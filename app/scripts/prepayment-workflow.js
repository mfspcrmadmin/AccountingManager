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
          return { invoice: lookup(INVOICES, "Vendor_Invoice"), payment: lookup(PAYMENTS, "Vendor_Payment") };
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
      return { payment: payment, request: request, fields: fields };
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
      if (id(ctx.payment[ctx.fields.invoice])) {
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
      var invoiceId = id(ctx.payment[ctx.fields.invoice]);
      var invoice = await get(INVOICES, invoiceId);
      validateInvoice(invoice, ctx);
      var allocations = await search("Supplier_Pay_Allocations", "(Supplier_Invoice:equals:" + invoiceId + ")");
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
        if (paymentId && id(allocation.Supplier_Invoice) === invoiceId && !cancelled(allocation) && positive(allocation.Allocated_Amount)) {
          byPayment[paymentId] = (byPayment[paymentId] || 0) + Number(allocation.Allocated_Amount);
        }
      });
      var payments = await Promise.all(Object.keys(byPayment).map(async function (paymentId) {
        var payment = await get(PAYMENTS, paymentId);
        return { payment: payment, allocated: byPayment[paymentId] };
      }));
      return payments.filter(function (item) { return !cancelled(item.payment); });
    }
    async function linkPayment(recordId, paymentId) {
      var ctx = await context(recordId);
      validateContext(ctx);
      if (!id(ctx.payment[ctx.fields.invoice])) { throw new Error("Create or select the invoice first."); }
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
      var settlementWarning = await ns.refreshQuickInvoiceSettlements(zoho, id(ctx.payment[ctx.fields.invoice]));
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
    async function saveInvoice(recordId, input, confirmSelfEmployment) {
      var ctx = await context(recordId), journal = checkpoint(recordId), invoice, invoiceId;
      validateContext(ctx);
      invoiceId = id(ctx.payment[ctx.fields.invoice]) || journal.invoiceId || input.existingInvoiceId;
      if (!invoiceId) {
        if (journal.invoiceAttempt) { throw new Error("The previous invoice request was not confirmed. Check CRM and select the existing invoice before trying again."); }
        if (ctx.payment.Accounting_Status === "Pending payment record") { throw new Error("Select the existing invoice for this prepayment."); }
        if (!input.reference.trim() || !input.date || !positive(input.amount) || !Number.isFinite(Number(input.vat)) || Number(input.vat) < 0) { throw new Error("Enter an invoice number, date, positive amount and valid VAT percentage."); }
        var invoiceType = input.invoiceType || "Proforma", irpf = Number(input.irpf || 0), amounts = invoiceAmounts(input);
        if (["Proforma", "Final Invoice", "Tickets", "Commission"].indexOf(invoiceType) === -1) { throw new Error("Select a valid invoice type for an outbound prepayment."); }
        if (!Number.isFinite(irpf) || irpf < 0 || !positive(amounts.total)) { throw new Error("Enter a valid IRPF percentage and positive total payable."); }
        if (amounts.total < Number(ctx.payment.Amount)) { throw new Error("The invoice total payable after IRPF cannot be smaller than this prepayment."); }
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
      if (invoiceTotal + 0.005 < Number(ctx.payment.Amount)) { throw new Error("The invoice's Total Payable Amount (" + invoiceTotal.toFixed(2) + " " + currency(invoice) + ") is smaller than this prepayment (" + Number(ctx.payment.Amount).toFixed(2) + " " + currency(ctx.payment) + ")."); }
      var link = {}; link[ctx.fields.invoice] = { id: invoiceId };
      await update(recordId, link);
      if (journal.invoiceId === invoiceId) { await ensureSettlement(invoice); }
      await update(recordId, { Accounting_Status: "Pending payment record" });
      return finishWithSettlementRefresh(recordId, invoiceId);
    }
    async function savePayment(recordId, input) {
      var ctx = await context(recordId), journal = checkpoint(recordId), invoiceId = id(ctx.payment[ctx.fields.invoice]);
      validateContext(ctx);
      if (!invoiceId) { throw new Error("Create or select the invoice first."); }
      var invoice = await get(INVOICES, invoiceId);
      validateInvoice(invoice, ctx);
      if (journal.invoiceId === invoiceId) { await ensureSettlement(invoice); }
      var paymentId = journal.paymentId;
      if (!paymentId) {
        if ((await invoicePayments(ctx)).length) {
          var existingError = new Error("This invoice already has an associated payment. Confirm its link to the prepayment.");
          existingError.code = "EXISTING_PAYMENT_AVAILABLE";
          throw existingError;
        }
        if (journal.paymentAttempt) { throw new Error("The previous payment request was not confirmed. Check CRM before recording another payment."); }
        if (!input.date) { throw new Error("Enter the payment date."); }
        validatePending(invoice, ctx.payment);
        var accountId = input.accountId;
        if (!accountId) { throw new Error("Select an Own payment account before creating the payment."); }
        var account = await get("Payment_Accounts", accountId);
        if (!ns.isOwnQuickPaymentAccount(account)) { throw new Error("Select an active Own payment account as the payment source."); }
        var allocations = {}, supplierAccounts = {};
        allocations[invoiceId] = Number(ctx.payment.Amount);
        var paymentData = { Name: "PREPAY-" + recordId, Currency: currency(ctx.payment), Payment_Date: input.date, Payment_Account: accountId, Status: "Paid", Accounting_Status: "Pending", Movement_Type: "Outbound Payment", allocations: allocations, Payment_Accounts_By_Supplier: supplierAccounts };
        checkpoint(recordId, Object.assign(journal, { paymentAttempt: true, paymentDate: input.date }));
        var response = await zoho.CRM.FUNCTIONS.execute("createsupplierpaymentfrominvoices", { arguments: JSON.stringify({ supplierInvoiceIds: invoiceId, paymentDataString: JSON.stringify(paymentData) }) });
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
      var settlementWarning = await ns.refreshQuickInvoiceSettlements(zoho, invoiceId);
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
      var matching = savedAllocations.filter(function (r) { return id(r.Supplier_Payment) === paymentId && id(r.Supplier_Invoice) === invoiceId && !cancelled(r); });
      var allocated = matching.reduce(function (sum, r) { return sum + Number(r.Allocated_Amount || 0); }, 0);
      var issues = [], expected = Number(ctx.payment.Amount);
      if (currency(savedPayment) !== currency(ctx.payment)) { issues.push("payment currency is " + currency(savedPayment) + "; prepayment currency is " + currency(ctx.payment)); }
      if (["Paid", "Reconciled"].indexOf(savedPayment.Status) === -1) { issues.push("payment status is " + (savedPayment.Status || "missing") + "; expected Paid or Reconciled"); }
      if (!positive(savedPayment.Payment_Amount) || Math.abs(Number(savedPayment.Payment_Amount) - expected) > 0.005) { issues.push("payment amount is " + (savedPayment.Payment_Amount == null ? "missing" : savedPayment.Payment_Amount) + "; prepayment amount is " + expected); }
      if (!positive(allocated) || Math.abs(allocated - expected) > 0.005) { issues.push("amount allocated to invoice " + invoiceId + " is " + allocated + "; expected " + expected + (matching.length ? "" : " (no matching allocation found)")); }
      if (matching.some(function (r) { return !positive(r.Allocated_Amount); })) { issues.push("the invoice contains an invalid allocation amount"); }
      if (issues.length) {
        throw new Error("Payment " + paymentId + " was created, but needs review: " + issues.join(". ") + ". No additional payment will be created.");
      }
      var data = { Accounting_Status: "Prepayment recorded", Payment_Date: journal.paymentDate || input.date };
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
    return { context: context, options: options, saveInvoice: saveInvoice, savePayment: savePayment, linkPayment: linkPayment };
  };

  ns.createPrepaymentWorkflow = function (panel, zoho, onChanged) {
    var modal = panel.querySelector('[data-prepayment-workflow]');
    var find = function (key) { return modal.querySelector('[data-prepayment-workflow-' + key + ']'); };
    var service = ns.createPrepaymentWorkflowService(zoho, global.sessionStorage);
    var ctx, choices, busy = false, generation = 0, opener, phase, documentFiles = [], resolveSelfEmployment;
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
    function setBusy(value) { busy = value; find("submit").disabled = value; find("fields").disabled = value; modal.setAttribute("aria-busy", String(value)); find("spinner").hidden = !value; }
    function option(record) { return '<option value="' + esc(id(record)) + '">' + esc(label(record)) + '</option>'; }
    function recordLink(module, record, text) { return id(record) ? '<button type="button" class="prepayment-record-link" data-prepayment-module="' + module + '" data-prepayment-record="' + esc(id(record)) + '">' + esc(text || label(record) || id(record)) + '</button>' : '—'; }
    function invoiceMode() {
      var existing = Boolean(find("existing").value);
      find("new-invoice").hidden = existing;
      find("new-invoice").disabled = existing;
      find("submit").textContent = existing ? "Link invoice" : "Create invoice";
    }
    function render() {
      var p = ctx.payment, r = ctx.request, invoice = p[ctx.fields.invoice], payment = p[ctx.fields.payment];
      var closed = ns.prepaymentsModel.isClosed(p) || id(payment);
      var hasExistingPayment = id(invoice) && choices.existingPayments && choices.existingPayments.length;
      phase = closed ? "view" : hasExistingPayment ? "link-payment" : id(invoice) ? "payment" : "invoice";
      find("title").textContent = phase === "view" ? "Prepayment details" : phase === "link-payment" ? "Link existing payment" : phase === "payment" ? "Record prepayment" : "Register supplier invoice";
      find("context").innerHTML = '<dl>' + [["Prepayment", esc(p.Name)], ["Observations", esc(p.Observations || r.Observations || "—")], ["Reported By", esc(r.Requested_By_2 || "?")], ["Supplier", esc(label(r.Supplier))], ["Booking", esc(r.MFSP_Reference || label(r.Booking))], ["Amount", esc(new Intl.NumberFormat("en-GB", { style: "currency", currency: currency(p) }).format(Number(p.Amount || 0)))], ["Accounting Status", esc(p.Accounting_Status || "Pending invoice")], ["Bank Payment Requested", p.Bank_Payment_Requested === true ? "Requested" : "Not requested"], ["Bank Receipt Needed", p.Bank_Receipt_Needed === true ? "Needed" : "Not needed"], ["Due date", esc(p.Due_Date || "—")], ["Invoice", recordLink(INVOICES, invoice)], ["Payment", recordLink(PAYMENTS, payment)]].map(function (item) { return '<div' + (item[0] === 'Observations' ? ' class="prepayment-observations"' : '') + '><dt>' + item[0] + '</dt><dd>' + item[1] + '</dd></div>'; }).join("") + '</dl>';
      documentFiles = [];
      find("documents").hidden = false;
      find("documents").innerHTML = '<dl>' + [[r.Proforma_Attached, "Proforma"], [r.Invoice_Attached, "Invoice"], [r._attachments, "Request attachments"], [p.Payment_Proof, "Payment proof"]].map(function (item) {
        var attachments = ns.operationsDocuments.files(item[0]);
        if (!attachments.length) { return item[1] === "Proforma" ? '<div class="card-purchase-workflow-documents"><dt>Proforma</dt><dd>No proforma associated.</dd></div>' : ""; }
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
        find("amount").value = p.Amount == null ? "" : p.Amount; find("vat").value = "0";
        find("invoice-type").value = "Proforma"; find("irpf").value = "0"; updateAmounts();
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
        find("payment-date").value = p.Payment_Date || ns.prepaymentsModel.today();
        find("payment-amount").value = p.Amount == null ? "" : p.Amount;
        find("account").innerHTML = '<option value="">Select Own payment account</option>' + choices.accounts.map(option).join("");
        find("account").value = choices.defaultAccountId || "";
        find("account").required = true;
        find("submit").textContent = "Record payment";
      }
    }
    function renderExistingPayment() {
      var selected = choices.existingPayments.find(function (item) { return id(item.payment) === find("existing-payment").value; });
      if (!selected) { find("existing-payment-details").innerHTML = ""; return; }
      var payment = selected.payment, format = new Intl.NumberFormat("en-GB", { style: "currency", currency: currency(payment) });
      find("existing-payment-details").innerHTML = '<dl>' + [
        ["Payment", recordLink(PAYMENTS, payment, label(payment) || id(payment))],
        ["Status", esc(payment.Status || "—")], ["Payment date", esc(payment.Payment_Date || "—")],
        ["Payment amount", esc(format.format(Number(payment.Payment_Amount || 0)))],
        ["Allocated to this invoice", esc(format.format(selected.allocated))]
      ].map(function (item) { return '<div' + (item[0] === 'Observations' ? ' class="prepayment-observations"' : '') + '><dt>' + item[0] + '</dt><dd>' + item[1] + '</dd></div>'; }).join("") + '</dl>';
    }
    async function open(recordId, button) {
      if (busy) { return; }
      opener = button; var token = ++generation;
      invoiceNameDefault.reset();
      modal.hidden = false; modal.classList.add("is-open");
      find("title").textContent = "Loading prepayment…"; find("context").innerHTML = ""; find("documents").innerHTML = "";
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
      if (!find("form").reportValidity()) { return; }
      setBusy(true); message(phase === "invoice" ? "Saving invoice…" : "Recording payment…");
      try {
        if (phase === "invoice") {
          ctx = await service.saveInvoice(id(ctx.payment), { existingInvoiceId: find("existing").value, settlementId: find("settlement").value, reference: find("reference").value, date: find("date").value, amount: find("amount").value, vat: find("vat").value, invoiceType: find("invoice-type").value, irpf: find("irpf").value }, confirmSelfEmployment);
          choices = await service.options(ctx);
        } else if (phase === "link-payment") {
          ctx = await service.linkPayment(id(ctx.payment), find("existing-payment").value);
        } else {
          ctx = await service.savePayment(id(ctx.payment), { date: find("payment-date").value, accountId: find("account").value });
        }
        render(); message(phase === "link-payment" ? "Invoice linked. Confirm the existing payment below." : phase === "payment" ? "Invoice linked. Review the payment details." : "Prepayment recorded.");
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
    find("existing").addEventListener("change", invoiceMode);
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
