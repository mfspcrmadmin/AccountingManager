(function (global) {
var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

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
    var buildZohoRecordViewUrl = deps.buildZohoRecordViewUrl;
    var getFriendlyLoadErrorMessage = deps.getFriendlyLoadErrorMessage;
    var ensureInvoicesLoaded = deps.ensureInvoicesLoaded;
    var paymentSelectionIsOpen = deps.paymentSelectionIsOpen;
    var onSelectInvoiceDuringPaymentCreation = deps.onSelectInvoiceDuringPaymentCreation;
    var onInvoicesLoaded = deps.onInvoicesLoaded;
    var invoiceFileLoadQueue = [];
    var invoiceFileLoadQueueIsRunning = false;

    function getCreatedByValue(record) {
      if (!record) {
        return null;
      }

      return record.Created_By || record.CreatedBy || record["Created By"] || null;
    }

    function ensureInvoiceCreatedByLoaded(invoiceId) {
      var invoice = (state.records.invoices || []).find(function (record) {
        return record.id === invoiceId;
      });

      // COQL can omit this system field for Supplier Invoices, while the
      // record endpoint returns it. Fetch it only when the list response did
      // not include a creator.
      if (!invoice || helpers.getLookupName(getCreatedByValue(invoice))) {
        return;
      }

      crm.getRecord(MODULES.invoices, invoiceId).then(function (detail) {
        var createdBy = getCreatedByValue(detail);

        if (createdBy) {
          invoice.Created_By = createdBy;
          renderAll();
        }
      }).catch(function (error) {
        debugError("ensureInvoiceCreatedByLoaded failed", error, {
          invoiceId: invoiceId
        });
      });
    }

    function ensureInvoiceFileLoaded(invoiceId) {
      var invoice = (state.records.invoices || []).find(function (record) {
        return record.id === invoiceId;
      });

      if (!invoice || Object.prototype.hasOwnProperty.call(invoice, "Invoice_File") || invoice._invoiceFileLoading) {
        return Promise.resolve();
      }

      invoice._invoiceFileLoading = true;
      renderAll();
      return crm.getRecord(MODULES.invoices, invoiceId).then(function (detail) {
        invoice.Invoice_File = detail && Object.prototype.hasOwnProperty.call(detail, "Invoice_File")
          ? detail.Invoice_File
          : null;
      }).catch(function () {
        invoice.Invoice_File = null;
      }).finally(function () {
        invoice._invoiceFileLoading = false;
        renderAll();
      });
    }

    function queueInvoiceFileLoad(invoiceId) {
      var invoice = (state.records.invoices || []).find(function (record) {
        return record.id === invoiceId;
      });

      if (!invoice || Object.prototype.hasOwnProperty.call(invoice, "Invoice_File") || invoice._invoiceFileLoading || invoice._invoiceFileQueued) {
        return;
      }

      invoice._invoiceFileQueued = true;
      invoiceFileLoadQueue.push(invoiceId);

      if (invoiceFileLoadQueueIsRunning) {
        return;
      }

      invoiceFileLoadQueueIsRunning = true;
      (async function () {
        var nextInvoiceId;
        var nextInvoice;

        while (invoiceFileLoadQueue.length) {
          nextInvoiceId = invoiceFileLoadQueue.shift();
          nextInvoice = (state.records.invoices || []).find(function (record) {
            return record.id === nextInvoiceId;
          });

          if (nextInvoice) {
            nextInvoice._invoiceFileQueued = false;
          }

          await ensureInvoiceFileLoaded(nextInvoiceId);
        }
      }()).finally(function () {
        invoiceFileLoadQueueIsRunning = false;
      });
    }

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

    function getInvoiceAttachmentMimeType(attachment) {
      return String(attachment && (
        attachment.type ||
        attachment.mime_type ||
        attachment.content_type ||
        attachment.Content_Type ||
        ""
      ) || "").trim();
    }

    function logInvoiceAttachmentPreview(label, payload, isError) {
      if (!global.console) {
        return;
      }

      if (isError && typeof global.console.error === "function") {
        global.console.error("[AccountingManager][Invoice preview] " + label, payload || {});
      } else if (typeof global.console.info === "function") {
        global.console.info("[AccountingManager][Invoice preview] " + label, payload || {});
      }
    }

    function getInvoiceAttachmentPreviewDebugData(attachment, fileId) {
      return {
        name: getInvoiceAttachmentFileName(attachment),
        sourceField: attachment && (attachment.Source_Field || attachment.source_field || ""),
        attachmentId: attachment && (attachment.id || ""),
        fileId: fileId || "",
        dollarFileId: attachment && (attachment.$file_id || ""),
        rawFileId: attachment && (attachment.file_id || attachment.File_ID || attachment.fileId || ""),
        previewUrlPresent: Boolean(getInvoiceAttachmentPreviewUrl(attachment)),
        availableKeys: attachment && typeof attachment === "object" ? Object.keys(attachment) : []
      };
    }

    function toInvoiceAttachmentBlob(source, mimeType) {
      if (source instanceof Blob) {
        return source;
      }

      if (source instanceof ArrayBuffer || (source && ArrayBuffer.isView(source))) {
        return new Blob([source], { type: mimeType || "application/octet-stream" });
      }

      return new Blob([source], { type: mimeType || "application/octet-stream" });
    }

    function revokeInvoiceAttachmentPreviewUrl(attachment) {
      var objectUrl = attachment && attachment._previewObjectUrl;

      if (!objectUrl) {
        return;
      }

      if (global.URL && typeof global.URL.revokeObjectURL === "function") {
        global.URL.revokeObjectURL(objectUrl);
      }

      if (attachment.Preview_Url === objectUrl) {
        delete attachment.Preview_Url;
      }
      if (attachment.Download_Url === objectUrl) {
        delete attachment.Download_Url;
      }
      delete attachment._previewObjectUrl;
    }

    function clearSelectedInvoiceAttachmentPreview() {
      var invoiceId = state.views.invoices.selectedDetailId;
      var previewKey = state.views.invoices.selectedAttachmentPreviewKey;
      var attachments = state.invoiceAttachmentsByInvoiceId[invoiceId] || [];

      attachments.forEach(function (attachment, index) {
        if (getInvoiceAttachmentKey(attachment, index) === previewKey) {
          revokeInvoiceAttachmentPreviewUrl(attachment);
        }
      });

      state.views.invoices.selectedAttachmentPreviewKey = "";
      state.invoiceAttachmentPreviewLoadingKey = "";
    }

    function clearInvoiceAttachmentPreviewUrls() {
      Object.keys(state.invoiceAttachmentsByInvoiceId || {}).forEach(function (invoiceId) {
        (state.invoiceAttachmentsByInvoiceId[invoiceId] || []).forEach(revokeInvoiceAttachmentPreviewUrl);
      });
      state.invoiceAttachmentPreviewLoadingKey = "";
    }

    async function ensureSelectedInvoiceAttachmentPreviewUrl(previewKey) {
      var invoiceId = state.views.invoices.selectedDetailId;
      var attachments = state.invoiceAttachmentsByInvoiceId[invoiceId] || [];
      var attachment = null;
      var fileId;
      var source;
      var objectUrl;

      attachments.some(function (candidate, index) {
        if (getInvoiceAttachmentKey(candidate, index) === previewKey) {
          attachment = candidate;
          return true;
        }
        return false;
      });

      if (!attachment || getInvoiceAttachmentPreviewUrl(attachment)) {
        return;
      }

      fileId = getInvoiceAttachmentSdkFileId(attachment);
      logInvoiceAttachmentPreview("attachment selected", {
        invoiceId: invoiceId,
        previewKey: previewKey,
        attachment: getInvoiceAttachmentPreviewDebugData(attachment, fileId)
      });
      if (!fileId) {
        logInvoiceAttachmentPreview("no usable file ID was returned by Zoho", {
          invoiceId: invoiceId,
          previewKey: previewKey,
          attachment: getInvoiceAttachmentPreviewDebugData(attachment, fileId)
        }, true);
        return;
      }

      state.invoiceAttachmentPreviewLoadingKey = previewKey;
      renderAll();

      try {
        source = await crm.getFile(fileId);
        logInvoiceAttachmentPreview("getFile response received", {
          invoiceId: invoiceId,
          fileId: fileId,
          valueType: typeof source,
          isBlob: source instanceof Blob,
          isArrayBuffer: source instanceof ArrayBuffer,
          byteLength: source && (source.size || source.byteLength || 0),
          mimeType: source && source.type || getInvoiceAttachmentMimeType(attachment)
        });
        if (typeof source === "string" && /^(https?:|data:|blob:)/i.test(source)) {
          objectUrl = source;
        } else {
          objectUrl = global.URL.createObjectURL(toInvoiceAttachmentBlob(source, getInvoiceAttachmentMimeType(attachment)));
          attachment._previewObjectUrl = objectUrl;
        }

        if (state.views.invoices.selectedDetailId !== invoiceId || state.views.invoices.selectedAttachmentPreviewKey !== previewKey) {
          revokeInvoiceAttachmentPreviewUrl(attachment);
          return;
        }

        attachment.Preview_Url = objectUrl;
        attachment.Download_Url = attachment.Download_Url || objectUrl;
      } catch (error) {
        logInvoiceAttachmentPreview("getFile or preview conversion failed", {
          invoiceId: invoiceId,
          fileId: fileId,
          message: error && error.message || String(error || ""),
          name: error && error.name || ""
        }, true);
        debugError("ensureSelectedInvoiceAttachmentPreviewUrl failed", error, {
          invoiceId: invoiceId,
          fileId: fileId
        });
      } finally {
        if (state.invoiceAttachmentPreviewLoadingKey === previewKey) {
          state.invoiceAttachmentPreviewLoadingKey = "";
        }
        renderAll();
      }
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

    function getInvoiceSupplierDestination(invoice) {
      return String(invoice["Supplier.Destination"] || "").trim();
    }

    function getInvoiceGroup(invoice) {
      var groupBy = state.views.invoices.groupBy || "none";
      var label;
      if (groupBy === "none") { return null; }
      if (groupBy === "destination") {
        label = getInvoiceSupplierDestination(invoice) || "Empty";
        return { key: label.toLowerCase(), label: label };
      }
      if (groupBy === "mfsp") {
        label = getMfspFromInvoice(invoice) || "No MFSP";
        return { key: label, label: label };
      }
      label = getSupplierNameFromInvoice(invoice) || "No supplier";
      return { key: String(helpers.getLookupId(invoice.Supplier) || label), label: label };
    }

    function buildInvoicesView() {
      var records = state.records.invoices.slice();
      var filters = cloneFilterState(state.views.invoices.filters);
      var appliedFilters = cloneFilterState(state.views.invoices.appliedFilters || state.views.invoices.filters);
      var hasCurrentFilters = hasAnyLoadFilterValue(filters);
      var sort = state.views.invoices.sort || { key: "date", direction: "desc" };
      var invoiceView = state.views.invoices.view || "open";
      var selectedStatuses = getNormalizedStatusFilterValues(appliedFilters.statusValues);
      var selectedInvoiceType = String(appliedFilters.invoiceType || "").trim();
      var filteredRecords = records.filter(function (invoice) {
        var invoiceDate = helpers.toIsoDate(invoice.Invoice_Date);
        var status = String(invoice.Status || "").trim().toLowerCase();
        var destinations = appliedFilters.destinationValues;
        if (Array.isArray(destinations) && destinations.length < 3 && !destinations.some(function (value) {
          return (value === "Empty" ? "" : value.toLowerCase()) === getInvoiceSupplierDestination(invoice).toLowerCase();
        })) { return false; }
        if (appliedFilters.selfEmployed === "true" || appliedFilters.selfEmployed === "false") {
          var selfEmployed = invoice["Supplier.Is_Self_Employed"];
          if (String(selfEmployed).toLowerCase() !== appliedFilters.selfEmployed) { return false; }
        }

        if (invoiceView === "closed" && status !== "paid" && status !== "cancelled" && status !== "rejected") {
          return false;
        }

        if (invoiceView === "open" && (status === "paid" || status === "cancelled" || status === "rejected")) {
          return false;
        }

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

        if (appliedFilters.supplierCode && !helpers.matchesText(getInvoiceSupplierDisplay(invoice).code, appliedFilters.supplierCode)) {
          return false;
        }

        if (appliedFilters.invoiceNumber && !helpers.matchesText([
          helpers.getInvoiceDisplayNumber(invoice, FIELD_CANDIDATES),
          invoice.Name,
          invoice.Invoice_Number
        ].join(" "), appliedFilters.invoiceNumber)) {
          return false;
        }

        if (appliedFilters.mfsp && !helpers.matchesText(getMfspFromInvoice(invoice), appliedFilters.mfsp)) {
          return false;
        }

        return true;
      }).sort(function (left, right) {
        var leftGroup = getInvoiceGroup(left);
        var rightGroup = getInvoiceGroup(right);
        var groupComparison = leftGroup && rightGroup
          ? compareValues(leftGroup.label, rightGroup.label, "asc") || compareValues(leftGroup.key, rightGroup.key, "asc") : 0;
        if (groupComparison) { return groupComparison; }
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

        return compareValues(
          Date.parse(left.Invoice_Date || "") || 0,
          Date.parse(right.Invoice_Date || "") || 0,
          sort.direction
        );
      });
      var filteredTotalAmount = filteredRecords.reduce(function (sum, invoice) {
        return sum + helpers.getInvoiceTotalAmount(invoice, FIELD_CANDIDATES) * (getInvoiceType(invoice) === "Credit Note" ? -1 : 1);
      }, 0);
      var selectedRecordsById = state.views.invoices.selectedRecordsById || {};
      var recordsById = {};
      var selectedFilteredRecords;

      records.forEach(function (invoice) {
        if (invoice && invoice.id) {
          recordsById[String(invoice.id)] = invoice;
          if (state.views.invoices.selectedIds[invoice.id]) {
            selectedRecordsById[String(invoice.id)] = invoice;
          }
        }
      });
      state.views.invoices.selectedRecordsById = selectedRecordsById;
      selectedFilteredRecords = Object.keys(state.views.invoices.selectedIds).map(function (invoiceId) {
        return recordsById[String(invoiceId)] || selectedRecordsById[String(invoiceId)] || null;
      }).filter(Boolean);
      var selectedFilteredAmount = selectedFilteredRecords.reduce(function (sum, invoice) {
        var amount = (
          Number(helpers.getCandidateValue(invoice, FIELD_CANDIDATES.invoice.totalPayableAmount)) ||
          Number(helpers.getCandidateValue(invoice, FIELD_CANDIDATES.invoice.invoiceTotal)) ||
          helpers.getInvoiceTotalAmount(invoice, FIELD_CANDIDATES)
        );
        return sum + amount * (getInvoiceType(invoice) === "Credit Note" ? -1 : 1);
      }, 0);
      // Invoice records are already loaded as a complete filtered dataset.
      // Keep one scrollable list instead of dividing it into local pages.
      var totalPages = 1;
      var page = 1;
      var hasMore = false;
      var visibleRecords = filteredRecords;
      var selectedVisibleCount = visibleRecords.filter(function (invoice) {
        return Boolean(state.views.invoices.selectedIds[invoice.id]);
      }).length;
      var selectedDetailId = state.views.invoices.selectedDetailId;
      var selectedInvoice;
      var selectedInvoiceLines = [];
      var selectedInvoiceLinesLoading = false;
      var selectedInvoiceAllocations = [];
      var selectedInvoiceAllocationsLoading = false;
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
        showAttachments: Boolean(state.views.invoices.showAttachments),
        groupBy: state.views.invoices.groupBy || "none",
        getGroup: getInvoiceGroup,
        selectedDetailId: selectedDetailId,
        selectedInvoice: selectedInvoice,
        selectedInvoiceDetailTab: normalizeInvoiceDetailTab(state.views.invoices.detailTab || "basic"),
        selectedInvoiceLines: selectedInvoiceLines,
        selectedInvoiceLinesLoading: selectedInvoiceLinesLoading,
        selectedInvoiceAllocations: selectedInvoiceAllocations,
        selectedInvoiceAllocationsLoading: selectedInvoiceAllocationsLoading,
        selectedInvoiceDeleteImpact: selectedInvoiceDeleteImpact,
        visibleRecords: visibleRecords,
        selectedVisibleCount: selectedVisibleCount,
        page: page,
        hasMore: hasMore,
        pageSummary: filteredRecords.length + (filteredRecords.length === 1 ? " invoice" : " invoices"),
        statusOptions: ns.getWorkspaceStatusValues("invoices", invoiceView, INVOICE_STATUS_FILTER_OPTIONS).map(function (value) {
          return { value: value, label: value };
        }),
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
      var invoice = state.records.invoices.find(function (record) {
        return String(record && record.id || "") === String(invoiceId || "");
      });

      if (isSelected) {
        state.views.invoices.selectedIds[invoiceId] = true;
        if (invoice) {
          state.views.invoices.selectedRecordsById[invoiceId] = invoice;
        }
      } else {
        delete state.views.invoices.selectedIds[invoiceId];
        delete state.views.invoices.selectedRecordsById[invoiceId];
      }

      renderAll();
    }

    function toggleVisibleInvoices(isSelected, visibleRecords) {
      visibleRecords.forEach(function (invoice) {
        if (isSelected) {
          state.views.invoices.selectedIds[invoice.id] = true;
          state.views.invoices.selectedRecordsById[invoice.id] = invoice;
        } else {
          delete state.views.invoices.selectedIds[invoice.id];
          delete state.views.invoices.selectedRecordsById[invoice.id];
        }
      });

      renderAll();
    }

    function selectInvoiceDetail(invoiceId) {
      var activeDetailTab = normalizeInvoiceDetailTab(state.views && state.views.invoices ? state.views.invoices.detailTab : "basic");

      closeSelectedInvoiceDeletePanel(false);
      state.views.invoices.selectedDetailId = invoiceId || "";
      state.invoiceLineLoadingId = invoiceId || "";
      state.invoiceAllocationLoadingId = invoiceId || "";
      state.views.invoices.detailTab = activeDetailTab;
      renderAll();

      if (invoiceId) {
        ensureInvoiceCreatedByLoaded(invoiceId);
        ensureInvoiceFileLoaded(invoiceId);
        ensureInvoiceLinesLoaded(invoiceId);
        ensureInvoiceAllocationsLoaded(invoiceId);
      }
    }

    function setInvoiceDetailTab(tabName) {
      var normalizedTab = normalizeInvoiceDetailTab(tabName);
      var selectedInvoiceId = state.views && state.views.invoices ? state.views.invoices.selectedDetailId : "";

      state.views.invoices.detailTab = normalizedTab;
      renderAll();

      if (normalizedTab === "payment" && selectedInvoiceId) {
        ensureInvoiceLinesLoaded(selectedInvoiceId);
        ensureInvoiceAllocationsLoaded(selectedInvoiceId);
      }
    }

    function setShowInvoiceAttachments(showAttachments) {
      state.views.invoices.showAttachments = Boolean(showAttachments);
      renderAll();
    }

    async function openInvoiceInCrm(invoiceId) {
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
      setShowAttachments: setShowInvoiceAttachments,
      openInCrm: openInvoiceInCrm,
      loadTabData: loadInvoicesTabData,
      refreshTabData: refreshInvoicesTabData,
      ensureAllocationsLoaded: ensureInvoiceAllocationsLoaded,
      ensureLinesLoaded: ensureInvoiceLinesLoaded,
      queueFileLoad: queueInvoiceFileLoad,
    };
  };
}(window));
