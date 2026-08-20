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

    async function setAccountingTab(tabName) {
      var normalizedTab = normalizeAccountingTab(tabName);

      state.accountingTab = normalizedTab;
      renderAll();

      if (state.currentTab === "accounting" && (normalizedTab === "accounts" || normalizedTab === "rules")) {
        await ensureTabDataLoaded("accounting");
        renderAll();
      }
    }

    async function refreshAccountingAccountsTabData() {
      renderer.showError("");
      renderer.showNotice("Refreshing accounting accounts...", {
        isLoading: true
      });
      renderer.setLoading(true, "Refreshing accounting accounts...");
      renderAll();

      try {
        state.loaded.accountingAccounts = false;
        state.records.accountingAccounts = [];
        await ensureAccountingAccountsLoaded();
        renderAll();
      } catch (error) {
        renderer.showError(error.message || "Could not refresh accounting accounts.");
      } finally {
        renderer.setLoading(false);
        renderer.showNotice("");
      }
    }

    async function loadAccountingEntriesTabData(options) {
      var settings = options || {};

      if (!settings.preservePage) {
        state.views.accountingEntries.page = 1;
        state.views.accountingEntries.appliedFilters = cloneFilterState(state.views.accountingEntries.filters);
      }
      await refreshAccountingEntriesTabData();
    }

    async function refreshAccountingEntriesTabData() {
      renderer.showError("");
      renderer.showNotice("Loading accounting entries...", {
        isLoading: true
      });
      renderer.setLoading(true, "Loading accounting entries...");
      renderAll();

      try {
        state.loaded.accountingEntries = false;
        state.views.accountingEntries.hasMore = false;
        state.records.accountingEntries = [];
        await ensureAccountingEntriesLoaded();
        state.views.accountingEntries.hasLoaded = true;
        renderAll();
      } catch (error) {
        renderer.showError(error.message || "Could not load accounting entries.");
      } finally {
        renderer.setLoading(false);
        renderer.showNotice("");
      }
    }

    async function loadAccountingEntryLinesTabData(options) {
      var settings = options || {};

      if (!settings.preservePage) {
        state.views.accountingEntryLines.page = 1;
        state.views.accountingEntryLines.appliedFilters = cloneFilterState(state.views.accountingEntryLines.filters);
      }
      await refreshAccountingEntryLinesTabData();
    }

    async function refreshAccountingEntryLinesTabData() {
      renderer.showError("");
      renderer.showNotice("Loading accounting entry lines...", {
        isLoading: true
      });
      renderer.setLoading(true, "Loading accounting entry lines...");
      renderAll();

      try {
        state.loaded.accountingEntryLines = false;
        state.views.accountingEntryLines.hasMore = false;
        state.records.accountingEntryLines = [];
        await ensureAccountingEntryLinesLoaded();
        await ensureAccountingAccountsLoaded();
        state.views.accountingEntryLines.hasLoaded = true;
        renderAll();
      } catch (error) {
        renderer.showError(error.message || "Could not load accounting entry lines.");
      } finally {
        renderer.setLoading(false);
        renderer.showNotice("");
      }
    }

    async function refreshAccountingRulesTabData() {
      renderer.showError("");
      renderer.showNotice("Refreshing accounting rules...", {
        isLoading: true
      });
      renderer.setLoading(true, "Refreshing accounting rules...");
      renderAll();

      try {
        state.loaded.accountingRules = false;
        state.records.accountingRules = [];
        await ensureAccountingRulesLoaded();
        renderAll();
      } catch (error) {
        renderer.showError(error.message || "Could not refresh accounting rules.");
      } finally {
        renderer.setLoading(false);
        renderer.showNotice("");
      }
    }

    function buildAccountingEntriesView() {
      return {
        records: getSortedAccountingEntriesRecords(state.records.accountingEntries, state.views.accountingEntries.sort),
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
      };
    }

    function buildAccountingEntryLinesView() {
      return {
        records: getSortedAccountingEntryLinesRecords(state.records.accountingEntryLines, state.views.accountingEntryLines.sort),
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
      };
    }

    function buildAccountingAccountsView() {
      var records = state.records.accountingAccounts;
      var totalPages = Math.max(1, Math.ceil(records.length / state.views.accountingAccounts.perPage));
      var page = Math.min(state.views.accountingAccounts.page, totalPages);
      var selectedId = state.views.accountingAccounts.selectedId;
      var start;
      var visibleRecords;
      var selectedRecord;

      if (!records.some(function (account) { return account.id === selectedId; })) {
        selectedId = "";
        state.views.accountingAccounts.selectedId = "";
      }

      selectedRecord = records.find(function (account) {
        return account.id === selectedId;
      }) || null;
      start = (page - 1) * state.views.accountingAccounts.perPage;
      visibleRecords = records.slice(start, start + state.views.accountingAccounts.perPage);
      state.views.accountingAccounts.page = page;

      return {
        records: records,
        visibleRecords: visibleRecords,
        selectedRecord: selectedRecord,
        selectedId: selectedId,
        page: page,
        totalPages: totalPages,
        emptyMessage: state.currentTab === "accounting" && state.accountingTab === "accounts" && state.isLoading
          ? "Loading accounting accounts..."
          : state.loaded.accountingAccounts
          ? "No accounting accounts were found."
          : "Open the tab to load accounting accounts."
      };
    }

    function buildAccountingRulesView() {
      var records = state.records.accountingRules;
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
      visibleRecords = records.slice(start, start + state.views.accountingRules.perPage);
      state.views.accountingRules.page = page;

      return {
        records: records,
        visibleRecords: visibleRecords,
        selectedRecord: selectedRecord,
        selectedId: selectedId,
        page: page,
        totalPages: totalPages,
        emptyMessage: state.currentTab === "accounting" && state.accountingTab === "rules" && state.isLoading
          ? "Loading accounting rules..."
          : state.loaded.accountingRules
          ? "No accounting rules were found."
          : "Open the tab to load accounting rules."
      };
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
