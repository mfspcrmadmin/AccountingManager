(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {}, busy = new Set();
  function id(value) { return String(value && value.id || ""); }
  function cents(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || Math.abs(n * 100 - Math.round(n * 100)) > .000001) { throw new Error("Review the movement amount; use a positive amount with at most two decimals."); }
    return Math.round(n * 100);
  }
  function output(response) {
    var value = response && response.details && response.details.output;
    return typeof value === "string" ? JSON.parse(value) : value;
  }
  ns.saveCardPayment = async function (deps, purchaseId, input) {
    purchaseId = String(purchaseId);
    if (busy.has(purchaseId)) { throw new Error("This card payment is already being saved."); }
    busy.add(purchaseId);
    var key = "accounting-manager:card-payment:v1:" + purchaseId, api = deps.zoho.CRM.API;
    function persist(job) {
      var raw = JSON.stringify(job); deps.storage.setItem(key, raw);
      if (deps.storage.getItem(key) !== raw) { throw new Error("Payment recovery information could not be stored."); }
    }
    async function get(module, recordId) {
      var response = await api.getRecord({Entity:module, RecordID:String(recordId)});
      var record = response && response.data && response.data[0];
      if (!record || id(record) !== String(recordId)) { throw new Error("The saved " + module + " record is unavailable. Review it before resuming; no replacement was created."); }
      return record;
    }
    async function rows(module, field, value) {
      var all = [], seen = new Set();
      for (var page = 1; page <= 25; page++) {
        var response;
        try {
          response = api.coql ? await api.coql({select_query:"select id from " + module + " where " + field + " = '" + String(value).replace(/'/g, "''") + "' order by id asc limit " + ((page - 1) * 200) + ", 200"}) :
            await api.searchRecord({Entity:module, Type:"criteria", Query:"(" + field + ":equals:" + value + ")", page:page, per_page:200});
        } catch (error) {
          if (Number(error && error.status) !== 204 && (!error || error.code !== "NO_CONTENT")) { throw error; }
          response = {data:[]};
        }
        if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { response = {data:[]}; }
        if (!response || !Array.isArray(response.data)) { throw new Error("Could not read all related " + module + " records."); }
        for (var record of response.data) {
          if (!id(record) || seen.has(id(record))) { throw new Error("Incomplete related records. Review before continuing."); }
          seen.add(id(record)); all.push(await get(module, id(record)));
        }
        if (!(response.info && response.info.more_records) && response.data.length < 200) { return all; }
        if (!response.data.length) { break; }
      }
      throw new Error("Related record limit reached; no partial list was accepted.");
    }
    async function run() {
      if (deps.storage.getItem("accounting-manager-card-invoice-v1-" + purchaseId)) { throw new Error("Finish the pending invoice registration before recording a payment."); }
      var purchase = await get("Card_Purchases", purchaseId), invoiceId = id(purchase.Vendor_Invoice);
      var refund = purchase.Transaction_Type === "Refund", movement = refund ? "Supplier Refund" : "Outbound Payment";
      var amount = cents(purchase.Amount), currency = purchase.Currency || "EUR";
      if (purchase.Locked__s || ["Cancelled","Discarded"].includes(purchase.Accounting_Status) || !invoiceId) { throw new Error("This card movement is closed, locked or has no invoice."); }
      var invoice = await get("Supplier_Invoices", invoiceId);
      if (invoice.Locked__s || invoice.Edit_Status === "Pending" || (invoice.Registration_Key && invoice.Registration_Status !== "Complete") ||
          !["Received","Partially Paid","Paid"].includes(invoice.Status) ||
          (invoice.Invoice_Type === "Credit Note") !== refund || !id(purchase.Supplier) || !id(purchase.Booking) ||
          id(invoice.Supplier) !== id(purchase.Supplier) || id(invoice.Booking) !== id(purchase.Booking) || (invoice.Currency || "EUR") !== currency) {
        throw new Error("The invoice/credit note must match this card movement's supplier, booking, currency and purchase/refund type, and be fully registered.");
      }
      var job = JSON.parse(deps.storage.getItem(key) || "null");
      var split = ns.alhambraCard && await ns.alhambraCard.context(deps.zoho, purchase, deps.storage, deps.commissionInvoiceId || job && job.commissionInvoiceId);
      var expectedAllocations = {}; expectedAllocations[invoiceId] = amount / 100;
      if (split) {
        if (!split.commission || split.commission.Registration_Status !== "Complete") { throw new Error("Create or finish the Iacpos commission invoice before recording this card payment."); }
        expectedAllocations[invoiceId] = split.base / 100;
        expectedAllocations[id(split.commission)] = split.difference / 100;
      }
      if (job && !job.version) {
        // Older journals contain only the immutable creation request.
        if (!job.operation_key || !job.allocations || Object.keys(job.allocations).length !== 1 || cents(job.allocations[invoiceId]) !== amount || (job.Currency || "EUR") !== currency || job.Movement_Type !== movement) {
          throw new Error("The old payment request does not match this movement. Review before resuming.");
        }
        job = {version:2, request:job, invoiceId:invoiceId, amount:amount, currency:currency, movement:movement, supplierId:id(purchase.Supplier), bookingId:id(purchase.Booking)};
        var recovered = await rows("Supplier_Payments", "Invoice_Edit_Key", job.request.operation_key);
        if (recovered.length !== 1) { throw new Error("An older payment request is pending. Verify its outcome in Payments before continuing; no new payment was requested."); }
        job.paymentId = id(recovered[0]); persist(job);
      }
      if (job && (job.version !== 2 || job.invoiceId !== invoiceId || job.amount !== amount || job.currency !== currency || job.movement !== movement ||
          job.supplierId !== id(purchase.Supplier) || job.bookingId !== id(purchase.Booking))) { throw new Error("The card movement changed during registration. Review the pending payment."); }
      if (id(purchase.Vendor_Payment) && (!job || id(purchase.Vendor_Payment) !== job.paymentId)) { throw new Error("This card movement already has a different linked payment."); }
      if (!job && ["Purchase recorded","Refund recorded"].includes(purchase.Accounting_Status)) { throw new Error("This card movement is already recorded."); }
      if (job && !split && job.request && Object.keys(job.request.allocations || {}).length !== 1) { throw new Error("The saved invoice split changed. Review this payment before continuing."); }
      if (job && split && job.request && JSON.stringify(job.request.allocations) !== JSON.stringify(expectedAllocations)) {
        // The older single-invoice request may have been rejected for exceeding
        // its balance. Keep its operation key, but only amend it if no payment
        // exists; an ambiguous or partially saved payment must be reviewed.
        if (job.paymentId || job.complete || Object.keys(job.request.allocations || {}).length !== 1 ||
            cents(job.request.allocations[invoiceId]) !== amount ||
            (await rows("Supplier_Payments", "Invoice_Edit_Key", job.request.operation_key)).length) {
          throw new Error("A saved payment already exists or its split changed. Review it in Payments before continuing.");
        }
        job.request.allocations = expectedAllocations; persist(job);
      }
      if (job && split) { job.commissionInvoiceId = id(split.commission); persist(job); }
      async function verify(paymentId, allocationIds, skipClaimed) {
        var payment = await get("Supplier_Payments", paymentId);
        if (!["Paid","Reconciled"].includes(payment.Status) || payment.Movement_Type !== movement || (payment.Currency || "EUR") !== currency) {
          throw new Error("The payment status, amount, currency or purchase/refund type does not match this card movement.");
        }
        var allocations = await rows("Supplier_Pay_Allocations", "Supplier_Payment", paymentId);
        for (var allocationId of allocationIds || []) {
          if (!allocations.some(function (row) { return id(row) === String(allocationId); })) { allocations.push(await get("Supplier_Pay_Allocations", allocationId)); }
        }
        if (split) {
          var active = allocations.filter(function (row) { return row.Status !== "Cancelled" && row.Status !== "Void"; });
          if (active.length !== 2 || cents(payment.Payment_Amount) !== amount ||
              job && !job.existing && id(payment.Payment_Account) !== job.request.Payment_Account) { throw new Error("The Alhambra payment must match the card total and its two invoice allocations."); }
          for (var expectedId of Object.keys(expectedAllocations)) {
            var matches = active.filter(function (row) { return id(row.Supplier_Invoice) === expectedId; });
            if (matches.length !== 1 || id(matches[0].Supplier_Payment) !== paymentId || (matches[0].Currency || currency) !== currency ||
                cents(matches[0].Allocated_Amount) !== cents(expectedAllocations[expectedId])) { throw new Error("Review the Alhambra and Iacpos payment allocations; the split does not match this charge."); }
          }
          var peers = await rows("Card_Purchases", "Vendor_Payment", paymentId);
          if (peers.some(function (row) { return id(row) !== purchaseId; }) || (await rows("Prepayments", "Vendor_Payment", paymentId)).length) {
            throw new Error("This split payment is already assigned to another operation.");
          }
          return payment;
        }
        var matching = allocations.filter(function (row) { return id(row.Supplier_Invoice) === invoiceId && row.Status !== "Cancelled" && row.Status !== "Void"; });
        if (matching.length !== 1 || id(matching[0].Supplier_Payment) !== paymentId || (matching[0].Currency || currency) !== currency) { throw new Error("The payment does not have one verified allocation to this invoice."); }
        var available = cents(matching[0].Allocated_Amount);
        if (job && !job.existing && (cents(payment.Payment_Amount) !== amount || available !== amount ||
            id(payment.Payment_Account) !== job.request.Payment_Account ||
            allocations.filter(function (row) { return row.Status !== "Void" && row.Status !== "Cancelled"; }).length !== 1)) {
          throw new Error("The created payment amount, account or allocations differ from the saved card request. Review before linking it.");
        }
        for (var peer of await rows("Card_Purchases", "Vendor_Payment", paymentId)) {
          if (id(peer) !== purchaseId && id(peer.Vendor_Invoice) === invoiceId) { available -= cents(peer.Amount); }
        }
        for (var prepayment of await rows("Prepayments", "Vendor_Payment", paymentId)) {
          var links = await rows("Prepayment_Invoice_Allocations", "Prepayment", id(prepayment));
          if (!links.length) { throw new Error("A linked prepayment has no verified invoice allocation. Review this payment."); }
          for (var link of links) { if (id(link.Vendor_Invoice) === invoiceId) { available -= cents(link.Allocated_Amount); } }
        }
        if (skipClaimed && available === 0) { return null; }
        if (available < amount || cents(payment.Payment_Amount) < amount) { throw new Error("This payment is already assigned to other operations or does not cover this card movement."); }
        return payment;
      }
      if (!job) {
        var candidates = [], seenPayments = new Set();
        for (var link of await rows("Supplier_Pay_Allocations", "Supplier_Invoice", invoiceId)) {
          var pid = id(link.Supplier_Payment);
          if (!pid || seenPayments.has(pid)) { throw new Error("Missing or duplicate invoice payment allocations require review."); }
          seenPayments.add(pid);
          var candidate = await get("Supplier_Payments", pid);
          if (["Paid","Reconciled"].includes(candidate.Status)) {
            var availablePayment = await verify(pid, [], true);
            if (availablePayment) { candidates.push(availablePayment); }
          }
        }
        var selected;
        if (candidates.length) {
          // Existing payments need an explicit decision; never assume another charge.
          if (candidates.length !== 1) { throw new Error("This invoice has several recorded payments. Review their links in Payments before registering this card movement."); }
          selected = await verify(id(candidates[0]));
          if (!await deps.confirmExisting(selected, purchase)) { throw new Error("Existing payment was not linked. No new payment was created."); }
          await verify(id(selected));
        }
        job = {version:2, invoiceId:invoiceId, amount:amount, currency:currency, movement:movement, supplierId:id(purchase.Supplier), bookingId:id(purchase.Booking)};
        if (split) { job.commissionInvoiceId = id(split.commission); }
        if (selected) { job.paymentId = id(selected); job.existing = true; job.complete = true; }
        else {
          var account = await get("Payment_Accounts", input.Payment_Account);
          if (!ns.isOwnQuickPaymentAccount(account) || account.Locked__s) { throw new Error("Select an active Own payment account."); }
          if (!String(input.Name || "").trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.Payment_Date || "")) { throw new Error("Enter a payment reference and date."); }
          job.request = Object.assign({}, input, {operation_key:deps.randomUUID(), Currency:currency, Movement_Type:movement, Status:"Paid", Accounting_Status:"Pending", allocations:{}, Payment_Accounts_By_Supplier:{}});
          job.request.allocations = expectedAllocations;
        }
        persist(job);
      }
      if (job.paymentId) {
        var known = await get("Supplier_Payments", job.paymentId);
        if (!job.existing && known.Invoice_Edit_Key !== job.request.operation_key) { throw new Error("The saved payment belongs to another operation."); }
      }
      if (!job.complete) {
        var capability = output(await deps.zoho.CRM.FUNCTIONS.execute("createsupplierpaymentfrominvoices", {arguments:JSON.stringify({supplierInvoiceIds:"capabilities",paymentDataString:"{}"})}));
        if (!capability || capability.consistency_version !== 2) { throw new Error("The payment consistency update must be deployed in CRM."); }
        var result = output(await deps.zoho.CRM.FUNCTIONS.execute("createsupplierpaymentfrominvoices", {arguments:JSON.stringify({supplierInvoiceIds:Object.keys(job.request.allocations).join("|||"),paymentDataString:JSON.stringify(job.request)})}));
        if (result && result.payment_id) {
          if (job.paymentId && job.paymentId !== String(result.payment_id)) { throw new Error("CRM returned a different payment. Review the pending operation."); }
          job.paymentId = String(result.payment_id); job.allocationIds = result.allocation_ids || []; persist(job);
        }
        if (!result || result.error !== false || result.success !== true || !job.paymentId) { throw new Error(result && result.message || "Payment outcome is unconfirmed. Resume the same operation."); }
        job.complete = true; persist(job);
      }
      await verify(job.paymentId, job.allocationIds);
      // Keep recovery until recalculation and the source link both succeed.
      var warning = await ns.refreshQuickInvoiceSettlements(deps.zoho, invoiceId);
      if (warning) { throw new Error(warning + " Resume this payment to finish related updates."); }
      if (split) {
        var currentSplit = await ns.alhambraCard.context(deps.zoho, await get("Card_Purchases", purchaseId), deps.storage, id(split.commission));
        if (!currentSplit || !currentSplit.commission || id(currentSplit.commission) !== id(split.commission) ||
            currentSplit.base !== split.base || currentSplit.total !== split.total || currentSplit.commission.Registration_Status !== "Complete") { throw new Error("The invoice split changed before linking the card payment."); }
        warning = await ns.refreshQuickInvoiceSettlements(deps.zoho, id(split.commission));
        if (warning) { throw new Error(warning + " Resume this payment to finish the Iacpos settlement."); }
      }
      var fresh = await get("Card_Purchases", purchaseId);
      if (fresh.Locked__s || fresh.Accounting_Status === "Cancelled" || id(fresh.Vendor_Invoice) !== invoiceId || cents(fresh.Amount) !== amount ||
          (fresh.Currency || "EUR") !== currency || (fresh.Transaction_Type === "Refund") !== refund || id(fresh.Supplier) !== job.supplierId ||
          id(fresh.Booking) !== job.bookingId || id(fresh.Vendor_Payment) && id(fresh.Vendor_Payment) !== job.paymentId) { throw new Error("The card movement changed before linking the payment. Review before resuming."); }
      var changes = {Vendor_Payment:{id:job.paymentId}, Accounting_Status:refund ? "Refund recorded" : "Purchase recorded", Review_Notes:input.Review_Notes || "", Accounting_Processed_At:new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00")};
      var user = await deps.userEmail(); if (user) { changes.Accounting_Processed_By = user; }
      var response = await api.updateRecord({Entity:"Card_Purchases",APIData:Object.assign({id:purchaseId},changes),Trigger:["workflow"]});
      var updated = response && response.data && response.data[0];
      if (!updated || updated.code !== "SUCCESS" && updated.status !== "success") { throw new Error("Payment saved; the card movement link is still pending. Resume this payment."); }
      var confirmed = await get("Card_Purchases", purchaseId);
      if (id(confirmed.Vendor_Payment) !== job.paymentId || confirmed.Accounting_Status !== changes.Accounting_Status) { throw new Error("The card payment link could not be verified. Resume this payment."); }
      deps.storage.removeItem(key);
      return {paymentId:job.paymentId, changes:changes};
    }
    try { return await (global.navigator && global.navigator.locks ? global.navigator.locks.request(key, run) : run()); }
    finally { busy.delete(purchaseId); }
  };
}(window));
