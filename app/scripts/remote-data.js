(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createRemoteDataModule = function (deps) {
    var MODULES = deps.MODULES;
    var INVOICE_STATUS_FILTER_OPTIONS = deps.INVOICE_STATUS_FILTER_OPTIONS;
    var PAYMENT_STATUS_FILTER_OPTIONS = deps.PAYMENT_STATUS_FILTER_OPTIONS;
    var BOOKING_BROWSER_FIELDS = deps.BOOKING_BROWSER_FIELDS;
    var state = deps.state;
    var helpers = deps.helpers;
    var crm = deps.crm;
    var debugWarn = deps.debugWarn;
    var debugError = deps.debugError;
    var resolveCoqlFields = deps.resolveCoqlFields;
    var resolveFieldApiByCandidates = deps.resolveFieldApiByCandidates;
    var escapeCoqlValue = deps.escapeCoqlValue;
    var getNormalizedStatusFilterValues = deps.getNormalizedStatusFilterValues;
    var hasAllStatusFilterValuesSelected = deps.hasAllStatusFilterValuesSelected;
    var getNormalizedBookingStageValues = deps.getNormalizedBookingStageValues;
    var hasAllBookingStageFilterValuesSelected = deps.hasAllBookingStageFilterValuesSelected;

    var MAX_RECORD_FETCH_PAGES = 100;

    function attachCoqlContextToError(error, context) {
      var targetError = error || new Error("Unknown COQL error");
      var details = context || {};

      try {
        if (details.query) {
          targetError.coqlQuery = details.query;
        }

        if (details.whereClause) {
          targetError.coqlWhereClause = details.whereClause;
        }

        if (details.orderByClause) {
          targetError.coqlOrderByClause = details.orderByClause;
        }

        if (details.moduleName) {
          targetError.coqlModuleName = details.moduleName;
        }
      } catch (contextError) {
        debugWarn("attachCoqlContextToError failed", {
          contextError: contextError,
          originalError: error
        });
      }

      return targetError;
    }

    async function loadModuleRecords(moduleName, fields, options) {
      var settings = options || {};

      try {
        return helpers.dedupeById(await loadRecordsByCoql(moduleName, fields, settings));
      } catch (coqlError) {
        if (settings.whereClause || settings.orderByClause) {
          if (
            settings.orderByClause &&
            !settings.whereClause &&
            /missing clause/i.test(String(coqlError && coqlError.message || ""))
          ) {
            return helpers.dedupeById(await loadRecordsByPagination(moduleName));
          }

          throw coqlError;
        }

        return helpers.dedupeById(await loadRecordsByPagination(moduleName));
      }
    }

    async function loadRecordsByCoql(moduleName, fields, options) {
      var settings = options || {};
      var offset = 0;
      var records = [];
      var batch = [];
      var page;
      var query = "";
      var selectFields = await resolveCoqlFields(moduleName, fields);
      var whereClause = " where " + (settings.whereClause || "id is not null");
      var orderByClause = " order by " + (settings.orderByClause || "id asc");

      for (page = 0; page < MAX_RECORD_FETCH_PAGES; page += 1) {
        query =
          "select " + selectFields.join(", ") +
          " from " + moduleName +
          whereClause +
          orderByClause +
          " limit " + offset + ", 200";

        try {
          batch = await crm.coql(query, { strict: true });
        } catch (error) {
          throw attachCoqlContextToError(error, {
            moduleName: moduleName,
            query: query,
            whereClause: settings.whereClause || "id is not null",
            orderByClause: settings.orderByClause || "id asc"
          });
        }

        if (!batch.length) {
          break;
        }

        records = records.concat(batch);

        if (batch.length < 200) {
          break;
        }

        offset += 200;
      }

      if (settings.requireComplete && page === MAX_RECORD_FETCH_PAGES && batch.length === 200) {
        throw new Error("Could not load all payment allocations. The payment letter cannot be generated with an incomplete total.");
      }
      return records;
    }

    async function loadRecordsByPagination(moduleName) {
      var page = 1;
      var records = [];
      var batch;

      for (page = 1; page <= MAX_RECORD_FETCH_PAGES; page += 1) {
        batch = await crm.getAllRecords(moduleName, page, 200);

        if (!batch.length) {
          break;
        }

        records = records.concat(batch);

        if (batch.length < 200) {
          break;
        }
      }

      return records;
    }

    function buildCoqlOrEqualsClause(fieldName, values) {
      var normalizedValues = (values || []).filter(Boolean).map(function (value) {
        return "'" + escapeCoqlValue(value) + "'";
      });

      if (!normalizedValues.length) {
        return "";
      }

      if (normalizedValues.length === 1) {
        return fieldName + " = " + normalizedValues[0];
      }

      // COQL counts every equality joined with OR as an individual criterion.
      // Using IN keeps multi-value filters within its 25-criteria limit.
      return fieldName + " in (" + normalizedValues.join(", ") + ")";
    }

    // COQL requires three or more criteria to be explicitly grouped as binary
    // expressions. A plain "A or B or C" is rejected as a parsing error.
    function buildCoqlLogicalClause(operator, clauses) {
      var normalizedClauses = (clauses || []).filter(Boolean);

      if (!normalizedClauses.length) {
        return "";
      }

      return normalizedClauses.reduce(function (combinedClause, clause) {
        return combinedClause ? "(" + combinedClause + " " + operator + " " + clause + ")" : clause;
      }, "");
    }

    function buildCoqlPageQuery(moduleName, fields, options) {
      var settings = options || {};
      var page = Math.max(1, Number(settings.page) || 1);
      var perPage = Math.max(1, Math.min(200, Number(settings.perPage) || 10));
      var limit = perPage + 1;
      var offset = (page - 1) * perPage;
      var whereClause = " where " + (settings.whereClause || "id is not null");
      var orderClause = " order by " + (settings.orderByClause || "id asc");

      return resolveCoqlFields(moduleName, fields).then(function (selectFields) {
        return "select " + selectFields.join(", ") +
          " from " + moduleName +
          whereClause +
          orderClause +
          " limit " + offset + ", " + limit;
      });
    }

    async function loadCoqlPage(moduleName, fields, options) {
      var settings = Object.assign({}, options);
      var page = Math.max(1, Number(settings.page) || 1);
      var perPage = Math.max(1, Math.min(200, Number(settings.perPage) || 50));
      if ((page - 1) * perPage + perPage >= 100000) { throw new Error("Zoho's pagination limit has been reached. Narrow the filters to continue."); }
      settings.whereClause = settings.whereClause || "id is not null";
      settings.orderByClause = settings.orderByClause || "id asc";
      settings.page = page; settings.perPage = perPage;
      var query = await buildCoqlPageQuery(moduleName, fields, settings);
      var records = await crm.coql(query, { strict: true });
      return { records: records.slice(0, perPage), hasMore: records.length > perPage, page: page, perPage: perPage };
    }

    async function buildInvoiceRemoteWhereClause(filters, options) {
      var settings = options || {};
      var conditions = [];
      var mfsp = String(filters && filters.mfsp || "").trim();
      var supplierCode = String(filters && filters.supplierCode || "").trim();
      var invoiceNumber = String(filters && filters.invoiceNumber || "").trim();
      var invoiceType = String(filters && filters.invoiceType || "").trim();
      var destinations = filters && filters.destinationValues;
      var selfEmployed = String(filters && filters.selfEmployed || "");
      if (Array.isArray(destinations) && destinations.length < 3) {
        var destinationConditions = destinations.map(function (value) {
          return value === "Empty" ? "Supplier.Destination is null"
            : "Supplier.Destination = '" + escapeCoqlValue(value) + "'";
        });
        conditions.push(destinationConditions.length ? buildCoqlLogicalClause("or", destinationConditions) : "id = '0'");
      }
      if (selfEmployed === "true" || selfEmployed === "false") {
        conditions.push("Supplier.Is_Self_Employed = " + selfEmployed);
      }
      var selectedStatuses = getNormalizedStatusFilterValues(filters && filters.statusValues);
      var invoiceView = String(filters && filters.invoiceView || "open").trim().toLowerCase();
      var statusFieldApi = await resolveFieldApiByCandidates(MODULES.invoices, ["Status"], "Status");
      var dateFieldApi = await resolveFieldApiByCandidates(MODULES.invoices, ["Invoice_Date", "Invoice Date"], "Invoice_Date");
      var mfspFieldApi = await resolveFieldApiByCandidates(MODULES.invoices, ["MFSP_Reference", "MFSP Reference"], "MFSP_Reference");
      var invoiceNameFieldApi = await resolveFieldApiByCandidates(MODULES.invoices, ["Name", "Invoice_Number", "Invoice Number"], "Name");
      var invoiceTypeFieldApi = await resolveFieldApiByCandidates(MODULES.invoices, ["Invoice_Type", "Invoice Type"], "Invoice_Type");

      if (settings.pendingOnly) {
        conditions.push(buildCoqlOrEqualsClause(statusFieldApi, ["Received", "Partially Paid"]));
      } else {
        if (invoiceView === "closed") {
          conditions.push(buildCoqlOrEqualsClause(statusFieldApi, ["Paid", "Cancelled", "Rejected"]));
        } else if (invoiceView === "open") {
          conditions.push("(" + statusFieldApi + " is null or " + statusFieldApi + " not in ('Paid', 'Cancelled', 'Rejected'))");
        }
        if (Array.isArray(filters && filters.statusValues) && !selectedStatuses.length) {
          conditions.push("id = '0'");
        } else if (selectedStatuses.length && !hasAllStatusFilterValuesSelected(selectedStatuses, INVOICE_STATUS_FILTER_OPTIONS)) {
          var statusConditions = [];
          if (selectedStatuses.indexOf("-None-") !== -1) { statusConditions.push(statusFieldApi + " is null"); }
          statusConditions.push(buildCoqlOrEqualsClause(statusFieldApi, selectedStatuses));
          conditions.push(buildCoqlLogicalClause("or", statusConditions));
        }
      }

      if (filters && filters.dateFrom) {
        conditions.push(dateFieldApi + " >= '" + escapeCoqlValue(filters.dateFrom) + "'");
      }

      if (filters && filters.dateTo) {
        conditions.push(dateFieldApi + " <= '" + escapeCoqlValue(filters.dateTo) + "'");
      }

      if (invoiceType) {
        conditions.push(invoiceTypeFieldApi + " = '" + escapeCoqlValue(invoiceType) + "'");
      }

      if (supplierCode) {
        var supplierCodeFieldApi = await resolveFieldApiByCandidates(MODULES.invoices, ["Supplier_Code", "Supplier Code", "TP_Reference", "Connection_Reference", "Supplier_Connection_Reference", "Supplier Connection Reference"], "Supplier_Code");
        conditions.push(supplierCodeFieldApi + " like '%" + escapeCoqlValue(supplierCode) + "%'");
      }

      if (invoiceNumber) {
        conditions.push(invoiceNameFieldApi + " like '%" + escapeCoqlValue(invoiceNumber) + "%'");
      }

      if (mfsp) {
        conditions.push(mfspFieldApi + " like '%" + escapeCoqlValue(mfsp) + "%'");
      }

      return buildCoqlLogicalClause("and", conditions);
    }

    async function buildInvoiceRemoteOrderByClause(sort, groupBy) {
      var normalizedSort = sort || {};
      var fieldName;
      var direction = normalizedSort.direction === "asc" ? "asc" : "desc";

      if (normalizedSort.key === "invoice") {
        fieldName = await resolveFieldApiByCandidates(MODULES.invoices, ["Name", "Invoice_Number", "Invoice Number"], "Name");
      } else if (normalizedSort.key === "supplierCode") {
        fieldName = await resolveFieldApiByCandidates(MODULES.invoices, ["Supplier_Code", "Supplier Code", "TP_Reference", "Connection_Reference", "Supplier_Connection_Reference", "Supplier Connection Reference"], "Supplier_Code");
      } else if (normalizedSort.key === "mfsp") {
        fieldName = "MFSP_Reference";
      } else if (normalizedSort.key === "invoiceType") {
        fieldName = "Invoice_Type";
      } else if (normalizedSort.key === "status") {
        fieldName = await resolveFieldApiByCandidates(MODULES.invoices, ["Status"], "Status");
      } else if (normalizedSort.key === "booking") {
        fieldName = await resolveFieldApiByCandidates(MODULES.invoices, ["Booking", "Booking_Name", "Booking Name", "Deal_Name", "Deal Name"], "Booking");
      } else if (normalizedSort.key === "total") {
        fieldName = await resolveFieldApiByCandidates(MODULES.invoices, ["Total_Payable_Amount", "Invoice_Total"], "Total_Payable_Amount");
      } else {
        fieldName = await resolveFieldApiByCandidates(MODULES.invoices, ["Invoice_Date", "Invoice Date"], "Invoice_Date");
      }

      var groupFields = groupBy === "destination" ? ["Supplier.Destination"]
        : groupBy === "mfsp" ? ["MFSP_Reference"]
        : groupBy === "supplier" ? ["Supplier_Name", "Supplier"] : [];
      var terms = groupFields.map(function (field) { return field + " asc"; });
      if (groupFields.indexOf(fieldName) === -1) { terms.push(fieldName + " " + direction); }
      terms.push("id asc");
      return terms.join(", ");
    }

    async function loadInvoicePage(fields, search) {
      var perPage = Math.max(1, Math.min(200, Math.floor(Number(search.perPage) || 50)));
      var page = Math.max(1, Math.floor(Number(search.page) || 1));
      var offset = (page - 1) * perPage;
      // Never present the COQL offset ceiling as the end of the result set.
      if (offset + perPage + 1 > 100000) {
        throw new Error("Zoho's pagination limit has been reached. Narrow the filters to continue.");
      }
      var where = await buildInvoiceRemoteWhereClause(search.filters);
      var order = await buildInvoiceRemoteOrderByClause(search.sort, search.groupBy);
      var selected = await resolveCoqlFields(MODULES.invoices, fields);
      var query = "select " + selected.join(", ") + " from " + MODULES.invoices +
        " where " + (where || "id is not null") + " order by " + order +
        " limit " + offset + ", " + (perPage + 1);
      // One look-ahead row identifies the last batch without a COUNT query.
      // Do not fall back to a full download or ignore filters on API errors.
      var records = await crm.coql(query, { strict: true });
      return { records: records.slice(0, perPage), hasMore: records.length > perPage };
    }

    // Relationship searches use separate, bounded queries for compatibility
    // with the embedded CRM SDK. Grouping at most 100 candidate payment IDs
    // keeps the relationship result complete even with many allocations.
    async function loadPaymentPage(fields, allocationFields, search) {
      var filters = search.filters || {};
      var perPage = Math.max(1, Math.min(100, Math.floor(Number(search.perPage) || 50)));
      var offset = Math.max(0, Number(search.offset) || 0);
      if (offset + perPage + 1 > 100000) {
        throw new Error("Zoho's pagination limit has been reached. Narrow the filters to continue.");
      }
      var conditions = [];
      var view = filters.paymentView || "open";
      if (view === "open") { conditions.push("Status = 'Pending Payment'"); }
      if (view === "closed") { conditions.push("Status in ('Paid', 'Cancelled')"); }
      var statuses = getNormalizedStatusFilterValues(filters.statusValues);
      if (Array.isArray(filters.statusValues) && !statuses.length) { conditions.push("id = '0'"); }
      else if (statuses.length && !hasAllStatusFilterValuesSelected(statuses, PAYMENT_STATUS_FILTER_OPTIONS)) {
        conditions.push(buildCoqlOrEqualsClause("Status", statuses));
      }
      if (filters.dateFrom) { conditions.push("Payment_Date >= '" + escapeCoqlValue(filters.dateFrom) + "'"); }
      if (filters.dateTo) { conditions.push("Payment_Date <= '" + escapeCoqlValue(filters.dateTo) + "'"); }
      if (String(filters.paymentName || "").trim()) { conditions.push("Name like '%" + escapeCoqlValue(filters.paymentName.trim()) + "%'"); }
      var base = buildCoqlLogicalClause("and", conditions) || "id is not null";
      var order = " order by Payment_Date desc, id asc";
      var selected = await resolveCoqlFields(MODULES.payments, fields);
      var related = Boolean(String(filters.mfsp || "").trim() || String(filters.supplierCode || "").trim());
      var collected = [], hasMore;
      do {
        var windowSize = perPage - collected.length;
        if (offset + windowSize + 1 > 100000) {
          throw new Error("Zoho's pagination limit has been reached. Narrow the filters to continue.");
        }
        var candidates = await crm.coql("select " + (related ? "id" : selected.join(", ")) +
          " from " + MODULES.payments + " where " + base + order + " limit " + offset + ", " + (windowSize + 1), { strict: true });
        hasMore = candidates.length > windowSize;
        var records = candidates.slice(0, windowSize);
        offset += records.length;
        if (related && records.length) {
          var ids = records.map(function (record) { return String(record.id); });
          var allocationScope = buildCoqlOrEqualsClause("Supplier_Payment", ids);
          var matchingIds = ids.slice();
          var supplierCodeField = await resolveFieldApiByCandidates(MODULES.suppliers, ["TP_Reference", "Connection_Reference", "Supplier_Code"], "TP_Reference");
          for (var filter of [["bookingMfsp", filters.mfsp], ["Supplier." + supplierCodeField, filters.supplierCode]]) {
            if (!String(filter[1] || "").trim()) { continue; }
            var pattern = "'%" + escapeCoqlValue(filter[1].trim()) + "%'";
            // The allocation's booking owns this part of a mixed/split payment.
            // Use the invoice booking only for legacy allocations without one.
            // Names and copied MFSP fields are not authoritative relationships.
            // The embedded SDK permits two joined relations per query. Combining
            // Booking and Supplier_Invoice.Booking uses three, even across OR.
            var criteria = filter[0] === "bookingMfsp"
              ? ["Booking.MFSP_Reference like " + pattern,
                "(Booking is null and Supplier_Invoice.Booking.MFSP_Reference like " + pattern + ")"]
              : [filter[0] + " like " + pattern];
            var relatedIds = new Set();
            for (var criterion of criteria) {
              var relatedRows = await crm.coql("select Supplier_Payment from " + MODULES.payAllocations +
                " where (" + allocationScope + " and " + criterion + ") group by Supplier_Payment limit 0, 100", { strict: true });
              relatedRows.forEach(function (row) { relatedIds.add(String(row.Supplier_Payment && row.Supplier_Payment.id || row.Supplier_Payment || "")); });
            }
            matchingIds = matchingIds.filter(function (id) { return relatedIds.has(id); });
            if (!matchingIds.length) { break; }
          }
          // Independent EXISTS-like criteria preserve mixed-payment semantics:
          // supplier and MFSP may match different allocations of the same payment.
          records = matchingIds.length ? await crm.coql("select " + selected.join(", ") + " from " + MODULES.payments +
            " where " + buildCoqlLogicalClause("and", [base, buildCoqlOrEqualsClause("id", matchingIds)]) + order + " limit 0, " + perPage, { strict: true }) : [];
        }
        collected = collected.concat(records);
        // A page is a batch of matching payments, not a batch of candidates.
        // Keep scanning sparse relationship matches before returning to the UI.
      } while (related && hasMore && collected.length < perPage);
      records = collected;
      var allocations = [];
      if (records.length) {
        var allocationSelect = await resolveCoqlFields(MODULES.payAllocations, allocationFields);
        var scope = buildCoqlOrEqualsClause("Supplier_Payment", records.map(function (record) { return String(record.id); }));
        var lastId = "";
        while (true) {
          var batch = await crm.coql("select " + allocationSelect.join(", ") + " from " + MODULES.payAllocations +
            " where " + (lastId ? "(" + scope + " and id > '" + escapeCoqlValue(lastId) + "')" : scope) +
            " order by id asc limit 0, 200", { strict: true });
          allocations = allocations.concat(batch);
          if (batch.length < 200) { break; }
          var nextId = String(batch[batch.length - 1].id);
          if (nextId === lastId) { throw new Error("CRM repeated an allocation batch."); }
          lastId = nextId;
        }
      }
      return { records: records, allocations: allocations, hasMore: hasMore, nextOffset: offset };
    }

    async function buildPaymentRemoteWhereClause(filters, paymentIds) {
      var conditions = [];
      var ids = helpers.uniqueNonEmpty(paymentIds || []);
      var mfsp = String(filters && filters.mfsp || "").trim();
      var paymentName = String(filters && filters.paymentName || "").trim();
      var selectedStatuses = getNormalizedStatusFilterValues(filters && filters.statusValues);
      var statusFieldApi = await resolveFieldApiByCandidates(MODULES.payments, ["Status", "Payment_Status", "Payment Status"], "Status");
      var dateFieldApi = await resolveFieldApiByCandidates(MODULES.payments, ["Payment_Date", "Payment Date"], "Payment_Date");
      var paymentNameFieldApi = await resolveFieldApiByCandidates(MODULES.payments, ["Name", "Payment_Name", "Payment Name"], "Name");

      if (selectedStatuses.length && !hasAllStatusFilterValuesSelected(selectedStatuses, PAYMENT_STATUS_FILTER_OPTIONS)) {
        conditions.push(buildCoqlOrEqualsClause(statusFieldApi, selectedStatuses));
      }

      if (filters && filters.dateFrom) {
        conditions.push(dateFieldApi + " >= '" + escapeCoqlValue(filters.dateFrom) + "'");
      }

      if (filters && filters.dateTo) {
        conditions.push(dateFieldApi + " <= '" + escapeCoqlValue(filters.dateTo) + "'");
      }

      if (paymentName) {
        conditions.push(paymentNameFieldApi + " like '%" + escapeCoqlValue(paymentName) + "%'");
      }

      if (ids.length) {
        conditions.push(buildCoqlOrEqualsClause("id", ids));
      } else if (mfsp) {
        conditions.push("id = '__none__'");
      }

      return buildCoqlLogicalClause("and", conditions);
    }

    async function buildPaymentRemoteOrderByClause() {
      var dateFieldApi = await resolveFieldApiByCandidates(MODULES.payments, ["Payment_Date", "Payment Date"], "Payment_Date");
      return dateFieldApi + " desc";
    }

    async function buildAccountingEntriesRemoteWhereClause(filters) {
      var conditions = [];
      var normalizedFilters = filters || {};
      var entryName = String(normalizedFilters.entryName || "").trim();
      var movementType = String(normalizedFilters.movementType || "").trim();
      var mfsp = String(normalizedFilters.mfsp || "").trim();
      var dateFieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["Entry_Date"], "Entry_Date");
      var nameFieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["Name"], "Name");
      var movementTypeFieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["Movement_Type", "Movement Type"], "Movement_Type");
      var mfspFieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["MFSP_Reference", "MFSP Reference"], "MFSP_Reference");

      if (normalizedFilters.dateFrom) {
        conditions.push(dateFieldApi + " >= '" + escapeCoqlValue(normalizedFilters.dateFrom) + "'");
      }

      if (normalizedFilters.dateTo) {
        conditions.push(dateFieldApi + " <= '" + escapeCoqlValue(normalizedFilters.dateTo) + "'");
      }

      if (entryName) {
        conditions.push(nameFieldApi + " like '%" + escapeCoqlValue(entryName) + "%'");
      }

      if (movementType) {
        conditions.push(movementTypeFieldApi + " like '%" + escapeCoqlValue(movementType) + "%'");
      }

      if (mfsp) {
        conditions.push(mfspFieldApi + " like '%" + escapeCoqlValue(mfsp) + "%'");
      }

      return buildCoqlLogicalClause("and", conditions);
    }

    async function buildAccountingEntriesRemoteOrderByClause(sort) {
      var normalizedSort = sort || {};
      var direction = normalizedSort.direction === "asc" ? "asc" : "desc";
      var sortKey = normalizedSort.key || "date";
      var fieldApi = "Entry_Date";

      if (sortKey === "entry") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["Name"], "Name");
      } else if (sortKey === "movement") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["Movement_Type", "Movement Type"], "Movement_Type");
      } else if (sortKey === "invoice") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["Supplier_Invoice", "Supplier Invoice"], "Supplier_Invoice");
      } else if (sortKey === "supplier") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["Supplier"], "Supplier");
      } else if (sortKey === "mfsp") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["MFSP_Reference", "MFSP Reference"], "MFSP_Reference");
      } else if (sortKey === "status") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["Accounting_Status", "Accounting Status"], "Accounting_Status");
      } else if (sortKey === "debit") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["Total_Debit", "Total Debit"], "Total_Debit");
      } else if (sortKey === "credit") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["Total_Credit", "Total Credit"], "Total_Credit");
      } else {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntries, ["Entry_Date"], "Entry_Date");
      }

      if (sortKey === "invoice" || sortKey === "account") { fieldApi += ".Name"; }
      if (sortKey === "supplier") { fieldApi += ".Vendor_Name"; }
      return fieldApi + " " + direction + ", id asc";
    }

    async function buildAccountingEntryLinesRemoteWhereClause(filters) {
      var conditions = [];
      var normalizedFilters = filters || {};
      var lineName = String(normalizedFilters.lineName || "").trim();
      var dateFieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntryLines, ["Source_Date", "Source Date", "Date"], "Source_Date");
      var nameFieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntryLines, ["Name", "Accounting_Entry_Line_Name", "Accounting Entry Line Name"], "Name");

      if (normalizedFilters.dateFrom) {
        conditions.push(dateFieldApi + " >= '" + escapeCoqlValue(normalizedFilters.dateFrom) + "'");
      }

      if (normalizedFilters.dateTo) {
        conditions.push(dateFieldApi + " <= '" + escapeCoqlValue(normalizedFilters.dateTo) + "'");
      }

      if (lineName) {
        conditions.push(nameFieldApi + " like '%" + escapeCoqlValue(lineName) + "%'");
      }

      return buildCoqlLogicalClause("and", conditions);
    }

    async function buildAccountingEntryLinesRemoteOrderByClause(sort) {
      var normalizedSort = sort || {};
      var direction = normalizedSort.direction === "asc" ? "asc" : "desc";
      var sortKey = normalizedSort.key || "date";
      var fieldApi = "Source_Date";

      if (sortKey === "name") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntryLines, ["Name", "Accounting_Entry_Line_Name", "Accounting Entry Line Name"], "Name");
      } else if (sortKey === "account") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntryLines, ["Account"], "Account");
      } else if (sortKey === "debit") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntryLines, ["Debit"], "Debit");
      } else if (sortKey === "credit") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntryLines, ["Credit"], "Credit");
      } else if (sortKey === "lineNo") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntryLines, ["Line_No", "Line No"], "Line_No");
      } else if (sortKey === "lineType") {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntryLines, ["Line_Type", "Line Type"], "Line_Type");
      } else {
        fieldApi = await resolveFieldApiByCandidates(MODULES.accountingEntryLines, ["Source_Date", "Source Date", "Date"], "Source_Date");
      }

      if (sortKey === "invoice" || sortKey === "account") { fieldApi += ".Name"; }
      if (sortKey === "supplier") { fieldApi += ".Vendor_Name"; }
      return fieldApi + " " + direction + ", id asc";
    }

    async function buildBookingRemoteWhereClause(filters) {
      var conditions = [];
      var normalizedFilters = filters || {};
      var mfsp = String(normalizedFilters.mfsp || "").trim();
      var bookingName = String(normalizedFilters.bookingName || "").trim();
      var agency = String(normalizedFilters.agency || "").trim();
      var accountingRep = String(normalizedFilters.accountingRep || "").trim();
      var arrivalMode = normalizedFilters.arrivalDateMode === "range" ? "range" : "single";
      var selectedStages = getNormalizedBookingStageValues(normalizedFilters.stageValues);
      var mfspFieldApi = await resolveFieldApiByCandidates(MODULES.bookings, ["MFSP_Reference", "MFSP Reference"], "MFSP_Reference");
      var bookingNameFieldApi = await resolveFieldApiByCandidates(MODULES.bookings, ["Deal_Name", "Name"], "Deal_Name");
      var arrivalDateFieldApi = await resolveFieldApiByCandidates(MODULES.bookings, ["Arrival_Date", "Arrival Date"], "Arrival_Date");
      var agencyFieldApi = await resolveFieldApiByCandidates(MODULES.bookings, ["Account_Name", "Agency Name", "Agency"], "Account_Name");
      var stageFieldApi = await resolveFieldApiByCandidates(MODULES.bookings, ["Stage"], "Stage");
      var accountingRepFieldApi = await resolveFieldApiByCandidates(MODULES.bookings, ["Accounting_Rep", "Accounting Rep"], "Accounting_Rep");

      if (mfsp) {
        conditions.push(mfspFieldApi + " like '%" + escapeCoqlValue(mfsp) + "%'");
      }

      if (bookingName) {
        conditions.push(bookingNameFieldApi + " like '%" + escapeCoqlValue(bookingName) + "%'");
      }

      if (arrivalMode === "single" && normalizedFilters.arrivalDateFrom) {
        conditions.push(arrivalDateFieldApi + " = '" + escapeCoqlValue(normalizedFilters.arrivalDateFrom) + "'");
      }

      if (arrivalMode === "range" && normalizedFilters.arrivalDateFrom) {
        conditions.push(arrivalDateFieldApi + " >= '" + escapeCoqlValue(normalizedFilters.arrivalDateFrom) + "'");
      }

      if (arrivalMode === "range" && normalizedFilters.arrivalDateTo) {
        conditions.push(arrivalDateFieldApi + " <= '" + escapeCoqlValue(normalizedFilters.arrivalDateTo) + "'");
      }

      if (agency) {
        conditions.push(agencyFieldApi + ".Account_Name like '%" + escapeCoqlValue(agency) + "%'");
      }

      if (selectedStages.length) {
        conditions.push(buildCoqlOrEqualsClause(stageFieldApi, selectedStages));
      }

      if (accountingRep) {
        conditions.push(buildCoqlLogicalClause("and", accountingRep.split(/\s+/).map(function (part) { return "(" + accountingRepFieldApi + ".first_name like '%" + escapeCoqlValue(part) + "%' or " + accountingRepFieldApi + ".last_name like '%" + escapeCoqlValue(part) + "%')"; })));
      }

      conditions = conditions.filter(Boolean);

      // COQL requires explicit grouping when more than two criteria are used.
      // Build a right-associated expression so every generated query is valid.
      return conditions.reduceRight(function (expression, condition) {
        return expression ? "(" + condition + " and " + expression + ")" : condition;
      }, "");
    }

    async function buildBookingRemoteOrderByClause() {
      var arrivalDateFieldApi = await resolveFieldApiByCandidates(MODULES.bookings, ["Arrival_Date", "Arrival Date"], "Arrival_Date");
      return arrivalDateFieldApi + " desc, id asc";
    }

    async function loadBookingRecordsByIds(ids) {
      var normalizedIds = helpers.uniqueNonEmpty(ids || []);
      var selectFields;
      var records;
      var idsClause;

      if (!normalizedIds.length) {
        return [];
      }

      selectFields = await resolveCoqlFields(MODULES.bookings, BOOKING_BROWSER_FIELDS);
      // COQL rejects the long parenthesized chain of `id = ... or id = ...`
      // generated for a page of bookings. `IN` is the supported compact form
      // for a batch of record identifiers.
      idsClause = "id in (" + normalizedIds.map(function (id) {
        return "'" + escapeCoqlValue(id) + "'";
      }).join(", ") + ")";
      records = await crm.coql(
        "select " + selectFields.join(", ") +
        " from " + MODULES.bookings +
        " where " + idsClause +
        " limit 0, 200"
      );

      return records;
    }

    async function hydrateBookingPageRecords(records) {
      var pageRecords = Array.isArray(records) ? records.slice() : [];
      var detailedRecords;
      var detailedById = {};

      if (!pageRecords.length) {
        return [];
      }

      try {
        detailedRecords = await loadBookingRecordsByIds(pageRecords.map(function (record) {
          return record.id;
        }));
        detailedRecords.forEach(function (record) {
          if (record && record.id) {
            detailedById[record.id] = record;
          }
        });

        return pageRecords.map(function (record) {
          return detailedById[record.id] ? Object.assign({}, record, detailedById[record.id]) : record;
        });
      } catch (error) {
        debugError("hydrateBookingPageRecords failed", error, {
          recordCount: pageRecords.length
        });
        return pageRecords;
      }
    }

    function canUseBookingSearchFallback(filters) {
      var normalizedFilters = filters || {};
      var selectedStages = getNormalizedBookingStageValues(normalizedFilters.stageValues);

      return selectedStages.length > 0 &&
        !hasAllBookingStageFilterValuesSelected(selectedStages) &&
        !String(normalizedFilters.mfsp || "").trim() &&
        !String(normalizedFilters.bookingName || "").trim() &&
        !String(normalizedFilters.agency || "").trim() &&
        !String(normalizedFilters.accountingRep || "").trim() &&
        normalizedFilters.arrivalDateMode !== "range" &&
        !normalizedFilters.arrivalDateTo;
    }

    function buildBookingSearchCriteria(filters) {
      var normalizedFilters = filters || {};
      var selectedStages = getNormalizedBookingStageValues(normalizedFilters.stageValues);
      var stageClauses = selectedStages.map(function (value) {
        return "(Stage:equals:" + helpers.escapeCriteriaValue(value) + ")";
      });
      var criteria = stageClauses.length === 1 ? stageClauses[0] : "(" + stageClauses.join("or") + ")";

      if (!stageClauses.length) {
        return "";
      }

      if (normalizedFilters.arrivalDateFrom) {
        criteria += "and(Arrival_Date:equals:" + helpers.escapeCriteriaValue(normalizedFilters.arrivalDateFrom) + ")";
      }

      return criteria;
    }

    async function loadBookingSearchFallbackPage(filters, page) {
      var criteria = buildBookingSearchCriteria(filters);
      var perPage = Math.max(1, Number(state.views.bookings.perPage) || 25);
      var batch;
      var hasMore;

      if (!criteria) {
        throw new Error("Bookings search fallback criteria unavailable.");
      }

      batch = await crm.searchRecordPage(MODULES.bookings, criteria, page, perPage + 1);
      hasMore = batch.length > perPage;

      return {
        records: hasMore ? batch.slice(0, perPage) : batch,
        hasMore: hasMore,
        page: page,
        perPage: perPage
      };
    }

    async function loadPaymentAuxPage(key, fields, search) {
      var f = search.filters || {}, conditions = [];
      function like(field, value) { if (String(value || "").trim()) { conditions.push(field + " like '%" + escapeCoqlValue(value.trim()) + "%'"); } }
      if (key === "paymentAllocations") {
        like("Name", f.reference); like("Supplier_Payment.Name", f.payment);
        like("Supplier_Invoice.Name", f.invoice); like("Supplier_Settlement.Name", f.supplierCode);
        if (f.movementType) { conditions.push("Movement_Type = '" + escapeCoqlValue(f.movementType) + "'"); }
        return loadCoqlPage(MODULES.payAllocations, fields, { page: search.page, perPage: search.perPage,
          whereClause: buildCoqlLogicalClause("and", conditions), orderByClause: "Allocation_Date desc, id asc" });
      }
      if (f.query) { conditions.push("(Name like '%" + escapeCoqlValue(f.query) + "%' or Email like '%" + escapeCoqlValue(f.query) + "%')"); }
      if (f.status) { conditions.push("Status = '" + escapeCoqlValue(f.status) + "'"); }
      var base = buildCoqlLogicalClause("and", conditions) || "id is not null";
      var result = await loadCoqlPage(MODULES.paymentAccounts, fields, { page: search.page, perPage: search.perPage, whereClause: base, orderByClause: "Name asc, id asc" });
      if ((f.supplierId || f.mfsp) && result.records.length) {
        var ids = result.records.map(function (r) { return String(r.id); });
        var scope = buildCoqlOrEqualsClause("Payment_Account", ids);
        var matching = [base, buildCoqlOrEqualsClause("id", ids)];
        [["Supplier.Vendor_Name", f.supplierId], ["MFSP_Reference", f.mfsp]].forEach(function (pair) {
          if (!pair[1]) { return; }
          matching.push("id in (select Payment_Account from " + MODULES.payAllocations + " where (" + scope + " and " + pair[0] + " like '%" + escapeCoqlValue(pair[1]) + "%') group by Payment_Account limit 100)");
        });
        result.records = (await loadCoqlPage(MODULES.paymentAccounts, fields, { page: 1, perPage: search.perPage, whereClause: buildCoqlLogicalClause("and", matching), orderByClause: "Name asc, id asc" })).records;
      }
      return result;
    }

    return {
      attachCoqlContextToError: attachCoqlContextToError,
      loadPaymentAuxPage: loadPaymentAuxPage,
      loadModuleRecords: loadModuleRecords,
      loadRecordsByCoql: loadRecordsByCoql,
      loadRecordsByPagination: loadRecordsByPagination,
      buildCoqlOrEqualsClause: buildCoqlOrEqualsClause,
      buildCoqlPageQuery: buildCoqlPageQuery,
      loadCoqlPage: loadCoqlPage,
      loadInvoicePage: loadInvoicePage,
      loadPaymentPage: loadPaymentPage,
      buildInvoiceRemoteWhereClause: buildInvoiceRemoteWhereClause,
      buildInvoiceRemoteOrderByClause: buildInvoiceRemoteOrderByClause,
      buildPaymentRemoteWhereClause: buildPaymentRemoteWhereClause,
      buildPaymentRemoteOrderByClause: buildPaymentRemoteOrderByClause,
      buildAccountingEntriesRemoteWhereClause: buildAccountingEntriesRemoteWhereClause,
      buildAccountingEntriesRemoteOrderByClause: buildAccountingEntriesRemoteOrderByClause,
      buildAccountingEntryLinesRemoteWhereClause: buildAccountingEntryLinesRemoteWhereClause,
      buildAccountingEntryLinesRemoteOrderByClause: buildAccountingEntryLinesRemoteOrderByClause,
      buildBookingRemoteWhereClause: buildBookingRemoteWhereClause,
      buildBookingRemoteOrderByClause: buildBookingRemoteOrderByClause,
      hydrateBookingPageRecords: hydrateBookingPageRecords,
      canUseBookingSearchFallback: canUseBookingSearchFallback,
      loadBookingSearchFallbackPage: loadBookingSearchFallbackPage
    };
  };
}(window));
