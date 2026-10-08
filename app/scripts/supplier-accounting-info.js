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
      if (!output || output.error === true || output.success !== true || output.sent === false) { throw new Error(output && output.message || response && response.message || "CRM did not confirm the email request."); }
      requests.set(id, { message: output.message || "Accounting account requested from Luciano and Claudia." });
    } catch (error) {
      var message = "The accounting account request email could not be sent or confirmed. " + (error && error.message || "CRM did not confirm the request.") + " Check email delivery before requesting again.";
      requests.set(id, { message: message });
      ns.showErrorPopup(message, "Accounting account request failed");
    }
    return requests.get(id).message;
  }
  var savingAccounts = new Set();
  function accountIcon(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
  }
  function editorHtml(id, account) {
    function button(action, label, path, hidden) {
      return '<button type="button" data-account-' + action + ' title="' + label + '" aria-label="' + label + '"' + (hidden ? ' hidden' : '') + '>' + accountIcon(path) + '</button>';
    }
    return '<div class="supplier-account-editor" data-supplier-account-editor="' + esc(id) + '"><div class="supplier-account-editor-row"><input type="text" readonly tabindex="-1" aria-label="Accounting account" placeholder="Not provided" maxlength="255" data-account-value value="' + esc(value(account)) + '"><div class="supplier-account-editor-actions">' +
      button('edit', 'Edit accounting account', 'm16 3 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16l-1 4Z', false) +
      button('save', 'Save accounting account', 'm5 12 4 4L19 6', true) +
      button('cancel', 'Cancel editing', 'm6 6 12 12M18 6 6 18', true) +
      '</div></div><span class="supplier-account-editor-status" role="status" aria-live="polite"></span></div>';
  }
  async function saveAccount(zoho, id, account) {
    if (!/^\d+$/.test(String(id))) { throw new Error('A valid supplier is required.'); }
    account = value(account);
    if (account.length > 255) { throw new Error('Accounting account must have at most 255 characters.'); }
    var response = await zoho.CRM.API.updateRecord({ Entity: 'Vendors', APIData: { id: String(id), Cuenta_Contable: account || null }, Trigger: [] });
    var result = response && response.data && response.data[0];
    if (!result || result.code !== 'SUCCESS') { throw new Error(result && result.message || response && response.message || 'CRM did not confirm the accounting account update.'); }
    return account;
  }
  ns.supplierAccountingInfo = { infoHtml: infoHtml, requestHtml: requestHtml, request: request, editorHtml: editorHtml, saveAccount: saveAccount };
  if (!global.document) { return; }
  function setEditing(editor, editing) {
    var input = editor.querySelector('[data-account-value]');
    editor.classList.toggle('is-editing', editing);
    input.readOnly = !editing;
    input.tabIndex = editing ? 0 : -1;
    editor.querySelector('[data-account-edit]').hidden = editing;
    editor.querySelector('[data-account-save]').hidden = !editing;
    editor.querySelector('[data-account-cancel]').hidden = !editing;
  }
  async function editAccount(editor, action) {
    var id = editor.getAttribute('data-supplier-account-editor');
    if (savingAccounts.has(id)) { return; }
    var input = editor.querySelector('[data-account-value]');
    var status = editor.querySelector('[role="status"]');
    status.textContent = '';
    editor.classList.remove('has-error');
    input.removeAttribute('aria-invalid');
    if (action === 'edit') {
      setEditing(editor, true); input.focus(); input.select(); return;
    }
    if (action === 'cancel') {
      input.value = input.defaultValue; setEditing(editor, false);
      editor.querySelector('[data-account-edit]').focus(); return;
    }
    if (input.readOnly) { return; }
    savingAccounts.add(id);
    editor.setAttribute('aria-busy', 'true');
    editor.querySelectorAll('button, input').forEach(function (control) { control.disabled = true; });
    status.textContent = 'Saving...';
    try {
      var account = await saveAccount(global.ZOHO, id, input.value);
      input.value = account; input.defaultValue = account;
      setEditing(editor, false); status.textContent = '';
      global.document.querySelectorAll('[data-supplier-account-info]').forEach(function (details) { if (details.getAttribute('data-supplier-account-info') === id) { delete details.dataset.loaded; } });
      global.document.dispatchEvent(new global.CustomEvent('supplier-accounting-account-saved', { detail: { id: id, account: account } }));
    } catch (error) {
      status.textContent = error.message || 'Could not save the accounting account.';
      editor.classList.add('has-error'); input.setAttribute('aria-invalid', 'true');
    } finally {
      savingAccounts.delete(id); editor.removeAttribute('aria-busy');
      editor.querySelectorAll('button, input').forEach(function (control) { control.disabled = false; });
      if (editor.isConnected && !input.readOnly) { input.focus(); }
      else {
        global.document.querySelectorAll('[data-supplier-account-editor]').forEach(function (current) {
          if (current.getAttribute('data-supplier-account-editor') === id) { current.querySelector('[data-account-edit]').focus(); }
        });
      }
    }
  }
  global.document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-account-edit], [data-account-save], [data-account-cancel]');
    if (!button || button.disabled) { return; }
    editAccount(button.closest('[data-supplier-account-editor]'), button.hasAttribute('data-account-edit') ? 'edit' : button.hasAttribute('data-account-cancel') ? 'cancel' : 'save');
  });
  global.document.addEventListener('keydown', function (event) {
    var editor = event.target.closest('[data-supplier-account-editor]');
    if (!editor || !editor.classList.contains('is-editing') || event.isComposing || (event.key !== 'Enter' && event.key !== 'Escape')) { return; }
    event.preventDefault(); event.stopImmediatePropagation();
    editAccount(editor, event.key === 'Escape' ? 'cancel' : 'save');
  }, true);
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
    catch (error) {
      status.textContent = error.message || "Could not request the accounting account.";
      ns.showErrorPopup(status.textContent, "Accounting account request failed");
    }
  });
}(window));
