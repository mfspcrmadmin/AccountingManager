(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
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
      return { invoice: lookup("Supplier_Invoices", "Vendor_Invoice"), payment: lookup("Supplier_Payments", "Vendor_Payment") };
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
      try { await syncModule("Prepayments", await prepaymentFields()); }
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
