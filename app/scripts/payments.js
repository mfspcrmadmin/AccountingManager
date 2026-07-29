(function (global) {
var ns = global.PurchasesManagerApp = global.PurchasesManagerApp || {};

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

    function normalizePaymentsSection(sectionName) {
      return sectionName === "accounts" || sectionName === "allocations" ? sectionName : "payments";
    }

    function isPaymentAccountsSectionActive() {
      return state.currentTab === "payments" &&
        normalizePaymentsSection(state.views.payments.section) === "accounts";
    }

    async function setPaymentsSection(sectionName) {
      var nextSection = normalizePaymentsSection(sectionName);

      state.views.payments.section = nextSection;
      state.currentTab = "payments";
      renderAll();

      if (nextSection === "accounts" || nextSection === "allocations") {
        await ensureTabDataLoaded("payments");
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

    async function refreshPaymentsTabData() {
      var options = arguments[0] || {};

      renderer.showError("");
      renderer.showNotice(options.loadingLabel || "Loading payments...", {
        isLoading: true
      });
      renderer.setLoading(true, options.loadingLabel || "Loading payments...");
      renderAll();

      try {
        state.loaded.payments = false;
        state.loaded.payAllocations = false;
        state.views.payments.hasMore = false;
        state.records.payments = [];
        state.records.payAllocations = [];
        resetPaymentRelationshipIndexes();
        await ensurePayAllocationsLoaded();
        await ensurePaymentsLoaded();
        state.views.payments.hasLoaded = options.loadedFlag !== false;
        renderAll();
      } catch (error) {
        debugError("refreshPaymentsTabData failed", error, {
          filters: cloneFilterState(state.views.payments.appliedFilters || state.views.payments.filters)
        });
        renderer.showError(getFriendlyLoadErrorMessage("payments", error, options.errorMessage || "Could not refresh payments."));
      } finally {
        renderer.setLoading(false);
        renderer.showNotice("");
      }
    }

    async function refreshPaymentAccountsTabData() {
      renderer.showError("");
      renderer.showNotice("Refreshing payment accounts...", {
        isLoading: true
      });
      renderer.setLoading(true, "Refreshing payment accounts...");
      renderAll();

      try {
        state.loaded.payments = false;
        state.loaded.payAllocations = false;
        state.loaded.paymentAccounts = false;
        state.loaded.paymentAccountsContext = false;
        state.views.payments.hasMore = false;
        state.records.payments = [];
        state.records.payAllocations = [];
        state.records.paymentAccounts = [];
        resetPaymentRelationshipIndexes();
        await ensurePaymentAccountsLoaded();
        requestPaymentAccountsContextLoad();
        renderAll();
      } catch (error) {
        renderer.showError(error.message || "Could not refresh payment accounts.");
      } finally {
        renderer.setLoading(false);
        renderer.showNotice("");
      }
    }

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

    function selectPayment(paymentId) {
      if (String(state.paymentLetter.paymentId || "") !== String(paymentId || "")) {
        deps.closeSelectedPaymentLetterPanel();
      }

      state.views.payments.selectedId = paymentId || "";
      renderAll();
    }

    function selectPaymentAccount(accountId) {
      state.views.paymentAccounts.selectedId = accountId || "";
      renderAll();
    }

    function getPaymentAccountMeta(account) {
      if (!account || !account.id) {
        return createEmptyPaymentAccountMeta();
      }

      return state.indexes.paymentAccountMetaById[account.id] || createEmptyPaymentAccountMeta();
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
      var records = state.records.payments.slice();
      var filters = cloneFilterState(state.views.payments.filters);
      var appliedFilters = cloneFilterState(state.views.payments.appliedFilters || state.views.payments.filters);
      var selectedPaymentDetailTab = normalizePaymentDetailTab(state.views.payments.detailTab || "payment");
      var hasCurrentFilters = hasAnyLoadFilterValue(filters);
      var selectedStatuses = getNormalizedStatusFilterValues(appliedFilters.statusValues);
      var filteredRecords = records.filter(function (payment) {
        var paymentDate = helpers.toIsoDate(payment.Payment_Date);

        if (selectedStatuses.length && selectedStatuses.indexOf(String(payment.Status || "")) === -1) {
          return false;
        }

        if (appliedFilters.dateFrom && (!paymentDate || paymentDate < appliedFilters.dateFrom)) {
          return false;
        }

        if (appliedFilters.dateTo && (!paymentDate || paymentDate > appliedFilters.dateTo)) {
          return false;
        }

        if (appliedFilters.mfsp && !helpers.matchesText(getMfspFromPayment(payment), appliedFilters.mfsp)) {
          return false;
        }

        if (appliedFilters.supplierCode && !getPaymentSupplierCodeValues(payment).some(function (value) {
          return helpers.matchesText(value, appliedFilters.supplierCode);
        })) {
          return false;
        }

        return true;
      });
      var totalPages = Math.max(1, Math.ceil(filteredRecords.length / state.views.payments.perPage));
      var page = Math.min(Math.max(1, Number(state.views.payments.page) || 1), totalPages);
      var hasMore = page < totalPages;
      var selectedId = state.views.payments.selectedId;
      var visibleRecords = filteredRecords.slice(
        (page - 1) * state.views.payments.perPage,
        page * state.views.payments.perPage
      );
      var selectedRecord;
      var selectedAllocations = [];

      if (!filteredRecords.some(function (payment) { return payment.id === selectedId; })) {
        selectedId = filteredRecords[0] ? filteredRecords[0].id : "";
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
        filteredRecords: filteredRecords,
        visibleRecords: visibleRecords,
        selectedRecord: selectedRecord,
        selectedAllocations: selectedAllocations,
        selectedId: selectedId,
        selectedPaymentDetailTab: selectedPaymentDetailTab,
        page: page,
        hasMore: hasMore,
        pageSummary: buildLocalPageSummary(page, totalPages),
        countLabel: state.views.payments.hasLoaded
          ? filteredRecords.length + (filteredRecords.length === 1 ? " payment" : " payments")
          : "0 payments",
        statusOptions: buildCombinedStatusOptions(PAYMENT_STATUS_FILTER_OPTIONS, filteredRecords, "Status"),
        emptyMessage: state.currentTab === "payments" && state.isLoading
          ? "Loading payments..."
          : state.views.payments.hasLoaded || !hasCurrentFilters
          ? "No payments match the current filters."
          : "Use the filters and click Load to fetch payments.",
        getPaymentReference: function (payment) {
          return helpers.getCandidateValue(payment, FIELD_CANDIDATES.payment.reference) || payment.Name || "Untitled payment";
        },
        getSupplierName: getSupplierNameFromPayment,
        getMfsp: getMfspFromPayment
      };
    }

    function buildPaymentAccountsView() {
      var records = state.records.paymentAccounts;
      var filters = state.views.paymentAccounts.filters;
      var hasContextLoaded = Boolean(state.loaded.paymentAccountsContext);
      var isContextLoading = Boolean(getPaymentAccountsContextLoading && getPaymentAccountsContextLoading());
      var isAccountsSectionActive = isPaymentAccountsSectionActive();
      var filteredRecords = records.filter(function (account) {
        var meta = hasContextLoaded ? getPaymentAccountMeta(account) : null;

        if (
          filters.query &&
          !helpers.matchesText(account.Name, filters.query) &&
          !helpers.matchesText(account.Email, filters.query)
        ) {
          return false;
        }

        if (hasContextLoaded && filters.supplierId && meta.supplierIds.indexOf(filters.supplierId) === -1) {
          return false;
        }

        if (hasContextLoaded && filters.mfsp && !meta.mfsps.some(function (mfsp) {
          return helpers.matchesText(mfsp, filters.mfsp);
        })) {
          return false;
        }

        if (filters.status && String(account.Status || "") !== String(filters.status)) {
          return false;
        }

        return true;
      });
      var totalPages = Math.max(1, Math.ceil(filteredRecords.length / state.views.paymentAccounts.perPage));
      var page = Math.min(state.views.paymentAccounts.page, totalPages);
      var selectedId = state.views.paymentAccounts.selectedId;
      var start;
      var visibleRecords;
      var selectedRecord;
      var supplierOptions;

      if (!filteredRecords.some(function (account) { return account.id === selectedId; })) {
        selectedId = "";
        state.views.paymentAccounts.selectedId = "";
      }

      selectedRecord = filteredRecords.find(function (account) {
        return account.id === selectedId;
      }) || null;
      start = (page - 1) * state.views.paymentAccounts.perPage;
      visibleRecords = filteredRecords.slice(start, start + state.views.paymentAccounts.perPage);
      state.views.paymentAccounts.page = page;
      supplierOptions = hasContextLoaded ? buildSupplierOptionsFromAccountMeta(records) : [];

      return {
        filters: filters,
        filteredRecords: filteredRecords,
        visibleRecords: visibleRecords,
        selectedRecord: selectedRecord,
        selectedId: selectedId,
        page: page,
        totalPages: totalPages,
        supplierOptions: supplierOptions,
        isContextReady: hasContextLoaded,
        isContextLoading: isContextLoading,
        statusOptions: buildStatusOptions(records, "Status"),
        emptyMessage: isAccountsSectionActive && state.isLoading
          ? "Loading payment accounts..."
          : state.loaded.paymentAccounts
          ? "No payment accounts match the current filters."
          : "Open Payments and switch to Payment Accounts to load payment accounts.",
        getAccountName: function (account) {
          return helpers.getCandidateValue(account, FIELD_CANDIDATES.paymentAccount.name) || account.Name || "Untitled account";
        },
        getAccountMeta: getPaymentAccountMeta
      };
    }

    function buildPaymentAllocationsView() {
      var filters = state.views.paymentAllocations.filters;
      var records = state.records.payAllocations.filter(function (allocation) {
        return (!filters.reference || helpers.matchesText(allocation.Name, filters.reference)) &&
          (!filters.movementType || String(allocation.Movement_Type || "") === filters.movementType) &&
          (!filters.payment || helpers.matchesText(helpers.getLookupName(allocation.Supplier_Payment), filters.payment)) &&
          (!filters.invoice || helpers.matchesText(helpers.getLookupName(allocation.Supplier_Invoice), filters.invoice)) &&
          (!filters.supplierCode || helpers.matchesText(helpers.getLookupName(allocation.Supplier_Settlement), filters.supplierCode));
      });
      var totalPages = Math.max(1, Math.ceil(records.length / state.views.paymentAllocations.perPage));
      var page = Math.min(Math.max(1, Number(state.views.paymentAllocations.page) || 1), totalPages);
      var visibleRecords = records.slice(
        (page - 1) * state.views.paymentAllocations.perPage,
        page * state.views.paymentAllocations.perPage
      );
      var selectedId = state.views.paymentAllocations.selectedId;
      var selectedRecord;
      var movementTypes = helpers.sortStrings(helpers.uniqueNonEmpty(state.records.payAllocations.map(function (allocation) { return allocation.Movement_Type; })));

      if (!records.some(function (allocation) { return allocation.id === selectedId; })) {
        selectedId = records[0] ? records[0].id : "";
        state.views.paymentAllocations.selectedId = selectedId;
      }
      selectedRecord = records.filter(function (allocation) { return allocation.id === selectedId; })[0] || null;
      state.views.paymentAllocations.page = page;
      return {
        filters: filters,
        filteredRecords: records,
        visibleRecords: visibleRecords,
        selectedRecord: selectedRecord,
        selectedId: selectedId,
        movementTypes: movementTypes,
        page: page,
        totalPages: totalPages
      };
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
      refreshTabData: refreshPaymentsTabData,
      refreshAccountsTabData: refreshPaymentAccountsTabData,
      buildView: buildPaymentsView,
      buildAccountsView: buildPaymentAccountsView,
      buildAllocationsView: buildPaymentAllocationsView,
      normalizeDetailTab: normalizePaymentDetailTab,
      setDetailTab: setPaymentDetailTab,
      selectPayment: selectPayment,
      selectPaymentAllocation: selectPaymentAllocation,
      selectPaymentAccount: selectPaymentAccount
    };
  };
}(window));
