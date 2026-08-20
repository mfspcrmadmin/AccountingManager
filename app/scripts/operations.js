(function (global) {
  "use strict";

  var MINIMUM_PAGE_SIZE = 10;
  var records = [];
  var currentPage = 1;
  var selectedType = "prepayments";
  var sources = {
    prepayments: { title: "Supplier prepayments", functionName: "creator_getcreatorprepayments", responseKey: "prepayments", supportsStatus: true, supportsDates: true, statusOptions: [["Not Paid", "Pending"], ["Paid", "Paid"], ["Cancelled", "Cancelled"]] },
    renfe: { title: "RENFE payments", functionName: "creator_getrenfepayments", responseKey: "records", supportsStatus: false, supportsDates: false, statusOptions: [] },
    "card-purchases": { title: "Card purchases", functionName: "creator_getcardpurchases", responseKey: "records", supportsStatus: true, supportsDates: false, statusOptions: [["Pending Accounting Review", "Pending accounting review"], ["Ok", "OK"]] }
  };
  var search = document.getElementById("operations-filter-search");
  var status = document.getElementById("operations-filter-status");
  var dateFrom = document.getElementById("operations-filter-from");
  var dateTo = document.getElementById("operations-filter-to");
  var apply = document.getElementById("operations-apply-filters");
  var reset = document.getElementById("operations-reset-filters");
  var empty = document.getElementById("operations-empty");
  var tableWrap = document.getElementById("operations-table-wrap");
  var tableHead = document.getElementById("operations-table-head");
  var tableBody = document.getElementById("operations-table-body");
  var paginationBar = document.getElementById("operations-pagination-bar");
  var paginationCopy = document.getElementById("operations-pagination-copy");
  var previousPage = document.getElementById("operations-prev-page");
  var nextPage = document.getElementById("operations-next-page");
  var typeCards = Array.prototype.slice.call(document.querySelectorAll("[data-operation-type]"));
  var statusField = document.getElementById("operations-filter-status-field");
  var fromField = document.getElementById("operations-filter-from-field");
  var toField = document.getElementById("operations-filter-to-field");
  var title = document.getElementById("operations-title");

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normaliseDate(value) {
    var isoMatch = String(value || "").match(/(\d{4}-\d{2}-\d{2})/);
    return isoMatch ? isoMatch[1] : "";
  }

  function formatDate(value) {
    var iso = normaliseDate(value);
    var creatorMatch;
    var months;

    if (iso) {
      return iso.split("-").reverse().join("/");
    }

    creatorMatch = String(value || "").match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
    if (!creatorMatch) {
      return "&mdash;";
    }

    months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
    return String(creatorMatch[1]).padStart(2, "0") + "/" + (months[creatorMatch[2]] || creatorMatch[2]) + "/" + creatorMatch[3];
  }

  function formatCreatorDate(value) {
    var iso = normaliseDate(value);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var parts;

    if (!iso) {
      return "";
    }

    parts = iso.split("-");
    return parts[2] + "-" + months[Number(parts[1]) - 1] + "-" + parts[0];
  }

  function formatAmount(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount)) {
      return "&mdash;";
    }
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "EUR"
    }).format(amount);
  }

  function statusClass(value) {
    if (value === "Paid") {
      return "is-paid";
    }
    if (value === "Cancelled") {
      return "is-cancelled";
    }
    return "is-pending";
  }

  function statusLabel(value) {
    return value === "Not Paid" ? "Pending" : (value || "");
  }

  function transactionClass(value) {
    return value === "Partial Payment" ? "is-partial" : "is-full";
  }

  function transactionLabel(value) {
    return value === "Partial Payment" ? "Partial" : (value === "Full Payment" ? "Full" : (value || ""));
  }

  function textOrDash(value) {
    return value == null || value === "" ? "&mdash;" : escapeHtml(value);
  }

  function isTrue(value) {
    return value === true || String(value).toLowerCase() === "true";
  }

  function attachmentFileNames(value) {
    var names = [];

    function addName(item) {
      var raw;
      var filePathMatch;
      var fileName;

      if (item == null || item === "") {
        return;
      }
      if (Array.isArray(item)) {
        item.forEach(addName);
        return;
      }
      if (typeof item === "object") {
        if (item.name || item.file_name || item.fileName || item.display_value) {
          addName(item.name || item.file_name || item.fileName || item.display_value);
        }
        return;
      }

      raw = String(item);
      filePathMatch = raw.match(/[?&]filepath=([^&]+)/i);
      fileName = filePathMatch ? filePathMatch[1] : raw.split("?")[0].split("/").pop();
      try {
        fileName = decodeURIComponent(fileName);
      } catch (error) {
        // Keep the original name when the source is not URI encoded.
      }
      if (fileName && names.indexOf(fileName) === -1) {
        names.push(fileName);
      }
    }

    addName(value);
    return names;
  }

  function formatAttachments(value) {
    var names = attachmentFileNames(value);
    if (!names.length) {
      return "<span class=\"operations-empty-value\">&mdash;</span>";
    }
    return "<span class=\"operations-file-name\" title=\"" + escapeHtml(names.join(", ")) + "\">" +
      escapeHtml(names[0]) + (names.length > 1 ? " <span>+" + (names.length - 1) + "</span>" : "") +
    "</span>";
  }

  function extractFunctionOutput(response) {
    var output = response && response.details ? response.details.output : response;
    if (typeof output === "string") {
      try {
        output = JSON.parse(output);
      } catch (error) {
        throw new Error(output || "Creator did not return valid data.");
      }
    }
    return output && typeof output === "object" ? output : {};
  }

  function getSource() {
    return sources[selectedType];
  }

  function getPageSize() {
    var availableHeight;
    var headerHeight;
    var estimatedRowHeight = 43;

    if (!tableWrap) {
      return MINIMUM_PAGE_SIZE;
    }

    availableHeight = tableWrap.clientHeight;
    headerHeight = tableHead ? tableHead.offsetHeight : 42;
    if (!availableHeight) {
      return MINIMUM_PAGE_SIZE;
    }

    return Math.max(MINIMUM_PAGE_SIZE, Math.floor((availableHeight - headerHeight) / estimatedRowHeight));
  }

  function setTableHeaders() {
    var headers = {
      prepayments: ["Status", "Accounted", "Amount", "Transaction type", "Payment date", "Booking MFSP", "Booking name", "Service date", "Supplier code", "Observations", "Proforma attached", "Payment proof", "Check-in date", "Check-out date", "Requested by", "Requested date", "When to be paid"],
      renfe: ["Requested date", "Requested by", "Booking MFSP", "Booking name", "RENFE ticket locator", "Amount", "Observations"],
      "card-purchases": ["Status", "Amount", "Booking MFSP", "Booking name", "Supplier code", "Supplier name", "Service name", "Service date", "Observations", "Requested by"]
    }[selectedType] || [];

    if (tableHead) {
      tableHead.innerHTML = headers.map(function (header) {
        return "<th" + (header === "Amount" ? " class=\"numeric-cell\"" : "") + ">" + header + "</th>";
      }).join("");
    }
  }

  function syncSourceControls() {
    var source = getSource();
    var options = source.statusOptions;

    if (title) {
      title.textContent = source.title;
    }
    if (statusField) {
      statusField.hidden = !source.supportsStatus;
    }
    if (fromField) {
      fromField.hidden = !source.supportsDates;
    }
    if (toField) {
      toField.hidden = !source.supportsDates;
    }
    if (status) {
      status.innerHTML = "<option value=\"\">All statuses</option>" + options.map(function (option) {
        return "<option value=\"" + escapeHtml(option[0]) + "\">" + escapeHtml(option[1]) + "</option>";
      }).join("");
    }
    setTableHeaders();
  }

  function renderOperationRow(record) {
    if (selectedType === "renfe") {
      return "<tr>" +
        "<td>" + formatDate(record.requested_date) + "</td><td>" + textOrDash(record.requested_by) + "</td><td>" + textOrDash(record.booking_mfsp) + "</td><td>" + textOrDash(record.booking_name) + "</td><td>" + textOrDash(record.ticket_locator) + "</td><td class=\"numeric-cell\">" + formatAmount(record.amount) + "</td><td class=\"operations-observations\" title=\"" + escapeHtml(record.observations || "") + "\">" + textOrDash(record.observations) + "</td>" +
      "</tr>";
    }
    if (selectedType === "card-purchases") {
      return "<tr>" +
        "<td><span class=\"operations-status " + (record.status === "Ok" ? "is-paid" : "is-pending") + "\">" + textOrDash(record.status) + "</span></td><td class=\"numeric-cell\">" + formatAmount(record.amount) + "</td><td>" + textOrDash(record.booking_mfsp) + "</td><td>" + textOrDash(record.booking_name) + "</td><td>" + textOrDash(record.supplier_code) + "</td><td>" + textOrDash(record.supplier_name) + "</td><td>" + textOrDash(record.service_name) + "</td><td>" + formatDate(record.service_date) + "</td><td class=\"operations-observations\" title=\"" + escapeHtml(record.observations || "") + "\">" + textOrDash(record.observations) + "</td><td>" + textOrDash(record.requested_by) + "</td>" +
      "</tr>";
    }
    return "<tr>" +
      "<td><span class=\"operations-status " + statusClass(record.status) + "\">" + textOrDash(statusLabel(record.status)) + "</span></td>" +
      "<td><span class=\"operations-boolean " + (isTrue(record.accounted) ? "is-yes" : "is-no") + "\">" + (isTrue(record.accounted) ? "Yes" : "No") + "</span></td>" +
      "<td class=\"numeric-cell\">" + formatAmount(record.amount) + "</td>" +
      "<td><span class=\"operations-transaction " + transactionClass(record.transaction_type) + "\">" + textOrDash(transactionLabel(record.transaction_type)) + "</span></td>" +
      "<td>" + formatDate(record.payment_date) + "</td><td>" + textOrDash(record.booking_mfsp) + "</td><td>" + textOrDash(record.booking_name) + "</td><td>" + formatDate(record.service_date) + "</td><td>" + textOrDash(record.supplier_code) + "</td><td class=\"operations-observations\" title=\"" + escapeHtml(record.observations || "") + "\">" + textOrDash(record.observations) + "</td><td>" + formatAttachments(record.proforma_attached) + "</td><td>" + formatAttachments(record.payment_proof) + "</td><td>" + formatDate(record.check_in_date) + "</td><td>" + formatDate(record.check_out_date) + "</td><td>" + textOrDash(record.requested_by) + "</td><td>" + formatDate(record.requested_date) + "</td><td>" + textOrDash(record.when_to_be_paid) + "</td>" +
    "</tr>";
  }

  function getFilteredRecords() {
    var query = String(search && search.value || "").trim().toLocaleLowerCase("en");
    var selectedStatus = String(status && status.value || "");
    var from = String(dateFrom && dateFrom.value || "");
    var to = String(dateTo && dateTo.value || "");

    return records.filter(function (record) {
      var haystack = [record.booking_mfsp, record.booking_name, record.supplier_code, record.supplier_name, record.ticket_locator, record.observations]
        .join(" ").toLocaleLowerCase("en");
      var paymentDate = normaliseDate(record.payment_date);

      return (!query || haystack.indexOf(query) !== -1) &&
        (!getSource().supportsStatus || !selectedStatus || record.status === selectedStatus) &&
        (!from || !paymentDate || paymentDate >= from) &&
        (!to || !paymentDate || paymentDate <= to);
    });
  }

  function renderPagination(totalRecords, pageSize) {
    var totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

    if (currentPage > totalPages) {
      currentPage = totalPages;
    }
    if (!paginationBar) {
      return;
    }

    paginationBar.hidden = totalRecords <= pageSize;
    if (paginationCopy) {
      paginationCopy.textContent = "Page " + currentPage + " of " + totalPages;
    }
    if (previousPage) {
      previousPage.disabled = currentPage <= 1;
    }
    if (nextPage) {
      nextPage.disabled = currentPage >= totalPages;
    }
  }

  function render() {
    var filtered = getFilteredRecords();
    var pageSize;
    var totalPages;
    var startIndex;
    var pageRecords;

    if (!tableWrap || !tableBody || !empty) {
      return;
    }

    if (!filtered.length) {
      tableWrap.hidden = true;
      if (paginationBar) {
        paginationBar.hidden = true;
      }
      empty.hidden = false;
      empty.innerHTML = records.length
        ? "<h3>No matching prepayments</h3><p>Change or reset the filters to view other results.</p>"
        : "<h3>No prepayments found</h3><p>Creator did not return any prepayments to review.</p>";
      return;
    }

    tableWrap.hidden = false;
    pageSize = getPageSize();
    totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (currentPage > totalPages) {
      currentPage = totalPages;
    }
    startIndex = (currentPage - 1) * pageSize;
    pageRecords = filtered.slice(startIndex, startIndex + pageSize);
    tableBody.innerHTML = pageRecords.map(renderOperationRow).join("");
    empty.hidden = true;
    tableWrap.hidden = false;
    renderPagination(filtered.length, pageSize);
  }

  async function loadRecords() {
    var response;
    var output;

    if (!(global.ZOHO && ZOHO.CRM && ZOHO.CRM.FUNCTIONS)) {
      throw new Error("The Zoho CRM connection is not available yet.");
    }

    empty.hidden = false;
    empty.innerHTML = "<h3>Loading prepayments&hellip;</h3><p>Querying Creator.</p>";
    tableWrap.hidden = true;
    if (paginationBar) {
      paginationBar.hidden = true;
    }
    response = await ZOHO.CRM.FUNCTIONS.execute(getSource().functionName, {
      arguments: JSON.stringify({
        status: String(status && status.value || ""),
        paymentDateFrom: formatCreatorDate(dateFrom && dateFrom.value),
        paymentDateTo: formatCreatorDate(dateTo && dateTo.value),
        searchText: String(search && search.value || "").trim()
      })
    });
    output = extractFunctionOutput(response);

    if (output.success === false || output.error === true) {
      throw new Error(output.message || "Prepayments could not be queried in Creator.");
    }

    records = Array.isArray(output[getSource().responseKey]) ? output[getSource().responseKey] : [];
    currentPage = 1;
    render();
  }

  async function applyFilters() {
    try {
      await loadRecords();
    } catch (error) {
      tableWrap.hidden = true;
      if (paginationBar) {
        paginationBar.hidden = true;
      }
      empty.hidden = false;
      empty.innerHTML = "<h3>Prepayments could not be loaded</h3><p>" + escapeHtml(error.message || error) + "</p>";
    }
  }

  if (apply) {
    apply.addEventListener("click", applyFilters);
  }
  if (reset) {
    reset.addEventListener("click", function () {
      [search, status, dateFrom, dateTo].forEach(function (field) {
        if (field) {
          field.value = "";
        }
      });
      currentPage = 1;
      render();
    });
  }
  if (previousPage) {
    previousPage.addEventListener("click", function () {
      if (currentPage > 1) {
        currentPage -= 1;
        render();
      }
    });
  }
  if (nextPage) {
    nextPage.addEventListener("click", function () {
      var totalPages = Math.ceil(getFilteredRecords().length / getPageSize());
      if (currentPage < totalPages) {
        currentPage += 1;
        render();
      }
    });
  }
  typeCards.forEach(function (card) {
    card.addEventListener("click", function () {
      selectedType = card.getAttribute("data-operation-type") || "prepayments";
      records = [];
      currentPage = 1;
      typeCards.forEach(function (candidate) {
        candidate.classList.toggle("is-active", candidate === card);
      });
      syncSourceControls();
      tableWrap.hidden = true;
      if (paginationBar) {
        paginationBar.hidden = true;
      }
      empty.hidden = false;
      empty.innerHTML = "<h3>Ready to load " + escapeHtml(card.textContent.trim()) + "</h3><p>Apply filters to query Creator.</p>";
    });
  });
  syncSourceControls();
}(window));
