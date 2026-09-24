(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  function id(record) { return String(record && record.id || ""); }
  function matches(record, purchase) { return id(record.Supplier) === id(purchase.Supplier) && id(record.Booking) === id(purchase.Booking); }
  function context(purchase) {
    if (!/^\d+$/.test(id(purchase.Supplier)) || !/^\d+$/.test(id(purchase.Booking))) { throw new Error("A supplier and booking are required to select a settlement."); }
  }
  ns.cardPurchaseSettlements = {
    load: async function (api, purchase) {
      context(purchase);
      var records = [], seen = new Set();
      for (var page = 1; page <= 50; page += 1) {
        var response;
        try { response = await api.searchRecord({ Entity: "Supplier_Settlements", Type: "criteria", Query: '((Supplier:equals:' + id(purchase.Supplier) + ')and(Booking:equals:' + id(purchase.Booking) + '))', page: page, per_page: 200 }); }
        catch (error) { if (Number(error && error.status) === 204 || error && error.code === 'NO_CONTENT') { break; } throw error; }
        if (response && (Number(response.status) === 204 || response.code === 'NO_CONTENT')) { break; }
        if (!response || !Array.isArray(response.data)) { throw new Error("Could not load supplier settlements."); }
        response.data.forEach(function (record) {
          if (!id(record) || seen.has(id(record))) { throw new Error("CRM returned incomplete settlement results."); }
          seen.add(id(record));
          if (matches(record, purchase)) { records.push(record); }
        });
        if (!(response.info && response.info.more_records)) { break; }
        if (!response.data.length || page === 50) { throw new Error("CRM returned incomplete settlement results."); }
      }
      var linked = records.find(function (record) { return id(record) === id(purchase.Settlement); });
      return { records: records, selectedId: linked ? id(linked) : records.length === 1 ? id(records[0]) : "" };
    },
    validate: async function (api, purchase, settlementId) {
      context(purchase);
      if (!/^\d+$/.test(String(settlementId || ""))) { throw new Error("Select a settlement before creating the invoice."); }
      var response = await api.getRecord({ Entity: "Supplier_Settlements", RecordID: settlementId });
      var record = response && response.data && response.data[0];
      if (!record || id(record) !== settlementId || !matches(record, purchase)) { throw new Error("The selected settlement must belong to this supplier and booking. Reopen the form to refresh the choices."); }
      return record;
    }
  };
}(window));
