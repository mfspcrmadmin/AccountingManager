(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  function output(response) {
    var value = response && response.details && response.details.output;
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (_) { value = null; }
    }
    if (!value || typeof value.success !== "boolean" || typeof value.retryable !== "boolean") {
      throw new Error("CRM did not confirm the registration result. Retry this operation to check its outcome.");
    }
    if (value.success && !/^\d+$/.test(String(value.invoice_id || ""))) {
      throw new Error("CRM did not return the invoice ID. Retry this operation to check its outcome.");
    }
    return value;
  }

  function cents(value, label) {
    var number = Number(value);
    if (!Number.isFinite(number) || number < 0 || Math.abs(number * 100 - Math.round(number * 100)) > 0.000001) {
      throw new Error((label || "Amount") + " must be a non-negative number with at most two decimal places.");
    }
    return Math.round(number * 100);
  }

  // A journal is written BEFORE the only request that can create an invoice.
  // It survives closing the panel, navigation and lost function responses.
  ns.createInvoiceRegistration = function (deps) {
    var busy = false;
    function key(supplierId) { return "accounting-manager:supplier-invoice:v1:" + supplierId; }
    function read(supplierId) {
      var raw = deps.storage.getItem(key(supplierId));
      if (!raw) { return null; }
      var journal = JSON.parse(raw);
      var savedRequest;
      try { savedRequest = JSON.parse(journal.requestJson); } catch (_) { /* Fail closed below. */ }
      if (journal.version !== 1 || !/^[a-f0-9-]{36}$/.test(journal.operationKey || "") ||
          !savedRequest || savedRequest.supplier_id !== String(supplierId) || !savedRequest.invoice || !savedRequest.invoice.Name) {
        throw new Error("The pending invoice registration cannot be read. Keep it and contact support before creating another invoice.");
      }
      return journal;
    }
    function save(supplierId, journal) {
      var serialized = JSON.stringify(journal);
      deps.storage.setItem(key(supplierId), serialized);
      if (deps.storage.getItem(key(supplierId)) !== serialized) {
        throw new Error("The recovery information could not be saved. Invoice registration has been stopped.");
      }
    }
    async function run(supplierId, request, file) {
      var previous = read(supplierId);
      if (previous && previous.discardRequested) { return discard(supplierId); }
      if (busy) { return { busy: true }; }
      busy = true;
      async function execute() {
        var journal = read(supplierId);
        if (!journal) {
          if (!request || request.supplier_id !== String(supplierId)) { throw new Error("Select the invoice supplier first."); }
          // Check storage before even uploading a document.
          var storageProbe = key(supplierId) + ":probe";
          deps.storage.setItem(storageProbe, "1");
          deps.storage.removeItem(storageProbe);
          request = JSON.parse(JSON.stringify(request));
          if (file) {
            var upload = await deps.uploadFile(file);
            var row = upload && upload.data && upload.data[0];
            var fileId = row && row.details && row.details.id;
            if (!row || String(row.status || row.code).toLowerCase() !== "success" || !fileId) {
              throw new Error("The document upload was not confirmed. No invoice has been requested.");
            }
            request.file_id = String(fileId);
          }
          journal = { version: 1, operationKey: deps.randomUUID(), requestJson: JSON.stringify(request), invoiceId: "" };
          save(supplierId, journal);
        }
        if (journal.invoiceId) {
          var existing = await deps.getInvoice(journal.invoiceId);
          if (!existing || String(existing.id) !== journal.invoiceId || existing.Registration_Key !== journal.operationKey) {
            throw new Error("The previously saved invoice is unavailable or belongs to another operation. Review it before resuming; no replacement invoice was requested.");
          }
        }
        var result = output(await deps.executeFunction("supplierinvoice_register", {
          operationKey: journal.operationKey, requestJson: journal.requestJson
        }));
        if (result.invoice_id) { journal.invoiceId = String(result.invoice_id); }
        journal.message = result.message || "";
        save(supplierId, journal);
        if (!result.success) {
          // Only an explicit server rejection BEFORE creating any record permits editing.
          if (!result.retryable && !journal.invoiceId) { deps.storage.removeItem(key(supplierId)); }
          return result;
        }
        // Keep the journal if the read/refresh fails. A retry returns the existing ID.
        await deps.refresh(result.invoice_id);
        deps.storage.removeItem(key(supplierId));
        return result;
      }
      try {
        return await (deps.withLock ? deps.withLock(key(supplierId), execute) : execute());
      } finally { busy = false; }
    }
    async function discard(supplierId) {
      if (busy) { return { busy: true }; }
      busy = true;
      async function execute() {
        var journal = read(supplierId);
        if (!journal) { throw new Error("There is no saved registration to discard."); }
        journal.discardRequested = true;
        save(supplierId, journal);
        var result = output(await deps.executeFunction("supplierinvoice_register", {
          operationKey: journal.operationKey,
          requestJson: JSON.stringify({ operation: "discard_registration", original_request: journal.requestJson })
        }));
        if (result.invoice_id) journal.invoiceId = String(result.invoice_id);
        journal.message = result.message || "";
        if (!result.success && result.phase === "validate") { delete journal.discardRequested; }
        save(supplierId, journal);
        if (!result.success) { return result; }
        if (result.phase !== "discarded") { throw new Error("CRM did not confirm that the registration was discarded. Keep this recovery and retry."); }
        deps.storage.removeItem(key(supplierId));
        if (deps.storage.getItem(key(supplierId))) { throw new Error("Registration discarded; its local recovery could not be cleared. Retry discard."); }
        try { await deps.refresh(result.invoice_id); }
        catch (_) { result.refreshRequired = true; }
        return result;
      }
      try { return await (deps.withLock ? deps.withLock(key(supplierId), execute) : execute()); }
      finally { busy = false; }
    }
    return { pending: read, run: run, discard: discard, isBusy: function () { return busy; } };
  };
  ns.invoiceRegistrationCents = cents;
}(window));
