(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  // Keep the parent until every dependent mutation succeeds. The journal lets
  // Confirm deletion resume after a partial failure, including a page reload.
  ns.createInvoiceDeletionModule = function (deps) {
    var crm = deps.crm, M = deps.modules, helpers = deps.helpers;
    var storage = deps.storage;
    function id(value) { return String(helpers.getLookupId(value) || ""); }
    function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
    function unique(values) { return Array.from(new Set(values.filter(Boolean))); }
    function total(invoice) {
      return money(invoice.Invoice_Total != null ? invoice.Invoice_Total : invoice.Total_Payable_Amount);
    }
    function locked(record) {
      return Boolean(record.Zoho_Books_Document_Id || record.Zoho_Books_Payment_ID || record.Posted_At || record.Accounting_Posted_At) ||
        [record.Accounting_Status, record.Books_Post_Status, record.Status].some(function (value) {
          return /^(posted|posted to books|sent to books|synced|exported|reconciled)$/i.test(String(value || "").trim());
        });
    }
    function assertUnlocked(record) {
      if (locked(record)) { throw new Error((record.Name || record.id) + " is posted, exported or reconciled. Reverse it before deleting the invoice."); }
    }
    async function all(module, field, value) {
      var records = [], seen = new Set();
      for (var page = 1; page <= 1000; page += 1) {
        var batch = field
          ? await crm.searchRecordPage(module, "(" + field + ":equals:" + helpers.escapeCriteriaValue(value) + ")", page, 200)
          : await crm.getAllRecords(module, page, 200);
        if (!Array.isArray(batch)) { throw new Error("Could not load " + module + "."); }
        batch.forEach(function (record) {
          if (!record.id || seen.has(String(record.id))) { throw new Error("Incomplete or repeated CRM page for " + module + "."); }
          seen.add(String(record.id)); records.push(record);
        });
        if (batch.length < 200) { return records; }
      }
      throw new Error("Too many related records in " + module + "; deletion was stopped.");
    }
    async function record(module, recordId) {
      var result = await crm.getRecord(module, recordId);
      if (!result || !result.id) { throw new Error("Could not load " + module + " " + recordId + "."); }
      return result;
    }
    function statusForSettlement(settlement, invoiced, paid) {
      if (settlement.Admin_Status === "Cancelled") { return "Cancelled"; }
      if (paid > 0) { return invoiced > 0 && paid >= invoiced ? "Paid" : "Partially Paid"; }
      if (invoiced > 0) {
        return invoiced < money(settlement.Total_Service_Cost) ? "Partially Accounted" : "Accounted";
      }
      return Number(settlement.Service_Count) > 0 || money(settlement.Total_Service_Cost) !== 0 || settlement.Settlement_Type === "Agent Commission"
        ? "Pending Invoice" : "No Services";
    }

    async function prepare(invoiceId) {
      var invoice = await record(M.invoices, invoiceId);
      assertUnlocked(invoice);
      var job = { version: 1, invoiceId: invoiceId, operations: [], cursor: 0, guards: [{ module: M.invoices, id: invoiceId }] };
      var deletes = [], updates = [], deleteKeys = new Set(), entriesToDelete = new Set();
      var invoiceCache = {}; invoiceCache[invoiceId] = invoice;
      async function loadInvoice(value) {
        if (!invoiceCache[value]) { invoiceCache[value] = await record(M.invoices, value); }
        return invoiceCache[value];
      }
      function remove(module, item) {
        var key = module + ":" + item.id;
        if (!deleteKeys.has(key)) { deletes.push({ type: "delete", module: module, id: String(item.id) }); deleteKeys.add(key); }
      }
      function update(module, item, fields) { updates.push({ type: "update", module: module, id: String(item.id), fields: fields }); }
      var allocations = await all(M.payAllocations, "Supplier_Invoice", invoiceId);
      var splits = await all(M.invoiceSettlementAllocations, "Vendor_Invoice", invoiceId);
      var lines = await all(M.invoiceLines, "Supplier_Invoice", invoiceId);
      var settlementIds = unique([id(invoice.Supplier_Settlement)].concat(
        allocations.map(function (a) { return id(a.Supplier_Settlement); }),
        splits.map(function (a) { return id(a.Vendor_Settlement); })
      ));
      var paymentIds = unique(allocations.map(function (a) { return id(a.Supplier_Payment); }));
      var cards = await all("Card_Purchases", "Vendor_Invoice", invoiceId);
      // Card linkage also recovers payments whose allocation was never created.
      paymentIds = unique(paymentIds.concat(cards.map(function (c) { return id(c.Vendor_Payment); })));
      var payments = [], deletedPaymentIds = [];
      for (var paymentId of paymentIds) {
        var payment = await record(M.payments, paymentId); assertUnlocked(payment);
        job.guards.push({ module: M.payments, id: paymentId });
        var remaining = (await all(M.payAllocations, "Supplier_Payment", paymentId)).filter(function (a) { return id(a.Supplier_Invoice) !== invoiceId; });
        payments.push({ record: payment, allocations: remaining });
        if (!remaining.length) { deletedPaymentIds.push(paymentId); }
        for (var a of remaining) {
          if (id(a.Supplier_Settlement)) { settlementIds.push(id(a.Supplier_Settlement)); }
          if (id(a.Supplier_Invoice)) {
            var allocatedInvoice = await loadInvoice(id(a.Supplier_Invoice));
            ["Supplier", "Booking", "Supplier_Settlement"].forEach(function (field) {
              if (!id(a[field])) { a[field] = allocatedInvoice[field]; }
            });
          }
        }
      }
      // Payment entries have no payment lookup in this CRM. Both current name
      // formats and the legacy name end in the immutable payment ID.
      var entries = await all(M.accountingEntries);
      entries.forEach(function (entry) {
        var belongsToPayment = paymentIds.some(function (value) {
          var name = String(entry.Name || "");
          return name === "Supplier_Payment_" + value ||
            (name.indexOf("INV-") === 0 && name.endsWith("-PAY-" + value)) ||
            (name.indexOf("PAY-MULTI-") === 0 && name.endsWith("-" + value));
        });
        if (id(entry.Supplier_Invoice) === invoiceId || belongsToPayment) { assertUnlocked(entry); entriesToDelete.add(String(entry.id)); }
      });
      var invoiceAccountingLines = await all(M.accountingEntryLines, "Supplier_Invoice", invoiceId);
      for (var entryId of unique(invoiceAccountingLines.map(function (line) { return id(line.Accounting_Entry); }))) {
        if (!entriesToDelete.has(entryId)) {
          // An unrelated shared journal must not be silently left unbalanced.
          throw new Error("Invoice lines belong to shared accounting entry " + entryId + ". Reverse or unlink that entry before deletion.");
        }
      }
      for (var entry of entries.filter(function (e) { return entriesToDelete.has(String(e.id)); })) {
        job.guards.push({ module: M.accountingEntries, id: String(entry.id) });
        var entryLines = await all(M.accountingEntryLines, "Accounting_Entry", entry.id);
        entryLines.forEach(function (line) { remove(M.accountingEntryLines, line); });
      }
      invoiceAccountingLines.forEach(function (line) { remove(M.accountingEntryLines, line); });
      entries.filter(function (e) { return entriesToDelete.has(String(e.id)); }).forEach(function (e) { remove(M.accountingEntries, e); });
      // Preserve credit notes, but remove references to records being deleted.
      for (var credit of await all(M.invoices, "Original_Invoice", invoiceId)) {
        assertUnlocked(credit); update(M.invoices, credit, { Original_Invoice: null });
      }
      for (var line of lines) {
        for (var creditLine of await all(M.invoiceLines, "Original_Invoice_Line", line.id)) {
          if (id(creditLine.Supplier_Invoice) !== invoiceId) {
            assertUnlocked(await loadInvoice(id(creditLine.Supplier_Invoice)));
            update(M.invoiceLines, creditLine, { Original_Invoice_Line: null });
          }
        }
        remove(M.invoiceLines, line);
      }
      allocations.forEach(function (a) { remove(M.payAllocations, a); });
      splits.forEach(function (a) { remove(M.invoiceSettlementAllocations, a); });
      for (var context of payments) {
        var p = context.record, rows = context.allocations;
        if (!rows.length) {
          // Payment deletion comes after its card links have been cleared.
          continue;
        }
        var suppliers = unique(rows.map(function (a) { return id(a.Supplier); }));
        var bookings = unique(rows.map(function (a) { return id(a.Booking); }));
        var settlements = unique(rows.map(function (a) { return id(a.Supplier_Settlement); }));
        update(M.payments, p, {
          Payment_Amount: money(rows.reduce(function (sum, a) { return sum + money(a.Allocated_Amount); }, 0)),
          Allocation_Count: rows.length, Supplier_Count: suppliers.length, Booking_Count: bookings.length,
          Settlement_Count: settlements.length, Context_Mode: suppliers.length <= 1 && bookings.length <= 1 && settlements.length <= 1 ? "Single" : "Mixed",
          Context_Summary: "Suppliers: " + suppliers.length + " | Bookings: " + bookings.length + " | Settlements: " + settlements.length,
          Accounting_Status: "Pending"
        });
        // This allocation picklist has no Pending value in the CRM schema.
        rows.forEach(function (a) { update(M.payAllocations, a, { Payment_Accounting_Status: null }); });
      }
      for (var deletedPaymentId of deletedPaymentIds) {
        cards = cards.concat(await all("Card_Purchases", "Vendor_Payment", deletedPaymentId));
      }
      for (var cardId of unique(cards.map(function (c) { return String(c.id); }))) {
        var card = cards.find(function (c) { return String(c.id) === cardId; });
        var clearInvoice = id(card.Vendor_Invoice) === invoiceId;
        var clearPayment = deletedPaymentIds.indexOf(id(card.Vendor_Payment)) !== -1;
        var cardFields = { Accounting_Processed_At: null, Accounting_Processed_By: null };
        if (clearInvoice) { cardFields.Vendor_Invoice = null; cardFields.Invoice_Number = null; }
        if (clearPayment) { cardFields.Vendor_Payment = null; }
        var hasInvoice = !clearInvoice && id(card.Vendor_Invoice);
        cardFields.Accounting_Status = card.Transaction_Type === "Refund"
          ? (hasInvoice ? "Pending refund record" : "Pending credit note")
          : (hasInvoice ? "Pending payment record" : "Pending invoice");
        update("Card_Purchases", card, cardFields);
      }
      // Rebuild remaining invoice balances from all their allocations, including
      // payments outside this deletion. Formula fields are calculated by CRM.
      for (var relatedInvoiceId of Object.keys(invoiceCache).filter(function (value) { return value !== invoiceId; })) {
        var relatedInvoice = invoiceCache[relatedInvoiceId];
        var paid = money((await all(M.payAllocations, "Supplier_Invoice", relatedInvoiceId)).reduce(function (sum, a) { return sum + money(a.Allocated_Amount); }, 0));
        var fields = { Amount_Paid: paid };
        if (["Cancelled", "Rejected"].indexOf(relatedInvoice.Status) === -1) {
          fields.Status = paid > 0 ? (total(relatedInvoice) > 0 && paid >= total(relatedInvoice) ? "Paid" : "Partially Paid") : "Received";
        }
        update(M.invoices, relatedInvoice, fields);
        if (id(relatedInvoice.Supplier_Settlement)) { settlementIds.push(id(relatedInvoice.Supplier_Settlement)); }
      }
      for (var settlementId of unique(settlementIds)) {
        var settlement = await record(M.settlements, settlementId);
        var directInvoices = await all(M.invoices, "Supplier_Settlement", settlementId);
        var settlementSplits = (await all(M.invoiceSettlementAllocations, "Vendor_Settlement", settlementId)).filter(function (a) { return a.Status !== "Void" && id(a.Vendor_Invoice) !== invoiceId; });
        var invoiceIds = unique(directInvoices.map(function (i) { invoiceCache[String(i.id)] = i; return String(i.id); }).concat(settlementSplits.map(function (a) { return id(a.Vendor_Invoice); }))).filter(function (value) { return value !== invoiceId; });
        var gross = 0, creditAmount = 0, settlementPaid = 0;
        for (var value of invoiceIds) {
          var inv = await loadInvoice(value);
          var invoiceSplits = (await all(M.invoiceSettlementAllocations, "Vendor_Invoice", value)).filter(function (a) { return a.Status !== "Void"; });
          var amount = invoiceSplits.length ? invoiceSplits.filter(function (a) { return id(a.Vendor_Settlement) === settlementId; }).reduce(function (sum, a) { return sum + money(a.Allocated_Amount); }, 0) : total(inv);
          if (inv.Invoice_Type === "Credit Note") { creditAmount += amount; } else { gross += amount; }
        }
        for (var allocation of await all(M.payAllocations, "Supplier_Settlement", settlementId)) {
          if (id(allocation.Supplier_Invoice) === invoiceId) { continue; }
          var paidInvoice = id(allocation.Supplier_Invoice) ? await loadInvoice(id(allocation.Supplier_Invoice)) : null;
          settlementPaid += money(allocation.Allocated_Amount) * (paidInvoice && paidInvoice.Invoice_Type === "Credit Note" ? -1 : 1);
        }
        var net = money(gross - creditAmount); settlementPaid = money(settlementPaid);
        update(M.settlements, settlement, {
          Gross_Invoice_Amount: money(gross), Credit_Note_Amount: money(creditAmount), Total_Invoice: net, Total_Paid: settlementPaid,
          Admin_Status: statusForSettlement(settlement, net, settlementPaid), Closure_Review_Status: "Pending review"
        });
      }
      // Clear inbound references before deleting their targets, then restore
      // derived values. All payloads were prepared before the first write.
      var unlinkUpdates = updates.filter(function (op) { return op.module === "Card_Purchases" || Object.prototype.hasOwnProperty.call(op.fields, "Original_Invoice") || Object.prototype.hasOwnProperty.call(op.fields, "Original_Invoice_Line"); });
      job.operations = unlinkUpdates.concat(deletes, updates.filter(function (op) { return unlinkUpdates.indexOf(op) === -1; }), deletedPaymentIds.map(function (value) { return { type: "delete", module: M.payments, id: value }; }));
      job.operations.push({ type: "delete", module: M.invoices, id: invoiceId });
      return job;
    }

    async function execute(invoiceId) {
      invoiceId = String(invoiceId);
      var key = "accountingManager.invoiceDeletion.v1." + invoiceId;
      var saved = storage.getItem(key);
      var job = saved ? JSON.parse(saved) : await prepare(invoiceId);
      if (job.version !== 1 || job.invoiceId !== invoiceId) { throw new Error("Invalid invoice deletion recovery data."); }
      storage.setItem(key, JSON.stringify(job));
      try {
        // Posting can have occurred since the first attempt failed. Never use
        // a stored plan to bypass the accounting lock on a subsequent attempt.
        for (var guard of job.guards || []) {
          var deleted = job.operations.slice(0, job.cursor).some(function (op) {
            return op.type === "delete" && op.module === guard.module && op.id === guard.id;
          });
          if (!deleted) {
            var live = await crm.getRecord(guard.module, guard.id);
            if (live && live.id) { assertUnlocked(live); }
          }
        }
        for (; job.cursor < job.operations.length; job.cursor += 1) {
          var op = job.operations[job.cursor];
          var response = op.type === "delete" ? await crm.deleteRecord(op.module, op.id) : await crm.updateRecord(op.module, op.id, op.fields, { trigger: [] });
          var result = helpers.extractRecords(response)[0] || response || {};
          var status = String(result.code || result.status || "").toLowerCase();
          var alreadyDeleted = status === "already_deleted" || (status === "invalid_data" && /^record (already )?deleted\.?$/i.test(String(result.message || "").trim()));
          if (status !== "success" && !(op.type === "delete" && alreadyDeleted)) {
            throw new Error(op.module + " " + op.id + ": " + (result.message || "CRM did not confirm the change."));
          }
          storage.setItem(key, JSON.stringify(Object.assign({}, job, { cursor: job.cursor + 1 })));
        }
        storage.removeItem(key);
        return { success: true };
      } catch (error) {
        throw new Error("Deletion incomplete (" + job.cursor + "/" + job.operations.length + " changes confirmed). " + error.message + " Retry Confirm deletion to resume.");
      }
    }
    return { execute: execute, prepare: prepare, statusForSettlement: statusForSettlement };
  };
})(window);
