(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  ns.collectPaymentAllocationExport = async function (fetchPage, progress) {
    var rows = [], seen = new Set(), page = 1;
    while (true) {
      var result = await fetchPage({ page: page, perPage: 100 });
      result.records.forEach(function (row) {
        if (!row.id || seen.has(String(row.id))) { throw new Error("CRM returned repeated or unidentified allocations. Export cancelled; refresh and retry."); }
        seen.add(String(row.id)); rows.push(row);
      });
      if (progress) { progress(rows.length); }
      if (!result.hasMore) { return rows; }
      if (!result.records.length || page >= 999) { throw new Error("Could not retrieve the complete export. Narrow the filters and retry."); }
      page += 1;
    }
  };
  ns.paymentAllocationExportSheet = function (records) {
    function label(value) { return value && (value.name || value.Name || value.id) || ""; }
    return { name: "Payment allocations",
      headers: ["Allocation ID", "Allocation", "Payment", "Invoice", "Supplier", "Booking", "MFSP", "Settlement", "Amount", "Currency", "Allocation date", "Payment date", "Payment status", "Movement type"],
      rows: records.map(function (row) {
        var amount = row.Allocated_Amount;
        if (amount != null && amount !== "" && !Number.isFinite(Number(amount))) { throw new Error("Invalid amount in allocation " + row.id + "."); }
        return [String(row.id), row.Name || "", label(row.Supplier_Payment), label(row.Supplier_Invoice),
          row.Supplier_Name || label(row.Supplier), label(row.Booking), row.MFSP_Reference || "", label(row.Supplier_Settlement),
          amount == null || amount === "" ? "" : { value: ns.helpers.getExportSignedAmount(amount, row), format: "money" }, row.Currency || "",
          row.Allocation_Date || "", row.Payment_Date || "", row.Payment_Status || "", row.Movement_Type || ""];
      })
    };
  };
  ns.bindPaymentAllocationExports = function (deps) {
    ["payment-allocations-export", "selected-payment-allocations-export"].forEach(function (id) {
      var button = document.getElementById(id);
      button.addEventListener("click", async function () {
        if (button.disabled) { return; }
        var paymentId = id === "selected-payment-allocations-export" ? deps.state.views.payments.selectedId : "";
        if (id === "selected-payment-allocations-export" && !paymentId) { return; }
        var filters = JSON.parse(JSON.stringify(deps.state.views.paymentAllocations.appliedFilters || deps.state.views.paymentAllocations.filters || {}));
        var status = document.getElementById(id + "-status");
        button.disabled = true; status.textContent = "Loading all matching allocations…";
        try {
          var records = await ns.collectPaymentAllocationExport(function (query) { return deps.fetchPage(paymentId, filters, query); },
            function (count) { status.textContent = count + " allocations loaded…"; });
          if (!records.length) { status.textContent = "No allocations match this export."; return; }
          var blob = ns.createExcelWorkbook([ns.paymentAllocationExportSheet(records)]);
          var url = URL.createObjectURL(blob), link = document.createElement("a");
          link.href = url; link.download = "Payment-allocations" + (paymentId ? "-" + paymentId : "") + ".xlsx";
          document.body.appendChild(link); link.click(); link.remove();
          global.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          status.textContent = records.length + " allocations exported.";
        } catch (error) { status.textContent = "Export failed. " + (error.message || "Please retry."); }
        finally { button.disabled = false; }
      });
    });
  };
}(window));
