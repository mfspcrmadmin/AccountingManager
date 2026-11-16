(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var report = null;
  ns.startPaymentDiagnostics = function (filters) {
    report = { version: "payments-diagnostics-20261020-2", started: new Date().toISOString(), filters: JSON.parse(JSON.stringify(filters)), queries: [] };
  };
  ns.tracePaymentQuery = function (query) {
    if (!report || !/Supplier_Payments|Supplier_Pay_Allocations/.test(query)) { return null; }
    var entry = { query: query, started: new Date().toISOString(), status: "pending" };
    report.queries.push(entry);
    if (report.queries.length > 120) { report.queries.shift(); }
    return entry;
  };
  ns.finishPaymentQuery = function (entry, rows, error) {
    if (!entry) { return; }
    entry.finished = new Date().toISOString();
    entry.status = error ? "error" : "success";
    if (!error) { entry.count = rows.length; return; }
    entry.error = {};
    ["name", "message", "code", "status", "statusText", "details", "responseText"].forEach(function (key) {
      if (error[key] !== undefined) { entry.error[key] = String(typeof error[key] === "object" ? JSON.stringify(error[key]) : error[key]).slice(0, 4000); }
    });
    if (!Object.keys(entry.error).length) { entry.error.value = String(error).slice(0, 4000); }
  };
  ns.paymentDiagnosticsText = function () { return JSON.stringify(report || { message: "Run a payment search first." }, null, 2); };
  ns.failPaymentDiagnostics = function (error) {
    if (!report) { return; }
    var entry = {};
    ns.finishPaymentQuery(entry, [], error);
    report.failure = entry;
  };
  ns.showPaymentDiagnostics = function () {
    var dialog = document.createElement("dialog");
    dialog.style.cssText = "width:min(850px,90vw);max-height:85vh;padding:20px";
    dialog.innerHTML = '<h3>Payment search diagnostic</h3><p>Includes filters, queries and CRM errors. No payment rows or credentials are collected. Copy this text and send it to support.</p><textarea readonly aria-label="Payment search diagnostic" style="width:100%;height:45vh"></textarea><button type="button" class="button primary">Copy diagnostic</button> <button type="button" class="button secondary">Close</button><p role="status"></p>';
    dialog.querySelector("textarea").value = ns.paymentDiagnosticsText();
    var buttons = dialog.querySelectorAll("button");
    buttons[0].onclick = async function () {
      var text = dialog.querySelector("textarea");
      try { await global.navigator.clipboard.writeText(text.value); dialog.querySelector('[role="status"]').textContent = "Copied."; }
      catch (_) { text.focus(); text.select(); dialog.querySelector('[role="status"]').textContent = "Press Ctrl+C to copy the selected diagnostic."; }
    };
    buttons[1].onclick = function () { dialog.close(); };
    dialog.addEventListener("close", function () { dialog.remove(); });
    document.body.appendChild(dialog); dialog.showModal();
  };
}(window));
