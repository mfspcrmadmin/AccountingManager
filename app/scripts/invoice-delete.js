(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  // Keep the parent until every dependent mutation succeeds. The journal lets
  // Confirm deletion resume after a partial failure, including a page reload.
  ns.createInvoiceDeletionModule = function (deps) {
    var crm = deps.crm, M = deps.modules, helpers = deps.helpers;
    var storage = deps.storage;
    function id(value) { return String(helpers.getLookupId(value) || ""); }
    function money(value) { var amount=Number(value == null || value === "" ? 0 : value); if(!Number.isFinite(amount) || Math.abs(amount*100-Math.round(amount*100))>0.000001) {throw new Error("Invalid monetary amount; review the record before deletion.");} return Math.round(amount*100)/100; }
    function unique(values) { return Array.from(new Set(values.filter(Boolean))); }
    function total(invoice) {
      return money(invoice.Total_Payable_Amount != null ? invoice.Total_Payable_Amount : invoice.Invoice_Total);
    }
    function locked(record, module) {
      return record.Locked__s === true || Boolean(record.Zoho_Books_Document_Id || record.Zoho_Books_Payment_ID || record.Posted_At || (module !== M.invoices && record.Accounting_Posted_At)) ||
        [module !== M.invoices && record.Accounting_Status, record.Books_Post_Status, record.Status].some(function (value) {
          return /^(posted|posted to books|sent to books|synced|exported|reconciled)$/i.test(String(value || "").trim());
        });
    }
    function assertUnlocked(record, module) {
      if (module === M.invoices && (record.Edit_Status === "Pending" || ["Pending", "Ready"].includes(record.Registration_Status))) { throw new Error("Finish the pending invoice registration or correction before deleting this invoice."); }
      if (locked(record, module)) { throw new Error((record.Name || record.id) + " is posted, exported or reconciled. Reverse it before deleting the invoice."); }
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
      assertUnlocked(invoice, M.invoices);
      var job = { version: 3, invoiceId: invoiceId, operations: [], cursor: 0, guards: [{ module: M.invoices, id: invoiceId }] };
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
      function update(module, item, fields) { var before={}; Object.keys(fields).forEach(function(field){before[field]=item[field] == null ? null : item[field];}); updates.push({ type: "update", module: module, id: String(item.id), fields: fields, before:before }); }
      var allocations = await all(M.payAllocations, "Supplier_Invoice", invoiceId);
      var splits = await all(M.invoiceSettlementAllocations, "Vendor_Invoice", invoiceId);
      var lines = await all(M.invoiceLines, "Supplier_Invoice", invoiceId);
      var settlementIds = unique([id(invoice.Supplier_Settlement)].concat(
        allocations.map(function (a) { return id(a.Supplier_Settlement); }),
        splits.map(function (a) { return id(a.Vendor_Settlement); })
      ));
      var paymentIds = unique(allocations.map(function (a) { return id(a.Supplier_Payment); }));
      var cards = await all("Card_Purchases", "Vendor_Invoice", invoiceId);
      var prepaymentFields = await ns.getUndoPrepaymentFields(crm);
      var prepaymentLinks = await all(ns.prepaymentAllocations.module, "Vendor_Invoice", invoiceId);
      var prepayments = [];
      for (var link of prepaymentLinks) {
        if (!id(link.Prepayment)) { throw new Error("A prepayment invoice allocation has no prepayment."); }
        prepayments.push(await record("Prepayments", id(link.Prepayment)));
        remove(ns.prepaymentAllocations.module, link);
      }
      // Card linkage also recovers payments whose allocation was never created.
      paymentIds = unique(paymentIds.concat(cards.map(function (c) { return id(c.Vendor_Payment); }).concat(prepayments.map(function (p) { return id(p[prepaymentFields.payment]); }))));
      var payments = [], deletedPaymentIds = [];
      for (var paymentId of paymentIds) {
        var payment = await record(M.payments, paymentId); assertUnlocked(payment);
        await reconcileFields({type:"reconcilePayment",module:M.payments,id:paymentId});
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
      if (entriesToDelete.size || invoiceAccountingLines.length) {
        throw new Error("Existing accounting entries or lines are linked to this invoice or its payments. Review and unlink them before deleting; they will not be deleted or regenerated.");
      }
      // Preserve credit notes, but remove references to records being deleted.
      for (var credit of await all(M.invoices, "Original_Invoice", invoiceId)) {
        assertUnlocked(credit, M.invoices); update(M.invoices, credit, { Original_Invoice: null });
      }
      for (var line of lines) {
        for (var creditLine of await all(M.invoiceLines, "Original_Invoice_Line", line.id)) {
          if (id(creditLine.Supplier_Invoice) !== invoiceId) {
            assertUnlocked(await loadInvoice(id(creditLine.Supplier_Invoice)), M.invoices);
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
        updates.push({ type: "reconcilePayment", module: M.payments, id: String(p.id) });
      }
      for (var deletedPaymentId of deletedPaymentIds) {
        cards = cards.concat(await all("Card_Purchases", "Vendor_Payment", deletedPaymentId));
        prepayments = prepayments.concat(await all("Prepayments", prepaymentFields.payment, deletedPaymentId));
      }
      for (var cardId of unique(cards.map(function (c) { return String(c.id); }))) {
        var card = cards.find(function (c) { return String(c.id) === cardId; });
        var clearInvoice = id(card.Vendor_Invoice) === invoiceId;
        update("Card_Purchases", card, ns.operationUndoFields("Card_Purchases", card, clearInvoice));
      }
      var requestIds = [];
      for (var prepaymentId of unique(prepayments.map(function (p) { return String(p.id); }))) {
        var prepayment = prepayments.find(function (p) { return String(p.id) === prepaymentId; });
        var remainingLinks = (await all(ns.prepaymentAllocations.module, "Prepayment", prepaymentId)).filter(function (row) { return id(row.Vendor_Invoice) !== invoiceId; });
        prepayment._invoiceAllocationComplete = ns.prepaymentAllocations.summarize(prepayment, remainingLinks).complete;
        var resetFields = ns.operationUndoFields("Prepayments", prepayment, false);
        delete resetFields.Vendor_Payment; resetFields[prepaymentFields.payment] = null;
        update("Prepayments", prepayment, resetFields);
        if (id(prepayment.Prepayment_Request)) { requestIds.push(id(prepayment.Prepayment_Request)); }
      }
      for (var relatedInvoiceId of Object.keys(invoiceCache).filter(function (value) { return value !== invoiceId; })) {
        updates.push({type:"reconcileInvoice",module:M.invoices,id:relatedInvoiceId});
        var relatedInvoice = invoiceCache[relatedInvoiceId];
        if (id(relatedInvoice.Supplier_Settlement)) { settlementIds.push(id(relatedInvoice.Supplier_Settlement)); }
        for (var split of await all(M.invoiceSettlementAllocations,"Vendor_Invoice",relatedInvoiceId)) {
          if (split.Status !== "Void" && split.Status !== "Cancelled") { settlementIds.push(id(split.Vendor_Settlement)); }
        }
      }
      // Clear inbound references before deleting their targets, then restore
      // derived values. All payloads were prepared before the first write.
      var unlinkUpdates = updates.filter(function (op) { return op.module === "Card_Purchases" || op.module === "Prepayments" || Object.prototype.hasOwnProperty.call(op.fields || {}, "Original_Invoice") || Object.prototype.hasOwnProperty.call(op.fields || {}, "Original_Invoice_Line"); });
      job.operations = unlinkUpdates.concat(deletes, updates.filter(function (op) { return unlinkUpdates.indexOf(op) === -1; }), deletedPaymentIds.map(function (value) { return { type: "delete", module: M.payments, id: value }; }));
      unique(requestIds).forEach(function (value) { job.operations.push({ type: "syncRequest", id: value }); });
      // Cancel only the invoice being deleted so the shared rebuild excludes it.
      // Keep it available for recovery until every dependent recalculation succeeds.
      job.operations.push({type:"update",module:M.invoices,id:invoiceId,fields:{Status:"Cancelled"},before:{Status:invoice.Status || null}});
      job.operations.push({type:"rebuildSettlements",ids:unique(settlementIds)});
      job.operations.push({ type: "delete", module: M.invoices, id: invoiceId });
      return job;
    }

    async function reconcileFields(op) {
      var current = await record(op.module,op.id); assertUnlocked(current,op.module);
      var rows = await all(M.payAllocations,op.type === "reconcileInvoice" ? "Supplier_Invoice" : "Supplier_Payment",op.id);
      rows = rows.filter(function(a){return a.Status !== "Void" && a.Status !== "Cancelled";});
      var seenInvoices=new Set();
      for(var row of rows) {
        if(!id(row.Supplier_Invoice) || !id(row.Supplier_Payment) || money(row.Allocated_Amount)<=0) {throw new Error("Invalid payment allocation; review it before deletion.");}
        var pair=id(row.Supplier_Invoice)+":"+id(row.Supplier_Payment);
        if(seenInvoices.has(pair)) {throw new Error("Duplicate payment allocations require review before deletion.");} seenInvoices.add(pair);
      }
      if(op.type === "reconcileInvoice") {
        var paid=0;
        for(var allocation of rows) {
          var payment=await record(M.payments,id(allocation.Supplier_Payment));
          if((payment.Currency || "EUR") !== (current.Currency || "EUR")) {throw new Error("Mixed-currency allocations require review before deletion.");}
          if(["Paid","Reconciled"].includes(payment.Status)) { paid+=money(allocation.Allocated_Amount); }
        }
        paid=money(paid); var values={Amount_Paid:paid};
        if(!["Cancelled","Rejected"].includes(current.Status)) { values.Status=paid>0?(paid>=total(current)?"Paid":"Partially Paid"):"Received"; }
        return values;
      }
      var net=0,suppliers=[],bookings=[],settlements=[];
      for(var allocation of rows) {
        var invoice=await record(M.invoices,id(allocation.Supplier_Invoice));
        if((invoice.Currency || "EUR") !== (current.Currency || "EUR")) {throw new Error("Mixed-currency allocations require review before deletion.");}
        net+=money(allocation.Allocated_Amount)*(invoice.Invoice_Type === "Credit Note" ? -1 : 1);
        suppliers.push(id(invoice.Supplier));bookings.push(id(invoice.Booking));settlements.push(id(invoice.Supplier_Settlement));
      }
      suppliers=unique(suppliers);bookings=unique(bookings);settlements=unique(settlements);
      return {Payment_Amount:Math.abs(money(net)),Movement_Type:net<0?"Supplier Refund":"Outbound Payment",Allocation_Count:rows.length,Supplier_Count:suppliers.length,Booking_Count:bookings.length,Settlement_Count:settlements.length,Context_Mode:suppliers.length<=1&&bookings.length<=1&&settlements.length<=1?"Single":"Mixed",Context_Summary:"Suppliers: "+suppliers.length+" | Bookings: "+bookings.length+" | Settlements: "+settlements.length};
    }
    var busy = false;
    async function execute(invoiceId) {
      if(busy) { throw new Error("Invoice deletion is already running."); }
      busy = true;
      try { var task=function(){return executeSaved(invoiceId);}; return await (global.navigator && global.navigator.locks ? global.navigator.locks.request("accountingManager.invoiceDeletion."+invoiceId,task) : task()); } finally { busy = false; }
    }
    async function executeSaved(invoiceId) {
      invoiceId = String(invoiceId);
      var key = "accountingManager.invoiceDeletion.v1." + invoiceId;
      var saved = storage.getItem(key);
      var job = saved ? JSON.parse(saved) : await prepare(invoiceId);
      if (job.version !== 3 || job.invoiceId !== invoiceId) { throw new Error("This saved deletion uses an older plan. Review its completed steps before continuing; no new changes were made."); }
      storage.setItem(key, JSON.stringify(job));
      if(storage.getItem(key) !== JSON.stringify(job)) { throw new Error("Deletion recovery information could not be stored."); }
      try {
        // Posting can have occurred since the first attempt failed. Never use
        for (var relation of [[M.payAllocations,"Supplier_Invoice"],[M.invoiceSettlementAllocations,"Vendor_Invoice"],[M.invoiceLines,"Supplier_Invoice"],[ns.prepaymentAllocations.module,"Vendor_Invoice"]]) {
          for (var linked of await all(relation[0],relation[1],invoiceId)) {
            if (!job.operations.some(function(op){return op.type === "delete" && op.module === relation[0] && op.id === String(linked.id);})) { throw new Error("Invoice relationships changed during deletion. Review the pending operation."); }
          }
        }
        var guardedPaymentIds = job.guards.filter(function(g){return g.module === M.payments;}).map(function(g){return g.id;});
        var accounting = await all(M.accountingEntries);
        if (accounting.some(function(entry){return id(entry.Supplier_Invoice) === invoiceId || guardedPaymentIds.some(function(pid){var name=String(entry.Name||"");return name === "Supplier_Payment_"+pid || name.endsWith("-PAY-"+pid) || name.indexOf("PAY-MULTI-")===0 && name.endsWith("-"+pid);});}) || (await all(M.accountingEntryLines,"Supplier_Invoice",invoiceId)).length) { throw new Error("Existing accounting links must be reviewed before deleting. Accounting records are preserved."); }
        // Recheck posted/locked records before resuming the plan.
        // a stored plan to bypass the accounting lock on a subsequent attempt.
        for (var guard of job.guards || []) {
          var deleted = job.operations.slice(0, job.cursor).some(function (op) {
            return op.type === "delete" && op.module === guard.module && op.id === guard.id;
          });
          if (!deleted) {
            var live = await crm.getRecord(guard.module, guard.id);
            if (live && live.id) { assertUnlocked(live, guard.module); }
          }
        }
        for (; job.cursor < job.operations.length; job.cursor += 1) {
          var op = job.operations[job.cursor];
          if (op.type === "syncRequest") {
            await ns.syncPrepaymentRequest(crm, op.id);
            storage.setItem(key, JSON.stringify(Object.assign({}, job, { cursor: job.cursor + 1 })));
            continue;
          }
          if(op.type === "rebuildSettlements") {
            // A retry recalculates live balances again, not only the settlement total.
            for(var dependent of job.operations.filter(function(step){return step.type === "reconcileInvoice" || step.type === "reconcilePayment";})) {
              var freshFields=await reconcileFields(dependent);
              var fresh=await crm.updateRecord(dependent.module,dependent.id,freshFields,{trigger:[]});
              var confirmation=helpers.extractRecords(fresh)[0] || fresh || {};
              if(String(confirmation.code || confirmation.status).toLowerCase() !== "success") { throw new Error("Related balances were not confirmed."); }
            }
            if(!op.ids.length) { storage.setItem(key,JSON.stringify(Object.assign({},job,{cursor:job.cursor+1}))); continue; }
            var rebuilt = await crm.executeFunction("rebuildsuppliersettlementtotals", {settlementIdsString:op.ids.join("|||")});
            var output = rebuilt && rebuilt.details && rebuilt.details.output;
            output = typeof output === "string" ? JSON.parse(output) : output;
            if(!output || output.error !== false || Number(output.warning_count || 0) || Number(output.processed_count == null ? output.updated_count : output.processed_count) !== op.ids.length) { throw new Error(output && output.message || "Settlement recalculation was not confirmed."); }
            storage.setItem(key,JSON.stringify(Object.assign({},job,{cursor:job.cursor+1}))); continue;
          }
          if(op.type === "reconcileInvoice" || op.type === "reconcilePayment") { op.fields = await reconcileFields(op); }
          if(op.type === "update" && op.before) {
            var liveTarget=await record(op.module,op.id);assertUnlocked(liveTarget,op.module);
            function comparable(value){return value && typeof value === "object" && value.id ? String(value.id) : value == null ? null : value;}
            Object.keys(op.fields).forEach(function(field){var value=comparable(liveTarget[field]);if(value !== comparable(op.before[field]) && value !== comparable(op.fields[field])) {throw new Error("A related record changed during deletion ("+field+"). Review it before resuming.");}});
          }
          var response = op.type === "delete" ? await crm.deleteRecord(op.module, op.id) : await crm.updateRecord(op.module, op.id, op.fields, { trigger: [] });
          var result = helpers.extractRecords(response)[0] || response || {};
          var status = String(result.code || result.status || "").toLowerCase();
          var alreadyDeleted = status === "already_deleted" || (status === "invalid_data" && /^record (already )?deleted\.?$/i.test(String(result.message || "").trim()));
          if (status !== "success" && !(op.type === "delete" && alreadyDeleted)) {
            throw new Error(op.module + " " + op.id + ": " + (result.message || "CRM did not confirm the change."));
          }
          if (op.module === "Prepayments" && ns.resetPrepaymentCheckpoint) { ns.resetPrepaymentCheckpoint(op.id); }
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
