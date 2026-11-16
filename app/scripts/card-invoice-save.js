(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {}, busy = new Set();
  function id(value) { return String(value && value.id || ""); }
  ns.saveCardInvoice = async function (zoho, storage, purchaseId, input) {
    if (busy.has(purchaseId)) { throw new Error("This card invoice is already being saved."); }
    busy.add(purchaseId);
    var key = "accounting-manager-card-invoice-v1-" + purchaseId;
    function save(plan) { var raw = JSON.stringify(plan); storage.setItem(key, raw); if (storage.getItem(key) !== raw) { throw new Error("Invoice recovery information could not be saved."); } }
    async function run() {
      if (!storage) { throw new Error("Persistent storage is required before creating an invoice."); }
      var plan = JSON.parse(storage.getItem(key) || "null"), api = zoho.CRM.API;
      var response = await api.getRecord({ Entity: "Card_Purchases", RecordID: purchaseId });
      var purchase = response && response.data && response.data[0];
      if (!purchase || id(purchase) !== purchaseId || purchase.Locked__s === true) { throw new Error("Could not read an editable card purchase."); }
      if (id(purchase.Vendor_Payment) || ["Purchase recorded", "Refund recorded", "Cancelled", "Discarded"].includes(purchase.Accounting_Status)) { throw new Error("The card movement is already recorded or closed. Review its pending invoice operation before continuing."); }
      if (!plan) {
        if (id(purchase.Vendor_Invoice) || id(purchase.Vendor_Payment) || ["Recorded", "Cancelled", "Discarded"].includes(purchase.Accounting_Status)) { throw new Error("This card purchase is already linked or closed. Reload it before continuing."); }
        var amount = Number(input.amount), vat = Number(input.vat), date = String(input.date || ""), reference = String(input.reference || "").trim();
        if (!reference || reference.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(vat) || vat < 0 || vat > 100 || [amount,vat].some(function(v) { return Math.abs(v * 100 - Math.round(v * 100)) > 0.000001; })) { throw new Error("Enter a valid reference, date, positive amount and VAT percentage (0–100), with at most two decimals."); }
        var refund = purchase.Transaction_Type === "Refund", type = refund ? "Credit Note" : input.invoiceType;
        if (!["Credit Note", "Proforma", "Final Invoice", "Tickets", "Commission"].includes(type) || !refund && type === "Credit Note") { throw new Error("Select a valid invoice type."); }
        await ns.cardPurchaseSettlements.validate(api, purchase, input.settlementId);
        var net = Math.round(amount / (1 + vat / 100) * 100) / 100;
        plan = { purchaseId: purchaseId, supplierId: id(purchase.Supplier), bookingId: id(purchase.Booking), serviceId: id(purchase.Boking_Service), refund: refund,
          invoice: { Name: reference, Supplier: { id: id(purchase.Supplier) }, Supplier_Name: purchase.Supplier && (purchase.Supplier.name || purchase.Supplier.Name) || "", Supplier_Code: purchase.Supplier_Code || "", Booking: { id: id(purchase.Booking) }, Supplier_Settlement: { id: input.settlementId }, Currency: purchase.Currency || "EUR", Invoice_Date: date, Invoice_Amount_Excl_VAT: net, Invoice_Amount_Incl_VAT: amount, VAT_percentage: vat, VAT_Amount: Math.round((amount-net)*100)/100, Invoice_Total: amount, Total_Payable_Amount: amount, Amount_Paid: 0, Status: "Received", Invoice_Type: type }, notes: input.notes || "" };
        plan.invoice.Registration_Status = "Pending";
        save(plan);
      }
      if (plan.purchaseId !== purchaseId || plan.supplierId !== id(purchase.Supplier) || plan.bookingId !== id(purchase.Booking) || plan.serviceId !== id(purchase.Boking_Service) || plan.refund !== (purchase.Transaction_Type === "Refund") || plan.invoice.Currency !== (purchase.Currency || "EUR")) { throw new Error("The card purchase changed during invoice registration. Review the saved operation."); }
      if (id(purchase.Vendor_Invoice) && id(purchase.Vendor_Invoice) !== plan.invoiceId) { throw new Error("The card purchase now links to a different invoice."); }
      await ns.cardPurchaseSettlements.validate(api, purchase, id(plan.invoice.Supplier_Settlement));
      var invoiceId = await ns.ensureQuickInvoiceRecord(zoho, "Supplier_Invoices", "card-" + purchaseId, plan.invoice);
      plan.invoiceId = invoiceId; save(plan);
      var settlementId = id(plan.invoice.Supplier_Settlement);
      var allocationId = await ns.ensureQuickInvoiceRecord(zoho, "Inv_Set_Allocations", invoiceId + "-" + settlementId, { Name: invoiceId + "-" + settlementId, Vendor_Invoice: { id: invoiceId }, Vendor_Settlement: { id: settlementId }, Allocated_Amount: plan.invoice.Total_Payable_Amount, Allocation_Date: plan.invoice.Invoice_Date, Currency: plan.invoice.Currency, Status: "Active", Allocation_Source: "Manual" });
      await ns.validateQuickInvoiceAllocation(zoho, invoiceId, settlementId, plan.invoice.Total_Payable_Amount, plan.invoice.Currency, allocationId);
      if (plan.serviceId && !plan.refund) { await ns.ensureQuickInvoiceRecord(zoho, "Supplier_Invoice_Lines", invoiceId + "-" + plan.serviceId, { Name: (plan.invoice.Name + " - card purchase").slice(0,120), Supplier_Invoice: { id: invoiceId }, Booking_Service: { id: plan.serviceId }, Amount: plan.invoice.Total_Payable_Amount, Service_Date: plan.invoice.Invoice_Date, Line_Type: "Service", Currency: plan.invoice.Currency }); }
      var changes = { Settlement: { id: settlementId }, Vendor_Invoice: { id: invoiceId }, Invoice_Number: plan.invoice.Name, Accounting_Status: plan.refund ? "Pending refund record" : "Pending payment record", Review_Notes: plan.notes };
      response = await api.updateRecord({ Entity: "Card_Purchases", APIData: Object.assign({ id: purchaseId }, changes), Trigger: [] });
      var result = response && response.data && response.data[0];
      if (!result || result.code !== "SUCCESS" && result.status !== "success") { throw new Error("Invoice saved; the card purchase link is pending. Retry this operation."); }
      await ns.completeQuickInvoice(zoho, invoiceId);
      storage.removeItem(key);
      return { invoiceId: invoiceId, changes: changes };
    }
    try { return await (global.navigator && global.navigator.locks ? global.navigator.locks.request(key, run) : run()); }
    finally { busy.delete(purchaseId); }
  };
}(window));
