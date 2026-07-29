(function (global) {
var ns = global.PurchasesManagerApp = global.PurchasesManagerApp || {};

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "EUR"
    }).format(Number(value) || 0);
  }

  function formatDate(value) {
    var isoDate = toIsoDate(value);
    var date;

    if (!isoDate) {
      return "-";
    }

    date = new Date(isoDate + "T00:00:00");

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
  }

  function textValue(value, fallback) {
    return value === null || value === undefined || value === "" ? (fallback || "-") : String(value);
  }

  function firstValue(record, keys) {
    var index;
    var key;

    if (!record || !Array.isArray(keys)) {
      return "";
    }

    for (index = 0; index < keys.length; index += 1) {
      key = keys[index];

      if (record[key] !== null && record[key] !== undefined && record[key] !== "") {
        return record[key];
      }
    }

    return "";
  }

  function stripAccents(value) {
    var text = String(value || "");
    return text.normalize ? text.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : text;
  }

  function normalizeString(value) {
    return stripAccents(value)
      .toLowerCase()
      .replace(/[%_\-\s|]+/g, "");
  }

  function normalizeQuery(value) {
    return stripAccents(String(value || "")).toLowerCase().trim();
  }

  function normalizeDestinationValue(value) {
    return stripAccents(String(value || "")).trim().toLowerCase();
  }

  function findFieldByCandidates(fields, candidates) {
    var fieldIndex;
    var candidateIndex;
    var field;
    var normalizedCandidate;

    if (!Array.isArray(fields) || !Array.isArray(candidates)) {
      return null;
    }

    for (candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      normalizedCandidate = normalizeString(candidates[candidateIndex]);

      for (fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
        field = fields[fieldIndex];

        if (normalizeString(field.api_name) === normalizedCandidate || normalizeString(field.field_label) === normalizedCandidate) {
          return field;
        }
      }
    }

    return null;
  }

  function getLookupId(lookupValue) {
    if (!lookupValue) {
      return "";
    }

    if (typeof lookupValue === "object") {
      return lookupValue.id || "";
    }

    return String(lookupValue);
  }

  function getLookupName(lookupValue) {
    if (!lookupValue) {
      return "";
    }

    if (typeof lookupValue === "object") {
      return lookupValue.name || lookupValue.Vendor_Name || lookupValue.Name || lookupValue.Deal_Name || "";
    }

    return String(lookupValue);
  }

  function valueToText(value) {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "object") {
      return getLookupName(value);
    }

    return String(value);
  }

  function getCandidateValue(record, candidates) {
    return valueToText(firstValue(record, candidates));
  }

  function getLookupValue(record, candidates) {
    return firstValue(record, candidates);
  }

  function getLookupDisplayValue(record, candidates) {
    return getLookupName(getLookupValue(record, candidates));
  }

  function getPicklistOptions(field) {
    if (!field || !Array.isArray(field.pick_list_values)) {
      return [];
    }

    return field.pick_list_values
      .filter(function (item) {
        return item && item.display_value !== null && item.display_value !== undefined && item.actual_value !== null && item.actual_value !== undefined;
      })
      .map(function (item) {
        return {
          label: item.display_value,
          value: item.actual_value
        };
      });
  }

  function extractRecords(response) {
    if (!response) {
      return [];
    }

    if (Array.isArray(response.data)) {
      return response.data;
    }

    if (Array.isArray(response.records)) {
      return response.records;
    }

    if (Array.isArray(response)) {
      return response;
    }

    return [];
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeCriteriaValue(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/,/g, "\\,")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function buildSupplierLabel(record, fieldCandidates) {
    var supplierCandidates = fieldCandidates.supplier;
    var name = getCandidateValue(record, supplierCandidates.name) || "Unnamed supplier";
    var connectionReference = getCandidateValue(record, supplierCandidates.connectionReference) || "No connection ref";
    var ezusReference = getCandidateValue(record, supplierCandidates.ezusReference) || "No Ezus ref";

    return [name, connectionReference, ezusReference].join(" | ");
  }

  function getInvoiceDisplayNumber(record, fieldCandidates) {
    return getCandidateValue(record, fieldCandidates.invoice.number) || record.Name || "Untitled invoice";
  }

  function getInvoiceTotalAmount(record, fieldCandidates) {
    return Number(
      getCandidateValue(record, fieldCandidates.invoice.totalAmount) ||
      getCandidateValue(record, fieldCandidates.invoice.amount) ||
      0
    );
  }

  function getInvoicePendingAmount(record, fieldCandidates) {
    var unpaidAmount = getCandidateValue(record, fieldCandidates.invoice.unpaidAmount);
    var totalAmount = getInvoiceTotalAmount(record, fieldCandidates);
    var amountPaid = Number(getCandidateValue(record, fieldCandidates.invoice.amountPaid) || 0);
    var normalizedUnpaidAmount;

    if (unpaidAmount !== "") {
      normalizedUnpaidAmount = Number(unpaidAmount) || 0;

      if (amountPaid <= 0 && normalizedUnpaidAmount <= 0 && totalAmount > 0) {
        return totalAmount;
      }

      return normalizedUnpaidAmount;
    }

    if (amountPaid <= 0 && totalAmount > 0) {
      return totalAmount;
    }

    return totalAmount - amountPaid;
  }

  function getPaymentAmount(record, fieldCandidates) {
    return Number(getCandidateValue(record, fieldCandidates.payment.amount) || 0);
  }

  function toIsoDate(value) {
    var raw = String(value || "").trim();
    var match;
    var date;

    if (!raw) {
      return "";
    }

    match = raw.match(/^(\d{4}-\d{2}-\d{2})/);

    if (match) {
      return match[1];
    }

    date = new Date(raw);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toISOString().slice(0, 10);
  }

  function isDateInRange(value, dateFrom, dateTo) {
    var isoValue = toIsoDate(value);

    if (!isoValue) {
      return !dateFrom && !dateTo;
    }

    if (dateFrom && isoValue < dateFrom) {
      return false;
    }

    if (dateTo && isoValue > dateTo) {
      return false;
    }

    return true;
  }

  function dedupeById(records) {
    var seen = {};

    return records.filter(function (record) {
      if (!record || !record.id || seen[record.id]) {
        return false;
      }

      seen[record.id] = true;
      return true;
    });
  }

  function sortSuppliersByQuery(records, query, fieldCandidates) {
    var normalizedQuery = normalizeString(query);
    var supplierCandidates = fieldCandidates.supplier;

    return records.slice().sort(function (left, right) {
      return getSupplierScore(right, normalizedQuery, supplierCandidates) - getSupplierScore(left, normalizedQuery, supplierCandidates);
    });
  }

  function getSupplierScore(record, normalizedQuery, supplierCandidates) {
    var fields = [
      getCandidateValue(record, supplierCandidates.name),
      getCandidateValue(record, supplierCandidates.connectionReference),
      getCandidateValue(record, supplierCandidates.ezusReference)
    ];
    var score = 0;

    fields.forEach(function (value, index) {
      var normalizedValue = normalizeString(value);

      if (!normalizedValue) {
        return;
      }

      if (normalizedValue === normalizedQuery) {
        score += index === 0 ? 120 : 100;
        return;
      }

      if (normalizedValue.indexOf(normalizedQuery) === 0) {
        score += index === 0 ? 80 : 60;
        return;
      }

      if (normalizedValue.indexOf(normalizedQuery) !== -1) {
        score += 24;
      }
    });

    return score;
  }

  function matchesSupplierQuery(record, query, fieldCandidates) {
    var normalizedQuery = normalizeString(query);
    var supplierCandidates = fieldCandidates.supplier;

    return [
      getCandidateValue(record, supplierCandidates.name),
      getCandidateValue(record, supplierCandidates.connectionReference),
      getCandidateValue(record, supplierCandidates.ezusReference)
    ].some(function (value) {
      return normalizeString(value).indexOf(normalizedQuery) !== -1;
    });
  }

  function matchesText(value, query) {
    return normalizeQuery(value).indexOf(normalizeQuery(query)) !== -1;
  }

  function getStatusTone(value) {
    var normalized = String(value || "").toLowerCase();

    if (!normalized) {
      return "neutral";
    }

    if (
      normalized.indexOf("active") !== -1 ||
      normalized.indexOf("paid") !== -1 ||
      normalized.indexOf("approved") !== -1 ||
      normalized.indexOf("posted") !== -1 ||
      normalized.indexOf("done") !== -1 ||
      normalized.indexOf("closed") !== -1 ||
      normalized.indexOf("mapped") !== -1 ||
      normalized.indexOf("success") !== -1
    ) {
      return "positive";
    }

    if (
      normalized.indexOf("cancel") !== -1 ||
      normalized.indexOf("void") !== -1 ||
      normalized.indexOf("reject") !== -1 ||
      normalized.indexOf("error") !== -1 ||
      normalized.indexOf("inactive") !== -1
    ) {
      return "danger";
    }

    if (
      normalized.indexOf("draft") !== -1 ||
      normalized.indexOf("pending") !== -1 ||
      normalized.indexOf("review") !== -1 ||
      normalized.indexOf("wait") !== -1 ||
      normalized.indexOf("open") !== -1 ||
      normalized.indexOf("planned") !== -1
    ) {
      return "warning";
    }

    return "neutral";
  }

  function booleanLabel(value) {
    return value ? "Yes" : "No";
  }

  function readSelectedIds(data) {
    if (!data) {
      return [];
    }

    if (Array.isArray(data.EntityId)) {
      return data.EntityId.filter(Boolean);
    }

    if (data.EntityId) {
      return [data.EntityId];
    }

    if (Array.isArray(data.EntityIds)) {
      return data.EntityIds.filter(Boolean);
    }

    return [];
  }

  function getClientPayload(data) {
    if (!data || typeof data !== "object") {
      return null;
    }

    if (data.data && typeof data.data === "object") {
      return data.data;
    }

    if (data.Message && typeof data.Message === "object") {
      return data.Message;
    }

    return null;
  }

  function getSupplierIdFromPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return "";
    }

    return payload.supplier_id || payload.supplierId || payload.record_id || payload.recordId || payload.id || "";
  }

  function uniqueNonEmpty(values) {
    var seen = {};

    return values.filter(function (value) {
      var normalized;

      if (!value && value !== 0) {
        return false;
      }

      normalized = String(value);

      if (seen[normalized]) {
        return false;
      }

      seen[normalized] = true;
      return true;
    });
  }

  function sortStrings(values) {
    return values.slice().sort(function (left, right) {
      return String(left).localeCompare(String(right), "en", { sensitivity: "base" });
    });
  }

  ns.helpers = {
    booleanLabel: booleanLabel,
    buildSupplierLabel: buildSupplierLabel,
    dedupeById: dedupeById,
    escapeCriteriaValue: escapeCriteriaValue,
    escapeHtml: escapeHtml,
    extractRecords: extractRecords,
    findFieldByCandidates: findFieldByCandidates,
    firstValue: firstValue,
    formatCurrency: formatCurrency,
    formatDate: formatDate,
    getCandidateValue: getCandidateValue,
    getClientPayload: getClientPayload,
    getInvoiceDisplayNumber: getInvoiceDisplayNumber,
    getInvoicePendingAmount: getInvoicePendingAmount,
    getInvoiceTotalAmount: getInvoiceTotalAmount,
    getLookupDisplayValue: getLookupDisplayValue,
    getLookupId: getLookupId,
    getLookupName: getLookupName,
    getLookupValue: getLookupValue,
    getPaymentAmount: getPaymentAmount,
    getStatusTone: getStatusTone,
    getSupplierIdFromPayload: getSupplierIdFromPayload,
    isDateInRange: isDateInRange,
    matchesSupplierQuery: matchesSupplierQuery,
    matchesText: matchesText,
    normalizeDestinationValue: normalizeDestinationValue,
    normalizeQuery: normalizeQuery,
    normalizeString: normalizeString,
    readSelectedIds: readSelectedIds,
    sortStrings: sortStrings,
    sortSuppliersByQuery: sortSuppliersByQuery,
    textValue: textValue,
    toIsoDate: toIsoDate,
    getPicklistOptions: getPicklistOptions,
    uniqueNonEmpty: uniqueNonEmpty,
    valueToText: valueToText
  };
}(window));
