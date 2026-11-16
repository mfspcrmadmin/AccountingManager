(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  ns.reconcileSavedPayment = async function (deps, paymentId, allocations) {
    var ids = Object.keys(allocations), settlements = new Set();
    if (!ids.length) { throw new Error("The original payment allocations are missing."); }
    for (var offset = 0; offset < ids.length; offset += 5) {
      var batch = ids.slice(offset, offset + 5);
      deps.progress("invoices", offset, ids.length);
      var result = await deps.execute("managesupplierpaymentallocations", {
        supplierPaymentId: paymentId,
        allocationsDataString: JSON.stringify({ allocations: allocations, reconcile_only: true, reconcile_invoice_ids: batch })
      });
      if (!result || result.success !== true || result.error !== false || result.reconcile_batch !== true ||
          !Array.isArray(result.affected_invoice_ids) || result.affected_invoice_ids.length !== batch.length ||
          !batch.every(function (id) { return result.affected_invoice_ids.indexOf(id) !== -1; }) ||
          !Array.isArray(result.affected_settlement_ids)) {
        throw new Error(result && result.message || "CRM did not confirm this invoice batch. Resume the same payment.");
      }
      result.affected_settlement_ids.forEach(function (id) {
        if (!/^[0-9]+$/.test(String(id))) { throw new Error("CRM returned an invalid settlement identifier."); }
        settlements.add(String(id));
      });
      deps.progress("invoices", offset + batch.length, ids.length);
    }
    var done = 0;
    for (var settlementId of settlements) {
      deps.progress("settlements", done, settlements.size);
      var rebuilt = await deps.execute("rebuildsuppliersettlementtotals", { settlementIdsString: settlementId });
      if (!rebuilt || rebuilt.error !== false || Number(rebuilt.warning_count || 0) !== 0 || Number(rebuilt.processed_count) !== 1) {
        throw new Error(rebuilt && rebuilt.message || "Settlement balances remain pending. Resume the same payment.");
      }
      deps.progress("settlements", ++done, settlements.size);
    }
  };
  // Existing unique Invoice_Edit_Key fields provide identity even if the insert
  // response is lost. The immutable browser journal survives closing the panel.
  ns.createReliablePaymentSave = function (deps) {
    var key = "accounting-manager:payment-save:v1", busy = false;
    function progress(phase, current, total) {
      if (deps.progress) { deps.progress({ phase: phase, current: current || 0, total: total || 0 }); }
    }
    function pending() {
      var raw = deps.storage.getItem(key);
      if (!raw) { return null; }
      var value = JSON.parse(raw);
      if (value.version !== 1 || !value.operationKey || !value.plan || !value.plan.entries.length) {
        throw new Error("Payment recovery information is unreadable. Keep it and contact support before creating another payment.");
      }
      return value;
    }
    function save(value) {
      var raw = JSON.stringify(value);
      deps.storage.setItem(key, raw);
      if (deps.storage.getItem(key) !== raw) { throw new Error("Payment recovery information could not be saved."); }
    }
    async function rows(module, field, id) {
      var result = [], seen = new Set();
      for (var page = 1; page <= 25; page++) {
        var batch = await deps.crm.searchRecordPage(module, "(" + field + ":equals:" + id + ")", page, 200);
        if (!Array.isArray(batch)) { throw new Error("CRM did not return a complete allocation list."); }
        for (var row of batch) { if (!row.id || seen.has(String(row.id))) { throw new Error("Incomplete or repeated allocation results."); } seen.add(String(row.id)); }
        result = result.concat(batch);
        if (batch.length < 200) { return result; }
      }
      throw new Error("Allocation read limit reached; no partial list was accepted.");
    }
    function id(value) { return String(value && value.id || value || ""); }
    function amount(value) {
      var n = Number(value);
      if (!Number.isFinite(n) || n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > .000001) { throw new Error("Use non-negative amounts with at most two decimals."); }
      return Math.round(n * 100);
    }
    async function ensure(module, identity, payload, knownId, rememberId) {
      var found = knownId ? [await deps.crm.getRecord(module, knownId)] : await rows(module, "Invoice_Edit_Key", identity);
      if (knownId && (!found[0] || id(found[0]) !== String(knownId))) {
        throw new Error("The previously saved payment is unavailable. Review it before resuming; no replacement payment was created.");
      }
      if (!found.length) {
        var result = await deps.crm.insertRecord(module, Object.assign({}, payload, { Invoice_Edit_Key: identity }), { trigger: [] });
        var row = result && result.data && result.data[0];
        if (!row || !row.details || !row.details.id || !["SUCCESS", "DUPLICATE_DATA"].includes(row.code)) {
          throw new Error("CRM did not confirm the payment record. Retry the same operation to check its outcome.");
        }
        if (rememberId) { rememberId(String(row.details.id)); }
        found = [await deps.crm.getRecord(module, row.details.id)];
      }
      if (found.length !== 1 || !found[0] || found[0].Invoice_Edit_Key !== identity) { throw new Error("The payment identity could not be verified."); }
      var record = found[0];
      Object.keys(payload).forEach(function (field) {
        // Reconciliation owns these derived fields; they may already be refreshed
        // when resuming after a later operation or screen refresh failure.
        if (["Context_Mode", "Context_Summary", "Supplier_Count", "Booking_Count", "Settlement_Count", "Allocation_Count", "Invoice_Status", "Payment_Status"].includes(field)) { return; }
        if (id(record[field]) !== id(payload[field])) { throw new Error("The saved payment data changed: " + field + ". Review before resuming."); }
      });
      return record;
    }
    async function preflight(plan, paymentId) {
      if (!plan || !plan.payment || !String(plan.payment.Name || "").trim() || String(plan.payment.Name).length > 120) { throw new Error("Enter a payment reference of at most 120 characters."); }
      var seen = {}, currency = plan.payment.Currency || "EUR", net = 0, index = 0;
      for (var entry of plan.entries) {
        progress("validation", ++index, plan.entries.length);
        if (seen[entry.invoiceId]) { throw new Error("Duplicate invoice allocation."); }
        seen[entry.invoiceId] = true;
        var invoice = await deps.crm.getRecord("Supplier_Invoices", entry.invoiceId);
        var label = "Invoice " + (invoice && invoice.Name || entry.invoiceNumber || entry.invoiceId) + " (" + entry.invoiceId + ")";
        if (!invoice || String(invoice.id) !== String(entry.invoiceId)) { throw new Error(label + " could not be read from CRM. Check access and reload the invoice."); }
        if (invoice.Edit_Status === "Pending") { throw new Error(label + " has an unfinished correction. Resume its invoice correction before paying."); }
        if (invoice.Locked__s) { throw new Error(label + " is locked in CRM. Review its lock before paying."); }
        if (invoice.Registration_Key && invoice.Registration_Status !== "Complete") { throw new Error(label + " has unfinished registration (" + (invoice.Registration_Status || "unconfirmed") + "). Resume invoice registration before paying; retrying the payment cannot finish the invoice registration."); }
        if (!["Received", "Partially Paid", "Paid"].includes(invoice.Status)) { throw new Error(label + " has status " + (invoice.Status || "unconfirmed") + ", which does not allow payment."); }
        if ((invoice.Currency || "EUR") !== currency) { throw new Error("Payment and invoice currencies must match."); }
        if (id(invoice.Supplier) !== id(entry.invoiceRecord.Supplier) || id(invoice.Supplier_Settlement) !== id(entry.invoiceRecord.Supplier_Settlement) ||
            (invoice.Invoice_Type === "Credit Note") !== entry.isCreditNote) { throw new Error("The invoice relationships or type changed. Review before saving."); }
        var links = await rows("Supplier_Pay_Allocations", "Supplier_Invoice", entry.invoiceId), reserved = 0, payments = {};
        for (var link of links) {
          var pid = id(link.Supplier_Payment);
          if (!pid || payments[pid]) { throw new Error("Missing or duplicate payment allocation. Review this invoice."); }
          payments[pid] = true;
          var payment = await deps.crm.getRecord("Supplier_Payments", pid);
          if (!payment || !payment.id) { throw new Error("A related payment could not be read."); }
          if ((payment.Currency || currency) !== currency || (link.Currency || currency) !== currency) { throw new Error("Existing allocations use another currency. Review their conversion before saving."); }
          if (pid !== paymentId && payment.Status !== "Cancelled") { reserved += amount(link.Allocated_Amount); }
        }
        var allocated = amount(entry.allocatedAmount);
        if (allocated <= 0 || reserved + allocated > amount(invoice.Total_Payable_Amount == null ? invoice.Invoice_Total : invoice.Total_Payable_Amount)) {
          throw new Error("Allocation exceeds the available payable balance of invoice " + entry.invoiceNumber + ".");
        }
        net += entry.isCreditNote ? -allocated : allocated;
      }
      if (Math.abs(net) !== amount(plan.payment.Payment_Amount) || (net < 0 ? "Supplier Refund" : "Outbound Payment") !== plan.payment.Movement_Type) {
        throw new Error("Payment amount and allocations do not agree.");
      }
    }
    async function run(plan) {
      if (busy) { return { busy: true }; }
      busy = true;
      var journal;
      function checkpoint(phase) {
        journal.phase = phase;
        delete journal.lastError;
        save(journal);
        progress(phase);
      }
      async function finish() {
        // Financial work has already been confirmed. A display failure must not
        // retain a financial retry or rerun reconciliation on a large remittance.
        deps.storage.removeItem(key);
        if (deps.storage.getItem(key)) { throw new Error("Payment saved, but its recovery notice could not be cleared."); }
        progress("refresh");
        try { await deps.refresh(journal.paymentId, journal.plan); }
        catch (_) { return { success: true, paymentId: journal.paymentId, refreshRequired: true }; }
        return { success: true, paymentId: journal.paymentId };
      }
      async function execute() {
        journal = pending();
        if (journal && journal.phase === "complete" && journal.paymentId) { return finish(); }
        progress("connection");
        if (deps.ready) { await deps.ready(); }
        if (!journal) {
          await preflight(plan, "");
          journal = { version: 1, operationKey: deps.randomUUID(), plan: plan, phase: "validation" };
          save(journal); // Before any financial record can be created.
        }
        plan = journal.plan;
        var existing = journal.paymentId ? [await deps.crm.getRecord("Supplier_Payments", journal.paymentId)] : await rows("Supplier_Payments", "Invoice_Edit_Key", journal.operationKey);
        if (journal.paymentId && (!existing[0] || id(existing[0]) !== String(journal.paymentId))) {
          throw new Error("The previously saved payment is unavailable. Review it before resuming; no replacement payment was created.");
        }
        if (existing.length > 1) { throw new Error("Duplicate payment operation keys require review."); }
        if (existing.length) {
          if (existing[0].Invoice_Edit_Key !== journal.operationKey) { throw new Error("The payment identity could not be verified."); }
          journal.paymentId = id(existing[0]); save(journal);
        }
        if (existing.length && deps.storage.getItem("accounting-manager:payment-delete:v1:" + id(existing[0]))) { throw new Error("Finish the pending payment deletion before resuming registration."); }
        checkpoint("validation");
        await preflight(plan, existing.length ? id(existing[0]) : "");
        checkpoint("payment");
        var payment = await ensure("Supplier_Payments", journal.operationKey, plan.payment, journal.paymentId, function (paymentId) {
          journal.paymentId = paymentId; save(journal);
        });
        journal.paymentId = id(payment); save(journal);
        // Server validates the complete requested graph before allocation writes.
        checkpoint("allocation-validation");
        await deps.reconcile(journal.paymentId, plan, true);
        checkpoint("allocations");
        var allocationIndex = 0;
        for (var entry of plan.entries) {
          progress("allocations", ++allocationIndex, plan.entries.length);
          var payload = deps.allocationPayload(journal.paymentId, plan, entry);
          await ensure("Supplier_Pay_Allocations", journal.operationKey + "-" + entry.invoiceId, payload);
        }
        checkpoint("balances");
        await deps.reconcile(journal.paymentId, plan, false);
        checkpoint("operations");
        await deps.sync(journal.paymentId, plan);
        checkpoint("complete");
        return finish();
      }
      try { return await (deps.withLock ? deps.withLock(key, execute) : execute()); }
      catch (error) {
        if (journal) {
          journal.lastError = String(error.message || error);
          try { save(journal); } catch (_) { /* Keep the last durable checkpoint. */ }
        }
        throw error;
      }
      finally { busy = false; }
    }
    return { run: run, pending: pending };
  };
}(window));
