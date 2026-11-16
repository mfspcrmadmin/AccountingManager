(function (global) {
  "use strict";

  var MODULES = { purchases: "Card_Purchases", invoices: "Supplier_Invoices", payments: "Supplier_Payments", invoiceLines: "Supplier_Invoice_Lines", invoiceSettlements: "Inv_Set_Allocations" };
  var CREATE_PAYMENT_FUNCTION = "createsupplierpaymentfrominvoices";
  var records = [], page = 1, activePurchase = null, busy = false, cardPurchaseView = "open", cardPurchaseOwnerId = "", cardPurchaseAppliedFilters = { mfsp: "", supplierCode: "", search: "", statuses: [], types: [], ownerId: "" };
  var selectedType = "prepayments", sort = { key: "Transaction_Date", direction: "desc" };
  var sources = { prepayments: { title: "Supplier prepayments", crm: true }, renfe: { title: "RENFE payments", functionName: "creator_getrenfepayments", responseKey: "records" }, "card-purchases": { title: "Card purchases", cards: true } };
  var $ = function (id) { return document.getElementById(id); };
  var search = $("operations-filter-search"), status = $("operations-filter-status"), dateFrom = $("operations-filter-from"), dateTo = $("operations-filter-to"), apply = $("operations-apply-filters"), reset = $("operations-reset-filters"), filters = $("operations-filters");
  var toolbar = $("card-purchases-toolbar"), cardFilter = $("card-purchases-card-filter"), cardMfspFilter = $("card-purchases-mfsp-filter"), cardSupplierCodeFilter = $("card-purchases-supplier-code-filter"), cardStatus = $("card-purchases-status-filter"), cardStatusMenu = $("card-purchases-status-menu"), cardStatusLabel = $("card-purchases-status-filter-label"), cardStatusOptions = Array.prototype.slice.call(document.querySelectorAll("[data-card-purchase-status-option]")), cardStatusToggleAll = document.querySelector("[data-card-purchase-status-toggle-all]"), cardType = $("card-purchases-type-filter"), cardTypeMenu = $("card-purchases-type-menu"), cardTypeLabel = $("card-purchases-type-filter-label"), cardTypeOptions = Array.prototype.slice.call(document.querySelectorAll("[data-card-purchase-type-option]")), cardTypeToggleAll = document.querySelector("[data-card-purchase-type-toggle-all]"), cardOwner = $("card-purchases-owner-filter"), cardOwnerMenu = $("card-purchases-owner-menu"), cardOwnerLabel = $("card-purchases-owner-filter-label"), cardApplyFilters = $("card-purchases-apply-filters"), cardResetFilters = $("card-purchases-reset-filters"), refresh = $("card-purchases-refresh"), title = $("operations-title"), empty = $("operations-empty"), tableWrap = $("operations-table-wrap"), tableHead = $("operations-table-head"), tableBody = $("operations-table-body"), pagination = $("operations-pagination-bar"), paginationCopy = $("operations-pagination-copy"), previous = $("operations-prev-page"), next = $("operations-next-page");
  var modal = $("card-purchase-workflow-modal"), workflowForm = $("card-purchase-workflow-form"), workflowTitle = $("card-purchase-workflow-title"), workflowEyebrow = $("card-purchase-workflow-eyebrow"), workflowContext = $("card-purchase-workflow-context"), workflowMessage = $("card-purchase-workflow-message"), workflowSpinner = $("card-purchase-workflow-spinner"), workflowInvoiceFields = $("card-purchase-workflow-invoice-fields"), workflowPaymentFields = $("card-purchase-workflow-payment-fields"), workflowReference = $("card-purchase-reference"), workflowReferenceLabel = $("card-purchase-reference-label"), workflowDate = $("card-purchase-date"), workflowDateLabel = $("card-purchase-date-label"), workflowAmount = $("card-purchase-amount"), workflowVat = $("card-purchase-vat"), workflowPaymentReference = $("card-purchase-payment-reference"), workflowPaymentDate = $("card-purchase-payment-date"), workflowPaymentAccount = $("card-purchase-payment-account"), workflowNotes = $("card-purchase-review-notes"), workflowSubmit = $("card-purchase-workflow-submit"), workflowNeedsReview = $("card-purchase-workflow-needs-review"), workflowActions = document.querySelector("#card-purchase-workflow-form .card-purchase-workflow-actions");
  var typeCards = Array.prototype.slice.call(document.querySelectorAll("[data-operation-type]")), cardPurchaseViewButtons = Array.prototype.slice.call(document.querySelectorAll("[data-card-purchase-view]"));
  var workflowService = $("card-purchase-workflow-service"), workflowServiceRequest = 0;
  var serviceEdit = $("card-purchase-service-edit"), serviceMessage = $("card-purchase-service-message"), editingService = false, serviceChoices = [], selectedServiceId = "";
  var workflowInvoiceType = $("card-purchase-invoice-type");
  var workflowSettlement = $("card-purchase-settlement"), workflowSettlementMessage = $("card-purchase-settlement-message"), settlementGeneration = 0, settlementLoading = false;
  var workflowSettlementSummary = $("card-purchase-settlement-summary"), summaryGeneration = 0;
  async function renderCardSettlementSummary() {
    if (!workflowSettlementSummary || !activePurchase) { return; }
    var purchase = activePurchase, token = ++summaryGeneration;
    var settlementId = purchase._action === "invoice" ? workflowSettlement.value : lookupId(purchase.Settlement);
    workflowSettlementSummary.innerHTML = '<p class="card-reading-loading" role="status">Loading settlement…</p>';
    try {
      if (!settlementId && purchase._action !== "invoice" && lookupId(purchase.Vendor_Invoice)) {
        var response = await api().getRecord({ Entity: MODULES.invoices, RecordID: lookupId(purchase.Vendor_Invoice) });
        var invoice = response && response.data && response.data[0];
        if (!invoice) { throw new Error("The associated invoice could not be loaded."); }
        settlementId = lookupId(invoice.Supplier_Settlement);
      }
      if (token !== summaryGeneration || activePurchase !== purchase) { return; }
      if (!settlementId) {
        workflowSettlementSummary.textContent = "No settlement associated yet. Select a settlement or link an invoice to see its totals.";
        return;
      }
      var record = await global.AccountingManagerApp.cardPurchaseSettlements.validate(api(), purchase, settlementId);
      if (token !== summaryGeneration || activePurchase !== purchase) { return; }
      function amount(value) { return value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value); }
      var cost = amount(record.Total_Service_Cost), invoiced = amount(record.Total_Invoice), paid = amount(record.Total_Paid);
      var pendingInvoice = cost == null || invoiced == null ? null : Math.round((cost - invoiced) * 100) / 100;
      var pendingPayment = invoiced == null || paid == null ? null : Math.round((invoiced - paid) * 100) / 100;
      var format = new Intl.NumberFormat("en-GB", { style: "currency", currency: record.Currency || purchase.Currency || "EUR" });
      workflowSettlementSummary.innerHTML = '<p>' + esc(record.Name || record.id) + '</p><div class="invoice-create-summary-grid">' + [
        ["Pending invoicing", pendingInvoice, true], ["Total service cost", cost], ["Already invoiced", invoiced],
        ["Total paid", paid], ["Unpaid invoiced amount", pendingPayment]
      ].map(function (item) {
        return '<div class="invoice-create-summary-item' + (item[2] && item[1] != null ? ' invoice-create-summary-item-highlight' : '') + '"><span>' + item[0] + '</span><strong>' + (item[1] == null ? '<span class="card-reading-missing" tabindex="0" title="This amount is not available in CRM" aria-label="Amount unavailable in CRM">—</span>' : esc(format.format(item[1]))) + '</strong></div>';
      }).join('') + '</div>';
    } catch (error) {
      if (token === summaryGeneration && activePurchase === purchase) { workflowSettlementSummary.innerHTML = '<div class="card-reading-error" role="alert"><p>Could not load settlement.</p><details><summary>Details</summary><p>' + esc(error.message || "Please retry.") + '</p></details><button type="button" class="button secondary" data-card-totals-retry>Retry</button></div>'; }
    }
  }
  if (workflowSettlementSummary) { workflowSettlementSummary.addEventListener("click", function (event) { if (event.target.closest("[data-card-totals-retry]")) { renderCardSettlementSummary(); } }); }
  if (workflowSettlement) { workflowSettlement.addEventListener("change", renderCardSettlementSummary); }
  async function populateSettlements(purchase) {
    var token = ++settlementGeneration;
    settlementLoading = true; workflowSettlement.disabled = true; workflowSettlement.value = "";
    workflowSettlement.innerHTML = '<option value="">Loading settlements…</option>';
    workflowSettlementMessage.textContent = "";
    try {
      var result = await global.AccountingManagerApp.cardPurchaseSettlements.load(api(), purchase);
      if (token !== settlementGeneration || activePurchase !== purchase) { return; }
      workflowSettlement.innerHTML = '<option value="">Select settlement</option>' + result.records.map(function (record) { return '<option value="' + esc(record.id) + '">' + esc(record.Name || record.id) + '</option>'; }).join('');
      workflowSettlement.value = result.selectedId;
      renderCardSettlementSummary();
      workflowSettlement.disabled = isRecordedPurchase(purchase) || !result.records.length;
      workflowSettlementMessage.textContent = !result.records.length ? "No settlement matches this supplier and booking." : !result.selectedId ? "Several settlements match. Select the one for this invoice." : "";
    } catch (error) {
      if (token !== settlementGeneration || activePurchase !== purchase) { return; }
      workflowSettlement.innerHTML = '<option value="">Settlement unavailable</option>';
      workflowSettlementMessage.textContent = error.message || "Could not load settlements. Reopen the form to retry.";
      if (workflowSettlementSummary) { workflowSettlementSummary.textContent = workflowSettlementMessage.textContent; }
    } finally { if (token === settlementGeneration) { settlementLoading = false; } }
  }
  var invoiceNameDefault = global.AccountingManagerApp.createInvoiceNameDefault(workflowReference, api, function (error) { setMessage("Could not suggest an invoice number: " + error.message, true); });
  function updateInvoiceNameDefault() {
    if (!activePurchase || activePurchase._action !== "invoice") { return; }
    return invoiceNameDefault.update({ type: workflowInvoiceType.value, supplierId: lookupId(activePurchase.Supplier), supplierCode: activePurchase.Supplier_Code, bookingId: lookupId(activePurchase.Booking), mfsp: activePurchase.MFSP_Reference });
  }
  workflowInvoiceType.addEventListener("change", updateInvoiceNameDefault);
  workflowInvoiceType.addEventListener("change", function () { workflowDate.value = global.AccountingManagerApp.defaultInvoiceDate(workflowInvoiceType.value); });

  global.AccountingManagerApp = global.AccountingManagerApp || {};
  global.AccountingManagerApp.operationsDocuments = { files: files, preview: previewFile };
  var prepayments = global.AccountingManagerApp && global.AccountingManagerApp.createPrepaymentsWorkspace
    ? global.AccountingManagerApp.createPrepaymentsWorkspace($("prepayments-workspace"), global.ZOHO) : null;
  var reportGeneration = 0, ministryActive = false;

  async function loadWorkflowService(purchase) {
    var request = ++workflowServiceRequest;
    var serviceId = lookupId(purchase && purchase.Boking_Service);
    if (!workflowService) { return; }
    $("card-purchase-services-count").textContent = serviceId ? "(1)" : "(0)";
    $("card-purchase-services-count").setAttribute("aria-label", serviceId ? "1 service" : "0 services");
    $("card-purchase-services-total").textContent = "";
    workflowService.hidden = false;
    serviceEdit.hidden = editingService || !canEditService();
    workflowService.innerHTML = '<p>' + (serviceId ? 'Loading service…' : 'No associated service.') + '</p>';
    if (!serviceId) { return; }
    try {
      var service = responseRecords(await api().getRecord({ Entity: "Booking_Services", RecordID: serviceId }))[0];
      if (request !== workflowServiceRequest || activePurchase !== purchase) { return; }
      if (!service) { throw new Error("Service not available"); }
      $("card-purchase-services-total").textContent = service.Total_Purchase_Price != null && service.Total_Purchase_Price !== '' && Number.isFinite(Number(service.Total_Purchase_Price)) ? 'Total ' + money(service.Total_Purchase_Price) : 'Total unavailable';
      workflowService.innerHTML = '<ul><li>' + serviceContent(service) + '</li></ul>';
    } catch (error) {
      if (request !== workflowServiceRequest || activePurchase !== purchase) { return; }
      workflowService.innerHTML = '<p>The associated service could not be loaded.</p>';
    }
  }

  function canEditService() {
    var services = global.AccountingManagerApp.cardPurchaseServices;
    return activePurchase && activePurchase._action === "invoice" && services && services.editable(activePurchase);
  }
  function serviceContent(service) {
    var price = service.Total_Purchase_Price;
    return '<div class="card-reading-service-name"><strong>' + esc(service.Product_Description || service.Name || 'Service') + '</strong><span>' + esc(date(service.Service_Date)) + '</span></div><div class="prepayment-service-price"><span>Total purchase price</span><strong>' + esc(price == null || price === '' ? '—' : money(price)) + '</strong></div>';
  }
  function setServiceMessage(text, error) {
    serviceMessage.textContent = text || ""; serviceMessage.hidden = !text;
    serviceMessage.classList.toggle("is-error", Boolean(error));
  }
  function renderServiceEditor() {
    serviceEdit.hidden = true;
    workflowService.innerHTML = '<p>Choose one service for this supplier and booking.</p><ul>' + serviceChoices.map(function (service) {
      var selected = lookupId(service) === selectedServiceId;
      return '<li class="prepayment-service-choice"><label><input type="radio" name="card-purchase-service" data-card-service-choice="' + esc(service.id) + '"' + (selected ? ' checked' : '') + '><span>' + (selected ? 'Included' : 'Not included') + '</span></label>' + serviceContent(service) + '</li>';
    }).join('') + '</ul>' + (!serviceChoices.length ? '<p>No services found for this supplier and booking.</p>' : '') + '<div class="prepayment-service-actions"><button type="button" class="button" data-card-service-save' + (!serviceChoices.some(function (service) { return lookupId(service) === selectedServiceId; }) ? ' disabled' : '') + '>Save service</button><button type="button" class="button tertiary" data-card-service-cancel>Cancel</button></div>';
  }
  async function editService(event) {
    event.preventDefault(); event.stopPropagation();
    if (busy || !canEditService()) { return; }
    var purchase = activePurchase, token = ++workflowServiceRequest;
    busy = true; serviceEdit.disabled = true; workflowSubmit.disabled = true; workflowNeedsReview.disabled = true;
    $("card-purchase-services").open = true; setServiceMessage("Loading services…");
    try {
      var choices = await global.AccountingManagerApp.cardPurchaseServices.load(api(), purchase);
      if (activePurchase !== purchase || token !== workflowServiceRequest) { return; }
      serviceChoices = choices; selectedServiceId = lookupId(purchase.Boking_Service); editingService = true;
      renderServiceEditor(); setServiceMessage("");
    } catch (error) { if (activePurchase === purchase) { setServiceMessage(error.message || "Could not load services.", true); } }
    finally { busy = false; serviceEdit.disabled = false; workflowSubmit.disabled = editingService; workflowNeedsReview.disabled = editingService; }
  }
  async function saveService() {
    if (busy || !editingService || !canEditService()) { return; }
    var purchase = activePurchase;
    busy = true; setServiceMessage("Saving service…");
    workflowService.querySelectorAll("button, input").forEach(function (control) { control.disabled = true; });
    try {
      var service = await global.AccountingManagerApp.cardPurchaseServices.save(api(), purchase, selectedServiceId);
      purchase.Boking_Service = { id: lookupId(service), name: service.Name || lookupId(service) };
      records.forEach(function (record) { if (record.id === purchase.id) { record.Boking_Service = purchase.Boking_Service; } });
      editingService = false; await loadWorkflowService(purchase); setServiceMessage("Associated service updated.");
    } catch (error) { renderServiceEditor(); setServiceMessage(error.message || "Could not save the associated service.", true); }
    finally { busy = false; workflowSubmit.disabled = editingService; workflowNeedsReview.disabled = editingService; }
  }
  serviceEdit.addEventListener("click", editService);
  workflowService.addEventListener("change", function (event) {
    if (busy || !editingService || !event.target.hasAttribute("data-card-service-choice")) { return; }
    selectedServiceId = event.target.getAttribute("data-card-service-choice");
    // Keep focus on the selected radio while updating labels and the save action.
    workflowService.querySelectorAll("[data-card-service-choice]").forEach(function (input) { input.nextElementSibling.textContent = input.checked ? "Included" : "Not included"; });
    workflowService.querySelector("[data-card-service-save]").disabled = false;
  });
  workflowService.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button || busy || !editingService) { return; }
    if (button.hasAttribute("data-card-service-save")) { saveService(); }
    if (button.hasAttribute("data-card-service-cancel")) {
      editingService = false; selectedServiceId = ""; setServiceMessage("");
      workflowSubmit.disabled = false; workflowNeedsReview.disabled = false;
      loadWorkflowService(activePurchase); serviceEdit.focus();
    }
  });

  function esc(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
  function lookupId(value) { return value && typeof value === "object" ? String(value.id || "") : ""; }
  function lookupName(value) { return value && typeof value === "object" ? String(value.name || value.Name || "") : String(value || ""); }
  function isoDate(value) { var match = String(value || "").match(/\d{4}-\d{2}-\d{2}/); return match ? match[0] : ""; }
  function date(value) { var result = isoDate(value); return result ? result.split("-").reverse().join("/") : "—"; }
  function money(value) { var number = Number(value); return Number.isFinite(number) ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(number) : "—"; }
  function files(value) { return (Array.isArray(value) ? value : value ? [value] : []).map(function (file) { return typeof file === "string" ? { name: "Supporting document", id: file, url: "", type: "" } : { name: file.File_Name__s || file.File_Name || file.file_Name || file.file_name || file.filename || file.fileName || file.name || "Supporting document", id: file.File_Id__s || file.$file_id || file.file_id || file.file_Id || file.File_Id || file.id || "", url: file.url || file.file_url || file.preview_url || file.download_url || "", type: file.type || file.mime_type || file.content_type || "" }; }); }
  function api() { return global.ZOHO && global.ZOHO.CRM && global.ZOHO.CRM.API; }
  function source() { return sources[selectedType]; }
  function responseRecords(response) { return response && Array.isArray(response.data) ? response.data : []; }
  function assertSuccess(response, fallback) { var result = responseRecords(response)[0] || response || {}; var state = String(result.status || result.code || "").toLowerCase(); if (state && state !== "success") { throw new Error(result.message || fallback); } return result; }
  function actionFor(record) {
    var state = String(record.Accounting_Status || ""), refund = record.Transaction_Type === "Refund";
    if (state === "Cancelled") { return null; }
    if (global.localStorage && global.localStorage.getItem("accounting-manager-card-invoice-v1-" + record.id)) { return ["invoice", "Resume invoice"]; }
    if (global.localStorage && global.localStorage.getItem("accounting-manager:card-payment:v1:" + record.id)) { return ["payment", "Resume payment"]; }
    if (state === "Purchase recorded" || state === "Refund recorded") { return null; }
    if (state === "Needs review") { return ["review-done", "Review done"]; }
    if (lookupId(record.Vendor_Payment)) { return ["review", "Review linked payment"]; }
    if (lookupId(record.Vendor_Invoice)) {
      if (refund && (state === "Refund pending" || state === "Needs review")) { return ["refund-ready", "Refund received"]; }
      return ["payment", refund ? "Record card refund" : "Record card payment"];
    }
    if (["", "-None-", "Needs review", "Pending invoice", "Pending credit note", "Pending payment record", "Pending refund record", "Refund pending"].indexOf(state) !== -1) { return ["invoice", refund ? "Review credit note" : "Review invoice"]; }
    return null;
  }
  function badge(value, type) { var statusValue = String(value || "Pending invoice"); var statusClass = { "Pending invoice": "is-pending-invoice", "Pending payment record": "is-pending-payment", "Purchase recorded": "is-purchase-recorded", "Pending credit note": "is-pending-credit-note", "Refund pending": "is-refund-pending", "Pending refund record": "is-pending-refund", "Refund recorded": "is-refund-recorded", "Needs review": "is-needs-review", "Cancelled": "is-cancelled" }[statusValue] || "is-pending"; return '<span class="card-purchase-status ' + (type ? (value === "Refund" ? "is-refund" : "is-purchase") : statusClass) + '">' + esc(statusValue) + "</span>"; }
  function columns() { return [["review", ""], ["Name", "Card purchase"], ["Transaction_Type", "Type"], ["Supplier", "Supplier"], ["Booking", "Booking"], ["Accounting_Status", "Registration status"], ["Transaction_Date", "Transaction date"], ["Amount", "Amount"], ["Card_Payment_Account", "Card"], ["Vendor_Invoice", "Invoice / credit note"], ["Vendor_Payment", "Payment record"], ["Supporting_Documents", "Supporting documents"]]; }
  function sortValue(record, key) { if (key === "Supporting_Documents") { return files(record.Supporting_Documents).map(function (file) { return file.name; }).join(" ").toLowerCase(); } if (key === "Amount") { return Number(record[key]) || 0; } return String(key === "Supplier" || key === "Booking" || key === "Card_Payment_Account" || key === "Vendor_Invoice" || key === "Vendor_Payment" ? lookupName(record[key]) : record[key] || "").toLowerCase(); }
  function isClosedCardPurchase(record) { return record.Accounting_Status === "Purchase recorded" || record.Accounting_Status === "Refund recorded"; }
  function cardPurchaseMatchesView(record) { if (cardPurchaseView === "all") { return true; } if (cardPurchaseView === "closed") { return isClosedCardPurchase(record); } return !isClosedCardPurchase(record) && record.Accounting_Status !== "Cancelled"; }
  function selectedCardPurchaseStatuses() { return cardStatusOptions.filter(function (option) { return option.checked; }).map(function (option) { return option.value; }); }
  function syncCardPurchaseStatusFilter() { var selected = selectedCardPurchaseStatuses(), allSelected = selected.length === cardStatusOptions.length; if (cardStatusToggleAll) { cardStatusToggleAll.checked = allSelected; cardStatusToggleAll.indeterminate = selected.length > 0 && !allSelected; } if (cardStatusLabel) { cardStatusLabel.textContent = !selected.length || allSelected ? "All statuses" : selected.length === 1 ? selected[0] : selected.length + " statuses"; } }
  function selectedCardPurchaseTypes() { return cardTypeOptions.filter(function (option) { return option.checked; }).map(function (option) { return option.value; }); }
  function syncCardPurchaseTypeFilter() { var selected = selectedCardPurchaseTypes(), allSelected = selected.length === cardTypeOptions.length; if (cardTypeToggleAll) { cardTypeToggleAll.checked = allSelected; cardTypeToggleAll.indeterminate = selected.length > 0 && !allSelected; } if (cardTypeLabel) { cardTypeLabel.textContent = !selected.length || allSelected ? "All types" : selected.length === 1 ? selected[0] : selected.length + " types"; } }
  function applyCardPurchaseFilters() { cardPurchaseAppliedFilters = { mfsp: String(cardMfspFilter && cardMfspFilter.value || "").trim().toLowerCase(), supplierCode: String(cardSupplierCodeFilter && cardSupplierCodeFilter.value || "").trim().toLowerCase(), search: String(cardFilter && cardFilter.value || "").trim().toLowerCase(), statuses: selectedCardPurchaseStatuses(), types: selectedCardPurchaseTypes(), ownerId: cardPurchaseOwnerId }; page = 1; render(); }
  function resetCardPurchaseFilters() { if (cardMfspFilter) { cardMfspFilter.value = ""; } if (cardSupplierCodeFilter) { cardSupplierCodeFilter.value = ""; } if (cardFilter) { cardFilter.value = ""; } cardStatusOptions.forEach(function (option) { option.checked = false; }); cardTypeOptions.forEach(function (option) { option.checked = false; }); cardPurchaseOwnerId = ""; syncCardPurchaseStatusFilter(); syncCardPurchaseTypeFilter(); syncOwnerFilter(); applyCardPurchaseFilters(); }
  function filtered() { var query = cardPurchaseAppliedFilters.search, selectedStatus = cardPurchaseAppliedFilters.statuses, selectedType = cardPurchaseAppliedFilters.types, selectedOwner = cardPurchaseAppliedFilters.ownerId; var items = records.filter(function (record) { return !source().cards || (cardPurchaseMatchesView(record) && (!cardPurchaseAppliedFilters.mfsp || String(record.MFSP_Reference || "").toLowerCase().indexOf(cardPurchaseAppliedFilters.mfsp) !== -1) && (!cardPurchaseAppliedFilters.supplierCode || String(record.Supplier_Code || "").toLowerCase().indexOf(cardPurchaseAppliedFilters.supplierCode) !== -1) && (!query || lookupName(record.Card_Payment_Account).toLowerCase().indexOf(query) !== -1) && (!selectedStatus.length || selectedStatus.length === cardStatusOptions.length || selectedStatus.indexOf(record.Accounting_Status) !== -1) && (!selectedType.length || selectedType.length === cardTypeOptions.length || selectedType.indexOf(record.Transaction_Type) !== -1) && (!selectedOwner || lookupId(record.Owner) === selectedOwner)); }); return source().cards ? items.sort(function (left, right) { var a = sortValue(left, sort.key), b = sortValue(right, sort.key), compared = typeof a === "number" ? a - b : String(a).localeCompare(String(b), "en", { numeric: true }); return compared * (sort.direction === "asc" ? 1 : -1); }) : items; }
  function columnManager() { return global.AccountingManagerApp && global.AccountingManagerApp.tableColumns; }
  function visibleCardColumns() { var manager = columnManager(); return manager ? manager.visibleOrder("cardPurchases") : columns().slice(1).map(function (column) { return column[0]; }); }
  function headers() {
    if (!source().cards) { tableHead.innerHTML = "<th>Requested date</th><th>Requested by</th><th>Amount</th><th>Ticket locator</th><th>Booking MFSP</th><th>Booking name</th><th>Observations</th>"; return; }
    var manager = columnManager(), definitions = columns().slice(1), labels = {};
    if (manager) { manager.configure("cardPurchases", definitions.map(function (column) { return { key: column[0], label: column[1], defaultWidth: column[0] === "Supporting_Documents" ? 260 : column[0] === "Amount" ? 120 : 190 }; }), render); }
    definitions.forEach(function (column) { labels[column[0]] = column[1]; });
    tableHead.innerHTML = '<th class="card-purchase-review-cell" data-fixed-column-width="104" aria-label="Actions"></th>' + visibleCardColumns().map(function (key) {
      var indicator = sort.key === key ? (sort.direction === "asc" ? " &#9650;" : " &#9660;") : "";
      var html = '<th aria-sort="' + (sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none") + '"' + (key === "Amount" ? ' class="numeric-cell"' : '') + '><button class="operations-card-purchase-sort" type="button" data-card-purchase-sort="' + key + '">' + esc(labels[key]) + indicator + '</button></th>';
      return manager ? manager.resizableHeader(key, html) : html;
    }).join("") + (manager ? '<th class="table-columns-gear-cell">' + manager.button("cardPurchases") + '</th>' : '');
  }
  function cardPurchaseReference(value) { return value == null || value === "" ? "" : '<small class="card-purchase-secondary-reference">' + esc(value) + "</small>"; }
  function cardEditMenu(record) {
    var menuId = 'card-purchase-actions-' + String(record.id);
    return '<button type="button" class="card-purchase-review-button" data-card-actions popovertarget="' + esc(menuId) + '" title="More actions" aria-label="Actions for ' + esc(record.Name || 'card purchase') + '"><svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/></svg></button><div id="' + esc(menuId) + '" class="prepayment-actions-menu" popover="auto" aria-label="Card purchase actions"><button type="button" class="button tertiary compact-action-button" data-card-edit="' + esc(record.id) + '">Edit card purchase</button></div>';
  }
  function cardRow(record) { var active = activePurchase && String(activePurchase.id) === String(record.id), readOnly = record.Accounting_Status === "Purchase recorded" || record.Accounting_Status === "Refund recorded", icon = readOnly ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 10s2.7-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.7 4.5-7.5 4.5S2.5 10 2.5 10Zm7.5 2.2A2.2 2.2 0 1 0 10 7.8a2.2 2.2 0 0 0 0 4.4Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.75h6.3L15 6.45v10.8H5zM11 2.75v3.7h4M7.5 11l1.7 1.7 3.5-3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>';
    var cells = {
      Name: '<strong>' + esc(record.Name || '—') + '</strong>',
      Transaction_Type: badge(record.Transaction_Type, true),
      Supplier: esc(lookupName(record.Supplier) || '—') + cardPurchaseReference(record.Supplier_Code),
      Booking: esc(lookupName(record.Booking) || '—') + cardPurchaseReference(record.MFSP_Reference),
      Accounting_Status: badge(record.Accounting_Status),
      Transaction_Date: date(record.Transaction_Date),
      Amount: money(record.Amount),
      Card_Payment_Account: esc(lookupName(record.Card_Payment_Account) || '—'),
      Vendor_Invoice: esc(lookupName(record.Vendor_Invoice) || record.Invoice_Number || '—'),
      Vendor_Payment: esc(lookupName(record.Vendor_Payment) || '—'),
      Supporting_Documents: files(record.Supporting_Documents).map(function (file, index) { return '<div><button class="card-purchase-file" type="button" data-card-purchase-file="' + index + '" title="Preview ' + esc(file.name) + '">' + esc(file.name) + '</button></div>'; }).join('') || '—'
    };
    return '<tr data-card-purchase-id="' + esc(record.id) + '"' + (active ? ' class="is-card-purchase-active" aria-selected="true"' : '') + '><td class="card-purchase-review-cell"><div class="prepayment-row-actions"><button class="card-purchase-review-button" type="button" data-card-purchase-review aria-label="' + (readOnly ? 'View' : 'Register') + ' ' + esc(record.Name || 'card purchase') + '">' + icon + '</button>' + cardEditMenu(record) + '</div></td>' + visibleCardColumns().map(function (key) { return '<td' + (key === 'Amount' ? ' class="numeric-cell"' : '') + '>' + cells[key] + '</td>'; }).join('') + (columnManager() ? '<td class="table-columns-gear-cell"></td>' : '') + '</tr>';
  }
  function render() { if (source().crm || ministryActive) { return; } tableWrap._bufferedTableToken = null; var scrollTop = page === 1 ? 0 : tableWrap.scrollTop; var values = filtered(), perPage = 50, totalPages = Math.max(1, Math.ceil(values.length / perPage)), shown; if (page > totalPages) { page = totalPages; } shown = values.slice(0, page * perPage); headers(); if (!values.length) { tableWrap.hidden = true; pagination.hidden = true; empty.hidden = false; empty.innerHTML = source().cards ? "<h3>No card purchases match this view</h3><p>Change the search or status filter, or refresh the list.</p>" : "<h3>No records found</h3>"; return; } empty.hidden = true; tableWrap.hidden = false; tableBody.innerHTML = source().cards ? shown.map(cardRow).join("") : shown.map(function (record) { return "<tr><td>" + esc(record.requested_date || "") + "</td><td>" + esc(record.requested_by || "") + '</td><td class="numeric-cell">' + money(record.amount) + "</td><td>" + esc(record.ticket_locator || "") + "</td><td>" + esc(record.booking_mfsp || "") + "</td><td>" + esc(record.booking_name || "") + "</td><td>" + esc(record.observations || "") + "</td></tr>"; }).join(""); pagination.hidden = true; tableWrap.scrollTop = scrollTop; if (global.AccountingManagerApp.renderBufferedTable) { global.AccountingManagerApp.renderBufferedTable(tableWrap, tableWrap, shown.length, values.length + (selectedType === "renfe" && renfeMore ? 1 : 0), moreRows); } }
  async function cardPurchases() {
    // Use the same validated, fully paginated CRM reader as Prepayments.
    return global.AccountingManagerApp.prepaymentsModel.loadModule(api(), MODULES.purchases);
  }
  var renfeCursor = "", renfeMore = false, renfeFilters = null;
  async function loadRenfeBatch(token) {
    var query = Object.assign({}, renfeFilters, { searchText: JSON.stringify({ protocol: "renfe-pages-v1", query: renfeFilters.searchText, cursor: renfeCursor }) });
    var response = await global.ZOHO.CRM.FUNCTIONS.execute("creator_getrenfepayments", { arguments: JSON.stringify(query) });
    if (token !== reportGeneration || ministryActive || selectedType !== "renfe") { return false; }
    var output = response && response.details && response.details.output;
    try { output = typeof output === "string" ? JSON.parse(output) : output; } catch (_) { throw new Error("Invalid RENFE response."); }
    if (!output || output.success !== true || !Array.isArray(output.records) || typeof output.has_more !== "boolean") { throw new Error(output && output.message || "RENFE pagination is unavailable. Update the CRM function before searching."); }
    if (output.has_more && (!output.next_cursor || output.next_cursor === renfeCursor || !output.records.length)) { throw new Error("RENFE returned an invalid continuation cursor."); }
    var seen = new Set(records.map(function (r) { return String(r.id); }));
    output.records.forEach(function (r) { if (!r.id || seen.has(String(r.id))) { throw new Error("RENFE returned repeated or unidentified records. Refresh the search."); } seen.add(String(r.id)); });
    records = records.concat(output.records); renfeCursor = output.next_cursor || ""; renfeMore = output.has_more;
    return true;
  }
  async function moreRows() {
    if (selectedType === "renfe" && page * 50 >= records.length && renfeMore) {
      if (!await loadRenfeBatch(reportGeneration)) { return; }
    }
    page += 1; render();
  }
  var loadingReportToken = null;
  function setReportLoading(loading) {
    if (!refresh) { return; }
    refresh.disabled = loading;
    refresh.classList.toggle("is-refreshing", loading);
    refresh.setAttribute("aria-label", loading ? "Refreshing card purchases" : "Refresh card purchases");
    refresh.title = loading ? "Refreshing card purchases" : "Refresh card purchases";
  }
  async function populatePaymentAccounts(preferredId) {
    if (!workflowPaymentAccount) { return; }
    var token = (populatePaymentAccounts.generation || 0) + 1;
    populatePaymentAccounts.generation = token;
    workflowPaymentAccount.disabled = true;
    workflowPaymentAccount.innerHTML = '<option value="">Loading Own payment accounts…</option>';
    try {
      var choices = await global.AccountingManagerApp.loadOwnPaymentAccountChoices(api(), preferredId);
      if (token !== populatePaymentAccounts.generation) { return; }
      workflowPaymentAccount.innerHTML = '<option value="">Select Own payment account</option>' + choices.accounts.map(function (account) { return '<option value="' + esc(account.id) + '">' + esc(account.Name || lookupName(account) || 'Own payment account') + '</option>'; }).join('');
      workflowPaymentAccount.value = choices.defaultAccountId || '';
      workflowPaymentAccount.required = true;
      workflowPaymentAccount.disabled = false;
    } catch (error) {
      if (token !== populatePaymentAccounts.generation) { return; }
      workflowPaymentAccount.innerHTML = '<option value="">Payment account unavailable</option>';
      setMessage(error.message || 'Could not load Own payment accounts. Reopen the form to retry.');
    }
  }
  function syncOwnerFilter() { var owners = {}, selectedName; if (!cardOwnerMenu) { return; } records.forEach(function (record) { var id = lookupId(record.Owner), name = lookupName(record.Owner); if (id && name) { owners[id] = name; } }); if (cardPurchaseOwnerId && !owners[cardPurchaseOwnerId]) { cardPurchaseOwnerId = ""; } selectedName = owners[cardPurchaseOwnerId] || "All owners"; cardOwnerLabel.textContent = selectedName; cardOwnerMenu.innerHTML = '<button class="service-multi-filter-option card-purchase-owner-option' + (!cardPurchaseOwnerId ? ' is-selected' : '') + '" type="button" data-card-purchase-owner-option=""><span>All owners</span></button>' + Object.keys(owners).sort(function (left, right) { return owners[left].localeCompare(owners[right], "en"); }).map(function (id) { return '<button class="service-multi-filter-option card-purchase-owner-option' + (cardPurchaseOwnerId === id ? ' is-selected' : '') + '" type="button" data-card-purchase-owner-option="' + esc(id) + '"><span>' + esc(owners[id]) + '</span></button>'; }).join(""); }
  async function load() {
    if (source().crm) { if (prepayments) { return prepayments.load(); } return; }
    if (loadingReportToken === reportGeneration) { return; }
    var token = ++reportGeneration, current = source(), response, output;
    loadingReportToken = token;
    setReportLoading(Boolean(current.cards));
    empty.hidden = false;
    empty.innerHTML = '<p class="operations-loading" role="status">Loading ' + esc(current.title.toLowerCase()) + '…</p>';
    tableBody.innerHTML = "";
    records = [];
    tableWrap.hidden = true;
    pagination.hidden = true;
    try {
      if (current.cards) {
        var purchases = await cardPurchases();
        if (token !== reportGeneration || ministryActive) { return; }
        records = purchases; syncOwnerFilter(); page = 1; render(); return;
      }
      renfeCursor = ""; renfeMore = false;
      renfeFilters = { status: "", paymentDateFrom: String(dateFrom.value || ""), paymentDateTo: String(dateTo.value || ""), searchText: String(search.value || "") };
      if (!await loadRenfeBatch(token)) { return; }
      page = 1; render();
    } catch (error) {
      if (token !== reportGeneration || ministryActive) { return; }
      throw error;
    } finally {
      if (loadingReportToken === token) { loadingReportToken = null; setReportLoading(false); }
    }
  }

  function controls() { var cards = source().cards; var ministryButton = document.querySelector("[data-ministry-report-tab]"); if (ministryButton) { ministryButton.classList.remove("is-active"); } title.textContent = source().title; filters.hidden = cards || source().crm; toolbar.hidden = !cards; if (prepayments) { if (source().crm) { $("prepayments-workspace").hidden = false; empty.hidden = true; tableWrap.hidden = true; pagination.hidden = true; } else { prepayments.hide(); } } tableWrap.classList.toggle("is-card-purchases", cards); typeCards.forEach(function (item) { item.classList.toggle("is-active", item.getAttribute("data-operation-type") === selectedType); }); }
  function setMessage(message, error) { workflowMessage.textContent = message || ""; workflowMessage.classList.toggle("is-error", Boolean(error)); }
  function setWorkflowSaving(saving, label) { serviceEdit.disabled = Boolean(saving); modal.classList.toggle("is-saving", Boolean(saving)); if (workflowSpinner) { workflowSpinner.hidden = !saving; workflowSpinner.textContent = saving ? label || "Saving…" : ""; } }
  function isRecordedPurchase(purchase) { return purchase && !(global.localStorage && global.localStorage.getItem("accounting-manager:card-payment:v1:" + purchase.id)) && (purchase.Accounting_Status === "Cancelled" || purchase.Accounting_Status === "Purchase recorded" || purchase.Accounting_Status === "Refund recorded"); }
  function setWorkflowReadOnly(readOnly) { if (workflowActions) { workflowActions.hidden = readOnly; } workflowForm.classList.toggle("is-read-only", readOnly); workflowNotes.readOnly = readOnly; workflowNotes.disabled = readOnly; if (readOnly) { workflowInvoiceFields.hidden = true; workflowPaymentFields.hidden = true; } if (readOnly) { workflowTitle.textContent = activePurchase.Accounting_Status === "Cancelled" ? "Cancelled card transaction" : activePurchase.Transaction_Type === "Refund" ? "Recorded card refund" : "Recorded card purchase"; workflowEyebrow.textContent = "Read-only record"; setMessage(""); } }
  function setWorkflowPanelOpen(open) { var activeRow; if (open) { modal.hidden = false; loadWorkflowService(activePurchase); setWorkflowReadOnly(isRecordedPurchase(activePurchase)); Array.prototype.forEach.call(tableBody.querySelectorAll("tr.is-card-purchase-active"), function (row) { row.classList.remove("is-card-purchase-active"); row.removeAttribute("aria-selected"); }); activeRow = activePurchase && tableBody.querySelector('[data-card-purchase-id="' + String(activePurchase.id).replace(/"/g, "\\\"") + '"]'); if (activeRow) { activeRow.classList.add("is-card-purchase-active"); activeRow.setAttribute("aria-selected", "true"); } global.requestAnimationFrame(function () { modal.classList.add("is-open"); }); return; } modal.classList.remove("is-open"); global.setTimeout(function () { if (!modal.classList.contains("is-open")) { modal.hidden = true; } }, 240); }
  function previewFile(file) { var preview = document.createElement("div"), content, close; preview.className = "operations-file-preview"; preview.innerHTML = '<div class="operations-file-preview-backdrop"></div><section class="operations-file-preview-card" role="dialog" aria-modal="true" aria-label="File preview"><header><strong>' + esc(file.name) + '</strong><button type="button" aria-label="Close" class="widget-popup-close" title="Close">&times;</button></header><div class="operations-file-preview-content">Loading preview…</div></section>'; content = preview.querySelector(".operations-file-preview-content"); close = function () { if (preview._url) { global.URL.revokeObjectURL(preview._url); } preview.remove(); }; preview.querySelector(".operations-file-preview-backdrop").onclick = close; preview.querySelector("button").onclick = close; document.body.appendChild(preview); Promise.resolve(file.url || (file.id && api().getFile({ id: file.id }))).then(function (source) { var blob = source instanceof Blob ? source : new Blob([source], { type: file.type || "application/octet-stream" }), url = typeof source === "string" && /^(https?:|data:|blob:)/i.test(source) ? source : global.URL.createObjectURL(blob), image = /^image\//i.test(blob.type || file.type) || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(file.name), pdf = /^application\/pdf$/i.test(blob.type || file.type) || /\.pdf$/i.test(file.name); if (!source) { throw new Error("File is not available."); } if (url.indexOf("blob:") === 0) { preview._url = url; } content.innerHTML = image ? '<img src="' + esc(url) + '" alt="' + esc(file.name) + '">' : pdf ? '<iframe src="' + esc(url) + '" title="' + esc(file.name) + '"></iframe>' : '<p>This file cannot be previewed here.</p><a class="button secondary" href="' + esc(url) + '" download="' + esc(file.name) + '">Download file</a>'; }).catch(function () { content.innerHTML = '<p class="operations-file-preview-error">The file preview could not be loaded.</p>'; }); }
  function closeWorkflow() { if (!busy) { invoiceNameDefault.reset(); workflowServiceRequest += 1; settlementGeneration += 1; populatePaymentAccounts.generation = (populatePaymentAccounts.generation || 0) + 1; editingService = false; activePurchase = null; setWorkflowSaving(false); setWorkflowPanelOpen(false); setMessage(""); if (source().cards) { render(); } } }
  function cardReadingContext(purchase, contextItems, documents) {
    var eye = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
    var fileIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 3h8l4 4v14H6V3Z M14 3v5h4"/></svg>';
    var items = contextItems.filter(function (item) { return item[0] !== 'Booking'; }).concat([
      ['Transaction type', purchase.Transaction_Type || '—'], ['Accounting status', purchase.Accounting_Status || 'Pending invoice'],
      ['Invoice', purchase.Invoice_Number || lookupName(purchase.Vendor_Invoice) || '—'], ['Payment', lookupName(purchase.Vendor_Payment) || '—']
    ]);
    return '<div class="card-reading-heading"><strong>' + esc(lookupName(purchase.Supplier) || 'Supplier unavailable') + '</strong><strong class="card-reading-amount">' + esc(purchase.Amount == null || purchase.Amount === '' ? '—' : money(purchase.Amount)) + '</strong></div>' +
      '<p class="card-reading-references">' + esc(purchase.Name || 'Reference unavailable') + '<br>' + esc([purchase.MFSP_Reference, lookupName(purchase.Booking)].filter(Boolean).join(' · ') || 'Booking unavailable') + '</p>' +
      '<dl class="card-reading-grid">' + items.map(function (item) { return '<div><dt>' + esc(item[0]) + '</dt><dd' + (item[0] === 'Accounting status' ? ' class="card-reading-status"' : '') + '>' + esc(item[1]) + '</dd></div>'; }).join('') + '</dl>' +
      '<section class="card-reading-documents" aria-label="Supporting documents"><h4>Supporting documents</h4>' + (documents.length ? documents.map(function (file, index) {
        return '<div class="card-reading-document">' + fileIcon + '<span title="' + esc(file.name) + '">' + esc(file.name) + '</span><button class="card-reading-preview" type="button" data-card-purchase-workflow-file="' + index + '" title="Preview ' + esc(file.name) + '" aria-label="Preview ' + esc(file.name) + '">' + eye + '</button></div>';
      }).join('') : '<p class="card-reading-empty">No supporting documents.</p>') + '</section>';
  }
  function openWorkflow(purchase, action) { var suggestedAction = actionFor(purchase), effectiveAction = suggestedAction ? suggestedAction[0] : "review", refund = purchase.Transaction_Type === "Refund", invoice = effectiveAction === "invoice", payment = effectiveAction === "payment", documents = files(purchase.Supporting_Documents), contextItems; editingService = false; workflowSubmit.disabled = busy; workflowNeedsReview.disabled = busy; workflowNeedsReview.hidden = purchase.Accounting_Status === "Needs review"; setServiceMessage(""); populatePaymentAccounts.generation = (populatePaymentAccounts.generation || 0) + 1; activePurchase = purchase; activePurchase._action = effectiveAction; summaryGeneration += 1; if (workflowSettlementSummary) { workflowSettlementSummary.innerHTML = '<p class="card-reading-loading" role="status">Loading settlement…</p>'; } workflowEyebrow.textContent = refund ? "Card refund" : "Card purchase"; workflowTitle.textContent = effectiveAction === "payment" ? (refund ? "Record card refund" : "Record card payment") : effectiveAction === "refund-ready" ? "Confirm refund received" : (effectiveAction === "review" || effectiveAction === "review-done") ? "Review card transaction" : refund ? "Create credit note" : "Create supplier invoice"; contextItems = [["Booking", lookupName(purchase.Booking) || "—"], ["Transaction date", date(purchase.Transaction_Date)], ["Settlement", lookupName(purchase.Settlement) || "—"], ["Card", lookupName(purchase.Card_Payment_Account) || "—"]]; workflowContext.innerHTML = cardReadingContext(purchase, contextItems, documents); $("card-purchase-associated-invoices").innerHTML = '<h4>Associated invoices (' + (lookupId(purchase.Vendor_Invoice) ? 1 : 0) + ')</h4>' + (lookupId(purchase.Vendor_Invoice) ? '<p>' + esc(purchase.Invoice_Number || lookupName(purchase.Vendor_Invoice) || lookupId(purchase.Vendor_Invoice)) + '</p>' : '<p class="prepayment-secondary">No invoices linked</p>'); workflowInvoiceFields.hidden = !invoice; settlementGeneration += 1; settlementLoading = false; workflowSettlement.disabled = !invoice; workflowSettlement.required = invoice; workflowPaymentFields.hidden = !payment; workflowReference.required = invoice; workflowDate.required = invoice; workflowAmount.required = invoice; workflowPaymentReference.required = payment; workflowPaymentDate.required = payment; workflowPaymentAccount.required = payment; workflowReferenceLabel.textContent = refund ? "Credit note reference" : "Invoice number"; workflowDateLabel.textContent = refund ? "Credit note date" : "Invoice date"; workflowInvoiceType.innerHTML = (refund ? ["Credit Note"] : ["Tickets", "Final Invoice", "Proforma", "Commission"]).map(function (type) { return '<option value="' + type + '">' + type + '</option>'; }).join(""); workflowInvoiceType.value = refund ? "Credit Note" : "Tickets"; workflowInvoiceType.disabled = refund || !invoice; workflowInvoiceType.required = invoice; workflowReference.value = purchase.Invoice_Number || ""; workflowDate.value = global.AccountingManagerApp.defaultInvoiceDate(workflowInvoiceType.value); workflowAmount.value = Number(purchase.Amount || 0).toFixed(2); workflowVat.value = "0"; workflowNotes.value = purchase.Review_Notes || ""; if (payment) { workflowPaymentReference.value = refund ? "CARD-REFUND-" + purchase.Name : "CARD-PAY-" + String(purchase.Invoice_Number || lookupName(purchase.Vendor_Invoice) || "").trim(); workflowPaymentDate.value = isoDate(purchase.Transaction_Date) || new Date().toISOString().slice(0, 10); populatePaymentAccounts(lookupId(purchase.Card_Payment_Account)); } workflowSubmit.textContent = effectiveAction === "payment" ? (refund ? "Record refund" : "Record payment") : effectiveAction === "refund-ready" ? "Set ready to record" : effectiveAction === "review-done" ? "Review done" : effectiveAction === "review" ? "Save review notes" : refund ? "Create credit note" : "Create invoice"; setMessage(""); setWorkflowPanelOpen(true); global.AccountingManagerApp.alhambraCard.render(purchase, effectiveAction); invoiceNameDefault.reset(); if (invoice) { updateInvoiceNameDefault(); populateSettlements(purchase); } else { renderCardSettlementSummary(); } var pendingInvoice = invoice && global.localStorage && global.localStorage.getItem("accounting-manager-card-invoice-v1-" + purchase.id); workflowInvoiceFields.disabled = Boolean(pendingInvoice); if (effectiveAction === "review-done") { setMessage("Complete the review to update the status from the linked invoice and payment. This does not create an invoice or payment."); } if (effectiveAction === "review" && lookupId(purchase.Vendor_Payment)) { setMessage("A payment is already linked: " + (lookupName(purchase.Vendor_Payment) || lookupId(purchase.Vendor_Payment)) + ". Review it in Payments before changing this transaction."); } if (pendingInvoice) { workflowSubmit.textContent = "Resume saved invoice"; setMessage("Resume the saved invoice and its pending links or totals."); } }
  async function create(entity, data) { return assertSuccess(await api().insertRecord({ Entity: entity, APIData: [data], Trigger: ["workflow"] }), "Zoho CRM did not create the record."); }
  async function updatePurchase(data) { var payload = Object.assign({ id: activePurchase.id }, data); try { return assertSuccess(await api().updateRecord({ Entity: MODULES.purchases, RecordID: activePurchase.id, APIData: payload, Trigger: ["workflow"] }), "Zoho CRM did not update the card purchase."); } catch (error) { if (global.console && global.console.error) { global.console.error("[Card Purchases] Card Purchase update failed", { error: error, cardPurchaseId: activePurchase.id, payload: payload }); } throw error; } }
  async function createInvoice() {
    if (!global.localStorage.getItem("accounting-manager-card-invoice-v1-" + activePurchase.id) && (settlementLoading || workflowSettlement.disabled)) { throw new Error('Wait for the settlement choices to load.'); }
    var result = await global.AccountingManagerApp.saveCardInvoice(global.ZOHO, global.localStorage, String(activePurchase.id), {
      reference: workflowReference.value, date: workflowDate.value, amount: workflowAmount.value, vat: workflowVat.value,
      settlementId: workflowSettlement.value, invoiceType: workflowInvoiceType.value, notes: workflowNotes.value.trim()
    });
    Object.assign(activePurchase, result.changes);
    return result.invoiceId;
  }
  function output(response) { var value = response && response.details && response.details.output; try { return typeof value === "string" ? JSON.parse(value) : value || {}; } catch (error) { throw new Error(value || "Payment function did not return valid data."); } }
  async function userEmail() { try { var value = global.ZOHO.CRM.CONFIG && await global.ZOHO.CRM.CONFIG.getCurrentUser(); value = value && (value.users && value.users[0] || value.user || value); return String(value && value.email || ""); } catch (error) { return ""; } }
  async function createPayment() {
    var commissionInvoiceId = await global.AccountingManagerApp.alhambraCard.beforePayment(activePurchase);
    var result = await global.AccountingManagerApp.saveCardPayment({
      zoho: global.ZOHO, storage: global.localStorage, commissionInvoiceId: commissionInvoiceId,
      randomUUID: function () { return global.crypto.randomUUID(); }, userEmail: userEmail,
      confirmExisting: async function (payment, purchase) {
        return global.confirm("An existing payment can cover this card movement: " + (payment.Name || payment.id) +
          " (" + payment.Payment_Amount + " " + (payment.Currency || "EUR") + ", " + (payment.Payment_Date || "date unavailable") + "). Link it to " +
          (purchase.Name || purchase.id) + "? No new payment will be created.");
      }
    }, activePurchase.id, {
      Name: workflowPaymentReference.value.trim(), Payment_Date: workflowPaymentDate.value,
      Payment_Account: String(workflowPaymentAccount.value || ""), Review_Notes: workflowNotes.value.trim()
    });
    Object.assign(activePurchase, result.changes);
    activePurchase._settlementWarning = "";
    return { auditWarning: false };
  }
  function reviewedCardStatus(purchase) {
    var refund = purchase.Transaction_Type === "Refund", invoiceId = lookupId(purchase.Vendor_Invoice), paymentId = lookupId(purchase.Vendor_Payment);
    if (paymentId && !invoiceId) { throw new Error("A payment is linked but no invoice or credit note is linked. Correct the relationship before completing the review."); }
    return !invoiceId ? (refund ? "Pending credit note" : "Pending invoice") : !paymentId ? (refund ? "Pending refund record" : "Pending payment record") : (refund ? "Refund recorded" : "Purchase recorded");
  }
  async function completeCardReview() {
    var targetStatus = reviewedCardStatus(activePurchase), invoiceId = lookupId(activePurchase.Vendor_Invoice), paymentId = lookupId(activePurchase.Vendor_Payment);
    if (invoiceId) {
      var invoice = responseRecords(await api().getRecord({ Entity: "Supplier_Invoices", RecordID: invoiceId }))[0];
      if (!invoice || String(invoice.id) !== invoiceId || invoice.Edit_Status === "Pending" || invoice.Registration_Status === "Pending" || ["Cancelled", "Rejected"].indexOf(invoice.Status) !== -1) { throw new Error("The linked invoice is unavailable or needs correction. Finish that correction before completing the review."); }
    }
    if (paymentId) {
      var payment = responseRecords(await api().getRecord({ Entity: "Supplier_Payments", RecordID: paymentId }))[0];
      if (!payment || String(payment.id) !== paymentId || ["Paid", "Reconciled"].indexOf(payment.Status) === -1) { throw new Error("The linked payment is not Paid or Reconciled. Review it in Payments before marking this transaction as recorded."); }
    }
    await updatePurchase({ Accounting_Status: targetStatus, Review_Notes: workflowNotes.value.trim() });
    var confirmed = responseRecords(await api().getRecord({ Entity: MODULES.purchases, RecordID: String(activePurchase.id) }))[0];
    if (!confirmed || confirmed.Accounting_Status !== targetStatus || lookupId(confirmed.Vendor_Invoice) !== invoiceId || lookupId(confirmed.Vendor_Payment) !== paymentId) { throw new Error("The review update could not be verified. Reopen the transaction to check its current status before retrying."); }
    Object.assign(activePurchase, confirmed);
    records = await cardPurchases(); syncOwnerFilter(); render();
    openWorkflow(activePurchase, "review");
    setMessage("Review completed. Status: " + targetStatus + ".");
  }
  async function validateWorkflowAction(action) {
    var fresh = responseRecords(await api().getRecord({ Entity: MODULES.purchases, RecordID: String(activePurchase.id) }))[0];
    if (!fresh || String(fresh.id) !== String(activePurchase.id)) { throw new Error("The card transaction could not be read. Reopen it before continuing."); }
    var next = actionFor(fresh), changed = lookupId(fresh.Vendor_Invoice) !== lookupId(activePurchase.Vendor_Invoice) || lookupId(fresh.Vendor_Payment) !== lookupId(activePurchase.Vendor_Payment) || Number(fresh.Amount) !== Number(activePurchase.Amount) || fresh.Currency !== activePurchase.Currency || fresh.Transaction_Type !== activePurchase.Transaction_Type;
    if (fresh.Accounting_Status === "Cancelled" || fresh.Accounting_Status === "Purchase recorded" && !next || fresh.Accounting_Status === "Refund recorded" && !next || changed || action !== "review" && (!next || next[0] !== action)) {
      openWorkflow(fresh, "review");
      throw new Error("This transaction changed. Review the current links and available action before continuing.");
    }
    Object.assign(activePurchase, fresh);
  }
  async function submit(event) { var action, paymentResult, savingLabel; event.preventDefault(); if (!activePurchase || busy || editingService || isRecordedPurchase(activePurchase)) { return; } action = activePurchase._action; savingLabel = action === "invoice" ? "Creating invoice…" : action === "payment" ? "Recording payment…" : "Saving…"; busy = true; workflowSubmit.disabled = true; workflowNeedsReview.disabled = true; setMessage(""); setWorkflowSaving(true, savingLabel); try { await validateWorkflowAction(action); if (action === "review-done") { await completeCardReview(); return; } if (action === "invoice") { await createInvoice(); records = await cardPurchases(); syncOwnerFilter(); render(); openWorkflow(activePurchase, "payment"); setMessage("Invoice created. Review the card payment and record it when ready." + (activePurchase._settlementWarning ? " " + activePurchase._settlementWarning : ""), Boolean(activePurchase._settlementWarning)); return; } if (action === "payment") { paymentResult = await createPayment(); setMessage(paymentResult && paymentResult.auditWarning ? "Card movement recorded and status updated. The payment link could not be saved; see the console log." : "Card movement recorded."); } else if (action === "refund-ready") { await updatePurchase({ Accounting_Status: "Pending refund record", Review_Notes: workflowNotes.value.trim() }); activePurchase.Accounting_Status = "Pending refund record"; records = await cardPurchases(); syncOwnerFilter(); render(); openWorkflow(activePurchase, "payment"); setMessage("The refund is ready. Review and record the refund payment."); return; } else { await updatePurchase({ Review_Notes: workflowNotes.value.trim() }); setMessage("Review notes saved."); } records = await cardPurchases(); syncOwnerFilter(); render(); if (activePurchase._settlementWarning) { setMessage(activePurchase._settlementWarning, true); } else { global.setTimeout(closeWorkflow, 650); } } catch (error) { setMessage(error.message || "Could not save this record.", true); } finally { busy = false; setWorkflowSaving(false); workflowSubmit.disabled = false; workflowNeedsReview.disabled = false; } }
  async function needsReview() { if (!activePurchase || activePurchase.Accounting_Status === "Needs review" || busy || editingService || isRecordedPurchase(activePurchase)) { return; } busy = true; workflowNeedsReview.disabled = true; workflowSubmit.disabled = true; setMessage(""); setWorkflowSaving(true, "Saving review…"); try { await updatePurchase({ Accounting_Status: "Needs review", Review_Notes: workflowNotes.value.trim() }); records = await cardPurchases(); syncOwnerFilter(); activePurchase = null; render(); setWorkflowPanelOpen(false); } catch (error) { setMessage(error.message || "Could not update this record.", true); } finally { busy = false; setWorkflowSaving(false); workflowNeedsReview.disabled = false; workflowSubmit.disabled = false; } }

  apply && apply.addEventListener("click", function () { load().catch(function (error) { empty.hidden = false; empty.textContent = error.message || "Could not load records."; }); });
  refresh && refresh.addEventListener("click", function () { load().catch(function (error) { empty.hidden = false; empty.textContent = error.message || "Could not refresh card purchases."; }); });
  reset && reset.addEventListener("click", function () { [search, status, dateFrom, dateTo].forEach(function (field) { if (field) { field.value = ""; } }); });
  cardStatus && cardStatus.addEventListener("click", function () { var open = cardStatusMenu.hidden; cardStatusMenu.hidden = !open; cardStatus.setAttribute("aria-expanded", open ? "true" : "false"); });
  cardStatusToggleAll && cardStatusToggleAll.addEventListener("change", function () { cardStatusOptions.forEach(function (option) { option.checked = cardStatusToggleAll.checked; }); syncCardPurchaseStatusFilter(); });
  cardStatusOptions.forEach(function (option) { option.addEventListener("change", function () { syncCardPurchaseStatusFilter(); }); });
  cardType && cardType.addEventListener("click", function () { var open = cardTypeMenu.hidden; cardTypeMenu.hidden = !open; cardType.setAttribute("aria-expanded", open ? "true" : "false"); });
  cardTypeToggleAll && cardTypeToggleAll.addEventListener("change", function () { cardTypeOptions.forEach(function (option) { option.checked = cardTypeToggleAll.checked; }); syncCardPurchaseTypeFilter(); });
  cardTypeOptions.forEach(function (option) { option.addEventListener("change", function () { syncCardPurchaseTypeFilter(); }); });
  cardOwner && cardOwner.addEventListener("click", function () { var open = cardOwnerMenu.hidden; cardOwnerMenu.hidden = !open; cardOwner.setAttribute("aria-expanded", open ? "true" : "false"); });
  cardOwnerMenu && cardOwnerMenu.addEventListener("click", function (event) { var option = event.target.closest("[data-card-purchase-owner-option]"); if (!option) { return; } cardPurchaseOwnerId = option.getAttribute("data-card-purchase-owner-option") || ""; syncOwnerFilter(); cardOwnerMenu.hidden = true; cardOwner.setAttribute("aria-expanded", "false"); });
  document.addEventListener("pointerdown", function (event) { if (cardStatusMenu && !cardStatusMenu.hidden && !cardStatusMenu.contains(event.target) && !cardStatus.contains(event.target)) { cardStatusMenu.hidden = true; cardStatus.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("pointerdown", function (event) { if (cardTypeMenu && !cardTypeMenu.hidden && !cardTypeMenu.contains(event.target) && !cardType.contains(event.target)) { cardTypeMenu.hidden = true; cardType.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("pointerdown", function (event) { if (cardOwnerMenu && !cardOwnerMenu.hidden && !cardOwnerMenu.contains(event.target) && !cardOwner.contains(event.target)) { cardOwnerMenu.hidden = true; cardOwner.setAttribute("aria-expanded", "false"); } });
  cardApplyFilters && cardApplyFilters.addEventListener("click", applyCardPurchaseFilters);
  cardResetFilters && cardResetFilters.addEventListener("click", resetCardPurchaseFilters);
  cardPurchaseViewButtons.forEach(function (button) { button.addEventListener("click", function () { cardPurchaseView = button.getAttribute("data-card-purchase-view") || "open"; cardPurchaseViewButtons.forEach(function (item) { var active = item === button; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", active ? "true" : "false"); }); page = 1; render(); }); });

  tableHead && tableHead.addEventListener("click", function (event) { var button = event.target.closest("[data-card-purchase-sort]"), key; if (!button) { return; } key = button.getAttribute("data-card-purchase-sort"); sort.direction = sort.key === key && sort.direction === "asc" ? "desc" : "asc"; sort.key = key; page = 1; render(); });
  tableBody && tableBody.addEventListener('click', async function (event) {
    var actions = event.target.closest('[data-card-actions]');
    if (actions) {
      var menu = document.getElementById(actions.getAttribute('popovertarget')), rect = actions.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(rect.left, global.innerWidth - 190)) + 'px';
      menu.style.top = Math.max(8, Math.min(rect.bottom + 6, global.innerHeight - 70)) + 'px';
      return;
    }
    var edit = event.target.closest('[data-card-edit]');
    if (!edit || busy) { return; }
    var popover = edit.closest('[popover]'); if (popover && popover.hidePopover) { popover.hidePopover(); }
    closeWorkflow();
    var ns = global.AccountingManagerApp;
    ns.operationEditor = ns.operationEditor || ns.createOperationEditor(global.ZOHO);
    await ns.operationEditor.open('Card_Purchases', edit.dataset.cardEdit, edit, load);
  });
  tableBody && tableBody.addEventListener("click", function (event) { var row = event.target.closest("[data-card-purchase-id]"), review = event.target.closest("[data-card-purchase-review]"), fileButton = event.target.closest("[data-card-purchase-file]"), purchase; if (!row || (!review && !fileButton)) { return; } purchase = records.filter(function (record) { return String(record.id) === row.getAttribute("data-card-purchase-id"); })[0]; if (purchase && fileButton) { var file = files(purchase.Supporting_Documents)[Number(fileButton.getAttribute("data-card-purchase-file"))]; if (file) { previewFile(file); } } else if (purchase) { openWorkflow(purchase, "review"); } });
  workflowForm && workflowForm.addEventListener("submit", submit); workflowNeedsReview && workflowNeedsReview.addEventListener("click", needsReview); Array.prototype.slice.call(document.querySelectorAll("[data-card-purchase-close]")).forEach(function (button) { button.addEventListener("click", closeWorkflow); });
  workflowContext && workflowContext.addEventListener("click", function (event) { var button = event.target.closest("[data-card-purchase-workflow-file]"), selectedFile; if (!button || !activePurchase) { return; } selectedFile = files(activePurchase.Supporting_Documents)[Number(button.getAttribute("data-card-purchase-workflow-file"))]; if (selectedFile) { previewFile(selectedFile); } });
  typeCards.forEach(function (card) { card.addEventListener("click", function () { reportGeneration += 1; ministryActive = false; selectedType = card.getAttribute("data-operation-type") || "prepayments"; records = []; page = 1; controls(); if (source().crm) { if (prepayments) { prepayments.activate(); } return; } if (source().cards) { load().catch(function (error) { empty.hidden = false; empty.textContent = error.message || "Could not load card purchases."; if (!source().cards || ministryActive) { empty.hidden = true; } }); } else { empty.hidden = false; empty.innerHTML = "<h3>Ready to load " + esc(source().title) + "</h3><p>Apply filters to query Creator.</p>"; tableWrap.hidden = true; pagination.hidden = true; } }); });
  ["accounting-manager-invoice-deleted", "accounting-manager-operation-undone"].forEach(function (event) { global.addEventListener(event, function () {
    if (source().cards) { activePurchase = null; closeWorkflow(); load().catch(function (error) { setMessage(error.message || "Could not reload card purchases.", true); }); }
  });
  });
  var operationsTab = document.querySelector('[data-tab-button="operations"]');
  if (operationsTab) { operationsTab.addEventListener("click", function () { var defaultReport = document.querySelector('[data-operation-type="prepayments"]'); if (defaultReport) { defaultReport.click(); } }); }
  var ministryTab = document.querySelector('[data-ministry-report-tab]');
  if (ministryTab) { ministryTab.addEventListener("click", function () { reportGeneration += 1; ministryActive = true; if (prepayments) { prepayments.hide(); } }); }
  global.AccountingManagerApp.openPendingCardOperation = async function (recordId, action) {
    if (busy) { throw new Error("Wait for the current card operation to finish."); }
    var response = await api().getRecord({ Entity: "Card_Purchases", RecordID: recordId });
    var purchase = responseRecords(response)[0];
    if (!purchase || String(purchase.id) !== String(recordId)) { throw new Error("The card purchase could not be read."); }
    openWorkflow(purchase, action);
  };
  controls();
}(window));
