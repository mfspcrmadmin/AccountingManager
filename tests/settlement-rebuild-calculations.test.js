const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('crm/rebuildSupplierSettlementTotals.dg', 'utf8').replace(/\r\n/g, '\n');
const record = data => ({ get: key => data[key] });
// Execute the actual arithmetic expressions from Deluge, adapting numeric casts only.
function arithmetic(code, context) {
  vm.runInNewContext(code.replace(/\.toDecimal\(\)|\.toLong\(\)/g, ''), context);
}
function calculate({ gross = 1000, payable = gross, paid, share = payable, split = true, credit = false }) {
  const ctx = {
    ifnull: (value, fallback) => value == null ? fallback : value,
    invoiceRecord: record({ Invoice_Total: gross, Total_Payable_Amount: payable, Amount_Paid: paid, Invoice_Type: credit ? 'Credit Note' : 'Final Invoice' }),
    allocationRecord: record({ Allocated_Amount: paid }),
    settlementAmountsByInvoiceId: record({ invoice: share }), invoiceId: 'invoice', hasActiveSplits: split,
    creditNoteAmountFromInvoices: 0, grossInvoiceAmountFromInvoices: 0, totalInvoiceFromInvoices: 0, totalPaidFromInvoices: 0, totalPaidFromAllocations: 0
  };
  arithmetic(source.match(/fullInvoiceTotal = [^\n]+/)[0], ctx);
  ctx.invoiceTotal = ctx.fullInvoiceTotal;
  const splitStart = source.indexOf('if(hasActiveSplits)\n');
  assert.ok(splitStart >= 0, 'Could not locate split allocation arithmetic');
  arithmetic(source.slice(splitStart, source.indexOf('// Read allocations by invoice')), ctx);
  arithmetic(source.slice(source.indexOf('allocationPaid = ifnull'), source.indexOf('allocationCount = allocationCount + 1;')), ctx);
  return ctx;
}
test('invoice Status alone excludes cancelled and rejected invoices, regardless of obsolete accounting fields', () => {
  const guard = source.match(/if\(ifnull\(invoiceRecord.get\("Status"\)[^\n]+\n\s*\{\s*continue;\s*\}/)[0];
  const ctx = { ifnull: (value, fallback) => value == null ? fallback : value, included: [], records: [
    record({ id: 'cancelled', Status: 'Cancelled', Accounting_Status: 'Pending' }),
    record({ id: 'rejected', Status: 'Rejected' }),
    record({ id: 'received', Status: 'Received', Accounting_Status: 'Cancelled' }),
    record({ id: 'paid', Status: 'Paid' })
  ] };
  vm.runInNewContext('for (const invoiceRecord of records) { ' + guard + ' included.push(invoiceRecord.get("id")); }', ctx);
  assert.deepEqual(ctx.included, ['received', 'paid']);
});

test('a fully paid 846.20 invoice produces 846.20 invoiced and paid on its settlement', () => {
  const result = calculate({ gross: 846.20, paid: 846.20 });
  assert.equal(result.totalInvoiceFromInvoices, 846.20);
  assert.equal(result.totalPaidFromAllocations, 846.20);
});
test('IRPF payable amount is the denominator when distributing paid amounts', () => {
  const result = calculate({ gross: 1000, payable: 850, paid: 850 });
  assert.equal(result.totalInvoiceFromInvoices, 850);
  assert.equal(result.totalPaidFromAllocations, 850);
  assert.equal(result.totalPaidFromInvoices, 850);
});
test('partial payments are distributed across settlements without counting the payment twice', () => {
  const first = calculate({ paid: 846.20, share: 400 });
  const second = calculate({ paid: 846.20, share: 600 });
  assert.ok(Math.abs(first.totalPaidFromAllocations - 338.48) < 0.00001);
  assert.ok(Math.abs(first.totalPaidFromAllocations + second.totalPaidFromAllocations - 846.20) < 0.00001);
});
test('credit note refunds reduce both invoiced and paid totals', () => {
  const result = calculate({ gross: 200, paid: 200, credit: true });
  assert.equal(result.totalInvoiceFromInvoices, -200);
  assert.equal(result.totalPaidFromAllocations, -200);
});
test('the Deluge rebuild uses COQL and counts only paid or reconciled payment allocations', () => {
  assert.doesNotMatch(source, /zoho\.crm\.searchRecords/);
  assert.match(source, /paidPayment.get\("Status"\) == "Paid" \|\| paidPayment.get\("Status"\) == "Reconciled"/);
});

test('totals exclude only incomplete registrations and retain legacy invoices', () => {
  const guard = source.match(/if\(ifnull\(invoiceRecord.get\("Registration_Key"\)[^\n]+continue; \}/)[0];
  const ctx = { ifnull: (value, fallback) => value == null ? fallback : value, included: [], records: [
    record({ id: 'partial', Registration_Key: 'key', Registration_Status: 'Pending' }),
    record({ id: 'ready', Registration_Key: 'key2', Registration_Status: 'Ready' }),
    record({ id: 'complete', Registration_Key: 'key3', Registration_Status: 'Complete' }),
    record({ id: 'legacy' })
  ] };
  vm.runInNewContext('for (const invoiceRecord of records) { ' + guard + ' included.push(invoiceRecord.get("id")); }', ctx);
  assert.deepEqual(ctx.included, ['ready', 'complete', 'legacy']);
});
