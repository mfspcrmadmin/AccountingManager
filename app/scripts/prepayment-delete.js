(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var PREFIX = "accounting-manager-delete-prepayment-";
  function id(value) { return String(value && value.id || value || ""); }
  ns.createPrepaymentDeletionService = function (zoho, storage) {
    var api = zoho.CRM.API, running = false;
    function save(job) { storage.setItem(PREFIX + job.id, JSON.stringify(job)); }
    async function get(module, recordId) {
      var response = await api.getRecord({ Entity: module, RecordID: recordId });
      var record = response && response.data && response.data[0];
      if (!record || String(record.id) !== recordId) { throw new Error("Could not read " + module + " " + recordId); }
      return record;
    }
    async function query(sql) {
      var response;
      try { response = await api.coql({ select_query: sql }); }
      catch (error) { if (Number(error && error.status) === 204 || error && error.code === "NO_CONTENT") { return []; } throw error; }
      if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { return []; }
      if (!response || response.code || !Array.isArray(response.data)) { throw new Error("Could not verify prepayment relationships. Nothing else will be deleted."); }
      return response.data;
    }
    async function related(module, field, recordId) {
      if (!/^\d+$/.test(recordId)) { throw new Error("Invalid relationship ID."); }
      var rows = [], seen = new Set();
      for (var offset = 0; offset < 100000; offset += 200) {
        var page = await query("select id from " + module + " where " + field + " = '" + recordId + "' order by id asc limit " + offset + ", 200");
        for (var row of page) {
          if (!row.id || seen.has(String(row.id))) { throw new Error("Incomplete CRM relationships."); }
          seen.add(String(row.id)); rows.push(row);
        }
        if (page.length < 200) { return rows; }
      }
      throw new Error("Too many relationships to verify deletion.");
    }
    async function guard(recordId) {
      if (ns.assertPrepaymentDeletionCheckpoint) { ns.assertPrepaymentDeletionCheckpoint(recordId); }
      var p = await get("Prepayments", recordId);
      var schema = await zoho.CRM.META.getFields({ Entity: "Prepayments" });
      if (!schema || !Array.isArray(schema.fields)) { throw new Error("Could not verify prepayment fields."); }
      var fields = ["Vendor_Invoice", "Vendor_Payment"].concat(schema.fields.filter(function (f) {
        return f.lookup && f.lookup.module && ["Supplier_Invoices", "Supplier_Payments"].indexOf(f.lookup.module.api_name) !== -1;
      }).map(function (f) { return f.api_name; }));
      if (fields.some(function (f) { return Boolean(id(p[f])); }) || p.Accounting_Status === "Prepayment recorded" ||
          (await related("Prepayment_Invoice_Allocations", "Prepayment", recordId)).length) {
        throw new Error("Cannot delete a prepayment with associated invoices or payments.");
      }
      var journal = JSON.parse(storage.getItem("accounting-manager-prepayment-" + recordId) || "{}");
      if (journal.invoiceId || journal.paymentId || journal.invoiceAttempt || journal.paymentAttempt || journal.invoiceAllocationAttempt || (journal.invoiceAllocationIds || []).length) {
        throw new Error("Review the pending invoice/payment operation before deleting this prepayment.");
      }
      return p;
    }
    async function prepare(recordId) {
      var payment = await guard(recordId), requestId = id(payment.Prepayment_Request);
      var job = { id: recordId, payment: payment, requestId: requestId, operations: [], cursor: 0 };
      var links = [], siblings = requestId ? await related("Prepayments", "Prepayment_Request", requestId) : [];
      job.removeRequest = Boolean(requestId) && !siblings.some(function (p) { return String(p.id) !== recordId; });
      if (requestId) {
        if (!siblings.some(function (p) { return String(p.id) === recordId; })) { throw new Error("CRM has not confirmed this request's prepayments. Refresh before deleting."); }
        if (job.removeRequest) { links = await related("Prepayment_Request_Services", "Prepayment_Request", requestId); }
        // Calculate every status and validate all reads before making any changes.
        await ns.syncPrepaymentRequest({
          getFields: function (module) { return zoho.CRM.META.getFields({ Entity: module }); },
          getRecord: get, coql: query,
          updateRecord: async function (module, recordId, data) {
            job.operations.push({ type: "update", module: module, id: recordId, data: data });
            return { data: [{ code: "SUCCESS" }] };
          }
        }, requestId, { excludePrepaymentId: recordId, removeRequest: job.removeRequest });
      }
      job.operations.push({ type: "delete", module: "Prepayments", id: recordId });
      links.forEach(function (link) { job.operations.push({ type: "delete", module: "Prepayment_Request_Services", id: String(link.id) }); });
      if (job.removeRequest) { job.operations.push({ type: "delete", module: "Prepayment_Requests", id: requestId }); }
      return job;
    }
    async function remove(recordId) {
      if (running) { throw new Error("A prepayment deletion is already running."); }
      running = true;
      try {
        var job = JSON.parse(storage.getItem(PREFIX + recordId) || "null") || await prepare(recordId);
        var deleted = job.operations.slice(0, job.cursor).some(function (op) { return op.type === "delete" && op.module === "Prepayments"; });
        if (!deleted) { await guard(recordId); }
        if (job.removeRequest && (await related("Prepayments", "Prepayment_Request", job.requestId)).some(function (p) { return String(p.id) !== recordId; })) {
          throw new Error("This request now has other prepayments. Review its relationships before continuing deletion.");
        }
        save(job);
        while (job.cursor < job.operations.length) {
          var op = job.operations[job.cursor];
          if (op.type === "delete" && op.module === "Prepayments") { await guard(recordId); }
          if (op.type === "delete" && op.module === "Prepayment_Requests") {
            if ((await related("Prepayments", "Prepayment_Request", job.requestId)).length ||
                (await related("Prepayment_Request_Services", "Prepayment_Request", job.requestId)).length) {
              throw new Error("The request still has relationships. Refresh and review them before completing deletion.");
            }
          }
          var response = op.type === "delete"
            ? await api.deleteRecord({ Entity: op.module, RecordID: op.id })
            : await api.updateRecord({ Entity: op.module, APIData: Object.assign({ id: op.id }, op.data), Trigger: [] });
          var result = response && response.data && response.data[0];
          if (!result || (result.code !== "SUCCESS" && result.status !== "success")) { throw new Error(result && result.message || "CRM did not confirm deletion changes."); }
          job.cursor += 1; save(job);
        }
        storage.removeItem(PREFIX + recordId);
        if (ns.resetPrepaymentCheckpoint) { ns.resetPrepaymentCheckpoint(recordId); }
      } finally { running = false; }
    }
    function pending() {
      var payments = [];
      for (var i = 0; i < storage.length; i += 1) {
        var key = storage.key(i);
        if (key.indexOf(PREFIX) === 0) { payments.push(JSON.parse(storage.getItem(key)).payment); }
      }
      return payments;
    }
    return { remove: remove, pending: pending };
  };
}(window));
