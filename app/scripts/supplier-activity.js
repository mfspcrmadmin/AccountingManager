(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createSupplierActivityModule = function (deps) {
    var MODULES = deps.MODULES;
    var FIELD_CANDIDATES = deps.FIELD_CANDIDATES;
    var SEND_SUPPLIER_PAYMENT_LETTER_FUNCTION = deps.SEND_SUPPLIER_PAYMENT_LETTER_FUNCTION;
    var PAYMENT_LETTER_DEFAULT_RECIPIENT = deps.PAYMENT_LETTER_DEFAULT_RECIPIENT;
    var GET_SUPPLIER_CONTACT_BY_TYPE_FUNCTION = deps.GET_SUPPLIER_CONTACT_BY_TYPE_FUNCTION;
    var PAYMENT_LETTER_CONTACT_TYPE = deps.PAYMENT_LETTER_CONTACT_TYPE;
    var state = deps.state;
    var elements = deps.elements;
    var helpers = deps.helpers;
    var crm = deps.crm;
    var renderer = deps.renderer;
    var renderAll = deps.renderAll;
    var debugError = deps.debugError;
    var loadInvoicesForSupplier = deps.loadInvoicesForSupplier;
    var loadPaymentsForSupplier = deps.loadPaymentsForSupplier;
    var getInvoiceSupplierId = deps.getInvoiceSupplierId;
    var sortRecordsByDateDesc = deps.sortRecordsByDateDesc;
    var getFunctionOutputObject = deps.getFunctionOutputObject;
    var getPaymentLetterFunctionResult = deps.getPaymentLetterFunctionResult;
    var getInvoiceBookingDisplay = deps.getInvoiceBookingDisplay;
    var getBookingNameFromPayment = deps.getBookingNameFromPayment;
    var buildSpreadsheetWorkbookXml = deps.buildSpreadsheetWorkbookXml;
    var downloadFileFromText = deps.downloadFileFromText;
    var sanitizeDownloadFileName = deps.sanitizeDownloadFileName;
    var hasValidEmailAddress = deps.hasValidEmailAddress;

    async function refreshSupplierRelatedActivity(options) {
      var settings = options || {};
      var supplierId = String(settings.supplierId || state.supplierId || "").trim();
      var createdInvoiceId = String(settings.createdInvoiceId || "").trim();
      var supplierInvoices = [];
      var supplierPayments = [];
      var createdInvoiceRecord;

      if (!supplierId) {
        state.supplierInvoices = [];
        state.supplierPayments = [];
        return;
      }

      await Promise.all([
        loadInvoicesForSupplier(supplierId).then(function (records) {
          supplierInvoices = records || [];
        }),
        loadPaymentsForSupplier(supplierId).then(function (records) {
          supplierPayments = records || [];
        })
      ]);

      if (createdInvoiceId && !supplierInvoices.some(function (invoice) {
        return String(invoice && invoice.id || "") === createdInvoiceId;
      })) {
        try {
          createdInvoiceRecord = await crm.getRecord(MODULES.invoices, createdInvoiceId);
        } catch (invoiceFetchError) {
          debugError("refreshSupplierRelatedActivity fetch created invoice failed", invoiceFetchError, {
            supplierId: supplierId,
            createdInvoiceId: createdInvoiceId
          });
        }

        if (createdInvoiceRecord && getInvoiceSupplierId(createdInvoiceRecord) === supplierId) {
          supplierInvoices = sortRecordsByDateDesc(
            helpers.dedupeById([createdInvoiceRecord].concat(supplierInvoices)),
            "Invoice_Date"
          );
        }
      }

      state.supplierInvoices = supplierInvoices;
      state.supplierPayments = supplierPayments;
    }

    function compareSupplierActivityExportValues(left, right, direction) {
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

    function getSortedSupplierActivityInvoices(records) {
      var sort = state.supplierActivityInvoicesSort || { key: "date", direction: "desc" };

      return (records || []).slice().sort(function (left, right) {
        if (sort.key === "invoice") {
          return compareSupplierActivityExportValues(
            helpers.getInvoiceDisplayNumber(left, FIELD_CANDIDATES),
            helpers.getInvoiceDisplayNumber(right, FIELD_CANDIDATES),
            sort.direction
          );
        }

        if (sort.key === "invoiceType") {
          return compareSupplierActivityExportValues(left.Invoice_Type, right.Invoice_Type, sort.direction);
        }

        if (sort.key === "status") {
          return compareSupplierActivityExportValues(left.Status, right.Status, sort.direction);
        }

        if (sort.key === "booking") {
          return compareSupplierActivityExportValues(
            getInvoiceBookingDisplay(left),
            getInvoiceBookingDisplay(right),
            sort.direction
          );
        }

        if (sort.key === "total") {
          return compareSupplierActivityExportValues(
            helpers.getInvoiceTotalAmount(left, FIELD_CANDIDATES),
            helpers.getInvoiceTotalAmount(right, FIELD_CANDIDATES),
            sort.direction
          );
        }

        if (sort.key === "paid") {
          return compareSupplierActivityExportValues(
            Number(left.Amount_Paid) || 0,
            Number(right.Amount_Paid) || 0,
            sort.direction
          );
        }

        if (sort.key === "pending") {
          return compareSupplierActivityExportValues(
            helpers.getInvoicePendingAmount(left, FIELD_CANDIDATES),
            helpers.getInvoicePendingAmount(right, FIELD_CANDIDATES),
            sort.direction
          );
        }

        return compareSupplierActivityExportValues(
          Date.parse(left.Invoice_Date || "") || 0,
          Date.parse(right.Invoice_Date || "") || 0,
          sort.direction
        );
      });
    }

    function getSupplierActivityExportFileBase(suffix) {
      var supplierName = state.supplier
        ? helpers.getCandidateValue(state.supplier, FIELD_CANDIDATES.supplier.name)
        : "";

      return sanitizeDownloadFileName((supplierName || "supplier") + "-" + suffix);
    }

    function onSupplierInvoicesExportClick() {
      var invoices;
      var workbookXml;
      var fileName;

      if (!state.supplier) {
        renderer.showError("Load a supplier first.");
        return;
      }

      invoices = getSortedSupplierActivityInvoices(state.supplierInvoices);

      if (!invoices.length) {
        renderer.showError("This supplier has no invoices to export.");
        return;
      }

      renderer.showError("");
      workbookXml = buildSpreadsheetWorkbookXml("Supplier Invoices", [
        "Invoice",
        "Status",
        "Invoice Type",
        "Invoice Date",
        "Payment Dates",
        "Booking",
        "Total",
        "Paid",
        "Pending"
      ], invoices.map(function (invoice) {
        return [
          { value: helpers.getInvoiceDisplayNumber(invoice, FIELD_CANDIDATES), type: "String" },
          { value: invoice.Status || "", type: "String" },
          { value: invoice.Invoice_Type || "", type: "String" },
          { value: helpers.formatDate(invoice.Invoice_Date), type: "String" },
          { value: invoice._supplierPaymentDates == null ? "Unavailable" : (invoice._supplierPaymentDates.map(function (date) { return helpers.formatDate(date); }).join(", ") || "-"), type: "String" },
          { value: getInvoiceBookingDisplay(invoice), type: "String" },
          { value: helpers.getExportSignedAmount(helpers.getInvoiceTotalAmount(invoice, FIELD_CANDIDATES), invoice), type: "Number" },
          { value: helpers.getExportSignedAmount(Number(invoice.Amount_Paid) || 0, invoice), type: "Number" },
          { value: helpers.getExportSignedAmount(helpers.getInvoicePendingAmount(invoice, FIELD_CANDIDATES), invoice), type: "Number" }
        ];
      }));
      fileName = getSupplierActivityExportFileBase("supplier-invoices") + ".xls";
      downloadFileFromText(fileName, "application/vnd.ms-excel;charset=utf-8", workbookXml);
      renderer.showNotice("Supplier invoices export generated successfully.", {
        tone: "success"
      });
    }

    function onSupplierPaymentsExportClick() {
      var payments;
      var workbookXml;
      var fileName;

      if (!state.supplier) {
        renderer.showError("Load a supplier first.");
        return;
      }

      payments = (state.supplierPayments || []).slice();

      if (!payments.length) {
        renderer.showError("This supplier has no payments to export.");
        return;
      }

      renderer.showError("");
      workbookXml = buildSpreadsheetWorkbookXml("Supplier Payments", [
        "Payment",
        "Status",
        "Payment Date",
        "Booking context",
        "Payment account",
        "Amount"
      ], payments.map(function (payment) {
        return [
          { value: helpers.getCandidateValue(payment, FIELD_CANDIDATES.payment.reference) || payment.Name || "Untitled payment", type: "String" },
          { value: payment.Status || "", type: "String" },
          { value: helpers.formatDate(payment.Payment_Date), type: "String" },
          { value: getBookingNameFromPayment(payment), type: "String" },
          { value: payment._supplierAccountDisplay || ns.paymentAccountLabel(payment), type: "String" },
          { value: helpers.getExportSignedAmount(helpers.getPaymentAmount(payment, FIELD_CANDIDATES), payment), type: "Number" }
        ];
      }));
      fileName = getSupplierActivityExportFileBase("supplier-payments") + ".xls";
      downloadFileFromText(fileName, "application/vnd.ms-excel;charset=utf-8", workbookXml);
      renderer.showNotice("Supplier payments export generated successfully.", {
        tone: "success"
      });
    }

    function getPaymentLetterSuppliers(record) {
      var paymentId = String(record && record.id || "");
      var groupedBySupplierId = {};

      if (!paymentId) {
        return [];
      }

      state.records.payAllocations.forEach(function (allocation) {
        var allocationPaymentId = helpers.getLookupId(allocation.Supplier_Payment);
        var supplierId;
        var supplierName;
        var bucket;
        var invoiceId;

        if (allocationPaymentId !== paymentId) {
          return;
        }

        supplierId = helpers.getLookupId(allocation.Supplier);
        supplierName = allocation.Supplier_Name || helpers.getLookupName(allocation.Supplier) || "Unknown supplier";

        if (!supplierId) {
          return;
        }

        if (!groupedBySupplierId[supplierId]) {
          groupedBySupplierId[supplierId] = {
            id: supplierId,
            name: supplierName,
            ezusReference: String(allocation.Ezus_Supplier_Reference || "").trim(),
            invoiceIds: {},
            invoiceCount: 0,
            totalAllocated: 0
          };
        }

        bucket = groupedBySupplierId[supplierId];
        if (!bucket.ezusReference && allocation.Ezus_Supplier_Reference) {
          bucket.ezusReference = String(allocation.Ezus_Supplier_Reference || "").trim();
        }
        invoiceId = helpers.getLookupId(allocation.Supplier_Invoice) || String(allocation.Name || "");

        if (invoiceId && !bucket.invoiceIds[invoiceId]) {
          bucket.invoiceIds[invoiceId] = true;
          bucket.invoiceCount += 1;
        }

        bucket.totalAllocated += getPaymentLetterAllocationAmount(allocation);
      });

      return Object.keys(groupedBySupplierId).map(function (supplierId) {
        return groupedBySupplierId[supplierId];
      }).sort(function (left, right) {
        return String(left.name || "").localeCompare(String(right.name || ""), "en", {
          sensitivity: "base"
        });
      });
    }

    function getEffectivePaymentLetterRecipient(supplierId) {
      var manualEmail = String(state.paymentLetter.manualEmailBySupplierId[supplierId] || "").trim();
      var resolvedRecipient = state.paymentLetter.recipientStatesBySupplierId[supplierId] || null;

      if (manualEmail) {
        return {
          status: "ready",
          email: manualEmail,
          source: "manual",
          message: "Manual email override"
        };
      }

      return resolvedRecipient || {
        status: "missing",
        email: "",
        source: "missing",
        message: "No email available"
      };
    }

    function getSelectedPaymentLetterSuppliersMissingRecipients(payment) {
      return (payment ? getPaymentLetterSuppliers(payment) : []).filter(function (supplier) {
        var recipient = getEffectivePaymentLetterRecipient(supplier.id);

        return Boolean(state.paymentLetter.selectedSupplierIds[supplier.id]) &&
          recipient.status !== "loading" &&
          !hasValidEmailAddress(recipient.email);
      }).map(function (supplier) {
        return supplier.name;
      });
    }

    async function resolvePaymentLetterRecipientForSupplier(supplier) {
      var response;
      var output;
      var email;

      if (!supplier || !supplier.id) {
        return {
          status: "missing",
          email: "",
          source: "missing",
          message: "Supplier not available"
        };
      }

      response = await crm.executeFunction(GET_SUPPLIER_CONTACT_BY_TYPE_FUNCTION, {
        supplierId: supplier.id,
        contactType: PAYMENT_LETTER_CONTACT_TYPE
      });
      output = getFunctionOutputObject(response) || {};

      if (output.error) {
        return {
          status: "missing",
          email: "",
          source: "missing",
          message: output.message || "Could not load CRM supplier contact"
        };
      }

      email = typeof output.Email === "string"
        ? output.Email.trim()
        : (typeof output.email === "string" ? output.email.trim() : "");

      if (!hasValidEmailAddress(email)) {
        return {
          status: "missing",
          email: "",
          source: "missing",
          message: "No AC - Accounts contact email"
        };
      }

      return {
        status: "ready",
        email: email,
        source: "crm",
        message: "AC - Accounts contact from CRM"
      };
    }

    async function loadPaymentLetterRecipients(payment, suppliers) {
      var paymentId = String(payment && payment.id || "");
      var requestToken;
      var results;

      if (!paymentId || !state.paymentLetter.isOpen || state.paymentLetter.paymentId !== paymentId) {
        return;
      }

      requestToken = Number(state.paymentLetter.requestToken || 0) + 1;
      state.paymentLetter.requestToken = requestToken;
      state.paymentLetter.isLoadingRecipients = true;
      state.paymentLetter.recipientStatesBySupplierId = {};
      suppliers.forEach(function (supplier) {
        state.paymentLetter.recipientStatesBySupplierId[supplier.id] = {
          status: "loading",
          email: "",
          source: "loading",
          message: "Loading CRM contact..."
        };
      });
      renderSelectedPaymentLetterPanel(payment);

      results = await Promise.all(suppliers.map(async function (supplier) {
        try {
          return {
            supplierId: supplier.id,
            recipient: await resolvePaymentLetterRecipientForSupplier(supplier)
          };
        } catch (error) {
          debugError("loadPaymentLetterRecipients failed", error, {
            supplierId: supplier.id,
            contactType: PAYMENT_LETTER_CONTACT_TYPE
          });
          return {
            supplierId: supplier.id,
            recipient: {
              status: "missing",
              email: "",
              source: "missing",
              message: "Could not load supplier email"
            }
          };
        }
      }));

      if (!state.paymentLetter.isOpen ||
        state.paymentLetter.paymentId !== paymentId ||
        state.paymentLetter.requestToken !== requestToken) {
        return;
      }

      results.forEach(function (item) {
        state.paymentLetter.recipientStatesBySupplierId[item.supplierId] = item.recipient;
      });
      state.paymentLetter.isLoadingRecipients = false;
      renderSelectedPaymentLetterPanel(payment);
    }

    function closeSelectedPaymentLetterPanel() {
      state.paymentLetter.isOpen = false;
      state.paymentLetter.isBusy = false;
      state.paymentLetter.isLoadingRecipients = false;
      state.paymentLetter.paymentId = "";
      state.paymentLetter.selectedSupplierIds = {};
      state.paymentLetter.recipientStatesBySupplierId = {};
      state.paymentLetter.editingEmailSupplierId = "";
      state.paymentLetter.contactsBySupplierId = {};
      state.paymentLetter.requestToken = Number(state.paymentLetter.requestToken || 0) + 1;
    }

    async function openSelectedPaymentLetterPanel(payment) {
      var suppliers = getPaymentLetterSuppliers(payment);

      if (!payment || !payment.id) {
        renderer.showError("Select a payment first.");
        return;
      }

      if (!suppliers.length) {
        renderer.showError("This payment has no suppliers available to send.");
        return;
      }

      state.paymentLetter.isOpen = true;
      state.paymentLetter.isBusy = false;
      state.paymentLetter.isLoadingRecipients = false;
      state.paymentLetter.paymentId = payment.id;
      state.paymentLetter.selectedSupplierIds = {};
      state.paymentLetter.recipientStatesBySupplierId = {};
      state.paymentLetter.editingEmailSupplierId = "";
      state.paymentLetter.contactsBySupplierId = {};
      suppliers.forEach(function (supplier) {
        state.paymentLetter.selectedSupplierIds[supplier.id] = true;
      });
      renderAll();
      await loadPaymentLetterRecipients(payment, suppliers);
    }

    function getSelectedPaymentLetterSupplierIds() {
      return Object.keys(state.paymentLetter.selectedSupplierIds || {}).filter(function (supplierId) {
        return Boolean(state.paymentLetter.selectedSupplierIds[supplierId]);
      });
    }

    function getPaymentLetterContactName(contact) {
      return String(contact && (contact.Contact_Name || contact.Full_Name || contact.Name || contact.Last_Name) || "-");
    }

    function renderPaymentLetterContacts(supplierId, contactsState) {
      var contacts;

      if (!contactsState) {
        return "";
      }

      if (contactsState.status === "loading") {
        return '<div class="payment-letter-contacts">Loading contacts...</div>';
      }

      if (contactsState.status === "error") {
        return '<div class="payment-letter-contacts payment-letter-warning">' + helpers.escapeHtml(contactsState.message || "Could not load contacts.") + "</div>";
      }

      contacts = contactsState.contacts || [];
      if (!contacts.length) {
        return '<div class="payment-letter-contacts">No contacts associated with this supplier.</div>';
      }

      return [
        '<div class="payment-letter-contacts">',
        '  <table class="payment-letter-contacts-table">',
        "    <thead><tr><th>Name</th><th>Status</th><th>Contact Type</th><th>Email</th><th></th></tr></thead>",
        "    <tbody>",
        contacts.map(function (contact) {
          var email = String(contact && contact.Email || "").trim();
          var canSelect = hasValidEmailAddress(email);

          return "<tr>" +
            "<td>" + helpers.escapeHtml(getPaymentLetterContactName(contact)) + "</td>" +
            "<td>" + helpers.escapeHtml(String(contact && contact.Status || "-")) + "</td>" +
            "<td>" + helpers.escapeHtml(String(contact && contact.Contact_Type || "-")) + "</td>" +
            "<td>" + helpers.escapeHtml(email || "-") + "</td>" +
            '<td><button type="button" class="button secondary compact-action-button payment-letter-email-edit" data-payment-letter-select-contact="' + helpers.escapeHtml(supplierId) + '" data-payment-letter-contact-email="' + helpers.escapeHtml(email) + '"' + (canSelect && !state.paymentLetter.isBusy ? "" : " disabled") + ">Select</button></td>" +
            "</tr>";
        }).join(""),
        "    </tbody>",
        "  </table>",
        "</div>"
      ].join("");
    }

    async function loadPaymentLetterContacts(supplierId) {
      var contacts;

      state.paymentLetter.contactsBySupplierId[supplierId] = { status: "loading", contacts: [] };
      renderSelectedPaymentLetterPanel(getCurrentPaymentLetterPayment());

      try {
        contacts = await crm.searchRecord("Contacts", "(Vendor_Name:equals:" + String(supplierId) + ")");
        state.paymentLetter.contactsBySupplierId[supplierId] = {
          status: "ready",
          contacts: contacts || []
        };
      } catch (error) {
        debugError("loadPaymentLetterContacts failed", error, { supplierId: supplierId });
        state.paymentLetter.contactsBySupplierId[supplierId] = {
          status: "error",
          contacts: [],
          message: "Could not load supplier contacts."
        };
      }

      renderSelectedPaymentLetterPanel(getCurrentPaymentLetterPayment());
    }

    function getCurrentPaymentLetterPayment() {
      return state.records.payments.find(function (item) {
        return String(item && item.id || "") === String(state.paymentLetter.paymentId || "");
      }) || null;
    }

    function getPaymentLetterAllocationAmount(allocation) {
      var amount = Number(allocation.Allocated_Amount || 0) || 0;
      return String(allocation.Movement_Type || "").trim() === "Supplier Refund"
        ? -Math.abs(amount)
        : amount;
    }

    function getPaymentLetterAllocationsForSupplier(paymentId, supplierId) {
      return state.records.payAllocations.filter(function (allocation) {
        return helpers.getLookupId(allocation.Supplier_Payment) === String(paymentId || "") &&
          helpers.getLookupId(allocation.Supplier) === String(supplierId || "");
      }).sort(function (left, right) {
        return String(left.Invoice_Date || "").localeCompare(String(right.Invoice_Date || ""));
      });
    }

    function normalizePdfText(value) {
      var text = String(value === null || value === undefined ? "" : value);

      if (text.normalize) {
        text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      }

      return text.replace(/[^\x20-\x7E\u20ac]/g, " ").replace(/\s+/g, " ").trim();
    }

    function escapePdfText(value) {
      return normalizePdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/\u20ac/g, "\\200");
    }

    function truncatePdfText(value, maxLength) {
      var text = normalizePdfText(value);

      if (text.length <= maxLength) {
        return text;
      }

      return text.slice(0, Math.max(0, maxLength - 3)) + "...";
    }

    function addPdfTextLine(operations, x, y, size, text) {
      operations.push("0.06 0.09 0.16 rg BT /F1 " + size + " Tf " + x + " " + y + " Td (" + escapePdfText(text) + ") Tj ET");
    }

    function paymentLetterInvoiceName(allocation) {
      var lookup = allocation.Supplier_Invoice;
      return String(allocation["Supplier_Invoice.Name"] ||
        (lookup && typeof lookup === "object" && (lookup.name || lookup.Name)) || "").trim();
    }

    // Conservative Helvetica widths keep even long, unbroken references inside the column.
    function wrapPaymentLetterInvoice(value) {
      var lines = [], line = "", width = 0;
      Array.from(normalizePdfText(value)).forEach(function (character) {
        var advance = /[MW@%]/.test(character) ? 8 : /[A-Z]/.test(character) ? 6 : 4.8;
        if (width + advance > 137 && line) { lines.push(line); line = ""; width = 0; }
        line += character; width += advance;
      });
      lines.push(line || "-");
      return lines;
    }

    function paginatePaymentLetter(allocations) {
      var pages = [[]], used = 0;
      allocations.forEach(function (allocation) {
        var lines = wrapPaymentLetterInvoice(paymentLetterInvoiceName(allocation) || "Invoice unavailable");
        if (used && Math.max(17, lines.length * 11 + 6) <= 480 && used + Math.max(17, lines.length * 11 + 6) > 480) {
          pages.push([]); used = 0;
        }
        var continuation = false;
        while (lines.length) {
          var capacity = Math.floor((480 - used - 6) / 11);
          if (capacity < 1) { pages.push([]); used = 0; continue; }
          var part = lines.splice(0, capacity);
          pages[pages.length - 1].push({ allocation: allocation, lines: part, continuation: continuation });
          continuation = true;
          used += Math.max(17, part.length * 11 + 6);
        }
      });
      return pages;
    }

    function buildPaymentLetterPdfOperations(payment, supplier, allocations, pages, pageIndex, pageCount) {
      var operations = [];
      var paymentReference = helpers.getCandidateValue(payment, FIELD_CANDIDATES.payment.reference) || payment.Name || payment.id || "-";
      var paymentDate = helpers.formatDate(helpers.getCandidateValue(payment, FIELD_CANDIDATES.payment.date));
      var totalAllocated = allocations.reduce(function (sum, allocation) {
        return sum + getPaymentLetterAllocationAmount(allocation);
      }, 0);
      var pageRows = pages[pageIndex];
      var y = 790;

      operations.push("0.92 0.96 1 rg 0 735 595 72 re f");
      operations.push("0.86 0.9 0.96 RG 0.5 w 42 92 511 640 re S");
      addPdfTextLine(operations, 58, y - 18, 10, "PAYMENT LETTER");
      addPdfTextLine(operations, 400, y - 18, 10, "Made for Spain and Portugal");
      y -= 40;
      addPdfTextLine(operations, 58, y, 18, supplier.name);
      y -= 20;
      addPdfTextLine(operations, 58, y, 10, "Summary of the invoices included in payment " + paymentReference + ".");
      y -= 42;
      addPdfTextLine(operations, 58, y, 10, "Payment reference: " + paymentReference);
      addPdfTextLine(operations, 330, y, 10, "Payment date: " + paymentDate);
      y -= 18;
      addPdfTextLine(operations, 58, y, 10, "Invoices paid: " + allocations.length);
      addPdfTextLine(operations, 330, y, 10, "Allocated amount: " + helpers.formatCurrency(totalAllocated));
      y -= 38;
      addPdfTextLine(operations, 58, y, 9, "Invoice");
      addPdfTextLine(operations, 205, y, 9, "Invoice date");
      addPdfTextLine(operations, 305, y, 9, "MFSP");
      addPdfTextLine(operations, 460, y, 9, "Paid amount");
      y -= 14;
      operations.push("0.89 0.91 0.94 RG 0.5 w 58 " + (y + 6) + " 480 1 re f");
      y -= 10;
      pageRows.forEach(function (row) {
        var allocation = row.allocation;
        var mfspReference = allocation.MFSP_Reference || "-";
        var invoiceDate = helpers.formatDate(allocation.Invoice_Date);
        var amount = helpers.formatCurrency(getPaymentLetterAllocationAmount(allocation));

        row.lines.forEach(function (line, index) {
          addPdfTextLine(operations, 58, y - index * 11, 8, line);
        });
        addPdfTextLine(operations, 205, y, 8, invoiceDate);
        addPdfTextLine(operations, 305, y, 8, truncatePdfText(mfspReference, 22));
        if (!row.continuation) { addPdfTextLine(operations, 460, y, 8, amount); }
        y -= Math.max(17, row.lines.length * 11 + 6);
      });
      addPdfTextLine(operations, 480, 42, 8, "Page " + (pageIndex + 1) + " of " + pageCount);

      return operations.join("\n");
    }

    function buildPaymentLetterPdf(payment, supplier, letterAllocations) {
      var allocations = letterAllocations || getPaymentLetterAllocationsForSupplier(payment.id, supplier.id);
      var pages = paginatePaymentLetter(allocations);
      var pageCount = pages.length;
      var objects = [];
      var pageObjectNumbers = [];
      var pdf;
      var offsets = [0];
      var xrefOffset;
      var index;

      function addObject(content) {
        objects.push(content);
        return objects.length;
      }

      addObject("<< /Type /Catalog /Pages 2 0 R >>");
      addObject("");
      addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

      for (index = 0; index < pageCount; index += 1) {
        var stream = buildPaymentLetterPdfOperations(payment, supplier, allocations, pages, index, pageCount);
        var contentObjectNumber = addObject("<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream");
        var pageObjectNumber = addObject("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents " + contentObjectNumber + " 0 R >>");
        pageObjectNumbers.push(pageObjectNumber + " 0 R");
      }

      objects[1] = "<< /Type /Pages /Kids [" + pageObjectNumbers.join(" ") + "] /Count " + pageCount + " >>";

      pdf = "%PDF-1.4\n";
      objects.forEach(function (objectContent, objectIndex) {
        offsets.push(pdf.length);
        pdf += (objectIndex + 1) + " 0 obj\n" + objectContent + "\nendobj\n";
      });
      xrefOffset = pdf.length;
      pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
      for (index = 1; index < offsets.length; index += 1) {
        pdf += ("0000000000" + String(offsets[index])).slice(-10) + " 00000 n \n";
      }
      pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF";

      return pdf;
    }

    async function resolvePaymentLetterInvoiceNames(allocations) {
      // COQL may return lookup IDs without names. Never substitute the allocation/payment Name.
      var invoiceNames = {};
      for (var allocation of allocations) {
        if (paymentLetterInvoiceName(allocation)) { continue; }
        var invoiceId = helpers.getLookupId(allocation.Supplier_Invoice);
        if (!invoiceId) { throw new Error("An allocation has no linked invoice. Please review the payment before downloading."); }
        if (!invoiceNames[invoiceId]) {
          var invoice = await crm.getRecord(MODULES.invoices, invoiceId);
          if (!invoice || !String(invoice.Name || "").trim()) { throw new Error("Could not load the invoice name. Please retry."); }
          invoiceNames[invoiceId] = invoice.Name;
        }
        allocation["Supplier_Invoice.Name"] = invoiceNames[invoiceId];
      }
    }

    async function downloadPaymentLetterPdf(payment, supplier, letterAllocations) {
      var allocations = letterAllocations || getPaymentLetterAllocationsForSupplier(payment.id, supplier.id);
      await resolvePaymentLetterInvoiceNames(allocations);
      var paymentReference = helpers.getCandidateValue(payment, FIELD_CANDIDATES.payment.reference) || payment.Name || "payment";
      var fileName = sanitizeDownloadFileName("payment-letter-" + paymentReference + "-" + supplier.name) + ".pdf";
      var pdf = buildPaymentLetterPdf(payment, supplier, allocations);

      downloadFileFromText(fileName, "application/pdf", pdf);
      renderer.showNotice("Payment letter PDF downloaded.", {
        tone: "success"
      });
    }

    var supplierLetterDialog, supplierLetterGeneration = 0, supplierLetterSending = false;

    function ensureSupplierLetterDialog() {
      if (supplierLetterDialog) { return supplierLetterDialog; }
      var doc = deps.document || global.document;
      var dialog = doc.createElement("dialog");
      dialog.id = "supplier-payment-letter-preview";
      dialog.setAttribute("aria-labelledby", "supplier-payment-letter-preview-title");
      dialog.innerHTML = '<header class="panel-header"><div><p class="panel-kicker">Payment letter</p><h2 id="supplier-payment-letter-preview-title">Preview</h2></div><button type="button" class="widget-popup-close close-supplier-control" data-letter-close aria-label="Close" title="Close">&times;</button></header>' +
        '<div data-letter-content aria-live="polite"></div><footer class="actions"><button type="button" class="button secondary" data-letter-retry hidden>Retry</button><button type="button" class="button secondary" data-letter-download disabled>Download PDF</button><button type="button" class="button primary" data-letter-send disabled>Send payment letter</button></footer>';
      doc.body.appendChild(dialog);
      dialog.querySelector("[data-letter-close]").onclick = function () { if (!supplierLetterSending) { dialog.close(); } };
      dialog.addEventListener("close", function () { supplierLetterGeneration += 1; });
      dialog.addEventListener("cancel", function (event) { if (supplierLetterSending) { event.preventDefault(); return; } supplierLetterGeneration += 1; });
      supplierLetterDialog = dialog;
      return dialog;
    }

    async function openSupplierPaymentLetterPreview(paymentId) {
      if (supplierLetterSending) { return; }
      var supplierId = String(state.supplierId || state.supplier && state.supplier.id || "");
      if (!supplierId || !state.supplier) { return; }
      var supplier = { id: supplierId, name: helpers.getCandidateValue(state.supplier, FIELD_CANDIDATES.supplier.name) || "Supplier" };
      var dialog = ensureSupplierLetterDialog();
      var generation = ++supplierLetterGeneration;
      var content = dialog.querySelector("[data-letter-content]");
      var download = dialog.querySelector("[data-letter-download]");
      var retry = dialog.querySelector("[data-letter-retry]");
      var send = dialog.querySelector("[data-letter-send]");
      send.disabled = true;
      send.onclick = null;
      download.disabled = true;
      download.onclick = null;
      retry.hidden = true;
      retry.onclick = function () { openSupplierPaymentLetterPreview(paymentId); };
      content.innerHTML = '<div class="empty-state" role="status">Loading payment letter...</div>';
      if (!dialog.open) { dialog.showModal(); }
      try {
        var results = await Promise.all([
          crm.getRecord(MODULES.payments, paymentId),
          deps.loadPaymentLetterAllocations(paymentId, supplierId)
        ]);
        var payment = results[0];
        if (!payment || String(payment.id) !== String(paymentId)) { throw new Error("Could not load this payment."); }
        var allocations = helpers.dedupeById(results[1] || []).filter(function (allocation) {
          return helpers.getLookupId(allocation.Supplier_Payment) === String(paymentId) && helpers.getLookupId(allocation.Supplier) === supplierId;
        }).sort(function (a, b) { return String(a.Invoice_Date || "").localeCompare(String(b.Invoice_Date || "")) || String(a.id).localeCompare(String(b.id)); });
        await resolvePaymentLetterInvoiceNames(allocations);
        if (generation !== supplierLetterGeneration || !dialog.open) { return; }
        if (!allocations.length) {
          content.innerHTML = '<div class="empty-state">No invoice allocations for this supplier in this payment.</div>';
          return;
        }
        var esc = helpers.escapeHtml;
        var reference = helpers.getCandidateValue(payment, FIELD_CANDIDATES.payment.reference) || payment.Name || payment.id;
        var total = allocations.reduce(function (sum, allocation) { return sum + getPaymentLetterAllocationAmount(allocation); }, 0);
        content.innerHTML = '<article class="supplier-letter-sheet"><div class="supplier-letter-heading"><p class="panel-kicker">Made for Spain &amp; Portugal</p><h3>' + esc(supplier.name) + '</h3><p>Invoices included in payment <strong>' + esc(reference) + '</strong></p><p>Payment date: ' + esc(helpers.formatDate(payment.Payment_Date)) + '</p><p class="supplier-letter-total">Total paid to this supplier: <strong>' + esc(helpers.formatCurrency(total)) + '</strong></p></div>' +
          '<div class="table-wrap"><table class="results-table"><thead><tr><th>Invoice</th><th>Invoice date</th><th>MFSP</th><th class="numeric-cell">Paid amount</th></tr></thead><tbody>' + allocations.map(function (allocation) {
            return '<tr><td class="supplier-letter-invoice">' + esc(paymentLetterInvoiceName(allocation)) + '</td><td>' + esc(helpers.formatDate(allocation.Invoice_Date)) + '</td><td>' + esc(allocation.MFSP_Reference || "-") + '</td><td class="numeric-cell">' + esc(helpers.formatCurrency(getPaymentLetterAllocationAmount(allocation))) + '</td></tr>';
          }).join("") + '</tbody><tfoot><tr><th colspan="3">Total paid to this supplier</th><td class="numeric-cell">' + esc(helpers.formatCurrency(total)) + '</td></tr></tfoot></table></div></article>';
        send.disabled = false;
        send.onclick = function () { openSupplierLetterRecipient(dialog, supplier, payment, generation); };
        download.disabled = false;
        download.onclick = async function () {
          download.disabled = true;
          try { await downloadPaymentLetterPdf(payment, supplier, allocations); }
          catch (error) { renderer.showError(error.message || "Could not download the payment letter."); }
          finally { if (generation === supplierLetterGeneration) { download.disabled = false; } }
        };
      } catch (error) {
        if (generation !== supplierLetterGeneration || !dialog.open) { return; }
        debugError("openSupplierPaymentLetterPreview failed", error);
        content.innerHTML = '<div class="payment-letter-warning" role="alert">Could not load the payment letter. Please retry.</div>';
        retry.hidden = false;
      }
    }

    async function sendPaymentLetterToSuppliers(paymentId, supplierIds, supplierEmailMap) {
      var actingUserEmail = String(await deps.getCurrentUserEmail() || "").trim().toLowerCase();
      if (!hasValidEmailAddress(actingUserEmail)) {
        throw new Error("Could not identify your CRM user email. No payment letters were sent. Please reload the widget and try again.");
      }
      var response = await crm.executeFunction(SEND_SUPPLIER_PAYMENT_LETTER_FUNCTION, {
        paymentId: paymentId,
        supplierIds: supplierIds.join("|||"),
        recipientEmail: PAYMENT_LETTER_DEFAULT_RECIPIENT,
        supplierEmailMapStr: JSON.stringify(supplierEmailMap),
        actingUserEmail: actingUserEmail
      });
      var result = getPaymentLetterFunctionResult(response);
      if (!result.success) { throw new Error(result.message || "Payment letter could not be sent."); }
      return result;
    }

    async function openSupplierLetterRecipient(dialog, supplier, payment, generation) {
      var content = dialog.querySelector("[data-letter-content]");
      var existing = content.querySelector("[data-letter-recipient]");
      if (existing) { existing.scrollIntoView({ block: "nearest" }); return; }
      var section = (deps.document || global.document).createElement("section");
      section.className = "supplier-letter-recipient";
      section.setAttribute("data-letter-recipient", "");
      section.innerHTML = '<h3>Send payment letter</h3><p>Recipient for ' + helpers.escapeHtml(supplier.name) + '</p>' +
        '<fieldset><div class="supplier-letter-recipient-controls"><label>Email<input type="email" data-letter-email aria-label="Recipient email" disabled></label><button type="button" class="button secondary" data-letter-edit disabled>Edit email</button><button type="button" class="button secondary" data-letter-contacts>See contacts</button></div>' +
        '<div data-letter-contact-list></div><p data-letter-send-status role="status" aria-live="polite">Loading supplier email from CRM...</p>' +
        '<button type="button" class="button primary" data-letter-confirm disabled>Send</button></fieldset>';
      content.prepend(section);
      section.scrollIntoView({ block: "nearest" });
      var email = section.querySelector("[data-letter-email]");
      var edit = section.querySelector("[data-letter-edit]");
      var contactsButton = section.querySelector("[data-letter-contacts]");
      var list = section.querySelector("[data-letter-contact-list]");
      var status = section.querySelector("[data-letter-send-status]");
      var confirm = section.querySelector("[data-letter-confirm]");
      var fieldset = section.querySelector("fieldset");
      var changed = false, contactsToken = 0, contactsLoading = false, sent = false;
      function current() { return generation === supplierLetterGeneration && dialog.open; }
      function validate() { confirm.disabled = sent || supplierLetterSending || contactsLoading || !hasValidEmailAddress(email.value.trim()); }
      email.oninput = function () { changed = true; status.textContent = hasValidEmailAddress(email.value.trim()) ? "" : "Enter a valid email address."; validate(); };
      edit.onclick = function () { email.disabled = false; email.focus(); changed = true; };
      contactsButton.onclick = async function () {
        if (supplierLetterSending || sent) { return; }
        if (list.innerHTML) { contactsToken += 1; list.innerHTML = ""; contactsLoading = false; contactsButton.textContent = "See contacts"; validate(); return; }
        var token = ++contactsToken;
        contactsLoading = true; validate();
        contactsButton.textContent = "Hide contacts";
        list.innerHTML = '<p role="status">Loading contacts...</p>';
        try {
          var contacts = await crm.searchRecord("Contacts", "(Vendor_Name:equals:" + supplier.id + ")");
          if (!current() || token !== contactsToken) { return; }
          list.innerHTML = '<label>Search contacts<input type="search" data-letter-contact-search placeholder="Name or email"></label><div data-letter-contact-results></div>';
          var search = list.querySelector("[data-letter-contact-search]");
          function renderContacts() {
            var query = search.value.toLowerCase().trim();
            var filtered = contacts.filter(function (contact) { return (getPaymentLetterContactName(contact) + " " + (contact.Email || "")).toLowerCase().includes(query); });
            list.querySelector("[data-letter-contact-results]").innerHTML = renderPaymentLetterContacts(supplier.id, {status: "ready", contacts: filtered});
          }
          search.oninput = renderContacts; renderContacts();
        } catch (error) {
          if (current() && token === contactsToken) { list.innerHTML = '<p class="payment-letter-warning">Could not load contacts. Close and reopen contacts to retry.</p>'; }
        } finally {
          if (current() && token === contactsToken) { contactsLoading = false; validate(); }
        }
      };
      list.onclick = function (event) {
        var button = event.target.closest("[data-payment-letter-select-contact]");
        if (!button || supplierLetterSending || sent) { return; }
        var value = button.getAttribute("data-payment-letter-contact-email") || "";
        if (!hasValidEmailAddress(value)) { return; }
        changed = true; email.value = value; email.disabled = false;
        list.innerHTML = ""; contactsButton.textContent = "See contacts"; status.textContent = "Contact selected."; validate();
      };
      confirm.onclick = async function () {
        if (!current() || supplierLetterSending || contactsLoading || sent || !hasValidEmailAddress(email.value.trim())) { return; }
        var emailMap = {}; emailMap[supplier.id] = email.value.trim();
        supplierLetterSending = true; fieldset.disabled = true; validate();
        dialog.querySelector("[data-letter-close]").disabled = true;
        status.textContent = "Sending payment letter...";
        try {
          var result = await sendPaymentLetterToSuppliers(String(payment.id), [supplier.id], emailMap);
          sent = true; status.textContent = result.message || "Payment letter sent successfully.";
          confirm.textContent = "Sent";
          dialog.querySelector("[data-letter-send]").disabled = true;
        } catch (error) {
          status.textContent = error.message || "Could not send the payment letter.";
          debugError("supplierPaymentLetterSend failed", error);
        } finally {
          supplierLetterSending = false; fieldset.disabled = sent;
          dialog.querySelector("[data-letter-close]").disabled = false; validate();
        }
      };
      try {
        var recipient = await resolvePaymentLetterRecipientForSupplier(supplier);
        if (!current() || changed || sent || supplierLetterSending) { return; }
        email.value = recipient.email || "";
        status.textContent = recipient.message || "";
      } catch (error) {
        if (current() && !changed) { status.textContent = "Could not load supplier email. Choose a contact or enter an email."; }
      } finally {
        if (current() && !sent && !supplierLetterSending) { email.disabled = false; edit.disabled = false; validate(); }
      }
    }

    function renderIconSvg(name) {
      var paths = {
        check: '<path d="M20 6 9 17l-5-5"></path>',
        close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
        pencil: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
        searchClose: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path><path d="m8 8 6 6"></path><path d="m14 8-6 6"></path>',
        search: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>'
      };

      return '<svg class="payment-letter-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + paths[name] + "</svg>";
    }

    function renderSelectedPaymentLetterPanel(payment) {
      var isOpen = Boolean(
        payment &&
        payment.id &&
        state.paymentLetter.isOpen &&
        state.paymentLetter.paymentId === payment.id
      );
      var suppliers = isOpen ? getPaymentLetterSuppliers(payment) : [];
      var selectedCount = getSelectedPaymentLetterSupplierIds().length;
      var missingRecipientNames = isOpen ? getSelectedPaymentLetterSuppliersMissingRecipients(payment) : [];
      var warningMessage = "";
      var bulkAction = elements.selectedPaymentLetterToggleAll.closest(".payment-letter-bulk-action");

      elements.selectedPaymentLetterPanel.hidden = !isOpen;

      if (!isOpen) {
        elements.selectedPaymentLetterEmpty.hidden = true;
        elements.selectedPaymentLetterWarning.hidden = true;
        elements.selectedPaymentLetterWarning.textContent = "";
        elements.selectedPaymentLetterSuppliers.innerHTML = "";
        elements.selectedPaymentLetterSubmit.disabled = false;
        elements.selectedPaymentLetterCancel.disabled = false;
        if (bulkAction) {
          bulkAction.hidden = true;
        }
        elements.selectedPaymentLetterToggleAll.checked = false;
        elements.selectedPaymentLetterToggleAll.indeterminate = false;
        return;
      }

      if (bulkAction) {
        bulkAction.hidden = !suppliers.length;
      }
      elements.selectedPaymentLetterToggleAll.disabled = state.paymentLetter.isBusy || !suppliers.length;
      elements.selectedPaymentLetterToggleAll.checked = suppliers.length && suppliers.every(function (supplier) {
        return Boolean(state.paymentLetter.selectedSupplierIds[supplier.id]);
      });
      elements.selectedPaymentLetterToggleAll.indeterminate = selectedCount > 0 && selectedCount < suppliers.length;

      if (!suppliers.length) {
        elements.selectedPaymentLetterEmpty.hidden = false;
        elements.selectedPaymentLetterWarning.hidden = true;
        elements.selectedPaymentLetterWarning.textContent = "";
        elements.selectedPaymentLetterSuppliers.innerHTML = "";
      } else {
        elements.selectedPaymentLetterEmpty.hidden = true;
        elements.selectedPaymentLetterSuppliers.innerHTML = suppliers.map(function (supplier) {
          var isChecked = Boolean(state.paymentLetter.selectedSupplierIds[supplier.id]);
          var invoiceLabel = supplier.invoiceCount === 1 ? "1 invoice" : String(supplier.invoiceCount) + " invoices";
          var recipient = getEffectivePaymentLetterRecipient(supplier.id);
          var emailClassName = "payment-letter-email";
          var emailText = recipient.email || "No email";
          var isEditingEmail = state.paymentLetter.editingEmailSupplierId === String(supplier.id);
          var contactsState = state.paymentLetter.contactsBySupplierId[supplier.id] || null;
          var contactsTitle = contactsState ? "Hide contacts" : "See contacts";
          var contactsIconName = contactsState ? "searchClose" : "search";

          if (recipient.status === "loading") {
            emailClassName += " is-loading";
            emailText = "Loading email...";
          } else if (!recipient.email) {
            emailClassName += " is-missing";
          } else if (recipient.source === "manual") {
            emailClassName += " is-manual";
          }

          return [
            '<div class="payment-letter-supplier-option">',
            '  <input type="checkbox" data-payment-letter-supplier="' + helpers.escapeHtml(supplier.id) + '"' + (isChecked ? " checked" : "") + (state.paymentLetter.isBusy ? " disabled" : "") + '>',
            '  <div class="payment-letter-supplier-meta">',
            "    <strong>" + helpers.escapeHtml(supplier.name) + "</strong>",
            "    <span>" + helpers.escapeHtml(invoiceLabel + " | " + helpers.formatCurrency(supplier.totalAllocated)) + "</span>",
            "  </div>",
            '  <div class="payment-letter-supplier-side">',
            isEditingEmail
              ? '    <input class="payment-letter-email-input" type="email" data-payment-letter-email-input="' + helpers.escapeHtml(supplier.id) + '" value="' + helpers.escapeHtml(recipient.email || "") + '" aria-label="Email for ' + helpers.escapeHtml(supplier.name) + '">'
              : '    <span class="' + helpers.escapeHtml(emailClassName) + '">' + helpers.escapeHtml(emailText) + "</span>",
            '    <div class="payment-letter-side-actions">',
            isEditingEmail
              ? '      <button type="button" class="button compact-action-button payment-letter-icon-button payment-letter-cancel-button payment-letter-email-edit" data-payment-letter-cancel-email="' + helpers.escapeHtml(supplier.id) + '" aria-label="Cancel email edit" title="Cancel">' + renderIconSvg("close") + '</button><button type="button" class="button compact-action-button payment-letter-icon-button payment-letter-confirm-button payment-letter-email-edit" data-payment-letter-update-email="' + helpers.escapeHtml(supplier.id) + '" aria-label="Update email" title="Update email">' + renderIconSvg("check") + "</button>"
              : contactsState
                ? ""
                : '      <button type="button" class="button secondary compact-action-button payment-letter-icon-button payment-letter-download-button" data-payment-letter-download-pdf="' + helpers.escapeHtml(supplier.id) + '"' + (state.paymentLetter.isBusy ? " disabled" : "") + ' aria-label="Download payment letter PDF" title="Download payment letter PDF">' + renderIconSvg("download") + '</button><button type="button" class="button secondary compact-action-button payment-letter-icon-button payment-letter-email-edit" data-payment-letter-edit-email="' + helpers.escapeHtml(supplier.id) + '"' + (state.paymentLetter.isBusy ? " disabled" : "") + ' aria-label="Edit email" title="Edit email">' + renderIconSvg("pencil") + "</button>",
            isEditingEmail
              ? ""
              : '      <button type="button" class="button secondary compact-action-button payment-letter-icon-button payment-letter-email-edit" data-payment-letter-see-contacts="' + helpers.escapeHtml(supplier.id) + '"' + (state.paymentLetter.isBusy ? " disabled" : "") + ' aria-label="' + helpers.escapeHtml(contactsTitle) + '" title="' + helpers.escapeHtml(contactsTitle) + '">' + renderIconSvg(contactsIconName) + "</button>",
            "    </div>",
            "  </div>",
            renderPaymentLetterContacts(supplier.id, contactsState),
            "</div>"
          ].join("");
        }).join("");
      }

      if (state.paymentLetter.isLoadingRecipients) {
        warningMessage = "Loading supplier emails from CRM...";
      } else if (missingRecipientNames.length) {
        warningMessage = "Selected suppliers without email: " + missingRecipientNames.join(", ") + ". Add an email or uncheck them before sending.";
      }

      elements.selectedPaymentLetterWarning.hidden = !warningMessage;
      elements.selectedPaymentLetterWarning.textContent = warningMessage;
      elements.selectedPaymentLetterSubmit.disabled = state.paymentLetter.isBusy ||
        state.paymentLetter.isLoadingRecipients ||
        !suppliers.length ||
        selectedCount === 0 ||
        missingRecipientNames.length > 0;
      elements.selectedPaymentLetterCancel.disabled = state.paymentLetter.isBusy;
      elements.selectedPaymentLetterSubmit.textContent = state.paymentLetter.isBusy ? "Sending..." : "Send";
    }

    async function onSelectedPaymentSendLetterClick() {
      var payment = state.records.payments.find(function (item) {
        return String(item && item.id || "") === String(state.views.payments.selectedId || "");
      }) || null;

      if (!state.views.payments.selectedId || !payment) {
        renderer.showError("Select a payment first.");
        return;
      }

      renderer.showError("");
      if (state.paymentLetter.isOpen && state.paymentLetter.paymentId === payment.id) {
        closeSelectedPaymentLetterPanel();
        renderAll();
        return;
      }

      await openSelectedPaymentLetterPanel(payment);
    }

    function onSelectedPaymentLetterSupplierToggle(event) {
      var target = event.target;
      var supplierId;

      if (!target || !target.getAttribute) {
        return;
      }

      supplierId = target.getAttribute("data-payment-letter-supplier");

      if (!supplierId) {
        return;
      }

      state.paymentLetter.selectedSupplierIds[supplierId] = Boolean(target.checked);
      renderSelectedPaymentLetterPanel(
        state.records.payments.find(function (item) {
          return String(item && item.id || "") === String(state.paymentLetter.paymentId || "");
        }) || null
      );
    }

    function onSelectedPaymentLetterToggleAllClick() {
      var payment = getCurrentPaymentLetterPayment();
      var suppliers = payment ? getPaymentLetterSuppliers(payment) : [];
      var shouldSelectAll;

      if (state.paymentLetter.isBusy || !suppliers.length) {
        return;
      }

      shouldSelectAll = Boolean(elements.selectedPaymentLetterToggleAll.checked);
      suppliers.forEach(function (supplier) {
        state.paymentLetter.selectedSupplierIds[supplier.id] = shouldSelectAll;
      });
      renderSelectedPaymentLetterPanel(payment);
    }

    function onSupplierActivityInvoiceSortChange(sortKey) {
      var currentSort = state.supplierActivityInvoicesSort || {};

      if (!sortKey) {
        return;
      }

      if (currentSort.key === sortKey) {
        currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
      } else {
        currentSort.key = sortKey;
        currentSort.direction = sortKey === "date" ? "desc" : "asc";
      }

      state.supplierActivityInvoicesSort = currentSort;
      renderAll();
    }

    function onSelectedPaymentLetterEmailEditClick(event) {
      var target = event.target;
      var actionTarget;
      var supplierId;
      var payment;
      var input;
      var email;

      if (!target || !target.closest) {
        return;
      }

      actionTarget = target.closest(
        "[data-payment-letter-edit-email]," +
        "[data-payment-letter-update-email]," +
        "[data-payment-letter-cancel-email]," +
        "[data-payment-letter-see-contacts]," +
        "[data-payment-letter-select-contact]," +
        "[data-payment-letter-download-pdf]"
      );

      if (!actionTarget) {
        return;
      }

      supplierId = actionTarget.getAttribute("data-payment-letter-edit-email") ||
        actionTarget.getAttribute("data-payment-letter-update-email") ||
        actionTarget.getAttribute("data-payment-letter-cancel-email") ||
        actionTarget.getAttribute("data-payment-letter-see-contacts") ||
        actionTarget.getAttribute("data-payment-letter-select-contact") ||
        actionTarget.getAttribute("data-payment-letter-download-pdf");

      if (!supplierId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      payment = getCurrentPaymentLetterPayment();
      if (!payment || state.paymentLetter.isBusy) {
        return;
      }

      if (actionTarget.getAttribute("data-payment-letter-download-pdf")) {
        var supplier = getPaymentLetterSuppliers(payment).find(function (item) {
          return String(item && item.id || "") === String(supplierId);
        });

        if (!supplier) {
          renderer.showError("Could not find the supplier for this payment letter.");
          return;
        }

        actionTarget.disabled = true;
        return downloadPaymentLetterPdf(payment, supplier).catch(function (error) {
          debugError("downloadPaymentLetterPdf failed", error);
          renderer.showError(error.message || "Could not generate the payment letter. Please retry.");
        }).finally(function () { actionTarget.disabled = false; });
        return;
      }

      if (actionTarget.getAttribute("data-payment-letter-edit-email")) {
        state.paymentLetter.editingEmailSupplierId = String(supplierId);
        renderSelectedPaymentLetterPanel(payment);
        return;
      }

      if (actionTarget.getAttribute("data-payment-letter-cancel-email")) {
        state.paymentLetter.editingEmailSupplierId = "";
        renderSelectedPaymentLetterPanel(payment);
        return;
      }

      if (actionTarget.getAttribute("data-payment-letter-update-email")) {
        input = Array.prototype.slice.call(elements.selectedPaymentLetterSuppliers.querySelectorAll("[data-payment-letter-email-input]")).find(function (item) {
          return item.getAttribute("data-payment-letter-email-input") === String(supplierId);
        });
        email = String(input && input.value || "").trim();

        if (!email) {
          delete state.paymentLetter.manualEmailBySupplierId[supplierId];
        } else if (!hasValidEmailAddress(email)) {
          renderer.showError("Enter a valid email address.");
          return;
        } else {
          state.paymentLetter.manualEmailBySupplierId[supplierId] = email;
        }

        renderer.showError("");
        state.paymentLetter.editingEmailSupplierId = "";
        renderSelectedPaymentLetterPanel(payment);
        return;
      }

      if (actionTarget.getAttribute("data-payment-letter-see-contacts")) {
        if (state.paymentLetter.contactsBySupplierId[supplierId]) {
          delete state.paymentLetter.contactsBySupplierId[supplierId];
          renderSelectedPaymentLetterPanel(payment);
        } else {
          loadPaymentLetterContacts(supplierId);
        }
        return;
      }

      email = String(actionTarget.getAttribute("data-payment-letter-contact-email") || "").trim();
      if (!hasValidEmailAddress(email)) {
        renderer.showError("The selected contact does not have a valid email address.");
        return;
      }

      state.paymentLetter.manualEmailBySupplierId[supplierId] = email;
      state.paymentLetter.editingEmailSupplierId = "";
      delete state.paymentLetter.contactsBySupplierId[supplierId];
      renderer.showError("");
      renderSelectedPaymentLetterPanel(payment);
    }

    async function onSelectedPaymentLetterSubmitClick() {
      if (state.paymentLetter.isBusy) { return; }
      var paymentId = String(state.paymentLetter.paymentId || "");
      var payment = state.records.payments.find(function (item) {
        return String(item && item.id || "") === paymentId;
      }) || null;
      var supplierIds = getSelectedPaymentLetterSupplierIds();
      var missingRecipients;
      var selectedSuppliers;
      var supplierEmailMap = {};
      var response;
      var result;

      if (!paymentId) {
        renderer.showError("Select a payment first.");
        return;
      }

      if (!supplierIds.length) {
        renderer.showError("Select at least one supplier to send the payment letter.");
        return;
      }

      if (state.paymentLetter.isLoadingRecipients) {
        renderer.showError("Wait until the supplier emails finish loading.");
        return;
      }

      missingRecipients = getSelectedPaymentLetterSuppliersMissingRecipients(payment);

      if (missingRecipients.length) {
        renderer.showError("Add an email or uncheck these suppliers before sending: " + missingRecipients.join(", ") + ".");
        return;
      }

      selectedSuppliers = payment ? getPaymentLetterSuppliers(payment).filter(function (supplier) {
        return supplierIds.indexOf(String(supplier.id || "")) !== -1;
      }) : [];
      selectedSuppliers.forEach(function (supplier) {
        var recipient = getEffectivePaymentLetterRecipient(supplier.id);

        if (recipient.email) {
          supplierEmailMap[supplier.id] = recipient.email;
        }
      });

      renderer.showError("");
      state.paymentLetter.isBusy = true;
      renderer.refreshActionState();
      renderSelectedPaymentLetterPanel(
        state.records.payments.find(function (item) {
          return String(item && item.id || "") === paymentId;
        }) || null
      );
      renderer.showNotice("Sending payment letter...", {
        isLoading: true
      });

      try {
        result = await sendPaymentLetterToSuppliers(paymentId, supplierIds, supplierEmailMap);

        closeSelectedPaymentLetterPanel();
        renderAll();
        renderer.showNotice(result.message || "Payment letter sent successfully.", {
          tone: "success"
        });
      } catch (error) {
        state.paymentLetter.isBusy = false;
        renderer.refreshActionState();
        renderSelectedPaymentLetterPanel(
          state.records.payments.find(function (item) {
            return String(item && item.id || "") === paymentId;
          }) || null
        );
        renderer.showNotice("");
        debugError("onSelectedPaymentLetterSubmitClick failed", error, {
          paymentId: paymentId,
          supplierIds: supplierIds
        });
        renderer.showErrorPopup(error.message || "Could not send the payment letter.", "Payment letter could not be sent");
      }
    }

    function setSupplierActivityTab(tabName) {
      state.supplierActivityTab = tabName === "payments" ? "payments" : "invoices";
      renderAll();
    }

    return {
      openSupplierPaymentLetterPreview: openSupplierPaymentLetterPreview,
      getPaymentLetterSuppliers: getPaymentLetterSuppliers,
      refreshSupplierRelatedActivity: refreshSupplierRelatedActivity,
      onSelectedPaymentSendLetterClick: onSelectedPaymentSendLetterClick,
      onSupplierInvoicesExportClick: onSupplierInvoicesExportClick,
      onSupplierPaymentsExportClick: onSupplierPaymentsExportClick,
      onSelectedPaymentLetterSupplierToggle: onSelectedPaymentLetterSupplierToggle,
      onSelectedPaymentLetterToggleAllClick: onSelectedPaymentLetterToggleAllClick,
      onSupplierActivityInvoiceSortChange: onSupplierActivityInvoiceSortChange,
      onSelectedPaymentLetterEmailEditClick: onSelectedPaymentLetterEmailEditClick,
      onSelectedPaymentLetterSubmitClick: onSelectedPaymentLetterSubmitClick,
      setSupplierActivityTab: setSupplierActivityTab,
      closeSelectedPaymentLetterPanel: closeSelectedPaymentLetterPanel,
      renderSelectedPaymentLetterPanel: renderSelectedPaymentLetterPanel,
      resolvePaymentLetterRecipientForSupplier: resolvePaymentLetterRecipientForSupplier
    };
  };
}(window));
