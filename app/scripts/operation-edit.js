(function (global) {
  'use strict';
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var definitions = {
    Prepayments: {
      title: 'Edit prepayment', file: 'Payment_Proof',
      groups: [['Prepayment details', 'Name,Owner,Prepayment_Request,Amount,Currency,Percent'], ['Payment schedule', 'When_To_Be_Paid,Due_Date,Payment_Date,Accounting_Status,Bank_Payment_Requested,Bank_Receipt_Needed']],
      financial: 'Currency,Amount,Percent,Prepayment_Request,Payment_Date,Accounting_Status',
      readonly: 'Vendor_Invoice,Vendor_Payment,Creator_Original_Status,Exchange_Rate',
      statuses: ['Pending invoice', 'Cancelled', 'Discard - Credit', 'Discard - Already Paid']
    },
    Card_Purchases: {
      title: 'Edit card purchase', file: 'Supporting_Documents',
      groups: [['Purchase details', 'Name,Owner,Transaction_Type,Transaction_Date,Amount,Currency,Card_Payment_Account,Original_Card_Purchase'], ['Supplier and booking', 'Supplier,Booking,Boking_Service,Settlement,Invoice_Number'], ['Review', 'Accounting_Status,Email,Transaction_Notes,Review_Notes']],
      financial: 'Currency,Amount,Card_Payment_Account,Original_Card_Purchase,Transaction_Type,Transaction_Date,Supplier,Booking,Boking_Service,Settlement,Invoice_Number,Accounting_Status',
      readonly: 'Vendor_Invoice,Vendor_Payment,Accounting_Processed_By,Accounting_Processed_At,MFSP_Reference,Supplier_Code,Exchange_Rate',
      statuses: ['Pending invoice', 'Pending credit note', 'Refund pending', 'Needs review', 'Cancelled']
    }
  };
  var labels = { Name: 'Name', Boking_Service: 'Booking service', Accounting_Status: 'Registration status', Original_Card_Purchase: 'Original card', Percent: 'Percentage' };
  function id(v) { return String(v && v.id || ''); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]; }); }
  function fileId(f) { return String(f.id || f.attachment_Id || ''); }
  function fileName(f) { return f.File_Name__s || f.File_Name || f.file_Name || f.name || 'Document'; }
  function valueKey(v) { return v && typeof v === 'object' ? id(v) : v == null ? '' : String(v); }
  function same(a, b) { return valueKey(a) === valueKey(b); }
  function localDate(value) { if (!value) return ''; var d = new Date(value); return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function verify(record, request) {
    if (!record || id(record) !== request.id) return false;
    if (!Object.keys(request.changes).every(function (k) { return k === 'Transaction_Date' && record[k] && request.changes[k] ? new Date(record[k]).getTime() === new Date(request.changes[k]).getTime() : same(record[k], request.changes[k]); })) return false;
    var list = record[definitions[request.module].file] || [];
    if (request.remove_files.some(function (removed) { return list.some(function (f) { return fileId(f) === removed; }); })) return false;
    return request.add_files.every(function (added) {
      return list.filter(function (f) {
        var bytes = f.original_Size_Byte || f.Size__s || f.file_Size || f.size;
        return String(f.File_Id__s || f.file_Id || '') === added.id ||
          Boolean(fileId(f)) && request.before_files.indexOf(fileId(f)) === -1 && fileName(f) === added.name && (!/^\d+$/.test(String(bytes)) || Number(bytes) === added.size);
      }).length === 1;
    });
  }
  ns.operationEditModel = { definitions: definitions, verify: verify, same: same, localDate: localDate };
  ns.createOperationEditor = function (zoho, onSaved) {
    var dialog, form, body, feedback, submit, record, schema, config, moduleName, busy = false, pending = null, confirmed = false, removed = [], queue = [], opener, generation = 0;
    var api = zoho.CRM.API;
    function key() { return 'accounting-operation-edit:' + moduleName + ':' + id(record); }
    function remember() { try { if (pending) global.sessionStorage.setItem(key(), JSON.stringify(pending)); else global.sessionStorage.removeItem(key()); } catch (ignored) {} }
    async function call(request) {
      var response = await zoho.CRM.FUNCTIONS.execute('supplierinvoice_register', { arguments: JSON.stringify({ operationKey: global.crypto.randomUUID(), requestJson: JSON.stringify(Object.assign({ operation: 'edit_operation' }, request)) }) });
      var result = response && response.details && response.details.output;
      if (typeof result === 'string') { try { result = JSON.parse(result); } catch (ignored) { result = null; } }
      if (!result || typeof result.success !== 'boolean') throw new Error('CRM did not confirm the result. Check saved changes before trying again.');
      return result;
    }
    function message(text, loading) { feedback.classList.toggle('is-error', Boolean(text) && !loading); feedback.innerHTML = (loading ? '<span class="inline-feedback-spinner" aria-hidden="true"></span>' : '') + '<span>' + esc(text) + '</span>'; }
    function setBusy(value, text) {
      busy = value; dialog.setAttribute('aria-busy', String(value));
      form.querySelector('fieldset').disabled = value || Boolean(pending);
      dialog.querySelectorAll('[data-close]').forEach(function (b) { b.disabled = value; });
      submit.disabled = value; submit.classList.toggle('is-saving', value);
      submit.textContent = value ? 'Saving changes…' : pending ? (confirmed ? 'Retry related updates' : 'Check saved changes') : 'Save changes';
      if (text) message(text, value);
    }
    function close() { if (busy) return; generation++; dialog.close(); if (opener && opener.isConnected) opener.focus(); }
    function ensure() {
      if (dialog) return;
      dialog = document.createElement('dialog'); dialog.className = 'operation-edit-dialog'; dialog.setAttribute('aria-labelledby', 'operation-edit-title');
      dialog.innerHTML = '<header><div><h2 id="operation-edit-title"></h2><p data-context></p></div><button type="button" class="widget-popup-close operation-edit-close" data-close title="Close" aria-label="Close">&times;</button></header><form><div class="operation-edit-body"><fieldset></fieldset></div><footer><button type="button" class="button secondary" data-close>Cancel</button><div class="operation-edit-feedback" role="status" aria-live="polite"></div><button type="submit" class="button primary">Save changes</button></footer></form>';
      document.body.appendChild(dialog); form = dialog.querySelector('form'); body = dialog.querySelector('fieldset'); feedback = dialog.querySelector('[role=status]'); submit = form.querySelector('[type=submit]');
      dialog.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', close); });
      dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
      form.addEventListener('submit', save);
      body.addEventListener('click', handleClick);
      body.addEventListener('input', function (e) {
        if (e.target.matches('[data-lookup-input]')) { e.target.dataset.selected = ''; e.target.closest('.operation-edit-field').querySelector('[data-results]').innerHTML = ''; }
        if (e.target.matches('[data-field]')) e.target.removeAttribute('aria-invalid');
      });
      body.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('[data-lookup-input]')) { e.preventDefault(); searchLookup(e.target.closest('.operation-edit-field')); } });
      body.addEventListener('change', function (e) { if (e.target.matches('[data-upload]')) { addFiles(e.target.files); e.target.value = ''; } });
      body.addEventListener('dragover', function (e) { if (e.target.closest('[data-drop]')) { e.preventDefault(); e.target.closest('[data-drop]').classList.add('is-dragging'); } });
      body.addEventListener('dragleave', function (e) { var zone = e.target.closest('[data-drop]'); if (zone) zone.classList.remove('is-dragging'); });
      body.addEventListener('drop', function (e) { var zone = e.target.closest('[data-drop]'); if (zone) { e.preventDefault(); zone.classList.remove('is-dragging'); addFiles(e.dataTransfer.files); } });
    }
    function fieldMarkup(name, locked) {
      var f = schema.find(function (f) { return f.api_name === name; });
      if (!f || f.visible === false || f.view_type && !f.view_type.view) return '';
      var value = record[name], label = labels[name] || f.field_label, readonly = locked && config.financial.split(',').includes(name) || f.read_only || f.field_read_only || f.view_type && !f.view_type.edit;
      var required = f.system_mandatory || name === 'Name', attrs = ' data-field="' + name + '" id="operation-field-' + name + '"' + (readonly ? ' disabled' : '') + (required ? ' required' : ''), control;
      if (f.data_type === 'lookup' || f.data_type === 'ownerlookup') {
        control = '<div class="operation-lookup"><input type="search" autocomplete="off" data-lookup-input data-selected="' + esc(id(value)) + '" value="' + esc(value && (value.name || value.Name) || '') + '" placeholder="Search ' + esc(label.toLowerCase()) + '…"' + attrs + '><button type="button" class="button secondary" data-search' + (readonly ? ' disabled' : '') + ' title="Search" aria-label="Search ' + esc(label) + '">⌕</button><button type="button" class="button secondary" data-clear' + (readonly ? ' disabled' : '') + ' title="Clear selection" aria-label="Clear ' + esc(label) + '">×</button></div><div class="operation-lookup-results" data-results role="group" aria-label="' + esc(label) + ' search results"></div>';
      } else if (f.data_type === 'picklist') {
        var options = (f.pick_list_values || []).filter(function (p) { return p.actual_value !== '-None-' && (name !== 'Accounting_Status' || config.statuses.includes(p.actual_value) || p.actual_value === value); });
        control = '<select' + attrs + '><option value="">Select…</option>' + options.map(function (p) { return '<option value="' + esc(p.actual_value) + '"' + (p.actual_value === value ? ' selected' : '') + '>' + esc(p.display_value || p.actual_value) + '</option>'; }).join('') + '</select>';
      } else if (f.data_type === 'boolean') control = '<input type="checkbox"' + attrs + (value === true ? ' checked' : '') + '>';
      else if (f.data_type === 'textarea') control = '<textarea rows="3"' + attrs + ' maxlength="' + (f.length || 32000) + '">' + esc(value || '') + '</textarea>';
      else {
        var type = {currency:'number', percent:'number', date:'date', datetime:'datetime-local', email:'email'}[f.data_type] || 'text';
        control = '<input type="' + type + '"' + attrs + ' value="' + esc(type === 'datetime-local' ? localDate(value) : value == null ? '' : value) + '"' + (type === 'number' ? ' step="0.01" min="0"' + (name === 'Percent' ? ' max="100"' : '') : ' maxlength="' + (f.length || 255) + '"') + '>';
      }
      return '<div class="operation-edit-field' + (f.data_type === 'textarea' ? ' is-wide' : '') + '" data-name="' + name + '"><label for="operation-field-' + name + '">' + esc(label) + (required && !readonly ? ' <span class="required">*</span>' : '') + (readonly ? ' <span class="operation-field-lock">Read only</span>' : '') + '</label>' + control + '<small class="operation-field-error"></small></div>';
    }
    function render(locked) {
      body.innerHTML = (locked ? '<p class="operation-edit-notice">An invoice or payment is already registered. Financial fields are read only; other details and documents can still be edited.</p>' : '') + config.groups.map(function (g) { return '<section><h3>' + g[0] + '</h3><div class="operation-edit-grid">' + g[1].split(',').map(function (f) { return fieldMarkup(f, locked); }).join('') + '</div></section>'; }).join('') +
        '<section><h3>' + (moduleName === 'Prepayments' ? 'Payment proof' : 'Supporting documents') + '</h3><ul class="operation-edit-files" data-files></ul><div class="operation-edit-drop" data-drop><input type="file" multiple data-upload hidden><button type="button" data-browse>↑ <span>Drop files here or <u>browse</u></span></button><small>Up to 5 files · 20 MB per file</small></div></section>' +
        '<details class="operation-edit-related"><summary>Related records and system details</summary><dl>' + config.readonly.split(',').concat(['Created_Time','Modified_Time']).map(function (name) { var f = schema.find(function (f) { return f.api_name === name; }); if (!f || f.visible === false) return ''; var v = record[name]; return '<div><dt>' + esc(f.field_label) + '</dt><dd>' + esc(v && typeof v === 'object' ? v.name || v.id : v == null ? '—' : v) + '</dd></div>'; }).join('') + '</dl></details>';
      body.querySelectorAll('[data-field]').forEach(function (node) { node.dataset.initial = JSON.stringify([node.type === 'checkbox' ? node.checked : node.value, node.dataset.selected || '']); });
      renderFiles();
    }
    function renderFiles() {
      var list = body.querySelector('[data-files]'); if (!list) return;
      list.innerHTML = (record[config.file] || []).map(function (f, i) { var deleted = removed.includes(fileId(f)); return '<li' + (deleted ? ' class="is-removed"' : '') + '><div><small>' + (deleted ? 'Removed on save' : 'Saved document') + '</small><span title="' + esc(fileName(f)) + '">' + esc(fileName(f)) + '</span></div><button type="button" class="button secondary" data-preview="' + i + '">Download</button><button type="button" class="button secondary" data-remove="' + i + '">' + (deleted ? 'Undo' : 'Remove') + '</button></li>'; }).join('') + queue.map(function (item, i) { return '<li class="is-new"><div><small>Not saved · ' + (item.file.size / 1024).toFixed(1) + ' KB</small><span title="' + esc(item.file.name) + '">' + esc(item.file.name) + '</span></div><button type="button" class="button secondary" data-unqueue="' + i + '">Remove</button></li>'; }).join('');
    }
    function addFiles(files) {
      if (busy || pending) return;
      var items = Array.from(files);
      if (items.some(function (f) { return !f.size || f.size > 20 * 1024 * 1024; })) { message('Choose non-empty files no larger than 20 MB.'); return; }
      if ((record[config.file] || []).length - removed.length + queue.length + items.length > 5) { message('Remove an existing file before adding more than five documents.'); return; }
      queue = queue.concat(items.map(function (file) { return {file:file}; })); renderFiles(); message('');
    }
    async function handleClick(e) {
      if (busy || pending) return;
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-browse')) body.querySelector('[data-upload]').click();
      if (b.hasAttribute('data-remove')) { var f = record[config.file][Number(b.dataset.remove)], fid = fileId(f); if (!fid) { message('CRM did not return this document identifier. Reopen the record before removing it.'); return; } removed = removed.includes(fid) ? removed.filter(function (v) { return v !== fid; }) : removed.concat(fid); renderFiles(); }
      if (b.hasAttribute('data-unqueue')) { queue.splice(Number(b.dataset.unqueue), 1); renderFiles(); }
      if (b.hasAttribute('data-preview') && ns.operationsDocuments) {
        var savedFile = ns.operationsDocuments.files(record[config.file])[Number(b.dataset.preview)];
        b.disabled = true;
        try {
          if (!savedFile || !savedFile.id) throw new Error('The saved document identifier is unavailable.');
          var blob = await api.getFile({id:savedFile.id});
          if (!(blob instanceof Blob) || !blob.size) throw new Error('The document download was not confirmed.');
          var url = global.URL.createObjectURL(blob), link = document.createElement('a');
          link.href = url; link.download = savedFile.name; dialog.appendChild(link); link.click(); link.remove();
          global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 10000);
        } catch (error) { message(error.message || 'Could not download this document.'); }
        finally { b.disabled = false; }
      }
      if (b.hasAttribute('data-search')) await searchLookup(b.closest('.operation-edit-field'));
      if (b.hasAttribute('data-clear')) { var input = b.closest('.operation-edit-field').querySelector('input'); input.value = ''; input.dataset.selected = ''; b.closest('.operation-edit-field').querySelector('[data-results]').innerHTML = ''; }
      if (b.hasAttribute('data-select')) { var field = b.closest('.operation-edit-field'), node = field.querySelector('input'); node.dataset.selected = b.dataset.select; node.value = b.dataset.label; field.querySelector('[data-results]').innerHTML = ''; if (['Supplier','Booking'].includes(field.dataset.name)) ['Settlement','Boking_Service'].forEach(function (key) { var dependent = body.querySelector('[data-field="' + key + '"]'); dependent.value = ''; dependent.dataset.selected = ''; }); }
    }
    async function searchLookup(field) {
      var input = field.querySelector('input'), results = field.querySelector('[data-results]'), query = input.value.trim(), token = generation, searchToken = (Number(field.dataset.searchToken) || 0) + 1;
      field.dataset.searchToken = searchToken;
      if (query.length < 2) { results.textContent = 'Enter at least two characters to search.'; return; }
      var metadata = schema.find(function (f) { return f.api_name === field.dataset.name; }); results.textContent = 'Searching…';
      try {
        var response, relatedContext = {Supplier:{id:body.querySelector('[data-field=Supplier]') && body.querySelector('[data-field=Supplier]').dataset.selected}, Booking:{id:body.querySelector('[data-field=Booking]') && body.querySelector('[data-field=Booking]').dataset.selected}};
        if (field.dataset.name === 'Settlement' && ns.cardPurchaseSettlements) {
          response = {data:(await ns.cardPurchaseSettlements.load(api, relatedContext)).records};
          response.data = response.data.filter(function (r) { return String(r.Name || '').toLowerCase().includes(query.toLowerCase()); });
        } else if (field.dataset.name === 'Boking_Service' && ns.cardPurchaseServices) {
          response = {data:await ns.cardPurchaseServices.load(api, relatedContext)};
          response.data = response.data.filter(function (r) { return [r.Name,r.Product_Description,r.Service_Date].join(' ').toLowerCase().includes(query.toLowerCase()); });
        } else if (metadata.data_type === 'ownerlookup') {
          response = {users:[]};
          for (var userPage = 1; userPage <= 50; userPage++) {
            var userResponse = await api.getAllUsers({Type:'ActiveUsers', page:userPage, per_page:200});
            if (!Array.isArray(userResponse.users)) throw new Error('Could not load active users.');
            response.users = response.users.concat(userResponse.users);
            if (!userResponse.info || !userResponse.info.more_records) break;
            if (!userResponse.users.length || userPage === 50) throw new Error('The user list could not be fully loaded.');
          }
        } else response = await api.searchRecord({Entity:metadata.lookup.module.api_name, Type:'word', Query:query, page:1, per_page:50});
        if (token !== generation || Number(field.dataset.searchToken) !== searchToken || query !== input.value.trim()) return;
        var rows = metadata.data_type === 'ownerlookup' ? (response.users || []).filter(function (u) { return String(u.full_name || '').toLowerCase().includes(query.toLowerCase()); }) : response.data;
        if (!rows && (response.status === 204 || response.code === 'NO_CONTENT')) rows = [];
        if (!Array.isArray(rows)) throw new Error('Could not load search results.');
        if (['Settlement','Boking_Service'].includes(field.dataset.name)) rows = rows.filter(function (r) { return id(r.Supplier) === body.querySelector('[data-field=Supplier]').dataset.selected && id(r.Booking) === body.querySelector('[data-field=Booking]').dataset.selected; });
        if (['Card_Payment_Account','Original_Card_Purchase'].includes(field.dataset.name)) rows = rows.filter(ns.isOwnQuickPaymentAccount);
        results.innerHTML = rows.length ? rows.map(function (r) { var label = r.Name || r.Vendor_Name || r.Deal_Name || r.full_name || r.name || id(r); return '<button type="button" data-select="' + esc(id(r)) + '" data-label="' + esc(label) + '"><strong>' + esc(label) + '</strong><small>' + esc(r.MFSP_Reference || r.TP_Reference || r.Supplier_Code || '') + '</small></button>'; }).join('') : 'No matching records found.';
        if (response.info && response.info.more_records) results.insertAdjacentHTML('beforeend', '<small>More matches are available. Refine your search.</small>');
      } catch (error) { if (token === generation && Number(field.dataset.searchToken) === searchToken) results.textContent = Number(error.status) === 204 ? 'No matching records found.' : error.message || 'Search failed. Try again.'; }
    }
    function collect() {
      var changes = {};
      body.querySelectorAll('[data-field]:not(:disabled)').forEach(function (node) {
        if (node.dataset.initial === JSON.stringify([node.type === 'checkbox' ? node.checked : node.value, node.dataset.selected || ''])) return;
        var name = node.dataset.field, f = schema.find(function (f) { return f.api_name === name; }), value;
        if (node.hasAttribute('data-lookup-input')) { if (node.value && !node.dataset.selected) throw new Error('Select a search result for ' + (labels[name] || f.field_label) + '.'); value = node.dataset.selected ? {id:node.dataset.selected} : null; }
        else if (node.type === 'checkbox') value = node.checked;
        else if (node.type === 'number') value = node.value === '' ? null : Number(node.value);
        else if (node.type === 'datetime-local') { if (node.value === localDate(record[name])) return; value = node.value ? new Date(node.value).toISOString() : null; }
        else value = node.value.trim() || null;
        if (!same(value, record[name])) changes[name] = value;
      });
      return changes;
    }
    async function finish() {
      if (!confirmed) {
        message('Checking the saved record…', true);
        var read = await call({module:moduleName,id:pending.id,action:'read'});
        if (!read.success || !verify(read.record, pending)) {
          if (read.success && read.record.Modified_Time === pending.modified_time) { pending = null; remember(); throw new Error('No changes were saved. You can retry Save changes.'); }
          throw new Error('The saved result could not be fully verified. Check the record in CRM before retrying; this form will not submit another update.');
        }
        confirmed = true;
      }
      if (moduleName === 'Prepayments') {
        message('Changes saved. Updating request and service statuses…', true);
        for (var requestId of pending.sync_requests) await ns.syncPrepaymentRequestFromSDK(api, zoho.CRM.META, requestId);
      }
      pending = null; remember();
      global.dispatchEvent(new CustomEvent('accounting-manager-operation-edited', {detail:{module:moduleName,id:id(record)}}));
      if (onSaved) { try { await onSaved(); } catch (error) { message('Changes saved. Refresh the list to reload the latest data.'); return; } }
      busy = false; close();
    }
    async function save(e) {
      e.preventDefault(); if (busy) return;
      if (pending) { setBusy(true, confirmed ? 'Updating related records…' : 'Checking saved changes…'); try { await finish(); } catch (error) { message((confirmed ? 'Changes saved. ' : '') + error.message); } finally { setBusy(false); } return; }
      if (!form.reportValidity()) return;
      var changes;
      try { changes = collect(); } catch (error) { message(error.message); return; }
      if (!Object.keys(changes).length && !removed.length && !queue.length) { close(); return; }
      setBusy(true, 'Checking current data…');
      try {
        var fresh = await call({module:moduleName,id:id(record),action:'read'});
        if (!fresh.success || fresh.record.Modified_Time !== record.Modified_Time) throw new Error('This record has changed. Reopen it before saving.');
        for (var item of queue) {
          if (item.uploadedId) continue;
          message('Uploading ' + item.file.name + '…', true);
          var response = await api.uploadFile({ CONTENT_TYPE:'multipart', PARTS:[{headers:{'Content-Disposition':'file;'},content:'__FILE__'}], FILE:{fileParam:'content',file:item.file} });
          var upload = response && response.data && response.data[0];
          if (!upload || upload.code !== 'SUCCESS' || !upload.details || !upload.details.id) throw new Error('The document upload was not confirmed.');
          item.uploadedId = String(upload.details.id);
        }
        pending = {module:moduleName,id:id(record),action:'save',modified_time:record.Modified_Time,changes:changes,remove_files:removed.slice(),before_files:(record[config.file] || []).map(fileId),add_files:queue.map(function (item) { return {id:item.uploadedId,name:item.file.name,size:item.file.size}; }),sync_requests:Array.from(new Set([id(record.Prepayment_Request), id(changes.Prepayment_Request)].filter(Boolean)))};
        remember(); message('Saving changes…', true);
        var result = await call(pending);
        if (result.uncertain) throw new Error('CRM did not confirm the save. Use Check saved changes to verify the result.');
        if (!result.success && !result.saved) { pending = null; remember(); if (result.field) { var field = body.querySelector('[data-name="' + result.field + '"]'); if (field) { field.querySelector('.operation-field-error').textContent = result.message; field.scrollIntoView({block:'nearest'}); } } throw new Error(result.message || 'Changes were not saved.'); }
        await finish();
      } catch (error) { message((confirmed ? 'Changes saved. ' : '') + (error.message || 'Could not save changes.')); }
      finally { setBusy(false); }
    }
    return {open: async function (module, recordId, trigger, refresh) {
      if (busy || !definitions[module]) return;
      ensure(); onSaved = refresh; moduleName = module; config = definitions[module]; record = {id:String(recordId)}; pending = null; confirmed = false; removed = []; queue = []; opener = trigger; var token = ++generation;
      dialog.querySelector('h2').textContent = config.title; dialog.querySelector('[data-context]').textContent = 'Loading details…'; body.innerHTML = ''; if (!dialog.open) dialog.showModal(); setBusy(true, 'Loading current record…');
      try {
        var values = await Promise.all([call({module:module,id:String(recordId),action:'read'}), zoho.CRM.META.getFields({Entity:module})]);
        if (token !== generation) return;
        if (!values[0].success) throw new Error(values[0].message || 'Could not load the record.');
        if (!Array.isArray(values[1].fields)) throw new Error('Could not load field definitions.');
        record = values[0].record; schema = values[1].fields; dialog.querySelector('[data-context]').textContent = record.Name || id(record); render(values[0].financial_locked);
        try { pending = JSON.parse(global.sessionStorage.getItem(key()) || 'null'); } catch (ignored) {}
        message(pending ? 'An earlier save needs verification. Check saved changes to continue safely.' : '');
      } catch (error) { message(error.message || 'Could not load this record.'); body.innerHTML = ''; }
      finally { setBusy(false); submit.disabled = !body.children.length; }
    }};
  };
}(window));
