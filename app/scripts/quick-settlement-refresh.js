(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  // Return a warning after a successful creation; never invite creating the record again.
  ns.refreshQuickInvoiceSettlements = async function (zoho, invoiceId) {
    try {
      var api = zoho.CRM.API, response = await api.getRecord({ Entity: "Supplier_Invoices", RecordID: invoiceId });
      var invoice = response && response.data && response.data[0];
      if (!invoice || String(invoice.id) !== String(invoiceId)) { throw new Error("Could not read the invoice settlements."); }
      var ids = new Set(), seen = new Set(), page = 1;
      if (invoice.Supplier_Settlement && invoice.Supplier_Settlement.id) { ids.add(String(invoice.Supplier_Settlement.id)); }
      while (true) {
        try {
          response = api.coql ? await api.coql({ select_query: "select id, Status, Vendor_Settlement from Inv_Set_Allocations where Vendor_Invoice = '" + String(invoiceId).replace(/'/g, "''") + "' order by id asc limit " + ((page - 1) * 200) + ", 200" }) :
            await api.searchRecord({ Entity: "Inv_Set_Allocations", Type: "criteria", Query: "(Vendor_Invoice:equals:" + invoiceId + ")", page: page, per_page: 200 });
        }
        catch (error) { if (Number(error && error.status) === 204 || error && error.code === "NO_CONTENT") { break; } throw error; }
        if (response && (Number(response.status) === 204 || response.code === "NO_CONTENT")) { break; }
        if (!response || !Array.isArray(response.data)) { throw new Error("Could not read invoice settlement allocations."); }
        response.data.forEach(function (allocation) {
          if (seen.has(allocation.id)) { throw new Error("CRM returned repeated settlement allocations."); }
          seen.add(allocation.id);
          if (allocation.Status !== "Void" && allocation.Status !== "Cancelled" && allocation.Vendor_Settlement && allocation.Vendor_Settlement.id) { ids.add(String(allocation.Vendor_Settlement.id)); }
        });
        if (!(response.info && response.info.more_records)) { break; }
        if (!response.data.length) { throw new Error("CRM returned incomplete settlement allocations."); }
        page += 1;
      }
      if (!ids.size) { throw new Error("No settlement was found for the invoice."); }
      response = await zoho.CRM.FUNCTIONS.execute("rebuildsuppliersettlementtotals", { arguments: JSON.stringify({ settlementIdsString: Array.from(ids).join("|||") }) });
      var result = response && response.details && response.details.output;
      result = typeof result === "string" ? JSON.parse(result) : result;
      var processed = result && (result.processed_count == null ? result.updated_count : result.processed_count);
      if (!result || result.error !== false || Number(processed) !== ids.size || Number(result.warning_count || 0) > 0) {
        throw new Error(result && result.message || "CRM did not confirm all settlement updates.");
      }
      if (Array.isArray(result.details) && global.dispatchEvent && global.CustomEvent) {
        global.dispatchEvent(new global.CustomEvent("accounting-manager-settlements-rebuilt", { detail: result }));
      }
      return "";
    } catch (error) {
      return "The record was saved, but settlement totals could not be fully recalculated: " + error.message;
    }
  };
}(window));
