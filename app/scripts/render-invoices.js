(function (global) {
var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createInvoicesRenderer = function (deps) {
    var elements = deps.elements;
    var state = deps.state;
    var helpers = deps.helpers;
    var fieldCandidates = deps.fieldCandidates;
    var setTextWithTitle = deps.setTextWithTitle;
    var stripSortIndicator = deps.stripSortIndicator;
    var getSortIndicator = deps.getSortIndicator;

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

    function formatInvoiceTypeBadge(invoice) {
      var invoiceType = helpers.textValue(helpers.getCandidateValue(invoice, fieldCandidates.invoice.invoiceType));
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

    function normalizeInvoiceFiles(value) {
      return (Array.isArray(value) ? value : value ? [value] : []).map(function (file, index) {
        if (typeof file === "string") {
          return { name: "Invoice file " + String(index + 1), id: file, url: "", type: "" };
        }

        return {
          name: String(file && (file.File_Name || file.file_Name || file.file_name || file.filename || file.fileName || file.name) || "Invoice file " + String(index + 1)),
          id: String(file && (file.$file_id || file.file_id || file.file_Id || file.File_Id || file.id) || ""),
          url: String(file && (file.url || file.file_url || file.preview_url || file.download_url) || ""),
          type: String(file && (file.type || file.mime_type || file.content_type) || "")
        };
      });
    }

    function toInvoiceFileBlob(source, type) {
      if (source instanceof Blob) { return source; }
      if (source instanceof ArrayBuffer || (source && ArrayBuffer.isView(source))) {
        return new Blob([source], { type: type || "application/octet-stream" });
      }
      return new Blob([source], { type: type || "application/octet-stream" });
    }

    function showInvoiceFilePreview(file) {
      var modal = document.createElement("div");
      var content;
      var close;

      modal.className = "operations-file-preview";
      modal.innerHTML = '<div class="operations-file-preview-backdrop"></div><section class="operations-file-preview-card" role="dialog" aria-modal="true" aria-label="File preview"><header><strong>' + helpers.escapeHtml(file.name) + '</strong><button type="button" aria-label="Close">&times;</button></header><div class="operations-file-preview-content">Loading preview...</div></section>';
      content = modal.querySelector(".operations-file-preview-content");
      close = function () {
        if (modal._objectUrl) { global.URL.revokeObjectURL(modal._objectUrl); }
        modal.remove();
      };
      modal.querySelector(".operations-file-preview-backdrop").onclick = close;
      modal.querySelector("button").onclick = close;
      document.body.appendChild(modal);

      Promise.resolve(file.url || (file.id && global.ZOHO && global.ZOHO.CRM && global.ZOHO.CRM.API && global.ZOHO.CRM.API.getFile({ id: file.id }))).then(function (source) {
        var blob;
        var url;
        var isImage;
        var isPdf;

        if (!source) { throw new Error("File is not available for preview."); }
        blob = toInvoiceFileBlob(source, file.type);
        url = typeof source === "string" && /^(https?:|data:|blob:)/i.test(source) ? source : global.URL.createObjectURL(blob);
        isImage = /^image\//i.test(blob.type || file.type) || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(file.name);
        isPdf = /^application\/pdf$/i.test(blob.type || file.type) || /\.pdf$/i.test(file.name);
        if (url.indexOf("blob:") === 0) { modal._objectUrl = url; }
        content.innerHTML = isImage
          ? '<img src="' + helpers.escapeHtml(url) + '" alt="' + helpers.escapeHtml(file.name) + '">'
          : isPdf
          ? '<iframe src="' + helpers.escapeHtml(url) + '" title="' + helpers.escapeHtml(file.name) + '"></iframe>'
          : '<p>This file cannot be previewed here.</p><a class="button secondary" href="' + helpers.escapeHtml(url) + '" download="' + helpers.escapeHtml(file.name) + '">Download file</a>';
      }).catch(function () {
        content.innerHTML = '<p class="operations-file-preview-error">The file preview could not be loaded.</p>';
      });
    }

    function renderSelectedInvoiceAttachments(invoice) {
      var files = normalizeInvoiceFiles(invoice && invoice.Invoice_File);

      if (!elements.selectedInvoiceAttachmentsList) {
        return;
      }

      if (invoice && invoice._invoiceFileLoading) {
        elements.selectedInvoiceAttachmentsList.innerHTML = '<span class="selected-invoice-attachments-empty">Loading attachments...</span>';
        return;
      }

      if (!files.length) {
        elements.selectedInvoiceAttachmentsList.innerHTML = '<span class="selected-invoice-attachments-empty">This invoice has no attachments.</span>';
        return;
      }

      elements.selectedInvoiceAttachmentsList.innerHTML = files.map(function (file, index) {
        return '<button class="card-purchase-file" type="button" data-invoice-file-index="' + index + '" title="Preview ' + helpers.escapeHtml(file.name) + '">' + helpers.escapeHtml(file.name) + "</button>";
      }).join("");
      elements.selectedInvoiceAttachmentsList.onclick = function (event) {
        var button = event.target && event.target.closest("[data-invoice-file-index]");
        var index;

        if (!button) {
          return;
        }
        index = Number(button.getAttribute("data-invoice-file-index"));
        if (files[index]) {
          showInvoiceFilePreview(files[index]);
        }
      };
    }

    function renderSelectedInvoice(view, tabState, callbacks) {
      var isInfoTab = tabState.selectedInvoiceDetailTab !== "payment" && tabState.selectedInvoiceDetailTab !== "accounting";
      var isPaymentTab = tabState.selectedInvoiceDetailTab === "payment";
      var isAccountingTab = tabState.selectedInvoiceDetailTab === "accounting";

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
        return;
      }

      elements.selectedInvoiceEmpty.hidden = true;
      elements.selectedInvoiceContent.hidden = false;
      elements.selectedInvoiceTitle.textContent = helpers.getInvoiceDisplayNumber(view.selectedInvoice, fieldCandidates);
      if (elements.selectedInvoiceCreatedBy) {
        elements.selectedInvoiceCreatedBy.textContent = "Created by " + helpers.textValue(helpers.getLookupName(
          view.selectedInvoice.Created_By || view.selectedInvoice.CreatedBy || view.selectedInvoice["Created By"]
        ));
      }
      elements.selectedInvoiceStatus.textContent = helpers.textValue(view.selectedInvoice.Status);
      elements.selectedInvoiceStatus.className = "status-pill " + helpers.getStatusTone(view.selectedInvoice.Status);
      renderSelectedInvoiceAttachments(view.selectedInvoice);
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

    }

    function renderInvoiceTable(view, listState, callbacks) {
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
        elements.invoicesTableHead.innerHTML = listState.showAttachments ? [
          "<tr>",
          '  <th class="checkbox-column"><input id="toggle-all-invoices" class="table-checkbox" type="checkbox" aria-label="Select visible invoices"></th>',
          "  <th data-invoice-sort=\"supplierCode\">Supplier code</th>",
          "  <th data-invoice-sort=\"mfsp\">MFSP</th>",
          "  <th data-invoice-sort=\"invoice\">Invoice</th>",
          '  <th class="invoice-attachment-files-column">Attachment</th>',
          "  <th data-invoice-sort=\"date\">Date</th>",
          "  <th class=\"numeric-cell\" data-invoice-sort=\"total\">Total Payable Amount</th>",
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
        var invoiceFiles = normalizeInvoiceFiles(invoice.Invoice_File);
        var attachmentMarkup = "";

        if (listState.showAttachments && !Object.prototype.hasOwnProperty.call(invoice, "Invoice_File")) {
          callbacks.onInvoiceFilesNeeded(invoice.id);
          attachmentMarkup = '<span class="table-inline-secondary">Loading...</span>';
        } else if (listState.showAttachments && !invoiceFiles.length) {
          attachmentMarkup = '<span class="table-inline-secondary">-</span>';
        } else if (listState.showAttachments) {
          attachmentMarkup = '<div class="invoice-attachments-summary">' + invoiceFiles.map(function (file, index) {
            return '<div class="invoice-attachments-summary-item"><button class="card-purchase-file" type="button" data-invoice-file-index="' + index + '" title="Preview ' + helpers.escapeHtml(file.name) + '">' + helpers.escapeHtml(file.name) + '</button></div>';
          }).join("") + "</div>";
        }

        return (listState.showAttachments ? [
          '<tr class="is-clickable' + (isActive ? " is-active" : "") + (isChecked ? " is-checked" : "") + '" data-invoice-id="' + helpers.escapeHtml(invoice.id) + '">',
          '  <td class="checkbox-column"><input class="table-checkbox" type="checkbox" data-invoice-checkbox="' + helpers.escapeHtml(invoice.id) + '"' + (isChecked ? " checked" : "") + ' aria-label="Select invoice"></td>',
          "  <td>" + helpers.escapeHtml(supplierDisplay.code || "-") + "</td>",
          "  <td>" + helpers.escapeHtml(view.getMfsp(invoice) || "-") + "</td>",
          '  <td><a class="supplier-inline-link invoice-native-link" href="#" data-invoice-open-native="' + helpers.escapeHtml(invoice.id) + '">' + helpers.escapeHtml(helpers.getInvoiceDisplayNumber(invoice, fieldCandidates)) + "</a></td>",
          '  <td class="invoice-attachment-files-cell">' + attachmentMarkup + "</td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(invoice.Invoice_Date)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(formatCandidateCurrency(invoice, fieldCandidates.invoice.totalPayableAmount, fieldCandidates.invoice.invoiceTotal)) + "</td>",
          "  <td><span class=\"status-pill " + helpers.escapeHtml(helpers.getStatusTone(invoice.Status)) + "\">" + helpers.escapeHtml(invoice.Status || "-") + "</span></td>",
          "  <td>" + formatInvoiceTypeBadge(invoice) + "</td>",
          "</tr>"
        ] : [
          '<tr class="is-clickable' + (isActive ? " is-active" : "") + (isChecked ? " is-checked" : "") + '" data-invoice-id="' + helpers.escapeHtml(invoice.id) + '">',
          '  <td class="checkbox-column"><input class="table-checkbox" type="checkbox" data-invoice-checkbox="' + helpers.escapeHtml(invoice.id) + '"' + (isChecked ? " checked" : "") + ' aria-label="Select invoice"></td>',
          "  <td>" + helpers.escapeHtml(supplierDisplay.code || "-") + "</td>",
          "  <td>" + helpers.escapeHtml(view.getMfsp(invoice) || "-") + "</td>",
          '  <td><a class="supplier-inline-link invoice-native-link" href="#" data-invoice-open-native="' + helpers.escapeHtml(invoice.id) + '">' + helpers.escapeHtml(helpers.getInvoiceDisplayNumber(invoice, fieldCandidates)) + "</a></td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(invoice.Invoice_Date)) + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(formatCandidateCurrency(invoice, fieldCandidates.invoice.totalPayableAmount, fieldCandidates.invoice.invoiceTotal)) + "</td>",
          "  <td><span class=\"status-pill " + helpers.escapeHtml(helpers.getStatusTone(invoice.Status)) + "\">" + helpers.escapeHtml(invoice.Status || "-") + "</span></td>",
          "  <td>" + formatInvoiceTypeBadge(invoice) + "</td>",
          "</tr>"
        ]).join("");
      }).join("");

      elements.invoicesEmpty.hidden = true;
      elements.invoicesTableWrap.hidden = false;
      Array.prototype.forEach.call(elements.invoicesTableWrap.querySelectorAll(".invoice-results-table"), function (table) {
        table.classList.toggle("show-attachments-column", listState.showAttachments);
      });
      elements.invoicesPaginationBar.hidden = true;
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
          callbacks.onInvoiceOpenNative(link.getAttribute("data-invoice-open-native"));
        });
      });

      Array.prototype.forEach.call(elements.invoicesTableBody.querySelectorAll("button[data-invoice-file-index]"), function (button) {
        button.addEventListener("click", function () {
          var row = button.closest("tr[data-invoice-id]");
          var invoiceId = row && row.getAttribute("data-invoice-id");
          var invoice = view.visibleRecords.find(function (record) {
            return record.id === invoiceId;
          });
          var files = normalizeInvoiceFiles(invoice && invoice.Invoice_File);
          var index = Number(button.getAttribute("data-invoice-file-index"));

          if (files[index]) {
            showInvoiceFilePreview(files[index]);
          }
        });
      });


      Array.prototype.forEach.call(elements.invoicesTableBody.querySelectorAll("tr[data-invoice-id]"), function (row) {
        row.addEventListener("click", function (event) {
          var target = event.target;
          var checkbox;
          var invoiceId;

          if (target && (target.closest("input[data-invoice-checkbox]") || target.closest("a") || target.closest("button[data-invoice-file-index]"))) {
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

    }

    function renderInvoiceSelectionSummary(view, callbacks) {
      if (!view.selectedFilteredRecords.length) {
        elements.invoiceSelectionEmpty.hidden = false;
        elements.invoiceSelectionTableWrap.hidden = true;
        elements.invoiceSelectionList.innerHTML = "";
        return;
      }

      elements.invoiceSelectionList.innerHTML = view.selectedFilteredRecords.map(function (invoice) {
        var supplierDisplay = view.getSupplierDisplay
          ? view.getSupplierDisplay(invoice)
          : { code: "" };

        return [
          "<tr>",
          "  <td>" + helpers.escapeHtml(helpers.getInvoiceDisplayNumber(invoice, fieldCandidates)) + "</td>",
          "  <td>" + helpers.escapeHtml(supplierDisplay.code || "-") + "</td>",
          '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(
            helpers.getInvoiceTotalAmount(invoice, fieldCandidates) *
            (helpers.textValue(helpers.getCandidateValue(invoice, fieldCandidates.invoice.invoiceType)) === "Credit Note" ? -1 : 1)
          )) + "</td>",
          "  <td>" + helpers.escapeHtml(helpers.formatDate(invoice.Invoice_Date)) + "</td>",
          '  <td class="invoice-selection-remove-cell"><button class="invoice-selection-remove" type="button" data-remove-selected-invoice="' + helpers.escapeHtml(invoice.id) + '" aria-label="Remove invoice from selection" title="Remove from selection">&times;</button></td>',
          "</tr>"
        ].join("");
      }).join("");
      elements.invoiceSelectionEmpty.hidden = true;
      elements.invoiceSelectionTableWrap.hidden = false;
      Array.prototype.forEach.call(elements.invoiceSelectionList.querySelectorAll("[data-remove-selected-invoice]"), function (button) {
        button.onclick = function () {
          callbacks.onInvoiceChecked(button.getAttribute("data-remove-selected-invoice"), false);
        };
      });
    }

    function renderInvoicesWorkspace(view, onInvoiceChecked, onInvoiceSelected, onToggleAll, onSortChange, onInvoiceDetailTabChange, onInvoiceOpenNative, onInvoiceFilesNeeded, onShowAttachmentsChange) {
      var isSpecificDateRange = (view.filters.datePreset || "specific") === "specific";
      var listState = {
        sortKey: view.sort && view.sort.key ? view.sort.key : "",
        sortDirection: view.sort && view.sort.direction ? view.sort.direction : "asc",
        selectedInvoiceDetailTab: view.selectedInvoiceDetailTab || "basic",
        showAttachments: Boolean(view.showAttachments)
      };
      var callbacks = {
        onInvoiceChecked: onInvoiceChecked,
        onInvoiceSelected: onInvoiceSelected,
        onToggleAll: onToggleAll,
        onSortChange: onSortChange,
        onInvoiceDetailTabChange: onInvoiceDetailTabChange,
        onInvoiceOpenNative: onInvoiceOpenNative,
        onInvoiceFilesNeeded: onInvoiceFilesNeeded || function () {},
        onShowAttachmentsChange: onShowAttachmentsChange || function () {}
      };

      if (elements.invoiceFilterSupplierCode) {
        elements.invoiceFilterSupplierCode.value = view.filters.supplierCode || "";
      }
      if (elements.invoiceFilterType) {
        elements.invoiceFilterType.value = view.filters.invoiceType || "";
      }
      if (elements.invoiceFilterDatePreset) {
        elements.invoiceFilterDatePreset.value = view.filters.datePreset || "specific";
        elements.invoiceFilterDatePreset.closest(".filters-grid").classList.toggle("is-custom-date-range", isSpecificDateRange);
      }
      if (elements.invoiceFilterDateFrom) {
        elements.invoiceFilterDateFrom.value = view.filters.dateFrom || "";
        elements.invoiceFilterDateFrom.disabled = !isSpecificDateRange;
      }
      if (elements.invoiceFilterDateTo) {
        elements.invoiceFilterDateTo.value = view.filters.dateTo || "";
        elements.invoiceFilterDateTo.disabled = !isSpecificDateRange;
      }

      elements.invoicesCount.textContent = view.countLabel;
      elements.invoiceSummaryMatched.textContent = String(view.filteredRecords.length);
      elements.invoiceSummaryFilteredAmount.textContent = helpers.formatCurrency(view.filteredTotalAmount);
      elements.invoiceSummarySelectedCount.textContent = String(view.selectedFilteredRecords.length);
      elements.invoiceSummarySelectedAmount.textContent = helpers.formatCurrency(view.selectedFilteredAmount);
      elements.invoiceCreatePayment.hidden = view.selectedFilteredRecords.length === 0;

      if (elements.invoicesShowAttachments) {
        elements.invoicesShowAttachments.checked = listState.showAttachments;
        elements.invoicesShowAttachments.onchange = function () {
          callbacks.onShowAttachmentsChange(elements.invoicesShowAttachments.checked);
        };
      }

      renderInvoiceSelectionSummary(view, callbacks);
      renderSelectedInvoice(view, listState, callbacks);
      renderInvoiceTable(view, listState, callbacks);
    }

    return {
      renderInvoicesWorkspace: renderInvoicesWorkspace
    };
  };
}(window));
