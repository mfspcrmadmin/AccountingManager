(function (global) {
var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createInvoiceCreateModule = function (deps) {
    var invoiceDateDefaultType;
    function updateInvoiceDateDefault(force) {
      var type = isInvoiceCreateRefundMode() ? "Credit Note" : elements.invoiceCreateType.value;
      if (force || type !== invoiceDateDefaultType) {
        elements.invoiceCreateDate.value = ns.defaultInvoiceDate(type);
        invoiceDateDefaultType = type;
      }
    }
    var MODULES = deps.MODULES;
    var FIELD_CANDIDATES = deps.FIELD_CANDIDATES;
    var INVOICE_LINE_FIELDS = deps.INVOICE_LINE_FIELDS;
    var CREATE_LINES_FUNCTION = deps.CREATE_LINES_FUNCTION;
    var INVOICE_CREATE_MODES = deps.INVOICE_CREATE_MODES;
    var INVOICE_CREATE_STEPS = deps.INVOICE_CREATE_STEPS;
    var INVOICE_CREATE_VALIDATION_FIELD_KEYS = deps.INVOICE_CREATE_VALIDATION_FIELD_KEYS;
    var INVOICE_TYPES = deps.INVOICE_TYPES;
    var DEFAULT_INVOICE_STATUS = deps.DEFAULT_INVOICE_STATUS;
    var state = deps.state;
    var elements = deps.elements;
    var helpers = deps.helpers;
    var crm = deps.crm;
    var renderer = deps.renderer;
    var renderAll = deps.renderAll;
    var debugError = deps.debugError;
    var debugWarn = deps.debugWarn;
    var setInvoiceCreateStep = deps.setInvoiceCreateStep;
    var getInvoiceCreateStep = deps.getInvoiceCreateStep;
    var getLocalIsoDate = deps.getLocalIsoDate;
    var applyInvoiceCreateSupplierTaxDefaults = deps.applyInvoiceCreateSupplierTaxDefaults;
    var isInvoiceCreateRefundMode = deps.isInvoiceCreateRefundMode;
    var getInvoiceCreateRecordLabel = deps.getInvoiceCreateRecordLabel;
    var getInvoiceCreateStepForFieldKey = deps.getInvoiceCreateStepForFieldKey;
    var getInvoiceCreateSelectedTypeValue = deps.getInvoiceCreateSelectedTypeValue;
    var getInvoiceCreateTypeOptionsForMode = deps.getInvoiceCreateTypeOptionsForMode;
    var getInvoiceCreateTitleText = deps.getInvoiceCreateTitleText;
    var syncInvoiceCreateModeDefaults = deps.syncInvoiceCreateModeDefaults;
    var ensureBookingsLoaded = deps.ensureBookingsLoaded;
    var ensureInvoiceCreateFieldMetadataLoaded = deps.ensureInvoiceCreateFieldMetadataLoaded;
    var ensureInvoiceCreateSettlementStatusOptionsLoaded = deps.ensureInvoiceCreateSettlementStatusOptionsLoaded;
    var getDefaultInvoiceCreateSettlementStatusValues = deps.getDefaultInvoiceCreateSettlementStatusValues;
    var getNormalizedInvoiceCreateSettlementStatusValues = deps.getNormalizedInvoiceCreateSettlementStatusValues;
    var hasAllInvoiceCreateSettlementStatusesSelected = deps.hasAllInvoiceCreateSettlementStatusesSelected;
    var getUniqueSortedValues = deps.getUniqueSortedValues;
    var getResolvedInvoiceCreateFieldApi = deps.getResolvedInvoiceCreateFieldApi;
    var validateInvoiceCreateSettlementCapacity = deps.validateInvoiceCreateSettlementCapacity;
    var validateInvoiceCreateNumberUniqueness = deps.validateInvoiceCreateNumberUniqueness;
    var isSupplierSelfEmployed = deps.isSupplierSelfEmployed;
    var updateSupplierSelfEmployedStatus = deps.updateSupplierSelfEmployedStatus;
    var recalculateSettlementTotals = deps.recalculateSettlementTotals;
    var invalidateInvoiceCreateSettlementCache = deps.invalidateInvoiceCreateSettlementCache;
    var getSupplierResolvedAccountingAccount = deps.getSupplierResolvedAccountingAccount;
    var getSupplierDefaultPaymentAccountLabel = deps.getSupplierDefaultPaymentAccountLabel;
    var renderInvoiceCreateSelect = deps.renderInvoiceCreateSelect;
    var getInvoiceCreateSettlementUnpaidInvoicedAmount = deps.getInvoiceCreateSettlementUnpaidInvoicedAmount;
    var getInvoiceCreateSettlementRemainingToInvoice = deps.getInvoiceCreateSettlementRemainingToInvoice;
    var isIrpfSelfEmploymentPromptOpen = false;
    var resolveIrpfSelfEmploymentConfirmation = null;
    var resolveCoqlFields = deps.resolveCoqlFields;
    var escapeCoqlValue = deps.escapeCoqlValue;
    var formatFileSize = deps.formatFileSize;
    var getInvoiceCreateDocumentFile = deps.getInvoiceCreateDocumentFile;
    var getInvoiceCreateNumberValue = deps.getInvoiceCreateNumberValue;
    var calculationView = { rows: [], loading: false, error: "" };
    var calculationRetrying = "";
    var serviceSelectionGeneration = 0;
    var settlementLoadGeneration = 0;
    var calculationMonitor = ns.createSettlementCalculationMonitor ? ns.createSettlementCalculationMonitor({
      crm: crm,
      onChange: function (view, retrying) {
        calculationView = view;
        calculationRetrying = retrying;
        renderCalculationStatus();
        if (state.invoiceCreation.isOpen && elements.invoiceCreateSettlementTableBody) { renderInvoiceCreateSettlementTable(); }
      },
      onSnapshot: async function (snapshot, isCurrent) {
        if (!isCurrent() || !state.invoiceCreation.isOpen || String(state.supplierId) !== snapshot.supplierId ||
            state.invoiceCreation.isLoadingSettlements || state.isLoading || submitInProgress) { return; }
        var records = normalizeSettlements(snapshot.settlements);
        var old = state.invoiceCreation.settlements || [];
        if (JSON.stringify(old) === JSON.stringify(records)) { return; }
        invalidateInvoiceCreateSettlementCache();
        state.invoiceCreation.hasLoadedSettlements = true;
        state.invoiceCreation.loadedSupplierId = snapshot.supplierId;
        if (ns.reconcileCalculationSettlements(state.invoiceCreation, records)) {
          setInvoiceCreateStep(INVOICE_CREATE_STEPS.settlement);
          state.invoiceCreation.settlementDropdownOpen = true;
          renderer.showError("A selected settlement is no longer available for this supplier. Review the selection before saving.");
        }
        state.invoiceCreation.services = [];
        renderAll();
        var currentSelection = state.invoiceCreation.selectedSettlement;
        if (currentSelection) {
          var services = await loadServicesForSettlement(currentSelection.id);
          if (isCurrent() && state.invoiceCreation.isOpen && state.invoiceCreation.selectedSettlement &&
              String(state.invoiceCreation.selectedSettlement.id) === String(currentSelection.id)) {
            state.invoiceCreation.services = services;
            renderAll();
          }
        }
      }
    }) : null;

    function renderCalculationStatus() {
      if (!elements.invoiceCreateCalculation || !calculationMonitor) { return; }
      elements.invoiceCreateCalculation.hidden = !state.invoiceCreation.isOpen;
      var selectedBookings = getSelectedInvoiceCreateSettlements().map(function (record) { return helpers.getLookupId(record.Booking); });
      var rows = (calculationView.rows || []).filter(function (row) { return selectedBookings.indexOf(row.bookingId) !== -1; });
      var affected = rows.filter(function (row) { return row.status !== "idle"; });
      var unknown = !!calculationView.error;
      var host = elements.invoiceCreateCalculation;
      var toggle = host.querySelector('#invoice-create-calculation-toggle');
      var details = host.querySelector('#invoice-create-calculation-details');
      toggle.onclick = function () {
        details.hidden = !details.hidden;
        toggle.setAttribute('aria-expanded', String(!details.hidden));
      };
      var count = host.querySelector('#invoice-create-calculation-count');
      count.innerHTML = (affected.length ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v1"/></svg>' : '') + affected.length;
      count.setAttribute('aria-label', affected.length + ' bookings need attention');
      count.dataset.tone = unknown ? 'error' : affected.length ? 'warning' : 'neutral';
      elements.invoiceCreateCalculationSummary.textContent = 'Calculation status';
      elements.invoiceCreateCalculationChecked.textContent = calculationView.loading ? 'Checking status…' :
        'Last checked: ' + (calculationView.checkedAt ? new Date(calculationView.checkedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Not checked');
      host.querySelector('#invoice-create-calculation-help').textContent =
        (calculationView.checkedAt ? 'Last checked: ' + new Date(calculationView.checkedAt).toLocaleString() + '. ' : '') +
        'Checks bookings of selected settlements every 30 seconds (read-only). This panel starts a recalculation only when you click Recover calculation. Scheduled CRM jobs run independently. An empty queue does not guarantee that all source data is current.';
      elements.invoiceCreateCalculationRefresh.classList.toggle('is-checking', calculationView.loading);
      elements.invoiceCreateCalculationRefresh.setAttribute('aria-busy', String(calculationView.loading));
      var selectedPending = rows.some(function (row) { return selectedBookings.indexOf(row.bookingId) !== -1 && (row.status !== "idle" || row.bookingId === calculationRetrying); });
      var warning = selectedPending ? "Selected settlement amounts may be out of date. See calculation details." : "";
      if (unknown && selectedBookings.length) { warning = "Selected settlement calculation status is unverified."; }
      elements.invoiceCreateCalculationWarning.textContent = warning;
      elements.invoiceCreateCalculationWarning.hidden = !warning;
      elements.invoiceCreateCalculationRefresh.disabled = calculationView.loading || !!calculationRetrying;
      var escape = helpers.escapeHtml;
      var spinner = '<span class="calculation-spinner" aria-hidden="true"></span>';
      var openTechnical = Array.from(elements.invoiceCreateCalculationRows.querySelectorAll('details[open]')).map(function (node) { return node.dataset.booking; });
      var markup = rows.slice().sort(function (a, b) { return Number(a.status === "idle") - Number(b.status === "idle"); }).map(function (row) {
        var recovering = row.bookingId === calculationRetrying;
        var running = row.status === 'running' || recovering;
        var label = recovering ? 'Recovering' : row.status === 'running' ? 'Calculating' : row.status === 'unconfirmed' ? 'Unconfirmed' : row.status === 'failed' ? 'Failed' : row.status === 'pending' ? row.onHold ? 'On hold' : 'Pending' : 'No pending work';
        var description = recovering ? 'Recovery is in progress.' : row.status === 'running' ? 'A calculation is in progress.' : row.status === 'unconfirmed' ? 'The previous calculation ended without confirmed completion.' : row.status === 'failed' ? 'Calculation failed. Review the details before retrying.' : row.status === 'pending' ? row.onHold ? 'Calculation is on hold.' : 'Waiting for calculation.' : 'No pending calculation was found.';
        var ref = state.indexes && state.indexes.mfspByBookingId && state.indexes.mfspByBookingId[row.bookingId];
        var name = row.mfsp || ref || (row.label !== row.bookingId ? row.label : 'Reference unavailable');
        var technical = 'Booking ID: ' + row.bookingId + (row.error ? '\n' + row.error : '') + (row.recovery ? '\n' + row.recovery.message : '');
        return '<article class="settlement-calculation-row" data-booking="' + escape(row.bookingId) + '"><div class="calculation-card-heading"><strong>' + escape(name) + '</strong><span class="calculation-badge" data-tone="' + (row.status === 'failed' ? 'error' : row.status === 'unconfirmed' || row.status === 'pending' ? 'warning' : 'neutral') + '">' + (running ? spinner : '') + escape(label) + '</span></div>' +
          '<p>' + escape(description) + '</p><dl class="calculation-metadata"><div><dt>Last calculation update</dt><dd>' + escape(row.lastCalculated ? new Date(row.lastCalculated).toLocaleString() : 'Unavailable') + '</dd></div>' +
          (row.nextRunAt && row.status === 'pending' && !row.onHold ? '<div><dt>Next attempt eligible</dt><dd>' + escape(new Date(row.nextRunAt).toLocaleString()) + '</dd></div>' : '') + '</dl>' +
          (row.recovery && !recovering ? '<p class="calculation-recovery-result" data-status="' + escape(row.recovery.status) + '" role="status">' + (row.recovery.status === 'error' ? 'Recovery could not be confirmed. See technical details.' : escape(row.recovery.message)) + '</p>' : '') +
          '<details class="calculation-technical" data-booking="' + escape(row.bookingId) + '"' + (openTechnical.indexOf(row.bookingId) !== -1 ? ' open' : '') + '><summary data-calculation-detail="' + escape(row.bookingId) + '">Technical details</summary><pre>' + escape(technical) + '</pre></details>' +
          (row.canRetry || recovering ? '<button type="button" class="button secondary calculation-recover" data-calculation-retry="' + escape(row.bookingId) + '"' + ((calculationRetrying || state.isLoading || submitInProgress) ? ' disabled' : '') + '>' + (recovering ? spinner + 'Recovering…' : 'Recover calculation') + '</button>' : '') + '</article>';
      }).join('');
      if (unknown) { markup = '<p role="alert">Calculation status unavailable.</p><details class="calculation-technical"><summary>Technical details</summary><pre>' + escape(calculationView.error) + '</pre></details>' + markup; }
      else if (!selectedBookings.length) { markup = '<p>Select a settlement to check its booking.</p>'; }
      else if (!rows.length && !calculationView.loading) { markup = '<p>No linked bookings found for the selected settlements.</p>'; }
      renderStableMarkup(elements.invoiceCreateCalculationRows, markup);

    }

    var invoiceNameDefault = ns.createInvoiceNameDefault(elements.invoiceCreateNumber, function () { return global.ZOHO.CRM.API; }, function (error) {
      renderer.showError("Could not suggest an invoice number: " + error.message);
    }, function () { elements.invoiceCreateNumber.setCustomValidity(""); refreshInvoiceCreateActionState(); });
    function updateInvoiceNameDefault() {
      var settlement = state.invoiceCreation.selectedSettlement;
      return invoiceNameDefault.update({
        type: isInvoiceCreateRefundMode() ? "Credit Note" : elements.invoiceCreateType.value,
        supplierId: state.supplierId,
        supplierCode: helpers.getCandidateValue(state.supplier, FIELD_CANDIDATES.supplier.connectionReference) || "",
        bookingId: helpers.getLookupId(settlement && settlement.Booking),
        mfsp: getInvoiceCreateSettlementMfsp(settlement)
      });
    }
    var isPreviewableImageFile = deps.isPreviewableImageFile;
    var isPreviewablePdfFile = deps.isPreviewablePdfFile;
    var clearInvoiceCreateDocumentFileSelection = deps.clearInvoiceCreateDocumentFileSelection;
    var onInvoiceCreateDocumentFileChange = deps.onInvoiceCreateDocumentFileChange;
    var onInvoiceCreateDocumentFilePreviewClick = deps.onInvoiceCreateDocumentFilePreviewClick;
    var refreshInvoicesTabData = deps.refreshInvoicesTabData;
    var refreshSupplierRelatedActivity = deps.refreshSupplierRelatedActivity;
    var getFunctionResponseResult = deps.getFunctionResponseResult;
    var getInvoiceLinePermissionHelpMessage = deps.getInvoiceLinePermissionHelpMessage;
    var roundCurrency = deps.roundCurrency;
    var uploadFileToInvoiceField = deps.uploadFileToInvoiceField;
    var onInvoiceCreateRequestAccountingAccountClick = deps.onInvoiceCreateRequestAccountingAccountClick;
    var eventsBound = false;
    var submitInProgress = false;
    var registrationRecovery;
    var registration = ns.createInvoiceRegistration({
      storage: {
        getItem: function (key) { return global.localStorage.getItem(key); },
        setItem: function (key, value) { global.localStorage.setItem(key, value); },
        removeItem: function (key) { global.localStorage.removeItem(key); }
      },
      randomUUID: function () { return global.crypto.randomUUID(); },
      withLock: function (key, execute) {
        if (global.navigator && global.navigator.locks) { return global.navigator.locks.request(key, execute); }
        throw new Error("This browser cannot safely coordinate invoice registration between tabs. Use a browser with Web Locks support.");
      },
      executeFunction: function (name, args) { return crm.executeFunction(name, args); },
        getInvoice: function (invoiceId) { return crm.getRecord("Supplier_Invoices", invoiceId); },
      uploadFile: function (file) { return crm.uploadFile(file); },
      refresh: async function (invoiceId) {
        invalidateInvoiceCreateSettlementCache();
        await refreshInvoicesAfterCreate(invoiceId);
        if (!(state.supplierInvoices || []).some(function (invoice) { return String(invoice.id) === String(invoiceId); })) {
          throw new Error("The invoice was registered, but the supplier view could not load it. Resume to refresh the same invoice.");
        }
        await reloadInvoiceCreateSettlements({ forceReload: true, throwOnError: true });
      }
    });

    function renderRegistrationRecovery() {
      if (!elements.invoiceCreateForm || !global.document || !global.document.createElement) { return; }
      if (!registrationRecovery) {
        registrationRecovery = global.document.createElement("div");
        registrationRecovery.className = "inline-feedback invoice-registration-recovery";
        registrationRecovery.setAttribute("role", "status");
        var message = global.document.createElement("p");
        var resume = global.document.createElement("button");
        resume.type = "button";
        resume.className = "button primary";
        resume.textContent = "Resume invoice registration";
        resume.addEventListener("click", handleInvoiceCreateSubmitEvent);
        registrationRecovery.appendChild(message);
        registrationRecovery.appendChild(resume);
        var discard = global.document.createElement("button");
        discard.type = "button"; discard.className = "button secondary"; discard.textContent = "Discard registration";
        var confirmBox = global.document.createElement("div");
        confirmBox.className = "invoice-registration-discard"; confirmBox.hidden = true;
        var explanation = global.document.createElement("p");
        explanation.textContent = "Discard this unfinished registration? The invoice will be cancelled and removed from payable balances. Its document and history will be kept. This is different from hiding the notice.";
        var keep = global.document.createElement("button"), confirm = global.document.createElement("button");
        keep.type = confirm.type = "button"; keep.className = "button secondary"; confirm.className = "button primary";
        keep.textContent = "Keep registration"; confirm.textContent = "Yes, discard registration";
        discard.addEventListener("click", function () { confirmBox.hidden = false; keep.focus(); });
        keep.addEventListener("click", function () { confirmBox.hidden = true; discard.focus(); });
        confirm.addEventListener("click", async function () {
          if (submitInProgress || state.isLoading) return;
          var supplierId = String(state.supplierId);
          submitInProgress = true;
          try {
            setInvoiceCreateLoading(true, "Discarding invoice registration and updating balances...");
            renderRegistrationRecovery();
            var result = await registration.discard(supplierId);
            if (result.busy) return;
            if (!result.success) throw new Error(result.message);
            confirmBox.hidden = true;
            resetInvoiceCreateFormAfterCreate(); state.invoiceCreation.isOpen = false;
            renderer.showNotice("Registration discarded. The cancelled invoice and document are kept for reference." + (result.refreshRequired ? " Reload the view to see updated balances." : ""), { tone: "success" });
          } catch (error) { renderer.showError(error.message); }
          finally { submitInProgress = false; setInvoiceCreateLoading(false, "", { preserveNotice: true }); renderAll(); }
        });
        confirmBox.appendChild(explanation); confirmBox.appendChild(keep); confirmBox.appendChild(confirm);
        registrationRecovery.appendChild(discard); registrationRecovery.appendChild(confirmBox);
        registrationRecovery._resume = resume; registrationRecovery._discard = discard;
        (elements.invoiceCreateFeedback || elements.invoiceCreateForm).prepend(registrationRecovery);
      }
      var pending;
      var recoveryError;
      try { pending = !isInvoiceCreateRefundMode() && state.supplierId && registration.pending(state.supplierId); }
      catch (error) { recoveryError = error.message; renderer.showError(error.message); }
      registrationRecovery.hidden = !pending && !recoveryError;
      if (recoveryError) {
        registrationRecovery.firstChild.textContent = recoveryError;
        registrationRecovery.querySelectorAll('button').forEach(function (button) { button.disabled = true; });
      }
      if (pending) {
        var request = JSON.parse(pending.requestJson);
        if (registrationRecovery._operationKey !== pending.operationKey) {
          registrationRecovery.querySelector('.invoice-registration-discard').hidden = true;
          registrationRecovery._operationKey = pending.operationKey;
        }
        registrationRecovery.firstChild.textContent = (pending.invoiceId ? "Invoice " + pending.invoiceId + " was created. " : "The previous registration has not been confirmed. ") +
          "Resume " + request.invoice.Name + " to complete or check the same invoice. Do not create it again.";
        if (pending.discardRequested) registrationRecovery.firstChild.textContent = "Discarding " + request.invoice.Name + " remains to be confirmed. Continue discarding to finish updating its balances.";
        registrationRecovery.querySelectorAll('button').forEach(function (button) { button.disabled = submitInProgress || state.isLoading; });
        registrationRecovery._resume.hidden = Boolean(pending.discardRequested);
        registrationRecovery._discard.textContent = pending.discardRequested ? "Continue discarding" : "Discard registration";
      }
      Array.prototype.forEach.call(elements.invoiceCreateForm.querySelectorAll("input, select, textarea, button"), function (element) {
        if (registrationRecovery.contains(element) || element === elements.invoiceCreateClose || element === elements.invoiceCreateCancel) { return; }
        if (pending || recoveryError) {
          if (element.dataset.registrationDisabled === undefined) { element.dataset.registrationDisabled = String(element.disabled); }
          element.disabled = true;
        } else if (element.dataset.registrationDisabled !== undefined) {
          element.disabled = element.dataset.registrationDisabled === "true";
          delete element.dataset.registrationDisabled;
        }
      });
      if (!pending && !recoveryError) {
        refreshInvoiceCreateActionState();
        renderInvoiceCreateDocumentFilePreview();
      }
    }

    async function registerSupplierInvoice(payload, allocations, confirmedExcess, file) {
      var supplierId = String(state.supplierId);
      var result = await registration.run(supplierId, payload ? {
        supplier_id: supplierId,
        invoice: payload,
        allocations: allocations.map(function (allocation) { return { settlement_id: String(allocation.settlement.id), amount: allocation.amount }; }),
        amount_mode: state.invoiceCreation.lastEditedAmountMode || "gross",
        confirmed_excess: confirmedExcess
      } : null, file);
      if (result.busy) { return; }
      if (!result.success) {
        renderer.showError((result.invoice_id ? "Invoice " + result.invoice_id + " was created. " : "") + result.message);
        renderAll();
        return;
      }
      resetInvoiceCreateFormAfterCreate();
      state.invoiceCreation.isOpen = false;
      renderAll();
      renderer.showNotice((result.phase === "discarded" ? "Registration discarded. The cancelled invoice is kept for reference." : "Invoice " + result.invoice_id + " registered. No payment was created.") +
        ((result.warnings || []).length ? " " + result.warnings.join(" ") : ""), { tone: "success" });
    }

    function renderStableMarkup(host, markup) {
      if (!host || (host._invoiceMarkup === markup && (markup === "" || host.innerHTML !== ""))) { return; }
      var active = global.document && global.document.activeElement;
      var focused = active && host.contains && host.contains(active);
      var key = focused && (active.getAttribute("data-settlement-allocation-id") || active.getAttribute("data-settlement-selection-id") || active.getAttribute("data-status-filter-value") || active.getAttribute("data-calculation-retry") || active.getAttribute("data-calculation-detail"));
      var scrollTop = host.scrollTop;
      host.innerHTML = markup;
      host._invoiceMarkup = markup;
      if (key) {
        var replacement = Array.prototype.find.call(host.querySelectorAll("input,button,summary"), function (node) {
          return ["data-settlement-allocation-id", "data-settlement-selection-id", "data-status-filter-value", "data-calculation-retry", "data-calculation-detail"].some(function (attribute) { return node.getAttribute(attribute) === key; });
        });
        if (replacement) {
          active.disabled = replacement.disabled;
          if (active.tagName === "BUTTON") { active.innerHTML = replacement.innerHTML; }
          replacement.replaceWith(active);
          active.focus({ preventScroll: true });
        }
      }
      host.scrollTop = scrollTop;
    }

    function normalizeSettlements(records) {
      return records
        .slice()
        .sort(function (left, right) {
          var leftDate = Date.parse(left.First_Service_Date || "") || 0;
          var rightDate = Date.parse(right.First_Service_Date || "") || 0;
          return rightDate - leftDate;
        });
    }

    function normalizeServices(records) {
      return records
        .slice()
        .sort(function (left, right) {
          var leftDate = Date.parse(left.Service_Date || "") || 0;
          var rightDate = Date.parse(right.Service_Date || "") || 0;
          return leftDate - rightDate;
        });
    }

    function isInvoiceCreateSettlementPaidStatus(value) {
      return String(value || "").trim().toLowerCase() === "paid";
    }

    function getInvoiceCreateSettlementStatusToggleLabel(selectedValues, options) {
      var selected = getNormalizedInvoiceCreateSettlementStatusValues(selectedValues);
      var defaultValues = getDefaultInvoiceCreateSettlementStatusValues(options);
      var optionValues = (options || []).map(function (item) {
        return item.value;
      });
      var hasPaidOption = optionValues.some(function (value) {
        return isInvoiceCreateSettlementPaidStatus(value);
      });
      var singleOption;

      if (!selected.length) {
        return "No statuses";
      }

      if (hasAllInvoiceCreateSettlementStatusesSelected(selected, options)) {
        return "All statuses";
      }

      if (hasPaidOption && hasAllInvoiceCreateSettlementStatusesSelected(selected, defaultValues.map(function (value) {
        return {
          value: value
        };
      }))) {
        return "All except Paid";
      }

      if (selected.length === 1) {
        singleOption = (options || []).find(function (item) {
          return item.value === selected[0];
        });
        return singleOption ? singleOption.label : "1 status";
      }

      return String(selected.length) + " statuses";
    }

    function getInvoiceCreateSettlementDisplayName(settlement) {
      return helpers.textValue(settlement && settlement.Name, settlement && settlement.id);
    }

    function getInvoiceCreateSettlementStatus(settlement) {
      return helpers.textValue(settlement && settlement.Admin_Status, "");
    }

    function getInvoiceCreateSettlementMfsp(settlement) {
      var bookingId = helpers.getLookupId(settlement && settlement.Booking);
      return bookingId && state.indexes && state.indexes.mfspByBookingId ? state.indexes.mfspByBookingId[bookingId] || "" : "";
    }

    function getInvoiceCreateSettlementMeta(settlement) {
      var mfsp = getInvoiceCreateSettlementMfsp(settlement);
      var ezusReference = settlement && settlement.Ezus_Supplier_Reference
        ? String(settlement.Ezus_Supplier_Reference)
        : "";
      var metaParts = [mfsp, helpers.getLookupName(settlement && settlement.Booking), ezusReference].filter(Boolean);

      if (metaParts.length) {
        return metaParts.join(" | ");
      }

      return helpers.getLookupName(settlement && settlement.Booking) || "-";
    }

    async function getInvoiceCreateBookingMfspReference(bookingId) {
      var booking;

      if (!bookingId) {
        return "";
      }

      try {
        booking = await crm.getRecord(MODULES.bookings, bookingId);
        return String(helpers.getCandidateValue(booking, FIELD_CANDIDATES.booking.mfsp) || "").trim();
      } catch (error) {
        debugWarn("getInvoiceCreateBookingMfspReference failed", {
          bookingId: bookingId,
          errorMessage: error && error.message || String(error || "")
        });
        return "";
      }
    }

    function getInvoiceCreateSettlementSearchText(settlement) {
      return helpers.normalizeQuery([
        getInvoiceCreateSettlementDisplayName(settlement),
        settlement && settlement.id,
        getInvoiceCreateSettlementMeta(settlement),
        getInvoiceCreateSettlementStatus(settlement),
        helpers.getLookupName(settlement && settlement.Booking),
        getInvoiceCreateSettlementMfsp(settlement),
        settlement && settlement.Total_Service_Cost
      ].join(" "));
    }

    function buildInvoiceCreateSettlementStatusOptions() {
      var values = getUniqueSortedValues((state.invoiceCreation.settlements || []).map(function (settlement) {
        return getInvoiceCreateSettlementStatus(settlement);
      }));
      var metadataOptions = state.invoiceCreation.settlementStatusOptions || [];
      var combinedValues;

      combinedValues = metadataOptions.map(function (option) {
        return option && option.value ? option.value : "";
      }).concat(getDefaultInvoiceCreateSettlementStatusValues(), values);

      return getUniqueSortedValues(combinedValues).filter(Boolean).map(function (value) {
        return {
          value: value,
          label: value
        };
      });
    }

    function getFilteredInvoiceCreateSettlements() {
      var query = helpers.normalizeQuery(state.invoiceCreation.settlementQuery);
      var selectedStatuses = getNormalizedInvoiceCreateSettlementStatusValues(state.invoiceCreation.settlementStatusValues);
      var statusOptions = buildInvoiceCreateSettlementStatusOptions();
      var shouldFilterByStatus = selectedStatuses.length > 0 && !hasAllInvoiceCreateSettlementStatusesSelected(selectedStatuses, statusOptions);

      return (state.invoiceCreation.settlements || []).filter(function (settlement) {
        if (query && getInvoiceCreateSettlementSearchText(settlement).indexOf(query) === -1) {
          return false;
        }

        if (shouldFilterByStatus && selectedStatuses.indexOf(getInvoiceCreateSettlementStatus(settlement)) === -1) {
          return false;
        }

        return true;
      });
    }

    function renderInvoiceCreateContext() {
      return;

      var supplier = state.supplier;
      var selectedSettlement = state.invoiceCreation.selectedSettlement;
      var supplierName = supplier
        ? (helpers.getLookupName(supplier) || supplier.Vendor_Name || supplier.Name)
        : "";
      var supplierSelfEmployed = supplier ? isSupplierSelfEmployed(supplier) : false;
      var supplierAccountNumber = helpers.getCandidateValue(supplier, FIELD_CANDIDATES.supplier.accountNumber) || "";
      var accountingAccount = getSupplierResolvedAccountingAccount(supplier);
      var supplierPaymentAccountLabel = getSupplierDefaultPaymentAccountLabel(supplier);
      var selfEmployedClassName = supplier
        ? (supplierSelfEmployed ? "accounting-status present" : "accounting-status missing")
        : "accounting-status missing";
      var paymentAccountClassName = supplierPaymentAccountLabel ? "accounting-status present" : "accounting-status missing";
      var accountingClassName = accountingAccount.hasValue ? "accounting-status present" : "accounting-status missing";
      var accountNumberClassName = supplierAccountNumber ? "accounting-status present" : "accounting-status missing";

      elements.invoiceCreateSupplierName.textContent = helpers.textValue(supplierName);
      if (elements.invoiceCreateContextSettlement) {
        elements.invoiceCreateContextSettlement.textContent = selectedSettlement
          ? helpers.textValue(getInvoiceCreateSettlementDisplayName(selectedSettlement))
          : "Choose settlement";
        elements.invoiceCreateContextSettlement.className = selectedSettlement
          ? "accounting-status present"
          : "accounting-status missing";
      }
      elements.invoiceCreateSupplierSelfEmployed.textContent = supplier
        ? helpers.booleanLabel(supplierSelfEmployed)
        : "-";
      elements.invoiceCreateSupplierSelfEmployed.className = selfEmployedClassName;
      if (elements.invoiceCreateSupplierAccountNumber) {
        elements.invoiceCreateSupplierAccountNumber.textContent = supplierPaymentAccountLabel
          ? helpers.textValue(supplierPaymentAccountLabel)
          : "Missing";
        elements.invoiceCreateSupplierAccountNumber.className = paymentAccountClassName;
      }
      if (elements.invoiceCreateSupplierAccounting) {
        elements.invoiceCreateSupplierAccounting.textContent = accountingAccount.hasValue
          ? helpers.textValue(accountingAccount.displayValue)
          : "Missing";
        elements.invoiceCreateSupplierAccounting.className = accountingClassName;
      }
      if (elements.invoiceCreateRequestAccountingAccount) {
        elements.invoiceCreateRequestAccountingAccount.hidden = accountingAccount.hasValue || !supplier;
        elements.invoiceCreateRequestAccountingAccount.disabled = state.isLoading || accountingAccount.hasValue || !supplier;
      }
      if (elements.invoiceCreateSupplierPaymentAccount) {
        elements.invoiceCreateSupplierPaymentAccount.textContent = supplierAccountNumber
          ? helpers.textValue(supplierAccountNumber)
          : "Missing";
        elements.invoiceCreateSupplierPaymentAccount.className = accountNumberClassName;
      }
      if (elements.invoiceCreateSupplierPreview) {
        elements.invoiceCreateSupplierPreview.textContent = helpers.textValue(supplierName);
      }
    }

    function renderInvoiceCreateSettlementFilters() {
      var statusOptions = buildInvoiceCreateSettlementStatusOptions();
      var selectedStatuses = getNormalizedInvoiceCreateSettlementStatusValues(state.invoiceCreation.settlementStatusValues);

      if (elements.invoiceCreateSettlementStatusToggle) {
        elements.invoiceCreateSettlementStatusToggle.textContent = getInvoiceCreateSettlementStatusToggleLabel(selectedStatuses, statusOptions);
        elements.invoiceCreateSettlementStatusToggle.setAttribute("aria-expanded", state.invoiceCreation.settlementStatusDropdownOpen ? "true" : "false");
      }

      if (elements.invoiceCreateSettlementStatusMenu) {
        elements.invoiceCreateSettlementStatusMenu.hidden = !state.invoiceCreation.settlementStatusDropdownOpen;
        renderStableMarkup(elements.invoiceCreateSettlementStatusMenu, [
          '<div class="status-filter-menu-actions">',
          '  <button class="status-filter-menu-action" type="button" data-status-filter-action="select-all">Select all</button>',
          '  <button class="status-filter-menu-action" type="button" data-status-filter-action="clear-all">Deselect all</button>',
          "</div>",
          statusOptions.map(function (option) {
            var isChecked = selectedStatuses.indexOf(option.value) !== -1;

            return [
              '<label class="bookings-stage-option">',
              '  <input type="checkbox" data-status-filter-value="' + helpers.escapeHtml(option.value) + '"' + (isChecked ? " checked" : "") + ' value="' + helpers.escapeHtml(option.value) + '">',
              '  <span>' + helpers.escapeHtml(option.label) + "</span>",
              "</label>"
            ].join("");
          }).join("")
        ].join(""));
      }
    }

    async function selectInvoiceCreateSettlement(settlement) {
      var generation = ++serviceSelectionGeneration;
      var supplierId = state.supplierId;
      var settlementId = settlement && settlement.id;
      function isCurrent() {
        return generation === serviceSelectionGeneration && state.invoiceCreation.isOpen &&
          state.supplierId === supplierId && state.invoiceCreation.selectedSettlement &&
          String(state.invoiceCreation.selectedSettlement.id) === String(settlementId);
      }
      state.invoiceCreation.selectedSettlement = settlement || null;
      state.invoiceCreation.services = [];
      clearInvoiceCreateValidationState();
      renderAll();
      renderer.showError("");

      updateInvoiceNameDefault();
      if (!state.invoiceCreation.selectedSettlement) {
        return;
      }

      setInvoiceCreateLoading(true, "Loading services...");

      try {
        var services = await loadServicesForSettlement(settlementId);
        if (!isCurrent()) { return; }
        state.invoiceCreation.services = services;
        renderAll();
      } catch (error) {
        if (!isCurrent()) { return; }
        state.invoiceCreation.services = [];
        renderAll();
        debugError("selectInvoiceCreateSettlement failed", error, {
          settlementId: settlementId
        });
        renderer.showError(error.message || "Could not load settlement services.");
      } finally {
        if (generation === serviceSelectionGeneration) { setInvoiceCreateLoading(false); }
      }
    }

    function getSelectedInvoiceCreateSettlements() {
      return state.invoiceCreation.selectedSettlements || [];
    }

    async function toggleInvoiceCreateSettlement(settlement, selected) {
      var selectedSettlements = getSelectedInvoiceCreateSettlements().slice();
      var index = selectedSettlements.findIndex(function (item) { return String(item.id) === String(settlement.id); });

      if (selected && index === -1) {
        selectedSettlements.push(settlement);
        state.invoiceCreation.selectedSettlement = settlement;
      } else if (!selected && index !== -1) {
        selectedSettlements.splice(index, 1);
        delete state.invoiceCreation.settlementAllocationAmounts[settlement.id];
      }

      state.invoiceCreation.selectedSettlements = selectedSettlements;
      if (selectedSettlements.length === 1) {
        state.invoiceCreation.settlementAllocationAmounts[selectedSettlements[0].id] = getInvoiceCreateCurrentInvoiceTotal();
      }
      if (!selectedSettlements.some(function (item) { return state.invoiceCreation.selectedSettlement && String(item.id) === String(state.invoiceCreation.selectedSettlement.id); })) {
        state.invoiceCreation.selectedSettlement = selectedSettlements[0] || null;
      }

      if (state.invoiceCreation.selectedSettlement) {
        await selectInvoiceCreateSettlement(state.invoiceCreation.selectedSettlement);
      } else {
        state.invoiceCreation.services = [];
        renderAll();
      }
    }

    function renderInvoiceCreateSettlementTable() {
      var settlements = getFilteredInvoiceCreateSettlements();
      var emptyMessage = "No settlements match these filters.";
      if (!(state.invoiceCreation.settlements || []).length) {
        emptyMessage = calculationView.loading ? "Checking settlement availability…" : calculationView.error ? "Calculation status could not be verified." :
          (calculationView.rows || []).some(function (row) { return row.status === "failed"; }) ? "Calculation failed. Open calculation details to retry." :
          (calculationView.rows || []).some(function (row) { return row.status !== "idle"; }) ? "Settlements are pending calculation. This list updates automatically." : "No settlements available for this supplier.";
      }
      var markup = state.invoiceCreation.isLoadingSettlements ? '<p class="supplier-context-empty">Loading settlements…</p>' : settlements.map(function (settlement) {
        var selected = getSelectedInvoiceCreateSettlements().some(function (item) { return String(item.id) === String(settlement.id); });
        var status = getInvoiceCreateSettlementStatus(settlement);
        return '<label class="supplier-settlement-option' + (selected ? ' is-selected' : '') + '" data-settlement-id="' + helpers.escapeHtml(settlement.id) + '">' +
          '<input type="checkbox" data-settlement-selection-id="' + helpers.escapeHtml(settlement.id) + '"' + (selected ? ' checked' : '') + ' aria-label="Select ' + helpers.escapeHtml(getInvoiceCreateSettlementDisplayName(settlement)) + '">' +
          '<span class="supplier-settlement-label"><strong>' + helpers.escapeHtml(getInvoiceCreateSettlementDisplayName(settlement)) + '</strong><small>' + helpers.escapeHtml(getInvoiceCreateSettlementMeta(settlement)) + '</small><span class="status-pill ' + helpers.escapeHtml(helpers.getStatusTone(status)) + '">' + helpers.escapeHtml(status) + '</span></span>' +
          '<strong class="supplier-settlement-cost" title="Total service cost">' + helpers.escapeHtml(helpers.formatCurrency(settlement.Total_Service_Cost)) + '</strong></label>';
      }).join("");
      elements.invoiceCreateSettlementEmpty.textContent = emptyMessage;
      elements.invoiceCreateSettlementEmpty.hidden = state.invoiceCreation.isLoadingSettlements || settlements.length > 0;
      elements.invoiceCreateSettlementTableWrap.hidden = !state.invoiceCreation.isLoadingSettlements && !settlements.length;
      renderStableMarkup(elements.invoiceCreateSettlementTableBody, markup);
    }

    function renderInvoiceCreateSettlementSummary() {
      var selected = getSelectedInvoiceCreateSettlements();
      var settlement = state.invoiceCreation.selectedSettlement;
      var sum = function (getValue) { return selected.reduce(function (total, item) { return total + (Number(getValue(item)) || 0); }, 0); };
      if (elements.invoiceCreateSummaryEmpty) { elements.invoiceCreateSummaryEmpty.hidden = !!selected.length; }
      if (elements.invoiceCreateFinancialSummary) { elements.invoiceCreateFinancialSummary.hidden = !selected.length; }
      if (elements.invoiceCreateSummaryTitle) { elements.invoiceCreateSummaryTitle.textContent = selected.length > 1 ? "Combined totals · " + selected.length + " settlements" : "Settlement totals"; }
      if (elements.invoiceCreateSelectedSettlementName) { elements.invoiceCreateSelectedSettlementName.textContent = selected.map(getInvoiceCreateSettlementDisplayName).join(", "); }
      elements.invoiceCreateSettlementTotalCost.textContent = helpers.formatCurrency(sum(function (item) { return item.Total_Service_Cost; }));
      elements.invoiceCreateSettlementTotalInvoice.textContent = helpers.formatCurrency(sum(function (item) { return item.Total_Invoice; }));
      elements.invoiceCreateSettlementThisInvoice.textContent = helpers.formatCurrency(sum(getInvoiceCreateSettlementRemainingToInvoice));
      elements.invoiceCreateSettlementTotalPaid.textContent = helpers.formatCurrency(sum(function (item) { return item.Total_Paid; }));
      elements.invoiceCreateSettlementUnpaidInvoiced.textContent = helpers.formatCurrency(sum(getInvoiceCreateSettlementUnpaidInvoicedAmount));
      elements.invoiceCreateSettlementStatus.hidden = true;
      var select = elements.invoiceCreateSelectedSettlementSelect;
      if (select) {
        if (global.document.activeElement !== select) {
          renderStableMarkup(select, selected.map(function (item) { return '<option value="' + helpers.escapeHtml(item.id) + '">' + helpers.escapeHtml(getInvoiceCreateSettlementDisplayName(item)) + '</option>'; }).join(""));
          select.value = settlement ? settlement.id : "";
        }
        select.closest(".field").hidden = selected.length < 2;
      }
      renderInvoiceCreateSettlementAllocations();
    }

    function getInvoiceCreateSettlementAllocations(invoiceTotal) {
      var selectedSettlements = getSelectedInvoiceCreateSettlements();
      var amounts = state.invoiceCreation.settlementAllocationAmounts || {};
      return selectedSettlements.map(function (settlement) {
        var rawAmount = amounts[settlement.id];
        var amount = rawAmount === undefined || rawAmount === "" ? (selectedSettlements.length === 1 ? invoiceTotal : 0) : getInvoiceCreateNumberValue(rawAmount);
        return { settlement: settlement, amount: amount };
      });
    }

    function getInvoiceCreateCurrentInvoiceTotal() {
      var grossAmount = getInvoiceCreateNumberValue(elements.invoiceCreateAmountGross.value);
      var netAmount = getInvoiceCreateNumberValue(elements.invoiceCreateAmountNet.value);
      var irpfRate = getInvoiceCreateNumberValue(elements.invoiceCreateIrpfPercent.value);
      var additionalVatValues = getInvoiceCreateAdditionalVatValues();
      var additionalGrossAmount = hasInvoiceCreateAdditionalVatValues() ? additionalVatValues.grossAmount : 0;
      var additionalIrpfAmount = hasInvoiceCreateAdditionalVatValues() ? additionalVatValues.irpfAmount : 0;

      return roundCurrency(grossAmount + additionalGrossAmount - roundCurrency(netAmount * irpfRate / 100) - additionalIrpfAmount +
        (isInvoiceCreateRefundMode() ? 0 : getInvoiceCreateNumberValue(elements.invoiceCreateReimbursableExpense.value)));
    }

    function renderInvoiceCreateSettlementAllocations() {
      var invoiceTotal = getInvoiceCreateCurrentInvoiceTotal();
      var allocations = getInvoiceCreateSettlementAllocations(invoiceTotal);
      var allocatedTotal = allocations.reduce(function (total, allocation) { return total + allocation.amount; }, 0);
      var remaining = invoiceTotal - allocatedTotal;

      if (!elements.invoiceCreateSettlementAllocationList) { return; }
      var allocationMarkup = allocations.map(function (allocation) {
        var value = state.invoiceCreation.settlementAllocationAmounts[allocation.settlement.id];
        if ((value === undefined || value === "") && allocations.length === 1 && invoiceTotal) { value = invoiceTotal.toFixed(2); }
        return '<tr><td>' + helpers.escapeHtml(getInvoiceCreateSettlementDisplayName(allocation.settlement)) + '</td><td class="numeric-cell"><input class="invoice-create-allocation-input" type="number" min="0" step="0.01" data-settlement-allocation-id="' + helpers.escapeHtml(allocation.settlement.id) + '" value="' + helpers.escapeHtml(value === undefined ? "" : value) + '" placeholder="0.00"></td></tr>';
      }).join("") || '<tr><td colspan="2" class="muted-cell">Select one or more settlements.</td></tr>';
      renderStableMarkup(elements.invoiceCreateSettlementAllocationList, allocationMarkup);
      updateInvoiceCreateSettlementAllocationTotals(allocatedTotal, remaining);
    }

    function updateInvoiceCreateSettlementAllocationTotals(allocatedTotal, remaining) {
      if (elements.invoiceCreateSettlementAllocationTotal) { elements.invoiceCreateSettlementAllocationTotal.textContent = helpers.formatCurrency(allocatedTotal); }
      if (elements.invoiceCreateSettlementAllocationRemaining) {
        elements.invoiceCreateSettlementAllocationRemaining.textContent = helpers.formatCurrency(remaining);
        elements.invoiceCreateSettlementAllocationRemaining.className = Math.abs(remaining) < 0.01 ? "is-positive" : "is-negative";
      }
    }

    function refreshInvoiceCreateActionState() {
      var currentStep = getInvoiceCreateStep();
      var selectedSettlement = state.invoiceCreation.selectedSettlement;
      var selectedSettlements = getSelectedInvoiceCreateSettlements();
      var hasSettlements = !!state.invoiceCreation.settlements.length;
      var hasSupplierContext = !!state.supplierId;
      var hasStatusOptions = !!state.invoiceCreation.settlementStatusOptions.length;
      var canRefreshSettlements = hasSupplierContext && !state.invoiceCreation.isLoadingSettlements;
      var isFinalStep = currentStep === INVOICE_CREATE_STEPS.amounts;
      var isSettlementStep = currentStep === INVOICE_CREATE_STEPS.settlement;
      var isSoftBlockedNext = isInvoiceCreateNextSoftBlocked();

      elements.invoiceCreateSettlementSearch.disabled = state.isLoading || !hasSettlements;
      if (elements.invoiceCreateSettlementStatusToggle) {
        elements.invoiceCreateSettlementStatusToggle.disabled = state.isLoading || !hasSupplierContext || !hasStatusOptions;
        elements.invoiceCreateSettlementStatusToggle.setAttribute("aria-expanded", state.invoiceCreation.settlementStatusDropdownOpen ? "true" : "false");
      }
      if (elements.invoiceCreateSettlementRefresh) {
        elements.invoiceCreateSettlementRefresh.disabled = state.isLoading || !canRefreshSettlements;
      }
      if (elements.invoiceCreateSelectOtherSettlement) {
        elements.invoiceCreateSelectOtherSettlement.disabled = state.isLoading || !selectedSettlement;
      }
      if (elements.invoiceCreatePrev) {
        elements.invoiceCreatePrev.hidden = isSettlementStep;
        elements.invoiceCreatePrev.disabled = state.isLoading || isSettlementStep;
      }
      if (elements.invoiceCreateNext) {
        elements.invoiceCreateNext.hidden = isFinalStep;
        // Keep this actionable when data is missing so the widget can explain what is required.
        elements.invoiceCreateNext.disabled = state.isLoading;
        elements.invoiceCreateNext.classList.toggle("is-soft-disabled", !elements.invoiceCreateNext.disabled && isSoftBlockedNext);
        elements.invoiceCreateNext.setAttribute("aria-disabled", (!elements.invoiceCreateNext.disabled && isSoftBlockedNext) ? "true" : "false");
        if (!elements.invoiceCreateNext.disabled && isSoftBlockedNext) {
          elements.invoiceCreateNext.title = "Attach the invoice file to continue.";
        } else {
          elements.invoiceCreateNext.removeAttribute("title");
        }
      }
      if (elements.invoiceCreateSubmit) {
        elements.invoiceCreateSubmit.hidden = false;
        // Validation is handled in onCreateInvoiceSubmit and renders inline feedback.
        elements.invoiceCreateSubmit.disabled = state.isLoading || submitInProgress;
      }
      elements.invoiceCreateClose.disabled = state.isLoading;
      elements.invoiceCreateCancel.disabled = state.isLoading;
      if (elements.invoiceCreateFileChoose) { elements.invoiceCreateFileChoose.disabled = state.isLoading || submitInProgress; }
      if (elements.invoiceCreateFileInput) { elements.invoiceCreateFileInput.disabled = state.isLoading || submitInProgress; }
    }

    function renderInvoiceCreateStatusTone(value) {
      var tone;

      if (!elements.invoiceCreateStatus) {
        return;
      }

      tone = helpers.getStatusTone(value);
      elements.invoiceCreateStatus.classList.add("status-select");
      elements.invoiceCreateStatus.classList.remove("status-neutral", "status-positive", "status-warning", "status-danger");
      elements.invoiceCreateStatus.classList.add("status-" + tone);
    }

    function setDefaultInvoiceCreateStatus() {
      var hasDefaultOption;
      var option;

      if (!elements.invoiceCreateStatus) {
        return;
      }

      hasDefaultOption = Array.prototype.some.call(elements.invoiceCreateStatus.options || [], function (item) {
        return String(item.value || "") === DEFAULT_INVOICE_STATUS;
      });

      if (!hasDefaultOption) {
        option = global.document.createElement("option");
        option.value = DEFAULT_INVOICE_STATUS;
        option.textContent = DEFAULT_INVOICE_STATUS;
        elements.invoiceCreateStatus.appendChild(option);
      }

      elements.invoiceCreateStatus.value = DEFAULT_INVOICE_STATUS;
      elements.invoiceCreateStatus.disabled = true;
      renderInvoiceCreateStatusTone(DEFAULT_INVOICE_STATUS);
    }

    function setInvoiceCreateAmountValue(element, value) {
      if (!element) {
        return;
      }

      if (!value) {
        element.value = "";
        return;
      }

      element.value = String(roundCurrency(value));
    }

    function clearInvoiceCreateVatReviewCheck() {
      if (elements.invoiceCreateVatReviewed) {
        elements.invoiceCreateVatReviewed.checked = false;
      }
    }

    function clearInvoiceCreateAdditionalVatReviewCheck() {
      if (elements.invoiceCreateAdditionalVatReviewed) {
        elements.invoiceCreateAdditionalVatReviewed.checked = false;
      }
    }

    function clearInvoiceCreateAdditionalIrpfReviewCheck() {
      if (elements.invoiceCreateAdditionalIrpfReviewed) {
        elements.invoiceCreateAdditionalIrpfReviewed.checked = false;
      }
    }

    function clearInvoiceCreateIrpfReviewCheck() {
      if (elements.invoiceCreateIrpfReviewed) {
        elements.invoiceCreateIrpfReviewed.checked = false;
      }
    }

    function clearInvoiceCreateTaxReviewChecks() {
      clearInvoiceCreateVatReviewCheck();
      clearInvoiceCreateAdditionalVatReviewCheck();
      clearInvoiceCreateAdditionalIrpfReviewCheck();
      clearInvoiceCreateIrpfReviewCheck();
    }

    function isInvoiceCreateAdditionalVatEnabled() {
      return Boolean(elements.invoiceCreateAdditionalVatEnabled && elements.invoiceCreateAdditionalVatEnabled.checked);
    }

    function syncInvoiceCreateAdditionalVatVisibility() {
      var isEnabled = isInvoiceCreateAdditionalVatEnabled();

      if (elements.invoiceCreateAdditionalVatFields) {
        elements.invoiceCreateAdditionalVatFields.hidden = !isEnabled;
      }

      if (elements.invoiceCreateAdditionalVatAmountField) {
        elements.invoiceCreateAdditionalVatAmountField.hidden = !isEnabled;
      }

      if (elements.invoiceCreateAdditionalIrpfAmountField) {
        elements.invoiceCreateAdditionalIrpfAmountField.hidden = !isEnabled;
      }

      if (elements.invoiceCreateCalculatedGrid) {
        elements.invoiceCreateCalculatedGrid.classList.toggle("has-additional-vat", isEnabled);
      }
    }

    function getInvoiceCreateAdditionalVatPercentValue() {
      return getInvoiceCreateNumberValue(
        elements.invoiceCreateAdditionalVatPercent && elements.invoiceCreateAdditionalVatPercent.value
      );
    }

    function getInvoiceCreateAdditionalAmountInclVatValue() {
      return getInvoiceCreateNumberValue(
        elements.invoiceCreateAdditionalAmountInclVat && elements.invoiceCreateAdditionalAmountInclVat.value
      );
    }

    function getInvoiceCreateAdditionalAmountExclVatValue() {
      return getInvoiceCreateNumberValue(
        elements.invoiceCreateAdditionalAmountExclVat && elements.invoiceCreateAdditionalAmountExclVat.value
      );
    }

    function getInvoiceCreateAdditionalIrpfPercentValue() {
      return getInvoiceCreateNumberValue(
        elements.invoiceCreateAdditionalIrpfPercent && elements.invoiceCreateAdditionalIrpfPercent.value
      );
    }

    function getInvoiceCreateAdditionalIrpfAmountValue() {
      return getInvoiceCreateNumberValue(
        elements.invoiceCreateAdditionalIrpfAmount && elements.invoiceCreateAdditionalIrpfAmount.value
      );
    }

    function getInvoiceCreateAdditionalVatValues() {
      var additionalVatPercent = getInvoiceCreateAdditionalVatPercentValue();
      var additionalBaseAmount = getInvoiceCreateAdditionalAmountExclVatValue();
      var additionalAmountInclVat = roundCurrency(
        additionalBaseAmount * (1 + (additionalVatPercent / 100))
      );
      var additionalVatAmount = roundCurrency(additionalAmountInclVat - additionalBaseAmount);

      if (!isInvoiceCreateRefundMode() && elements.invoiceCreateAdditionalIrpfAmount) {
        setInvoiceCreateAmountValue(elements.invoiceCreateAdditionalIrpfAmount,
          roundCurrency(additionalBaseAmount * getInvoiceCreateAdditionalIrpfPercentValue() / 100));
        elements.invoiceCreateAdditionalIrpfAmount.readOnly = true;
      } else if (elements.invoiceCreateAdditionalIrpfAmount) {
        elements.invoiceCreateAdditionalIrpfAmount.readOnly = false;
      }

      setInvoiceCreateAmountValue(elements.invoiceCreateAdditionalAmountInclVat, additionalAmountInclVat);

      return {
        percent: additionalVatPercent,
        grossAmount: additionalAmountInclVat,
        baseAmount: additionalBaseAmount,
        amount: additionalVatAmount,
        irpfPercent: getInvoiceCreateAdditionalIrpfPercentValue(),
        irpfAmount: getInvoiceCreateAdditionalIrpfAmountValue()
      };
    }

    function hasInvoiceCreateAdditionalVatValues() {
      var additionalVatPercentRaw = String(
        elements.invoiceCreateAdditionalVatPercent && elements.invoiceCreateAdditionalVatPercent.value || ""
      ).trim();
      var additionalAmountExclVatRaw = String(
        elements.invoiceCreateAdditionalAmountExclVat && elements.invoiceCreateAdditionalAmountExclVat.value || ""
      ).trim();
      var additionalIrpfPercentRaw = String(
        elements.invoiceCreateAdditionalIrpfPercent && elements.invoiceCreateAdditionalIrpfPercent.value || ""
      ).trim();
      var additionalIrpfAmountRaw = String(
        elements.invoiceCreateAdditionalIrpfAmount && elements.invoiceCreateAdditionalIrpfAmount.value || ""
      ).trim();
      var additionalVatValues = getInvoiceCreateAdditionalVatValues();

      return isInvoiceCreateAdditionalVatEnabled() && (
        additionalVatPercentRaw !== "" ||
        additionalAmountExclVatRaw !== "" ||
        additionalIrpfPercentRaw !== "" ||
        additionalIrpfAmountRaw !== "" ||
        additionalVatValues.percent > 0 ||
        additionalVatValues.grossAmount > 0 ||
        additionalVatValues.irpfPercent > 0 ||
        additionalVatValues.irpfAmount > 0
      );
    }

    function getInvoiceCreateValidationFieldElement(fieldKey) {
      if (fieldKey === "allocation" && elements.invoiceCreateSettlementAllocationList) {
        return elements.invoiceCreateSettlementAllocationList.querySelector("input[data-settlement-allocation-id]");
      }
      if (fieldKey === "settlement") {
        if (
          state.invoiceCreation.selectedSettlement &&
          !state.invoiceCreation.settlementDropdownOpen &&
          elements.invoiceCreateSelectOtherSettlement
        ) {
          return elements.invoiceCreateSelectOtherSettlement;
        }

        return elements.invoiceCreateSettlementSearch;
      }

      if (fieldKey === "invoiceNumber") {
        return elements.invoiceCreateNumber;
      }

      if (fieldKey === "invoiceDate") {
        return elements.invoiceCreateDate;
      }

      if (fieldKey === "invoiceType") {
        return elements.invoiceCreateType;
      }

      if (fieldKey === "invoiceFile") {
        return elements.invoiceCreateFileChoose || elements.invoiceCreateFileInput;
      }

      if (fieldKey === "amountGross") {
        return elements.invoiceCreateAmountGross;
      }

      if (fieldKey === "vatReviewed") {
        return elements.invoiceCreateVatPercent;
      }

      if (fieldKey === "additionalVatPercent") {
        return elements.invoiceCreateAdditionalVatPercent;
      }

      if (fieldKey === "additionalAmountExclVat") {
        return elements.invoiceCreateAdditionalAmountExclVat;
      }

      if (fieldKey === "additionalAmountInclVat") {
        return elements.invoiceCreateAdditionalAmountInclVat;
      }

      if (fieldKey === "additionalVatReviewed") {
        return elements.invoiceCreateAdditionalVatPercent;
      }

      if (fieldKey === "additionalIrpfPercent") {
        return elements.invoiceCreateAdditionalIrpfPercent;
      }

      if (fieldKey === "additionalIrpfReviewed") {
        return elements.invoiceCreateAdditionalIrpfPercent;
      }

      if (fieldKey === "additionalIrpfAmount") {
        return elements.invoiceCreateAdditionalIrpfAmount;
      }

      if (fieldKey === "irpfReviewed") {
        return elements.invoiceCreateIrpfPercent;
      }

      return null;
    }

    function getInvoiceCreateValidationFieldHost(fieldKey) {
      var element;

      if (
        fieldKey === "settlement" &&
        state.invoiceCreation.selectedSettlement &&
        !state.invoiceCreation.settlementDropdownOpen &&
        elements.invoiceCreateSelectedSettlementCard
      ) {
        return elements.invoiceCreateSelectedSettlementCard;
      }

      if (fieldKey === "invoiceFile" && elements.invoiceCreateFileInput) {
        return elements.invoiceCreateFileInput.closest(".invoice-create-file-strip");
      }

      if (fieldKey === "allocation" && elements.invoiceCreateAllocationCard) {
        return elements.invoiceCreateAllocationCard;
      }

      element = getInvoiceCreateValidationFieldElement(fieldKey);

      if (!element) {
        return null;
      }

      return element.closest(".field");
    }

    function ensureInvoiceCreateFieldErrorNode(host) {
      var errorNode;

      if (!host) {
        return null;
      }

      errorNode = host.querySelector(".field-error");
      if (errorNode) {
        return errorNode;
      }

      errorNode = global.document.createElement("span");
      errorNode.className = "field-error";
      errorNode.hidden = true;
      host.appendChild(errorNode);
      return errorNode;
    }

    function renderInvoiceCreateValidationState() {
      var validationMessage = state.invoiceCreation.validationMessage || "";
      var validationFields = state.invoiceCreation.validationFields || {};

      INVOICE_CREATE_VALIDATION_FIELD_KEYS.forEach(function (fieldKey) {
        var element = getInvoiceCreateValidationFieldElement(fieldKey);
        var host = getInvoiceCreateValidationFieldHost(fieldKey);
        var errorNode = ensureInvoiceCreateFieldErrorNode(host);
        var fieldMessage = validationFields[fieldKey] || "";

        if (host) {
          host.classList.toggle("has-error", Boolean(fieldMessage));
        }

        if (element) {
          if (fieldMessage) {
            element.setAttribute("aria-invalid", "true");
          } else {
            element.removeAttribute("aria-invalid");
          }
        }

        if (errorNode) {
          errorNode.textContent = fieldMessage;
          errorNode.hidden = !fieldMessage;
        }
      });

      if (elements.invoiceCreateSubmit) {
        elements.invoiceCreateSubmit.classList.toggle("has-validation-error", Boolean(validationMessage));
      }
    }

    function setInvoiceCreateValidationState(message, fieldErrors) {
      state.invoiceCreation.validationMessage = String(message || "").trim();
      state.invoiceCreation.validationFields = Object.assign({}, fieldErrors || {});
      renderInvoiceCreateValidationState();
      if (state.invoiceCreation.validationMessage) {
        renderer.showError(state.invoiceCreation.validationMessage);
      }
    }

    function clearInvoiceCreateValidationState() {
      renderer.showError("");
      setInvoiceCreateValidationState("", {});
    }

    function syncInvoiceCreateStepWithFieldErrors(fieldErrors) {
      if (fieldErrors && fieldErrors.settlement) {
        state.invoiceCreation.settlementDropdownOpen = true;
        renderAll();
      }
    }

    function triggerInvoiceCreateSubmitValidationFeedback() {
      var actionButton = elements.invoiceCreateSubmit;

      if (!actionButton) {
        return;
      }

      actionButton.classList.remove("animate-validation-error");
      void actionButton.offsetWidth;
      actionButton.classList.add("animate-validation-error");
    }

    function focusFirstInvoiceCreateValidationField(fieldErrors) {
      var firstFieldKey = Object.keys(fieldErrors || {}).find(function (fieldKey) {
        return Boolean(fieldErrors[fieldKey]);
      });
      var fieldElement = firstFieldKey ? getInvoiceCreateValidationFieldElement(firstFieldKey) : null;

      if (fieldElement && typeof fieldElement.focus === "function") {
        fieldElement.focus();
      }
    }

    function showInvoiceCreateValidationError(message, fieldErrors) {
      syncInvoiceCreateStepWithFieldErrors(fieldErrors);
      renderer.showError(message || "");
      setInvoiceCreateValidationState(message, fieldErrors);
      triggerInvoiceCreateSubmitValidationFeedback();
      focusFirstInvoiceCreateValidationField(fieldErrors);
    }

    function validateInvoiceCreateSettlementStep() {
      var recordLabel = getInvoiceCreateRecordLabel();

      if (!state.supplier || !getSelectedInvoiceCreateSettlements().length) {
        showInvoiceCreateValidationError("Select at least one supplier settlement before continuing.", {
          settlement: "Choose the settlements you want to use for this " + recordLabel + "."
        });
        return false;
      }

      return true;
    }

    function validateInvoiceCreateAmountsStep() {
      var computedAmounts;
      var recordLabelCapitalized = isInvoiceCreateRefundMode() ? "Refund" : "Invoice";
      var selectedTypeValue = getInvoiceCreateSelectedTypeValue();
      var selectedDocumentFile = getInvoiceCreateDocumentFile();

      if (!validateInvoiceCreateSettlementStep() || !validateInvoiceCreateDocumentStep()) {
        return false;
      }

      computedAmounts = updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");

      if (!computedAmounts.grossAmount) {
        showInvoiceCreateValidationError("Enter an amount before continuing.", {
          amountGross: recordLabelCapitalized + " Amount Incl VAT must be greater than zero."
        });
        return false;
      }

      if (isInvoiceCreateDocumentRequired() && selectedDocumentFile == null) {
        showInvoiceCreateValidationError("Attach the invoice file before creating the invoice.", {
          invoiceFile: "Invoice File is required."
        });
        return false;
      }

      return true;
    }

    function validateInvoiceCreateDocumentStep() {
      var recordLabelCapitalized = isInvoiceCreateRefundMode() ? "Refund reference" : "Invoice number";
      var selectedTypeValue = getInvoiceCreateSelectedTypeValue();

      if (!validateInvoiceCreateSettlementStep()) {
        return false;
      }

      if (!elements.invoiceCreateNumber.value.trim()) {
        showInvoiceCreateValidationError("Enter " + (isInvoiceCreateRefundMode() ? "a" : "an") + " " + recordLabelCapitalized.toLowerCase() + " before continuing.", {
          invoiceNumber: recordLabelCapitalized + " is required."
        });
        return false;
      }

      if (!elements.invoiceCreateDate.value) {
        showInvoiceCreateValidationError("Choose an invoice date before continuing.", {
          invoiceDate: "Invoice date is required."
        });
        return false;
      }

      if (!isInvoiceCreateRefundMode() && !selectedTypeValue) {
        showInvoiceCreateValidationError("Select an invoice type before continuing.", {
          invoiceType: "Invoice Type is required."
        });
        return false;
      }

      return true;
    }

    function isInvoiceCreateNextSoftBlocked() {
      return false;
    }

    function onInvoiceCreatePreviousClick() {
      var currentStep = getInvoiceCreateStep();

      clearInvoiceCreateValidationState();
      if (currentStep > INVOICE_CREATE_STEPS.settlement) {
        setInvoiceCreateStep(currentStep - 1);
        renderAll();
      }
    }

    function onInvoiceCreateNextClick() {
      var currentStep = getInvoiceCreateStep();
      var canAdvance = true;

      clearInvoiceCreateValidationState();

      if (isInvoiceCreateNextSoftBlocked()) {
        showInvoiceCreateValidationError("Attach the invoice file before continuing.", {
          invoiceFile: "Invoice File is required."
        });
        return;
      }

      if (currentStep === INVOICE_CREATE_STEPS.settlement) {
        canAdvance = validateInvoiceCreateSettlementStep() && validateInvoiceCreateDocumentStep();
      } else if (currentStep === INVOICE_CREATE_STEPS.amounts) {
        canAdvance = validateInvoiceCreateAmountsStep();
      }

      if (!canAdvance) {
        return;
      }

      if (currentStep < INVOICE_CREATE_STEPS.amounts) {
        setInvoiceCreateStep(currentStep + 1);
        renderAll();
      }
    }

    function getInvoiceCreateTaxReviewValidationMessage() {
      var missingChecks = [];
      var recordLabel = getInvoiceCreateRecordLabel();

      if (!elements.invoiceCreateVatReviewed || !elements.invoiceCreateVatReviewed.checked) {
        missingChecks.push("VAT");
      }

      if (hasInvoiceCreateAdditionalVatValues() && (!elements.invoiceCreateAdditionalVatReviewed || !elements.invoiceCreateAdditionalVatReviewed.checked)) {
        missingChecks.push("Additional VAT");
      }

      if (hasInvoiceCreateAdditionalVatValues() && (!elements.invoiceCreateAdditionalIrpfReviewed || !elements.invoiceCreateAdditionalIrpfReviewed.checked)) {
        missingChecks.push("Additional IRPF");
      }

      if (!elements.invoiceCreateIrpfReviewed || !elements.invoiceCreateIrpfReviewed.checked) {
        missingChecks.push("IRPF");
      }

      if (!missingChecks.length) {
        return "";
      }

      return "Review and confirm " + missingChecks.join(" and ") + " before creating the " + recordLabel + ".";
    }

    function updateInvoiceCreateComputedAmounts(source) {
      var vatRate = getInvoiceCreateNumberValue(elements.invoiceCreateVatPercent.value);
      var irpfRate = getInvoiceCreateNumberValue(elements.invoiceCreateIrpfPercent.value);
      var grossAmount = getInvoiceCreateNumberValue(elements.invoiceCreateAmountGross.value);
      var netAmount = getInvoiceCreateNumberValue(elements.invoiceCreateAmountNet.value);
      var additionalVatValues = getInvoiceCreateAdditionalVatValues();
      var additionalGrossAmount = hasInvoiceCreateAdditionalVatValues()
        ? additionalVatValues.grossAmount
        : 0;
      var additionalVatAmount = hasInvoiceCreateAdditionalVatValues()
        ? additionalVatValues.amount
        : 0;
      var additionalIrpfAmount = hasInvoiceCreateAdditionalVatValues()
        ? additionalVatValues.irpfAmount
        : 0;
      var reimbursableExpense = getInvoiceCreateNumberValue(elements.invoiceCreateReimbursableExpense.value);
      var vatMultiplier = 1 + (vatRate / 100);
      var vatAmount;
      var primaryIrpfAmount;
      var irpfAmount;
      var invoiceTotal;
      var totalPayableAmount;

      state.invoiceCreation.lastEditedAmountMode = source || state.invoiceCreation.lastEditedAmountMode || "gross";

      if (state.invoiceCreation.lastEditedAmountMode === "net") {
        grossAmount = netAmount * vatMultiplier;
        setInvoiceCreateAmountValue(elements.invoiceCreateAmountGross, grossAmount);
      } else {
        netAmount = vatMultiplier ? (grossAmount / vatMultiplier) : grossAmount;
        setInvoiceCreateAmountValue(elements.invoiceCreateAmountNet, netAmount);
      }

      grossAmount = getInvoiceCreateNumberValue(elements.invoiceCreateAmountGross.value);
      netAmount = getInvoiceCreateNumberValue(elements.invoiceCreateAmountNet.value);
      vatAmount = roundCurrency(grossAmount - netAmount);
      primaryIrpfAmount = roundCurrency(netAmount * irpfRate / 100);
      irpfAmount = roundCurrency(primaryIrpfAmount + additionalIrpfAmount);
      invoiceTotal = roundCurrency(grossAmount + additionalGrossAmount - irpfAmount);
      totalPayableAmount = roundCurrency(invoiceTotal + reimbursableExpense);

      if (getSelectedInvoiceCreateSettlements().length === 1) {
        state.invoiceCreation.settlementAllocationAmounts[getSelectedInvoiceCreateSettlements()[0].id] = isInvoiceCreateRefundMode() ? invoiceTotal : totalPayableAmount;
      }

      elements.invoiceCreateVatAmount.textContent = helpers.formatCurrency(vatAmount);
      if (elements.invoiceCreateAdditionalVatAmount) {
        elements.invoiceCreateAdditionalVatAmount.textContent = helpers.formatCurrency(additionalVatAmount);
      }
      elements.invoiceCreateIrpfAmount.textContent = helpers.formatCurrency(irpfAmount);
      if (elements.invoiceCreateAdditionalIrpfDisplay) {
        elements.invoiceCreateAdditionalIrpfDisplay.textContent = helpers.formatCurrency(additionalIrpfAmount);
      }
      elements.invoiceCreateInvoiceTotal.textContent = helpers.formatCurrency(invoiceTotal);
      elements.invoiceCreateTotalPayableAmount.textContent = helpers.formatCurrency(totalPayableAmount);
      if (state.invoiceCreation && state.invoiceCreation.isOpen) {
        renderInvoiceCreateSettlementSummary();
      }

      return {
        grossAmount: grossAmount,
        netAmount: netAmount,
        vatAmount: vatAmount,
        additionalAmountExclVat: hasInvoiceCreateAdditionalVatValues()
          ? additionalVatValues.baseAmount
          : 0,
        additionalAmountInclVat: additionalGrossAmount,
        additionalVatAmount: additionalVatAmount,
        primaryIrpfAmount: primaryIrpfAmount,
        additionalIrpfPercent: hasInvoiceCreateAdditionalVatValues() ? additionalVatValues.irpfPercent : 0,
        additionalIrpfAmount: additionalIrpfAmount,
        irpfAmount: irpfAmount,
        reimbursableExpense: reimbursableExpense,
        invoiceTotal: invoiceTotal,
        totalPayableAmount: totalPayableAmount
      };
    }

    async function confirmInvoiceCreateIrpfSelfEmployment() {
      var irpfRate = getInvoiceCreateNumberValue(elements.invoiceCreateIrpfPercent.value);

      if (
        !irpfRate ||
        !state.supplier ||
        isSupplierSelfEmployed(state.supplier) ||
        isIrpfSelfEmploymentPromptOpen
      ) {
        return;
      }

      isIrpfSelfEmploymentPromptOpen = true;
      try {
        if (!await requestIrpfSelfEmploymentConfirmation()) {
          elements.invoiceCreateIrpfPercent.value = "0";
          clearInvoiceCreateIrpfReviewCheck();
          updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
          renderer.showNotice("IRPF was reset to 0 because the vendor is not self-employed.", { tone: "neutral" });
          return;
        }

        setInvoiceCreateLoading(true, "Updating vendor self-employment status...");
        await updateSupplierSelfEmployedStatus(state.supplierId, true);
        renderAll();
        renderer.showNotice("Vendor marked as self-employed. IRPF has been kept.", { tone: "success" });
      } catch (error) {
        elements.invoiceCreateIrpfPercent.value = "0";
        clearInvoiceCreateIrpfReviewCheck();
        updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
        debugError("confirmInvoiceCreateIrpfSelfEmployment failed", error, { supplierId: state.supplierId });
        renderer.showError("The vendor could not be marked as self-employed. IRPF was reset to 0.");
      } finally {
        isIrpfSelfEmploymentPromptOpen = false;
        setInvoiceCreateLoading(false);
      }
    }

    function requestIrpfSelfEmploymentConfirmation() {
      if (!elements.invoiceCreateIrpfConfirmationPopup) {
        return Promise.resolve(false);
      }

      // The invoice form can be opened from a different tab. Move this widget modal
      // outside any hidden tab container so it is always visible above the form.
      if (global.document && global.document.body && elements.invoiceCreateIrpfConfirmationPopup.parentElement !== global.document.body) {
        global.document.body.appendChild(elements.invoiceCreateIrpfConfirmationPopup);
      }
      elements.invoiceCreateIrpfConfirmationPopup.hidden = false;
      return new Promise(function (resolve) {
        resolveIrpfSelfEmploymentConfirmation = resolve;
      });
    }

    function resolveInvoiceCreateIrpfSelfEmploymentConfirmation(confirmed) {
      if (elements.invoiceCreateIrpfConfirmationPopup) {
        elements.invoiceCreateIrpfConfirmationPopup.hidden = true;
      }
      if (resolveIrpfSelfEmploymentConfirmation) {
        resolveIrpfSelfEmploymentConfirmation(Boolean(confirmed));
        resolveIrpfSelfEmploymentConfirmation = null;
      }
    }

    function renderInvoiceCreateServices() {
      var services = state.invoiceCreation.services || [];
      var showServicesPanel = Boolean(state.invoiceCreation.selectedSettlement);

      if (elements.invoiceCreateServicesPanel) {
        elements.invoiceCreateServicesPanel.hidden = !showServicesPanel;
        elements.invoiceCreateServicesPanel.classList.toggle("is-settlement-selected", showServicesPanel);
      }

      elements.invoiceCreateServicesCount.textContent = services.length === 1 ? "1 service" : String(services.length) + " services";

      if (!showServicesPanel) {
        elements.invoiceCreateServicesEmpty.textContent = "Select a supplier settlement to load its related booking services.";
        elements.invoiceCreateServicesEmpty.hidden = false;
        elements.invoiceCreateServicesTableWrap.hidden = true;
        elements.invoiceCreateServicesTableBody.innerHTML = "";
        return;
      }

      if (!services.length) {
        elements.invoiceCreateServicesEmpty.textContent = "No booking services are linked to this supplier settlement.";
        elements.invoiceCreateServicesEmpty.hidden = false;
        elements.invoiceCreateServicesTableWrap.hidden = true;
        elements.invoiceCreateServicesTableBody.innerHTML = "";
        return;
      }

      renderStableMarkup(elements.invoiceCreateServicesTableBody, services.map(function (service) {
        return '<article class="supplier-service-item"><div><strong>' + helpers.escapeHtml(helpers.textValue(service.Product_Description, service.Name || "Service")) + '</strong><span>' + helpers.escapeHtml(helpers.formatDate(service.Service_Date)) + '</span></div><dl><div><dt>Total purchase price</dt><dd>' + helpers.escapeHtml(helpers.formatCurrency(service.Total_Purchase_Price)) + '</dd></div><div><dt>Final purchase cost</dt><dd>' + helpers.escapeHtml(helpers.formatCurrency(service.Final_Purchase_Cost)) + '</dd></div></dl></article>';
      }).join(""));

      elements.invoiceCreateServicesEmpty.hidden = true;
      elements.invoiceCreateServicesTableWrap.hidden = false;
    }

    function renderInvoiceCreateTypeColors() {
      var select = elements.invoiceCreateType;
      if (!select || !select.options) { return; }
      var field = state.invoiceCreation.invoiceFields && state.invoiceCreation.invoiceFields.invoiceType;
      var values = field && field.enable_colour_code !== false ? field.pick_list_values || [] : [];
      Array.prototype.forEach.call(select.options, function (option) {
        var metadata = values.find(function (item) { return String(item.actual_value) === option.value; });
        var color = metadata && /^#[0-9a-f]{6}$/i.test(metadata.colour_code || "") ? metadata.colour_code : "";
        var foreground = "#26313d";
        if (color) {
          var rgb = [1, 3, 5].map(function (offset) {
            var channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
            return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
          });
          var luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          foreground = luminance > 0.179 ? "#000000" : "#ffffff";
        }
        option.style.backgroundColor = color || "#ffffff";
        option.style.color = foreground;
        if (option.selected) {
          select.style.backgroundColor = color;
          select.style.color = color ? foreground : "";
        }
      });
    }

    function renderInvoiceCreateModeState() {
      var isRefundMode = isInvoiceCreateRefundMode();
      var settlementSelected = Boolean(state.invoiceCreation.selectedSettlement);
      var typeOptions = getInvoiceCreateTypeOptionsForMode();
      var currentTypeValue = String(elements.invoiceCreateType && elements.invoiceCreateType.value || "");

      if (elements.invoiceCreateTitle) {
        elements.invoiceCreateTitle.textContent = getInvoiceCreateTitleText();
      }
      if (elements.invoiceCreateHeaderSupplier) {
        var supplier = state.supplier, supplierId = supplier && String(supplier.id || "");
        var supplierName = supplier && (supplier.Vendor_Name || supplier.Name || helpers.getLookupName(supplier)) || "";
        var header = elements.invoiceCreateHeaderSupplier, signature = JSON.stringify([supplierId, supplierName]);
        header.hidden = !supplierId;
        if (header.dataset.supplier !== signature) {
          header.dataset.supplier = signature;
          header.innerHTML = supplierId ? '<span>' + helpers.escapeHtml(supplierName) + '</span>' + (ns.supplierAccountingInfo ? ns.supplierAccountingInfo.infoHtml(supplierId) : '') : '';
        }
      }
      if (elements.invoiceCreateNumberLabel) {
        elements.invoiceCreateNumberLabel.textContent = isRefundMode ? "Refund Reference" : "Invoice Number";
      }
      if (elements.invoiceCreateDateLabel) {
        elements.invoiceCreateDateLabel.textContent = isRefundMode ? "Refund Date" : "Invoice Date";
      }
      if (elements.invoiceCreateAmountNetLabel) {
        elements.invoiceCreateAmountNetLabel.textContent = isRefundMode ? "Refund Amount Excl VAT" : "Invoice Amount Excl VAT";
      }
      if (elements.invoiceCreateAmountGrossLabel) {
        elements.invoiceCreateAmountGrossLabel.textContent = isRefundMode ? "Refund Amount Incl VAT" : "Invoice Amount Incl VAT";
      }
      if (elements.invoiceCreateInvoiceTotalLabel) {
        elements.invoiceCreateInvoiceTotalLabel.textContent = isRefundMode ? "Credit Note Total" : "Invoice Total";
      }
      if (elements.invoiceCreateSubmit) {
        elements.invoiceCreateSubmit.textContent = isRefundMode ? "Create refund" : "Create invoice";
      }
      if (elements.invoiceCreateTypeField) {
        elements.invoiceCreateTypeField.hidden = isRefundMode;
      }

      if (!global.document || global.document.activeElement !== elements.invoiceCreateType) {
        renderInvoiceCreateSelect(elements.invoiceCreateType, typeOptions, isRefundMode ? INVOICE_TYPES.creditNote : "Select invoice type");
      }

      if (!isRefundMode && currentTypeValue && typeOptions.some(function (option) {
        return String(option && option.value || "") === currentTypeValue;
      })) {
        elements.invoiceCreateType.value = currentTypeValue;
      }

      syncInvoiceCreateModeDefaults();
      updateInvoiceDateDefault(false);

      renderInvoiceCreateTypeColors();

      if (elements.invoiceCreateModeBadge) {
        elements.invoiceCreateModeBadge.textContent = settlementSelected
          ? (isRefundMode ? "Refund mode | settlement selected" : "Invoice mode | settlement selected")
          : state.supplierId
            ? (isRefundMode ? "Refund mode | supplier ready" : "Invoice mode | supplier ready")
            : "Supplier context required";
      }
    }

    function onInvoiceCreateSettlementStatusToggleClick(event) {
      if (event) {
        event.preventDefault();
      }

      if (elements.invoiceCreateSettlementStatusToggle && elements.invoiceCreateSettlementStatusToggle.disabled) {
        return;
      }

      state.invoiceCreation.settlementStatusDropdownOpen = !state.invoiceCreation.settlementStatusDropdownOpen;
      renderAll();
    }

    function onInvoiceCreateSettlementStatusOptionChange(event) {
      var input = event.target;
      var nextValues;

      if (!input || input.type !== "checkbox") {
        return;
      }

      nextValues = getNormalizedInvoiceCreateSettlementStatusValues(state.invoiceCreation.settlementStatusValues);

      if (input.checked) {
        nextValues.push(input.value);
      } else {
        nextValues = nextValues.filter(function (value) {
          return value !== input.value;
        });
      }

      state.invoiceCreation.settlementStatusValues = getNormalizedInvoiceCreateSettlementStatusValues(nextValues);
      renderAll();
    }

    function onInvoiceCreateSettlementStatusMenuActionClick(event) {
      var action = event.target && event.target.getAttribute("data-status-filter-action");
      var options = buildInvoiceCreateSettlementStatusOptions();

      if (!action) {
        return;
      }

      if (action === "select-all") {
        state.invoiceCreation.settlementStatusValues = options.map(function (item) {
          return item.value;
        });
      } else if (action === "clear-all") {
        state.invoiceCreation.settlementStatusValues = [];
      }

      renderAll();
    }

    function onDocumentClickCloseInvoiceCreateSettlementStatusDropdown(event) {
      var fieldContainsTarget = elements.invoiceCreateSettlementStatusField &&
        typeof elements.invoiceCreateSettlementStatusField.contains === "function" &&
        elements.invoiceCreateSettlementStatusField.contains(event.target);

      if (state.invoiceCreation.settlementStatusDropdownOpen && !fieldContainsTarget) {
        state.invoiceCreation.settlementStatusDropdownOpen = false;
        renderAll();
      }
    }

    function isInvoiceCreateDocumentRequired() {
      return !isInvoiceCreateRefundMode() && getInvoiceCreateSelectedTypeValue() !== "Commission";
    }

    function renderInvoiceCreateDocumentFilePreview() {
      var selectedFile = getInvoiceCreateDocumentFile();
      var fileRequired = isInvoiceCreateDocumentRequired();
      if (elements.invoiceCreateFileRequired) {
        elements.invoiceCreateFileRequired.hidden = !fileRequired;
      }
      if (elements.invoiceCreateFileInput) {
        elements.invoiceCreateFileInput.setAttribute("aria-required", String(fileRequired));
      }

      if (elements.invoiceCreateFileInput) {
        elements.invoiceCreateFileInput.disabled = state.isLoading;
      }

      if (elements.invoiceCreateFileDropZone) {
        elements.invoiceCreateFileDropZone.classList.toggle("has-file", Boolean(selectedFile));
      }
      if (elements.invoiceCreateFileChoose) {
        elements.invoiceCreateFileChoose.textContent = selectedFile ? "Change file" : "Choose file";
      }

      if (elements.invoiceCreateFileName) {
        elements.invoiceCreateFileName.textContent = selectedFile
          ? selectedFile.name
          : "No file selected";
      }

      if (elements.invoiceCreateFileRemove) {
        elements.invoiceCreateFileRemove.hidden = !selectedFile;
        elements.invoiceCreateFileRemove.disabled = state.isLoading;
      }
    }

    function setInvoiceCreateLoading(isLoading, label, options) {
      var preserveNotice = Boolean(options && options.preserveNotice);

      if (elements.invoiceCreateLoadingPill) {
        elements.invoiceCreateLoadingPill.hidden = !isLoading;
        elements.invoiceCreateLoadingPill.textContent = label || "Loading...";
      }
      renderer.setLoading(isLoading, label);
      if (!isLoading && !preserveNotice) {
        renderer.showNotice("");
      }
      refreshInvoiceCreateActionState();
    }

    function closeCreateInvoicePanel() {
      if (calculationMonitor) { calculationMonitor.stop(); }
      settlementLoadGeneration++;
      state.invoiceCreation.isOpen = false;
      state.invoiceCreation.settlementDropdownOpen = false;
      state.invoiceCreation.mode = INVOICE_CREATE_MODES.invoice;
      setInvoiceCreateStep(INVOICE_CREATE_STEPS.settlement);
      resetInvoiceCreateFormAfterCreate();
      clearInvoiceCreateValidationState();
      renderer.showError("");
      renderAll();
    }

    async function openCreateInvoicePanel(mode) {
      var backgroundTasks;
      var nextMode = mode === INVOICE_CREATE_MODES.refund
        ? INVOICE_CREATE_MODES.refund
        : INVOICE_CREATE_MODES.invoice;

      if (!state.supplierId || !state.supplier) {
        renderer.showError("Load a supplier first.");
        return;
      }

      state.invoiceCreation.isOpen = true;
      state.invoiceCreation.mode = nextMode;
      setInvoiceCreateStep(INVOICE_CREATE_STEPS.settlement);
      resetInvoiceCreateFormAfterCreate();
      clearInvoiceCreateValidationState();
      renderer.showNotice("");
      renderer.showError("");
      elements.invoiceCreateDate.value = "";
      invoiceDateDefaultType = undefined;
      applyInvoiceCreateSupplierTaxDefaults();
      syncInvoiceCreateModeDefaults();
      renderAll();

      try {
        backgroundTasks = [
          ensureBookingsLoaded().then(function () {
            renderAll();
          }).catch(function (error) {
            debugError("openCreateInvoicePanel ensureBookingsLoaded failed", error, {
              supplierId: state.supplierId
            });
          }),
          ensureInvoiceCreateFieldMetadataLoaded().then(function () {
            renderAll();
          }).catch(function (error) {
            debugError("openCreateInvoicePanel ensureInvoiceCreateFieldMetadataLoaded failed", error, {
              supplierId: state.supplierId
            });
          }),
          ensureInvoiceCreateSettlementStatusOptionsLoaded().then(function () {
            renderAll();
          }).catch(function (error) {
            debugError("openCreateInvoicePanel ensureInvoiceCreateSettlementStatusOptionsLoaded failed", error, {
              supplierId: state.supplierId
            });
          })
        ];
        await reloadInvoiceCreateSettlements();
        Promise.allSettled(backgroundTasks).then(function () {
          renderAll();
        });
        renderAll();
      } catch (error) {
        debugError("openCreateInvoicePanel failed", error, {
          supplierId: state.supplierId,
          mode: nextMode
        });
        renderer.showError(error.message || "Could not prepare the invoice form.");
      }
    }

    async function refreshInvoicesAfterCreate(createdInvoiceId) {
      var shouldReloadInvoicesView = state.currentTab === "invoices" && state.views.invoices.hasLoaded;

      state.loaded.invoices = false;
      state.loaded.settlements = false;
      state.views.invoices.hasMore = false;
      state.views.invoices.hasLoaded = false;
      state.records.invoices = [];
      state.records.settlements = [];
      state.invoiceLinesByInvoiceId = {};
      state.invoiceLineLoadingId = "";

      var refreshTasks = [refreshSupplierRelatedActivity({ createdInvoiceId: createdInvoiceId })];
      if (shouldReloadInvoicesView) {
        refreshTasks.push(refreshInvoicesTabData({
          loadedFlag: true
        }));
      }
      var refreshResults = await Promise.allSettled(refreshTasks);
      var refreshFailure = refreshResults.find(function (result) { return result.status === "rejected"; });
      if (refreshFailure) { throw refreshFailure.reason; }
      renderAll();
    }

    function renderInvoiceCreatePanel() {
      elements.invoiceCreatePanel.hidden = !state.invoiceCreation.isOpen;
      elements.invoiceCreatePanel.classList.remove("is-settlement-step");
      if (!state.invoiceCreation.isOpen) {
        if (calculationMonitor) { calculationMonitor.stop(); }
        return;
      }
      if (calculationMonitor) { calculationMonitor.start(String(state.supplierId || ""), getSelectedInvoiceCreateSettlements().map(function (record) { return helpers.getLookupId(record.Booking); })); }
      renderCalculationStatus();
      renderInvoiceCreateModeState();
      updateInvoiceNameDefault();
      renderInvoiceCreateSettlementFilters();
      renderInvoiceCreateSettlementTable();
      renderInvoiceCreateSettlementSummary();
      renderInvoiceCreateServices();
      renderInvoiceCreateDocumentFilePreview();
      elements.invoiceCreateStepSettlement.hidden = false;
      elements.invoiceCreateStepAmounts.hidden = false;
      elements.invoiceCreateDocumentFields.hidden = false;
      elements.invoiceCreateAllocationCard.hidden = false;
      var selected = getSelectedInvoiceCreateSettlements();
      var expanded = state.invoiceCreation.settlementDropdownOpen || !selected.length;
      elements.invoiceCreateSettlementSelectorPanel.hidden = !expanded;
      if (elements.invoiceCreateSelectedSettlementPanel) { elements.invoiceCreateSelectedSettlementPanel.hidden = !selected.length || expanded; }
      if (elements.invoiceCreateSelectionToggle) {
        elements.invoiceCreateSelectionToggle.hidden = !selected.length;
        elements.invoiceCreateSelectionToggle.querySelector("[data-settlement-toggle-action]").textContent = expanded ? "Hide list" : "Show list";
        elements.invoiceCreateSelectionToggle.setAttribute("aria-expanded", String(expanded));
        elements.invoiceCreateSelectionToggle.title = expanded ? "Hide settlement list" : "Show settlement list";
        elements.invoiceCreateSelectionToggle.setAttribute("aria-label", elements.invoiceCreateSelectionToggle.title);
      }
      renderInvoiceCreateValidationState();
      refreshInvoiceCreateActionState();
      renderRegistrationRecovery();
    }

    function resetInvoiceCreateSettlementState() {
      settlementLoadGeneration++;
      if (calculationMonitor) { calculationMonitor.stop(); }
      state.invoiceCreation.settlements = [];
      state.invoiceCreation.selectedSettlement = null;
      state.invoiceCreation.selectedSettlements = [];
      state.invoiceCreation.settlementAllocationAmounts = {};
      setInvoiceCreateStep(INVOICE_CREATE_STEPS.settlement);
      state.invoiceCreation.settlementQuery = "";
      state.invoiceCreation.settlementStatusValues = getDefaultInvoiceCreateSettlementStatusValues();
      state.invoiceCreation.settlementStatusDropdownOpen = false;
      state.invoiceCreation.loadedSupplierId = "";
      state.invoiceCreation.hasLoadedSettlements = false;
      state.invoiceCreation.settlementMfspFilter = "";
      state.invoiceCreation.isLoadingSettlements = false;
      state.invoiceCreation.settlementDropdownOpen = true;
      state.invoiceCreation.services = [];
      elements.invoiceCreateSettlementSearch.value = "";
      if (elements.invoiceCreateSettlementStatusMenu) {
        elements.invoiceCreateSettlementStatusMenu.innerHTML = "";
        elements.invoiceCreateSettlementStatusMenu.hidden = true;
      }
      if (elements.invoiceCreateSettlementMfspFilter) {
        elements.invoiceCreateSettlementMfspFilter.innerHTML = "";
      }
      elements.invoiceCreateSettlementTableBody.innerHTML = "";
      clearInvoiceCreateValidationState();
    }

    async function loadSettlementsForSupplier(supplierId) {
      if (ns.readSupplierCalculationSettlements) {
        return normalizeSettlements(await ns.readSupplierCalculationSettlements(crm, String(supplierId)));
      }
      var fields = [
        "id",
        "Name",
        "Booking",
        "Supplier",
        "Supplier_Name",
        "Ezus_Supplier_Reference",
        "Total_Service_Cost",
        "Total_Invoice",
        "Total_Paid",
        "Admin_Status",
        "First_Service_Date",
        "Last_Service_Date",
        "Service_Count"
      ];
      var startedAt = Date.now();
      var escapedId = escapeCoqlValue(supplierId);
      var criteria = "(Supplier:equals:" + helpers.escapeCriteriaValue(supplierId) + ")";
      var whereClause = "Supplier = '" + escapedId + "'";

      try {
        return normalizeSettlements(await crm.searchRecord(MODULES.settlements, criteria));
      } catch (searchError) {
        debugWarn("loadSettlementsForSupplier searchRecord fallback", {
          supplierId: supplierId,
          elapsedMs: Date.now() - startedAt
        });
        try {
          return normalizeSettlements(await crm.coql(
            "select " + fields.join(", ") +
            " from " + MODULES.settlements +
            " where " + whereClause +
            " limit 0, 200"
          ));
        } catch (coqlError) {
          debugWarn("loadSettlementsForSupplier coql fallback", {
            supplierId: supplierId,
            elapsedMs: Date.now() - startedAt
          });
          return normalizeSettlements((await crm.getAllRecords(MODULES.settlements, 1, 200)).filter(function (record) {
            return helpers.getLookupId(record.Supplier) === supplierId;
          }));
        }
      } finally {
        void startedAt;
      }
    }

    async function reloadInvoiceCreateSettlements(options) {
      var supplierAtStart = String(state.supplierId || "");
      var loadToken = ++settlementLoadGeneration;
      var preserveSearch = Boolean(options && options.preserveSearch);
      var forceReload = Boolean(options && options.forceReload);
      var canReuseLoadedSettlements;

      if (!state.supplierId) {
        return;
      }

      canReuseLoadedSettlements =
        !forceReload &&
        state.invoiceCreation.loadedSupplierId === state.supplierId &&
        state.invoiceCreation.hasLoadedSettlements &&
        !state.invoiceCreation.isLoadingSettlements &&
        Array.isArray(state.invoiceCreation.settlements);

      if (canReuseLoadedSettlements) {
        state.invoiceCreation.selectedSettlement = null;
        state.invoiceCreation.selectedSettlements = [];
        state.invoiceCreation.settlementAllocationAmounts = {};
        state.invoiceCreation.services = [];
        state.invoiceCreation.settlementDropdownOpen = true;
        state.invoiceCreation.settlementStatusDropdownOpen = false;
        state.invoiceCreation.settlementMfspFilter = "";
        if (!preserveSearch) {
          state.invoiceCreation.settlementQuery = "";
          elements.invoiceCreateSettlementSearch.value = "";
        }
        renderAll();
        return;
      }

      setInvoiceCreateLoading(true, "Loading settlements...");
      renderer.showError("");
      state.invoiceCreation.isLoadingSettlements = true;
      state.invoiceCreation.settlements = [];
      state.invoiceCreation.selectedSettlement = null;
      state.invoiceCreation.selectedSettlements = [];
      state.invoiceCreation.settlementAllocationAmounts = {};
      state.invoiceCreation.services = [];
      state.invoiceCreation.settlementDropdownOpen = true;
      state.invoiceCreation.settlementStatusDropdownOpen = false;
      state.invoiceCreation.loadedSupplierId = state.supplierId;
      state.invoiceCreation.settlementMfspFilter = "";

      if (!preserveSearch) {
        state.invoiceCreation.settlementQuery = "";
        elements.invoiceCreateSettlementSearch.value = "";
      }

      renderAll();

      try {
        var loadedSettlements = await loadSettlementsForSupplier(supplierAtStart);
        if (loadToken !== settlementLoadGeneration || String(state.supplierId) !== supplierAtStart) { return; }
        state.invoiceCreation.settlements = loadedSettlements;
        state.invoiceCreation.isLoadingSettlements = false;
        state.invoiceCreation.hasLoadedSettlements = true;

        if (!state.invoiceCreation.settlements.length) {
          renderer.showNotice("A settlement is required to register an invoice. See calculation status above.");
        } else {
          renderer.showNotice("");
        }
      } catch (error) {
        if (loadToken !== settlementLoadGeneration || String(state.supplierId) !== supplierAtStart) { return; }
        resetInvoiceCreateSettlementState();
        state.invoiceCreation.isLoadingSettlements = false;
        debugError("reloadInvoiceCreateSettlements failed", error, {
          supplierId: state.supplierId
        });
        renderer.showError(error.message || "Could not load supplier settlements.");
        if (options && options.throwOnError) { throw error; }
      } finally {
        if (String(state.supplierId) === supplierAtStart && (loadToken === settlementLoadGeneration || !state.invoiceCreation.isLoadingSettlements)) {
          state.invoiceCreation.isLoadingSettlements = false;
          setInvoiceCreateLoading(false);
        }
      }
    }

    async function loadServicesForSettlement(settlementId) {
      var fields = [
        "id",
        "Name",
        "Booking",
        "Product_Description",
        "Service_Date",
        "Total_Purchase_Price",
        "Final_Purchase_Cost",
        "Booking_Reference",
        "Supplier_Name",
        "Supplier_Settlement"
      ];
      var escapedId = settlementId.replace(/'/g, "\\'");
      var selectFields = await resolveCoqlFields(MODULES.bookingServices, fields);

      try {
        return normalizeServices(await crm.coql(
          "select " + selectFields.join(", ") +
          " from " + MODULES.bookingServices +
          " where Supplier_Settlement = '" + escapedId + "'" +
          " limit 0, 200"
        ));
      } catch (coqlError) {
        try {
          return normalizeServices(await crm.searchRecord(MODULES.bookingServices, "(Supplier_Settlement:equals:" + settlementId + ")"));
        } catch (searchError) {
          return normalizeServices((await crm.getAllRecords(MODULES.bookingServices, 1, 200)).filter(function (record) {
            return helpers.getLookupId(record.Supplier_Settlement) === settlementId;
          }));
        }
      }
    }

    async function loadExistingInvoiceLines(invoiceId) {
      var fields = [
        "id",
        INVOICE_LINE_FIELDS.serviceLookup
      ];
      var escapedId = invoiceId.replace(/'/g, "\\'");
      var selectFields = await resolveCoqlFields(MODULES.invoiceLines, fields);

      try {
        return helpers.extractRecords(await crm.coql(
          "select " + selectFields.join(", ") +
          " from " + MODULES.invoiceLines +
          " where " + INVOICE_LINE_FIELDS.invoiceLookup + " = '" + escapedId + "'" +
          " limit 0, 200"
        ));
      } catch (coqlError) {
        try {
          return await crm.searchRecord(MODULES.invoiceLines, "(" + INVOICE_LINE_FIELDS.invoiceLookup + ":equals:" + invoiceId + ")");
        } catch (searchError) {
          return (await crm.getAllRecords(MODULES.invoiceLines, 1, 200)).filter(function (record) {
            return helpers.getLookupId(record[INVOICE_LINE_FIELDS.invoiceLookup]) === invoiceId;
          });
        }
      }
    }

    async function getServicesForInvoiceLineCreation(settlementId) {
      if (
        state.invoiceCreation.selectedSettlement &&
        state.invoiceCreation.selectedSettlement.id === settlementId &&
        state.invoiceCreation.services.length
      ) {
        return state.invoiceCreation.services;
      }

      return loadServicesForSettlement(settlementId);
    }

    function buildInvoiceLinePayload(invoiceId, settlementId, service) {
      var bookingId = helpers.getLookupId(service.Booking);
      var descriptionValue = service.Product_Description || "";
      var bookingReference = service.Booking_Reference || "";
      var payload = {};

      payload[INVOICE_LINE_FIELDS.invoiceLookup] = { id: invoiceId };
      payload[INVOICE_LINE_FIELDS.serviceLookup] = { id: service.id };
      payload[INVOICE_LINE_FIELDS.name] = service.Name || ("Service " + service.id);
      payload[INVOICE_LINE_FIELDS.amount] = getInvoiceCreateNumberValue(service.Total_Purchase_Price);
      payload[INVOICE_LINE_FIELDS.quantity] = 1;

      if (settlementId) {
        payload[INVOICE_LINE_FIELDS.settlementLookup] = { id: settlementId };
      }

      if (state.supplierId) {
        payload[INVOICE_LINE_FIELDS.supplierLookup] = { id: state.supplierId };
      }

      if (bookingId) {
        payload[INVOICE_LINE_FIELDS.bookingLookup] = { id: bookingId };
      }

      if (bookingReference) {
        descriptionValue = descriptionValue
          ? descriptionValue + " | Booking ref: " + bookingReference
          : "Booking ref: " + bookingReference;
      }

      if (descriptionValue) {
        payload[INVOICE_LINE_FIELDS.description] = descriptionValue;
      }

      if (service.Service_Date) {
        payload[INVOICE_LINE_FIELDS.serviceDate] = service.Service_Date;
      }

      return payload;
    }

    async function createInvoiceLinesFallback(invoiceId, settlementId) {
      var services = await getServicesForInvoiceLineCreation(settlementId);
      var existingLines = await loadExistingInvoiceLines(invoiceId);
      var existingServiceIds = {};
      var createdCount = 0;
      var skippedCount = 0;
      var errorMessages = [];
      var index;
      var service;
      var serviceId;
      var response;
      var created;
      var status;

      if (!services.length) {
        return {
          message: " No booking services found for the selected supplier settlement.",
          success: true
        };
      }

      existingLines.forEach(function (line) {
        var existingServiceId = helpers.getLookupId(line[INVOICE_LINE_FIELDS.serviceLookup]);

        if (existingServiceId) {
          existingServiceIds[existingServiceId] = true;
        }
      });

      for (index = 0; index < services.length; index += 1) {
        service = services[index];
        serviceId = service && service.id ? String(service.id) : "";

        if (!serviceId || existingServiceIds[serviceId]) {
          skippedCount += 1;
          continue;
        }

        response = await crm.insertRecord(MODULES.invoiceLines, buildInvoiceLinePayload(invoiceId, settlementId, service));
        created = helpers.extractRecords(response)[0] || {};
        status = String(created.status || created.code || "").toLowerCase();

        if (status && status !== "success") {
          skippedCount += 1;
          errorMessages.push(created.message || "Zoho CRM rejected one invoice line.");
          continue;
        }

        createdCount += 1;
        existingServiceIds[serviceId] = true;
      }

      return {
        message: " " + createdCount + " invoice line(s) created from widget fallback." + (skippedCount ? " " + skippedCount + " skipped." : "") + (errorMessages.length ? " Review CRM permissions and invoice line field mappings." : ""),
        success: !errorMessages.length
      };
    }

    async function createInvoiceLinesForInvoice(invoiceId, settlementId) {
      var response;
      var functionResult;
      var fallbackResult;
      var functionArgs = {
        invoiceId: invoiceId,
        settlementId: settlementId || "",
        supplierId: state.supplierId || ""
      };
      var failureMessage = "";

      try {
        response = await crm.executeFunction(CREATE_LINES_FUNCTION, functionArgs);
        functionResult = getFunctionResponseResult(response);

        if (functionResult.success === true) {
          return {
            message: functionResult.message ? " " + functionResult.message : " Invoice lines function executed.",
            success: true
          };
        }

        failureMessage = functionResult.message || " The CRM function did not confirm invoice line creation.";
      } catch (lineError) {
        debugError("createInvoiceLinesForInvoice function failed", lineError, {
          functionName: CREATE_LINES_FUNCTION,
          args: functionArgs
        });
        failureMessage = " The CRM function could not be executed.";
      }

      try {
        fallbackResult = await createInvoiceLinesFallback(invoiceId, settlementId);

        if (fallbackResult.success) {
          return {
            message: fallbackResult.message + (failureMessage ? " The CRM function response was: " + failureMessage.trim() : ""),
            success: true
          };
        }

        return {
          message: (failureMessage || "") + fallbackResult.message,
          success: false
        };
      } catch (fallbackError) {
        debugError("createInvoiceLinesForInvoice fallback failed", fallbackError, {
          invoiceId: invoiceId,
          settlementId: settlementId
        });
        return {
          message: (failureMessage || "") +
            " Widget fallback failed: " + (fallbackError.message || "unknown error") + "." +
            getInvoiceLinePermissionHelpMessage(fallbackError),
          success: false
        };
      }
    }

    function resetInvoiceCreateFormAfterCreate() {
      setInvoiceCreateStep(INVOICE_CREATE_STEPS.settlement);
      elements.invoiceCreateNumber.value = "";
      invoiceNameDefault.reset();
      elements.invoiceCreateNumber.setCustomValidity("");
      elements.invoiceCreateDate.value = "";
      invoiceDateDefaultType = undefined;
      elements.invoiceCreateAmountGross.value = "";
      elements.invoiceCreateAmountNet.value = "";
      elements.invoiceCreateReimbursableExpense.value = "0";
      if (elements.invoiceCreateAdditionalVatEnabled) {
        elements.invoiceCreateAdditionalVatEnabled.checked = false;
      }
      if (elements.invoiceCreateAdditionalVatFields) {
        elements.invoiceCreateAdditionalVatFields.hidden = true;
      }
      if (elements.invoiceCreateAdditionalVatPercent) {
        elements.invoiceCreateAdditionalVatPercent.value = "";
      }
      if (elements.invoiceCreateAdditionalAmountExclVat) {
        elements.invoiceCreateAdditionalAmountExclVat.value = "";
      }
      if (elements.invoiceCreateAdditionalAmountInclVat) {
        elements.invoiceCreateAdditionalAmountInclVat.value = "";
      }
      if (elements.invoiceCreateAdditionalVatAmount) {
        elements.invoiceCreateAdditionalVatAmount.textContent = "-";
      }
      if (elements.invoiceCreateAdditionalIrpfPercent) {
        elements.invoiceCreateAdditionalIrpfPercent.value = "";
      }
      if (elements.invoiceCreateAdditionalIrpfAmount) {
        elements.invoiceCreateAdditionalIrpfAmount.value = "";
      }
      clearInvoiceCreateTaxReviewChecks();
      elements.invoiceCreateVatPercent.dataset.userTouched = "";
      elements.invoiceCreateIrpfPercent.dataset.userTouched = "";
      state.invoiceCreation.lastEditedAmountMode = "gross";
      applyInvoiceCreateSupplierTaxDefaults();
      updateInvoiceCreateComputedAmounts("gross");
      syncInvoiceCreateModeDefaults();
      setDefaultInvoiceCreateStatus();
      clearInvoiceCreateDocumentFileSelection();
      clearInvoiceCreateValidationState();
    }

    function onInvoiceCreateSettlementInput() {
      state.invoiceCreation.settlementQuery = elements.invoiceCreateSettlementSearch.value.trim();
      renderAll();
      renderer.showError("");
    }

    function onInvoiceCreateSettlementTableClick(event) {
      var selectionInput = event.target.closest("[data-settlement-selection-id]");
      var option = event.target.closest("[data-settlement-id]");
      var settlementId;
      var settlement;

      if (!option || !selectionInput) {
        return;
      }

      settlementId = option.getAttribute("data-settlement-id");
      settlement = state.invoiceCreation.settlements.find(function (item) {
        return String(item.id) === String(settlementId);
      }) || null;

      if (settlement) {
        toggleInvoiceCreateSettlement(settlement, selectionInput.checked);
      }
    }

    async function updateSettlementTotalInvoiceAfterCreate(settlementId) {
      if (!settlementId) {
        return;
      }

      await recalculateSettlementTotals(settlementId);
      invalidateInvoiceCreateSettlementCache();
    }

    async function onCreateInvoiceSubmit(event) {
      event.preventDefault();
      if (submitInProgress || state.isLoading) { return; }
      submitInProgress = true;
      try {
        setInvoiceCreateLoading(true, "Checking invoice...");
        if (!isInvoiceCreateRefundMode() && state.supplierId && registration.pending(state.supplierId)) {
          await registerSupplierInvoice(null);
          return;
        }
        await performInvoiceCreateSubmit(event);
      } catch (error) {
        var pending;
        try { pending = state.supplierId && registration.pending(state.supplierId); } catch (_) { /* Keep the unreadable journal. */ }
        renderer.showError((pending && pending.invoiceId ? "Invoice " + pending.invoiceId + " was created. " : "") +
          error.message + (pending ? " Use Resume invoice registration to check or complete the same invoice." : ""));
      } finally {
        submitInProgress = false;
        setInvoiceCreateLoading(false, "", { preserveNotice: true });
        renderAll();
      }
    }

    async function performInvoiceCreateSubmit(event) {
      var supplierName;
      var bookingId;
      var supplierCode;
      var payload = {};
      var response;
      var created;
      var status;
      var createdId;
      var computedAmounts;
      var invoiceLinesMessage;
      var settlementUpdateMessage = "";
      var invoiceSettlementAllocationMessage = "";
      var settlementAllocations;
      var allocationTotal;
      var allocationErrors;
      var invoiceNumberValue = elements.invoiceCreateNumber.value.trim();
      var settlementCapacityValidation;
      var capacityMessages = [];
      var confirmedExcess = [];
      var supplierIdAtSubmit = state.supplierId;
      var taxReviewValidationMessage;
      var validationFieldErrors;
      var additionalVatEnabled = Boolean(elements.invoiceCreateAdditionalVatEnabled && elements.invoiceCreateAdditionalVatEnabled.checked);
      var additionalVatPercentRaw = String(elements.invoiceCreateAdditionalVatPercent && elements.invoiceCreateAdditionalVatPercent.value || "").trim();
      var additionalAmountExclVatRaw = String(elements.invoiceCreateAdditionalAmountExclVat && elements.invoiceCreateAdditionalAmountExclVat.value || "").trim();
      var additionalIrpfPercentRaw = String(elements.invoiceCreateAdditionalIrpfPercent && elements.invoiceCreateAdditionalIrpfPercent.value || "").trim();
      var additionalIrpfAmountRaw = String(elements.invoiceCreateAdditionalIrpfAmount && elements.invoiceCreateAdditionalIrpfAmount.value || "").trim();
      var additionalVatValues = getInvoiceCreateAdditionalVatValues();
      var hasAdditionalVatValue = additionalVatEnabled && (
        additionalVatPercentRaw !== "" ||
        additionalAmountExclVatRaw !== "" ||
        additionalIrpfPercentRaw !== "" ||
        additionalIrpfAmountRaw !== "" ||
        additionalVatValues.percent > 0 ||
        additionalVatValues.grossAmount > 0 ||
        additionalVatValues.irpfPercent > 0 ||
        additionalVatValues.irpfAmount > 0
      );
      var isRefundMode = isInvoiceCreateRefundMode();
      var recordLabel = isRefundMode ? "refund" : "invoice";
      var recordLabelCapitalized = isRefundMode ? "Refund" : "Invoice";
      var selectedTypeValue;
      var bookingMfspReference;
      var vendorEzusSupplierReference;
      var vendorAccountingReference;
      var selectedDocumentFile = getInvoiceCreateDocumentFile();
      var attachmentUploadResult;
      var attachmentNotice = "";
      var attachmentErrorMessage = "";
      var preserveNoticeOnExit = false;

      event.preventDefault();
      renderer.showError("");
      clearInvoiceCreateValidationState();

      if (!state.supplier || !getSelectedInvoiceCreateSettlements().length) {
        showInvoiceCreateValidationError("Select at least one supplier settlement before creating the " + recordLabel + ".", {
          settlement: "Choose the settlements you want to use for this " + recordLabel + "."
        });
        return;
      }

      if (!elements.invoiceCreateDate.value) {
        showInvoiceCreateValidationError("Choose a " + recordLabel + " date before creating the " + recordLabel + ".", {
          invoiceDate: recordLabelCapitalized + " date is required."
        });
        return;
      }

      if (!invoiceNumberValue) {
        showInvoiceCreateValidationError("Enter a " + (isRefundMode ? "refund reference" : "invoice number") + " before creating the " + recordLabel + ".", {
          invoiceNumber: (isRefundMode ? "Refund reference" : "Invoice number") + " is required."
        });
        return;
      }

      selectedTypeValue = getInvoiceCreateSelectedTypeValue();
      if (!isRefundMode && !selectedTypeValue) {
        showInvoiceCreateValidationError("Select an invoice type before creating the invoice.", {
          invoiceType: "Invoice Type is required."
        });
        return;
      }

      if (isInvoiceCreateDocumentRequired() && selectedDocumentFile == null) {
        showInvoiceCreateValidationError("Attach the invoice file before creating the " + recordLabel + ".", {
          invoiceFile: "Invoice File is required."
        });
        return;
      }

      if ((getInvoiceCreateNumberValue(elements.invoiceCreateIrpfPercent.value) > 0 || additionalVatValues.irpfAmount > 0) && !isSupplierSelfEmployed(state.supplier)) {
        showInvoiceCreateValidationError("Confirm whether the vendor should be marked as self-employed before creating the " + recordLabel + ".", {
          irpfReviewed: "Confirm the self-employment prompt or reset IRPF to 0."
        });
        if (!await requestIrpfSelfEmploymentConfirmation()) {
          elements.invoiceCreateIrpfPercent.value = "0";
          if (elements.invoiceCreateAdditionalIrpfPercent) { elements.invoiceCreateAdditionalIrpfPercent.value = ""; }
          if (elements.invoiceCreateAdditionalIrpfAmount) { elements.invoiceCreateAdditionalIrpfAmount.value = ""; }
          clearInvoiceCreateIrpfReviewCheck();
          updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
          showInvoiceCreateValidationError("IRPF can only be used when the supplier is marked as self-employed.", {
            irpfReviewed: "IRPF was reset to 0. Mark the vendor as self-employed to use IRPF."
          });
          return;
        }

        try {
          setInvoiceCreateLoading(true, "Updating supplier self-employment...");
          await updateSupplierSelfEmployedStatus(state.supplierId, true);
          renderAll();
        } catch (selfEmployedError) {
          debugError("updateSupplierSelfEmployedStatus failed", selfEmployedError, {
            supplierId: state.supplierId
          });
          showInvoiceCreateValidationError("The supplier could not be marked as self-employed.", {
            irpfReviewed: "Try again or remove IRPF before creating the " + recordLabel + "."
          });
          return;
        } finally {
          setInvoiceCreateLoading(false);
        }
      }

      if (!isRefundMode) {
        [elements.invoiceCreateAmountGross, elements.invoiceCreateAmountNet, elements.invoiceCreateVatPercent,
          elements.invoiceCreateIrpfPercent, elements.invoiceCreateReimbursableExpense,
          elements.invoiceCreateAdditionalVatPercent, elements.invoiceCreateAdditionalAmountExclVat,
          elements.invoiceCreateAdditionalIrpfPercent].forEach(function (element) {
          if (element) { ns.invoiceRegistrationCents(element.value || 0, "Invoice amounts and percentages"); }
        });
      }
      computedAmounts = updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");

      if (!computedAmounts.grossAmount) {
        showInvoiceCreateValidationError("Enter an amount before creating the " + recordLabel + ".", {
          amountGross: (isRefundMode ? "Refund" : "Invoice") + " Amount Incl VAT must be greater than zero."
        });
        return;
      }

      var amountToAllocate = isRefundMode ? computedAmounts.invoiceTotal : computedAmounts.totalPayableAmount;
      settlementAllocations = getInvoiceCreateSettlementAllocations(amountToAllocate);
      allocationTotal = settlementAllocations.reduce(function (total, allocation) { return total + allocation.amount; }, 0);
      allocationErrors = settlementAllocations.some(function (allocation) { return !(allocation.amount > 0); });
      if (!isRefundMode) {
        settlementAllocations.forEach(function (allocation) { ns.invoiceRegistrationCents(allocation.amount, "Settlement allocation"); });
      }
      if (allocationErrors || (isRefundMode ? Math.abs(allocationTotal - amountToAllocate) > 0.01 : Math.round(allocationTotal * 100) !== Math.round(amountToAllocate * 100))) {
        showInvoiceCreateValidationError("Allocate the complete " + recordLabel + " total between the selected settlements.", {
          allocation: "Each selected settlement needs an allocation amount, and the total must equal " + helpers.formatCurrency(amountToAllocate) + "."
        });
        return;
      }

      if (hasAdditionalVatValue) {
        validationFieldErrors = {};

        if (!(additionalVatValues.percent > 0)) {
          validationFieldErrors.additionalVatPercent = "Enter the Additional VAT percentage.";
        }

        if (!(additionalVatValues.baseAmount > 0)) {
          validationFieldErrors.additionalAmountExclVat = "Enter the Additional Amount Excl VAT.";
        }

        if (Object.keys(validationFieldErrors).length) {
          showInvoiceCreateValidationError("Review the Additional VAT values before creating the " + recordLabel + ".", validationFieldErrors);
          return;
        }
      }

      taxReviewValidationMessage = getInvoiceCreateTaxReviewValidationMessage();

      if (taxReviewValidationMessage) {
        validationFieldErrors = {};

        if (!elements.invoiceCreateVatReviewed || !elements.invoiceCreateVatReviewed.checked) {
          validationFieldErrors.vatReviewed = "Confirm that VAT is correct.";
        }

        if (hasAdditionalVatValue && (!elements.invoiceCreateAdditionalVatReviewed || !elements.invoiceCreateAdditionalVatReviewed.checked)) {
          validationFieldErrors.additionalVatReviewed = "Confirm that Additional VAT is correct.";
        }

        if (hasAdditionalVatValue && (!elements.invoiceCreateAdditionalIrpfReviewed || !elements.invoiceCreateAdditionalIrpfReviewed.checked)) {
          validationFieldErrors.additionalIrpfReviewed = "Confirm that Additional IRPF is correct.";
        }

        if (!elements.invoiceCreateIrpfReviewed || !elements.invoiceCreateIrpfReviewed.checked) {
          validationFieldErrors.irpfReviewed = "Confirm that IRPF is correct.";
        }

        showInvoiceCreateValidationError(taxReviewValidationMessage, validationFieldErrors);
        return;
      }

      try {
        for (var allocationIndex = 0; allocationIndex < settlementAllocations.length; allocationIndex += 1) {
          settlementCapacityValidation = await validateInvoiceCreateSettlementCapacity(
            settlementAllocations[allocationIndex].settlement.id,
            settlementAllocations[allocationIndex].amount,
            getInvoiceCreateSelectedTypeValue()
          );
          if (!settlementCapacityValidation.valid) { break; }
          if (settlementCapacityValidation.requiresConfirmation) {
            capacityMessages.push(settlementCapacityValidation.message);
            confirmedExcess.push(String(settlementAllocations[allocationIndex].settlement.id));
          }
        }
      } catch (validationError) {
        debugError("validateInvoiceCreateSettlementCapacity failed", validationError, {
          settlementId: state.invoiceCreation.selectedSettlement.id,
          invoiceTotal: computedAmounts.invoiceTotal
        });
        showInvoiceCreateValidationError("Could not validate the settlement capacity for this " + recordLabel + ".", {
          settlement: "The settlement totals could not be checked right now.",
          amountGross: "Review the amount and try again."
        });
        return;
      }

      if (!settlementCapacityValidation.valid) {
        renderAll();
        showInvoiceCreateValidationError(
          settlementCapacityValidation.message || "This " + recordLabel + " exceeds the remaining amount available on the settlement.",
          {
            settlement: "This settlement does not have enough remaining capacity for the " + recordLabel + ".",
            amountGross: "Reduce the amount or choose another settlement."
          }
        );
        return;
      }

      if (capacityMessages.length) {
        renderAll();

        if (typeof global.confirm === "function" && !global.confirm(
          capacityMessages.join("\n") + " Click OK to continue anyway, or Cancel to stop."
        )) {
          showInvoiceCreateValidationError(
            settlementCapacityValidation.message || "This " + recordLabel + " exceeds the remaining amount available on the settlement.",
            {
              settlement: "Invoice registration was cancelled by the user.",
              amountGross: "Review the amount or confirm again to continue."
            }
          );
          return;
        }
      }

      renderAll();

      supplierName = state.supplier.Vendor_Name || state.supplier.Name || helpers.getLookupName(state.supplier);
      supplierCode = helpers.getCandidateValue(state.supplier, FIELD_CANDIDATES.supplier.connectionReference) || "";
      bookingId = helpers.getLookupId(state.invoiceCreation.selectedSettlement.Booking);
      if (isRefundMode && invoiceNumberValue && !await validateInvoiceCreateNumberUniqueness(state.supplierId, invoiceNumberValue)) {
        elements.invoiceCreateNumber.setCustomValidity(
          (isRefundMode ? "Refund reference" : "Invoice number") + " must be unique for the selected supplier."
        );
        showInvoiceCreateValidationError((isRefundMode ? "Refund reference" : "Invoice number") + " must be unique for the selected supplier.", {
          invoiceNumber: "Another " + recordLabel + " already uses this reference for the current supplier."
        });
        return;
      }

      payload.Supplier = { id: state.supplierId };
      payload.Supplier_Name = supplierName;
      payload.Supplier_Code = supplierCode;
      payload[getResolvedInvoiceCreateFieldApi("settlementLookup", "Supplier_Settlement")] = { id: state.invoiceCreation.selectedSettlement.id };
      payload[getResolvedInvoiceCreateFieldApi("invoiceDate", "Invoice_Date")] = elements.invoiceCreateDate.value;
      payload[getResolvedInvoiceCreateFieldApi("invoiceAmountExclVat", "Invoice_Amount_Excl_VAT")] = computedAmounts.netAmount;
      payload[getResolvedInvoiceCreateFieldApi("invoiceAmountInclVat", "Invoice_Amount_Incl_VAT")] = computedAmounts.grossAmount;
      payload[getResolvedInvoiceCreateFieldApi("vatPercent", "VAT_percentage")] = getInvoiceCreateNumberValue(elements.invoiceCreateVatPercent.value);
      payload[getResolvedInvoiceCreateFieldApi("vatAmount", "VAT_Amount")] = computedAmounts.vatAmount;
      payload[getResolvedInvoiceCreateFieldApi("additionalAmountExclVat", "Additional_Amount_Excl_VAT")] = hasAdditionalVatValue ? computedAmounts.additionalAmountExclVat : 0;
      payload[getResolvedInvoiceCreateFieldApi("additionalAmountInclVat", "Additional_Amount_Incl_VAT")] = hasAdditionalVatValue ? computedAmounts.additionalAmountInclVat : 0;
      payload[getResolvedInvoiceCreateFieldApi("additionalVatPercent", "Additional_VAT_percentage")] = hasAdditionalVatValue ? additionalVatValues.percent : 0;
      payload[getResolvedInvoiceCreateFieldApi("additionalVatAmount", "Additional_VAT_Amount")] = hasAdditionalVatValue ? computedAmounts.additionalVatAmount : 0;
      payload[getResolvedInvoiceCreateFieldApi("additionalIrpfPercent", "Additional_IRPF_percentage")] = hasAdditionalVatValue ? computedAmounts.additionalIrpfPercent : 0;
      payload[getResolvedInvoiceCreateFieldApi("additionalIrpfAmount", "Additional_IRPF_Amount")] = hasAdditionalVatValue ? computedAmounts.additionalIrpfAmount : 0;
      payload[getResolvedInvoiceCreateFieldApi("irpfPercent", "IRPF_percentage")] = getInvoiceCreateNumberValue(elements.invoiceCreateIrpfPercent.value);
      payload[getResolvedInvoiceCreateFieldApi("irpfAmount", "IRPF_Amount")] = computedAmounts.primaryIrpfAmount;
      payload[getResolvedInvoiceCreateFieldApi("reimbursableExpense", "Reimbursable_Expense")] = computedAmounts.reimbursableExpense;
      payload[getResolvedInvoiceCreateFieldApi("invoiceTotal", "Invoice_Total")] = computedAmounts.invoiceTotal;
      payload[getResolvedInvoiceCreateFieldApi("totalPayableAmount", "Total_Payable_Amount")] = computedAmounts.totalPayableAmount;
      vendorEzusSupplierReference = String(helpers.getCandidateValue(state.supplier, FIELD_CANDIDATES.supplier.ezusReference) || "").trim();
      vendorAccountingReference = String(helpers.getCandidateValue(state.supplier, FIELD_CANDIDATES.supplier.accounting) || "").trim();

      if (vendorEzusSupplierReference || state.invoiceCreation.selectedSettlement.Ezus_Supplier_Reference) {
        payload[getResolvedInvoiceCreateFieldApi("ezusReference", "Ezus_Supplier_Reference")] = vendorEzusSupplierReference || state.invoiceCreation.selectedSettlement.Ezus_Supplier_Reference;
      }

      if (vendorAccountingReference && state.invoiceCreation.invoiceFields.supplierAccounting) {
        payload[getResolvedInvoiceCreateFieldApi("supplierAccounting", "Cuenta_Contable_Supplier")] = vendorAccountingReference;
      }

      if (invoiceNumberValue) {
        payload[getResolvedInvoiceCreateFieldApi("invoiceNumber", "Name")] = invoiceNumberValue;
      }

      payload[getResolvedInvoiceCreateFieldApi("status", "Status")] = DEFAULT_INVOICE_STATUS;

      if (selectedTypeValue) {
        payload[getResolvedInvoiceCreateFieldApi("invoiceType", "Invoice_Type")] = selectedTypeValue;
      }

      if (bookingId) {
        payload[getResolvedInvoiceCreateFieldApi("bookingLookup", "Booking")] = { id: bookingId };
      }

      bookingMfspReference = await getInvoiceCreateBookingMfspReference(bookingId);
      payload[getResolvedInvoiceCreateFieldApi("mfsp", "MFSP_Reference")] = bookingMfspReference || getInvoiceCreateSettlementMfsp(state.invoiceCreation.selectedSettlement) || "";

      setInvoiceCreateLoading(true, isRefundMode ? "Creating refund..." : "Creating invoice...");

      if (!isRefundMode) {
        if (state.supplierId !== supplierIdAtSubmit) { throw new Error("The supplier changed. Reopen the invoice form before saving."); }
        await registerSupplierInvoice(payload, settlementAllocations, confirmedExcess, selectedDocumentFile);
        return;
      }

      try {
        response = await crm.insertRecord(MODULES.invoices, payload);
        created = helpers.extractRecords(response)[0] || {};
        status = String(created.status || created.code || "").toLowerCase();

        if (status && status !== "success") {
          throw new Error(created.message || ("Zoho CRM did not confirm the " + recordLabel + " creation."));
        }

        createdId = created.details && created.details.id;

        if (createdId) {
          try {
            await Promise.all(settlementAllocations.map(function (allocation) {
              return crm.insertRecord(MODULES.invoiceSettlementAllocations, {
                Name: String(createdId) + "-" + String(allocation.settlement.id),
                Vendor_Invoice: { id: createdId },
                Vendor_Settlement: { id: allocation.settlement.id },
                Allocated_Amount: allocation.amount,
                Allocation_Date: elements.invoiceCreateDate.value,
                Status: "Active",
                Allocation_Source: "Manual"
              });
            }));
          } catch (invoiceSettlementAllocationError) {
            debugError("create invoice settlement allocation failed", invoiceSettlementAllocationError, {
              invoiceId: createdId,
              settlementId: state.invoiceCreation.selectedSettlement.id
            });
            invoiceSettlementAllocationMessage = " The invoice was created, but its settlement allocation could not be saved.";
          }
          try {
            await Promise.all(settlementAllocations.map(function (allocation) {
              return updateSettlementTotalInvoiceAfterCreate(allocation.settlement.id);
            }));
          } catch (settlementUpdateError) {
            debugError("updateSettlementTotalInvoiceAfterCreate failed", settlementUpdateError, {
              settlementId: state.invoiceCreation.selectedSettlement.id,
              invoiceId: createdId,
              invoiceTotal: computedAmounts.invoiceTotal
            });
            settlementUpdateMessage = " The " + recordLabel + " was created, but the settlement totals could not be updated automatically.";
          }
          if (!isRefundMode) {
            for (var lineSettlementIndex = 0; lineSettlementIndex < settlementAllocations.length; lineSettlementIndex += 1) {
              invoiceLinesMessage = await createInvoiceLinesForInvoice(createdId, settlementAllocations[lineSettlementIndex].settlement.id);
              if (invoiceLinesMessage && !invoiceLinesMessage.success) { break; }
            }
          }
          if (selectedDocumentFile) {
            try {
              attachmentUploadResult = await uploadFileToInvoiceField(createdId, "Invoice_File", selectedDocumentFile);
              attachmentNotice = " " + selectedDocumentFile.name + " was attached to Invoice_File";
              if (attachmentUploadResult && attachmentUploadResult.fieldState && !attachmentUploadResult.fieldState.fieldAttachments.length) {
                attachmentNotice += ", although the widget could not verify a concrete file preview after upload";
              }
              attachmentNotice += ".";
            } catch (attachmentError) {
              debugError("uploadFileToInvoiceField after create failed", attachmentError, {
                invoiceId: createdId,
                fileName: selectedDocumentFile.name,
                fileSize: selectedDocumentFile.size || 0
              });
              attachmentErrorMessage = "The " + recordLabel + " was created, but the Invoice_File upload failed: " +
                (attachmentError.message || "unknown error") + ".";
            }
          }
        }

        await refreshInvoicesAfterCreate(createdId);
        resetInvoiceCreateFormAfterCreate();
        await reloadInvoiceCreateSettlements();
        state.invoiceCreation.isOpen = false;
        state.invoiceCreation.settlementDropdownOpen = false;
        renderAll();

        if (invoiceLinesMessage && !invoiceLinesMessage.success) {
          renderer.showNotice("Supplier " + recordLabel + " created successfully in Zoho CRM." + attachmentNotice + settlementUpdateMessage + invoiceSettlementAllocationMessage, {
            tone: "success"
          });
          preserveNoticeOnExit = true;
          if (attachmentErrorMessage) {
            renderer.showError("The " + recordLabel + " was created, but its invoice lines could not be generated. " +
              attachmentErrorMessage + (invoiceLinesMessage.message || ""));
            return;
          }
          renderer.showError("The invoice was created, but its invoice lines could not be generated." + (invoiceLinesMessage.message || ""));
          return;
        }

        renderer.showNotice("Supplier " + recordLabel + " created successfully in Zoho CRM." + (invoiceLinesMessage ? invoiceLinesMessage.message : "") + attachmentNotice + settlementUpdateMessage + invoiceSettlementAllocationMessage, {
          tone: "success"
        });
        preserveNoticeOnExit = true;
        if (attachmentErrorMessage) {
          renderer.showError(attachmentErrorMessage);
        }
      } catch (error) {
        debugError("create invoice flow error", error, {
          invoicePayload: payload,
          rawResponse: response
        });
        renderAll();
        showInvoiceCreateValidationError(error.message || ("Zoho CRM rejected the " + recordLabel + " creation."));
      } finally {
        setInvoiceCreateLoading(false, "", {
          preserveNotice: preserveNoticeOnExit
        });
      }
    }

    function handleInvoiceCreateSubmitEvent(event) {
      event.preventDefault();
      Promise.resolve(onCreateInvoiceSubmit(event)).catch(function (error) {
        debugError("invoice create validation failed before submit", error);
        showInvoiceCreateValidationError(
          error && error.message ? error.message : "The invoice validation could not be completed. Please review the highlighted fields.",
          { amountGross: "Review this form and try again." }
        );
      });
    }

    async function onInvoiceCreateSettlementRefreshClick() {
      try {
        renderer.showError("");
        await reloadInvoiceCreateSettlements({
          preserveSearch: true,
          forceReload: true
        });
        renderAll();
      } catch (error) {
        debugError("onInvoiceCreateSettlementRefreshClick failed", error, {
          supplierId: state.supplierId
        });
        renderer.showError(error.message || "Could not refresh settlements.");
      }
    }

    function bindEvents() {
      if (eventsBound) { return; }
      if (elements.invoiceCreateSelectionToggle) {
        elements.invoiceCreateSelectionToggle.addEventListener("click", function () {
          state.invoiceCreation.settlementDropdownOpen = !state.invoiceCreation.settlementDropdownOpen;
          renderAll();
        });
      }
      if (calculationMonitor && elements.invoiceCreateCalculationRefresh) {
        elements.invoiceCreateCalculationRefresh.addEventListener("click", function () { calculationMonitor.refresh(); });
        elements.invoiceCreateCalculationRows.addEventListener("click", function (event) {
          var button = event.target.closest("[data-calculation-retry]");
          if (button && !button.disabled) { calculationMonitor.retry(button.dataset.calculationRetry); }
        });
      }
      eventsBound = true;

      elements.invoiceCreateClose.addEventListener("click", closeCreateInvoicePanel);
      elements.invoiceCreateCancel.addEventListener("click", closeCreateInvoicePanel);
      if (elements.invoiceCreateRequestAccountingAccount) {
        elements.invoiceCreateRequestAccountingAccount.addEventListener("click", onInvoiceCreateRequestAccountingAccountClick);
      }
      elements.invoiceCreateSettlementSearch.addEventListener("input", onInvoiceCreateSettlementInput);
      elements.invoiceCreateSettlementSearch.addEventListener("change", onInvoiceCreateSettlementInput);
      if (elements.invoiceCreateSettlementStatusToggle) {
        elements.invoiceCreateSettlementStatusToggle.addEventListener("click", onInvoiceCreateSettlementStatusToggleClick);
      }
      if (elements.invoiceCreateSettlementStatusMenu) {
        elements.invoiceCreateSettlementStatusMenu.addEventListener("change", onInvoiceCreateSettlementStatusOptionChange);
        elements.invoiceCreateSettlementStatusMenu.addEventListener("click", onInvoiceCreateSettlementStatusMenuActionClick);
      }
      if (elements.invoiceCreateSettlementRefresh) {
        elements.invoiceCreateSettlementRefresh.addEventListener("click", onInvoiceCreateSettlementRefreshClick);
      }
      if (elements.invoiceCreateSelectOtherSettlement) {
        elements.invoiceCreateSelectOtherSettlement.addEventListener("click", function () {
          clearInvoiceCreateValidationState();
          state.invoiceCreation.settlementDropdownOpen = true;
          renderAll();
        });
      }
      elements.invoiceCreateSettlementTableBody.addEventListener("click", onInvoiceCreateSettlementTableClick);
      if (elements.invoiceCreateSelectedSettlementSelect) {
        elements.invoiceCreateSelectedSettlementSelect.addEventListener("change", function () {
          var settlement = getSelectedInvoiceCreateSettlements().find(function (item) {
            return String(item.id) === String(elements.invoiceCreateSelectedSettlementSelect.value);
          });
          if (settlement) {
            selectInvoiceCreateSettlement(settlement);
          }
        });
      }
      if (elements.invoiceCreateSettlementAllocationList) {
        elements.invoiceCreateSettlementAllocationList.addEventListener("input", function (event) {
          var input = event.target.closest("[data-settlement-allocation-id]");
          if (!input) {
            return;
          }
          state.invoiceCreation.settlementAllocationAmounts[input.getAttribute("data-settlement-allocation-id")] = input.value;
          clearInvoiceCreateValidationState();
          var invoiceTotal = getInvoiceCreateCurrentInvoiceTotal();
          var allocations = getInvoiceCreateSettlementAllocations(invoiceTotal);
          var allocatedTotal = allocations.reduce(function (total, allocation) { return total + allocation.amount; }, 0);
          updateInvoiceCreateSettlementAllocationTotals(allocatedTotal, invoiceTotal - allocatedTotal);
        });
      }
      elements.invoiceCreateForm.addEventListener("submit", handleInvoiceCreateSubmitEvent);
      if (elements.invoiceCreateSubmit) {
        elements.invoiceCreateSubmit.addEventListener("click", function (event) {
          // Trigger the widget validation explicitly; this also guarantees feedback in embedded Zoho contexts.
          handleInvoiceCreateSubmitEvent(event);
        });
      }
      if (elements.invoiceCreateFileInput) {
        elements.invoiceCreateFileInput.addEventListener("change", onInvoiceCreateDocumentFileChange);
      }
      if (elements.invoiceCreateFileChoose) {
        elements.invoiceCreateFileChoose.addEventListener("click", function () {
          if (!state.isLoading && !submitInProgress) { elements.invoiceCreateFileInput.click(); }
        });
      }
      if (elements.invoiceCreateFileDropZone) {
        var dropZone = elements.invoiceCreateFileDropZone;
        var dragDepth = 0;
        function hasDraggedFiles(event) {
          return event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], "Files") !== -1;
        }
        dropZone.addEventListener("dragenter", function (event) {
          if (!hasDraggedFiles(event)) { return; }
          event.preventDefault();
          dragDepth += 1;
          dropZone.classList.toggle("is-dragging-file", !state.isLoading && !submitInProgress);
        });
        dropZone.addEventListener("dragover", function (event) {
          if (!hasDraggedFiles(event)) { return; }
          event.preventDefault();
          event.dataTransfer.dropEffect = state.isLoading || submitInProgress ? "none" : "copy";
        });
        dropZone.addEventListener("dragleave", function () {
          dragDepth = Math.max(0, dragDepth - 1);
          if (!dragDepth) { dropZone.classList.remove("is-dragging-file"); }
        });
        dropZone.addEventListener("drop", function (event) {
          event.preventDefault();
          dragDepth = 0;
          dropZone.classList.remove("is-dragging-file");
          if (state.isLoading || submitInProgress) { return; }
          var files = event.dataTransfer && event.dataTransfer.files;
          if (!files || !files.length) { return; }
          if (files.length !== 1) {
            showInvoiceCreateValidationError("Attach one invoice file at a time.", { invoiceFile: "Drop a single file here." });
            return;
          }
          elements.invoiceCreateFileInput.files = files;
          onInvoiceCreateDocumentFileChange();
        });
      }
      if (elements.invoiceCreateFileRemove) {
        elements.invoiceCreateFileRemove.addEventListener("click", function () {
          clearInvoiceCreateValidationState();
          clearInvoiceCreateDocumentFileSelection();
          renderAll();
        });
      }
      if (elements.invoiceCreatePrev) {
        elements.invoiceCreatePrev.addEventListener("click", onInvoiceCreatePreviousClick);
      }
      if (elements.invoiceCreateNext) {
        elements.invoiceCreateNext.addEventListener("click", onInvoiceCreateNextClick);
      }
      elements.invoiceCreateAmountGross.addEventListener("input", function () {
        clearInvoiceCreateValidationState();
        updateInvoiceCreateComputedAmounts("gross");
      });
      elements.invoiceCreateNumber.addEventListener("input", function () {
        invoiceNameDefault.reset();
        clearInvoiceCreateValidationState();
        elements.invoiceCreateNumber.setCustomValidity("");
        refreshInvoiceCreateActionState();
      });
      elements.invoiceCreateNumber.addEventListener("change", function () {
        clearInvoiceCreateValidationState();
        elements.invoiceCreateNumber.setCustomValidity("");
        if (!elements.invoiceCreateNumber.value.trim()) { updateInvoiceNameDefault(); }
        refreshInvoiceCreateActionState();
      });
      elements.invoiceCreateAmountNet.addEventListener("input", function () {
        clearInvoiceCreateValidationState();
        updateInvoiceCreateComputedAmounts("net");
      });
      elements.invoiceCreateVatPercent.addEventListener("input", function () {
        clearInvoiceCreateValidationState();
        elements.invoiceCreateVatPercent.dataset.userTouched = "true";
        clearInvoiceCreateVatReviewCheck();
        updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
      });
      if (elements.invoiceCreateAdditionalVatEnabled) {
        elements.invoiceCreateAdditionalVatEnabled.addEventListener("change", function () {
          clearInvoiceCreateValidationState();
          syncInvoiceCreateAdditionalVatVisibility();
          updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
        });
      }
      if (elements.invoiceCreateAdditionalVatPercent) {
        elements.invoiceCreateAdditionalVatPercent.addEventListener("input", function () {
          clearInvoiceCreateValidationState();
          clearInvoiceCreateAdditionalVatReviewCheck();
          updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
        });
      }
      if (elements.invoiceCreateAdditionalAmountExclVat) {
        elements.invoiceCreateAdditionalAmountExclVat.addEventListener("input", function () {
          clearInvoiceCreateValidationState();
          if (!isInvoiceCreateRefundMode()) { clearInvoiceCreateAdditionalIrpfReviewCheck(); }
          updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
        });
      }
      if (elements.invoiceCreateAdditionalIrpfPercent) {
        elements.invoiceCreateAdditionalIrpfPercent.addEventListener("input", function () {
          clearInvoiceCreateValidationState();
          clearInvoiceCreateAdditionalIrpfReviewCheck();
          updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
        });
      }
      if (elements.invoiceCreateAdditionalIrpfAmount) {
        elements.invoiceCreateAdditionalIrpfAmount.addEventListener("input", function () {
          clearInvoiceCreateValidationState();
          updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
          confirmInvoiceCreateIrpfSelfEmployment();
        });
      }
      elements.invoiceCreateIrpfPercent.addEventListener("input", function () {
        clearInvoiceCreateValidationState();
        elements.invoiceCreateIrpfPercent.dataset.userTouched = "true";
        clearInvoiceCreateIrpfReviewCheck();
        updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
        confirmInvoiceCreateIrpfSelfEmployment();
      });
      if (elements.invoiceCreateIrpfConfirmationYes) {
        elements.invoiceCreateIrpfConfirmationYes.addEventListener("click", function () {
          resolveInvoiceCreateIrpfSelfEmploymentConfirmation(true);
        });
      }
      if (elements.invoiceCreateIrpfConfirmationNo) {
        elements.invoiceCreateIrpfConfirmationNo.addEventListener("click", function () {
          resolveInvoiceCreateIrpfSelfEmploymentConfirmation(false);
        });
      }
      elements.invoiceCreateReimbursableExpense.addEventListener("input", function () {
        clearInvoiceCreateValidationState();
        updateInvoiceCreateComputedAmounts(state.invoiceCreation.lastEditedAmountMode || "gross");
      });
      elements.invoiceCreateDate.addEventListener("input", function () {
        clearInvoiceCreateValidationState();
        refreshInvoiceCreateActionState();
      });
      elements.invoiceCreateDate.addEventListener("change", function () {
        clearInvoiceCreateValidationState();
        refreshInvoiceCreateActionState();
      });
      elements.invoiceCreateType.addEventListener("change", function () {
        updateInvoiceDateDefault(true);
        renderInvoiceCreateDocumentFilePreview();
        renderInvoiceCreateTypeColors();
        updateInvoiceNameDefault();
        clearInvoiceCreateValidationState();
        refreshInvoiceCreateActionState();
      });
      if (elements.invoiceCreateVatReviewed) {
        elements.invoiceCreateVatReviewed.addEventListener("change", clearInvoiceCreateValidationState);
      }
      if (elements.invoiceCreateAdditionalVatReviewed) {
        elements.invoiceCreateAdditionalVatReviewed.addEventListener("change", clearInvoiceCreateValidationState);
      }
      if (elements.invoiceCreateAdditionalIrpfReviewed) {
        elements.invoiceCreateAdditionalIrpfReviewed.addEventListener("change", clearInvoiceCreateValidationState);
      }
      if (elements.invoiceCreateIrpfReviewed) {
        elements.invoiceCreateIrpfReviewed.addEventListener("change", clearInvoiceCreateValidationState);
      }
      if (elements.invoiceCreateStatus) {
        elements.invoiceCreateStatus.addEventListener("change", function () {
          renderInvoiceCreateStatusTone(elements.invoiceCreateStatus.value);
        });
      }

      global.document.addEventListener("click", onDocumentClickCloseInvoiceCreateSettlementStatusDropdown);
    }

    return {
      bindEvents: bindEvents,
      refreshActionState: refreshInvoiceCreateActionState,
      openPanel: openCreateInvoicePanel,
      refreshAfterCreate: refreshInvoicesAfterCreate,
      renderDocumentFilePreview: renderInvoiceCreateDocumentFilePreview,
      setLoading: setInvoiceCreateLoading,
      clearValidationState: clearInvoiceCreateValidationState,
      showValidationError: showInvoiceCreateValidationError,
      syncAdditionalVatVisibility: syncInvoiceCreateAdditionalVatVisibility,
      setDefaultStatus: setDefaultInvoiceCreateStatus,
      updateComputedAmounts: updateInvoiceCreateComputedAmounts,
      closePanel: closeCreateInvoicePanel,
      renderPanel: renderInvoiceCreatePanel,
      resetSettlementState: resetInvoiceCreateSettlementState,
      loadSettlementsForSupplier: loadSettlementsForSupplier,
      reloadSettlements: reloadInvoiceCreateSettlements,
      loadServicesForSettlement: loadServicesForSettlement,
      createInvoiceLinesForInvoice: createInvoiceLinesForInvoice,
      resetFormAfterCreate: resetInvoiceCreateFormAfterCreate,
      onSettlementInput: onInvoiceCreateSettlementInput,
      onSettlementTableClick: onInvoiceCreateSettlementTableClick,
      onSubmit: onCreateInvoiceSubmit,
      onSettlementRefreshClick: onInvoiceCreateSettlementRefreshClick,
      onSettlementStatusToggleClick: onInvoiceCreateSettlementStatusToggleClick,
      onSettlementStatusOptionChange: onInvoiceCreateSettlementStatusOptionChange,
      onSettlementStatusMenuActionClick: onInvoiceCreateSettlementStatusMenuActionClick,
      selectSettlement: selectInvoiceCreateSettlement,
      renderSettlementSummary: renderInvoiceCreateSettlementSummary
    };
  };
}(window));
