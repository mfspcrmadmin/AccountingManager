(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createDashboardModule = function (deps) {
    var MODULES = deps.MODULES;
    var FIELD_CANDIDATES = deps.FIELD_CANDIDATES;
    var INVOICE_COQL_FIELDS = deps.INVOICE_COQL_FIELDS;
    var SETTLEMENT_FIELDS = deps.SETTLEMENT_FIELDS;
    var state = deps.state;
    var helpers = deps.helpers;
    var renderer = deps.renderer;
    var renderAll = deps.renderAll;
    var setCurrentTab = deps.setCurrentTab;
    var loadSupplierWorkspace = deps.loadSupplierWorkspace;
    var buildInvoiceRemoteWhereClause = deps.buildInvoiceRemoteWhereClause;
    var buildInvoiceRemoteOrderByClause = deps.buildInvoiceRemoteOrderByClause;
    var buildCoqlOrEqualsClause = deps.buildCoqlOrEqualsClause;
    var loadRecordsByCoql = deps.loadRecordsByCoql;
    var loadRecordsByPagination = deps.loadRecordsByPagination;
    var normalizeSettlements = deps.normalizeSettlements;
    var compareValues = deps.compareValues;
    var roundCurrency = deps.roundCurrency;
    var getSettlementMfsp = deps.getSettlementMfsp;
    var getInvoiceCreateSettlementUnpaidInvoicedAmount = deps.getInvoiceCreateSettlementUnpaidInvoicedAmount;
    var getInvoiceCreateSettlementRemainingToInvoice = deps.getInvoiceCreateSettlementRemainingToInvoice;

    var dashboardLoadPromise = null;

    function getSettlementRemainingToPay(settlement) {
      return Math.max(0, getInvoiceCreateSettlementUnpaidInvoicedAmount(settlement));
    }

    function getSettlementRemainingToInvoice(settlement) {
      return Math.max(0, getInvoiceCreateSettlementRemainingToInvoice(settlement));
    }

    function isDashboardInvoicePending(invoice) {
      var status = String(invoice && invoice.Status || "").toLowerCase();
      var pendingAmount = roundCurrency(helpers.getInvoicePendingAmount(invoice, FIELD_CANDIDATES));

      if (pendingAmount <= 0) {
        return false;
      }

      return status.indexOf("paid") === -1 &&
        status.indexOf("cancel") === -1 &&
        status.indexOf("reject") === -1;
    }

    function isDashboardSettlementPending(settlement) {
      var status = String(settlement && settlement.Admin_Status || "").toLowerCase();

      if (status.indexOf("paid") !== -1 || status.indexOf("cancel") !== -1 || status.indexOf("no services") !== -1) {
        return false;
      }

      return getSettlementRemainingToPay(settlement) > 0 || getSettlementRemainingToInvoice(settlement) > 0;
    }

    async function refreshDashboardTabData() {
      renderer.showError("");
      renderer.showNotice("Refreshing dashboard...", {
        isLoading: true
      });
      renderer.setLoading(true, "Refreshing dashboard...");
      renderAll();

      try {
        state.dashboard.loaded = false;
        state.dashboard.pendingInvoices = [];
        state.dashboard.pendingSettlements = [];
        await ensureDashboardDataLoaded(true);
        renderAll();
      } catch (error) {
        renderer.showError(error.message || "Could not refresh the dashboard.");
      } finally {
        renderer.setLoading(false);
        renderer.showNotice("");
        renderAll();
      }
    }

    async function openSupplierFromDashboard(supplierId) {
      if (!supplierId) {
        renderer.showError("This dashboard row is missing the supplier reference.");
        return;
      }

      renderer.showError("");
      await setCurrentTab("suppliers");
      await loadSupplierWorkspace(supplierId);
    }

    function onDashboardSuppliersTableClick(event) {
      var trigger = event.target.closest("[data-dashboard-supplier-id]");

      if (!trigger) {
        return;
      }

      openSupplierFromDashboard(trigger.getAttribute("data-dashboard-supplier-id"));
    }

    function onDashboardTripsTableClick(event) {
      var trigger = event.target.closest("[data-dashboard-supplier-id]");

      if (!trigger) {
        return;
      }

      openSupplierFromDashboard(trigger.getAttribute("data-dashboard-supplier-id"));
    }

    async function ensureDashboardDataLoaded(forceReload) {
      var shouldForceReload = Boolean(forceReload);

      if (!shouldForceReload && state.dashboard.loaded) {
        return;
      }

      if (dashboardLoadPromise) {
        return dashboardLoadPromise;
      }

      dashboardLoadPromise = (async function () {
        var pendingInvoiceWhereClause = await buildInvoiceRemoteWhereClause({}, {
          pendingOnly: true
        });
        var pendingSettlementWhereClause = buildCoqlOrEqualsClause("Admin_Status", [
          "Pending Invoice",
          "Partially Accounted",
          "Accounted",
          "Partially Paid"
        ]);
        var pendingInvoices = [];
        var pendingSettlements = [];

        try {
          pendingInvoices = helpers.dedupeById(await loadRecordsByCoql(MODULES.invoices, INVOICE_COQL_FIELDS, {
            whereClause: pendingInvoiceWhereClause,
            orderByClause: await buildInvoiceRemoteOrderByClause({
              key: "date",
              direction: "desc"
            })
          }));
        } catch (invoiceError) {
          pendingInvoices = (await loadRecordsByPagination(MODULES.invoices)).filter(isDashboardInvoicePending);
        }

        try {
          pendingSettlements = normalizeSettlements(helpers.dedupeById(await loadRecordsByCoql(MODULES.settlements, SETTLEMENT_FIELDS, {
            whereClause: pendingSettlementWhereClause,
            orderByClause: "First_Service_Date desc"
          })));
        } catch (settlementError) {
          pendingSettlements = normalizeSettlements((await loadRecordsByPagination(MODULES.settlements)).filter(isDashboardSettlementPending));
        }

        state.dashboard.pendingInvoices = pendingInvoices.filter(isDashboardInvoicePending);
        state.dashboard.pendingSettlements = pendingSettlements.filter(isDashboardSettlementPending);
        state.dashboard.loaded = true;
      }()).finally(function () {
        dashboardLoadPromise = null;
      });

      return dashboardLoadPromise;
    }

    function buildDashboardView() {
      var pendingInvoices = state.dashboard.pendingInvoices || [];
      var pendingSettlements = state.dashboard.pendingSettlements || [];
      var pendingSupplierBuckets = {};
      var pendingSuppliers = [];
      var pendingTrips = [];
      var supplierTotals = {
        count: 0,
        amount: 0
      };
      var tripTotals = {
        readyCount: 0,
        readyAmount: 0,
        toInvoiceCount: 0,
        toInvoiceAmount: 0
      };
      var suppliersEmptyMessage;
      var tripsEmptyMessage;

      pendingInvoices.forEach(function (invoice) {
        var pendingAmount;
        var supplierKey;
        var bucket;
        var bookingKey;
        var invoiceDate;

        if (!isDashboardInvoicePending(invoice)) {
          return;
        }

        pendingAmount = roundCurrency(helpers.getInvoicePendingAmount(invoice, FIELD_CANDIDATES));
        supplierKey = helpers.getLookupId(invoice.Supplier) || String(invoice.Supplier_Name || invoice.id || "");

        if (!supplierKey) {
          return;
        }

        if (!pendingSupplierBuckets[supplierKey]) {
          pendingSupplierBuckets[supplierKey] = {
            supplierId: helpers.getLookupId(invoice.Supplier),
            supplierName: invoice.Supplier_Name || helpers.getLookupName(invoice.Supplier) || "Unknown supplier",
            pendingAmount: 0,
            openInvoicesCount: 0,
            tripKeys: {},
            oldestInvoiceDate: "",
            latestInvoiceDate: ""
          };
        }

        bucket = pendingSupplierBuckets[supplierKey];
        bookingKey = helpers.getLookupId(invoice.Booking) || helpers.getCandidateValue(invoice, FIELD_CANDIDATES.invoice.mfsp) || invoice.id;
        invoiceDate = helpers.toIsoDate(invoice.Invoice_Date);

        bucket.pendingAmount = roundCurrency(bucket.pendingAmount + pendingAmount);
        bucket.openInvoicesCount += 1;
        bucket.tripKeys[bookingKey] = true;

        if (invoiceDate && (!bucket.oldestInvoiceDate || invoiceDate < bucket.oldestInvoiceDate)) {
          bucket.oldestInvoiceDate = invoiceDate;
        }

        if (invoiceDate && (!bucket.latestInvoiceDate || invoiceDate > bucket.latestInvoiceDate)) {
          bucket.latestInvoiceDate = invoiceDate;
        }
      });

      pendingSuppliers = Object.keys(pendingSupplierBuckets).map(function (supplierKey) {
        var bucket = pendingSupplierBuckets[supplierKey];

        return {
          supplierId: bucket.supplierId || supplierKey,
          supplierName: bucket.supplierName,
          pendingAmount: bucket.pendingAmount,
          openInvoicesCount: bucket.openInvoicesCount,
          tripCount: Object.keys(bucket.tripKeys).length,
          oldestInvoiceDate: bucket.oldestInvoiceDate,
          latestInvoiceDate: bucket.latestInvoiceDate
        };
      }).sort(function (left, right) {
        return compareValues(left.pendingAmount, right.pendingAmount, "desc") ||
          compareValues(left.oldestInvoiceDate, right.oldestInvoiceDate, "asc") ||
          compareValues(left.supplierName, right.supplierName, "asc");
      });

      supplierTotals.count = pendingSuppliers.length;
      supplierTotals.amount = roundCurrency(pendingSuppliers.reduce(function (sum, bucket) {
        return sum + bucket.pendingAmount;
      }, 0));

      pendingTrips = pendingSettlements.filter(isDashboardSettlementPending).map(function (settlement) {
        var remainingToPay = getSettlementRemainingToPay(settlement);
        var remainingToInvoice = getSettlementRemainingToInvoice(settlement);

        if (remainingToPay > 0) {
          tripTotals.readyCount += 1;
          tripTotals.readyAmount = roundCurrency(tripTotals.readyAmount + remainingToPay);
        }

        if (remainingToInvoice > 0) {
          tripTotals.toInvoiceCount += 1;
          tripTotals.toInvoiceAmount = roundCurrency(tripTotals.toInvoiceAmount + remainingToInvoice);
        }

        return {
          id: settlement.id,
          settlementName: helpers.textValue(settlement.Name, settlement.id),
          bookingName: helpers.getLookupName(settlement.Booking),
          supplierId: helpers.getLookupId(settlement.Supplier),
          supplierName: settlement.Supplier_Name || helpers.getLookupName(settlement.Supplier) || "-",
          mfsp: getSettlementMfsp(settlement),
          adminStatus: helpers.textValue(settlement.Admin_Status, "-"),
          firstServiceDate: helpers.toIsoDate(settlement.First_Service_Date),
          lastServiceDate: helpers.toIsoDate(settlement.Last_Service_Date),
          remainingToInvoice: remainingToInvoice,
          remainingToPay: remainingToPay
        };
      }).sort(function (left, right) {
        var leftUrgency = left.remainingToPay > 0 ? 1 : 0;
        var rightUrgency = right.remainingToPay > 0 ? 1 : 0;

        return compareValues(leftUrgency, rightUrgency, "desc") ||
          compareValues(left.remainingToPay, right.remainingToPay, "desc") ||
          compareValues(left.remainingToInvoice, right.remainingToInvoice, "desc") ||
          compareValues(left.firstServiceDate, right.firstServiceDate, "asc") ||
          compareValues(left.settlementName, right.settlementName, "asc");
      });

      suppliersEmptyMessage = state.currentTab === "dashboard" && state.isLoading
        ? "Loading pending suppliers..."
        : state.dashboard.loaded
        ? "No suppliers currently have unpaid invoice balance."
        : "Open the dashboard to load pending suppliers.";

      tripsEmptyMessage = state.currentTab === "dashboard" && state.isLoading
        ? "Loading pending trips..."
        : state.dashboard.loaded
        ? "No trips currently have pending supplier invoice or payment balance."
        : "Open the dashboard to load pending trips.";

      return {
        pendingSuppliers: pendingSuppliers,
        pendingTrips: pendingTrips,
        supplierTotals: supplierTotals,
        tripTotals: tripTotals,
        suppliersEmptyMessage: suppliersEmptyMessage,
        tripsEmptyMessage: tripsEmptyMessage
      };
    }

    return {
      buildView: buildDashboardView,
      ensureLoaded: ensureDashboardDataLoaded,
      refreshTabData: refreshDashboardTabData,
      onSuppliersTableClick: onDashboardSuppliersTableClick,
      onTripsTableClick: onDashboardTripsTableClick
    };
  };
}(window));
