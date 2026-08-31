(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

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
      var syncLabel = "Sync project";
      var recalculateLabel = "Recalculate settlement";

      if (elements.bookingActionsMfsp) {
        elements.bookingActionsMfsp.disabled = Boolean(isBusy);
      }

      if (elements.bookingActionsSyncProject) {
        elements.bookingActionsSyncProject.disabled = Boolean(isBusy);
        elements.bookingActionsSyncProject.textContent = isBusy && actionKey === "sync"
          ? "Syncing project..."
          : syncLabel;
      }

      if (elements.bookingActionsRecalculateSettlement) {
        elements.bookingActionsRecalculateSettlement.disabled = Boolean(isBusy);
        elements.bookingActionsRecalculateSettlement.textContent = isBusy && actionKey === "recalculate"
          ? "Recalculating..."
          : recalculateLabel;
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

        if (output.error === true || output.success === false || result.success === false) {
          throw new Error(output.message || result.message || "The booking project could not be synced.");
        }

        renderer.showNotice(output.message || result.message || ("Project synced for " + bookingLabel + "."), {
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
        renderer.setLoading(false);
        setBookingShortcutBusyState(false);
      }
    }

    async function onBookingRecalculateSettlementClick() {
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

        if (output.error === true || output.success === false || result.success === false) {
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

        agentCommissionError = getAgentCommissionRecalculationError(output);
        if (agentCommissionError) {
          throw new Error(agentCommissionError);
        }

        settlement = await findRecalculatedAgentCommissionSettlement(output, agentCommissionBookingId);
        if (!settlement) {
          setAgentCommissionPopup(true, "The agent commission settlement is still missing after recalculation. There is another problem with this booking; please review its agent, agency and commission data.", false);
          return;
        }

        await openAgentCommissionInvoice(settlement);
        setAgentCommissionPopup(false, "", false);
      } catch (error) {
        debugError("onAgentCommissionRecalculateClick failed", error, { bookingId: agentCommissionBookingId });
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
      return helpers.normalizeString(helpers.textValue(settlement && settlement.Admin_Status, "")) === "noservices";
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
      return "is-pending";
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
      var relatedInvoices = (invoices || []).filter(function (invoice) {
        return helpers.getLookupId(invoice.Supplier_Settlement) === settlementId;
      });
      var quoted = getClosureNumber(settlement, "Total_Service_Cost");
      var invoiced = relatedInvoices.length
        ? relatedInvoices.reduce(function (total, invoice) { return total + getClosureInvoiceTotal(invoice); }, 0)
        : getClosureNumber(settlement, "Total_Invoice");
      var paid = getClosureNumber(settlement, "Total_Paid");
      var hasInvoice = relatedInvoices.length > 0;
      var isPaid = hasInvoice && paid >= invoiced - 0.01;
      var variance = quoted - invoiced;
      var review = getClosureReviewStatus(settlement);
      var isReviewed = helpers.normalizeString(review) === "reviewed";
      var tone = !hasInvoice ? "is-alert" : hasInvoice && isPaid && Math.abs(variance) <= 0.01 ? "is-ok" : "is-pending";
      var status = !hasInvoice ? "Invoice missing" : Math.abs(variance) > 0.01 ? "Amount differs from quote" : tone === "is-ok" ? "Matched and paid" : "Payment pending";

      return {
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

      elements.bookingClosurePopup.hidden = !closure.isOpen;
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
        elements.bookingClosureContent.innerHTML = '<div class="empty-state">Loading booking closure data...</div>';
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
        ["Sales Price now", helpers.formatCurrency(currentSalesPrice)],
        ["Balance Due Amount", helpers.formatCurrency(getClosureNumber(booking, "Balance_Amount"))],
        ["Quoted cost", helpers.formatCurrency(quotedCost)],
        ["Invoiced cost", helpers.formatCurrency(invoicedCost)],
        ["Paid", helpers.formatCurrency(paidCost)],
        ["Expected margin", helpers.formatCurrency(expectedMargin)],
        ["Final margin", helpers.formatCurrency(actualMargin)],
        [costVariance >= 0 ? "Gain vs quote" : "Loss vs quote", helpers.formatCurrency(Math.abs(costVariance))]
      ];
      closureFilter = closure.filter || "all";
      closureSort = closure.sort || { key: "supplier", direction: "asc" };
      settlements = settlements.filter(function (settlement) {
        return closureFilter === "all" || getClosureSettlementMetrics(settlement, invoices).color === closureFilter;
      }).sort(function (left, right) {
        return compareClosureRows(
          getClosureSettlementMetrics(left, invoices),
          getClosureSettlementMetrics(right, invoices),
          closureSort.key,
          closureSort.direction
        );
      });
      rows = settlements.map(function (settlement) {
        var settlementId = String(settlement.id || "");
        var relatedInvoices = invoices.filter(function (invoice) {
          return helpers.getLookupId(invoice.Supplier_Settlement) === settlementId;
        });
        var quoted = getClosureNumber(settlement, "Total_Service_Cost");
        var invoiced = relatedInvoices.length
          ? relatedInvoices.reduce(function (total, invoice) { return total + getClosureInvoiceTotal(invoice); }, 0)
          : getClosureNumber(settlement, "Total_Invoice");
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
          : Math.abs(variance) > 0.01
          ? "Amount differs from quote"
          : tone === "is-ok"
          ? "Matched and paid"
          : "Payment pending";
        var settlementDetail = isAgentCommission
          ? "Commission"
          : String(settlement.Service_Count || 0) + " services";

        return [
          '<tr class="booking-closure-row ' + tone + (isReviewed ? " is-reviewed" : "") + (isAgentCommission ? " booking-closure-agent-commission" : "") + '" data-booking-closure-settlement-id="' + helpers.escapeHtml(settlementId) + '">',
          "<td><strong>" + helpers.escapeHtml(settlement.Supplier_Name || helpers.getLookupName(settlement.Supplier) || settlement.Name || "-") + "</strong><br><span class=\"table-inline-secondary\">" + helpers.escapeHtml(settlement.Name || "") + " · " + helpers.escapeHtml(settlementDetail) + "</span></td>",
          '<td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(quoted)) + "</td>",
          '<td class="numeric-cell">' + helpers.escapeHtml(hasInvoice ? helpers.formatCurrency(invoiced) : "-") + "</td>",
          '<td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(paid)) + "</td>",
          '<td class="numeric-cell booking-closure-variance ' + varianceTone + '">' + helpers.escapeHtml(hasInvoice ? helpers.formatCurrency(variance) : "-") + "</td>",
          "<td>" + helpers.escapeHtml(status) + "</td>",
          '<td><span class="status-pill ' + helpers.escapeHtml(helpers.getStatusTone(closureReviewStatus)) + (isReviewed ? " booking-closure-review-pill" : "") + '">' + helpers.escapeHtml(closureReviewStatus) + "</span></td>",
          '<td><details class="booking-closure-actions"><summary aria-label="Settlement actions" title="Settlement actions">&#8942;</summary><div>' +
            (isReviewed
              ? '<button type="button" class="button secondary" disabled>Reviewed</button>'
              : '<button type="button" class="button secondary" data-booking-closure-review-settlement-id="' + helpers.escapeHtml(settlementId) + '">Mark as reviewed</button>') +
            '<button type="button" class="button secondary" title="Coming soon">Request invoice</button></div></details></td>',
          "</tr>"
        ].join("");
      }).join("");

      elements.bookingClosureContent.innerHTML =
        '<div class="booking-closure-summary">' + summary.map(function (item) {
          return "<div><span>" + helpers.escapeHtml(item[0]) + "</span><strong>" + helpers.escapeHtml(item[1]) + "</strong></div>";
        }).join("") + "</div>" +
        '<div class="booking-closure-legend"><button type="button" class="' + (closureFilter === "all" ? "is-active" : "") + '" data-booking-closure-filter="all">All</button><button type="button" class="is-ok' + (closureFilter === "matched" ? " is-active" : "") + '" data-booking-closure-filter="matched">Matched, invoiced and paid</button><button type="button" class="is-pending' + (closureFilter === "pending" ? " is-active" : "") + '" data-booking-closure-filter="pending">Payment pending or amount differs from quote</button><button type="button" class="is-alert' + (closureFilter === "missing" ? " is-active" : "") + '" data-booking-closure-filter="missing">Invoice missing</button><button type="button" class="is-reviewed' + (closureFilter === "reviewed" ? " is-active" : "") + '" data-booking-closure-filter="reviewed">Reviewed</button></div>' +
        '<div class="table-wrap booking-closure-table-wrap"><table class="results-table"><thead><tr>' + getClosureSortHeader("Supplier / settlement", "supplier", closureSort) + getClosureSortHeader("Quoted", "quoted", closureSort) + getClosureSortHeader("Invoiced", "invoiced", closureSort) + getClosureSortHeader("Paid", "paid", closureSort) + getClosureSortHeader("Variance", "variance", closureSort) + getClosureSortHeader("Status", "status", closureSort) + getClosureSortHeader("Closure review", "review", closureSort) + "<th>Actions</th></tr></thead><tbody>" +
        (rows || '<tr><td colspan="8" class="table-empty">No settlements were found for this booking.</td></tr>') +
        "</tbody></table></div>";
    }

    function closeBookingClosure() {
      state.bookingClosure.isOpen = false;
      if (state.bookingClosure.detail) {
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

      elements.bookingClosureDetailContent.innerHTML =
        '<div class="booking-closure-detail-sections">' +
          '<section class="booking-closure-detail-section"><h3>Services</h3>' + renderTable(["Service Date", "Name", "Status"], services.map(function (service) {
            return "<tr><td>" + helpers.escapeHtml(helpers.formatDate(service.Service_Date)) + "</td><td>" + helpers.escapeHtml(service.Product_Description || "-") + "</td><td>" + helpers.escapeHtml(service.Status_EZUS || "-") + "</td></tr>";
          }).join(""), "No services found for this settlement.") + "</section>" +
          '<section class="booking-closure-detail-section"><h3>Invoices</h3>' + renderTable(["Invoice", "Invoice type", "Date", "Amount"], invoices.map(function (invoice) {
            return "<tr><td>" + helpers.escapeHtml(invoice.Name || "-") + "</td><td>" + getClosureInvoiceTypeBadge(invoice) + "</td><td>" + helpers.escapeHtml(helpers.formatDate(invoice.Invoice_Date)) + '</td><td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(getClosureInvoiceTotal(invoice))) + "</td></tr>";
          }).join(""), "No invoices found for this settlement.") + "</section>" +
          '<section class="booking-closure-detail-section"><h3>Payments</h3>' + renderTable(["Payment", "Date", "Amount"], payments.map(function (payment) {
            payment = payment || {};
            return "<tr><td>" + helpers.escapeHtml(payment.Name || "-") + "</td><td>" + helpers.escapeHtml(helpers.formatDate(payment.Payment_Date)) + '</td><td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(payment.Payment_Amount)) + "</td></tr>";
          }).join(""), "No payments found for this settlement.") + "</section>" +
        "</div>";
    }

    function closeBookingClosureDetail() {
      if (state.bookingClosure && state.bookingClosure.detail) {
        state.bookingClosure.detail.isOpen = false;
      }
      renderBookingClosureDetail();
    }

    function onBookingClosureTableControlClick(event) {
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
      var interactiveTarget = event.target && event.target.closest("button, summary, details, a, input, select, textarea");
      var row = event.target && event.target.closest("[data-booking-closure-settlement-id]");
      var settlementId = row && row.getAttribute("data-booking-closure-settlement-id");
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

      state.bookingClosure.detail = { isOpen: true, isLoading: true, settlement: settlement, services: [], invoices: [], payments: [] };
      renderBookingClosureDetail();
      try {
        allocations = await crm.searchRecord(MODULES.payAllocations, "(Supplier_Settlement:equals:" + settlementId + ")");
        paymentIds = helpers.uniqueNonEmpty((allocations || []).map(function (allocation) {
          return helpers.getLookupId(allocation.Supplier_Payment);
        }));
        state.bookingClosure.detail.services = await crm.searchRecord(MODULES.bookingServices, "(Supplier_Settlement:equals:" + settlementId + ")");
        state.bookingClosure.detail.invoices = await crm.searchRecord(MODULES.invoices, "(Supplier_Settlement:equals:" + settlementId + ")");
        state.bookingClosure.detail.payments = await Promise.all(paymentIds.map(function (paymentId) {
          return crm.getRecord(MODULES.payments, paymentId);
        }));
      } catch (error) {
        debugError("onBookingClosureSettlementClick failed", error, { settlementId: settlementId });
        renderer.showError(error.message || "Could not load the settlement details.");
      } finally {
        state.bookingClosure.detail.isLoading = false;
        renderBookingClosureDetail();
      }
    }

    function onBookingClosureRefreshClick() {
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

      if (!settlementId) {
        return;
      }

      target.disabled = true;
      try {
        await crm.updateRecord(MODULES.settlements, settlementId, {
          Closure_Review_Status: "Reviewed"
        });
        state.bookingClosure.settlements = (state.bookingClosure.settlements || []).map(function (settlement) {
          if (String(settlement && settlement.id || "") === settlementId) {
            return Object.assign({}, settlement, {
              Closure_Review_Status: "Reviewed"
            });
          }

          return settlement;
        });
        renderBookingClosure();
        renderer.showNotice("Settlement marked as reviewed.", { tone: "success" });
      } catch (error) {
        target.disabled = false;
        debugError("onBookingClosureReviewClick failed", error, { settlementId: settlementId });
        renderer.showError(error.message || "Could not mark the settlement as reviewed.");
      }
    }

    async function onBookingTripClosureClick(mfspOverride) {
      var mfspCode = String(mfspOverride || getBookingShortcutMfspValue() || "").trim();
      var bookingRecord;

      renderer.showError("");
      try {
        state.bookingClosure = {
          isOpen: true,
          isLoading: true,
          booking: null,
          settlements: [],
          invoices: [],
          filter: "all",
          sort: { key: "supplier", direction: "asc" },
          detail: { isOpen: false, isLoading: false, settlement: null, services: [], invoices: [], payments: [] }
        };
        renderBookingClosure();
        renderBookingClosureDetail();
        setBookingActionsPopupOpen(false);
        bookingRecord = await resolveBookingShortcutRecordByMfsp(mfspCode);
        state.bookingClosure.booking = bookingRecord;
        await Promise.all([
          crm.searchRecord(MODULES.settlements, "(Booking:equals:" + bookingRecord.id + ")").then(function (records) {
            state.bookingClosure.settlements = records || [];
          }),
          crm.searchRecord(MODULES.invoices, "(Booking:equals:" + bookingRecord.id + ")").then(function (records) {
            state.bookingClosure.invoices = records || [];
          })
        ]);
      } catch (error) {
        debugError("onBookingTripClosureClick failed", error, { mfspCode: mfspCode });
        renderer.showError(error.message || "Could not load the booking closure data.");
      } finally {
        state.bookingClosure.isLoading = false;
        renderBookingClosure();
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

    async function loadBookingsBrowserData() {
      var options = arguments[0] || {};
      var currentFilters = cloneFilterState(options.filters || state.views.bookings.filters);
      var targetPage = Math.max(1, Number(options.page) || 1);
      var remotePage;
      var pageRecords;

      renderer.showError("");
      renderer.showNotice("Loading bookings...", {
        isLoading: true
      });
      renderer.setLoading(true, "Loading bookings...");
      renderAll();

      try {
        currentFilters.stageValues = getNormalizedBookingStageValues(currentFilters.stageValues);
        remotePage = await loadCoqlPage(MODULES.bookings, BOOKING_BROWSER_PAGE_FIELDS, {
          page: targetPage,
          perPage: state.views.bookings.perPage,
          whereClause: await buildBookingRemoteWhereClause(currentFilters),
          orderByClause: await buildBookingRemoteOrderByClause()
        });
        pageRecords = await hydrateBookingPageRecords(remotePage.records);
        state.views.bookings.records = sortBookingsBrowserRecords(pageRecords);
        state.views.bookings.page = remotePage.page;
        state.views.bookings.hasMore = remotePage.hasMore;
        state.views.bookings.countLabel = buildBookingCountLabel(pageRecords.length, {
          page: remotePage.page,
          hasMore: remotePage.hasMore,
          hasExactTotal: !remotePage.hasMore && remotePage.page <= 1
        });
        state.views.bookings.pageSummary = buildRemotePageSummary(remotePage.page, remotePage.hasMore);
        state.views.bookings.appliedFilters = cloneFilterState(currentFilters);
        state.views.bookings.hasLoaded = true;
        renderAll();
      } catch (error) {
        if (canUseBookingSearchFallback(currentFilters)) {
          try {
            remotePage = await loadBookingSearchFallbackPage(currentFilters, targetPage);
            pageRecords = await hydrateBookingPageRecords(remotePage.records);
            state.views.bookings.records = sortBookingsBrowserRecords(pageRecords);
            state.views.bookings.page = remotePage.page;
            state.views.bookings.hasMore = remotePage.hasMore;
            state.views.bookings.countLabel = buildBookingCountLabel(pageRecords.length, {
              page: remotePage.page,
              hasMore: remotePage.hasMore,
              hasExactTotal: !remotePage.hasMore && remotePage.page <= 1
            });
            state.views.bookings.pageSummary = buildRemotePageSummary(remotePage.page, remotePage.hasMore);
            state.views.bookings.appliedFilters = cloneFilterState(currentFilters);
            state.views.bookings.hasLoaded = true;
            renderAll();
          } catch (fallbackError) {
            renderer.showError(getFriendlyLoadErrorMessage("bookings", error, fallbackError.message || "Could not load bookings."));
          }
        } else {
          renderer.showError(getFriendlyLoadErrorMessage("bookings", error, "Could not load bookings."));
        }
      } finally {
        renderer.setLoading(false);
        renderer.showNotice("");
        renderAll();
      }
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
        countLabel: state.views.bookings.countLabel || "0 bookings",
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
      onClosureReviewClick: onBookingClosureReviewClick,
      onClosureTableControlClick: onBookingClosureTableControlClick,
      onClosureSettlementClick: onBookingClosureSettlementClick,
      loadBrowserData: loadBookingsBrowserData,
      buildView: buildBookingsView
    };
  };
}(window));
