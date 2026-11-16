(function (global) {
var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createPaymentsRenderer = function (deps) {
    var elements = deps.elements;
    var state = deps.state;
    var helpers = deps.helpers;
    var fieldCandidates = deps.fieldCandidates;
    var setTextWithTitle = deps.setTextWithTitle;
    var renderSimpleSelect = deps.renderSimpleSelect;

    function renderPaymentsWorkspaceSections(activeSection) {
      var isAccounts = activeSection === "accounts";
      var isAllocations = activeSection === "allocations";
      var isPayments = !isAccounts && !isAllocations;

      elements.paymentsSectionTabPayments.classList.toggle("is-active", isPayments);
      elements.paymentsSectionTabPayments.setAttribute("aria-selected", isPayments ? "true" : "false");
      elements.paymentsSectionTabAccounts.classList.toggle("is-active", isAccounts);
      elements.paymentsSectionTabAccounts.setAttribute("aria-selected", isAccounts ? "true" : "false");
      elements.paymentsSectionTabAllocations.classList.toggle("is-active", isAllocations);
      elements.paymentsSectionTabAllocations.setAttribute("aria-selected", isAllocations ? "true" : "false");
      elements.paymentsBrowserWorkspace.hidden = !isPayments;
      elements.paymentsAllocationsWorkspace.hidden = !isAllocations;
      elements.paymentsAccountsWorkspace.hidden = !isAccounts;
    }

    function renderPaymentAllocationsWorkspace(view, onSelected) {
      var filterElements = {
        reference: elements.paymentAllocationFilterReference, movementType: elements.paymentAllocationFilterMovementType, payment: elements.paymentAllocationFilterPayment,
        invoice: elements.paymentAllocationFilterInvoice, supplierCode: elements.paymentAllocationFilterSupplierCode
      };
      Object.keys(filterElements).forEach(function (key) { if (filterElements[key]) { filterElements[key].value = view.filters[key] || ""; } });
      elements.paymentAllocationsCount.textContent = view.filteredRecords.length + (view.filteredRecords.length === 1 ? " allocation" : " allocations");
      elements.paymentAllocationsTableBody.innerHTML = view.visibleRecords.map(function (allocation) {
        return '<tr class="is-clickable' + (allocation.id === view.selectedId ? " is-active" : "") + '" data-payment-allocation-id="' + helpers.escapeHtml(allocation.id) + '"><td>' + helpers.escapeHtml(allocation.Name || "-") + "</td><td>" + helpers.escapeHtml(allocation.Movement_Type || "-") + "</td><td>" + helpers.escapeHtml(helpers.getLookupName(allocation.Supplier_Payment) || "-") + "</td><td>" + helpers.escapeHtml(helpers.getLookupName(allocation.Supplier_Invoice) || "-") + "</td><td>" + helpers.escapeHtml(allocation.MFSP_Reference || "-") + "</td><td>" + helpers.escapeHtml(allocation.Supplier_Name || helpers.getLookupName(allocation.Supplier) || "-") + "</td><td>" + helpers.escapeHtml(helpers.getLookupName(allocation.Supplier_Settlement) || allocation["Supplier_Settlement.Name"] || "-") + '</td><td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(allocation.Allocated_Amount)) + "</td></tr>";
      }).join("");
      elements.paymentAllocationsEmpty.hidden = Boolean(view.filteredRecords.length);
      elements.paymentAllocationsTableWrap.hidden = !view.filteredRecords.length;
      Array.prototype.forEach.call(elements.paymentAllocationsTableBody.querySelectorAll("tr[data-payment-allocation-id]"), function (row) { row.addEventListener("click", function () { onSelected(row.getAttribute("data-payment-allocation-id")); }); });
      var allocation = view.selectedRecord;
      elements.selectedPaymentAllocationEmpty.hidden = Boolean(allocation);
      elements.selectedPaymentAllocationContent.hidden = !allocation;
      elements.selectedPaymentAllocationPill.textContent = allocation ? (allocation.Payment_Status || "-") : "No allocation selected";
      elements.selectedPaymentAllocationPill.className = allocation
        ? "status-pill " + helpers.getStatusTone(allocation.Payment_Status)
        : "badge subtle";
      elements.paymentAllocationsCount.textContent = view.filteredRecords.length + " records loaded";
      ns.renderProgressiveTable(elements.paymentAllocationsTableWrap, elements.paymentAllocationsEmpty, view, view.onLoadMore);
      if (!allocation) { return; }
      elements.selectedPaymentAllocationTitle.textContent = allocation.Name || "-";
      elements.selectedPaymentAllocationAmount.textContent = helpers.formatCurrency(allocation.Allocated_Amount);
      elements.selectedPaymentAllocationDate.textContent = helpers.formatDate(allocation.Allocation_Date);
      elements.selectedPaymentAllocationMovementType.textContent = allocation.Movement_Type || "-";
      elements.selectedPaymentAllocationPayment.textContent = helpers.getLookupName(allocation.Supplier_Payment) || "-";
      elements.selectedPaymentAllocationPaymentDate.textContent = helpers.formatDate(allocation.Payment_Date);
      elements.selectedPaymentAllocationPaymentStatus.textContent = allocation.Payment_Status || "-";
      elements.selectedPaymentAllocationInvoice.textContent = helpers.getLookupName(allocation.Supplier_Invoice) || "-";
      elements.selectedPaymentAllocationSettlement.textContent = helpers.getLookupName(allocation.Supplier_Settlement) || allocation["Supplier_Settlement.Name"] || "-";
      elements.selectedPaymentAllocationSupplier.textContent = allocation.Supplier_Name || helpers.getLookupName(allocation.Supplier) || "-";
      elements.selectedPaymentAllocationMfsp.textContent = allocation.MFSP_Reference || "-";
      elements.paymentAllocationsCount.textContent = view.filteredRecords.length + " records loaded";
      ns.renderProgressiveTable(elements.paymentAllocationsTableWrap, elements.paymentAllocationsEmpty, view, view.onLoadMore);
    }

    var detailTransitionTimer = null;
    var pendingLoadCheck = null;
    var lastLoadStateKey = "";
    function syncPaymentDetailLayout(payment) {
      var layout = document.getElementById("payments-list-layout");
      var sidebar = document.getElementById("payment-detail-sidebar");
      if (!layout || !sidebar) { return; }
      var open = Boolean(payment);
      if (layout.classList.contains("is-detail-open") !== open) {
        if (detailTransitionTimer) { global.clearTimeout(detailTransitionTimer); }
        var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
        state.views.payments.detailTransitioning = !reduced;
        layout.classList.toggle("is-detail-open", open);
        if (!reduced) {
          detailTransitionTimer = global.setTimeout(function () {
            state.views.payments.detailTransitioning = false;
            var check = pendingLoadCheck;
            pendingLoadCheck = null;
            if (check) { check(false); }
          }, 240);
        }
      }
      sidebar.setAttribute("aria-hidden", open ? "false" : "true");
      sidebar.inert = !open;
    }

    function renderPaymentLoadState(view) {
      var wrap = elements.paymentsTableWrap;
      var footer = document.getElementById("payments-load-status");
      if (!footer) {
        footer = document.createElement("div");
        footer.id = "payments-load-status";
        footer.className = "payment-load-status";
        footer.setAttribute("role", "status");
        footer.setAttribute("aria-live", "polite");
      }
      // Keep initial errors visible even when the empty table is hidden.
      if (view.visibleRecords.length) { wrap.appendChild(footer); }
      else { elements.paymentsEmpty.insertAdjacentElement("afterend", footer); }
      wrap.setAttribute("aria-busy", view.loadingMore || view.loadingInitial ? "true" : "false");
      footer.hidden = false;
      if (view.loadingInitial || view.loadingMore) {
        footer.innerHTML = '<span class="payment-load-spinner" aria-hidden="true"></span><span>' +
          (view.loadingInitial ? "Loading payments..." : "Loading more payments...") + '</span>';
      } else if (view.loadError) {
        footer.innerHTML = '<span>' + helpers.escapeHtml(view.loadError) + '</span><button type="button" class="button secondary compact-action-button">Retry</button>';
        footer.querySelector("button").onclick = view.onRetry;
        if (ns.showPaymentDiagnostics) {
          var diagnostic = document.createElement("button"); diagnostic.type = "button"; diagnostic.className = "button secondary compact-action-button";
          diagnostic.textContent = "View diagnostic"; diagnostic.onclick = ns.showPaymentDiagnostics; footer.appendChild(diagnostic);
        }
      } else if (view.hasMore) {
        footer.innerHTML = '<button type="button" class="button secondary compact-action-button">Load more payments</button>';
        footer.querySelector("button").onclick = view.onLoadMore;
      } else {
        footer.textContent = view.visibleRecords.length ? "All matching payments loaded." : "";
        footer.hidden = !view.visibleRecords.length;
      }
      var checkScroll = function (automatic) {
        var current = state.views.payments;
        if (current.loadError || current.loadingInitial || current.loadingMore || !current.hasMore) { return; }
        if (current.detailTransitioning) {
          if (automatic && view.hasMore && !view.loadError && !view.loadingMore && !view.loadingInitial) { pendingLoadCheck = checkScroll; }
          return;
        }
        if (state.currentTab === "payments" && state.views.payments.section === "payments" && view.hasMore && !view.loadError &&
            !view.loadingMore && !view.loadingInitial && (view.visibleRecords.length === 0 || (wrap.clientHeight > 0 &&
            wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 180))) {
          view.onLoadMore();
        }
      };
      wrap.onscroll = function () { checkScroll(false); };
      // Also fill a tall viewport when one batch does not create a scrollbar.
      var loadStateKey = [view.page, view.visibleRecords.length, view.loadingInitial, view.loadingMore, view.hasMore, view.loadError].join("|");
      if (loadStateKey !== lastLoadStateKey && global.requestAnimationFrame) { global.requestAnimationFrame(function () { checkScroll(true); }); }
      lastLoadStateKey = loadStateKey;
    }

    function renderPaymentsWorkspace(view, onSelected, letterBatch) {
      var scrollTop = elements.paymentsTableWrap.scrollTop;
      var scrollLeft = elements.paymentsTableWrap.scrollLeft;
      syncPaymentDetailLayout(view.selectedRecord);
      var paymentColumns = [
        { key: "date", label: "Date", defaultWidth: 110, minWidth: 100 },
        { key: "payment", label: "Payment", defaultWidth: 180, minWidth: 120, flex: true },
        { key: "status", label: "Status", defaultWidth: 120, minWidth: 110 },
        { key: "account", label: "Payment account", defaultWidth: 200, minWidth: 140, flex: true },
        { key: "amount", label: "Amount", defaultWidth: 160, minWidth: 160 }
      ];
      ns.tableColumns.configure("payments", paymentColumns, function () { renderPaymentsWorkspace(view, onSelected, letterBatch); });
      var visiblePaymentColumns = ns.tableColumns.visibleOrder("payments");
      var isSpecificDateRange = (view.filters.datePreset || "specific") === "specific";
      if (elements.paymentFilterDatePreset) {
        elements.paymentFilterDatePreset.value = view.filters.datePreset || "specific";
        var paymentFilterToolbar = elements.paymentFilterDatePreset.closest(".list-toolbar");
        if (paymentFilterToolbar) {
          paymentFilterToolbar.classList.toggle("is-custom-date-range", isSpecificDateRange);
        }
      }
      if (elements.paymentFilterDateFrom) {
        elements.paymentFilterDateFrom.value = view.filters.dateFrom || "";
        elements.paymentFilterDateFrom.disabled = !isSpecificDateRange;
      }
      if (elements.paymentFilterDateTo) {
        elements.paymentFilterDateTo.value = view.filters.dateTo || "";
        elements.paymentFilterDateTo.disabled = !isSpecificDateRange;
      }
      if (elements.paymentFilterSupplierCode) {
        elements.paymentFilterSupplierCode.value = view.filters.supplierCode || "";
      }
      if (elements.paymentFilterName) {
        elements.paymentFilterName.value = view.filters.paymentName || "";
      }
      if (elements.paymentFilterMfsp) {
        elements.paymentFilterMfsp.value = view.filters.mfsp || "";
      }

      elements.paymentsCount.textContent = view.countLabel;

      if (elements.paymentsTableHead) {
        var headers = {
          date: "<th>Date</th>", payment: "<th>Payment</th>", status: "<th>Status</th>",
          account: "<th>Payment account</th>", amount: '<th class="numeric-cell">Amount</th>'
        };
        elements.paymentsTableHead.innerHTML = '<tr><th><input type="checkbox" data-payment-letter-select-all aria-label="Select all visible payments"></th>'  + visiblePaymentColumns.map(function (key) { return ns.tableColumns.resizableHeader(key, headers[key]); }).join("") + '<th class="table-columns-gear-cell">' + ns.tableColumns.button("payments") + "</th></tr>";
      }

      if (!view.filteredRecords.length) {
        elements.paymentsEmpty.textContent = view.loadError ? "Could not load payments." : view.emptyMessage;
        elements.paymentsEmpty.hidden = false;
        elements.paymentsTableWrap.hidden = true;
        elements.paymentsTableBody.innerHTML = "";
      } else {
        elements.paymentsTableBody.innerHTML = view.visibleRecords.map(function (payment) {
          var isActive = payment.id === view.selectedId;
          var paymentAccountDisplay = ns.paymentDescription(payment, false);

          var cells = {
            date: "<td>" + helpers.escapeHtml(helpers.formatDate(payment.Payment_Date)) + "</td>",
            payment: "<td>" + helpers.escapeHtml(view.getPaymentReference(payment)) + "</td>",
            status: "<td><span class=\"status-pill " + helpers.escapeHtml(helpers.getStatusTone(payment.Status)) + "\">" + helpers.escapeHtml(payment.Status || "-") + "</span></td>",
            account: "<td>" + helpers.escapeHtml(paymentAccountDisplay || "-") + "</td>",
            amount: '<td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(helpers.getPaymentAmount(payment, fieldCandidates))) + "</td>"
          };
          return '<tr class="is-clickable' + (isActive ? " is-active" : "") + '" data-payment-id="' + helpers.escapeHtml(payment.id) + '" tabindex="0" aria-selected="' + (isActive ? "true" : "false") + '"><td><input type="checkbox" data-payment-letter-select="' + helpers.escapeHtml(payment.id) + '" aria-label="Select payment ' + helpers.escapeHtml(view.getPaymentReference(payment)) + '"></td>' + visiblePaymentColumns.map(function (key) { return cells[key]; }).join("") + '<td class="table-columns-gear-cell"></td></tr>';
        }).join("");

        Array.prototype.forEach.call(elements.paymentsTableBody.querySelectorAll("tr[data-payment-id]"), function (row) {
          row.addEventListener("keydown", function (event) {
            if (event.target === row && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault(); onSelected(row.getAttribute("data-payment-id"));
            }
          });
          row.addEventListener("click", function (event) {
            if (event.target.closest("[data-payment-letter-select]")) { return; }
            onSelected(row.getAttribute("data-payment-id"));
          });
        });

        elements.paymentsEmpty.hidden = true;
        elements.paymentsTableWrap.hidden = false;
      }

      if (letterBatch) { letterBatch.renderSelection(view); }
      elements.paymentsTableWrap.scrollTop = scrollTop;
      elements.paymentsTableWrap.scrollLeft = scrollLeft;
      renderPaymentLoadState(view);
    }

    function renderSelectedPayment(payment, helpersApi, onPaymentDetailTabChange) {
      var closeButton = document.getElementById("payment-detail-close");
      var feedback = document.getElementById("payment-detail-feedback");
      var detail = state.views.payments.detailLoad || {};
      var loading = Boolean(payment && detail.id === String(payment.id) && detail.loading);
      if (closeButton) {
        closeButton.onclick = function () {
          var previousId = payment && String(payment.id);
          helpersApi.closeDetail();
          var row = Array.prototype.find.call(elements.paymentsTableBody.querySelectorAll("[data-payment-id]"), function (item) {
            return item.getAttribute("data-payment-id") === previousId;
          });
          if (row) { row.focus({ preventScroll: true }); }
        };
      }
      if (feedback) {
        var messages = payment && detail.id === String(payment.id) ? [detail.error, detail.creatorError, detail.accountError].filter(Boolean) : [];
        feedback.hidden = !payment || (!loading && !messages.length);
        feedback.innerHTML = loading ? "Loading payment details..." : messages.map(helpers.escapeHtml).join(" ") +
          (messages.length ? ' <button type="button" class="button secondary compact-action-button">Retry</button>' : "");
        var retry = feedback.querySelector("button");
        if (retry) { retry.onclick = helpersApi.retryDetail; }
      }
      var tone;
      var status;
      var allocations;
      var selectedPaymentDetailTab = state.views && state.views.payments
        ? state.views.payments.detailTab || "payment"
        : "payment";
      var isPaymentTab = selectedPaymentDetailTab !== "allocations" && selectedPaymentDetailTab !== "accounting";
      var isAllocationsTab = selectedPaymentDetailTab === "allocations";
      var isAccountingTab = selectedPaymentDetailTab === "accounting";

      function getCountValue(record, candidates, fallbackValue) {
        var rawValue = helpers.getCandidateValue(record, candidates);
        var numericValue;

        if (rawValue === "" || rawValue === null || rawValue === undefined) {
          rawValue = fallbackValue;
        }

        numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? String(numericValue) : "0";
      }

      if (elements.selectedPaymentTabPayment) {
        elements.selectedPaymentTabPayment.onclick = function () {
          if (onPaymentDetailTabChange) {
            onPaymentDetailTabChange("payment");
          }
        };
      }
      if (elements.selectedPaymentTabAllocations) {
        elements.selectedPaymentTabAllocations.onclick = function () {
          if (onPaymentDetailTabChange) {
            onPaymentDetailTabChange("allocations");
          }
        };
      }
      if (elements.selectedPaymentTabAccounting) {
        elements.selectedPaymentTabAccounting.onclick = function () {
          if (onPaymentDetailTabChange) {
            onPaymentDetailTabChange("accounting");
          }
        };
      }

      if (!payment) {
        elements.selectedPaymentPill.textContent = "No payment selected";
        elements.selectedPaymentPill.className = "badge subtle";
        elements.selectedPaymentEmpty.hidden = false;
        elements.selectedPaymentContent.hidden = true;
        if (elements.selectedPaymentPaymentView) {
          elements.selectedPaymentPaymentView.hidden = false;
        }
        if (elements.selectedPaymentAllocationsView) {
          elements.selectedPaymentAllocationsView.hidden = true;
        }
        if (elements.selectedPaymentAccountingView) {
          elements.selectedPaymentAccountingView.hidden = true;
        }
        if (elements.selectedPaymentAccountingActions) {
          elements.selectedPaymentAccountingActions.hidden = true;
        }
        elements.selectedPaymentAllocationsEmpty.textContent = "This payment has no related allocations yet.";
        elements.selectedPaymentAllocationsEmpty.hidden = false;
        elements.selectedPaymentAllocationsTableWrap.hidden = true;
        elements.selectedPaymentAllocationsList.innerHTML = "";
        return;
      }

      status = payment.Status || "-";
      tone = helpers.getStatusTone(status);
      allocations = helpersApi.getAllocations ? helpersApi.getAllocations(payment) : [];
      elements.selectedPaymentPill.textContent = status;
      elements.selectedPaymentPill.className = "status-pill " + tone;
      elements.selectedPaymentEmpty.hidden = true;
      elements.selectedPaymentContent.hidden = false;
      setTextWithTitle(elements.selectedPaymentTitle, helpersApi.getPaymentReference(payment));
      if (elements.selectedPaymentCreatedBy) {
        var creatorName = ns.paymentLookupLabel(payment.Created_By);
        elements.selectedPaymentCreatedBy.textContent = creatorName ? "Created by " + creatorName
          : loading ? "Loading creator..." : "Creator not available";
      }
      if (elements.selectedPaymentHeroAmount) {
        setTextWithTitle(elements.selectedPaymentHeroAmount, helpers.formatCurrency(helpers.getPaymentAmount(payment, fieldCandidates)));
      }
      if (elements.selectedPaymentHeroMeta) {
        setTextWithTitle(
          elements.selectedPaymentHeroMeta,
          ns.paymentDescription(payment, loading)
        );
      }
      setTextWithTitle(elements.selectedPaymentDate, helpers.formatDate(payment.Payment_Date));
      setTextWithTitle(
        elements.selectedPaymentType,
        helpers.textValue(helpers.getCandidateValue(payment, fieldCandidates.payment.movementType))
      );
      setTextWithTitle(
        elements.selectedPaymentAccount,
        ns.paymentAccountLabel(payment, loading)
      );
      setTextWithTitle(elements.selectedPaymentAmount, helpers.formatCurrency(helpers.getPaymentAmount(payment, fieldCandidates)));
      setTextWithTitle(
        elements.selectedPaymentAccountingStatus,
        helpers.textValue(helpers.getCandidateValue(payment, fieldCandidates.payment.accountingStatus))
      );
      setTextWithTitle(
        elements.selectedPaymentSupplierCount,
        getCountValue(payment, fieldCandidates.payment.supplierCount, allocations.length ? helpers.uniqueNonEmpty(allocations.map(function (allocation) {
          return helpers.getLookupId(allocation.Supplier);
        })).length : 0)
      );
      setTextWithTitle(
        elements.selectedPaymentBookingCount,
        getCountValue(payment, fieldCandidates.payment.bookingCount, allocations.length ? helpers.uniqueNonEmpty(allocations.map(function (allocation) {
          return helpers.getLookupId(allocation.Booking);
        })).length : 0)
      );
      setTextWithTitle(
        elements.selectedPaymentSettlementCount,
        getCountValue(payment, fieldCandidates.payment.settlementCount, allocations.length ? helpers.uniqueNonEmpty(allocations.map(function (allocation) {
          return helpers.getLookupId(allocation.Supplier_Settlement);
        })).length : 0)
      );
      setTextWithTitle(
        elements.selectedPaymentAllocationCount,
        getCountValue(payment, fieldCandidates.payment.allocationCount, allocations.length)
      );
      if (elements.selectedPaymentTabPayment) {
        elements.selectedPaymentTabPayment.classList.toggle("is-active", isPaymentTab);
        elements.selectedPaymentTabPayment.setAttribute("aria-selected", isPaymentTab ? "true" : "false");
      }
      if (elements.selectedPaymentTabAllocations) {
        elements.selectedPaymentTabAllocations.classList.toggle("is-active", isAllocationsTab);
        elements.selectedPaymentTabAllocations.setAttribute("aria-selected", isAllocationsTab ? "true" : "false");
      }
      if (elements.selectedPaymentTabAccounting) {
        elements.selectedPaymentTabAccounting.classList.toggle("is-active", isAccountingTab);
        elements.selectedPaymentTabAccounting.setAttribute("aria-selected", isAccountingTab ? "true" : "false");
      }
      if (elements.selectedPaymentPaymentView) {
        elements.selectedPaymentPaymentView.hidden = !isPaymentTab;
      }
      if (elements.selectedPaymentAllocationsView) {
        elements.selectedPaymentAllocationsView.hidden = !isAllocationsTab;
      }
      if (elements.selectedPaymentAccountingView) {
        elements.selectedPaymentAccountingView.hidden = !isAccountingTab;
      }
      if (elements.selectedPaymentAccountingActions) {
        elements.selectedPaymentAccountingActions.hidden = !isAccountingTab;
      }

      if (!allocations.length) {
        elements.selectedPaymentAllocationsEmpty.textContent = "This payment has no related allocations yet.";
        elements.selectedPaymentAllocationsEmpty.hidden = false;
        elements.selectedPaymentAllocationsTableWrap.hidden = true;
        elements.selectedPaymentAllocationsList.innerHTML = "";
        if (helpersApi.allocationTable) { ns.renderProgressiveTable(elements.selectedPaymentAllocationsTableWrap, elements.selectedPaymentAllocationsEmpty, helpersApi.allocationTable, helpersApi.allocationTable.onLoadMore); }
        return;
      }

      elements.selectedPaymentAllocationsList.innerHTML = allocations.map(function (allocation) {
        return [
          "<tr>",
          "  <td>" + helpers.escapeHtml(helpers.getLookupName(allocation.Supplier_Invoice) || allocation["Supplier_Invoice.Name"] || allocation.Name || "-") + "</td>",
          "  <td>" + helpers.escapeHtml(helpers.getLookupName(allocation.Supplier_Settlement) || allocation["Supplier_Settlement.Name"] || "-") + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(allocation.Allocated_Amount)) + "</td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(allocation.Allocation_Date)) + "</td>",
          "</tr>"
        ].join("");
      }).join("");
      elements.selectedPaymentAllocationsEmpty.hidden = true;
      elements.selectedPaymentAllocationsTableWrap.hidden = false;
      if (helpersApi.allocationTable) { ns.renderProgressiveTable(elements.selectedPaymentAllocationsTableWrap, elements.selectedPaymentAllocationsEmpty, helpersApi.allocationTable, helpersApi.allocationTable.onLoadMore); }
    }

    function renderPaymentAccountsWorkspace(view, onSelected) {
      var isCreatePanelOpen = state.paymentAccountCreation && state.paymentAccountCreation.isOpen;
      var isContextReady = Boolean(view.isContextReady);
      var contextPlaceholder = view.isContextLoading
        ? "Loading supplier relationships..."
        : "Supplier relationships unavailable";

      elements.paymentAccountFilterSupplier.disabled = false;
      elements.paymentAccountFilterMfsp.disabled = false;
      elements.paymentAccountFilterMfsp.placeholder = "MFSP reference";
      elements.paymentAccountsCount.textContent = view.filteredRecords.length + (view.filteredRecords.length === 1 ? " account" : " accounts");
      elements.paymentAccountsBrowser.hidden = isCreatePanelOpen;

      if (isCreatePanelOpen) {
        return;
      }

      if (!view.filteredRecords.length) {
        elements.paymentAccountsEmpty.textContent = view.emptyMessage;
        elements.paymentAccountsEmpty.hidden = false;
        elements.paymentAccountsTableWrap.hidden = true;
        elements.paymentAccountsTableBody.innerHTML = "";
      } else {
        elements.paymentAccountsTableBody.innerHTML = view.visibleRecords.map(function (account) {
          var isActive = account.id === view.selectedId;
          var ownerType = helpers.textValue(account.Owner_Type);
          var ownerTypeTone = ownerType.toLowerCase() === "own"
            ? "info"
            : ownerType.toLowerCase() === "supplier"
            ? "caution"
            : "neutral";

          return [
            '<tr class="is-clickable' + (isActive ? " is-active" : "") + '" data-payment-account-id="' + helpers.escapeHtml(account.id) + '">',
            "  <td>" + helpers.escapeHtml(view.getAccountName(account)) + "</td>",
            '  <td><span class="status-pill ' + helpers.escapeHtml(helpers.getStatusTone(account.Status)) + '">' + helpers.escapeHtml(account.Status || "-") + "</span></td>",
            '  <td><span class="status-pill ' + helpers.escapeHtml(ownerTypeTone) + '">' + helpers.escapeHtml(ownerType) + "</span></td>",
            "  <td>" + helpers.escapeHtml(helpers.booleanLabel(Boolean(account.Allowed_For_Supplier_Payments))) + "</td>",
            "</tr>"
          ].join("");
        }).join("");

        Array.prototype.forEach.call(elements.paymentAccountsTableBody.querySelectorAll("tr[data-payment-account-id]"), function (row) {
          row.addEventListener("click", function () {
            onSelected(row.getAttribute("data-payment-account-id"));
          });
        });

        elements.paymentAccountsEmpty.hidden = true;
        elements.paymentAccountsTableWrap.hidden = false;
      }

      elements.paymentAccountsCount.textContent = view.filteredRecords.length + " records loaded";
      ns.renderProgressiveTable(elements.paymentAccountsTableWrap, elements.paymentAccountsEmpty, view, view.onLoadMore);
    }

    function renderSelectedPaymentAccount(account, helpersApi) {
      var status;
      var tone;
      var meta;

      if (!account) {
        elements.selectedPaymentAccountPill.textContent = "No account selected";
        elements.selectedPaymentAccountEmpty.hidden = false;
        elements.selectedPaymentAccountContent.hidden = true;
        elements.selectedPaymentAccountEdit.hidden = true;
        return;
      }

      status = account.Status || "-";
      tone = helpers.getStatusTone(status);
      meta = helpersApi.getAccountMeta(account);

      elements.selectedPaymentAccountPill.textContent = helpersApi.getAccountName(account);
      elements.selectedPaymentAccountEmpty.hidden = true;
      elements.selectedPaymentAccountContent.hidden = false;
      elements.selectedPaymentAccountEdit.hidden = false;
      elements.selectedPaymentAccountTitle.textContent = helpersApi.getAccountName(account);
      elements.selectedPaymentAccountMappingStatus.textContent = status;
      elements.selectedPaymentAccountMappingStatus.className = "status-pill " + tone;
      elements.selectedPaymentAccountEmail.textContent = helpers.textValue(account.Email);
      elements.selectedPaymentAccountSuppliers.textContent = helpersApi.isContextReady
        ? helpers.textValue(meta.suppliers.join(", "))
        : helpersApi.isContextLoading
        ? "Loading linked suppliers..."
        : "Supplier relationships unavailable";
      elements.selectedPaymentAccountMfsps.textContent = helpersApi.isContextReady
        ? helpers.textValue(meta.mfsps.join(", "))
        : helpersApi.isContextLoading
        ? "Loading related MFSPs..."
        : "MFSP relationships unavailable";
      elements.selectedPaymentAccountLastSyncDate.textContent = helpers.formatDate(account.Last_Sync_Date);
      elements.selectedPaymentAccountLastSyncStatus.textContent = helpers.textValue(account.Last_Sync_Status);
      elements.selectedPaymentAccountAllowed.textContent = helpers.booleanLabel(Boolean(account.Allowed_For_Supplier_Payments));
      elements.selectedPaymentAccountAutoSync.textContent = helpers.booleanLabel(Boolean(account.Auto_Sync_To_Books));
      elements.selectedPaymentAccountRequiresProof.textContent = helpers.booleanLabel(Boolean(account.Requires_Proof_of_Payment));
    }

    return {
      renderPaymentsWorkspaceSections: renderPaymentsWorkspaceSections,
      renderPaymentsWorkspace: renderPaymentsWorkspace,
      renderSelectedPayment: renderSelectedPayment,
      renderPaymentAccountsWorkspace: renderPaymentAccountsWorkspace,
      renderPaymentAllocationsWorkspace: renderPaymentAllocationsWorkspace,
      renderSelectedPaymentAccount: renderSelectedPaymentAccount
    };
  };
}(window));
