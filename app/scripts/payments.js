(function (global) {
var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  // Lookup labels must not pass through textValue(value, ""): that helper
  // intentionally replaces an empty fallback with "-".
  ns.paymentLookupLabel = function (value) {
    if (!value) { return ""; }
    if (typeof value === "object") { return String(value.name || value.Name || value.Deal_Name || value.full_name || "").trim(); }
    return /^\d+$/.test(String(value)) ? "" : String(value).trim();
  };
  ns.paymentAccountLabel = function (payment, loading) {
    if (!payment) { return ""; }
    var account = payment.Payment_Account;
    if (Object.prototype.hasOwnProperty.call(payment, "Payment_Account") && !account) { return "No payment account"; }
    var name = ns.paymentLookupLabel(account) || String(payment["Payment_Account.Name"] || "").trim();
    if (name) { return name; }
    if (loading) { return "Loading payment account..."; }
    return account ? "Payment account name unavailable" : "Payment account not loaded";
  };
  ns.paymentDescription = function (payment, loading) {
    return [String(payment && payment.Movement_Type || "").trim(), ns.paymentAccountLabel(payment, loading)].filter(Boolean).join(" | ");
  };

  ns.enrichSupplierPaymentActivity = async function (detail, crm, modules, helpers) {
    // Share in-flight reads across allocations, without retaining stale records after reopening.
    var reads = new Map();
    function read(module, id) {
      var key = module + ":" + id;
      if (!reads.has(key)) {
        reads.set(key, Promise.resolve().then(function () { return crm.getRecord(module, id); }).then(function (record) {
          if (!record || String(record.id) !== String(id)) { throw new Error("Related record unavailable"); }
          return record;
        }));
      }
      return reads.get(key);
    }
    async function resolve(record, field, module, label) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) { return { text: label + " unavailable", error: true }; }
      var value = record[field];
      if (!value) { return { text: "-" }; }
      var name = ns.paymentLookupLabel(value), id = helpers.getLookupId(value);
      if (name) { return { text: name }; }
      try {
        var related = await read(module, id);
        name = ns.paymentLookupLabel(related);
        if (!name) { throw new Error("Related name unavailable"); }
        record[field] = Object.assign({}, typeof value === "object" ? value : {}, { id: id, name: name });
        return { text: name };
      } catch (error) { return { text: label + " unavailable", error: true }; }
    }
    await Promise.all([
      (async function () {
        var payment = detail.record;
        try {
          if (!Object.prototype.hasOwnProperty.call(payment, "Payment_Account") && !payment["Payment_Account.Name"]) {
            var full = await read(modules.payments, payment.id);
            if (Object.prototype.hasOwnProperty.call(full, "Payment_Account")) { payment.Payment_Account = full.Payment_Account; }
          }
          if (ns.paymentLookupLabel(payment.Payment_Account) || payment["Payment_Account.Name"]) {
            detail.accountDisplay = { text: ns.paymentAccountLabel(payment, false) };
          } else { detail.accountDisplay = await resolve(payment, "Payment_Account", modules.paymentAccounts, "Payment account"); }
        } catch (error) { detail.accountDisplay = { text: "Payment account unavailable", error: true }; }
      }()),
      Promise.all((detail.allocations || []).map(async function (allocation) {
        allocation._invoiceDisplay = await resolve(allocation, "Supplier_Invoice", modules.invoices, "Invoice");
        if (!Object.prototype.hasOwnProperty.call(allocation, "Booking")) {
          var invoiceId = helpers.getLookupId(allocation.Supplier_Invoice);
          if (invoiceId) {
            try {
              var invoice = await read(modules.invoices, invoiceId);
              if (Object.prototype.hasOwnProperty.call(invoice, "Booking")) { allocation.Booking = invoice.Booking; }
            } catch (error) { /* resolve below distinguishes an unread field from an empty lookup. */ }
          }
        }
        allocation._bookingDisplay = await resolve(allocation, "Booking", modules.bookings, "Booking");
      }))
    ]);
  };

  ns.createPaymentsModule = function (deps) {
    var FIELD_CANDIDATES = deps.FIELD_CANDIDATES;
    var helpers = deps.helpers;
    var state = deps.state;
    var renderer = deps.renderer;
    var renderAll = deps.renderAll;
    var debugError = deps.debugError;
    var cloneFilterState = deps.cloneFilterState;
    var getNormalizedStatusFilterValues = deps.getNormalizedStatusFilterValues;
    var hasAnyLoadFilterValue = deps.hasAnyLoadFilterValue;
    var getMfspFromPayment = deps.getMfspFromPayment;
    var getPaymentMfspValues = deps.getPaymentMfspValues;
    var getPaymentSupplierCodeValues = deps.getPaymentSupplierCodeValues;
    var buildLocalPageSummary = deps.buildLocalPageSummary;
    var buildCombinedStatusOptions = deps.buildCombinedStatusOptions;
    var PAYMENT_STATUS_FILTER_OPTIONS = deps.PAYMENT_STATUS_FILTER_OPTIONS;
    var getSupplierNameFromPayment = deps.getSupplierNameFromPayment;
    var createEmptyPaymentAccountMeta = deps.createEmptyPaymentAccountMeta;
    var buildStatusOptions = deps.buildStatusOptions;
    var getFriendlyLoadErrorMessage = deps.getFriendlyLoadErrorMessage;
    var resetPaymentRelationshipIndexes = deps.resetPaymentRelationshipIndexes;
    var ensurePayAllocationsLoaded = deps.ensurePayAllocationsLoaded;
    var ensurePaymentsLoaded = deps.ensurePaymentsLoaded;
    var ensurePaymentAccountsLoaded = deps.ensurePaymentAccountsLoaded;
    var requestPaymentAccountsContextLoad = deps.requestPaymentAccountsContextLoad;
    var ensureTabDataLoaded = deps.ensureTabDataLoaded;
    var getPaymentAccountsContextLoading = deps.getPaymentAccountsContextLoading;

    var auxiliaryQueries = {};
    function auxiliaryQuery(key) {
      if (!auxiliaryQueries[key]) {
        var view = state.views[key];
        auxiliaryQueries[key] = ns.createProgressiveQuery({ view: view, render: renderAll,
          getRecords: function () { return view.browserRecords || []; },
          setRecords: function (records) { view.browserRecords = records; if (key === "paymentAccounts") { var byId = new Map(state.records.paymentAccounts.map(function (r) { return [String(r.id), r]; })); records.forEach(function (r) { byId.set(String(r.id), r); }); state.records.paymentAccounts = Array.from(byId.values()); } },
          fetch: function (query) { return deps.fetchAuxPage(key, query); },
          resetScroll: function () { if (deps.resetAuxScroll) { deps.resetAuxScroll(key); } }
        });
      }
      return auxiliaryQueries[key];
    }
    function loadAuxiliary(key, apply) {
      var view = state.views[key];
      if (apply || !view.appliedFilters) { view.appliedFilters = cloneFilterState(view.filters); }
      return auxiliaryQuery(key).reset({ filters: view.appliedFilters, perPage: Math.min(100, view.perPage || 50) });
    }
    function auxiliaryView(key, value) {
      var view = state.views[key];
      return Object.assign(value, { loadingInitial: view.loadingInitial, loadingMore: view.loadingMore, hasMore: view.hasMore,
        loadError: view.loadError, onLoadMore: function () { return auxiliaryQuery(key).more(); } });
    }
    function cancelSearch() {
      closePaymentDetail(false);
      searchGeneration += 1; activeRequest = null; searchSnapshot = null;
      state.views.payments.loadingInitial = state.views.payments.loadingMore = false;
      Object.keys(auxiliaryQueries).forEach(function (key) { auxiliaryQueries[key].cancel(); });
    }

    function normalizePaymentsSection(sectionName) {
      return sectionName === "accounts" || sectionName === "allocations" ? sectionName : "payments";
    }

    function isPaymentAccountsSectionActive() {
      return state.currentTab === "payments" &&
        normalizePaymentsSection(state.views.payments.section) === "accounts";
    }

    async function setPaymentsSection(sectionName) {
      var nextSection = normalizePaymentsSection(sectionName);

      cancelSearch();
      closePaymentDetail(false);
      state.views.payments.section = nextSection;
      state.currentTab = "payments";
      renderAll();

      if (nextSection === "payments") {
        await refreshPaymentsTabData();
      } else if (nextSection === "accounts" || nextSection === "allocations") {
        await loadAuxiliary(nextSection === "accounts" ? "paymentAccounts" : "paymentAllocations");
        renderAll();
      }
    }

    async function loadPaymentsTabData() {
      state.views.payments.page = 1;
      state.views.payments.appliedFilters = cloneFilterState(state.views.payments.filters);
      await refreshPaymentsTabData({
        loadingLabel: "Loading payments...",
        errorMessage: "Could not load payments.",
        loadedFlag: true
      });
    }

    var searchGeneration = 0;
    var searchSnapshot = null;
    var activeRequest = null;

    function refreshPaymentsTabData() {
      var view = state.views.payments;
      closePaymentDetail(false);
      searchGeneration += 1;
      activeRequest = null;
      searchSnapshot = {
        filters: cloneFilterState(view.appliedFilters || view.filters),
        sort: Object.assign({}, view.sort),
        groupBy: view.groupBy || "none",
        nextPage: 1,
        offset: 0,
        perPage: Math.max(1, Math.min(100, Math.floor(Number(view.perPage) || 50)))
      };
      searchSnapshot.filters.paymentView = view.view || "open";
      if (ns.startPaymentDiagnostics) { ns.startPaymentDiagnostics(searchSnapshot.filters); }
      view.page = 0;
      view.hasMore = true;
      view.hasLoaded = false;
      view.loadError = "";
      view.loadingMore = false;
      view.recordIds = [];
      if (deps.resetPaymentScroll) { deps.resetPaymentScroll(); }
      return loadMorePayments();
    }

    function loadMorePayments() {
      var view = state.views.payments;
      if (activeRequest) { return activeRequest; }
      if (!searchSnapshot || !view.hasMore) { return Promise.resolve(); }
      var generation = searchGeneration;
      var snapshot = searchSnapshot;
      var page = snapshot.nextPage;
      view.loadingInitial = page === 1;
      view.loadingMore = page > 1;
      view.loadError = "";
      // Defer work until the request guard is installed (render can trigger scroll).
      activeRequest = Promise.resolve().then(function () {
        renderAll();
        return deps.fetchPaymentPage(Object.assign({}, snapshot, { page: page }));
      }).then(function (result) {
        if (generation !== searchGeneration) { return; }
        var seen = new Set(view.recordIds);
        result.records.forEach(function (record) {
          var existing = state.records.payments.findIndex(function (item) { return String(item.id) === String(record.id); });
          if (existing === -1) { state.records.payments.push(record); }
          else { state.records.payments[existing] = record; }
          if (!seen.has(String(record.id))) {
            seen.add(String(record.id));
            view.recordIds.push(String(record.id));
          }
        });
        view.page = page;
        snapshot.nextPage = page + 1;
        view.hasMore = result.hasMore;
        view.hasLoaded = true;
        snapshot.offset = result.nextOffset;
        if (deps.onPaymentsLoaded) { deps.onPaymentsLoaded(result); }
      }).catch(function (error) {
        if (generation !== searchGeneration) { return; }
        var reason = error && (error.message || error.code || error.statusText);
        if (ns.failPaymentDiagnostics) { ns.failPaymentDiagnostics(error); }
        var errorDetails = error && error.details;
        if (error && error.code && reason !== error.code) { reason += " (" + error.code + ")"; }
        if (errorDetails && (errorDetails.column_name || errorDetails.api_name)) {
          reason = (reason || "CRM query rejected.") + " Field: " + (errorDetails.column_name || errorDetails.api_name) + ".";
        }
        view.loadError = /pagination limit/.test(String(reason)) ? reason :
          "Could not load payments." + (reason ? " " + String(reason) : " CRM did not provide an error description.") + " Please retry.";
        debugError("loadPaymentPage failed", error, { page: page, filters: snapshot.filters });
      }).finally(function () {
        if (generation !== searchGeneration) { return; }
        view.loadingInitial = false;
        view.loadingMore = false;
        activeRequest = null;
        renderAll();
      });
      return activeRequest;
    }

    function refreshPaymentAccountsTabData() { return loadAuxiliary("paymentAccounts"); }

    function normalizePaymentDetailTab(tabName) {
      if (tabName === "allocations" || tabName === "accounting") {
        return tabName;
      }

      return "payment";
    }

    function setPaymentDetailTab(tabName) {
      state.views.payments.detailTab = normalizePaymentDetailTab(tabName);
      renderAll();
    }

    var detailAllocationQuery = null;
    var detailAllocationView = null;
    function loadDetailAllocations(paymentId) {
      if (!deps.fetchDetailAllocationPage) { return Promise.resolve(); }
      if (detailAllocationQuery) { detailAllocationQuery.cancel(); }
      var view = detailAllocationView = { records: [] };
      detailAllocationQuery = ns.createProgressiveQuery({ view: view, render: renderAll,
        getRecords: function () { return view.records; }, setRecords: function (rows) { view.records = rows; },
        fetch: function (query) { return deps.fetchDetailAllocationPage(paymentId, query); },
        resetScroll: function () { if (deps.resetDetailScroll) { deps.resetDetailScroll(); } }
      });
      view.onLoadMore = detailAllocationQuery.more;
      return detailAllocationQuery.reset({ perPage: 50 });
    }

    var detailGeneration = 0;

    function closePaymentDetail(shouldRender) {
      detailGeneration += 1;
      if (detailAllocationQuery) { detailAllocationQuery.cancel(); }
      detailAllocationView = null;
      state.views.payments.selectedId = "";
      state.views.payments.detailLoad = null;
      if (deps.closeSelectedPaymentLetterPanel) { deps.closeSelectedPaymentLetterPanel(); }
      if (shouldRender !== false) { renderAll(); }
    }

    async function loadPaymentDetail(paymentId) {
      var generation = ++detailGeneration;
      var view = state.views.payments;
      view.detailLoad = { id: paymentId, loading: true, creatorError: "", accountError: "", error: "" };
      renderAll();
      try {
        var detail = await deps.crm.getRecord(deps.MODULES.payments, paymentId);
        if (generation !== detailGeneration || view.selectedId !== paymentId) { return; }
        if (!detail || String(detail.id) !== paymentId) { throw new Error("The selected payment could not be read."); }
        var creatorError = "";
        if (!Object.prototype.hasOwnProperty.call(detail, "Created_By")) {
          creatorError = "CRM did not return the payment creator.";
        } else if (detail.Created_By && !ns.paymentLookupLabel(detail.Created_By)) {
          creatorError = "CRM returned the creator ID without a name.";
        }
        var accountError = "";
        if (!Object.prototype.hasOwnProperty.call(detail, "Payment_Account")) {
          accountError = "CRM did not return the payment account field.";
        } else if (detail.Payment_Account && !ns.paymentLookupLabel(detail.Payment_Account)) {
          var accountId = helpers.getLookupId(detail.Payment_Account);
          try {
            if (!accountId) { throw new Error("Missing account ID"); }
            var account = await deps.crm.getRecord(deps.MODULES.paymentAccounts, accountId);
            if (!account || !account.Name || String(account.id) !== String(accountId)) { throw new Error("Missing account name"); }
            detail.Payment_Account = { id: String(accountId), name: account.Name };
          } catch (error) {
            accountError = "Could not load the associated payment account.";
          }
        }
        if (generation !== detailGeneration || view.selectedId !== paymentId) { return; }
        var payment = state.records.payments.find(function (record) { return String(record.id) === paymentId; });
        if (!payment) { return; }
        // Only enrich the requested identity fields. Financial data and the
        // current table snapshot remain owned by the list/mutation workflows.
        ["Created_By", "Payment_Account", "Movement_Type"].forEach(function (field) {
          if (Object.prototype.hasOwnProperty.call(detail, field)) { payment[field] = detail[field]; }
        });
        if (Object.prototype.hasOwnProperty.call(detail, "Payment_Account")) {
          payment["Payment_Account.Name"] = ns.paymentLookupLabel(detail.Payment_Account);
        }
        view.detailLoad = { id: paymentId, loading: false, creatorError: creatorError, accountError: accountError, error: "" };
      } catch (error) {
        if (generation !== detailGeneration || view.selectedId !== paymentId) { return; }
        view.detailLoad = { id: paymentId, loading: false, error: "Could not load payment details. Please retry.", creatorError: "", accountError: "" };
        debugError("loadPaymentDetail failed", error, { paymentId: paymentId });
      } finally {
        if (generation === detailGeneration && view.selectedId === paymentId) { renderAll(); }
      }
    }

    function selectPayment(paymentId) {
      var id = String(paymentId || "");
      if (!id) { closePaymentDetail(); return Promise.resolve(); }
      if (String(state.paymentLetter.paymentId || "") !== id && deps.closeSelectedPaymentLetterPanel) {
        deps.closeSelectedPaymentLetterPanel();
      }
      state.views.payments.selectedId = id;
      return Promise.all([loadPaymentDetail(id), loadDetailAllocations(id)]);
    }

    async function selectPaymentAccount(accountId) {
      state.views.paymentAccounts.selectedId = accountId || "";
      var account = (state.views.paymentAccounts.browserRecords || []).find(function (r) { return r.id === accountId; });
      if (!account || !deps.loadAccountMetadata) { renderAll(); return; }
      account._contextLoading = true; renderAll();
      try { account._browserMeta = await deps.loadAccountMetadata(accountId); }
      catch (error) { debugError("Payment account relationships unavailable", error); }
      finally { account._contextLoading = false; renderAll(); }
    }

    function getPaymentAccountMeta(account) {
      if (!account || !account.id) {
        return createEmptyPaymentAccountMeta();
      }

      return account._browserMeta || state.indexes.paymentAccountMetaById[account.id] || createEmptyPaymentAccountMeta();
    }

    function buildSupplierOptionsFromAccountMeta(records) {
      var seen = {};
      var options = [];

      records.forEach(function (account) {
        var meta = getPaymentAccountMeta(account);

        meta.supplierIds.forEach(function (supplierId) {
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

    function buildPaymentsView() {
      var byId = new Map(state.records.payments.map(function (record) { return [String(record.id), record]; }));
      var records = (state.views.payments.recordIds || []).map(function (id) { return byId.get(id); }).filter(Boolean);
      var filters = cloneFilterState(state.views.payments.filters);
      var selectedPaymentDetailTab = normalizePaymentDetailTab(state.views.payments.detailTab || "payment");
      var hasCurrentFilters = hasAnyLoadFilterValue(filters);
      var paymentView = state.views.payments.view || "open";
      var filteredRecords = records;
      var page = state.views.payments.page || 1;
      var hasMore = Boolean(state.views.payments.hasMore);
      var selectedId = state.views.payments.selectedId;
      var visibleRecords = filteredRecords;
      var selectedRecord;
      var selectedAllocations = [];

      if (!filteredRecords.some(function (payment) { return payment.id === selectedId; })) {
        selectedId = "";
        if (state.views.payments.selectedId) { detailGeneration += 1; state.views.payments.detailLoad = null; }
        state.views.payments.selectedId = selectedId;
      }

      selectedRecord = filteredRecords.find(function (payment) {
        return payment.id === selectedId;
      }) || null;

      if (selectedRecord) {
        selectedAllocations = state.records.payAllocations.filter(function (allocation) {
          return helpers.getLookupId(allocation.Supplier_Payment) === selectedRecord.id;
        });
      }

      state.views.payments.page = page;
      state.views.payments.hasMore = hasMore;

      return {
        filters: filters,
        loadingInitial: Boolean(state.views.payments.loadingInitial),
        loadingMore: Boolean(state.views.payments.loadingMore),
        loadError: state.views.payments.loadError || "",
        onLoadMore: loadMorePayments,
        onRetry: loadMorePayments,
        filteredRecords: filteredRecords,
        visibleRecords: visibleRecords,
        selectedRecord: selectedRecord,
        selectedAllocations: selectedAllocations,
        detailAllocationView: detailAllocationView,
        selectedId: selectedId,
        selectedPaymentDetailTab: selectedPaymentDetailTab,
        page: page,
        hasMore: hasMore,
        pageSummary: filteredRecords.length + (filteredRecords.length === 1 ? " payment loaded" : " payments loaded"),
        countLabel: state.views.payments.hasLoaded
          ? filteredRecords.length + (filteredRecords.length === 1 ? " payment loaded" : " payments loaded")
          : "0 payments",
        statusOptions: ns.getWorkspaceStatusValues("payments", paymentView, buildCombinedStatusOptions(PAYMENT_STATUS_FILTER_OPTIONS, records, "Status").map(function (option) { return option.value; }))
          .map(function (value) { return { value: value, label: value }; }),
        emptyMessage: state.views.payments.loadingInitial
          ? "Loading payments..."
          : state.views.payments.hasLoaded || !hasCurrentFilters
          ? (hasMore ? "Searching payments..." : "No payments match the current filters.")
          : "Use the filters and click Load to fetch payments.",
        getPaymentReference: function (payment) {
          return helpers.getCandidateValue(payment, FIELD_CANDIDATES.payment.reference) || payment.Name || "Untitled payment";
        },
        getSupplierName: getSupplierNameFromPayment,
        getMfsp: getMfspFromPayment
      };
    }

    function buildPaymentAccountsView() {
      var records = state.views.paymentAccounts.browserRecords || [];
      var filters = state.views.paymentAccounts.filters;
      var hasContextLoaded = false, isContextLoading = false, isAccountsSectionActive = isPaymentAccountsSectionActive();
      var filteredRecords = records;
      var totalPages = Math.max(1, Math.ceil(filteredRecords.length / state.views.paymentAccounts.perPage));
      var page = Math.min(state.views.paymentAccounts.page, totalPages);
      var selectedId = state.views.paymentAccounts.selectedId;
      var start;
      var visibleRecords;
      var selectedRecord;
      var supplierOptions;

      if (!state.records.paymentAccounts.some(function (account) { return account.id === selectedId; })) {
        selectedId = "";
        state.views.paymentAccounts.selectedId = "";
      }

      selectedRecord = state.records.paymentAccounts.find(function (account) {
        return account.id === selectedId;
      }) || null;
      start = (page - 1) * state.views.paymentAccounts.perPage;
      visibleRecords = filteredRecords;

      supplierOptions = hasContextLoaded ? buildSupplierOptionsFromAccountMeta(records) : [];

      return auxiliaryView("paymentAccounts", {
        filters: filters,
        filteredRecords: filteredRecords,
        visibleRecords: visibleRecords,
        selectedRecord: selectedRecord,
        selectedId: selectedId,
        page: page,
        totalPages: totalPages,
        supplierOptions: supplierOptions,
        isContextReady: Boolean(selectedRecord && selectedRecord._browserMeta),
        isContextLoading: Boolean(selectedRecord && selectedRecord._contextLoading),
        statusOptions: buildStatusOptions(records, "Status"),
        emptyMessage: isAccountsSectionActive && state.isLoading
          ? "Loading payment accounts..."
          : state.views.paymentAccounts.hasLoaded
          ? "No payment accounts match the current filters."
          : "Open Payments and switch to Payment Accounts to load payment accounts.",
        getAccountName: function (account) {
          return helpers.getCandidateValue(account, FIELD_CANDIDATES.paymentAccount.name) || account.Name || "Untitled account";
        },
        getAccountMeta: getPaymentAccountMeta
      });
    }

    function buildPaymentAllocationsView() {
      var filters = state.views.paymentAllocations.filters;
      var records = state.views.paymentAllocations.browserRecords || [];
      var totalPages = 1, page = state.views.paymentAllocations.page || 1;
      var visibleRecords = records;
      var selectedId = state.views.paymentAllocations.selectedId;
      var selectedRecord;
      var movementTypes = helpers.sortStrings(helpers.uniqueNonEmpty(state.records.payAllocations.map(function (allocation) { return allocation.Movement_Type; })));

      if (!records.some(function (allocation) { return allocation.id === selectedId; })) {
        selectedId = records[0] ? records[0].id : "";
        state.views.paymentAllocations.selectedId = selectedId;
      }
      selectedRecord = records.filter(function (allocation) { return allocation.id === selectedId; })[0] || null;

      return auxiliaryView("paymentAllocations", {
        filters: filters,
        filteredRecords: records,
        visibleRecords: visibleRecords,
        selectedRecord: selectedRecord,
        selectedId: selectedId,
        movementTypes: movementTypes,
        page: page,
        totalPages: totalPages
      });
    }

    function selectPaymentAllocation(allocationId) {
      state.views.paymentAllocations.selectedId = allocationId || "";
      renderAll();
    }

    return {
      normalizeSection: normalizePaymentsSection,
      isAccountsSectionActive: isPaymentAccountsSectionActive,
      setSection: setPaymentsSection,
      loadTabData: loadPaymentsTabData,
      loadMore: loadMorePayments,
      cancel: cancelSearch,
      loadAuxiliary: loadAuxiliary,
      refreshTabData: refreshPaymentsTabData,
      refreshAccountsTabData: refreshPaymentAccountsTabData,
      buildView: buildPaymentsView,
      buildAccountsView: buildPaymentAccountsView,
      buildAllocationsView: buildPaymentAllocationsView,
      normalizeDetailTab: normalizePaymentDetailTab,
      setDetailTab: setPaymentDetailTab,
      selectPayment: selectPayment,
      closeDetail: closePaymentDetail,
      retryDetail: function () { return selectPayment(state.views.payments.selectedId); },
      selectPaymentAllocation: selectPaymentAllocation,
      selectPaymentAccount: selectPaymentAccount
    };
  };
}(window));
