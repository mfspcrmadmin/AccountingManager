(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  ns.getUndoPrepaymentFields = async function (crm) {
    var response = await crm.getFields("Prepayments"), fields = response && response.fields || [];
    function lookup(module, preferred) {
      var field = fields.find(function (f) { return f.api_name === preferred && f.data_type === "lookup"; }) || fields.find(function (f) { return f.lookup && f.lookup.module && f.lookup.module.api_name === module; });
      if (!field) { throw new Error("Prepayments needs a lookup to " + module + "."); }
      return field.api_name;
    }
    return { payment: lookup("Supplier_Payments", "Vendor_Payment") };
  };
  ns.operationUndoFields = function (module, record, clearInvoice) {
    var refund = module === "Card_Purchases" && record.Transaction_Type === "Refund";
    var fields = { Vendor_Payment: null };
    if (clearInvoice) { fields.Vendor_Invoice = null; }
    if (module === "Prepayments") { fields.Payment_Date = null; }
    else {
      fields.Accounting_Processed_At = null; fields.Accounting_Processed_By = null;
      if (clearInvoice) { fields.Invoice_Number = null; }
    }
    if (!/^(Cancelled|Discard - Credit|Discard - Already Paid)$/.test(record.Accounting_Status || "")) {
      fields.Accounting_Status = module === "Prepayments" ? (record._invoiceAllocationComplete ? "Pending payment record" : "Pending invoice") : !clearInvoice && record.Vendor_Invoice
        ? (refund ? "Pending refund record" : "Pending payment record")
        : (refund ? "Pending credit note" : "Pending invoice");
    }
    return fields;
  };
  ns.preparePaymentOperationUndo = async function (crm, paymentId) {
    var operations = [];
    for (var module of ["Prepayments", "Card_Purchases"]) {
      var fields = module === "Prepayments" ? await ns.getUndoPrepaymentFields(crm) : { invoice: "Vendor_Invoice", payment: "Vendor_Payment" };
      var seen = new Set();
      for (var page = 1; ; page += 1) {
        var rows = await crm.searchRecordPage(module, "(" + fields.payment + ":equals:" + paymentId + ")", page, 200);
        if (!Array.isArray(rows)) { throw new Error("Could not read linked " + module); }
        for (var row of rows) {
          if (!row.id || seen.has(String(row.id))) { throw new Error("Incomplete search results for " + module); }
          seen.add(String(row.id));
          if (module === "Prepayments") {
            var links = [], linkSeen = new Set();
            for (var linkPage = 1; ; linkPage += 1) {
              var batch = await crm.searchRecordPage(ns.prepaymentAllocations.module, "(Prepayment:equals:" + row.id + ")", linkPage, 200);
              if (!Array.isArray(batch)) { throw new Error("Could not read prepayment invoice allocations."); }
              batch.forEach(function (link) { if (!link.id || linkSeen.has(String(link.id))) { throw new Error("Incomplete prepayment allocations."); } linkSeen.add(String(link.id)); links.push(link); });
              if (batch.length < 200) { break; }
            }
            row._invoiceAllocationComplete = ns.prepaymentAllocations.summarize(row, links).complete;
          }
          var payload = ns.operationUndoFields(module, row, false);
          delete payload.Vendor_Payment; payload[fields.payment] = null;
          operations.push({ module: module, id: String(row.id), fields: payload, requestId: module === "Prepayments" && row.Prepayment_Request && row.Prepayment_Request.id });
        }
        if (rows.length < 200) { break; }
      }
    }
    return operations;
  };
  ns.applyPaymentOperationUndo = async function (crm, operations, assertSuccess) {
    var requests = new Set();
    for (var op of operations) {
      assertSuccess(await crm.updateRecord(op.module, op.id, op.fields), "Could not reset " + op.module + " " + op.id);
      if (op.module === "Prepayments" && ns.resetPrepaymentCheckpoint) { ns.resetPrepaymentCheckpoint(op.id); }
      if (op.requestId) { requests.add(String(op.requestId)); }
    }
    for (var requestId of requests) { await ns.syncPrepaymentRequest(crm, requestId); }
  };
  ns.createPaymentOperationSync = function (crm, assertSuccess) {
    function id(value) { return String(value && value.id || ""); }
    async function searchAll(module, criteria) {
      var result = [], seen = new Set(), page = 1;
      while (true) {
        var records = await crm.searchRecordPage(module, criteria, page, 200);
        if (!Array.isArray(records)) { throw new Error("Could not read linked " + module + "."); }
        records.forEach(function (record) {
          if (!id(record) || seen.has(id(record))) { throw new Error("Incomplete search results for " + module + "."); }
          seen.add(id(record)); result.push(record);
        });
        if (records.length < 200) { return result; }
        page += 1;
      }
    }
    async function prepaymentFields() {
      var response = await crm.getFields("Prepayments"), fields = response && response.fields || [];
      function lookup(module, preferred) {
        var field = fields.find(function (f) { return f.api_name === preferred && f.data_type === "lookup"; }) || fields.find(function (f) { return f.lookup && f.lookup.module && f.lookup.module.api_name === module; });
        if (!field) { throw new Error("Prepayments needs a lookup to " + module + "."); }
        return field.api_name;
      }
      return { payment: lookup("Supplier_Payments", "Vendor_Payment") };
    }
    return async function sync(paymentId, payment, entries) {
      var errors = [], updated = 0, requests = new Set();
      if (["Paid", "Reconciled"].indexOf(payment.Status) === -1) { return { errors: errors, updated: updated }; }
      async function syncModule(module, fields) {
        for (var entry of entries) {
          if (module === "Prepayments" && entry.isCreditNote) { continue; }
          try {
            var records = await searchAll(module, "(" + fields.invoice + ":equals:" + entry.invoiceId + ")");
            var available = Number(entry.allocatedAmount);
            records.forEach(function (record) {
              if (id(record[fields.payment]) === String(paymentId)) { available -= Number(record.Amount || 0); }
            });
            records.sort(function (a, b) { return String(a.Due_Date || a.Transaction_Date || "").localeCompare(String(b.Due_Date || b.Transaction_Date || "")) || id(a).localeCompare(id(b)); });
            for (var record of records) {
              if (id(record[fields.payment]) === String(paymentId)) { if (module === "Prepayments" && id(record.Prepayment_Request)) { requests.add(id(record.Prepayment_Request)); } continue; }
              if (id(record[fields.payment]) || ["Cancelled", "Prepayment recorded", "Purchase recorded", "Refund recorded", "Discard - Credit", "Discard - Already Paid"].indexOf(record.Accounting_Status) !== -1) { continue; }
              if (id(record[fields.invoice]) !== String(entry.invoiceId)) { continue; }
              if (module === "Card_Purchases" && (record.Transaction_Type === "Refund") !== Boolean(entry.isCreditNote)) { continue; }
              var invoiceCurrency = entry.invoiceRecord && entry.invoiceRecord.Currency || payment.Currency || "EUR";
              if ((record.Currency || "EUR") !== invoiceCurrency) { continue; }
              var amount = Number(record.Amount);
              if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(available) || amount > available + 0.005) { continue; }
              var data = { Accounting_Status: module === "Prepayments" ? "Prepayment recorded" : entry.isCreditNote ? "Refund recorded" : "Purchase recorded" };
              data[fields.payment] = { id: String(paymentId) };
              if (module === "Prepayments") { data.Payment_Date = payment.Payment_Date; }
              else { data.Accounting_Processed_At = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"); }
              // Reserve the amount even when CRM's update response is uncertain.
              available = Math.round((available - amount) * 100) / 100;
              try {
                assertSuccess(await crm.updateRecord(module, id(record), data), "CRM did not confirm the linked operation update.");
                updated += 1;
                if (module === "Prepayments" && id(record.Prepayment_Request)) { requests.add(id(record.Prepayment_Request)); }
              } catch (error) { errors.push(module + " " + (record.Name || id(record)) + ": " + error.message); }
            }
          } catch (error) { errors.push(module + " / invoice " + entry.invoiceId + ": " + error.message); }
        }
      }
      try {
        var fields = await prepaymentFields(), candidates = new Map(), budgets = {}, linksByPrepayment = new Map();
        for (var entry of entries) {
          if (entry.isCreditNote) { continue; }
          if (!Number.isFinite(Number(entry.allocatedAmount)) || Number(entry.allocatedAmount) <= 0 || (entry.invoiceRecord && entry.invoiceRecord.Currency || payment.Currency || "EUR") !== (payment.Currency || "EUR")) { continue; }
          var invoiceId = String(entry.invoiceId);
          budgets[invoiceId] = Math.round((Number(budgets[invoiceId] || 0) + Number(entry.allocatedAmount)) * 100) / 100;
          for (var link of await searchAll(ns.prepaymentAllocations.module, "(Vendor_Invoice:equals:" + invoiceId + ")")) {
            if (id(link.Vendor_Invoice) !== invoiceId || !id(link.Prepayment)) { throw new Error("Invalid prepayment invoice association."); }
            if (!candidates.has(id(link.Prepayment))) {
              var candidate = await crm.getRecord("Prepayments", id(link.Prepayment));
              if (!candidate || id(candidate) !== id(link.Prepayment)) { throw new Error("Could not read linked prepayment."); }
              candidates.set(id(candidate), candidate);
            }
          }
        }
        for (var record of candidates.values()) {
          var summary = ns.prepaymentAllocations.summarize(record, await searchAll(ns.prepaymentAllocations.module, "(Prepayment:equals:" + id(record) + ")"));
          linksByPrepayment.set(id(record), summary);
          if (id(record[fields.payment]) === String(paymentId)) {
            summary.rows.forEach(function (row) { var key = id(row.Vendor_Invoice); budgets[key] = Number(budgets[key] || 0) - Number(row.Allocated_Amount); });
            if (id(record.Prepayment_Request)) { requests.add(id(record.Prepayment_Request)); }
          }
        }
        var ordered = Array.from(candidates.values()).sort(function (a, b) { return String(a.Due_Date || "").localeCompare(String(b.Due_Date || "")) || id(a).localeCompare(id(b)); });
        for (var record of ordered) {
          if (id(record[fields.payment]) || ["Cancelled", "Prepayment recorded", "Discard - Credit", "Discard - Already Paid"].indexOf(record.Accounting_Status) !== -1) { continue; }
          var summary = linksByPrepayment.get(id(record));
          if (!summary.complete || (record.Currency || "EUR") !== (payment.Currency || "EUR") || !summary.rows.every(function (row) { return Number.isFinite(budgets[id(row.Vendor_Invoice)]) && budgets[id(row.Vendor_Invoice)] + 0.005 >= Number(row.Allocated_Amount); })) { continue; }
          var data = { Accounting_Status: "Prepayment recorded", Payment_Date: payment.Payment_Date }; data[fields.payment] = { id: String(paymentId) };
          summary.rows.forEach(function (row) { budgets[id(row.Vendor_Invoice)] -= Number(row.Allocated_Amount); });
          try {
            assertSuccess(await crm.updateRecord("Prepayments", id(record), data), "CRM did not confirm the linked prepayment update.");
            updated += 1; if (id(record.Prepayment_Request)) { requests.add(id(record.Prepayment_Request)); }
          } catch (error) { errors.push("Prepayments " + id(record) + ": " + error.message); }
        }
      }
      catch (error) { errors.push("Prepayments: " + error.message); }
      await syncModule("Card_Purchases", { invoice: "Vendor_Invoice", payment: "Vendor_Payment" });
      for (var requestId of requests) {
        try { await ns.syncPrepaymentRequest(crm, requestId); }
        catch (error) { errors.push("Prepayment request " + requestId + ": " + error.message); }
      }
      return { errors: errors, updated: updated };
    };
  };
}(window));
