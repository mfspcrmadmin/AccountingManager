(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  ns.syncPrepaymentRequest = async function (crm, requestId) {
    if (!requestId) { return; }
    if (!/^\d+$/.test(String(requestId))) { throw new Error("Invalid prepayment request ID."); }
    async function fields(module) {
      var response = await crm.getFields(module);
      if (!response || !Array.isArray(response.fields)) { throw new Error("Could not read fields for " + module); }
      return response.fields;
    }
    async function related(module, field) {
      var records = [], seen = new Set();
      for (var offset = 0; offset < 100000; offset += 200) {
        var page;
        try { page = await crm.coql("select id from " + module + " where " + field + " = '" + requestId + "' order by id asc limit " + offset + ", 200"); }
        catch (error) { if (Number(error && error.status) === 204 || error && error.code === "NO_CONTENT") { return records; } throw error; }
        if (!Array.isArray(page)) { throw new Error("Could not read " + module); }
        for (var row of page) {
          if (!row.id || seen.has(String(row.id))) { throw new Error("Incomplete " + module + " results."); }
          seen.add(String(row.id));
          var record = await crm.getRecord(module, String(row.id));
          if (!record || !record.id) { throw new Error("Could not read " + module + " " + row.id); }
          records.push(record);
        }
        if (page.length < 200) { return records; }
      }
      throw new Error("Too many related records to confirm payment status.");
    }
    function statusValue(schema, api, desired) {
      var field = schema.find(function (f) { return f.api_name === api; });
      var option = field && (field.pick_list_values || []).find(function (v) { return String(v.actual_value || "").toLowerCase() === desired; });
      if (!option) { throw new Error(api + " needs the CRM value " + desired); }
      return option.actual_value;
    }
    async function update(module, recordId, field, value) {
      var data = {}; data[field] = value;
      var response = await crm.updateRecord(module, recordId, data);
      if (!response || !response.data || !response.data[0] || response.data[0].code !== "SUCCESS") { throw new Error("Could not update " + module + " " + recordId); }
    }
    var payments = await related("Prepayments", "Prepayment_Request");
    var paid = payments.filter(function (p) { return p.Accounting_Status === "Prepayment recorded"; }).length;
    if (!payments.length || !paid) { throw new Error("No paid prepayments found for request " + requestId); }
    var desired = paid === payments.length ? "fully paid" : "partially paid";
    var requestFields = await fields("Prepayment_Requests"), serviceFields = await fields("Booking_Services");
    var lookup = serviceFields.find(function (f) { return f.data_type === "lookup" && f.lookup && f.lookup.module && f.lookup.module.api_name === "Prepayment_Requests"; });
    if (!lookup || !/^[A-Za-z][A-Za-z0-9_]*$/.test(lookup.api_name)) { throw new Error("Booking Services needs a lookup to Prepayment Requests."); }
    var requestStatus = statusValue(requestFields, "Status", desired), serviceStatus = statusValue(serviceFields, "Payment_Status", desired);
    var services = await related("Booking_Services", lookup.api_name);
    await update("Prepayment_Requests", requestId, "Status", requestStatus);
    var errors = [];
    for (var service of services) {
      try { await update("Booking_Services", String(service.id), "Payment_Status", serviceStatus); }
      catch (error) { errors.push(error.message); }
    }
    if (errors.length) { throw new Error(errors.join("; ")); }
  };
}(window));
