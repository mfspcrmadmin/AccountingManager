(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var requests = new Map();
  function esc(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function value(input) { return String(input == null ? "" : input).trim(); }
  function requestHtml(id) {
    var state = requests.get(String(id));
    return '<span class="supplier-account-request"><button type="button" class="button secondary" data-supplier-account-request="' + esc(id) + '"' + (state ? ' disabled' : '') + '>Request Accounting Account</button><span role="status">' + esc(state && state.message || '') + '</span></span>';
  }
  function infoHtml(id) {
    if (!id) { return ""; }
    return '<details class="supplier-accounting-info" data-supplier-account-info="' + esc(id) + '"><summary aria-label="Supplier accounting information" title="Supplier accounting information"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 5.5v1.5"/></svg></summary><div class="supplier-accounting-info-body" popover="auto" role="region" aria-label="Supplier accounting information">Loading supplier information…</div></details>';
  }
  async function request(zoho, id) {
    if (!/^\d+$/.test(String(id))) { throw new Error("A valid supplier is required."); }
    if (requests.has(id)) { return requests.get(id).message; }
    requests.set(id, { message: "Sending request…" });
    try {
      var response = await zoho.CRM.FUNCTIONS.execute("email_requestsupplieraccountingaccountemail", { arguments: JSON.stringify({ supplierId: id }) });
      var output = response && response.details && response.details.output;
      if (typeof output === "string") { output = JSON.parse(output); }
      if (!output || output.error === true || output.success !== true) { throw new Error(output && output.message || "CRM did not confirm the request."); }
      requests.set(id, { message: output.message || "Accounting account requested from Luciano and Claudia." });
    } catch (error) {
      requests.set(id, { message: (error.message || "CRM did not confirm the request.") + " Check email delivery before requesting again." });
    }
    return requests.get(id).message;
  }
  ns.supplierAccountingInfo = { infoHtml: infoHtml, requestHtml: requestHtml, request: request };
  if (!global.document) { return; }
  function position(details) {
    var body = details.querySelector('.supplier-accounting-info-body');
    if (!details.open || !body.matches(':popover-open')) { return; }
    var anchor = details.querySelector('summary').getBoundingClientRect(), box = body.getBoundingClientRect();
    body.style.left = Math.max(12, Math.min(anchor.left, global.innerWidth - box.width - 12)) + "px";
    var top = anchor.bottom + 8;
    if (top + box.height > global.innerHeight - 12) { top = anchor.top - box.height - 8; }
    body.style.top = Math.max(12, Math.min(top, global.innerHeight - box.height - 12)) + "px";
  }
  global.addEventListener('resize', function () { global.document.querySelectorAll('[data-supplier-account-info][open]').forEach(position); });
  global.document.addEventListener('scroll', function () { global.document.querySelectorAll('[data-supplier-account-info][open]').forEach(position); }, true);
  global.document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') { return; }
    var body = global.document.querySelector('.supplier-accounting-info-body:popover-open');
    if (body) { event.preventDefault(); event.stopPropagation(); body.hidePopover(); body.parentElement.open = false; body.parentElement.querySelector('summary').focus(); }
  }, true);
  global.document.addEventListener("toggle", async function (event) {
    var details = event.target;
    if (details.matches && details.matches('.supplier-accounting-info-body')) {
      if (event.newState === 'closed') { details.parentElement.open = false; }
      return;
    }
    if (!details.matches || !details.matches('[data-supplier-account-info]')) { return; }
    var body = details.querySelector('.supplier-accounting-info-body'), id = details.getAttribute('data-supplier-account-info');
    if (!details.open) { if (body.matches(':popover-open')) { body.hidePopover(); } return; }
    if (!body.matches(':popover-open')) { body.showPopover(); }
    position(details);
    if (details.dataset.loaded) { return; }
    details.dataset.loaded = "true";
    try {
      var response = await global.ZOHO.CRM.API.getRecord({ Entity: "Vendors", RecordID: id });
      var supplier = response && response.data && response.data[0];
      if (!supplier || String(supplier.id) !== id) { throw new Error("Could not load the supplier."); }
      var account = value(supplier.Cuenta_Contable);
      body.innerHTML = '<dl>' + [['Accounting Account', account ? esc(account) : '<span class="supplier-accounting-missing">Missing</span>' + requestHtml(id)], ['Account Number', esc(value(supplier.IBAN) || value(supplier.Account_Number) || 'Missing')], ['CIF / NIF', esc(value(supplier.CIF_NIF) || 'Missing')]].map(function (row) { return '<div><dt>' + row[0] + '</dt><dd>' + row[1] + '</dd></div>'; }).join('') + '</dl>';
    } catch (error) { body.textContent = error.message || "Could not load supplier information. Close and reopen to retry."; delete details.dataset.loaded; }
    position(details);
  }, true);
  global.document.addEventListener("click", async function (event) {
    var button = event.target.closest('[data-supplier-account-request]');
    if (!button || button.disabled) { return; }
    var id = button.getAttribute('data-supplier-account-request');
    button.disabled = true;
    var status = button.parentElement.querySelector('[role="status"]');
    status.textContent = "Sending request…";
    try { status.textContent = await request(global.ZOHO, id); }
    catch (error) { status.textContent = error.message; }
  });
}(window));
