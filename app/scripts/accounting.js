(function (global) {
var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createAccountingModule = function (deps) {
    var state = deps.state;
    var renderer = deps.renderer;
    var renderAll = deps.renderAll;
    var cloneFilterState = deps.cloneFilterState;
    var ensureTabDataLoaded = deps.ensureTabDataLoaded;
    var ensureAccountingAccountsLoaded = deps.ensureAccountingAccountsLoaded;
    var ensureAccountingEntriesLoaded = deps.ensureAccountingEntriesLoaded;
    var ensureAccountingEntryLinesLoaded = deps.ensureAccountingEntryLinesLoaded;
    var ensureAccountingRulesLoaded = deps.ensureAccountingRulesLoaded;
    var getSortedAccountingEntriesRecords = deps.getSortedAccountingEntriesRecords;
    var getSortedAccountingEntryLinesRecords = deps.getSortedAccountingEntryLinesRecords;

    function normalizeAccountingTab(tabName) {
      if (tabName === "lines" || tabName === "accounts" || tabName === "rules") {
        return tabName;
      }

      return "entries";
    }

    var keys = { entries: "accountingEntries", lines: "accountingEntryLines", accounts: "accountingAccounts", rules: "accountingRules" };
    var queries = {};
    Object.keys(keys).forEach(function (tab) {
      var key = keys[tab], view = state.views[key];
      queries[key] = ns.createProgressiveQuery({
        view: view,
        getRecords: function () { return view.browserRecords || []; },
        setRecords: function (records) { view.browserRecords = records; if (tab === "entries" || tab === "lines") { state.records[key] = records; } else { var byId = new Map(state.records[key].map(function (r) { return [String(r.id), r]; })); records.forEach(function (r) { byId.set(String(r.id), r); }); state.records[key] = Array.from(byId.values()); } },
        fetch: function (query) { return deps.fetchPage(key, query); },
        render: renderAll,
        resetScroll: function () { var wrap = deps.elements[key + "TableWrap"]; if (wrap) { wrap.scrollTop = 0; } }
      });
    });
    function refresh(key, apply) {
      var view = state.views[key];
      if (apply || !view.appliedFilters) { view.appliedFilters = cloneFilterState(view.filters || {}); }
      return queries[key].reset({ filters: view.appliedFilters, sort: view.sort || { key: "date", direction: "desc" }, perPage: view.perPage || 50 });
    }
    function cancel() { Object.keys(queries).forEach(function (key) { queries[key].cancel(); }); }
    async function setAccountingTab(tabName) {
      cancel();
      state.accountingTab = normalizeAccountingTab(tabName);
      return refresh(keys[state.accountingTab]);
    }
    function refreshAccountingAccountsTabData() { return refresh("accountingAccounts"); }
    function loadAccountingEntriesTabData() { return refresh("accountingEntries", true); }
    function refreshAccountingEntriesTabData() { return refresh("accountingEntries"); }
    function loadAccountingEntryLinesTabData() { return refresh("accountingEntryLines", true); }
    function refreshAccountingEntryLinesTabData() { return refresh("accountingEntryLines"); }
    function refreshAccountingRulesTabData() { return refresh("accountingRules"); }
    function progressiveView(key, result) {
      var view = state.views[key];
      return Object.assign(result, {
        loadingInitial: view.loadingInitial, loadingMore: view.loadingMore,
        loadError: view.loadError, hasMore: view.hasMore, onLoadMore: queries[key].more,
        countLabel: (view.browserRecords || []).length + " records loaded"
      });
    }

    function buildAccountingEntriesView() {
      return progressiveView("accountingEntries", {
        records: state.views.accountingEntries.browserRecords || [],
        page: state.views.accountingEntries.page || 1,
        hasMore: Boolean(state.views.accountingEntries.hasMore),
        pageSummary: state.views.accountingEntries.pageSummary || "Page 1",
        sort: state.views.accountingEntries.sort || {
          key: "date",
          direction: "desc"
        },
        countLabel: state.views.accountingEntries.hasLoaded
          ? (state.views.accountingEntries.countLabel || "0 entries")
          : "0 entries",
        emptyMessage: state.currentTab === "accounting" && state.accountingTab === "entries" && state.isLoading
          ? "Loading accounting entries..."
          : state.views.accountingEntries.hasLoaded
          ? "No accounting entries match the current filters."
          : "Use the filters and click Load to fetch accounting entries."
      });
    }

    function buildAccountingEntryLinesView() {
      return progressiveView("accountingEntryLines", {
        records: state.views.accountingEntryLines.browserRecords || [],
        page: state.views.accountingEntryLines.page || 1,
        hasMore: Boolean(state.views.accountingEntryLines.hasMore),
        pageSummary: state.views.accountingEntryLines.pageSummary || "Page 1",
        sort: state.views.accountingEntryLines.sort || {
          key: "date",
          direction: "desc"
        },
        countLabel: state.views.accountingEntryLines.hasLoaded
          ? (state.views.accountingEntryLines.countLabel || "0 lines")
          : "0 lines",
        emptyMessage: state.currentTab === "accounting" && state.accountingTab === "lines" && state.isLoading
          ? "Loading accounting entry lines..."
          : state.views.accountingEntryLines.hasLoaded
          ? "No accounting entry lines match the current filters."
          : "Use the filters and click Load to fetch accounting entry lines."
      });
    }

    function buildAccountingAccountsView() {
      var records = state.views.accountingAccounts.browserRecords || [];
      var totalPages = Math.max(1, Math.ceil(records.length / state.views.accountingAccounts.perPage));
      var page = Math.min(state.views.accountingAccounts.page, totalPages);
      var selectedId = state.views.accountingAccounts.selectedId;
      var start;
      var visibleRecords;
      var selectedRecord;

      if (!state.records.accountingAccounts.some(function (account) { return account.id === selectedId; })) {
        selectedId = "";
        state.views.accountingAccounts.selectedId = "";
      }

      selectedRecord = state.records.accountingAccounts.find(function (account) {
        return account.id === selectedId;
      }) || null;
      start = (page - 1) * state.views.accountingAccounts.perPage;
      visibleRecords = records;


      return progressiveView("accountingAccounts", {
        records: records,
        visibleRecords: visibleRecords,
        selectedRecord: selectedRecord,
        selectedId: selectedId,
        page: page,
        totalPages: totalPages,
        emptyMessage: state.currentTab === "accounting" && state.accountingTab === "accounts" && state.isLoading
          ? "Loading accounting accounts..."
          : state.views.accountingAccounts.hasLoaded
          ? "No accounting accounts were found."
          : "Open the tab to load accounting accounts."
      });
    }

    function buildAccountingRulesView() {
      var records = state.views.accountingRules.browserRecords || [];
      var totalPages = Math.max(1, Math.ceil(records.length / state.views.accountingRules.perPage));
      var page = Math.min(state.views.accountingRules.page, totalPages);
      var selectedId = state.views.accountingRules.selectedId;
      var start;
      var visibleRecords;
      var selectedRecord;

      if (!records.some(function (rule) { return rule.id === selectedId; })) {
        selectedId = "";
        state.views.accountingRules.selectedId = "";
      }

      selectedRecord = records.find(function (rule) {
        return rule.id === selectedId;
      }) || null;
      start = (page - 1) * state.views.accountingRules.perPage;
      visibleRecords = records;


      return progressiveView("accountingRules", {
        records: records,
        visibleRecords: visibleRecords,
        selectedRecord: selectedRecord,
        selectedId: selectedId,
        page: page,
        totalPages: totalPages,
        emptyMessage: state.currentTab === "accounting" && state.accountingTab === "rules" && state.isLoading
          ? "Loading accounting rules..."
          : state.views.accountingRules.hasLoaded
          ? "No accounting rules were found."
          : "Open the tab to load accounting rules."
      });
    }

    function selectAccountingAccount(accountId) {
      state.views.accountingAccounts.selectedId = accountId || "";
      renderAll();
    }

    function selectAccountingRule(ruleId) {
      state.views.accountingRules.selectedId = ruleId || "";
      renderAll();
    }

    return {
      normalizeTab: normalizeAccountingTab,
      cancel: cancel,
      setTab: setAccountingTab,
      refreshAccountsTabData: refreshAccountingAccountsTabData,
      loadEntriesTabData: loadAccountingEntriesTabData,
      refreshEntriesTabData: refreshAccountingEntriesTabData,
      loadEntryLinesTabData: loadAccountingEntryLinesTabData,
      refreshEntryLinesTabData: refreshAccountingEntryLinesTabData,
      refreshRulesTabData: refreshAccountingRulesTabData,
      buildEntriesView: buildAccountingEntriesView,
      buildEntryLinesView: buildAccountingEntryLinesView,
      buildAccountsView: buildAccountingAccountsView,
      buildRulesView: buildAccountingRulesView,
      selectAccount: selectAccountingAccount,
      selectRule: selectAccountingRule
    };
  };
}(window));
