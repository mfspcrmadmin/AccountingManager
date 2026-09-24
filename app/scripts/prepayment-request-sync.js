(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  ns.syncPrepaymentRequestFromSDK = function (api, meta, requestId) {
    return ns.syncPrepaymentRequest({
      getFields: function (module) { return meta.getFields({ Entity: module }); },
      getRecord: async function (module, recordId) { var response = await api.getRecord({ Entity: module, RecordID: recordId }); return response && response.data && response.data[0]; },
      coql: async function (query) {
        var response = await api.coql({ select_query: query });
        if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { return []; }
        if (!response || response.code || !Array.isArray(response.data)) { throw new Error("Could not read related prepayments or services."); }
        return response.data;
      },
      updateRecord: function (module, recordId, data) { return api.updateRecord({ Entity: module, APIData: Object.assign({ id: recordId }, data), Trigger: [] }); }
    }, requestId);
  };
  ns.syncPrepaymentRequest = async function (crm, requestId, options) {
    options = options || {};
    if (!requestId) { return; }
    if (!/^\d+$/.test(String(requestId))) { throw new Error("Invalid prepayment request ID."); }
    async function fields(module) {
      var response = await crm.getFields(module);
      if (!response || !Array.isArray(response.fields)) { throw new Error("Could not read fields for " + module); }
      return response.fields;
    }
    async function related(module, field, parentId) {
      if (!/^\d+$/.test(String(parentId))) { throw new Error("Invalid relationship ID."); }
      var records = [], seen = new Set();
      for (var offset = 0; offset < 100000; offset += 200) {
        var page;
        try { page = await crm.coql("select id from " + module + " where " + field + " = '" + parentId + "' order by id asc limit " + offset + ", 200"); }
        catch (error) { if (Number(error && error.status) === 204 || error && error.code === "NO_CONTENT") { return records; } throw error; }
        if (!Array.isArray(page)) { throw new Error("Could not read " + module); }
        for (var row of page) {
          if (!row.id || seen.has(String(row.id))) { throw new Error("Incomplete " + module + " results."); }
          seen.add(String(row.id));
          var record = await crm.getRecord(module, String(row.id));
          if (!record || String(record.id) !== String(row.id)) { throw new Error("Could not read " + module + " " + row.id); }
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
    var summaries = new Map();
    function id(value) { return String(value && value.id || ""); }
    async function summary(parentId) {
      if (summaries.has(parentId)) { return summaries.get(parentId); }
      var request = await crm.getRecord("Prepayment_Requests", parentId);
      if (!request || String(request.id) !== parentId) { throw new Error("Could not read request " + parentId); }
      var ignored = (options.removeRequest && parentId === String(requestId)) || ["cancelled", "discarded"].indexOf(String(request.Status || "").toLowerCase()) !== -1;
      var payments = ignored ? [] : (await related("Prepayments", "Prepayment_Request", parentId)).filter(function (p) { return p.Accounting_Status !== "Cancelled" && String(p.id) !== options.excludePrepaymentId; });
      var paid = payments.filter(function (p) { return ["Prepayment recorded", "Discard - Credit", "Discard - Already Paid"].indexOf(p.Accounting_Status) !== -1; }).length;
      var result = { ignored: ignored, paid: paid > 0, full: payments.length > 0 && paid === payments.length };
      summaries.set(parentId, result);
      return result;
    }
    var current = await summary(String(requestId));
    var requestFields = await fields("Prepayment_Requests"), serviceFields = await fields("Booking_Services");
    var links = await related("Prepayment_Request_Services", "Prepayment_Request", String(requestId));
    var serviceIds = new Set();
    links.forEach(function (link) {
      if (id(link.Prepayment_Request) !== String(requestId) || !id(link.Booking_Service)) { throw new Error("Invalid request/service association."); }
      serviceIds.add(id(link.Booking_Service));
    });
    var updates = [];
    for (var serviceId of serviceIds) {
      var serviceLinks = await related("Prepayment_Request_Services", "Booking_Service", serviceId);
      var requestIds = new Set();
      serviceLinks.forEach(function (link) {
        if (id(link.Booking_Service) !== serviceId || !id(link.Prepayment_Request)) { throw new Error("Invalid service/request association."); }
        requestIds.add(id(link.Prepayment_Request));
      });
      if (!requestIds.has(String(requestId))) { throw new Error("Incomplete service/request associations. Retry synchronization."); }
      var active = [];
      for (var parentId of requestIds) {
        var item = await summary(parentId);
        if (!item.ignored) { active.push(item); }
      }
      var desired = active.length && active.every(function (item) { return item.full; }) ? "fully paid" :
        active.some(function (item) { return item.paid; }) ? "partially paid" : "prepayment requested";
      if (active.length) { updates.push({ id: serviceId, status: statusValue(serviceFields, "Payment_Status", desired) }); }
      else if (options.removeRequest) {
        // No request remains to justify a request-derived payment status.
        var serviceRecord = await crm.getRecord("Booking_Services", serviceId);
        if (!serviceRecord || String(serviceRecord.id) !== serviceId) { throw new Error("Could not read service " + serviceId); }
        if (["prepayment requested", "fully paid", "partially paid"].indexOf(String(serviceRecord.Payment_Status || "").toLowerCase()) !== -1) {
          var paidAmount = Number(serviceRecord.Total_Paid || 0), cost = Number(serviceRecord.Total_Service_Cost || 0);
          var baseline = paidAmount > 0 ? (cost > 0 && paidAmount >= cost ? "fully paid" : "partially paid") : "to be paid";
          updates.push({ id: serviceId, status: statusValue(serviceFields, "Payment_Status", baseline) });
        }
      }
    }
    if (!current.ignored) {
      await update("Prepayment_Requests", requestId, "Status", statusValue(requestFields, "Status", current.full ? "fully paid" : current.paid ? "partially paid" : "to be paid"));
    }
    var errors = [];
    for (var service of updates) {
      try { await update("Booking_Services", service.id, "Payment_Status", service.status); }
      catch (error) { errors.push(error.message); }
    }
    if (errors.length) { throw new Error(errors.join("; ")); }
  };
}(window));
