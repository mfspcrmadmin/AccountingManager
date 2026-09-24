(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var REQUESTS = "Prepayment_Requests", PAYMENTS = "Prepayments";
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function id(value) { return String(value && value.id || ""); }
  function name(value) { return String(value && (value.name || value.Name) || ""); }
  function day(value) { return String(value || "").slice(0, 10); }
  function date(value) { var d = day(value); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split("-").reverse().join("/") : "—"; }
  function number(value) { return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null; }
  function money(value, currency) { return number(value) === null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "EUR" }).format(Number(value)); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function overdue(payment, currentDay) { return isPending(payment) && Boolean(day(payment.Due_Date)) && day(payment.Due_Date) < currentDay; }
  function accountingStatus(payment) { return payment.Accounting_Status && payment.Accounting_Status !== "-None-" ? payment.Accounting_Status : "No status"; }
  function accountingStatusClass(payment) {
    switch (accountingStatus(payment)) {
      case "Pending invoice": return "is-pending-invoice";
      case "Pending payment record": return "is-pending-payment";
      case "Prepayment recorded": return "is-paid";
      case "Cancelled": return "is-cancelled";
      case "Discard - Credit": return "is-discard-credit";
      case "Discard - Already Paid": return "is-discard-paid";
      default: return "is-neutral";
    }
  }
  function isClosed(payment) { return ["Prepayment recorded", "Cancelled", "Discard - Credit", "Discard - Already Paid"].indexOf(accountingStatus(payment)) !== -1; }
  ns.isOwnQuickPaymentAccount = function (account) {
    return Boolean(account) && String(account.Owner_Type || "").trim().toLowerCase() === "own" && String(account.Status || "").trim().toLowerCase() !== "inactive";
  };
  ns.loadOwnPaymentAccountChoices = async function (api, preferredId) {
    var accounts = (await loadModule(api, "Payment_Accounts")).filter(ns.isOwnQuickPaymentAccount);
    accounts.sort(function (a, b) { return String(a.Name || a.id).localeCompare(String(b.Name || b.id)); });
    return { accounts: accounts, defaultAccountId: accounts.some(function (account) { return id(account) === String(preferredId || ""); }) ? String(preferredId) : "" };
  };
  ns.discardPrepayment = async function (api, recordId, status, meta) {
    if (["Discard - Credit", "Discard - Already Paid"].indexOf(status) === -1) { throw new Error("Select a discard reason."); }
    var response = await api.getRecord({ Entity: PAYMENTS, RecordID: recordId });
    var payment = response && response.data && response.data[0];
    if (!payment || id(payment) !== String(recordId)) { throw new Error("Could not read this prepayment."); }
    if ((isClosed(payment) && payment.Accounting_Status !== status) || id(payment.Vendor_Payment)) { throw new Error("This prepayment is already closed or linked to a payment. Refresh its details."); }
    response = await api.updateRecord({ Entity: PAYMENTS, APIData: { id: recordId, Accounting_Status: status }, Trigger: ["workflow"] });
    var result = response && response.data && response.data[0];
    if (!result || (result.code !== "SUCCESS" && result.status !== "success")) { throw new Error(result && result.message || "CRM did not confirm the status change."); }
    if (id(payment.Prepayment_Request)) {
      try { await ns.syncPrepaymentRequestFromSDK(api, meta, id(payment.Prepayment_Request)); }
      catch (error) { throw new Error("Discard saved, but request/services status could not be synchronized. Retry to synchronize: " + error.message); }
    }
  };
  function isPending(payment) { return ["Pending invoice", "Pending payment record", "No status"].indexOf(accountingStatus(payment)) !== -1; }
  ns.updatePrepaymentDueDate = async function (api, recordId, value) {
    if (!recordId || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new Error("Enter a valid due date.");
    }
    var response = await api.updateRecord({ Entity: PAYMENTS, APIData: { id: recordId, Due_Date: value }, Trigger: ["workflow"] });
    var result = response && response.data && response.data[0];
    if (!result || (result.code !== "SUCCESS" && result.status !== "success")) { throw new Error(result && result.message || "CRM did not confirm the due date change."); }
  };
  function paymentSort(a, b) { return (day(a.Due_Date) || "9999").localeCompare(day(b.Due_Date) || "9999") || String(a.Name || a.id).localeCompare(String(b.Name || b.id)); }
  function totals(payments, predicate) {
    var sums = {}, missing = 0;
    payments.filter(predicate || function () { return true; }).forEach(function (p) {
      if (number(p.Amount) === null) { missing += 1; return; }
      var currency = p.Currency || "EUR";
      sums[currency] = (sums[currency] || 0) + Number(p.Amount);
    });
    return { sums: sums, missing: missing };
  }
  function totalText(value) {
    var parts = Object.keys(value.sums).sort().map(function (currency) { return money(value.sums[currency], currency); });
    if (value.missing) { parts.push(value.missing + " missing amount" + (value.missing === 1 ? "" : "s")); }
    return parts.join(" · ") || "—";
  }
  function groupRecords(requests, payments) {
    var groups = requests.map(function (request) { return { key: id(request), request: request, payments: [] }; });
    var byId = new Map(groups.map(function (group) { return [group.key, group]; }));
    payments.forEach(function (payment) {
      var requestId = id(payment.Prepayment_Request), key = requestId || "unassigned";
      if (!byId.has(key)) {
        var group = { key: key, request: null, requestId: requestId, label: requestId ? (name(payment.Prepayment_Request) || "Request unavailable") : "No prepayment request", payments: [] };
        byId.set(key, group); groups.push(group);
      }
      byId.get(key).payments.push(payment);
    });
    groups.forEach(function (group) { group.payments.sort(paymentSort); });
    return groups;
  }
  function filterGroups(groups, filters, currentDay) {
    var mfsp = String(filters.mfsp || "").trim().toLowerCase();
    var supplierCode = String(filters.supplierCode || "").trim().toLowerCase();
    var paymentFilter = filters.dueToday || filters.from || filters.to || filters.paymentFrom || filters.paymentTo || filters.accountingStatus || filters.bankRequested || filters.bankReceipt || filters.statusView === "closed";
    return groups.map(function (group) {
      var r = group.request || {};
      var parentMatch = (!mfsp || String(r.MFSP_Reference || "").toLowerCase().indexOf(mfsp) !== -1) &&
        (!supplierCode || String(r.Supplier_Code || "").toLowerCase().indexOf(supplierCode) !== -1);
      var visible = group.payments.filter(function (p) {
        return parentMatch &&
          (filters.statusView === "open" ? !isClosed(p) : filters.statusView === "closed" ? isClosed(p) : true) &&
          (filters.dueToday ? day(p.Due_Date) === currentDay :
            (!filters.from || (day(p.Due_Date) && day(p.Due_Date) >= filters.from)) &&
            (!filters.to || (day(p.Due_Date) && day(p.Due_Date) <= filters.to))) &&
          (!filters.paymentFrom || (day(p.Payment_Date) && day(p.Payment_Date) >= filters.paymentFrom)) &&
          (!filters.paymentTo || (day(p.Payment_Date) && day(p.Payment_Date) <= filters.paymentTo)) &&
          (!filters.accountingStatus || accountingStatus(p) === filters.accountingStatus) &&
          (!filters.bankRequested || (p.Bank_Payment_Requested === true) === (filters.bankRequested === "yes")) &&
          (!filters.bankReceipt || (p.Bank_Receipt_Needed === true) === (filters.bankReceipt === "yes"));
      });
      return Object.assign({}, group, { visible: visible, include: visible.length > 0 || (!group.payments.length && parentMatch && !paymentFilter) });
    }).filter(function (group) { return group.include; }).sort(function (a, b) {
      var nextA = a.visible.find(function (p) { return isPending(p) && p.Due_Date; });
      var nextB = b.visible.find(function (p) { return isPending(p) && p.Due_Date; });
      return (nextA ? day(nextA.Due_Date) : "9999").localeCompare(nextB ? day(nextB.Due_Date) : "9999") ||
        String(b.request && b.request.Requested_Date || "").localeCompare(String(a.request && a.request.Requested_Date || "")) || a.key.localeCompare(b.key);
    });
  }
  async function loadModule(api, module) {
    var all = [], seen = new Set(), page = 1;
    while (true) {
      var response;
      try { response = await api.getAllRecords({ Entity: module, page: page, per_page: 200, sort_by: "id", sort_order: "asc" }); }
      catch (error) { if (Number(error && error.status) === 204 || error && error.code === "NO_CONTENT") { return all; } throw new Error("Could not load " + module + ": " + (error && error.message || "CRM request failed.")); }
      if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { return all; }
      if (!response || !Array.isArray(response.data) || response.status === "error") { throw new Error("Could not load " + module + ": " + (response && response.message || "Invalid CRM response.")); }
      response.data.forEach(function (record) {
        if (!id(record) || seen.has(id(record))) { throw new Error("CRM returned incomplete or repeated pages for " + module + ". Refresh to retry."); }
        seen.add(id(record)); all.push(record);
      });
      if (!(response.info && response.info.more_records)) { return all; }
      if (!response.data.length) { throw new Error("CRM returned an empty page before finishing " + module + "."); }
      page += 1;
    }
  }
  function recordButton(module, recordId, label) {
    return recordId ? '<button type="button" class="prepayment-record-link" data-prepayment-module="' + module + '" data-prepayment-record="' + esc(recordId) + '">' + esc(label) + '</button>' : esc(label || "—");
  }
  function documents(value, module, recordId, label) {
    var list = Array.isArray(value) ? value : value ? [value] : [];
    return list.length ? '<div class="prepayment-documents"><strong>' + label + ' <small>(open in CRM)</small></strong>' + list.map(function (file) {
      return recordButton(module, recordId, typeof file === "string" ? file : file.File_Name__s || file.File_Name || file.file_Name || file.name || label);
    }).join("") + '</div>' : "";
  }
  function registrationButton(payment) {
    var readOnly = isClosed(payment);
    var path = readOnly ? 'M2.5 10s2.7-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.7 4.5-7.5 4.5S2.5 10 2.5 10Zm7.5 2.2A2.2 2.2 0 1 0 10 7.8a2.2 2.2 0 0 0 0 4.4Z' : 'M5 2.75h6.3L15 6.45v10.8H5zM11 2.75v3.7h4M7.5 11l1.7 1.7 3.5-3.5';
    var title = (readOnly ? "View " : "Register invoice and payment for ") + (payment.Name || id(payment));
    return '<button class="card-purchase-review-button" type="button" data-prepayment-register="' + esc(id(payment)) + '" aria-label="' + esc(title) + '" title="' + esc(title) + '"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="' + path + '" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg></button>';
  }
  function discardButton(payment) {
    if (isClosed(payment) || id(payment.Vendor_Payment)) { return ""; }
    var title = "Discard prepayment: " + (payment.Name || id(payment));
    return '<button class="prepayment-discard-button" type="button" data-prepayment-discard="' + esc(id(payment)) + '" aria-label="' + esc(title) + '">Discard</button>';
  }
  function deleteButton(payment) {
    var blocked = id(payment.Vendor_Invoice) || id(payment.Vendor_Payment) || payment.Accounting_Status === "Prepayment recorded";
    return id(payment) ? '<button type="button" class="button tertiary compact-action-button" data-prepayment-delete="' + esc(id(payment)) + '" aria-label="Delete ' + esc(payment.Name || id(payment)) + '" title="' + (blocked ? 'Cannot delete: associated invoice or payment' : 'Delete prepayment') + '"' + (blocked ? ' disabled' : '') + '>Delete</button>' : '';
  }
  function actionsMenu(payment, showRequest) {
    var menuId = 'prepayment-actions-' + (showRequest ? 'all-' : 'request-') + id(payment);
    return '<button class="card-purchase-review-button" type="button" data-prepayment-actions popovertarget="' + esc(menuId) + '" aria-label="Actions for ' + esc(payment.Name || id(payment)) + '" title="More actions"><svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/></svg></button><div id="' + esc(menuId) + '" class="prepayment-actions-menu" popover="auto" aria-label="Prepayment actions">' + discardButton(payment) + deleteButton(payment) + '</div>';
  }
  function paymentTable(rows, currentDay, showRequest, statusView, onColumnsChanged) {
    var definitions = [
      ["Bank_Payment_Requested", "Bank Payment Requested"], ["Bank_Receipt_Needed", "Bank Receipt Needed"],
      ["Name", "Prepayment"],
      ...(showRequest ? [["Request", "Request / supplier / booking"]] : []),
      ["Observations", "Observations"], ["Accounting_Status", "Accounting Status"], ["Due_Date", "Due date"],
      ["Amount", "Amount"], ["Percent", "%"], ["Payment_Date", "Payment date"],
      ["Payment_Proof", "Payment proof"], ["Proforma", "Proforma"], ["Reported_By", "Reported By"]
    ];
    var manager = ns.tableColumns, tableKey = showRequest ? "prepayments" : "prepaymentsByRequest";
    if (manager) { manager.configure(tableKey, definitions.map(function (column) { return { key: column[0], label: column[1], defaultWidth: column[0] === "Name" ? 300 : column[0] === "Request" ? 360 : column[0] === "Observations" || column[0] === "Proforma" ? 260 : column[0] === "Amount" ? 120 : 180 }; }), onColumnsChanged); }
    var order = manager ? manager.visibleOrder(tableKey) : definitions.map(function (column) { return column[0]; });
    var bankColumns = ["Bank_Payment_Requested", "Bank_Receipt_Needed"];
    order = bankColumns.filter(function (key) { return order.indexOf(key) !== -1; }).concat(order.filter(function (key) { return bankColumns.indexOf(key) === -1; }));
    if (statusView === "open") { order = order.filter(function (key) { return key !== "Bank_Payment_Requested"; }); }
    var labels = Object.fromEntries(definitions);
    var head = '<th aria-label="Actions"><input class="prepayment-select" type="checkbox" data-prepayment-select-all aria-label="Select all payments in this table" title="Select or deselect all payments in this table"></th>' + order.map(function (key) {
      var html = '<th>' + esc(labels[key]) + '</th>';
      return manager ? manager.resizableHeader(key, html) : html;
    }).join('') + (manager ? '<th class="table-columns-gear-cell">' + manager.button(tableKey) + '</th>' : '');
    return '<div class="table-wrap"><table class="results-table prepayments-table"><thead><tr>' + head + '</tr></thead><tbody>' + rows.map(function (row) {
      var p = row.payment, r = row.group.request || {}, late = overdue(p, currentDay);
      var dueToday = !isClosed(p) && Boolean(day(p.Due_Date)) && day(p.Due_Date) === currentDay;
      var select = id(p) ? '<input class="prepayment-select" type="checkbox" data-prepayment-select value="' + esc(id(p)) + '" aria-label="Select ' + esc(p.Name || id(p)) + '">' : '<span class="prepayment-select-space"></span>';
      var requested = p.Bank_Payment_Requested === true;
      var bank = '<label class="prepayment-bank-toggle" title="Bank Payment Requested — click to mark or unmark manually"><input type="checkbox" data-prepayment-bank-requested value="' + esc(id(p)) + '"' + (requested ? ' checked' : '') + ' aria-label="Bank Payment Requested: ' + esc(p.Name || id(p)) + '"><span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 7l8-4 8 4H2Zm2 2v6m4-6v6m4-6v6m4-6v6M2 17h16"/></svg><span class="bank-requested-yes">Requested</span><span class="bank-requested-no">Not requested</span></span></label>';
      var receipt = '<label class="prepayment-bank-toggle prepayment-receipt-toggle" title="Bank Receipt Needed - click to mark or unmark manually"><input type="checkbox" data-prepayment-bank-receipt value="' + esc(id(p)) + '"' + (p.Bank_Receipt_Needed === true ? ' checked' : '') + ' aria-label="Bank Receipt Needed: ' + esc(p.Name || id(p)) + '"><span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 2.5 7 4l3-1.5L13 4l2-1.5v15L13 16l-3 1.5L7 16l-2 1.5zM8 7h4M8 10h4M8 13h2"/></svg><span class="bank-requested-yes">Needed</span><span class="bank-requested-no">Not needed</span></span></label>';
      var proformas = ns.operationsDocuments ? ns.operationsDocuments.files(r.Proforma_Attached) : [];
      var proofs = Array.isArray(p.Payment_Proof) ? p.Payment_Proof : [];
      var proofLinks = proofs.map(function (file, index) {
        var title = typeof file === "string" ? "Payment proof" : file.File_Name__s || file.File_Name || file.file_Name || file.file_name || file.filename || file.fileName || file.name || "Payment proof";
        return '<div><button class="card-purchase-file" type="button" data-prepayment-proof-preview="' + esc(id(p)) + '" data-proof-index="' + index + '" title="Preview ' + esc(title) + '">' + esc(title) + '</button></div>';
      }).join('');
      var proofAction = proofs.length ? 'Edit' : 'Attach';
      var proofIcon = proofs.length ? 'M12 3l5 5M3 17l4-1L17 6a2.1 2.1 0 0 0-3-3L4 13z' : 'm7 11 5-5a2 2 0 0 1 3 3l-6 6a3.5 3.5 0 0 1-5-5l6-6';
      var cells = {
        Name: recordButton(PAYMENTS, id(p), p.Name || id(p)) + '<small>' + esc(p.When_To_Be_Paid === "-None-" ? "" : p.When_To_Be_Paid) + '</small>',
        Request: recordButton(REQUESTS, id(r) || row.group.requestId, r.Name || row.group.label) + '<small>' + esc([name(r.Supplier), r.MFSP_Reference || name(r.Booking)].filter(Boolean).join(' · ')) + '</small>',
        Observations: esc(p.Observations || r.Observations || '-'),
        Accounting_Status: '<span class="prepayment-status ' + accountingStatusClass(p) + '">' + esc(accountingStatus(p)) + '</span>',
        Due_Date: (id(p) ? '<button type="button" class="prepayment-record-link prepayment-due-edit" data-prepayment-due-edit="' + esc(id(p)) + '" aria-label="Edit due date for ' + esc(p.Name || id(p)) + '" title="Edit due date">' + date(p.Due_Date) + ' <span aria-hidden="true">✎</span></button>' : date(p.Due_Date)) + (dueToday ? '<small class="prepayment-due-today-label">Due today</small>' : late ? '<small>Overdue</small>' : ''),
        Amount: esc(money(p.Amount, p.Currency)),
        Percent: number(p.Percent) === null ? '?' : esc(p.Percent) + '%',
        Payment_Date: date(p.Payment_Date),
        Reported_By: esc(r.Requested_By_2 || '-'),
        Bank_Payment_Requested: bank,
        Bank_Receipt_Needed: receipt,
        Payment_Proof: '<div class="prepayment-receipt-actions">' + (proofLinks || (p.Bank_Receipt_Needed === true && id(p) ? '' : '-')) + (p.Bank_Receipt_Needed === true && id(p) ? '<button class="prepayment-proof-button" type="button" data-prepayment-proof="' + esc(id(p)) + '" title="' + proofAction + ' payment proof" aria-label="' + proofAction + ' payment proof for ' + esc(p.Name || id(p)) + '"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="' + proofIcon + '"/></svg>' + (proofs.length ? '' : 'Attach') + '</button>' : '') + '</div>',
        Proforma: proformas.map(function (file, index) { return '<div><button class="card-purchase-file" type="button" data-prepayment-proforma="' + esc(row.group.key || id(r)) + '" data-proforma-index="' + index + '" title="Preview ' + esc(file.name) + '">' + esc(file.name) + '</button></div>'; }).join('') || 'No proforma associated.'
      };
      return '<tr' + (dueToday ? ' class="prepayment-due-today"' : '') + '><td class="card-purchase-review-cell"><div class="prepayment-row-actions">' + select + registrationButton(p) + actionsMenu(p, showRequest) + '</div></td>' + order.map(function (key) {
        var cls = key === 'Amount' ? 'numeric-cell' : key === 'Observations' ? 'prepayment-observations' : key === 'Due_Date' && late ? 'prepayment-overdue' : '';
        return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + cells[key] + '</td>';
      }).join('') + (manager ? '<td class="table-columns-gear-cell"></td>' : '') + '</tr>';
    }).join('') + '</tbody></table></div>';
  }
  ns.prepaymentsModel = { today: today, paymentTable: paymentTable, isClosed: isClosed, isPending: isPending, groupRecords: groupRecords, filterGroups: filterGroups, totals: totals, loadModule: loadModule, overdue: overdue };
  ns.createPrepaymentsWorkspace = function (panel, zoho) {
    var groups = [], loaded = false, busy = false, generation = 0, view = "payments", statusView = "open", page = 1, expanded = new Set();
    var dueDateSaves = new Set();
    var deletion = ns.createPrepaymentDeletionService ? ns.createPrepaymentDeletionService(zoho, global.localStorage) : null;
    var deleteBusy = false;
    function closeActionsMenus() {
      panel.querySelectorAll('.prepayment-actions-menu:popover-open').forEach(function (menu) { menu.hidePopover(); });
    }
    // Capture clicks before action handlers or other widget controls stop propagation.
    global.addEventListener("click", function (event) {
      if (event.target.closest && event.target.closest('[data-prepayment-actions]')) { return; }
      closeActionsMenus();
    }, true);
    var dueTodayOnly = false;
    var applied = { mfsp: "", supplierCode: "", from: "", to: "", paymentFrom: "", paymentTo: "", accountingStatus: "", bankRequested: "", bankReceipt: "" };
    var find = function (key) { return panel.querySelector('[data-prepayments-' + key + ']'); };
    var message = find("message"), results = find("results"), summary = find("summary"), pager = find("pager"), refresh = find("refresh");
    var workflow = ns.createPrepaymentWorkflow(panel, zoho, load);
    var bankActions = ns.createPrepaymentBankActions ? ns.createPrepaymentBankActions(panel, zoho, load, showError) : null;
    var proofDialog = ns.createPrepaymentProofDialog ? ns.createPrepaymentProofDialog(panel, zoho, function (updated) {
      groups.forEach(function (group) { group.payments.forEach(function (payment) { if (id(payment) === id(updated)) { Object.assign(payment, updated); } }); });
      render();
    }) : null;
    var discardDialog = find("discard-dialog"), discardId = "", discardBusy = false;
    var deleteDialog = find("delete-dialog"), deleteId = "";
    find("delete-cancel").addEventListener("click", function () { if (!deleteBusy) { deleteDialog.close(); } });
    deleteDialog.addEventListener("cancel", function (event) { if (deleteBusy) { event.preventDefault(); } });
    find("delete-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      if (deleteBusy || !deleteId || !deletion) { return; }
      deleteBusy = true; find("delete-submit").disabled = true; find("delete-cancel").disabled = true;
      find("delete-error").textContent = "";
      try {
        await deletion.remove(deleteId);
        deleteDialog.close(); await load();
        if (loaded) { message.textContent = "Prepayment and its unused relationships deleted."; }
      } catch (error) { find("delete-error").textContent = error.message + " If deletion started, confirm again to finish the remaining steps."; }
      finally { deleteBusy = false; find("delete-submit").disabled = false; find("delete-cancel").disabled = false; }
    });
    find("discard-cancel").addEventListener("click", function () { if (!discardBusy) { discardDialog.close(); } });
    discardDialog.addEventListener("cancel", function (event) { if (discardBusy) { event.preventDefault(); } });
    find("discard-form").addEventListener("submit", async function (event) {
      event.preventDefault(); if (discardBusy || !discardId) { return; }
      discardBusy = true; find("discard-submit").disabled = true; find("discard-cancel").disabled = true; find("discard-status").disabled = true;
      find("discard-error").textContent = "";
      try {
        await ns.discardPrepayment(zoho.CRM.API, discardId, find("discard-status").value, zoho.CRM.META);
        discardDialog.close(); await load();
      } catch (error) { find("discard-error").textContent = error.message || "Could not change the status."; }
      finally { discardBusy = false; find("discard-submit").disabled = false; find("discard-cancel").disabled = false; find("discard-status").disabled = false; }
    });
    function showError(error) { message.textContent = error && error.message || String(error); message.classList.add("is-error"); }
    function render() {
      panel.querySelectorAll('[data-prepayments-status-view]').forEach(function (button) { var active = button.dataset.prepaymentsStatusView === statusView; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); });
      panel.querySelectorAll('[data-prepayments-view]').forEach(function (button) { var active = button.dataset.prepaymentsView === view; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); });
      if (!loaded) { return; }
      var currentDay = today(), filtered = filterGroups(groups, Object.assign({}, applied, { statusView: statusView, dueToday: dueTodayOnly }), currentDay);
      var rows = [];
      filtered.forEach(function (group) { group.visible.forEach(function (payment) { rows.push({ payment: payment, group: group }); }); });
      rows.sort(function (a, b) { return paymentSort(a.payment, b.payment); });
      var payments = rows.map(function (row) { return row.payment; });
      summary.hidden = view !== "requests";
      summary.innerHTML = [
        ['Requests shown', String(filtered.filter(function (g) { return g.request && (view === "requests" || g.visible.length); }).length)],
        ['Prepayments shown', String(payments.length)],
        ['Pending registration', totalText(totals(payments, function (p) { return isPending(p); }))],
        ['Overdue', totalText(totals(payments, function (p) { return overdue(p, currentDay); }))]
      ].map(function (item) { return '<div><span>' + item[0] + '</span><strong>' + esc(item[1]) + '</strong></div>'; }).join("");
      var items = view === "requests" ? filtered : rows, pages = Math.max(1, Math.ceil(items.length / 15));
      page = Math.min(page, pages);
      var visible = items.slice((page - 1) * 15, page * 15);
      message.classList.remove("is-error");
      message.textContent = !items.length ? "No " + (view === "requests" ? "requests" : "prepayments") + " match these filters." : "";
      results.innerHTML = view === "payments" ? (visible.length ? paymentTable(visible, currentDay, true, statusView, render) : "") : visible.map(function (group) {
        var r = group.request || {}, pending = group.payments.filter(function (p) { return isPending(p); });
        var nextDue = pending.find(function (p) { return p.Due_Date; });
        var key = esc(group.key), requestId = id(r) || group.requestId;
        return '<details class="prepayment-request" data-prepayment-group="' + key + '"' + (expanded.has(group.key) ? ' open' : '') + '><summary><span class="prepayment-request-heading"><strong>' + esc(r.Name || group.label) + '</strong><small>' + esc([name(r.Supplier), r.Supplier_Code, r.MFSP_Reference, name(r.Booking)].filter(Boolean).join(" · ") || "No supplier or booking information") + '</small></span><span><small>Prepayments</small><strong>' + group.payments.length + '</strong></span><span><small>Pending registration</small><strong>' + esc(totalText(totals(pending))) + '</strong></span><span><small>Next due</small><strong>' + date(nextDue && nextDue.Due_Date) + '</strong></span></summary><div class="prepayment-request-body"><div class="prepayment-request-meta"><div><small>Requested by</small><strong>' + esc(r.Requested_By_2 || '—') + '</strong></div><div><small>Requested date</small><strong>' + date(r.Requested_Date) + '</strong></div><div><small>Type</small><strong>' + esc(r.Transaction_Type === '-None-' ? '—' : r.Transaction_Type || '—') + '</strong></div></div>' +
          (!group.request ? '<p class="prepayment-warning">' + (requestId ? 'The linked request is unavailable. Check your CRM access.' : 'These prepayments have no linked request.') + '</p>' : '') +
          '<p class="prepayment-request-totals">All prepayments: ' + esc(totalText(totals(group.payments))) + ' · Paid: ' + esc(totalText(totals(group.payments, function (p) { return p.Accounting_Status === "Prepayment recorded"; }))) + ' · Cancelled: ' + esc(totalText(totals(group.payments, function (p) { return p.Accounting_Status === "Cancelled"; }))) + '</p>' +
          (r.Observations ? '<p class="prepayment-observations">' + esc(r.Observations) + '</p>' : '') +
          '<div class="prepayment-request-documents">' + documents(r.Proforma_Attached, REQUESTS, requestId, 'Proforma') + documents(r.Invoice_Attached, REQUESTS, requestId, 'Invoice') + '</div>' +
          (group.visible.length !== group.payments.length ? '<p>Showing ' + group.visible.length + ' of ' + group.payments.length + ' prepayments matching the filters. Request totals include all its prepayments.</p>' : '') +
          (group.visible.length ? paymentTable(group.visible.map(function (payment) { return { payment: payment, group: group }; }), currentDay, false, statusView, render) : '<p class="prepayment-no-payments">No prepayments have been added to this request.</p>') + '</div></details>';
      }).join("");
      pager.hidden = items.length <= 15;
      find("page-copy").textContent = 'Page ' + page + ' of ' + pages;
      find("previous").disabled = page <= 1; find("next").disabled = page >= pages;
      if (bankActions) { bankActions.render(groups.reduce(function (all, group) { return all.concat(group.payments); }, []), statusView); }
    }
    async function load() {
      if (busy) { return; }
      var token = ++generation;
      busy = true; loaded = false; refresh.disabled = true; panel.setAttribute("aria-busy", "true");
      message.classList.remove("is-error"); message.textContent = "Loading requests and prepayments…";
      results.innerHTML = ""; summary.hidden = true; pager.hidden = true;
      try {
        if (!zoho || !zoho.CRM || !zoho.CRM.API) { throw new Error("CRM is not available. Open this widget in Zoho CRM and refresh."); }
        var data = await Promise.all([loadModule(zoho.CRM.API, REQUESTS), loadModule(zoho.CRM.API, PAYMENTS)]);
        if (deletion) { deletion.pending().forEach(function (payment) { if (!data[1].some(function (p) { return id(p) === id(payment); })) { data[1].push(payment); } }); }
        if (token !== generation) { return; }
        groups = groupRecords(data[0], data[1]); loaded = true; page = 1; render();
      } catch (error) { if (token === generation) { showError(error); } }
      finally { if (token === generation) { busy = false; refresh.disabled = false; panel.setAttribute("aria-busy", "false"); } }
    }
    function applyFilters() {
      var from = find("from").value, to = find("date-mode").value === "single" ? from : find("to").value;
      var paymentFrom = find("payment-from").value, paymentTo = find("payment-date-mode").value === "single" ? paymentFrom : find("payment-to").value;
      if (!dueTodayOnly && from && to && from > to) { showError(new Error("Due date from must be on or before due date to.")); return; }
      if (paymentFrom && paymentTo && paymentFrom > paymentTo) { showError(new Error("Payment date from must be on or before payment date to.")); return; }
      // Native date inputs return an empty value after a date segment is cleared.
      // Clear the remaining segments too, so an empty filter means all dates.
      if (!from) { find("from").value = ""; }
      if (!to) { find("to").value = ""; }
      if (!paymentFrom) { find("payment-from").value = ""; }
      if (!paymentTo) { find("payment-to").value = ""; }
      applied = { mfsp: find("mfsp").value, supplierCode: find("supplier-code").value, accountingStatus: find("accounting-status").value, bankRequested: find("bank-requested").value, bankReceipt: find("bank-receipt").value, from: from, to: to, paymentFrom: paymentFrom, paymentTo: paymentTo };
      message.classList.remove("is-error"); message.textContent = "";
      page = 1; render();
      if (!loaded && !busy) { load(); }
    }
    function syncDueTodayControls() {
      find("date-mode").disabled = dueTodayOnly;
      find("from").disabled = dueTodayOnly;
      find("to").disabled = dueTodayOnly || find("date-mode").value !== "range";
    }
    function resetFilters(todayOnly) {
      find("filters").reset();
      ["", "payment-"].forEach(function (prefix) {
        find(prefix + "date-mode").value = "single";
        find(prefix + "from-label").textContent = "Date";
        find(prefix + "from").value = "";
        find(prefix + "to").value = "";
        find(prefix + "to").disabled = true;
        find(prefix + "to-field").hidden = true;
      });
      dueTodayOnly = Boolean(todayOnly); find("due-today").checked = dueTodayOnly;
      syncDueTodayControls(); applyFilters();
    }
    find("reset").addEventListener("click", function () { resetFilters(false); });
    find("due-today").addEventListener("change", function () {
      dueTodayOnly = Boolean(find("due-today").checked);
      syncDueTodayControls(); page = 1; render();
    });
    ["", "payment-"].forEach(function (prefix) {
      find(prefix + "date-mode").addEventListener("change", function () {
        var range = find(prefix + "date-mode").value === "range";
        find(prefix + "from-label").textContent = range ? "From" : "Date";
        find(prefix + "to-field").hidden = !range;
        find(prefix + "to").disabled = !range;
        find(prefix + "to").value = "";
        if (!prefix) { syncDueTodayControls(); }
      });
    });
    find("filters").addEventListener("submit", function (event) { event.preventDefault(); applyFilters(); });
    refresh.addEventListener("click", load);
    global.addEventListener("accounting-manager-payment-created", function () { loaded = false; });
    ["accounting-manager-invoice-deleted", "accounting-manager-operation-undone"].forEach(function (event) { global.addEventListener(event, function () { loaded = false; }); });
    find("previous").addEventListener("click", function () { page -= 1; render(); });
    find("next").addEventListener("click", function () { page += 1; render(); });
    results.addEventListener("toggle", function (event) { var key = event.target.getAttribute("data-prepayment-group"); if (key) { if (event.target.open) { expanded.add(key); if (ns.tableColumns) { ns.tableColumns.refreshWidths("prepaymentsByRequest"); } } else { expanded.delete(key); } } }, true);
    results.addEventListener("submit", async function (event) {
      var form = event.target.closest('[data-prepayment-due-form]');
      if (!form) { return; }
      event.preventDefault();
      var recordId = form.getAttribute('data-prepayment-due-form');
      if (busy || dueDateSaves.has(recordId) || !form.reportValidity()) { return; }
      var value = form.querySelector('input').value;
      dueDateSaves.add(recordId);
      form.querySelectorAll('input, button').forEach(function (control) { control.disabled = true; });
      form.querySelector('[role="status"]').textContent = "Saving...";
      try {
        await ns.updatePrepaymentDueDate(zoho.CRM.API, recordId, value);
        groups.forEach(function (group) {
          group.payments.forEach(function (payment) { if (id(payment) === recordId) { payment.Due_Date = value; } });
          group.payments.sort(paymentSort);
        });
        render();
        message.textContent = "Due date saved. The list now reflects the current date filters.";
      } catch (error) {
        form.querySelector('[role="status"]').textContent = error.message || "Could not save the due date.";
        showError(error);
      } finally {
        dueDateSaves.delete(recordId);
        form.querySelectorAll('input, button').forEach(function (control) { control.disabled = false; });
      }
    });
    panel.addEventListener("click", async function (event) {
      if (deleteBusy) { return; }
      var actions = event.target.closest('[data-prepayment-actions]');
      if (actions) {
        var menu = panel.querySelector('#' + actions.getAttribute('popovertarget'));
        var rect = actions.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(rect.left, global.innerWidth - 176)) + 'px';
        menu.style.top = Math.max(8, Math.min(rect.bottom + 6, global.innerHeight - 110)) + 'px';
        return;
      }
      var deleteAction = event.target.closest('[data-prepayment-delete]');
      if (deleteAction) {
        if (busy || discardBusy || dueDateSaves.size || deleteAction.disabled || !deletion) { return; }
        deleteId = deleteAction.getAttribute('data-prepayment-delete');
        var deletePayment = groups.reduce(function (all, group) { return all.concat(group.payments); }, []).find(function (p) { return id(p) === deleteId; });
        if (!deletePayment) { return; }
        find("delete-name").textContent = deletePayment.Name || deleteId;
        find("delete-error").textContent = "";
        deleteDialog.showModal();
        return;
      }
      var dueCancel = event.target.closest('[data-prepayment-due-cancel]');
      if (dueCancel) { render(); return; }
      var dueEdit = event.target.closest('[data-prepayment-due-edit]');
      if (dueEdit) {
        var dueId = dueEdit.getAttribute('data-prepayment-due-edit');
        if (busy || dueDateSaves.has(dueId)) { return; }
        var duePayment = groups.reduce(function (all, group) { return all.concat(group.payments); }, []).find(function (payment) { return id(payment) === dueId; });
        if (!duePayment) { return; }
        var cell = dueEdit.closest('td');
        cell.innerHTML = '<form class="prepayment-due-form" data-prepayment-due-form="' + esc(dueId) + '"><input type="date" required value="' + esc(day(duePayment.Due_Date)) + '" aria-label="Due date for ' + esc(duePayment.Name || dueId) + '"><div><button type="submit" class="button secondary compact-action-button">Save</button> <button type="button" class="button secondary compact-action-button" data-prepayment-due-cancel>Cancel</button></div><small role="status" aria-live="polite"></small></form>';
        cell.querySelector('input').focus(); return;
      }
      var proofPreview = event.target.closest('[data-prepayment-proof-preview]');
      if (proofPreview && ns.operationsDocuments) {
        var proofPayment = groups.reduce(function (all, group) { return all.concat(group.payments); }, []).find(function (payment) { return id(payment) === proofPreview.getAttribute('data-prepayment-proof-preview'); });
        var proofFile = proofPayment && ns.operationsDocuments.files(proofPayment.Payment_Proof)[Number(proofPreview.getAttribute('data-proof-index'))];
        if (proofFile) { ns.operationsDocuments.preview(proofFile); }
        return;
      }
      var proof = event.target.closest('[data-prepayment-proof]');
      if (proof && proofDialog) {
        var proofId = proof.getAttribute('data-prepayment-proof');
        var proofRecord = groups.reduce(function (all, group) { return all.concat(group.payments); }, []).find(function (payment) { return id(payment) === proofId; });
        await proofDialog.open(proofId, proofRecord); return;
      }
      var proforma = event.target.closest('[data-prepayment-proforma]');
      if (proforma) {
        var group = groups.find(function (item) { return item.key === proforma.getAttribute('data-prepayment-proforma'); });
        var file = group && ns.operationsDocuments.files((group.request || {}).Proforma_Attached)[Number(proforma.getAttribute('data-proforma-index'))];
        if (file) { ns.operationsDocuments.preview(file); }
        return;
      }
      var discard = event.target.closest('[data-prepayment-discard]');
      if (discard) {
        if (busy || discardBusy) { return; }
        discardId = discard.getAttribute("data-prepayment-discard");
        var payment = groups.reduce(function (all, group) { return all.concat(group.payments); }, []).find(function (p) { return id(p) === discardId; });
        if (!payment || isClosed(payment)) { return; }
        find("discard-name").textContent = payment.Name || discardId;
        find("discard-status").value = "Discard - Credit"; find("discard-error").textContent = "";
        discardDialog.showModal(); return;
      }
      var registration = event.target.closest('[data-prepayment-register]');
      if (registration) { await workflow.open(registration.getAttribute("data-prepayment-register"), registration); return; }
      var viewButton = event.target.closest('[data-prepayments-view]');
      if (viewButton) { view = viewButton.dataset.prepaymentsView; page = 1; render(); return; }
      var statusButton = event.target.closest('[data-prepayments-status-view]');
      if (statusButton) { statusView = statusButton.dataset.prepaymentsStatusView; page = 1; render(); return; }
      var record = event.target.closest('[data-prepayment-record]');
      if (!record) { return; }
      try {
        if (!zoho || !zoho.CRM.UI || !zoho.CRM.UI.Record || !zoho.CRM.UI.Record.open) { throw new Error("Opening CRM records is unavailable in this widget context."); }
        var opened = await zoho.CRM.UI.Record.open({ Entity: record.dataset.prepaymentModule, RecordID: record.dataset.prepaymentRecord });
        if (opened === false) { throw new Error("The CRM record could not be opened."); }
      } catch (error) { showError(error); }
    });
    return {
      activate: function () {
        panel.hidden = false; view = "payments"; statusView = "open";
        resetFilters(true);
      },
      hide: function () { closeActionsMenus(); workflow.close(); panel.hidden = true; },
      load: load
    };
  };
}(window));
