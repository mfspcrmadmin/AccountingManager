(function (global) {
var ns = global.PurchasesManagerApp = global.PurchasesManagerApp || {};

  ns.createInvoicesModule = function (deps) {
    var MODULES = deps.MODULES;
    var FIELD_CANDIDATES = deps.FIELD_CANDIDATES;
    var helpers = deps.helpers;
    var state = deps.state;
    var crm = deps.crm;
    var renderer = deps.renderer;
    var renderAll = deps.renderAll;
    var debugError = deps.debugError;
    var cloneFilterState = deps.cloneFilterState;
    var hasAnyLoadFilterValue = deps.hasAnyLoadFilterValue;
    var getNormalizedStatusFilterValues = deps.getNormalizedStatusFilterValues;
    var getInvoiceSupplierCodeSortValue = deps.getInvoiceSupplierCodeSortValue;
    var getMfspFromInvoice = deps.getMfspFromInvoice;
    var compareValues = deps.compareValues;
    var getInvoiceSupplierSortValue = deps.getInvoiceSupplierSortValue;
    var getInvoiceBookingDisplay = deps.getInvoiceBookingDisplay;
    var getInvoiceType = deps.getInvoiceType;
    var getInvoicePaidAmount = deps.getInvoicePaidAmount;
    var buildSelectedInvoiceDeleteImpact = deps.buildSelectedInvoiceDeleteImpact;
    var buildLocalPageSummary = deps.buildLocalPageSummary;
    var buildCombinedStatusOptions = deps.buildCombinedStatusOptions;
    var INVOICE_STATUS_FILTER_OPTIONS = deps.INVOICE_STATUS_FILTER_OPTIONS;
    var getSupplierNameFromInvoice = deps.getSupplierNameFromInvoice;
    var getInvoiceSupplierDisplay = deps.getInvoiceSupplierDisplay;
    var closeSelectedInvoiceDeletePanel = deps.closeSelectedInvoiceDeletePanel;
    var resolveCoqlFields = deps.resolveCoqlFields;
    var PAY_ALLOCATION_FIELDS = deps.PAY_ALLOCATION_FIELDS;
    var sortRecordsByDateDesc = deps.sortRecordsByDateDesc;
    var INVOICE_LINE_RELATED_FIELDS = deps.INVOICE_LINE_RELATED_FIELDS;
    var INVOICE_LINE_FIELDS = deps.INVOICE_LINE_FIELDS;
    var loadRecordsByCoql = deps.loadRecordsByCoql;
    var buildCoqlOrEqualsClause = deps.buildCoqlOrEqualsClause;
    var INVOICE_ATTACHMENT_FIELDS = deps.INVOICE_ATTACHMENT_FIELDS;
    var buildZohoRecordViewUrl = deps.buildZohoRecordViewUrl;
    var getFriendlyLoadErrorMessage = deps.getFriendlyLoadErrorMessage;
    var ensureInvoicesLoaded = deps.ensureInvoicesLoaded;
    var paymentSelectionIsOpen = deps.paymentSelectionIsOpen;
    var onSelectInvoiceDuringPaymentCreation = deps.onSelectInvoiceDuringPaymentCreation;
    var onInvoicesLoaded = deps.onInvoicesLoaded;
    var invoiceAttachmentPrefetchPromise = null;
    var invoiceAttachmentPrefetchSignature = "";

    async function loadPayAllocationsForInvoice(invoiceId) {
      var escapedId = invoiceId.replace(/'/g, "\\'");
      var selectFields = await resolveCoqlFields(MODULES.payAllocations, PAY_ALLOCATION_FIELDS);

      try {
        return sortRecordsByDateDesc(
          await crm.coql(
            "select " + selectFields.join(", ") +
            " from " + MODULES.payAllocations +
            " where Supplier_Invoice = '" + escapedId + "'" +
            " limit 0, 200"
          ),
          "Allocation_Date"
        );
      } catch (coqlError) {
        try {
          return sortRecordsByDateDesc(
            await crm.searchRecord(MODULES.payAllocations, "(Supplier_Invoice:equals:" + invoiceId + ")"),
            "Allocation_Date"
          );
        } catch (searchError) {
          return [];
        }
      }
    }

    async function ensureInvoiceAllocationsLoaded(invoiceId, forceReload) {
      if (!invoiceId) {
        return [];
      }

      if (!forceReload && Object.prototype.hasOwnProperty.call(state.invoiceAllocationsByInvoiceId, invoiceId)) {
        if (state.invoiceAllocationLoadingId === invoiceId) {
          state.invoiceAllocationLoadingId = "";
          renderAll();
        }
        return state.invoiceAllocationsByInvoiceId[invoiceId];
      }

      state.invoiceAllocationLoadingId = invoiceId;
      renderAll();

      try {
        state.invoiceAllocationsByInvoiceId[invoiceId] = await loadPayAllocationsForInvoice(invoiceId);
        return state.invoiceAllocationsByInvoiceId[invoiceId];
      } catch (error) {
        debugError("ensureInvoiceAllocationsLoaded failed", error, {
          invoiceId: invoiceId
        });
        state.invoiceAllocationsByInvoiceId[invoiceId] = [];
        return [];
      } finally {
        if (state.invoiceAllocationLoadingId === invoiceId) {
          state.invoiceAllocationLoadingId = "";
        }
        renderAll();
      }
    }

    async function loadBookingServiceRecordsByIds(ids) {
      var normalizedIds = helpers.uniqueNonEmpty(ids || []);

      if (!normalizedIds.length) {
        return [];
      }

      return loadRecordsByCoql(MODULES.bookingServices, ["id", "Name"], {
        whereClause: buildCoqlOrEqualsClause("id", normalizedIds)
      });
    }

    async function enrichInvoiceLinesWithBookingServiceNames(lines) {
      var normalizedLines = Array.isArray(lines) ? lines.slice() : [];
      var serviceIds = helpers.uniqueNonEmpty(normalizedLines.map(function (line) {
        return helpers.getLookupId(line && line[INVOICE_LINE_FIELDS.serviceLookup]);
      }));
      var serviceNameById = {};
      var serviceRecords;

      if (!serviceIds.length) {
        return normalizedLines;
      }

      try {
        serviceRecords = await loadBookingServiceRecordsByIds(serviceIds);
        serviceRecords.forEach(function (service) {
          var serviceId = String(service && service.id || "");
          var serviceName = String(service && (service.Name || service.name) || "").trim();

          if (serviceId && serviceName) {
            serviceNameById[serviceId] = serviceName;
          }
        });
      } catch (error) {
        debugError("enrichInvoiceLinesWithBookingServiceNames failed", error, {
          serviceIds: serviceIds
        });
        return normalizedLines;
      }

      return normalizedLines.map(function (line) {
        var updatedLine = Object.assign({}, line);
        var lookupValue = line && line[INVOICE_LINE_FIELDS.serviceLookup];
        var serviceId = helpers.getLookupId(lookupValue);
        var lookupName = lookupValue && typeof lookupValue === "object"
          ? String(lookupValue.name || lookupValue.Name || "").trim()
          : "";
        var resolvedName = lookupName || serviceNameById[serviceId] || "";

        if (!serviceId || !resolvedName) {
          return updatedLine;
        }

        updatedLine[INVOICE_LINE_FIELDS.serviceLookup] = typeof lookupValue === "object" && lookupValue
          ? Object.assign({}, lookupValue, {
            name: lookupValue.name || resolvedName,
            Name: lookupValue.Name || resolvedName
          })
          : {
            id: serviceId,
            name: resolvedName,
            Name: resolvedName
          };

        return updatedLine;
      });
    }

    async function loadInvoiceLinesForInvoice(invoiceId) {
      var escapedId = invoiceId.replace(/'/g, "\\'");
      var selectFields = await resolveCoqlFields(MODULES.invoiceLines, INVOICE_LINE_RELATED_FIELDS);
      var records;

      try {
        records = sortRecordsByDateDesc(
          await crm.coql(
            "select " + selectFields.join(", ") +
            " from " + MODULES.invoiceLines +
            " where " + INVOICE_LINE_FIELDS.invoiceLookup + " = '" + escapedId + "'" +
            " limit 0, 200"
          ),
          INVOICE_LINE_FIELDS.serviceDate
        );
      } catch (coqlError) {
        try {
          records = sortRecordsByDateDesc(
            await crm.searchRecord(MODULES.invoiceLines, "(" + INVOICE_LINE_FIELDS.invoiceLookup + ":equals:" + invoiceId + ")"),
            INVOICE_LINE_FIELDS.serviceDate
          );
        } catch (searchError) {
          records = sortRecordsByDateDesc(
            (await crm.getAllRecords(MODULES.invoiceLines, 1, 200)).filter(function (record) {
              return helpers.getLookupId(record[INVOICE_LINE_FIELDS.invoiceLookup]) === invoiceId;
            }),
            INVOICE_LINE_FIELDS.serviceDate
          );
        }
      }

      return enrichInvoiceLinesWithBookingServiceNames(records);
    }

    async function ensureInvoiceLinesLoaded(invoiceId, forceReload) {
      if (!invoiceId) {
        return [];
      }

      if (!forceReload && Object.prototype.hasOwnProperty.call(state.invoiceLinesByInvoiceId, invoiceId)) {
        if (state.invoiceLineLoadingId === invoiceId) {
          state.invoiceLineLoadingId = "";
          renderAll();
        }
        return state.invoiceLinesByInvoiceId[invoiceId];
      }

      state.invoiceLineLoadingId = invoiceId;
      renderAll();

      try {
        state.invoiceLinesByInvoiceId[invoiceId] = await loadInvoiceLinesForInvoice(invoiceId);
        return state.invoiceLinesByInvoiceId[invoiceId];
      } catch (error) {
        debugError("ensureInvoiceLinesLoaded failed", error, {
          invoiceId: invoiceId
        });
        state.invoiceLinesByInvoiceId[invoiceId] = [];
        return [];
      } finally {
        if (state.invoiceLineLoadingId === invoiceId) {
          state.invoiceLineLoadingId = "";
        }
        renderAll();
      }
    }

    function getInvoiceAttachmentFileName(attachment) {
      return String(
        attachment && (
          attachment.Display_Name ||
          attachment.display_name ||
          attachment.File_Name ||
          attachment.file_name ||
          attachment.file_Name ||
          attachment.fileName ||
          attachment.FileName ||
          attachment.Name ||
          attachment.name
        ) || ""
      ).trim();
    }

    function getInvoiceAttachmentCategory(attachment) {
      var explicitCategory = String(
        attachment && (
          attachment.Category ||
          attachment.category
        ) || ""
      ).trim();
      var fileName = getInvoiceAttachmentFileName(attachment).toLowerCase();

      if (explicitCategory) {
        return explicitCategory;
      }

      if (fileName.indexOf("proforma") !== -1) {
        return "Proforma";
      }

      if (fileName.indexOf("invoice") !== -1 || fileName.indexOf("final") !== -1) {
        return "Final";
      }

      return "Attachment";
    }

    function normalizeInvoiceAttachmentUrl(rawUrl) {
      var trimmedUrl = String(rawUrl || "").trim();
      var nestedIndex;
      var nestedUrl;

      if (!trimmedUrl) {
        return "";
      }

      if (/^chrome-extension:\/\//i.test(trimmedUrl)) {
        nestedIndex = trimmedUrl.search(/https?:\/\//i);

        if (nestedIndex !== -1) {
          nestedUrl = trimmedUrl.slice(nestedIndex).trim();
          try {
            return decodeURIComponent(nestedUrl);
          } catch (error) {
            return nestedUrl;
          }
        }
      }

      return trimmedUrl;
    }

    function getInvoiceAttachmentPreviewUrl(attachment) {
      return normalizeInvoiceAttachmentUrl(String(
        attachment && (
          attachment.Preview_Url ||
          attachment.preview_url ||
          attachment.previewUrl ||
          attachment.Preview_URL ||
          attachment.Download_Url ||
          attachment.download_url ||
          attachment.downloadUrl ||
          attachment.Download_URL ||
          attachment.Link_Url ||
          attachment.link_url ||
          attachment.linkUrl ||
          attachment.Attachment_URL ||
          attachment.attachment_url ||
          attachment.URL ||
          attachment.url
        ) || ""
      ).trim());
    }

    function getInvoiceAttachmentDateValue(attachment) {
      return attachment && (
        attachment.Modified_Time ||
        attachment.Created_Time ||
        attachment.$modified_time ||
        attachment.$created_time ||
        ""
      ) || "";
    }

    function normalizeInvoiceAttachments(records) {
      return (records || []).slice().sort(function (left, right) {
        return (Date.parse(getInvoiceAttachmentDateValue(right)) || 0) - (Date.parse(getInvoiceAttachmentDateValue(left)) || 0);
      });
    }

    function getInvoiceAttachmentFetchModeRank(mode) {
      if (mode === "full") {
        return 2;
      }

      if (mode === "summary") {
        return 1;
      }

      return 0;
    }

    function tagInvoiceAttachments(records, relatedMode) {
      var attachments = normalizeInvoiceAttachments(records);

      attachments._relatedMode = relatedMode || "none";
      return attachments;
    }

    function getInvoiceRecordById(invoiceId) {
      return (state.records.invoices || []).find(function (invoice) {
        return String(invoice && invoice.id || "") === String(invoiceId || "");
      }) || null;
    }

    function syncLoadedInvoiceAttachmentFields(invoiceRecord) {
      var existingRecord;

      if (!invoiceRecord || !invoiceRecord.id) {
        return;
      }

      existingRecord = getInvoiceRecordById(invoiceRecord.id);
      if (!existingRecord) {
        return;
      }

      INVOICE_ATTACHMENT_FIELDS.forEach(function (fieldConfig) {
        if (Object.prototype.hasOwnProperty.call(invoiceRecord, fieldConfig.apiName)) {
          existingRecord[fieldConfig.apiName] = invoiceRecord[fieldConfig.apiName];
        }
      });
    }

    function normalizeInvoiceFieldAttachments(invoiceRecord) {
      return INVOICE_ATTACHMENT_FIELDS.reduce(function (attachments, fieldConfig) {
        var rawValue = invoiceRecord ? invoiceRecord[fieldConfig.apiName] : null;
        var files = Array.isArray(rawValue)
          ? rawValue
          : rawValue
          ? [rawValue]
          : [];

        files.forEach(function (fileRecord, index) {
          var source = fileRecord && typeof fileRecord === "object"
            ? Object.assign({}, fileRecord)
            : {
              Link_Url: String(fileRecord || "")
            };
          var fileName = getInvoiceAttachmentFileName(source) || (fieldConfig.label + (files.length > 1 ? " " + String(index + 1) : ""));
          var previewUrl = getInvoiceAttachmentPreviewUrl(source);

          attachments.push(Object.assign({}, source, {
            Category: fieldConfig.category,
            Source_Field: fieldConfig.apiName,
            Source_Label: fieldConfig.label,
            Display_Name: fileName,
            File_Name: fileName,
            Preview_Url: previewUrl || source.Preview_Url || source.preview_url || "",
            Download_Url: source.Download_Url || source.download_url || previewUrl || ""
          }));
        });

        return attachments;
      }, []);
    }

    function mergeInvoiceAttachments(primaryAttachments, secondaryAttachments) {
      var seen = {};

      return (primaryAttachments || []).concat(secondaryAttachments || []).filter(function (attachment) {
        var key = [
          getInvoiceAttachmentCategory(attachment),
          getInvoiceAttachmentFileName(attachment),
          getInvoiceAttachmentPreviewUrl(attachment),
          attachment && (attachment.id || attachment.file_id || attachment.$file_id || attachment.Source_Field || "")
        ].join("|");

        if (seen[key]) {
          return false;
        }

        seen[key] = true;
        return true;
      });
    }

    function getInvoiceAttachmentKey(attachment, fallbackIndex) {
      return [
        attachment && (attachment.id || attachment.file_id || attachment.$file_id || fallbackIndex || ""),
        attachment && (attachment.Source_Field || attachment.source_field || ""),
        getInvoiceAttachmentCategory(attachment),
        getInvoiceAttachmentFileName(attachment),
        getInvoiceAttachmentPreviewUrl(attachment)
      ].join("|");
    }

    function getInvoiceAttachmentsForField(invoiceRecord, fieldApiName) {
      return normalizeInvoiceFieldAttachments(invoiceRecord).filter(function (attachment) {
        return String(attachment && attachment.Source_Field || "") === String(fieldApiName || "");
      });
    }

    async function loadInvoiceRelatedAttachments(invoiceId, relatedMode) {
      var attachments = [];
      var page;
      var batch;
      var maxPages = relatedMode === "full" ? 5 : 1;
      var perPage = relatedMode === "full" ? 200 : 25;

      for (page = 1; page <= maxPages; page += 1) {
        batch = await crm.getRelatedRecords(MODULES.invoices, invoiceId, "Attachments", page, perPage);

        if (!batch.length) {
          break;
        }

        attachments = attachments.concat(batch);

        if (batch.length < perPage) {
          break;
        }
      }

      return attachments;
    }

    async function loadInvoiceAttachmentsForInvoice(invoiceId, options) {
      var requestOptions = options || {};
      var relatedMode = requestOptions.relatedMode || "full";
      var invoiceRecord = getInvoiceRecordById(invoiceId);
      var fieldAttachments = normalizeInvoiceFieldAttachments(invoiceRecord);
      var relatedAttachments = [];
      var resolvedMode = relatedMode === "none" ? "none" : "summary";

      if (!fieldAttachments.length) {
        try {
          invoiceRecord = await crm.getRecord(MODULES.invoices, invoiceId);
          syncLoadedInvoiceAttachmentFields(invoiceRecord);
          fieldAttachments = normalizeInvoiceFieldAttachments(invoiceRecord);
        } catch (recordError) {
          debugError("loadInvoiceAttachmentsForInvoice getRecord fallback failed", recordError, {
            invoiceId: invoiceId
          });
        }
      }

      if (relatedMode === "full" || (relatedMode === "summary" && !fieldAttachments.length)) {
        try {
          relatedAttachments = await loadInvoiceRelatedAttachments(invoiceId, relatedMode);
          resolvedMode = relatedMode;
        } catch (relatedError) {
          debugError("loadInvoiceRelatedAttachments failed", relatedError, {
            invoiceId: invoiceId,
            relatedMode: relatedMode
          });
        }
      }

      return tagInvoiceAttachments(
        mergeInvoiceAttachments(fieldAttachments, relatedAttachments),
        resolvedMode
      );
    }

    async function ensureInvoiceAttachmentsLoaded(invoiceId, options) {
      var requestOptions = options || {};
      var forceReload = Boolean(requestOptions.forceReload);
      var requestedMode = requestOptions.relatedMode || "full";
      var cachedAttachments;

      if (!invoiceId) {
        return [];
      }

      if (!forceReload && Object.prototype.hasOwnProperty.call(state.invoiceAttachmentsByInvoiceId, invoiceId)) {
        cachedAttachments = state.invoiceAttachmentsByInvoiceId[invoiceId];

        if (getInvoiceAttachmentFetchModeRank(cachedAttachments && cachedAttachments._relatedMode) >= getInvoiceAttachmentFetchModeRank(requestedMode)) {
          if (state.invoiceAttachmentLoadingId === invoiceId) {
            state.invoiceAttachmentLoadingId = "";
            renderAll();
          }
          return cachedAttachments;
        }

        if (state.invoiceAttachmentLoadingId === invoiceId) {
          state.invoiceAttachmentLoadingId = "";
          renderAll();
        }
      }

      state.invoiceAttachmentLoadingId = invoiceId;
      renderAll();

      try {
        state.invoiceAttachmentsByInvoiceId[invoiceId] = await loadInvoiceAttachmentsForInvoice(invoiceId, {
          relatedMode: requestedMode
        });
        return state.invoiceAttachmentsByInvoiceId[invoiceId];
      } catch (error) {
        debugError("ensureInvoiceAttachmentsLoaded failed", error, {
          invoiceId: invoiceId,
          relatedMode: requestedMode
        });
        state.invoiceAttachmentsByInvoiceId[invoiceId] = [];
        return [];
      } finally {
        if (state.invoiceAttachmentLoadingId === invoiceId) {
          state.invoiceAttachmentLoadingId = "";
        }
        renderAll();
      }
    }

    function getInvoiceAttachmentSdkFileId(attachment) {
      var sourceField = String(attachment && (attachment.Source_Field || attachment.source_field) || "").trim();

      return String(
        attachment && (
          attachment.$file_id ||
          attachment.file_id ||
          attachment.File_ID ||
          attachment.fileId ||
          (sourceField ? attachment.id : "")
        ) || ""
      ).trim();
    }

    function summarizeInvoiceFieldRawValue(rawValue) {
      if (rawValue == null) {
        return "empty";
      }

      if (Array.isArray(rawValue)) {
        return "array(" + rawValue.length + ")";
      }

      if (typeof rawValue === "object") {
        return "object keys: " + Object.keys(rawValue).slice(0, 8).join(", ");
      }

      return typeof rawValue + ": " + String(rawValue);
    }

    function getInvoiceFieldAttachmentsSummary(invoiceRecord, fieldApiName) {
      var fieldAttachments = getInvoiceAttachmentsForField(invoiceRecord, fieldApiName);
      var rawValue = invoiceRecord ? invoiceRecord[fieldApiName] : null;

      return {
        fieldAttachments: fieldAttachments,
        rawValue: rawValue,
        rawSummary: summarizeInvoiceFieldRawValue(rawValue)
      };
    }

    function getInvoiceAttachmentSummarySortValue(record, fieldApiName) {
      return getInvoiceAttachmentsForField(record, fieldApiName).map(function (attachment, index) {
        return getInvoiceAttachmentFileName(attachment) || (fieldApiName + " " + String(index + 1));
      }).join(" | ");
    }

    function normalizeInvoiceDetailTab(tabName) {
      if (tabName === "payment" || tabName === "accounting") {
        return tabName;
      }

      return "basic";
    }

    function buildInvoicesView() {
      var records = state.records.invoices.slice();
      var filters = cloneFilterState(state.views.invoices.filters);
      var appliedFilters = cloneFilterState(state.views.invoices.appliedFilters || state.views.invoices.filters);
      var hasCurrentFilters = hasAnyLoadFilterValue(filters);
      var sort = state.views.invoices.sort || { key: "date", direction: "desc" };
      var selectedStatuses = getNormalizedStatusFilterValues(appliedFilters.statusValues);
      var selectedInvoiceType = String(appliedFilters.invoiceType || "").trim();
      var filteredRecords = records.filter(function (invoice) {
        var invoiceDate = helpers.toIsoDate(invoice.Invoice_Date);

        if (selectedStatuses.length && selectedStatuses.indexOf(String(invoice.Status || "")) === -1) {
          return false;
        }

        if (appliedFilters.dateFrom && (!invoiceDate || invoiceDate < appliedFilters.dateFrom)) {
          return false;
        }

        if (appliedFilters.dateTo && (!invoiceDate || invoiceDate > appliedFilters.dateTo)) {
          return false;
        }

        if (selectedInvoiceType && getInvoiceType(invoice) !== selectedInvoiceType) {
          return false;
        }

        if (appliedFilters.supplierCode && !helpers.matchesText(getInvoiceSupplierCodeSortValue(invoice), appliedFilters.supplierCode)) {
          return false;
        }

        if (appliedFilters.mfsp && !helpers.matchesText(getMfspFromInvoice(invoice), appliedFilters.mfsp)) {
          return false;
        }

        return true;
      }).sort(function (left, right) {
        if (sort.key === "invoice") {
          return compareValues(
            helpers.getInvoiceDisplayNumber(left, FIELD_CANDIDATES),
            helpers.getInvoiceDisplayNumber(right, FIELD_CANDIDATES),
            sort.direction
          );
        }

        if (sort.key === "status") {
          return compareValues(left.Status, right.Status, sort.direction);
        }

        if (sort.key === "invoiceType") {
          return compareValues(getInvoiceType(left), getInvoiceType(right), sort.direction);
        }

        if (sort.key === "supplier") {
          return compareValues(
            getInvoiceSupplierSortValue(left),
            getInvoiceSupplierSortValue(right),
            sort.direction
          );
        }

        if (sort.key === "supplierCode") {
          return compareValues(
            getInvoiceSupplierCodeSortValue(left),
            getInvoiceSupplierCodeSortValue(right),
            sort.direction
          );
        }

        if (sort.key === "mfsp") {
          return compareValues(
            getMfspFromInvoice(left),
            getMfspFromInvoice(right),
            sort.direction
          );
        }

        if (sort.key === "booking") {
          return compareValues(
            getInvoiceBookingDisplay(left),
            getInvoiceBookingDisplay(right),
            sort.direction
          );
        }

        if (sort.key === "total") {
          return compareValues(
            helpers.getInvoiceTotalAmount(left, FIELD_CANDIDATES),
            helpers.getInvoiceTotalAmount(right, FIELD_CANDIDATES),
            sort.direction
          );
        }

        if (sort.key === "paid") {
          return compareValues(
            getInvoicePaidAmount(left),
            getInvoicePaidAmount(right),
            sort.direction
          );
        }

        if (sort.key === "pending") {
          return compareValues(
            helpers.getInvoicePendingAmount(left, FIELD_CANDIDATES),
            helpers.getInvoicePendingAmount(right, FIELD_CANDIDATES),
            sort.direction
          );
        }

        if (sort.key === "invoiceFile") {
          return compareValues(
            getInvoiceAttachmentSummarySortValue(left, "Invoice_File"),
            getInvoiceAttachmentSummarySortValue(right, "Invoice_File"),
            sort.direction
          );
        }

        return compareValues(
          Date.parse(left.Invoice_Date || "") || 0,
          Date.parse(right.Invoice_Date || "") || 0,
          sort.direction
        );
      });
      var filteredTotalAmount = filteredRecords.reduce(function (sum, invoice) {
        return sum + helpers.getInvoiceTotalAmount(invoice, FIELD_CANDIDATES) * (getInvoiceType(invoice) === "Credit Note" ? -1 : 1);
      }, 0);
      var selectedFilteredRecords = filteredRecords.filter(function (invoice) {
        return Boolean(state.views.invoices.selectedIds[invoice.id]);
      });
      var selectedFilteredAmount = selectedFilteredRecords.reduce(function (sum, invoice) {
        var amount = (
          Number(helpers.getCandidateValue(invoice, FIELD_CANDIDATES.invoice.totalPayableAmount)) ||
          Number(helpers.getCandidateValue(invoice, FIELD_CANDIDATES.invoice.invoiceTotal)) ||
          helpers.getInvoiceTotalAmount(invoice, FIELD_CANDIDATES)
        );
        return sum + amount * (getInvoiceType(invoice) === "Credit Note" ? -1 : 1);
      }, 0);
      var totalPages = Math.max(1, Math.ceil(filteredRecords.length / state.views.invoices.perPage));
      var page = Math.min(Math.max(1, Number(state.views.invoices.page) || 1), totalPages);
      var hasMore = page < totalPages;
      var visibleRecords = filteredRecords.slice(
        (page - 1) * state.views.invoices.perPage,
        page * state.views.invoices.perPage
      );
      var selectedVisibleCount = visibleRecords.filter(function (invoice) {
        return Boolean(state.views.invoices.selectedIds[invoice.id]);
      }).length;
      var selectedDetailId = state.views.invoices.selectedDetailId;
      var selectedInvoice;
      var selectedInvoiceLines = [];
      var selectedInvoiceLinesLoading = false;
      var selectedInvoiceAllocations = [];
      var selectedInvoiceAllocationsLoading = false;
      var selectedInvoiceAttachments = [];
      var selectedInvoiceAttachmentsLoading = false;
      var selectedInvoiceAttachmentPreview = null;
      var selectedInvoiceDeleteImpact = null;

      if (selectedDetailId && !filteredRecords.some(function (invoice) { return invoice.id === selectedDetailId; })) {
        selectedDetailId = "";
        state.views.invoices.selectedDetailId = "";
      }

      selectedInvoice = filteredRecords.find(function (invoice) {
        return invoice.id === selectedDetailId;
      }) || null;

      if (selectedDetailId) {
        selectedInvoiceLines = state.invoiceLinesByInvoiceId[selectedDetailId] || [];
        selectedInvoiceLinesLoading = state.invoiceLineLoadingId === selectedDetailId;
        selectedInvoiceAllocations = state.invoiceAllocationsByInvoiceId[selectedDetailId] || [];
        selectedInvoiceAllocationsLoading = state.invoiceAllocationLoadingId === selectedDetailId;
        selectedInvoiceAttachments = state.invoiceAttachmentsByInvoiceId[selectedDetailId] || [];
        selectedInvoiceAttachmentsLoading = state.invoiceAttachmentLoadingId === selectedDetailId;

        if (state.views.invoices.selectedAttachmentPreviewKey) {
          selectedInvoiceAttachmentPreview = selectedInvoiceAttachments.find(function (attachment, index) {
            return getInvoiceAttachmentKey(attachment, index) === state.views.invoices.selectedAttachmentPreviewKey;
          }) || null;
        }
      }

      if (selectedInvoice) {
        selectedInvoiceDeleteImpact = buildSelectedInvoiceDeleteImpact(selectedInvoice);
      }

      state.views.invoices.page = page;
      state.views.invoices.hasMore = hasMore;

      return {
        filters: filters,
        sort: sort,
        filteredRecords: filteredRecords,
        filteredTotalAmount: filteredTotalAmount,
        selectedFilteredRecords: selectedFilteredRecords,
        selectedFilteredAmount: selectedFilteredAmount,
        countLabel: state.views.invoices.hasLoaded
          ? filteredRecords.length + (filteredRecords.length === 1 ? " invoice" : " invoices")
          : "0 invoices",
        listTab: state.views.invoices.listTab || "basic",
        selectedDetailId: selectedDetailId,
        selectedInvoice: selectedInvoice,
        selectedInvoiceDetailTab: normalizeInvoiceDetailTab(state.views.invoices.detailTab || "basic"),
        selectedInvoiceLines: selectedInvoiceLines,
        selectedInvoiceLinesLoading: selectedInvoiceLinesLoading,
        selectedInvoiceAllocations: selectedInvoiceAllocations,
        selectedInvoiceAllocationsLoading: selectedInvoiceAllocationsLoading,
        selectedInvoiceAttachments: selectedInvoiceAttachments,
        selectedInvoiceAttachmentsLoading: selectedInvoiceAttachmentsLoading,
        selectedInvoiceAttachmentPreview: selectedInvoiceAttachmentPreview,
        selectedInvoiceDeleteImpact: selectedInvoiceDeleteImpact,
        visibleRecords: visibleRecords,
        selectedVisibleCount: selectedVisibleCount,
        page: page,
        hasMore: hasMore,
        pageSummary: buildLocalPageSummary(page, totalPages),
        statusOptions: buildCombinedStatusOptions(INVOICE_STATUS_FILTER_OPTIONS, records, "Status"),
        emptyMessage: state.currentTab === "invoices" && state.isLoading
          ? "Loading invoices..."
          : state.views.invoices.hasLoaded || !hasCurrentFilters
          ? "No invoices match the current filters."
          : "Use the filters and click Load to fetch invoices.",
        getSupplierName: getSupplierNameFromInvoice,
        getSupplierDisplay: getInvoiceSupplierDisplay,
        getMfsp: getMfspFromInvoice
      };
    }

    function toggleInvoiceSelection(invoiceId, isSelected) {
      if (isSelected) {
        state.views.invoices.selectedIds[invoiceId] = true;
      } else {
        delete state.views.invoices.selectedIds[invoiceId];
      }

      renderAll();
    }

    function toggleVisibleInvoices(isSelected, visibleRecords) {
      visibleRecords.forEach(function (invoice) {
        if (isSelected) {
          state.views.invoices.selectedIds[invoice.id] = true;
        } else {
          delete state.views.invoices.selectedIds[invoice.id];
        }
      });

      renderAll();
    }

    function selectInvoiceDetail(invoiceId) {
      var activeDetailTab = normalizeInvoiceDetailTab(state.views && state.views.invoices ? state.views.invoices.detailTab : "basic");

      closeSelectedInvoiceDeletePanel(false);
      state.views.invoices.selectedDetailId = invoiceId || "";
      state.views.invoices.selectedAttachmentPreviewKey = "";
      state.invoiceLineLoadingId = invoiceId || "";
      state.invoiceAllocationLoadingId = invoiceId || "";
      state.views.invoices.detailTab = activeDetailTab;
      renderAll();

      if (invoiceId) {
        ensureInvoiceLinesLoaded(invoiceId);
        ensureInvoiceAllocationsLoaded(invoiceId);
        ensureInvoiceAttachmentsLoaded(invoiceId, {
          relatedMode: "full"
        });
      }
    }

    function setInvoiceDetailTab(tabName) {
      var normalizedTab = normalizeInvoiceDetailTab(tabName);
      var selectedInvoiceId = state.views && state.views.invoices ? state.views.invoices.selectedDetailId : "";

      state.views.invoices.detailTab = normalizedTab;
      renderAll();

      if (normalizedTab === "basic" && selectedInvoiceId) {
        ensureInvoiceAttachmentsLoaded(selectedInvoiceId, {
          relatedMode: "full"
        });
      } else if (normalizedTab === "payment" && selectedInvoiceId) {
        ensureInvoiceLinesLoaded(selectedInvoiceId);
        ensureInvoiceAllocationsLoaded(selectedInvoiceId);
      }
    }

    function prefetchVisibleInvoiceAttachments(visibleRecords) {
      var records = (visibleRecords || []).filter(function (invoice) {
        return Boolean(invoice && invoice.id);
      });
      var signature = records.map(function (invoice) {
        return String(invoice.id);
      }).join("|");

      if (!signature || invoiceAttachmentPrefetchSignature === signature || invoiceAttachmentPrefetchPromise) {
        return;
      }

      invoiceAttachmentPrefetchSignature = signature;
      invoiceAttachmentPrefetchPromise = (async function () {
        var index;
        var invoice;

        for (index = 0; index < records.length; index += 1) {
          invoice = records[index];

          if (!invoice || !invoice.id) {
            continue;
          }

          if (state.currentTab !== "invoices" || (state.views.invoices.listTab || "basic") !== "attachments") {
            break;
          }

          if (Object.prototype.hasOwnProperty.call(state.invoiceAttachmentsByInvoiceId, invoice.id)) {
            continue;
          }

          await ensureInvoiceAttachmentsLoaded(invoice.id, {
            relatedMode: "summary"
          });
        }
      }()).finally(function () {
        invoiceAttachmentPrefetchPromise = null;
        if (invoiceAttachmentPrefetchSignature === signature) {
          invoiceAttachmentPrefetchSignature = "";
        }
      });
    }

    function setInvoiceListTab(tabName) {
      var normalizedTab = tabName === "attachments" ? "attachments" : "basic";

      state.views.invoices.listTab = normalizedTab;
      renderAll();
    }

    function setSelectedInvoiceAttachmentPreview(previewKey) {
      state.views.invoices.selectedAttachmentPreviewKey = String(previewKey || "") === String(state.views.invoices.selectedAttachmentPreviewKey || "")
        ? ""
        : String(previewKey || "");
      renderAll();
    }

    async function openInvoiceAttachmentFallback(invoiceId) {
      var viewUrl;
      var openedWindow;

      if (!invoiceId) {
        renderer.showError("Select an invoice first.");
        return;
      }

      viewUrl = "https://crm.zoho.eu/crm/org20093299576/tab/CustomModule18/" + encodeURIComponent(invoiceId);

      if (viewUrl) {
        if (typeof global.open === "function") {
          openedWindow = global.open(viewUrl, "_blank", "noopener");

          if (openedWindow) {
            return;
          }
        }

        if (global.location && typeof global.location.assign === "function") {
          global.location.assign(viewUrl);
          return;
        }

        if (global.location) {
          global.location.href = viewUrl;
          return;
        }
      }

      renderer.showError("Could not open the Zoho invoice.");
    }

    async function loadInvoicesTabData() {
      state.views.invoices.page = 1;
      state.views.invoices.appliedFilters = cloneFilterState(state.views.invoices.filters);
      await refreshInvoicesTabData({
        loadingLabel: "Loading invoices...",
        errorMessage: "Could not load invoices.",
        loadedFlag: true
      });
    }

    async function refreshInvoicesTabData() {
      var options = arguments[0] || {};

      invoiceAttachmentPrefetchPromise = null;
      invoiceAttachmentPrefetchSignature = "";
      renderer.showError("");
      renderer.showNotice(options.loadingLabel || "Loading invoices...", {
        isLoading: true
      });
      renderer.setLoading(true, options.loadingLabel || "Loading invoices...");
      renderAll();

      try {
        state.loaded.invoices = false;
        state.views.invoices.hasMore = false;
        state.records.invoices = [];
        state.invoiceAttachmentsByInvoiceId = {};
        state.invoiceAttachmentLoadingId = "";
        await ensureInvoicesLoaded();
        state.views.invoices.hasLoaded = options.loadedFlag !== false;
        if (typeof onInvoicesLoaded === "function") {
          onInvoicesLoaded();
        }
        renderAll();
      } catch (error) {
        debugError("refreshInvoicesTabData failed", error, {
          filters: cloneFilterState(state.views.invoices.appliedFilters || state.views.invoices.filters)
        });
        renderer.showError(getFriendlyLoadErrorMessage("invoices", error, options.errorMessage || "Could not refresh invoices."));
      } finally {
        renderer.setLoading(false);
        renderer.showNotice("");
      }
    }

    return {
      buildView: buildInvoicesView,
      toggleSelection: toggleInvoiceSelection,
      toggleVisible: toggleVisibleInvoices,
      selectDetail: selectInvoiceDetail,
      normalizeDetailTab: normalizeInvoiceDetailTab,
      setDetailTab: setInvoiceDetailTab,
      prefetchVisibleAttachments: prefetchVisibleInvoiceAttachments,
      setListTab: setInvoiceListTab,
      setAttachmentPreview: setSelectedInvoiceAttachmentPreview,
      openAttachmentFallback: openInvoiceAttachmentFallback,
      loadTabData: loadInvoicesTabData,
      refreshTabData: refreshInvoicesTabData,
      ensureAllocationsLoaded: ensureInvoiceAllocationsLoaded,
      ensureLinesLoaded: ensureInvoiceLinesLoaded,
      ensureAttachmentsLoaded: ensureInvoiceAttachmentsLoaded,
      getAttachmentFileName: getInvoiceAttachmentFileName,
      getAttachmentCategory: getInvoiceAttachmentCategory,
      getAttachmentPreviewUrl: getInvoiceAttachmentPreviewUrl,
      getAttachmentDateValue: getInvoiceAttachmentDateValue,
      getAttachmentKey: getInvoiceAttachmentKey,
      getAttachmentsForField: getInvoiceAttachmentsForField,
      getAttachmentSdkFileId: getInvoiceAttachmentSdkFileId,
      getFieldAttachmentsSummary: getInvoiceFieldAttachmentsSummary,
      syncLoadedInvoiceAttachmentFields: syncLoadedInvoiceAttachmentFields
    };
  };
}(window));
