(function (global) {
  "use strict";
  var panel = document.getElementById("ministry-traveller-register");
  var tab = document.querySelector("[data-ministry-report-tab]");
  var checkInFrom = document.getElementById("ministry-check-in-from");
  var checkOutTo = document.getElementById("ministry-check-out-to");
  var datePreset = document.getElementById("ministry-date-preset");
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
  var rows = [];
  var viewMode = "simple";
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
  function setDatePreset() {
    var now = new Date(), start, end, preset = datePreset.value;
    if (preset === "specific") { checkInFrom.disabled = false; checkOutTo.disabled = false; return; }
    if (preset === "last-month") { start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); }
    if (preset === "next-month") { start = new Date(now.getFullYear(), now.getMonth() + 1, 1); end = new Date(now.getFullYear(), now.getMonth() + 2, 0); }
    if (preset === "last-7-days") { end = new Date(now); start = new Date(now); start.setDate(start.getDate() - 6); }
    if (preset === "last-30-days") { end = new Date(now); start = new Date(now); start.setDate(start.getDate() - 29); }
    if (preset === "next-7-days") { start = new Date(now); end = new Date(now); end.setDate(end.getDate() + 6); }
    if (preset === "next-30-days") { start = new Date(now); end = new Date(now); end.setDate(end.getDate() + 29); }
    checkInFrom.value = toInputDate(start); checkOutTo.value = toInputDate(end); checkInFrom.disabled = true; checkOutTo.disabled = true;
  }
  function duration(checkIn, checkOut) { var start = Date.parse(date(checkIn) + "T00:00:00Z"), end = Date.parse(date(checkOut) + "T00:00:00Z"); return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 86400000)) : ""; }
  function passengerValues(traveller) {
    var isLead = traveller.Lead_Pax === true || String(traveller.Lead_Pax).toLowerCase() === "true";
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
    var output = response && response.details && response.details.output;
    try { output = typeof output === "string" ? JSON.parse(output) : output; } catch (error) { return null; }
    if (Array.isArray(output)) { return output; }
    if (output && Array.isArray(output.travelers)) { return output.travelers; }
    if (output && Array.isArray(output.travellers)) { return output.travellers; }
    return null;
  }
  async function getTravelersForBooking(bookingId) {
    var response, travelers, relations, ids;
    try {
      response = await global.ZOHO.CRM.FUNCTIONS.execute("crm_getTravelersForBooking", { arguments: JSON.stringify({ bookingId: bookingId }) });
      travelers = functionOutputRecords(response);
      if (travelers) { return travelers; }
    } catch (functionError) {
      // Fall through to the relationship-module implementation below.
    }
    relations = await api().searchRecord({ Entity: "PAX_X_Bookings", Type: "criteria", Query: "(Bookings:equals:" + bookingId + ")" }, 1, 200);
    ids = uniqueIds(extract(relations).map(function (relation) { return relation.PAX; }));
    return Promise.all(ids.map(function (id) { return getRecord("PAX", id); }));
  }
  async function loadTravelersByBooking(bookingIds) {
    var travelerIdsByBooking = {};
    var records = {};
    await Promise.all(bookingIds.map(async function (bookingId) {
      var travelers = await getTravelersForBooking(bookingId);
      var travelerIds = uniqueIds(travelers);
      travelerIdsByBooking[bookingId] = travelerIds;
      travelers.forEach(function (traveler) { if (traveler && traveler.id) { records[String(traveler.id)] = traveler; } });
    }));
    return { idsByBooking: travelerIdsByBooking, records: records };
  }
  async function loadServices(from, to) {
    var all = [], offset = 0, response, batch, query;
    do {
      query = "select id, Booking, Supplier, Hotel_Check_In, Hotel_Check_Out from Booking_Services where (Hotel_Check_In >= '" + from + "' and Hotel_Check_Out <= '" + to + "') limit " + offset + ", 200";
      response = await api().coql({ select_query: query });
      batch = extract(response);
      all = all.concat(batch);
      offset += batch.length;
    } while (response && response.info && response.info.more_records && batch.length);
    return all;
  }
  function render() {
    var visibleColumns = global.AccountingManagerApp.tableColumns.visibleOrder("ministryTravelerRegister");
    function cell(key, row) {
      if (key === "leadPax") {
        var isLead = row.leadPax === "true";
        return '<td class="ministry-lead-pax-cell"><span class="ministry-lead-pax ' + (isLead ? "is-lead" : "is-not-lead") + '" title="' + (isLead ? "Lead passenger" : "Not lead passenger") + '" aria-label="' + (isLead ? "Lead passenger" : "Not lead passenger") + '">' + (isLead ? '&#10003;' : '&times;') + "</span></td>";
      }
      return "<td>" + escapeHtml(row[key] == null ? "" : row[key]) + "</td>";
    }
    function dataRow(row) { return "<tr>" + visibleColumns.map(function (key) { return cell(key, row); }).join("") + '<td class="table-columns-gear-cell"></td></tr>'; }
    tableHead.innerHTML = "<tr>" + visibleColumns.map(function (key) { return "<th>" + escapeHtml(columns.filter(function (column) { return column.key === key; })[0].label) + "</th>"; }).join("") + '<th class="table-columns-gear-cell">' + global.AccountingManagerApp.tableColumns.button("ministryTravelerRegister") + "</th></tr>";
    if (viewMode === "simple") {
      tableBody.innerHTML = rows.map(dataRow).join("");
    } else {
      var groups = {};
      rows.forEach(function (row) { var group = row.mfsp || "No MFSP Reference"; (groups[group] = groups[group] || []).push(row); });
      tableBody.innerHTML = Object.keys(groups).sort().map(function (group) {
        var hotelIds = {};
        groups[group].forEach(function (row) { hotelIds[row.serviceId] = true; });
        return '<tr class="ministry-group-row"><td colspan="' + (visibleColumns.length + 1) + '"><strong>' + escapeHtml(group) + '</strong><span>' + Object.keys(hotelIds).length + (Object.keys(hotelIds).length === 1 ? " hotel" : " hotels") + "</span></td></tr>" + groups[group].map(function (row, index, groupRows) {
          if (groupRows.slice(0, index).some(function (previousRow) { return previousRow.serviceId === row.serviceId; })) { return dataRow(row); }
          return '<tr class="ministry-hotel-group-row"><td colspan="' + (visibleColumns.length + 1) + '"><strong>' + escapeHtml(row.vendorName || "No supplier") + '</strong><span>' + escapeHtml(row.checkIn + " – " + row.checkOut) + " · " + row.travelerCount + (row.travelerCount === 1 ? " traveler" : " travelers") + "</span></td></tr>" + dataRow(row);
        }).join("");
      }).join("");
    }
    tableWrap.hidden = !rows.length;
    exportButton.disabled = !rows.length;
    countBadge.hidden = false;
    countBadge.textContent = rows.length + (rows.length === 1 ? " traveler found" : " travelers found");
    message.textContent = rows.length ? "" : "No travelers were found for the selected dates.";
  }
  async function load() {
    var from = date(checkInFrom.value), to = date(checkOutTo.value), mfsp = String(mfspFilter.value || "").trim().toLowerCase(), supplierCode = String(supplierCodeFilter.value || "").trim().toLowerCase(), services, eligibleServices, bookings, contacts, vendors, travelerData, pax;
    if (!from || !to) { message.textContent = "Enter both dates before searching."; return; }
    if (from > to) { message.textContent = "Check-in from must be before check-out to."; return; }
    search.disabled = true; search.classList.add("is-loading"); exportButton.disabled = true; tableWrap.hidden = true; countBadge.hidden = true; message.classList.add("is-loading"); message.innerHTML = '<span class="ministry-message-spinner" aria-hidden="true"></span>Loading hotel services and traveller data…';
    try {
      services = await loadServices(from, to);
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
        var leadTravellerIds = travellerIds.filter(function (id) { var traveller = pax[id] || {}; return traveller.Lead_Pax === true || String(traveller.Lead_Pax).toLowerCase() === "true"; });
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
            passengers: allTravellerIds.map(function (id) { return Object.assign({ id: id }, passengerValues(pax[id] || {})); }), selectedPassengerId: travellerIds[0]
          }, passengerValues(traveller)));
        });
      });
      render();
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
    var url = global.URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "ministry-traveller-register-" + checkInFrom.value + "-" + checkOutTo.value + ".xls"; document.body.appendChild(link); link.click(); link.remove(); global.URL.revokeObjectURL(url);
  }
  global.AccountingManagerApp.tableColumns.configure("ministryTravelerRegister", columns, render);
  tab.addEventListener("click", function () { document.querySelectorAll(".operations-report-option").forEach(function (button) { button.classList.toggle("is-active", button === tab); }); panel.hidden = false; panel.closest(".operations-panel").classList.add("is-ministry-traveler-register"); destinationNote.hidden = false; document.getElementById("operations-filters").hidden = true; document.getElementById("card-purchases-toolbar").hidden = true; document.getElementById("operations-empty").hidden = true; document.getElementById("operations-table-wrap").hidden = true; document.getElementById("operations-pagination-bar").hidden = true; document.getElementById("operations-title").textContent = "Ministry Traveler Register"; });
  document.querySelectorAll("[data-operation-type]").forEach(function (button) { button.addEventListener("click", function () { panel.hidden = true; countBadge.hidden = true; destinationNote.hidden = true; panel.closest(".operations-panel").classList.remove("is-ministry-traveler-register"); document.getElementById("operations-filters").hidden = button.getAttribute("data-operation-type") !== "renfe"; }); });
  viewButtons.forEach(function (button) { button.addEventListener("click", function () { viewMode = button.getAttribute("data-ministry-view"); viewButtons.forEach(function (item) { var active = item === button; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", active ? "true" : "false"); }); render(); }); });
  datePreset.addEventListener("change", setDatePreset); setDatePreset(); search.addEventListener("click", load);
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
