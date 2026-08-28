(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createSupplierWorkspaceModule = function (deps) {
    var MODULES = deps.MODULES;
    var FIELD_CANDIDATES = deps.FIELD_CANDIDATES;
    var state = deps.state;
    var elements = deps.elements;
    var helpers = deps.helpers;
    var crm = deps.crm;
    var renderer = deps.renderer;
    var renderAll = deps.renderAll;
    var debugError = deps.debugError;
    var closeCreateInvoicePanel = deps.closeCreateInvoicePanel;
    var loadInvoicesForSupplier = deps.loadInvoicesForSupplier;
    var loadPaymentsForSupplier = deps.loadPaymentsForSupplier;
    var resetInvoiceCreateSettlementState = deps.resetInvoiceCreateSettlementState;
    var resetInvoiceCreateFormAfterCreate = deps.resetInvoiceCreateFormAfterCreate;
    var applyInvoiceCreateSupplierTaxDefaults = deps.applyInvoiceCreateSupplierTaxDefaults;
    var reloadInvoiceCreateSettlements = deps.reloadInvoiceCreateSettlements;

    function getSupplierSearchDisplayValue(record) {
      var connectionReference = helpers.getCandidateValue(record, FIELD_CANDIDATES.supplier.connectionReference);
      var supplierName = helpers.getCandidateValue(record, FIELD_CANDIDATES.supplier.name);

      return connectionReference || supplierName || helpers.buildSupplierLabel(record, FIELD_CANDIDATES);
    }

    async function bootstrapRecentSuppliers() {
      renderer.setLoading(true, "Loading suppliers...");

      try {
        state.recentSuppliers = await crm.getAllRecords(MODULES.suppliers, 1, 200);
        indexSuppliers(state.recentSuppliers);
        renderer.renderSupplierOptions();
      } catch (error) {
        debugError("bootstrapRecentSuppliers failed", error);
        renderer.showError("Could not load the initial supplier list from Zoho CRM.");
      } finally {
        renderer.setLoading(false);
      }
    }

    function indexSuppliers(records) {
      var index = {};

      records.forEach(function (record) {
        var label = helpers.buildSupplierLabel(record, FIELD_CANDIDATES);
        index[record.id] = record;
        index[label] = record;
        index[String(helpers.getCandidateValue(record, FIELD_CANDIDATES.supplier.name) || "").toLowerCase()] = record;
        index[String(helpers.getCandidateValue(record, FIELD_CANDIDATES.supplier.connectionReference) || "").toLowerCase()] = record;
        index[String(helpers.getCandidateValue(record, FIELD_CANDIDATES.supplier.ezusReference) || "").toLowerCase()] = record;
      });

      state.supplierIndex = index;
    }

    function cacheSupplierLookup(record) {
      var label = helpers.buildSupplierLabel(record, FIELD_CANDIDATES);
      state.supplierIndex[record.id] = record;
      state.supplierIndex[label] = record;
      state.supplierIndex[String(helpers.getCandidateValue(record, FIELD_CANDIDATES.supplier.name) || "").toLowerCase()] = record;
      state.supplierIndex[String(helpers.getCandidateValue(record, FIELD_CANDIDATES.supplier.connectionReference) || "").toLowerCase()] = record;
      state.supplierIndex[String(helpers.getCandidateValue(record, FIELD_CANDIDATES.supplier.ezusReference) || "").toLowerCase()] = record;
    }

    function getSupplierFromSearch() {
      var rawValue = elements.supplierSearch.value.trim();

      if (!rawValue) {
        return null;
      }

      return state.supplierIndex[rawValue] || state.supplierIndex[rawValue.toLowerCase()] || null;
    }

    async function onLoadSupplierClick() {
      var rawValue = elements.supplierSearch.value.trim();
      var supplier = getSupplierFromSearch();
      var matches;

      renderer.showError("");

      if (!rawValue) {
        renderer.hideSearchResults();
        renderer.showError("Enter a supplier name, connection reference or Ezus reference.");
        return;
      }

      if (!supplier) {
        matches = await searchSuppliers(rawValue);

        if (matches.length > 1) {
          renderer.showNotice("More than one supplier matches that search. Choose the correct one below.");
          renderer.renderSearchResults(matches, function (match) {
            cacheSupplierLookup(match);
            elements.supplierSearch.value = getSupplierSearchDisplayValue(match);
            renderer.hideSearchResults();
            loadSupplierWorkspace(match.id);
          });
          return;
        }

        supplier = matches[0] || null;
      }

      if (!supplier) {
        renderer.showSupplierSearchEmpty();
        return;
      }

      cacheSupplierLookup(supplier);
      renderer.hideSearchResults();
      await loadSupplierWorkspace(supplier.id);
    }

    async function searchSuppliers(rawQuery) {
      var query = String(rawQuery || "").trim();
      var escaped = helpers.escapeCriteriaValue(query);
      var requests = [];
      var results = [];
      var recentMatches;

      if (!query) {
        return [];
      }

      getSupplierSearchFieldApis().forEach(function (fieldApi) {
        requests.push(crm.searchRecord(MODULES.suppliers, "(" + fieldApi + ":equals:" + escaped + ")").catch(function () {
          return [];
        }));

        if (query.length >= 2) {
          requests.push(crm.searchRecord(MODULES.suppliers, "(" + fieldApi + ":starts_with:" + escaped + ")").catch(function () {
            return [];
          }));
        }
      });

      if (query.length >= 2) {
        requests.push(crm.searchWord(MODULES.suppliers, query).catch(function () {
          return [];
        }));
      }

      (await Promise.all(requests)).forEach(function (batch) {
        results = results.concat(batch || []);
      });

      recentMatches = state.recentSuppliers.filter(function (record) {
        return helpers.matchesSupplierQuery(record, query, FIELD_CANDIDATES);
      });
      results = results.concat(recentMatches);

      return helpers.sortSuppliersByQuery(
        helpers.dedupeById(results).filter(function (record) {
          return helpers.matchesSupplierQuery(record, query, FIELD_CANDIDATES);
        }),
        query,
        FIELD_CANDIDATES
      );
    }

    function getSupplierSearchFieldApis() {
      return [
        "Vendor_Name",
        "TP_Reference",
        "Ezus_Supplier_API"
      ];
    }

    async function loadSupplierWorkspace(supplierId) {
      var invoiceResult;
      var paymentResult;
      var previousSupplierId = String(state.supplierId || "").trim();
      var nextSupplierId = String(supplierId || "").trim();
      var shouldCloseInvoiceCreateOnSupplierChange = Boolean(
        state.invoiceCreation.isOpen &&
        previousSupplierId &&
        nextSupplierId &&
        previousSupplierId !== nextSupplierId
      );

      renderer.setLoading(true, "Loading supplier...");
      renderer.showError("");

      try {
        if (shouldCloseInvoiceCreateOnSupplierChange) {
          closeCreateInvoicePanel();
        }

        state.supplierId = supplierId;
        state.supplier = await crm.getRecord(MODULES.suppliers, supplierId);

        if (!state.supplier) {
          throw new Error("Supplier not found in CRM.");
        }

        cacheSupplierLookup(state.supplier);
        elements.supplierSearch.value = getSupplierSearchDisplayValue(state.supplier);
        state.supplierInfoTab = "basic";
        invoiceResult = loadInvoicesForSupplier(supplierId);
        paymentResult = loadPaymentsForSupplier(supplierId);
        state.supplierActivityTab = "invoices";
        state.supplierInvoices = [];
        state.supplierPayments = [];
        state.invoiceLinesByInvoiceId = {};
        state.invoiceLineLoadingId = "";
        await Promise.allSettled([invoiceResult, paymentResult]).then(function (results) {
          state.supplierInvoices = results[0].status === "fulfilled" ? results[0].value : [];
          state.supplierPayments = results[1].status === "fulfilled" ? results[1].value : [];
        });
        resetInvoiceCreateSettlementState();
        resetInvoiceCreateFormAfterCreate();
        applyInvoiceCreateSupplierTaxDefaults();

        if (state.invoiceCreation.isOpen && !shouldCloseInvoiceCreateOnSupplierChange) {
          await reloadInvoiceCreateSettlements();
        }

        renderAll();
        renderer.showNotice(
          (state.supplierInvoices.length || state.supplierPayments.length)
            ? "Supplier loaded. Use the integrated invoice form or review related activity on the right."
            : "Supplier loaded. This supplier does not have related invoices or payments yet."
        );
      } catch (error) {
        debugError("loadSupplierWorkspace failed", error, {
          supplierId: supplierId
        });
        state.supplier = null;
        state.supplierId = "";
        state.supplierInvoices = [];
        state.supplierPayments = [];
        state.supplierInfoTab = "basic";
        state.invoiceCreation.isOpen = false;
        resetInvoiceCreateSettlementState();
        renderAll();
        renderer.showError(error.message || "Could not load the supplier workspace.");
      } finally {
        renderer.setLoading(false);
      }
    }

    function clearSupplierWorkspace(options) {
      var settings = options || {};

      state.supplier = null;
      state.supplierId = "";
      state.supplierInvoices = [];
      state.supplierPayments = [];
      state.supplierInfoTab = "basic";
      state.supplierActivityTab = "invoices";
      state.invoiceCreation.isOpen = false;
      state.invoiceLinesByInvoiceId = {};
      state.invoiceLineLoadingId = "";
      resetInvoiceCreateSettlementState();
      resetInvoiceCreateFormAfterCreate();
      elements.supplierSearch.value = "";
      renderer.hideSearchResults();
      renderAll();

      if (settings.showNotice !== false) {
        renderer.showNotice("Supplier closed. Search another one when you want.", {
          tone: "success"
        });
      }
    }

    function onCloseSupplierWorkspaceClick() {
      renderer.showError("");
      clearSupplierWorkspace();
    }

    return {
      getSearchDisplayValue: getSupplierSearchDisplayValue,
      bootstrapRecentSuppliers: bootstrapRecentSuppliers,
      cacheSupplierLookup: cacheSupplierLookup,
      onLoadSupplierClick: onLoadSupplierClick,
      loadSupplierWorkspace: loadSupplierWorkspace,
      clearSupplierWorkspace: clearSupplierWorkspace,
      onCloseSupplierWorkspaceClick: onCloseSupplierWorkspaceClick
    };
  };
}(window));
