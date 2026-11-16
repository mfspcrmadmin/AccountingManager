(function (global) {
  'use strict';
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var types = [
    [/^accounting-manager:payment-save:v1$/, 'payment-create', 'Payment registration'],
    [/^accounting-manager:payment-allocation-edit:v1:(\d+)$/, 'payment-edit', 'Payment allocation correction'],
    [/^accounting-manager:payment-delete:v1:(\d+)$/, 'payment-delete', 'Payment deletion'],
    [/^accounting-manager:invoice-edit:v1:(\d+)$/, 'invoice-edit', 'Invoice correction'],
    [/^accounting-manager:supplier-invoice:v1:(\d+)$/, 'invoice-create', 'Invoice registration'],
    [/^accountingManager\.invoiceDeletion\.v1\.(\d+)$/, 'invoice-delete', 'Invoice deletion'],
    [/^accounting-manager-card-invoice-v1-(\d+)$/, 'card-invoice', 'Card invoice registration'],
    [/^accounting-manager:alhambra-commission:(\d+)$/, 'card-invoice', 'Iacpos commission invoice'],
    [/^accounting-manager:card-payment:v1:(\d+)$/, 'card-payment', 'Card payment registration'],
    [/^accounting-manager-prepayment-(\d+)$/, 'prepayment', 'Prepayment registration'],
    [/^accountingManager\.paymentUndo\.operations\.(\d+)$/, 'legacy-delete', 'Earlier payment deletion']
  ];
  var dismissalPrefix = 'accounting-manager:pending-dismissed:v1:';
  ns.dismissPendingOperation = function (storages, key) {
    if (!types.some(function (type) { return type[0].test(key); })) throw Error('This notice cannot be dismissed.');
    // Retain recovery keys: deleting them could let a later retry create duplicates.
    storages.forEach(function (storage) {
      var saved = storage.getItem(key);
      if (saved !== null) {
        storage.setItem(dismissalPrefix + key, saved);
        if (storage.getItem(dismissalPrefix + key) !== saved) throw Error('The dismissal could not be saved.');
      }
    });
  };
  ns.readPendingOperations = function (storages) {
    var rows = [], seen = new Set();
    storages.forEach(function (storage) {
      try {
        for (var index = 0; index < storage.length; index++) {
          var key = storage.key(index), type = types.find(function (t) { return t[0].test(key); });
          if (!type || seen.has(key)) continue;
          seen.add(key);
          if (storage.getItem(dismissalPrefix + key) === storage.getItem(key)) continue;
          var match = key.match(type[0]), row = { key: key, type: type[1], title: type[2], id: match[1] || '', reference: '', bookingReference: '', status: 'Status unverified', detail: '', blocked: false };
          try {
            var data = JSON.parse(storage.getItem(key));
            if (!data || typeof data !== 'object' || Array.isArray(data) && row.type !== 'legacy-delete') throw Error('Invalid recovery');
            if (row.type === 'prepayment') {
              if (!(data.invoiceAttempt || data.invoiceId || data.invoiceAllocationAttempt || data.statusSyncPending || (data.paymentAttempt && (!data.paymentComplete || data.statusSyncPending !== false)))) continue;
              row.detail = data.statusSyncPending ? 'Payment link or request/service updates remain to be confirmed.' : data.invoiceAttempt || data.invoiceId ? 'Invoice registration or related updates remain to be confirmed.' : 'Payment registration remains to be confirmed.';
            }
            if (row.type === 'payment-create') {
              if (!data.plan || !data.plan.payment || !Array.isArray(data.plan.entries)) throw Error('Invalid recovery');
              row.reference = data.plan.payment.Name || '';
              row.id = data.paymentId || '';
              var phases = {
                validation: 'Invoice balances must be checked before continuing.',
                payment: 'Payment creation or its readback remains to be confirmed.',
                'allocation-validation': 'Payment saved; allocation validation remains to be confirmed.',
                allocations: 'Payment saved; invoice allocations remain to be confirmed.',
                balances: 'Allocations saved; invoice and settlement balances remain to be confirmed.',
                operations: 'Payment and balances confirmed; related operations remain to be confirmed.',
                complete: 'Payment, allocations, balances and related operations confirmed. Only the local recovery notice needs clearing.'
              };
              row.detail = phases[data.phase] || (data.paymentId ? 'Payment saved; allocations, related updates or screen refresh remain to be confirmed.' : 'Payment creation has not been confirmed. Reuse the saved request.');
              if (data.phase === 'complete') row.status = 'Payment saved';
              if (data.lastError) row.detail += ' Last error: ' + data.lastError;
            }
            if (row.type === 'invoice-create') { var request = JSON.parse(data.requestJson); row.reference = request.invoice.Name || ''; row.bookingReference = request.invoice.MFSP_Reference || request.invoice.Booking && request.invoice.Booking.name || ''; }
            if (row.type === 'invoice-create' && data.discardRequested) { row.title = 'Invoice registration discard'; row.detail = 'Discarding this registration remains to be confirmed. Open it to continue discarding, not to register it again.'; }
            if (row.type === 'invoice-edit') { if (!data.request || !data.operationKey) throw Error('Invalid recovery'); }
            if (row.type === 'payment-edit' && !data.allocations) throw Error('Invalid recovery');
            if (row.type === 'payment-delete') { if (!data.allocations || !Array.isArray(data.operations)) throw Error('Invalid recovery'); row.reference = data.payment && data.payment.Name || ''; row.detail = data.reconciled ? 'Related updates confirmed; payment deletion or screen refresh remains to be confirmed.' : 'Source links, invoice balances and deletion remain to be confirmed.'; }
            if (row.type === 'invoice-delete') { if (!Array.isArray(data.operations) || !Number.isInteger(data.cursor)) throw Error('Invalid recovery'); row.detail = data.cursor + ' of ' + data.operations.length + ' saved steps confirmed. Review before continuing deletion.'; }
            if (row.type === 'card-invoice') { row.reference = data.invoice && data.invoice.Name || ''; row.bookingReference = data.invoice && (data.invoice.MFSP_Reference || data.invoice.Booking && data.invoice.Booking.name) || ''; }
            if (row.type === 'card-payment') row.reference = data.Name || '';
            if (row.type === 'legacy-delete') { row.status = 'Review required'; row.blocked = true; row.detail = 'This older deletion needs a manual review of affected invoices. Recovery information has been preserved.'; }
          } catch (_) { row.status = 'Recovery error'; row.blocked = true; row.detail = 'Recovery information could not be read. Contact support with this record ID; do not repeat the creation or clear browser data.'; }
          rows.push(row);
        }
      } catch (_) { rows.push({key:'storage-error-'+rows.length,type:'error',status:'Storage error',title:'Recovery storage unavailable',detail:'Pending operations could not be checked. Restore browser storage access before saving.',blocked:true}); }
    });
    // The persistent deletion journal supersedes the earlier session-only journal.
    return rows.filter(function (row) { return row.type !== 'legacy-delete' || !seen.has('accounting-manager:payment-delete:v1:' + row.id); });
  };
  ns.mountPendingOperations = function (host, open) {
    if (!host) return;
    var rows = [], signature = '', opening = false;
    function element(tag, text, className) { var node = global.document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
    function icon(kind) {
      var node = element('span', '', 'pending-icon');
      var paths = kind === 'chevron' ? '<path d="m6 9 6 6 6-6"/>' : kind === 'info' ? '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>' : kind.indexOf('payment') !== -1 ? '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h4"/>' : '<path d="M7 3h7l4 4v14H6V3h1m7 0v5h4M9 12h6m-6 4h6"/>';
      node.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+paths+'</svg>'; return node;
    }
    var summary = element('summary'), count = element('span', '', 'pending-count'), headerTitle = element('span', 'Pending operations', 'pending-title');
    var list = element('div', '', 'pending-list'), feedback = element('p', '', 'pending-feedback');
    var help = element('button', '', 'pending-help'), note = element('p', 'Saved in this browser. Opening an operation does not submit it again.', 'pending-help-text');
    help.type = 'button'; help.setAttribute('aria-label', 'About pending operations'); help.setAttribute('aria-expanded', 'false'); help.appendChild(icon('info'));
    note.id = host.id + '-help'; note.hidden = true; help.setAttribute('aria-controls', note.id);
    help.addEventListener('click', function(event) { event.preventDefault(); event.stopPropagation(); note.hidden = !note.hidden; help.setAttribute('aria-expanded', String(!note.hidden)); if (!note.hidden) host.open = true; });
    summary.appendChild(icon('document')); summary.appendChild(headerTitle); summary.appendChild(count); summary.appendChild(help); summary.appendChild(icon('chevron')); host.appendChild(summary);
    host.appendChild(note); host.appendChild(list); host.appendChild(feedback); feedback.setAttribute('role','status');
    function refresh() {
      if (opening) return;
      var stores;
      try { stores = [global.localStorage, global.sessionStorage]; } catch (_) { stores = [null]; }
      var next = ns.readPendingOperations(stores), value = JSON.stringify(next);
      if (signature === value) return;
      signature = value; rows = next; host.hidden = !rows.length;
      count.textContent = String(rows.length); count.setAttribute('aria-label', rows.length + ' pending operations');
      list.replaceChildren();
      rows.forEach(function (row) {
        var article = element('article'), body = element('div', '', 'pending-body'), title = element('strong', row.title), actions = element('div', '', 'pending-row-actions');
        var technical = element('details', '', 'pending-details'), technicalTitle = element('summary', 'Details'), detail = element('p', row.detail);
        technicalTitle.prepend(icon('chevron')); technical.appendChild(technicalTitle);
        if (row.id) technical.appendChild(element('p', 'Record ID: ' + row.id));
        if (row.detail) technical.appendChild(detail);
        body.appendChild(title);
        var reference = [row.reference, row.bookingReference].filter(Boolean).join(' / ');
        if (reference) body.appendChild(element('div', reference, 'pending-reference'));
        if (row.blocked) body.appendChild(element('p', row.type === 'error' ? 'Browser storage is unavailable.' : row.type === 'legacy-delete' ? 'Earlier deletion needs manual review.' : 'Saved recovery data could not be read.', 'pending-problem'));
        var status = element('span', row.status || 'Status unverified', 'pending-status' + (row.blocked ? ' is-attention' : ''));
        actions.appendChild(status);body.appendChild(technical);article.appendChild(icon(row.type));article.appendChild(body);article.appendChild(actions);
        if (!row.blocked) {
          var button = global.document.createElement('button'); button.type = 'button'; button.className = 'button secondary pending-review'; button.textContent = 'Review operation';
          button.addEventListener('click', async function () {
            if (opening) return;
            opening = true; button.disabled = true; button.textContent = 'Opening…'; feedback.textContent = 'Opening saved operation…';
            feedback.classList.add('is-loading');
            try {
              if (global.document.querySelector('[aria-busy="true"]')) throw Error('An operation is still running. Wait for it to finish before opening recovery.');
              if (!ns.readPendingOperations(stores).some(function (item) { return item.key === row.key; })) throw Error('This operation is no longer pending.');
              await open(row); feedback.textContent = ''; host.open = false;
            } catch (error) { feedback.textContent = error.message || 'Could not open the saved operation.'; }
            finally { opening = false; button.disabled = false; button.textContent = 'Review operation'; feedback.classList.remove('is-loading'); refresh(); }
          }); actions.appendChild(button);
        }
        if (row.type !== 'error') {
          var dismiss = global.document.createElement('button'), confirmation = global.document.createElement('div');
          dismiss.type = 'button'; dismiss.className = 'button secondary'; dismiss.textContent = 'Dismiss notice';
          confirmation.hidden = true; confirmation.className = 'pending-confirmation';
          var explanation = global.document.createElement('p'), confirm = global.document.createElement('button'), cancel = global.document.createElement('button');
          explanation.textContent = 'Hide this notice in this browser? This does not cancel or complete the operation. CRM records and recovery information are kept. The notice returns if the saved operation changes.';
          confirm.type = cancel.type = 'button'; confirm.className = cancel.className = 'button secondary';
          confirm.textContent = 'Yes, dismiss notice'; confirm.className = 'button primary'; cancel.textContent = 'Keep notice';
          dismiss.addEventListener('click', function () { if (opening) return; confirmation.hidden = false; dismiss.disabled = true; cancel.focus(); });
          cancel.addEventListener('click', function () { confirmation.hidden = true; dismiss.disabled = false; dismiss.focus(); });
          confirm.addEventListener('click', function () {
            if (opening) return;
            try {
              if (global.document.querySelector('[aria-busy="true"]')) throw Error('An operation is running. Wait for it to finish before dismissing the notice.');
              ns.dismissPendingOperation(stores, row.key);
              feedback.textContent = 'Notice dismissed. CRM records have not been changed.';
              signature = ''; refresh(); summary.focus();
            } catch (error) { feedback.textContent = error.message || 'Could not dismiss this notice.'; }
          });
          confirmation.appendChild(element('strong', 'Dismiss this notice?')); confirmation.appendChild(explanation);
          var confirmationActions = element('div', '', 'pending-confirmation-actions');
          confirmationActions.appendChild(cancel); confirmationActions.appendChild(confirm); confirmation.appendChild(confirmationActions);
          actions.appendChild(dismiss); article.appendChild(confirmation);
        }
        list.appendChild(article);
      });
    }
    global.addEventListener('storage',refresh); global.addEventListener('focus',refresh);
    global.document.addEventListener('visibilitychange',refresh);
    // Same-window storage writes do not fire the storage event. Only inspect local
    // journals here: no CRM requests and no automatic retries.
    var timer = global.setInterval(function () { if (!global.document.hidden) refresh(); },2000);
    refresh();
    return {refresh:refresh,destroy:function(){global.clearInterval(timer);global.removeEventListener('storage',refresh);global.removeEventListener('focus',refresh);global.document.removeEventListener('visibilitychange',refresh);}};
  };
}(window));
