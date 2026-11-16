(function (global) {
  "use strict";
  var panel = document.getElementById("ministry-traveller-register");
  var tab = document.querySelector("[data-ministry-report-tab]");
  var dateFilters = ["in", "out"].map(function (kind) {
    return { label: kind === "in" ? "Check-in" : "Check-out", field: kind === "in" ? "Hotel_Check_In" : "Hotel_Check_Out",
      mode: document.getElementById("ministry-check-" + kind + "-mode"),
      from: document.getElementById("ministry-check-" + kind + "-from"),
      to: document.getElementById("ministry-check-" + kind + "-to") };
  });
  var mfspFilter = document.getElementById("ministry-filter-mfsp");
  var supplierCodeFilter = document.getElementById("ministry-filter-supplier-code");
  var search = document.getElementById("ministry-search");
  var exportButton = document.getElementById("ministry-export");
  var exportPicker = document.getElementById("ministry-export-picker");
  var exportPickerList = document.getElementById("ministry-export-picker-list");
  var exportPickerConfirm = document.getElementById("ministry-export-picker-confirm");
  var message = document.getElementById("ministry-register-message");
  var tableWrap = document.getElementById("ministry-register-table-wrap");
  var tableHead = document.getElementById("ministry-register-table-head");
  var tableBody = document.getElementById("ministry-register-table-body");
  var countBadge = document.getElementById("ministry-traveler-count");
  var destinationNote = document.getElementById("ministry-destination-note");
  var viewButtons = Array.prototype.slice.call(document.querySelectorAll("[data-ministry-view]"));
  var rows = [], visibleCount = 50;
  var viewMode = "simple";
  var sort = { key: "mfsp", direction: "asc" };
  var columns = [
    { key: "checkIn", label: "Hotel Check In" }, { key: "checkOut", label: "Hotel Check Out" }, { key: "duration", label: "Duration (days)" },
    { key: "bookingName", label: "Booking Name" }, { key: "mfsp", label: "MFSP Reference" }, { key: "connectionReference", label: "Supplier Code" }, { key: "vendorName", label: "Vendor Name" },
    { key: "leadPax", label: "Lead Pax" }, { key: "forename", label: "Forename" }, { key: "surname", label: "Surname" },
    { key: "passengerEmail", label: "Passenger Email" }, { key: "passportNumber", label: "Passport Number" }, { key: "nationality", label: "Nationality" },
    { key: "clientName", label: "Client Name" }, { key: "clientEmail", label: "Agent Email" }
  ];

  function api() { return global.ZOHO && global.ZOHO.CRM && global.ZOHO.CRM.API; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
  function extract(response) { return response && Array.isArray(response.data) ? response.data : []; }
  function lookupId(value) { return value && typeof value === "object" ? String(value.id || "") : ""; }
  function lookupName(value) { return value && typeof value === "object" ? String(value.name || value.Name || "") : String(value || ""); }
  function includesText(value, filter) { return !filter || String(value || "").toLowerCase().indexOf(filter) !== -1; }
  function date(value) { var match = String(value || "").match(/\d{4}-\d{2}-\d{2}/); return match ? match[0] : ""; }
  function displayDate(value) { var result = date(value); return result ? result.split("-").reverse().join("/") : ""; }
  function toInputDate(value) { return value.getFullYear() + "-" + String(value.getMonth() + 1).padStart(2, "0") + "-" + String(value.getDate()).padStart(2, "0"); }
  function setDatePreset(filter) {
    var now = new Date(), start, end, preset = filter.mode.value;
    filter.from.hidden = preset === "any";
    filter.to.hidden = preset === "single" || preset === "any";
    filter.from.disabled = filter.to.disabled = preset !== "single" && preset !== "range";
    if (preset === "any" || preset === "single" || preset === "range") { return; }
    if (preset === "last-month") { start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); }
    if (preset === "next-month") { start = new Date(now.getFullYear(), now.getMonth() + 1, 1); end = new Date(now.getFullYear(), now.getMonth() + 2, 0); }
    if (preset === "last-7-days") { end = new Date(now); start = new Date(now); start.setDate(start.getDate() - 6); }
    if (preset === "last-30-days") { end = new Date(now); start = new Date(now); start.setDate(start.getDate() - 29); }
    if (preset === "next-7-days") { start = new Date(now); end = new Date(now); end.setDate(end.getDate() + 6); }
    if (preset === "next-30-days") { start = new Date(now); end = new Date(now); end.setDate(end.getDate() + 29); }
    filter.from.value = toInputDate(start); filter.to.value = toInputDate(end);
  }
  function duration(checkIn, checkOut) { var start = Date.parse(date(checkIn) + "T00:00:00Z"), end = Date.parse(date(checkOut) + "T00:00:00Z"); return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 86400000)) : ""; }
  function passengerValues(traveller) {
    var leadValue = traveller.Lead_Passenger != null ? traveller.Lead_Passenger : traveller.Lead_Pax;
    var isLead = leadValue === true || String(leadValue).toLowerCase() === "true";
    return { forename: traveller.Forename || "", surname: traveller.Name || "", leadPax: isLead ? "true" : "false", passengerEmail: traveller.Email || "", passportNumber: traveller.Passport_Number || "", nationality: traveller.Nationality || "" };
  }
  function passengerName(passenger) { return [passenger.forename, passenger.surname].filter(Boolean).join(" ") || passenger.passengerEmail || "Unnamed traveler"; }
  function uniqueIds(values) {
    var ids = {};
    var list = Array.isArray(values) ? values : values ? [values] : [];
    list.forEach(function (value) { var id = lookupId(value); if (id) { ids[id] = true; } });
    return Object.keys(ids);
  }
  function getRecord(entity, id) { return api().getRecord({ Entity: entity, RecordID: id }).then(function (response) { return extract(response)[0] || null; }); }
  function mapRecords(entity, ids) {
    var cache = {};
    return Promise.all(ids.map(function (id) { return getRecord(entity, id).then(function (record) { cache[id] = record; }).catch(function () { cache[id] = null; }); })).then(function () { return cache; });
  }
  function functionOutputRecords(response) {
    var output = response && response.details && response.details.output != null ? response.details.output : response;
    if (typeof output === "string") {
      try { output = JSON.parse(output); } catch (error) { throw new Error("Could not read Booking participants. Please retry."); }
    }
    if (!output || output.error === true || output.error === "true") throw new Error(output && output.message || "Could not load Booking participants.");
    if (output.schema_version !== 1 || !Array.isArray(output.result)) throw new Error("Booking participant integration needs updating. Please retry.");
    return output.result;
  }
  async function getTravelersForBooking(bookingId) {
    var response = await global.ZOHO.CRM.FUNCTIONS.execute("gettravellersforbooking", { arguments: JSON.stringify({ bookingId: bookingId }) });
    return functionOutputRecords(response);
  }
  async function loadTravelersByBooking(bookingIds) {
    var travelerIdsByBooking = {};
    var records = {};
    await Promise.all(bookingIds.map(async function (bookingId) {
      var travelers = await getTravelersForBooking(bookingId);
      var keys = [];
      travelers.forEach(function (traveler) {
        if (!traveler || !traveler.id || !traveler.PAX_Booking_ID || String(traveler.Booking_ID) !== String(bookingId)) throw new Error("Invalid Booking participant context. Please refresh.");
        // Cache trip values by Booking + relation, never by the reusable person ID.
        var key = bookingId + ":" + traveler.PAX_Booking_ID;
        if (records[key]) throw new Error("Duplicated Booking participant. Please refresh.");
        records[key] = traveler;
        keys.push(key);
      });
      travelerIdsByBooking[bookingId] = keys;
    }));
    return { idsByBooking: travelerIdsByBooking, records: records };
  }
  function dateCriteria(filters) {
    var clauses = [];
    filters.forEach(function (filter) {
      if (filter.mode.value === "any") { return; }
      var from = date(filter.from.value), to = filter.mode.value === "single" ? "" : date(filter.to.value);
      if (from && to && from > to) { throw new Error(filter.label + ": range start must be before range end."); }
      if (filter.mode.value === "single") {
        if (from) { clauses.push(filter.field + " = '" + from + "'"); }
      } else {
        if (from) { clauses.push(filter.field + " >= '" + from + "'"); }
        if (to) { clauses.push(filter.field + " <= '" + to + "'"); }
      }
    });
    if (!clauses.length) { throw new Error("Enter at least one check-in or check-out date before searching."); }
    return clauses.reduce(function (left, right) { return left ? "(" + left + " and " + right + ")" : right; }, "");
  }
  async function loadServices(criteria) {
    var all = [], offset = 0, response, batch, query;
    do {
      query = "select id, Booking, Supplier, Hotel_Check_In, Hotel_Check_Out from Booking_Services where " + criteria + " limit " + offset + ", 200";
      response = await api().coql({ select_query: query });
      batch = extract(response);
      all = all.concat(batch);
      offset += batch.length;
    } while (response && response.info && response.info.more_records && batch.length);
    return all;
  }
  function compareRows(a, b) {
    function value(row) {
      var result = row[sort.key];
      if (sort.key === "checkIn" || sort.key === "checkOut") {
        return result ? String(result).split("/").reverse().join("-") : "";
      }
      return result == null ? "" : result;
    }
    var left = value(a), right = value(b), comparison;
    if (left === "" || right === "") {
      comparison = left === right ? 0 : left === "" ? 1 : -1;
      return comparison || String(a.serviceId).localeCompare(String(b.serviceId));
    }
    comparison = sort.key === "duration" ? Number(left) - Number(right) :
      String(left).localeCompare(String(right), "en", { sensitivity: "base", numeric: true });
    return comparison * (sort.direction === "asc" ? 1 : -1) ||
      String(a.mfsp).localeCompare(String(b.mfsp)) || String(a.serviceId).localeCompare(String(b.serviceId));
  }
  function changeSort(key) {
    if (!columns.some(function (column) { return column.key === key; })) { return; }
    sort = { key: key, direction: sort.key === key && sort.direction === "asc" ? "desc" : "asc" };
    visibleCount = 50;
    render();
  }
  function render() {
    tableWrap._bufferedTableToken = null;
    var scrollTop = visibleCount === 50 ? 0 : tableWrap.scrollTop;
    var visibleRows = rows.slice().sort(compareRows).slice(0, visibleCount);
    var visibleColumns = global.AccountingManagerApp.tableColumns.visibleOrder("ministryTravelerRegister");
    function cell(key, row) {
      if (key === "leadPax") {
        var isLead = row.leadPax === "true";
        return '<td class="ministry-lead-pax-cell"><span class="ministry-lead-pax ' + (isLead ? "is-lead" : "is-not-lead") + '" title="' + (isLead ? "Lead passenger" : "Not lead passenger") + '" aria-label="' + (isLead ? "Lead passenger" : "Not lead passenger") + '">' + (isLead ? '&#10003;' : '&times;') + "</span></td>";
      }
      return "<td>" + escapeHtml(row[key] == null ? "" : row[key]) + "</td>";
    }
    function dataRow(row) { return "<tr>" + visibleColumns.map(function (key) { return cell(key, row); }).join("") + '<td class="table-columns-gear-cell"></td></tr>'; }
    tableHead.innerHTML = "<tr>" + visibleColumns.map(function (key) { return '<th class="is-clickable" tabindex="0" data-ministry-sort="' + key + '" aria-sort="' + (sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none") + '">' + escapeHtml(columns.filter(function (column) { return column.key === key; })[0].label) + (sort.key === key ? (sort.direction === "asc" ? " &#9650;" : " &#9660;") : "") + "</th>"; }).join("") + '<th class="table-columns-gear-cell">' + global.AccountingManagerApp.tableColumns.button("ministryTravelerRegister") + "</th></tr>";
    if (viewMode === "simple") {
      tableBody.innerHTML = visibleRows.map(dataRow).join("");
    } else {
      var groups = {};
      visibleRows.forEach(function (row) { var group = row.mfsp || "No MFSP Reference"; (groups[group] = groups[group] || []).push(row); });
      tableBody.innerHTML = Object.keys(groups).map(function (group) {
        var hotelIds = {};
        groups[group].forEach(function (row) { hotelIds[row.serviceId] = true; });
        return '<tr class="ministry-group-row"><td colspan="' + (visibleColumns.length + 1) + '"><strong>' + escapeHtml(group) + '</strong><span>' + Object.keys(hotelIds).length + (Object.keys(hotelIds).length === 1 ? " hotel" : " hotels") + "</span></td></tr>" + groups[group].map(function (row, index, groupRows) {
          if (groupRows.slice(0, index).some(function (previousRow) { return previousRow.serviceId === row.serviceId; })) { return dataRow(row); }
          return '<tr class="ministry-hotel-group-row"><td colspan="' + (visibleColumns.length + 1) + '"><strong>' + escapeHtml(row.vendorName || "No supplier") + '</strong><span>' + escapeHtml(row.checkIn + " – " + row.checkOut) + " · " + row.travelerCount + (row.travelerCount === 1 ? " traveler" : " travelers") + "</span></td></tr>" + dataRow(row);
        }).join("");
      }).join("");
    }
    tableWrap.hidden = !rows.length;
    tableWrap.scrollTop = scrollTop;
    if (global.AccountingManagerApp.renderBufferedTable) { global.AccountingManagerApp.renderBufferedTable(tableWrap, tableWrap, visibleRows.length, rows.length, function () { visibleCount += 50; render(); }); }
    exportButton.disabled = !rows.length;
    countBadge.hidden = false;
    countBadge.textContent = rows.length + (rows.length === 1 ? " traveler found" : " travelers found");
    message.textContent = rows.length ? "" : "No travelers were found for the selected dates.";
  }
  async function load() {
    var criteria, mfsp = String(mfspFilter.value || "").trim().toLowerCase(), supplierCode = String(supplierCodeFilter.value || "").trim().toLowerCase(), services, eligibleServices, bookings, contacts, vendors, travelerData, pax;
    try { criteria = dateCriteria(dateFilters); }
    catch (error) { message.textContent = error.message; return; }
    search.disabled = true; search.classList.add("is-loading"); exportButton.disabled = true; tableWrap.hidden = true; countBadge.hidden = true; message.classList.add("is-loading"); message.innerHTML = '<span class="ministry-message-spinner" aria-hidden="true"></span>Loading hotel services and traveller data…';
    try {
      services = await loadServices(criteria);
      vendors = await mapRecords("Vendors", uniqueIds(services.map(function (service) { return service.Supplier; })));
      eligibleServices = services.filter(function (service) {
        var vendor = vendors[lookupId(service.Supplier)] || {};
        var destination = String(vendor.Destination || "").trim().toLowerCase();
        return (!destination || destination === "spain") && includesText(vendor.TP_Reference, supplierCode);
      });
      bookings = await mapRecords("Deals", uniqueIds(eligibleServices.map(function (service) { return service.Booking; })));
      eligibleServices = eligibleServices.filter(function (service) {
        var booking = bookings[lookupId(service.Booking)] || {};
        return Boolean(String(booking.Ezus_Project_ID || "").trim()) && includesText(booking.MFSP_Reference, mfsp);
      });
      contacts = await mapRecords("Contacts", uniqueIds(Object.keys(bookings).map(function (id) { return bookings[id] && bookings[id].Contact_Name; })));
      travelerData = await loadTravelersByBooking(uniqueIds(eligibleServices.map(function (service) { return service.Booking; })));
      pax = travelerData.records;
      rows = [];
      eligibleServices.forEach(function (service) {
        var booking = bookings[lookupId(service.Booking)] || {}, contact = contacts[lookupId(booking.Contact_Name)] || {}, vendor = vendors[lookupId(service.Supplier)] || {};
        var travellerIds = travelerData.idsByBooking[lookupId(service.Booking)] || [];
        var allTravellerIds = travellerIds.slice();
        var leadTravellerIds = travellerIds.filter(function (id) { var traveller = pax[id] || {}; return passengerValues(traveller).leadPax === "true"; });
        var travelerIdsWithEmail = allTravellerIds.filter(function (id) { return Boolean(String((pax[id] || {}).Email || "").trim()); });
        if (leadTravellerIds.length) {
          travellerIds = [leadTravellerIds[0]];
        } else if (travelerIdsWithEmail.length > 1 || !travelerIdsWithEmail.length) {
          travellerIds = allTravellerIds;
        } else {
          travellerIds = travelerIdsWithEmail;
        }
        if (!travellerIds.length) { return; }
        travellerIds.forEach(function (travellerId) {
          var traveller = pax[travellerId] || {};
          rows.push(Object.assign({
            serviceId: String(service.id || ""), checkIn: displayDate(service.Hotel_Check_In), checkOut: displayDate(service.Hotel_Check_Out), duration: duration(service.Hotel_Check_In, service.Hotel_Check_Out),
            bookingName: booking.Deal_Name || lookupName(service.Booking), mfsp: booking.MFSP_Reference || "", connectionReference: vendor.TP_Reference || "", vendorName: vendor.Vendor_Name || lookupName(service.Supplier),
            clientName: lookupName(contact.Account_Name), clientEmail: contact.Email || "", travelerCount: allTravellerIds.length,
            passengers: allTravellerIds.map(function (id) { return Object.assign({ id: (pax[id] || {}).id, participationId: (pax[id] || {}).PAX_Booking_ID }, passengerValues(pax[id] || {})); }), selectedPassengerId: (pax[travellerIds[0]] || {}).id
          }, passengerValues(traveller)));
        });
      });
      visibleCount = 50; render();
    } catch (error) { rows = []; tableWrap.hidden = true; countBadge.hidden = true; message.textContent = error.message || "Could not load the traveler register."; }
    finally { search.disabled = false; search.classList.remove("is-loading"); message.classList.remove("is-loading"); }
  }
  function exportServices() {
    var services = {};
    rows.forEach(function (row) { if (!services[row.serviceId]) { services[row.serviceId] = row; } });
    return Object.keys(services).map(function (serviceId) { return services[serviceId]; });
  }
  function closeExportPicker() { exportPicker.hidden = true; }
  function openExportPicker() {
    exportPickerList.innerHTML = exportServices().map(function (row, rowIndex) {
      var options = row.passengers.map(function (passenger, passengerIndex) {
        return '<option value="' + passengerIndex + '"' + (passenger.id === row.selectedPassengerId ? " selected" : "") + ">" + escapeHtml(passengerName(passenger) + (passenger.passengerEmail ? " · " + passenger.passengerEmail : "")) + "</option>";
      }).join("");
      return '<label class="ministry-export-picker-row"><span><strong>' + escapeHtml(row.mfsp || row.bookingName || "Booking") + "</strong><small>" + escapeHtml((row.vendorName || "No supplier") + " · " + row.checkIn + " – " + row.checkOut) + '</small></span><select data-ministry-export-traveler="' + rowIndex + '">' + options + "</select></label>";
    }).join("");
    exportPicker.hidden = false;
  }
  function exportExcel(exportRows) {
    var visibleColumns = global.AccountingManagerApp.tableColumns.visibleOrder("ministryTravelerRegister");
    var headings = visibleColumns.map(function (key) { return columns.filter(function (column) { return column.key === key; })[0].label; });
    var body = exportRows.map(function (row) { return "<tr>" + visibleColumns.map(function (key) { return "<td>" + escapeHtml(row[key] == null ? "" : row[key]) + "</td>"; }).join("") + "</tr>"; }).join("");
    var blob = new Blob(["\ufeff<html><head><meta charset=\"utf-8\"></head><body><table><thead><tr>" + headings.map(function (heading) { return "<th>" + heading + "</th>"; }).join("") + "</tr></thead><tbody>" + body + "</tbody></table></body></html>"], { type: "application/vnd.ms-excel;charset=utf-8" });
    var url = global.URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "ministry-traveller-register-" + (dateFilters[0].from.value || "any-check-in") + "-" + (dateFilters[1].from.value || "any-check-out") + ".xls"; document.body.appendChild(link); link.click(); link.remove(); global.URL.revokeObjectURL(url);
  }
  tableHead.addEventListener("click", function (event) {
    var header = event.target.closest("[data-ministry-sort]");
    if (header) { changeSort(header.getAttribute("data-ministry-sort")); }
  });
  tableHead.addEventListener("keydown", function (event) {
    var header = event.target.closest("[data-ministry-sort]");
    if (header && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      var key = header.getAttribute("data-ministry-sort");
      changeSort(key);
      tableHead.querySelector('[data-ministry-sort="' + key + '"]').focus();
    }
  });
  global.AccountingManagerApp.tableColumns.configure("ministryTravelerRegister", columns, render);
  tab.addEventListener("click", function () { document.querySelectorAll(".operations-report-option").forEach(function (button) { button.classList.toggle("is-active", button === tab); }); panel.hidden = false; panel.closest(".operations-panel").classList.add("is-ministry-traveler-register"); destinationNote.hidden = false; document.getElementById("operations-filters").hidden = true; document.getElementById("card-purchases-toolbar").hidden = true; document.getElementById("operations-empty").hidden = true; document.getElementById("operations-table-wrap").hidden = true; document.getElementById("operations-pagination-bar").hidden = true; document.getElementById("operations-title").textContent = "Ministry Traveler Register"; });
  document.querySelectorAll("[data-operation-type]").forEach(function (button) { button.addEventListener("click", function () { panel.hidden = true; countBadge.hidden = true; destinationNote.hidden = true; panel.closest(".operations-panel").classList.remove("is-ministry-traveler-register"); document.getElementById("operations-filters").hidden = button.getAttribute("data-operation-type") !== "renfe"; }); });
  viewButtons.forEach(function (button) { button.addEventListener("click", function () { viewMode = button.getAttribute("data-ministry-view"); visibleCount = 50; viewButtons.forEach(function (item) { var active = item === button; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", active ? "true" : "false"); }); render(); }); });
  dateFilters.forEach(function (filter) { filter.mode.addEventListener("change", function () { setDatePreset(filter); }); setDatePreset(filter); });
  search.addEventListener("click", load);
  exportButton.addEventListener("click", openExportPicker);
  exportPicker.querySelectorAll("[data-ministry-export-close]").forEach(function (button) { button.addEventListener("click", closeExportPicker); });
  exportPickerConfirm.addEventListener("click", function () {
    var exportRows = exportServices().map(function (row, rowIndex) {
      var select = exportPickerList.querySelector('[data-ministry-export-traveler="' + rowIndex + '"]');
      var passenger = row.passengers[Number(select && select.value)] || row.passengers[0] || {};
      return Object.assign({}, row, passenger, { passengerEmail: passenger.passengerEmail || row.clientEmail || "" });
    });
    closeExportPicker();
    exportExcel(exportRows);
  });
}(window));
