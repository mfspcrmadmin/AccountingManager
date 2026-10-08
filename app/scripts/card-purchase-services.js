(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  function id(record) { return String(record && record.id || ""); }
  function matches(record, purchase) { return id(record.Supplier) === id(purchase.Supplier) && id(record.Booking) === id(purchase.Booking); }
  function editable(purchase) {
    return purchase && !id(purchase.Vendor_Invoice) && !id(purchase.Vendor_Payment) &&
      ["Purchase recorded", "Refund recorded", "Cancelled"].indexOf(purchase.Accounting_Status) === -1;
  }
  async function get(api, entity, recordId) {
    var response = await api.getRecord({ Entity: entity, RecordID: recordId });
    var record = response && response.data && response.data[0];
    if (!record || id(record) !== recordId) { throw new Error("Could not verify the associated service. Reopen the form to retry."); }
    return record;
  }
  ns.cardPurchaseServices = {
    editable: editable,
    load: async function (api, purchase) {
      if (!/^\d+$/.test(id(purchase.Supplier)) || !/^\d+$/.test(id(purchase.Booking))) { throw new Error("A supplier and booking are required to select a service."); }
      var records = [], seen = new Set();
      for (var page = 1; page <= 50; page += 1) {
        var response;
        try { response = await api.searchRecord({ Entity: "Booking_Services", Type: "criteria", Query: '((Supplier:equals:' + id(purchase.Supplier) + ')and(Booking:equals:' + id(purchase.Booking) + '))', page: page, per_page: 200 }); }
        catch (error) { if (Number(error && error.status) === 204 || error && error.code === "NO_CONTENT") { break; } throw error; }
        if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { break; }
        if (!response || !Array.isArray(response.data)) { throw new Error("Could not load services."); }
        response.data.forEach(function (record) {
          if (!id(record) || seen.has(id(record))) { throw new Error("CRM returned incomplete service results."); }
          seen.add(id(record));
          if (matches(record, purchase)) { records.push(record); }
        });
        if (!(response.info && response.info.more_records)) { break; }
        if (!response.data.length || page === 50) { throw new Error("CRM returned incomplete service results."); }
      }
      return records;
    },
    save: async function (api, purchase, serviceId) {
      if (!editable(purchase)) { throw new Error("The service cannot be changed after an invoice or payment is linked."); }
      if (!/^\d+$/.test(String(serviceId || ""))) { throw new Error("Select an associated service."); }
      var current = await get(api, "Card_Purchases", id(purchase));
      if (!editable(current) || !matches(current, purchase) || id(current.Boking_Service) !== id(purchase.Boking_Service)) {
        throw new Error("This card purchase has changed. Reopen it before editing its service.");
      }
      var selected = await get(api, "Booking_Services", serviceId);
      if (!matches(selected, current)) { throw new Error("The service must belong to this supplier and booking."); }
      var response = await api.updateRecord({ Entity: "Card_Purchases", RecordID: id(current), APIData: { id: id(current), Boking_Service: { id: serviceId } }, Trigger: ["workflow"] });
      var result = response && response.data && response.data[0];
      if (!result || String(result.code || result.status).toLowerCase() !== "success") { throw new Error(result && result.message || "Could not save the associated service."); }
      return selected;
    }
  };
}(window));
