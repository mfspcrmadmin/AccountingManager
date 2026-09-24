(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var MAX_FILES = 5, MAX_SIZE = 20 * 1024 * 1024;
  function files(record) { return Array.isArray(record.Payment_Proof) ? record.Payment_Proof : []; }
  function fileId(file) { return String(file.File_Id__s || file.$file_id || file.file_Id || file.file_id || file.File_Id || ""); }
  function fileName(file) { return file.File_Name__s || file.File_Name || file.file_Name || file.file_name || file.filename || file.fileName || file.name || "Payment proof"; }
  function attachmentId(file) { return String(file.attachment_Id || file.id || fileId(file)); }
  function exactFileSize(file) {
    // Display sizes such as "35.78 KB" are rounded text, not a byte count.
    var candidates = [file.original_Size_Byte, file.Size__s, file.file_Size, file.size];
    for (var value of candidates) {
      if (value == null || !/^\d+$/.test(String(value).trim())) { continue; }
      var bytes = Number(value);
      if (Number.isSafeInteger(bytes)) { return bytes; }
    }
    return null;
  }
  function isSavedFile(file, item) {
    if (fileId(file) === item.uploadedId) { return true; }
    // CRM may return a different file ID after linking the uploaded ZFS file.
    // Require a NEW attachment, its exact name and its size when CRM exposes it.
    var size = exactFileSize(file);
    return Boolean(item.previousIds && attachmentId(file) && !item.previousIds.includes(attachmentId(file)) && fileName(file) === item.file.name && (size == null || size === item.file.size));
  }
  function confirmed(response, fallback) {
    var result = response && response.data && response.data[0];
    if (!result || result.code !== "SUCCESS") { throw new Error(result && result.message || response && response.message || fallback); }
    return result;
  }
  ns.createPrepaymentProofSender = function (zoho) {
    return { send: async function (recordId) {
      if (!/^\d+$/.test(String(recordId || ""))) { throw new Error("A valid prepayment is required."); }
      if (!zoho || !zoho.CRM || !zoho.CRM.FUNCTIONS || !zoho.CRM.FUNCTIONS.execute) { throw new Error("Sending payment proof is unavailable in this widget context."); }
      var response;
      try {
        response = await zoho.CRM.FUNCTIONS.execute("notif_sendprepaymentproof", { arguments: JSON.stringify({ prepaymentId: String(recordId) }) });
      } catch (error) {
        throw new Error("CRM did not confirm the send. Check email delivery before trying again. " + (error && error.message || ""));
      }
      var result = response && response.details && response.details.output;
      try { if (typeof result === "string") { result = JSON.parse(result); } } catch (ignored) { result = null; }
      if (!result || result.success !== true || result.sent !== true) {
        throw new Error(result && result.message || "CRM did not confirm the send. Check email delivery and that notif_sendprepaymentproof is deployed before trying again.");
      }
      return result;
    } };
  };
  ns.createPrepaymentProofService = function (api, options) {
    var wait = options && options.wait || function (ms) { return new Promise(function (resolve) { global.setTimeout(resolve, ms); }); };
    async function read(recordId) {
      var response = await api.getRecord({ Entity: "Prepayments", RecordID: recordId });
      var record = response && response.data && response.data[0];
      if (!record || String(record.id) !== String(recordId)) { throw new Error("Could not load this prepayment and its payment proof."); }
      if (!Object.prototype.hasOwnProperty.call(record, "Payment_Proof")) { throw new Error("CRM did not return the Payment Proof field. Check field access and reopen the popup. Existing attachments have not been changed."); }
      if (record.Payment_Proof != null && !Array.isArray(record.Payment_Proof)) { throw new Error("CRM returned an invalid Payment Proof field."); }
      return record;
    }
    async function verify(recordId, item, record) {
      for (var attempt = 0; attempt < 4; attempt += 1) {
        if (files(record).filter(function (file) { return isSavedFile(file, item); }).length === 1) { return record; }
        if (attempt < 3) { await wait(600 * (attempt + 1)); record = await read(recordId); }
      }
      throw new Error("The file was uploaded, but CRM has not confirmed it in Payment Proof: " + item.file.name + ". Click Check attachments to read CRM again without uploading another copy.");
    }
    async function save(recordId, queue, onProgress) {
      if (!queue.length) { throw new Error("Choose at least one file."); }
      queue.forEach(function (item) {
        if (!item.file || !item.file.name || !item.file.size || item.file.size > MAX_SIZE) { throw new Error("Each file must be non-empty and no larger than 20 MB."); }
      });
      var record = await read(recordId);
      if (record.Bank_Receipt_Needed !== true) { throw new Error("Bank Receipt Needed is no longer marked. Refresh the prepayment before attaching files."); }
      queue.forEach(function (item) {
        if (item.uploadedId && files(record).some(function (file) { return isSavedFile(file, item); })) { item.saved = true; }
      });
      if (files(record).length + queue.filter(function (item) { return !item.saved; }).length > MAX_FILES) { throw new Error("Payment Proof allows up to 5 files, including existing attachments."); }
      for (var item of queue) {
        if (item.saved) { continue; }
        if (item.attempted) {
          record = await verify(recordId, item, record); item.saved = true;
          if (onProgress) { onProgress(record); } continue;
        }
        if (!item.uploadedId) {
          var result = confirmed(await api.uploadFile({
            CONTENT_TYPE: "multipart", PARTS: [{ headers: { "Content-Disposition": "file;" }, content: "__FILE__" }],
            FILE: { fileParam: "content", file: item.file }
          }), "CRM did not confirm the file upload.");
          item.uploadedId = String(result.details && result.details.id || "");
          if (!item.uploadedId) { throw new Error("CRM did not return an uploaded file ID."); }
        }
        // Re-read immediately before appending, including changes from other users.
        record = await read(recordId);
        if (record.Bank_Receipt_Needed !== true) { throw new Error("Bank Receipt Needed is no longer marked."); }
        if (files(record).some(function (file) { return fileId(file) === item.uploadedId; })) { item.saved = true; if (onProgress) { onProgress(record); } continue; }
        if (files(record).length >= MAX_FILES) { throw new Error("Payment Proof already contains 5 files."); }
        var previousIds = files(record).map(attachmentId);
        item.previousIds = previousIds;
        item.attempted = true;
        // The embedded SDK accepts a list of uploaded ZFS IDs for a file field.
        // $file_id objects can return SUCCESS while leaving the field empty.
        // https://www.zoho.com/crm/resources/solutions/transfer-attachments-from-deals-to-accounts-automatically.html
        var response = await api.updateRecord({ Entity: "Prepayments", APIData: { id: recordId, Payment_Proof: [item.uploadedId] }, Trigger: [] });
        try { confirmed(response, "CRM did not confirm the Payment Proof update."); }
        catch (error) { item.attempted = false; throw error; }
        record = await verify(recordId, item, await read(recordId));
        item.saved = true;
        if (onProgress) { onProgress(record); }
        if (previousIds.some(function (key) { return key && !files(record).some(function (file) { return attachmentId(file) === key; }); })) {
          throw new Error("The file was saved, but the existing attachments changed. Refresh and review Payment Proof.");
        }
      }
      return record;
    }
    async function remove(recordId, selectedFile) {
      var key = String(selectedFile.attachment_Id || selectedFile.id || "");
      if (!key) { throw new Error("CRM did not provide an attachment ID. Refresh before removing this file."); }
      var record = await read(recordId);
      if (record.Bank_Receipt_Needed !== true) { throw new Error("Bank Receipt Needed is no longer marked."); }
      if (!files(record).some(function (file) { return attachmentId(file) === key; })) { return record; }
      var remaining = files(record).filter(function (file) { return attachmentId(file) !== key; }).map(attachmentId);
      confirmed(await api.updateRecord({ Entity: "Prepayments", APIData: { id: recordId, Payment_Proof: [{ attachment_id: key, _delete: null }] }, Trigger: [] }), "CRM did not confirm the attachment removal.");
      for (var attempt = 0; attempt < 4; attempt += 1) {
        record = await read(recordId);
        if (!files(record).some(function (file) { return attachmentId(file) === key; })) {
          if (remaining.some(function (id) { return !files(record).some(function (file) { return attachmentId(file) === id; }); })) { throw new Error("The other attachments changed. Close and reopen Payment Proof to review them."); }
          return record;
        }
        if (attempt < 3) { await wait(600 * (attempt + 1)); }
      }
      throw new Error("CRM has not confirmed the removal. Close and reopen Payment Proof to check the files.");
    }
    return { read: read, save: save, remove: remove };
  };
  ns.createPrepaymentProofDialog = function (panel, zoho, onSaved) {
    var find = function (key) { return panel.querySelector('[data-prepayment-proof-' + key + ']'); };
    var dialog = find("dialog"), input = find("files"), save = find("save"), close = find("close"), message = find("message");
    var send = find("send"), sender = ns.createPrepaymentProofSender(zoho), sendLocked = false, sending = false;
    var dropzone = find("dropzone"), browse = find("browse"), dragDepth = 0;
    var service = ns.createPrepaymentProofService(zoho && zoho.CRM && zoho.CRM.API), recordId = "", record = null, queue = [], busy = false;
    var initialRecord = null;
    function render() {
      input.disabled = busy || !record || queue.some(function (item) { return item.attempted && !item.saved; });
      browse.disabled = input.disabled;
      dropzone.setAttribute("aria-disabled", String(input.disabled));
      close.disabled = busy;
      save.disabled = busy || !record;
      save.textContent = busy && record && !sending ? "Saving…" : queue.some(function (item) { return item.attempted && !item.saved; }) ? "Check attachments" : queue.some(function (item) { return !item.saved; }) ? "Save attachments" : "Attach files";
      send.disabled = busy || sendLocked || !record || !files(record).length || queue.some(function (item) { return !item.saved; });
      send.textContent = sending ? "Sending…" : "Send Payment Proof";
      dialog.setAttribute("aria-busy", String(busy));
      find("existing").replaceChildren();
      var displayedFiles = files(record || initialRecord || {});
      displayedFiles.forEach(function (file) {
        var li = global.document.createElement("li"), label = global.document.createElement("span");
        label.textContent = fileName(file); li.appendChild(label);
        var remove = global.document.createElement("button"); remove.type = "button"; remove.className = "button secondary prepayment-proof-delete"; remove.title = "Delete file"; remove.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6"/></svg>'; remove.disabled = busy || !record || queue.some(function (item) { return !item.saved; });
        remove.setAttribute("aria-label", "Remove attached file " + fileName(file));
        remove.addEventListener("click", async function () {
          if (busy || !record || queue.some(function (item) { return !item.saved; })) { return; }
          busy = true; message.textContent = "Removing attachment…"; render();
          try { record = await service.remove(recordId, file); onSaved(record); sendLocked = false; message.textContent = "Attachment removed."; }
          catch (error) { message.textContent = error.message || "Could not remove the attachment. Reopen Payment Proof to check."; }
          finally { busy = false; render(); }
        });
        li.appendChild(remove); find("existing").appendChild(li);
      });
      find("existing-empty").hidden = displayedFiles.length > 0;
      find("existing-empty").textContent = busy && !record ? "Loading attached files…" : !record ? "Could not load attached files." : "No payment proof attached yet.";
      find("queue").replaceChildren();
      queue.forEach(function (item, index) {
        var li = global.document.createElement("li"), label = global.document.createElement("span");
        label.textContent = item.file.name + " · " + (item.file.size / 1024 / 1024).toFixed(2) + " MB" + (item.saved ? " — Saved" : " — Ready to attach"); li.appendChild(label);
        if (!item.saved && !item.attempted) {
          var remove = global.document.createElement("button"); remove.type = "button"; remove.className = "button secondary prepayment-proof-delete"; remove.title = "Delete file"; remove.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6"/></svg>'; remove.disabled = busy;
          remove.setAttribute("aria-label", "Remove " + item.file.name);
          remove.addEventListener("click", function () { queue.splice(index, 1); render(); }); li.appendChild(remove);
        }
        find("queue").appendChild(li);
      });
    }
    function addFiles(incoming) {
      if (input.disabled) { return; }
      var errors = [];
      Array.from(incoming || []).forEach(function (file) {
        if (!file.size || file.size > MAX_SIZE) { errors.push(file.name + ": choose a non-empty file up to 20 MB."); return; }
        if (queue.some(function (item) { return item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified; })) { return; }
        if (files(record).length + queue.filter(function (item) { return !item.saved; }).length >= MAX_FILES) { errors.push("Payment Proof allows up to 5 files in total."); return; }
        if (!queue.some(function (item) { return item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified; })) { queue.push({ file: file }); }
      });
      input.value = ""; message.textContent = Array.from(new Set(errors)).join(" "); render();
    }
    input.addEventListener("change", function () { addFiles(input.files); });
    browse.addEventListener("click", function () { if (!input.disabled) { input.click(); } });
    dropzone.addEventListener("dragenter", function (event) { event.preventDefault(); dragDepth += 1; if (!input.disabled) { dropzone.classList.add("is-dragging"); } });
    dropzone.addEventListener("dragover", function (event) { event.preventDefault(); if (event.dataTransfer) { event.dataTransfer.dropEffect = input.disabled ? "none" : "copy"; } });
    dropzone.addEventListener("dragleave", function (event) { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { dropzone.classList.remove("is-dragging"); } });
    dialog.addEventListener("dragover", function (event) { event.preventDefault(); });
    dialog.addEventListener("drop", function (event) { event.preventDefault(); });
    dropzone.addEventListener("drop", function (event) {
      event.preventDefault(); dragDepth = 0; dropzone.classList.remove("is-dragging");
      addFiles(event.dataTransfer && event.dataTransfer.files);
    });
    close.addEventListener("click", function () { if (!busy) { dialog.close(); } });
    dialog.addEventListener("cancel", function (event) { if (busy) { event.preventDefault(); } });
    find("form").addEventListener("submit", async function (event) {
      event.preventDefault(); if (busy || !record) { return; }
      // The initial Attach action opens the picker; selected files can then be saved.
      if (!queue.some(function (item) { return !item.saved; })) { input.click(); return; }
      busy = true; message.textContent = "Uploading files to Payment Proof…"; render();
      try {
        record = await service.save(recordId, queue, function (updated) { record = updated; onSaved(updated); render(); });
        onSaved(record);
        message.textContent = "Files saved to Payment Proof."; queue = []; sendLocked = false;
      } catch (error) { message.textContent = error.message || "Could not attach files. Files already marked Saved remain attached."; }
      finally { busy = false; render(); }
    });
    send.addEventListener("click", async function () {
      if (busy || sendLocked || !record || !files(record).length || queue.some(function (item) { return !item.saved; })) { return; }
      busy = true; sending = true; sendLocked = true; message.textContent = "Sending payment proof…"; render();
      try {
        var result = await sender.send(recordId);
        message.textContent = result.message || "Payment proof email sent successfully.";
      } catch (error) { message.textContent = error.message || "Could not confirm the send. Check email delivery before trying again."; }
      finally { busy = false; sending = false; render(); }
    });
    return { open: async function (id, snapshot) {
      if (busy || dialog.open) { return; }
      recordId = String(id); record = null; queue = []; input.value = ""; busy = true; sendLocked = false;
      initialRecord = snapshot && String(snapshot.id) === recordId ? snapshot : null;
      dragDepth = 0; dropzone.classList.remove("is-dragging");
      find("name").textContent = initialRecord && initialRecord.Name || ""; message.textContent = "Loading payment proof…"; render(); dialog.showModal();
      try {
        record = await service.read(recordId);
        find("name").textContent = record.Name || recordId;
        if (record.Bank_Receipt_Needed !== true) { record = null; throw new Error("Bank Receipt Needed is no longer marked. Refresh the table."); }
        message.textContent = "";
      } catch (error) { message.textContent = error.message || "Could not load payment proof."; }
      finally { busy = false; render(); }
    } };
  };
}(window));
