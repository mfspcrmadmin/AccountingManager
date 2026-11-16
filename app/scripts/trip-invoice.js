(function (global) {
  'use strict';
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  ns.createTripInvoiceModule = function (deps) {
    var dialog = null, busy = false, token = 0;
    function close() { if (dialog && !busy) { dialog.close(); } }
    async function call(bookingId, action, date, basis, snapshot) {
      var result = deps.output(await deps.crm.executeFunction('tripinvoice_manage', {
        bookingId: String(bookingId), action: action, invoiceDate: date || '', amountBasis: basis || '', expectedSnapshot: snapshot || ''
      }));
      if (!result || result.success !== true) {
        var message = String(result && result.message || 'CRM did not confirm the invoice operation. Reopen this Booking to check its invoice before retrying.').replace(/(?:Error at line\s*:\s*\d+,?\s*)+/g, '');
        throw new Error(message);
      }
      return result;
    }
    var pdfDownloads = ns.createSalesInvoicePdfDownloads && ns.createSalesInvoicePdfDownloads({call:call,crm:deps.crm});
    async function open(booking, trigger) {
      if (busy || !booking || !booking.id) { return; }
      if (dialog) { dialog.close(); }
      var generation = ++token, preview = null, completedInvoice = null;
      var current = document.createElement('dialog');
      dialog = current;
      current.className = 'trip-invoice-dialog';
      current.setAttribute('aria-labelledby', 'trip-invoice-title');
      current.innerHTML = '<header><div><h2 id="trip-invoice-title">Invoice trip</h2><p data-invoice-context></p></div><button type="button" class="widget-popup-close" data-invoice-close aria-label="Close">&times;</button></header>' +
        '<section class="trip-invoice-result" data-invoice-result hidden aria-label="Registered invoice"></section><div data-invoice-documents hidden></div><div data-invoice-collections hidden></div><p role="status" aria-live="polite" data-invoice-status>Checking Booking and existing invoices...</p>' +
        '<form hidden><fieldset class="trip-invoice-historical" data-invoice-historical hidden><legend>1. Confirm historical payment</legend><p class="trip-invoice-hint">Confirm only the historical remainder shown below using your original records. Existing receipts and refunds are preserved; do not include them again.</p><dl data-historical-totals></dl><div class="trip-invoice-fields"><label class="field"><span>Payment origin</span><input data-historical-origin maxlength="200" placeholder="e.g. Tourplan or bank transfer"></label></div><label class="trip-invoice-historical-confirm"><input type="checkbox" data-historical-confirm><span>I confirm that this historical remainder was received, accounts for historical refunds and does not duplicate the detailed receipts.<small>My confirmation will be saved with the invoice.</small></span></label></fieldset>' +
        '<section class="trip-invoice-date-section"><h3 data-invoice-date-heading>Invoice details</h3><div class="trip-invoice-fields"><label class="field"><span>Invoice date</span><input type="date" data-invoice-date required></label><div class="trip-invoice-total"><span>Invoice total</span><strong data-invoice-amount></strong><small>Taxes included</small></div></div><details class="trip-invoice-more"><summary>About this invoice</summary><p>Full Booking Sales Price; agent commission is not deducted. One trip line, with no separate VAT breakdown.</p><p>Series FV-YYYY-000001. The invoice date determines the year; the number is assigned on creation.</p></details></section>' +
        '<div class="trip-invoice-preview" data-invoice-preview hidden></div><div class="inline-actions trip-invoice-form-actions"><button type="submit" class="button primary" data-invoice-review>Review invoice</button><button type="button" class="button primary" data-invoice-issue disabled hidden>Create sales invoice</button></div></form>' +
        '<div class="inline-actions" data-invoice-footer><div class="trip-invoice-download-actions"><button type="button" class="button secondary" data-invoice-pdf hidden>Download invoice PDF</button><label data-invoice-save-pdf-label hidden><input type="checkbox" data-invoice-save-pdf checked> <span>Save a copy in Attachments</span></label></div><button type="button" class="button secondary" data-invoice-refresh-collections hidden>Review current receipts</button><button type="button" class="button primary" data-invoice-apply-collections hidden disabled>Save verified receipts</button><button type="button" class="button secondary" data-invoice-retry-link hidden>Restore Booking link</button><button type="button" class="button secondary" data-invoice-open hidden>Open invoice</button><button type="button" class="button secondary" data-invoice-cancel>Close</button></div>';
      document.body.appendChild(current);
      var pdfButton = current.querySelector('[data-invoice-pdf]'), savePdfLabel = current.querySelector('[data-invoice-save-pdf-label]');
      var status = current.querySelector('[data-invoice-status]'), form = current.querySelector('form');
      var date = current.querySelector('[data-invoice-date]');
      var issue = current.querySelector('[data-invoice-issue]'), summary = current.querySelector('[data-invoice-preview]');
      var cancelButton = current.querySelector('[data-invoice-cancel]');
      var reviewButton = current.querySelector('[data-invoice-review]');
      var footer = current.querySelector('[data-invoice-footer]');
      var openInvoice = current.querySelector('[data-invoice-open]'), retryLink = current.querySelector('[data-invoice-retry-link]');
      function active() { return generation === token && current.open; }
      function money(value, currency) { return value == null ? 'Not provided' : Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (currency ? ' ' + currency : ''); }
      function lock(value) {
        busy = value;
        current.setAttribute('aria-busy', String(value));
        current.querySelectorAll('input, select, textarea, button').forEach(function (element) { element.disabled = value; });
        issue.disabled = value || !preview;
      }
      function invalidate() { preview = null; collectionPreview = null; issue.disabled = true; issue.hidden = true; reviewButton.textContent = 'Review invoice'; reviewButton.className = 'button primary'; summary.hidden = true; status.textContent = '';  }
      var receipts = current.querySelector('[data-invoice-collections]');
      var refreshReceipts = current.querySelector('[data-invoice-refresh-collections]');
      var applyReceipts = current.querySelector('[data-invoice-apply-collections]');
      var collectionPreview = null;
      var historical = current.querySelector('[data-invoice-historical]');
      var historicalOrigin = current.querySelector('[data-historical-origin]');
      var historicalConfirm = current.querySelector('[data-historical-confirm]');
      var historicalAmount = null;
      [historicalOrigin, historicalConfirm].forEach(function (input) { input.addEventListener('input', invalidate); });
      function historicalRequest() {
        if (historical.hidden) { return ''; }
        if (!historicalConfirm.checked || historicalOrigin.value.trim().length < 3) { throw new Error('Confirm the historical payment and provide its origin.'); }
        return JSON.stringify({historical_confirmation:{confirmed:true,amount:historicalAmount,origin:historicalOrigin.value.trim()}});
      }

      function showCollections(value, compact) {
        receipts.replaceChildren(); receipts.hidden = !value;
        if (!value) { return; }
        var totals = document.createElement('p');
        totals.textContent = 'Source: ' + value.source + ' \u00b7 Confirmed receipts: ' + money(value.paid, 'EUR') + ' \u00b7 Completed refunds: ' + money(value.refunded, 'EUR') + ' \u00b7 Net paid: ' + money(value.net, 'EUR');
        if (!compact) { receipts.appendChild(totals); }
        var details = document.createElement('details'), title = document.createElement('summary'); title.textContent = 'Receipt evidence'; details.appendChild(title);
        (value.evidence && value.evidence.records || []).forEach(function (row) {
          var item = document.createElement('p');item.textContent = (row.source === 'Historical manual confirmation' ? 'Historical payment confirmed manually' : row.source === 'All_Travellers_Payments' ? 'Receipt' : row.source === 'All_Refunds' ? 'Refund' : 'CRM receipt') + ' \u00b7 ' + row.id + ' \u00b7 ' + row.status + ' \u00b7 ' + money(row.amount_eur, 'EUR');details.appendChild(item);
          if (row.confirmation) { var confirmation = document.createElement('p'); confirmation.textContent = 'Origin: ' + row.confirmation.origin + (row.confirmation.reference ? ' | Reference: ' + row.confirmation.reference : '') + ' | Confirmed by: ' + row.confirmation.confirmed_by; details.appendChild(confirmation); }
        });
        receipts.appendChild(details);
      }
      function showDocuments(result) {
        current.querySelector('[data-invoice-result]').hidden = true;
        footer.appendChild(cancelButton);
        form.hidden = true; openInvoice.hidden = true; retryLink.hidden = true; pdfButton.hidden = true; savePdfLabel.hidden = true;
        refreshReceipts.hidden = true; applyReceipts.hidden = true;
        var target = current.querySelector('[data-invoice-documents]');target.replaceChildren();target.hidden = false;
        status.textContent = result.message || 'Existing invoice documents require review. No new invoice was created.';
        (result.documents || []).forEach(function (row) {
          var line = document.createElement('p'), button = document.createElement('button');
          var credit = /credit/i.test(row.Type || '');
          line.textContent = (row.Type || 'Document') + ' \u00b7 ' + row.Subject + ' \u00b7 ' + (row.Invoice_Origin || 'Historical / unclassified') + ' \u00b7 ' + (row.Invoice_Date || '') + ' \u00b7 ' + money(credit ? -Math.abs(Number(row.Grand_Total)) : row.Grand_Total, row.Currency) +
            (credit ? ' \u00b7 Original invoice: ' + (row.Original_Sales_Invoice && row.Original_Sales_Invoice.name || 'Not linked; review in CRM') : '');
          button.type = 'button';button.className = 'button secondary';button.textContent = 'Open document';
          button.onclick = async function () { try { await deps.openRecord('Invoices',String(row.id)); } catch (error) { status.textContent = error.message; } };
          line.appendChild(button);
          if (credit && !row.Original_Sales_Invoice) {
            var label = document.createElement('label'), select = document.createElement('select'), save = document.createElement('button');
            label.textContent = 'Original invoice '; select.setAttribute('aria-label','Original invoice for ' + row.Subject);
            var empty = document.createElement('option');empty.value = '';empty.textContent = 'Select original invoice';select.appendChild(empty);
            var candidates = (result.documents || []).filter(function (candidate) { return candidate.Type === 'Invoice' && Number(candidate.Grand_Total) > 0 && candidate.Currency === row.Currency; });
            candidates.forEach(function (candidate) { var option = document.createElement('option');option.value = candidate.id;option.textContent = candidate.Subject + ' \u00b7 ' + money(candidate.Grand_Total,candidate.Currency);select.appendChild(option); });
            save.type = 'button';save.className = 'button secondary';save.textContent = 'Link original invoice';save.disabled = true;
            select.onchange = function () { save.disabled = !select.value; };
            save.onclick = async function () {
              if (busy || !select.value) { return; }
              var selected = candidates.find(function (candidate) { return String(candidate.id) === select.value; });
              if (!selected) { return; }
              lock(true);
              try {
                await call(booking.id,'link-original','','',JSON.stringify({credit_id:row.id,original_id:selected.id,credit_modified:row.Modified_Time,original_modified:selected.Modified_Time}));
                row.Original_Sales_Invoice = {id:selected.id,name:selected.Subject};
                showDocuments(result);status.textContent = 'Original invoice linked. Document amounts and receipts were preserved.';
              } catch (error) { status.textContent = error.message; }
              finally { lock(false); }
            };
            label.appendChild(select);line.appendChild(label);line.appendChild(save);
          }
          target.appendChild(line);
        });
      }
      function showInvoice(result) {
        historical.hidden = true;
        footer.appendChild(cancelButton);
        if (result.multiple) { showDocuments(result); return; }
        form.hidden = true;
        var needsAttention = Boolean(result.warning || result.booking_link_missing);
        var hero = current.querySelector('[data-invoice-result]');
        hero.replaceChildren(); hero.hidden = false; hero.classList.toggle('needs-attention', needsAttention);
        current.querySelector('#trip-invoice-title').textContent = 'Sales invoice';
        var heading = document.createElement('div'); heading.className = 'trip-invoice-result-heading';
        heading.innerHTML = '<span class="trip-invoice-result-icon" aria-hidden="true"><svg viewBox="0 0 24 24">' + (needsAttention ? '<path d="M12 6v7m0 4v1"/>' : '<path d="m5 12 4 4L19 6"/>') + '</svg></span>';
        var title = document.createElement('h3');title.setAttribute('role','status');title.textContent = needsAttention ? 'Invoice needs attention' : result.historical ? 'Existing sales invoice' : 'Invoice registered';heading.appendChild(title);hero.appendChild(heading);
        var numberRow = document.createElement('div');numberRow.className = 'trip-invoice-number-row';
        var number = document.createElement('strong');number.className = 'trip-invoice-number';number.textContent = result.invoice_number || 'Number unavailable';numberRow.appendChild(number);
        var copy = document.createElement('button');copy.type='button';copy.className='button secondary trip-invoice-copy';copy.disabled=!result.invoice_number;
        var copySvg='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></svg>';
        copy.innerHTML=copySvg+'<span>Copy number</span>';copy.setAttribute('aria-label','Copy invoice number');
        copy.onclick=async function(){
          try {
            if(global.navigator.clipboard && global.isSecureContext) { await global.navigator.clipboard.writeText(String(result.invoice_number)); }
            else { var temp=document.createElement('textarea');temp.value=String(result.invoice_number);temp.style.cssText='position:fixed;opacity:0;pointer-events:none';current.appendChild(temp);temp.select();var copied=document.execCommand('copy');temp.remove();copy.focus({preventScroll:true});if(!copied)throw new Error('Copy unavailable'); }
            copy.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>Copied</span>';copy.setAttribute('aria-label','Invoice number copied');
            global.setTimeout(function(){if(copy.isConnected){copy.innerHTML=copySvg+'<span>Copy number</span>';copy.setAttribute('aria-label','Copy invoice number');}},1800);
          } catch(error) { status.textContent='Select the invoice number above and copy it manually.'; }
        };
        numberRow.appendChild(copy);hero.appendChild(numberRow);
        var facts=document.createElement('dl');facts.className='trip-invoice-result-facts';
        [['Invoice date',result.invoice_date || 'Not available'],['Invoice total',money(result.amount,result.currency || booking.Currency)],['Net paid',money(result.net_paid,result.currency)],['Balance',money(result.balance_due,result.currency)]].forEach(function(item){var group=document.createElement('div'),label=document.createElement('dt'),value=document.createElement('dd');label.textContent=item[0];value.textContent=item[1];group.append(label,value);facts.appendChild(group);});hero.appendChild(facts);
        var audit=document.createElement('p');audit.className='trip-invoice-result-audit';audit.textContent='Payment source: '+(result.collection_source || result.collections && result.collections.source || 'Not classified')+(result.collections_status?' | '+result.collections_status:'')+(result.collections_checked_at?' | Checked '+new Date(result.collections_checked_at).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'');hero.appendChild(audit);
        status.textContent=result.warning || (result.booking_link_missing ? 'Restore the Booking link to finish registration.' : '');
        pdfButton.hidden = !pdfDownloads || result.origin !== 'Accounting Manager';
        savePdfLabel.hidden = pdfButton.hidden;
        pdfButton.onclick = async function () {
          if (busy || !pdfDownloads) { return; }
          lock(true);status.textContent = 'Preparing the invoice PDF...';
          try {
            var downloaded = await pdfDownloads.download(booking.id,result.invoice_id,current.querySelector('[data-invoice-save-pdf]').checked);
            status.textContent = downloaded.warning || (downloaded.saved ? 'PDF downloaded and its copy confirmed in invoice Attachments.' : 'PDF downloaded. No attachment copy was requested.');
          } catch (error) { status.textContent = error.message || 'Could not download the invoice PDF.'; }
          finally { lock(false); }
        };
        openInvoice.hidden = false;
        openInvoice.onclick = async function () {
          try { await deps.openRecord('Invoices', String(result.invoice_id)); }
          catch (error) { status.textContent = error.message || 'Could not open the invoice.'; }
        };
        retryLink.hidden = result.historical || !(result.warning || result.booking_link_missing);
        refreshReceipts.hidden = result.origin !== 'Accounting Manager' || String(result.collection_source || '').includes('Historical manual confirmation');
        applyReceipts.hidden = true; collectionPreview = null;
        if (result.historical) { audit.textContent += ' | Historical document'; }
        showCollections(result.collections, true);
        retryLink.onclick = async function () {
          if (busy) { return; }
          lock(true);
          try { var restored = await call(booking.id, 'issue'); if (active()) { showInvoice(restored); } }
          catch (error) { status.textContent = error.message; }
          finally { lock(false); }
        };
        completedInvoice = !result.historical && !result.booking_link_missing && !result.warning ? result : null;
        if (completedInvoice && deps.onSaved) { deps.onSaved(booking.id, result); }
      }
      refreshReceipts.onclick = async function () {
        if (busy) { return; }
        lock(true); collectionPreview = null; applyReceipts.hidden = true;
        try {
          var result = await call(booking.id, 'collections-preview');
          if (!active()) { return; }
          collectionPreview = result; showCollections(result.collections); applyReceipts.hidden = false;
          status.textContent = 'Review confirmed receipts and completed refunds. Save to update this invoice. Its number and total will remain unchanged.';
        } catch (error) { status.textContent = error.message; }
        finally { lock(false); }
      };
      applyReceipts.onclick = async function () {
        if (busy || !collectionPreview) { return; }
        lock(true);
        try {
          var result = await call(booking.id, 'collections-apply', '', '', collectionPreview.snapshot);
          if (active()) { showInvoice(result); }
        } catch (error) { collectionPreview = null; applyReceipts.hidden = true; status.textContent = error.message; }
        finally { lock(false); }
      };
      current.querySelector('[data-invoice-close]').onclick = close;
      current.querySelector('[data-invoice-cancel]').onclick = close;
      current.addEventListener('cancel', function (event) { if (busy) { event.preventDefault(); } });
      current.addEventListener('close', function () {
        if (dialog === current) { dialog = null; token++; }
        current.remove();
        if (completedInvoice && deps.onCloseAfterInvoice && deps.onCloseAfterInvoice(booking.id, completedInvoice)) { return; }
        if (trigger && trigger.isConnected) { trigger.focus({ preventScroll: true }); }
      });
      date.addEventListener('input', invalidate);
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        if (busy || !form.reportValidity()) { return; }
        lock(true); status.textContent = 'Reading the current Booking and invoice details…';
        try {
          var result = await call(booking.id, 'preview', date.value, 'gross', historicalRequest());
          if (!active()) { return; }
          if (result.existing) { showInvoice(result); return; }
          preview = result; showCollections(result.collections);
          summary.textContent = 'Client: ' + (result.client && result.client.name || '') + ' · Date: ' + result.invoice_date + ' · Total: ' + money(result.amount, result.currency) + '. The next available FV-' + date.value.slice(0, 4) + ' number will be assigned when you create the invoice.';
          summary.hidden = false; issue.hidden = false; reviewButton.textContent = 'Review again'; reviewButton.className = 'button secondary';
          status.textContent = 'Ready to create. Check the reviewed details below.';
        } catch (error) { preview = null; status.textContent = error.message; }
        finally { lock(false); }
      });
      issue.onclick = async function () {
        if (busy || !preview) { return; }
        lock(true); status.textContent = 'Creating sales invoice…';
        try {
          var result = await call(booking.id, 'issue', date.value, 'gross', preview.snapshot);
          if (active()) { showInvoice(result); }
        } catch (error) {
          preview = null; summary.hidden = true;
          status.textContent = error.message + ' Review again to check whether an invoice already exists before retrying.';
        } finally { lock(false); }
      };
      current.showModal();
      current.setAttribute('aria-busy', 'true');
      try {
        var result = await call(booking.id, 'inspect');
        if (!active()) { return; }
        if (result.existing) { showInvoice(result); return; }
        current.querySelector('[data-invoice-context]').textContent = (result.mfsp || '') + ' | ' + (result.client && result.client.name || '');
        current.querySelector('[data-invoice-amount]').textContent = money(result.sales_price, result.currency);
        current.querySelector('.trip-invoice-form-actions').prepend(cancelButton);
        form.hidden = false; showCollections(result.collections);
        if (result.historical_required) {
          historical.hidden = false;
          current.querySelector('[data-invoice-date-heading]').textContent = '2. Invoice details';
          historicalAmount = Number(result.historical_amount);
          historicalOrigin.required = historicalConfirm.required = true;
          historicalConfirm.checked = false;
          var totals = current.querySelector('[data-historical-totals]');
          [['Sales price', result.sales_price], ['Detailed net collections', result.detailed_net || 0], ['Historical remainder to confirm', result.historical_amount], ['Booking balance', result.balance]].forEach(function (item) {
            var label = document.createElement('dt'), value = document.createElement('dd'); label.textContent = item[0]; value.textContent = money(item[1], result.currency); totals.append(label, value);
          });
        }
        status.textContent = '';
        if (result.historical_required) { historicalOrigin.focus(); } else { date.focus(); }
      } catch (error) { if (active()) { status.textContent = error.message; } }
      finally { current.setAttribute('aria-busy', 'false'); }
    }
    return { open: open, close: close, call: call };
  };
}(window));
