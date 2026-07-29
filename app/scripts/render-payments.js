(function (global) {
var ns = global.PurchasesManagerApp = global.PurchasesManagerApp || {};

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
      elements.paymentAllocationFilterMovementType.innerHTML = '<option value="">All movement types</option>' + view.movementTypes.map(function (type) { return '<option value="' + helpers.escapeHtml(type) + '">' + helpers.escapeHtml(type) + "</option>"; }).join("");
      elements.paymentAllocationFilterMovementType.value = view.filters.movementType || "";
      elements.paymentAllocationsCount.textContent = view.filteredRecords.length + (view.filteredRecords.length === 1 ? " allocation" : " allocations");
      elements.paymentAllocationsTableBody.innerHTML = view.visibleRecords.map(function (allocation) {
        return '<tr class="is-clickable' + (allocation.id === view.selectedId ? " is-active" : "") + '" data-payment-allocation-id="' + helpers.escapeHtml(allocation.id) + '"><td>' + helpers.escapeHtml(allocation.Name || "-") + "</td><td>" + helpers.escapeHtml(allocation.Movement_Type || "-") + "</td><td>" + helpers.escapeHtml(helpers.getLookupName(allocation.Supplier_Payment) || "-") + "</td><td>" + helpers.escapeHtml(helpers.getLookupName(allocation.Supplier_Invoice) || "-") + "</td><td>" + helpers.escapeHtml(allocation.MFSP_Reference || "-") + "</td><td>" + helpers.escapeHtml(allocation.Supplier_Name || helpers.getLookupName(allocation.Supplier) || "-") + "</td><td>" + helpers.escapeHtml(helpers.getLookupName(allocation.Supplier_Settlement) || "-") + '</td><td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(allocation.Allocated_Amount)) + "</td></tr>";
      }).join("");
      elements.paymentAllocationsEmpty.hidden = Boolean(view.filteredRecords.length);
      elements.paymentAllocationsTableWrap.hidden = !view.filteredRecords.length;
      elements.paymentAllocationsPaginationBar.hidden = view.totalPages <= 1;
      elements.paymentAllocationsPaginationCopy.textContent = "Page " + view.page + " of " + view.totalPages;
      elements.paymentAllocationsPrevPage.disabled = state.isLoading || view.page <= 1;
      elements.paymentAllocationsNextPage.disabled = state.isLoading || view.page >= view.totalPages;
      Array.prototype.forEach.call(elements.paymentAllocationsTableBody.querySelectorAll("tr[data-payment-allocation-id]"), function (row) { row.addEventListener("click", function () { onSelected(row.getAttribute("data-payment-allocation-id")); }); });
      var allocation = view.selectedRecord;
      elements.selectedPaymentAllocationEmpty.hidden = Boolean(allocation);
      elements.selectedPaymentAllocationContent.hidden = !allocation;
      elements.selectedPaymentAllocationPill.textContent = allocation ? (allocation.Payment_Status || "-") : "No allocation selected";
      elements.selectedPaymentAllocationPill.className = allocation
        ? "status-pill " + helpers.getStatusTone(allocation.Payment_Status)
        : "badge subtle";
      if (!allocation) { return; }
      elements.selectedPaymentAllocationTitle.textContent = allocation.Name || "-";
      elements.selectedPaymentAllocationAmount.textContent = helpers.formatCurrency(allocation.Allocated_Amount);
      elements.selectedPaymentAllocationDate.textContent = helpers.formatDate(allocation.Allocation_Date);
      elements.selectedPaymentAllocationMovementType.textContent = allocation.Movement_Type || "-";
      elements.selectedPaymentAllocationPayment.textContent = helpers.getLookupName(allocation.Supplier_Payment) || "-";
      elements.selectedPaymentAllocationPaymentDate.textContent = helpers.formatDate(allocation.Payment_Date);
      elements.selectedPaymentAllocationPaymentStatus.textContent = allocation.Payment_Status || "-";
      elements.selectedPaymentAllocationInvoice.textContent = helpers.getLookupName(allocation.Supplier_Invoice) || "-";
      elements.selectedPaymentAllocationSettlement.textContent = helpers.getLookupName(allocation.Supplier_Settlement) || "-";
      elements.selectedPaymentAllocationSupplier.textContent = allocation.Supplier_Name || helpers.getLookupName(allocation.Supplier) || "-";
      elements.selectedPaymentAllocationMfsp.textContent = allocation.MFSP_Reference || "-";
    }

    function renderPaymentsWorkspace(view, onSelected) {
      if (elements.paymentFilterDateFrom) {
        elements.paymentFilterDateFrom.value = view.filters.dateFrom || "";
      }
      if (elements.paymentFilterDateTo) {
        elements.paymentFilterDateTo.value = view.filters.dateTo || "";
      }
      if (elements.paymentFilterSupplierCode) {
        elements.paymentFilterSupplierCode.value = view.filters.supplierCode || "";
      }
      if (elements.paymentFilterMfsp) {
        elements.paymentFilterMfsp.value = view.filters.mfsp || "";
      }

      elements.paymentsCount.textContent = view.countLabel;

      if (!view.filteredRecords.length) {
        elements.paymentsEmpty.textContent = view.emptyMessage;
        elements.paymentsEmpty.hidden = false;
        elements.paymentsTableWrap.hidden = true;
        elements.paymentsPaginationBar.hidden = true;
        elements.paymentsTableBody.innerHTML = "";
      } else {
        elements.paymentsTableBody.innerHTML = view.visibleRecords.map(function (payment) {
          var isActive = payment.id === view.selectedId;
          var paymentAccountDisplay = [
            helpers.textValue(helpers.getCandidateValue(payment, fieldCandidates.payment.movementType), ""),
            helpers.textValue(helpers.getLookupName(payment.Payment_Account), "")
          ].filter(Boolean).join(" | ");

          return [
            '<tr class="is-clickable' + (isActive ? " is-active" : "") + '" data-payment-id="' + helpers.escapeHtml(payment.id) + '">',
            "  <td>" + helpers.escapeHtml(helpers.formatDate(payment.Payment_Date)) + "</td>",
            "  <td>" + helpers.escapeHtml(view.getPaymentReference(payment)) + "</td>",
            "  <td><span class=\"status-pill " + helpers.escapeHtml(helpers.getStatusTone(payment.Status)) + "\">" + helpers.escapeHtml(payment.Status || "-") + "</span></td>",
            "  <td>" + helpers.escapeHtml(paymentAccountDisplay || "-") + "</td>",
            '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(helpers.getPaymentAmount(payment, fieldCandidates))) + "</td>",
            "</tr>"
          ].join("");
        }).join("");

        Array.prototype.forEach.call(elements.paymentsTableBody.querySelectorAll("tr[data-payment-id]"), function (row) {
          row.addEventListener("click", function () {
            onSelected(row.getAttribute("data-payment-id"));
          });
        });

        elements.paymentsEmpty.hidden = true;
        elements.paymentsTableWrap.hidden = false;
        elements.paymentsPaginationBar.hidden = view.page <= 1 && !view.hasMore;
        elements.paymentsPaginationCopy.textContent = view.pageSummary;
      }

      elements.paymentsPrevPage.disabled = state.isLoading || view.page <= 1;
      elements.paymentsNextPage.disabled = state.isLoading || !view.hasMore;
    }

    function renderSelectedPayment(payment, helpersApi, onPaymentDetailTabChange) {
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
        elements.selectedPaymentCreatedBy.textContent = "Created by " + helpers.textValue(helpers.getLookupName(payment.Created_By));
      }
      setTextWithTitle(elements.selectedPaymentDate, helpers.formatDate(payment.Payment_Date));
      setTextWithTitle(
        elements.selectedPaymentType,
        helpers.textValue(helpers.getCandidateValue(payment, fieldCandidates.payment.movementType))
      );
      setTextWithTitle(
        elements.selectedPaymentAccount,
        helpers.textValue(helpers.getLookupName(payment.Payment_Account))
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
        return;
      }

      elements.selectedPaymentAllocationsList.innerHTML = allocations.map(function (allocation) {
        return [
          "<tr>",
          "  <td>" + helpers.escapeHtml(helpers.getLookupName(allocation.Supplier_Invoice) || allocation.Name || "-") + "</td>",
          "  <td>" + helpers.escapeHtml(helpers.getLookupName(allocation.Supplier_Settlement) || "-") + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(allocation.Allocated_Amount)) + "</td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(allocation.Allocation_Date)) + "</td>",
          "</tr>"
        ].join("");
      }).join("");
      elements.selectedPaymentAllocationsEmpty.hidden = true;
      elements.selectedPaymentAllocationsTableWrap.hidden = false;
    }

    function renderPaymentAccountsWorkspace(view, onSelected) {
      var isCreatePanelOpen = state.paymentAccountCreation && state.paymentAccountCreation.isOpen;
      var isContextReady = Boolean(view.isContextReady);
      var contextPlaceholder = view.isContextLoading
        ? "Loading supplier relationships..."
        : "Supplier relationships unavailable";

      renderSimpleSelect(
        elements.paymentAccountFilterSupplier,
        view.supplierOptions,
        view.filters.supplierId,
        "All suppliers"
      );
      renderSimpleSelect(
        elements.paymentAccountFilterMappingStatus,
        view.statusOptions,
        view.filters.status,
        "All statuses"
      );
      elements.paymentAccountFilterSupplier.disabled = state.isLoading || !isContextReady;
      elements.paymentAccountFilterSupplier.title = isContextReady ? "" : contextPlaceholder;
      elements.paymentAccountFilterMfsp.disabled = state.isLoading || !isContextReady;
      elements.paymentAccountFilterMfsp.placeholder = isContextReady ? "MFSP reference" : contextPlaceholder;
      elements.paymentAccountFilterMfsp.title = isContextReady ? "" : contextPlaceholder;
      elements.paymentAccountsCount.textContent = view.filteredRecords.length + (view.filteredRecords.length === 1 ? " account" : " accounts");
      elements.paymentAccountsBrowser.hidden = isCreatePanelOpen;

      if (isCreatePanelOpen) {
        return;
      }

      if (!view.filteredRecords.length) {
        elements.paymentAccountsEmpty.textContent = view.emptyMessage;
        elements.paymentAccountsEmpty.hidden = false;
        elements.paymentAccountsTableWrap.hidden = true;
        elements.paymentAccountsPaginationBar.hidden = true;
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
        elements.paymentAccountsPaginationBar.hidden = view.totalPages <= 1;
        elements.paymentAccountsPaginationCopy.textContent = "Page " + view.page + " of " + view.totalPages;
      }

      elements.paymentAccountsPrevPage.disabled = state.isLoading || view.page <= 1;
      elements.paymentAccountsNextPage.disabled = state.isLoading || view.page >= view.totalPages;
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
