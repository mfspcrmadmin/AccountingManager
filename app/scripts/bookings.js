(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.isEmptyNoSupplierSettlement = function (row) {
    function zero(value) { return value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) === 0; }
    return Boolean(row && /(?:^|-)NOSUPPLIER$/i.test(String(row.Name || '').trim()) &&
      ['Service_Count', 'Total_Service_Cost', 'Total_Invoice', 'Total_Paid'].every(function (field) { return zero(row[field]); }));
  };

  ns.createBookingsModule = function (deps) {
    var MODULES = deps.MODULES;
    var FIELD_CANDIDATES = deps.FIELD_CANDIDATES;
    var BOOKING_STAGE_FILTER_OPTIONS = deps.BOOKING_STAGE_FILTER_OPTIONS;
    var BOOKING_BROWSER_PAGE_FIELDS = deps.BOOKING_BROWSER_PAGE_FIELDS;
    var SYNC_PROJECT_FROM_EZUS_FUNCTION = deps.SYNC_PROJECT_FROM_EZUS_FUNCTION;
    var RECALCULATE_SUPPLIER_SETTLEMENTS_FOR_BOOKING_FUNCTION = deps.RECALCULATE_SUPPLIER_SETTLEMENTS_FOR_BOOKING_FUNCTION;
    var state = deps.state;
    var elements = deps.elements;
    var helpers = deps.helpers;
    var crm = deps.crm;
    var renderer = deps.renderer;
    var renderAll = deps.renderAll;
    var debugError = deps.debugError;
    var resolveFieldApiByCandidates = deps.resolveFieldApiByCandidates;
    var getFunctionOutputObject = deps.getFunctionOutputObject;
    var getFunctionResponseResult = deps.getFunctionResponseResult;
    var cloneFilterState = deps.cloneFilterState;
    var getNormalizedBookingStageValues = deps.getNormalizedBookingStageValues;
    var hasAllBookingStageFilterValuesSelected = deps.hasAllBookingStageFilterValuesSelected;
    var loadCoqlPage = deps.loadCoqlPage;
    var buildBookingRemoteWhereClause = deps.buildBookingRemoteWhereClause;
    var buildBookingRemoteOrderByClause = deps.buildBookingRemoteOrderByClause;
    var hydrateBookingPageRecords = deps.hydrateBookingPageRecords;
    var canUseBookingSearchFallback = deps.canUseBookingSearchFallback;
    var loadBookingSearchFallbackPage = deps.loadBookingSearchFallbackPage;
    var buildRemotePageSummary = deps.buildRemotePageSummary;
    var getFriendlyLoadErrorMessage = deps.getFriendlyLoadErrorMessage;
    var getCurrentUserEmail = deps.getCurrentUserEmail;
    var openAgentCommissionInvoice = deps.openAgentCommissionInvoice;

    var agentCommissionBookingId = "";
    var bookingShortcutBusy = false;

    async function refreshSettlementDataAfterBookingAction() {
      if (deps.refreshSettlementDataAfterBookingAction) {
        try {
          await deps.refreshSettlementDataAfterBookingAction();
        } catch (error) {
          renderer.showError("The operation may have changed CRM data, but the displayed settlements could not be refreshed. Reload them before continuing. " + (error.message || ""));
        }
      }
    }

    function setAgentCommissionPopup(isOpen, message, canRecalculate, messageTone) {
      if (!elements.agentCommissionPopup) {
        return;
      }

      elements.agentCommissionPopup.hidden = !isOpen;
      if (elements.agentCommissionMessage) {
        elements.agentCommissionMessage.textContent = message || "";
        elements.agentCommissionMessage.classList.toggle("is-error", messageTone === "error");
      }
      if (elements.agentCommissionRecalculate) {
        elements.agentCommissionRecalculate.hidden = !canRecalculate;
        elements.agentCommissionRecalculate.disabled = false;
        elements.agentCommissionRecalculate.textContent = "Recalculate settlements";
      }
    }

    async function findAgentCommissionSettlement(bookingId) {
      var settlements = await crm.searchRecord(MODULES.settlements, "(Booking:equals:" + helpers.escapeCriteriaValue(bookingId) + ")");

      return (settlements || []).filter(function (settlement) {
        return helpers.normalizeString(settlement && settlement.Settlement_Type) === "agentcommission";
      })[0] || null;
    }

    function getAgentCommissionRecalculationResult(recalculationOutput) {
      var commissionResult = recalculationOutput && recalculationOutput.agent_commission;

      if (typeof commissionResult === "string") {
        try {
          commissionResult = JSON.parse(commissionResult);
        } catch (error) {
          commissionResult = null;
        }
      }

      return commissionResult && typeof commissionResult === "object" ? commissionResult : null;
    }

    function getAgentCommissionSettlementId(recalculationOutput) {
      var commissionResult = getAgentCommissionRecalculationResult(recalculationOutput);

      return String(commissionResult && commissionResult.settlement_id || "").trim();
    }

    function getAgentCommissionRecalculationError(recalculationOutput) {
      var commissionResult = getAgentCommissionRecalculationResult(recalculationOutput);

      if (!commissionResult || commissionResult.error !== true) {
        return "";
      }

      return String(commissionResult.message || "The agent commission settlement could not be recalculated.").trim();
    }

    async function findRecalculatedAgentCommissionSettlement(recalculationOutput, bookingId) {
      var settlementId = getAgentCommissionSettlementId(recalculationOutput);
      var settlement;

      // The Deluge function returns the record ID it has just created or updated.
      // Use it first: criteria searches can lag briefly behind a CRM write.
      if (settlementId) {
        settlement = await crm.getRecord(MODULES.settlements, settlementId);
        if (settlement) {
          return settlement;
        }
      }

      return findAgentCommissionSettlement(bookingId);
    }

    function onBookingsStageToggleClick(event) {
      event.preventDefault();
      state.views.bookings.stageDropdownOpen = !state.views.bookings.stageDropdownOpen;
      renderAll();
    }

    function onBookingsStageOptionChange(event) {
      var target = event.target;
      var stageValue;
      var nextValues;

      if (!target || target.type !== "checkbox") {
        return;
      }

      stageValue = target.getAttribute("data-booking-stage-value");

      if (!stageValue) {
        return;
      }

      nextValues = getNormalizedBookingStageValues(state.views.bookings.filters.stageValues);

      if (target.checked) {
        nextValues.push(stageValue);
      } else {
        nextValues = nextValues.filter(function (value) {
          return value !== stageValue;
        });
      }

      state.views.bookings.filters.stageValues = getNormalizedBookingStageValues(nextValues);
      renderAll();
    }

    function onBookingsStageMenuActionClick(event) {
      var action = event.target && event.target.getAttribute("data-booking-stage-action");

      if (!action) {
        return;
      }

      // Rendering replaces the clicked button. Do not let its detached target
      // reach the document handler and get mistaken for an outside click.
      event.preventDefault();
      event.stopPropagation();

      if (action === "select-all") {
        state.views.bookings.filters.stageValues = BOOKING_STAGE_FILTER_OPTIONS.slice();
      } else if (action === "clear-all") {
        state.views.bookings.filters.stageValues = [];
      }

      renderAll();
    }

    function onDocumentClickCloseBookingsStageDropdown(event) {
      if (!state.views.bookings.stageDropdownOpen) {
        return;
      }

      if (
        elements.bookingsFilterStageField &&
        event.target &&
        typeof elements.bookingsFilterStageField.contains === "function" &&
        elements.bookingsFilterStageField.contains(event.target)
      ) {
        return;
      }

      state.views.bookings.stageDropdownOpen = false;
      renderAll();
    }

    function onBookingActionsToggleClick(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      setBookingActionsPopupOpen(
        !elements.bookingActionsShortcut ||
        elements.bookingActionsShortcut.hidden
      );
    }

    function onDocumentClickCloseBookingActionsPopup(event) {
      if (!elements.bookingActionsShortcut || elements.bookingActionsShortcut.hidden) {
        return;
      }

      if (
        elements.bookingActionsShortcut &&
        event.target &&
        typeof elements.bookingActionsShortcut.contains === "function" &&
        elements.bookingActionsShortcut.contains(event.target)
      ) {
        return;
      }

      setBookingActionsPopupOpen(false);
    }

    function onDocumentKeydownCloseBookingActionsPopup(event) {
      if (event && event.key === "Escape") {
        setBookingActionsPopupOpen(false);
        closeBookingClosure();
      }
    }

    function setBookingActionsPopupOpen(isOpen) {
      if (!elements.bookingActionsShortcut || !elements.bookingActionsPopup || !elements.bookingActionsToggle) {
        return;
      }

      if (isOpen) {
        elements.bookingActionsShortcut.hidden = false;
        global.requestAnimationFrame(function () {
          elements.bookingActionsShortcut.classList.add("is-open");
        });
      } else {
        elements.bookingActionsShortcut.classList.remove("is-open");
        global.setTimeout(function () {
          if (!elements.bookingActionsShortcut.classList.contains("is-open")) {
            elements.bookingActionsShortcut.hidden = true;
          }
        }, 240);
      }
      elements.bookingActionsToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");

      if (isOpen && elements.bookingActionsMfsp && typeof elements.bookingActionsMfsp.focus === "function") {
        global.setTimeout(function () {
          elements.bookingActionsMfsp.focus();
        }, 0);
      }
    }

    function setBookingShortcutBusyState(isBusy, actionKey) {
      bookingShortcutBusy = Boolean(isBusy);
      var syncLabel = "Sync project";
      var recalculateLabel = "Recalculate settlement";

      if (elements.bookingActionsMfsp) {
        elements.bookingActionsMfsp.disabled = Boolean(isBusy);
      }

      if (elements.bookingActionsSyncProject) {
        elements.bookingActionsSyncProject.disabled = Boolean(isBusy);
        elements.bookingActionsSyncProject.innerHTML = isBusy && actionKey === "sync"
          ? '<span class="booking-action-spinner" aria-hidden="true"></span><span>Syncing project...</span>'
          : syncLabel;
        elements.bookingActionsSyncProject.setAttribute('aria-busy', String(Boolean(isBusy && actionKey === 'sync')));
      }

      if (elements.bookingActionsRecalculateSettlement) {
        elements.bookingActionsRecalculateSettlement.disabled = Boolean(isBusy);
        elements.bookingActionsRecalculateSettlement.innerHTML = isBusy && actionKey === "recalculate"
          ? '<span class="booking-action-spinner" aria-hidden="true"></span><span>Recalculating...</span>'
          : recalculateLabel;
        elements.bookingActionsRecalculateSettlement.setAttribute('aria-busy', String(Boolean(isBusy && actionKey === 'recalculate')));
      }

      if (elements.bookingActionsTripClosure) {
        elements.bookingActionsTripClosure.disabled = Boolean(isBusy);
      }
    }

    function getBookingShortcutMfspValue() {
      return elements.bookingActionsMfsp && elements.bookingActionsMfsp.value
        ? String(elements.bookingActionsMfsp.value).trim()
        : "";
    }

    function getBookingShortcutDisplayName(bookingRecord, fallbackMfsp) {
      return helpers.getCandidateValue(bookingRecord, FIELD_CANDIDATES.booking.name) ||
        helpers.getCandidateValue(bookingRecord, FIELD_CANDIDATES.booking.mfsp) ||
        String(fallbackMfsp || "").trim() ||
        "booking";
    }

    async function resolveBookingShortcutRecordByMfsp(mfspCode) {
      var normalizedMfsp = String(mfspCode || "").trim();
      var mfspFieldApi;
      var criteria;
      var matchedRecords;
      var exactMatches;
      var resolvedRecord;

      if (!normalizedMfsp) {
        throw new Error("Enter an MFSP reference.");
      }

      mfspFieldApi = await resolveFieldApiByCandidates(
        MODULES.bookings,
        FIELD_CANDIDATES.booking.mfsp,
        "MFSP_Reference"
      );
      criteria = "(" + mfspFieldApi + ":equals:" + helpers.escapeCriteriaValue(normalizedMfsp) + ")";
      matchedRecords = await crm.searchRecord(MODULES.bookings, criteria);
      exactMatches = matchedRecords.filter(function (record) {
        var candidateValue = record
          ? record[mfspFieldApi] || helpers.getCandidateValue(record, FIELD_CANDIDATES.booking.mfsp)
          : "";

        return helpers.normalizeQuery(candidateValue) === helpers.normalizeQuery(normalizedMfsp);
      });

      if (!exactMatches.length) {
        throw new Error("No booking was found for MFSP " + normalizedMfsp + ".");
      }

      if (exactMatches.length > 1) {
        throw new Error("More than one booking was found for MFSP " + normalizedMfsp + ".");
      }

      resolvedRecord = await crm.getRecord(MODULES.bookings, exactMatches[0].id);

      if (!resolvedRecord || !resolvedRecord.id) {
        throw new Error("The booking could not be loaded for MFSP " + normalizedMfsp + ".");
      }

      return resolvedRecord;
    }

    async function onBookingSyncProjectClick() {
      if (bookingShortcutBusy) { return; }
      var mfspCode = getBookingShortcutMfspValue();
      var bookingRecord;
      var bookingLabel;
      var bookingId;
      var syncActionUserEmail;
      var response;
      var output;
      var result;

      renderer.showError("");
      setBookingShortcutBusyState(true, "sync");
      renderer.setLoading(true, "Syncing booking project...");

      try {
        bookingRecord = await resolveBookingShortcutRecordByMfsp(mfspCode);
        bookingLabel = getBookingShortcutDisplayName(bookingRecord, mfspCode);
        bookingId = String(bookingRecord.id || "").trim();

        syncActionUserEmail = await getCurrentUserEmail();
        response = await crm.executeFunction(SYNC_PROJECT_FROM_EZUS_FUNCTION, {
          bookingId: bookingId,
          args: JSON.stringify({
            sync: {
              syncActionUserEmail: syncActionUserEmail
            }
          })
        });
        output = getFunctionOutputObject(response) || {};
        result = getFunctionResponseResult(response);

        if (output.error !== false || output.success === false || result.success === false) {
          throw new Error(output.message || result.message || "The booking project could not be synced.");
        }

        renderer.showNotice("Project synced for " + bookingLabel + ". Supplier settlement recalculation is queued; totals may still be pending.", {
          tone: "success"
        });
      } catch (error) {
        debugError("onBookingSyncProjectClick failed", error, {
          functionName: SYNC_PROJECT_FROM_EZUS_FUNCTION,
          mfspCode: mfspCode
        });
        renderer.showNotice("");
        renderer.showError(error.message || "Could not sync the booking project.");
      } finally {
        await refreshSettlementDataAfterBookingAction();
        renderer.setLoading(false);
        setBookingShortcutBusyState(false);
      }
    }

    async function onBookingRecalculateSettlementClick() {
      if (bookingShortcutBusy) { return; }
      var mfspCode = getBookingShortcutMfspValue();
      var bookingRecord;
      var bookingLabel;
      var response;
      var output;
      var result;

      renderer.showError("");
      setBookingShortcutBusyState(true, "recalculate");
      renderer.setLoading(true, "Recalculating supplier settlements...");

      try {
        bookingRecord = await resolveBookingShortcutRecordByMfsp(mfspCode);
        bookingLabel = getBookingShortcutDisplayName(bookingRecord, mfspCode);
        response = await crm.executeFunction(RECALCULATE_SUPPLIER_SETTLEMENTS_FOR_BOOKING_FUNCTION, {
          bookingId: String(bookingRecord.id || "").trim()
        });
        output = getFunctionOutputObject(response) || {};
        result = getFunctionResponseResult(response);

        if (output.error !== false || output.success === false || result.success === false ||
            ["settlement_create_errors", "settlement_update_errors", "service_link_errors", "settlements_mark_no_services_errors", "supplier_services_type_backfill_errors"].some(function (key) { return Number(output[key] || 0) > 0; })) {
          throw new Error(output.message || result.message || "Supplier settlements could not be recalculated.");
        }

        renderer.showNotice(output.message || result.message || ("Supplier settlements recalculated for " + bookingLabel + "."), {
          tone: "success"
        });
      } catch (error) {
        debugError("onBookingRecalculateSettlementClick failed", error, {
          functionName: RECALCULATE_SUPPLIER_SETTLEMENTS_FOR_BOOKING_FUNCTION,
          mfspCode: mfspCode
        });
        renderer.showNotice("");
        renderer.showError(error.message || "Could not recalculate supplier settlements.");
      } finally {
        await refreshSettlementDataAfterBookingAction();
        renderer.setLoading(false);
        setBookingShortcutBusyState(false);
      }
    }

    async function onBookingRowActionClick(action, bookingId, mfspCode) {
      if (action === "trip-closure") {
        return onBookingTripClosureClick(mfspCode);
      }

      if (action !== "pay-agent-commission") {
        return;
      }

      if (!bookingId) {
        setAgentCommissionPopup(true, "This booking does not have an ID, so its agent commission cannot be registered.", false);
        return;
      }

      agentCommissionBookingId = String(bookingId).trim();
      setAgentCommissionPopup(true, "Checking the agent commission settlement...", false);

      try {
        var settlement = await findAgentCommissionSettlement(agentCommissionBookingId);

        if (!settlement) {
          setAgentCommissionPopup(true, "No agent commission settlement was found for this booking. Recalculate settlements to create it.", true);
          return;
        }

        await openAgentCommissionInvoice(settlement);
        setAgentCommissionPopup(false, "", false);
      } catch (error) {
        debugError("onBookingRowActionClick failed", error, {
          action: action,
          bookingId: bookingId
        });
        setAgentCommissionPopup(true, error.message || "Could not check the agent commission settlement.", false);
      }
    }

    async function onAgentCommissionRecalculateClick() {
      var response;
      var output;
      var result;
      var settlement;
      var agentCommissionError;
      var stage = "recalculate-settlements";

      if (!agentCommissionBookingId) {
        setAgentCommissionPopup(true, "This booking is no longer available. Close this window and try again.", false);
        return;
      }

      if (elements.agentCommissionRecalculate) {
        elements.agentCommissionRecalculate.disabled = true;
        elements.agentCommissionRecalculate.textContent = "Recalculating...";
      }
      if (elements.agentCommissionMessage) {
        elements.agentCommissionMessage.textContent = "Recalculating settlements...";
      }

      try {
        response = await crm.executeFunction(RECALCULATE_SUPPLIER_SETTLEMENTS_FOR_BOOKING_FUNCTION, {
          bookingId: agentCommissionBookingId
        });
        output = getFunctionOutputObject(response) || {};
        result = getFunctionResponseResult(response);

        if (output.error === true || output.success === false || result.success === false) {
          throw new Error(output.message || result.message || "Settlements could not be recalculated.");
        }

        stage = "validate-agent-commission";
        agentCommissionError = getAgentCommissionRecalculationError(output);
        if (agentCommissionError) {
          throw new Error(agentCommissionError);
        }

        stage = "load-agent-commission-settlement";
        settlement = await findRecalculatedAgentCommissionSettlement(output, agentCommissionBookingId);
        if (!settlement) {
          setAgentCommissionPopup(true, "The agent commission settlement is still missing after recalculation. There is another problem with this booking; please review its agent, agency and commission data.", false);
          return;
        }

        stage = "open-agent-commission-invoice";
        await openAgentCommissionInvoice(settlement);
        setAgentCommissionPopup(false, "", false);
      } catch (error) {
        debugError("onAgentCommissionRecalculateClick failed", error, {
          bookingId: agentCommissionBookingId,
          functionName: RECALCULATE_SUPPLIER_SETTLEMENTS_FOR_BOOKING_FUNCTION,
          stage: stage,
          functionResponse: response || null,
          agentCommissionResult: getAgentCommissionRecalculationResult(output),
          settlementId: settlement && settlement.id || ""
        });
        setAgentCommissionPopup(true, error.message || "Settlements could not be recalculated. There is another problem with this booking.", false, "error");
      }
    }

    function closeAgentCommissionPopup() {
      agentCommissionBookingId = "";
      setAgentCommissionPopup(false, "", false);
    }

    function getClosureNumber(record, fieldName) {
      var value = Number(record && record[fieldName]);
      return Number.isFinite(value) ? value : 0;
    }

    function getClosureInvoiceTotal(invoice) {
      return Number(helpers.getInvoiceTotalAmount(invoice, FIELD_CANDIDATES)) ||
        Number(helpers.getCandidateValue(invoice, FIELD_CANDIDATES.invoice.totalPayableAmount)) || 0;
    }

    function getClosureInvoiceTypeBadge(invoice) {
      var invoiceType = helpers.textValue(helpers.getCandidateValue(invoice, FIELD_CANDIDATES.invoice.invoiceType));
      var normalizedType = String(invoiceType || "").toLowerCase();
      var tone = "is-final";

      if (normalizedType.indexOf("credit") !== -1) {
        tone = "is-credit";
      } else if (normalizedType.indexOf("proforma") !== -1) {
        tone = "is-proforma";
      } else if (normalizedType.indexOf("ticket") !== -1) {
        tone = "is-tickets";
      } else if (normalizedType.indexOf("commission") !== -1) {
        tone = "is-commission";
      }

      return '<span class="invoice-type-badge ' + tone + '">' + helpers.escapeHtml(invoiceType || "-") + "</span>";
    }

    function isNoServicesSettlement(settlement) {
      return ns.isEmptyNoSupplierSettlement(settlement) || helpers.normalizeString(helpers.textValue(settlement && settlement.Admin_Status, "")) === "noservices";
    }

    function getClosureReviewStatus(settlement) {
      return helpers.getCandidateValue(settlement, FIELD_CANDIDATES.settlement.closureReviewStatus) || "Pending review";
    }

    function getBookingClosureStatus(booking) {
      return helpers.getCandidateValue(booking, FIELD_CANDIDATES.booking.closureStatus) || "Closure Pending";
    }

    function getBookingClosureStatusTone(status) {
      var normalized = helpers.normalizeString(status);

      if (normalized.indexOf("complete") !== -1) {
        return "is-completed";
      }
      if (normalized.indexOf("reopen") !== -1) {
        return "is-reopened";
      }
      if (normalized.indexOf("blocked") !== -1) { return "is-blocked"; }
      if (normalized.indexOf("review") !== -1) { return "is-review"; }
      return "is-pending";
    }

    function closureProgress(settlements) {
      var relevant = settlements.filter(function (item) { return !isNoServicesSettlement(item); });
      var reviewed = relevant.filter(function (item) { return helpers.normalizeString(getClosureReviewStatus(item)) === "reviewed"; }).length;
      return { total: relevant.length, reviewed: reviewed, ready: relevant.length > 0 && reviewed === relevant.length };
    }

    async function loadClosureRows(module, field, value) {
      var records = [], seen = new Set();
      for (var page = 1; page <= 25; page++) {
        var batch = await crm.searchRecordPage(module, "(" + field + ":equals:" + helpers.escapeCriteriaValue(String(value)) + ")", page, 200);
        if (!Array.isArray(batch)) { throw new Error("Incomplete closure records."); }
        for (var row of batch) {
          if (!row.id || seen.has(String(row.id))) { throw new Error("Repeated or incomplete closure records."); }
          seen.add(String(row.id)); records.push(row);
        }
        if (batch.length < 200) { return records; }
      }
      throw new Error("Closure read limit reached. No partial result was accepted.");
    }

    async function loadAllClosureRecords(module, bookingId) {
      return loadClosureRows(module, "Booking", bookingId);
    }

    function activeClosureInvoice(invoice) {
      return !["Cancelled", "Rejected"].includes(invoice.Status) &&
        !(invoice.Registration_Key && invoice.Registration_Status !== "Complete");
    }

    function closureRelatedInvoices(settlement, invoices) {
      return (settlement._closureInvoices || (invoices || []).filter(function (invoice) {
        return helpers.getLookupId(invoice.Supplier_Settlement) === String(settlement.id);
      })).filter(activeClosureInvoice);
    }

    async function loadClosureSnapshot(closure) {
      var loaded = await Promise.all([loadAllClosureRecords(MODULES.settlements, closure.booking.id), loadAllClosureRecords(MODULES.invoices, closure.booking.id)]);
      var settlements = loaded[0], invoices = loaded[1];
      var byId = new Map(invoices.map(function (invoice) { return [String(invoice.id), invoice]; }));
      for (var settlement of settlements) {
        var links = await loadClosureRows("Inv_Set_Allocations", "Vendor_Settlement", settlement.id);
        var related = new Map();
        for (var link of links) {
          if (["Void", "Cancelled"].includes(link.Status)) { continue; }
          var invoiceId = helpers.getLookupId(link.Vendor_Invoice);
          if (!invoiceId) { throw new Error("An invoice allocation has no invoice. Review the settlement."); }
          if (!byId.has(invoiceId)) {
            var invoice = await crm.getRecord(MODULES.invoices, invoiceId);
            if (!invoice || String(invoice.id) !== invoiceId) { throw new Error("A closure invoice could not be read."); }
            byId.set(invoiceId, invoice);
          }
          related.set(invoiceId, byId.get(invoiceId));
        }
        // Legacy invoices without allocation records still use the primary settlement.
        for (var invoice of invoices) {
          if (helpers.getLookupId(invoice.Supplier_Settlement) === String(settlement.id) && !related.has(String(invoice.id))) {
            var splits = await loadClosureRows("Inv_Set_Allocations", "Vendor_Invoice", invoice.id);
            if (!splits.some(function (row) { return !["Void", "Cancelled"].includes(row.Status); })) { related.set(String(invoice.id), invoice); }
          }
        }
        settlement._closureInvoices = Array.from(related.values());
      }
      return {settlements:settlements, invoices:Array.from(byId.values())};
    }

    function closureSettlementSnapshot(record) {
      return JSON.stringify([record.id, record.Modified_Time, record.Booking, record.Admin_Status, record.Closure_Review_Status,
        record.Total_Service_Cost, record.Total_Invoice, record.Total_Paid, record.Service_Count, record.Currency, record.Name]);
    }

    function closureSnapshotOrder(records) {
      return records.slice().sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
    }

    function closureBalanceBlockReason(booking) {
      var raw = booking && booking.Balance_Amount;
      if (raw == null || String(raw).trim() === '' || !Number.isFinite(Number(raw))) {
        return 'Cannot complete closure: Balance Due Amount is unavailable. Refresh and verify the Booking balance.';
      }
      return Number(raw) !== 0
        ? 'Cannot complete closure: Balance Due Amount is ' + Number(raw).toFixed(2) + '. It must be zero. Review the Booking payments, then refresh Trip closure.'
        : '';
    }

    function isNoSupplierSettlement(settlement) {
      return /(?:^|-)NOSUPPLIER$/i.test(String(settlement.Name || '').trim());
    }

    function showNoSupplierWarning(settlement) {
      if (ns.isEmptyNoSupplierSettlement(settlement)) { return false; }
      if (!isNoSupplierSettlement(settlement)) { return false; }
      // A known zero budget with no recorded financial movement needs no warning.
      // Keep unknown budgets and any nonzero/invalid financial value visible.
      var cost = settlement.Total_Service_Cost;
      if (cost == null || cost === '' || !Number.isFinite(Number(cost)) || Number(cost) !== 0) { return true; }
      return ['Total_Invoice', 'Total_Paid'].some(function (field) {
        var value = settlement[field];
        return value != null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) !== 0);
      });
    }

    function showNoSupplierDetails(settlement) {
      return isNoSupplierSettlement(settlement) &&
        (Number(settlement.Service_Count) > 0 || showNoSupplierWarning(settlement));
    }

    function ignoredNoSupplier(closure, settlement) {
      return isNoSupplierSettlement(settlement) && (closure.ignoredNoSupplierIds || []).includes(String(settlement.id));
    }

    function closureExceptions(closure) {
      var issues = [];
      var balanceReason = closureBalanceBlockReason(closure.booking);
      if (balanceReason) { throw new Error(balanceReason); }
      for (var settlement of closure.settlements.filter(function (row) { return !isNoServicesSettlement(row); })) {
        if (ignoredNoSupplier(closure, settlement)) {
          issues.push('Explicitly ignored NOSUPPLIER: ' + settlement.Name + ' [' + settlement.id + '], services ' + settlement.Service_Count +
            ', quoted ' + String(settlement.Total_Service_Cost) + ', invoiced ' + String(settlement.Total_Invoice) + ', paid ' + String(settlement.Total_Paid) + '. Missing values are not zero.');
          continue;
        }
        var missingFields = ["Total_Service_Cost", "Total_Invoice", "Total_Paid"].filter(function (field) {
          return settlement[field] == null || settlement[field] === "" || !Number.isFinite(Number(settlement[field]));
        });
        if (missingFields.length && (closure.ignoredMigrationIds || []).includes(String(settlement.id))) {
          issues.push('Explicitly ignored TP migration settlement: ' + (settlement.Name || settlement.id) + ' [' + settlement.id + '], unavailable: ' + missingFields.join(', ') + ', quoted ' + String(settlement.Total_Service_Cost) + ', invoiced ' + String(settlement.Total_Invoice) + ', paid ' + String(settlement.Total_Paid) + '. Missing values are not zero.');
          continue;
        }
        if (missingFields.length) { throw new Error("Settlement totals are unavailable: " + (settlement.Name || settlement.id) + " [" + settlement.id + "]: " + missingFields.join(', ') + ". " + (isNoSupplierSettlement(settlement) ? "Select Ignore NOSUPPLIER again before completing closure, or recalculate and review this settlement." : "Recalculate and review before completing closure.")); }
        var metrics = getClosureSettlementMetrics(settlement, closure.invoices);
        if (!metrics.hasInvoice || Math.abs(metrics.invoiced - metrics.paid) > .01) {
          issues.push((settlement.Name || settlement.id) + " [" + settlement.id + ", " + (settlement.Currency || "EUR") + "]: quoted " + metrics.quoted + ", invoiced " + metrics.invoiced + ", paid " + metrics.paid + (metrics.hasInvoice ? "" : ", invoice missing"));
        }
        if (closureRelatedInvoices(settlement, closure.invoices).some(function (invoice) { return !["Final Invoice", "Credit Note"].includes(invoice.Invoice_Type); })) {
          issues.push((settlement.Name || settlement.id) + ": non-final invoice documents");
        }
      }
      return issues;
    }

    async function loadClosureReviewIssues(closure) {
      await refreshClosureBooking(closure);
      var snapshot = await loadClosureSnapshot(closure);
      closure.settlements = snapshot.settlements; closure.invoices = snapshot.invoices;
      var issues = [];
      function add(title, explanation, row, evidence) {
        issues.push({title:title, explanation:explanation, record:row && ((row.Name || 'Settlement') + ' [' + row.id + ']'),
          module:row ? MODULES.settlements : MODULES.bookings, id:String(row ? row.id : closure.booking.id), evidence:evidence || ''});
      }
      var balance = closureBalanceBlockReason(closure.booking);
      if (balance) add('Customer balance requires reconciliation', 'The booking balance is not confirmed as zero. Correct the customer payments or document the historical exception.', null, balance);
      var active = closure.settlements.filter(function (row) { return !isNoServicesSettlement(row); });
      if (!active.length) add('No active settlements', 'No active supplier settlements were found. Review the booking services before accepting an exception.');
      active.forEach(function (row) {
        var values = 'Quoted: ' + String(row.Total_Service_Cost) + ' ? Invoiced: ' + String(row.Total_Invoice) + ' ? Paid: ' + String(row.Total_Paid);
        if (row.Closure_Review_Status !== 'Reviewed') add('Settlement not reviewed', 'Review the supplier settlement and its documents, or explicitly accept that this migrated settlement has no completed review.', row, values);
        if (showNoSupplierWarning(row)) add('Services without a supplier', 'This NOSUPPLIER settlement contains costs or unknown totals. Assign the supplier and recalculate, or document why it is excluded from this closure.', row, values);
        var missing = ['Total_Service_Cost','Total_Invoice','Total_Paid'].filter(function (field) { return row[field] == null || row[field] === '' || !Number.isFinite(Number(row[field])); });
        if (missing.length) add('Financial totals unavailable', 'Recalculate this settlement or document the migration exception. Missing values remain unknown.', row, values);
        else {
          var metrics = getClosureSettlementMetrics(row, closure.invoices);
          if (!metrics.hasInvoice) add('Supplier invoice missing', 'No supplier invoice supports this settlement. Register the document or explain the historical exception.', row, values);
          if (Math.abs(metrics.invoiced - metrics.paid) > .01) add('Supplier payments differ from invoices', 'Review payments, refunds and allocations or explain the historical difference.', row, values);
        }
        if (closureRelatedInvoices(row, closure.invoices).some(function (invoice) { return !['Final Invoice','Credit Note'].includes(invoice.Invoice_Type); })) add('Non-final supplier documents', 'Replace provisional documents with final invoices or document why they are accepted for this closure.', row);
      });
      return {bookingId:closure.booking.id, issues:issues, revision:JSON.stringify([closure.booking.Closure_Status, closure.booking.Balance_Amount, closureSnapshotOrder(closure.settlements).map(closureSettlementSnapshot), closureSnapshotOrder(closure.invoices)])};
    }

    function requireClosureWriteSuccess(response) {
      var result = response && response.data && response.data[0];
      if (!result || result.code !== "SUCCESS") {
        throw new Error(result && result.message || response && response.message || "CRM did not confirm the change.");
      }
    }

    async function saveClosureStatus(closure, status, extra) {
      var payload = Object.assign({ Closure_Status: status }, extra || {});
      requireClosureWriteSuccess(await crm.updateRecord(MODULES.bookings, closure.booking.id, payload));
      Object.assign(closure.booking, payload);
      (state.views.bookings.records || []).forEach(function (record) {
        if (String(record.id) === String(closure.booking.id)) { Object.assign(record, payload); }
      });
      renderAll();
    }

    async function refreshClosureBooking(closure) {
      var booking = await crm.getRecord(MODULES.bookings, closure.booking.id);
      if (!booking || !booking.id) { throw new Error('The booking could not be loaded. Refresh and try again.'); }
      closure.booking = booking;
    }

    async function loadClosureBlockingReason(closure) {
      if (!['Closure Blocked', 'Closure Completed'].includes(getBookingClosureStatus(closure.booking))) { return; }
      try {
        var notes = [], page = 1, batch;
        do {
          batch = await crm.getRelatedRecords(MODULES.bookings, closure.booking.id, 'Notes', page++, 200);
          notes = notes.concat(batch);
        } while (batch.length === 200);
        closure.acceptedExceptionNotes = notes.filter(function (note) { return note.Note_Title === 'Trip closure accepted exceptions'; }).sort(function (a, b) { return String(b.Created_Time || '').localeCompare(String(a.Created_Time || '')); });
        notes = notes.filter(function (note) { return note.Note_Title === 'Trip closure blocking reason'; })
          .sort(function (a, b) { return String(b.Created_Time || '').localeCompare(String(a.Created_Time || '')); });
        closure.savedBlockReason = notes.length ? notes[0].Note_Content : '';
      } catch (error) {
        closure.savedBlockReason = '';
      }
    }

    function closureActionIcon(action) {
      var paths = { start: '<path d="m9 5 10 7-10 7Z"/>', complete: '<path d="m5 12 4 4L19 6"/>',
        block: '<circle cx="12" cy="12" r="8"/><path d="m6 6 12 12"/>',
        reopen: '<path d="M4 10a8 8 0 1 1 2 8M4 4v6h6"/>' };
      return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (paths[action] || paths.block) + '</svg>';
    }

    function closureControls(closure) {
      var status = getBookingClosureStatus(closure.booking);
      var progress = closureProgress(closure.settlements || []);
      var completed = status === 'Closure Completed';
      var blocked = status === 'Closure Blocked';
      var pending = status === 'Closure Pending';
      var busy = Boolean(closure.isSaving || closure.loadFailed);
      var reason = closureBalanceBlockReason(closure.booking) || (!progress.total ? 'No active settlements to review.' : !progress.ready ? 'Review all settlements to complete closure.' : '');
      var percent = progress.total ? Math.round(progress.reviewed / progress.total * 100) : 0;
      function button(action, label, primary, unavailable, description) {
        var saving = closure.isSaving && closure.savingAction === action;
        return '<button type="' + (action === 'block' ? 'submit' : 'button') + '" class="button ' + (primary ? 'primary' : 'secondary') +
          (action === 'block' || action === 'open-block' ? ' closure-block-action' : '') + '" data-closure-action="' + action + '"' +
          (busy || unavailable ? ' disabled' : '') + (description ? ' aria-describedby="' + description + '"' : '') +
          (action === 'open-block' ? ' aria-expanded="' + Boolean(closure.blockPopoverOpen) + '" aria-controls="closure-block-popover" aria-haspopup="dialog"' : '') +
          (saving ? ' aria-busy="true"' : '') + '>' + (saving && action === 'complete' ? '<span class="booking-action-spinner" aria-hidden="true"></span>' : action === 'cancel-block' ? '' : closureActionIcon(action)) +
          '<span>' + (saving ? 'Saving...' : label) + '</span></button>';
      }
      var actions = completed ? button('reopen', 'Reopen closure', false) : blocked ? button('start', 'Resume review', true) :
        (pending ? button('start', 'Start review', true) : '') +
        (deps.reviewClosure || !pending || progress.ready ? '<div class="closure-complete-control">' + button('complete', 'Complete closure', !pending && progress.ready, deps.reviewClosure ? false : Boolean(reason), reason ? 'closure-complete-help' : '') + '</div>' : '') +
        '<div class="closure-block-anchor">' + button('open-block', 'Block closure', false) +
        (closure.blockPopoverOpen ? '<form id="closure-block-popover" class="closure-block-popover" role="dialog" aria-labelledby="closure-block-label" novalidate>' +
          '<label id="closure-block-label" for="closure-block-reason">Blocking reason</label>' +
          '<textarea id="closure-block-reason" data-closure-block-reason rows="3" maxlength="2000" required' + (busy ? ' disabled' : '') +
          (closure.blockError ? ' aria-invalid="true" aria-describedby="closure-block-error"' : '') + '>' + helpers.escapeHtml(closure.blockReason || '') + '</textarea>' +
          (closure.blockError ? '<p id="closure-block-error" class="booking-closure-error" role="alert">' + helpers.escapeHtml(closure.blockError) + '</p>' : '') +
          '<div class="closure-block-buttons">' + button('cancel-block', 'Cancel', false) + button('block', 'Block closure', false) + '</div></form>' : '') + '</div>';
      return '<section class="booking-closure-workflow" aria-label="Closure workflow" aria-busy="' + Boolean(closure.isSaving) + '">' +
        '<div class="closure-workflow-row"><div class="closure-progress"><div class="closure-progress-copy"><strong>' + progress.reviewed + ' / ' + progress.total +
        '</strong><span>settlements reviewed</span></div><div class="closure-progress-track' + (progress.ready ? ' is-ready' : '') + '" role="progressbar" aria-label="Settlements reviewed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent +
        '" aria-valuetext="' + progress.reviewed + ' of ' + progress.total + ' settlements reviewed"><span style="width:' + percent + '%"></span></div></div>' +
        '<div class="closure-workflow-actions">' + actions + '</div></div>' +
        (!deps.reviewClosure && !completed && !blocked && !pending && reason ? '<p id="closure-complete-help" class="closure-workflow-help">' + reason + '</p>' : '') +
        (blocked ? '<p class="closure-blocked-reason">' + closureActionIcon('block') + '<span>' + helpers.escapeHtml(closure.savedBlockReason || 'See the booking Notes for the blocking reason.') + '</span></p>' : '') +
        (closure.booking.Closure_Completed_By ? '<p class="closure-workflow-audit">Last completed by ' + helpers.escapeHtml(String(closure.booking.Closure_Completed_By).split('@')[0].replace(/[._]/g, ' ')) + ' &middot; <time title="' + helpers.escapeHtml(closure.booking.Closure_Completed_By + ' - ' + (closure.booking.Closure_Completed_At || '')) + '">' + helpers.escapeHtml(closure.booking.Closure_Completed_At && !isNaN(Date.parse(closure.booking.Closure_Completed_At)) ? new Date(closure.booking.Closure_Completed_At).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date unavailable') + '</time>' + '</p>' : '') +
        (closure.error ? '<p class="booking-closure-error" role="alert">' + helpers.escapeHtml(closure.error) + '</p>' : '') + '</section>';
    }

    function focusClosureControl(selector) {
      var control = (elements.bookingClosureControls || elements.bookingClosureContent).querySelector(selector);
      if (control && typeof control.focus === 'function') { control.focus(); }
    }

    function closeClosureBlockPopover(returnFocus) {
      var closure = state.bookingClosure;
      if (!closure || !closure.blockPopoverOpen || closure.isSaving) { return; }
      closure.blockPopoverOpen = false;
      closure.blockError = '';
      renderBookingClosure();
      if (returnFocus) { focusClosureControl('[data-closure-action="open-block"]'); }
    }

    function onClosurePopoverDismiss(event) {
      var closure = state.bookingClosure;
      if (!closure || !closure.blockPopoverOpen) { return; }
      if (event.type === 'keydown') {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeClosureBlockPopover(true); }
      } else if (!event.target.closest('.closure-block-anchor')) {
        closeClosureBlockPopover(false);
      }
    }

    async function onClosureStatusClick(event) {
      var target = event.target && event.target.closest('[data-closure-action]');
      var closure = state.bookingClosure;
      if (!target || target.disabled || !closure || closure.isSaving || closure.loadFailed) { return; }
      var action = target.getAttribute('data-closure-action');
      if (event.preventDefault) { event.preventDefault(); }
      if (action === 'open-block') {
        closure.blockPopoverOpen = true;
        closure.blockError = '';
        renderBookingClosure();
        focusClosureControl('[data-closure-block-reason]');
        return;
      }
      if (action === 'cancel-block') { closeClosureBlockPopover(true); return; }
      var input = (elements.bookingClosureControls || elements.bookingClosureContent).querySelector('[data-closure-block-reason]');
      closure.blockReason = input ? input.value.trim() : closure.blockReason || '';
      if (action === 'block' && !closure.blockReason) {
        closure.blockError = 'Enter a blocking reason.';
        closure.blockPopoverOpen = true;
        renderBookingClosure();
        focusClosureControl('[data-closure-block-reason]');
        return;
      }
      if (action === 'complete' && elements.bookingClosureContent && elements.bookingClosureContent.querySelectorAll) {
        var ignoreInputs = elements.bookingClosureContent.querySelectorAll('[data-closure-ignore-nosupplier]');
        if (ignoreInputs.length) {
          closure.ignoredNoSupplierIds = Array.prototype.filter.call(ignoreInputs, function (input) { return input.checked && !input.disabled; }).map(function (input) { return input.getAttribute('data-closure-ignore-nosupplier'); });
        }
      }
      if (action === 'complete' && elements.bookingClosureContent && elements.bookingClosureContent.querySelectorAll) {
        var migrationInputs = elements.bookingClosureContent.querySelectorAll('[data-closure-ignore-migration]');
        if (migrationInputs.length) {
          closure.ignoredMigrationIds = Array.prototype.filter.call(migrationInputs, function (input) { return input.checked && !input.disabled; }).map(function (input) { return input.getAttribute('data-closure-ignore-migration'); });
        }
      }
      closure.error = '';
      closure.blockError = '';
      closure.isSaving = true;
      closure.savingAction = action;
      renderBookingClosure();
      try {
        await refreshClosureBooking(closure);
        var status = getBookingClosureStatus(closure.booking);
        if (action === 'reopen') {
          if (status !== 'Closure Completed') { throw new Error('Only a completed closure can be reopened.'); }
          await saveClosureStatus(closure, 'Closure Reopened');
        } else {
          if (status === 'Closure Completed') { throw new Error('Reopen the closure before making changes.'); }
          if (action === 'start') {
            if (status !== 'Closure Pending' && status !== 'Closure Blocked') { throw new Error('The closure is already being reviewed.'); }
            await saveClosureStatus(closure, 'Closure In Review');
          } else if (action === 'block') {
            if (!closure.blockReason) { throw new Error('Enter a blocking reason.'); }
            requireClosureWriteSuccess(await crm.insertRecord('Notes', {
              Parent_Id: closure.booking.id, '$se_module': MODULES.bookings,
              Note_Title: 'Trip closure blocking reason', Note_Content: closure.blockReason
            }));
            await saveClosureStatus(closure, 'Closure Blocked');
            closure.savedBlockReason = closure.blockReason;
            closure.blockReason = '';
            closure.blockPopoverOpen = false;
          } else if (action === 'complete') {
            if (status === 'Closure Blocked') { throw new Error('Resolve the block and resume review before completing closure.'); }
            var review = null, exceptions = [], reason = '';
            if (deps.reviewClosure) {
              review = await deps.reviewClosure(function () { return loadClosureReviewIssues(closure); });
              if (!review) return;
              exceptions = review.issues; reason = review.reason;
            } else {
              var balanceReason = closureBalanceBlockReason(closure.booking);
              if (balanceReason) throw new Error(balanceReason);
              var snapshot = await loadClosureSnapshot(closure);
              closure.settlements = snapshot.settlements; closure.invoices = snapshot.invoices;
              if (!closureProgress(closure.settlements).ready) throw new Error('All active settlements must be reviewed before completing closure.');
              exceptions = closureExceptions(closure);
              if (exceptions.length) {
                closure.exceptionIssues = exceptions; reason = String(closure.exceptionReason || '').trim();
                if (!reason) { closure.exceptionReasonRequired = true; throw new Error('A justification is required to complete closure with exceptions.'); }
                closure.exceptionReasonRequired = false;
              }
            }
            if (reason.length > 2000) throw new Error('Use a justification of at most 2000 characters.');
            var email = await getCurrentUserEmail();
            if (!email) throw new Error('The signed-in user is unavailable. Reload before completing closure.');
            var ignoredSnapshot = JSON.stringify([closure.ignoredNoSupplierIds || [], closure.ignoredMigrationIds || []]);
            var reviewedSnapshot = JSON.stringify(closureSnapshotOrder(closure.settlements).map(closureSettlementSnapshot));
            var balanceSnapshot = closure.booking.Balance_Amount;
            await refreshClosureBooking(closure);
            var latestBalanceReason = closureBalanceBlockReason(closure.booking);
            if (!review && latestBalanceReason) { throw new Error(latestBalanceReason); }
            var checked = await loadClosureSnapshot(closure);
            if (JSON.stringify([closure.ignoredNoSupplierIds || [], closure.ignoredMigrationIds || []]) !== ignoredSnapshot || getBookingClosureStatus(closure.booking) !== status || closure.booking.Balance_Amount !== balanceSnapshot ||
                JSON.stringify(closureSnapshotOrder(checked.settlements).map(closureSettlementSnapshot)) !== reviewedSnapshot ||
                JSON.stringify(closureSnapshotOrder(checked.invoices)) !== JSON.stringify(closureSnapshotOrder(closure.invoices))) {
              closure.settlements = checked.settlements; closure.invoices = checked.invoices;
              closure.exceptionReason = '';
              throw new Error("Closure data changed. Review the current figures before completing.");
            }
            if (review && !(await deps.verifyClosureReview(function () { return loadClosureReviewIssues(closure); }, review.evidence))) {
              throw new Error('Closure data changed. Complete closure again to review the current issues.');
            }
            if (exceptions.length) {
              requireClosureWriteSuccess(await crm.insertRecord("Notes", {
                Parent_Id: closure.booking.id, "$se_module": MODULES.bookings, Note_Title: "Trip closure accepted exceptions",
                Note_Content: "Accepted by: " + email + "\nAt: " + new Date().toISOString() + "\nReason: " + reason + "\n" + exceptions.join("\n")
              }));
            }
            await saveClosureStatus(closure, 'Closure Completed', {
              Closure_Completed_By: email, Closure_Completed_At: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')
            });
            renderer.showNotice('Closure completed successfully.' + (exceptions.length ? ' Accepted exceptions were saved in Booking Notes.' : ' All closure checks passed.'), {tone:'success'});
          }
        }
      } catch (error) {
        if (action === 'block') {
          closure.blockError = error.message || 'Could not block closure.';
          closure.blockPopoverOpen = true;
        } else { closure.error = error.message || 'Could not update closure status.'; }
      } finally {
        closure.isSaving = false;
        closure.savingAction = '';
        renderBookingClosure();
        if (closure.exceptionReasonRequired) {
          var reasonField = elements.bookingClosureContent.querySelector('[data-closure-exception-reason]');
          if (reasonField && reasonField.focus) { reasonField.focus({ preventScroll: true }); if (reasonField.scrollIntoView) { reasonField.scrollIntoView({ block: 'nearest' }); } }
        } else { focusClosureControl(closure.blockPopoverOpen ? '[data-closure-block-reason]' : '.booking-closure-workflow button:not(:disabled)'); }
      }
    }

    function getClosureRowColor(tone, isReviewed) {
      return isReviewed ? "reviewed" : tone === "is-ok" ? "matched" : tone === "is-alert" ? "missing" : "pending";
    }

    function compareClosureRows(left, right, sortKey, direction) {
      var leftValue = left[sortKey];
      var rightValue = right[sortKey];
      var comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue || "").localeCompare(String(rightValue || ""), "en", { sensitivity: "base" });

      return direction === "desc" ? -comparison : comparison;
    }

    function getClosureSortHeader(label, key, sort) {
      var isActive = sort.key === key;
      var indicator = isActive ? (sort.direction === "asc" ? " ↑" : " ↓") : "";

      return '<th><button class="booking-closure-sort' + (isActive ? " is-active" : "") + '" type="button" data-booking-closure-sort="' + key + '">' + helpers.escapeHtml(label + indicator) + "</button></th>";
    }

    function getClosureSettlementMetrics(settlement, invoices) {
      var settlementId = String(settlement && settlement.id || "");
      var relatedInvoices = closureRelatedInvoices(settlement, invoices);
      var quoted = getClosureNumber(settlement, "Total_Service_Cost");
      var invoiced = getClosureNumber(settlement, "Total_Invoice");
      var paid = getClosureNumber(settlement, "Total_Paid");
      var hasInvoice = relatedInvoices.length > 0;
      var isPaid = hasInvoice && paid >= invoiced - 0.01;
      var variance = quoted - invoiced;
      var review = getClosureReviewStatus(settlement);
      var isReviewed = helpers.normalizeString(review) === "reviewed";
      var tone = !hasInvoice ? "is-alert" : hasInvoice && isPaid && Math.abs(variance) <= 0.01 ? "is-ok" : "is-pending";
      var status = !hasInvoice ? "Invoice missing" : Math.abs(variance) > 0.01 ? "Amount differs from quote" : tone === "is-ok" ? "Matched and paid" : "Payment pending";

      return {
        hasInvoice: hasInvoice,
        supplier: settlement.Supplier_Name || helpers.getLookupName(settlement.Supplier) || settlement.Name || "-",
        quoted: quoted,
        invoiced: invoiced,
        paid: paid,
        variance: variance,
        status: status,
        review: review,
        color: getClosureRowColor(tone, isReviewed)
      };
    }

    function closureReferenceMarkup(settlement, options) {
      var closure = state.bookingClosure || {};
      var mfsp = settlement.MFSP_Reference || helpers.getCandidateValue(closure.booking || {}, FIELD_CANDIDATES.booking.mfsp) || "";
      var code = (closure.supplierCodes || {})[helpers.getLookupId(settlement.Supplier)];
      function reference(label, value, missing) {
        return '<span class="closure-reference"><span>' + label + ': </span>' + (value
          ? (label === 'MFSP' && options && options.copyMfsp === false ? '<span>' + helpers.escapeHtml(value) + '</span>' : '<button type="button" class="closure-copy-reference" data-closure-copy="' + helpers.escapeHtml(value) + '" aria-label="Copy ' + label + ' ' + helpers.escapeHtml(value) + '" title="Copy ' + label + '">' + helpers.escapeHtml(value) + '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></svg></button>')
          : '<span>' + (missing || 'Not provided') + '</span>') + '</span>';
      }
      return '<div class="closure-references">' + reference('MFSP', mfsp) + reference('Supplier code', code, code === null ? 'Unavailable' : 'Not provided') + '</div>';
    }

    function closureSupplierCellMarkup(settlement, detail) {
      var closure = state.bookingClosure || {};
      var code = (closure.supplierCodes || {})[helpers.getLookupId(settlement.Supplier)];
      var label = 'Copiar c?digo de proveedor: ' + code;
      var copy = code ? '<button type="button" class="closure-supplier-copy" data-closure-copy="' + helpers.escapeHtml(code) + '" aria-label="' + helpers.escapeHtml(label) + '" title="' + helpers.escapeHtml(label) + '"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g class="closure-copy-icon"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></g><path class="closure-copy-check" d="m5 12 4 4L19 6"/></svg></button>' : '';
      return '<strong>' + helpers.escapeHtml(settlement.Supplier_Name || helpers.getLookupName(settlement.Supplier) || settlement.Name || '-') + '</strong><br><span class="table-inline-secondary closure-settlement-line">' + '<span class="closure-reference-text" title="' + helpers.escapeHtml(settlement.Name || '') + '">' + helpers.escapeHtml(settlement.Name || '') + '</span>' + copy + '</span><br><span class="table-inline-secondary">' + helpers.escapeHtml(detail) + '</span>';
    }

    async function loadClosureSupplierCodes(closure) {
      closure.supplierCodes = {};
      var ids = Array.from(new Set(closure.settlements.map(function (row) { return helpers.getLookupId(row.Supplier); }).filter(Boolean)));
      for (var offset = 0; offset < ids.length; offset += 5) {
        await Promise.all(ids.slice(offset, offset + 5).map(async function (id) {
          try {
            var supplier = await crm.getRecord(MODULES.suppliers, id);
            if (!supplier || String(supplier.id) !== id) { throw new Error('Supplier unavailable'); }
            closure.supplierCodes[id] = helpers.getCandidateValue(supplier, FIELD_CANDIDATES.supplier.connectionReference) || '';
          } catch (error) { closure.supplierCodes[id] = null; }
        }));
      }
    }

    async function onClosureCopyClick(event) {
      var button = event.target && event.target.closest('[data-closure-copy]');
      if (!button) { return; }
      event.preventDefault();
      event.stopPropagation();
      var text = button.getAttribute('data-closure-copy');
      try {
        if (global.navigator && global.navigator.clipboard && global.isSecureContext) {
          await global.navigator.clipboard.writeText(text);
        } else {
          var input = global.document.createElement('textarea');
          input.value = text;
          input.style.cssText = 'position:fixed;left:-9999px;top:0';
          global.document.body.appendChild(input);
          try { input.select(); if (!global.document.execCommand('copy')) { throw new Error('Clipboard unavailable'); } }
          finally { input.remove(); button.focus({ preventScroll: true }); }
        }
        if (button.classList.contains('closure-supplier-copy')) {
          var originalLabel = 'Copiar c?digo de proveedor: ' + text;
          global.clearTimeout(button._copyFeedbackTimer);
          button.classList.add('is-copied');
          button.title = 'Copiado';
          button.setAttribute('aria-label', 'Copiado');
          button._copyFeedbackTimer = global.setTimeout(function () {
            button.classList.remove('is-copied');
            button.title = originalLabel;
            button.setAttribute('aria-label', originalLabel);
          }, 1600);
        } else {
          button.title = 'Copied';
          button.setAttribute('aria-label', 'Copied ' + text);
        }
      } catch (error) {
        renderer.showError('Could not copy. Select and copy the value manually.');
      }
    }

    function renderBookingClosure() {
      var closure = state.bookingClosure || {};
      var booking = closure.booking;
      var settlements = (closure.settlements || []).filter(function (settlement) {
        return !isNoServicesSettlement(settlement);
      });
      var invoices = closure.invoices || [];
      var currentSalesPrice;
      var bookingClosureStatus;
      var quotedCost;
      var invoicedCost;
      var paidCost;
      var expectedMargin;
      var actualMargin;
      var costVariance;
      var summary;
      var rows;
      var closureFilter;
      var closureSort;

      if (!elements.bookingClosurePopup) {
        return;
      }

      // Replacing the table collapses its scroll range. Preserve each scrolling
      // ancestor as well as the table itself before rebuilding it.
      var previousWrap = elements.bookingClosureContent.querySelector(".booking-closure-table-wrap");
      var tableScroll = previousWrap ? { top: previousWrap.scrollTop, left: previousWrap.scrollLeft } : null;
      var scrollParents = [], parent = elements.bookingClosureContent;
      while (parent) {
        scrollParents.push({ element: parent, top: parent.scrollTop, left: parent.scrollLeft });
        parent = parent.parentElement;
      }
      var active = global.document && global.document.activeElement;
      var focusedMigration = active && active.getAttribute && active.getAttribute("data-closure-ignore-migration");
      var focusedIgnore = active && active.getAttribute && active.getAttribute("data-closure-ignore-nosupplier");
      var focusedFilter = active && active.getAttribute && active.getAttribute("data-booking-closure-filter");
      var focusedSort = active && active.getAttribute && active.getAttribute("data-booking-closure-sort");
      var focusedReview = active && active.getAttribute && active.getAttribute("data-booking-closure-review-settlement-id");
      if (deps.onClosureContext) deps.onClosureContext(closure);
      elements.bookingClosurePopup.hidden = !closure.isOpen;
      if (elements.bookingClosureBilling) {
        elements.bookingClosureBilling.hidden = !closure.isOpen || closure.isLoading || !booking;
        var hasSalesInvoice = booking && helpers.getLookupId(booking.Sales_Invoice);
        elements.bookingClosureInvoiceTrip.disabled = !booking || closure.isLoading || closure.isSaving || closure.loadFailed ||
          (!hasSalesInvoice && getBookingClosureStatus(booking) !== 'Closure Completed');
        elements.bookingClosureInvoiceTrip.textContent = hasSalesInvoice ? 'View sales invoice' : 'Invoice trip';
        elements.bookingClosureInvoiceStatus.textContent = hasSalesInvoice
          ? (booking.Sales_Invoice_Number || 'Sales invoice') + (booking.Sales_Invoice_Date ? ' ? ' + helpers.formatDate(booking.Sales_Invoice_Date) : '')
          : booking && getBookingClosureStatus(booking) === 'Closure Completed' ? 'Closure completed. Invoice eligibility and confirmed receipts will be checked when you open Invoice trip.' : 'Complete Trip closure to invoice this Booking.';
      }
      var bulkRebuild = elements.bookingClosurePopup.querySelector('[data-booking-closure-rebuild="all"]');
      if (bulkRebuild) {
        bulkRebuild.disabled = !booking || closure.isLoading || closure.isSaving || closure.loadFailed || getBookingClosureStatus(booking) === 'Closure Completed' || !(closure.settlements || []).length;
        var rebuilding = closure.isSaving && closure.rebuildingSettlementId === 'all';
        bulkRebuild.setAttribute('aria-busy', String(Boolean(rebuilding)));
        bulkRebuild.innerHTML = rebuilding ? '<span class="booking-action-spinner" aria-hidden="true"></span>Recalculating...' : 'Recalculate all settlements';
      }
      if (elements.bookingClosureOpenBooking) {
        elements.bookingClosureOpenBooking.disabled = !booking || !booking.id || closure.isLoading;
      }
      if (elements.bookingClosureControls) {
        elements.bookingClosureControls.hidden = !closure.isOpen || closure.isLoading || !booking;
        elements.bookingClosureControls.innerHTML = elements.bookingClosureControls.hidden ? '' : closureControls(closure);
      }
      if (elements.bookingClosureAccountingRep) {
        elements.bookingClosureAccountingRep.hidden = !closure.isOpen || closure.isLoading || !booking;
        elements.bookingClosureAccountingRep.textContent = booking
          ? "Accounting rep: " + (getBookingBrowserValue(booking, FIELD_CANDIDATES.booking.accountingRep) || "Unassigned")
          : "";
      }
      if (!closure.isOpen) {
        if (elements.bookingClosureStatus) {
          elements.bookingClosureStatus.hidden = true;
        }
        return;
      }

      if (closure.isLoading) {
        elements.bookingClosureTitle.textContent = "Trip closure";
        if (elements.bookingClosureStatus) {
          elements.bookingClosureStatus.hidden = true;
        }
        elements.bookingClosureContent.innerHTML = '<div class="booking-closure-loading" role="status" aria-label="Loading trip closure"><span class="booking-closure-loading-spinner" aria-hidden="true"></span><span aria-hidden="true">Preparing trip closure…</span></div>';
        return;
      }

      if (!booking) {
        elements.bookingClosureTitle.textContent = "Trip closure";
        if (elements.bookingClosureStatus) {
          elements.bookingClosureStatus.hidden = true;
        }
        elements.bookingClosureContent.innerHTML = '<div class="empty-state">No booking closure data could be loaded.</div>';
        return;
      }

      currentSalesPrice = getClosureNumber(booking, "Sales_Price_inc_Taxes");
      bookingClosureStatus = getBookingClosureStatus(booking);
      quotedCost = settlements.reduce(function (total, settlement) { return total + getClosureNumber(settlement, "Total_Service_Cost"); }, 0);
      invoicedCost = settlements.reduce(function (total, settlement) { return total + getClosureNumber(settlement, "Total_Invoice"); }, 0);
      paidCost = settlements.reduce(function (total, settlement) { return total + getClosureNumber(settlement, "Total_Paid"); }, 0);
      expectedMargin = currentSalesPrice - quotedCost;
      actualMargin = currentSalesPrice - invoicedCost;
      costVariance = quotedCost - invoicedCost;
      elements.bookingClosureTitle.textContent = "Trip closure · " + getBookingShortcutDisplayName(booking) + " (" + (helpers.getCandidateValue(booking, FIELD_CANDIDATES.booking.mfsp) || "No MFSP") + ")";

      if (elements.bookingClosureStatus) {
        elements.bookingClosureStatus.textContent = bookingClosureStatus;
        elements.bookingClosureStatus.className = "booking-closure-status " + getBookingClosureStatusTone(bookingClosureStatus);
        elements.bookingClosureStatus.hidden = false;
      }

      summary = [
        ["Sales price", helpers.formatCurrency(currentSalesPrice)],
        ["Balance Due Amount", helpers.formatCurrency(getClosureNumber(booking, "Balance_Amount")), getClosureNumber(booking, "Balance_Amount") === 0 ? "is-zero-balance" : "is-outstanding-balance"],
        ["Quoted cost", helpers.formatCurrency(quotedCost)],
        ["Invoiced cost", helpers.formatCurrency(invoicedCost), "is-final-trip-cost", "Final trip cost"],
        ["Supplier payments", helpers.formatCurrency(paidCost)],
        ["Expected margin", helpers.formatCurrency(expectedMargin)],
        ["Final margin", helpers.formatCurrency(actualMargin)],
        [costVariance >= 0 ? "Savings vs budget" : "Over budget", helpers.formatCurrency(Math.abs(costVariance))]
      ];
      closureFilter = closure.filter || "all";
      closureSort = closure.sort || { key: "supplier", direction: "asc" };
      settlements = settlements.filter(function (settlement) {
        if (isNoSupplierSettlement(settlement)) { return false; }
        var m = getClosureSettlementMetrics(settlement, invoices);
        return closureFilter === "all" || (closureFilter === "reviewed" ? helpers.normalizeString(m.review) === "reviewed" :
          closureFilter === "matched" ? m.hasInvoice && Math.abs(m.variance) <= .01 && m.paid >= m.invoiced - .01 :
          closureFilter === "pending" ? m.hasInvoice && m.paid < m.invoiced - .01 :
          closureFilter === "variance" ? m.hasInvoice && Math.abs(m.variance) > .01 : closureFilter === "missing" && !m.hasInvoice);
      }).sort(function (left, right) {
        return compareClosureRows(
          getClosureSettlementMetrics(left, invoices),
          getClosureSettlementMetrics(right, invoices),
          closureSort.key,
          closureSort.direction
        );
      });
      var closureColumns = [{"key": "actions", "label": "Actions"}, {"key": "reviewToggle", "label": "Review toggle"}, {"key": "supplier", "label": "Supplier / settlement"}, {"key": "review", "label": "Closure review"}, {"key": "quoted", "label": "Quoted"}, {"key": "invoiced", "label": "Invoiced"}, {"key": "paid", "label": "Paid"}, {"key": "variance", "label": "Variance"}, {"key": "status", "label": "Invoice & payment status"}, {"key": "finalInvoiceCheck", "label": "Final invoice check"}];
      ns.tableColumns.configure("tripClosure", closureColumns, renderBookingClosure);
      var visibleClosureColumns = ns.tableColumns.visibleOrder("tripClosure").filter(function (key) { return key !== "reviewToggle"; });
      if (visibleClosureColumns.indexOf("review") === -1) { visibleClosureColumns.splice(1, 0, "review"); }
      var closureHeaders = {
        actions: '<th aria-label="Settlement actions"></th>',
        reviewToggle: '<th class="booking-closure-review-cell" aria-label="Review"></th>',
        supplier: getClosureSortHeader("Supplier / settlement", "supplier", closureSort),
        review: getClosureSortHeader("Closure review", "review", closureSort),
        quoted: getClosureSortHeader("Quoted", "quoted", closureSort),
        invoiced: getClosureSortHeader("Invoiced", "invoiced", closureSort),
        paid: getClosureSortHeader("Paid", "paid", closureSort),
        variance: getClosureSortHeader("Savings / over budget", "variance", closureSort),
        status: getClosureSortHeader("Invoice & payment status", "status", closureSort),
        finalInvoiceCheck: '<th>Final invoice check</th>',
      };
      rows = settlements.map(function (settlement) {
        var settlementId = String(settlement.id || "");
        var relatedInvoices = closureRelatedInvoices(settlement, invoices);
        var quoted = getClosureNumber(settlement, "Total_Service_Cost");
        var invoiced = getClosureNumber(settlement, "Total_Invoice");
        var paid = getClosureNumber(settlement, "Total_Paid");
        var hasInvoice = relatedInvoices.length > 0;
        var isPaid = hasInvoice && paid >= invoiced - 0.01;
        var variance = quoted - invoiced;
        var varianceTone = hasInvoice && variance > 0.01 ? "is-gain" : hasInvoice && variance < -0.01 ? "is-loss" : "";
        var closureReviewStatus = getClosureReviewStatus(settlement);
        var isReviewed = helpers.normalizeString(closureReviewStatus) === "reviewed";
        var isAgentCommission = helpers.normalizeString(settlement && settlement.Settlement_Type) === "agentcommission";
        var tone = !hasInvoice
          ? "is-alert"
          : hasInvoice && isPaid && Math.abs(variance) <= 0.01
          ? "is-ok"
          : "is-pending";
        var status = !hasInvoice
          ? "Invoice missing"
          : (isPaid ? "Paid" : "Payment pending") + (Math.abs(variance) > .01 ? " - Budget differs" : " - Budget matched");
        var nonFinalInvoiceCount = relatedInvoices.filter(function (invoice) {
          return String(helpers.getCandidateValue(invoice, FIELD_CANDIDATES.invoice.invoiceType) || "").trim().toLowerCase() !== "final invoice" && String(helpers.getCandidateValue(invoice, FIELD_CANDIDATES.invoice.invoiceType) || "").trim().toLowerCase() !== "credit note";
        }).length;
        var settlementDetail = isAgentCommission
          ? "Commission"
          : String(settlement.Service_Count || 0) + " services";

        var cells = {
          actions: '<td><details class="booking-closure-actions"><summary aria-label="' + (closure.rebuildingSettlementId === settlementId ? 'Rebuilding settlement totals' : 'Settlement actions') + '" title="Settlement actions">' + (closure.rebuildingSettlementId === settlementId ? '<span class="booking-closure-loading-spinner booking-closure-rebuild-spinner" aria-hidden="true"></span><span class="booking-closure-rebuild-status" role="status">Rebuilding totals...</span>' : '&#8942;') + '</summary><div>' +
            '<button type="button" class="button secondary" data-booking-closure-request-invoice="' + helpers.escapeHtml(settlementId) + '">Request invoice</button>' +
            '<button type="button" class="button secondary" data-booking-closure-rebuild="' + helpers.escapeHtml(settlementId) + '"' + (closure.rebuildingSettlementId === settlementId ? ' aria-busy="true"' : '') + '>' + (closure.rebuildingSettlementId === settlementId ? 'Rebuilding totals…' : 'Rebuild totals') + '</button></div></details></td>',
          reviewToggle: '<td class="booking-closure-review-cell"><button type="button" class="booking-closure-review-button' + (isReviewed ? ' is-reviewed' : '') + '" aria-label="' + (isReviewed ? 'Mark as pending review' : 'Mark as reviewed') + '" title="' + (isReviewed ? 'Mark as pending review' : 'Mark as reviewed') + '" aria-pressed="' + isReviewed + '"' + (' data-booking-closure-review-settlement-id="' + helpers.escapeHtml(settlementId) + '"') + '><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6" /></svg></button></td>',
          supplier: '<td class="booking-closure-settlement-cell">' + closureSupplierCellMarkup(settlement, settlementDetail) + "</td>",
          review: '<td><button type="button" class="closure-review-control' + (isReviewed ? ' is-reviewed' : '') + '" data-booking-closure-review-settlement-id="' + helpers.escapeHtml(settlementId) + '" aria-pressed="' + isReviewed + '" aria-label="' + (bookingClosureStatus === 'Closure Completed' ? helpers.escapeHtml(closureReviewStatus) + '; reopen closure to change' : isReviewed ? 'Mark as pending review' : 'Mark as reviewed') + '">' + (isReviewed ? '&#10003; ' : '') + helpers.escapeHtml(closureReviewStatus) + (bookingClosureStatus === 'Closure Completed' ? ' - Locked' : '') + '</button></td>',
          quoted: '<td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(quoted)) + "</td>",
          invoiced: '<td class="numeric-cell">' + helpers.escapeHtml(hasInvoice ? helpers.formatCurrency(invoiced) : "-") + "</td>",
          paid: '<td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(paid)) + "</td>",
          variance: '<td class="numeric-cell booking-closure-variance ' + varianceTone + '">' + helpers.escapeHtml(hasInvoice ? (variance > .01 ? "Saving " : variance < -.01 ? "Over " : "") + helpers.formatCurrency(Math.abs(variance)) : "-") + "</td>",
          status: "<td>" + helpers.escapeHtml(status) + "</td>",
          finalInvoiceCheck: '<td>' + (hasInvoice && nonFinalInvoiceCount ? relatedInvoices.filter(function (invoice) { return !["final invoice", "credit note"].includes(String(helpers.getCandidateValue(invoice, FIELD_CANDIDATES.invoice.invoiceType) || "").trim().toLowerCase()); }).map(function (invoice) { return '<a class="booking-closure-final-check is-incomplete" target="_blank" rel="noopener" href="https://crm.zoho.eu/crm/tab/' + encodeURIComponent(MODULES.invoices) + '/' + encodeURIComponent(invoice.id) + '">Review ' + helpers.escapeHtml(invoice.Name || invoice.id) + '</a>'; }).join('<br>') : '<span class="booking-closure-final-check ' + (hasInvoice ? 'is-complete' : 'is-incomplete') + '">' + (hasInvoice ? 'All final / credit notes' : 'No invoices') + '</span>') + (isAgentCommission ? '<small class="closure-document-help">Commission: same document rules apply.</small>' : '') + '</td>'
        };
        return '<tr class="booking-closure-row ' + tone + (isReviewed ? " is-reviewed" : "") + (isAgentCommission ? " booking-closure-agent-commission" : "") + '" data-booking-closure-settlement-id="' + helpers.escapeHtml(settlementId) + '">' + visibleClosureColumns.map(function (key, index) { return index === visibleClosureColumns.length - 1 ? cells[key].replace("<td", '<td colspan="2"') : cells[key]; }).join("") + "</tr>";
      }).join("");

      var migrationRows = (closure.settlements || []).filter(function (row) {
        return !isNoServicesSettlement(row) && !isNoSupplierSettlement(row) && ['Total_Service_Cost', 'Total_Invoice', 'Total_Paid'].some(function (field) { return row[field] == null || row[field] === '' || !Number.isFinite(Number(row[field])); });
      });
      var migrationExceptionsMarkup = bookingClosureStatus !== 'Closure Completed' && migrationRows.length ?
        '<section class="closure-migration" aria-labelledby="closure-migration-title"><div class="closure-migration-heading"><div><h3 id="closure-migration-title">TP migration exceptions</h3><p>Select the settlements to exclude from financial checks for this closure.</p></div><span class="closure-migration-count">' + migrationRows.length + (migrationRows.length === 1 ? ' settlement' : ' settlements') + '</span></div><div class="closure-migration-list">' + migrationRows.map(function (row) {
          var id = String(row.id), selected = (closure.ignoredMigrationIds || []).includes(id);
          var missing = [['Total_Service_Cost', 'Quoted'], ['Total_Invoice', 'Invoiced'], ['Total_Paid', 'Paid']].filter(function (item) { var value = row[item[0]]; return value == null || value === '' || !Number.isFinite(Number(value)); }).map(function (item) { return item[1]; });
          return '<label class="closure-migration-item' + (selected ? ' is-selected' : '') + '"><input type="checkbox" data-closure-ignore-migration="' + helpers.escapeHtml(id) + '"' + (selected ? ' checked' : '') + (closure.isSaving || closure.loadFailed ? ' disabled' : '') + '><span class="closure-migration-item-copy"><strong>' + helpers.escapeHtml(row.Name || id) + '</strong><span>Unavailable: ' + helpers.escapeHtml(missing.join(', ')) + '</span></span><span class="closure-migration-choice">' + (selected ? 'Ignored for closure' : 'Ignore for closure') + '</span></label>';
        }).join('') + '</div><p class="closure-migration-footnote">A justification will be saved in Booking Notes. Missing amounts stay unknown; this choice applies only to this closure attempt.</p></section>' : '';

      elements.bookingClosureContent.innerHTML =
        (!deps.reviewClosure && (closure.settlements || []).some(function (row) { return !isNoServicesSettlement(row) && ['Total_Service_Cost','Total_Invoice','Total_Paid'].some(function (field) { return row[field] == null || row[field] === ''; }); }) ? '<p class="booking-closure-notes" role="status">Incomplete financial totals: the summary sums available values only. Inspect unavailable amounts below before closing.</p>' : '') +
        (deps.reviewClosure ? '' : migrationExceptionsMarkup) +
        '<div class="booking-closure-summary">' + [[0,1], [3,4,2], [6,5,7]].map(function (indexes, group) { return '<section class="closure-metric-group"><h3>' + ['Sale and balance','Trip costs','Result'][group] + '</h3><div class="closure-metric-items">' + indexes.map(function (index) { var item = summary[index];
          return '<div' + (item[2] ? ' class="' + helpers.escapeHtml(item[2]) + '"' : '') + '><span>' + helpers.escapeHtml(item[0]) + "</span><strong>" + helpers.escapeHtml(item[1]) + "</strong>" + (item[3] ? '<small>' + helpers.escapeHtml(item[3]) + '</small>' : '') + "</div>";
        }).join("") + '</div></section>'; }).join('') + "</div>" +
        (!deps.reviewClosure && bookingClosureStatus !== 'Closure Completed' && (closure.exceptionIssues || []).length ? '<section class="closure-exception-review" aria-labelledby="closure-exception-heading"><h3 id="closure-exception-heading">Accept closure exceptions</h3><details><summary>' + closure.exceptionIssues.length + ' exceptions to review</summary><ul>' + closure.exceptionIssues.map(function (text) { return '<li>' + helpers.escapeHtml(text) + '</li>'; }).join('') + '</ul></details><label for="closure-exception-reason">Justification</label><textarea id="closure-exception-reason" data-closure-exception-reason rows="2" maxlength="2000" placeholder="Explain why these exceptions are accepted"' + (closure.isSaving ? ' disabled' : '') + (closure.exceptionReasonRequired ? ' aria-invalid="true" aria-describedby="closure-exception-help"' : '') + '>' + helpers.escapeHtml(closure.exceptionReason || '') + '</textarea><div><small id="closure-exception-help">Required. Saved with your user, date and the accepted exceptions in Booking Notes.</small><button type="button" class="button primary" data-closure-action="complete"' + (closure.isSaving || closure.loadFailed ? ' disabled' : '') + '>Confirm and complete closure</button></div></section>' : '') +
        (bookingClosureStatus === 'Closure Completed' ? '<details class="booking-closure-notes"><summary>Closure exceptions and audit</summary>' + ((closure.acceptedExceptionNotes || []).length ? '<p>Latest recorded acceptance; this does not approve later changes.</p><pre class="closure-exception-note">' + helpers.escapeHtml(closure.acceptedExceptionNotes[0].Note_Content || '') + '</pre>' : '<p>No accepted-exception note is available in this view. Review Booking Notes for historical closure evidence.</p>') + '</details>' : '') +
        (deps.reviewClosure && (closure.settlements || []).some(showNoSupplierDetails) ? '<section class="closure-nosupplier" aria-label="Services without supplier"><div class="closure-nosupplier-heading"><h3>Services without supplier</h3></div>' + (closure.settlements || []).filter(showNoSupplierDetails).map(function (row) {
          return '<div class="closure-nosupplier-row"><div><strong>' + helpers.escapeHtml(row.Name) + '</strong><span>' + helpers.escapeHtml(String(row.Service_Count || 0)) + ' services</span></div><button type="button" class="button secondary" data-closure-nosupplier-detail="' + helpers.escapeHtml(String(row.id)) + '">View services</button></div>';
        }).join('') + '</section>' : '') +
        (!deps.reviewClosure && (closure.settlements || []).some(showNoSupplierDetails) ? '<section class="closure-nosupplier" aria-label="NOSUPPLIER review"><div class="closure-nosupplier-heading"><h3>NOSUPPLIER</h3><span>Review before ignoring</span><details><summary aria-label="About ignoring NOSUPPLIER" title="About ignoring NOSUPPLIER"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></svg></summary><p>Ignore applies only to this closure attempt and requires a justification. Review and customer balance checks still apply; figures remain in the financial summary.</p></details></div>' + (closure.settlements || []).filter(showNoSupplierDetails).map(function (row) {
          var sid = helpers.escapeHtml(String(row.id));
          function value(field) { return row[field] == null || row[field] === '' ? 'Unavailable' : helpers.formatCurrency(Number(row[field])); }
          return '<div class="closure-nosupplier-row"><div><strong>' + helpers.escapeHtml(row.Name) + '</strong><span>' + helpers.escapeHtml(String(row.Service_Count || 0)) + ' services | Quoted: ' + helpers.escapeHtml(value('Total_Service_Cost')) + ' | Invoiced: ' + helpers.escapeHtml(value('Total_Invoice')) + ' | Paid: ' + helpers.escapeHtml(value('Total_Paid')) + '</span></div><button type="button" class="button secondary" data-closure-nosupplier-detail="' + sid + '" title="View services, invoices and payments"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/></svg> Details</button><label><input type="checkbox" data-closure-ignore-nosupplier="' + sid + '"' + (ignoredNoSupplier(closure, row) ? ' checked' : '') + (closure.isSaving || closure.loadFailed || bookingClosureStatus === 'Closure Completed' || isNoServicesSettlement(row) ? ' disabled' : '') + '> <span>Ignore NOSUPPLIER</span></label>' + (isNoServicesSettlement(row) ? '<small>No Services: already excluded from closure checks.</small>' : '') + '</div>';
        }).join('') + '</section>' : '') +
        '<div class="booking-closure-legend" role="group" aria-label="Filter settlements">' + [
          ['all', 'All'], ['matched', 'Matched and paid'], ['pending', 'Payment pending'], ['variance', 'Budget differences'], ['missing', 'Invoice missing'], ['reviewed', 'Reviewed']
        ].map(function (item) {
          var count = (closure.settlements || []).filter(function (row) {
            if (isNoServicesSettlement(row) || isNoSupplierSettlement(row)) { return false; }
            var m = getClosureSettlementMetrics(row, invoices);
            return item[0] === 'all' || (item[0] === 'reviewed' ? helpers.normalizeString(m.review) === 'reviewed' : item[0] === 'matched' ? m.hasInvoice && Math.abs(m.variance) <= .01 && m.paid >= m.invoiced - .01 : item[0] === 'pending' ? m.hasInvoice && m.paid < m.invoiced - .01 : item[0] === 'variance' ? m.hasInvoice && Math.abs(m.variance) > .01 : !m.hasInvoice);
          }).length;
          return '<button type="button" aria-pressed="' + (closureFilter === item[0]) + '" class="' + (closureFilter === item[0] ? 'is-active' : '') + '" data-booking-closure-filter="' + item[0] + '">' + item[1] + ' <span>' + count + '</span></button>';
        }).join('') + '</div>' +
        '<div class="table-wrap booking-closure-table-wrap"><table class="results-table"><thead><tr>' + visibleClosureColumns.map(function (key) { return ns.tableColumns.resizableHeader(key, closureHeaders[key]); }).join("") + '<th class="table-columns-gear-cell">' + ns.tableColumns.button("tripClosure") + "</th></tr></thead><tbody>" +
        (rows || '<tr><td colspan="' + (visibleClosureColumns.length + 1) + '" class="table-empty">No settlements were found for this booking.</td></tr>') +
        "</tbody></table></div>";
      if (focusedMigration) {
        var migrationControl = elements.bookingClosureContent.querySelector('[data-closure-ignore-migration="' + focusedMigration + '"]');
        if (migrationControl) { migrationControl.focus({ preventScroll: true }); }
      }
      if (focusedIgnore) {
        var ignoreControl = elements.bookingClosureContent.querySelector('[data-closure-ignore-nosupplier="' + focusedIgnore + '"]');
        if (ignoreControl) { ignoreControl.focus({ preventScroll: true }); }
      }
      if (focusedFilter || focusedSort) {
        var restoredControl = elements.bookingClosureContent.querySelector(focusedFilter ? '[data-booking-closure-filter="' + focusedFilter + '"]' : '[data-booking-closure-sort="' + focusedSort + '"]');
        if (restoredControl) { restoredControl.focus({ preventScroll: true }); }
      }
      var nextWrap = elements.bookingClosureContent.querySelector(".booking-closure-table-wrap");
      if (tableScroll && nextWrap) { nextWrap.scrollTop = tableScroll.top; nextWrap.scrollLeft = tableScroll.left; }
      scrollParents.forEach(function (position) {
        position.element.scrollTop = position.top;
        position.element.scrollLeft = position.left;
      });
      var header = elements.bookingClosurePopup.querySelector('.booking-closure-header');
      var card = elements.bookingClosurePopup.querySelector('.booking-closure-card');
      if (header && card && global.ResizeObserver && !card._closureHeaderObserver) {
        card._closureHeaderObserver = new global.ResizeObserver(function () { card.style.setProperty('--closure-header-height', Math.max(0, header.getBoundingClientRect().height) + 'px'); });
        card._closureHeaderObserver.observe(header);
      }
      if (deps.onClosureRendered) deps.onClosureRendered();
      elements.bookingClosureContent.querySelectorAll('[data-booking-closure-review-settlement-id], [data-booking-closure-request-invoice], [data-booking-closure-rebuild]').forEach(function (button) {
        button.disabled = Boolean(closure.isSaving || closure.loadFailed || bookingClosureStatus === 'Closure Completed');
        if (bookingClosureStatus === 'Closure Completed') { button.title = 'Reopen closure to make changes'; }
        if (focusedReview && button.getAttribute("data-booking-closure-review-settlement-id") === focusedReview && !button.disabled) {
          button.focus({ preventScroll: true });
        }
      });
    }

    function onInvoiceRequested(settlementId) {
      var closure = state.bookingClosure;
      if (!closure) { return; }
      (closure.settlements || []).forEach(function (settlement) {
        if (String(settlement.id) === settlementId) {
          settlement.Closure_Review_Status = "Invoice Requested";
        }
      });
      if (closure.detail && closure.detail.settlement && String(closure.detail.settlement.id) === settlementId) {
        closure.detail.settlement.Closure_Review_Status = "Invoice Requested";
      }
      renderBookingClosure();
    }

    function closeBookingClosure() {
      if (state.bookingClosure.isSaving) { return; }
      state.bookingClosure.isOpen = false;
      if (state.bookingClosure.detail) {
        if (state.bookingClosure.detail.tables) { Object.keys(state.bookingClosure.detail.tables).forEach(function (key) { state.bookingClosure.detail.tables[key].query.cancel(); }); }
        state.bookingClosure.detail.isOpen = false;
      }
      renderBookingClosure();
      renderBookingClosureDetail();
    }

    function renderBookingClosureDetail() {
      var detail = state.bookingClosure && state.bookingClosure.detail || {};
      var settlement = detail.settlement || {};
      var services = detail.services || [];
      var invoices = detail.invoices || [];
      var payments = detail.payments || [];

      if (!elements.bookingClosureDetailPopup) {
        return;
      }

      elements.bookingClosureDetailPopup.hidden = !detail.isOpen;
      if (!detail.isOpen) {
        return;
      }

      elements.bookingClosureDetailTitle.textContent = settlement.Supplier_Name || helpers.getLookupName(settlement.Supplier) || settlement.Name || "Settlement";
      if (detail.isLoading) {
        elements.bookingClosureDetailContent.innerHTML = '<div class="empty-state">Loading settlement details...</div>';
        return;
      }

      function renderTable(headers, rows, emptyCopy) {
        return '<div class="table-wrap"><table class="results-table mini-results-table"><thead><tr>' + headers.map(function (header) {
          return "<th>" + helpers.escapeHtml(header) + "</th>";
        }).join("") + "</tr></thead><tbody>" + (rows || '<tr><td colspan="' + headers.length + '" class="table-empty">' + helpers.escapeHtml(emptyCopy) + "</td></tr>") + "</tbody></table></div>";
      }

      var previousTables = Array.prototype.slice.call(elements.bookingClosureDetailContent.querySelectorAll(".table-wrap"));
      var scrollPositions = previousTables.map(function (wrap) { if (wrap._progressiveTable && wrap._progressiveTable.observer) { wrap._progressiveTable.observer.disconnect(); } return wrap.scrollTop; });
      elements.bookingClosureDetailContent.innerHTML =
        closureReferenceMarkup(settlement) + '<div class="booking-closure-detail-sections">' +
          '<section class="booking-closure-detail-section"><h3>Services <span class="closure-detail-count" title="Loaded records">' + services.length + '</span></h3>' + renderTable(["Service Date", "Name", "Status", "Final purchase cost"], services.map(function (service) {
            return "<tr><td>" + helpers.escapeHtml(helpers.formatDate(service.Service_Date)) + "</td><td>" + '<a target="_blank" rel="noopener" href="https://crm.zoho.eu/crm/tab/' + encodeURIComponent(MODULES.bookingServices) + '/' + encodeURIComponent(service.id) + '">' + helpers.escapeHtml(service.Product_Description || "-") + '</a>' + "</td><td>" + helpers.escapeHtml(service.Status_EZUS || "-") + '</td><td class="numeric-cell">' + helpers.escapeHtml(service.Final_Purchase_Cost == null ? 'Unavailable' : String(service.Final_Purchase_Cost) + ' ' + (service.Currency || '')) + '</td></tr>' ;
          }).join(""), "No services found for this settlement.") + "</section>" +
          '<section class="booking-closure-detail-section"><h3>Invoices <span class="closure-detail-count" title="Loaded records">' + invoices.length + '</span></h3>' + renderTable(["Invoice", "Invoice type", "Date", "Amount"], invoices.map(function (invoice) {
            return "<tr><td>" + helpers.escapeHtml(invoice.Name || "-") + "</td><td>" + getClosureInvoiceTypeBadge(invoice) + "</td><td>" + helpers.escapeHtml(helpers.formatDate(invoice.Invoice_Date)) + '</td><td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(getClosureInvoiceTotal(invoice))) + "</td></tr>";
          }).join(""), "No invoices found for this settlement.") + "</section>" +
          '<section class="booking-closure-detail-section"><h3>Payments <span class="closure-detail-count" title="Loaded records">' + payments.length + '</span></h3>' + renderTable(["Payment", "Date", "Allocated to settlement"], payments.map(function (payment) {
            payment = payment || {};
            return "<tr><td>" + helpers.escapeHtml(payment.Name || "-") + "</td><td>" + helpers.escapeHtml(helpers.formatDate(payment.Payment_Date)) + '</td><td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(payment.Settlement_Allocated_Amount == null ? payment.Payment_Amount : payment.Settlement_Allocated_Amount)) + "</td></tr>";
          }).join(""), "No payments found for this settlement.") + "</section>" +
        "</div>";
      if (detail.tables) {
        var wraps = elements.bookingClosureDetailContent.querySelectorAll(".table-wrap");
        ["services", "invoices", "payments"].forEach(function (key, index) {
          var table = detail.tables[key];
          if (!table || !wraps[index]) { return; }
          ns.renderProgressiveTable(wraps[index], wraps[index].querySelector(".table-empty"), table.view, table.view.onLoadMore);
          wraps[index].scrollTop = scrollPositions[index] || 0;
        });
      }

    }

    function closeBookingClosureDetail() {
      if (state.bookingClosure && state.bookingClosure.detail) {
        if (state.bookingClosure.detail.tables) { Object.keys(state.bookingClosure.detail.tables).forEach(function (key) { state.bookingClosure.detail.tables[key].query.cancel(); }); }
        state.bookingClosure.detail.isOpen = false;
      }
      renderBookingClosureDetail();
    }

    function onBookingClosureTableControlClick(event) {
      var migration = event.target && event.target.closest('[data-closure-ignore-migration]');
      if (migration) {
        if (event.type !== 'change') { return; }
        var context = state.bookingClosure;
        if (!context || migration.disabled || context.isSaving || context.loadFailed || getBookingClosureStatus(context.booking) === 'Closure Completed') { return; }
        var migrationId = migration.getAttribute('data-closure-ignore-migration');
        context.ignoredMigrationIds = (context.ignoredMigrationIds || []).filter(function (id) { return id !== migrationId; });
        if (migration.checked) { context.ignoredMigrationIds.push(migrationId); }
        context.exceptionReason = ''; context.exceptionIssues = []; context.exceptionReasonRequired = false;
        renderBookingClosure();
        return;
      }
      var ignore = event.target && event.target.closest('[data-closure-ignore-nosupplier]');
      if (ignore) {
        if (event.type && event.type !== 'change') { return; }
        var closure = state.bookingClosure;
        if (!closure || ignore.disabled || closure.isSaving || closure.loadFailed || getBookingClosureStatus(closure.booking) === 'Closure Completed') { return; }
        var sid = ignore.getAttribute('data-closure-ignore-nosupplier');
        var row = (closure.settlements || []).find(function (record) { return String(record.id) === sid; });
        if (!row || !isNoSupplierSettlement(row) || isNoServicesSettlement(row)) { return; }
        closure.ignoredNoSupplierIds = (closure.ignoredNoSupplierIds || []).filter(function (id) { return id !== sid; });
        if (ignore.checked) { closure.ignoredNoSupplierIds.push(sid); }
        closure.exceptionReason = ''; closure.exceptionIssues = []; closure.exceptionReasonRequired = false;
        renderBookingClosure();
        return;
      }
      var target = event.target && event.target.closest("[data-booking-closure-sort], [data-booking-closure-filter]");
      var sortKey;
      var filter;

      if (!target) {
        return;
      }

      sortKey = target.getAttribute("data-booking-closure-sort");
      filter = target.getAttribute("data-booking-closure-filter");

      if (sortKey) {
        state.bookingClosure.sort = state.bookingClosure.sort || { key: "supplier", direction: "asc" };
        if (state.bookingClosure.sort.key === sortKey) {
          state.bookingClosure.sort.direction = state.bookingClosure.sort.direction === "asc" ? "desc" : "asc";
        } else {
          state.bookingClosure.sort = { key: sortKey, direction: "asc" };
        }
      } else if (filter) {
        state.bookingClosure.filter = state.bookingClosure.filter === filter && filter !== "all" ? "all" : filter;
      }

      renderBookingClosure();
    }

    async function onBookingClosureSettlementClick(event) {
      var detailButton = event.target && event.target.closest('[data-closure-nosupplier-detail]');
      var interactiveTarget = !detailButton && event.target && event.target.closest("button, summary, details, a, input, select, textarea");
      var row = event.target && event.target.closest("[data-booking-closure-settlement-id]");
      var settlementId = detailButton ? detailButton.getAttribute('data-closure-nosupplier-detail') : row && row.getAttribute("data-booking-closure-settlement-id");
      var settlement;
      var allocations;
      var paymentIds;

      if (interactiveTarget || !settlementId) {
        return;
      }

      settlement = (state.bookingClosure.settlements || []).filter(function (item) {
        return String(item && item.id || "") === settlementId;
      })[0];
      if (!settlement) {
        return;
      }

      closeBookingClosureDetail();
      var detail = state.bookingClosure.detail = { isOpen: true, isLoading: false, settlement: settlement, services: [], invoices: [], payments: [], tables: {} };
      var escapedId = String(settlementId).replace(/'/g, "\\'");
      var paymentDetailsPromise;
      async function readSettlementPayments() {
        var links = await loadClosureRows(MODULES.payAllocations, 'Supplier_Settlement', settlementId);
        var totals = {};
        links.forEach(function (link) {
          var id = helpers.getLookupId(link.Supplier_Payment);
          if (!id || link.Allocated_Amount == null || !Number.isFinite(Number(link.Allocated_Amount))) { throw new Error('Payment allocations are incomplete. Review the settlement in CRM.'); }
          totals[id] = (totals[id] || 0) + Number(link.Allocated_Amount);
        });
        var ids = Object.keys(totals), records = [];
        for (var offset = 0; offset < ids.length; offset += 5) {
          var batch = await Promise.all(ids.slice(offset, offset + 5).map(async function (id) {
            var payment = await crm.getRecord(MODULES.payments, id);
            if (!payment || String(payment.id) !== id) { throw new Error('A linked payment could not be verified. Retry to reload its allocations.'); }
            return Object.assign({}, payment, { Settlement_Allocated_Amount: totals[id] });
          }));
          records = records.concat(batch);
        }
        return records.sort(function (a, b) { return String(b.Payment_Date || '').localeCompare(String(a.Payment_Date || '')) || String(a.id).localeCompare(String(b.id)); });
      }
      await Promise.all(["services", "invoices", "payments"].map(function (key) {
        var view = {}, query;
        query = ns.createProgressiveQuery({ view: view,
          getRecords: function () { return detail[key]; }, setRecords: function (rows) { detail[key] = rows; },
          render: function () { if (state.bookingClosure.detail === detail && detail.isOpen) { renderBookingClosureDetail(); } },
          fetch: async function (search) {
            var module = key === "services" ? MODULES.bookingServices : MODULES[key];
            var fields = key === "services" ? ["id", "Service_Date", "Product_Description", "Status_EZUS", "Final_Purchase_Cost", "Currency"] : key === "invoices" ? ["id", "Name", "Invoice_Date", "Invoice_Type", "Invoice_Total", "Total_Payable_Amount"] : ["id", "Name", "Payment_Date", "Payment_Amount"];
            var order = (key === "services" ? "Service_Date" : key === "invoices" ? "Invoice_Date" : "Payment_Date") + " desc, id asc";
            if (key === 'payments') {
              if (!paymentDetailsPromise) { paymentDetailsPromise = readSettlementPayments().catch(function (error) { paymentDetailsPromise = null; throw error; }); }
              var payments = await paymentDetailsPromise;
              var offset = (search.page - 1) * 50;
              return { records: payments.slice(offset, offset + 50), hasMore: payments.length > offset + 50 };
            }
            return loadCoqlPage(module, fields, { page: search.page, perPage: 50, whereClause: "Supplier_Settlement = '" + escapedId + "'", orderByClause: order });
          }
        });
        view.onLoadMore = query.more;
        detail.tables[key] = { view: view, query: query };
        return query.reset({});
      }));
    }

    async function onBookingClosureRebuildClick(event) {
      var target = event.target && event.target.closest('[data-booking-closure-rebuild]');
      var closure = state.bookingClosure;
      if (!target || target.disabled || !closure || !closure.booking || closure.isSaving || closure.isLoading || closure.loadFailed || getBookingClosureStatus(closure.booking) === 'Closure Completed') { return; }
      var settlementId = target.getAttribute('data-booking-closure-rebuild');
      var rebuildAll = settlementId === 'all';
      var targets = rebuildAll ? (closure.settlements || []).slice() : (closure.settlements || []).filter(function (row) { return String(row.id) === settlementId; });
      if (!targets.length) { return; }
      var settlement = (closure.settlements || []).find(function (row) { return String(row.id) === settlementId; });
      if (!settlement && !rebuildAll) { return; }
      closure.isSaving = true;
      closure.rebuildingSettlementId = settlementId;
      closure.error = '';
      renderer.showError('');
      renderBookingClosure();
      try {
        var response = await crm.executeFunction('rebuildsuppliersettlementtotals', { settlementIdsString: targets.map(function (row) { return String(row.id); }).join('|||') });
        var result = getFunctionOutputObject(response);
        if (!result || result.error !== false || Number(result.processed_count) !== targets.length) {
          throw new Error(result && result.message || 'Rebuild could not be confirmed. Refresh before trying again.');
        }
        var refreshed = [];
        for (var row of targets) {
          var fresh = await crm.getRecord(MODULES.settlements, String(row.id));
          if (!fresh || String(fresh.id) !== String(row.id)) { throw new Error('Totals were rebuilt, but a settlement could not be refreshed. Refresh before continuing.'); }
          refreshed.push(fresh);
        }
        targets.forEach(function (row, index) { Object.assign(row, refreshed[index]); });
        if (rebuildAll) {
          var snapshot = await loadClosureSnapshot(closure);
          // Search indexing can lag behind the rebuild. Keep the direct record
          // read for financial totals and review state instead of stale search values.
          snapshot.settlements.forEach(function (row) {
            var current = refreshed.find(function (fresh) { return String(fresh.id) === String(row.id); });
            if (current) { Object.assign(row, current); }
          });
          closure.settlements = snapshot.settlements;
          closure.invoices = snapshot.invoices;
          await refreshClosureBooking(closure);
          await loadClosureBlockingReason(closure);
          await loadClosureSupplierCodes(closure);
          closure.exceptionIssues = [];
          closure.exceptionReason = '';
          closure.exceptionReasonRequired = false;
        }
        if (closure.detail && closure.detail.settlement) {
          closure.detail.settlement = closure.settlements.find(function (row) { return String(row.id) === String(closure.detail.settlement.id); }) || closure.detail.settlement;
        }
        if (deps.refreshSettlementDataAfterBookingAction) { await deps.refreshSettlementDataAfterBookingAction(); }
        if (deps.onClosureContext) { deps.onClosureContext(closure); }
        var warnings = (result.warnings || []).join(' ');
        if (Number(result.warning_count) > 0 || warnings) {
          renderer.showError('Totals rebuilt with warnings. ' + (warnings || result.message || 'Review the settlement.'));
        } else {
          renderer.showNotice(rebuildAll ? 'All settlement totals rebuilt. Review the updated figures.' : 'Settlement totals rebuilt.', { tone: 'success' });
        }
      } catch (error) {
        closure.error = error.message || 'Could not rebuild settlement totals. Refresh before trying again.';
        closure.loadFailed = true;
        renderer.showError(closure.error);
        debugError('onBookingClosureRebuildClick failed', error, { settlementId: settlementId });
      } finally {
        closure.isSaving = false;
        closure.rebuildingSettlementId = '';
        if (state.bookingClosure === closure && closure.isOpen) {
          renderBookingClosure();
          renderBookingClosureDetail();
          var summary = elements.bookingClosureContent && elements.bookingClosureContent.querySelector('[data-booking-closure-settlement-id="' + settlementId + '"] summary');
          if (summary) { summary.focus({ preventScroll: true }); }
        }
      }
    }

    function onBookingClosureRefreshClick() {
      if (state.bookingClosure && state.bookingClosure.isSaving) { return; }
      var booking = state.bookingClosure && state.bookingClosure.booking;
      var mfspCode = helpers.getCandidateValue(booking, FIELD_CANDIDATES.booking.mfsp);

      if (!mfspCode) {
        renderer.showError("Could not refresh the trip closure because its MFSP reference is unavailable.");
        return;
      }

      return onBookingTripClosureClick(mfspCode);
    }

    async function onBookingClosureReviewClick(event) {
      var target = event.target && event.target.closest("[data-booking-closure-review-settlement-id]");
      var settlementId = target && target.getAttribute("data-booking-closure-review-settlement-id");

      if (!settlementId || target.disabled || state.bookingClosure.isSaving || state.bookingClosure.loadFailed) {
        return;
      }

      var settlement = (state.bookingClosure.settlements || []).find(function (record) {
        return String(record && record.id || "") === settlementId;
      });
      if (!settlement) {
        return;
      }
      var isReviewed = helpers.normalizeString(getClosureReviewStatus(settlement)) === "reviewed";
      var nextReviewStatus = isReviewed ? "Pending review" : "Reviewed";
      var closure = state.bookingClosure;

      target.disabled = true;
      closure.isSaving = true;
      closure.error = '';
      renderBookingClosure();
      try {
        await refreshClosureBooking(closure);
        if (getBookingClosureStatus(closure.booking) === 'Closure Completed') {
          throw new Error('Reopen the closure before changing settlement reviews.');
        }
        var freshSettlement = await crm.getRecord(MODULES.settlements, settlementId);
        if (!freshSettlement || String(freshSettlement.id) !== settlementId ||
            helpers.getLookupId(freshSettlement.Booking) !== String(closure.booking.id)) { throw new Error("The settlement is unavailable or belongs to another booking."); }
        if (closureSettlementSnapshot(freshSettlement) !== closureSettlementSnapshot(settlement)) {
          closure.settlements = closure.settlements.map(function (row) { return String(row.id) === settlementId ? freshSettlement : row; });
          throw new Error("This settlement changed since it was displayed. Review the updated amounts before marking it reviewed.");
        }
        requireClosureWriteSuccess(await crm.updateRecord(MODULES.settlements, settlementId, {
          Closure_Review_Status: nextReviewStatus
        }));
        state.bookingClosure.settlements = (state.bookingClosure.settlements || []).map(function (settlement) {
          if (String(settlement && settlement.id || "") === settlementId) {
            return Object.assign({}, settlement, {
              Closure_Review_Status: nextReviewStatus
            });
          }

          return settlement;
        });
        if (!isReviewed && getBookingClosureStatus(closure.booking) === 'Closure Pending') {
          try { await saveClosureStatus(closure, 'Closure In Review'); }
          catch (error) { throw new Error('Settlement review saved, but the closure status could not advance. Use Start review. ' + error.message); }
        }
        renderer.showNotice(isReviewed ? "Settlement marked as pending review." : "Settlement marked as reviewed.", { tone: "success" });
      } catch (error) {
        closure.error = error.message;
        debugError("onBookingClosureReviewClick failed", error, { settlementId: settlementId });
        renderer.showError(error.message || "Could not update the settlement review status.");
      } finally {
        closure.isSaving = false;
        renderBookingClosure();
      }
    }

    async function onBookingTripClosureClick(mfspOverride) {
      if (state.bookingClosure && state.bookingClosure.isSaving) { return; }
      var mfspCode = String(mfspOverride || getBookingShortcutMfspValue() || "").trim();
      var bookingRecord;
      var closure;

      renderer.showError("");
      try {
        closure = state.bookingClosure = {
          isOpen: true,
          isLoading: true,
          booking: null,
          settlements: [],
          invoices: [],
          ignoredNoSupplierIds: [],
          filter: "all",
          sort: { key: "supplier", direction: "asc" },
          detail: { isOpen: false, isLoading: false, settlement: null, services: [], invoices: [], payments: [] }
        };
        renderBookingClosure();
        renderBookingClosureDetail();
        setBookingActionsPopupOpen(false);
        bookingRecord = await resolveBookingShortcutRecordByMfsp(mfspCode);
        closure.booking = bookingRecord;
        await Promise.all([
          loadClosureBlockingReason(closure),
          loadClosureSnapshot(closure).then(function (snapshot) {
            closure.settlements = snapshot.settlements;
            closure.invoices = snapshot.invoices;
            return loadClosureSupplierCodes(closure);
          })
        ]);
      } catch (error) {
        debugError("onBookingTripClosureClick failed", error, { mfspCode: mfspCode });
        closure.loadFailed = true;
        closure.error = 'Could not load all closure data. Refresh before making changes.';
        if (state.bookingClosure === closure && closure.isOpen) { renderer.showError(error.message || "Could not load the booking closure data."); }
      } finally {
        closure.isLoading = false;
        if (state.bookingClosure === closure && closure.isOpen) { renderBookingClosure(); }
      }
    }

    function getBookingBrowserValue(record, candidates) {
      var lookupValue = helpers.getLookupValue(record, candidates);

      if (lookupValue && typeof lookupValue === "object") {
        return helpers.getLookupName(lookupValue);
      }

      return helpers.getCandidateValue(record, candidates);
    }

    function getBookingBrowserNumber(record, candidates) {
      var rawValue = getBookingBrowserValue(record, candidates);
      var parsedValue;

      if (rawValue === "" || rawValue === "-") {
        return null;
      }

      parsedValue = Number(rawValue);
      return Number.isNaN(parsedValue) ? null : parsedValue;
    }

    function getBookingBrowserPercent(record, candidates) {
      var numericValue = getBookingBrowserNumber(record, candidates);

      if (numericValue === null) {
        return "-";
      }

      return String(Number(numericValue.toFixed(2))) + "%";
    }

    function sortBookingsBrowserRecords(records) {
      return records.slice().sort(function (left, right) {
        var rightDate = Date.parse(getBookingBrowserValue(right, FIELD_CANDIDATES.booking.arrivalDate) || "") || 0;
        var leftDate = Date.parse(getBookingBrowserValue(left, FIELD_CANDIDATES.booking.arrivalDate) || "") || 0;

        if (rightDate !== leftDate) {
          return rightDate - leftDate;
        }

        return getBookingBrowserValue(left, FIELD_CANDIDATES.booking.name).localeCompare(
          getBookingBrowserValue(right, FIELD_CANDIDATES.booking.name),
          "en",
          { sensitivity: "base" }
        );
      });
    }

    function buildBookingCountLabel(count, options) {
      var settings = options || {};
      var label = count + (count === 1 ? " booking" : " bookings");

      if (!settings.hasExactTotal && ((Number(settings.page) || 1) > 1 || settings.hasMore)) {
        return label + " shown";
      }

      return label;
    }

    function filterBookingsBrowserRecords(records, filters) {
      var normalizedFilters = filters || {};
      var arrivalMode = normalizedFilters.arrivalDateMode === "range" ? "range" : "single";
      var arrivalDateFrom = normalizedFilters.arrivalDateFrom || "";
      var arrivalDateTo = normalizedFilters.arrivalDateTo || "";
      var selectedStages = getNormalizedBookingStageValues(normalizedFilters.stageValues);
      var hasStageFilter = selectedStages.length > 0;

      if (!selectedStages.length) {
        return [];
      }

      return (records || []).filter(function (booking) {
        var arrivalDate = helpers.toIsoDate(getBookingBrowserValue(booking, FIELD_CANDIDATES.booking.arrivalDate));
        var stageValue = getBookingBrowserValue(booking, FIELD_CANDIDATES.booking.stage);

        if (normalizedFilters.mfsp && !helpers.matchesText(getBookingBrowserValue(booking, FIELD_CANDIDATES.booking.mfsp), normalizedFilters.mfsp)) {
          return false;
        }

        if (normalizedFilters.bookingName && !helpers.matchesText(getBookingBrowserValue(booking, FIELD_CANDIDATES.booking.name), normalizedFilters.bookingName)) {
          return false;
        }

        if (arrivalMode === "single" && arrivalDateFrom && arrivalDate !== arrivalDateFrom) {
          return false;
        }

        if (arrivalMode === "range" && !helpers.isDateInRange(arrivalDate, arrivalDateFrom, arrivalDateTo)) {
          return false;
        }

        if (normalizedFilters.agency && !helpers.matchesText(getBookingBrowserValue(booking, FIELD_CANDIDATES.booking.agency), normalizedFilters.agency)) {
          return false;
        }

        if (hasStageFilter && selectedStages.indexOf(String(stageValue || "")) === -1) {
          return false;
        }

        if (normalizedFilters.accountingRep && !helpers.matchesText(getBookingBrowserValue(booking, FIELD_CANDIDATES.booking.accountingRep), normalizedFilters.accountingRep)) {
          return false;
        }

        return true;
      });
    }

    var browserQuery;
    function getBrowserQuery() {
      if (!browserQuery) { browserQuery = ns.createProgressiveQuery({
      view: state.views.bookings,
      getRecords: function () { return state.views.bookings.records || []; },
      setRecords: function (records) { state.views.bookings.records = records; },
      render: renderAll,
      resetScroll: function () { var wrap = global.document && global.document.getElementById("bookings-table-wrap"); if (wrap) { wrap.scrollTop = 0; } },
      fetch: async function (query) {
        if (!query.filters.stageValues.length) { return { records: [], hasMore: false }; }
        var result = await loadCoqlPage(MODULES.bookings, BOOKING_BROWSER_PAGE_FIELDS, {
          page: query.page, perPage: query.perPage,
          whereClause: await buildBookingRemoteWhereClause(query.filters),
          orderByClause: await buildBookingRemoteOrderByClause()
        });
        result.records = await hydrateBookingPageRecords(result.records);
        return result;
      }
    }); }
      return browserQuery;
    }

    function loadBookingsBrowserData(options) {
      var view = state.views.bookings;
      if (options && options.page > 1) { return getBrowserQuery().more(); }
      view.appliedFilters = cloneFilterState(options && options.filters || view.filters);
      view.appliedFilters.stageValues = getNormalizedBookingStageValues(view.appliedFilters.stageValues);
      return getBrowserQuery().reset({ filters: view.appliedFilters, perPage: view.perPage });
    }

    function buildBookingsView() {
      var records = state.views.bookings.records || [];
      var emptyMessage = state.currentTab === "bookings" && state.isLoading
        ? "Loading bookings..."
        : state.views.bookings.hasLoaded
        ? "No bookings match the loaded filters."
        : "Use the filters and click Load to fetch bookings.";

      return {
        filteredRecords: records,
        visibleRecords: records,
        countLabel: records.length + " bookings loaded",
        loadingInitial: state.views.bookings.loadingInitial,
        loadingMore: state.views.bookings.loadingMore,
        loadError: state.views.bookings.loadError,
        onLoadMore: function () { return getBrowserQuery().more(); },
        emptyMessage: emptyMessage,
        hasLoaded: Boolean(state.views.bookings.hasLoaded),
        page: Math.max(1, Number(state.views.bookings.page) || 1),
        hasMore: Boolean(state.views.bookings.hasMore),
        pageSummary: state.views.bookings.pageSummary || "Page 1",
        stageOptions: BOOKING_STAGE_FILTER_OPTIONS.map(function (value) {
          return {
            value: value,
            label: value
          };
        }),
        formatters: {
          text: function (record, candidates) {
            return helpers.textValue(getBookingBrowserValue(record, candidates));
          },
          date: function (record, candidates) {
            return helpers.formatDate(getBookingBrowserValue(record, candidates));
          },
          currency: function (record, candidates) {
            var numericValue = getBookingBrowserNumber(record, candidates);
            return numericValue === null ? "-" : helpers.formatCurrency(numericValue);
          },
          number: function (record, candidates) {
            var numericValue = getBookingBrowserNumber(record, candidates);
            return numericValue === null ? "-" : String(Number.isInteger(numericValue) ? numericValue : Number(numericValue.toFixed(2)));
          },
          percent: function (record, candidates) {
            return getBookingBrowserPercent(record, candidates);
          }
        }
      };
    }

    return {
      onStageToggleClick: onBookingsStageToggleClick,
      onStageOptionChange: onBookingsStageOptionChange,
      onStageMenuActionClick: onBookingsStageMenuActionClick,
      onDocumentClickCloseStageDropdown: onDocumentClickCloseBookingsStageDropdown,
      onActionsToggleClick: onBookingActionsToggleClick,
      onDocumentClickCloseActionsPopup: onDocumentClickCloseBookingActionsPopup,
      onDocumentKeydownCloseActionsPopup: onDocumentKeydownCloseBookingActionsPopup,
      setActionsPopupOpen: setBookingActionsPopupOpen,
      onSyncProjectClick: onBookingSyncProjectClick,
      onRecalculateSettlementClick: onBookingRecalculateSettlementClick,
      onRowActionClick: onBookingRowActionClick,
      onAgentCommissionRecalculateClick: onAgentCommissionRecalculateClick,
      closeAgentCommissionPopup: closeAgentCommissionPopup,
      onTripClosureClick: onBookingTripClosureClick,
      closeBookingClosure: closeBookingClosure,
      closeBookingClosureDetail: closeBookingClosureDetail,
      onClosureRefreshClick: onBookingClosureRefreshClick,
      onClosureRebuildClick: onBookingClosureRebuildClick,
      onClosureReviewClick: onBookingClosureReviewClick,
      onClosureCopyClick: onClosureCopyClick,
      onClosureStatusClick: onClosureStatusClick,
      onClosurePopoverDismiss: onClosurePopoverDismiss,
      onInvoiceRequested: onInvoiceRequested,
      onClosureTableControlClick: onBookingClosureTableControlClick,
      onClosureSettlementClick: onBookingClosureSettlementClick,
      loadBrowserData: loadBookingsBrowserData,
      cancelBrowser: function () { if (browserQuery) { browserQuery.cancel(); } },
      buildView: buildBookingsView
    };
  };
}(window));
