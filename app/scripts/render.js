(function (global) {
var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createRenderer = function (elements, state, helpers, fieldCandidates) {
    var MESSAGE_AUTO_DISMISS_DELAY = 5000;
    var MESSAGE_FADE_DURATION = 350;
    var noticeAutoDismissTimer = null;
    var errorAutoDismissTimer = null;

    function clearMessageAutoDismissTimer(type) {
      var timer = type === "error" ? errorAutoDismissTimer : noticeAutoDismissTimer;

      if (timer) {
        global.clearTimeout(timer);
      }

      if (type === "error") {
        errorAutoDismissTimer = null;
      } else {
        noticeAutoDismissTimer = null;
      }
    }

    function scheduleMessageAutoDismiss(type) {
      var element = type === "error" ? elements.error : elements.notice;
      var hideMessage = type === "error" ? hideError : hideNotice;

      if (!element) {
        return;
      }

      clearMessageAutoDismissTimer(type);
      var fadeTimer = global.setTimeout(function () {
        element.classList.add("is-fading-out");
        if (type === "error") {
          errorAutoDismissTimer = global.setTimeout(hideMessage, MESSAGE_FADE_DURATION);
        } else {
          noticeAutoDismissTimer = global.setTimeout(hideMessage, MESSAGE_FADE_DURATION);
        }
      }, MESSAGE_AUTO_DISMISS_DELAY);

      if (type === "error") {
        errorAutoDismissTimer = fadeTimer;
      } else {
        noticeAutoDismissTimer = fadeTimer;
      }
    }

    function hideNotice() {
      if (!elements.notice) {
        return;
      }

      clearMessageAutoDismissTimer("notice");
      elements.notice.hidden = true;
      elements.notice.classList.remove("is-loading", "is-fading-out");
      elements.notice.removeAttribute("aria-busy");
      if (elements.noticeText) {
        elements.noticeText.textContent = "";
      }
    }

    function hideError() {
      if (!elements.error) {
        return;
      }

      clearMessageAutoDismissTimer("error");
      elements.error.hidden = true;
      elements.error.classList.remove("is-fading-out");
      if (elements.errorText) {
        elements.errorText.textContent = "";
      }
    }

    function setLoading(isLoading, label) {
      state.isLoading = isLoading;
      if (elements.loadingPill) {
        elements.loadingPill.hidden = !isLoading;
        elements.loadingPill.textContent = label || "Loading...";
      }
      if (isLoading && label) {
        showNotice(label, {
          isLoading: true
        });
      } else if (!isLoading && elements.notice) {
        elements.notice.classList.remove("is-loading");
        elements.notice.removeAttribute("aria-busy");
        if (!elements.notice.hidden && elements.noticeText && elements.noticeText.textContent) {
          scheduleMessageAutoDismiss("notice");
        }
      }
      refreshActionState();
    }

    function refreshActionState() {
      var ezusReference = state.supplier ? helpers.getCandidateValue(state.supplier, fieldCandidates.supplier.ezusReference) : "";
      var hasSelectedInvoice = Boolean(state.views && state.views.invoices && state.views.invoices.selectedDetailId);
      var isInvoiceDeletionBusy = Boolean(state.invoiceDeletion && state.invoiceDeletion.isBusy);
      var isInvoiceAccountingBusy = Boolean(state.invoiceAccounting && state.invoiceAccounting.isBusy);
      var hasSelectedPayment = Boolean(state.views && state.views.payments && state.views.payments.selectedId);
      var isPaymentAccountingBusy = Boolean(state.paymentAccounting && state.paymentAccounting.isBusy);
      var isPaymentLetterBusy = Boolean(state.paymentLetter && state.paymentLetter.isBusy);

      if (elements.dashboardRefresh) {
        elements.dashboardRefresh.disabled = state.isLoading;
      }
      elements.loadSupplier.disabled = state.isLoading;
      elements.createInvoiceFromSupplier.disabled = state.isLoading || !state.supplierId;
      if (elements.createRefundFromSupplier) {
        elements.createRefundFromSupplier.disabled = state.isLoading || !state.supplierId;
      }
      if (elements.syncSupplierWithEzus) {
        elements.syncSupplierWithEzus.disabled = state.isLoading || !state.supplierId;
      }
      if (elements.seeSupplierInCrm) {
        elements.seeSupplierInCrm.disabled = state.isLoading || !state.supplierId;
      }
      if (elements.seeSupplierInEzus) {
        elements.seeSupplierInEzus.disabled = state.isLoading || !state.supplierId || !ezusReference;
      }
      if (elements.closeSupplierWorkspace) {
        elements.closeSupplierWorkspace.disabled = state.isLoading || !state.supplierId;
      }
      if (elements.invoicesRefresh) {
        elements.invoicesRefresh.hidden = true;
      }
      if (elements.invoicesLoad) {
        elements.invoicesLoad.disabled = state.isLoading;
        elements.invoicesLoad.textContent = state.currentTab === "invoices" && state.isLoading ? "Loading..." : "Load";
      }
      if (elements.invoicesShowAttachments) {
        elements.invoicesShowAttachments.disabled = state.isLoading;
      }
      if (elements.bookingsLoad) {
        elements.bookingsLoad.disabled = state.isLoading;
      }
      if (elements.selectedInvoiceEdit) {
        elements.selectedInvoiceEdit.disabled = state.isLoading || isInvoiceDeletionBusy || !hasSelectedInvoice;
      }
      if (elements.selectedInvoiceDelete) {
        elements.selectedInvoiceDelete.disabled = state.isLoading || isInvoiceDeletionBusy || !hasSelectedInvoice;
      }
      if (elements.selectedInvoiceSyncAccounting) {
        elements.selectedInvoiceSyncAccounting.disabled = state.isLoading || isInvoiceDeletionBusy || isInvoiceAccountingBusy || !hasSelectedInvoice;
        elements.selectedInvoiceSyncAccounting.textContent = isInvoiceAccountingBusy && state.invoiceAccounting.action === "sync"
          ? "Syncing..."
          : "Sync entry";
      }
      if (elements.selectedInvoiceRebuildAccountingTotals) {
        elements.selectedInvoiceRebuildAccountingTotals.disabled = state.isLoading || isInvoiceDeletionBusy || isInvoiceAccountingBusy || !hasSelectedInvoice;
        elements.selectedInvoiceRebuildAccountingTotals.textContent = isInvoiceAccountingBusy && state.invoiceAccounting.action === "rebuild"
          ? "Rebuilding..."
          : "Rebuild totals";
      }
      if (elements.selectedInvoiceDeleteUpdateSettlement) {
        elements.selectedInvoiceDeleteUpdateSettlement.disabled = state.isLoading || isInvoiceDeletionBusy || !hasSelectedInvoice;
      }
      if (elements.selectedInvoiceDeleteConfirm) {
        elements.selectedInvoiceDeleteConfirm.disabled = state.isLoading || isInvoiceDeletionBusy || !hasSelectedInvoice;
      }
      if (elements.selectedInvoiceDeleteCancel) {
        elements.selectedInvoiceDeleteCancel.disabled = state.isLoading || isInvoiceDeletionBusy || !hasSelectedInvoice;
      }
      if (elements.paymentsLoad) {
        elements.paymentsLoad.disabled = state.isLoading;
        elements.paymentsLoad.textContent = state.currentTab === "payments" && state.isLoading ? "Loading..." : "Load";
      }
      if (elements.paymentsRefresh) {
        elements.paymentsRefresh.hidden = true;
      }
      if (elements.paymentAccountsRefresh) {
        elements.paymentAccountsRefresh.disabled = state.isLoading;
      }
      if (elements.accountingEntriesLoad) {
        elements.accountingEntriesLoad.disabled = state.isLoading;
        elements.accountingEntriesLoad.textContent = state.currentTab === "accounting" && state.accountingTab === "entries" && state.isLoading ? "Loading..." : "Load";
      }
      if (elements.accountingEntryLinesLoad) {
        elements.accountingEntryLinesLoad.disabled = state.isLoading;
        elements.accountingEntryLinesLoad.textContent = state.currentTab === "accounting" && state.accountingTab === "lines" && state.isLoading ? "Loading..." : "Load";
      }
      if (elements.accountingEntryLinesExportContasol) {
        elements.accountingEntryLinesExportContasol.disabled = state.isLoading || !state.views.accountingEntryLines.hasLoaded || !state.records.accountingEntryLines.length;
      }
      if (elements.accountingAccountsRefresh) {
        elements.accountingAccountsRefresh.disabled = state.isLoading;
      }
      if (elements.accountingRulesRefresh) {
        elements.accountingRulesRefresh.disabled = state.isLoading;
      }
      if (elements.accountingAccountCreateOpen) {
        elements.accountingAccountCreateOpen.disabled = state.isLoading;
      }
      if (elements.accountingRuleCreateOpen) {
        elements.accountingRuleCreateOpen.disabled = state.isLoading;
      }
      if (elements.paymentAccountCreateOpen) {
        elements.paymentAccountCreateOpen.disabled = state.isLoading;
      }
      if (elements.selectedPaymentEdit) {
        elements.selectedPaymentEdit.disabled = state.isLoading || isPaymentLetterBusy || isPaymentAccountingBusy || !hasSelectedPayment;
      }
      if (elements.selectedPaymentDelete) {
        elements.selectedPaymentDelete.disabled = state.isLoading || isPaymentLetterBusy || isPaymentAccountingBusy || !hasSelectedPayment;
      }
      if (elements.selectedPaymentSyncAccounting) {
        elements.selectedPaymentSyncAccounting.disabled = state.isLoading || isPaymentLetterBusy || isPaymentAccountingBusy || !hasSelectedPayment;
        elements.selectedPaymentSyncAccounting.textContent = isPaymentAccountingBusy && state.paymentAccounting.action === "sync"
          ? "Syncing..."
          : "Sync entry";
      }
      if (elements.selectedPaymentRebuildAccountingTotals) {
        elements.selectedPaymentRebuildAccountingTotals.disabled = state.isLoading || isPaymentLetterBusy || isPaymentAccountingBusy || !hasSelectedPayment;
        elements.selectedPaymentRebuildAccountingTotals.textContent = isPaymentAccountingBusy && state.paymentAccounting.action === "rebuild"
          ? "Rebuilding..."
          : "Rebuild totals";
      }
      if (elements.selectedPaymentExportBank) {
        elements.selectedPaymentExportBank.disabled = state.isLoading || isPaymentLetterBusy || isPaymentAccountingBusy || !hasSelectedPayment;
      }
      if (elements.selectedPaymentExportBankInvoices) {
        elements.selectedPaymentExportBankInvoices.disabled = state.isLoading || isPaymentLetterBusy || isPaymentAccountingBusy || !hasSelectedPayment;
      }
      if (elements.selectedPaymentSendLetter) {
        elements.selectedPaymentSendLetter.disabled = state.isLoading || isPaymentLetterBusy || isPaymentAccountingBusy || !hasSelectedPayment;
      }
      if (elements.selectedPaymentAccountEdit) {
        elements.selectedPaymentAccountEdit.disabled = state.isLoading;
      }
    }

    function showNotice(message, options) {
      var isLoading = Boolean(options && options.isLoading);
      var tone = options && options.tone === "success" ? "success" : "neutral";
      var persistent = Boolean(options && options.persistent);

      if (message) {
        hideError();
      }

      if (elements.noticeText) {
        elements.noticeText.textContent = message || "";
      }
      elements.notice.hidden = !message;
      elements.notice.classList.remove("info", "neutral", "success", "is-fading-out");
      elements.notice.classList.add(tone);
      elements.notice.classList.toggle("is-loading", Boolean(message) && isLoading);
      if (message && isLoading) {
        elements.notice.setAttribute("aria-busy", "true");
      } else {
        elements.notice.removeAttribute("aria-busy");
      }

      if (message && !isLoading && !persistent) {
        scheduleMessageAutoDismiss("notice");
      } else {
        clearMessageAutoDismissTimer("notice");
      }
    }

    function showError(message) {
      if (message) {
        hideNotice();
      }

      if (elements.errorText) {
        elements.errorText.textContent = message || "";
      }
      elements.error.hidden = !message;
      elements.error.classList.remove("is-fading-out");
      if (message) {
        scheduleMessageAutoDismiss("error");
      } else {
        clearMessageAutoDismissTimer("error");
      }
    }

    function setTextWithTitle(element, value) {
      var text = helpers.textValue(value);

      if (!element) {
        return;
      }

      element.textContent = text;
      element.title = text && text !== "-" ? text : "";
    }

    function formatSupplierDetailValue(value, multiline) {
      var text = helpers.textValue(value);

      if (!multiline || text === "-") {
        return helpers.escapeHtml(text);
      }

      return helpers.escapeHtml(text).replace(/\r?\n/g, "<br>");
    }

    function buildSupplierDetailCard(label, value, options) {
      var settings = options || {};
      var cardClassName = "supplier-fact supplier-detail-card" + (settings.wide ? " supplier-detail-card-wide" : "");
      var valueMarkup;
      var href;

      if (settings.accountingStatus) {
        valueMarkup = '<dd class="supplier-detail-value supplier-detail-value-rich"><span class="accounting-status ' +
          (value ? "present" : "missing") + '">' +
          helpers.escapeHtml(value ? helpers.textValue(value) : "Missing") +
          "</span></dd>";
      } else if (settings.link && value && value !== "-") {
        href = /^https?:\/\//i.test(String(value)) ? String(value) : "https://" + String(value);
        valueMarkup = '<dd class="supplier-detail-value supplier-detail-value-rich"><a class="supplier-inline-link" href="' +
          helpers.escapeHtml(href) + '" target="_blank" rel="noopener">' +
          helpers.escapeHtml(String(value)) +
          "</a></dd>";
      } else {
        valueMarkup = '<dd class="supplier-detail-value' + (settings.multiline ? " supplier-detail-value-multiline" : "") + '">' +
          formatSupplierDetailValue(value, settings.multiline) +
          "</dd>";
      }

      return [
        '<div class="' + cardClassName + '">',
        "  <dt>" + helpers.escapeHtml(label) + "</dt>",
        "  " + valueMarkup,
        "</div>"
      ].join("");
    }

    function buildSupplierDetailGrid(items) {
      return '<dl class="supplier-facts-grid supplier-detail-grid">' + items.join("") + "</dl>";
    }

    function buildSupplierInfoBlock(title, items, options) {
      var settings = options || {};
      var descriptionMarkup = settings.description
        ? '<p class="supplier-info-block-copy">' + helpers.escapeHtml(settings.description) + "</p>"
        : "";
      var bodyClassName = "supplier-detail-grid" + (settings.compact ? " supplier-detail-grid-compact" : "");

      return [
        '<section class="supplier-info-block' + (settings.emphasis ? " supplier-info-block-emphasis" : "") + '">',
        '  <div class="supplier-info-block-header">',
        '    <h3 class="supplier-info-section-title">' + helpers.escapeHtml(title) + "</h3>",
        "    " + descriptionMarkup,
        "  </div>",
        '  <dl class="supplier-facts-grid ' + bodyClassName + '">' + items.join("") + "</dl>",
        "</section>"
      ].join("");
    }

    function buildSupplierInfoPanels(items, className) {
      return '<div class="supplier-info-panels' + (className ? " " + className : "") + '">' + items.join("") + "</div>";
    }

    function formatSupplierBooleanValue(value) {
      var normalized;

      if (value === null || value === undefined || value === "") {
        return "-";
      }

      if (typeof value === "boolean") {
        return helpers.booleanLabel(value);
      }

      normalized = String(value).trim().toLowerCase();

      if (normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1") {
        return "Yes";
      }

      if (normalized === "false" || normalized === "no" || normalized === "n" || normalized === "0") {
        return "No";
      }

      return helpers.textValue(value);
    }

    function buildSupplierInfoBasic(supplier) {
      return buildSupplierInfoPanels([
        buildSupplierInfoBlock("Overview", [
          buildSupplierDetailCard("Supplier", helpers.getCandidateValue(supplier, fieldCandidates.supplier.name)),
          buildSupplierDetailCard("Vendor Type", helpers.getCandidateValue(supplier, fieldCandidates.supplier.vendorType)),
          buildSupplierDetailCard("Connection Reference", helpers.getCandidateValue(supplier, fieldCandidates.supplier.connectionReference)),
          buildSupplierDetailCard("Ezus Identifier", helpers.getCandidateValue(supplier, fieldCandidates.supplier.ezusReference))
        ], {
          compact: true
        }),
        buildSupplierInfoBlock("Classification & coverage", [
          buildSupplierDetailCard("Category", helpers.getCandidateValue(supplier, fieldCandidates.supplier.category)),
          buildSupplierDetailCard("Subcategory", helpers.getCandidateValue(supplier, fieldCandidates.supplier.subcategory)),
          buildSupplierDetailCard("Destination", helpers.getCandidateValue(supplier, fieldCandidates.supplier.destination)),
          buildSupplierDetailCard("Subdestination", helpers.getCandidateValue(supplier, fieldCandidates.supplier.subdestination))
        ], {
          compact: true
        })
      ]);
    }

    function buildSupplierInfoFinancial(supplier) {
      return buildSupplierInfoPanels([
        buildSupplierInfoBlock("Financial setup", [
          buildSupplierDetailCard("Accounting account", helpers.getCandidateValue(supplier, fieldCandidates.supplier.accounting), {
            accountingStatus: true
          }),
          buildSupplierDetailCard("Account number", helpers.getCandidateValue(supplier, fieldCandidates.supplier.accountNumber)),
          buildSupplierDetailCard("CIF / NIF", helpers.getCandidateValue(supplier, fieldCandidates.supplier.cifNif)),
          buildSupplierDetailCard("Is Self Employed", formatSupplierBooleanValue(
            helpers.getCandidateValue(supplier, fieldCandidates.supplier.selfEmployed)
          ))
        ], {
          compact: true,
          emphasis: true
        }),
        buildSupplierInfoBlock("Defaults", [
          buildSupplierDetailCard("Default accounting account", helpers.getCandidateValue(supplier, fieldCandidates.supplier.defaultAccountingAccount)),
          buildSupplierDetailCard("Default accounting rule", helpers.getCandidateValue(supplier, fieldCandidates.supplier.defaultAccountingRule))
        ], {
          compact: true
        })
      ]);
    }

    function buildSupplierInfoPayment(supplier) {
      return buildSupplierInfoPanels([
        buildSupplierInfoBlock("Payment setup", [
          buildSupplierDetailCard("Payment Method", helpers.getCandidateValue(supplier, fieldCandidates.supplier.paymentMethod)),
          buildSupplierDetailCard("Payment Conditions", helpers.getCandidateValue(supplier, fieldCandidates.supplier.paymentConditions), {
            multiline: true,
            wide: true
          }),
          buildSupplierDetailCard("Cancellation Policy", helpers.getCandidateValue(supplier, fieldCandidates.supplier.cancellationPolicy), {
            multiline: true,
            wide: true
          })
        ], {
          compact: true
        }),
        buildSupplierInfoBlock("Commission", [
          buildSupplierDetailCard("Commission Status", helpers.getCandidateValue(supplier, fieldCandidates.supplier.commissionStatus)),
          buildSupplierDetailCard("Commission Amount", helpers.getCandidateValue(supplier, fieldCandidates.supplier.commissionAmount)),
          buildSupplierDetailCard("Commission Notes", helpers.getCandidateValue(supplier, fieldCandidates.supplier.commissionNotes), {
            multiline: true,
            wide: true
          })
        ], {
          compact: true
        })
      ]);
    }

    function buildSupplierInfoAddress(supplier) {
      return buildSupplierInfoPanels([
        buildSupplierInfoBlock("Physical Address", [
          buildSupplierDetailCard("Address", helpers.getCandidateValue(supplier, fieldCandidates.supplier.address), {
            multiline: true,
            wide: true
          }),
          buildSupplierDetailCard("City/Town", helpers.getCandidateValue(supplier, fieldCandidates.supplier.cityTown)),
          buildSupplierDetailCard("Analysis City", helpers.getCandidateValue(supplier, fieldCandidates.supplier.analysisCity)),
          buildSupplierDetailCard("Country", helpers.getCandidateValue(supplier, fieldCandidates.supplier.country)),
          buildSupplierDetailCard("Zip Code", helpers.getCandidateValue(supplier, fieldCandidates.supplier.zipCode)),
          buildSupplierDetailCard("Website", helpers.getCandidateValue(supplier, fieldCandidates.supplier.website), {
            link: true
          })
        ], {
          compact: true,
          description: "Operational and destination-related details."
        }).replace('class="supplier-info-block', 'class="supplier-info-block supplier-address-card supplier-address-card-physical'),
        buildSupplierInfoBlock("Billing Address", [
          buildSupplierDetailCard("Mailing Address", helpers.getCandidateValue(supplier, fieldCandidates.supplier.mailingAddress), {
            multiline: true,
            wide: true
          }),
          buildSupplierDetailCard("City", helpers.getCandidateValue(supplier, fieldCandidates.supplier.mailingCity)),
          buildSupplierDetailCard("Post Code", helpers.getCandidateValue(supplier, fieldCandidates.supplier.postCode)),
          buildSupplierDetailCard("Mailing Country", helpers.getCandidateValue(supplier, fieldCandidates.supplier.mailingCountry))
        ], {
          compact: true,
          description: "Tax and mailing information used for invoicing."
        }).replace('class="supplier-info-block', 'class="supplier-info-block supplier-address-card supplier-address-card-billing')
      ], "supplier-address-panels");
    }

    function buildSupplierInfoContent(supplier) {
      if (state.supplierInfoTab === "financial") {
        return buildSupplierInfoFinancial(supplier);
      }

      if (state.supplierInfoTab === "payment") {
        return buildSupplierInfoPayment(supplier);
      }

      if (state.supplierInfoTab === "address") {
        return buildSupplierInfoAddress(supplier);
      }

      return buildSupplierInfoBasic(supplier);
    }

    function setMode(text) {
      if (elements.modeBadge) {
        elements.modeBadge.textContent = text;
      }
    }

    function renderSupplierOptions() {
      elements.supplierOptions.innerHTML = state.recentSuppliers.map(function (supplier) {
        return '<option value="' + helpers.escapeHtml(helpers.buildSupplierLabel(supplier, fieldCandidates)) + '"></option>';
      }).join("");
    }

    function renderDashboard(view) {
      var alias = state.welcome && state.welcome.alias ? String(state.welcome.alias).trim() : "";
      var isWelcomeLoading = Boolean(state.welcome && state.welcome.isLoading);

      if (elements.welcomeHeading) {
        elements.welcomeHeading.textContent = isWelcomeLoading
          ? "Loading workspace..."
          : alias ? "Hello, " + alias + "!" : "Hello!";
        return;
      }

      setTextWithTitle(elements.dashboardStatSuppliers, String(view.supplierTotals.count));
      setTextWithTitle(elements.dashboardStatOpenAmount, helpers.formatCurrency(view.supplierTotals.amount));
      setTextWithTitle(elements.dashboardStatTripsReady, String(view.tripTotals.readyCount));
      setTextWithTitle(elements.dashboardStatReadyAmount, helpers.formatCurrency(view.tripTotals.readyAmount));
      setTextWithTitle(elements.dashboardStatTripsToInvoice, String(view.tripTotals.toInvoiceCount));
      setTextWithTitle(elements.dashboardStatToInvoiceAmount, helpers.formatCurrency(view.tripTotals.toInvoiceAmount));
      elements.dashboardSuppliersCount.textContent = view.pendingSuppliers.length + (view.pendingSuppliers.length === 1 ? " supplier" : " suppliers");
      elements.dashboardTripsCount.textContent = view.pendingTrips.length + (view.pendingTrips.length === 1 ? " trip" : " trips");

      if (!view.pendingSuppliers.length) {
        elements.dashboardSuppliersEmpty.textContent = view.suppliersEmptyMessage;
        elements.dashboardSuppliersEmpty.hidden = false;
        elements.dashboardSuppliersTableWrap.hidden = true;
        elements.dashboardSuppliersTableBody.innerHTML = "";
      } else {
        elements.dashboardSuppliersTableBody.innerHTML = view.pendingSuppliers.map(function (row) {
          var actionMarkup = row.supplierId
            ? '<button class="button secondary compact-action-button" type="button" data-dashboard-supplier-id="' + helpers.escapeHtml(row.supplierId) + '">Open supplier</button>'
            : '<span class="table-inline-secondary">Unavailable</span>';

          return [
            "<tr>",
            "  <td>" + helpers.escapeHtml(row.supplierName) + "</td>",
            '  <td class="numeric-cell">' + helpers.escapeHtml(String(row.openInvoicesCount)) + "</td>",
            '  <td class="numeric-cell">' + helpers.escapeHtml(String(row.tripCount)) + "</td>",
            "  <td>" + helpers.escapeHtml(helpers.formatDate(row.oldestInvoiceDate)) + "</td>",
            '  <td class="numeric-cell"><strong>' + helpers.escapeHtml(helpers.formatCurrency(row.pendingAmount)) + "</strong></td>",
            "  <td>" + actionMarkup + "</td>",
            "</tr>"
          ].join("");
        }).join("");
        elements.dashboardSuppliersEmpty.hidden = true;
        elements.dashboardSuppliersTableWrap.hidden = false;
      }

      if (!view.pendingTrips.length) {
        elements.dashboardTripsEmpty.textContent = view.tripsEmptyMessage;
        elements.dashboardTripsEmpty.hidden = false;
        elements.dashboardTripsTableWrap.hidden = true;
        elements.dashboardTripsTableBody.innerHTML = "";
      } else {
        elements.dashboardTripsTableBody.innerHTML = view.pendingTrips.map(function (row) {
          var actionMarkup = row.supplierId
            ? '<button class="button secondary compact-action-button" type="button" data-dashboard-supplier-id="' + helpers.escapeHtml(row.supplierId) + '">Open supplier</button>'
            : '<span class="table-inline-secondary">Unavailable</span>';

          return [
            "<tr>",
            "  <td>" + helpers.escapeHtml(row.settlementName) + "</td>",
            "  <td>" + helpers.escapeHtml(row.mfsp || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(row.bookingName || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(row.supplierName) + "</td>",
            '  <td><span class="status-pill ' + helpers.escapeHtml(helpers.getStatusTone(row.adminStatus)) + '">' + helpers.escapeHtml(row.adminStatus) + "</span></td>",
            "  <td>" + helpers.escapeHtml(helpers.formatDate(row.firstServiceDate)) + "</td>",
            '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(row.remainingToInvoice)) + "</td>",
            '  <td class="numeric-cell"><strong>' + helpers.escapeHtml(helpers.formatCurrency(row.remainingToPay)) + "</strong></td>",
            "  <td>" + actionMarkup + "</td>",
            "</tr>"
          ].join("");
        }).join("");
        elements.dashboardTripsEmpty.hidden = true;
        elements.dashboardTripsTableWrap.hidden = false;
      }
    }

    function renderTabs() {
      var isSuppliersTab = state.currentTab === "suppliers";
      var activeMainTab = state.currentTab === "paymentAccounts" ? "payments" : state.currentTab;

      elements.tabButtons.forEach(function (button) {
        var tabName = button.getAttribute("data-tab-button");
        button.classList.toggle("is-active", tabName === activeMainTab);
      });

      elements.tabPanels.forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-tab-panel") !== activeMainTab;
      });

      if (elements.searchPanel) {
        elements.searchPanel.hidden = !isSuppliersTab;
      }

      if (!isSuppliersTab) {
        elements.searchResultsCard.hidden = true;
      }
    }

    var paymentsRenderer = ns.createPaymentsRenderer({
      elements: elements,
      state: state,
      helpers: helpers,
      fieldCandidates: fieldCandidates,
      setTextWithTitle: setTextWithTitle,
      renderSimpleSelect: renderSimpleSelect
    });
    var invoicesRenderer = ns.createInvoicesRenderer({
      elements: elements,
      state: state,
      helpers: helpers,
      fieldCandidates: fieldCandidates,
      setTextWithTitle: setTextWithTitle,
      stripSortIndicator: stripSortIndicator,
      getSortIndicator: getSortIndicator
    });
    var accountingRenderer = ns.createAccountingRenderer({
      elements: elements,
      state: state,
      helpers: helpers,
      fieldCandidates: fieldCandidates,
      bindSortableHeaders: bindSortableHeaders
    });

    function renderPaymentsWorkspaceSections(activeSection) {
      paymentsRenderer.renderPaymentsWorkspaceSections(activeSection);
    }

    if (elements.noticeDismiss) {
      elements.noticeDismiss.addEventListener("click", hideNotice);
    }

    if (elements.errorDismiss) {
      elements.errorDismiss.addEventListener("click", hideError);
    }

    function hideSearchResults() {
      elements.searchResultsCard.hidden = true;
      elements.searchResultsCount.textContent = "0 matches";
      elements.searchResultsBody.innerHTML = '<tr><td colspan="3" class="table-empty">No suppliers found.</td></tr>';
    }

    function showSupplierSearchEmpty() {
      elements.searchResultsCard.hidden = false;
      elements.searchResultsCount.textContent = "0 matches";
      elements.searchResultsBody.innerHTML = '<tr><td colspan="3" class="table-empty">No suppliers found. Try another name or reference.</td></tr>';
    }

    function renderSearchResults(records, onSelected) {
      if (!records || !records.length) {
        hideSearchResults();
        return;
      }

      elements.searchResultsCard.hidden = false;
      elements.searchResultsCount.textContent = records.length + (records.length === 1 ? " match" : " matches");
      elements.searchResultsBody.innerHTML = records.map(function (record) {
        return [
          '<tr class="is-clickable" data-supplier-id="' + helpers.escapeHtml(record.id) + '">',
          "  <td>" + helpers.escapeHtml(helpers.getCandidateValue(record, fieldCandidates.supplier.name) || "-") + "</td>",
          "  <td>" + helpers.escapeHtml(helpers.getCandidateValue(record, fieldCandidates.supplier.connectionReference) || "-") + "</td>",
          "  <td>" + helpers.escapeHtml(helpers.getCandidateValue(record, fieldCandidates.supplier.ezusReference) || "-") + "</td>",
          "</tr>"
        ].join("");
      }).join("");

      Array.prototype.forEach.call(elements.searchResultsBody.querySelectorAll("tr[data-supplier-id]"), function (row) {
        row.addEventListener("click", function () {
          var supplierId = row.getAttribute("data-supplier-id");
          var match = records.find(function (record) {
            return record.id === supplierId;
          });

          if (match) {
            onSelected(match);
          }
        });
      });
    }

    function renderSupplierContext() {
      var supplier = state.supplier;
      var supplierName;
      var connectionReference;
      var ezusReference;
      var lastEzusSyncAt;
      var lastEzusSyncBy;

      function formatSyncDate(value) {
        var parsedDate;

        if (!value) {
          return "-";
        }

        parsedDate = new Date(value);
        if (Number.isNaN(parsedDate.getTime())) {
          return helpers.textValue(value);
        }

        return parsedDate.toLocaleString(undefined, {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
      }

      if (!supplier) {
        if (elements.supplierChip) {
          elements.supplierChip.textContent = "No supplier selected";
          elements.supplierChip.title = "";
        }
        if (elements.supplierWorkspaceMain) {
          elements.supplierWorkspaceMain.classList.add("is-empty");
        }
        elements.supplierInfoEmpty.hidden = false;
        elements.supplierInfoContentShell.hidden = true;
        elements.supplierInfoContent.innerHTML = "";
        if (elements.supplierActivityPanel) {
          elements.supplierActivityPanel.hidden = true;
        }
        if (elements.supplierRailActions) {
          elements.supplierRailActions.hidden = true;
        }
        if (elements.supplierEzusSyncStrip) {
          elements.supplierEzusSyncStrip.hidden = true;
        }
        elements.createInvoiceFromSupplier.hidden = true;
        if (elements.createRefundFromSupplier) {
          elements.createRefundFromSupplier.hidden = true;
        }
        elements.seeSupplierInCrm.hidden = true;
        elements.seeSupplierInEzus.hidden = true;
        elements.closeSupplierWorkspace.hidden = true;
        elements.syncSupplierWithEzus.hidden = true;
        refreshActionState();
        return;
      }

      supplierName = helpers.getCandidateValue(supplier, fieldCandidates.supplier.name);
      connectionReference = helpers.getCandidateValue(supplier, fieldCandidates.supplier.connectionReference);
      ezusReference = helpers.getCandidateValue(supplier, fieldCandidates.supplier.ezusReference);
      lastEzusSyncAt = helpers.getCandidateValue(supplier, fieldCandidates.supplier.lastEzusSyncAt);
      lastEzusSyncBy = helpers.getCandidateValue(supplier, fieldCandidates.supplier.lastEzusSyncBy);
      if (elements.supplierChip) {
        elements.supplierChip.textContent = connectionReference
          ? helpers.textValue(supplierName) + " | " + helpers.textValue(connectionReference)
          : helpers.textValue(supplierName);
        elements.supplierChip.title = elements.supplierChip.textContent;
      }
      if (elements.supplierWorkspaceMain) {
        elements.supplierWorkspaceMain.classList.remove("is-empty");
      }
      elements.supplierInfoEmpty.hidden = true;
      elements.supplierInfoContentShell.hidden = false;
      elements.supplierInfoContent.innerHTML = buildSupplierInfoContent(supplier);
      if (elements.supplierActivityPanel) {
        elements.supplierActivityPanel.hidden = false;
      }
      if (elements.supplierHeaderName) {
        elements.supplierHeaderName.textContent = helpers.textValue(supplierName, "Unnamed supplier");
      }
      if (elements.supplierHeaderEzusStatus) {
        elements.supplierHeaderEzusStatus.textContent = ezusReference ? "Connected to Ezus" : "Not connected to Ezus";
        elements.supplierHeaderEzusStatus.classList.toggle("is-connected", Boolean(ezusReference));
      }
      if (elements.supplierHeaderConnectionReference) {
        elements.supplierHeaderConnectionReference.textContent = connectionReference || "";
        elements.supplierHeaderConnectionReference.hidden = !connectionReference;
      }
      if (elements.supplierRailActions) {
        elements.supplierRailActions.hidden = false;
      }
      if (elements.supplierEzusSyncStrip) {
        elements.supplierEzusSyncStrip.hidden = false;
      }
      if (elements.supplierLastEzusSyncAt) {
        elements.supplierLastEzusSyncAt.textContent = lastEzusSyncAt || lastEzusSyncBy
          ? "Last sync: " + formatSyncDate(lastEzusSyncAt) +
            (lastEzusSyncBy ? " · By " + helpers.textValue(lastEzusSyncBy) : "")
          : "Not synced yet";
      }
      if (elements.supplierLastEzusSyncBy) {
        elements.supplierLastEzusSyncBy.textContent = helpers.textValue(
          lastEzusSyncBy,
          "-"
        );
      }
      elements.createInvoiceFromSupplier.hidden = false;
      if (elements.createRefundFromSupplier) {
        elements.createRefundFromSupplier.hidden = false;
      }
      elements.seeSupplierInCrm.hidden = false;
      elements.seeSupplierInEzus.hidden = false;
      elements.closeSupplierWorkspace.hidden = false;
      elements.seeSupplierInCrm.title = "Open supplier in CRM";
      elements.seeSupplierInEzus.title = ezusReference ? "Open supplier in Ezus" : "This supplier does not have an Ezus Supplier API value.";
      elements.syncSupplierWithEzus.hidden = false;
      elements.supplierInfoTabBasic.classList.toggle("is-active", state.supplierInfoTab === "basic");
      elements.supplierInfoTabBasic.setAttribute("aria-selected", state.supplierInfoTab === "basic" ? "true" : "false");
      elements.supplierInfoTabFinancial.classList.toggle("is-active", state.supplierInfoTab === "financial");
      elements.supplierInfoTabFinancial.setAttribute("aria-selected", state.supplierInfoTab === "financial" ? "true" : "false");
      elements.supplierInfoTabPayment.classList.toggle("is-active", state.supplierInfoTab === "payment");
      elements.supplierInfoTabPayment.setAttribute("aria-selected", state.supplierInfoTab === "payment" ? "true" : "false");
      elements.supplierInfoTabAddress.classList.toggle("is-active", state.supplierInfoTab === "address");
      elements.supplierInfoTabAddress.setAttribute("aria-selected", state.supplierInfoTab === "address" ? "true" : "false");
      refreshActionState();
    }

    function renderSimpleSelect(selectElement, items, currentValue, emptyLabel) {
      var options = ['<option value="">' + helpers.escapeHtml(emptyLabel || "All") + "</option>"];

      (items || []).forEach(function (item) {
        options.push(
          '<option value="' + helpers.escapeHtml(item.value) + '"' +
          (String(item.value) === String(currentValue || "") ? " selected" : "") +
          ">" + helpers.escapeHtml(item.label) + "</option>"
        );
      });

      selectElement.innerHTML = options.join("");
    }

    function renderSupplierActivityStats(showingInvoices, invoices, payments) {
      var invoiceTotal = 0;
      var invoicePaid = 0;
      var invoicePending = 0;
      var paymentTotal = 0;
      var paymentAccounts = {};
      var latestPaymentDate = "";

      if (!elements.supplierActivityStats) {
        return;
      }

      if (!state.supplier) {
        elements.supplierActivityStats.hidden = true;
        return;
      }

      elements.supplierActivityStats.hidden = false;

      if (showingInvoices) {
        invoices.forEach(function (invoice) {
          invoiceTotal += Number(helpers.getInvoiceTotalAmount(invoice, fieldCandidates)) || 0;
          invoicePaid += Number(invoice.Amount_Paid) || 0;
          invoicePending += Number(helpers.getInvoicePendingAmount(invoice, fieldCandidates)) || 0;
        });

        elements.supplierActivityStat1Label.textContent = "Total invoices";
        elements.supplierActivityStat1Value.textContent = String(invoices.length);
        elements.supplierActivityStat2Label.textContent = "Total amount";
        elements.supplierActivityStat2Value.textContent = helpers.formatCurrency(invoiceTotal);
        elements.supplierActivityStat3Label.textContent = "Paid";
        elements.supplierActivityStat3Value.textContent = helpers.formatCurrency(invoicePaid);
        elements.supplierActivityStat4Label.textContent = "Pending";
        elements.supplierActivityStat4Value.textContent = helpers.formatCurrency(invoicePending);
        return;
      }

      payments.forEach(function (payment) {
        var paymentAccount = helpers.getLookupName(payment.Payment_Account);

        paymentTotal += Number(helpers.getPaymentAmount(payment, fieldCandidates)) || 0;
        if (paymentAccount) {
          paymentAccounts[paymentAccount] = true;
        }
        if (payment.Payment_Date && (!latestPaymentDate || payment.Payment_Date > latestPaymentDate)) {
          latestPaymentDate = payment.Payment_Date;
        }
      });

      elements.supplierActivityStat1Label.textContent = "Total payments";
      elements.supplierActivityStat1Value.textContent = String(payments.length);
      elements.supplierActivityStat2Label.textContent = "Total amount";
      elements.supplierActivityStat2Value.textContent = helpers.formatCurrency(paymentTotal);
      elements.supplierActivityStat3Label.textContent = "Payment accounts";
      elements.supplierActivityStat3Value.textContent = String(Object.keys(paymentAccounts).length);
      elements.supplierActivityStat4Label.textContent = "Latest payment";
      elements.supplierActivityStat4Value.textContent = latestPaymentDate ? helpers.formatDate(latestPaymentDate) : "-";
    }

    function compareSupplierActivityValues(left, right, direction) {
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

    function stripSortIndicator(label) {
      return String(label || "").replace(/\s+[\u25B2\u25BC]$/, "");
    }

    function getSortIndicator(direction) {
      return String.fromCharCode(direction === "asc" ? 9650 : 9660);
    }

    function bindSortableHeaders(container, selector, attributeName, labels, sort, onSortChange) {
      var sortKey = sort && sort.key ? sort.key : "";
      var sortDirection = sort && sort.direction ? sort.direction : "asc";

      if (!container || !onSortChange) {
        return;
      }

      Array.prototype.forEach.call(container.querySelectorAll(selector), function (header) {
        var displayKey = header.getAttribute(attributeName) || "";
        var displayLabel = labels[displayKey] || stripSortIndicator(header.textContent);
        var isActiveSort = displayKey === sortKey;

        header.textContent = displayLabel + (isActiveSort ? " " + getSortIndicator(sortDirection) : "");
        header.style.cursor = "pointer";
        header.onclick = function () {
          onSortChange(displayKey);
        };
      });
    }

    function renderSupplierRelatedActivity(invoiceRecords, paymentRecords, helpersApi) {
      var invoices = invoiceRecords || [];
      var payments = paymentRecords || [];
      var showingInvoices = state.supplierActivityTab !== "payments";
      var activeRecords = showingInvoices ? invoices : payments;
      var supplierInvoiceSort = state.supplierActivityInvoicesSort || { key: "date", direction: "desc" };
      var supplierInvoiceSortLabels = {
        invoice: "Invoice",
        status: "Status",
        date: "Date",
        booking: "Booking",
        total: "Total",
        paid: "Paid",
        pending: "Pending"
      };

      invoices = invoices.slice().sort(function (left, right) {
        if (supplierInvoiceSort.key === "invoice") {
          return compareSupplierActivityValues(
            helpers.getInvoiceDisplayNumber(left, fieldCandidates),
            helpers.getInvoiceDisplayNumber(right, fieldCandidates),
            supplierInvoiceSort.direction
          );
        }

        if (supplierInvoiceSort.key === "status") {
          return compareSupplierActivityValues(left.Status, right.Status, supplierInvoiceSort.direction);
        }

        if (supplierInvoiceSort.key === "booking") {
          return compareSupplierActivityValues(
            helpersApi && helpersApi.getInvoiceBooking ? helpersApi.getInvoiceBooking(left) : (helpers.getLookupDisplayValue(left, fieldCandidates.invoice.booking) || ""),
            helpersApi && helpersApi.getInvoiceBooking ? helpersApi.getInvoiceBooking(right) : (helpers.getLookupDisplayValue(right, fieldCandidates.invoice.booking) || ""),
            supplierInvoiceSort.direction
          );
        }

        if (supplierInvoiceSort.key === "total") {
          return compareSupplierActivityValues(
            helpers.getInvoiceTotalAmount(left, fieldCandidates),
            helpers.getInvoiceTotalAmount(right, fieldCandidates),
            supplierInvoiceSort.direction
          );
        }

        if (supplierInvoiceSort.key === "paid") {
          return compareSupplierActivityValues(
            Number(left.Amount_Paid) || 0,
            Number(right.Amount_Paid) || 0,
            supplierInvoiceSort.direction
          );
        }

        if (supplierInvoiceSort.key === "pending") {
          return compareSupplierActivityValues(
            helpers.getInvoicePendingAmount(left, fieldCandidates),
            helpers.getInvoicePendingAmount(right, fieldCandidates),
            supplierInvoiceSort.direction
          );
        }

        return compareSupplierActivityValues(
          Date.parse(left.Invoice_Date || "") || 0,
          Date.parse(right.Invoice_Date || "") || 0,
          supplierInvoiceSort.direction
        );
      });

      elements.supplierRelatedTabInvoices.classList.toggle("is-active", showingInvoices);
      elements.supplierRelatedTabInvoices.setAttribute("aria-selected", showingInvoices ? "true" : "false");
      elements.supplierRelatedTabPayments.classList.toggle("is-active", !showingInvoices);
      elements.supplierRelatedTabPayments.setAttribute("aria-selected", !showingInvoices ? "true" : "false");
      elements.supplierRelatedTabInvoices.textContent = "Invoices (" + invoices.length + ")";
      elements.supplierRelatedTabPayments.textContent = "Payments (" + payments.length + ")";
      elements.supplierActivityCount.textContent = activeRecords.length +
        (showingInvoices
          ? (activeRecords.length === 1 ? " invoice" : " invoices")
          : (activeRecords.length === 1 ? " payment" : " payments"));

      if (elements.supplierExportInvoices) {
        elements.supplierExportInvoices.hidden = !showingInvoices;
        elements.supplierExportInvoices.disabled = !state.supplier || invoices.length === 0;
      }

      if (elements.supplierExportPayments) {
        elements.supplierExportPayments.hidden = showingInvoices;
        elements.supplierExportPayments.disabled = !state.supplier || payments.length === 0;
      }

      renderSupplierActivityStats(showingInvoices, invoices, payments);

      if (!state.supplier) {
        elements.supplierInvoicesEmpty.textContent = "Search a supplier to load its related invoices.";
        elements.supplierPaymentsEmpty.textContent = "Search a supplier to load its related payments.";
        elements.supplierInvoicesEmpty.hidden = !showingInvoices;
        elements.supplierPaymentsEmpty.hidden = showingInvoices;
        elements.supplierInvoicesTableWrap.hidden = true;
        elements.supplierPaymentsTableWrap.hidden = true;
        elements.supplierInvoicesTableBody.innerHTML = "";
        elements.supplierPaymentsTableBody.innerHTML = "";
        return;
      }

      elements.supplierInvoicesTableBody.innerHTML = invoices.map(function (invoice) {
        return [
          '<tr class="supplier-activity-detail-trigger" data-supplier-activity-invoice-id="' + helpers.escapeHtml(invoice.id) + '">',
          "  <td>" + helpers.escapeHtml(helpers.getInvoiceDisplayNumber(invoice, fieldCandidates)) + "</td>",
          '  <td><span class="status-pill ' + helpers.escapeHtml(helpers.getStatusTone(invoice.Status)) + '">' + helpers.escapeHtml(invoice.Status || "-") + "</span></td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(invoice.Invoice_Date)) + "</td>",
          "  <td>" + helpers.escapeHtml(helpersApi && helpersApi.getInvoiceBooking ? helpersApi.getInvoiceBooking(invoice) : (helpers.getLookupDisplayValue(invoice, fieldCandidates.invoice.booking) || "-")) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(helpers.getInvoiceTotalAmount(invoice, fieldCandidates))) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(invoice.Amount_Paid)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(helpers.getInvoicePendingAmount(invoice, fieldCandidates))) + "</td>",
          "</tr>"
        ].join("");
      }).join("");

      elements.supplierPaymentsTableBody.innerHTML = payments.map(function (payment) {
        return [
          '<tr class="supplier-activity-detail-trigger" data-supplier-activity-payment-id="' + helpers.escapeHtml(payment.id) + '">',
          "  <td>" + helpers.escapeHtml(helpers.getCandidateValue(payment, fieldCandidates.payment.reference) || payment.Name || "Untitled payment") + "</td>",
          '  <td><span class="status-pill ' + helpers.escapeHtml(helpers.getStatusTone(payment.Status)) + '">' + helpers.escapeHtml(payment.Status || "-") + "</span></td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(payment.Payment_Date)) + "</td>",
          "  <td>" + helpers.escapeHtml(helpersApi && helpersApi.getPaymentBooking ? helpersApi.getPaymentBooking(payment) : "-") + "</td>",
          "  <td>-</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(helpers.getPaymentAmount(payment, fieldCandidates))) + "</td>",
          "</tr>"
        ].join("");
      }).join("");

      if (elements.supplierInvoicesTableHead) {
        Array.prototype.forEach.call(
          elements.supplierInvoicesTableHead.querySelectorAll("th[data-supplier-invoice-sort]"),
          function (header) {
            var sortKey = header.getAttribute("data-supplier-invoice-sort");
            var baseLabel = supplierInvoiceSortLabels[sortKey] || stripSortIndicator(header.textContent);
            var isActiveSort = sortKey === supplierInvoiceSort.key;
            header.textContent = baseLabel + (isActiveSort ? " " + getSortIndicator(supplierInvoiceSort.direction) : "");
            header.classList.add("is-clickable");
            header.onclick = function () {
              if (helpersApi && typeof helpersApi.onInvoiceSortChange === "function") {
                helpersApi.onInvoiceSortChange(sortKey);
              }
            };
          }
        );
      }

      if (showingInvoices) {
        elements.supplierInvoicesEmpty.textContent = "No related invoices were found for this supplier.";
        elements.supplierInvoicesEmpty.hidden = invoices.length > 0;
        elements.supplierInvoicesTableWrap.hidden = invoices.length === 0;
        elements.supplierPaymentsEmpty.hidden = true;
        elements.supplierPaymentsTableWrap.hidden = true;
        return;
      }

      elements.supplierPaymentsEmpty.textContent = "No related payments were found for this supplier.";
      elements.supplierPaymentsEmpty.hidden = payments.length > 0;
      elements.supplierPaymentsTableWrap.hidden = payments.length === 0;
      elements.supplierInvoicesEmpty.hidden = true;
      elements.supplierInvoicesTableWrap.hidden = true;
    }

    function renderSupplierActivityDetailPopup(detail) {
      var isInvoice = detail && detail.type === "invoice";
      var record = detail && detail.record;
      var relatedRecords = isInvoice ? detail.lines : detail && detail.allocations;
      var summary;
      var relatedTitle;
      var relatedHeaders;
      var relatedRows;

      if (!elements.supplierActivityDetailPopup) {
        return;
      }

      elements.supplierActivityDetailPopup.hidden = !detail || !detail.isOpen;
      if (!detail || !detail.isOpen) {
        return;
      }

      elements.supplierActivityDetailEyebrow.textContent = isInvoice ? "Supplier invoice" : "Supplier payment";
      elements.supplierActivityDetailTitle.textContent = isInvoice
        ? helpers.getInvoiceDisplayNumber(record, fieldCandidates)
        : (helpers.getCandidateValue(record, fieldCandidates.payment.reference) || record.Name || "Payment");

      summary = isInvoice ? [
        ["Status", record.Status || "-"],
        ["Date", helpers.formatDate(record.Invoice_Date)],
        ["Booking", helpers.getLookupDisplayValue(record, fieldCandidates.invoice.booking) || "-"],
        ["Total", helpers.formatCurrency(helpers.getInvoiceTotalAmount(record, fieldCandidates))],
        ["Paid", helpers.formatCurrency(record.Amount_Paid)],
        ["Pending", helpers.formatCurrency(helpers.getInvoicePendingAmount(record, fieldCandidates))]
      ] : [
        ["Status", record.Status || "-"],
        ["Date", helpers.formatDate(record.Payment_Date)],
        ["Type", helpers.getCandidateValue(record, fieldCandidates.payment.movementType) || "-"],
        ["Payment account", helpers.getLookupName(record.Payment_Account) || "-"],
        ["Amount", helpers.formatCurrency(helpers.getPaymentAmount(record, fieldCandidates))]
      ];
      relatedTitle = isInvoice ? "Invoice lines" : "Payment allocations";
      relatedHeaders = isInvoice ? ["Service date", "Service", "Amount"] : ["Invoice", "Booking", "Amount", "Date"];
      relatedRows = (relatedRecords || []).map(function (item) {
        return isInvoice
          ? "<tr><td>" + helpers.escapeHtml(helpers.formatDate(item.Service_Date)) + "</td><td>" + helpers.escapeHtml(helpers.getLookupName(item.Booking_Service) || item.Name || "-") + "</td><td class=\"numeric-cell\">" + helpers.escapeHtml(helpers.formatCurrency(item.Amount)) + "</td></tr>"
          : "<tr><td>" + helpers.escapeHtml(helpers.getLookupName(item.Supplier_Invoice) || item.Name || "-") + "</td><td>" + helpers.escapeHtml(helpers.getLookupName(item.Booking) || "-") + "</td><td class=\"numeric-cell\">" + helpers.escapeHtml(helpers.formatCurrency(item.Allocated_Amount)) + "</td><td>" + helpers.escapeHtml(helpers.formatDate(item.Allocation_Date)) + "</td></tr>";
      }).join("");

      elements.supplierActivityDetailContent.innerHTML = detail.isLoading
        ? '<div class="empty-state">Loading related information...</div>'
        : '<div class="supplier-activity-detail-summary">' + summary.map(function (item) {
          return "<div><span>" + helpers.escapeHtml(item[0]) + "</span><strong>" + helpers.escapeHtml(item[1]) + "</strong></div>";
        }).join("") + "</div>" +
          '<section class="supplier-activity-detail-section"><h3>' + relatedTitle + " (" + relatedRecords.length + ")</h3>" +
          (relatedRecords.length
            ? '<div class="table-wrap"><table class="results-table mini-results-table"><thead><tr>' + relatedHeaders.map(function (label) { return "<th>" + label + "</th>"; }).join("") + "</tr></thead><tbody>" + relatedRows + "</tbody></table></div>"
            : '<div class="empty-state">No related records found.</div>') +
          "</section>";
    }

    function renderBookingsWorkspace(view) {
      var bookingCandidates = fieldCandidates.booking;
      var isArrivalRange = state.views.bookings.filters.arrivalDateMode === "range";
      var selectedStages = Array.isArray(state.views.bookings.filters.stageValues)
        ? state.views.bookings.filters.stageValues
        : [];
      var visibleRecords = Array.isArray(view.visibleRecords) ? view.visibleRecords : [];
      var hasAllStagesSelected = Boolean(view.stageOptions && selectedStages.length && selectedStages.length === view.stageOptions.length);
      var stageToggleLabel = !selectedStages.length
        ? "No stages"
        : hasAllStagesSelected
        ? "All stages"
        : selectedStages.length <= 2
        ? selectedStages.join(", ")
        : String(selectedStages.length) + " stages";

      if (elements.bookingsFilterMfsp) {
        elements.bookingsFilterMfsp.value = state.views.bookings.filters.mfsp || "";
      }
      if (elements.bookingsFilterName) {
        elements.bookingsFilterName.value = state.views.bookings.filters.bookingName || "";
      }
      if (elements.bookingsFilterArrivalMode) {
        elements.bookingsFilterArrivalMode.value = state.views.bookings.filters.arrivalDateMode || "single";
      }
      if (elements.bookingsFilterArrivalDateFrom) {
        elements.bookingsFilterArrivalDateFrom.value = state.views.bookings.filters.arrivalDateFrom || "";
      }
      if (elements.bookingsFilterArrivalDateTo) {
        elements.bookingsFilterArrivalDateTo.value = state.views.bookings.filters.arrivalDateTo || "";
        elements.bookingsFilterArrivalDateTo.hidden = !isArrivalRange;
      }
      if (elements.bookingsFilterAgency) {
        elements.bookingsFilterAgency.value = state.views.bookings.filters.agency || "";
      }
      if (elements.bookingsFilterStageToggle) {
        elements.bookingsFilterStageToggle.textContent = stageToggleLabel;
        elements.bookingsFilterStageToggle.setAttribute("aria-expanded", state.views.bookings.stageDropdownOpen ? "true" : "false");
      }
      if (elements.bookingsFilterStageMenu) {
        elements.bookingsFilterStageMenu.hidden = !state.views.bookings.stageDropdownOpen;
        elements.bookingsFilterStageMenu.innerHTML = [
          '<div class="status-filter-menu-actions">',
          '  <button class="status-filter-menu-action" type="button" data-booking-stage-action="select-all">Select all</button>',
          '  <button class="status-filter-menu-action" type="button" data-booking-stage-action="clear-all">Deselect all</button>',
          "</div>",
          view.stageOptions.map(function (option) {
            var isChecked = selectedStages.indexOf(option.value) !== -1;

            return [
              '<label class="bookings-stage-option">',
              '  <input type="checkbox" data-booking-stage-value="' + helpers.escapeHtml(option.value) + '"' + (isChecked ? " checked" : "") + '>',
              '  <span>' + helpers.escapeHtml(option.label) + "</span>",
              "</label>"
            ].join("");
          }).join("")
        ].join("");
      }
      if (elements.bookingsFilterAccountingRep) {
        elements.bookingsFilterAccountingRep.value = state.views.bookings.filters.accountingRep || "";
      }
      if (elements.bookingsLoad) {
        elements.bookingsLoad.textContent = state.currentTab === "bookings" && state.isLoading ? "Loading..." : "Load";
      }

      elements.bookingsCount.textContent = view.countLabel;

      if (!view.filteredRecords.length) {
        elements.bookingsEmpty.textContent = view.emptyMessage;
        elements.bookingsEmpty.hidden = false;
        elements.bookingsTableWrap.hidden = true;
        elements.bookingsTableBody.innerHTML = "";
        if (elements.bookingsPaginationBar) {
          elements.bookingsPaginationBar.hidden = true;
        }
        return;
      }

      elements.bookingsTableBody.innerHTML = visibleRecords.map(function (record) {
        var stageValue = view.formatters.text(record, bookingCandidates.stage);
        var closureStatusValue = view.formatters.text(record, bookingCandidates.closureStatus);

        if (!closureStatusValue || closureStatusValue === "-") {
          closureStatusValue = "Closure Pending";
        }

        return [
          '<tr class="booking-row" data-booking-id="' + helpers.escapeHtml(String(record.id || "")) + '" data-booking-closure-mfsp="' + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.mfsp)) + '">',
          '  <td class="booking-row-actions-cell"><details class="booking-row-actions"><summary aria-label="Booking actions" title="Booking actions">&#8942;</summary><div class="booking-row-actions-menu">' +
          '    <button type="button" data-booking-row-action="trip-closure">Trip Closure</button>' +
          '    <button type="button" data-booking-row-action="pay-agent-commission">Pay Agent Commission</button>' +
          "  </div></details></td>",
          '  <td><span class="status-pill ' + helpers.escapeHtml(helpers.getStatusTone(closureStatusValue)) + '">' + helpers.escapeHtml(closureStatusValue) + "</span></td>",
          "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.mfsp)) + "</td>",
          "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.name)) + "</td>",
          "  <td>" + helpers.escapeHtml(view.formatters.date(record, bookingCandidates.arrivalDate)) + "</td>",
          "  <td>" + helpers.escapeHtml(view.formatters.date(record, bookingCandidates.departureDate)) + "</td>",
          "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.agency)) + "</td>",
          "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.consortia)) + "</td>",
          "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.iataCode)) + "</td>",
          "  <td><span class=\"status-pill " + helpers.escapeHtml(helpers.getStatusTone(stageValue)) + "\">" + helpers.escapeHtml(stageValue) + "</span></td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.number(record, bookingCandidates.travellersNumber)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.salesPrice)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.purchasePrice)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.grossMargin)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.netMargin)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.balanceAmount)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.totalPaidAmount)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.totalRefundAmount)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.totalRequestedAmount)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.agentCommissionAmount)) + "</td>",
          "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.accountingRep)) + "</td>",
          "</tr>"
        ].join("");
      }).join("");

      elements.bookingsEmpty.hidden = true;
      elements.bookingsTableWrap.hidden = false;
      if (elements.bookingsPaginationBar) {
        elements.bookingsPaginationBar.hidden = view.page <= 1 && !view.hasMore;
      }
      if (elements.bookingsPaginationCopy) {
        elements.bookingsPaginationCopy.textContent = view.pageSummary;
      }
      if (elements.bookingsPrevPage) {
        elements.bookingsPrevPage.disabled = state.isLoading || view.page <= 1;
      }
      if (elements.bookingsNextPage) {
        elements.bookingsNextPage.disabled = state.isLoading || !view.hasMore;
      }
    }

    function renderInvoicesWorkspace(view, onInvoiceChecked, onInvoiceSelected, onToggleAll, onSortChange, onInvoiceListTabChange, onInvoiceDetailTabChange, onSelectedInvoiceAttachmentPreview, onInvoiceAttachmentFallbackOpen, getInvoiceAttachmentsForField, getAttachmentKey, getAttachmentFileName, getAttachmentCategory, getAttachmentDateValue, getAttachmentPreviewUrl) {
      invoicesRenderer.renderInvoicesWorkspace(
        view,
        onInvoiceChecked,
        onInvoiceSelected,
        onToggleAll,
        onSortChange,
        onInvoiceListTabChange,
        onInvoiceDetailTabChange,
        onSelectedInvoiceAttachmentPreview,
        onInvoiceAttachmentFallbackOpen,
        getInvoiceAttachmentsForField,
        getAttachmentKey,
        getAttachmentFileName,
        getAttachmentCategory,
        getAttachmentDateValue,
        getAttachmentPreviewUrl
      );
    }
    function renderPaymentsWorkspace(view, onSelected) {
      paymentsRenderer.renderPaymentsWorkspace(view, onSelected);
    }

    function renderSelectedPayment(payment, helpersApi, onPaymentDetailTabChange) {
      paymentsRenderer.renderSelectedPayment(payment, helpersApi, onPaymentDetailTabChange);
    }

    function renderPaymentAccountsWorkspace(view, onSelected) {
      paymentsRenderer.renderPaymentAccountsWorkspace(view, onSelected);
    }

    function renderPaymentAllocationsWorkspace(view, onSelected) {
      paymentsRenderer.renderPaymentAllocationsWorkspace(view, onSelected);
    }

    function renderSelectedPaymentAccount(account, helpersApi) {
      paymentsRenderer.renderSelectedPaymentAccount(account, helpersApi);
    }

    function renderAccountingWorkspace(activeTab) {
      accountingRenderer.renderAccountingWorkspace(activeTab);
    }

    function renderAccountingEntriesWorkspace(view, onSortChange) {
      accountingRenderer.renderAccountingEntriesWorkspace(view, onSortChange);
    }

    function renderAccountingEntryLinesWorkspace(view, onSortChange) {
      accountingRenderer.renderAccountingEntryLinesWorkspace(view, onSortChange);
    }

    function renderAccountingAccountsWorkspace(view, onSelected) {
      accountingRenderer.renderAccountingAccountsWorkspace(view, onSelected);
    }

    function renderSelectedAccountingAccount(account) {
      accountingRenderer.renderSelectedAccountingAccount(account);
    }

    function renderAccountingRulesWorkspace(view, onSelected) {
      accountingRenderer.renderAccountingRulesWorkspace(view, onSelected);
    }

    function renderSelectedAccountingRule(rule) {
      accountingRenderer.renderSelectedAccountingRule(rule);
    }

    return {
      renderDashboard: renderDashboard,
      renderAccountingEntriesWorkspace: renderAccountingEntriesWorkspace,
      renderAccountingEntryLinesWorkspace: renderAccountingEntryLinesWorkspace,
      renderBookingsWorkspace: renderBookingsWorkspace,
      renderAccountingAccountsWorkspace: renderAccountingAccountsWorkspace,
      renderAccountingRulesWorkspace: renderAccountingRulesWorkspace,
      renderAccountingWorkspace: renderAccountingWorkspace,
      hideSearchResults: hideSearchResults,
      showSupplierSearchEmpty: showSupplierSearchEmpty,
      refreshActionState: refreshActionState,
      renderInvoiceWorkspace: renderInvoicesWorkspace,
      renderPaymentAccountsWorkspace: renderPaymentAccountsWorkspace,
      renderPaymentAllocationsWorkspace: renderPaymentAllocationsWorkspace,
      renderPaymentsWorkspaceSections: renderPaymentsWorkspaceSections,
      renderPaymentsWorkspace: renderPaymentsWorkspace,
      renderSelectedAccountingAccount: renderSelectedAccountingAccount,
      renderSelectedAccountingRule: renderSelectedAccountingRule,
      renderSearchResults: renderSearchResults,
      renderSelectedPayment: renderSelectedPayment,
      renderSelectedPaymentAccount: renderSelectedPaymentAccount,
      renderSupplierContext: renderSupplierContext,
      renderSupplierRelatedActivity: renderSupplierRelatedActivity,
      renderSupplierActivityDetailPopup: renderSupplierActivityDetailPopup,
      renderSupplierOptions: renderSupplierOptions,
      renderTabs: renderTabs,
      setLoading: setLoading,
      setMode: setMode,
      hideError: hideError,
      hideNotice: hideNotice,
      showError: showError,
      showNotice: showNotice
    };
  };
}(window));
