(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  // Existing unique Registration_Key fields protect inserts even when the response is lost.
  ns.ensureQuickInvoiceRecord = async function (zoho, module, key, values) {
    var api = zoho.CRM.API;
    var metadata = await zoho.CRM.META.getFields({ Entity: module });
    var field = (metadata.fields || []).find(function (f) { return f.api_name === "Registration_Key"; });
    if (!field || !field.unique || !Object.keys(field.unique).length) { throw new Error("A unique Registration_Key is required in " + module + " before saving safely."); }
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) { throw new Error("Invalid invoice recovery key."); }
    var response;
    try { response = await api.searchRecord({ Entity: module, Type: "criteria", Query: "(Registration_Key:equals:" + key + ")", page: 1, per_page: 200 }); }
    catch (error) { if (Number(error.status) !== 204 && error.code !== "NO_CONTENT") { throw error; } response = { data: [] }; }
    if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { response = { data: [] }; }
    if (!response || !Array.isArray(response.data) || response.data.length > 1 || response.info && response.info.more_records) { throw new Error("Could not uniquely identify the pending " + module + " record."); }
    var record = response.data[0];
    if (!record) {
      response = await api.insertRecord({ Entity: module, APIData: [Object.assign({}, values, { Registration_Key: key })], Trigger: [] });
      var result = response && response.data && response.data[0];
      if (!result || !["SUCCESS", "DUPLICATE_DATA"].includes(result.code) && result.status !== "success" || !result.details || !result.details.id) { throw new Error(result && result.message || "The invoice step was not confirmed. Retry the same operation."); }
      response = await api.getRecord({ Entity: module, RecordID: String(result.details.id) });
      record = response && response.data && response.data[0];
    }
    if (!record || record.Registration_Key !== key) { throw new Error("The recovered record belongs to another operation."); }
    Object.keys(values).forEach(function (fieldName) {
      var expected = values[fieldName], actual = record[fieldName];
      if (fieldName === "Registration_Status" && expected === "Pending" && ["Ready", "Complete"].includes(actual)) { return; }
      if (expected && typeof expected === "object" && expected.id) { expected = String(expected.id); actual = String(actual && actual.id || ""); }
      if (typeof expected === "number") { actual = actual == null ? NaN : Number(actual); }
      if (actual !== expected && !(expected === "" && actual == null)) { throw new Error("The recovered " + module + " record changed (" + fieldName + "). Review it before continuing."); }
    });
    return String(record.id);
  };
  ns.validateQuickInvoiceAllocation = async function (zoho, invoiceId, settlementId, total, currency, allocationId) {
    var api = zoho.CRM.API, records = [], seen = new Set();
    for (var page = 1; page <= 25; page++) {
      var response;
      try {
        response = api.coql ? await api.coql({select_query:"select id, Status, Vendor_Invoice, Vendor_Settlement, Allocated_Amount, Currency from Inv_Set_Allocations where Vendor_Invoice = '" + String(invoiceId).replace(/'/g, "''") + "' order by id asc limit " + ((page - 1) * 200) + ", 200"}) :
          await api.searchRecord({Entity:"Inv_Set_Allocations",Type:"criteria",Query:"(Vendor_Invoice:equals:" + invoiceId + ")",page:page,per_page:200});
      }
      catch (error) { if (Number(error && error.status) !== 204 && (!error || error.code !== "NO_CONTENT")) { throw error; } response = {data:[]}; }
      if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { response = {data:[]}; }
      if (!response || !Array.isArray(response.data)) { throw new Error("Could not verify all invoice settlement allocations."); }
      for (var record of response.data) {
        if (!record.id || seen.has(String(record.id))) { throw new Error("Incomplete invoice settlement allocations."); }
        seen.add(String(record.id)); records.push(record);
      }
      if (!(response.info && response.info.more_records) && response.data.length < 200) { break; }
      if (!response.data.length || page === 25) { throw new Error("Incomplete invoice settlement allocations."); }
    }
    // The confirmed allocation can be read before Search has indexed it.
    var direct = await api.getRecord({Entity:"Inv_Set_Allocations",RecordID:allocationId});
    var saved = direct && direct.data && direct.data[0];
    if (!saved || String(saved.id) !== String(allocationId)) { throw new Error("Could not verify the saved invoice allocation."); }
    records = records.filter(function (row) { return String(row.id) !== String(allocationId); });
    records.push(saved);
    var active = records.filter(function (row) { return row.Status !== "Void" && row.Status !== "Cancelled"; });
    if (active.length !== 1 || String(active[0].Vendor_Invoice && active[0].Vendor_Invoice.id) !== String(invoiceId) ||
        String(active[0].Vendor_Settlement && active[0].Vendor_Settlement.id) !== String(settlementId) ||
        Number(active[0].Allocated_Amount) !== Number(total) || (active[0].Currency || "EUR") !== currency) {
      throw new Error("The invoice settlement allocation changed. Its complete allocation must match the invoice total before registration can finish.");
    }
  };
  ns.completeQuickInvoice = async function (zoho, invoiceId) {
    for (var status of ["Ready", "Complete"]) {
      var response = await zoho.CRM.API.updateRecord({Entity:"Supplier_Invoices",APIData:{id:invoiceId,Registration_Status:status},Trigger:[]});
      var row = response && response.data && response.data[0];
      if (!row || row.code !== "SUCCESS" && row.status !== "success") { throw new Error("Invoice registration status was not confirmed. Resume the saved operation."); }
      if (status === "Ready") {
        var warning = await ns.refreshQuickInvoiceSettlements(zoho, invoiceId);
        if (warning) { throw new Error(warning + " Resume the saved operation."); }
      }
    }
  };
}(window));
