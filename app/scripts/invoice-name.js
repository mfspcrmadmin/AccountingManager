(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var prefixes = { Tickets: "TICK", Proforma: "PROF", "Final Invoice": "INV", "Credit Note": "CRED", Commission: "COMM" };
  function text(value) { return String(value == null ? "" : value).trim(); }
  function first(record, fields) {
    for (var field of fields) { if (text(record && record[field])) { return text(record[field]); } }
    return "";
  }
  ns.generateInvoiceName = async function (api, context) {
    var prefix = prefixes[context.type], supplierId = text(context.supplierId), bookingId = text(context.bookingId);
    if (!prefix || !supplierId || !bookingId) { return ""; }
    var mfsp = text(context.mfsp), code = text(context.supplierCode);
    async function get(module, recordId) {
      var response = await api.getRecord({ Entity: module, RecordID: recordId });
      var record = response && response.data && response.data[0];
      if (!record) { throw new Error("Could not read " + module + " for the invoice name."); }
      return record;
    }
    if (!mfsp) { mfsp = first(await get("Deals", bookingId), ["MFSP_Reference", "MFSP Reference"]); }
    if (context.type === "Final Invoice") { return mfsp ? "INV-" + mfsp + "-" : ""; }
    if (!code) { code = first(await get("Vendors", supplierId), ["TP_Reference", "Connection_Reference", "Supplier_Connection_Reference", "Connection Reference"]); }
    if (!mfsp || !code) { return ""; }
    var stem = prefix + "-" + mfsp + "-" + code + "-", max = 0, page = 1, seen = new Set();
    while (true) {
      var response;
      try { response = await api.searchRecord({ Entity: "Supplier_Invoices", Type: "criteria", Query: "(Supplier:equals:" + supplierId + ")", page: page, per_page: 200 }); }
      catch (error) { if (Number(error && error.status) === 204 || error && error.code === "NO_CONTENT") { break; } throw error; }
      if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { break; }
      if (!response || !Array.isArray(response.data)) { throw new Error("Could not check existing invoice names."); }
      for (var record of response.data) {
        if (seen.has(record.id)) { throw new Error("CRM returned repeated invoice pages."); }
        seen.add(record.id);
        var name = text(record.Name), suffix = name.slice(stem.length);
        if (name.indexOf(stem) === 0 && /^\d+$/.test(suffix)) { max = Math.max(max, Number(suffix)); }
      }
      if (!(response.info && response.info.more_records)) { break; }
      if (!response.data.length) { throw new Error("CRM returned incomplete invoice names."); }
      page += 1;
    }
    return stem + (max + 1);
  };
  ns.createInvoiceNameDefault = function (input, api, onError, onChanged) {
    var generation = 0, lastName = "", lastKey = "";
    return {
      reset: function () { generation += 1; lastName = ""; lastKey = ""; },
      update: async function (context) {
        var key = JSON.stringify(context), initial = input.value;
        if (key === lastKey || (text(initial) && initial !== lastName)) { return; }
        lastKey = key;
        var token = ++generation;
        if (initial === lastName) { input.value = ""; initial = ""; if (onChanged) { onChanged(); } }
        try {
          var name = await ns.generateInvoiceName(api(), context);
          if (token !== generation || input.value !== initial) { return; }
          input.value = name; lastName = name;
          if (onChanged) { onChanged(); }
        } catch (error) {
          if (token === generation) { lastKey = ""; if (onError) { onError(error); } }
        }
      }
    };
  };
}(window));
