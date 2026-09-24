(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var INVOICES = "Supplier_Invoices", PAYMENTS = "Supplier_Payments", PREPAYMENTS = "Prepayments";
  function id(record) { return String(record && record.id || ""); }
  function label(record) { return String(record && (record.name || record.Name) || ""); }
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function positive(value) { return Number.isFinite(Number(value)) && Number(value) > 0; }
  function cancelled(record) { return record.Status === "Cancelled" || record.Accounting_Status === "Cancelled"; }
  function currency(record) { return record.Currency || "EUR"; }
  function invoiceAmounts(input) {
    var amount = Number(input.amount), vat = Number(input.vat), irpf = Number(input.irpf || 0);
    var net = Math.round(amount / (1 + vat / 100) * 100) / 100;
    var withholding = Math.round(net * irpf / 100 * 100) / 100;
    return { net: net, irpf: withholding, total: Math.round((amount - withholding) * 100) / 100 };
  }
  function pending(invoice) {
    if (invoice.Unpaid_Invoiced_Amount != null && String(invoice.Unpaid_Invoiced_Amount).trim() !== "") { return Number(invoice.Unpaid_Invoiced_Amount); }
    return Number(invoice.Total_Payable_Amount == null ? invoice.Invoice_Total : invoice.Total_Payable_Amount) - Number(invoice.Amount_Paid || 0);
  }
  function validatePending(invoice, payment) {
    var available = pending(invoice), required = Number(payment.Amount);
    if (!Number.isFinite(available)) { throw new Error("The invoice's pending amount could not be calculated. Check its total payable and amount paid in CRM."); }
    if (available + 0.005 < required) {
      var format = new Intl.NumberFormat("en-GB", { style: "currency", currency: currency(payment) });
      throw new Error("The invoice's pending amount (" + format.format(available) + ") is smaller than this prepayment (" + format.format(required) + "). Amount already paid: " + format.format(Number(invoice.Amount_Paid || 0)) + ". Check the invoice's total payable, IRPF and recorded payments.");
    }
  }
  function success(response) {
    var result = response && response.data && response.data[0];
    if (!result || (result.code !== "SUCCESS" && result.status !== "success")) { throw new Error(result && result.message || response && response.message || "CRM did not confirm the change."); }
    return result;
  }
  ns.createPrepaymentWorkflowService = function (zoho, storage) {
    var api = zoho.CRM.API, schemaPromise, memory = {}, deniedAttachmentRequests = new Set();
    ns.resetPrepaymentCheckpoint = function (recordId) {
      var key = "accounting-manager-prepayment-" + recordId;
      delete memory[key];
      if (storage) { storage.removeItem(key); }
    };
    async function syncRequest(ctx) {
      var requestId = id(ctx.payment.Prepayment_Request);
      if (!requestId) { return ""; }
      try {
        await ns.syncPrepaymentRequest({
          getFields: function (module) { return zoho.CRM.META.getFields({ Entity: module }); },
          getRecord: async function (module, recordId) { var response = await api.getRecord({ Entity: module, RecordID: recordId }); return response && response.data && response.data[0]; },
          coql: async function (query) {
            var response;
            try { response = await api.coql({ select_query: query }); }
            catch (error) { if (Number(error && error.status) === 204 || error && error.code === "NO_CONTENT") { return []; } throw error; }
            if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { return []; }
            if (!response || response.code || !Array.isArray(response.data)) { throw new Error("Could not read related prepayments or services."); }
            return response.data;
          },
          updateRecord: function (module, recordId, data) { return api.updateRecord({ Entity: module, APIData: Object.assign({ id: recordId }, data), Trigger: [] }); }
        }, requestId);
        return "";
      } catch (error) { return "Payment recorded, but request/services status could not be synchronized: " + error.message; }
    }
    function hasFiles(value) { return Array.isArray(value) ? value.length > 0 : Boolean(value); }
    function attachmentPermissionDenied(error) {
      if (!error) { return false; }
      if (error.code === "NO_PERMISSION" || Number(error.status) === 403 || Number(error.statusCode) === 403) { return true; }
      if (typeof error.responseText === "string") {
        try { return attachmentPermissionDenied(JSON.parse(error.responseText)); } catch (ignored) { return false; }
      }
      return false;
    }
    async function schema() {
      if (!schemaPromise) {
        schemaPromise = zoho.CRM.META.getFields({ Entity: PREPAYMENTS }).then(function (response) {
          var fields = response && response.fields || [];
          function lookup(module, preferred) {
            var field = fields.find(function (f) { return f.api_name === preferred && f.data_type === "lookup"; }) || fields.find(function (f) { return f.lookup && f.lookup.module && f.lookup.module.api_name === module; });
            if (!field) { throw new Error("Prepayments needs a lookup to " + module + " before records can be registered."); }
            return field.api_name;
          }
          return { payment: lookup(PAYMENTS, "Vendor_Payment") };
        }).catch(function (error) { schemaPromise = null; throw error; });
      }
      return schemaPromise;
    }
    async function get(module, recordId) {
      var response = await api.getRecord({ Entity: module, RecordID: recordId });
      var record = response && response.data && response.data[0];
      if (!record || id(record) !== String(recordId)) { throw new Error("Could not read the linked " + module + " record."); }
      return record;
    }
    async function search(module, criteria) {
      var result = [], page = 1;
      while (true) {
        var response;
        try { response = await api.searchRecord({ Entity: module, Type: "criteria", Query: criteria, page: page, per_page: 200 }); }
        catch (error) { if (Number(error && error.status) === 204 || error && error.code === "NO_CONTENT") { return result; } throw error; }
        if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { return result; }
        if (!response || !Array.isArray(response.data)) { throw new Error("Could not search " + module + "."); }
        if (response.data.some(function (record) { return result.some(function (previous) { return id(previous) === id(record); }); })) { throw new Error("CRM returned repeated search results."); }
        result = result.concat(response.data);
        if (!(response.info && response.info.more_records)) { return result; }
        if (!response.data.length) { throw new Error("CRM returned incomplete search results."); }
        page += 1;
      }
    }
    function checkpoint(recordId, value) {
      var key = "accounting-manager-prepayment-" + recordId;
      if (value) { memory[key] = value; if (storage) { storage.setItem(key, JSON.stringify(value)); } return value; }
      return memory[key] || (storage && JSON.parse(storage.getItem(key) || "null")) || {};
    }
    ns.assertPrepaymentDeletionCheckpoint = function (recordId) {
      var journal = checkpoint(recordId);
      if (journal.invoiceId || journal.paymentId || journal.invoiceAttempt || journal.paymentAttempt || journal.invoiceAllocationAttempt || (journal.invoiceAllocationIds || []).length) {
        throw new Error("Review the pending invoice/payment operation before deleting this prepayment.");
      }
    };
    async function update(recordId, data) {
      success(await api.updateRecord({ Entity: PREPAYMENTS, APIData: Object.assign({ id: recordId }, data), Trigger: ["workflow"] }));
    }
    async function create(module, data) {
      var result = success(await api.insertRecord({ Entity: module, APIData: [data], Trigger: ["workflow"] }));
      if (!result.details || !result.details.id) { throw new Error("CRM did not return the new record ID."); }
      return String(result.details.id);
    }
    async function finishWithSettlementRefresh(recordId, invoiceId) {
      var warning = await ns.refreshQuickInvoiceSettlements(zoho, invoiceId);
      var ctx = await context(recordId);
      ctx.settlementWarning = warning;
      return ctx;
    }
    async function context(recordId) {
      var fields = await schema(), payment = await get(PREPAYMENTS, recordId);
      var requestId = id(payment.Prepayment_Request);
      var request = requestId ? await get("Prepayment_Requests", requestId) : {};
      if (requestId && api.getRelatedRecords && !hasFiles(request.Proforma_Attached) && !hasFiles(request.Invoice_Attached) && !deniedAttachmentRequests.has(requestId)) {
        request._attachments = [];
        try {
          var page = 1, seen = new Set();
          while (true) {
            var attachments = await api.getRelatedRecords({ Entity: "Prepayment_Requests", RecordID: requestId, RelatedList: "Attachments", page: page, per_page: 200 });
            if (attachments && (Number(attachments.status) === 204 || attachments.code === "NO_CONTENT")) { break; }
            if (attachmentPermissionDenied(attachments)) { throw attachments; }
            if (!attachments || !Array.isArray(attachments.data)) { throw new Error("CRM did not return the request attachments."); }
            attachments.data.forEach(function (file) {
              if (seen.has(id(file))) { throw new Error("CRM returned repeated attachments."); }
              seen.add(id(file)); request._attachments.push(file);
            });
            if (!(attachments.info && attachments.info.more_records)) { break; }
            if (!attachments.data.length) { throw new Error("CRM returned incomplete attachments."); }
            page += 1;
          }
        } catch (error) {
          if (attachmentPermissionDenied(error)) { deniedAttachmentRequests.add(requestId); }
          else if (!(Number(error && error.status) === 204 || error && error.code === "NO_CONTENT")) { request._documentError = "The request attachments could not be loaded."; }
        }
      }
      var rows = await search(ns.prepaymentAllocations.module, "(Prepayment:equals:" + recordId + ")");
      var known = checkpoint(recordId).invoiceAllocationIds || [];
      for (var allocationId of known) {
        if (!rows.some(function (row) { return id(row) === allocationId; })) { rows.push(await get(ns.prepaymentAllocations.module, allocationId)); }
      }
      var allocationSummary = ns.prepaymentAllocations.summarize(payment, rows);
      return { payment: payment, request: request, fields: fields, allocations: allocationSummary };
    }
    function validateContext(ctx) {
      if (ns.prepaymentsModel.isClosed(ctx.payment) || id(ctx.payment[ctx.fields.payment])) { throw new Error("This prepayment is already recorded, discarded or cancelled. Refresh to view its details."); }
      if (!id(ctx.request.Supplier) || !id(ctx.request.Booking)) { throw new Error("The request needs a supplier and booking before registration."); }
      if (!positive(ctx.payment.Amount)) { throw new Error("The prepayment needs a positive amount."); }
    }
    function validateInvoice(invoice, ctx) {
      if (id(invoice.Supplier) !== id(ctx.request.Supplier) || id(invoice.Booking) !== id(ctx.request.Booking)) { throw new Error("The invoice must belong to this request's supplier and booking."); }
      if (currency(invoice) !== currency(ctx.payment)) { throw new Error("The invoice and prepayment must use the same currency."); }
      if (cancelled(invoice) || invoice.Status === "Rejected" || invoice.Invoice_Type === "Credit Note") { throw new Error("This invoice cannot receive an outbound prepayment."); }
      if (!id(invoice.Supplier_Settlement)) { throw new Error("The invoice needs a supplier settlement."); }
    }
    async function options(ctx) {
      var supplierId = id(ctx.request.Supplier), bookingId = id(ctx.request.Booking);
      if (!supplierId || !bookingId) { throw new Error("The request needs a supplier and booking before registration."); }
      if (ctx.allocations.complete) {
        var existingPayments = await invoicePayments(ctx);
        var accountChoices = existingPayments.length ? { accounts: [], defaultAccountId: "" } : await ns.loadOwnPaymentAccountChoices(api);
        return Object.assign({ settlements: [], invoices: [], existingPayments: existingPayments }, accountChoices);
      }
      var criteria = "((Supplier:equals:" + supplierId + ")and(Booking:equals:" + bookingId + "))";
      var results = await Promise.all([
        search("Supplier_Settlements", criteria), search(INVOICES, criteria),
        ns.loadOwnPaymentAccountChoices(api)
      ]);
      return {
        settlements: results[0].filter(function (r) { return !cancelled(r) && currency(r) === currency(ctx.payment); }),
        invoices: results[1].filter(function (r) { return !cancelled(r) && r.Status !== "Rejected" && r.Invoice_Type !== "Credit Note" && currency(r) === currency(ctx.payment); }),
        accounts: results[2].accounts, defaultAccountId: results[2].defaultAccountId
      };
    }
    async function invoicePayments(ctx) {
      var allocations = [];
      for (var row of ctx.allocations.rows) {
        var invoiceId = id(row.Vendor_Invoice);
        validateInvoice(await get(INVOICES, invoiceId), ctx);
        allocations = allocations.concat(await search("Supplier_Pay_Allocations", "(Supplier_Invoice:equals:" + invoiceId + ")"));
      }
      var journal = checkpoint(id(ctx.payment));
      if (journal.paymentId && journal.allocationIds && journal.allocationIds.length) {
        var created = await Promise.all(journal.allocationIds.map(function (allocationId) { return get("Supplier_Pay_Allocations", allocationId); }));
        var byId = new Map(allocations.map(function (allocation) { return [id(allocation), allocation]; }));
        created.forEach(function (allocation) {
          if (id(allocation.Supplier_Payment) !== String(journal.paymentId)) { throw new Error("The saved allocation does not belong to the created payment. Review its link in CRM."); }
          byId.set(id(allocation), allocation);
        });
        allocations = Array.from(byId.values());
      }
      var byPayment = {};
      allocations.forEach(function (allocation) {
        var paymentId = id(allocation.Supplier_Payment);
        if (paymentId && ctx.allocations.rows.some(function (row) { return id(row.Vendor_Invoice) === id(allocation.Supplier_Invoice); }) && !cancelled(allocation) && positive(allocation.Allocated_Amount)) {
          byPayment[paymentId] = (byPayment[paymentId] || 0) + Number(allocation.Allocated_Amount);
        }
      });
      var payments = await Promise.all(Object.keys(byPayment).map(async function (paymentId) {
        var payment = await get(PAYMENTS, paymentId);
        return { payment: payment, allocated: byPayment[paymentId] };
      }));
      var availablePayments = [];
      for (var item of payments) {
        if (cancelled(item.payment) || !ns.prepaymentAllocations.covered(ctx.allocations, allocations, id(item.payment))) { continue; }
        var balances = {};
        allocations.filter(function (a) { return id(a.Supplier_Payment) === id(item.payment) && !cancelled(a) && a.Status !== "Void"; }).forEach(function (a) { balances[id(a.Supplier_Invoice)] = (balances[id(a.Supplier_Invoice)] || 0) + Number(a.Allocated_Amount); });
        var peers = await search(PREPAYMENTS, "(" + ctx.fields.payment + ":equals:" + id(item.payment) + ")");
        for (var peer of peers) {
          if (id(peer) === id(ctx.payment)) { continue; }
          var peerRows = await search(ns.prepaymentAllocations.module, "(Prepayment:equals:" + id(peer) + ")");
          var peerSummary = ns.prepaymentAllocations.summarize(peer, peerRows);
          if (!peerSummary.complete) { throw new Error("Another prepayment linked to this payment has incomplete invoice allocations. Review it in CRM."); }
          peerRows.forEach(function (row) { var key = id(row.Vendor_Invoice); balances[key] = Number(balances[key] || 0) - Number(row.Allocated_Amount); });
        }
        if (ctx.allocations.rows.every(function (row) { return balances[id(row.Vendor_Invoice)] + 0.005 >= Number(row.Allocated_Amount); })) { availablePayments.push(item); }
      }
      return availablePayments;
    }
    async function linkPayment(recordId, paymentId) {
      var ctx = await context(recordId);
      validateContext(ctx);
      if (!ctx.allocations.complete) { throw new Error("Allocate the full prepayment to invoices first."); }
      var payments = await invoicePayments(ctx);
      var selected = payments.find(function (item) { return id(item.payment) === String(paymentId); });
      if (!selected) { throw new Error("This payment is no longer associated with the invoice. Refresh the prepayment."); }
      var payment = selected.payment;
      if (["Paid", "Reconciled"].indexOf(payment.Status) === -1 || currency(payment) !== currency(ctx.payment) || !positive(payment.Payment_Amount) || selected.allocated + 0.005 < Number(ctx.payment.Amount) || Number(payment.Payment_Amount) + 0.005 < Number(ctx.payment.Amount)) {
        throw new Error("The associated payment must be paid or reconciled, use the prepayment currency and cover its amount on this invoice.");
      }
      var data = { Accounting_Status: "Prepayment recorded" };
      data[ctx.fields.payment] = { id: id(payment) };
      if (payment.Payment_Date) { data.Payment_Date = payment.Payment_Date; }
      var settlementWarning = await refreshInvoices(ctx);
      await update(recordId, data);
      var requestWarning = await syncRequest(ctx);
      ctx = await context(recordId); ctx.settlementWarning = [settlementWarning, requestWarning].filter(Boolean).join(" "); return ctx;
    }
    async function ensureSettlement(invoice) {
      var invoiceId = id(invoice), settlementId = id(invoice.Supplier_Settlement);
      var allocations = await search("Inv_Set_Allocations", "(Vendor_Invoice:equals:" + invoiceId + ")");
      if (allocations.some(function (r) { return id(r.Vendor_Settlement) === settlementId && r.Status === "Active"; })) { return; }
      await create("Inv_Set_Allocations", { Name: invoiceId + "-" + settlementId, Vendor_Invoice: { id: invoiceId }, Vendor_Settlement: { id: settlementId }, Allocated_Amount: Number(invoice.Total_Payable_Amount), Allocation_Date: invoice.Invoice_Date, Status: "Active", Allocation_Source: "Manual" });
    }
    async function assertAllocationSchema() {
      var response = await zoho.CRM.META.getFields({ Entity: ns.prepaymentAllocations.module });
      var fields = response && response.fields || [], name = fields.find(function (f) { return f.api_name === "Name"; });
      if (!name || !name.unique || !Object.keys(name.unique).length) { throw new Error("Configure Name to disallow duplicates in Prepayment Invoice Allocations before registering invoices."); }
    }
    async function saveInvoice(recordId, input, confirmSelfEmployment) {
      var ctx = await context(recordId), journal = checkpoint(recordId), invoice, invoiceId;
      validateContext(ctx);
      if (journal.paymentAttempt || journal.paymentId) { throw new Error("A payment is in progress. Verify it before changing invoice allocations."); }
      if (ctx.allocations.complete && !input.existingInvoiceId && !journal.invoiceId) { ctx.settlementWarning = await refreshInvoices(ctx); return ctx; }
      var applied = Number(input.allocatedAmount == null ? ctx.allocations.remaining : input.allocatedAmount);
      var existingRow = ctx.allocations.rows.find(function (row) { return id(row.Vendor_Invoice) === String(input.existingInvoiceId || journal.invoiceId || ""); });
      if (existingRow) { applied = input.allocatedAmount == null ? Number(existingRow.Allocated_Amount) : applied; }
      if (!positive(applied) || (!existingRow && Math.round(applied * 100) > Math.round(ctx.allocations.remaining * 100))) { throw new Error("Enter a positive allocated amount within the remaining prepayment amount."); }
      if (journal.invoiceId && input.existingInvoiceId && journal.invoiceId !== input.existingInvoiceId) { throw new Error("Finish linking the previously created invoice before selecting another invoice."); }
      await assertAllocationSchema();
      invoiceId = journal.invoiceId || input.existingInvoiceId;
      if (!invoiceId) {
        if (journal.invoiceAttempt) { throw new Error("The previous invoice request was not confirmed. Check CRM and select the existing invoice before trying again."); }
        if (ctx.payment.Accounting_Status === "Pending payment record") { throw new Error("Select the existing invoice for this prepayment."); }
        if (!input.reference.trim() || !input.date || !positive(input.amount) || !Number.isFinite(Number(input.vat)) || Number(input.vat) < 0) { throw new Error("Enter an invoice number, date, positive amount and valid VAT percentage."); }
        var invoiceType = input.invoiceType || "Proforma", irpf = Number(input.irpf || 0), amounts = invoiceAmounts(input);
        if (["Proforma", "Final Invoice", "Tickets", "Commission"].indexOf(invoiceType) === -1) { throw new Error("Select a valid invoice type for an outbound prepayment."); }
        if (!Number.isFinite(irpf) || irpf < 0 || !positive(amounts.total)) { throw new Error("Enter a valid IRPF percentage and positive total payable."); }
        if (amounts.total + 0.005 < applied) { throw new Error("The invoice total payable after IRPF cannot be smaller than this prepayment."); }
        var settlement = await get("Supplier_Settlements", input.settlementId);
        if (id(settlement.Supplier) !== id(ctx.request.Supplier) || id(settlement.Booking) !== id(ctx.request.Booking) || currency(settlement) !== currency(ctx.payment) || cancelled(settlement)) { throw new Error("Select a settlement for this supplier, booking and currency."); }
        var duplicates = await search(INVOICES, "(Supplier:equals:" + id(ctx.request.Supplier) + ")");
        if (duplicates.some(function (r) { return String(r.Name || "").trim().toLowerCase() === input.reference.trim().toLowerCase(); })) { throw new Error("An invoice with that number already exists for this supplier. Select the existing invoice."); }
        if (irpf > 0) {
          var supplier = await get("Vendors", id(ctx.request.Supplier));
          var candidates = ns.FIELD_CANDIDATES && ns.FIELD_CANDIDATES.supplier.selfEmployed || ["Is_Self_Employed", "Is Self Employed", "Self_Employed", "Self Employed", "Autonomo", "Es_Autonomo"];
          var selfEmployedField = candidates.find(function (key) { return supplier[key] != null; }) || "Is_Self_Employed";
          if (["true", "yes", "y", "1", "si"].indexOf(String(supplier[selfEmployedField] || "").trim().toLowerCase()) === -1) {
            if (!confirmSelfEmployment || !await confirmSelfEmployment()) {
              var resetError = new Error("IRPF can only be used when the supplier is marked as self-employed. IRPF was reset to 0; review the total before saving again.");
              resetError.code = "IRPF_RESET";
              throw resetError;
            }
            var supplierUpdate = { id: id(supplier) }; supplierUpdate[selfEmployedField] = true;
            success(await api.updateRecord({ Entity: "Vendors", APIData: supplierUpdate, Trigger: ["workflow"] }));
          }
        }
        var amount = Number(input.amount), vat = Number(input.vat), net = amounts.net;
        checkpoint(recordId, Object.assign(journal, { invoiceAttempt: true }));
        invoiceId = await create(INVOICES, {
          Name: input.reference.trim(), Supplier: { id: id(ctx.request.Supplier) }, Supplier_Name: label(ctx.request.Supplier), Supplier_Code: ctx.request.Supplier_Code || "",
          Booking: { id: id(ctx.request.Booking) }, Supplier_Settlement: { id: input.settlementId }, Currency: currency(ctx.payment),
          Invoice_Date: input.date, Invoice_Amount_Excl_VAT: net, Invoice_Amount_Incl_VAT: amount,
          VAT_percentage: vat, VAT_Amount: Math.round((amount - net) * 100) / 100, IRPF_percentage: irpf, IRPF_Amount: amounts.irpf, Invoice_Total: amounts.total,
          Total_Payable_Amount: amounts.total, Amount_Paid: 0, Status: "Received", Accounting_Status: "Pending", Invoice_Type: invoiceType
        });
        checkpoint(recordId, Object.assign(journal, { invoiceId: invoiceId }));
      }
      invoice = await get(INVOICES, invoiceId);
      validateInvoice(invoice, ctx);
      var invoiceTotal = Number(invoice.Total_Payable_Amount);
      if (invoice.Total_Payable_Amount == null || String(invoice.Total_Payable_Amount).trim() === "" || !Number.isFinite(invoiceTotal)) { throw new Error("The invoice needs a valid Total Payable Amount before linking this prepayment."); }
      if (invoiceTotal + 0.005 < applied) { throw new Error("The invoice's Total Payable Amount (" + invoiceTotal.toFixed(2) + " " + currency(invoice) + ") is smaller than this prepayment (" + Number(ctx.payment.Amount).toFixed(2) + " " + currency(ctx.payment) + ")."); }
      if (journal.invoiceId === invoiceId) { await ensureSettlement(invoice); }
      if (existingRow) {
        if (Math.round(Number(existingRow.Allocated_Amount) * 100) !== Math.round(applied * 100)) { throw new Error("This invoice is already allocated with a different amount. Remove its association first."); }
      } else {
        if (journal.invoiceAllocationAttempt && !journal.invoiceAllocationId) { throw new Error("The previous allocation was not confirmed. Review CRM before retrying."); }
        if (!journal.invoiceAllocationId) {
          checkpoint(recordId, Object.assign(journal, { invoiceId: invoiceId, invoiceAllocationAttempt: true }));
          var allocationId = await create(ns.prepaymentAllocations.module, { Name: recordId + "-" + invoiceId, Prepayment: { id: recordId }, Vendor_Invoice: { id: invoiceId }, Allocated_Amount: applied, Currency: currency(ctx.payment) });
          checkpoint(recordId, Object.assign(journal, { invoiceAllocationId: allocationId, invoiceAllocationIds: (journal.invoiceAllocationIds || []).concat(allocationId) }));
        }
        var saved = await get(ns.prepaymentAllocations.module, journal.invoiceAllocationId);
        if (id(saved.Prepayment) !== String(recordId) || id(saved.Vendor_Invoice) !== invoiceId || Math.round(Number(saved.Allocated_Amount) * 100) !== Math.round(applied * 100) || saved.Currency !== currency(ctx.payment)) { throw new Error("CRM did not confirm the invoice allocation. Review it before retrying."); }
      }
      ctx = await context(recordId);
      await update(recordId, { Accounting_Status: ctx.allocations.complete ? "Pending payment record" : "Pending invoice" });
      delete journal.invoiceId; delete journal.invoiceAttempt; delete journal.invoiceAllocationId; delete journal.invoiceAllocationAttempt;
      checkpoint(recordId, journal);
      return finishWithSettlementRefresh(recordId, invoiceId);
    }
    async function refreshInvoices(ctx) {
      var warnings = [];
      for (var row of ctx.allocations.rows) { warnings.push(await ns.refreshQuickInvoiceSettlements(zoho, id(row.Vendor_Invoice))); }
      return warnings.filter(Boolean).join(" ");
    }
    async function removeInvoice(recordId, allocationId) {
      var ctx = await context(recordId), journal = checkpoint(recordId);
      validateContext(ctx);
      if (journal.paymentAttempt || journal.paymentId || journal.invoiceAttempt || journal.invoiceAllocationAttempt) { throw new Error("Finish or review the pending operation before removing an invoice association."); }
      var row = ctx.allocations.rows.find(function (item) { return id(item) === String(allocationId); });
      if (!row) { throw new Error("Invoice association no longer exists. Refresh the prepayment."); }
      success(await api.deleteRecord({ Entity: ns.prepaymentAllocations.module, RecordID: allocationId }));
      journal.invoiceAllocationIds = (journal.invoiceAllocationIds || []).filter(function (value) { return value !== String(allocationId); });
      checkpoint(recordId, journal);
      await update(recordId, { Accounting_Status: "Pending invoice" });
      return context(recordId);
    }
    async function savePayment(recordId, input) {
      var ctx = await context(recordId), journal = checkpoint(recordId);
      validateContext(ctx);
      if (!ctx.allocations.complete) { throw new Error("Allocate the full prepayment to invoices first."); }
      var invoices = [];
      for (var row of ctx.allocations.rows) {
        var invoice = await get(INVOICES, id(row.Vendor_Invoice));
        validateInvoice(invoice, ctx); invoices.push(invoice);
      }
      var paymentId = journal.paymentId;
      if (!paymentId) {
        if ((await invoicePayments(ctx)).length) {
          var existingError = new Error("This invoice already has an associated payment. Confirm its link to the prepayment.");
          existingError.code = "EXISTING_PAYMENT_AVAILABLE";
          throw existingError;
        }
        if (journal.paymentAttempt) { throw new Error("The previous payment request was not confirmed. Check CRM before recording another payment."); }
        ctx.allocations.rows.forEach(function (row, index) { validatePending(invoices[index], { Amount: row.Allocated_Amount, Currency: currency(ctx.payment) }); });
        var accountId = input.accountId;
        if (!accountId) { throw new Error("Select an Own payment account before creating the payment."); }
        var account = await get("Payment_Accounts", accountId);
        if (!ns.isOwnQuickPaymentAccount(account)) { throw new Error("Select an active Own payment account as the payment source."); }
        var allocations = {}, supplierAccounts = {};
        ctx.allocations.rows.forEach(function (row) { allocations[id(row.Vendor_Invoice)] = Number(row.Allocated_Amount); });
        var paymentData = { Name: "PREPAY-" + recordId, Currency: currency(ctx.payment), Payment_Account: accountId, Status: "Paid", Accounting_Status: "Pending", Movement_Type: "Outbound Payment", allocations: allocations, Payment_Accounts_By_Supplier: supplierAccounts };
        checkpoint(recordId, Object.assign(journal, { paymentAttempt: true }));
        var response = await zoho.CRM.FUNCTIONS.execute("createsupplierpaymentfrominvoices", { arguments: JSON.stringify({ supplierInvoiceIds: invoices.map(id).join("|||"), paymentDataString: JSON.stringify(paymentData) }) });
        var result = response && response.details && response.details.output;
        result = typeof result === "string" ? JSON.parse(result) : result;
        if (result && result.payment_id) {
          checkpoint(recordId, Object.assign(journal, { paymentId: String(result.payment_id), allocationIds: Array.isArray(result.allocation_ids) ? Array.from(new Set(result.allocation_ids.map(String).filter(Boolean))) : [] }));
        }
        if (!result || result.error || result.success === false || !result.payment_id) { throw new Error(result && result.message || "CRM did not confirm the payment. Check CRM before retrying."); }
        paymentId = String(result.payment_id);
        checkpoint(recordId, Object.assign(journal, { paymentId: paymentId }));
      }
      // The invoice is already paid, even if verification or the prepayment link fails below.
      var settlementWarning = await refreshInvoices(ctx);
      var savedPayment = await get(PAYMENTS, paymentId);
      var savedAllocations;
      try {
        // Newly created records may not be indexed by Search yet. Read the returned IDs directly.
        savedAllocations = journal.allocationIds && journal.allocationIds.length ?
          await Promise.all(journal.allocationIds.map(function (allocationId) { return get("Supplier_Pay_Allocations", allocationId); })) :
          await search("Supplier_Pay_Allocations", "(Supplier_Payment:equals:" + paymentId + ")");
      } catch (error) {
        throw new Error("Payment " + paymentId + " was created, but its invoice allocation needs review: " + error.message + " No additional payment will be created. Reopen this prepayment to retry verification.");
      }
      var issues = [], expected = Number(ctx.payment.Amount);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(savedPayment.Payment_Date || ""))) { issues.push("CRM did not return the saved payment date"); }
      if (currency(savedPayment) !== currency(ctx.payment)) { issues.push("payment currency is " + currency(savedPayment) + "; prepayment currency is " + currency(ctx.payment)); }
      if (["Paid", "Reconciled"].indexOf(savedPayment.Status) === -1) { issues.push("payment status is " + (savedPayment.Status || "missing") + "; expected Paid or Reconciled"); }
      if (!positive(savedPayment.Payment_Amount) || Math.abs(Number(savedPayment.Payment_Amount) - expected) > 0.005) { issues.push("payment amount is " + savedPayment.Payment_Amount + "; prepayment amount is " + expected); }
      if (!ns.prepaymentAllocations.covered(ctx.allocations, savedAllocations, paymentId)) { issues.push("no matching allocation found covering every invoice in the prepayment"); }
      if (savedAllocations.some(function (row) { return id(row.Supplier_Payment) !== paymentId || !positive(row.Allocated_Amount) || !ctx.allocations.rows.some(function (link) { return id(link.Vendor_Invoice) === id(row.Supplier_Invoice); }); })) { issues.push("payment contains an invalid or unrelated invoice allocation"); }
      var actualTotal = savedAllocations.filter(function (row) { return id(row.Supplier_Payment) === paymentId && !cancelled(row) && row.Status !== "Void"; }).reduce(function (sum, row) { return sum + Number(row.Allocated_Amount); }, 0);
      if (!Number.isFinite(actualTotal) || Math.abs(actualTotal - expected) > 0.005) { issues.push("total allocated is " + actualTotal + "; expected " + expected); }
      if (issues.length) {
        throw new Error("Payment " + paymentId + " was created, but needs review: " + issues.join(". ") + ". No additional payment will be created.");
      }
      var data = { Accounting_Status: "Prepayment recorded", Payment_Date: savedPayment.Payment_Date };
      data[ctx.fields.payment] = { id: paymentId };
      try { await update(recordId, data); }
      catch (error) {
        var linkError = new Error("Payment " + paymentId + " is recorded, but could not be linked to this prepayment: " + error.message + " Confirm the existing payment to retry the link.");
        linkError.code = "PAYMENT_LINK_PENDING";
        throw linkError;
      }
      var requestWarning = await syncRequest(ctx);
      ctx = await context(recordId); ctx.settlementWarning = [settlementWarning, requestWarning].filter(Boolean).join(" "); return ctx;
    }
    async function relatedServices(ctx) {
      if (!id(ctx.request)) { throw new Error("This prepayment has no request to resolve its services."); }
      var links = await search("Prepayment_Request_Services", '(Prepayment_Request:equals:' + id(ctx.request) + ')');
      var serviceIds = new Set();
      links.forEach(function (link) {
        if (id(link.Prepayment_Request) !== id(ctx.request) || !id(link.Booking_Service)) { throw new Error("An invalid request/service association needs review in CRM."); }
        serviceIds.add(id(link.Booking_Service));
      });
      var records = await Promise.all(Array.from(serviceIds).map(function (serviceId) { return get("Booking_Services", serviceId); }));
      records.sort(function (a, b) { return String(a.Service_Date || '9999').localeCompare(String(b.Service_Date || '9999')) || id(a).localeCompare(id(b)); });
      return { records: records, description: "Services linked to this prepayment request" };
    }
    async function associatedSettlement(ctx, selectedSettlementId, selectedInvoiceId) {
      var invoiceId = selectedInvoiceId || (ctx.allocations.rows.length === 1 ? id(ctx.allocations.rows[0].Vendor_Invoice) : "");
      var settlementId = selectedSettlementId;
      if (invoiceId) {
        var invoice = await get(INVOICES, invoiceId);
        settlementId = id(invoice.Supplier_Settlement);
      }
      if (!settlementId) { return null; }
      var settlement = await get("Supplier_Settlements", settlementId);
      if (id(settlement.Supplier) !== id(ctx.request.Supplier) || id(settlement.Booking) !== id(ctx.request.Booking)) { throw new Error("The settlement does not belong to this request's supplier and booking."); }
      return settlement;
    }
    async function associatedSettlements(ctx, selectedSettlementId, selectedInvoiceId) {
      if (selectedInvoiceId || selectedSettlementId || !ctx.allocations.rows.length) {
        var selected = await associatedSettlement(ctx, selectedSettlementId, selectedInvoiceId);
        return selected ? [selected] : [];
      }
      var records = [], seen = new Set();
      for (var row of ctx.allocations.rows) {
        var settlement = await associatedSettlement(ctx, "", id(row.Vendor_Invoice));
        if (settlement && !seen.has(id(settlement))) { seen.add(id(settlement)); records.push(settlement); }
      }
      return records;
    }
    async function serviceSelection(ctx) {
      var request = await get("Prepayment_Requests", id(ctx.request));
      if (!id(request.Supplier) || !id(request.Booking)) { throw new Error("The request needs a supplier and booking."); }
      var links = await search("Prepayment_Request_Services", "(Prepayment_Request:equals:" + id(request) + ")");
      var records = await search("Booking_Services", "((Supplier:equals:" + id(request.Supplier) + ")and(Booking:equals:" + id(request.Booking) + "))");
      if (records.some(function (r) { return id(r.Supplier) !== id(request.Supplier) || id(r.Booking) !== id(request.Booking); }) || links.some(function (l) { return id(l.Prepayment_Request) !== id(request) || !id(l.Booking_Service); })) { throw new Error("Invalid service associations returned by CRM."); }
      var known = new Set(records.map(id));
      for (var link of links) {
        if (!known.has(id(link.Booking_Service))) { throw new Error("An associated service no longer belongs to this supplier and booking. Review it in CRM before editing."); }
      }
      records.sort(function (a, b) { return String(a.Service_Date || "9999").localeCompare(String(b.Service_Date || "9999")) || id(a).localeCompare(id(b)); });
      return { records: records, links: links, selected: Array.from(new Set(links.map(function (l) { return id(l.Booking_Service); }))) };
    }
    async function saveServiceSelection(recordId, selectedIds) {
      var ctx = await context(recordId);
      validateContext(ctx);
      if (ctx.allocations.rows.length) { throw new Error("An invoice is already linked. Reopen the prepayment to continue."); }
      var selected = new Set(selectedIds.map(String));
      if (!selected.size) { throw new Error("Keep at least one service associated with this request."); }
      var current = await serviceSelection(ctx), allowed = new Set(current.records.map(id));
      if (Array.from(selected).some(function (value) { return !allowed.has(value); })) { throw new Error("Select services from this request's supplier and booking only."); }
      var retainedLinks = current.links.filter(function (link) { return selected.has(id(link.Booking_Service)); });
      // Confirm additions before removing anything, including when retrying a partial save.
      for (var serviceId of selected) {
        if (current.selected.indexOf(serviceId) !== -1) { continue; }
        var key = "prepayment-service-link-" + id(ctx.request) + "-" + serviceId;
        var attempt = memory[key] || (storage && JSON.parse(storage.getItem(key) || "null"));
        if (attempt && !attempt.id) { throw new Error("A previous association could not be confirmed. Refresh and retry once CRM has indexed it."); }
        if (!attempt) {
          attempt = {}; memory[key] = attempt;
          if (storage) { storage.setItem(key, JSON.stringify(attempt)); }
          var response = await api.insertRecord({ Entity: "Prepayment_Request_Services", APIData: { Name: id(ctx.request) + "-" + serviceId, Prepayment_Request: { id: id(ctx.request) }, Booking_Service: { id: serviceId } }, Trigger: ["workflow"] });
          var outcome = response && response.data && response.data[0];
          if (outcome && outcome.code && outcome.code !== "SUCCESS" && outcome.status !== "success") {
            delete memory[key];
            if (storage && storage.removeItem) { storage.removeItem(key); }
          }
          var created = success(response);
          if (!created.details || !created.details.id) { throw new Error("CRM did not return the association ID. Refresh before retrying."); }
          attempt.id = String(created.details.id);
          if (storage) { storage.setItem(key, JSON.stringify(attempt)); }
        }
        var saved = await get("Prepayment_Request_Services", attempt.id);
        if (id(saved.Prepayment_Request) !== id(ctx.request) || id(saved.Booking_Service) !== serviceId) { throw new Error("CRM did not confirm the service association."); }
        retainedLinks.push(saved);
      }
      // Read by ID: CRM search indexing can lag behind a successful insert.
      for (var retained of retainedLinks) {
        var verified = await get("Prepayment_Request_Services", id(retained));
        if (id(verified.Prepayment_Request) !== id(ctx.request) || !selected.has(id(verified.Booking_Service))) { throw new Error("CRM did not confirm a selected service. Retry to finish saving."); }
      }
      if (!retainedLinks.length) { throw new Error("Keep at least one confirmed service associated with this request."); }
      for (var link of current.links) {
        if (!selected.has(id(link.Booking_Service))) { success(await api.deleteRecord({ Entity: "Prepayment_Request_Services", RecordID: id(link) })); }
      }
      var result = { records: [], selected: Array.from(selected), links: retainedLinks, description: "Services linked to this prepayment request" };
      for (var selectedId of selected) { result.records.push(await get("Booking_Services", selectedId)); }
      result.records.sort(function (a, b) { return String(a.Service_Date || "9999").localeCompare(String(b.Service_Date || "9999")) || id(a).localeCompare(id(b)); });
      selected.forEach(function (serviceId) {
        var key = "prepayment-service-link-" + id(ctx.request) + "-" + serviceId;
        delete memory[key];
        if (storage && storage.removeItem) { storage.removeItem(key); }
      });
      return result;
    }
    return { context: context, options: options, saveInvoice: saveInvoice, removeInvoice: removeInvoice, savePayment: savePayment, linkPayment: linkPayment, relatedServices: relatedServices, associatedSettlement: associatedSettlement, associatedSettlements: associatedSettlements, serviceSelection: serviceSelection, saveServiceSelection: saveServiceSelection };
  };

  ns.createPrepaymentWorkflow = function (panel, zoho, onChanged) {
    var modal = panel.querySelector('[data-prepayment-workflow]');
    var find = function (key) { return modal.querySelector('[data-prepayment-workflow-' + key + ']'); };
    var service = ns.createPrepaymentWorkflowService(zoho, global.sessionStorage);
    var ctx, choices, busy = false, generation = 0, opener, phase, documentFiles = [], resolveSelfEmployment;
    var notesButton = find("notes");
    if (notesButton) notesButton.addEventListener("click", async function () {
      if (busy || !ctx || notesButton.disabled) return;
      notesButton.disabled = true;
      try { await ns.openPrepaymentAccountingNotes(id(ctx.payment)); }
      catch (error) { message(error.message || "Could not open Accounting Notes.", true); }
      finally { notesButton.disabled = !ns.accountingNotesEnabled || busy || !ctx; }
    });
    var invoiceNameDefault = ns.createInvoiceNameDefault(find("reference"), function () { return zoho.CRM.API; }, function (error) { message("Could not suggest an invoice number: " + error.message, true); });
    function updateInvoiceNameDefault() {
      if (!ctx || phase !== "invoice") { return; }
      return invoiceNameDefault.update({ type: find("invoice-type").value, supplierId: id(ctx.request.Supplier), supplierCode: ctx.request.Supplier_Code, bookingId: id(ctx.request.Booking), mfsp: ctx.request.MFSP_Reference });
    }
    function updateAmounts() {
      var amounts = invoiceAmounts({ amount: find("amount").value, vat: find("vat").value, irpf: find("irpf").value });
      find("irpf-amount").value = Number.isFinite(amounts.irpf) ? amounts.irpf.toFixed(2) : "";
      find("total-payable").value = Number.isFinite(amounts.total) ? amounts.total.toFixed(2) : "";
    }
    function confirmSelfEmployment() {
      find("self-employed-confirmation").hidden = false;
      find("self-employed-yes").focus();
      return new Promise(function (resolve) { resolveSelfEmployment = resolve; });
    }
    function resolveConfirmation(confirmed) {
      find("self-employed-confirmation").hidden = true;
      if (resolveSelfEmployment) { var resolve = resolveSelfEmployment; resolveSelfEmployment = null; resolve(confirmed); }
    }
    function message(text, error) { find("message").textContent = text || ""; find("message").classList.toggle("is-error", Boolean(error)); }
    function serviceContent(record) {
          var serviceDate = String(record.Service_Date || ""), match = serviceDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
          var amount = record.Total_Purchase_Price, price = 'Not provided';
          if (amount != null && String(amount).trim() !== '' && Number.isFinite(Number(amount))) {
            var code = record.Currency || currency(ctx.payment);
            try { price = new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }).format(Number(amount)); }
            catch (ignored) { price = String(amount) + ' ' + code; }
          }
          return '<div class="prepayment-service-date"><span>Service Date</span><strong>' + esc(match ? match[3] + '/' + match[2] + '/' + match[1] : serviceDate || 'Not provided') + '</strong></div><div><span>Product Description</span><p>' + esc(record.Product_Description || 'No product description provided.') + '</p></div><div class="prepayment-service-price"><span>Total Purchase Price</span><strong>' + esc(price) + '</strong></div>';
    }
    var editServicesButton = find("services-edit");
    function serviceMessage(text, error) {
      var node = find("services-message");
      if (node) { node.textContent = text || ""; node.hidden = !text; node.classList.toggle("is-error", Boolean(error)); }
    }
    var editingServices = false, serviceChoices = [], selectedServiceIds = new Set();
    function serviceTotal(records) {
      var totals = {}, missing = 0;
      records.forEach(function (record) {
        var amount = record.Total_Purchase_Price, code = record.Currency || currency(ctx.payment);
        if (amount == null || String(amount).trim() === "" || !Number.isFinite(Number(amount))) { missing += 1; return; }
        totals[code] = (totals[code] || 0) + Math.round(Number(amount) * 100);
      });
      var total = Object.keys(totals).map(function (code) { return new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).format(totals[code] / 100); }).join(" + ") || "0";
      return esc(total) + (missing ? ' (' + missing + ' without a price; total incomplete)' : '');
    }
    function renderServiceEditor() {
      var total = serviceTotal(serviceChoices.filter(function (record) { return selectedServiceIds.has(id(record)); }));
      find("services").innerHTML = '<p>Services for this supplier and booking. Changes apply to the whole prepayment request.</p><p class="prepayment-services-total" role="status">Selected: ' + selectedServiceIds.size + ' &middot; Total: ' + total + '</p><ul>' + serviceChoices.map(function (record) {
        var checked = selectedServiceIds.has(id(record));
        return '<li class="prepayment-service-choice"><label><input type="checkbox" data-service-choice="' + esc(id(record)) + '"' + (checked ? ' checked' : '') + '><span>' + (checked ? 'Included' : 'Not included') + '</span></label>' + serviceContent(record) + '</li>';
      }).join('') + '</ul><div class="prepayment-service-actions"><button type="button" class="button" data-service-save' + (!selectedServiceIds.size ? ' disabled' : '') + '>Save services</button><button type="button" class="button tertiary" data-service-cancel>Cancel</button></div>';
    }
    if (find("services")) {
      find("services").addEventListener("change", function (event) {
        var value = event.target.getAttribute("data-service-choice");
        if (!value || busy) { return; }
        if (event.target.checked) { selectedServiceIds.add(value); } else { selectedServiceIds.delete(value); }
        renderServiceEditor();
        var checkbox = Array.prototype.find.call(find("services").querySelectorAll("[data-service-choice]"), function (node) { return node.getAttribute("data-service-choice") === value; });
        if (checkbox) { checkbox.focus(); }
      });
      async function handleServiceAction(event) {
        var button = event.target.closest("button");
        if (!button || busy || phase !== "invoice" || ctx.allocations.rows.length) { return; }
        event.preventDefault();
        if (button.hasAttribute("data-service-cancel")) { editingServices = false; serviceMessage(""); await renderServices(); return; }
        if (!button.hasAttribute("data-service-edit") && !button.hasAttribute("data-service-save")) { return; }
        servicesGeneration += 1;
        setBusy(true); serviceMessage(button.hasAttribute("data-service-save") ? "Saving services..." : "Loading services...");
        try {
          if (button.hasAttribute("data-service-edit")) {
            var details = button.closest && button.closest("details");
            if (details) { details.open = true; }
            var selection = await service.serviceSelection(ctx);
            serviceChoices = selection.records; selectedServiceIds = new Set(selection.selected); editingServices = true;
            renderServiceEditor(); serviceMessage("");
          } else {
            var savedSelection = await service.saveServiceSelection(id(ctx.payment), Array.from(selectedServiceIds));
            editingServices = false; await renderServices(savedSelection); serviceMessage("Associated services updated.");
            try { await onChanged(); } catch (refreshError) { serviceMessage("Services saved, but the overview could not refresh. " + (refreshError.message || ""), true); }
          }
        } catch (error) { serviceMessage(error.message || "Could not save associated services. Retry to finish saving.", true); }
        finally { setBusy(false); }
      }
      find("services").addEventListener("click", handleServiceAction);
      if (editServicesButton) editServicesButton.addEventListener("click", handleServiceAction);
    }
    var servicesGeneration = 0;
    async function renderServices(confirmedSelection) {
      if (editServicesButton) { editServicesButton.hidden = phase !== "invoice" || editingServices || Boolean(ctx && ctx.allocations.rows.length); }
      var container = find("services");
      if (!container || !ctx || editingServices) { return; }
      var token = ++servicesGeneration, currentGeneration = generation;
      container.textContent = "Loading services…";
      try {
        var result = confirmedSelection && Array.isArray(confirmedSelection.records) ? confirmedSelection : await service.relatedServices(ctx);
        if (token !== servicesGeneration || currentGeneration !== generation) { return; }
        container.innerHTML = '<p class="prepayment-services-total">Total: ' + serviceTotal(result.records) + '</p>' + (result.description === "Services linked to this prepayment request" ? '' : '<p class="prepayment-services-description">' + esc(result.description) + '</p>') + (result.records.length ? '<ul>' + result.records.map(function (record) {
          return '<li>' + serviceContent(record) + '</li>';
        }).join('') + '</ul>' : '<p>No associated services found.</p>');
      } catch (error) { if (token === servicesGeneration && currentGeneration === generation) { container.textContent = "Could not load associated services. " + (error.message || "Reopen the prepayment to retry."); } }
    }
    var settlementGeneration = 0;
    async function renderSettlement() {
      var container = find("settlement-summary");
      if (!container || !ctx) { return; }
      var token = ++settlementGeneration, currentGeneration = generation;
      container.textContent = "Loading settlement...";
      try {
        var records = await service.associatedSettlements(ctx, phase === "invoice" ? find("settlement").value : "", phase === "invoice" ? find("existing").value : "");
        if (token !== settlementGeneration || currentGeneration !== generation) { return; }
        if (!records.length) { container.textContent = "No settlement associated yet. Select a settlement or link an invoice to see its totals."; return; }
        function amount(value) { return value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value); }
        container.innerHTML = records.map(function (record) {
        var cost = amount(record.Total_Service_Cost), invoiced = amount(record.Total_Invoice), paid = amount(record.Total_Paid);
        var pendingInvoice = cost == null || invoiced == null ? null : Math.round((cost - invoiced) * 100) / 100;
        var pendingPayment = invoiced == null || paid == null ? null : Math.round((invoiced - paid) * 100) / 100;
        var format = new Intl.NumberFormat("en-GB", { style: "currency", currency: record.Currency || currency(ctx.payment) });
        return '<p>' + recordLink("Supplier_Settlements", record) + '</p><div class="invoice-create-summary-grid">' + [
          ["Total service cost", cost], ["Already invoiced", invoiced], ["Pending invoicing", pendingInvoice, true],
          ["Total paid", paid], ["Unpaid invoiced amount", pendingPayment]
        ].map(function (item) { return '<div class="invoice-create-summary-item' + (item[2] ? ' invoice-create-summary-item-highlight' : '') + '"><span>' + item[0] + '</span><strong>' + (item[1] == null ? 'Not provided' : esc(format.format(item[1]))) + '</strong></div>'; }).join('') + '</div>';
        }).join('');
      } catch (error) {
        if (token === settlementGeneration && currentGeneration === generation) { container.textContent = "Could not load settlement. " + (error.message || "Please retry."); }
      }
    }
    function setBusy(value) { busy = value; if (editServicesButton) { editServicesButton.disabled = value; editServicesButton.hidden = phase !== "invoice" || editingServices || Boolean(ctx && ctx.allocations.rows.length); } if (find("services")) { Array.prototype.forEach.call(find("services").querySelectorAll("button, input"), function (node) { node.disabled = value || (node.hasAttribute("data-service-save") && !selectedServiceIds.size); }); } find("submit").disabled = value; find("fields").disabled = value; modal.setAttribute("aria-busy", String(value)); find("spinner").hidden = !value; if (notesButton) notesButton.disabled = !ns.accountingNotesEnabled || value || !ctx; }
    function option(record) { return '<option value="' + esc(id(record)) + '">' + esc(label(record)) + '</option>'; }
    function recordLink(module, record, text) { return id(record) ? '<button type="button" class="prepayment-record-link" data-prepayment-module="' + module + '" data-prepayment-record="' + esc(id(record)) + '">' + esc(text || label(record) || id(record)) + '</button>' : '—'; }
    function invoiceMode() {
      var existing = Boolean(find("existing").value);
      find("new-invoice").hidden = existing;
      find("new-invoice").disabled = existing;
      find("submit").textContent = existing ? "Link invoice" : "Create invoice";
    }
    function render() {
      var p = ctx.payment, r = ctx.request, payment = p[ctx.fields.payment];
      var closed = ns.prepaymentsModel.isClosed(p) || id(payment);
      var hasExistingPayment = ctx.allocations.complete && choices.existingPayments && choices.existingPayments.length;
      phase = closed ? "view" : hasExistingPayment ? "link-payment" : ctx.allocations.complete ? "payment" : "invoice";
      find("title").textContent = phase === "view" ? "Prepayment details" : phase === "link-payment" ? "Link existing payment" : phase === "payment" ? "Record prepayment" : "Register supplier invoice";
      find("context").innerHTML = '<dl>' + [["Prepayment", esc(p.Name)], ["Observations", esc(p.Observations || r.Observations || "—")], ["Reported By", esc(r.Requested_By_2 || "?")], ["Supplier", esc(label(r.Supplier)) + (ns.supplierAccountingInfo ? ns.supplierAccountingInfo.infoHtml(id(r.Supplier)) : "")], ["Booking", esc(r.MFSP_Reference || label(r.Booking))], ["Amount", esc(new Intl.NumberFormat("en-GB", { style: "currency", currency: currency(p) }).format(Number(p.Amount || 0)))], ["Accounting Status", esc(p.Accounting_Status || "Pending invoice")], ["Bank Payment Requested", p.Bank_Payment_Requested === true ? "Requested" : "Not requested"], ["Bank Receipt Needed", p.Bank_Receipt_Needed === true ? "Needed" : "Not needed"], ["Due date", esc(p.Due_Date || "—")], ["Payment", recordLink(PAYMENTS, payment)]].map(function (item) { return '<div' + (item[0] === 'Observations' ? ' class="prepayment-observations"' : '') + '><dt>' + item[0] + '</dt><dd>' + item[1] + '</dd></div>'; }).join("") + '</dl>';
      var formatAllocation = new Intl.NumberFormat("en-GB", { style: "currency", currency: currency(p) });
      find("allocations").innerHTML = '<h4>Associated invoices</h4><ul>' + ctx.allocations.rows.map(function (row) {
        return '<li>' + recordLink(INVOICES, row.Vendor_Invoice) + ' &middot; ' + esc(formatAllocation.format(row.Allocated_Amount)) + (!closed ? ' <button type="button" class="button tertiary" data-remove-allocation="' + esc(id(row)) + '">Remove association</button>' : '') + '</li>';
      }).join('') + '</ul><p>Allocated: ' + esc(formatAllocation.format(ctx.allocations.allocated)) + ' &middot; Remaining: ' + esc(formatAllocation.format(ctx.allocations.remaining)) + '</p>';
      documentFiles = [];
      find("documents").hidden = false;
      find("documents").innerHTML = '<dl>' + [[r.Proforma_Attached, "Proforma / invoices"], [r.Invoice_Attached, "Invoice"], [r._attachments, "Request attachments"], [p.Payment_Proof, "Payment proof"]].map(function (item) {
        var attachments = ns.operationsDocuments.files(item[0]);
        if (!attachments.length) { return item[1] === "Proforma / invoices" ? '<div class="card-purchase-workflow-documents"><dt>Proforma / invoices</dt><dd>No proforma associated. Attach supporting documents to the request.</dd></div>' : ""; }
        return '<div class="card-purchase-workflow-documents"><dt>' + item[1] + '</dt><dd>' + attachments.map(function (file) {
          var index = documentFiles.push(file) - 1;
          return '<button class="card-purchase-file" type="button" data-prepayment-file="' + index + '" title="Preview ' + esc(item[1]) + ': ' + esc(file.name) + '" aria-label="Preview ' + esc(item[1]) + ': ' + esc(file.name) + '"><span>' + esc(file.name) + '</span><span class="prepayment-preview-action">Preview</span></button>';
        }).join("") + '</dd></div>';
      }).join("") + '</dl>' + (r._documentError ? '<p class="operations-file-preview-error">' + esc(r._documentError) + '</p>' : '');
      find("invoice-fields").hidden = phase !== "invoice"; find("invoice-fields").disabled = phase !== "invoice";
      find("payment-fields").hidden = phase !== "payment"; find("payment-fields").disabled = phase !== "payment";
      find("link-payment-fields").hidden = phase !== "link-payment"; find("link-payment-fields").disabled = phase !== "link-payment";
      find("submit").hidden = closed;
      if (phase === "invoice") {
        find("existing").innerHTML = '<option value="">Create a new invoice</option>' + choices.invoices.map(option).join("");
        find("settlement").innerHTML = '<option value="">Select settlement</option>' + choices.settlements.map(option).join("");
        if (choices.settlements.length === 1) { find("settlement").value = id(choices.settlements[0]); }
        find("reference").value = ""; find("date").value = ns.prepaymentsModel.today();
        find("amount").value = ctx.allocations.remaining; find("allocated").value = ctx.allocations.remaining; find("allocated").max = ctx.allocations.remaining; find("vat").value = "0";
        find("invoice-type").value = r.Invoice_Attached && r.Invoice_Attached.length && !(r.Proforma_Attached && r.Proforma_Attached.length) ? "Final Invoice" : "Proforma"; find("irpf").value = "0"; updateAmounts();
        invoiceNameDefault.reset(); updateInvoiceNameDefault();
        invoiceMode();
      } else if (phase === "link-payment") {
        find("existing-payment").innerHTML = choices.existingPayments.map(function (item) {
          var payment = item.payment;
          return '<option value="' + esc(id(payment)) + '">' + esc(label(payment) || id(payment)) + '</option>';
        }).join("");
        find("existing-payment").value = id(choices.existingPayments[0].payment);
        find("existing-payment-choice").hidden = choices.existingPayments.length === 1;
        renderExistingPayment();
        find("submit").textContent = "Confirm payment link";
      } else if (phase === "payment") {
        find("payment-reference").value = "PREPAY-" + id(p);
        find("payment-date").value = ns.prepaymentsModel.today();
        find("payment-date").readOnly = true;
        find("payment-amount").value = p.Amount == null ? "" : p.Amount;
        find("account").innerHTML = '<option value="">Select Own payment account</option>' + choices.accounts.map(option).join("");
        find("account").value = choices.defaultAccountId || "";
        find("account").required = true;
        find("submit").textContent = "Record payment";
      }
      renderServices();
      renderSettlement();
    }
    function renderExistingPayment() {
      var selected = choices.existingPayments.find(function (item) { return id(item.payment) === find("existing-payment").value; });
      if (!selected) { find("existing-payment-details").innerHTML = ""; return; }
      var payment = selected.payment, format = new Intl.NumberFormat("en-GB", { style: "currency", currency: currency(payment) });
      find("existing-payment-details").innerHTML = '<dl>' + [
        ["Payment", recordLink(PAYMENTS, payment, label(payment) || id(payment))],
        ["Status", esc(payment.Status || "—")], ["Payment date", esc(payment.Payment_Date || "—")],
        ["Payment amount", esc(format.format(Number(payment.Payment_Amount || 0)))],
        ["Allocated to associated invoices", esc(format.format(selected.allocated))]
      ].map(function (item) { return '<div' + (item[0] === 'Observations' ? ' class="prepayment-observations"' : '') + '><dt>' + item[0] + '</dt><dd>' + item[1] + '</dd></div>'; }).join("") + '</dl>';
    }
    async function open(recordId, button) {
      if (busy) { return; }
      opener = button; var token = ++generation;
      ctx = null; editingServices = false; serviceMessage("");
      if (find("settlement-summary")) { find("settlement-summary").textContent = "Loading settlement..."; }
      invoiceNameDefault.reset();
      modal.hidden = false; modal.classList.add("is-open");
      find("title").textContent = "Loading prepayment…"; find("context").innerHTML = ""; find("documents").innerHTML = "";
      if (find("services")) { find("services").textContent = "Loading services…"; }
      find("invoice-fields").hidden = true; find("payment-fields").hidden = true; find("link-payment-fields").hidden = true; find("submit").hidden = true;
      message(""); setBusy(true); modal.querySelector('button[data-prepayment-workflow-close]').focus();
      try {
        ctx = await service.context(recordId);
        if (token !== generation) { return; }
        var closed = ns.prepaymentsModel.isClosed(ctx.payment) || id(ctx.payment[ctx.fields.payment]);
        choices = closed ? { invoices: [], settlements: [], accounts: [] } : await service.options(ctx);
        if (token !== generation) { return; }
        render();
      } catch (error) { message(error.message, true); }
      finally { if (token === generation) { setBusy(false); } }
    }
    function close() {
      if (busy) { return; }
      generation += 1; modal.classList.remove("is-open"); modal.hidden = true;
      invoiceNameDefault.reset();
      if (opener && opener.isConnected) { opener.focus(); }
    }
    find("form").addEventListener("submit", async function (event) {
      event.preventDefault(); if (busy || !ctx || phase === "view") { return; }
      if (editingServices) { message("Save or cancel your service selection before creating the invoice.", true); return; }
      if (!find("form").reportValidity()) { return; }
      // Read-only values do not participate in native required validation.
      if (phase === "payment" && (!find("payment-reference").value.trim() || !positive(find("payment-amount").value) || !find("account").value)) {
        message("Payment reference, a positive prepayment amount and an Own payment account are required.", true);
        return;
      }
      setBusy(true); message(phase === "invoice" ? "Saving invoice…" : "Recording payment…");
      try {
        if (phase === "invoice") {
          ctx = await service.saveInvoice(id(ctx.payment), { existingInvoiceId: find("existing").value, settlementId: find("settlement").value, reference: find("reference").value, date: find("date").value, amount: find("amount").value, allocatedAmount: find("allocated").value, vat: find("vat").value, invoiceType: find("invoice-type").value, irpf: find("irpf").value }, confirmSelfEmployment);
          choices = await service.options(ctx);
        } else if (phase === "link-payment") {
          ctx = await service.linkPayment(id(ctx.payment), find("existing-payment").value);
        } else {
          ctx = await service.savePayment(id(ctx.payment), { accountId: find("account").value });
        }
        render(); message(phase === "link-payment" ? "Invoice linked. Confirm the existing payment below." : phase === "payment" ? "Invoice linked. Review the payment details." : phase === "invoice" ? "Invoice saved. Add another invoice to allocate the remaining amount." : "Prepayment recorded.");
        if (ctx.settlementWarning) { message(ctx.settlementWarning, true); }
        await onChanged();
      } catch (error) {
        if (error.code === "EXISTING_PAYMENT_AVAILABLE" || error.code === "PAYMENT_LINK_PENDING") {
          try { choices = await service.options(ctx); render(); }
          catch (refreshError) { message(refreshError.message, true); return; }
        }
        if (error.code === "IRPF_RESET") { find("irpf").value = "0"; updateAmounts(); }
        message(error.message || "Could not save the prepayment.", true);
      }
      finally { setBusy(false); }
    });
    find("allocations").addEventListener("click", async function (event) {
      var button = event.target.closest("[data-remove-allocation]");
      if (!button || busy || !ctx) { return; }
      setBusy(true); message("Removing invoice association...");
      try {
        ctx = await service.removeInvoice(id(ctx.payment), button.getAttribute("data-remove-allocation"));
        choices = await service.options(ctx); render(); message("Association removed. The invoice is retained."); await onChanged();
      } catch (error) { message(error.message, true); } finally { setBusy(false); }
    });
    find("existing").addEventListener("change", function () { invoiceMode(); renderSettlement(); });
    find("settlement").addEventListener("change", function () { renderServices(); renderSettlement(); });
    find("invoice-type").addEventListener("change", updateInvoiceNameDefault);
    find("existing-payment").addEventListener("change", renderExistingPayment);
    ["amount", "vat", "irpf"].forEach(function (key) { find(key).addEventListener("input", updateAmounts); });
    find("self-employed-yes").addEventListener("click", function () { resolveConfirmation(true); });
    find("self-employed-no").addEventListener("click", function () { resolveConfirmation(false); });
    find("documents").addEventListener("click", function (event) {
      var button = event.target.closest('[data-prepayment-file]');
      var file = button && documentFiles[Number(button.getAttribute("data-prepayment-file"))];
      if (file) { ns.operationsDocuments.preview(file); }
    });
    modal.querySelectorAll('[data-prepayment-workflow-close]').forEach(function (button) { button.addEventListener("click", close); });
    modal.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") { return; }
      var focusable = Array.prototype.filter.call(modal.querySelectorAll('button, input, select, textarea, [tabindex="0"]'), function (element) { return !element.disabled && element.getClientRects().length; });
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && global.document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && global.document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    return { open: open, close: close };
  };
}(window));
