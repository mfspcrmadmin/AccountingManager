(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  function draftError(message) { var error = new Error(message); error.code = "INVALID_DRAFT"; return error; }
  function crmErrorDetail(error) {
    if (!error) { return ""; }
    if (typeof error === "string") {
      try { return crmErrorDetail(JSON.parse(error)); } catch (ignored) { return error.slice(0, 500); }
    }
    if (error.responseText) { return crmErrorDetail(error.responseText); }
    return [error.code, error.message].filter(function (value) { return typeof value === "string" && value; }).join(": ").slice(0, 500);
  }
  ns.createPrepaymentBankService = function (zoho) {
    async function execute(action, ids, recipients, token, cc, html) {
      if (!ids.length || ids.length > 25 || ids.some(function (id) { return !/^\d+$/.test(id); })) { throw new Error("Select between 1 and 25 registered prepayments."); }
      var response;
      try {
        response = await zoho.CRM.FUNCTIONS.execute("notif_sendprepaymentbankrequest", { arguments: JSON.stringify({ action: action, prepaymentIds: ids.join("|||"), recipientEmails: recipients || "", reviewToken: token || "", ccEmails: cc || "", emailBody: html || "" }) });
      } catch (error) {
        var detail = crmErrorDetail(error);
        throw new Error((action === "send" ? "CRM did not confirm the send. Check email delivery before starting another request." : "Could not prepare the email using notif_sendprepaymentbankrequest.") + (detail ? " CRM: " + detail : " Check the function is deployed and available to your profile."));
      }
      var result = response && response.details && response.details.output;
      try { if (typeof result === "string") { result = JSON.parse(result); } } catch (ignored) { result = null; }
      var confirmed = result && (action === "send" ? result.sent === true : result.success === true && typeof result.html === "string" && Boolean(result.token));
      if (!confirmed) { throw new Error(result && result.message || "CRM did not confirm the operation. " + (action === "send" ? "Check email delivery before retrying. " : "") + crmErrorDetail(response)); }
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
      panel.querySelectorAll('[data-prepayment-select]').forEach(function (input) { input.checked = selected.has(input.value); input.disabled = busy; });
      panel.querySelectorAll('[data-prepayment-bank-requested], [data-prepayment-bank-receipt]').forEach(function (input) { input.disabled = busy || pending.has(input.value); });
    }
    panel.addEventListener("change", async function (event) {
      var input = event.target;
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
    cancel.addEventListener("click", function () { if (!busy) { dialog.close(); } });
    dialog.addEventListener("cancel", function (event) { if (busy) { event.preventDefault(); } });
    open.addEventListener("click", async function () {
      if (busy || !canSend() || pending.size) { return; }
      busy = true; draft = null; draftIds = Array.from(selected).sort(); sync();
      send.disabled = true; cancel.disabled = true; message.textContent = "Preparing email…";
      editor.innerHTML = ""; editor.contentEditable = "false"; find("subject").textContent = "";
      find("recipients").value = "claudia@madeforspainandportugal.com";
      find("cc").value = "luciano@madeforspainandportugal.com, andersson@madeforspainandportugal.com";
      dialog.showModal();
      try {
        draft = await service.prepare(draftIds);
        editor.innerHTML = draft.html;
        editor.contentEditable = "true";
        find("subject").textContent = draft.subject;
        message.textContent = draft.alreadyRequested ? draft.alreadyRequested + " already marked as requested. Sending will request payment again." : "Review and edit the email before sending.";
        send.disabled = false;
      } catch (error) { message.textContent = error.message; }
      finally { busy = false; cancel.disabled = false; sync(); }
    });
    find("form").addEventListener("submit", async function (event) {
      event.preventDefault(); if (busy || !draft) { return; }
      busy = true; sync(); send.disabled = true; cancel.disabled = true; find("recipients").disabled = true; find("cc").disabled = true; editor.contentEditable = "false";
      message.textContent = "Sending…";
      try {
        var result = await service.send(draftIds, find("recipients").value, draft.token, find("cc").value, editor.innerHTML);
        draft = null; selected.clear();
        message.textContent = result.message || "Bank payment request sent.";
        dialog.close();
        await reload();
        if (result.failedIds && result.failedIds.length) { showError(new Error(result.message || "Email sent, but some prepayments could not be marked as requested.")); }
      } catch (error) {
        // A timeout may happen after delivery: require a fresh, explicit review for another send.
        if (error.code !== "INVALID_DRAFT") { draft = null; }
        message.textContent = error.message;
        if (!dialog.open) { showError(error); }
      } finally { busy = false; cancel.disabled = false; find("recipients").disabled = false; find("cc").disabled = false; send.disabled = !draft; editor.contentEditable = draft ? "true" : "false"; sync(); }
    });
    return { render: function (payments, view) {
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
