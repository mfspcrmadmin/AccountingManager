(function (global) {
var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.showErrorPopup = function (message, title) {
    if (ns.inlineFeedback) {
      ns.inlineFeedback.show((title ? title + ": " : "") + message, { tone: "error" }, ns.inlineFeedback.actionScope());
    }
  };

  ns.createRenderer = function (elements, state, helpers, fieldCandidates) {
    var feedback = ns.createInlineFeedback(state);
    ns.inlineFeedback = feedback;
    var loadingScopes = new Set();

    function hideNotice(scope) { feedback.show("", { clearTone: "notice" }, scope); }
    function hideError(scope) { feedback.show("", { clearTone: "error" }, scope); }

    function setLoading(isLoading, label, scope) {
      var target = scope || state.currentTab || "invoices";
      if (isLoading) { loadingScopes.add(target); }
      else { loadingScopes.delete(target); }
      state.isLoading = loadingScopes.size > 0;
      if (isLoading && label) { feedback.show(label, { isLoading: true }, target); }
      else if (!isLoading) { feedback.finish(target); }
      refreshActionState();
    }

    function withFeedbackTarget(scope) {
      var scoped = Object.create(api);
      scoped.showNotice = function (message, options) { feedback.show(message, Object.assign({ clearTone: "notice" }, options), scope); };
      scoped.showError = function (message) { feedback.show(message, { tone: "error", clearTone: "error" }, scope); };
      scoped.showErrorPopup = function (message, title) { scoped.showError((title ? title + ": " : "") + message); };
      scoped.hideNotice = function () { hideNotice(scope); };
      scoped.hideError = function () { hideError(scope); };
      scoped.setLoading = function (loading, label) { setLoading(loading, label, scope); };
      return scoped;
    }

    function refreshActionState() {
      var ezusReference = state.supplier ? helpers.getCandidateValue(state.supplier, fieldCandidates.supplier.ezusReference) : "";
      var hasSelectedInvoice = Boolean(state.views && state.views.invoices && state.views.invoices.selectedDetailId);
      var isInvoiceDeletionBusy = Boolean(state.invoiceDeletion && state.invoiceDeletion.isBusy);
      var isInvoiceAccountingBusy = Boolean(state.invoiceAccounting && state.invoiceAccounting.isBusy);
      var hasSelectedPayment = Boolean(state.views && state.views.payments && state.views.payments.selectedId);
      var isPaymentAccountingBusy = Boolean(state.paymentAccounting && state.paymentAccounting.isBusy);
      var isPaymentLetterBusy = Boolean(state.paymentLetter && state.paymentLetter.isBusy);

      elements.loadSupplier.disabled = state.isLoading;
      var searchClear = global.document.getElementById('clear-supplier-search');
      if (searchClear) { searchClear.hidden = !elements.supplierSearch.value; }
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
        elements.invoicesRefresh.disabled = state.isLoading;
      }
      if (elements.invoicesApplyFilters) {
        elements.invoicesApplyFilters.disabled = state.isLoading;
      }
      if (elements.invoicesLoad) {
        elements.invoicesLoad.disabled = state.isLoading;
        elements.invoicesLoad.textContent = state.currentTab === "invoices" && state.isLoading ? "Loading..." : "Load";
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
        elements.selectedInvoiceSyncAccounting.hidden = ns.ACCOUNTING_ENTRY_GENERATION_ENABLED !== true;
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
        elements.selectedInvoiceDeleteUpdateSettlement.disabled = true;
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
        elements.paymentsRefresh.disabled = state.isLoading;
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
      if (elements.selectedPaymentDelete) {
        elements.selectedPaymentDelete.disabled = state.isLoading || isPaymentLetterBusy || isPaymentAccountingBusy || !hasSelectedPayment;
      }
      if (elements.selectedPaymentSyncAccounting) {
        elements.selectedPaymentSyncAccounting.hidden = ns.ACCOUNTING_ENTRY_GENERATION_ENABLED !== true;
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
      feedback.show(message, Object.assign({ clearTone: "notice" }, options), feedback.actionScope());
    }

    function showError(message) {
      feedback.show(message, { tone: "error", clearTone: "error" }, feedback.actionScope());
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
      var text = helpers.textValue(value, "Not provided");

      if (!multiline || text === "Not provided") {
        return helpers.escapeHtml(text);
      }

      return helpers.escapeHtml(text).replace(/\r?\n/g, "<br>");
    }

    function buildSupplierDetailCard(label, value, options) {
      var settings = options || {};
      var cardClassName = "supplier-fact supplier-detail-card" + (settings.wide ? " supplier-detail-card-wide" : "");
      var valueMarkup;
      var href;
      var missing = value === null || value === undefined || value === "" || value === "-";
      if (missing) {
        value = "";
        cardClassName += " supplier-detail-missing";
      }

      if (settings.accountingStatus) {
        valueMarkup = '<dd class="supplier-detail-value supplier-detail-value-rich">' +
          (settings.supplierId && ns.supplierAccountingInfo
            ? ns.supplierAccountingInfo.editorHtml(settings.supplierId, value)
            : '<span class="accounting-status ' + (value ? 'present' : 'missing') + '">' + helpers.escapeHtml(missing ? 'Not provided' : helpers.textValue(value)) + '</span>') +
          (!value && settings.supplierId && ns.supplierAccountingInfo ? ns.supplierAccountingInfo.requestHtml(settings.supplierId) : '') + '</dd>';
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

      if (settings.copy && !missing) {
        valueMarkup = valueMarkup.replace("</dd>", '<button type="button" class="supplier-copy" data-supplier-copy="' +
          helpers.escapeHtml(String(value)) + '" aria-label="Copy ' + helpers.escapeHtml(label) + '" title="Copy ' +
          helpers.escapeHtml(label) + '"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button></dd>');
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
        buildSupplierInfoBlock("Classification", [
          buildSupplierDetailCard("Vendor type", helpers.getCandidateValue(supplier, fieldCandidates.supplier.vendorType)),
          buildSupplierDetailCard("Category", helpers.getCandidateValue(supplier, fieldCandidates.supplier.category)),
          buildSupplierDetailCard("Subcategory", helpers.getCandidateValue(supplier, fieldCandidates.supplier.subcategory))
        ], {
          compact: true
        }),
        buildSupplierInfoBlock("Location & website", [
          buildSupplierDetailCard("Destination", helpers.getCandidateValue(supplier, fieldCandidates.supplier.destination)),
          buildSupplierDetailCard("Subdestination", helpers.getCandidateValue(supplier, fieldCandidates.supplier.subdestination)),
          buildSupplierDetailCard("Website", helpers.getCandidateValue(supplier, fieldCandidates.supplier.website), { link: true, wide: true })
        ], {
          compact: true
        }),
        buildSupplierInfoBlock("Integration references", [
          buildSupplierDetailCard("Connection reference", helpers.getCandidateValue(supplier, fieldCandidates.supplier.connectionReference), { copy: true }),
          buildSupplierDetailCard("Ezus identifier", helpers.getCandidateValue(supplier, fieldCandidates.supplier.ezusReference), { copy: true })
        ])
      ]);
    }

    function buildSupplierInfoFinancial(supplier) {
      return buildSupplierInfoPanels([
        buildSupplierInfoBlock("Tax details", [
          buildSupplierDetailCard("Tax name", helpers.getCandidateValue(supplier, fieldCandidates.supplier.taxName), { wide: true }),
          buildSupplierDetailCard("CIF / NIF", helpers.getCandidateValue(supplier, fieldCandidates.supplier.cifNif), { copy: true }),
          buildSupplierDetailCard("Self-employed", formatSupplierBooleanValue(
            helpers.getCandidateValue(supplier, fieldCandidates.supplier.selfEmployed)
          ))
        ]),
        buildSupplierInfoBlock("Banking & accounting", [
          buildSupplierDetailCard("Accounting account", helpers.getCandidateValue(supplier, fieldCandidates.supplier.accounting), {
            accountingStatus: true, supplierId: supplier.id
          }),
          buildSupplierDetailCard("IBAN / account number", helpers.getCandidateValue(supplier, fieldCandidates.supplier.accountNumber), { copy: true, wide: true }),
          buildSupplierDetailCard("Default accounting account", helpers.getCandidateValue(supplier, fieldCandidates.supplier.defaultAccountingAccount)),
          buildSupplierDetailCard("Default accounting rule", helpers.getCandidateValue(supplier, fieldCandidates.supplier.defaultAccountingRule))
        ], {
          compact: true
        })
      ]);
    }

    function buildSupplierInfoPayment(supplier) {
      return buildSupplierInfoPanels([
        buildSupplierInfoBlock("Payment & commission", [
          buildSupplierDetailCard("Payment method", helpers.getCandidateValue(supplier, fieldCandidates.supplier.paymentMethod)),
          buildSupplierDetailCard("Commission status", helpers.getCandidateValue(supplier, fieldCandidates.supplier.commissionStatus)),
          buildSupplierDetailCard("Commission amount / rate", helpers.getCandidateValue(supplier, fieldCandidates.supplier.commissionAmount)),
          buildSupplierDetailCard("Commission notes & exceptions", helpers.getCandidateValue(supplier, fieldCandidates.supplier.commissionNotes), { multiline: true, wide: true })
        ]),
        buildSupplierInfoBlock("Payment conditions", [
          buildSupplierDetailCard("Terms", helpers.getCandidateValue(supplier, fieldCandidates.supplier.paymentConditions), { multiline: true, wide: true })
        ]),
        buildSupplierInfoBlock("Cancellation policy", [
          buildSupplierDetailCard("Terms", helpers.getCandidateValue(supplier, fieldCandidates.supplier.cancellationPolicy), { multiline: true, wide: true })
        ])
      ], "supplier-payment-panels");
    }

    function buildSupplierInfoAddress(supplier) {
      var billingFields = ["mailingAddress", "mailingCity", "postCode", "mailingCountry"];
      var hasBilling = billingFields.some(function (key) {
        var value = helpers.getCandidateValue(supplier, fieldCandidates.supplier[key]);
        return value !== null && value !== undefined && String(value).trim() !== "";
      });
      return buildSupplierInfoPanels([
        buildSupplierInfoBlock("Physical address", [
          buildSupplierDetailCard("Address", helpers.getCandidateValue(supplier, fieldCandidates.supplier.address), {
            multiline: true,
            wide: true
          }),
          buildSupplierDetailCard("City / town", helpers.getCandidateValue(supplier, fieldCandidates.supplier.cityTown)),
          buildSupplierDetailCard("Analysis city", helpers.getCandidateValue(supplier, fieldCandidates.supplier.analysisCity)),
          buildSupplierDetailCard("Country", helpers.getCandidateValue(supplier, fieldCandidates.supplier.country)),
          buildSupplierDetailCard("Zip code", helpers.getCandidateValue(supplier, fieldCandidates.supplier.zipCode))
        ], {
          compact: true,
        }).replace('class="supplier-info-block', 'class="supplier-info-block supplier-address-card supplier-address-card-physical'),
        hasBilling ? buildSupplierInfoBlock("Billing address", [
          buildSupplierDetailCard("Mailing address", helpers.getCandidateValue(supplier, fieldCandidates.supplier.mailingAddress), {
            multiline: true,
            wide: true
          }),
          buildSupplierDetailCard("City", helpers.getCandidateValue(supplier, fieldCandidates.supplier.mailingCity)),
          buildSupplierDetailCard("Post code", helpers.getCandidateValue(supplier, fieldCandidates.supplier.postCode)),
          buildSupplierDetailCard("Mailing country", helpers.getCandidateValue(supplier, fieldCandidates.supplier.mailingCountry))
        ], {
          compact: true,
        }).replace('class="supplier-info-block', 'class="supplier-info-block supplier-address-card supplier-address-card-billing') :
          '<section class="supplier-info-block"><h3 class="supplier-info-section-title">Billing address</h3><p class="supplier-missing-copy">Billing address not provided</p></section>'
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

    function hideSearchResults() {
      elements.searchResultsCard.hidden = true;
      elements.supplierSearch.setAttribute("aria-expanded", "false");
      elements.searchResultsCount.textContent = "0 matches";
      elements.searchResultsBody.innerHTML = '<tr><td colspan="3" class="table-empty">No suppliers found.</td></tr>';
    }

    function showSupplierSearchEmpty() {
      hideSearchResults();
      feedback.show("No suppliers found", { tone: "neutral" }, "supplier-search");
    }

    function renderSearchResults(records, onSelected) {
      if (!records || !records.length) {
        hideSearchResults();
        return;
      }

      elements.searchResultsCard.hidden = false;
      elements.supplierSearch.setAttribute("aria-expanded", "true");
      elements.searchResultsCount.textContent = records.length + (records.length === 1 ? " match" : " matches");
      elements.searchResultsBody.innerHTML = records.map(function (record) {
        return [
          '<tr class="is-clickable" tabindex="0" data-supplier-id="' + helpers.escapeHtml(record.id) + '">',
          "  <td colspan=\"3\"><strong>" + helpers.escapeHtml(helpers.getCandidateValue(record, fieldCandidates.supplier.name) || "-") + "</strong><small>" +
            helpers.escapeHtml([helpers.getCandidateValue(record, fieldCandidates.supplier.connectionReference), helpers.getCandidateValue(record, fieldCandidates.supplier.ezusReference)].filter(Boolean).join(" · ")) + "</small></td>",
          "</tr>"
        ].join("");
      }).join("");

      Array.prototype.forEach.call(elements.searchResultsBody.querySelectorAll("tr[data-supplier-id]"), function (row) {
        row.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.click(); }
          if (event.key === "Escape") { event.preventDefault(); hideSearchResults(); elements.supplierSearch.focus(); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            var next = event.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling;
            if (next) { next.focus(); } else if (event.key === "ArrowUp") { elements.supplierSearch.focus(); }
          }
        });
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

        return parsedDate.toLocaleString("en-GB", {
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
        elements.supplierLastEzusSyncAt.textContent = lastEzusSyncAt
          ? "Last sync: " + formatSyncDate(lastEzusSyncAt)
          : "Not synced yet";
      }
      if (elements.supplierLastEzusSyncBy) {
        elements.supplierLastEzusSyncBy.textContent = helpers.textValue(
          lastEzusSyncBy,
          "Not provided"
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
      ["basic", "financial", "payment", "address"].forEach(function (tab) {
        var button = elements.supplierInfoTabs.querySelector("#supplier-info-tab-" + tab);
        button.setAttribute("role", "tab");
        button.setAttribute("aria-controls", "supplier-info-content");
        button.tabIndex = state.supplierInfoTab === tab ? 0 : -1;
      });
      elements.supplierInfoContent.setAttribute("aria-labelledby", "supplier-info-tab-" + (state.supplierInfoTab || "basic"));
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
        invoiceType: "Invoice Type",
        date: "Invoice Date",
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

        if (supplierInvoiceSort.key === "invoiceType") {
          return compareSupplierActivityValues(left.Invoice_Type, right.Invoice_Type, supplierInvoiceSort.direction);
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

      elements.supplierRelatedTabInvoices.tabIndex = showingInvoices ? 0 : -1;
      elements.supplierRelatedTabPayments.tabIndex = showingInvoices ? -1 : 0;
      elements.supplierRelatedTabInvoices.setAttribute("aria-controls", "supplier-invoices-table-wrap supplier-invoices-empty");
      elements.supplierRelatedTabPayments.setAttribute("aria-controls", "supplier-payments-table-wrap supplier-payments-empty");
      renderSupplierActivityStats(true, invoices, payments);

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
          "  <td>" + invoicesRenderer.formatInvoiceTypeBadge(invoice) + "</td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(invoice.Invoice_Date)) + "</td>",
          "  <td>" + helpers.escapeHtml(invoice._supplierPaymentDates == null ? "Unavailable" : (invoice._supplierPaymentDates.map(function (date) { return helpers.formatDate(date); }).join(", ") || "-")) + "</td>",
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
          '<td><button type="button" class="button secondary compact-action-button supplier-letter-preview-button" data-supplier-payment-letter="' + helpers.escapeHtml(payment.id) + '" title="Preview payment letter" aria-label="Preview payment letter for ' + helpers.escapeHtml(payment.Name || payment.id) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path></svg></button></td>',
          "  <td>" + helpers.escapeHtml(helpers.getCandidateValue(payment, fieldCandidates.payment.reference) || payment.Name || "Untitled payment") + "</td>",
          '  <td><span class="status-pill ' + helpers.escapeHtml(helpers.getStatusTone(payment.Status)) + '">' + helpers.escapeHtml(payment.Status || "-") + "</span></td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(payment.Payment_Date)) + "</td>",
          "  <td>" + helpers.escapeHtml(helpersApi && helpersApi.getPaymentBooking ? helpersApi.getPaymentBooking(payment) : "-") + "</td>",
          "  <td>" + helpers.escapeHtml(payment._supplierAccountDisplay || ns.paymentAccountLabel(payment)) + "</td>",
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
        elements.supplierInvoicesEmpty.textContent = "No invoices for this supplier.";
        elements.supplierInvoicesEmpty.hidden = invoices.length > 0;
        elements.supplierInvoicesTableWrap.hidden = invoices.length === 0;
        elements.supplierPaymentsEmpty.hidden = true;
        elements.supplierPaymentsTableWrap.hidden = true;
        return;
      }

      elements.supplierPaymentsEmpty.textContent = "No payments for this supplier.";
      elements.supplierPaymentsEmpty.hidden = payments.length > 0;
      elements.supplierPaymentsTableWrap.hidden = payments.length === 0;
      elements.supplierInvoicesEmpty.hidden = true;
      elements.supplierInvoicesTableWrap.hidden = true;
    }

    function renderSupplierActivityDetailPopup(detail) {
      var isInvoice = detail && detail.type === "invoice";
      var record = detail && detail.record;

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

      elements.supplierActivityDetailPopup.classList.toggle("is-invoice", isInvoice);
      elements.supplierActivityDetailPopup.classList.toggle("is-payment", !isInvoice);
      if (elements.supplierActivityDetailStatus) {
        elements.supplierActivityDetailStatus.hidden = false;
        elements.supplierActivityDetailStatus.textContent = record.Status || "-";
        elements.supplierActivityDetailStatus.classList.toggle("is-paid", record.Status === "Paid");
      }
      if (isInvoice) {
        renderSupplierInvoiceDetail(detail);
        return;
      }

      renderSupplierPaymentDetail(detail);
    }

    function renderSupplierPaymentDetail(detail) {
      var previousScroll = elements.supplierActivityDetailContent.querySelector(".supplier-invoice-lines-scroll");
      var scrollTop = previousScroll ? previousScroll.scrollTop : 0;
      if (previousScroll && previousScroll._progressiveTable && previousScroll._progressiveTable.observer) { previousScroll._progressiveTable.observer.disconnect(); }

      var record = detail.record, escape = helpers.escapeHtml;
      var amount = helpers.firstValue(record, fieldCandidates.payment.amount);
      var allocations = detail.allocations || [];
      function money(value) {
        return value === null || value === undefined || value === "" ? "-" : helpers.formatCurrency(value);
      }
      function lookup(display, fallback) {
        return '<span' + (display && display.error ? ' class="lookup-unavailable"' : '') + '>' + escape(display ? display.text : fallback) + '</span>';
      }
      var accountFallback = ns.paymentAccountLabel(record, detail.isLoading);
      elements.supplierActivityDetailContent.innerHTML =
        '<div class="supplier-payment-amount"><span>Payment amount</span><strong>' + escape(money(amount)) + '</strong></div>' +
        '<dl class="supplier-invoice-identification supplier-payment-identification"><div><dt>Payment date</dt><dd>' + escape(helpers.formatDate(record.Payment_Date)) +
        '</dd></div><div><dt>Payment type</dt><dd>' + escape(helpers.getCandidateValue(record, fieldCandidates.payment.movementType) || "-") +
        '</dd></div><div><dt>Payment account</dt><dd>' + lookup(detail.accountDisplay, accountFallback) + '</dd></div></dl>' +
        '<section class="supplier-invoice-lines supplier-payment-allocations"><h3>Payment allocations <span class="supplier-invoice-count">' + (detail.isLoading || detail.error ? '' : allocations.length + ' loaded') + '</span></h3>' +
        (detail.isLoading ? '<div class="empty-state" role="status">Loading payment allocations...</div>' : detail.error ? '<div class="empty-state" role="alert">' + escape(detail.error) + '</div>' : allocations.length ?
          '<div class="supplier-invoice-lines-scroll" tabindex="0" role="region" aria-label="Payment allocations"><table><colgroup><col style="width:30%"><col style="width:32%"><col style="width:17%"><col style="width:21%"></colgroup><thead><tr><th scope="col">Invoice</th><th scope="col">Booking</th><th scope="col">Date</th><th scope="col">Allocated amount</th></tr></thead><tbody>' +
          allocations.map(function (allocation) {
            return '<tr><td>' + lookup(allocation._invoiceDisplay, 'Invoice unavailable') + '</td><td>' + lookup(allocation._bookingDisplay, 'Booking unavailable') + '</td><td>' + escape(helpers.formatDate(allocation.Allocation_Date)) + '</td><td>' + escape(money(allocation.Allocated_Amount)) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty-state">No related records found.</div>') + '</section>';
      if (detail.table) {
        var section = elements.supplierActivityDetailContent.querySelector(".supplier-invoice-lines");
        var wrap = section.querySelector(".supplier-invoice-lines-scroll");
        if (!wrap) { wrap = global.document.createElement("div"); wrap.className = "supplier-invoice-lines-scroll"; section.appendChild(wrap); }
        var empty = section.querySelector(".empty-state");
        ns.renderProgressiveTable(wrap, empty, detail.table, detail.table.onLoadMore);
        wrap.scrollTop = scrollTop;
      }

    }

    function renderSupplierInvoiceDetail(detail) {
      var previousScroll = elements.supplierActivityDetailContent.querySelector(".supplier-invoice-lines-scroll");
      var scrollTop = previousScroll ? previousScroll.scrollTop : 0;
      if (previousScroll && previousScroll._progressiveTable && previousScroll._progressiveTable.observer) { previousScroll._progressiveTable.observer.disconnect(); }

      var record = detail.record;
      var fields = fieldCandidates.invoice;
      var escape = helpers.escapeHtml;
      var totalValue = helpers.firstValue(record, fields.totalAmount.concat(fields.amount));
      var paidValue = helpers.firstValue(record, fields.amountPaid);
      var pendingValue = helpers.firstValue(record, fields.unpaidAmount);
      var hasTotal = totalValue !== "";
      var hasPending = pendingValue !== "" || (hasTotal && paidValue !== "");
      var pending = hasPending ? helpers.getInvoicePendingAmount(record, fieldCandidates) : null;
      var lines = detail.lines || [];
      function money(value) {
        return value === null || value === undefined || value === "" ? "-" : helpers.formatCurrency(value);
      }
      elements.supplierActivityDetailContent.innerHTML =
        '<dl class="supplier-invoice-identification"><div><dt>Invoice date</dt><dd>' + escape(helpers.formatDate(record.Invoice_Date)) +
        '</dd></div><div><dt>Booking</dt><dd>' + escape(helpers.getLookupDisplayValue(record, fields.booking) || "-") + '</dd></div></dl>' +
        '<dl class="supplier-invoice-totals"><div class="invoice-total"><dt>Invoice total</dt><dd>' + escape(money(hasTotal ? helpers.getInvoiceTotalAmount(record, fieldCandidates) : null)) +
        '</dd></div><div><dt>Paid</dt><dd>' + escape(money(paidValue)) +
        '</dd></div><div class="' + (pending > 0 ? 'has-pending' : '') + '"><dt>Pending</dt><dd>' + escape(money(pending)) + '</dd></div></dl>' +
        '<section class="supplier-invoice-lines"><h3>Invoice lines <span class="supplier-invoice-count">' + (detail.isLoading ? '' : lines.length + ' loaded') + '</span></h3>' +
        (detail.isLoading ? '<div class="empty-state">Loading related information...</div>' : lines.length ?
          '<div class="supplier-invoice-lines-scroll" tabindex="0" role="region" aria-label="Invoice lines"><table><colgroup><col style="width:20%"><col style="width:60%"><col style="width:20%"></colgroup><thead><tr><th scope="col">Service date</th><th scope="col">Service</th><th scope="col">Amount</th></tr></thead><tbody>' +
          lines.map(function (line) {
            return '<tr><td>' + escape(helpers.formatDate(line.Service_Date)) + '</td><td>' + escape(line._serviceProductDescription || "-") + '</td><td>' + escape(money(line.Amount)) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty-state">No related records found.</div>') + '</section>';
      if (detail.table) {
        var section = elements.supplierActivityDetailContent.querySelector(".supplier-invoice-lines");
        var wrap = section.querySelector(".supplier-invoice-lines-scroll");
        if (!wrap) { wrap = global.document.createElement("div"); wrap.className = "supplier-invoice-lines-scroll"; section.appendChild(wrap); }
        var empty = section.querySelector(".empty-state");
        ns.renderProgressiveTable(wrap, empty, detail.table, detail.table.onLoadMore);
        wrap.scrollTop = scrollTop;
      }

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
              '  <span class="status-pill ' + helpers.getBookingStatusTone(option.value) + '">' + helpers.escapeHtml(option.label) + "</span>",
              "</label>"
            ].join("");
          }).join("")
        ].join("");
      }
      if (elements.bookingsFilterAccountingRep) {
        elements.bookingsFilterAccountingRep.value = state.views.bookings.filters.accountingRep || "";
      }
      if (elements.bookingsLoad) {
        elements.bookingsLoad.classList.toggle("is-loading", state.currentTab === "bookings" && state.isLoading);
        elements.bookingsLoad.setAttribute("aria-label", state.currentTab === "bookings" && state.isLoading ? "Loading bookings" : "Load bookings");
      }

      var bookingColumns = [
        {"key": "actions", "label": "Actions", "defaultWidth": 44},
        {"key": "closureStatus", "label": "Closure Status", "defaultWidth": 200},
        {"key": "mfsp", "label": "MFSP", "defaultWidth": 140},
        {"key": "name", "label": "Booking Name", "defaultWidth": 250, "flex": true},
        {"key": "arrivalDate", "label": "Arrival Date", "defaultWidth": 140},
        {"key": "departureDate", "label": "Departure Date", "defaultWidth": 140},
        {"key": "agency", "label": "Agency", "defaultWidth": 200, "flex": true},
        {"key": "consortia", "label": "Consortia", "defaultWidth": 170},
        {"key": "iataCode", "label": "IATA Code", "defaultWidth": 130},
        {"key": "stage", "label": "Stage", "defaultWidth": 220},
        {"key": "travellersNumber", "label": "Travelers Number", "defaultWidth": 155},
        {"key": "salesPrice", "label": "Sales Price", "defaultWidth": 170},
        {"key": "purchasePrice", "label": "Purchase Price", "defaultWidth": 170},
        {"key": "grossMargin", "label": "Gross Margin", "defaultWidth": 170},
        {"key": "netMargin", "label": "Net Margin", "defaultWidth": 170},
        {"key": "balanceAmount", "label": "Balance Amount", "defaultWidth": 170},
        {"key": "totalPaidAmount", "label": "Total Paid Amount", "defaultWidth": 170},
        {"key": "totalRefundAmount", "label": "Total Refund Amount", "defaultWidth": 170},
        {"key": "totalRequestedAmount", "label": "Total Requested Amount", "defaultWidth": 200},
        {"key": "agentCommissionAmount", "label": "Agent Commission Amount", "defaultWidth": 210},
        {"key": "accountingRep", "label": "Accounting Rep", "defaultWidth": 190, "flex": true}
      ];
      ns.tableColumns.configure("bookings", bookingColumns, function () { renderBookingsWorkspace(view); });
      var visibleBookingColumns = ns.tableColumns.visibleOrder("bookings");
      var bookingHeaders = {"actions": "<th class=\"booking-row-actions-heading\" aria-label=\"Actions\"></th>", "closureStatus": "<th>Closure Status</th>", "mfsp": "<th>MFSP</th>", "name": "<th>Booking Name</th>", "arrivalDate": "<th>Arrival Date</th>", "departureDate": "<th>Departure Date</th>", "agency": "<th>Agency</th>", "consortia": "<th>Consortia</th>", "iataCode": "<th>IATA Code</th>", "stage": "<th>Stage</th>", "travellersNumber": "<th class=\"numeric-cell\">Travelers Number</th>", "salesPrice": "<th class=\"numeric-cell\">Sales Price</th>", "purchasePrice": "<th class=\"numeric-cell\">Purchase Price</th>", "grossMargin": "<th class=\"numeric-cell\">Gross Margin</th>", "netMargin": "<th class=\"numeric-cell\">Net Margin</th>", "balanceAmount": "<th class=\"numeric-cell\">Balance Amount</th>", "totalPaidAmount": "<th class=\"numeric-cell\">Total Paid Amount</th>", "totalRefundAmount": "<th class=\"numeric-cell\">Total Refund Amount</th>", "totalRequestedAmount": "<th class=\"numeric-cell\">Total Requested Amount</th>", "agentCommissionAmount": "<th class=\"numeric-cell\">Agent Commission Amount</th>", "accountingRep": "<th>Accounting Rep</th>"};
      elements.bookingsTableHead.innerHTML = "<tr>" + visibleBookingColumns.map(function (key) { return ns.tableColumns.resizableHeader(key, bookingHeaders[key]); }).join("") + '<th class="table-columns-gear-cell">' + ns.tableColumns.button("bookings") + "</th></tr>";

      elements.bookingsCount.textContent = view.countLabel;

      if (!view.filteredRecords.length) {
        elements.bookingsEmpty.textContent = view.emptyMessage;
        elements.bookingsEmpty.hidden = false;
        elements.bookingsTableWrap.hidden = true;
        elements.bookingsTableBody.innerHTML = "";
        ns.renderProgressiveTable(elements.bookingsTableWrap, elements.bookingsEmpty, view, view.onLoadMore);
        return;
      }

      elements.bookingsTableBody.innerHTML = visibleRecords.map(function (record) {
        var stageValue = view.formatters.text(record, bookingCandidates.stage);
        var closureStatusValue = view.formatters.text(record, bookingCandidates.closureStatus);

        if (!closureStatusValue || closureStatusValue === "-") {
          closureStatusValue = "Closure Pending";
        }

        var cells = {
          actions: '  <td class="booking-row-actions-cell"><details class="booking-row-actions"><summary aria-label="Booking actions" title="Booking actions">&#8942;</summary><div class="booking-row-actions-menu">' +
            '    <button type="button" data-booking-row-action="trip-closure">Trip Closure</button>' +
            '    <button type="button" data-booking-row-action="pay-agent-commission">Pay Agent Commission</button>' +
            "  </div></details></td>",
          closureStatus: '  <td><button type="button" class="status-pill booking-closure-status-button ' + helpers.escapeHtml(helpers.getBookingStatusTone(closureStatusValue)) + '" data-booking-row-action="trip-closure" title="Open trip closure">' + helpers.escapeHtml(closureStatusValue) + "</button></td>",
          mfsp: "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.mfsp)) + "</td>",
          name: "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.name)) + "</td>",
          arrivalDate: "  <td>" + helpers.escapeHtml(view.formatters.date(record, bookingCandidates.arrivalDate)) + "</td>",
          departureDate: "  <td>" + helpers.escapeHtml(view.formatters.date(record, bookingCandidates.departureDate)) + "</td>",
          agency: "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.agency)) + "</td>",
          consortia: "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.consortia)) + "</td>",
          iataCode: "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.iataCode)) + "</td>",
          stage: "  <td><span class=\"status-pill " + helpers.escapeHtml(helpers.getBookingStatusTone(stageValue)) + "\">" + helpers.escapeHtml(stageValue) + "</span></td>",
          travellersNumber: '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.number(record, bookingCandidates.travellersNumber)) + "</td>",
          salesPrice: '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.salesPrice)) + "</td>",
          purchasePrice: '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.purchasePrice)) + "</td>",
          grossMargin: '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.grossMargin)) + "</td>",
          netMargin: '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.netMargin)) + "</td>",
          balanceAmount: '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.balanceAmount)) + "</td>",
          totalPaidAmount: '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.totalPaidAmount)) + "</td>",
          totalRefundAmount: '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.totalRefundAmount)) + "</td>",
          totalRequestedAmount: '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.totalRequestedAmount)) + "</td>",
          agentCommissionAmount: '  <td class="numeric-cell">' + helpers.escapeHtml(view.formatters.currency(record, bookingCandidates.agentCommissionAmount)) + "</td>",
          accountingRep: "  <td>" + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.accountingRep)) + "</td>"
        };
        return '<tr class="booking-row" data-booking-id="' + helpers.escapeHtml(String(record.id || "")) + '" data-booking-closure-mfsp="' + helpers.escapeHtml(view.formatters.text(record, bookingCandidates.mfsp)) + '">' + visibleBookingColumns.map(function (key) { return cells[key]; }).join("") + '<td class="table-columns-gear-cell"></td></tr>';
      }).join("");

      elements.bookingsEmpty.hidden = true;
      elements.bookingsTableWrap.hidden = false;
      ns.renderProgressiveTable(elements.bookingsTableWrap, elements.bookingsEmpty, view, view.onLoadMore);

    }

    function renderInvoicesWorkspace(view, onInvoiceChecked, onInvoiceSelected, onToggleAll, onSortChange, onInvoiceDetailTabChange, onInvoiceOpenNative, onInvoiceFilesNeeded, onShowAttachmentsChange) {
      invoicesRenderer.renderInvoicesWorkspace(
        view,
        onInvoiceChecked,
        onInvoiceSelected,
        onToggleAll,
        onSortChange,
        onInvoiceDetailTabChange,
        onInvoiceOpenNative,
        onInvoiceFilesNeeded,
        onShowAttachmentsChange
      );
    }
    function renderPaymentsWorkspace(view, onSelected, letterBatch) {
      paymentsRenderer.renderPaymentsWorkspace(view, onSelected, letterBatch);
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

    var api = {
      withFeedbackTarget: withFeedbackTarget,
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
      showErrorPopup: ns.showErrorPopup,
      showNotice: showNotice
    };
    return api;
  };
}(window));
