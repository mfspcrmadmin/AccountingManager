(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  function id(value) { return String(value && value.id || ""); }
  function cents(value) { return Math.round(Number(value) * 100); }
  function summarize(payment, rows) {
    var seen = new Set(), total = 0, expected = cents(payment.Amount);
    if (!Number.isFinite(expected) || expected <= 0) { throw new Error("The prepayment needs a positive amount."); }
    rows.forEach(function (row) {
      var invoiceId = id(row.Vendor_Invoice), amount = cents(row.Allocated_Amount);
      if (!id(row) || id(row.Prepayment) !== id(payment) || !invoiceId || seen.has(invoiceId) || !Number.isFinite(amount) || amount <= 0 || row.Currency !== (payment.Currency || "EUR")) {
        throw new Error("Invalid or duplicate prepayment invoice allocation. Review its invoice, amount and currency in CRM.");
      }
      seen.add(invoiceId); total += amount;
    });
    if (total > expected) { throw new Error("Invoice allocations exceed the prepayment amount."); }
    return { rows: rows, allocated: total / 100, remaining: (expected - total) / 100, complete: total === expected };
  }
  function covered(summary, paymentAllocations, paymentId) {
    return summary.complete && summary.rows.every(function (row) {
      var matching = paymentAllocations.filter(function (a) { return id(a.Supplier_Payment) === String(paymentId) && id(a.Supplier_Invoice) === id(row.Vendor_Invoice) && a.Status !== "Cancelled" && a.Status !== "Void"; });
      return matching.length && matching.every(function (a) { return Number(a.Allocated_Amount) > 0; }) &&
        matching.reduce(function (total, a) { return total + cents(a.Allocated_Amount); }, 0) >= cents(row.Allocated_Amount);
    });
  }
  ns.prepaymentAllocations = { module: "Prepayment_Invoice_Allocations", summarize: summarize, covered: covered };
}(window));
