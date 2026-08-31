(function (global) {
var ns = global.AccountingManagerApp;

  if (!ns || !ns.helpers || !ns.getElements || !ns.createCrmClient || !ns.createRenderer || !ns.createInitialState) {
    return;
  }

  var MODULES = ns.MODULES;
  var FIELD_CANDIDATES = ns.FIELD_CANDIDATES;
  var helpers = ns.helpers;
  var state = ns.createInitialState();
  var elements = ns.getElements();
  var crm = ns.createCrmClient(global.ZOHO, helpers);
  var renderer = ns.createRenderer(elements, state, helpers, FIELD_CANDIDATES);
  var moduleFieldApiCache = {};
  var moduleFieldMetadataCache = {};
  var bookingsLoadPromise = null;
  var settlementsLoadPromise = null;
  var invoicesLoadPromise = null;
  var paymentsLoadPromise = null;
  var paymentsDatasetLoadPromise = null;
  var payAllocationsLoadPromise = null;
  var paymentAccountsContextLoadPromise = null;
  var paymentAccountsLoadPromise = null;
  var accountingEntriesLoadPromise = null;
  var accountingEntryLinesLoadPromise = null;
  var accountingAccountsLoadPromise = null;
  var accountingRulesLoadPromise = null;
  var invoicesLoadRequestId = 0;
  var paymentsLoadRequestId = 0;
  var invoicesFilterReloadTimer = null;
  var paymentsFilterReloadTimer = null;
  var INVOICE_CREATE_VALIDATION_FIELD_KEYS = [
    "settlement",
    "invoiceNumber",
    "invoiceDate",
    "invoiceType",
    "invoiceFile",
    "allocation",
    "amountGross",
    "vatReviewed",
    "additionalVatPercent",
    "additionalAmountExclVat",
    "additionalAmountInclVat",
    "additionalVatReviewed",
    "additionalIrpfReviewed",
    "irpfReviewed"
  ];
  var CREATE_LINES_FUNCTION = "widget_createinvoicelines";
  var CREATE_SUPPLIER_PAYMENT_FUNCTION = "createsupplierpaymentfrominvoices";
  var ENSURE_SUPPLIER_ACCOUNTING_ACCOUNT_FUNCTION = "ensuresupplieraccountingaccount";
  var ENSURE_SUPPLIER_PAYMENT_ACCOUNT_FUNCTION = "ensuresupplierpaymentaccount";
  var RESOLVE_SUPPLIER_INVOICE_ACCOUNTING_ENTRY_FUNCTION = "accent_resolvesupplierinvoiceaccountingentry";
  var RESOLVE_SUPPLIER_PAYMENT_ACCOUNTING_ENTRY_FUNCTION = "accent_resolvesupplierpaymentaccountingentry";
  var REBUILD_ACCOUNTING_ENTRY_TOTALS_FUNCTION = "accent_rebuildaccountingentrytotals";
  var REBUILD_SUPPLIER_SETTLEMENT_TOTALS_FUNCTION = "rebuildsuppliersettlementtotals";
  var MANAGE_SUPPLIER_PAYMENT_ALLOCATIONS_FUNCTION = "managesupplierpaymentallocations";
  var SYNC_SUPPLIER_FROM_EZUS_FUNCTION = "createsupplierinezus";
  var SYNC_PROJECT_FROM_EZUS_FUNCTION = "syncprojectfromezus";
  var RECALCULATE_SUPPLIER_SETTLEMENTS_FOR_BOOKING_FUNCTION = "recalculatesuppliersettlementsforbooking";
  var SEND_SUPPLIER_PAYMENT_LETTER_FUNCTION = "sendsupplierpaymentletter";
  var REQUEST_SUPPLIER_ACCOUNTING_ACCOUNT_EMAIL_FUNCTION = "requestsupplieraccountingaccountemail";
  var GET_SUPPLIER_CONTACT_BY_TYPE_FUNCTION = "getSupplierContactByType";
  var PAYMENT_LETTER_CONTACT_TYPE = "AC - Accounts";
  var PAYMENT_LETTER_DEFAULT_RECIPIENT = "";
  var DEFAULT_INVOICE_STATUS = "Received";
  var DEFAULT_SETTLEMENT_STATUS_FILTER_VALUES = [
    "Pending Invoice",
    "To Be Paid",
    "Partially Paid",
    "Partially Accounted",
    "Accounted"
  ];
  var SETTLEMENT_ADMIN_STATUS = {
    toBePaid: "To Be Paid",
    partiallyPaid: "Partially Paid",
    paid: "Paid"
  };
  var INVOICE_TYPES = {
    finalInvoice: "Final Invoice",
    creditNote: "Credit Note"
  };
  var PAYMENT_MOVEMENT_TYPES = {
    outbound: "Outbound Payment",
    supplierRefund: "Supplier Refund"
  };
  var INVOICE_CREATE_MODES = {
    invoice: "invoice",
    refund: "refund"
  };
  var INVOICE_CREATE_STEPS = {
    settlement: 1,
    amounts: 2
  };
  var INVOICE_LINE_FIELDS = {
    invoiceLookup: "Supplier_Invoice",
    serviceLookup: "Booking_Service",
    name: "Name",
    description: "Description",
    amount: "Amount",
    quantity: "Quantity",
    supplierLookup: "Supplier",
    settlementLookup: "Supplier_Settlement",
    bookingLookup: "Booking",
    serviceDate: "Service_Date"
  };

  function debugLog(label, payload) {
    // Routine diagnostics are intentionally silent; errors still use debugError.
  }

  function debugWarn(label, payload) {
    // Routine diagnostics are intentionally silent; errors still use debugError.
  }

  function debugError(label, error, payload) {
    var details = payload || {};

    if (error) {
      details.errorMessage = error.message || String(error);
      details.errorName = error.name || "";
      details.errorStack = error.stack || "";
      details.errorKeys = Object.keys(error);
      details.errorObject = error;
    }

    if (global.console && typeof global.console.error === "function") {
      global.console.error("[AccountingManager] " + label, details);
    }
  }

  function getDebugResponseSummary(response) {
    var records;
    var firstRecord;

    if (!response || typeof response !== "object") {
      return {
        value: response == null ? "" : String(response),
        valueType: typeof response
      };
    }

    records = typeof helpers.extractRecords === "function" ? helpers.extractRecords(response) : [];
    firstRecord = records[0] || {};

    return {
      topLevelKeys: Object.keys(response),
      firstStatus: String(firstRecord.status || firstRecord.code || ""),
      firstMessage: String(firstRecord.message || ""),
      firstDetailsKeys: firstRecord.details && typeof firstRecord.details === "object"
        ? Object.keys(firstRecord.details)
        : []
    };
  }

  function normalizeSettlements(records) {
    return (records || [])
      .slice()
      .sort(function (left, right) {
        var leftDate = Date.parse(left && left.First_Service_Date || "") || 0;
        var rightDate = Date.parse(right && right.First_Service_Date || "") || 0;
        return rightDate - leftDate;
      });
  }

  function attachGlobalDebugListeners() {
    if (global.__accountingManagerDebugAttached) {
      return;
    }

    global.__accountingManagerDebugAttached = true;

    global.addEventListener("error", function (event) {
      debugError("window error", event && event.error ? event.error : new Error(event.message || "Unknown window error"), {
        filename: event.filename || "",
        lineno: event.lineno || 0,
        colno: event.colno || 0
      });
    });

    global.addEventListener("unhandledrejection", function (event) {
      debugError("unhandled rejection", event.reason || new Error("Unhandled rejection"));
    });
  }

  var BOOKING_FIELDS = [
    "id",
    "Deal_Name",
    "MFSP_Reference"
  ];

  var BOOKING_BROWSER_FIELDS = [
    "id",
    "Deal_Name",
    "MFSP_Reference",
    "Closure_Status",
    "Arrival_Date",
    "Departure_Date",
    "Account_Name",
    "Consortia",
    "IATA_Code",
    "Stage",
    "Travellers_Number",
    "Sales_Price_inc_Taxes",
    "Purchase_Price_inc_Taxes",
    "Gross_Margin",
    "Net_Margin",
    "Balance_Amount",
    "Paid_Amount",
    "Total_Refund_Amount",
    "Total_Requested_Amount",
    "Final_Commission",
    "Accounting_Rep"
  ];
  var BOOKING_BROWSER_PAGE_FIELDS = [
    "id",
    "Deal_Name",
    "MFSP_Reference",
    "Closure_Status",
    "Arrival_Date",
    "Departure_Date",
    "Account_Name",
    "Consortia",
    "IATA_Code",
    "Stage",
    "Travellers_Number",
    "Accounting_Rep"
  ];
  var SETTLEMENT_FIELDS = [
    "id",
    "Name",
    "Booking",
    "Supplier",
    "Supplier_Name",
    "MFSP_Reference",
    "Total_Service_Cost",
    "Total_Invoice",
    "Total_Paid",
    "Unpaid_Invoiced_Amount",
    "Admin_Status",
    "Closure_Review_Status",
    "First_Service_Date",
    "Last_Service_Date",
    "Service_Count"
  ];
  var BOOKING_STAGE_FILTER_OPTIONS = [
    "Request Qualified",
    "Quotation",
    "Proposal Sent",
    "Pending Res Assignment",
    "Reservation In Progress",
    "Changes Requested",
    "All Services Confirmed",
    "FID Sent",
    "Pending Review",
    "FID In Review",
    "Review Done",
    "On Tour",
    "Trip Accounting Closure",
    "Cancelled",
    "Cancelled W/Charges",
    "Dead",
    "Booking Completed"
  ];
  state.views.bookings.filters.stageValues = BOOKING_STAGE_FILTER_OPTIONS.slice();
  state.views.bookings.appliedFilters.stageValues = BOOKING_STAGE_FILTER_OPTIONS.slice();
  var INVOICE_STATUS_FILTER_OPTIONS = [
    "-None-",
    "Received",
    "Partially Paid",
    "Paid",
    "Cancelled",
    "Rejected"
  ];
  var PAYMENT_STATUS_FILTER_OPTIONS = [
    "Planned",
    "Approved",
    "Pending Payment",
    "Cancelled",
    "Paid",
    "Reconciled"
  ];

  var INVOICE_FIELDS = [
    "id",
    "Name",
    "Status",
    "Created_By",
    "Invoice_Date",
    "Invoice_Amount_Excl_VAT",
    "Invoice_Amount_Incl_VAT",
    "VAT_percentage",
    "VAT_Amount",
    "Additional_Amount_Excl_VAT",
    "Additional_Amount_Incl_VAT",
    "Additional_VAT_percentage",
    "Additional_VAT_Amount",
    "Additional_IRPF_percentage",
    "Additional_IRPF_Amount",
    "IRPF_percentage",
    "IRPF_Amount",
    "Reimbursable_Expense",
    "Invoice_Total",
    "Total_Payable_Amount",
    "Unpaid_Invoiced_Amount",
    "Amount_Paid",
    "Invoice_Type",
    "Original_Invoice",
    "Supplier",
    "Supplier_Name",
    "Supplier_Code",
    "MFSP_Reference",
    "Ezus_Supplier_Reference",
    "Booking",
    "Supplier_Settlement",
    "Accounting_Status",
    "Accounting_Posted_At"
  ];
  var INVOICE_COQL_FIELDS = INVOICE_FIELDS.slice();

  var PAYMENT_FIELDS = [
    "id",
    "Name",
    "Status",
    "Created_By",
    "Payment_Date",
    "Payment_Amount",
    "Movement_Type",
    "Payment_Account",
    "Accounting_Status",
    "Context_Mode",
    "Context_Summary",
    "Allocation_Count",
    "Supplier_Count",
    "Booking_Count",
    "Settlement_Count"
  ];

  var PAYMENT_ACCOUNT_FIELDS = [
    "id",
    "Name",
    "Email",
    "IBAN",
    "Account_Number",
    "Bank_Account_Name",
    "Status",
    "Owner_Supplier",
    "Owner_Type",
    "Accounting_Account",
    "Currency",
    "Books_Mapping_Status",
    "Last_Sync_Status",
    "Last_Sync_Date",
    "Allowed_For_Supplier_Payments",
    "Auto_Sync_To_Books",
    "Requires_Proof_of_Payment",
    "External_ID"
  ];
  var ACCOUNTING_ACCOUNT_FIELDS = [
    "id",
    "Name",
    "Account_Name",
    "Account_Type",
    "Account_Subtype",
    "Status",
    "Zoho_Books_Account_Id"
  ];
  var ACCOUNTING_ENTRY_FIELDS = [
    "id",
    "Name",
    "Entry_Date",
    "Posting_Date",
    "Source_Date",
    "Movement_Type",
    "Supplier",
    "Booking",
    "Supplier_Settlement",
    "Supplier_Invoice",
    "MFSP_Reference",
    "Accounting_Status",
    "Books_Post_Status",
    "Zoho_Books_Document_Type",
    "Total_Debit",
    "Total_Credit",
    "Balanced",
    "Line_Count"
  ];
  var ACCOUNTING_ENTRY_LINE_FIELDS = [
    "id",
    "Name",
    "Source_Date",
    "Supplier_Invoice",
    "Line_No",
    "Line_Type",
    "Account",
    "Debit",
    "Credit",
    "Is_IRPF_Line"
  ];
  var ACCOUNTING_RULE_FIELDS = [
    "id",
    "Name",
    "Status",
    "Trip_Type",
    "Is_Self_Employed",
    "Base_Expense_Account",
    "Reimbursable_Account"
  ];
  var PAY_ALLOCATION_FIELDS = [
    "id",
    "Name",
    "Allocated_Amount",
    "Allocation_Date",
    "Supplier_Payment",
    "Supplier_Invoice",
    "Supplier",
    "Supplier_Name",
    "Booking",
    "Supplier_Settlement",
    "Ezus_Supplier_Reference",
    "MFSP_Reference",
    "Payment_Date",
    "Payment_Account",
    "Payment_Status",
    "Payment_Accounting_Status",
    "Movement_Type",
    "Invoice_Date",
    "Invoice_Status"
  ];
  var INVOICE_LINE_RELATED_FIELDS = [
    "id",
    INVOICE_LINE_FIELDS.serviceDate,
    INVOICE_LINE_FIELDS.amount,
    INVOICE_LINE_FIELDS.serviceLookup
  ];
  var PAYMENT_ACCOUNT_CREATE_PICKLIST_FALLBACKS = {
    currency: ["EUR", "USD"],
    methodType: ["Airwallex", "Bank Transfer", "Card", "Cash", "Other"],
    status: ["Active", "Inactive"],
    cardType: ["AMEX", "Other"],
    department: ["Travelers", "Office"],
    journalType: ["BANK", "Other"],
    bankName: ["Bankinter", "Santander"]
  };
  var invoicesModule = ns.createInvoicesModule({
    MODULES: MODULES,
    FIELD_CANDIDATES: FIELD_CANDIDATES,
    helpers: helpers,
    state: state,
    crm: crm,
    renderer: renderer,
    renderAll: renderAll,
    debugError: debugError,
    cloneFilterState: cloneFilterState,
    hasAnyLoadFilterValue: hasAnyLoadFilterValue,
    getNormalizedStatusFilterValues: getNormalizedStatusFilterValues,
    getInvoiceSupplierCodeSortValue: getInvoiceSupplierCodeSortValue,
    getMfspFromInvoice: getMfspFromInvoice,
    compareValues: compareValues,
    getInvoiceSupplierSortValue: getInvoiceSupplierSortValue,
    getInvoiceBookingDisplay: getInvoiceBookingDisplay,
    getInvoiceType: getInvoiceType,
    getInvoicePaidAmount: getInvoicePaidAmount,
    buildSelectedInvoiceDeleteImpact: buildSelectedInvoiceDeleteImpact,
    buildLocalPageSummary: buildLocalPageSummary,
    buildCombinedStatusOptions: buildCombinedStatusOptions,
    INVOICE_STATUS_FILTER_OPTIONS: INVOICE_STATUS_FILTER_OPTIONS,
    getSupplierNameFromInvoice: getSupplierNameFromInvoice,
    getInvoiceSupplierDisplay: getInvoiceSupplierDisplay,
    closeSelectedInvoiceDeletePanel: closeSelectedInvoiceDeletePanel,
    resolveCoqlFields: resolveCoqlFields,
    PAY_ALLOCATION_FIELDS: PAY_ALLOCATION_FIELDS,
    sortRecordsByDateDesc: sortRecordsByDateDesc,
    INVOICE_LINE_RELATED_FIELDS: INVOICE_LINE_RELATED_FIELDS,
    INVOICE_LINE_FIELDS: INVOICE_LINE_FIELDS,
    loadRecordsByCoql: loadRecordsByCoql,
    buildCoqlOrEqualsClause: buildCoqlOrEqualsClause,
    buildZohoRecordViewUrl: buildZohoRecordViewUrl,
    getFriendlyLoadErrorMessage: getFriendlyLoadErrorMessage,
    ensureInvoicesLoaded: ensureInvoicesLoaded,
    onInvoicesLoaded: function () {}
  });
  var buildInvoicesView = invoicesModule.buildView;
  var toggleInvoiceSelection = invoicesModule.toggleSelection;
  var toggleVisibleInvoices = invoicesModule.toggleVisible;
  var selectInvoiceDetail = invoicesModule.selectDetail;
  var normalizeInvoiceDetailTab = invoicesModule.normalizeDetailTab;
  var setInvoiceDetailTab = invoicesModule.setDetailTab;
  var setShowInvoiceAttachments = invoicesModule.setShowAttachments;
  var openInvoiceInCrm = invoicesModule.openInCrm;
  var loadInvoicesTabData = invoicesModule.loadTabData;
  var refreshInvoicesTabData = invoicesModule.refreshTabData;
  var ensureInvoiceAllocationsLoaded = invoicesModule.ensureAllocationsLoaded;
  var ensureInvoiceLinesLoaded = invoicesModule.ensureLinesLoaded;
  var queueInvoiceFileLoad = invoicesModule.queueFileLoad;
  var remoteDataModule = ns.createRemoteDataModule({
    MODULES: MODULES,
    INVOICE_STATUS_FILTER_OPTIONS: INVOICE_STATUS_FILTER_OPTIONS,
    PAYMENT_STATUS_FILTER_OPTIONS: PAYMENT_STATUS_FILTER_OPTIONS,
    BOOKING_BROWSER_FIELDS: BOOKING_BROWSER_FIELDS,
    state: state,
    helpers: helpers,
    crm: crm,
    debugWarn: debugWarn,
    debugError: debugError,
    resolveCoqlFields: resolveCoqlFields,
    resolveFieldApiByCandidates: resolveFieldApiByCandidates,
    escapeCoqlValue: escapeCoqlValue,
    getNormalizedStatusFilterValues: getNormalizedStatusFilterValues,
    hasAllStatusFilterValuesSelected: hasAllStatusFilterValuesSelected,
    getNormalizedBookingStageValues: getNormalizedBookingStageValues,
    hasAllBookingStageFilterValuesSelected: hasAllBookingStageFilterValuesSelected
  });
  var attachCoqlContextToError = remoteDataModule.attachCoqlContextToError;
  var loadModuleRecords = remoteDataModule.loadModuleRecords;
  var loadRecordsByCoql = remoteDataModule.loadRecordsByCoql;
  var loadRecordsByPagination = remoteDataModule.loadRecordsByPagination;
  var buildCoqlOrEqualsClause = remoteDataModule.buildCoqlOrEqualsClause;
  var buildCoqlPageQuery = remoteDataModule.buildCoqlPageQuery;
  var loadCoqlPage = remoteDataModule.loadCoqlPage;
  var buildInvoiceRemoteWhereClause = remoteDataModule.buildInvoiceRemoteWhereClause;
  var buildInvoiceRemoteOrderByClause = remoteDataModule.buildInvoiceRemoteOrderByClause;
  var buildPaymentRemoteWhereClause = remoteDataModule.buildPaymentRemoteWhereClause;
  var buildPaymentRemoteOrderByClause = remoteDataModule.buildPaymentRemoteOrderByClause;
  var buildAccountingEntriesRemoteWhereClause = remoteDataModule.buildAccountingEntriesRemoteWhereClause;
  var buildAccountingEntriesRemoteOrderByClause = remoteDataModule.buildAccountingEntriesRemoteOrderByClause;
  var buildAccountingEntryLinesRemoteWhereClause = remoteDataModule.buildAccountingEntryLinesRemoteWhereClause;
  var buildAccountingEntryLinesRemoteOrderByClause = remoteDataModule.buildAccountingEntryLinesRemoteOrderByClause;
  var buildBookingRemoteWhereClause = remoteDataModule.buildBookingRemoteWhereClause;
  var buildBookingRemoteOrderByClause = remoteDataModule.buildBookingRemoteOrderByClause;
  var hydrateBookingPageRecords = remoteDataModule.hydrateBookingPageRecords;
  var canUseBookingSearchFallback = remoteDataModule.canUseBookingSearchFallback;
  var loadBookingSearchFallbackPage = remoteDataModule.loadBookingSearchFallbackPage;
  var bookingsModule = ns.createBookingsModule({
    MODULES: MODULES,
    FIELD_CANDIDATES: FIELD_CANDIDATES,
    BOOKING_STAGE_FILTER_OPTIONS: BOOKING_STAGE_FILTER_OPTIONS,
    BOOKING_BROWSER_PAGE_FIELDS: BOOKING_BROWSER_PAGE_FIELDS,
    SYNC_PROJECT_FROM_EZUS_FUNCTION: SYNC_PROJECT_FROM_EZUS_FUNCTION,
    RECALCULATE_SUPPLIER_SETTLEMENTS_FOR_BOOKING_FUNCTION: RECALCULATE_SUPPLIER_SETTLEMENTS_FOR_BOOKING_FUNCTION,
    state: state,
    elements: elements,
    helpers: helpers,
    crm: crm,
    renderer: renderer,
    renderAll: renderAll,
    debugError: debugError,
    resolveFieldApiByCandidates: resolveFieldApiByCandidates,
    getFunctionOutputObject: getFunctionOutputObject,
    getFunctionResponseResult: getFunctionResponseResult,
    cloneFilterState: cloneFilterState,
    getNormalizedBookingStageValues: getNormalizedBookingStageValues,
    hasAllBookingStageFilterValuesSelected: hasAllBookingStageFilterValuesSelected,
    loadCoqlPage: loadCoqlPage,
    buildBookingRemoteWhereClause: buildBookingRemoteWhereClause,
    buildBookingRemoteOrderByClause: buildBookingRemoteOrderByClause,
    hydrateBookingPageRecords: hydrateBookingPageRecords,
    canUseBookingSearchFallback: canUseBookingSearchFallback,
    loadBookingSearchFallbackPage: loadBookingSearchFallbackPage,
    buildRemotePageSummary: buildRemotePageSummary,
    getFriendlyLoadErrorMessage: getFriendlyLoadErrorMessage,
    getCurrentUserEmail: getCurrentUserEmail,
    openAgentCommissionInvoice: function () {
      return openAgentCommissionInvoice.apply(null, arguments);
    }
  });
  var onBookingsStageToggleClick = bookingsModule.onStageToggleClick;
  var onBookingsStageOptionChange = bookingsModule.onStageOptionChange;
  var onBookingsStageMenuActionClick = bookingsModule.onStageMenuActionClick;
  var onDocumentClickCloseBookingsStageDropdown = bookingsModule.onDocumentClickCloseStageDropdown;
  var onBookingActionsToggleClick = bookingsModule.onActionsToggleClick;
  var onDocumentClickCloseBookingActionsPopup = bookingsModule.onDocumentClickCloseActionsPopup;
  var onDocumentKeydownCloseBookingActionsPopup = bookingsModule.onDocumentKeydownCloseActionsPopup;
  var setBookingActionsPopupOpen = bookingsModule.setActionsPopupOpen;
  var onBookingSyncProjectClick = bookingsModule.onSyncProjectClick;
  var onBookingRecalculateSettlementClick = bookingsModule.onRecalculateSettlementClick;
  var onBookingRowActionClick = bookingsModule.onRowActionClick;
  var onAgentCommissionRecalculateClick = bookingsModule.onAgentCommissionRecalculateClick;
  var closeAgentCommissionPopup = bookingsModule.closeAgentCommissionPopup;
  var onBookingTripClosureClick = bookingsModule.onTripClosureClick;
  var closeBookingClosure = bookingsModule.closeBookingClosure;
  var closeBookingClosureDetail = bookingsModule.closeBookingClosureDetail;
  var onBookingClosureRefreshClick = bookingsModule.onClosureRefreshClick;
  var onBookingClosureReviewClick = bookingsModule.onClosureReviewClick;
  var onBookingClosureTableControlClick = bookingsModule.onClosureTableControlClick;
  var onBookingClosureSettlementClick = bookingsModule.onClosureSettlementClick;
  var loadBookingsBrowserData = bookingsModule.loadBrowserData;
  var buildBookingsView = bookingsModule.buildView;
  var supplierActivityModule = ns.createSupplierActivityModule({
    MODULES: MODULES,
    FIELD_CANDIDATES: FIELD_CANDIDATES,
    SEND_SUPPLIER_PAYMENT_LETTER_FUNCTION: SEND_SUPPLIER_PAYMENT_LETTER_FUNCTION,
    PAYMENT_LETTER_DEFAULT_RECIPIENT: PAYMENT_LETTER_DEFAULT_RECIPIENT,
    GET_SUPPLIER_CONTACT_BY_TYPE_FUNCTION: GET_SUPPLIER_CONTACT_BY_TYPE_FUNCTION,
    PAYMENT_LETTER_CONTACT_TYPE: PAYMENT_LETTER_CONTACT_TYPE,
    state: state,
    elements: elements,
    helpers: helpers,
    crm: crm,
    renderer: renderer,
    renderAll: renderAll,
    debugError: debugError,
    loadInvoicesForSupplier: loadInvoicesForSupplier,
    loadPaymentsForSupplier: loadPaymentsForSupplier,
    getInvoiceSupplierId: getInvoiceSupplierId,
    sortRecordsByDateDesc: sortRecordsByDateDesc,
    getFunctionOutputObject: getFunctionOutputObject,
    getPaymentLetterFunctionResult: getPaymentLetterFunctionResult,
    getInvoiceBookingDisplay: getInvoiceBookingDisplay,
    getBookingNameFromPayment: getBookingNameFromPayment,
    buildSpreadsheetWorkbookXml: buildSpreadsheetWorkbookXml,
    downloadFileFromText: downloadFileFromText,
    sanitizeDownloadFileName: sanitizeDownloadFileName,
    hasValidEmailAddress: hasValidEmailAddress
  });
  var refreshSupplierRelatedActivity = supplierActivityModule.refreshSupplierRelatedActivity;
  var onSelectedPaymentSendLetterClick = supplierActivityModule.onSelectedPaymentSendLetterClick;
  var onSupplierInvoicesExportClick = supplierActivityModule.onSupplierInvoicesExportClick;
  var onSupplierPaymentsExportClick = supplierActivityModule.onSupplierPaymentsExportClick;
  var onSelectedPaymentLetterSupplierToggle = supplierActivityModule.onSelectedPaymentLetterSupplierToggle;
  var onSelectedPaymentLetterToggleAllClick = supplierActivityModule.onSelectedPaymentLetterToggleAllClick;
  var onSupplierActivityInvoiceSortChange = supplierActivityModule.onSupplierActivityInvoiceSortChange;
  var onSelectedPaymentLetterEmailEditClick = supplierActivityModule.onSelectedPaymentLetterEmailEditClick;
  var onSelectedPaymentLetterSubmitClick = supplierActivityModule.onSelectedPaymentLetterSubmitClick;
  var setSupplierActivityTab = supplierActivityModule.setSupplierActivityTab;
  var closeSelectedPaymentLetterPanel = supplierActivityModule.closeSelectedPaymentLetterPanel;
  var renderSelectedPaymentLetterPanel = supplierActivityModule.renderSelectedPaymentLetterPanel;
  var paymentsModule = ns.createPaymentsModule({
    FIELD_CANDIDATES: FIELD_CANDIDATES,
    helpers: helpers,
    state: state,
    renderer: renderer,
    renderAll: renderAll,
    debugError: debugError,
    cloneFilterState: cloneFilterState,
    getNormalizedStatusFilterValues: getNormalizedStatusFilterValues,
    hasAnyLoadFilterValue: hasAnyLoadFilterValue,
    getMfspFromPayment: getMfspFromPayment,
    getPaymentSupplierCodeValues: getPaymentSupplierCodeValues,
    buildLocalPageSummary: buildLocalPageSummary,
    buildCombinedStatusOptions: buildCombinedStatusOptions,
    PAYMENT_STATUS_FILTER_OPTIONS: PAYMENT_STATUS_FILTER_OPTIONS,
    getSupplierNameFromPayment: getSupplierNameFromPayment,
    createEmptyPaymentAccountMeta: createEmptyPaymentAccountMeta,
    buildStatusOptions: buildStatusOptions,
    getFriendlyLoadErrorMessage: getFriendlyLoadErrorMessage,
    resetPaymentRelationshipIndexes: resetPaymentRelationshipIndexes,
    ensurePayAllocationsLoaded: ensurePayAllocationsLoaded,
    ensurePaymentsLoaded: ensurePaymentsLoaded,
    ensurePaymentAccountsLoaded: ensurePaymentAccountsLoaded,
    requestPaymentAccountsContextLoad: requestPaymentAccountsContextLoad,
    ensureTabDataLoaded: ensureTabDataLoaded,
    getPaymentAccountsContextLoading: function () {
      return paymentAccountsContextLoadPromise;
    },
    closeSelectedPaymentLetterPanel: closeSelectedPaymentLetterPanel
  });
  var normalizePaymentsSection = paymentsModule.normalizeSection;
  var isPaymentAccountsSectionActive = paymentsModule.isAccountsSectionActive;
  var setPaymentsSection = paymentsModule.setSection;
  var loadPaymentsTabData = paymentsModule.loadTabData;
  var refreshPaymentsTabData = paymentsModule.refreshTabData;
  var refreshPaymentAccountsTabData = paymentsModule.refreshAccountsTabData;
  var buildPaymentsView = paymentsModule.buildView;
  var buildPaymentAccountsView = paymentsModule.buildAccountsView;
  var buildPaymentAllocationsView = paymentsModule.buildAllocationsView;
  var normalizePaymentDetailTab = paymentsModule.normalizeDetailTab;
  var setPaymentDetailTab = paymentsModule.setDetailTab;
  var selectPayment = paymentsModule.selectPayment;
  var selectPaymentAllocation = paymentsModule.selectPaymentAllocation;
  var selectPaymentAccount = paymentsModule.selectPaymentAccount;
  var paymentCreateModule = ns.createPaymentCreateModule({
    FIELD_CANDIDATES: FIELD_CANDIDATES,
    PAYMENT_MOVEMENT_TYPES: PAYMENT_MOVEMENT_TYPES,
    MODULES: MODULES,
    ENSURE_SUPPLIER_ACCOUNTING_ACCOUNT_FUNCTION: ENSURE_SUPPLIER_ACCOUNTING_ACCOUNT_FUNCTION,
    ENSURE_SUPPLIER_PAYMENT_ACCOUNT_FUNCTION: ENSURE_SUPPLIER_PAYMENT_ACCOUNT_FUNCTION,
    state: state,
    elements: elements,
    helpers: helpers,
    crm: crm,
    renderer: renderer,
    renderAll: renderAll,
    debugError: debugError,
    buildInvoicesView: buildInvoicesView,
    isBlockedInvoicePaymentStatus: isBlockedInvoicePaymentStatus,
    getInvoiceType: getInvoiceType,
    isCreditNoteInvoice: isCreditNoteInvoice,
    getInvoiceSupplierId: getInvoiceSupplierId,
    getSupplierNameFromInvoice: getSupplierNameFromInvoice,
    getBookingIdFromInvoice: getBookingIdFromInvoice,
    getBookingNameFromInvoice: getBookingNameFromInvoice,
    getInvoiceSettlementId: getInvoiceSettlementId,
    getInvoiceSettlementName: getInvoiceSettlementName,
    getInvoicePaidAmount: getInvoicePaidAmount,
    getMfspFromInvoice: getMfspFromInvoice,
    buildPaymentContextSummaryText: buildPaymentContextSummaryText,
    getUniqueSortedValues: getUniqueSortedValues,
    getContextDisplayValue: getContextDisplayValue,
    roundCurrency: roundCurrency,
    getLocalIsoDate: getLocalIsoDate,
    buildDefaultPaymentReference: buildDefaultPaymentReference,
    getPaymentAccountOwnerSupplierId: getPaymentAccountOwnerSupplierId,
    getPaymentAccountIbanValue: getPaymentAccountIbanValue,
    getPaymentAccountBeneficiaryName: getPaymentAccountBeneficiaryName,
    getPaymentAccountRecordById: getPaymentAccountRecordById,
    getSupplierRecordById: getSupplierRecordById,
    getSupplierDefaultPaymentAccountId: getSupplierDefaultPaymentAccountId,
    paymentAccountBelongsToSupplier: paymentAccountBelongsToSupplier,
    isSelectablePaymentAccount: isSelectablePaymentAccount,
    isOwnPaymentAccount: isOwnPaymentAccount,
    ensurePaymentAccountsLoaded: ensurePaymentAccountsLoaded,
    ensurePayAllocationsLoaded: ensurePayAllocationsLoaded,
    ensureSupplierDefaultPaymentAccountAssigned: ensureSupplierDefaultPaymentAccountAssigned,
    refreshInvoicesTabData: refreshInvoicesTabData,
    refreshPaymentsTabData: refreshPaymentsTabData,
    loadInvoicesForSupplier: loadInvoicesForSupplier,
    loadPaymentsForSupplier: loadPaymentsForSupplier,
    resetPaymentRelationshipIndexes: resetPaymentRelationshipIndexes,
    assertCrmMutationSucceeded: assertCrmMutationSucceeded,
    getFunctionOutputObject: getFunctionOutputObject,
    getFunctionResponseResult: getFunctionResponseResult,
    recalculateSettlementTotalsForSettlementIds: recalculateSettlementTotalsForSettlementIds,
    getUniqueSettlementIdsFromInvoices: getUniqueSettlementIdsFromInvoices,
    invalidateInvoiceCreateSettlementCache: invalidateInvoiceCreateSettlementCache,
    ensureInvoiceAllocationsLoaded: ensureInvoiceAllocationsLoaded,
    openNativeEditForModule: openNativeEditForModule
  });
  var resetInvoicePaymentForm = paymentCreateModule.resetInvoicePaymentForm;
  var renderInvoicePaymentPanel = paymentCreateModule.renderInvoicePaymentPanel;
  var closeCreatePaymentPanel = paymentCreateModule.closeCreatePaymentPanel;
  var openCreatePaymentPanel = paymentCreateModule.openCreatePaymentPanel;
  var onInvoicePaymentAllocationChange = paymentCreateModule.onInvoicePaymentAllocationChange;
  var onInvoicePaymentSupplierAccountChange = paymentCreateModule.onInvoicePaymentSupplierAccountChange;
  var onInvoicePaymentSupplierAccountFocus = paymentCreateModule.onInvoicePaymentSupplierAccountFocus;
  var onInvoicePaymentSupplierAccountInput = paymentCreateModule.onInvoicePaymentSupplierAccountInput;
  var onInvoicePaymentSupplierAccountBlur = paymentCreateModule.onInvoicePaymentSupplierAccountBlur;
  var onInvoicePaymentSupplierAccountOptionPointerDown = paymentCreateModule.onInvoicePaymentSupplierAccountOptionPointerDown;
  var onInvoicePaymentHeaderAccountFocus = paymentCreateModule.onInvoicePaymentHeaderAccountFocus;
  var onInvoicePaymentHeaderAccountInput = paymentCreateModule.onInvoicePaymentHeaderAccountInput;
  var onInvoicePaymentHeaderAccountKeydown = paymentCreateModule.onInvoicePaymentHeaderAccountKeydown;
  var onInvoicePaymentHeaderAccountBlur = paymentCreateModule.onInvoicePaymentHeaderAccountBlur;
  var onInvoicePaymentHeaderAccountToggleClick = paymentCreateModule.onInvoicePaymentHeaderAccountToggleClick;
  var onInvoicePaymentHeaderAccountDropdownPointerDown = paymentCreateModule.onInvoicePaymentHeaderAccountDropdownPointerDown;
  var onInvoicePaymentHeaderAccountDropdownClick = paymentCreateModule.onInvoicePaymentHeaderAccountDropdownClick;
  var onInvoicePaymentHeaderAccountDocumentPointerDown = paymentCreateModule.onInvoicePaymentHeaderAccountDocumentPointerDown;
  var onCreateSupplierPaymentSubmit = paymentCreateModule.onCreateSupplierPaymentSubmit;
  var closePaymentCreateFeedback = paymentCreateModule.closePaymentCreateFeedback;
  var refreshInvoicesAndPaymentsAfterSupplierPayment = paymentCreateModule.refreshInvoicesAndPaymentsAfterSupplierPayment;
  var accountingModule = ns.createAccountingModule({
    state: state,
    renderer: renderer,
    renderAll: renderAll,
    cloneFilterState: cloneFilterState,
    ensureTabDataLoaded: ensureTabDataLoaded,
    ensureAccountingAccountsLoaded: ensureAccountingAccountsLoaded,
    ensureAccountingEntriesLoaded: ensureAccountingEntriesLoaded,
    ensureAccountingEntryLinesLoaded: ensureAccountingEntryLinesLoaded,
    ensureAccountingRulesLoaded: ensureAccountingRulesLoaded,
    getSortedAccountingEntriesRecords: getSortedAccountingEntriesRecords,
    getSortedAccountingEntryLinesRecords: getSortedAccountingEntryLinesRecords
  });
  var normalizeAccountingTab = accountingModule.normalizeTab;
  var setAccountingTab = accountingModule.setTab;
  var refreshAccountingAccountsTabData = accountingModule.refreshAccountsTabData;
  var loadAccountingEntriesTabData = accountingModule.loadEntriesTabData;
  var refreshAccountingEntriesTabData = accountingModule.refreshEntriesTabData;
  var loadAccountingEntryLinesTabData = accountingModule.loadEntryLinesTabData;
  var refreshAccountingEntryLinesTabData = accountingModule.refreshEntryLinesTabData;
  var refreshAccountingRulesTabData = accountingModule.refreshRulesTabData;
  var buildAccountingEntriesView = accountingModule.buildEntriesView;
  var buildAccountingEntryLinesView = accountingModule.buildEntryLinesView;
  var buildAccountingAccountsView = accountingModule.buildAccountsView;
  var buildAccountingRulesView = accountingModule.buildRulesView;
  var selectAccountingAccount = accountingModule.selectAccount;
  var selectAccountingRule = accountingModule.selectRule;
  var accountCreateModule = ns.createAccountCreateModule({
    MODULES: MODULES,
    FIELD_CANDIDATES: FIELD_CANDIDATES,
    PAYMENT_ACCOUNT_CREATE_PICKLIST_FALLBACKS: PAYMENT_ACCOUNT_CREATE_PICKLIST_FALLBACKS,
    state: state,
    elements: elements,
    helpers: helpers,
    crm: crm,
    renderer: renderer,
    renderAll: renderAll,
    debugError: debugError,
    renderInvoiceCreateSelect: renderInvoiceCreateSelect,
    ensurePaymentAccountsLoaded: ensurePaymentAccountsLoaded,
    ensureAccountingAccountsLoaded: ensureAccountingAccountsLoaded,
    ensureSupplierDefaultPaymentAccountAssigned: ensureSupplierDefaultPaymentAccountAssigned
  });
  var refreshPaymentAccountCreateActionState = accountCreateModule.refreshPaymentAccountCreateActionState;
  var renderPaymentAccountCreatePicklists = accountCreateModule.renderPaymentAccountCreatePicklists;
  var clearPaymentAccountCreateFieldErrors = accountCreateModule.clearPaymentAccountCreateFieldErrors;
  var resetPaymentAccountCreateForm = accountCreateModule.resetPaymentAccountCreateForm;
  var renderPaymentAccountCreatePanel = accountCreateModule.renderPaymentAccountCreatePanel;
  var openCreatePaymentAccountPanel = accountCreateModule.openCreatePaymentAccountPanel;
  var openEditPaymentAccountPanel = accountCreateModule.openEditPaymentAccountPanel;
  var closeCreatePaymentAccountPanel = accountCreateModule.closeCreatePaymentAccountPanel;
  var onCreatePaymentAccountSubmit = accountCreateModule.onCreatePaymentAccountSubmit;
  var refreshAccountingAccountCreateActionState = accountCreateModule.refreshAccountingAccountCreateActionState;
  var clearAccountingAccountCreateFieldErrors = accountCreateModule.clearAccountingAccountCreateFieldErrors;
  var renderAccountingAccountCreatePanel = accountCreateModule.renderAccountingAccountCreatePanel;
  var openCreateAccountingAccountPanel = accountCreateModule.openCreateAccountingAccountPanel;
  var closeCreateAccountingAccountPanel = accountCreateModule.closeCreateAccountingAccountPanel;
  var onCreateAccountingAccountSubmit = accountCreateModule.onCreateAccountingAccountSubmit;
  var invoiceCreateModule = ns.createInvoiceCreateModule({
    MODULES: MODULES,
    FIELD_CANDIDATES: FIELD_CANDIDATES,
    INVOICE_LINE_FIELDS: INVOICE_LINE_FIELDS,
    CREATE_LINES_FUNCTION: CREATE_LINES_FUNCTION,
    INVOICE_CREATE_MODES: INVOICE_CREATE_MODES,
    INVOICE_CREATE_STEPS: INVOICE_CREATE_STEPS,
    INVOICE_CREATE_VALIDATION_FIELD_KEYS: INVOICE_CREATE_VALIDATION_FIELD_KEYS,
    INVOICE_TYPES: INVOICE_TYPES,
    DEFAULT_INVOICE_STATUS: DEFAULT_INVOICE_STATUS,
    state: state,
    elements: elements,
    helpers: helpers,
    crm: crm,
    renderer: renderer,
    renderAll: renderAll,
    debugError: debugError,
    debugWarn: debugWarn,
    setInvoiceCreateStep: setInvoiceCreateStep,
    getInvoiceCreateStep: getInvoiceCreateStep,
    getLocalIsoDate: getLocalIsoDate,
    applyInvoiceCreateSupplierTaxDefaults: applyInvoiceCreateSupplierTaxDefaults,
    isInvoiceCreateRefundMode: isInvoiceCreateRefundMode,
    getInvoiceCreateRecordLabel: getInvoiceCreateRecordLabel,
    getInvoiceCreateStepForFieldKey: getInvoiceCreateStepForFieldKey,
    getInvoiceCreateSelectedTypeValue: getInvoiceCreateSelectedTypeValue,
    getInvoiceCreateTypeOptionsForMode: getInvoiceCreateTypeOptionsForMode,
    getInvoiceCreateTitleText: getInvoiceCreateTitleText,
    syncInvoiceCreateModeDefaults: syncInvoiceCreateModeDefaults,
    ensureBookingsLoaded: ensureBookingsLoaded,
    ensureInvoiceCreateFieldMetadataLoaded: ensureInvoiceCreateFieldMetadataLoaded,
    ensureInvoiceCreateSettlementStatusOptionsLoaded: ensureInvoiceCreateSettlementStatusOptionsLoaded,
    getDefaultInvoiceCreateSettlementStatusValues: getDefaultInvoiceCreateSettlementStatusValues,
    getNormalizedInvoiceCreateSettlementStatusValues: getNormalizedInvoiceCreateSettlementStatusValues,
    hasAllInvoiceCreateSettlementStatusesSelected: hasAllInvoiceCreateSettlementStatusesSelected,
    getUniqueSortedValues: getUniqueSortedValues,
    getResolvedInvoiceCreateFieldApi: getResolvedInvoiceCreateFieldApi,
    validateInvoiceCreateSettlementCapacity: validateInvoiceCreateSettlementCapacity,
    validateInvoiceCreateNumberUniqueness: validateInvoiceCreateNumberUniqueness,
    isSupplierSelfEmployed: isSupplierSelfEmployed,
    updateSupplierSelfEmployedStatus: updateSupplierSelfEmployedStatus,
    recalculateSettlementTotals: recalculateSettlementTotals,
    invalidateInvoiceCreateSettlementCache: invalidateInvoiceCreateSettlementCache,
    getSupplierResolvedAccountingAccount: getSupplierResolvedAccountingAccount,
    getSupplierDefaultPaymentAccountLabel: getSupplierDefaultPaymentAccountLabel,
    renderInvoiceCreateSelect: renderInvoiceCreateSelect,
    getInvoiceCreateSettlementUnpaidInvoicedAmount: getInvoiceCreateSettlementUnpaidInvoicedAmount,
    getInvoiceCreateSettlementRemainingToInvoice: getInvoiceCreateSettlementRemainingToInvoice,
    resolveCoqlFields: resolveCoqlFields,
    escapeCoqlValue: escapeCoqlValue,
    formatFileSize: formatFileSize,
    getInvoiceCreateDocumentFile: getInvoiceCreateDocumentFile,
    isPreviewableImageFile: isPreviewableImageFile,
    isPreviewablePdfFile: isPreviewablePdfFile,
    clearInvoiceCreateDocumentFileSelection: clearInvoiceCreateDocumentFileSelection,
    onInvoiceCreateDocumentFileChange: onInvoiceCreateDocumentFileChange,
    onInvoiceCreateDocumentFilePreviewClick: onInvoiceCreateDocumentFilePreviewClick,
    refreshInvoicesTabData: refreshInvoicesTabData,
    refreshSupplierRelatedActivity: refreshSupplierRelatedActivity,
    getFunctionResponseResult: getFunctionResponseResult,
    getInvoiceLinePermissionHelpMessage: getInvoiceLinePermissionHelpMessage,
    getInvoiceCreateNumberValue: getInvoiceCreateNumberValue,
    roundCurrency: roundCurrency,
    uploadFileToInvoiceField: uploadFileToInvoiceField
  });
  var bindInvoiceCreateEvents = invoiceCreateModule.bindEvents;
  var refreshInvoiceCreateActionState = invoiceCreateModule.refreshActionState;
  var openCreateInvoicePanel = invoiceCreateModule.openPanel;
  var refreshInvoicesAfterCreate = invoiceCreateModule.refreshAfterCreate;
  var renderInvoiceCreateDocumentFilePreview = invoiceCreateModule.renderDocumentFilePreview;
  var setInvoiceCreateLoading = invoiceCreateModule.setLoading;
  var clearInvoiceCreateValidationState = invoiceCreateModule.clearValidationState;
  var syncInvoiceCreateAdditionalVatVisibility = invoiceCreateModule.syncAdditionalVatVisibility;
  var setDefaultInvoiceCreateStatus = invoiceCreateModule.setDefaultStatus;
  var updateInvoiceCreateComputedAmounts = invoiceCreateModule.updateComputedAmounts;
  var closeCreateInvoicePanel = invoiceCreateModule.closePanel;
  var renderInvoiceCreatePanel = invoiceCreateModule.renderPanel;
  var resetInvoiceCreateSettlementState = invoiceCreateModule.resetSettlementState;
  var loadSettlementsForSupplier = invoiceCreateModule.loadSettlementsForSupplier;
  var reloadInvoiceCreateSettlements = invoiceCreateModule.reloadSettlements;
  var loadServicesForSettlement = invoiceCreateModule.loadServicesForSettlement;
  var createInvoiceLinesForInvoice = invoiceCreateModule.createInvoiceLinesForInvoice;
  var resetInvoiceCreateFormAfterCreate = invoiceCreateModule.resetFormAfterCreate;
  var renderInvoiceCreateSettlementSummary = invoiceCreateModule.renderSettlementSummary;
  var supplierWorkspaceModule = ns.createSupplierWorkspaceModule({
    MODULES: MODULES,
    FIELD_CANDIDATES: FIELD_CANDIDATES,
    state: state,
    elements: elements,
    helpers: helpers,
    crm: crm,
    renderer: renderer,
    renderAll: renderAll,
    debugError: debugError,
    closeCreateInvoicePanel: closeCreateInvoicePanel,
    loadInvoicesForSupplier: loadInvoicesForSupplier,
    loadPaymentsForSupplier: loadPaymentsForSupplier,
    resetInvoiceCreateSettlementState: resetInvoiceCreateSettlementState,
    resetInvoiceCreateFormAfterCreate: resetInvoiceCreateFormAfterCreate,
    applyInvoiceCreateSupplierTaxDefaults: applyInvoiceCreateSupplierTaxDefaults,
    reloadInvoiceCreateSettlements: reloadInvoiceCreateSettlements
  });
  var getSupplierSearchDisplayValue = supplierWorkspaceModule.getSearchDisplayValue;
  var bootstrapRecentSuppliers = supplierWorkspaceModule.bootstrapRecentSuppliers;
  var cacheSupplierLookup = supplierWorkspaceModule.cacheSupplierLookup;
  var onLoadSupplierClick = supplierWorkspaceModule.onLoadSupplierClick;
  var loadSupplierWorkspace = supplierWorkspaceModule.loadSupplierWorkspace;
  var clearSupplierWorkspace = supplierWorkspaceModule.clearSupplierWorkspace;
  var onCloseSupplierWorkspaceClick = supplierWorkspaceModule.onCloseSupplierWorkspaceClick;

  async function openAgentCommissionInvoice(settlement) {
    var supplierId = helpers.getLookupId(settlement && settlement.Supplier);
    var settlementId = String(settlement && settlement.id || "").trim();
    var selectedSettlement;

    if (!supplierId || !settlementId) {
      throw new Error("The agent commission settlement does not have a Vendor, so the invoice form cannot be opened.");
    }

    await setCurrentTab("suppliers");
    await loadSupplierWorkspace(supplierId);
    if (!state.supplierId || String(state.supplierId) !== String(supplierId)) {
      throw new Error("The agency Vendor could not be loaded for this agent commission.");
    }

    await openCreateInvoicePanel(INVOICE_CREATE_MODES.invoice);
    selectedSettlement = (state.invoiceCreation.settlements || []).filter(function (item) {
      return String(item && item.id || "") === settlementId;
    })[0] || null;

    if (!selectedSettlement) {
      // A newly created settlement can be read by ID before it is visible in
      // the supplier search used to populate this table. Keep that record in
      // the local list so the user can select it immediately.
      selectedSettlement = settlement;
      state.invoiceCreation.settlements = [settlement].concat((state.invoiceCreation.settlements || []).filter(function (item) {
        return String(item && item.id || "") !== settlementId;
      }));
      state.invoiceCreation.hasLoadedSettlements = true;
    }

    state.invoiceCreation.selectedSettlements = [selectedSettlement];
    state.invoiceCreation.settlementAllocationAmounts = {};
    await invoiceCreateModule.selectSettlement(selectedSettlement);
  }

  attachGlobalDebugListeners();
  bindEvents();
  initFallbackState();
  bootstrap();

  function bindEvents() {
    elements.loadSupplier.addEventListener("click", onLoadSupplierClick);
    if (elements.focusSupplierSearch) {
      elements.focusSupplierSearch.addEventListener("click", function () {
        elements.supplierSearch.focus();
      });
    }
    elements.supplierSearch.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        onLoadSupplierClick();
      }
    });

    elements.tabButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        setCurrentTab(button.getAttribute("data-tab-button"));
      });
    });
    if (elements.invoiceSummaryClose) {
      elements.invoiceSummaryClose.addEventListener("click", function () {
        setInvoiceSummaryOpen(false);
      });
    }
    if (elements.invoiceSummaryOpen) {
      elements.invoiceSummaryOpen.addEventListener("click", function () {
        setInvoiceSummaryOpen(true);
      });
    }
    if (elements.bookingActionsToggle) {
      elements.bookingActionsToggle.addEventListener("click", onBookingActionsToggleClick);
    }
    if (elements.bookingActionsClose) {
      elements.bookingActionsClose.addEventListener("click", function () {
        setBookingActionsPopupOpen(false);
      });
    }
    if (elements.bookingActionsBackdrop) {
      elements.bookingActionsBackdrop.addEventListener("click", function () {
        setBookingActionsPopupOpen(false);
      });
    }
    if (elements.bookingActionsSyncProject) {
      elements.bookingActionsSyncProject.addEventListener("click", onBookingSyncProjectClick);
    }
    if (elements.bookingActionsRecalculateSettlement) {
      elements.bookingActionsRecalculateSettlement.addEventListener("click", onBookingRecalculateSettlementClick);
    }
    if (elements.bookingActionsTripClosure) {
      elements.bookingActionsTripClosure.addEventListener("click", onBookingTripClosureClick);
    }
    if (elements.bookingClosureClose) {
      elements.bookingClosureClose.addEventListener("click", closeBookingClosure);
    }
    if (elements.bookingClosureRefresh) {
      elements.bookingClosureRefresh.addEventListener("click", onBookingClosureRefreshClick);
    }
    if (elements.bookingClosurePopup) {
      elements.bookingClosurePopup.addEventListener("click", function (event) {
        if (event.target === elements.bookingClosurePopup) {
          closeBookingClosure();
        }
      });
    }
    if (elements.bookingClosureContent) {
      elements.bookingClosureContent.addEventListener("click", onBookingClosureTableControlClick);
      elements.bookingClosureContent.addEventListener("click", onBookingClosureReviewClick);
      elements.bookingClosureContent.addEventListener("click", onBookingClosureSettlementClick);
    }
    if (elements.bookingClosureDetailClose) {
      elements.bookingClosureDetailClose.addEventListener("click", closeBookingClosureDetail);
    }
    if (elements.bookingClosureDetailPopup) {
      elements.bookingClosureDetailPopup.addEventListener("click", function (event) {
        if (event.target === elements.bookingClosureDetailPopup) {
          closeBookingClosureDetail();
        }
      });
    }
    if (elements.agentCommissionClose) {
      elements.agentCommissionClose.addEventListener("click", closeAgentCommissionPopup);
    }
    if (elements.agentCommissionRecalculate) {
      elements.agentCommissionRecalculate.addEventListener("click", onAgentCommissionRecalculateClick);
    }
    if (elements.agentCommissionPopup) {
      elements.agentCommissionPopup.addEventListener("click", function (event) {
        if (event.target === elements.agentCommissionPopup) {
          closeAgentCommissionPopup();
        }
      });
    }
    if (elements.bookingsTableBody) {
      elements.bookingsTableBody.addEventListener("click", function (event) {
        var actionButton = event.target && event.target.closest("[data-booking-row-action]");
        var actionMenu = event.target && event.target.closest(".booking-row-actions");
        var actionRow;

        if (actionButton) {
          event.preventDefault();
          event.stopPropagation();
          if (actionMenu) {
            actionMenu.open = false;
          }
          actionRow = actionButton.closest("[data-booking-id]");
          onBookingRowActionClick(
            actionButton.getAttribute("data-booking-row-action"),
            actionRow && actionRow.getAttribute("data-booking-id"),
            actionRow && actionRow.getAttribute("data-booking-closure-mfsp")
          );
          return;
        }

        if (actionMenu) {
          Array.prototype.forEach.call(global.document.querySelectorAll(".booking-row-actions[open]"), function (openActionMenu) {
            if (openActionMenu !== actionMenu) {
              openActionMenu.open = false;
            }
          });
          global.setTimeout(function () {
            var summary = actionMenu.querySelector("summary");
            var menu = actionMenu.querySelector(".booking-row-actions-menu");
            var rect;
            var menuWidth;
            var left;
            var top;

            if (!actionMenu.open || !summary || !menu) {
              return;
            }

            rect = summary.getBoundingClientRect();
            menuWidth = menu.offsetWidth;
            left = Math.min(rect.left, global.innerWidth - menuWidth - 8);
            left = Math.max(8, left);
            top = rect.bottom + 4;
            if (top + menu.offsetHeight > global.innerHeight - 8) {
              top = Math.max(8, rect.top - menu.offsetHeight - 4);
            }
            menu.style.left = left + "px";
            menu.style.top = top + "px";
          }, 0);
          return;
        }
      });
    }
    global.document.addEventListener("click", function (event) {
      var clickedActionMenu = event.target && event.target.closest && event.target.closest(".booking-row-actions");
      var openActionMenus;

      if (clickedActionMenu) {
        return;
      }

      openActionMenus = global.document.querySelectorAll(".booking-row-actions[open]");
      Array.prototype.forEach.call(openActionMenus, function (actionMenu) {
        actionMenu.open = false;
      });
    });
    global.document.addEventListener("click", onDocumentClickCloseBookingActionsPopup);
    global.document.addEventListener("keydown", onDocumentKeydownCloseBookingActionsPopup);
    if (elements.supplierInvoicesTableBody) {
      elements.supplierInvoicesTableBody.addEventListener("click", function (event) {
        var row = event.target && event.target.closest("[data-supplier-activity-invoice-id]");
        if (row) {
          openSupplierActivityDetail("invoice", row.getAttribute("data-supplier-activity-invoice-id"));
        }
      });
    }
    if (elements.supplierPaymentsTableBody) {
      elements.supplierPaymentsTableBody.addEventListener("click", function (event) {
        var row = event.target && event.target.closest("[data-supplier-activity-payment-id]");
        if (row) {
          openSupplierActivityDetail("payment", row.getAttribute("data-supplier-activity-payment-id"));
        }
      });
    }
    if (elements.supplierActivityDetailClose) {
      elements.supplierActivityDetailClose.addEventListener("click", closeSupplierActivityDetail);
    }
    if (elements.supplierActivityDetailPopup) {
      elements.supplierActivityDetailPopup.addEventListener("click", function (event) {
        if (event.target === elements.supplierActivityDetailPopup) {
          closeSupplierActivityDetail();
        }
      });
    }
    global.document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.supplierActivityDetail && state.supplierActivityDetail.isOpen) {
        closeSupplierActivityDetail();
      }
    });

    bindBookingsLoadFilterControl(elements.bookingsFilterMfsp, "mfsp");
    bindBookingsLoadFilterControl(elements.bookingsFilterName, "bookingName");
    bindBookingsLoadFilterControl(elements.bookingsFilterArrivalMode, "arrivalDateMode", true);
    bindBookingsLoadFilterControl(elements.bookingsFilterArrivalDateFrom, "arrivalDateFrom");
    bindBookingsLoadFilterControl(elements.bookingsFilterArrivalDateTo, "arrivalDateTo");
    bindBookingsLoadFilterControl(elements.bookingsFilterAgency, "agency");
    bindBookingsLoadFilterControl(elements.bookingsFilterAccountingRep, "accountingRep");
    elements.bookingsFilterStageToggle.addEventListener("click", onBookingsStageToggleClick);
    elements.bookingsFilterStageMenu.addEventListener("change", onBookingsStageOptionChange);
    elements.bookingsFilterStageMenu.addEventListener("click", onBookingsStageMenuActionClick);
    global.document.addEventListener("click", onDocumentClickCloseBookingsStageDropdown);
    elements.bookingsLoad.addEventListener("click", loadBookingsBrowserData);
    elements.bookingsPrevPage.addEventListener("click", function () {
      if (state.views.bookings.hasLoaded && state.views.bookings.page > 1) {
        loadBookingsBrowserData({
          page: state.views.bookings.page - 1,
          filters: state.views.bookings.appliedFilters
        });
      }
    });
    elements.bookingsNextPage.addEventListener("click", function () {
      if (state.views.bookings.hasLoaded && state.views.bookings.hasMore) {
        loadBookingsBrowserData({
          page: state.views.bookings.page + 1,
          filters: state.views.bookings.appliedFilters
        });
      }
    });

    bindInvoicesLoadFilterControl(elements.invoiceFilterDateFrom, "dateFrom");
    bindInvoicesLoadFilterControl(elements.invoiceFilterDateTo, "dateTo");
    elements.invoiceFilterDatePreset.addEventListener("change", function () {
      applyDateFilterPreset("invoices", elements.invoiceFilterDatePreset.value);
    });
    bindInvoicesLoadFilterControl(elements.invoiceFilterType, "invoiceType");
    bindInvoicesLoadFilterControl(elements.invoiceFilterSupplierCode, "supplierCode");
    bindInvoicesLoadFilterControl(elements.invoiceFilterMfsp, "mfsp");
    elements.invoiceFilterStatusToggle.addEventListener("click", function (event) {
      onStatusFilterToggleClick("invoices", event);
    });
    elements.invoiceFilterStatusMenu.addEventListener("change", function (event) {
      onStatusFilterOptionChange("invoices", event);
    });
    elements.invoiceFilterStatusMenu.addEventListener("click", function (event) {
      onStatusFilterMenuActionClick("invoices", event);
    });
    elements.invoiceViewButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        var view = button.getAttribute("data-invoice-view") || "open";
        state.views.invoices.view = view;
        elements.invoiceViewButtons.forEach(function (item) {
          var isActive = item === button;
          item.classList.toggle("is-active", isActive);
          item.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
        state.views.invoices.page = 1;
        refreshInvoicesTabData({
          loadingLabel: "Loading invoices...",
          errorMessage: "Could not load invoices.",
          loadedFlag: true
        });
      });
    });

    bindPaymentsLoadFilterControl(elements.paymentFilterDateFrom, "dateFrom");
    bindPaymentsLoadFilterControl(elements.paymentFilterDateTo, "dateTo");
    elements.paymentFilterDatePreset.addEventListener("change", function () {
      applyDateFilterPreset("payments", elements.paymentFilterDatePreset.value);
      scheduleRemoteViewReload("payments");
    });
    bindPaymentsLoadFilterControl(elements.paymentFilterSupplierCode, "supplierCode");
    bindPaymentsLoadFilterControl(elements.paymentFilterMfsp, "mfsp");
    bindAccountingEntriesLoadFilterControl(elements.accountingEntryFilterDateFrom, "dateFrom");
    bindAccountingEntriesLoadFilterControl(elements.accountingEntryFilterDateTo, "dateTo");
    bindAccountingEntriesLoadFilterControl(elements.accountingEntryFilterName, "entryName");
    bindAccountingEntryLinesLoadFilterControl(elements.accountingEntryLineFilterDateFrom, "dateFrom");
    bindAccountingEntryLinesLoadFilterControl(elements.accountingEntryLineFilterDateTo, "dateTo");
    bindAccountingEntryLinesLoadFilterControl(elements.accountingEntryLineFilterName, "lineName");
    elements.paymentFilterStatusToggle.addEventListener("click", function (event) {
      onStatusFilterToggleClick("payments", event);
    });
    elements.paymentFilterStatusMenu.addEventListener("change", function (event) {
      onStatusFilterOptionChange("payments", event);
    });
    elements.paymentFilterStatusMenu.addEventListener("click", function (event) {
      onStatusFilterMenuActionClick("payments", event);
    });
    global.document.addEventListener("click", onDocumentClickCloseStatusFilterDropdown);

    bindFilterControl(elements.paymentAccountFilterQuery, "paymentAccounts", "query");
    bindFilterControl(elements.paymentAccountFilterSupplier, "paymentAccounts", "supplierId");
    bindFilterControl(elements.paymentAccountFilterMfsp, "paymentAccounts", "mfsp");
    bindFilterControl(elements.paymentAccountFilterMappingStatus, "paymentAccounts", "status");

    elements.invoicesPrevPage.addEventListener("click", function () {
      if (state.views.invoices.hasLoaded && state.views.invoices.page > 1) {
        state.views.invoices.page -= 1;
        renderAll();
      }
    });

    elements.invoicesNextPage.addEventListener("click", function () {
      if (state.views.invoices.hasLoaded && state.views.invoices.hasMore) {
        state.views.invoices.page += 1;
        renderAll();
      }
    });
    if (elements.invoicesLoad) {
      elements.invoicesLoad.addEventListener("click", loadInvoicesTabData);
    }
    if (elements.invoicesApplyFilters) {
      elements.invoicesApplyFilters.addEventListener("click", loadInvoicesTabData);
    }
    if (elements.invoicesRefresh) {
      elements.invoicesRefresh.addEventListener("click", function () {
        refreshInvoicesTabData({
          loadingLabel: "Refreshing invoices...",
          errorMessage: "Could not refresh invoices.",
          loadedFlag: true
        });
      });
    }

    elements.invoiceCreatePayment.addEventListener("click", function () {
      openCreatePaymentPanel();
    });
    elements.invoicePaymentClose.addEventListener("click", closeCreatePaymentPanel);
    elements.invoicePaymentCancel.addEventListener("click", closeCreatePaymentPanel);
    elements.invoicePaymentForm.addEventListener("submit", onCreateSupplierPaymentSubmit);
    elements.paymentCreateFeedbackClose.addEventListener("click", closePaymentCreateFeedback);
    elements.invoicePaymentName.addEventListener("input", function () {
      state.paymentCreation.form.name = elements.invoicePaymentName.value;
    });
    elements.invoicePaymentDate.addEventListener("change", function () {
      state.paymentCreation.form.paymentDate = elements.invoicePaymentDate.value;
      syncInvoicePaymentReferenceWithDate();
      renderInvoicePaymentPanel();
    });
    elements.invoicePaymentAccount.addEventListener("focus", onInvoicePaymentHeaderAccountFocus);
    elements.invoicePaymentAccount.addEventListener("input", onInvoicePaymentHeaderAccountInput);
    elements.invoicePaymentAccount.addEventListener("keydown", onInvoicePaymentHeaderAccountKeydown);
    elements.invoicePaymentAccount.addEventListener("blur", onInvoicePaymentHeaderAccountBlur);
    elements.invoicePaymentAccountToggle.addEventListener("click", onInvoicePaymentHeaderAccountToggleClick);
    elements.invoicePaymentAccountDropdown.addEventListener("pointerdown", onInvoicePaymentHeaderAccountDropdownPointerDown);
    elements.invoicePaymentAccountDropdown.addEventListener("click", onInvoicePaymentHeaderAccountDropdownClick);
    elements.invoicePaymentAccountDropdown.addEventListener("input", function (event) {
      if (event.target && event.target.classList.contains("payment-account-dropdown-search")) {
        onInvoicePaymentHeaderAccountInput(event);
      }
    });
    elements.invoicePaymentAccountDropdown.addEventListener("keydown", function (event) {
      if (event.target && event.target.classList.contains("payment-account-dropdown-search")) {
        onInvoicePaymentHeaderAccountKeydown(event);
      }
    });
    document.addEventListener("pointerdown", onInvoicePaymentHeaderAccountDocumentPointerDown);
    elements.invoicePaymentSupplierAccountsList.addEventListener("change", onInvoicePaymentSupplierAccountChange);
    elements.invoicePaymentSupplierAccountsList.addEventListener("focusin", function (event) {
      if (event.target && event.target.classList.contains("payment-supplier-account-input")) {
        onInvoicePaymentSupplierAccountFocus(event);
      }
    });
    elements.invoicePaymentSupplierAccountsList.addEventListener("input", function (event) {
      if (event.target && event.target.classList.contains("payment-supplier-account-input")) {
        onInvoicePaymentSupplierAccountInput(event);
      }
    });
    elements.invoicePaymentSupplierAccountsList.addEventListener("focusout", function (event) {
      if (event.target && event.target.classList.contains("payment-supplier-account-input")) {
        onInvoicePaymentSupplierAccountBlur(event);
      }
    });
    elements.invoicePaymentSupplierAccountsList.addEventListener("pointerdown", onInvoicePaymentSupplierAccountOptionPointerDown);
    elements.invoicePaymentAllocationsList.addEventListener("change", onInvoicePaymentAllocationChange);

    elements.paymentsPrevPage.addEventListener("click", function () {
      if (state.views.payments.hasLoaded && state.views.payments.page > 1) {
        state.views.payments.page -= 1;
        ensurePaymentsLoaded();
      }
    });

    elements.paymentsNextPage.addEventListener("click", function () {
      if (state.views.payments.hasLoaded && state.views.payments.hasMore) {
        state.views.payments.page += 1;
        ensurePaymentsLoaded();
      }
    });
    if (elements.paymentsLoad) {
      elements.paymentsLoad.addEventListener("click", loadPaymentsTabData);
    }
    elements.paymentsSectionTabPayments.addEventListener("click", function () {
      setPaymentsSection("payments");
    });
    elements.paymentsSectionTabAllocations.addEventListener("click", function () {
      setPaymentsSection("allocations");
    });
    elements.paymentsSectionTabAccounts.addEventListener("click", function () {
      setPaymentsSection("accounts");
    });
    [
      [elements.paymentAllocationFilterReference, "reference"], [elements.paymentAllocationFilterMovementType, "movementType"],
      [elements.paymentAllocationFilterPayment, "payment"], [elements.paymentAllocationFilterInvoice, "invoice"],
      [elements.paymentAllocationFilterSupplierCode, "supplierCode"]
    ].forEach(function (entry) {
      entry[0].addEventListener(entry[0].tagName === "SELECT" ? "change" : "input", function () {
        state.views.paymentAllocations.filters[entry[1]] = entry[0].value;
        state.views.paymentAllocations.page = 1;
        renderAll();
      });
    });
    elements.paymentAllocationsPrevPage.addEventListener("click", function () {
      if (state.views.paymentAllocations.page > 1) {
        state.views.paymentAllocations.page -= 1;
        renderAll();
      }
    });
    elements.paymentAllocationsNextPage.addEventListener("click", function () {
      state.views.paymentAllocations.page += 1;
      renderAll();
    });
    elements.selectedPaymentDelete.addEventListener("click", openPaymentUndoConfirmation);
    elements.selectedPaymentManageAllocations.addEventListener("click", openPaymentAllocationManager);
    elements.paymentAllocationManagerClose.addEventListener("click", closePaymentAllocationManager);
    elements.paymentAllocationManagerSave.addEventListener("click", savePaymentAllocationManager);
    elements.paymentAllocationManagerList.addEventListener("change", onPaymentAllocationManagerAmountChange);
    elements.paymentAllocationManagerList.addEventListener("click", onPaymentAllocationManagerRemoveClick);
    elements.paymentAllocationManagerFilter.addEventListener("input", filterPaymentAllocationManagerTable);
    elements.paymentAllocationManagerAdd.addEventListener("click", openPaymentAllocationInvoicePicker);
    elements.paymentAllocationManagerSearch.addEventListener("input", searchPaymentAllocationManagerInvoices);
    elements.paymentAllocationManagerResults.addEventListener("click", addPaymentAllocationManagerInvoice);
    elements.paymentAllocationInvoicePickerClose.addEventListener("click", closePaymentAllocationInvoicePicker);
    elements.paymentAllocationFeedbackClose.addEventListener("click", closePaymentAllocationFeedback);
    elements.paymentUndoConfirmationCancel.addEventListener("click", closePaymentUndoConfirmation);
    elements.paymentUndoConfirmationConfirm.addEventListener("click", onSelectedPaymentDeleteClick);
    elements.paymentUndoConfirmationClose.addEventListener("click", closePaymentUndoConfirmation);
    elements.selectedPaymentSyncAccounting.addEventListener("click", onSelectedPaymentSyncAccountingClick);
    elements.selectedPaymentRebuildAccountingTotals.addEventListener("click", onSelectedPaymentRebuildAccountingTotalsClick);
    elements.selectedPaymentExportBank.addEventListener("click", onSelectedPaymentExportBankClick);
    elements.selectedPaymentExportBankInvoices.addEventListener("click", onSelectedPaymentExportBankByInvoiceClick);
    elements.selectedPaymentSendLetter.addEventListener("click", onSelectedPaymentSendLetterClick);
    elements.selectedPaymentLetterSuppliers.addEventListener("change", onSelectedPaymentLetterSupplierToggle);
    elements.selectedPaymentLetterToggleAll.addEventListener("click", onSelectedPaymentLetterToggleAllClick);
    elements.selectedPaymentLetterSuppliers.addEventListener("click", onSelectedPaymentLetterEmailEditClick);
    elements.selectedPaymentLetterSubmit.addEventListener("click", onSelectedPaymentLetterSubmitClick);
    elements.selectedPaymentLetterCancel.addEventListener("click", function () {
      closeSelectedPaymentLetterPanel();
      renderAll();
    });

    elements.paymentAccountsPrevPage.addEventListener("click", function () {
      if (state.views.paymentAccounts.page > 1) {
        state.views.paymentAccounts.page -= 1;
        renderAll();
      }
    });

    elements.paymentAccountsNextPage.addEventListener("click", function () {
      state.views.paymentAccounts.page += 1;
      renderAll();
    });
    elements.paymentAccountsRefresh.addEventListener("click", refreshPaymentAccountsTabData);
    elements.accountingTabEntries.addEventListener("click", function () {
      setAccountingTab("entries");
    });
    elements.accountingTabLines.addEventListener("click", function () {
      setAccountingTab("lines");
    });
    elements.accountingTabAccounts.addEventListener("click", function () {
      setAccountingTab("accounts");
    });
    elements.accountingTabRules.addEventListener("click", function () {
      setAccountingTab("rules");
    });
    elements.accountingEntriesPrevPage.addEventListener("click", function () {
      if (state.views.accountingEntries.hasLoaded && state.views.accountingEntries.page > 1) {
        state.views.accountingEntries.page -= 1;
        loadAccountingEntriesTabData({
          preservePage: true
        });
      }
    });
    elements.accountingEntriesNextPage.addEventListener("click", function () {
      if (state.views.accountingEntries.hasLoaded && state.views.accountingEntries.hasMore) {
        state.views.accountingEntries.page += 1;
        loadAccountingEntriesTabData({
          preservePage: true
        });
      }
    });
    elements.accountingEntryLinesPrevPage.addEventListener("click", function () {
      if (state.views.accountingEntryLines.hasLoaded && state.views.accountingEntryLines.page > 1) {
        state.views.accountingEntryLines.page -= 1;
        loadAccountingEntryLinesTabData({
          preservePage: true
        });
      }
    });
    elements.accountingEntryLinesNextPage.addEventListener("click", function () {
      if (state.views.accountingEntryLines.hasLoaded && state.views.accountingEntryLines.hasMore) {
        state.views.accountingEntryLines.page += 1;
        loadAccountingEntryLinesTabData({
          preservePage: true
        });
      }
    });
    elements.accountingAccountsPrevPage.addEventListener("click", function () {
      if (state.views.accountingAccounts.page > 1) {
        state.views.accountingAccounts.page -= 1;
        renderAll();
      }
    });
    elements.accountingAccountsNextPage.addEventListener("click", function () {
      state.views.accountingAccounts.page += 1;
      renderAll();
    });
    elements.accountingRulesPrevPage.addEventListener("click", function () {
      if (state.views.accountingRules.page > 1) {
        state.views.accountingRules.page -= 1;
        renderAll();
      }
    });
    elements.accountingRulesNextPage.addEventListener("click", function () {
      state.views.accountingRules.page += 1;
      renderAll();
    });
    if (elements.accountingEntriesLoad) {
      elements.accountingEntriesLoad.addEventListener("click", loadAccountingEntriesTabData);
    }
    if (elements.accountingEntryLinesLoad) {
      elements.accountingEntryLinesLoad.addEventListener("click", loadAccountingEntryLinesTabData);
    }
    if (elements.accountingEntryLinesExportContasol) {
      elements.accountingEntryLinesExportContasol.addEventListener("click", onAccountingEntryLinesExportContasolClick);
    }
    elements.accountingAccountsRefresh.addEventListener("click", refreshAccountingAccountsTabData);
    elements.accountingRulesRefresh.addEventListener("click", refreshAccountingRulesTabData);
    elements.accountingAccountCreateOpen.addEventListener("click", openCreateAccountingAccountPanel);
    elements.accountingRuleCreateOpen.addEventListener("click", function () {
      openNativeCreateForModule(MODULES.accountingRules, "accounting rule", refreshAccountingRulesTabData);
    });
    elements.accountingAccountCreateClose.addEventListener("click", closeCreateAccountingAccountPanel);
    elements.accountingAccountCreateCancel.addEventListener("click", closeCreateAccountingAccountPanel);
    elements.accountingAccountCreateForm.addEventListener("submit", onCreateAccountingAccountSubmit);
    elements.accountingAccountCreateCode.addEventListener("input", clearAccountingAccountCreateFieldErrors);

    elements.paymentAccountCreateOpen.addEventListener("click", openCreatePaymentAccountPanel);
    elements.selectedPaymentAccountEdit.addEventListener("click", function () {
      if (!state.views.paymentAccounts.selectedId) {
        renderer.showError("Select a payment account first.");
        return;
      }

      openEditPaymentAccountPanel(state.views.paymentAccounts.selectedId);
    });
    elements.paymentAccountCreateClose.addEventListener("click", closeCreatePaymentAccountPanel);
    elements.paymentAccountCreateCancel.addEventListener("click", closeCreatePaymentAccountPanel);
    elements.paymentAccountCreateForm.addEventListener("submit", onCreatePaymentAccountSubmit);
    elements.paymentAccountCreateName.addEventListener("input", clearPaymentAccountCreateFieldErrors);

    elements.createInvoiceFromSupplier.addEventListener("click", async function () {
      if (!state.supplierId) {
        renderer.showError("Load a supplier first.");
        return;
      }

      renderer.showError("");
      await openCreateInvoicePanel(INVOICE_CREATE_MODES.invoice);
    });
    if (elements.createRefundFromSupplier) {
      elements.createRefundFromSupplier.addEventListener("click", async function () {
        if (!state.supplierId) {
          renderer.showError("Load a supplier first.");
          return;
        }

        renderer.showError("");
        await openCreateInvoicePanel(INVOICE_CREATE_MODES.refund);
      });
    }
    elements.selectedInvoiceEdit.addEventListener("click", onSelectedInvoiceEditClick);
    elements.selectedInvoiceDelete.addEventListener("click", onSelectedInvoiceDeleteClick);
    if (elements.selectedInvoiceSyncAccounting) {
      elements.selectedInvoiceSyncAccounting.addEventListener("click", onSelectedInvoiceSyncAccountingClick);
    }
    if (elements.selectedInvoiceRebuildAccountingTotals) {
      elements.selectedInvoiceRebuildAccountingTotals.addEventListener("click", onSelectedInvoiceRebuildAccountingTotalsClick);
    }
    elements.selectedInvoiceDeleteUpdateSettlement.addEventListener("change", function () {
      state.invoiceDeletion.updateSettlement = Boolean(elements.selectedInvoiceDeleteUpdateSettlement.checked);
      renderAll();
    });
    elements.selectedInvoiceDeleteConfirm.addEventListener("click", onSelectedInvoiceDeleteConfirmClick);
    elements.selectedInvoiceDeleteCancel.addEventListener("click", closeSelectedInvoiceDeletePanel);
    elements.syncSupplierWithEzus.addEventListener("click", onSyncSupplierWithEzusClick);
    elements.seeSupplierInCrm.addEventListener("click", onSeeSupplierInCrmClick);
    elements.seeSupplierInEzus.addEventListener("click", onSeeSupplierInEzusClick);
    elements.closeSupplierWorkspace.addEventListener("click", onCloseSupplierWorkspaceClick);
    elements.supplierInfoTabBasic.addEventListener("click", function () {
      setSupplierInfoTab("basic");
    });
    elements.supplierInfoTabFinancial.addEventListener("click", function () {
      setSupplierInfoTab("financial");
    });
    elements.supplierInfoTabPayment.addEventListener("click", function () {
      setSupplierInfoTab("payment");
    });
    elements.supplierInfoTabAddress.addEventListener("click", function () {
      setSupplierInfoTab("address");
    });
    elements.supplierRelatedTabInvoices.addEventListener("click", function () {
      setSupplierActivityTab("invoices");
    });
    elements.supplierRelatedTabPayments.addEventListener("click", function () {
      setSupplierActivityTab("payments");
    });
    elements.supplierExportInvoices.addEventListener("click", onSupplierInvoicesExportClick);
    elements.supplierExportPayments.addEventListener("click", onSupplierPaymentsExportClick);

    bindInvoiceCreateEvents();
  }

  function bindFilterControl(element, viewKey, filterKey) {
    function updateValue() {
      state.views[viewKey].filters[filterKey] = element.value;
      if (viewKey !== "invoices" && viewKey !== "payments") {
        state.views[viewKey].page = 1;
      }
      renderAll();
      if (viewKey !== "invoices" && viewKey !== "payments") {
        scheduleRemoteViewReload(viewKey);
      }
    }

    element.addEventListener("input", updateValue);
    element.addEventListener("change", updateValue);
  }

  function scheduleRemoteViewReload(viewKey) {
    var timerRef;
    var loader;

    if (viewKey === "invoices") {
      timerRef = "invoices";
      loader = loadInvoicesTabData;
    } else if (viewKey === "payments") {
      timerRef = "payments";
      loader = loadPaymentsTabData;
    } else {
      return;
    }

    if ((viewKey === "invoices" && state.currentTab !== "invoices") ||
      (viewKey === "payments" && state.currentTab !== "payments")) {
      return;
    }

    if (timerRef === "invoices" && invoicesFilterReloadTimer) {
      global.clearTimeout(invoicesFilterReloadTimer);
    }

    if (timerRef === "payments" && paymentsFilterReloadTimer) {
      global.clearTimeout(paymentsFilterReloadTimer);
    }

    if (timerRef === "invoices") {
      invoicesFilterReloadTimer = global.setTimeout(function () {
        invoicesFilterReloadTimer = null;
        loader();
      }, 280);
    } else {
      paymentsFilterReloadTimer = global.setTimeout(function () {
        paymentsFilterReloadTimer = null;
        loader();
      }, 280);
    }
  }

  function bindBookingsLoadFilterControl(element, filterKey, shouldRender) {
    function updateValue() {
      state.views.bookings.filters[filterKey] = element.value;
      if (shouldRender) {
        renderAll();
      }
    }

    element.addEventListener("input", updateValue);
    element.addEventListener("change", updateValue);
    element.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        loadBookingsBrowserData();
      }
    });
  }

  function bindInvoicesLoadFilterControl(element, filterKey) {
    function updateValue() {
      var nextValue = element.value;

      /* Text inputs emit `change` again when they lose focus. Without this
       * guard, clicking an invoice checkbox reloaded the same results and
       * swallowed the first selection. */
      if (state.views.invoices.filters[filterKey] === nextValue &&
        (filterKey !== "dateFrom" && filterKey !== "dateTo" || state.views.invoices.filters.datePreset === "specific")) {
        return;
      }
      state.views.invoices.filters[filterKey] = nextValue;
      if (filterKey === "dateFrom" || filterKey === "dateTo") {
        state.views.invoices.filters.datePreset = "specific";
        elements.invoiceFilterDatePreset.value = "specific";
      }
      state.views.invoices.page = 1;
      renderAll();
    }

    element.addEventListener("input", updateValue);
    element.addEventListener("change", updateValue);
    element.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        loadInvoicesTabData();
      }
    });
  }

  function bindPaymentsLoadFilterControl(element, filterKey) {
    function updateValue() {
      state.views.payments.filters[filterKey] = element.value;
      if (filterKey === "dateFrom" || filterKey === "dateTo") {
        state.views.payments.filters.datePreset = "specific";
        elements.paymentFilterDatePreset.value = "specific";
      }
      state.views.payments.page = 1;
      renderAll();
      scheduleRemoteViewReload("payments");
    }

    element.addEventListener("input", updateValue);
    element.addEventListener("change", updateValue);
    element.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        loadPaymentsTabData();
      }
    });
  }

  function bindAccountingEntriesLoadFilterControl(element, filterKey) {
    function updateValue() {
      state.views.accountingEntries.filters[filterKey] = element.value;
    }

    element.addEventListener("input", updateValue);
    element.addEventListener("change", updateValue);
    element.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        loadAccountingEntriesTabData();
      }
    });
  }

  function bindAccountingEntryLinesLoadFilterControl(element, filterKey) {
    function updateValue() {
      state.views.accountingEntryLines.filters[filterKey] = element.value;
    }

    element.addEventListener("input", updateValue);
    element.addEventListener("change", updateValue);
    element.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        loadAccountingEntryLinesTabData();
      }
    });
  }

  function getNormalizedBookingStageValues(values) {
    return (Array.isArray(values) ? values : []).filter(function (value, index, list) {
      return value && list.indexOf(value) === index;
    });
  }

  function hasAllBookingStageFilterValuesSelected(values) {
    var normalizedValues = getNormalizedBookingStageValues(values);

    return BOOKING_STAGE_FILTER_OPTIONS.length > 0 &&
      BOOKING_STAGE_FILTER_OPTIONS.every(function (value) {
        return normalizedValues.indexOf(value) !== -1;
      });
  }

  function getDefaultStatusFilterValues(viewKey) {
    if (viewKey === "payments") {
      return [];
    }

    return INVOICE_STATUS_FILTER_OPTIONS.slice();
  }

  function getNormalizedStatusFilterValues(values) {
    return helpers.uniqueNonEmpty(Array.isArray(values) ? values : []);
  }

  function cloneFilterState(filters) {
    var clone = Object.assign({}, filters || {});

    Object.keys(clone).forEach(function (key) {
      if (Array.isArray(clone[key])) {
        clone[key] = clone[key].slice();
      }
    });

    return clone;
  }

  function hasAllStatusFilterValuesSelected(selectedValues, optionValues) {
    return optionValues.length > 0 && optionValues.every(function (value) {
      return selectedValues.indexOf(value) !== -1;
    });
  }

  function getStatusFilterFieldElements(viewKey) {
    if (viewKey === "payments") {
      return {
        field: elements.paymentFilterStatusField,
        toggle: elements.paymentFilterStatusToggle,
        menu: elements.paymentFilterStatusMenu
      };
    }

    return {
      field: elements.invoiceFilterStatusField,
      toggle: elements.invoiceFilterStatusToggle,
      menu: elements.invoiceFilterStatusMenu
    };
  }

  function getStatusFilterOptionsForView(viewKey, records) {
    if (viewKey === "invoices") {
      return INVOICE_STATUS_FILTER_OPTIONS.map(function (value) {
        return { value: value, label: value };
      });
    }

    return buildCombinedStatusOptions(
      PAYMENT_STATUS_FILTER_OPTIONS,
      records || [],
      "Status"
    );
  }

  function getStatusFilterToggleLabel(viewKey, selectedValues, options) {
    var defaultValues = getDefaultStatusFilterValues(viewKey);
    var selected = getNormalizedStatusFilterValues(selectedValues);
    var optionValues = (options || []).map(function (item) {
      return item.value;
    });
    var singleOption;

    if (!selected.length) {
      return "No statuses";
    }

    if (
      hasAllStatusFilterValuesSelected(selected, optionValues) ||
      hasAllStatusFilterValuesSelected(selected, defaultValues)
    ) {
      return "All statuses";
    }

    if (selected.length === 1) {
      singleOption = (options || []).find(function (item) {
        return item.value === selected[0];
      });
      return singleOption ? singleOption.label : "1 status";
    }

    return String(selected.length) + " statuses";
  }

  function isInvoiceCreateSettlementPaidStatus(value) {
    return String(value || "").trim().toLowerCase() === "paid";
  }

  function getDefaultInvoiceCreateSettlementStatusValues(options) {
    var optionValues = (options || []).map(function (item) {
      return item && item.value ? item.value : "";
    }).filter(Boolean);
    var nonPaidValues;

    if (!optionValues.length) {
      return DEFAULT_SETTLEMENT_STATUS_FILTER_VALUES.slice();
    }

    nonPaidValues = optionValues.filter(function (value) {
      return !isInvoiceCreateSettlementPaidStatus(value);
    });

    return getNormalizedInvoiceCreateSettlementStatusValues(nonPaidValues);
  }

  function getNormalizedInvoiceCreateSettlementStatusValues(values) {
    return helpers.uniqueNonEmpty(Array.isArray(values) ? values : []);
  }

  function hasAllInvoiceCreateSettlementStatusesSelected(selectedValues, options) {
    var optionValues = (options || []).map(function (item) {
      return item.value;
    });

    return optionValues.length > 0 && optionValues.every(function (value) {
      return selectedValues.indexOf(value) !== -1;
    });
  }

  function onStatusFilterToggleClick(viewKey, event) {
    event.preventDefault();
    state.views.invoices.statusDropdownOpen = false;
    state.views.payments.statusDropdownOpen = false;
    state.views[viewKey].statusDropdownOpen = !state.views[viewKey].statusDropdownOpen;
    renderAll();
  }

  function onStatusFilterOptionChange(viewKey, event) {
    var target = event.target;
    var statusValue;
    var nextValues;

    if (!target || target.type !== "checkbox") {
      return;
    }

    statusValue = target.getAttribute("data-status-filter-value");

    if (!statusValue) {
      return;
    }

    nextValues = getNormalizedStatusFilterValues(state.views[viewKey].filters.statusValues);

    if (target.checked) {
      nextValues.push(statusValue);
    } else {
      nextValues = nextValues.filter(function (value) {
        return value !== statusValue;
      });
    }

    state.views[viewKey].filters.statusValues = getNormalizedStatusFilterValues(nextValues);
    state.views[viewKey].page = 1;
    renderAll();
    if (viewKey !== "invoices") {
      scheduleRemoteViewReload(viewKey);
    }
  }

  function onStatusFilterMenuActionClick(viewKey, event) {
    var action = event.target && event.target.getAttribute("data-status-filter-action");

    if (!action) {
      return;
    }

    if (action === "select-all") {
      state.views[viewKey].filters.statusValues = getStatusFilterOptionsForView(
        viewKey,
        viewKey === "payments" ? state.records.payments : state.records.invoices
      ).map(function (item) {
        return item.value;
      });
    } else if (action === "clear-all") {
      state.views[viewKey].filters.statusValues = [];
    }

    state.views[viewKey].page = 1;
    renderAll();
    if (viewKey !== "invoices") {
      scheduleRemoteViewReload(viewKey);
    }
  }

  function onDocumentClickCloseStatusFilterDropdown(event) {
    var shouldRender = false;
    var invoiceFieldContainsTarget = elements.invoiceFilterStatusField &&
      typeof elements.invoiceFilterStatusField.contains === "function" &&
      elements.invoiceFilterStatusField.contains(event.target);
    var paymentFieldContainsTarget = elements.paymentFilterStatusField &&
      typeof elements.paymentFilterStatusField.contains === "function" &&
      elements.paymentFilterStatusField.contains(event.target);

    if (state.views.invoices.statusDropdownOpen && !invoiceFieldContainsTarget) {
      state.views.invoices.statusDropdownOpen = false;
      shouldRender = true;
    }

    if (state.views.payments.statusDropdownOpen && !paymentFieldContainsTarget) {
      state.views.payments.statusDropdownOpen = false;
      shouldRender = true;
    }

    if (shouldRender) {
      renderAll();
    }
  }

  function renderStatusFilterControl(viewKey, options) {
    var controls = getStatusFilterFieldElements(viewKey);
    var selectedValues = getNormalizedStatusFilterValues(state.views[viewKey].filters.statusValues);
    var optionValues = (options || []).map(function (item) {
      return item.value;
    });

    if (!controls.toggle || !controls.menu) {
      return;
    }

    controls.toggle.textContent = getStatusFilterToggleLabel(viewKey, selectedValues, options);
    controls.toggle.setAttribute("aria-expanded", state.views[viewKey].statusDropdownOpen ? "true" : "false");
    controls.menu.hidden = !state.views[viewKey].statusDropdownOpen;
    controls.menu.innerHTML = [
      '<div class="status-filter-menu-actions">',
      '  <button class="status-filter-menu-action" type="button" data-status-filter-action="select-all">Select all</button>',
      '  <button class="status-filter-menu-action" type="button" data-status-filter-action="clear-all">Deselect all</button>',
      "</div>",
      (options || []).map(function (option) {
        var isChecked = selectedValues.indexOf(option.value) !== -1;

        return [
          '<label class="bookings-stage-option">',
          '  <input type="checkbox" data-status-filter-value="' + helpers.escapeHtml(option.value) + '"' + (isChecked ? " checked" : "") + ">",
          '  <span>' + helpers.escapeHtml(option.label) + "</span>",
          "</label>"
        ].join("");
      }).join("")
    ].join("");

    if (!selectedValues.length && optionValues.length === 0) {
      controls.toggle.textContent = "No statuses";
    }
  }

  function hasAnyActiveFilter(viewKey, filters) {
    return Object.keys(filters || {}).some(function (key) {
      var value = filters[key];

      if (Array.isArray(value)) {
        if (key === "statusValues" && viewKey) {
          return value.length > 0 && !hasAllStatusFilterValuesSelected(
            getNormalizedStatusFilterValues(value),
            getDefaultStatusFilterValues(viewKey)
          );
        }

        return value.length > 0;
      }

      return String(value || "").trim() !== "";
    });
  }

  function hasAnyLoadFilterValue(filters) {
    return Object.keys(filters || {}).some(function (key) {
      var value = filters[key];

      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return String(value || "").trim() !== "";
    });
  }

  function getLoadFilterRequirementMessage(viewKey) {
    if (viewKey === "bookings") {
      return "Could not load bookings with the current search. Try narrowing the filters or removing one of the text filters.";
    }

    if (viewKey === "payments") {
      return "Set at least one real filter before loading payments. Date, supplier or MFSP work well; leaving all statuses selected does not narrow the search.";
    }

    return "Set at least one real filter before loading invoices. Date, supplier code or MFSP work well; leaving all statuses selected does not narrow the search.";
  }

  function getFriendlyLoadErrorMessage(viewKey, error, fallbackMessage) {
    var rawMessage = String(error && error.message || error || "").trim();
    var coqlQuery = String(error && error.coqlQuery || "").trim();
    var coqlWhereClause = String(error && error.coqlWhereClause || "").trim();
    var coqlOrderByClause = String(error && error.coqlOrderByClause || "").trim();
    var coqlDetails = "";

    if (/missing clause/i.test(rawMessage)) {
      return getLoadFilterRequirementMessage(viewKey);
    }

    if (coqlQuery) {
      coqlDetails = " Query: " + coqlQuery;
    } else if (coqlWhereClause || coqlOrderByClause) {
      coqlDetails = " Details:" +
        (coqlWhereClause ? " where " + coqlWhereClause : "") +
        (coqlOrderByClause ? " order by " + coqlOrderByClause : "");
    }

    if (/unsupported column|invalid column|column given seems to be invalid/i.test(rawMessage)) {
      if (viewKey === "bookings") {
        return "Could not load bookings because Zoho rejected one of the columns used in the search. This environment may have a different Deals field setup." + coqlDetails;
      }

      if (viewKey === "payments") {
        return "Could not load payments because Zoho rejected one of the columns used in the query. The payment filters now use the documented module fields, but this environment may still have a different column setup." + coqlDetails;
      }

      return "Could not load invoices because Zoho rejected one of the columns used in the query. The invoice filters now use the documented module fields, but this environment may still have a different column setup." + coqlDetails;
    }

    return rawMessage || fallbackMessage;
  }

  function initFallbackState() {
    applyDefaultPaymentsFilters();
    elements.invoiceCreateDate.value = getLocalIsoDate();
    elements.invoiceCreateIrpfPercent.value = "0";
    elements.invoiceCreateReimbursableExpense.value = "0";
    if (elements.invoiceCreateAdditionalVatEnabled) {
      elements.invoiceCreateAdditionalVatEnabled.checked = false;
    }
    if (elements.invoiceCreateAdditionalVatFields) {
      elements.invoiceCreateAdditionalVatFields.hidden = true;
    }
    resetInvoicePaymentForm();
    renderPaymentAccountCreatePicklists();
    resetPaymentAccountCreateForm();
    renderer.setMode("Open from Zoho CRM");
    renderer.hideSearchResults();
    updateInvoiceCreateComputedAmounts("gross");
    setDefaultInvoiceCreateStatus();
    renderAll();
    renderer.showNotice("Widget ready. Search a supplier or switch tabs after Zoho CRM finishes loading.");
  }

  function getLocalIsoDate() {
    var today = new Date();
    var timezoneOffset = today.getTimezoneOffset() * 60000;
    return new Date(today.getTime() - timezoneOffset).toISOString().slice(0, 10);
  }

  function formatDateToIsoLocal(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }

    return [
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function getDateRangeForPreset(preset) {
    var today = new Date(getLocalIsoDate() + "T12:00:00");
    var from = new Date(today.getTime());
    var to = new Date(today.getTime());
    var dayOfWeek;

    switch (preset) {
      case "this-week":
        dayOfWeek = from.getDay() || 7;
        from.setDate(from.getDate() - dayOfWeek + 1);
        break;
      case "last-week":
        dayOfWeek = from.getDay() || 7;
        from.setDate(from.getDate() - dayOfWeek - 6);
        to.setDate(to.getDate() - dayOfWeek);
        break;
      case "last-7-days":
        from.setDate(from.getDate() - 6);
        break;
      case "this-month":
        from.setDate(1);
        break;
      case "last-month":
        from.setDate(1);
        from.setMonth(from.getMonth() - 1);
        to.setDate(0);
        break;
      case "last-30-days":
        from.setDate(from.getDate() - 29);
        break;
      case "year-to-date":
        from.setMonth(0, 1);
        break;
      case "all-time":
        return { dateFrom: "", dateTo: "" };
      default:
        return null;
    }

    return {
      dateFrom: formatDateToIsoLocal(from),
      dateTo: formatDateToIsoLocal(to)
    };
  }

  function syncDateFilterPresetControls(sectionName) {
    var isInvoices = sectionName === "invoices";
    var filters = state.views[sectionName].filters;
    var presetElement = isInvoices ? elements.invoiceFilterDatePreset : elements.paymentFilterDatePreset;
    var dateFromElement = isInvoices ? elements.invoiceFilterDateFrom : elements.paymentFilterDateFrom;
    var dateToElement = isInvoices ? elements.invoiceFilterDateTo : elements.paymentFilterDateTo;
    var isSpecificRange = filters.datePreset === "specific";

    presetElement.value = filters.datePreset || "specific";
    dateFromElement.value = filters.dateFrom || "";
    dateToElement.value = filters.dateTo || "";
    dateFromElement.disabled = !isSpecificRange;
    dateToElement.disabled = !isSpecificRange;
    presetElement.closest(".filters-grid").classList.toggle("is-custom-date-range", isSpecificRange);
  }

  function applyDateFilterPreset(sectionName, preset) {
    var filters = state.views[sectionName].filters;
    var range = getDateRangeForPreset(preset);

    filters.datePreset = preset;
    if (range) {
      filters.dateFrom = range.dateFrom;
      filters.dateTo = range.dateTo;
    }

    syncDateFilterPresetControls(sectionName);
    renderAll();
  }

  function getPaymentsDefaultDateFrom(referenceIsoDate) {
    var resolvedIsoDate = String(referenceIsoDate || getLocalIsoDate() || "").trim();
    var referenceDate = new Date((resolvedIsoDate || getLocalIsoDate()) + "T12:00:00");
    var dayOfWeek = referenceDate.getDay();
    var daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    referenceDate.setDate(referenceDate.getDate() - daysSinceMonday - 7);
    return formatDateToIsoLocal(referenceDate);
  }

  function buildDefaultPaymentsFilters() {
    var dateRange = getDateRangeForPreset("last-7-days");

    return {
      datePreset: "last-7-days",
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      statusValues: ["Paid"],
      supplierCode: "",
      mfsp: ""
    };
  }

  function applyDefaultPaymentsFilters() {
    var defaultFilters = buildDefaultPaymentsFilters();

    state.views.payments.filters = Object.assign({}, state.views.payments.filters, defaultFilters);
    state.views.payments.appliedFilters = cloneFilterState(defaultFilters);
  }

  function getInvoiceCreateNumberValue(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function roundCurrency(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function compareValues(left, right, direction) {
    var normalizedDirection = direction === "asc" ? 1 : -1;
    var leftValue = left == null ? "" : left;
    var rightValue = right == null ? "" : right;

    if (typeof leftValue === "number" || typeof rightValue === "number") {
      return ((Number(leftValue) || 0) - (Number(rightValue) || 0)) * normalizedDirection;
    }

    return String(leftValue).localeCompare(String(rightValue), "en", {
      sensitivity: "base"
    }) * normalizedDirection;
  }

  function getCrmErrorCode(error) {
    return String(
      error && (
        error.code ||
        error.Code ||
        error.status_code ||
        (error.errorObject && error.errorObject.code) ||
        (error.details && error.details.code)
      ) || ""
    ).trim();
  }

  function getCrmErrorPermissions(error) {
    var permissions = error && (
      error.permissions ||
      (error.details && error.details.permissions) ||
      (error.errorObject && error.errorObject.details && error.errorObject.details.permissions)
    );

    return Array.isArray(permissions) ? permissions : [];
  }

  function getInvoiceLinePermissionHelpMessage(error) {
    var errorCode = getCrmErrorCode(error);
    var permissions = getCrmErrorPermissions(error);

    if (errorCode !== "NO_PERMISSION") {
      return "";
    }

    if (permissions.indexOf("Crm_Implied_View_CustomModule19") !== -1) {
      return " Your Zoho profile does not have access to Supplier Invoice Lines (CustomModule19), so the invoice lines could not be generated.";
    }

    return " Your Zoho profile does not have permission to create or read Supplier Invoice Lines, so the invoice lines could not be generated.";
  }

  function parseJsonValue(value) {
    if (typeof value !== "string" || !value) {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  }

  function getFunctionOutputObject(response) {
    var detailsOutput = response && response.details ? response.details.output : "";
    var normalizedOutput = parseJsonValue(detailsOutput);

    return normalizedOutput && typeof normalizedOutput === "object"
      ? normalizedOutput
      : null;
  }

  function hasValidEmailAddress(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function escapeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function downloadFileFromText(fileName, mimeType, textContent) {
    var blob = new global.Blob([textContent], {
      type: mimeType
    });
    var objectUrl = global.URL.createObjectURL(blob);
    var anchor = global.document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = fileName;
    global.document.body.appendChild(anchor);
    anchor.click();
    global.document.body.removeChild(anchor);
    global.URL.revokeObjectURL(objectUrl);
  }

  function sanitizeDownloadFileName(value) {
    return String(value || "export")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatDateForContasol(value) {
    var isoDate = helpers.toIsoDate(value);
    var parts;

    if (!isoDate) {
      return "";
    }

    parts = isoDate.split("-");
    return parts.length === 3 ? [parts[2], parts[1], parts[0]].join("/") : "";
  }

  function formatNumberForContasol(value) {
    var numericValue = Number(value || 0);

    if (!Number.isFinite(numericValue)) {
      numericValue = 0;
    }

    return new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true
    }).format(numericValue);
  }

  function isBooleanLikeTrue(value) {
    var normalizedValue;

    if (value === true) {
      return true;
    }

    if (typeof value === "number") {
      return value !== 0;
    }

    normalizedValue = helpers.normalizeQuery(value);
    if (normalizedValue === "s\u00ed") {
      normalizedValue = "si";
    }
    return normalizedValue === "true" ||
      normalizedValue === "yes" ||
      normalizedValue === "y" ||
      normalizedValue === "1" ||
      normalizedValue === "si" ||
      normalizedValue === "sÃ­";
  }

  function getContasolDebitCreditValues(line) {
    var debit = Number(line && line.Debit || 0) || 0;
    var credit = Number(line && line.Credit || 0) || 0;

    return {
      debit: debit,
      credit: credit
    };
  }

  function getFunctionResponseResult(response) {
    var detailsOutput = response && response.details ? response.details.output : "";
    var normalizedOutput = parseJsonValue(detailsOutput);
    var message = "";
    var success = null;
    var lowerMessage;

    if (normalizedOutput && typeof normalizedOutput === "object") {
      if (typeof normalizedOutput.success === "boolean") {
        success = normalizedOutput.success;
      }

      if (typeof normalizedOutput.error === "boolean") {
        success = !normalizedOutput.error;
      }

      message = normalizedOutput.message || "";
    } else if (typeof normalizedOutput === "string" && normalizedOutput) {
      message = normalizedOutput;
    } else if (response && typeof response.message === "string" && response.message) {
      message = response.message;
    }

    lowerMessage = message.toLowerCase();

    if (success === null && lowerMessage) {
      if (
        lowerMessage.indexOf("missing") !== -1 ||
        lowerMessage.indexOf("not found") !== -1 ||
        lowerMessage.indexOf("could not") !== -1 ||
        lowerMessage.indexOf("error") !== -1 ||
        lowerMessage.indexOf("failed") !== -1
      ) {
        success = false;
      }
    }

    return {
      message: message,
      success: success
    };
  }

  function buildDefaultPaymentReference(paymentDate) {
    var resolvedDate = String(paymentDate || getLocalIsoDate() || "");
    var normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(resolvedDate)
      ? resolvedDate.split("-").join("")
      : getLocalIsoDate().split("-").join("");
    var now = new Date();
    var stamp = [
      normalizedDate,
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join("");

    return "PAY-" + stamp;
  }

  function syncInvoicePaymentReferenceWithDate() {
    var form = state.paymentCreation.form || {};
    var nextReference = buildDefaultPaymentReference(form.paymentDate);

    if (!form.name || form.name === form.lastAutoGeneratedName) {
      form.name = nextReference;
    }

    form.lastAutoGeneratedName = nextReference;
  }

  function getSupplierPaymentFunctionResult(response) {
    var detailsOutput = response && response.details ? response.details.output : "";
    var normalizedOutput = parseJsonValue(detailsOutput);
    var fallback = getFunctionResponseResult(response);

    if (normalizedOutput && typeof normalizedOutput === "object") {
      return {
        success: !normalizedOutput.error,
        message: normalizedOutput.message || fallback.message || "",
        paymentId: normalizedOutput.payment_id || "",
        allocationIds: Array.isArray(normalizedOutput.allocation_ids) ? normalizedOutput.allocation_ids : []
      };
    }

    return {
      success: fallback.success !== false,
      message: fallback.message || "",
      paymentId: "",
      allocationIds: []
    };
  }

  function getPaymentLetterFunctionResult(response) {
    var detailsOutput = response && response.details ? response.details.output : "";
    var normalizedOutput = parseJsonValue(detailsOutput);
    var fallback = getFunctionResponseResult(response);

    if (normalizedOutput && typeof normalizedOutput === "object") {
      return {
        success: !normalizedOutput.error,
        message: normalizedOutput.message || fallback.message || "",
        sentCount: Number(normalizedOutput.sent_count || 0) || 0
      };
    }

    return {
      success: fallback.success !== false,
      message: fallback.message || "",
      sentCount: 0
    };
  }

  function getInvoiceAccountingFunctionResult(response) {
    var detailsOutput = response && response.details ? response.details.output : "";
    var normalizedOutput = parseJsonValue(detailsOutput);
    var fallback = getFunctionResponseResult(response);

    if (normalizedOutput && typeof normalizedOutput === "object") {
      return {
        success: !normalizedOutput.error,
        message: normalizedOutput.message || fallback.message || "",
        accountingEntryId: String(normalizedOutput.accounting_entry_id || ""),
        created: Boolean(normalizedOutput.created),
        updated: Boolean(normalizedOutput.updated),
        balanced: Boolean(normalizedOutput.balanced),
        lineCount: Number(normalizedOutput.line_count || 0) || 0,
        totalDebit: Number(normalizedOutput.total_debit || 0) || 0,
        totalCredit: Number(normalizedOutput.total_credit || 0) || 0
      };
    }

    return {
      success: fallback.success !== false,
      message: fallback.message || "",
      accountingEntryId: "",
      created: false,
      updated: false,
      balanced: false,
      lineCount: 0,
      totalDebit: 0,
      totalCredit: 0
    };
  }

  function getSettlementRebuildFunctionResult(response) {
    var detailsOutput = response && response.details ? response.details.output : "";
    var normalizedOutput = parseJsonValue(detailsOutput);
    var fallback = getFunctionResponseResult(response);

    if (normalizedOutput && typeof normalizedOutput === "object") {
      return {
        success: !normalizedOutput.error,
        message: normalizedOutput.message || fallback.message || "",
        processedCount: Number(normalizedOutput.processed_count || 0) || 0,
        updatedCount: Number(normalizedOutput.updated_count || 0) || 0,
        warningCount: Number(normalizedOutput.warning_count || 0) || 0,
        updatedSettlementIds: Array.isArray(normalizedOutput.updated_settlement_ids) ? normalizedOutput.updated_settlement_ids : [],
        warnings: Array.isArray(normalizedOutput.warnings) ? normalizedOutput.warnings : [],
        details: Array.isArray(normalizedOutput.details) ? normalizedOutput.details : []
      };
    }

    return {
      success: fallback.success !== false,
      message: fallback.message || "",
      processedCount: 0,
      updatedCount: 0,
      warningCount: 0,
      updatedSettlementIds: [],
      warnings: [],
      details: []
    };
  }

  function isBlockedInvoicePaymentStatus(status) {
    var normalized = String(status || "").trim().toLowerCase();

    return normalized === "paid" ||
      normalized === "cancelled" ||
      normalized === "canceled" ||
      normalized === "reconciled" ||
      normalized === "void";
  }

  function getInvoiceSettlementId(record) {
    return helpers.getLookupId(record.Supplier_Settlement);
  }

  function getInvoiceSettlementName(record) {
    return helpers.getLookupName(record.Supplier_Settlement);
  }

  function getInvoicePaidAmount(record) {
    return Number(helpers.getCandidateValue(record, FIELD_CANDIDATES.invoice.amountPaid) || 0) || 0;
  }

  function getInvoiceType(record) {
    return String(helpers.getCandidateValue(record, FIELD_CANDIDATES.invoice.invoiceType) || "").trim();
  }

  function isCreditNoteInvoice(record) {
    return getInvoiceType(record) === INVOICE_TYPES.creditNote;
  }

  function getPaymentMovementType(record) {
    return String(helpers.getCandidateValue(record, FIELD_CANDIDATES.payment.movementType) || "").trim();
  }

  function getInvoiceCreateMode() {
    return state.invoiceCreation.mode === INVOICE_CREATE_MODES.refund
      ? INVOICE_CREATE_MODES.refund
      : INVOICE_CREATE_MODES.invoice;
  }

  function isInvoiceCreateRefundMode() {
    return getInvoiceCreateMode() === INVOICE_CREATE_MODES.refund;
  }

  function getInvoiceCreateRecordLabel() {
    return isInvoiceCreateRefundMode() ? "refund" : "invoice";
  }

  function getInvoiceCreateTitleText() {
    return isInvoiceCreateRefundMode() ? "Create supplier refund" : "Create supplier invoice";
  }

  function getInvoiceCreateSubmitText() {
    return isInvoiceCreateRefundMode() ? "Create supplier refund" : "Create supplier invoice";
  }

  function getInvoiceCreateStep() {
    var step = Number(state.invoiceCreation.step || INVOICE_CREATE_STEPS.settlement);

    if (step !== INVOICE_CREATE_STEPS.amounts) {
      return INVOICE_CREATE_STEPS.settlement;
    }

    return step;
  }

  function setInvoiceCreateStep(step) {
    var resolvedStep = Number(step || INVOICE_CREATE_STEPS.settlement);

    if (resolvedStep !== INVOICE_CREATE_STEPS.amounts) {
      resolvedStep = INVOICE_CREATE_STEPS.settlement;
    }

    state.invoiceCreation.step = resolvedStep;
  }

  function getInvoiceCreateStepForFieldKey(fieldKey) {
    if (fieldKey === "settlement") {
      return INVOICE_CREATE_STEPS.settlement;
    }

    if (fieldKey === "invoiceNumber" || fieldKey === "invoiceDate" || fieldKey === "invoiceType") {
      return INVOICE_CREATE_STEPS.settlement;
    }

    if (fieldKey === "invoiceFile" || fieldKey === "allocation") {
      return INVOICE_CREATE_STEPS.amounts;
    }

    if (
      fieldKey === "amountGross" ||
      fieldKey === "vatReviewed" ||
      fieldKey === "additionalVatPercent" ||
      fieldKey === "additionalAmountExclVat" ||
      fieldKey === "additionalAmountInclVat" ||
      fieldKey === "additionalVatReviewed" ||
      fieldKey === "additionalIrpfReviewed" ||
      fieldKey === "irpfReviewed"
    ) {
      return INVOICE_CREATE_STEPS.amounts;
    }

    return getInvoiceCreateStep();
  }

  function getInvoiceCreateTypeOptionsForMode() {
    var options = Array.isArray(state.invoiceCreation.invoiceTypeOptions)
      ? state.invoiceCreation.invoiceTypeOptions.slice()
      : [];

    if (isInvoiceCreateRefundMode()) {
      return options.filter(function (option) {
        return String(option && option.value || "") === INVOICE_TYPES.creditNote;
      });
    }

    return options.filter(function (option) {
      return String(option && option.value || "") !== INVOICE_TYPES.creditNote;
    });
  }

  function syncInvoiceCreateModeDefaults() {
    var availableTypeValues;
    var currentTypeValue;

    if (!elements.invoiceCreateType) {
      return;
    }

    availableTypeValues = getInvoiceCreateTypeOptionsForMode().map(function (option) {
      return String(option && option.value || "");
    });
    currentTypeValue = String(elements.invoiceCreateType.value || "");

    if (isInvoiceCreateRefundMode()) {
      elements.invoiceCreateType.value = INVOICE_TYPES.creditNote;
      elements.invoiceCreateType.disabled = true;
      return;
    }

    elements.invoiceCreateType.disabled = availableTypeValues.length === 0;
    if (!currentTypeValue || availableTypeValues.indexOf(currentTypeValue) === -1) {
      elements.invoiceCreateType.value = "";
    }
  }

  function getInvoiceCreateSelectedTypeValue() {
    return isInvoiceCreateRefundMode()
      ? INVOICE_TYPES.creditNote
      : String(elements.invoiceCreateType && elements.invoiceCreateType.value || "").trim();
  }

  function getInvoiceSettlementSign(record) {
    return isCreditNoteInvoice(record) ? -1 : 1;
  }

  function getSignedInvoiceTotalAmount(record) {
    return roundCurrency(helpers.getInvoiceTotalAmount(record, FIELD_CANDIDATES) * getInvoiceSettlementSign(record));
  }

  function getSignedInvoicePaidAmount(record) {
    return roundCurrency(getInvoicePaidAmount(record) * getInvoiceSettlementSign(record));
  }

  function getUniqueSettlementIdsFromInvoices(invoices) {
    return helpers.uniqueNonEmpty((invoices || []).map(function (invoice) {
      return getInvoiceSettlementId(invoice);
    }));
  }

  function getUniqueSettlementIdsFromAllocations(allocations) {
    return helpers.uniqueNonEmpty((allocations || []).map(function (allocation) {
      return helpers.getLookupId(allocation.Supplier_Settlement);
    }));
  }

  function invalidateInvoiceCreateSettlementCache() {
    state.invoiceCreation.hasLoadedSettlements = false;
    state.invoiceCreation.loadedSupplierId = "";
  }

  function getUniqueSortedValues(values) {
    return helpers.sortStrings(helpers.uniqueNonEmpty(values || []));
  }

  function getContextDisplayValue(values, pluralLabel, maxItems) {
    var uniqueValues = getUniqueSortedValues(values);
    var previewLimit = maxItems || 2;
    var preview;

    if (!uniqueValues.length) {
      return "-";
    }

    if (uniqueValues.length === 1) {
      return uniqueValues[0];
    }

    preview = uniqueValues.slice(0, previewLimit).join(", ");
    return "Mixed (" + uniqueValues.length + " " + pluralLabel + ")" +
      (preview ? ": " + preview + (uniqueValues.length > previewLimit ? ", ..." : "") : "");
  }

  function getCompactContextDisplayValue(values, singularLabel, pluralLabel) {
    var uniqueValues = getUniqueSortedValues(values);

    if (!uniqueValues.length) {
      return "-";
    }

    if (uniqueValues.length === 1) {
      return uniqueValues[0];
    }

    return String(uniqueValues.length) + " " + (uniqueValues.length === 1 ? singularLabel : pluralLabel);
  }

  function buildPaymentContextSummaryText(context) {
    var segments = [];

    if (!context) {
      return "";
    }

    if (context.supplierNames && context.supplierNames.length) {
      segments.push("Suppliers: " + context.supplierNames.slice(0, 3).join(", ") + (context.supplierNames.length > 3 ? ", ..." : ""));
    }

    if (context.bookingNames && context.bookingNames.length) {
      segments.push("Bookings: " + context.bookingNames.slice(0, 3).join(", ") + (context.bookingNames.length > 3 ? ", ..." : ""));
    }

    if (context.settlementNames && context.settlementNames.length) {
      segments.push("Settlements: " + context.settlementNames.slice(0, 3).join(", ") + (context.settlementNames.length > 3 ? ", ..." : ""));
    }

    return segments.join(" | ");
  }

  function getPaymentAccountOwnerSupplierId(account) {
    return String(helpers.getLookupId(account && account.Owner_Supplier) || "").trim();
  }

  function getPaymentAccountOwnerTypeValue(account) {
    return String(
      account && (
        account.Owner_Type ||
        helpers.getCandidateValue(account, ["Owner_Type", "Owner Type"])
      ) || ""
    ).trim();
  }

  function getOwnedPaymentAccountsForSupplierId(supplierId) {
    var normalizedSupplierId = String(supplierId || "").trim();

    if (!normalizedSupplierId) {
      return [];
    }

    return state.records.paymentAccounts.filter(function (account) {
      return getPaymentAccountOwnerSupplierId(account) === normalizedSupplierId &&
        String(account.Status || "").trim().toLowerCase() !== "inactive";
    });
  }

  function paymentAccountBelongsToSupplier(account, supplierId, supplierName) {
    var ownerSupplierId = String(getPaymentAccountOwnerSupplierId(account) || "").trim();
    var normalizedSupplierId = String(supplierId || "").trim();
    var ownerSupplierName = helpers.normalizeQuery(helpers.getLookupName(account && account.Owner_Supplier));
    var normalizedSupplierName = helpers.normalizeQuery(supplierName);

    if (ownerSupplierId && normalizedSupplierId && ownerSupplierId === normalizedSupplierId) {
      return true;
    }

    if (ownerSupplierName && normalizedSupplierName && ownerSupplierName === normalizedSupplierName) {
      return true;
    }

    return false;
  }

  function getPaymentAccountIbanValue(account) {
    return String(
      account && (
        account.IBAN ||
        account.Account_Number ||
        helpers.getCandidateValue(account, ["IBAN", "Account_Number"])
      ) || ""
    ).trim();
  }

  function getPaymentAccountBeneficiaryName(account) {
    return String(
      account && (
        account.Bank_Account_Name ||
        helpers.getCandidateValue(account, FIELD_CANDIDATES.paymentAccount.name)
      ) || ""
    ).trim();
  }

  function getSupplierRecordById(supplierId) {
    var normalizedSupplierId = String(supplierId || "").trim();

    if (!normalizedSupplierId) {
      return null;
    }

    if (state.supplier && String(state.supplier.id || "") === normalizedSupplierId) {
      return state.supplier;
    }

    return state.supplierIndex[normalizedSupplierId] || null;
  }

  function getSupplierDefaultPaymentAccountLookup(record) {
    return helpers.getLookupValue(record, FIELD_CANDIDATES.supplier.defaultPaymentAccount);
  }

  function getSupplierDefaultPaymentAccountId(record) {
    return helpers.getLookupId(getSupplierDefaultPaymentAccountLookup(record));
  }

  function getPaymentAccountRecordById(accountId) {
    var normalizedAccountId = String(accountId || "").trim();

    if (!normalizedAccountId) {
      return null;
    }

    return state.records.paymentAccounts.find(function (account) {
      return String(account && account.id || "") === normalizedAccountId;
    }) || null;
  }

  function getSupplierDefaultPaymentAccountRecord(record) {
    var lookup = getSupplierDefaultPaymentAccountLookup(record);
    var accountId = helpers.getLookupId(lookup);

    if (!accountId) {
      return null;
    }

    return getPaymentAccountRecordById(accountId) || lookup || null;
  }

  function getSupplierDefaultPaymentAccountLabel(record) {
    var paymentAccount = getSupplierDefaultPaymentAccountRecord(record);

    if (!paymentAccount) {
      return "";
    }

    return helpers.getLookupName(paymentAccount) ||
      helpers.getCandidateValue(paymentAccount, FIELD_CANDIDATES.paymentAccount.name) ||
      paymentAccount.Name ||
      paymentAccount.External_ID ||
      "";
  }

  function normalizeBooleanValue(value) {
    var normalizedValue;

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value !== 0;
    }

    normalizedValue = helpers.normalizeQuery(value);

    if (!normalizedValue) {
      return false;
    }

    return normalizedValue === "true" ||
      normalizedValue === "yes" ||
      normalizedValue === "y" ||
      normalizedValue === "1" ||
      normalizedValue === "si" ||
      normalizedValue === "sÃ­";
  }

  function isSupplierSelfEmployed(record) {
    var normalizedValue = helpers.normalizeQuery(helpers.firstValue(record, FIELD_CANDIDATES.supplier.selfEmployed));

    return normalizedValue === "true" ||
      normalizedValue === "yes" ||
      normalizedValue === "y" ||
      normalizedValue === "1" ||
      normalizedValue === "si";
  }

  async function updateSupplierSelfEmployedStatus(supplierId, isSelfEmployed) {
    var normalizedSupplierId = String(supplierId || "").trim();
    var fieldApi;
    var payload = {};
    var refreshedSupplier;

    if (!normalizedSupplierId) {
      throw new Error("Supplier context is required.");
    }

    fieldApi = await resolveFieldApiByCandidates(
      MODULES.suppliers,
      FIELD_CANDIDATES.supplier.selfEmployed,
      "Is_Self_Employed"
    );
    payload[fieldApi] = Boolean(isSelfEmployed);

    await crm.updateRecord(MODULES.suppliers, normalizedSupplierId, payload);
    refreshedSupplier = await crm.getRecord(MODULES.suppliers, normalizedSupplierId);

    if (refreshedSupplier) {
      refreshedSupplier[fieldApi] = Boolean(isSelfEmployed);

      if (state.supplierId === normalizedSupplierId) {
        state.supplier = refreshedSupplier;
      }

      state.recentSuppliers = (state.recentSuppliers || []).map(function (supplier) {
        return String(supplier && supplier.id || "") === normalizedSupplierId ? refreshedSupplier : supplier;
      });
      cacheSupplierLookup(refreshedSupplier);
      return refreshedSupplier;
    }

    return null;
  }

  async function onInvoiceCreateRequestAccountingAccountClick() {
    var supplierId = String(state.supplierId || "").trim();
    var accountingAccount = getSupplierResolvedAccountingAccount(state.supplier);
    var response;
    var output;
    var result;

    if (!supplierId || !state.supplier) {
      renderer.showError("Load a supplier first.");
      return;
    }

    if (accountingAccount.hasValue) {
      renderer.showNotice("This supplier already has an accounting account.", {
        tone: "neutral"
      });
      renderAll();
      return;
    }

    renderer.showError("");
    setInvoiceCreateLoading(true, "Requesting accounting account...");
    renderAll();

    try {
      response = await crm.executeFunction(REQUEST_SUPPLIER_ACCOUNTING_ACCOUNT_EMAIL_FUNCTION, {
        supplierId: supplierId
      });
      output = getFunctionOutputObject(response) || {};
      result = getFunctionResponseResult(response);

      if (output.error === true || result.success === false) {
        throw new Error(output.message || result.message || "The accounting account request email could not be sent.");
      }

      renderer.showNotice(output.message || result.message || "Email sent successfully. The accounting account has been requested.", {
        tone: "success",
        persistent: true
      });
    } catch (error) {
      debugError("onInvoiceCreateRequestAccountingAccountClick failed", error, {
        supplierId: supplierId
      });
      renderer.showNotice("");
      renderer.showError(error.message || "Could not send the accounting account request.");
    } finally {
      setInvoiceCreateLoading(false, "", {
        preserveNotice: true
      });
      renderAll();
    }
  }

  function summarizePaymentAccountForDebug(account) {
    return account ? {
      id: String(account.id || ""),
      name: String(account.Name || ""),
      ownerSupplierId: getPaymentAccountOwnerSupplierId(account),
      ownerSupplierRaw: account.Owner_Supplier || null,
      status: String(account.Status || ""),
      allowedForSupplierPayments: account.Allowed_For_Supplier_Payments,
      iban: getPaymentAccountIbanValue(account),
      bankAccountName: getPaymentAccountBeneficiaryName(account)
    } : null;
  }

  function isSelectablePaymentAccount(account) {
    return Boolean(account && account.Allowed_For_Supplier_Payments) &&
      String(account.Status || "").trim().toLowerCase() !== "inactive";
  }

  function isOwnPaymentAccount(account) {
    return helpers.normalizeQuery(getPaymentAccountOwnerTypeValue(account)) === "own" &&
      String(account && account.Status || "").trim().toLowerCase() !== "inactive";
  }

  async function ensureSupplierDefaultPaymentAccountAssigned(supplierId, paymentAccountId) {
    var normalizedSupplierId = String(supplierId || "").trim();
    var normalizedPaymentAccountId = String(paymentAccountId || "").trim();
    var supplierRecord;
    var paymentAccountRecord;

    if (!normalizedSupplierId || !normalizedPaymentAccountId) {
      return false;
    }

    supplierRecord = getSupplierRecordById(normalizedSupplierId);

    if (getSupplierDefaultPaymentAccountId(supplierRecord)) {
      return false;
    }

    await crm.updateRecord(MODULES.suppliers, normalizedSupplierId, {
      Default_Payment_Account: {
        id: normalizedPaymentAccountId
      }
    });

    if (state.supplierId === normalizedSupplierId) {
      state.supplier = await crm.getRecord(MODULES.suppliers, normalizedSupplierId);
      if (state.supplier) {
        cacheSupplierLookup(state.supplier);
      }
    } else if (supplierRecord) {
      paymentAccountRecord = getPaymentAccountRecordById(normalizedPaymentAccountId);
      supplierRecord.Default_Payment_Account = paymentAccountRecord
        ? {
          id: normalizedPaymentAccountId,
          name: helpers.getLookupName(paymentAccountRecord) || paymentAccountRecord.Name || ""
        }
        : {
          id: normalizedPaymentAccountId
        };
      cacheSupplierLookup(supplierRecord);
    }

    return true;
  }

  function getCrmMutationRecord(response) {
    return helpers.extractRecords(response)[0] || response || {};
  }

  function assertCrmMutationSucceeded(response, fallbackMessage) {
    var record = getCrmMutationRecord(response);
    var status = String(record.status || record.code || "").toLowerCase();

    if (status && status !== "success") {
      throw new Error(record.message || fallbackMessage);
    }

    return record;
  }

  function syncSettlementStateFromRebuildDetail(detail) {
    var settlementId = String(detail && detail.settlement_id || "");
    var updatedSettlementRecord;

    if (!settlementId) {
      return null;
    }

    updatedSettlementRecord = {
      id: settlementId,
      Name: detail.settlement_name || "",
      Gross_Invoice_Amount: Number(detail.new_gross_invoice_amount || 0) || 0,
      Credit_Note_Amount: Number(detail.new_credit_note_amount || 0) || 0,
      Total_Invoice: Number(detail.new_total_invoice || 0) || 0,
      Total_Paid: Number(detail.new_total_paid || 0) || 0,
      Admin_Status: detail.new_status || ""
    };

    if (state.records && Array.isArray(state.records.settlements)) {
      state.records.settlements = upsertRecordById(state.records.settlements, updatedSettlementRecord);
    }

    syncInvoiceCreateSettlementRecord(updatedSettlementRecord);
    return updatedSettlementRecord;
  }

  async function rebuildSupplierSettlementTotalsByFunction(settlementIds) {
    var uniqueSettlementIds = helpers.uniqueNonEmpty(settlementIds || []);
    var response;
    var result;

    if (!uniqueSettlementIds.length) {
      return {
        success: true,
        message: "",
        processedCount: 0,
        updatedCount: 0,
        warningCount: 0,
        updatedSettlementIds: [],
        warnings: [],
        details: []
      };
    }

    response = await crm.executeFunction(REBUILD_SUPPLIER_SETTLEMENT_TOTALS_FUNCTION, {
      settlementIdsString: uniqueSettlementIds.join("|||")
    });
    result = getSettlementRebuildFunctionResult(response);

    if (!result.success) {
      throw new Error(result.message || "Settlement totals could not be rebuilt.");
    }

    (result.details || []).forEach(syncSettlementStateFromRebuildDetail);
    return result;
  }

  async function recalculateSettlementTotals(settlementId) {
    var result;

    if (!settlementId) {
      return null;
    }

    result = await rebuildSupplierSettlementTotalsByFunction([settlementId]);
    return result.details && result.details[0] ? result.details[0] : null;
  }

  async function recalculateSettlementTotalsForSettlementIds(settlementIds) {
    var result = await rebuildSupplierSettlementTotalsByFunction(settlementIds);
    return result.details || [];
  }

  async function uploadFileToInvoiceField(invoiceId, fieldApiName, selectedFile) {
    var uploadRecord;
    var uploadedFileId = "";
    var payloadVariants;
    var index;
    var variant;
    var updateResult;
    var refreshedInvoice;

    uploadRecord = assertCrmMutationSucceeded(
      await crm.uploadFile(selectedFile),
      "Zoho CRM did not confirm the ZFS upload."
    );
    uploadedFileId = String(
      uploadRecord &&
      uploadRecord.details &&
      uploadRecord.details.id || ""
    ).trim();

    if (!uploadedFileId) {
      throw new Error("Zoho CRM uploaded the file but did not return a file id.");
    }

    payloadVariants = [
      {
        label: "array-object-$file_id",
        value: [{ $file_id: uploadedFileId }]
      },
      {
        label: "array-object-file_id",
        value: [{ file_id: uploadedFileId }]
      },
      {
        label: "array-string-id",
        value: [uploadedFileId]
      },
      {
        label: "object-$file_id-array",
        value: { $file_id: [uploadedFileId] }
      }
    ];

    for (index = 0; index < payloadVariants.length; index += 1) {
      variant = payloadVariants[index];
      updateResult = assertCrmMutationSucceeded(
        await crm.updateRecord(MODULES.invoices, invoiceId, (function () {
          var payload = {};

          payload[fieldApiName] = variant.value;
          return payload;
        }())),
        "Zoho CRM did not confirm the Invoice_File update."
      );

      refreshedInvoice = await crm.getRecord(MODULES.invoices, invoiceId);

      if (refreshedInvoice && refreshedInvoice[fieldApiName]) {
        return {
          uploadedFileId: uploadedFileId,
          updateResult: updateResult,
          variantLabel: variant.label,
          refreshedInvoice: refreshedInvoice
        };
      }
    }

    refreshedInvoice = await crm.getRecord(MODULES.invoices, invoiceId);
    return {
      uploadedFileId: uploadedFileId,
      updateResult: updateResult,
      variantLabel: payloadVariants[payloadVariants.length - 1].label,
      refreshedInvoice: refreshedInvoice
    };
  }

  function revokeObjectUrl(url) {
    if (!url || !global.URL || typeof global.URL.revokeObjectURL !== "function") {
      return;
    }

    try {
      global.URL.revokeObjectURL(url);
    } catch (error) {
      debugError("revokeObjectUrl failed", error, {
        url: url
      });
    }
  }

  function setInvoiceCreateDocumentFile(file) {
    var nextFile = file || null;

    revokeObjectUrl(state.invoiceCreation.documentFilePreviewUrl);

    state.invoiceCreation.documentFile = nextFile;
    state.invoiceCreation.documentFilePreviewUrl = "";
  }

  function clearInvoiceCreateDocumentFileSelection() {
    if (elements.invoiceCreateFileInput) {
      elements.invoiceCreateFileInput.value = "";
    }

    setInvoiceCreateDocumentFile(null);
  }

  function getInvoiceCreateDocumentFile() {
    return state.invoiceCreation.documentFile || null;
  }

  function isPreviewableImageFile(file) {
    var fileName = String(file && file.name || "");
    var fileType = String(file && file.type || "").toLowerCase();

    return fileType.indexOf("image/") === 0 || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);
  }

  function isPreviewablePdfFile(file) {
    var fileName = String(file && file.name || "");
    var fileType = String(file && file.type || "").toLowerCase();

    return fileType === "application/pdf" || /\.pdf$/i.test(fileName);
  }

  function onInvoiceCreateDocumentFileChange() {
    var file = elements.invoiceCreateFileInput &&
      elements.invoiceCreateFileInput.files &&
      elements.invoiceCreateFileInput.files[0]
      ? elements.invoiceCreateFileInput.files[0]
      : null;

    clearInvoiceCreateValidationState();
    setInvoiceCreateDocumentFile(file);
    renderAll();
  }

  function onInvoiceCreateDocumentFilePreviewClick(event) {
    var actionTrigger = event.target && typeof event.target.closest === "function"
      ? event.target.closest("[data-invoice-create-file-action]")
      : null;
    var action = actionTrigger ? actionTrigger.getAttribute("data-invoice-create-file-action") : "";

    if (action !== "remove") {
      return;
    }

    clearInvoiceCreateDocumentFileSelection();
    renderAll();
  }

  function renderInvoiceCreateSelect(selectElement, options, placeholder) {
    var items = Array.isArray(options) ? options : [];
    var markup = ['<option value="">' + helpers.escapeHtml(placeholder || "Select an option") + "</option>"];

    items.forEach(function (item) {
      markup.push(
        '<option value="' + helpers.escapeHtml(item.value) + '">' + helpers.escapeHtml(item.label) + "</option>"
      );
    });

    selectElement.innerHTML = markup.join("");
    selectElement.disabled = items.length === 0;
  }

  function getAccountingAccountLookupDisplayValue(accountLookup) {
    if (!accountLookup) {
      return "";
    }

    if (typeof accountLookup !== "object") {
      return String(accountLookup || "").trim();
    }

    return String(
      accountLookup.Account_Code ||
      accountLookup.Name ||
      accountLookup.name ||
      accountLookup.Account_Name ||
      ""
    ).trim();
  }

  function getSupplierResolvedAccountingAccount(supplier) {
    var defaultAccountingLookup;
    var defaultAccountingDisplayValue;
    var fallbackAccountingValue;
    var fallbackAccountingDisplayValue;

    if (!supplier) {
      return {
        hasValue: false,
        displayValue: "",
        source: ""
      };
    }

    defaultAccountingLookup = helpers.getLookupValue(supplier, FIELD_CANDIDATES.supplier.defaultAccountingAccount);
    defaultAccountingDisplayValue = getAccountingAccountLookupDisplayValue(defaultAccountingLookup);

    if (defaultAccountingDisplayValue) {
      return {
        hasValue: true,
        displayValue: defaultAccountingDisplayValue,
        source: "default"
      };
    }

    fallbackAccountingValue = helpers.firstValue(supplier, FIELD_CANDIDATES.supplier.accounting || ["Cuenta_Contable"]);
    fallbackAccountingDisplayValue = getAccountingAccountLookupDisplayValue(fallbackAccountingValue);

    if (fallbackAccountingDisplayValue) {
      return {
        hasValue: true,
        displayValue: fallbackAccountingDisplayValue,
        source: "legacy"
      };
    }

    return {
      hasValue: false,
      displayValue: "",
      source: ""
    };
  }


  function getSupplierDestinationValue() {
    var rawDestination = helpers.firstValue(state.supplier, ["Destination"]);
    return helpers.normalizeDestinationValue(typeof rawDestination === "object" ? helpers.getLookupName(rawDestination) : rawDestination);
  }

  function applyInvoiceCreateSupplierTaxDefaults() {
    var destination = getSupplierDestinationValue();
    var vatDefault = "";

    if (destination.indexOf("portugal") !== -1) {
      vatDefault = "23";
    } else if (destination.indexOf("spain") !== -1) {
      vatDefault = "21";
    }

    if (!elements.invoiceCreateVatPercent.dataset.userTouched) {
      elements.invoiceCreateVatPercent.value = vatDefault;
    }

    if (!elements.invoiceCreateIrpfPercent.dataset.userTouched) {
      elements.invoiceCreateIrpfPercent.value = "0";
    }

    syncInvoiceCreateAdditionalVatVisibility();
    updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
  }

  function getResolvedInvoiceCreateFieldApi(fieldKey, fallbackApiName) {
    return state.invoiceCreation.invoiceFields[fieldKey] && state.invoiceCreation.invoiceFields[fieldKey].api_name
      ? state.invoiceCreation.invoiceFields[fieldKey].api_name
      : fallbackApiName;
  }

  function escapeCoqlValue(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function normalizeInvoiceNumberForComparison(value) {
    return String(value || "").trim().toLowerCase();
  }

  function formatFileSize(bytes) {
    var size = Number(bytes) || 0;

    if (size >= 1024 * 1024) {
      return (size / (1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " MB";
    }

    if (size >= 1024) {
      return Math.round(size / 1024) + " KB";
    }

    return size + " B";
  }

  async function ensureInvoiceCreateFieldMetadataLoaded() {
    var response;
    var fields;

    if (state.invoiceCreation.invoiceFields && Object.keys(state.invoiceCreation.invoiceFields).length) {
      return;
    }

    try {
      response = await crm.getFields(MODULES.invoices);
      fields = response && Array.isArray(response.fields) ? response.fields : [];
    } catch (error) {
      debugError("ensureInvoiceCreateFieldMetadataLoaded failed", error);
      fields = [];
    }

    state.invoiceCreation.invoiceFields = {
      invoiceNumber: helpers.findFieldByCandidates(fields, ["Name", "Invoice Number", "Invoice_Number"]),
      settlementLookup: helpers.findFieldByCandidates(fields, ["Supplier_Settlement", "Supplier Settlement"]),
      bookingLookup: helpers.findFieldByCandidates(fields, ["Booking", "Deal_Name", "Deal Name", "Booking_Name", "Booking Name"]),
      status: helpers.findFieldByCandidates(fields, ["Status"]),
      invoiceDate: helpers.findFieldByCandidates(fields, ["Invoice_Date", "Invoice Date"]),
      invoiceType: helpers.findFieldByCandidates(fields, ["Invoice_Type", "Invoice Type"]),
      invoiceAmountExclVat: helpers.findFieldByCandidates(fields, ["Invoice_Amount_Excl_VAT", "Invoice Amount Excl VAT"]),
      invoiceAmountInclVat: helpers.findFieldByCandidates(fields, ["Invoice_Amount_Incl_VAT", "Invoice Amount Incl VAT"]),
      vatPercent: helpers.findFieldByCandidates(fields, ["VAT_percentage", "VAT %", "VAT Percentage"]),
      vatAmount: helpers.findFieldByCandidates(fields, ["VAT_Amount", "VAT Amount"]),
      additionalAmountExclVat: helpers.findFieldByCandidates(fields, ["Additional_Amount_Excl_VAT", "Additional Amount Excl VAT"]),
      additionalAmountInclVat: helpers.findFieldByCandidates(fields, ["Additional_Amount_Incl_VAT", "Additional Amount Incl VAT"]),
      additionalVatPercent: helpers.findFieldByCandidates(fields, ["Additional_VAT_percentage", "Additional VAT %", "Additional VAT Percentage"]),
      additionalVatAmount: helpers.findFieldByCandidates(fields, ["Additional_VAT_Amount", "Additional VAT Amount"]),
      additionalIrpfPercent: helpers.findFieldByCandidates(fields, ["Additional_IRPF_percentage", "Additional IRPF %", "Additional IRPF Percentage"]),
      additionalIrpfAmount: helpers.findFieldByCandidates(fields, ["Additional_IRPF_Amount", "Additional IRPF Amount"]),
      irpfPercent: helpers.findFieldByCandidates(fields, ["IRPF_percentage", "IRPF %", "IRPF Percentage"]),
      irpfAmount: helpers.findFieldByCandidates(fields, ["IRPF_Amount", "IRPF Amount"]),
      reimbursableExpense: helpers.findFieldByCandidates(fields, ["Reimbursable_Expense", "Reimbursable Expense"]),
      invoiceTotal: helpers.findFieldByCandidates(fields, ["Invoice_Total", "Invoice Total"]),
      totalPayableAmount: helpers.findFieldByCandidates(fields, ["Total_Payable_Amount", "Total Payable Amount"]),
      supplierAccounting: helpers.findFieldByCandidates(fields, FIELD_CANDIDATES.invoice.supplierAccounting)
    };

    state.invoiceCreation.invoiceTypeOptions = helpers.getPicklistOptions(state.invoiceCreation.invoiceFields.invoiceType);

    renderInvoiceCreateSelect(
      elements.invoiceCreateStatus,
      helpers.getPicklistOptions(state.invoiceCreation.invoiceFields.status),
      "Select status"
    );
    renderInvoiceCreateSelect(
      elements.invoiceCreateType,
      getInvoiceCreateTypeOptionsForMode(),
      "Select invoice type"
    );
    syncInvoiceCreateModeDefaults();
    setDefaultInvoiceCreateStatus();
  }

  async function ensureInvoiceCreateSettlementStatusOptionsLoaded() {
    var response;
    var fields;
    var statusField;
    var options;

    if (state.invoiceCreation.settlementStatusOptions.length) {
      return state.invoiceCreation.settlementStatusOptions;
    }

    try {
      response = await crm.getFields(MODULES.settlements);
      fields = response && Array.isArray(response.fields) ? response.fields : [];
      statusField = helpers.findFieldByCandidates(fields, ["Admin_Status", "Admin Status"]);
      options = helpers.getPicklistOptions(statusField);
    } catch (error) {
      debugError("ensureInvoiceCreateSettlementStatusOptionsLoaded failed", error);
      options = [];
    }

    getDefaultInvoiceCreateSettlementStatusValues().slice().reverse().forEach(function (defaultStatus) {
      if (!options.some(function (option) {
        return helpers.normalizeQuery(option.value) === helpers.normalizeQuery(defaultStatus);
      })) {
        options.unshift({
          value: defaultStatus,
          label: defaultStatus
        });
      }
    });

    state.invoiceCreation.settlementStatusOptions = options;
    return options;
  }

  function getInvoiceCreateSettlementUnpaidInvoicedAmount(settlement) {
    return roundCurrency(Number(settlement && settlement.Total_Invoice || 0) - Number(settlement && settlement.Total_Paid || 0));
  }

  function getInvoiceCreateSettlementRemainingToInvoice(settlement) {
    return roundCurrency(Number(settlement && settlement.Total_Service_Cost || 0) - Number(settlement && settlement.Total_Invoice || 0));
  }
  function getSettlementMfsp(settlement) {
    var bookingId = helpers.getLookupId(settlement && settlement.Booking);

    if (settlement && settlement.MFSP_Reference) {
      return settlement.MFSP_Reference;
    }

    return bookingId ? state.indexes.mfspByBookingId[bookingId] || "" : "";
  }

  function syncInvoiceCreateSettlementRecord(settlement) {
    var settlementId = settlement && settlement.id ? String(settlement.id) : "";

    if (!settlementId) {
      return;
    }

    state.invoiceCreation.settlements = (state.invoiceCreation.settlements || []).map(function (item) {
      return String(item && item.id || "") === settlementId ? settlement : item;
    });

    if (state.invoiceCreation.selectedSettlement && String(state.invoiceCreation.selectedSettlement.id || "") === settlementId) {
      state.invoiceCreation.selectedSettlement = settlement;
    }
  }

  async function validateInvoiceCreateSettlementCapacity(settlementId, invoiceTotalToAdd, invoiceType) {
    var settlementRecord;
    var totalServiceCost;
    var currentTotalInvoice;
    var nextTotalInvoice;
    var remainingToInvoice;
    var normalizedInvoiceTotal;
    var isCreditNote;

    if (!settlementId) {
      return {
        valid: false,
        message: "Select a supplier settlement before creating the invoice."
      };
    }

    settlementRecord = await crm.getRecord(MODULES.settlements, settlementId);

    if (!settlementRecord) {
      return {
        valid: false,
        message: "Could not load the latest settlement totals to validate this invoice."
      };
    }

    syncInvoiceCreateSettlementRecord(settlementRecord);
    totalServiceCost = roundCurrency(Number(settlementRecord.Total_Service_Cost || 0) || 0);
    currentTotalInvoice = roundCurrency(Number(settlementRecord.Total_Invoice || 0) || 0);
    normalizedInvoiceTotal = roundCurrency(Number(invoiceTotalToAdd) || 0);
    isCreditNote = String(invoiceType || "").trim() === INVOICE_TYPES.creditNote;
    nextTotalInvoice = roundCurrency(currentTotalInvoice + (isCreditNote ? -normalizedInvoiceTotal : normalizedInvoiceTotal));
    remainingToInvoice = roundCurrency(totalServiceCost - currentTotalInvoice);

    if (isCreditNote && nextTotalInvoice < 0) {
      return {
        valid: false,
        message: "This credit note would reduce the settlement below EUR 0.00 invoiced. Current net invoiced amount: " +
          helpers.formatCurrency(currentTotalInvoice) +
          ". Credit note total: " + helpers.formatCurrency(normalizedInvoiceTotal) + "."
      };
    }

    if (!isCreditNote && nextTotalInvoice > totalServiceCost) {
      return {
        valid: true,
        requiresConfirmation: true,
        message: "This invoice would exceed the settlement Total Service Cost. Remaining amount to invoice: " +
          helpers.formatCurrency(remainingToInvoice) +
          ". New invoice total: " + helpers.formatCurrency(normalizedInvoiceTotal) +
          ". Settlement total service cost: " + helpers.formatCurrency(totalServiceCost) + "."
      };
    }

    return {
      valid: true,
      settlement: settlementRecord
    };
  }

  async function validateInvoiceCreateNumberUniqueness(supplierId, invoiceNumber) {
    var normalizedInvoiceNumber = normalizeInvoiceNumberForComparison(invoiceNumber);
    var invoiceNumberFieldApi = getResolvedInvoiceCreateFieldApi("invoiceNumber", "Name");
    var selectFields = await resolveCoqlFields(MODULES.invoices, ["id", "Supplier", invoiceNumberFieldApi]);
    var escapedSupplierId = escapeCoqlValue(supplierId);
    var escapedInvoiceNumber = escapeCoqlValue(invoiceNumber);
    var matches;

    if (!supplierId || !normalizedInvoiceNumber) {
      return true;
    }

    try {
      matches = await crm.coql(
        "select " + selectFields.join(", ") +
        " from " + MODULES.invoices +
        " where Supplier = '" + escapedSupplierId + "'" +
        " and " + invoiceNumberFieldApi + " = '" + escapedInvoiceNumber + "'" +
        " limit 0, 1"
      );

      return matches.length === 0;
    } catch (coqlError) {
      try {
        matches = await crm.searchRecord(
          MODULES.invoices,
          "(" + invoiceNumberFieldApi + ":equals:" + helpers.escapeCriteriaValue(invoiceNumber) + ")and(Supplier:equals:" + helpers.escapeCriteriaValue(supplierId) + ")"
        );
      } catch (searchError) {
        matches = (await loadInvoicesForSupplier(supplierId)).filter(function (record) {
          return normalizeInvoiceNumberForComparison(record[invoiceNumberFieldApi]) === normalizedInvoiceNumber;
        });
      }

      return !matches.some(function (record) {
        return helpers.getLookupId(record.Supplier) === supplierId &&
          normalizeInvoiceNumberForComparison(record[invoiceNumberFieldApi]) === normalizedInvoiceNumber;
      });
    }
  }

  function extractLoggedInUserEmail(response) {
    var candidates = [];
    var index;
    var candidate;

    if (response) {
      candidates.push(response);
    }
    if (response && Array.isArray(response.users)) {
      candidates = candidates.concat(response.users);
    }
    if (response && Array.isArray(response.data)) {
      candidates = candidates.concat(response.data);
    }
    if (response && response.data && !Array.isArray(response.data)) {
      candidates.push(response.data);
    }
    if (response && response.result) {
      candidates.push(response.result);
    }
    if (response && response.current_user) {
      candidates.push(response.current_user);
    }
    if (response && response.user) {
      candidates.push(response.user);
    }

    for (index = 0; index < candidates.length; index += 1) {
      candidate = candidates[index] || {};
      if (candidate.email || candidate.Email || candidate.user_email) {
        return String(candidate.email || candidate.Email || candidate.user_email).trim();
      }
    }

    return "";
  }

  async function getCurrentUserEmail() {
    var readers = [
      function () {
        return global.ZOHO && global.ZOHO.CRM && global.ZOHO.CRM.CONFIG && typeof global.ZOHO.CRM.CONFIG.getCurrentUser === "function"
          ? global.ZOHO.CRM.CONFIG.getCurrentUser()
          : null;
      },
      function () {
        return global.$Crm && global.$Crm.user ? global.$Crm.user : null;
      },
      function () {
        return global.ZOHO && global.ZOHO.CRM && global.ZOHO.CRM.API && typeof global.ZOHO.CRM.API.getCurrentUser === "function"
          ? global.ZOHO.CRM.API.getCurrentUser()
          : null;
      }
    ];
    var index;
    var response;
    var email;

    for (index = 0; index < readers.length; index += 1) {
      try {
        response = await Promise.resolve(readers[index]());
        email = extractLoggedInUserEmail(response);
        if (email) {
          return email;
        }
      } catch (error) {
        debugWarn("Could not read current user email for Ezus sync", {
          error: error && error.message ? error.message : String(error)
        });
      }
    }

    throw new Error("Could not determine the email of the user starting the Ezus sync.");
  }

  var zohoPageLoadReceived = false;
  var zohoSdkInitialized = false;
  var initialInvoicesLoadPromise = null;

  function loadInitialOpenInvoices() {
    if (initialInvoicesLoadPromise || !zohoSdkInitialized || !zohoPageLoadReceived) {
      return initialInvoicesLoadPromise;
    }

    // PageLoad marks the point at which Zoho has finished creating the
    // widget context. Loading before it can complete without returning CRM
    // records, while clicking Open later works as expected.
    initialInvoicesLoadPromise = (async function () {
      state.currentTab = "invoices";
      state.views.invoices.view = "open";
      state.views.invoices.page = 1;
      await refreshInvoicesTabData({
        loadingLabel: "Loading invoices...",
        errorMessage: "Could not load invoices.",
        loadedFlag: true
      });
    }());

    return initialInvoicesLoadPromise;
  }

  async function bootstrap() {
    if (!global.ZOHO || !ZOHO.embeddedApp) {
      debugWarn("ZOHO.embeddedApp missing during bootstrap");
      renderer.showError("Zoho SDK was not detected. If this should run inside CRM, re-upload the widget and try again.");
      return;
    }

    ZOHO.embeddedApp.on("PageLoad", function (data) {
      var supplierIdFromPayload;

      zohoPageLoadReceived = true;
      state.selectedIds = helpers.readSelectedIds(data);
      state.clientPayload = helpers.getClientPayload(data);
      supplierIdFromPayload = helpers.getSupplierIdFromPayload(state.clientPayload);

      // Keep the context assignment ahead of the initial query.  The loader
      // itself is guarded until both PageLoad and embeddedApp.init have run.
      loadInitialOpenInvoices();

      if (supplierIdFromPayload) {
        loadSupplierWorkspace(supplierIdFromPayload);
        return;
      }

      if (state.selectedIds.length) {
        loadSupplierWorkspace(state.selectedIds[0]);
      }
    });

    try {
      await ZOHO.embeddedApp.init();
      zohoSdkInitialized = true;

      // Supplier suggestions are unrelated to the invoice query.  Starting
      // this here prevents a slow supplier bootstrap from leaving the Open
      // view selected but empty.
      loadInitialOpenInvoices();

      if (ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Resize) {
        await ZOHO.CRM.UI.Resize({
          width: "1480",
          height: "920"
        });
      }

      await bootstrapRecentSuppliers();
      state.zohoReady = true;
      renderer.setMode("Connected to CRM");
      if (!state.supplier) {
        renderer.showNotice("Supplier list loaded. Search by name, connection reference or Ezus reference.");
      }
    } catch (error) {
      debugError("bootstrap failed", error);
      renderer.showError("The widget could not initialize inside Zoho CRM.");
    }
  }

  async function getModuleFields(moduleName) {
    var response;
    var fields;

    if (Object.prototype.hasOwnProperty.call(moduleFieldMetadataCache, moduleName)) {
      return moduleFieldMetadataCache[moduleName];
    }

    try {
      response = await crm.getFields(moduleName);
      fields = response && Array.isArray(response.fields) ? response.fields : [];
      moduleFieldMetadataCache[moduleName] = fields;
      return fields;
    } catch (error) {
      moduleFieldMetadataCache[moduleName] = null;
      return null;
    }
  }

  async function getModuleFieldApis(moduleName) {
    var fields;
    var apiIndex = {};

    if (Object.prototype.hasOwnProperty.call(moduleFieldApiCache, moduleName)) {
      return moduleFieldApiCache[moduleName];
    }

    try {
      fields = await getModuleFields(moduleName);
      fields = Array.isArray(fields) ? fields : [];
      fields.forEach(function (field) {
        if (field && field.api_name) {
          apiIndex[field.api_name] = true;
        }
      });
      moduleFieldApiCache[moduleName] = apiIndex;
      return apiIndex;
    } catch (error) {
      moduleFieldApiCache[moduleName] = null;
      return null;
    }
  }

  async function resolveFieldApiByCandidates(moduleName, candidates, fallbackApiName) {
    var fields = await getModuleFields(moduleName);
    var resolvedField;

    if (!fields) {
      return fallbackApiName;
    }

    resolvedField = helpers.findFieldByCandidates(fields, candidates);
    return resolvedField && resolvedField.api_name ? resolvedField.api_name : fallbackApiName;
  }

  async function resolveCoqlFields(moduleName, requestedFields) {
    var availableFields = await getModuleFieldApis(moduleName);
    var filteredFields;

    if (!availableFields) {
      return requestedFields;
    }

    filteredFields = requestedFields.filter(function (fieldApi) {
      return fieldApi === "id" || availableFields[fieldApi];
    });

    return filteredFields.length ? filteredFields : ["id"];
  }

  async function setCurrentTab(tabName) {
    if (tabName === "paymentAccounts") {
      state.currentTab = "payments";
      state.views.payments.section = "accounts";
    } else {
      state.currentTab = tabName;

      if (tabName === "payments") {
        state.views.payments.section = "payments";
      }
    }

    renderAll();
    await ensureTabDataLoaded(state.currentTab);
    renderAll();
  }

  function setInvoiceSummaryOpen(isOpen) {
    if (!elements.invoicesWorkspace || !elements.invoiceSummarySidebar || !elements.invoiceSummaryOpen) {
      return;
    }

    if (!isOpen && global.innerWidth <= 980) {
      return;
    }

    elements.invoicesWorkspace.classList.toggle("is-summary-collapsed", !isOpen);
    elements.invoiceSummarySidebar.setAttribute("aria-hidden", isOpen ? "false" : "true");
    elements.invoiceSummaryOpen.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if ("inert" in elements.invoiceSummarySidebar) {
      elements.invoiceSummarySidebar.inert = !isOpen;
    }

    if (isOpen && elements.invoiceSummaryClose) {
      global.setTimeout(function () {
        elements.invoiceSummaryClose.focus();
      }, 0);
    } else if (!isOpen) {
      global.setTimeout(function () {
        elements.invoiceSummaryOpen.focus();
      }, 420);
    }
  }

  async function openNativeCreateForModule(moduleApi, label, onRefresh) {
    if (!(global.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Record && typeof ZOHO.CRM.UI.Record.create === "function")) {
      renderer.showError("Zoho native create form is not available in this widget context.");
      return;
    }

    renderer.showError("");

    try {
      await ZOHO.CRM.UI.Record.create({
        Entity: moduleApi
      });

      if (typeof onRefresh === "function") {
        await onRefresh();
      }
    } catch (error) {
      debugError("openNativeCreateForModule failed", error, {
        moduleApi: moduleApi
      });
      renderer.showError("Could not open the create form for " + label + ".");
    }
  }

  function getZohoCrmBaseUrl() {
    var candidates = [];
    var match;

    if (global.location && global.location.href) {
      candidates.push(String(global.location.href));
    }
    if (global.document && global.document.referrer) {
      candidates.push(String(global.document.referrer));
    }
    try {
      if (global.parent && global.parent.location && global.parent.location.href) {
        candidates.push(String(global.parent.location.href));
      }
    } catch (parentLocationError) {}
    try {
      if (global.top && global.top.location && global.top.location.href) {
        candidates.push(String(global.top.location.href));
      }
    } catch (topLocationError) {}

    match = candidates.map(function (candidate) {
      return String(candidate || "").match(/^(https?:\/\/[^/]+)(\/crm\/org\d+)/i);
    }).find(function (item) {
      return item && item[1] && item[2];
    });

    if (!match) {
      return "";
    }

    return match[1] + match[2];
  }

  function buildZohoRecordEditUrl(moduleApi, recordId) {
    var baseUrl = getZohoCrmBaseUrl();

    if (!baseUrl || !moduleApi || !recordId) {
      return "";
    }

    return baseUrl + "/tab/" + encodeURIComponent(moduleApi) + "/" + encodeURIComponent(recordId) + "/edit";
  }

  function buildZohoRecordViewUrl(moduleApi, recordId) {
    var baseUrl = getZohoCrmBaseUrl();

    if (!baseUrl || !moduleApi || !recordId) {
      return "";
    }

    return baseUrl + "/tab/" + encodeURIComponent(moduleApi) + "/" + encodeURIComponent(recordId);
  }

  async function openNativeEditForModule(moduleApi, recordId, label, onRefresh, options) {
    var settings = options || {};
    var editUrl;
    var openedWindow;

    if (settings.preferNewTab && typeof global.open === "function") {
      editUrl = buildZohoRecordEditUrl(moduleApi, recordId);

      if (editUrl) {
        openedWindow = global.open(editUrl, "_blank", "noopener");

        if (openedWindow) {
          renderer.showNotice("Opened " + label + " in a new tab.", {
            tone: "success"
          });
          return;
        }
      }
    }

    if (!(global.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Record && typeof ZOHO.CRM.UI.Record.edit === "function")) {
      renderer.showError("Zoho native edit form is not available in this widget context.");
      return;
    }

    renderer.showError("");

    try {
      await ZOHO.CRM.UI.Record.edit({
        Entity: moduleApi,
        RecordID: recordId
      });

      if (typeof onRefresh === "function") {
        await onRefresh();
      }
    } catch (error) {
      debugError("openNativeEditForModule failed", error, {
        moduleApi: moduleApi,
        recordId: recordId
      });
      renderer.showError("Could not open the edit form for " + label + ".");
    }
  }

  async function deleteModuleRecord(moduleApi, recordId, label, onRefresh) {
    var response;
    var result;
    var status;

    if (!recordId) {
      renderer.showError("Select a " + label + " first.");
      return false;
    }

    if (typeof global.confirm === "function" && !global.confirm("Delete this " + label + "? This action cannot be undone.")) {
      return false;
    }

    renderer.showError("");
    renderer.showNotice("Deleting " + label + "...", {
      isLoading: true
    });
    renderer.setLoading(true, "Deleting " + label + "...");
    renderAll();

    try {
      response = await crm.deleteRecord(moduleApi, recordId);
      result = helpers.extractRecords(response)[0] || response || {};
      status = String(result.status || result.code || "").toLowerCase();

      if (status && status !== "success") {
        throw new Error(result.message || "Zoho CRM did not confirm the deletion.");
      }

      if (typeof onRefresh === "function") {
        await onRefresh();
      }

      renderer.showNotice(label.charAt(0).toUpperCase() + label.slice(1) + " deleted successfully.", {
        tone: "success"
      });
      return true;
    } catch (error) {
      renderer.showNotice("");
      debugError("deleteModuleRecord failed", error, {
        moduleApi: moduleApi,
        recordId: recordId
      });
      renderer.showError(error.message || "Could not delete the " + label + ".");
      return false;
    } finally {
      renderer.setLoading(false);
    }
  }

  function closeSelectedInvoiceDeletePanel(renderImmediately) {
    state.invoiceDeletion.isOpen = false;
    state.invoiceDeletion.isBusy = false;
    state.invoiceDeletion.updateSettlement = true;

    if (renderImmediately !== false) {
      renderAll();
    }
  }

  function getSelectedInvoiceRecord() {
    var selectedInvoiceId = state.views && state.views.invoices ? state.views.invoices.selectedDetailId : "";

    return state.records.invoices.find(function (invoice) {
      return String(invoice.id || "") === String(selectedInvoiceId || "");
    }) || null;
  }

  function getSelectedPaymentRecord() {
    var selectedPaymentId = state.views && state.views.payments ? state.views.payments.selectedId : "";

    return state.records.payments.find(function (payment) {
      return String(payment && payment.id || "") === String(selectedPaymentId || "");
    }) || null;
  }

  function upsertRecordById(records, nextRecord) {
    var normalizedRecords = Array.isArray(records) ? records.slice() : [];
    var nextId = String(nextRecord && nextRecord.id || "");
    var didReplace = false;

    if (!nextId) {
      return normalizedRecords;
    }

    normalizedRecords = normalizedRecords.map(function (record) {
      if (String(record && record.id || "") === nextId) {
        didReplace = true;
        return nextRecord;
      }

      return record;
    });

    if (!didReplace) {
      normalizedRecords.unshift(nextRecord);
    }

    return normalizedRecords;
  }

  async function findAccountingEntryIdByInvoice(invoiceId) {
    var records;

    if (!invoiceId) {
      return "";
    }

    try {
      records = await crm.searchRecord(MODULES.accountingEntries, "(Supplier_Invoice:equals:" + invoiceId + ")");
      return records && records[0] && records[0].id ? String(records[0].id) : "";
    } catch (error) {
      debugError("findAccountingEntryIdByInvoice failed", error, {
        invoiceId: invoiceId
      });
      return "";
    }
  }

  function buildPaymentAccountingEntryName(paymentId) {
    paymentId = String(paymentId || "").trim();

    return paymentId ? "Supplier_Payment_" + paymentId : "";
  }

  async function findAccountingEntryIdByPayment(paymentId) {
    var records;
    var entryName = buildPaymentAccountingEntryName(paymentId);

    if (!entryName) {
      return "";
    }

    try {
      records = await crm.searchRecord(
        MODULES.accountingEntries,
        "(Name:equals:" + helpers.escapeCriteriaValue(entryName) + ")"
      );
      return records && records[0] && records[0].id ? String(records[0].id) : "";
    } catch (error) {
      debugError("findAccountingEntryIdByPayment failed", error, {
        paymentId: paymentId,
        entryName: entryName
      });
      return "";
    }
  }

  async function refreshInvoiceAfterAccountingAction(invoiceId) {
    var refreshedInvoice;

    if (!invoiceId) {
      return;
    }

    refreshedInvoice = await crm.getRecord(MODULES.invoices, invoiceId);

    if (!refreshedInvoice || !refreshedInvoice.id) {
      return;
    }

    state.records.invoices = upsertRecordById(state.records.invoices, refreshedInvoice);

    if (state.supplierId && getInvoiceSupplierId(refreshedInvoice) === state.supplierId) {
      state.supplierInvoices = sortRecordsByDateDesc(
        upsertRecordById(state.supplierInvoices, refreshedInvoice),
        "Invoice_Date"
      );
    }
  }

  async function refreshPaymentAfterAccountingAction(paymentId) {
    var refreshedPayment;
    var refreshedAccountingStatus;

    if (!paymentId) {
      return;
    }

    refreshedPayment = await crm.getRecord(MODULES.payments, paymentId);

    if (!refreshedPayment || !refreshedPayment.id) {
      return;
    }

    state.records.payments = upsertRecordById(state.records.payments, refreshedPayment);
    refreshedAccountingStatus = String(refreshedPayment.Accounting_Status || "").trim();

    if (refreshedAccountingStatus) {
      state.records.payAllocations = state.records.payAllocations.map(function (allocation) {
        if (helpers.getLookupId(allocation.Supplier_Payment) !== paymentId) {
          return allocation;
        }

        return Object.assign({}, allocation, {
          Payment_Accounting_Status: refreshedAccountingStatus
        });
      });
    }

    if (state.supplierId) {
      state.supplierPayments = await loadPaymentsForSupplier(state.supplierId);
    }
  }

  async function syncAccountingEntryForPayment(paymentId, options) {
    var settings = options || {};
    var response;
    var result;
    var rebuildResult = null;

    if (!paymentId) {
      throw new Error("Select a payment first.");
    }

    if (!settings.silent) {
      renderer.showError("");
      state.paymentAccounting.isBusy = true;
      state.paymentAccounting.action = "sync";
      renderer.refreshActionState();
      renderer.showNotice("Syncing accounting entry...", {
        isLoading: true
      });
    }

    try {
      response = await crm.executeFunction(RESOLVE_SUPPLIER_PAYMENT_ACCOUNTING_ENTRY_FUNCTION, {
        supplierPaymentId: paymentId,
        replaceExisting: "true"
      });
      result = getInvoiceAccountingFunctionResult(response);

      if (!result.success) {
        throw new Error(result.message || "Accounting entry could not be generated.");
      }

      if (result.accountingEntryId) {
        rebuildResult = await rebuildAccountingEntryTotalsForPayment(paymentId, result.accountingEntryId);
        state.paymentAccounting.lastEntryId = rebuildResult.accountingEntryId || result.accountingEntryId;
      } else {
        state.paymentAccounting.lastEntryId = "";
      }

      await refreshPaymentAfterAccountingAction(paymentId);

      if (!settings.skipRender) {
        renderAll();
      }

      return {
        result: result,
        rebuildResult: rebuildResult,
        message: buildInvoiceAccountingSuccessMessage(result, rebuildResult)
      };
    } catch (error) {
      if (!settings.skipRender) {
        renderAll();
      }
      throw error;
    } finally {
      if (!settings.silent) {
        state.paymentAccounting.isBusy = false;
        state.paymentAccounting.action = "";
        renderer.refreshActionState();
      }
    }
  }

  async function syncAccountingEntryForInvoice(invoiceId, options) {
    var settings = options || {};
    var response;
    var result;
    var rebuildResult = null;

    if (!invoiceId) {
      throw new Error("Select an invoice first.");
    }

    if (!settings.silent) {
      renderer.showError("");
      state.invoiceAccounting.isBusy = true;
      state.invoiceAccounting.action = "sync";
      renderer.refreshActionState();
      renderer.showNotice("Syncing accounting entry...", {
        isLoading: true
      });
    }

    try {
      response = await crm.executeFunction(RESOLVE_SUPPLIER_INVOICE_ACCOUNTING_ENTRY_FUNCTION, {
        supplierInvoiceId: invoiceId,
        replaceExisting: "true"
      });
      result = getInvoiceAccountingFunctionResult(response);

      if (!result.success) {
        throw new Error(result.message || "Accounting entry could not be generated.");
      }

      if (result.accountingEntryId) {
        rebuildResult = await rebuildAccountingEntryTotalsForInvoice(invoiceId, result.accountingEntryId);
        state.invoiceAccounting.lastEntryId = rebuildResult.accountingEntryId || result.accountingEntryId;
      } else {
        state.invoiceAccounting.lastEntryId = "";
      }

      await refreshInvoiceAfterAccountingAction(invoiceId);

      if (!settings.skipRender) {
        renderAll();
      }

      return {
        result: result,
        rebuildResult: rebuildResult,
        message: buildInvoiceAccountingSuccessMessage(result, rebuildResult)
      };
    } catch (error) {
      if (!settings.skipRender) {
        renderAll();
      }
      throw error;
    } finally {
      if (!settings.silent) {
        state.invoiceAccounting.isBusy = false;
        state.invoiceAccounting.action = "";
        renderer.refreshActionState();
      }
    }
  }

  async function syncAccountingEntriesForInvoices(invoiceIds, options) {
    var settings = options || {};
    var uniqueInvoiceIds = helpers.uniqueNonEmpty(invoiceIds || []);
    var syncedInvoiceIds = [];
    var failures = [];
    var index;
    var invoiceId;
    var errorMessage;

    for (index = 0; index < uniqueInvoiceIds.length; index += 1) {
      invoiceId = uniqueInvoiceIds[index];

      try {
        await syncAccountingEntryForInvoice(invoiceId, {
          silent: true,
          skipRender: true
        });
        syncedInvoiceIds.push(invoiceId);
      } catch (error) {
        errorMessage = error && error.message ? error.message : "Unknown accounting sync error.";
        failures.push({
          invoiceId: invoiceId,
          message: errorMessage
        });

        if (!settings.continueOnError) {
          throw error;
        }
      }
    }

    return {
      invoiceIds: uniqueInvoiceIds,
      syncedInvoiceIds: syncedInvoiceIds,
      failures: failures
    };
  }

  async function rebuildAccountingEntryTotalsForInvoice(invoiceId, knownEntryId) {
    var accountingEntryId = String(knownEntryId || "").trim();
    var response;
    var result;

    if (!accountingEntryId) {
      accountingEntryId = await findAccountingEntryIdByInvoice(invoiceId);
    }

    if (!accountingEntryId) {
      throw new Error("No accounting entry exists for this invoice yet.");
    }

    response = await crm.executeFunction(REBUILD_ACCOUNTING_ENTRY_TOTALS_FUNCTION, {
      accountingEntryId: accountingEntryId
    });
    result = getInvoiceAccountingFunctionResult(response);
    result.accountingEntryId = result.accountingEntryId || accountingEntryId;

    if (!result.success) {
      throw new Error(result.message || "Accounting entry totals could not be rebuilt.");
    }

    return result;
  }

  async function rebuildAccountingEntryTotalsForPayment(paymentId, knownEntryId) {
    var accountingEntryId = String(knownEntryId || "").trim();
    var response;
    var result;

    if (!accountingEntryId) {
      accountingEntryId = await findAccountingEntryIdByPayment(paymentId);
    }

    if (!accountingEntryId) {
      throw new Error("No accounting entry exists for this payment yet.");
    }

    response = await crm.executeFunction(REBUILD_ACCOUNTING_ENTRY_TOTALS_FUNCTION, {
      accountingEntryId: accountingEntryId
    });
    result = getInvoiceAccountingFunctionResult(response);
    result.accountingEntryId = result.accountingEntryId || accountingEntryId;

    if (!result.success) {
      throw new Error(result.message || "Accounting entry totals could not be rebuilt.");
    }

    return result;
  }

  function buildInvoiceAccountingSuccessMessage(result, rebuildResult) {
    var messageParts = [];
    var finalResult = rebuildResult || result || {};

    if (result && result.message) {
      messageParts.push(result.message.trim());
    }

    if (rebuildResult && rebuildResult.message && rebuildResult.message !== result.message) {
      messageParts.push(rebuildResult.message.trim());
    }

    if (finalResult.accountingEntryId) {
      messageParts.push("Entry ID: " + finalResult.accountingEntryId + ".");
    }

    if (finalResult.lineCount) {
      messageParts.push(
        finalResult.lineCount + " line(s), debit " +
        helpers.formatCurrency(finalResult.totalDebit) +
        ", credit " +
        helpers.formatCurrency(finalResult.totalCredit) +
        (finalResult.balanced ? ", balanced." : ", not balanced.")
      );
    }

    return messageParts.join(" ").trim() || "Accounting entry updated successfully.";
  }

  function buildSelectedInvoiceDeleteImpact(invoice) {
    var allocations = invoice ? (state.invoiceAllocationsByInvoiceId[invoice.id] || []) : [];
    var settlementId = getInvoiceSettlementId(invoice);
    var settlementName = getInvoiceSettlementName(invoice) || settlementId || "";
    var invoiceTotal = roundCurrency(helpers.getInvoiceTotalAmount(invoice, FIELD_CANDIDATES));
    var paidAmount = roundCurrency(Number(invoice && invoice.Amount_Paid || 0) || 0);
    var warnings = [];

    if (settlementId) {
      warnings.push("Settlement review: deleting this invoice can leave Total Invoice and Total Paid outdated on " + settlementName + ".");
    } else {
      warnings.push("This invoice is not linked to a settlement, so no settlement totals can be updated automatically.");
    }

    if (allocations.length) {
      warnings.push("Payment review: this invoice has " + allocations.length + " supplier pay allocation" + (allocations.length === 1 ? "" : "s") + " linked to it, so payments may need manual review after deletion.");
    }

    return {
      settlementId: settlementId,
      settlementName: settlementName,
      allocationCount: allocations.length,
      invoiceTotal: invoiceTotal,
      paidAmount: paidAmount,
      warningMessage: warnings.join(" ")
    };
  }

  async function updateSettlementAfterInvoiceDelete(invoice) {
    var settlementId = getInvoiceSettlementId(invoice);

    if (!settlementId) {
      return;
    }

    await recalculateSettlementTotals(settlementId);
    invalidateInvoiceCreateSettlementCache();
  }

  async function refreshInvoicesAfterInvoiceDelete(deletedInvoice) {
    var shouldReloadInvoicesView = state.currentTab === "invoices" && state.views.invoices.hasLoaded;

    state.loaded.settlements = false;
    state.loaded.invoices = false;
    state.loaded.payAllocations = false;
    state.views.invoices.hasMore = false;
    state.views.invoices.hasLoaded = false;
    state.records.settlements = [];
    state.records.invoices = [];
    state.records.payAllocations = [];
    resetPaymentRelationshipIndexes();

    if (deletedInvoice && deletedInvoice.id) {
      delete state.views.invoices.selectedIds[deletedInvoice.id];
      delete state.invoiceLinesByInvoiceId[deletedInvoice.id];
      delete state.invoiceAllocationsByInvoiceId[deletedInvoice.id];
    }

    state.views.invoices.selectedDetailId = "";
    if (shouldReloadInvoicesView) {
      await refreshInvoicesTabData({
        loadedFlag: true
      });
    }
    await ensurePayAllocationsLoaded();

    if (state.supplierId) {
      state.supplierInvoices = await loadInvoicesForSupplier(state.supplierId);
    }
  }

  async function onSelectedInvoiceSyncAccountingClick() {
    var invoice = getSelectedInvoiceRecord();
    var syncResult;

    if (!invoice || !invoice.id) {
      renderer.showError("Select an invoice first.");
      return;
    }

    try {
      syncResult = await syncAccountingEntryForInvoice(invoice.id);
      renderer.showNotice(syncResult.message, {
        tone: "success"
      });
    } catch (error) {
      debugError("onSelectedInvoiceSyncAccountingClick failed", error, {
        invoiceId: invoice.id
      });
      renderer.showError(error.message || "Accounting entry could not be generated.");
    }
  }

  async function onSelectedInvoiceRebuildAccountingTotalsClick() {
    var invoice = getSelectedInvoiceRecord();
    var rebuildResult;

    if (!invoice || !invoice.id) {
      renderer.showError("Select an invoice first.");
      return;
    }

    renderer.showError("");
    state.invoiceAccounting.isBusy = true;
    state.invoiceAccounting.action = "rebuild";
    renderer.refreshActionState();
    renderer.showNotice("Rebuilding accounting entry totals...", {
      isLoading: true
    });

    try {
      rebuildResult = await rebuildAccountingEntryTotalsForInvoice(invoice.id, "");
      state.invoiceAccounting.lastEntryId = rebuildResult.accountingEntryId || state.invoiceAccounting.lastEntryId;
      await refreshInvoiceAfterAccountingAction(invoice.id);
      renderAll();
      renderer.showNotice(buildInvoiceAccountingSuccessMessage(null, rebuildResult), {
        tone: "success"
      });
    } catch (error) {
      debugError("onSelectedInvoiceRebuildAccountingTotalsClick failed", error, {
        invoiceId: invoice.id
      });
      renderAll();
      renderer.showError(error.message || "Accounting entry totals could not be rebuilt.");
    } finally {
      state.invoiceAccounting.isBusy = false;
      state.invoiceAccounting.action = "";
      renderer.refreshActionState();
    }
  }

  async function onSelectedPaymentSyncAccountingClick() {
    var payment = getSelectedPaymentRecord();
    var syncResult;

    if (!payment || !payment.id) {
      renderer.showError("Select a payment first.");
      return;
    }

    try {
      syncResult = await syncAccountingEntryForPayment(payment.id);
      renderer.showNotice(syncResult.message, {
        tone: "success"
      });
    } catch (error) {
      debugError("onSelectedPaymentSyncAccountingClick failed", error, {
        paymentId: payment.id
      });
      renderer.showError(error.message || "Accounting entry could not be generated.");
    }
  }

  async function onSelectedPaymentRebuildAccountingTotalsClick() {
    var payment = getSelectedPaymentRecord();
    var rebuildResult;

    if (!payment || !payment.id) {
      renderer.showError("Select a payment first.");
      return;
    }

    renderer.showError("");
    state.paymentAccounting.isBusy = true;
    state.paymentAccounting.action = "rebuild";
    renderer.refreshActionState();
    renderer.showNotice("Rebuilding accounting entry totals...", {
      isLoading: true
    });

    try {
      rebuildResult = await rebuildAccountingEntryTotalsForPayment(payment.id, "");
      state.paymentAccounting.lastEntryId = rebuildResult.accountingEntryId || state.paymentAccounting.lastEntryId;
      await refreshPaymentAfterAccountingAction(payment.id);
      renderAll();
      renderer.showNotice(buildInvoiceAccountingSuccessMessage(null, rebuildResult), {
        tone: "success"
      });
    } catch (error) {
      debugError("onSelectedPaymentRebuildAccountingTotalsClick failed", error, {
        paymentId: payment.id
      });
      renderAll();
      renderer.showError(error.message || "Accounting entry totals could not be rebuilt.");
    } finally {
      state.paymentAccounting.isBusy = false;
      state.paymentAccounting.action = "";
      renderer.refreshActionState();
    }
  }

  async function onSelectedInvoiceEditClick() {
    var invoiceId = state.views.invoices.selectedDetailId;

    if (!invoiceId) {
      renderer.showError("Select an invoice first.");
      return;
    }

    await openNativeEditForModule(MODULES.invoices, invoiceId, "invoice", null, {
      preferNewTab: true
    });
  }

  function onSelectedInvoiceDeleteClick() {
    if (!state.views.invoices.selectedDetailId) {
      renderer.showError("Select an invoice first.");
      return;
    }

    renderer.showError("");
    state.invoiceDeletion.isOpen = true;
    state.invoiceDeletion.isBusy = false;
    if (typeof state.invoiceDeletion.updateSettlement !== "boolean") {
      state.invoiceDeletion.updateSettlement = true;
    }
    renderAll();
  }

  async function onSelectedInvoiceDeleteConfirmClick() {
    var invoice = getSelectedInvoiceRecord();
    var shouldUpdateSettlement = Boolean(state.invoiceDeletion.updateSettlement);
    var response;
    var result;
    var status;
    var settlementWarning = "";

    if (!invoice) {
      renderer.showError("Select an invoice first.");
      return;
    }

    state.invoiceDeletion.isBusy = true;
    renderer.showError("");
    renderer.showNotice("Deleting invoice...", {
      isLoading: true
    });
    renderer.setLoading(true, "Deleting invoice...");
    renderAll();

    try {
      response = await crm.deleteRecord(MODULES.invoices, invoice.id);
      result = helpers.extractRecords(response)[0] || response || {};
      status = String(result.status || result.code || "").toLowerCase();

      if (status && status !== "success") {
        throw new Error(result.message || "Zoho CRM did not confirm the invoice deletion.");
      }

      if (shouldUpdateSettlement && getInvoiceSettlementId(invoice)) {
        invalidateInvoiceCreateSettlementCache();
        try {
          await updateSettlementAfterInvoiceDelete(invoice);
        } catch (settlementError) {
          debugError("updateSettlementAfterInvoiceDelete failed", settlementError, {
            invoiceId: invoice.id,
            settlementId: getInvoiceSettlementId(invoice)
          });
          settlementWarning = " The invoice was deleted, but the settlement totals could not be updated automatically.";
        }
      }

      closeSelectedInvoiceDeletePanel(false);
      await refreshInvoicesAfterInvoiceDelete(invoice);
      renderAll();
      renderer.showNotice("Invoice deleted successfully." + settlementWarning, {
        tone: settlementWarning ? "neutral" : "success"
      });
    } catch (error) {
      debugError("onSelectedInvoiceDeleteConfirmClick failed", error, {
        invoiceId: invoice.id
      });
      state.invoiceDeletion.isBusy = false;
      renderer.showNotice("");
      renderer.showError(error.message || "Could not delete the invoice.");
      renderAll();
    } finally {
      renderer.setLoading(false);
      if (state.invoiceDeletion.isBusy) {
        state.invoiceDeletion.isBusy = false;
        renderAll();
      }
    }
  }

  function getSelectedPaymentAllocations(paymentId) {
    return state.records.payAllocations.filter(function (allocation) {
      return String(helpers.getLookupId(allocation.Supplier_Payment) || "") === String(paymentId || "");
    });
  }

  function isPaymentAllocationEditingLocked(payment) {
    var paymentStatus = String(payment && payment.Status || "").trim().toLowerCase();
    var accountingStatus = String(payment && payment.Accounting_Status || "").trim().toLowerCase();

    return paymentStatus === "reconciled" || paymentStatus === "cancelled" || paymentStatus === "canceled" ||
      accountingStatus === "posted" || accountingStatus === "synced" || accountingStatus === "exported" || accountingStatus === "reconciled";
  }

  async function getPaymentAccountingEntryForAllocationEdit(paymentId) {
    var entryId = await findAccountingEntryIdByPayment(paymentId);
    return entryId ? crm.getRecord(MODULES.accountingEntries, entryId) : null;
  }

  function isPostedAccountingEntry(entry) {
    var booksStatus = String(entry && entry.Books_Post_Status || "").trim().toLowerCase();
    var accountingStatus = String(entry && entry.Accounting_Status || "").trim().toLowerCase();
    return booksStatus === "posted" || booksStatus === "reconciled" || accountingStatus === "posted";
  }

  function closePaymentAllocationManager() {
    state.paymentAllocationManager = { isOpen: false, isLoading: false, isSaving: false, paymentId: "", paymentAmount: 0, invoices: [], amounts: {}, unlinkedAmounts: {}, newInvoiceIds: {}, isPickerOpen: false, tableQuery: "", searchRequestId: 0, searchResults: [], pickerError: "", error: "" };
    renderAll();
  }

  async function openPaymentAllocationManager() {
    var paymentId = String(state.views.payments.selectedId || "");
    var payment = state.records.payments.find(function (record) { return String(record.id) === paymentId; });
    var allocations;
    var invoices;
    if (!paymentId || !payment) { renderer.showError("Select a payment first."); return; }
    if (isPaymentAllocationEditingLocked(payment) || isPostedAccountingEntry(await getPaymentAccountingEntryForAllocationEdit(paymentId))) { renderer.showError("This payment is locked. Create a reversal instead."); return; }
    state.paymentAllocationManager.isOpen = true;
    state.paymentAllocationManager.isLoading = true;
    state.paymentAllocationManager.paymentId = paymentId;
    state.paymentAllocationManager.paymentAmount = roundCurrency(Number(payment.Payment_Amount) || 0);
    state.paymentAllocationManager.error = "";
    renderAll();
    try {
      allocations = await crm.searchRecord(MODULES.payAllocations, "(Supplier_Payment:equals:" + paymentId + ")");
      invoices = await Promise.all(allocations.map(function (allocation) { return crm.getRecord(MODULES.invoices, helpers.getLookupId(allocation.Supplier_Invoice)); }));
      state.paymentAllocationManager.invoices = invoices.filter(Boolean);
      state.paymentAllocationManager.amounts = {};
      allocations.forEach(function (allocation) { state.paymentAllocationManager.amounts[String(helpers.getLookupId(allocation.Supplier_Invoice))] = roundCurrency(Number(allocation.Allocated_Amount) || 0); });
    } catch (error) { state.paymentAllocationManager.error = error.message || "Could not load payment allocations."; }
    state.paymentAllocationManager.isLoading = false;
    renderAll();
  }

  function renderPaymentAllocationManager() {
    var manager = state.paymentAllocationManager;
    var applied = 0;
    var addedInvoiceCount = 0;
    var visibleInvoices;
    if (!elements.paymentAllocationManager) { return; }
    elements.paymentAllocationManager.hidden = !manager.isOpen;
    elements.paymentAllocationInvoicePicker.hidden = !manager.isOpen || !manager.isPickerOpen;
    if (!manager.isOpen) { return; }
    elements.paymentAllocationManagerError.hidden = !manager.error;
    elements.paymentAllocationManagerError.textContent = manager.error || "";
    elements.paymentAllocationInvoicePickerError.hidden = !manager.pickerError;
    elements.paymentAllocationInvoicePickerError.textContent = manager.pickerError || "";
    manager.invoices.forEach(function (invoice) { var id = String(invoice.id); var amount = roundCurrency(Number(manager.amounts[id]) || 0); if (!Object.prototype.hasOwnProperty.call(manager.unlinkedAmounts, id)) { applied += amount; } if (Object.prototype.hasOwnProperty.call(manager.newInvoiceIds, id) && amount > 0) { addedInvoiceCount += 1; } });
    visibleInvoices = manager.invoices.filter(function (invoice) { return invoiceMatchesPaymentAllocationQuery(invoice, manager.tableQuery); });
    elements.paymentAllocationManagerList.innerHTML = manager.isLoading ? '<tr><td colspan="3">Loading allocations...</td></tr>' : visibleInvoices.map(function (invoice) {
      var id = String(invoice.id); var amount = roundCurrency(Number(manager.amounts[id]) || 0); var isPendingUnlink = Object.prototype.hasOwnProperty.call(manager.unlinkedAmounts, id); var isNewInvoice = Object.prototype.hasOwnProperty.call(manager.newInvoiceIds, id); var rowClass = isPendingUnlink ? 'is-pending-unlink' : isNewInvoice ? 'is-new-allocation' : '';
      return '<tr class="' + rowClass + '"><td>' + helpers.escapeHtml(helpers.getInvoiceDisplayNumber(invoice, FIELD_CANDIDATES)) + '</td><td class="numeric-cell"><input type="number" min="0" step="0.01" data-payment-manager-amount="' + helpers.escapeHtml(id) + '" value="' + helpers.escapeHtml(String(amount)) + '"' + (isPendingUnlink ? ' disabled' : '') + '></td><td class="payment-allocation-manager-action"><button class="button compact-action-button payment-allocation-manager-unlink' + (isPendingUnlink ? ' is-restore' : isNewInvoice ? ' is-remove-new' : '') + '" type="button" ' + (isPendingUnlink ? 'data-payment-manager-restore' : isNewInvoice ? 'data-payment-manager-remove-new' : 'data-payment-manager-unlink') + '="' + helpers.escapeHtml(id) + '">' + (isPendingUnlink ? 'Restore' : isNewInvoice ? 'Remove' : 'Unlink') + '</button></td></tr>';
    }).join("") || '<tr><td colspan="3">' + (manager.tableQuery ? 'No allocated invoices match this search.' : 'No invoices allocated. Use Add invoice to add one.') + '</td></tr>';
    elements.paymentAllocationManagerResults.innerHTML = manager.searchResults.map(function (invoice) { return '<div class="payment-allocation-manager-result"><span title="' + helpers.escapeHtml(helpers.getInvoiceDisplayNumber(invoice, FIELD_CANDIDATES)) + '">' + helpers.escapeHtml(helpers.getInvoiceDisplayNumber(invoice, FIELD_CANDIDATES)) + '</span><button class="button secondary compact-action-button" type="button" data-payment-manager-add="' + helpers.escapeHtml(invoice.id) + '">Add</button></div>'; }).join("") || (elements.paymentAllocationManagerSearch.value.trim() ? '<p class="empty-state">No invoices found.</p>' : '<p class="empty-state">Start typing to find an invoice.</p>');
    elements.paymentAllocationManagerTotal.textContent = "Applied: " + helpers.formatCurrency(applied);
    elements.paymentAllocationManagerRemaining.textContent = "Unapplied: " + helpers.formatCurrency(Math.max(0, manager.paymentAmount - applied));
    elements.paymentAllocationManagerAddedCount.textContent = "Invoices to add: " + String(addedInvoiceCount);
    elements.paymentAllocationManagerSave.disabled = manager.isLoading || manager.isSaving;
  }

  function onPaymentAllocationManagerAmountChange(event) { var id = event.target.getAttribute("data-payment-manager-amount"); if (id) { state.paymentAllocationManager.amounts[id] = Math.max(0, roundCurrency(Number(event.target.value) || 0)); renderPaymentAllocationManager(); } }
  function onPaymentAllocationManagerRemoveClick(event) { var id = event.target.getAttribute("data-payment-manager-unlink"); var restoreId = event.target.getAttribute("data-payment-manager-restore"); var removeNewId = event.target.getAttribute("data-payment-manager-remove-new"); var manager = state.paymentAllocationManager; if (id) { manager.unlinkedAmounts[id] = manager.amounts[id]; renderPaymentAllocationManager(); } else if (restoreId) { delete manager.unlinkedAmounts[restoreId]; renderPaymentAllocationManager(); } else if (removeNewId) { manager.invoices = manager.invoices.filter(function (invoice) { return String(invoice.id) !== String(removeNewId); }); delete manager.amounts[removeNewId]; delete manager.newInvoiceIds[removeNewId]; renderPaymentAllocationManager(); } }
  function invoiceMatchesPaymentAllocationQuery(invoice, query) { var text = [helpers.getInvoiceDisplayNumber(invoice, FIELD_CANDIDATES), helpers.getCandidateValue(invoice, FIELD_CANDIDATES.invoice.number), invoice.Name, invoice.Invoice_Number].join(" "); return !String(query || "").trim() || helpers.matchesText(text, query); }
  function filterPaymentAllocationManagerTable() { state.paymentAllocationManager.tableQuery = String(elements.paymentAllocationManagerFilter.value || "").trim(); renderPaymentAllocationManager(); }
  function openPaymentAllocationInvoicePicker() { state.paymentAllocationManager.isPickerOpen = true; state.paymentAllocationManager.searchResults = []; state.paymentAllocationManager.pickerError = ""; state.paymentAllocationManager.searchRequestId += 1; renderPaymentAllocationManager(); window.setTimeout(function () { elements.paymentAllocationManagerSearch.focus(); }, 0); }
  function closePaymentAllocationInvoicePicker() { state.paymentAllocationManager.isPickerOpen = false; state.paymentAllocationManager.searchResults = []; state.paymentAllocationManager.pickerError = ""; state.paymentAllocationManager.searchRequestId += 1; elements.paymentAllocationManagerSearch.value = ""; renderPaymentAllocationManager(); }
  async function searchPaymentAllocationManagerInvoices() { var manager = state.paymentAllocationManager; var query = String(elements.paymentAllocationManagerSearch.value || "").trim(); var localMatches; var remoteBatches; var searchError = null; var requestId = manager.searchRequestId + 1; manager.searchRequestId = requestId; manager.pickerError = ""; if (!query) { manager.searchResults = []; renderPaymentAllocationManager(); return; } localMatches = state.records.invoices.filter(function (invoice) { return invoiceMatchesPaymentAllocationQuery(invoice, query); }); remoteBatches = await Promise.all([crm.searchRecord(MODULES.invoices, "(Name:starts_with:" + helpers.escapeCriteriaValue(query) + ")").catch(function (error) { searchError = error; return []; }), crm.searchWord(MODULES.invoices, query).catch(function (error) { searchError = searchError || error; return []; })]); if (requestId !== manager.searchRequestId) { return; } manager.searchResults = localMatches.concat(remoteBatches[0], remoteBatches[1]).filter(function (invoice, index, records) { return records.findIndex(function (record) { return String(record.id) === String(invoice.id); }) === index; }).filter(function (invoice) { return !manager.invoices.some(function (allocated) { return String(allocated.id) === String(invoice.id); }); }); if (!manager.searchResults.length && searchError) { manager.pickerError = "Could not search invoices. Try a different invoice number or name."; } renderPaymentAllocationManager(); }
  function addPaymentAllocationManagerInvoice(event) { var id = event.target.getAttribute("data-payment-manager-add"); var manager = state.paymentAllocationManager; var invoice = manager.searchResults.find(function (record) { return String(record.id) === String(id); }); if (invoice && !manager.invoices.some(function (record) { return String(record.id) === String(id); })) { manager.invoices.push(invoice); manager.amounts[id] = Math.max(0, roundCurrency(helpers.getInvoicePendingAmount(invoice, FIELD_CANDIDATES))); manager.newInvoiceIds[id] = true; manager.searchResults = []; manager.isPickerOpen = false; elements.paymentAllocationManagerSearch.value = ""; renderPaymentAllocationManager(); } }
  function renderPaymentAllocationFeedback() { var feedback = state.paymentAllocationFeedback; if (!elements.paymentAllocationFeedbackPopup) { return; } elements.paymentAllocationFeedbackPopup.hidden = !feedback.isOpen; if (!feedback.isOpen) { return; } elements.paymentAllocationFeedbackPopup.classList.toggle("is-success", feedback.mode === "success"); elements.paymentAllocationFeedbackPopup.classList.toggle("is-error", feedback.mode === "error"); elements.paymentAllocationFeedbackSpinner.hidden = feedback.mode !== "loading"; elements.paymentAllocationFeedbackEyebrow.textContent = feedback.mode === "success" ? "Completed" : feedback.mode === "error" ? "Could not save" : "Saving allocations"; elements.paymentAllocationFeedbackTitle.textContent = feedback.mode === "success" ? "Allocations saved" : feedback.mode === "error" ? "Allocations were not saved" : "Saving changes..."; elements.paymentAllocationFeedbackMessage.textContent = feedback.message; elements.paymentAllocationFeedbackClose.hidden = feedback.mode === "loading"; }
  function showPaymentAllocationFeedback(mode, message) { state.paymentAllocationFeedback.isOpen = true; state.paymentAllocationFeedback.mode = mode; state.paymentAllocationFeedback.message = message; renderPaymentAllocationFeedback(); }
  function closePaymentAllocationFeedback() { if (state.paymentAllocationFeedback.mode === "loading") { return; } state.paymentAllocationFeedback = { isOpen: false, mode: "loading", message: "" }; renderPaymentAllocationFeedback(); }
  async function savePaymentAllocationManager() { var manager = state.paymentAllocationManager; var allocations = {}; var pendingUnlinkInvoiceIds = Object.keys(manager.unlinkedAmounts); var result; var liveAllocations; var stillLinkedInvoiceIds; if (manager.isSaving) { return; } manager.invoices.forEach(function (invoice) { var id = String(invoice.id); allocations[invoice.id] = Object.prototype.hasOwnProperty.call(manager.unlinkedAmounts, id) ? 0 : roundCurrency(Number(manager.amounts[id]) || 0); }); manager.isSaving = true; manager.error = ""; showPaymentAllocationFeedback("loading", "Updating allocations and recalculating related invoices and settlements."); renderPaymentAllocationManager(); try { var response = await crm.executeFunction(MANAGE_SUPPLIER_PAYMENT_ALLOCATIONS_FUNCTION, { supplierPaymentId: manager.paymentId, allocationsDataString: JSON.stringify({ allocations: allocations }) }); result = getFunctionOutputObject(response) || getFunctionResponseResult(response); if (result && (result.error || result.success === false)) { throw new Error(result.message || "Could not update allocations."); } if (pendingUnlinkInvoiceIds.length) { liveAllocations = await crm.searchRecord(MODULES.payAllocations, "(Supplier_Payment:equals:" + manager.paymentId + ")"); stillLinkedInvoiceIds = (liveAllocations || []).map(function (allocation) { return String(helpers.getLookupId(allocation.Supplier_Invoice) || ""); }).filter(function (invoiceId) { return pendingUnlinkInvoiceIds.indexOf(invoiceId) !== -1; }); if (stillLinkedInvoiceIds.length) { throw new Error("Zoho did not confirm removal of " + String(stillLinkedInvoiceIds.length) + " allocation(s). The changes were not treated as saved."); } } await refreshInvoicesAndPaymentsAfterSupplierPayment(); renderer.showNotice("Payment allocations and balances were recalculated.", { tone: "success" }); closePaymentAllocationManager(); showPaymentAllocationFeedback("success", result && result.message || "Allocations, invoice balances and settlement totals were updated successfully."); } catch (error) { debugError("savePaymentAllocationManager failed", error, { paymentId: manager.paymentId, requestedAllocations: allocations, pendingUnlinkInvoiceIds: pendingUnlinkInvoiceIds, functionResult: result || null }); manager.isSaving = false; manager.error = ""; renderPaymentAllocationManager(); showPaymentAllocationFeedback("error", error.message || "Could not update allocations."); } }

  function renderPaymentUndoConfirmation() {
    var undo = state.paymentUndo;
    var invoiceNames;
    var isResult = undo.mode === "success" || undo.mode === "error";

    if (!elements.paymentUndoConfirmationPopup) {
      return;
    }

    elements.paymentUndoConfirmationPopup.hidden = !undo.isOpen;
    if (!undo.isOpen) {
      return;
    }

    elements.paymentUndoConfirmationPopup.classList.toggle("is-loading", undo.mode === "loading");
    elements.paymentUndoConfirmationPopup.classList.toggle("is-success", undo.mode === "success");
    elements.paymentUndoConfirmationPopup.classList.toggle("is-error", undo.mode === "error");
    elements.paymentUndoConfirmationEyebrow.textContent = undo.mode === "success"
      ? "Completed"
      : undo.mode === "error"
      ? "Undo failed"
      : undo.mode === "loading"
      ? "Processing"
      : "Destructive action";
    elements.paymentUndoConfirmationTitle.textContent = undo.mode === "success"
      ? "Payment undone"
      : undo.mode === "error"
      ? "Payment could not be fully undone"
      : undo.mode === "loading"
      ? "Undoing payment..."
      : "Undo payment?";

    if (isResult) {
      elements.paymentUndoConfirmationCopy.textContent = undo.resultMessage;
      elements.paymentUndoConfirmationList.innerHTML = "";
    } else if (undo.mode === "loading") {
      elements.paymentUndoConfirmationCopy.innerHTML = '<span class="payment-undo-spinner" aria-hidden="true"></span>Undoing payment and recalculating related invoices...';
      elements.paymentUndoConfirmationList.innerHTML = "";
    } else if (undo.isLoading) {
      elements.paymentUndoConfirmationCopy.textContent = "Checking the payment allocations and affected invoices...";
      elements.paymentUndoConfirmationList.innerHTML = "";
    } else if (!undo.allocations.length) {
      elements.paymentUndoConfirmationCopy.textContent = "No payment allocations are currently linked to this payment. Confirming will permanently remove only the payment record.";
      elements.paymentUndoConfirmationList.innerHTML = "";
    } else {
      invoiceNames = helpers.uniqueNonEmpty(undo.allocations.map(function (allocation) {
        return helpers.getLookupName(allocation.Supplier_Invoice) || allocation.Name || "Related invoice";
      }));
      elements.paymentUndoConfirmationCopy.textContent = "This permanently removes " + String(undo.allocations.length) + " payment allocation(s), restores the balances and payment status of " + String(invoiceNames.length) + " related invoice(s), and recalculates the affected settlement totals.";
      elements.paymentUndoConfirmationList.innerHTML = invoiceNames.map(function (invoiceName) {
        return '<span>' + helpers.escapeHtml(invoiceName) + "</span>";
      }).join("");
    }

    elements.paymentUndoConfirmationCancel.hidden = Boolean(isResult || undo.mode === "loading");
    elements.paymentUndoConfirmationConfirm.hidden = Boolean(isResult || undo.mode === "loading");
    elements.paymentUndoConfirmationClose.hidden = !isResult;
    elements.paymentUndoConfirmationCancel.disabled = Boolean(undo.isBusy);
    elements.paymentUndoConfirmationConfirm.disabled = Boolean(undo.isLoading || undo.isBusy);
    elements.paymentUndoConfirmationConfirm.textContent = "Confirm undo";
  }

  function closePaymentUndoConfirmation() {
    if (state.paymentUndo.isBusy) {
      return;
    }

    state.paymentUndo.isOpen = false;
    state.paymentUndo.isLoading = false;
    state.paymentUndo.paymentId = "";
    state.paymentUndo.allocations = [];
    state.paymentUndo.mode = "confirmation";
    state.paymentUndo.resultMessage = "";
    renderPaymentUndoConfirmation();
  }

  async function openPaymentUndoConfirmation() {
    var paymentId = String(state.views.payments.selectedId || "");
    var allocations = [];

    if (!paymentId) {
      renderer.showError("Select a payment first.");
      return;
    }

    state.paymentUndo.isOpen = true;
    state.paymentUndo.isLoading = true;
    state.paymentUndo.isBusy = false;
    state.paymentUndo.mode = "confirmation";
    state.paymentUndo.paymentId = paymentId;
    state.paymentUndo.allocations = [];
    state.paymentUndo.resultMessage = "";
    renderPaymentUndoConfirmation();

    try {
      allocations = await crm.searchRecord(MODULES.payAllocations, "(Supplier_Payment:equals:" + paymentId + ")");
    } catch (error) {
      debugError("load payment allocations for undo confirmation failed", error, { paymentId: paymentId });
      allocations = getSelectedPaymentAllocations(paymentId);
    }

    if (state.paymentUndo.paymentId !== paymentId) {
      return;
    }

    state.paymentUndo.allocations = allocations;
    state.paymentUndo.isLoading = false;
    renderPaymentUndoConfirmation();
  }

  async function onSelectedPaymentDeleteClick() {
    var paymentId = state.views.payments.selectedId;
    var relatedAllocations;
    var liveAllocations;
    var allocationsToDelete;
    var relatedSettlementIds = [];
    var relatedInvoiceIds = [];
    var payment;
    var accountingEntry;
    var deletedAllocationCount = 0;
    var undo = state.paymentUndo;

    if (!paymentId || !undo.isOpen || undo.paymentId !== String(paymentId) || undo.isLoading || undo.isBusy) {
      renderer.showError("Select a payment first.");
      return;
    }

    try {
      payment = state.records.payments.find(function (record) {
        return String(record.id) === String(paymentId);
      }) || await crm.getRecord(MODULES.payments, paymentId);

      if (isPaymentAllocationEditingLocked(payment)) {
        throw new Error("This payment cannot be undone because it is reconciled, cancelled, or already exported to accounting. Create a reversal instead.");
      }

      accountingEntry = await getPaymentAccountingEntryForAllocationEdit(paymentId);
      if (isPostedAccountingEntry(accountingEntry)) {
        throw new Error("This payment cannot be undone because its accounting entry is posted or reconciled. Create a reversal instead.");
      }

      // Keep the allocation snapshot from when the warning was opened.  An
      // earlier attempt can have removed allocations before failing later in
      // the rollback; the snapshot is still needed to restore those invoices.
      relatedAllocations = undo.allocations.slice();
      try {
        liveAllocations = await crm.searchRecord(MODULES.payAllocations, "(Supplier_Payment:equals:" + paymentId + ")");
      } catch (allocationReloadError) {
        debugError("reload payment allocations before undo failed", allocationReloadError, { paymentId: paymentId });
        liveAllocations = getSelectedPaymentAllocations(paymentId);
      }
      liveAllocations = Array.isArray(liveAllocations) ? liveAllocations : [];
      if (!relatedAllocations.length) {
        relatedAllocations = liveAllocations.slice();
      }
      allocationsToDelete = liveAllocations;

      relatedInvoiceIds = helpers.uniqueNonEmpty(relatedAllocations.map(function (allocation) {
        return helpers.getLookupId(allocation.Supplier_Invoice);
      }));
      relatedSettlementIds = getUniqueSettlementIdsFromAllocations(relatedAllocations);
      undo.isBusy = true;
      undo.mode = "loading";
      renderPaymentUndoConfirmation();
      renderer.showError("");
      renderAll();

      for (var allocationIndex = 0; allocationIndex < allocationsToDelete.length; allocationIndex += 1) {
        var allocation = allocationsToDelete[allocationIndex];
        var allocationId = String(allocation && allocation.id || "");

        if (!allocationId) {
          throw new Error("A payment allocation did not include a Zoho record ID, so it could not be removed safely.");
        }
        assertCrmMutationSucceeded(
          await crm.deleteRecord(MODULES.payAllocations, allocationId),
          "Zoho CRM did not confirm removal of payment allocation " + (allocation.Name || allocationId) + "."
        );
        deletedAllocationCount += 1;
      }

      state.loaded.payAllocations = false;
      state.records.payAllocations = [];
      resetPaymentRelationshipIndexes();
      await ensurePayAllocationsLoaded();

      for (var invoiceIndex = 0; invoiceIndex < relatedInvoiceIds.length; invoiceIndex += 1) {
        var invoiceId = String(relatedInvoiceIds[invoiceIndex]);
        var invoice = await crm.getRecord(MODULES.invoices, invoiceId);
        var previousStatus = relatedAllocations.map(function (allocation) {
          return String(helpers.getLookupId(allocation.Supplier_Invoice) || "") === invoiceId
            ? String(allocation.Invoice_Status || "").trim()
            : "";
        }).find(function (status) {
          return status && status.toLowerCase() !== "paid" && status.toLowerCase() !== "partially paid";
        }) || "Approved";
        var remainingPaidAmount = roundCurrency(state.records.payAllocations.filter(function (allocation) {
          return String(helpers.getLookupId(allocation.Supplier_Invoice) || "") === invoiceId;
        }).reduce(function (total, allocation) {
          return total + (Number(allocation.Allocated_Amount) || 0);
        }, 0));
        var invoiceTotal = roundCurrency(helpers.getInvoiceTotalAmount(invoice, FIELD_CANDIDATES));
        var invoicePayload = {
          Amount_Paid: remainingPaidAmount,
          Unpaid_Invoiced_Amount: Math.max(0, roundCurrency(invoiceTotal - remainingPaidAmount))
        };

        if (remainingPaidAmount >= invoiceTotal && invoiceTotal > 0) {
          invoicePayload.Status = "Paid";
        } else if (remainingPaidAmount > 0) {
          invoicePayload.Status = "Partially Paid";
        } else {
          invoicePayload.Status = previousStatus;
        }

        assertCrmMutationSucceeded(
          await crm.updateRecord(MODULES.invoices, invoiceId, invoicePayload),
          "Zoho CRM did not confirm the invoice balance rollback."
        );
        if (getInvoiceSettlementId(invoice)) {
          relatedSettlementIds.push(getInvoiceSettlementId(invoice));
        }
        delete state.invoiceAllocationsByInvoiceId[invoiceId];
      }

      assertCrmMutationSucceeded(
        await crm.deleteRecord(MODULES.payments, paymentId),
        "Zoho CRM did not confirm deletion of payment " + paymentId + "."
      );

      invalidateInvoiceCreateSettlementCache();
      await recalculateSettlementTotalsForSettlementIds(helpers.uniqueNonEmpty(relatedSettlementIds));
      state.views.payments.selectedId = "";
      await refreshInvoicesAndPaymentsAfterSupplierPayment();
      undo.isBusy = false;
      undo.mode = "success";
      undo.resultMessage = "Payment undone successfully. " + String(deletedAllocationCount) + " allocation(s) were removed and the related invoice balances were restored.";
      renderPaymentUndoConfirmation();
      renderAll();
    } catch (error) {
      debugError("onSelectedPaymentDeleteClick failed", error, {
        paymentId: paymentId,
        settlementIds: relatedSettlementIds,
        invoiceIds: relatedInvoiceIds,
        deletedAllocationCount: deletedAllocationCount
      });
      state.views.payments.selectedId = paymentId;
      undo.isBusy = false;
      undo.mode = "error";
      undo.resultMessage = "The payment could not be fully undone" +
        (deletedAllocationCount ? " after removing " + String(deletedAllocationCount) + " allocation(s)" : "") +
        ". " + (error.message || "Review its allocations and related invoice balances before trying again.");
      renderPaymentUndoConfirmation();
      renderAll();
      renderer.showNotice("");
    } finally {
      renderer.setLoading(false);
    }
  }

  function resolveBankExportSupplierPaymentAccount(allocation, supplierId) {
    var allocationAccountId = helpers.getLookupId(allocation && allocation.Payment_Account);
    var supplierOwnedAccounts;
    var completeOwnedAccounts;
    var accountRecord = null;

    if (allocationAccountId) {
      accountRecord = getPaymentAccountRecordById(allocationAccountId);
    }

    if (accountRecord) {
      return {
        accountRecord: accountRecord,
        hasConflict: false
      };
    }

    supplierOwnedAccounts = getOwnedPaymentAccountsForSupplierId(supplierId);
    completeOwnedAccounts = supplierOwnedAccounts.filter(function (account) {
      return getPaymentAccountIbanValue(account) || getPaymentAccountBeneficiaryName(account);
    });

    if (completeOwnedAccounts.length) {
      accountRecord = completeOwnedAccounts[0];
    } else if (supplierOwnedAccounts.length) {
      accountRecord = supplierOwnedAccounts[0];
    }

    return {
      accountRecord: accountRecord,
      hasConflict: !allocationAccountId && supplierOwnedAccounts.length > 1
    };
  }

  function buildBankExportInvoiceRowsForPayment(payment) {
    var paymentId = String(payment && payment.id || "");
    var allocations = state.records.payAllocations.filter(function (allocation) {
      return helpers.getLookupId(allocation.Supplier_Payment) === paymentId;
    });
    var invoicesById = {};

    state.records.invoices.forEach(function (invoice) {
      invoicesById[String(invoice && invoice.id || "")] = invoice;
    });

    return allocations.map(function (allocation) {
      var supplierId = helpers.getLookupId(allocation.Supplier);
      var supplierName = allocation.Supplier_Name || helpers.getLookupName(allocation.Supplier) || "Unknown supplier";
      var invoiceId = helpers.getLookupId(allocation.Supplier_Invoice);
      var invoiceRecord = invoiceId ? invoicesById[invoiceId] : null;
      var accountResolution;
      var accountRecord;
      var iban;
      var beneficiaryName;
      var invoiceNumber;
      var bookingName;
      var mfspReference;
      var amount;

      if (!supplierId) {
        debugWarn("bank export allocation skipped without supplier", {
          paymentId: paymentId,
          allocationId: String(allocation.id || ""),
          allocation: allocation
        });
        return null;
      }

      accountResolution = resolveBankExportSupplierPaymentAccount(allocation, supplierId);
      accountRecord = accountResolution.accountRecord;
      iban = getPaymentAccountIbanValue(accountRecord);
      beneficiaryName = getPaymentAccountBeneficiaryName(accountRecord);
      invoiceNumber = invoiceRecord
        ? helpers.getInvoiceDisplayNumber(invoiceRecord, FIELD_CANDIDATES)
        : helpers.getLookupName(allocation.Supplier_Invoice) || allocation.Name || "";
      bookingName = invoiceRecord
        ? getBookingNameFromInvoice(invoiceRecord)
        : helpers.getLookupName(allocation.Booking) || "";
      mfspReference = String(
        allocation.MFSP_Reference ||
        (invoiceRecord && getMfspFromInvoice(invoiceRecord)) ||
        ""
      ).trim();
      amount = roundCurrency(Number(allocation.Allocated_Amount || 0) || 0);

      if (!iban || !beneficiaryName) {
        debugWarn("bank export invoice row missing bank data", {
          paymentId: paymentId,
          supplierId: supplierId,
          supplierName: supplierName,
          invoiceId: invoiceId,
          invoiceNumber: invoiceNumber,
          allocationId: String(allocation.id || ""),
          selectedAccount: summarizePaymentAccountForDebug(accountRecord),
          allocationPaymentAccountId: helpers.getLookupId(allocation.Payment_Account),
          ownedAccounts: getOwnedPaymentAccountsForSupplierId(supplierId).map(summarizePaymentAccountForDebug)
        });
      }

      return {
        supplierId: supplierId,
        supplierName: supplierName,
        invoiceId: invoiceId,
        invoiceNumber: invoiceNumber,
        bookingName: bookingName,
        mfspReference: mfspReference,
        paymentAccountId: accountRecord && accountRecord.id ? String(accountRecord.id) : "",
        hasPaymentAccountConflict: accountResolution.hasConflict,
        iban: iban,
        beneficiaryName: beneficiaryName,
        amount: amount
      };
    }).filter(Boolean).sort(function (left, right) {
      var supplierComparison = String(left.supplierName || "").localeCompare(String(right.supplierName || ""), "en", {
        sensitivity: "base"
      });

      if (supplierComparison !== 0) {
        return supplierComparison;
      }

      return String(left.invoiceNumber || "").localeCompare(String(right.invoiceNumber || ""), "en", {
        sensitivity: "base"
      });
    });
  }

  function buildBankExportRowsForPayment(payment) {
    var paymentId = String(payment && payment.id || "");
    var allocations = state.records.payAllocations.filter(function (allocation) {
      return helpers.getLookupId(allocation.Supplier_Payment) === paymentId;
    });
    var groupedBySupplierId = {};

    allocations.forEach(function (allocation) {
      var supplierId = helpers.getLookupId(allocation.Supplier);
      var supplierName = allocation.Supplier_Name || helpers.getLookupName(allocation.Supplier) || "Unknown supplier";
      var bucket;

      if (!supplierId) {
        debugWarn("bank export allocation skipped without supplier", {
          paymentId: paymentId,
          allocationId: String(allocation.id || ""),
          allocation: allocation
        });
        return;
      }

      if (!groupedBySupplierId[supplierId]) {
        groupedBySupplierId[supplierId] = {
          supplierId: supplierId,
          supplierName: supplierName,
          totalAmount: 0
        };
      }

      bucket = groupedBySupplierId[supplierId];
      bucket.totalAmount = roundCurrency(bucket.totalAmount + (Number(allocation.Allocated_Amount || 0) || 0));
    });

    return Object.keys(groupedBySupplierId).map(function (supplierId) {
      var row = groupedBySupplierId[supplierId];
      var supplierOwnedAccounts;
      var accountRecord;
      var completeOwnedAccounts;
      var iban;
      var beneficiaryName;

      supplierOwnedAccounts = getOwnedPaymentAccountsForSupplierId(row.supplierId);
      completeOwnedAccounts = supplierOwnedAccounts.filter(function (account) {
        return getPaymentAccountIbanValue(account) || getPaymentAccountBeneficiaryName(account);
      });

      if (completeOwnedAccounts.length) {
        accountRecord = completeOwnedAccounts[0];
      } else if (supplierOwnedAccounts.length) {
        accountRecord = supplierOwnedAccounts[0];
      }

      row.paymentAccountId = accountRecord && accountRecord.id ? String(accountRecord.id) : "";
      row.hasPaymentAccountConflict = supplierOwnedAccounts.length > 1;
      iban = getPaymentAccountIbanValue(accountRecord);
      beneficiaryName = getPaymentAccountBeneficiaryName(accountRecord);

      if (!iban || !beneficiaryName) {
        debugWarn("bank export supplier missing bank data", {
          paymentId: paymentId,
          supplierId: row.supplierId,
          supplierName: row.supplierName,
          selectedAccount: summarizePaymentAccountForDebug(accountRecord),
          ownedAccounts: supplierOwnedAccounts.map(summarizePaymentAccountForDebug)
        });
      }

      return {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        paymentAccountId: row.paymentAccountId,
        hasPaymentAccountConflict: row.hasPaymentAccountConflict,
        iban: iban,
        beneficiaryName: beneficiaryName,
        totalAmount: row.totalAmount
      };
    }).sort(function (left, right) {
      return String(left.supplierName || "").localeCompare(String(right.supplierName || ""), "en", {
        sensitivity: "base"
      });
    });
  }

  function buildSpreadsheetWorkbookXml(worksheetName, headers, rows) {
    var xmlRows = [];

    xmlRows.push("<Row>" + headers.map(function (header) {
      return '<Cell><Data ss:Type="String">' + escapeXml(header) + "</Data></Cell>";
    }).join("") + "</Row>");

    rows.forEach(function (row) {
      xmlRows.push("<Row>" + row.map(function (cell) {
        var normalizedCell = cell;
        var cellValue = "";
        var cellType = "String";

        if (normalizedCell && typeof normalizedCell === "object" && !Array.isArray(normalizedCell)) {
          cellValue = normalizedCell.value == null ? "" : normalizedCell.value;
          cellType = normalizedCell.type || (typeof cellValue === "number" ? "Number" : "String");
        } else {
          cellValue = normalizedCell == null ? "" : normalizedCell;
          cellType = typeof cellValue === "number" ? "Number" : "String";
        }

        return '<Cell><Data ss:Type="' + escapeXml(cellType) + '">' + escapeXml(cellValue) + "</Data></Cell>";
      }).join("") + "</Row>");
    });

    return [
      '<?xml version="1.0"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
      ' xmlns:o="urn:schemas-microsoft-com:office:office"',
      ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
      ' xmlns:html="http://www.w3.org/TR/REC-html40">',
      '  <Worksheet ss:Name="' + escapeXml(worksheetName || "Sheet1") + '">',
      '    <Table>',
      xmlRows.join(""),
      "    </Table>",
      "  </Worksheet>",
      "</Workbook>"
    ].join("");
  }

  function buildBankExportWorkbookXml(headers, rows) {
    return buildSpreadsheetWorkbookXml("Payments", headers, rows.map(function (row) {
      return row.map(function (cell, index) {
        return index === 1 && cell !== ""
          ? { value: cell, type: "Number" }
          : { value: cell, type: "String" };
      });
    }));
  }

  async function onSelectedPaymentExportBankClick() {
    var paymentId = state.views.payments.selectedId;
    var payment;
    var headers;
    var supplierRows;
    var conflictRows;
    var missingRows;
    var warningMessages;
    var workbookRows;
    var workbookXml;
    var fileName;

    if (!paymentId) {
      renderer.showError("Select a payment first.");
      return;
    }

    payment = state.records.payments.find(function (item) {
      return String(item && item.id || "") === String(paymentId);
    }) || null;

    if (!payment) {
      renderer.showError("Select a payment first.");
      return;
    }

    renderer.showError("");
    renderer.showNotice("Preparing bank export...", {
      isLoading: true
    });

    try {
      if (!state.loaded.paymentAccounts) {
        await ensurePaymentAccountsLoaded();
      }

      supplierRows = buildBankExportRowsForPayment(payment);

      if (!supplierRows.length) {
        throw new Error("This payment has no supplier totals available to export.");
      }

      conflictRows = supplierRows.filter(function (row) {
        return row.hasPaymentAccountConflict;
      });
      missingRows = supplierRows.filter(function (row) {
        return !row.iban || !row.beneficiaryName;
      });
      warningMessages = [];

      if (conflictRows.length) {
        warningMessages.push("multiple Payment Accounts detected for: " + conflictRows.map(function (row) {
          return row.supplierName;
        }).join(", "));
      }

      if (missingRows.length) {
        warningMessages.push("missing IBAN or beneficiary name for: " + missingRows.map(function (row) {
          return row.supplierName;
        }).join(", "));
      }

      headers = [
        "Cuenta beneficiario",
        "Importe",
        "Nombre beneficiario",
        "Cuenta ordenante",
        "Detalle",
        "Fecha de vencimiento pagares",
        "Fecha emisiÃ³n",
        "Gastos",
        "NIF ordenante",
        "Nombre ordenante",
        "PropÃ³sito cheque",
        "Sufijo ordenante",
        "Urgencia"
      ];

      workbookRows = supplierRows.map(function (row) {
        return [
          row.iban,
          row.totalAmount.toFixed(2),
          row.beneficiaryName,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          ""
        ];
      });

      workbookXml = buildBankExportWorkbookXml(headers, workbookRows);
      fileName = sanitizeDownloadFileName((payment.Name || "payment") + "-bank-export") + ".xls";
      downloadFileFromText(fileName, "application/vnd.ms-excel;charset=utf-8", workbookXml);
      renderer.showNotice(
        warningMessages.length
          ? "Bank export generated with warnings: " + warningMessages.join(" | ") + "."
          : "Bank export generated successfully.",
        {
          tone: "success"
        }
      );
    } catch (error) {
      debugError("onSelectedPaymentExportBankClick failed", error, {
        paymentId: paymentId
      });
      renderer.showNotice("");
      renderer.showError(error.message || "Could not generate the bank export.");
    }
  }

  async function onSelectedPaymentExportBankByInvoiceClick() {
    var paymentId = state.views.payments.selectedId;
    var payment;
    var headers;
    var invoiceRows;
    var conflictRows;
    var missingRows;
    var warningMessages;
    var workbookRows;
    var workbookXml;
    var fileName;

    if (!paymentId) {
      renderer.showError("Select a payment first.");
      return;
    }

    payment = state.records.payments.find(function (item) {
      return String(item && item.id || "") === String(paymentId);
    }) || null;

    if (!payment) {
      renderer.showError("Select a payment first.");
      return;
    }

    renderer.showError("");
    renderer.showNotice("Preparing bank export by invoice...", {
      isLoading: true
    });

    try {
      if (!state.loaded.paymentAccounts) {
        await ensurePaymentAccountsLoaded();
      }

      invoiceRows = buildBankExportInvoiceRowsForPayment(payment);

      if (!invoiceRows.length) {
        throw new Error("This payment has no invoice allocations available to export.");
      }

      conflictRows = invoiceRows.filter(function (row) {
        return row.hasPaymentAccountConflict;
      });
      missingRows = invoiceRows.filter(function (row) {
        return !row.iban || !row.beneficiaryName;
      });
      warningMessages = [];

      if (conflictRows.length) {
        warningMessages.push("multiple Payment Accounts detected for: " + helpers.uniqueNonEmpty(conflictRows.map(function (row) {
          return row.supplierName;
        })).join(", "));
      }

      if (missingRows.length) {
        warningMessages.push("missing IBAN or beneficiary name for: " + helpers.uniqueNonEmpty(missingRows.map(function (row) {
          return row.supplierName + (row.invoiceNumber ? " (" + row.invoiceNumber + ")" : "");
        })).join(", "));
      }

      headers = [
        "Cuenta beneficiario",
        "Importe",
        "Nombre beneficiario",
        "Concepto",
        "Referencia beneficiario",
        "Detalle",
        "Fecha emisiÃ³n",
        "Gastos",
        "Nombre ordenante",
        "NIF ordenante",
        "PropÃ³sito cheque",
        "Sufijo ordenante",
        "Urgencia",
        "Cuenta ordenante",
        "Fecha vencimiento pagares"
      ];

      workbookRows = invoiceRows.map(function (row) {
        return [
          row.iban,
          row.amount.toFixed(2),
          row.beneficiaryName,
          row.mfspReference,
          row.bookingName,
          row.invoiceNumber,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          ""
        ];
      });

      workbookXml = buildBankExportWorkbookXml(headers, workbookRows);
      fileName = sanitizeDownloadFileName((payment.Name || "payment") + "-bank-export-by-invoice") + ".xls";
      downloadFileFromText(fileName, "application/vnd.ms-excel;charset=utf-8", workbookXml);
      renderer.showNotice(
        warningMessages.length
          ? "Bank export generated with warnings: " + warningMessages.join(" | ") + "."
          : "Bank export by invoice generated successfully.",
        {
          tone: "success"
        }
      );
    } catch (error) {
      debugError("onSelectedPaymentExportBankByInvoiceClick failed", error, {
        paymentId: paymentId
      });
      renderer.showNotice("");
      renderer.showError(error.message || "Could not generate the bank export by invoice.");
    }
  }

  function onInvoiceSortChange(sortKey) {
    var currentSort = state.views.invoices.sort || {};

    if (!sortKey) {
      return;
    }

    if (currentSort.key === sortKey) {
      currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      currentSort.key = sortKey;
      currentSort.direction = sortKey === "date" ? "desc" : "asc";
    }

    state.views.invoices.page = 1;
    if (state.currentTab === "invoices" && state.views.invoices.hasLoaded) {
      ensureInvoicesLoaded();
    } else {
      renderAll();
    }
  }

  function onAccountingEntriesSortChange(sortKey) {
    var currentSort = state.views.accountingEntries.sort || {};

    if (!sortKey) {
      return;
    }

    if (currentSort.key === sortKey) {
      currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      currentSort.key = sortKey;
      currentSort.direction = sortKey === "date" ? "desc" : "asc";
    }

    state.views.accountingEntries.sort = currentSort;
    state.views.accountingEntries.page = 1;

    if (state.currentTab === "accounting" && state.accountingTab === "entries" && state.views.accountingEntries.hasLoaded) {
      loadAccountingEntriesTabData();
    } else {
      renderAll();
    }
  }

  function onAccountingEntryLinesSortChange(sortKey) {
    var currentSort = state.views.accountingEntryLines.sort || {};

    if (!sortKey) {
      return;
    }

    if (currentSort.key === sortKey) {
      currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      currentSort.key = sortKey;
      currentSort.direction = sortKey === "date" ? "desc" : "asc";
    }

    state.views.accountingEntryLines.sort = currentSort;
    state.views.accountingEntryLines.page = 1;

    if (state.currentTab === "accounting" && state.accountingTab === "lines" && state.views.accountingEntryLines.hasLoaded) {
      loadAccountingEntryLinesTabData();
    } else {
      renderAll();
    }
  }

  function setSupplierInfoTab(tabName) {
    if (tabName !== "financial" && tabName !== "payment" && tabName !== "address") {
      state.supplierInfoTab = "basic";
    } else {
      state.supplierInfoTab = tabName;
    }

    renderAll();
  }

  function getSelectedSupplierEzusReference() {
    return String(
      state.supplier
        ? (helpers.getCandidateValue(state.supplier, FIELD_CANDIDATES.supplier.ezusReference) || "")
        : ""
    ).trim();
  }

  function onSeeSupplierInEzusClick() {
    var ezusReference = getSelectedSupplierEzusReference();
    var url;

    if (!state.supplierId) {
      renderer.showError("Load a supplier first.");
      return;
    }

    if (!ezusReference) {
      renderer.showError("This supplier does not have an Ezus Supplier API value.");
      return;
    }

    renderer.showError("");
    url = "https://pro.ezus.io/supplier?id=" + encodeURIComponent(ezusReference);
    global.open(url, "_blank", "noopener");
  }

  function onSeeSupplierInCrmClick() {
    var supplierId = String(state.supplierId || "").trim();
    var url;
    var openedWindow;

    if (!supplierId) {
      renderer.showError("Load a supplier first.");
      return;
    }

    renderer.showError("");
    url = "https://crm.zoho.eu/crm/org20093299576/tab/Vendors/" + encodeURIComponent(supplierId);

    openedWindow = global.open(url, "_blank", "noopener");

    if (!openedWindow) {
      renderer.showError("The supplier could not be opened in CRM.");
    }
  }

  async function onSyncSupplierWithEzusClick() {
    var response;
    var result;

    if (!state.supplierId) {
      renderer.showError("Load a supplier first.");
      return;
    }

    renderer.showError("");
    renderer.setLoading(true, "Syncing supplier from Ezus...");

    try {
      response = await crm.executeFunction(SYNC_SUPPLIER_FROM_EZUS_FUNCTION, {
        supplierId: state.supplierId
      });
      result = getFunctionResponseResult(response);

      if (result.success === false) {
        throw new Error(result.message || "Supplier sync from Ezus failed.");
      }

      state.supplier = await crm.getRecord(MODULES.suppliers, state.supplierId);

      if (state.supplier) {
        cacheSupplierLookup(state.supplier);
        elements.supplierSearch.value = getSupplierSearchDisplayValue(state.supplier);
      }

      renderAll();
      renderer.showNotice(result.message || "Supplier synced from Ezus.", {
        tone: "success"
      });
    } catch (error) {
      debugError("onSyncSupplierWithEzusClick failed", error, {
        functionName: SYNC_SUPPLIER_FROM_EZUS_FUNCTION,
        supplierId: state.supplierId
      });
      renderer.showNotice("");
      renderer.showError(error.message || "Could not sync the supplier from Ezus.");
      renderAll();
    } finally {
      renderer.setLoading(false);
    }
  }

  async function ensureTabDataLoaded(tabName) {
    var activePaymentsSection = normalizePaymentsSection(state.views.payments.section);
    var labelByTab = {
      payments: "Loading payments...",
      invoices: "Loading invoices...",
      accounting: "Loading accounting data..."
    };
    var shouldShowLoading = true;

    if (tabName === "payments" && activePaymentsSection === "accounts") {
      labelByTab.payments = "Loading payment accounts...";
    }

    if (!labelByTab[tabName]) {
      return;
    }

    if (tabName === "accounting" && state.accountingTab !== "accounts" && state.accountingTab !== "rules") {
      shouldShowLoading = false;
    }

    if (shouldShowLoading) {
      renderer.showNotice(labelByTab[tabName]);
      renderer.setLoading(true, labelByTab[tabName]);
      renderAll();
    }

    try {
      if (tabName === "invoices") {
        await loadInvoicesTabData();
      }

      if (tabName === "payments" && activePaymentsSection === "accounts") {
        await ensurePaymentAccountsLoaded();
        requestPaymentAccountsContextLoad();
      } else if (tabName === "payments" && !state.views.payments.hasLoaded) {
        state.views.payments.appliedFilters = cloneFilterState(state.views.payments.filters);
        await ensurePayAllocationsLoaded();
        await ensurePaymentsLoaded();
        state.views.payments.hasLoaded = true;
      }

      if (tabName === "accounting") {
        if (state.accountingTab === "accounts") {
          await ensureAccountingAccountsLoaded();
        } else if (state.accountingTab === "rules") {
          await ensureAccountingRulesLoaded();
        }
      }
    } catch (error) {
      renderer.showError(error.message || "Could not load data for that tab.");
    } finally {
      if (shouldShowLoading) {
        renderer.setLoading(false);
        renderer.showNotice("");
      }
    }
  }

  async function ensureBookingsLoaded() {
    if (state.loaded.bookings) {
      return;
    }

    if (bookingsLoadPromise) {
      return bookingsLoadPromise;
    }

    bookingsLoadPromise = (async function () {
      state.records.bookings = await loadModuleRecords(MODULES.bookings, BOOKING_FIELDS);
      state.loaded.bookings = true;
      rebuildBookingIndexes();
    }()).finally(function () {
      bookingsLoadPromise = null;
    });

    return bookingsLoadPromise;
  }

  async function ensureSettlementsLoaded() {
    if (state.loaded.settlements) {
      return;
    }

    if (settlementsLoadPromise) {
      return settlementsLoadPromise;
    }

    settlementsLoadPromise = (async function () {
      state.records.settlements = normalizeSettlements(await loadModuleRecords(MODULES.settlements, SETTLEMENT_FIELDS));
      state.loaded.settlements = true;
    }()).finally(function () {
      settlementsLoadPromise = null;
    });

    return settlementsLoadPromise;
  }

  async function ensureInvoicesLoaded() {
    if (state.loaded.invoices) {
      renderAll();
      return;
    }

    if (invoicesLoadPromise) {
      return invoicesLoadPromise;
    }

    invoicesLoadPromise = (async function () {
      var appliedFilters = cloneFilterState(state.views.invoices.appliedFilters || state.views.invoices.filters);
      var records;
      var whereClause;
      var orderByClause;

      appliedFilters.invoiceView = state.views.invoices.view || "open";
      whereClause = await buildInvoiceRemoteWhereClause(appliedFilters);
      orderByClause = await buildInvoiceRemoteOrderByClause(state.views.invoices.sort || {
        key: "date",
        direction: "desc"
      });

      records = await loadModuleRecords(MODULES.invoices, INVOICE_COQL_FIELDS, {
        whereClause: whereClause,
        orderByClause: orderByClause
      });
      state.records.invoices = sortRecordsByDateDesc(records, "Invoice_Date");
      state.views.invoices.hasMore = false;
      state.loaded.invoices = true;
      renderAll();
    }()).finally(function () {
      invoicesLoadPromise = null;
    });

    return invoicesLoadPromise;
  }

  async function ensurePaymentsLoaded() {
    if (state.loaded.payments) {
      renderAll();
      return;
    }

    if (paymentsLoadPromise) {
      return paymentsLoadPromise;
    }

    paymentsLoadPromise = (async function () {
      var appliedFilters = cloneFilterState(state.views.payments.appliedFilters || state.views.payments.filters);
      var records;

      if (!hasAnyLoadFilterValue(appliedFilters)) {
        state.records.payments = [];
        state.views.payments.hasMore = false;
        state.loaded.payments = true;
        rebuildPaymentAccountIndex();
        refreshPaymentAccountMetaIndex();
        renderAll();
        return;
      }

      await ensurePayAllocationsLoaded();
      // The widget connector rejects COQL for Supplier_Payments in this CRM.
      // Load the same complete dataset through the supported paginated endpoint;
      // buildPaymentsView applies the active filters locally.
      records = await loadRecordsByPagination(MODULES.payments);
      state.records.payments = sortRecordsByDateDesc(records, "Payment_Date");
      state.views.payments.hasMore = false;
      state.loaded.payments = true;
      rebuildPaymentAccountIndex();
      refreshPaymentAccountMetaIndex();
      renderAll();
    }()).finally(function () {
      paymentsLoadPromise = null;
    });

    return paymentsLoadPromise;
  }

  async function ensurePaymentsDatasetLoaded() {
    if (state.loaded.payments) {
      rebuildPaymentAccountIndex();
      refreshPaymentAccountMetaIndex();
      return;
    }

    if (paymentsDatasetLoadPromise) {
      return paymentsDatasetLoadPromise;
    }

    paymentsDatasetLoadPromise = (async function () {
      state.records.payments = sortRecordsByDateDesc(
        await loadRecordsByPagination(MODULES.payments),
        "Payment_Date"
      );
      state.loaded.payments = true;
      rebuildPaymentAccountIndex();
      refreshPaymentAccountMetaIndex();
      renderAll();
    }()).finally(function () {
      paymentsDatasetLoadPromise = null;
    });

    return paymentsDatasetLoadPromise;
  }

  async function ensurePayAllocationsLoaded() {
    if (state.loaded.payAllocations) {
      return;
    }

    if (payAllocationsLoadPromise) {
      return payAllocationsLoadPromise;
    }

    payAllocationsLoadPromise = (async function () {
      state.records.payAllocations = sortRecordsByDateDesc(
        // COQL for this custom module returns a syntax error in the widget
        // context, while pagination is supported and returns the full dataset.
        await loadRecordsByPagination(MODULES.payAllocations),
        "Allocation_Date"
      );
      state.loaded.payAllocations = true;
      rebuildPaymentContextIndexes();
      refreshPaymentAccountMetaIndex();

      if (state.supplierId && state.loaded.payments) {
        state.supplierPayments = getSupplierPaymentsFromLoadedRecords(state.supplierId);
      }
    }()).finally(function () {
      payAllocationsLoadPromise = null;
    });

    return payAllocationsLoadPromise;
  }

  async function ensurePaymentAccountsLoaded() {
    if (state.loaded.paymentAccounts) {
      return;
    }

    if (paymentAccountsLoadPromise) {
      return paymentAccountsLoadPromise;
    }

    paymentAccountsLoadPromise = (async function () {
      state.records.paymentAccounts = sortRecordsByName(
        await loadModuleRecords(MODULES.paymentAccounts, PAYMENT_ACCOUNT_FIELDS),
        FIELD_CANDIDATES.paymentAccount.name
      );
      state.loaded.paymentAccounts = true;
      refreshPaymentAccountMetaIndex();
    }()).finally(function () {
      paymentAccountsLoadPromise = null;
    });

    return paymentAccountsLoadPromise;
  }

  async function ensurePaymentAccountsContextLoaded() {
    if (refreshPaymentAccountMetaIndex()) {
      if (isPaymentAccountsSectionActive()) {
        renderAll();
      }
      return;
    }

    if (state.loaded.paymentAccountsContext) {
      return;
    }

    if (paymentAccountsContextLoadPromise) {
      return paymentAccountsContextLoadPromise;
    }

    paymentAccountsContextLoadPromise = (async function () {
      await ensurePayAllocationsLoaded();
      await ensurePaymentsDatasetLoaded();
      refreshPaymentAccountMetaIndex();
      if (isPaymentAccountsSectionActive()) {
        renderAll();
      }
    }()).finally(function () {
      paymentAccountsContextLoadPromise = null;
    });

    return paymentAccountsContextLoadPromise;
  }

  async function ensureAccountingEntriesLoaded() {
    if (state.loaded.accountingEntries) {
      return;
    }

    if (accountingEntriesLoadPromise) {
      return accountingEntriesLoadPromise;
    }

    accountingEntriesLoadPromise = (async function () {
      var appliedFilters = cloneFilterState(state.views.accountingEntries.appliedFilters || state.views.accountingEntries.filters);
      var remotePage = await loadCoqlPage(MODULES.accountingEntries, ACCOUNTING_ENTRY_FIELDS, {
        page: state.views.accountingEntries.page,
        perPage: state.views.accountingEntries.perPage,
        whereClause: await buildAccountingEntriesRemoteWhereClause(appliedFilters),
        orderByClause: await buildAccountingEntriesRemoteOrderByClause(state.views.accountingEntries.sort || {
          key: "date",
          direction: "desc"
        })
      });

      state.records.accountingEntries = remotePage.records;
      state.views.accountingEntries.page = remotePage.page;
      state.views.accountingEntries.hasMore = remotePage.hasMore;
      state.views.accountingEntries.pageSummary = buildRemotePageSummary(remotePage.page, remotePage.hasMore);
      state.views.accountingEntries.countLabel = remotePage.records.length + (remotePage.records.length === 1 ? " entry" : " entries");
      state.loaded.accountingEntries = true;
    }()).finally(function () {
      accountingEntriesLoadPromise = null;
    });

    return accountingEntriesLoadPromise;
  }

  async function ensureAccountingEntryLinesLoaded() {
    if (state.loaded.accountingEntryLines) {
      return;
    }

    if (accountingEntryLinesLoadPromise) {
      return accountingEntryLinesLoadPromise;
    }

    accountingEntryLinesLoadPromise = (async function () {
      var appliedFilters = cloneFilterState(state.views.accountingEntryLines.appliedFilters || state.views.accountingEntryLines.filters);
      var remotePage = await loadCoqlPage(MODULES.accountingEntryLines, ACCOUNTING_ENTRY_LINE_FIELDS, {
        page: state.views.accountingEntryLines.page,
        perPage: state.views.accountingEntryLines.perPage,
        whereClause: await buildAccountingEntryLinesRemoteWhereClause(appliedFilters),
        orderByClause: await buildAccountingEntryLinesRemoteOrderByClause(state.views.accountingEntryLines.sort || {
          key: "date",
          direction: "desc"
        })
      });

      state.records.accountingEntryLines = remotePage.records;
      state.views.accountingEntryLines.page = remotePage.page;
      state.views.accountingEntryLines.hasMore = remotePage.hasMore;
      state.views.accountingEntryLines.pageSummary = buildRemotePageSummary(remotePage.page, remotePage.hasMore);
      state.views.accountingEntryLines.countLabel = remotePage.records.length + (remotePage.records.length === 1 ? " line" : " lines");
      state.loaded.accountingEntryLines = true;
    }()).finally(function () {
      accountingEntryLinesLoadPromise = null;
    });

    return accountingEntryLinesLoadPromise;
  }

  async function onAccountingEntryLinesExportContasolClick() {
    var appliedFilters = cloneFilterState(state.views.accountingEntryLines.appliedFilters || state.views.accountingEntryLines.filters);
    var whereClause;
    var orderByClause;
    var lines;
    var headers;
    var workbookRows;
    var workbookXml;
    var fileName;
    var today = helpers.toIsoDate(new global.Date());

    if (!state.views.accountingEntryLines.hasLoaded) {
      renderer.showError("Load accounting entry lines first.");
      return;
    }

    renderer.showError("");
    renderer.showNotice("Preparing Contasol export...", {
      isLoading: true
    });

    try {
      await ensureAccountingAccountsLoaded();
      whereClause = await buildAccountingEntryLinesRemoteWhereClause(appliedFilters);
      orderByClause = await buildAccountingEntryLinesRemoteOrderByClause();
      lines = await loadRecordsByCoql(MODULES.accountingEntryLines, ACCOUNTING_ENTRY_LINE_FIELDS, {
        whereClause: whereClause,
        orderByClause: orderByClause
      });

      if (!lines.length) {
        throw new Error("No accounting entry lines match the current filters.");
      }

      headers = [
        "Diario",
        "fecha",
        "Asiento",
        "Orden",
        "Cuenta",
        "Importe pesetas",
        "Concepto",
        "Documento",
        "Importe DEBE en euros",
        "Importe HABER en euros",
        "Moneda",
        "Punteo",
        "Tipo de IVA",
        "CÃ³digo de IVA",
        "Departamento",
        "Subdepartamento",
        "Archivo de imagen"
      ];
      headers[13] = "C\u00f3digo de IVA";

      workbookRows = lines.map(function (line) {
        var exportAmounts = getContasolDebitCreditValues(line);

        return [
          { value: 1, type: "Number" },
          { value: formatDateForContasol(line.Source_Date), type: "String" },
          { value: 0, type: "Number" },
          { value: Number(line.Line_No || 0) || 0, type: "Number" },
          { value: getAccountingEntryLineAccountDisplayValue(line), type: "String" },
          { value: "", type: "String" },
          { value: String(line && line.Name || "").trim(), type: "String" },
          { value: "", type: "String" },
          { value: formatNumberForContasol(exportAmounts.debit), type: "String" },
          { value: formatNumberForContasol(exportAmounts.credit), type: "String" },
          { value: "E", type: "String" },
          { value: 0, type: "Number" },
          { value: "", type: "String" },
          { value: "", type: "String" },
          { value: "", type: "String" },
          { value: "", type: "String" },
          { value: "", type: "String" }
        ];
      });

      workbookXml = buildSpreadsheetWorkbookXml("Contasol", headers, workbookRows);
      fileName = sanitizeDownloadFileName("accounting-entry-lines-contasol-" + (today || "export")) + ".xls";
      downloadFileFromText(fileName, "application/vnd.ms-excel;charset=utf-8", workbookXml);
      renderer.showNotice("Contasol export generated successfully.", {
        tone: "success"
      });
    } catch (error) {
      debugError("onAccountingEntryLinesExportContasolClick failed", error, {
        filters: appliedFilters
      });
      renderer.showNotice("");
      renderer.showError(error.message || "Could not generate the Contasol export.");
    }
  }

  async function ensureAccountingAccountsLoaded() {
    if (state.loaded.accountingAccounts) {
      return;
    }

    if (accountingAccountsLoadPromise) {
      return accountingAccountsLoadPromise;
    }

    accountingAccountsLoadPromise = (async function () {
      state.records.accountingAccounts = sortRecordsByName(
        await loadModuleRecords(MODULES.accountingAccounts, ACCOUNTING_ACCOUNT_FIELDS),
        FIELD_CANDIDATES.accountingAccount.code
      );
      state.loaded.accountingAccounts = true;
    }()).finally(function () {
      accountingAccountsLoadPromise = null;
    });

    return accountingAccountsLoadPromise;
  }

  async function ensureAccountingRulesLoaded() {
    if (state.loaded.accountingRules) {
      return;
    }

    if (accountingRulesLoadPromise) {
      return accountingRulesLoadPromise;
    }

    accountingRulesLoadPromise = (async function () {
      state.records.accountingRules = sortRecordsByName(
        await loadModuleRecords(MODULES.accountingRules, ACCOUNTING_RULE_FIELDS),
        FIELD_CANDIDATES.accountingRule.name
      );
      state.loaded.accountingRules = true;
    }()).finally(function () {
      accountingRulesLoadPromise = null;
    });

    return accountingRulesLoadPromise;
  }

  async function loadInvoicesForSupplier(supplierId) {
    var escapedId = supplierId.replace(/'/g, "\\'");
    var selectFields = await resolveCoqlFields(MODULES.invoices, INVOICE_COQL_FIELDS);

    try {
      return sortRecordsByDateDesc(
        await crm.coql(
          "select " + selectFields.join(", ") +
          " from " + MODULES.invoices +
          " where Supplier = '" + escapedId + "'" +
          " limit 0, 200"
        ),
        "Invoice_Date"
      );
    } catch (coqlError) {
      try {
        return sortRecordsByDateDesc(
          await crm.searchRecord(MODULES.invoices, "(Supplier:equals:" + supplierId + ")"),
          "Invoice_Date"
        );
      } catch (searchError) {
        return getSupplierInvoicesFromLoadedRecords(supplierId);
      }
    }
  }

  async function loadPaymentsForSupplier(supplierId) {
    var relatedPaymentIds;
    var records = [];
    var index;
    var idsChunk;
    var paymentIdsClause;
    var chunkSize = 40;

    if (!supplierId) {
      return [];
    }

    await ensurePayAllocationsLoaded();
    relatedPaymentIds = helpers.uniqueNonEmpty(state.records.payAllocations.filter(function (allocation) {
      return helpers.getLookupId(allocation.Supplier) === supplierId;
    }).map(function (allocation) {
      return helpers.getLookupId(allocation.Supplier_Payment);
    }));

    if (!relatedPaymentIds.length) {
      return [];
    }

    try {
      for (index = 0; index < relatedPaymentIds.length; index += chunkSize) {
        idsChunk = relatedPaymentIds.slice(index, index + chunkSize);
        paymentIdsClause = "id in (" + idsChunk.map(function (id) {
          return "'" + escapeCoqlValue(id) + "'";
        }).join(", ") + ")";
        records = records.concat(await loadRecordsByCoql(MODULES.payments, PAYMENT_FIELDS, {
          whereClause: paymentIdsClause,
          orderByClause: await buildPaymentRemoteOrderByClause()
        }));
      }

      return sortRecordsByDateDesc(helpers.dedupeById(records), "Payment_Date");
    } catch (error) {
      return getSupplierPaymentsFromLoadedRecords(supplierId);
    }
  }

  function rebuildBookingIndexes() {
    var bookingById = {};
    var mfspByBookingId = {};

    state.records.bookings.forEach(function (booking) {
      bookingById[booking.id] = booking;
      mfspByBookingId[booking.id] = booking.MFSP_Reference || "";
    });

    state.indexes.bookingById = bookingById;
    state.indexes.mfspByBookingId = mfspByBookingId;
  }

  function rebuildPaymentAccountIndex() {
    var relatedPaymentsByAccountId = {};

    state.records.payments.forEach(function (payment) {
      var accountId = helpers.getLookupId(payment.Payment_Account);

      if (!accountId) {
        return;
      }

      if (!relatedPaymentsByAccountId[accountId]) {
        relatedPaymentsByAccountId[accountId] = [];
      }

      relatedPaymentsByAccountId[accountId].push(payment);
    });

    state.indexes.relatedPaymentsByAccountId = relatedPaymentsByAccountId;
  }

  function rebuildPaymentAccountMetaIndex() {
    var paymentAccountMetaById = {};

    state.records.paymentAccounts.forEach(function (account) {
      var relatedPayments = state.indexes.relatedPaymentsByAccountId[account.id] || [];
      var suppliers = [];
      var mfsps = [];
      var supplierIds = [];

      relatedPayments.forEach(function (payment) {
        var context = getPaymentContext(payment);

        if (!context) {
          return;
        }

        suppliers = suppliers.concat(context.supplierNames);
        mfsps = mfsps.concat(context.mfsps);
        supplierIds = supplierIds.concat(context.supplierIds);
      });

      paymentAccountMetaById[account.id] = {
        relatedPayments: relatedPayments,
        suppliers: helpers.sortStrings(helpers.uniqueNonEmpty(suppliers)),
        supplierIds: helpers.uniqueNonEmpty(supplierIds),
        mfsps: helpers.sortStrings(helpers.uniqueNonEmpty(mfsps))
      };
    });

    state.indexes.paymentAccountMetaById = paymentAccountMetaById;
  }

  function refreshPaymentAccountMetaIndex() {
    if (!state.loaded.paymentAccounts || !state.loaded.payments || !state.loaded.payAllocations) {
      state.indexes.paymentAccountMetaById = {};
      state.loaded.paymentAccountsContext = false;
      return false;
    }

    rebuildPaymentAccountMetaIndex();
    state.loaded.paymentAccountsContext = true;
    return true;
  }

  function resetPaymentRelationshipIndexes() {
    state.indexes.paymentContextByPaymentId = {};
    state.indexes.paymentIdsBySupplierId = {};
    state.indexes.paymentSupplierNameById = {};
    state.indexes.relatedPaymentsByAccountId = {};
    state.indexes.paymentAccountMetaById = {};
    state.loaded.paymentAccountsContext = false;
  }

  function requestPaymentAccountsContextLoad() {
    ensurePaymentAccountsContextLoaded().catch(function (error) {
      debugError("ensurePaymentAccountsContextLoaded failed", error, {
        currentTab: state.currentTab
      });

      if (isPaymentAccountsSectionActive()) {
        renderAll();
      }
    });
  }

  function rebuildPaymentContextIndexes() {
    var paymentContextByPaymentId = {};
    var paymentIdsBySupplierId = {};
    var paymentSupplierNameById = {};

    state.records.payAllocations.forEach(function (allocation) {
      var paymentId = helpers.getLookupId(allocation.Supplier_Payment);
      var supplierId = helpers.getLookupId(allocation.Supplier);
      var supplierName = allocation.Supplier_Name || helpers.getLookupName(allocation.Supplier);
      var bookingId = helpers.getLookupId(allocation.Booking);
      var bookingName = helpers.getLookupName(allocation.Booking);
      var settlementId = helpers.getLookupId(allocation.Supplier_Settlement);
      var settlementName = helpers.getLookupName(allocation.Supplier_Settlement);
      var context;

      if (!paymentId) {
        return;
      }

      if (!paymentContextByPaymentId[paymentId]) {
        paymentContextByPaymentId[paymentId] = {
          supplierIds: [],
          supplierNames: [],
          bookingIds: [],
          bookingNames: [],
          settlementIds: [],
          settlementNames: [],
          mfsps: [],
          ezusReferences: [],
          allocationCount: 0
        };
      }

      context = paymentContextByPaymentId[paymentId];
      context.allocationCount += 1;

      if (supplierId) {
        context.supplierIds.push(supplierId);
        if (!paymentIdsBySupplierId[supplierId]) {
          paymentIdsBySupplierId[supplierId] = {};
        }
        paymentIdsBySupplierId[supplierId][paymentId] = true;
        if (supplierName && !paymentSupplierNameById[supplierId]) {
          paymentSupplierNameById[supplierId] = supplierName;
        }
      }
      if (supplierName) {
        context.supplierNames.push(supplierName);
      }
      if (bookingId) {
        context.bookingIds.push(bookingId);
      }
      if (bookingName) {
        context.bookingNames.push(bookingName);
      }
      if (settlementId) {
        context.settlementIds.push(settlementId);
      }
      if (settlementName) {
        context.settlementNames.push(settlementName);
      }
      if (allocation.MFSP_Reference) {
        context.mfsps.push(allocation.MFSP_Reference);
      }
      if (allocation.Ezus_Supplier_Reference) {
        context.ezusReferences.push(allocation.Ezus_Supplier_Reference);
      }
    });

    Object.keys(paymentContextByPaymentId).forEach(function (paymentId) {
      var context = paymentContextByPaymentId[paymentId];

      context.supplierIds = getUniqueSortedValues(context.supplierIds);
      context.supplierNames = getUniqueSortedValues(context.supplierNames);
      context.bookingIds = getUniqueSortedValues(context.bookingIds);
      context.bookingNames = getUniqueSortedValues(context.bookingNames);
      context.settlementIds = getUniqueSortedValues(context.settlementIds);
      context.settlementNames = getUniqueSortedValues(context.settlementNames);
      context.mfsps = getUniqueSortedValues(context.mfsps);
      context.ezusReferences = getUniqueSortedValues(context.ezusReferences);
      context.supplierId = context.supplierIds.length === 1 ? context.supplierIds[0] : "";
      context.supplierName = context.supplierNames.length === 1 ? context.supplierNames[0] : "";
      context.bookingId = context.bookingIds.length === 1 ? context.bookingIds[0] : "";
      context.bookingName = context.bookingNames.length === 1 ? context.bookingNames[0] : "";
      context.settlementId = context.settlementIds.length === 1 ? context.settlementIds[0] : "";
      context.settlementName = context.settlementNames.length === 1 ? context.settlementNames[0] : "";
      context.mfsp = context.mfsps.length === 1 ? context.mfsps[0] : "";
      context.ezusReference = context.ezusReferences.length === 1 ? context.ezusReferences[0] : "";
      context.contextMode = (
        context.supplierNames.length <= 1 &&
        context.bookingNames.length <= 1 &&
        context.settlementNames.length <= 1
      ) ? "Single" : "Mixed";
      context.contextSummary = buildPaymentContextSummaryText(context);
    });

    Object.keys(paymentIdsBySupplierId).forEach(function (supplierId) {
      paymentIdsBySupplierId[supplierId] = Object.keys(paymentIdsBySupplierId[supplierId]);
    });

    state.indexes.paymentContextByPaymentId = paymentContextByPaymentId;
    state.indexes.paymentIdsBySupplierId = paymentIdsBySupplierId;
    state.indexes.paymentSupplierNameById = paymentSupplierNameById;
  }

  function sortRecordsByDateDesc(records, fieldName) {
    return records.slice().sort(function (left, right) {
      var leftDate = Date.parse(left[fieldName] || "") || 0;
      var rightDate = Date.parse(right[fieldName] || "") || 0;
      return rightDate - leftDate;
    });
  }

  function sortRecordsByName(records, candidates) {
    return records.slice().sort(function (left, right) {
      return helpers.getCandidateValue(left, candidates).localeCompare(
        helpers.getCandidateValue(right, candidates),
        "en",
        { sensitivity: "base" }
      );
    });
  }

  function getAccountingAccountRecordById(accountId) {
    var normalizedAccountId = String(accountId || "").trim();

    if (!normalizedAccountId) {
      return null;
    }

    return state.records.accountingAccounts.find(function (record) {
      return String(record && record.id || "") === normalizedAccountId;
    }) || null;
  }

  function getAccountingEntryLineAccountDisplayValue(line) {
    var accountLookup = line && line.Account;
    var accountId = helpers.getLookupId(accountLookup);
    var accountRecord = getAccountingAccountRecordById(accountId);
    var accountLabel = "";

    if (accountLookup && typeof accountLookup === "object") {
      accountLabel = String(
        accountLookup.name ||
        accountLookup.Name ||
        accountLookup.Account_Code ||
        accountLookup.Account_Name ||
        ""
      ).trim();

      if (accountLabel) {
        return accountLabel;
      }
    }

    if (accountRecord) {
      return String(accountRecord.Name || accountRecord.Account_Code || accountRecord.Account_Name || "").trim();
    }

    return String(accountLookup || "").trim();
  }

  async function loadInvoiceRecordsByIds(ids) {
    var normalizedIds = helpers.uniqueNonEmpty(ids || []);

    if (!normalizedIds.length) {
      return [];
    }

    return loadRecordsByCoql(MODULES.invoices, INVOICE_COQL_FIELDS, {
      whereClause: buildCoqlOrEqualsClause("id", normalizedIds)
    });
  }

  function getAccountingEntryLineInvoiceDisplayValue(line, invoiceNameById) {
    var invoiceLookup = line && line.Supplier_Invoice;
    var invoiceId = helpers.getLookupId(invoiceLookup);
    var invoiceLabel = "";

    if (invoiceLookup && typeof invoiceLookup === "object") {
      invoiceLabel = String(invoiceLookup.name || invoiceLookup.Name || "").trim();

      if (invoiceLabel) {
        return invoiceLabel;
      }
    }

    if (invoiceId && invoiceNameById[invoiceId]) {
      return invoiceNameById[invoiceId];
    }

    return String(invoiceLookup || "").trim();
  }

  function getAccountingEntryDisplayDateValue(entry) {
    return entry && (
      entry.Entry_Date ||
      entry.Posting_Date ||
      entry.Source_Date ||
      entry.Invoice_Date ||
      ""
    ) || "";
  }

  function getAccountingEntryInvoiceDisplayValue(entry) {
    return helpers.getLookupName(entry && entry.Supplier_Invoice) || "";
  }

  function getAccountingEntrySupplierDisplayValue(entry) {
    return helpers.getLookupName(entry && entry.Supplier) || "";
  }

  function getSortedAccountingEntriesRecords(records, sort) {
    var normalizedSort = sort || { key: "date", direction: "desc" };

    return (records || []).slice().sort(function (left, right) {
      if (normalizedSort.key === "entry") {
        return compareValues(left.Name, right.Name, normalizedSort.direction);
      }

      if (normalizedSort.key === "movement") {
        return compareValues(left.Movement_Type, right.Movement_Type, normalizedSort.direction);
      }

      if (normalizedSort.key === "invoice") {
        return compareValues(
          getAccountingEntryInvoiceDisplayValue(left),
          getAccountingEntryInvoiceDisplayValue(right),
          normalizedSort.direction
        );
      }

      if (normalizedSort.key === "supplier") {
        return compareValues(
          getAccountingEntrySupplierDisplayValue(left),
          getAccountingEntrySupplierDisplayValue(right),
          normalizedSort.direction
        );
      }

      if (normalizedSort.key === "mfsp") {
        return compareValues(left.MFSP_Reference, right.MFSP_Reference, normalizedSort.direction);
      }

      if (normalizedSort.key === "status") {
        return compareValues(left.Accounting_Status, right.Accounting_Status, normalizedSort.direction);
      }

      if (normalizedSort.key === "debit") {
        return compareValues(Number(left.Total_Debit || 0), Number(right.Total_Debit || 0), normalizedSort.direction);
      }

      if (normalizedSort.key === "credit") {
        return compareValues(Number(left.Total_Credit || 0), Number(right.Total_Credit || 0), normalizedSort.direction);
      }

      return compareValues(
        Date.parse(getAccountingEntryDisplayDateValue(left)) || 0,
        Date.parse(getAccountingEntryDisplayDateValue(right)) || 0,
        normalizedSort.direction
      );
    });
  }

  function getSortedAccountingEntryLinesRecords(records, sort) {
    var normalizedSort = sort || { key: "date", direction: "desc" };

    return (records || []).slice().sort(function (left, right) {
      if (normalizedSort.key === "name") {
        return compareValues(left.Name, right.Name, normalizedSort.direction);
      }

      if (normalizedSort.key === "account") {
        return compareValues(
          getAccountingEntryLineAccountDisplayValue(left),
          getAccountingEntryLineAccountDisplayValue(right),
          normalizedSort.direction
        );
      }

      if (normalizedSort.key === "debit") {
        return compareValues(Number(left.Debit || 0), Number(right.Debit || 0), normalizedSort.direction);
      }

      if (normalizedSort.key === "credit") {
        return compareValues(Number(left.Credit || 0), Number(right.Credit || 0), normalizedSort.direction);
      }

      if (normalizedSort.key === "lineNo") {
        return compareValues(Number(left.Line_No || 0), Number(right.Line_No || 0), normalizedSort.direction);
      }

      if (normalizedSort.key === "lineType") {
        return compareValues(left.Line_Type, right.Line_Type, normalizedSort.direction);
      }

      return compareValues(
        Date.parse(left.Source_Date || left.Date || "") || 0,
        Date.parse(right.Source_Date || right.Date || "") || 0,
        normalizedSort.direction
      );
    });
  }

  function getSupplierInvoicesFromLoadedRecords(supplierId) {
    return state.records.invoices.filter(function (invoice) {
      return helpers.getLookupId(invoice.Supplier) === supplierId;
    });
  }

  function getSupplierPaymentsFromLoadedRecords(supplierId) {
    var relatedPaymentIds = state.indexes.paymentIdsBySupplierId[supplierId] || [];

    return state.records.payments.filter(function (payment) {
      return relatedPaymentIds.indexOf(String(payment.id || "")) !== -1;
    });
  }

  function getInvoiceSupplierId(record) {
    return helpers.getLookupId(record.Supplier);
  }

  function getPaymentContext(record) {
    return state.indexes.paymentContextByPaymentId[String(record && record.id || "")] || null;
  }

  function createEmptyPaymentAccountMeta() {
    return {
      relatedPayments: [],
      suppliers: [],
      supplierIds: [],
      mfsps: []
    };
  }

  function getPaymentSupplierId(record) {
    var context = getPaymentContext(record);
    return context ? context.supplierId : "";
  }

  function getPaymentSupplierCodeValues(record) {
    var context = getPaymentContext(record);

    if (!context || !Array.isArray(context.supplierIds) || !context.supplierIds.length) {
      return [];
    }

    return helpers.uniqueNonEmpty(context.supplierIds.map(function (supplierId) {
      var cachedSupplier = state.supplierIndex[supplierId] || null;
      return cachedSupplier
        ? helpers.getCandidateValue(cachedSupplier, FIELD_CANDIDATES.supplier.connectionReference)
        : "";
    }));
  }

  function getSupplierNameFromInvoice(record) {
    return record.Supplier_Name || helpers.getLookupName(record.Supplier) || "-";
  }

  function getSupplierConnectionReferenceFromInvoice(record) {
    var directValue = helpers.getCandidateValue(record, FIELD_CANDIDATES.invoice.supplierConnectionReference);
    var supplierLookup = helpers.getLookupValue(record, FIELD_CANDIDATES.invoice.supplier);
    var lookupValue = helpers.getCandidateValue(supplierLookup, FIELD_CANDIDATES.supplier.connectionReference);
    var supplierId = getInvoiceSupplierId(record);
    var cachedSupplier = supplierId ? state.supplierIndex[supplierId] : null;

    if (directValue) {
      return directValue;
    }

    if (lookupValue) {
      return lookupValue;
    }

    if (cachedSupplier) {
      return helpers.getCandidateValue(cachedSupplier, FIELD_CANDIDATES.supplier.connectionReference) || "";
    }

    return "";
  }

  function getInvoiceSupplierDisplay(record) {
    var supplierName = getSupplierNameFromInvoice(record);
    var supplierCode = getSupplierConnectionReferenceFromInvoice(record);

    return {
      name: supplierName,
      code: supplierCode || ""
    };
  }

  function getInvoiceSupplierSortValue(record) {
    var supplierDisplay = getInvoiceSupplierDisplay(record);
    return supplierDisplay.name || "-";
  }

  function getInvoiceSupplierCodeSortValue(record) {
    var supplierDisplay = getInvoiceSupplierDisplay(record);
    return supplierDisplay.code || "-";
  }

  function getSupplierNameFromPayment(record) {
    var context = getPaymentContext(record);

    if (context) {
      return getCompactContextDisplayValue(context.supplierNames, "supplier", "suppliers");
    }

    return record.Context_Summary || "-";
  }

  function getBookingIdFromInvoice(record) {
    return helpers.getLookupId(helpers.getLookupValue(record, FIELD_CANDIDATES.invoice.booking));
  }

  function getBookingIdFromPayment(record) {
    var context = getPaymentContext(record);
    return context ? context.bookingId : "";
  }

  function getBookingNameFromInvoice(record) {
    return helpers.getLookupDisplayValue(record, FIELD_CANDIDATES.invoice.booking);
  }

  function getInvoiceBookingDisplay(record) {
    return getMfspFromInvoice(record) || getBookingNameFromInvoice(record) || "-";
  }

  function getBookingNameFromPayment(record) {
    var context = getPaymentContext(record);

    if (context) {
      return getContextDisplayValue(context.bookingNames, "bookings", 2);
    }

    return "-";
  }

  function getMfspFromInvoice(record) {
    return record.MFSP_Reference || state.indexes.mfspByBookingId[getBookingIdFromInvoice(record)] || "";
  }

  function getMfspFromPayment(record) {
    var context = getPaymentContext(record);

    if (context && context.mfsps.length) {
      return getCompactContextDisplayValue(context.mfsps, "MFSP", "MFSPs");
    }

    return state.indexes.mfspByBookingId[getBookingIdFromPayment(record)] || "";
  }

  function getPaymentSettlementName(record) {
    var context = getPaymentContext(record);

    if (context) {
      return getContextDisplayValue(context.settlementNames, "settlements", 2);
    }

    return "-";
  }

  function getPaymentContextSummary(record) {
    var context = getPaymentContext(record);

    if (context && context.contextSummary) {
      return context.contextSummary;
    }

    return record.Context_Summary || "-";
  }

  function paymentHasSupplier(record, supplierId) {
    var context = getPaymentContext(record);

    if (!supplierId) {
      return true;
    }

    return Boolean(context && context.supplierIds.indexOf(String(supplierId)) !== -1);
  }

  function buildSupplierOptionsFromPayments(records) {
    var seen = {};
    var options = [];

    records.forEach(function (payment) {
      var context = getPaymentContext(payment);

      if (!context) {
        return;
      }

      context.supplierIds.forEach(function (supplierId) {
        var label = state.indexes.paymentSupplierNameById[supplierId] || supplierId;

        if (!supplierId || seen[supplierId]) {
          return;
        }

        seen[supplierId] = true;
        options.push({
          value: supplierId,
          label: label
        });
      });
    });

    return options.sort(function (left, right) {
      return left.label.localeCompare(right.label, "en", { sensitivity: "base" });
    });
  }

  function buildSupplierOptionsFromRecords(records, getSupplierId, getSupplierName) {
    var seen = {};
    var options = [];

    records.forEach(function (record) {
      var supplierId = getSupplierId(record);
      var supplierName = getSupplierName(record);

      if (!supplierId || seen[supplierId]) {
        return;
      }

      seen[supplierId] = true;
      options.push({
        value: supplierId,
        label: supplierName || supplierId
      });
    });

    return options.sort(function (left, right) {
      return left.label.localeCompare(right.label, "en", { sensitivity: "base" });
    });
  }

  function buildStatusOptions(records, fieldName) {
    return helpers.sortStrings(helpers.uniqueNonEmpty(records.map(function (record) {
      return record[fieldName];
    }))).map(function (value) {
      return {
        value: value,
        label: value
      };
    });
  }

  function buildRemotePageSummary(page, hasMore) {
    return hasMore ? "Page " + page + " - More available" : "Page " + page;
  }

  function buildLocalPageSummary(page, totalPages) {
    return "Page " + page + " of " + totalPages;
  }

  function buildSupplierFilterOptions(getRecordSupplierId, getRecordSupplierName, records) {
    var seen = {};
    var options = [];

    state.recentSuppliers.forEach(function (supplier) {
      var supplierId = String(supplier && supplier.id || "");
      var supplierName = helpers.getCandidateValue(supplier, FIELD_CANDIDATES.supplier.name) || "";

      if (!supplierId || !supplierName || seen[supplierId]) {
        return;
      }

      seen[supplierId] = true;
      options.push({
        value: supplierId,
        label: supplierName
      });
    });

    (records || []).forEach(function (record) {
      var supplierId = String(getRecordSupplierId(record) || "");
      var supplierName = String(getRecordSupplierName(record) || "");

      if (!supplierId || !supplierName || seen[supplierId]) {
        return;
      }

      seen[supplierId] = true;
      options.push({
        value: supplierId,
        label: supplierName
      });
    });

    return options.sort(function (left, right) {
      return left.label.localeCompare(right.label, "en", { sensitivity: "base" });
    });
  }

  function buildCombinedStatusOptions(baseOptions, records, fieldName) {
    return helpers.sortStrings(
      helpers.uniqueNonEmpty((baseOptions || []).concat((records || []).map(function (record) {
        return record[fieldName];
      })))
    ).map(function (value) {
      return {
        value: value,
        label: value
      };
    });
  }

  async function loadSuppliersByPaymentSupplierCode(supplierCode) {
    var normalizedSupplierCode = String(supplierCode || "").trim();
    var supplierCodeFieldApi;
    var supplierRecords;

    if (!normalizedSupplierCode) {
      return [];
    }

    supplierCodeFieldApi = await resolveFieldApiByCandidates(
      MODULES.suppliers,
      ["TP_Reference", "Connection_Reference", "Supplier_Connection_Reference", "Supplier Connection Reference"],
      "TP_Reference"
    );

    supplierRecords = await loadRecordsByCoql(MODULES.suppliers, [
      "id",
      "Vendor_Name",
      "TP_Reference",
      "Connection_Reference",
      "Supplier_Connection_Reference",
      "Ezus_Supplier_API"
    ], {
      whereClause: supplierCodeFieldApi + " like '%" + escapeCoqlValue(normalizedSupplierCode) + "%'"
    });

    supplierRecords.forEach(cacheSupplierLookup);
    return supplierRecords;
  }

  async function getFilteredPaymentIdsFromAllocations(filters) {
    var normalizedFilters = filters || {};
    var supplierCode = String(normalizedFilters.supplierCode || "").trim();
    var hasMfspFilter = Boolean(String(filters && filters.mfsp || "").trim());
    var supplierIds = [];

    if (!supplierCode && !hasMfspFilter) {
      return [];
    }

    if (supplierCode) {
      supplierIds = (await loadSuppliersByPaymentSupplierCode(supplierCode)).map(function (supplier) {
        return String(supplier && supplier.id || "");
      }).filter(Boolean);

      if (!supplierIds.length) {
        return [];
      }
    }

    return helpers.uniqueNonEmpty(state.records.payAllocations.filter(function (allocation) {
      if (supplierIds.length && supplierIds.indexOf(helpers.getLookupId(allocation.Supplier)) === -1) {
        return false;
      }

      if (hasMfspFilter && !helpers.matchesText(allocation.MFSP_Reference, normalizedFilters.mfsp)) {
        return false;
      }

      return true;
    }).map(function (allocation) {
      return helpers.getLookupId(allocation.Supplier_Payment);
    }));
  }

  function closeSupplierActivityDetail() {
    state.supplierActivityDetail.isOpen = false;
    renderAll();
  }

  async function openSupplierActivityDetail(type, recordId) {
    var isInvoice = type === "invoice";
    var record = (isInvoice ? state.supplierInvoices : state.supplierPayments).find(function (item) {
      return String(item && item.id || "") === String(recordId || "");
    });

    if (!record) {
      return;
    }

    state.supplierActivityDetail = {
      isOpen: true,
      type: isInvoice ? "invoice" : "payment",
      record: record,
      lines: [],
      allocations: [],
      isLoading: true
    };
    renderAll();

    try {
      if (isInvoice) {
        await Promise.all([
          ensureInvoiceLinesLoaded(record.id),
          ensureInvoiceAllocationsLoaded(record.id)
        ]);
        state.supplierActivityDetail.lines = state.invoiceLinesByInvoiceId[record.id] || [];
        state.supplierActivityDetail.allocations = state.invoiceAllocationsByInvoiceId[record.id] || [];
      } else {
        try {
          state.supplierActivityDetail.allocations = await crm.coql(
            "select " + (await resolveCoqlFields(MODULES.payAllocations, PAY_ALLOCATION_FIELDS)).join(", ") +
            " from " + MODULES.payAllocations +
            " where Supplier_Payment = '" + String(record.id).replace(/'/g, "\\'") + "' limit 0, 200"
          );
        } catch (coqlError) {
          state.supplierActivityDetail.allocations = await crm.searchRecord(
            MODULES.payAllocations,
            "(Supplier_Payment:equals:" + record.id + ")"
          );
        }
      }
    } catch (error) {
      debugError("openSupplierActivityDetail failed", error, {
        type: type,
        recordId: recordId
      });
      state.supplierActivityDetail.lines = [];
      state.supplierActivityDetail.allocations = [];
    } finally {
      if (state.supplierActivityDetail.isOpen && String(state.supplierActivityDetail.record && state.supplierActivityDetail.record.id || "") === String(recordId)) {
        state.supplierActivityDetail.isLoading = false;
        renderAll();
      }
    }
  }

  function renderAll() {
    var bookingsView = buildBookingsView();
    var invoicesView = buildInvoicesView();
    var paymentsView = buildPaymentsView();
    var paymentAccountsView = buildPaymentAccountsView();
    var paymentAllocationsView = buildPaymentAllocationsView();
    var accountingEntriesView = buildAccountingEntriesView();
    var accountingEntryLinesView = buildAccountingEntryLinesView();
    var accountingAccountsView = buildAccountingAccountsView();
    var accountingRulesView = buildAccountingRulesView();

    if (elements.invoiceViewButtons) {
      elements.invoiceViewButtons.forEach(function (button) {
        var isActive = button.getAttribute("data-invoice-view") === (state.views.invoices.view || "open");
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    renderer.renderTabs();
    renderer.renderSupplierContext();
    renderer.renderSupplierRelatedActivity(state.supplierInvoices, state.supplierPayments, {
      getInvoiceBooking: getInvoiceBookingDisplay,
      getPaymentBooking: getBookingNameFromPayment,
      onInvoiceSortChange: onSupplierActivityInvoiceSortChange
    });
    renderer.renderSupplierActivityDetailPopup(state.supplierActivityDetail);
    renderInvoiceCreatePanel();
    renderInvoicePaymentPanel();
    renderPaymentAccountCreatePanel();
    renderAccountingAccountCreatePanel();
    renderer.renderBookingsWorkspace(bookingsView);
    renderStatusFilterControl("invoices", invoicesView.statusOptions);
    renderer.renderInvoiceWorkspace(
      invoicesView,
      toggleInvoiceSelection,
      selectInvoiceDetail,
      toggleVisibleInvoices,
      onInvoiceSortChange,
      setInvoiceDetailTab,
      openInvoiceInCrm,
      queueInvoiceFileLoad,
      setShowInvoiceAttachments
    );
    renderer.renderPaymentsWorkspaceSections(normalizePaymentsSection(state.views.payments.section));
    renderStatusFilterControl("payments", paymentsView.statusOptions);
    renderer.renderPaymentsWorkspace(paymentsView, selectPayment);
    renderer.renderPaymentAllocationsWorkspace(paymentAllocationsView, selectPaymentAllocation);
    renderer.renderSelectedPayment(paymentsView.selectedRecord, {
      getPaymentReference: paymentsView.getPaymentReference,
      getSupplierName: paymentsView.getSupplierName,
      getMfsp: paymentsView.getMfsp,
      getAllocations: function () {
        return paymentsView.selectedAllocations || [];
      },
      getSettlementName: getPaymentSettlementName,
      getContextSummary: getPaymentContextSummary
    }, setPaymentDetailTab);
    if (elements.selectedPaymentManageAllocations) {
      elements.selectedPaymentManageAllocations.hidden = !paymentsView.selectedRecord;
      elements.selectedPaymentManageAllocations.disabled = !paymentsView.selectedRecord || isPaymentAllocationEditingLocked(paymentsView.selectedRecord);
    }
    renderPaymentAllocationManager();
    renderSelectedPaymentLetterPanel(paymentsView.selectedRecord);
    renderer.renderPaymentAccountsWorkspace(paymentAccountsView, selectPaymentAccount);
    renderer.renderSelectedPaymentAccount(paymentAccountsView.selectedRecord, {
      getAccountMeta: paymentAccountsView.getAccountMeta,
      getAccountName: paymentAccountsView.getAccountName,
      isContextReady: paymentAccountsView.isContextReady,
      isContextLoading: paymentAccountsView.isContextLoading
    });
    renderer.renderAccountingWorkspace(state.accountingTab);
    renderer.renderAccountingEntriesWorkspace(accountingEntriesView, onAccountingEntriesSortChange);
    renderer.renderAccountingEntryLinesWorkspace(accountingEntryLinesView, onAccountingEntryLinesSortChange);
    renderer.renderAccountingAccountsWorkspace(accountingAccountsView, selectAccountingAccount);
    renderer.renderSelectedAccountingAccount(accountingAccountsView.selectedRecord);
    renderer.renderAccountingRulesWorkspace(accountingRulesView, selectAccountingRule);
    renderer.renderSelectedAccountingRule(accountingRulesView.selectedRecord);
    renderer.refreshActionState();
    refreshInvoiceCreateActionState();
    refreshPaymentAccountCreateActionState();
    refreshAccountingAccountCreateActionState();
  }
}(window));
