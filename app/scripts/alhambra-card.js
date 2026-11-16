(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var supplier = "616617000003010705", commissionSupplier = "616617000003265040";
  function id(value) { return String(value && value.id || ""); }
  function cents(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || Math.abs(number * 100 - Math.round(number * 100)) > .000001) { throw Error("Review the invoice and card amounts."); }
    return Math.round(number * 100);
  }
  async function get(api, module, recordId) {
    var result = await api.getRecord({Entity:module, RecordID:recordId}), record = result && result.data && result.data[0];
    if (!record || id(record) !== recordId) { throw Error("Could not read " + module + ". Reopen this card movement."); }
    return record;
  }
  function key(purchase) { return "card-" + id(purchase) + "-commission"; }
  function linkKey(purchase) { return "accounting-manager:alhambra-commission-id:" + id(purchase); }
  function eligible(purchase) { return id(purchase.Supplier) === supplier && purchase.Transaction_Type === "Purchase"; }
  async function context(zoho, purchase, storage, knownId, includeUnsplit) {
    if (!eligible(purchase) || !id(purchase.Vendor_Invoice)) { return null; }
    var api = zoho.CRM.API, invoice = await get(api, "Supplier_Invoices", id(purchase.Vendor_Invoice));
    if (id(invoice.Supplier) !== supplier || id(invoice.Booking) !== id(purchase.Booking) || (invoice.Currency || "EUR") !== (purchase.Currency || "EUR") ||
        invoice.Locked__s || invoice.Edit_Status === "Pending" || !["Received","Partially Paid","Paid"].includes(invoice.Status) ||
        invoice.Invoice_Type === "Credit Note" || invoice.Registration_Key && invoice.Registration_Status !== "Complete") { throw Error("The Alhambra invoice does not match this card movement or its registration is unfinished."); }
    var base = cents(invoice.Total_Payable_Amount == null ? invoice.Invoice_Total : invoice.Total_Payable_Amount);
    var total = cents(purchase.Amount), difference = total - base;
    if (difference <= 0) { return includeUnsplit ? {invoice:invoice, base:base, total:total, difference:difference} : null; }
    var confirmedId = knownId || storage && storage.getItem(linkKey(purchase));
    var response;
    if (confirmedId) {
      response = {data:[await get(api, "Supplier_Invoices", String(confirmedId))]};
    } else {
    try { response = await api.searchRecord({Entity:"Supplier_Invoices", Type:"criteria", Query:"(Registration_Key:equals:" + key(purchase) + ")", page:1, per_page:200}); }
    catch (error) { if (Number(error.status) !== 204 && error.code !== "NO_CONTENT") { throw error; } response = {data:[]}; }
    if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { response = {data:[]}; }
    }
    if (!response || !Array.isArray(response.data) || response.data.length > 1 || response.info && response.info.more_records) { throw Error("Could not uniquely identify the Iacpos invoice."); }
    var commission = response.data[0] || null;
    if (commission) {
      commission = await get(api, "Supplier_Invoices", id(commission));
      if (commission.Registration_Key !== key(purchase) || id(commission.Supplier) !== commissionSupplier || id(commission.Booking) !== id(purchase.Booking) ||
          (commission.Currency || "EUR") !== (purchase.Currency || "EUR") || commission.Locked__s || commission.Edit_Status === "Pending" ||
          !["Received","Partially Paid","Paid"].includes(commission.Status) || commission.Invoice_Type === "Credit Note" ||
          cents(commission.Total_Payable_Amount) !== difference) { throw Error("The Iacpos invoice changed or does not match this charge. Review it before continuing."); }
      if (storage) { storage.setItem(linkKey(purchase), id(commission)); }
    }
    var commissionPurchase = Object.assign({}, purchase, {Supplier:{id:commissionSupplier}, Settlement:commission && commission.Supplier_Settlement || null});
    var settlements = await ns.cardPurchaseSettlements.load(api, commissionPurchase);
    return {purchase:purchase, invoice:invoice, base:base, total:total, difference:difference, commission:commission, settlements:settlements, commissionPurchase:commissionPurchase};
  }
  async function save(zoho, storage, purchaseId, input) {
    var api = zoho.CRM.API, purchase = await get(api, "Card_Purchases", String(purchaseId));
    if (purchase.Locked__s || id(purchase.Vendor_Payment) || ["Cancelled","Discarded","Purchase recorded"].includes(purchase.Accounting_Status)) { throw Error("This card movement is closed or already linked to a payment."); }
    var ctx = await context(zoho, purchase, storage);
    if (!ctx) { return ""; }
    var recoveryKey = "accounting-manager:alhambra-commission:" + purchaseId;
    if (ctx.commission && ctx.commission.Registration_Status === "Complete") { storage.removeItem(recoveryKey); return id(ctx.commission); }
    var plan = JSON.parse(storage.getItem(recoveryKey) || "null");
    if (plan && !ctx.commission && plan.invoice.Invoice_Type === "Commission") {
      plan.invoice.Invoice_Type = "Final Invoice";
      plan.invoice.Name = plan.invoice.Name.replace(/^COMM-/, "INV-");
      var revised = JSON.stringify(plan); storage.setItem(recoveryKey, revised);
      if (storage.getItem(recoveryKey) !== revised) { throw Error("Could not save the revised final invoice request."); }
    }
    if (!plan) {
      var reference = String(input.reference || "").trim(), date = String(input.date || ""), vat = Number(input.vat == null ? 0 : input.vat);
      if (!reference || reference.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date ||
          !Number.isFinite(vat) || vat < 0 || vat > 100 || Math.abs(vat*100-Math.round(vat*100)) > .000001) { throw Error("Enter a valid Iacpos invoice reference and date. VAT is optional; use a percentage between 0 and 100."); }
      await ns.cardPurchaseSettlements.validate(api, ctx.commissionPurchase, String(input.settlementId || ""));
      var vendor = await get(api, "Vendors", commissionSupplier);
      var gross = ctx.difference / 100, net = Math.round(gross / (1 + vat/100) * 100)/100;
      plan = {baseInvoiceId:id(ctx.invoice), total:ctx.total, invoice:{
        Name:reference, Supplier:{id:commissionSupplier}, Supplier_Name:vendor.Vendor_Name || "Iacpos", Supplier_Code:vendor.TP_Reference || "IACPOS",
        Booking:{id:id(purchase.Booking)}, Supplier_Settlement:{id:String(input.settlementId || "")}, Currency:purchase.Currency || "EUR",
        Invoice_Date:date, Invoice_Amount_Excl_VAT:net, Invoice_Amount_Incl_VAT:gross, VAT_percentage:vat,
        VAT_Amount:Math.round((gross-net)*100)/100, Invoice_Total:gross, Total_Payable_Amount:gross,
        Amount_Paid:0, Status:"Received", Invoice_Type:"Final Invoice", Registration_Status:"Pending"
      }};
      var raw = JSON.stringify(plan); storage.setItem(recoveryKey, raw);
      if (storage.getItem(recoveryKey) !== raw) { throw Error("Could not save commission recovery information."); }
    }
    if (plan.baseInvoiceId !== id(ctx.invoice) || plan.total !== ctx.total || cents(plan.invoice.Total_Payable_Amount) !== ctx.difference ||
        id(plan.invoice.Booking) !== id(purchase.Booking) || plan.invoice.Currency !== (purchase.Currency || "EUR")) { throw Error("The saved commission no longer matches the card movement."); }
    await ns.cardPurchaseSettlements.validate(api, ctx.commissionPurchase, id(plan.invoice.Supplier_Settlement));
    var invoiceId = await ns.ensureQuickInvoiceRecord(zoho, "Supplier_Invoices", key(purchase), plan.invoice);
    storage.setItem(linkKey(purchase), invoiceId);
    if (storage.getItem(linkKey(purchase)) !== invoiceId) { throw Error("Could not retain the confirmed commission invoice ID. Retry this operation."); }
    var settlementId = id(plan.invoice.Supplier_Settlement);
    var allocationId = await ns.ensureQuickInvoiceRecord(zoho, "Inv_Set_Allocations", invoiceId + "-" + settlementId, {
      Name:invoiceId + "-" + settlementId, Vendor_Invoice:{id:invoiceId}, Vendor_Settlement:{id:settlementId},
      Allocated_Amount:ctx.difference/100, Allocation_Date:plan.invoice.Invoice_Date, Currency:plan.invoice.Currency, Status:"Active", Allocation_Source:"Manual"
    });
    await ns.validateQuickInvoiceAllocation(zoho, invoiceId, settlementId, ctx.difference/100, plan.invoice.Currency, allocationId);
    await ns.completeQuickInvoice(zoho, invoiceId);
    var confirmed = await get(api, "Supplier_Invoices", invoiceId);
    if (confirmed.Registration_Status !== "Complete") { throw Error("The commission invoice is saved but its completion is unconfirmed. Retry this operation."); }
    storage.removeItem(recoveryKey);
    return invoiceId;
  }
  ns.alhambraCard = {eligible:eligible, context:context, save:save, commissionSupplier:commissionSupplier};
  ns.alhambraCard.suggestAmount = async function (zoho, purchase) {
    if (!eligible(purchase) || id(purchase.Vendor_Invoice)) { return null; }
    var choices = await ns.cardPurchaseSettlements.load(zoho.CRM.API, Object.assign({}, purchase, {Supplier:{id:commissionSupplier}, Settlement:null}));
    if (choices.records.length !== 1) { return null; }
    var settlement = choices.records[0], fee = Number(settlement.Total_Service_Cost);
    // A booking-wide fee is only a starting point for a new, uninvoiced settlement.
    if (Number(settlement.Total_Invoice || 0) !== 0 || !Number.isFinite(fee) || fee <= 0) { return null; }
    var total = cents(purchase.Amount), commission = cents(fee);
    if (commission >= total) { return null; }
    return {base:total-commission, difference:commission, total:total, settlement:settlement};
  };
  var generation = 0, loading, currentId = "", currentContext, currentError;
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function money(value, currency) { return new Intl.NumberFormat("en-GB", {style:"currency", currency:currency || "EUR"}).format(value/100); }
  ns.alhambraCard.render = function (purchase, action) {
    var host = document.getElementById("card-alhambra-commission"), token = ++generation;
    currentId = id(purchase); currentContext = null; currentError = null; loading = null;
    host.hidden = !eligible(purchase); host.replaceChildren();
    var amountLabel = document.getElementById("card-purchase-amount-label");
    if (amountLabel) { amountLabel.textContent = eligible(purchase) ? "Alhambra tickets only (incl. VAT)" : "Amount incl. VAT"; }
    if (host.hidden) { return; }
    if (!id(purchase.Vendor_Invoice)) {
      host.innerHTML = '<h4>1. Create the Alhambra ticket invoice</h4><p>Enter only the Alhambra ticket amount above, excluding the Iacpos booking fee. Do not enter the combined card charge.</p><p><strong>2. Create the Iacpos invoice and record payment</strong><br>The next step creates a separate Iacpos invoice for the difference, then allocates one card payment to both invoices.</p><p data-suggestion role="status">Checking the Iacpos settlement for a suggested amount...</p>';
      var amount = document.getElementById("card-purchase-amount"), initial = amount.value, edited = false;
      function changed() { edited = true; }
      amount.addEventListener("input", changed);
      var pending = global.localStorage.getItem("accounting-manager-card-invoice-v1-" + id(purchase));
      loading = ns.alhambraCard.suggestAmount(global.ZOHO, purchase).then(function (suggestion) {
        if (token !== generation) { return; }
        var note = host.querySelector("[data-suggestion]");
        if (!suggestion) { note.textContent = "No unambiguous Iacpos amount is available. Enter the Alhambra ticket amount from its invoice."; return; }
        if (!edited && amount.value === initial && !pending && !document.getElementById("card-purchase-workflow-modal").hidden) { amount.value = (suggestion.base/100).toFixed(2); }
        note.textContent = "Suggested Alhambra amount: " + money(suggestion.base,purchase.Currency) + " = card charge " + money(suggestion.total,purchase.Currency) + " minus Iacpos " + money(suggestion.difference,purchase.Currency) + " from settlement " + (suggestion.settlement.Name || "") + ". This is the booking's fee; check it if the charge covers only part of the booking. You can edit the amount.";
      }).catch(function () {
        if (token === generation) { host.querySelector("[data-suggestion]").textContent = "Could not load the suggested amount. Enter the Alhambra ticket amount from its invoice, excluding Iacpos."; }
      }).finally(function () { amount.removeEventListener("input", changed); });
      return loading;
    }
    host.innerHTML = '<p role="status">Loading Alhambra and Iacpos breakdown…</p>';
    loading = context(global.ZOHO, purchase, global.localStorage, null, true).then(function (ctx) {
      if (token !== generation) { return; }
      currentContext = ctx;
      if (!ctx) { host.hidden = true; return; }
      var currency = purchase.Currency || "EUR";
      if (ctx.difference <= 0) {
        currentContext = null;
        host.innerHTML = '<h4>Invoice & payment breakdown</h4><dl>' +
          '<div><dt>Alhambra invoice</dt><dd>' + esc(money(ctx.base,currency)) + '</dd></div>' +
          '<div><dt>Card charge</dt><dd>' + esc(money(ctx.total,currency)) + '</dd></div>' +
          (ctx.difference === 0 ? '<div><dt>Iacpos difference</dt><dd>' + esc(money(0,currency)) + '</dd></div>' : '') + '</dl><p>' +
          (ctx.difference === 0 ? 'The Alhambra invoice equals the full card charge, so there is no remaining amount for Iacpos. If this charge includes an Iacpos fee, correct the Alhambra invoice to the actual ticket amount and reopen this card movement before recording payment.' :
            'The Alhambra invoice exceeds the card charge. Review the invoice and card amounts before assigning an Iacpos fee.') + '</p>';
        return;
      }
      var saved = JSON.parse(global.localStorage.getItem("accounting-manager:alhambra-commission:" + id(purchase)) || "null");
      var commission = ctx.commission || saved && saved.invoice;
      host.innerHTML = '<h4>Invoice & payment breakdown</h4><div class="card-supplier-breakdown">' +
        [{name:"Alhambra", amount:ctx.base, note:"Existing ticket invoice"},
          {name:"Iacpos", amount:ctx.difference, note:ctx.commission ? "Final invoice · booking fee" : "Final invoice to create · booking fee"}].map(function (part) {
          return '<section class="card-commission-amount" aria-label="' + esc(part.name) + ' invoice and payment"><h5>' + esc(part.name) +
            '</h5><small>' + esc(part.note) + '</small><dl><div><dt>Invoice total</dt><dd>' + esc(money(part.amount,currency)) +
            '</dd></div><div><dt>Payment allocation</dt><dd>' + esc(money(part.amount,currency)) + '</dd></div></dl></section>';
        }).join("") + '</div><div class="card-split-payment-total"><span>One card payment</span><strong>' + esc(money(ctx.total,currency)) +
        '</strong><small>' + esc(money(ctx.base,currency)) + ' Alhambra + ' + esc(money(ctx.difference,currency)) +
        ' Iacpos. Invoice totals include any applicable VAT.</small></div>';
      if (ctx.commission && ctx.commission.Registration_Status === "Complete") {
        if (action === "payment") { document.getElementById("card-purchase-workflow-submit").textContent = "Record payment"; }
        host.innerHTML += '<p>Commission invoice: <strong>' + esc(ctx.commission.Name) + '</strong></p><p>One card payment will be allocated to both suppliers’ invoices.</p>';
      } else if (action === "payment") {
        document.getElementById("card-purchase-workflow-submit").textContent = "Create commission invoice & record payment";
        host.innerHTML += '<fieldset class="card-purchase-workflow-fields" data-commission-fields><legend>Iacpos invoice details</legend>' +
          '<label class="field"><span>Final invoice reference</span><input data-commission-reference maxlength="120" value="' + esc(commission && commission.Name || "INV-" + (purchase.MFSP_Reference || id(purchase)) + "-IACPOS-" + id(purchase).slice(-6)) + '"></label>' +
          '<label class="field"><span>Invoice date</span><input data-commission-date type="date" required aria-required="true" value="' + esc(commission && commission.Invoice_Date || "") + '"></label>' +
          '<label class="field"><span>VAT % (if applicable)</span><input data-commission-vat type="number" min="0" max="100" step="0.01" placeholder="0" value="' + esc(commission ? commission.VAT_percentage : 0) + '"><small>Leave at 0 unless the receipt includes VAT.</small></label>' +
          '<label class="field"><span>Iacpos settlement</span><select data-commission-settlement><option value="">Select settlement</option>' +
          ctx.settlements.records.map(function (row) { return '<option value="' + esc(id(row)) + '">' + esc(row.Name || id(row)) + '</option>'; }).join("") +
          '</select></label></fieldset>';
        host.querySelector("[data-commission-settlement]").value = commission ? id(commission.Supplier_Settlement) : ctx.settlements.selectedId;
        if (saved || ctx.commission) { host.querySelector("fieldset").disabled = true; }
        if (!ctx.settlements.records.length) { host.innerHTML += '<p role="alert">No available Iacpos settlement was found for this booking. Recalculate its settlements before continuing.</p>'; }
      }
      if (ctx.commission) {
        var associated = document.getElementById("card-purchase-associated-invoices");
        associated.innerHTML = '<h4>Associated invoices (2)</h4><p>' + esc(ctx.invoice.Name) + '</p><p>' + esc(ctx.commission.Name) + ' · Iacpos</p>';
      }
    }).catch(function (error) {
      if (token !== generation) { return; }
      currentError = error; host.textContent = error.message;
    });
    return loading;
  };
  ns.alhambraCard.beforePayment = async function (purchase) {
    if (!eligible(purchase)) { return; }
    if (currentId !== id(purchase)) { throw Error("Reopen the card movement to review its commission."); }
    await loading;
    if (currentError) { throw currentError; }
    if (!currentContext) { return; }
    if (currentContext.commission && currentContext.commission.Registration_Status === "Complete") {
      global.localStorage.removeItem("accounting-manager:alhambra-commission:" + id(purchase));
      return id(currentContext.commission);
    }
    var host = document.getElementById("card-alhambra-commission");
    function value(name) { var field = host.querySelector("[data-commission-" + name + "]"); return field ? field.value : ""; }
    var input = {reference:value("reference"), date:value("date"), vat:value("vat"), settlementId:value("settlement")};
    var fields = host.querySelector("fieldset");
    if (fields) { fields.disabled = true; }
    try { return await save(global.ZOHO, global.localStorage, id(purchase), input); }
    finally { ns.alhambraCard.render(purchase, "payment"); }
  };
}(window));
