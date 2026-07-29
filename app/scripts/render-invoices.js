(function (global) {
var ns = global.PurchasesManagerApp = global.PurchasesManagerApp || {};

  ns.createInvoicesRenderer = function (deps) {
    var elements = deps.elements;
    var state = deps.state;
    var helpers = deps.helpers;
    var fieldCandidates = deps.fieldCandidates;
    var setTextWithTitle = deps.setTextWithTitle;
    var stripSortIndicator = deps.stripSortIndicator;
    var getSortIndicator = deps.getSortIndicator;

    function isImageAttachment(fileName, previewUrl) {
      var source = String(fileName || previewUrl || "").toLowerCase();
      return /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:$|[?#])/.test(source);
    }

    function isPdfAttachment(fileName, previewUrl) {
      var source = String(fileName || previewUrl || "").toLowerCase();
      return /\.pdf(?:$|[?#])/.test(source);
    }

    function buildAttachmentPreviewBody(fileName, previewUrl) {
      if (previewUrl && isImageAttachment(fileName, previewUrl)) {
        return '<div class="selected-invoice-attachment-popup-body"><img class="attachment-preview-image" src="' + helpers.escapeHtml(previewUrl) + '" alt="' + helpers.escapeHtml(fileName) + '"></div>';
      }

      if (previewUrl && isPdfAttachment(fileName, previewUrl)) {
        return '<div class="selected-invoice-attachment-popup-body"><iframe class="attachment-preview-frame" src="' + helpers.escapeHtml(previewUrl) + '#toolbar=0&navpanes=0" title="' + helpers.escapeHtml(fileName) + '"></iframe></div>';
      }

      return '<div class="selected-invoice-attachment-popup-body"><div class="attachment-preview-body-generic">Inline preview is not available for this file type.</div></div>';
    }

    function getCandidateNumber(record, candidates, fallbackCandidates) {
      var value = helpers.getCandidateValue(record, candidates);

      if ((value === "" || value === null || value === undefined) && fallbackCandidates) {
        value = helpers.getCandidateValue(record, fallbackCandidates);
      }

      if (value === "" || value === null || value === undefined) {
        return null;
      }

      value = Number(value);
      return Number.isFinite(value) ? value : 0;
    }

    function formatCandidateCurrency(record, candidates, fallbackCandidates) {
      var value = getCandidateNumber(record, candidates, fallbackCandidates);
      return value === null ? "-" : helpers.formatCurrency(value);
    }

    function formatCandidatePercent(record, candidates) {
      var value = helpers.getCandidateValue(record, candidates);
      var numericValue;

      if (value === "" || value === null || value === undefined) {
        return "-";
      }

      numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return helpers.textValue(value);
      }

      return numericValue.toFixed(2).replace(/\.?0+$/, "") + "%";
    }

    function formatTaxSummary(record, amountCandidates, percentCandidates) {
      var amountText = formatCandidateCurrency(record, amountCandidates);
      var percentText = formatCandidatePercent(record, percentCandidates);

      if (amountText === "-" && percentText === "-") {
        return "-";
      }

      return amountText + " (" + percentText + ")";
    }

    function joinDisplayParts(primaryValue, secondaryValue) {
      var normalizedPrimary = helpers.textValue(primaryValue);
      var normalizedSecondary = helpers.textValue(secondaryValue);

      if (normalizedPrimary === "-" && normalizedSecondary === "-") {
        return "-";
      }

      return normalizedPrimary + " | " + normalizedSecondary;
    }

    function renderSelectedInvoice(view, tabState, callbacks, attachmentHelpers) {
      var isInfoTab = tabState.selectedInvoiceDetailTab !== "payment" && tabState.selectedInvoiceDetailTab !== "accounting";
      var isPaymentTab = tabState.selectedInvoiceDetailTab === "payment";
      var isAccountingTab = tabState.selectedInvoiceDetailTab === "accounting";
      var selectedPreviewUrl;
      var selectedPreviewFileName;
      var selectedPreviewMarkup;

      if (elements.selectedInvoiceTabBasic) {
        elements.selectedInvoiceTabBasic.onclick = function () {
          callbacks.onInvoiceDetailTabChange("basic");
        };
      }
      if (elements.selectedInvoiceTabPayment) {
        elements.selectedInvoiceTabPayment.onclick = function () {
          callbacks.onInvoiceDetailTabChange("payment");
        };
      }
      if (elements.selectedInvoiceTabAccounting) {
        elements.selectedInvoiceTabAccounting.onclick = function () {
          callbacks.onInvoiceDetailTabChange("accounting");
        };
      }

      if (elements.selectedInvoicePanel) {
        elements.selectedInvoicePanel.hidden = Boolean(state.paymentCreation.isOpen);
      }

      if (!view.selectedInvoice) {
        elements.selectedInvoiceEmpty.hidden = false;
        elements.selectedInvoiceContent.hidden = true;
        elements.selectedInvoiceDeletePanel.hidden = true;
        if (elements.selectedInvoiceBasicView) {
          elements.selectedInvoiceBasicView.hidden = false;
        }
        if (elements.selectedInvoicePaymentView) {
          elements.selectedInvoicePaymentView.hidden = true;
        }
        if (elements.selectedInvoiceAccountingView) {
          elements.selectedInvoiceAccountingView.hidden = true;
        }
        if (elements.selectedInvoiceAccountingActions) {
          elements.selectedInvoiceAccountingActions.hidden = true;
        }
        if (elements.selectedInvoiceLinesEmpty) {
          elements.selectedInvoiceLinesEmpty.textContent = "This invoice has no invoice lines yet.";
          elements.selectedInvoiceLinesEmpty.hidden = false;
        }
        if (elements.selectedInvoiceLinesTableWrap) {
          elements.selectedInvoiceLinesTableWrap.hidden = true;
        }
        if (elements.selectedInvoiceLinesList) {
          elements.selectedInvoiceLinesList.innerHTML = "";
        }
        elements.selectedInvoiceAllocationsEmpty.textContent = "This invoice has no supplier pay allocations yet.";
        elements.selectedInvoiceAllocationsEmpty.hidden = false;
        elements.selectedInvoiceAllocationsTableWrap.hidden = true;
        elements.selectedInvoiceAllocationsList.innerHTML = "";
        if (elements.selectedInvoiceAttachmentsEmpty) {
          elements.selectedInvoiceAttachmentsEmpty.textContent = "This invoice has no attachments yet.";
          elements.selectedInvoiceAttachmentsEmpty.hidden = false;
        }
        if (elements.selectedInvoiceAttachmentsTableWrap) {
          elements.selectedInvoiceAttachmentsTableWrap.hidden = true;
        }
        if (elements.selectedInvoiceAttachmentsList) {
          elements.selectedInvoiceAttachmentsList.innerHTML = "";
        }
        if (elements.selectedInvoiceAttachmentsPreview) {
          elements.selectedInvoiceAttachmentsPreview.hidden = true;
          elements.selectedInvoiceAttachmentsPreview.innerHTML = "";
        }
        return;
      }

      elements.selectedInvoiceEmpty.hidden = true;
      elements.selectedInvoiceContent.hidden = false;
      elements.selectedInvoiceTitle.textContent = helpers.getInvoiceDisplayNumber(view.selectedInvoice, fieldCandidates);
      if (elements.selectedInvoiceCreatedBy) {
        elements.selectedInvoiceCreatedBy.textContent = "Created by " + helpers.textValue(helpers.getLookupName(view.selectedInvoice.Created_By));
      }
      elements.selectedInvoiceStatus.textContent = helpers.textValue(view.selectedInvoice.Status);
      elements.selectedInvoiceStatus.className = "status-pill " + helpers.getStatusTone(view.selectedInvoice.Status);
      elements.selectedInvoiceSupplier.textContent = joinDisplayParts(
        view.getSupplierName(view.selectedInvoice),
        view.getSupplierDisplay(view.selectedInvoice).code
      );
      elements.selectedInvoiceDate.textContent = helpers.formatDate(view.selectedInvoice.Invoice_Date);
      if (elements.selectedInvoiceType) {
        elements.selectedInvoiceType.textContent = helpers.textValue(
          helpers.getCandidateValue(view.selectedInvoice, fieldCandidates.invoice.invoiceType)
        );
      }
      elements.selectedInvoiceBooking.textContent = joinDisplayParts(
        helpers.getLookupDisplayValue(view.selectedInvoice, fieldCandidates.invoice.booking),
        view.getMfsp(view.selectedInvoice)
      );
      if (elements.selectedInvoiceAmountExclVat) {
        elements.selectedInvoiceAmountExclVat.textContent = formatCandidateCurrency(view.selectedInvoice, fieldCandidates.invoice.amountExclVat);
      }
      if (elements.selectedInvoiceAmountInclVat) {
        elements.selectedInvoiceAmountInclVat.textContent = formatCandidateCurrency(view.selectedInvoice, fieldCandidates.invoice.amountInclVat, fieldCandidates.invoice.amount);
      }
      if (elements.selectedInvoiceReimbursableExpense) {
        elements.selectedInvoiceReimbursableExpense.textContent = formatCandidateCurrency(view.selectedInvoice, fieldCandidates.invoice.reimbursableExpense);
      }
      if (elements.selectedInvoiceVatSummary) {
        elements.selectedInvoiceVatSummary.textContent = formatTaxSummary(
          view.selectedInvoice,
          fieldCandidates.invoice.vatAmount,
          fieldCandidates.invoice.vatPercent
        );
      }
      if (elements.selectedInvoiceAdditionalAmountInclVat) {
        elements.selectedInvoiceAdditionalAmountInclVat.textContent = formatCandidateCurrency(
          view.selectedInvoice,
          fieldCandidates.invoice.additionalAmountInclVat
        );
      }
      if (elements.selectedInvoiceAdditionalVatSummary) {
        elements.selectedInvoiceAdditionalVatSummary.textContent = formatTaxSummary(
          view.selectedInvoice,
          fieldCandidates.invoice.additionalVatAmount,
          fieldCandidates.invoice.additionalVatPercent
        );
      }
      if (elements.selectedInvoiceAdditionalIrpfSummary) {
        elements.selectedInvoiceAdditionalIrpfSummary.textContent = formatTaxSummary(
          view.selectedInvoice,
          fieldCandidates.invoice.additionalIrpfAmount,
          fieldCandidates.invoice.additionalIrpfPercent
        );
      }
      if (elements.selectedInvoiceIrpfSummary) {
        elements.selectedInvoiceIrpfSummary.textContent = formatTaxSummary(
          view.selectedInvoice,
          fieldCandidates.invoice.irpfAmount,
          fieldCandidates.invoice.irpfPercent
        );
      }
      elements.selectedInvoiceTotal.textContent = formatCandidateCurrency(
        view.selectedInvoice,
        fieldCandidates.invoice.invoiceTotal,
        fieldCandidates.invoice.totalPayableAmount
      );
      if (elements.selectedInvoiceTotalPayableAmount) {
        elements.selectedInvoiceTotalPayableAmount.textContent = formatCandidateCurrency(
          view.selectedInvoice,
          fieldCandidates.invoice.totalPayableAmount,
          fieldCandidates.invoice.invoiceTotal
        );
      }
      if (elements.selectedInvoiceAccountingStatus) {
        setTextWithTitle(elements.selectedInvoiceAccountingStatus, helpers.textValue(helpers.getCandidateValue(view.selectedInvoice, fieldCandidates.invoice.accountingStatus)));
      }
      if (elements.selectedInvoiceAccountingPostedAt) {
        setTextWithTitle(elements.selectedInvoiceAccountingPostedAt, helpers.textValue(view.selectedInvoice.Accounting_Posted_At));
      }
      elements.selectedInvoiceDeletePanel.hidden = !state.invoiceDeletion.isOpen;
      elements.selectedInvoiceDeleteUpdateSettlement.checked = Boolean(state.invoiceDeletion.updateSettlement);
      if (elements.selectedInvoiceTabBasic) {
        elements.selectedInvoiceTabBasic.classList.toggle("is-active", isInfoTab);
        elements.selectedInvoiceTabBasic.setAttribute("aria-selected", isInfoTab ? "true" : "false");
      }
      if (elements.selectedInvoiceTabPayment) {
        elements.selectedInvoiceTabPayment.classList.toggle("is-active", isPaymentTab);
        elements.selectedInvoiceTabPayment.setAttribute("aria-selected", isPaymentTab ? "true" : "false");
      }
      if (elements.selectedInvoiceTabAccounting) {
        elements.selectedInvoiceTabAccounting.classList.toggle("is-active", isAccountingTab);
        elements.selectedInvoiceTabAccounting.setAttribute("aria-selected", isAccountingTab ? "true" : "false");
      }
      if (elements.selectedInvoiceBasicView) {
        elements.selectedInvoiceBasicView.hidden = !isInfoTab;
      }
      if (elements.selectedInvoicePaymentView) {
        elements.selectedInvoicePaymentView.hidden = !isPaymentTab;
      }
      if (elements.selectedInvoiceAccountingView) {
        elements.selectedInvoiceAccountingView.hidden = !isAccountingTab;
      }
      if (elements.selectedInvoiceAccountingActions) {
        elements.selectedInvoiceAccountingActions.hidden = !isAccountingTab;
      }

      if (view.selectedInvoiceDeleteImpact) {
        elements.selectedInvoiceDeleteCopy.textContent = view.selectedInvoiceDeleteImpact.settlementName
          ? "Delete this invoice? This cannot be undone and may leave settlement totals inconsistent."
          : "Delete this invoice? This action cannot be undone.";
        elements.selectedInvoiceDeleteWarning.textContent = view.selectedInvoiceDeleteImpact.warningMessage;
        elements.selectedInvoiceDeleteWarning.hidden = !view.selectedInvoiceDeleteImpact.warningMessage;
      } else {
        elements.selectedInvoiceDeleteCopy.textContent = "Delete this invoice? This action cannot be undone.";
        elements.selectedInvoiceDeleteWarning.textContent = "";
        elements.selectedInvoiceDeleteWarning.hidden = true;
      }

      if (view.selectedInvoiceLinesLoading) {
        elements.selectedInvoiceLinesEmpty.textContent = "Loading invoice lines...";
        elements.selectedInvoiceLinesEmpty.hidden = false;
        elements.selectedInvoiceLinesTableWrap.hidden = true;
        elements.selectedInvoiceLinesList.innerHTML = "";
      } else if (!view.selectedInvoiceLines.length) {
        elements.selectedInvoiceLinesEmpty.textContent = "This invoice has no invoice lines yet.";
        elements.selectedInvoiceLinesEmpty.hidden = false;
        elements.selectedInvoiceLinesTableWrap.hidden = true;
        elements.selectedInvoiceLinesList.innerHTML = "";
      } else {
        elements.selectedInvoiceLinesList.innerHTML = view.selectedInvoiceLines.map(function (invoiceLine) {
          return [
            "<tr>",
            "  <td>" + helpers.escapeHtml(helpers.formatDate(invoiceLine.Service_Date)) + "</td>",
            '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(invoiceLine.Amount)) + "</td>",
            "  <td>" + helpers.escapeHtml(helpers.getLookupName(invoiceLine.Booking_Service) || invoiceLine.Name || "-") + "</td>",
            "</tr>"
          ].join("");
        }).join("");
        elements.selectedInvoiceLinesEmpty.hidden = true;
        elements.selectedInvoiceLinesTableWrap.hidden = false;
      }

      if (view.selectedInvoiceAllocationsLoading) {
        elements.selectedInvoiceAllocationsEmpty.textContent = "Loading supplier pay allocations...";
        elements.selectedInvoiceAllocationsEmpty.hidden = false;
        elements.selectedInvoiceAllocationsTableWrap.hidden = true;
        elements.selectedInvoiceAllocationsList.innerHTML = "";
      } else if (!view.selectedInvoiceAllocations.length) {
        elements.selectedInvoiceAllocationsEmpty.textContent = "This invoice has no supplier pay allocations yet.";
        elements.selectedInvoiceAllocationsEmpty.hidden = false;
        elements.selectedInvoiceAllocationsTableWrap.hidden = true;
        elements.selectedInvoiceAllocationsList.innerHTML = "";
      } else {
        elements.selectedInvoiceAllocationsList.innerHTML = view.selectedInvoiceAllocations.map(function (allocation) {
          var movementType = allocation.Movement_Type || "-";

          return [
            "<tr>",
            "  <td>" + helpers.escapeHtml(helpers.getLookupName(allocation.Supplier_Payment) || allocation.Name || "-") +
              (movementType && movementType !== "-"
                ? ' <span class="table-inline-secondary">| ' + helpers.escapeHtml(movementType) + "</span>"
                : "") + "</td>",
            '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(allocation.Allocated_Amount)) + "</td>",
            "  <td>" + helpers.escapeHtml(helpers.formatDate(allocation.Allocation_Date)) + "</td>",
            "</tr>"
          ].join("");
        }).join("");
        elements.selectedInvoiceAllocationsEmpty.hidden = true;
        elements.selectedInvoiceAllocationsTableWrap.hidden = false;
      }

      if (view.selectedInvoiceAttachmentsLoading) {
        elements.selectedInvoiceAttachmentsEmpty.textContent = "Loading invoice attachments...";
        elements.selectedInvoiceAttachmentsEmpty.hidden = false;
        elements.selectedInvoiceAttachmentsTableWrap.hidden = true;
        elements.selectedInvoiceAttachmentsList.innerHTML = "";
        if (elements.selectedInvoiceAttachmentsPreview) {
          elements.selectedInvoiceAttachmentsPreview.hidden = true;
          elements.selectedInvoiceAttachmentsPreview.innerHTML = "";
        }
      } else if (!view.selectedInvoiceAttachments.length) {
        elements.selectedInvoiceAttachmentsEmpty.textContent = "This invoice has no attachments yet.";
        elements.selectedInvoiceAttachmentsEmpty.hidden = false;
        elements.selectedInvoiceAttachmentsTableWrap.hidden = true;
        elements.selectedInvoiceAttachmentsList.innerHTML = "";
        if (elements.selectedInvoiceAttachmentsPreview) {
          elements.selectedInvoiceAttachmentsPreview.hidden = true;
          elements.selectedInvoiceAttachmentsPreview.innerHTML = "";
        }
      } else {
        elements.selectedInvoiceAttachmentsList.innerHTML = view.selectedInvoiceAttachments.map(function (attachment, index) {
          var fileName = attachmentHelpers.getAttachmentFileName(attachment) || ("Attachment " + String(index + 1));
          var previewKey = attachmentHelpers.getAttachmentKey(attachment, index);

          return [
            "<tr>",
            '  <td class="selected-invoice-attachment-file-cell"><a class="supplier-inline-link" href="#" data-selected-invoice-attachment-preview="' + helpers.escapeHtml(previewKey) + '">' + helpers.escapeHtml(fileName) + "</a></td>",
            "</tr>"
          ].join("");
        }).join("");
        elements.selectedInvoiceAttachmentsEmpty.hidden = true;
        elements.selectedInvoiceAttachmentsTableWrap.hidden = false;
        if (elements.selectedInvoiceAttachmentsPreview && view.selectedInvoiceAttachmentPreview) {
          selectedPreviewUrl = attachmentHelpers.getAttachmentPreviewUrl(view.selectedInvoiceAttachmentPreview);
          selectedPreviewFileName = attachmentHelpers.getAttachmentFileName(view.selectedInvoiceAttachmentPreview) || "Attachment";
          selectedPreviewMarkup = buildAttachmentPreviewBody(selectedPreviewFileName, selectedPreviewUrl);
          elements.selectedInvoiceAttachmentsPreview.innerHTML = [
            '<div class="selected-invoice-attachment-popup-card" role="document">',
            '  <div class="selected-invoice-attachment-popup-top">',
            '    <div class="selected-invoice-attachment-popup-meta">',
            '      <strong>' + helpers.escapeHtml(selectedPreviewFileName) + "</strong>",
            '      <span>' + helpers.escapeHtml(attachmentHelpers.getAttachmentCategory(view.selectedInvoiceAttachmentPreview) || "Attachment") + "</span>",
            "    </div>",
            '    <div class="selected-invoice-attachment-popup-actions">',
            selectedPreviewUrl
              ? '      <a class="button secondary compact-action-button attachment-preview-link" href="' + helpers.escapeHtml(selectedPreviewUrl) + '" target="_blank" rel="noopener">Open in new tab</a>'
              : '      <button class="button secondary compact-action-button attachment-preview-link" type="button" disabled>Open in new tab</button>',
            '      <button class="button secondary compact-action-button" type="button" data-close-selected-invoice-attachment-preview="true">Close</button>',
            "    </div>",
            "  </div>",
            selectedPreviewMarkup,
            "</div>"
          ].join("");
          elements.selectedInvoiceAttachmentsPreview.hidden = false;
        } else if (elements.selectedInvoiceAttachmentsPreview) {
          elements.selectedInvoiceAttachmentsPreview.hidden = true;
          elements.selectedInvoiceAttachmentsPreview.innerHTML = "";
        }
      }
    }

    function renderInvoiceTable(view, listState, callbacks, attachmentHelpers) {
      var currentToggleAllInvoices;

      if (!view.filteredRecords.length) {
        elements.invoicesEmpty.textContent = view.emptyMessage;
        elements.invoicesEmpty.hidden = false;
        elements.invoicesTableWrap.hidden = true;
        elements.invoicesPaginationBar.hidden = true;
        elements.invoicesTableBody.innerHTML = "";
        if (elements.toggleAllInvoices) {
          elements.toggleAllInvoices.checked = false;
          elements.toggleAllInvoices.indeterminate = false;
        }
        return;
      }

      if (elements.invoicesTableHead) {
        elements.invoicesTableHead.innerHTML = listState.showAttachmentsColumn ? [
          "<tr>",
          '  <th class="checkbox-column"><input id="toggle-all-invoices" class="table-checkbox" type="checkbox" aria-label="Select visible invoices"></th>',
          "  <th data-invoice-sort=\"supplierCode\">Supplier code</th>",
          "  <th data-invoice-sort=\"mfsp\">MFSP</th>",
          "  <th data-invoice-sort=\"invoice\">Invoice</th>",
          '  <th class="invoice-attachment-files-column" data-invoice-sort="invoiceFile">Invoice file</th>',
          "  <th data-invoice-sort=\"date\">Date</th>",
          '  <th class="numeric-cell" data-invoice-sort="total">Total Payable Amount</th>',
          "  <th data-invoice-sort=\"status\">Status</th>",
          "  <th data-invoice-sort=\"invoiceType\">Invoice Type</th>",
          "</tr>"
        ].join("") : [
          "<tr>",
          '  <th class="checkbox-column"><input id="toggle-all-invoices" class="table-checkbox" type="checkbox" aria-label="Select visible invoices"></th>',
          "  <th data-invoice-sort=\"supplierCode\">Supplier code</th>",
          "  <th data-invoice-sort=\"mfsp\">MFSP</th>",
          "  <th data-invoice-sort=\"invoice\">Invoice</th>",
          "  <th data-invoice-sort=\"date\">Date</th>",
          "  <th class=\"numeric-cell\" data-invoice-sort=\"total\">Total Payable Amount</th>",
          "  <th data-invoice-sort=\"status\">Status</th>",
          "  <th data-invoice-sort=\"invoiceType\">Invoice Type</th>",
          "</tr>"
        ].join("");
      }

      currentToggleAllInvoices = elements.invoicesTableHead
        ? elements.invoicesTableHead.querySelector("#toggle-all-invoices")
        : elements.toggleAllInvoices;

      elements.invoicesTableBody.innerHTML = view.visibleRecords.map(function (invoice) {
        var isActive = invoice.id === view.selectedDetailId;
        var isChecked = Boolean(state.views.invoices.selectedIds[invoice.id]);
        var supplierDisplay = view.getSupplierDisplay
          ? view.getSupplierDisplay(invoice)
          : { name: view.getSupplierName(invoice), code: "" };
        var hasCachedInvoiceAttachments = Boolean(state.invoiceAttachmentsByInvoiceId) &&
          Object.prototype.hasOwnProperty.call(state.invoiceAttachmentsByInvoiceId, invoice.id);
        var loadedInvoiceAttachments = hasCachedInvoiceAttachments && state.invoiceAttachmentsByInvoiceId && state.invoiceAttachmentsByInvoiceId[invoice.id]
          ? state.invoiceAttachmentsByInvoiceId[invoice.id].filter(function (attachment) {
            return String(attachment && attachment.Source_Field || "") === "Invoice_File";
          })
          : [];
        var invoiceFileAttachments = loadedInvoiceAttachments.length
          ? loadedInvoiceAttachments
          : attachmentHelpers.getInvoiceAttachmentsForField(invoice, "Invoice_File");
        var invoiceFileMarkup = "";

        if (listState.showAttachmentsColumn) {
          invoiceFileMarkup = invoiceFileAttachments.length
            ? '<div class="invoice-attachments-summary">' + invoiceFileAttachments.map(function (attachment, index) {
              var previewKey = attachmentHelpers.getAttachmentKey(attachment, index);

              return '<div class="invoice-attachments-summary-item">' +
                '<a class="supplier-inline-link" href="#" data-invoice-attachment-preview="' + helpers.escapeHtml(previewKey) + '" data-invoice-attachment-invoice-id="' + helpers.escapeHtml(invoice.id) + '">' +
                helpers.escapeHtml(attachmentHelpers.getAttachmentFileName(attachment) || ("Invoice " + String(index + 1))) +
                "</a>" +
                "</div>";
            }).join("") + "</div>"
            : !hasCachedInvoiceAttachments
            ? '<span class="table-inline-secondary">Loading...</span>'
            : '<span class="table-inline-secondary">No files</span>';
        }

        return listState.showAttachmentsColumn ? [
          '<tr class="is-clickable' + (isActive ? " is-active" : "") + (isChecked ? " is-checked" : "") + '" data-invoice-id="' + helpers.escapeHtml(invoice.id) + '">',
          '  <td class="checkbox-column"><input class="table-checkbox" type="checkbox" data-invoice-checkbox="' + helpers.escapeHtml(invoice.id) + '"' + (isChecked ? " checked" : "") + ' aria-label="Select invoice"></td>',
          "  <td>" + helpers.escapeHtml(supplierDisplay.code || "-") + "</td>",
          "  <td>" + helpers.escapeHtml(view.getMfsp(invoice) || "-") + "</td>",
          '  <td><a class="supplier-inline-link invoice-native-link" href="#" data-invoice-open-native="' + helpers.escapeHtml(invoice.id) + '">' + helpers.escapeHtml(helpers.getInvoiceDisplayNumber(invoice, fieldCandidates)) + "</a></td>",
          '  <td class="invoice-attachment-files-cell">' + invoiceFileMarkup + "</td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(invoice.Invoice_Date)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(formatCandidateCurrency(invoice, fieldCandidates.invoice.totalPayableAmount, fieldCandidates.invoice.invoiceTotal)) + "</td>",
          "  <td><span class=\"status-pill " + helpers.escapeHtml(helpers.getStatusTone(invoice.Status)) + "\">" + helpers.escapeHtml(invoice.Status || "-") + "</span></td>",
          "  <td>" + helpers.escapeHtml(helpers.textValue(helpers.getCandidateValue(invoice, fieldCandidates.invoice.invoiceType))) + "</td>",
          "</tr>"
        ].join("") : [
          '<tr class="is-clickable' + (isActive ? " is-active" : "") + (isChecked ? " is-checked" : "") + '" data-invoice-id="' + helpers.escapeHtml(invoice.id) + '">',
          '  <td class="checkbox-column"><input class="table-checkbox" type="checkbox" data-invoice-checkbox="' + helpers.escapeHtml(invoice.id) + '"' + (isChecked ? " checked" : "") + ' aria-label="Select invoice"></td>',
          "  <td>" + helpers.escapeHtml(supplierDisplay.code || "-") + "</td>",
          "  <td>" + helpers.escapeHtml(view.getMfsp(invoice) || "-") + "</td>",
          '  <td><a class="supplier-inline-link invoice-native-link" href="#" data-invoice-open-native="' + helpers.escapeHtml(invoice.id) + '">' + helpers.escapeHtml(helpers.getInvoiceDisplayNumber(invoice, fieldCandidates)) + "</a></td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(invoice.Invoice_Date)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(formatCandidateCurrency(invoice, fieldCandidates.invoice.totalPayableAmount, fieldCandidates.invoice.invoiceTotal)) + "</td>",
          "  <td><span class=\"status-pill " + helpers.escapeHtml(helpers.getStatusTone(invoice.Status)) + "\">" + helpers.escapeHtml(invoice.Status || "-") + "</span></td>",
          "  <td>" + helpers.escapeHtml(helpers.textValue(helpers.getCandidateValue(invoice, fieldCandidates.invoice.invoiceType))) + "</td>",
          "</tr>"
        ].join("");
      }).join("");

      elements.invoicesEmpty.hidden = true;
      elements.invoicesTableWrap.hidden = false;
      if (elements.invoicesTableWrap) {
        Array.prototype.forEach.call(elements.invoicesTableWrap.querySelectorAll(".invoice-results-table"), function (table) {
          table.classList.toggle("show-attachments-column", listState.showAttachmentsColumn);
        });
      }
      elements.invoicesPaginationBar.hidden = view.page <= 1 && !view.hasMore;
      elements.invoicesPaginationCopy.textContent = view.pageSummary;
      elements.invoicesPrevPage.disabled = state.isLoading || view.page <= 1;
      elements.invoicesNextPage.disabled = state.isLoading || !view.hasMore;
      if (currentToggleAllInvoices) {
        currentToggleAllInvoices.checked = view.visibleRecords.length > 0 && view.selectedVisibleCount === view.visibleRecords.length;
        currentToggleAllInvoices.indeterminate = view.selectedVisibleCount > 0 && view.selectedVisibleCount < view.visibleRecords.length;
      }

      Array.prototype.forEach.call(elements.invoicesTableWrap.querySelectorAll("th[data-invoice-sort]"), function (header) {
        var baseLabel = header.getAttribute("data-invoice-sort");
        var displayLabel = stripSortIndicator(header.textContent);
        var isActiveSort = baseLabel === listState.sortKey;
        header.textContent = displayLabel + (isActiveSort ? " " + getSortIndicator(listState.sortDirection) : "");
        header.classList.add("is-clickable");
        header.onclick = function () {
          callbacks.onSortChange(baseLabel);
        };
      });

      Array.prototype.forEach.call(elements.invoicesTableBody.querySelectorAll("input[data-invoice-checkbox]"), function (checkbox) {
        checkbox.addEventListener("change", function () {
          callbacks.onInvoiceChecked(checkbox.getAttribute("data-invoice-checkbox"), checkbox.checked);
        });
      });

      Array.prototype.forEach.call(elements.invoicesTableBody.querySelectorAll("a[data-invoice-open-native]"), function (link) {
        link.addEventListener("click", function (event) {
          event.preventDefault();
          callbacks.onInvoiceAttachmentFallbackOpen(link.getAttribute("data-invoice-open-native"));
        });
      });

      Array.prototype.forEach.call(elements.invoicesTableBody.querySelectorAll("a[data-invoice-attachment-preview]"), function (link) {
        link.addEventListener("click", function (event) {
          event.preventDefault();
          callbacks.onInvoiceSelected(link.getAttribute("data-invoice-attachment-invoice-id"));
          callbacks.onSelectedInvoiceAttachmentPreview(link.getAttribute("data-invoice-attachment-preview"));
        });
      });

      Array.prototype.forEach.call(elements.selectedInvoiceAttachmentsList.querySelectorAll("a[data-selected-invoice-attachment-preview]"), function (link) {
        link.addEventListener("click", function (event) {
          event.preventDefault();
          callbacks.onSelectedInvoiceAttachmentPreview(link.getAttribute("data-selected-invoice-attachment-preview"));
        });
      });

      Array.prototype.forEach.call(elements.invoicesTableBody.querySelectorAll("tr[data-invoice-id]"), function (row) {
        row.addEventListener("click", function (event) {
          var target = event.target;
          var checkbox;
          var invoiceId;

          if (target && (target.closest("input[data-invoice-checkbox]") || target.closest("a") || target.closest("button[data-invoice-attachment-fallback]"))) {
            return;
          }

          checkbox = row.querySelector("input[data-invoice-checkbox]");
          invoiceId = row.getAttribute("data-invoice-id");

          if (!checkbox || !invoiceId) {
            return;
          }

          callbacks.onInvoiceSelected(invoiceId);
        });
      });

      if (currentToggleAllInvoices) {
        currentToggleAllInvoices.onchange = function () {
          callbacks.onToggleAll(currentToggleAllInvoices.checked, view.visibleRecords);
        };
      }

      if (elements.selectedInvoiceAttachmentsPreview) {
        elements.selectedInvoiceAttachmentsPreview.onclick = function (event) {
          var target = event && event.target;

          if (target === elements.selectedInvoiceAttachmentsPreview || (target && target.closest("[data-close-selected-invoice-attachment-preview]"))) {
            callbacks.onSelectedInvoiceAttachmentPreview("");
          }
        };
      }
    }

    function renderInvoiceSelectionSummary(view) {
      if (!view.selectedFilteredRecords.length) {
        elements.invoiceSelectionEmpty.hidden = false;
        elements.invoiceSelectionTableWrap.hidden = true;
        elements.invoiceSelectionList.innerHTML = "";
        return;
      }

      elements.invoiceSelectionList.innerHTML = view.selectedFilteredRecords.map(function (invoice) {
        return [
          "<tr>",
          "  <td>" + helpers.escapeHtml(helpers.getInvoiceDisplayNumber(invoice, fieldCandidates)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(
            helpers.getInvoiceTotalAmount(invoice, fieldCandidates) *
            (helpers.textValue(helpers.getCandidateValue(invoice, fieldCandidates.invoice.invoiceType)) === "Credit Note" ? -1 : 1)
          )) + "</td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(invoice.Invoice_Date)) + "</td>",
          "</tr>"
        ].join("");
      }).join("");
      elements.invoiceSelectionEmpty.hidden = true;
      elements.invoiceSelectionTableWrap.hidden = false;
    }

    function renderInvoicesWorkspace(view, onInvoiceChecked, onInvoiceSelected, onToggleAll, onSortChange, onInvoiceListTabChange, onInvoiceDetailTabChange, onSelectedInvoiceAttachmentPreview, onInvoiceAttachmentFallbackOpen, getInvoiceAttachmentsForField, getAttachmentKey, getAttachmentFileName, getAttachmentCategory, getAttachmentDateValue, getAttachmentPreviewUrl) {
      var listState = {
        sortKey: view.sort && view.sort.key ? view.sort.key : "",
        sortDirection: view.sort && view.sort.direction ? view.sort.direction : "asc",
        selectedInvoiceDetailTab: view.selectedInvoiceDetailTab || "basic",
        showAttachmentsColumn: view.listTab === "attachments"
      };
      var callbacks = {
        onInvoiceChecked: onInvoiceChecked,
        onInvoiceSelected: onInvoiceSelected,
        onToggleAll: onToggleAll,
        onSortChange: onSortChange,
        onInvoiceDetailTabChange: onInvoiceDetailTabChange,
        onSelectedInvoiceAttachmentPreview: onSelectedInvoiceAttachmentPreview,
        onInvoiceAttachmentFallbackOpen: onInvoiceAttachmentFallbackOpen
      };
      var attachmentHelpers = {
        getInvoiceAttachmentsForField: getInvoiceAttachmentsForField,
        getAttachmentKey: getAttachmentKey,
        getAttachmentFileName: getAttachmentFileName,
        getAttachmentCategory: getAttachmentCategory,
        getAttachmentPreviewUrl: getAttachmentPreviewUrl
      };

      if (elements.invoiceFilterSupplierCode) {
        elements.invoiceFilterSupplierCode.value = view.filters.supplierCode || "";
      }
      if (elements.invoiceFilterType) {
        elements.invoiceFilterType.value = view.filters.invoiceType || "";
      }

      elements.invoicesCount.textContent = view.countLabel;
      elements.invoiceSummaryMatched.textContent = String(view.filteredRecords.length);
      elements.invoiceSummaryFilteredAmount.textContent = helpers.formatCurrency(view.filteredTotalAmount);
      elements.invoiceSummarySelectedCount.textContent = String(view.selectedFilteredRecords.length);
      elements.invoiceSummarySelectedAmount.textContent = helpers.formatCurrency(view.selectedFilteredAmount);
      elements.invoiceCreatePayment.hidden = view.selectedFilteredRecords.length === 0;

      if (elements.invoicesShowAttachments) {
        elements.invoicesShowAttachments.checked = listState.showAttachmentsColumn;
        elements.invoicesShowAttachments.onchange = function () {
          onInvoiceListTabChange(elements.invoicesShowAttachments.checked ? "attachments" : "basic");
        };
      }

      renderInvoiceSelectionSummary(view);
      renderSelectedInvoice(view, listState, callbacks, attachmentHelpers);
      renderInvoiceTable(view, listState, callbacks, attachmentHelpers);
    }

    return {
      renderInvoicesWorkspace: renderInvoicesWorkspace
    };
  };
}(window));
