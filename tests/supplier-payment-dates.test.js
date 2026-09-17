const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const main = fs.readFileSync('app/scripts/main.js', 'utf8');
const start = main.indexOf('  async function loadInvoicesForSupplier(');
const end = main.indexOf('  async function loadSupplierInvoiceRecords(', start);

function setup(invoices, load) {
  const context = {
    loadSupplierInvoiceRecords: async () => invoices,
    loadRecordsByCoql: load,
    MODULES: { payAllocations: 'Supplier_Pay_Allocations' },
    escapeCoqlValue: value => String(value).replace(/'/g, "\\'"),
    helpers: { getLookupId: lookup => lookup && lookup.id || '' },
    debugError: () => {}
  };
  vm.createContext(context);
  vm.runInContext(main.slice(start, end), context);
  return context;
}

test('supplier invoice payment dates group partial payments, deduplicate and ignore cancellations', async () => {
  const invoices = [{ id: 'i1' }, { id: 'i2' }];
  const context = setup(invoices, async (module, fields, options) => {
    assert.equal(module, 'Supplier_Pay_Allocations');
    assert.equal(options.whereClause, "Supplier_Invoice in ('i1', 'i2')");
    return [
      { Supplier_Invoice: { id: 'i1' }, Payment_Date: '2026-09-10', Payment_Status: 'Paid' },
      { Supplier_Invoice: { id: 'i1' }, Payment_Date: '2026-09-01', Payment_Status: 'Reconciled' },
      { Supplier_Invoice: { id: 'i1' }, Payment_Date: '2026-09-10', Payment_Status: 'Paid' },
      { Supplier_Invoice: { id: 'i2' }, Payment_Date: '2026-09-05', Payment_Status: 'Cancelled' },
      { Supplier_Invoice: { id: 'i2' }, Payment_Date: null }
    ];
  });
  const result = await context.loadInvoicesForSupplier('s1');
  assert.equal(result[0]._supplierPaymentDates.join(','), '2026-09-01,2026-09-10');
  assert.equal(result[1]._supplierPaymentDates.length, 0);
});

test('allocation failures preserve invoices and mark dates unavailable instead of unpaid', async () => {
  const invoices = [{ id: 'i1', _supplierPaymentDates: ['2025-01-01'] }];
  const context = setup(invoices, async () => { throw new Error('CRM unavailable'); });
  const result = await context.loadInvoicesForSupplier('s1');
  assert.equal(result, invoices);
  assert.equal(result[0]._supplierPaymentDates, null);
});

test('allocation queries batch invoice IDs and skip empty supplier tables', async () => {
  const invoices = Array.from({ length: 81 }, (_, index) => ({ id: String(index) }));
  const queries = [];
  const context = setup(invoices, async (module, fields, options) => {
    queries.push(options.whereClause);
    return [];
  });
  await context.loadInvoicesForSupplier('s1');
  assert.equal(queries.length, 3);
  assert.equal(queries[2], "Supplier_Invoice in ('80')");
  context.loadSupplierInvoiceRecords = async () => [];
  await context.loadInvoicesForSupplier('s2');
  assert.equal(queries.length, 3);
});
