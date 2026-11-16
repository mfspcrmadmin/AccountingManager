(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  function draftError(message) { var error = new Error(message); error.code = "INVALID_DRAFT"; return error; }
  function validEmails(value, required) {
    var emails = String(value || "").split(/[;,]/).map(function (email) { return email.trim(); }).filter(Boolean);
    return (!required || emails.length > 0) && emails.every(function (email) { return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email); });
  }
  function hasContent(html) { return Boolean(String(html || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim()); }
  function requestError(message, code, record, detail) {
    var error = new Error(message); error.code = code || "EMAIL_PREPARATION"; error.record = record; error.detail = detail || message; return error;
  }
  function failureCode(detail) { return /permission|forbidden|unauthorized|scope|access|AUTHENTICATION/i.test(detail) ? "ACCESS_ERROR" : /network|timeout|connection|fetch|offline/i.test(detail) ? "CONNECTION_ERROR" : "EMAIL_PREPARATION"; }
  function crmErrorDetail(error) {
    if (!error) { return ""; }
    if (typeof error === "string") {
      try { return crmErrorDetail(JSON.parse(error)); } catch (ignored) { return error.slice(0, 500); }
    }
    if (error.responseText) { return crmErrorDetail(error.responseText); }
    return [error.code, error.message].filter(function (value) { return typeof value === "string" && value; }).join(": ").slice(0, 500);
  }
  ns.createPrepaymentBankService = function (zoho) {
    async function readRecord(module, recordId) {
      var response = await zoho.CRM.API.getRecord({ Entity: module, RecordID: recordId });
      var record = response && response.data && response.data[0];
      if (!record || String(record.id) !== String(recordId)) { throw requestError("Unable to read the " + module + " record. Check access and retry.", "ACCESS_ERROR", { module: module, id: recordId }, crmErrorDetail(response)); }
      return record;
    }
    // Older deployed functions report the prepayment ID for every bank-account error.
    // Resolve the actual allocation account without guessing from the supplier default.
    async function explainLegacyAccountError(message) {
      var match = /needs a valid IBAN and supplier owner for (\d+)/.exec(message);
      if (!match) { return requestError(message, failureCode(message)); }
      var p = await readRecord("Prepayments", match[1]);
      var r = await readRecord("Prepayment_Requests", p.Prepayment_Request.id);
      var response = await zoho.CRM.API.searchRecord({ Entity: "Supplier_Pay_Allocations", Type: "criteria", Query: "(Supplier_Payment:equals:" + p.Vendor_Payment.id + ")", page: 1, per_page: 200 });
      if (!response || !Array.isArray(response.data) || response.info && response.info.more_records) { throw requestError("Unable to read all payment allocations. Check access and retry.", "ACCESS_ERROR", null, crmErrorDetail(response)); }
      var accountIds = Array.from(new Set(response.data.map(function (row) { return row.Payment_Account && row.Payment_Account.id; }).filter(Boolean)));
      if (accountIds.length !== 1) { return requestError("The supplier payment account could not be identified uniquely. Review the payment allocations.", "INCOMPLETE_DATA", { module: "Supplier_Payments", id: p.Vendor_Payment.id }, message); }
      var account = await readRecord("Payment_Accounts", accountIds[0]), issues = [];
      var record = { module: "Payment_Accounts", id: account.id, name: account.Name || "Supplier payment account" };
      if (!["Owner_Supplier", "IBAN", "Status"].every(function (field) { return Object.prototype.hasOwnProperty.call(account, field); })) { return requestError("Required bank-account fields are unavailable. Check field permissions for " + record.name + ".", "ACCESS_ERROR", record, message); }
      if (!account.Owner_Supplier || !account.Owner_Supplier.id) { issues.push("Owner Supplier is missing"); }
      else if (!r.Supplier || String(account.Owner_Supplier.id) !== String(r.Supplier.id)) { issues.push("Owner Supplier does not match the prepayment request supplier"); }
      if (!String(account.IBAN || "").trim()) { issues.push("IBAN is missing"); }
      if (account.Status === "Inactive") { issues.push("the account is inactive"); }
      return requestError(issues.length ? record.name + ": " + issues.join("; ") + ". Update this payment account and retry." : "Bank-account data could not be validated by the email function. Retry after reviewing " + record.name + ".", issues.length ? "INCOMPLETE_DATA" : "EMAIL_PREPARATION", record, message);
    }
    async function execute(action, ids, recipients, token, cc, html) {
      if (!ids.length || ids.length > 25 || ids.some(function (id) { return !/^\d+$/.test(id); })) { throw new Error("Select between 1 and 25 registered prepayments."); }
      var response;
      try {
        response = await zoho.CRM.FUNCTIONS.execute("notif_sendprepaymentbankrequest", { arguments: JSON.stringify({ action: action, prepaymentIds: ids.join("|||"), recipientEmails: recipients || "", reviewToken: token || "", ccEmails: cc || "", emailBody: html || "" }) });
      } catch (error) {
        var detail = crmErrorDetail(error);
        throw requestError((action === "send" ? "CRM did not confirm the send. Check email delivery before starting another request." : "Could not prepare the email using notif_sendprepaymentbankrequest.") + (detail ? " CRM: " + detail : " Check the function is deployed and available to your profile."), failureCode(detail), null, detail);
      }
      var result = response && response.details && response.details.output;
      try { if (typeof result === "string") { result = JSON.parse(result); } } catch (ignored) { result = null; }
      var confirmed = result && (action === "send" ? result.sent === true : result.success === true && hasContent(result.html) && typeof result.subject === "string" && Boolean(result.subject.trim()) && Boolean(result.token));
      if (!confirmed) {
        var errorMessage = result && result.message || "CRM did not confirm the operation. " + (action === "send" ? "Check email delivery before retrying. " : "Subject or email content is unavailable. ") + crmErrorDetail(response);
        if (action === "prepare" && /needs a valid IBAN and supplier owner for \d+/.test(errorMessage)) {
          var explained;
          try { explained = await explainLegacyAccountError(errorMessage); }
          catch (error) { explained = error.record ? error : requestError("Unable to retrieve the bank-account details. Check the connection and record access, then retry.", failureCode(crmErrorDetail(error)), null, crmErrorDetail(error)); }
          throw explained;
        }
        throw requestError(errorMessage, result && result.code || failureCode(errorMessage), result && result.record, result && result.detail);
      }
      return result;
    }
    async function setFlag(id, checked, field, label) {
        var data = { id: id }; data[field] = checked === true;
        var response = await zoho.CRM.API.updateRecord({ Entity: "Prepayments", APIData: data, Trigger: [] });
        var result = response && response.data && response.data[0];
        if (!result || result.code !== "SUCCESS") { throw new Error(result && result.message || "Could not update " + label + "."); }
        // Confirm the field exists and was saved; CRM can ignore unknown field names.
        var saved = await zoho.CRM.API.getRecord({ Entity: "Prepayments", RecordID: id });
        if (!saved || !saved.data || !saved.data[0] || saved.data[0][field] !== checked) { throw new Error("CRM did not confirm " + label + ". Check field permissions and refresh."); }
      }
    return {
      prepare: function (ids) { return execute("prepare", ids); },
      send: function (ids, recipients, token, cc, html) {
        var emails = recipients.split(/[;,]/).map(function (email) { return email.trim(); }).filter(Boolean);
        if (!emails.length || emails.some(function (email) { return !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email); })) { throw draftError("Enter valid recipient emails, separated by commas."); }
        if (!token) { throw new Error("Prepare and review the email before sending."); }
        var copies = String(cc || "").split(/[;,]/).map(function (email) { return email.trim(); }).filter(Boolean);
        if (copies.some(function (email) { return !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email); })) { throw draftError("Enter valid CC emails, separated by commas."); }
        if (!String(html || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim()) { throw draftError("Enter the email content before sending."); }
        return execute("send", ids, Array.from(new Set(emails)).join(","), token, Array.from(new Set(copies)).join(","), html);
      },
      setRequested: function (id, checked) { return setFlag(id, checked, "Bank_Payment_Requested", "Bank Payment Requested"); },
      setReceiptNeeded: function (id, checked) { return setFlag(id, checked, "Bank_Receipt_Needed", "Bank Receipt Needed"); }
    };
  };
  ns.createPrepaymentBankActions = function (panel, zoho, reload, showError) {
    var service = ns.createPrepaymentBankService(zoho), selected = new Set(), pending = new Set(), busy = false, draft = null, draftIds = [];
    var find = function (key) { return panel.querySelector('[data-prepayments-bank-' + key + ']'); };
    var dialog = find("dialog"), send = find("send"), open = find("open"), cancel = find("cancel"), message = find("message");
    var editor = find("preview"), receiptBulk = find("receipt-bulk"), statusView = "all", registered = new Set();
    var proofBulk = find("proof-bulk"), proofStatus = find("proof-status");
    var proofSender = ns.createPrepaymentProofSender ? ns.createPrepaymentProofSender(zoho) : null;
    var preparation = find("preparation"), preparing = false, preparationVersion = 0, affectedRecord = null, visiblePayments = new Map();
    function updateSend() {
      find("recipients").title = find("recipients").value; find("cc").title = find("cc").value;
      send.disabled = busy || !draft || !validEmails(find("recipients").value, true) || !validEmails(find("cc").value, false) || !hasContent(editor.innerHTML);
    }
    [find("recipients"), find("cc"), editor].forEach(function (input) { input.addEventListener("input", updateSend); });
    function canSend() { return statusView !== "open" && selected.size > 0 && selected.size <= 25 && Array.from(selected).every(function (id) { return registered.has(id); }); }
    editor.addEventListener("paste", function (event) {
      event.preventDefault();
      if (!busy) { global.document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); }
    });
    editor.addEventListener("drop", function (event) { event.preventDefault(); });
    function sync() {
      find("count").textContent = selected.size + " selected";
      open.hidden = statusView === "open";
      open.disabled = busy || pending.size > 0 || !canSend();
      receiptBulk.disabled = busy || pending.size > 0 || !selected.size;
      if (proofBulk) { proofBulk.disabled = busy || pending.size > 0 || !selected.size || !proofSender; }
      panel.querySelectorAll('[data-prepayment-select]').forEach(function (input) { input.checked = selected.has(input.value); input.disabled = busy; });
      panel.querySelectorAll('[data-prepayment-select-all]').forEach(function (input) {
        var rows = Array.from(input.closest('table').querySelectorAll('[data-prepayment-select]'));
        var count = rows.filter(function (row) { return selected.has(row.value); }).length;
        input.checked = rows.length > 0 && count === rows.length;
        input.indeterminate = count > 0 && count < rows.length;
        input.disabled = busy || !rows.length;
      });
      panel.querySelectorAll('[data-prepayment-bank-requested], [data-prepayment-bank-receipt]').forEach(function (input) { input.disabled = busy || pending.has(input.value); });
    }
    panel.addEventListener("change", async function (event) {
      var input = event.target;
      if (input.matches('[data-prepayment-select-all]')) {
        if (!busy) {
          input.closest('table').querySelectorAll('[data-prepayment-select]').forEach(function (row) {
            if (input.checked) { selected.add(row.value); } else { selected.delete(row.value); }
          });
        }
        sync(); return;
      }
      if (input.matches('[data-prepayment-select]')) {
        if (!busy) {
          if (!input.checked) { selected.delete(input.value); }
          else { selected.add(input.value); }
        }
        sync();
      }
      if (input.matches('[data-prepayment-bank-requested]') || input.matches('[data-prepayment-bank-receipt]')) {
        if (busy || pending.has(input.value)) { return; }
        var checked = input.checked; pending.add(input.value); sync();
        try { await (input.matches('[data-prepayment-bank-receipt]') ? service.setReceiptNeeded(input.value, checked) : service.setRequested(input.value, checked)); await reload(); }
        catch (error) { input.checked = !checked; showError(error); }
        finally { pending.delete(input.value); sync(); }
      }
    });
    if (proofBulk && proofStatus) { proofBulk.addEventListener("click", async function () {
      if (busy || pending.size || !selected.size || !proofSender) { return; }
      var ids = Array.from(selected), failures = [], sentCount = 0;
      busy = true; sync(); proofStatus.hidden = false;
      try {
        for (var index = 0; index < ids.length; index += 1) {
          proofStatus.textContent = "Sending payment proof " + (index + 1) + " of " + ids.length + "…";
          try { await proofSender.send(ids[index]); sentCount += 1; }
          catch (error) { failures.push(ids[index] + ": " + (error.message || "Send not confirmed.")); }
          // Never leave attempted sends selected: a timeout may follow delivery.
          selected.delete(ids[index]);
        }
      } finally {
        busy = false; sync();
        proofStatus.textContent = sentCount + " of " + ids.length + " payment proof email(s) sent." +
          (failures.length ? " Not confirmed: " + failures.join("; ") + " Check these records and email delivery before selecting them again." : "");
      }
    }); }
    receiptBulk.addEventListener("click", async function () {
      if (busy || pending.size || !selected.size) { return; }
      var ids = Array.from(selected), failures = [];
      busy = true; sync();
      try {
        for (var id of ids) {
          try { await service.setReceiptNeeded(id, true); selected.delete(id); }
          catch (error) { failures.push(id + ": " + error.message); }
        }
        await reload();
      } catch (error) { showError(error); }
      finally {
        busy = false; sync();
        if (failures.length) { showError(new Error("Could not mark Bank Receipt Needed for " + failures.length + " prepayment(s). " + failures.join("; "))); }
      }
    });
    function closeDraft() { if (!busy) { dialog.close(); draft = null; updateSend(); } }
    cancel.addEventListener("click", closeDraft);
    find("close").addEventListener("click", closeDraft);
    dialog.addEventListener("cancel", function (event) { if (busy) { event.preventDefault(); } });
    function cancelPreparation() {
      preparationVersion += 1; preparing = false; busy = false; draft = null;
      preparation.close(); sync();
    }
    find("preparation-close").addEventListener("click", cancelPreparation);
    preparation.addEventListener("cancel", function (event) { event.preventDefault(); cancelPreparation(); });
    preparation.addEventListener("close", function () { if (preparing && !preparation.open) { cancelPreparation(); } });
    find("record").addEventListener("click", async function () {
      if (!affectedRecord) { return; }
      try { await zoho.CRM.UI.Record.open({ Entity: affectedRecord.module, RecordID: affectedRecord.id }); }
      catch (error) { find("preparation-message").textContent = "Could not open the record. " + crmErrorDetail(error); }
    });
    async function prepareDraft() {
      var version = ++preparationVersion;
      preparing = true; busy = true; draft = null; affectedRecord = null; sync();
      send.disabled = true; message.textContent = "";
      editor.innerHTML = ""; editor.contentEditable = "false"; find("subject").textContent = "";
      find("recipients").value = "claudia@madeforspainandportugal.com";
      find("cc").value = "luciano@madeforspainandportugal.com, andersson@madeforspainandportugal.com";
      find("preparation-title").textContent = "Preparing payment request…";
      find("preparation-message").textContent = "";
      find("preparation-spinner").hidden = false; find("preparation-error").hidden = true;
      find("retry").hidden = true; find("record").hidden = true; find("technical").hidden = true; find("technical").open = false;
      if (!preparation.open) { preparation.showModal(); }
      try {
        var prepared = await service.prepare(draftIds);
        if (version !== preparationVersion) { return; }
        draft = prepared;
        editor.innerHTML = draft.html;
        editor.contentEditable = "true";
        find("subject").textContent = draft.subject;
        find("context").textContent = draftIds.map(function (id) { var p = visiblePayments.get(id); return p && p.Name || id; }).join(" · ");
        message.textContent = draft.alreadyRequested ? draft.alreadyRequested + " already marked as requested. Sending will request payment again." : "";
        preparing = false; preparation.close(); dialog.showModal();
      } catch (error) {
        if (version !== preparationVersion) { return; }
        preparing = false; affectedRecord = error.record;
        find("preparation-spinner").hidden = true; find("preparation-error").hidden = false;
        find("preparation-title").textContent = error.code === "ACCESS_ERROR" ? "Unable to access request data" : error.code === "CONNECTION_ERROR" ? "Connection failed" : "Unable to prepare request";
        find("preparation-message").textContent = error.message;
        find("technical").hidden = false;
        find("technical-detail").textContent = [error.code, affectedRecord && affectedRecord.module, affectedRecord && affectedRecord.id, error.detail].filter(Boolean).join("\n");
        find("retry").hidden = false;
        find("record").hidden = !(affectedRecord && zoho.CRM.UI && zoho.CRM.UI.Record && zoho.CRM.UI.Record.open);
        find("record").textContent = affectedRecord && affectedRecord.module === "Payment_Accounts" ? "Open payment account" : "Open record";
      } finally { if (version === preparationVersion) { busy = false; cancel.disabled = false; updateSend(); sync(); } }
    }
    find("retry").addEventListener("click", function () { if (!busy) { return prepareDraft(); } });
    open.addEventListener("click", function () {
      if (busy || !canSend() || pending.size) { return; }
      draftIds = Array.from(selected).sort(); return prepareDraft();
    });
    find("form").addEventListener("submit", async function (event) {
      event.preventDefault(); if (busy || !draft) { return; }
      busy = true; sync(); send.disabled = true; cancel.disabled = true; find("close").disabled = true; find("send-spinner").hidden = false; find("send-label").textContent = "Sending…"; find("recipients").disabled = true; find("cc").disabled = true; editor.contentEditable = "false";
      message.textContent = "Sending…";
      try {
        var result = await service.send(draftIds, find("recipients").value, draft.token, find("cc").value, editor.innerHTML);
        draft = null; selected.clear();
        message.textContent = result.message || "Bank payment request sent.";
        find("result").hidden = false; find("result").textContent = message.textContent;
        dialog.close();
        await reload();
        if (result.failedIds && result.failedIds.length) { showError(new Error(result.message || "Email sent, but some prepayments could not be marked as requested.")); }
      } catch (error) {
        // A timeout may happen after delivery: require a fresh, explicit review for another send.
        if (error.code !== "INVALID_DRAFT") { draft = null; }
        message.textContent = error.message;
        if (!dialog.open) { showError(error); }
      } finally { busy = false; cancel.disabled = false; find("close").disabled = false; find("send-spinner").hidden = true; find("send-label").textContent = "Send request"; find("recipients").disabled = false; find("cc").disabled = false; updateSend(); editor.contentEditable = "true"; sync(); }
    });
    return { render: function (payments, view) {
      visiblePayments = new Map(payments.map(function (payment) { return [String(payment.id), payment]; }));
      var nextView = view || "all";
      if (nextView !== statusView) { selected.clear(); }
      statusView = nextView;
      var eligible = new Set(payments.map(function (p) { return String(p.id); }));
      registered = new Set(payments.filter(function (p) { return p.Accounting_Status === "Prepayment recorded"; }).map(function (p) { return String(p.id); }));
      selected.forEach(function (id) { if (!eligible.has(id)) { selected.delete(id); } });
      sync();
    } };
  };
}(window));
