const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
for (const file of ['config.js', 'invoice-delete.js', 'crm.js']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + file, 'utf8'), { window });
}
const ns = window.AccountingManagerApp, M = ns.MODULES;
const lookup = id => ({ id });
const helpers = {
  getLookupId: v => v && typeof v === 'object' ? v.id : v,
  escapeCriteriaValue: v => String(v),
  extractRecords: v => Array.isArray(v) ? v : v?.data || []
};
function setup(extra = {}) {
  const data = {
    [M.invoices]: [{ id: 'i1', Name: 'Invoice', Invoice_Total: 100, Amount_Paid: 100, Status: 'Paid', Supplier_Settlement: lookup('s1') }],
    [M.settlements]: [{ id: 's1', Total_Invoice: 100, Total_Paid: 100, Total_Service_Cost: 100, Service_Count: 1, Admin_Status: 'Paid' }],
    [M.payments]: [{ id: 'p1', Name: 'Payment', Payment_Amount: 100, Status: 'Paid' }],
    [M.payAllocations]: [{ id: 'a1', Supplier_Invoice: lookup('i1'), Supplier_Payment: lookup('p1'), Supplier_Settlement: lookup('s1'), Allocated_Amount: 100 }],
    [M.invoiceLines]: [{ id: 'l1', Supplier_Invoice: lookup('i1') }],
    [M.invoiceSettlementAllocations]: [{ id: 'split1', Vendor_Invoice: lookup('i1'), Vendor_Settlement: lookup('s1'), Allocated_Amount: 100, Status: 'Active' }],
    [M.accountingEntries]: [{ id: 'e1', Supplier_Invoice: lookup('i1') }, { id: 'e2', Name: 'INV-Invoice-SUP-PAY-p1' }],
    [M.accountingEntryLines]: [{ id: 'el1', Accounting_Entry: lookup('e1'), Supplier_Invoice: lookup('i1') }, { id: 'el2', Accounting_Entry: lookup('e2'), Supplier_Invoice: lookup('i1') }],
    Card_Purchases: [{ id: 'card1', Vendor_Invoice: lookup('i1'), Vendor_Payment: lookup('p1'), Invoice_Number: 'INV1', Accounting_Status: 'Purchase recorded', Accounting_Processed_At: '2026-01-01' }],
    ...extra
  };
  const writes = [], reads = [], saved = new Map();
  const storage = { getItem: k => saved.get(k) || null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) };
  let fail;
  const crm = {
    async getRecord(module, id) { return structuredClone((data[module] || []).find(r => r.id === id)); },
    async getAllRecords(module, page, size) { return structuredClone((data[module] || []).slice((page - 1) * size, page * size)); },
    async searchRecordPage(module, criteria, page, size) {
      reads.push([module, page]);
      const [, field, value] = criteria.match(/^\((.*?):equals:(.*)\)$/);
      return structuredClone((data[module] || []).filter(r => String(helpers.getLookupId(r[field]) || '') === value).slice((page - 1) * size, page * size));
    },
    async deleteRecord(module, id) {
      if (fail?.(module, id, 'delete')) { return { code: 'ERROR', message: 'simulated rejection' }; }
      const index = (data[module] || []).findIndex(r => r.id === id);
      if (index === -1) { return { code: 'INVALID_DATA', message: 'record already deleted' }; }
      data[module].splice(index, 1); writes.push(['delete', module, id]);
      return { data: [{ code: 'SUCCESS' }] };
    },
    async updateRecord(module, id, fields, options) {
      if (fail?.(module, id, 'update')) { return { code: 'ERROR', message: 'simulated rejection' }; }
      assert.equal(options.trigger.length, 0);
      const schema = JSON.parse(fs.readFileSync('_local/crm/modules/modules_fields/' + module + '_fields')).fields;
      for (const [key, value] of Object.entries(fields)) {
        const field = schema.find(f => f.api_name === key);
        assert.ok(field, `Unknown field ${module}.${key}`);
        assert.notEqual(field.data_type, 'formula');
        if (field.data_type === 'picklist' && value != null) {
          assert.ok(field.pick_list_values.some(v => v.actual_value === value), `Invalid ${module}.${key}: ${value}`);
        }
      }
      const target = data[module].find(r => r.id === id); assert.ok(target);
      Object.assign(target, fields); writes.push(['update', module, id]);
      return { data: [{ code: 'SUCCESS' }] };
    }
  };
  const create = () => ns.createInvoiceDeletionModule({ crm, modules: M, helpers, storage });
  return { data, writes, reads, saved, crm, create, service: create(), setFail: f => { fail = f; } };
}

test('removes dependent records, resets card purchase and final settlement, deletes invoice last', async () => {
  const f = setup(); await f.service.execute('i1');
  for (const m of [M.invoices, M.invoiceLines, M.payments, M.payAllocations, M.invoiceSettlementAllocations, M.accountingEntries, M.accountingEntryLines]) {
    assert.equal(f.data[m].length, 0, m);
  }
  assert.equal(f.data[M.settlements][0].Total_Invoice, 0);
  assert.equal(f.data[M.settlements][0].Total_Paid, 0);
  assert.equal(f.data[M.settlements][0].Admin_Status, 'Pending Invoice');
  assert.equal(f.data.Card_Purchases[0].Vendor_Invoice, null);
  assert.equal(f.data.Card_Purchases[0].Vendor_Payment, null);
  assert.equal(f.data.Card_Purchases[0].Accounting_Status, 'Pending invoice');
  assert.equal(f.data.Card_Purchases[0].Accounting_Processed_At, null);
  assert.deepEqual(f.writes.at(-1), ['delete', M.invoices, 'i1']);
  assert.equal(f.saved.size, 0);
});

test('shared payment survives with remaining amount, counts and pending accounting', async () => {
  const f = setup();
  f.data[M.invoices].push({ id: 'i2', Invoice_Total: 80, Amount_Paid: 0, Status: 'Received', Supplier: lookup('v1'), Booking: lookup('b1'), Supplier_Settlement: lookup('s1') });
  f.data[M.payAllocations].push({ id: 'a2', Supplier_Invoice: lookup('i2'), Supplier_Payment: lookup('p1'), Supplier_Settlement: lookup('s1'), Allocated_Amount: 40 });
  await f.service.execute('i1');
  const p = f.data[M.payments][0];
  assert.equal(p.Payment_Amount, 40); assert.equal(p.Allocation_Count, 1); assert.equal(p.Supplier_Count, 1);
  assert.equal(p.Accounting_Status, 'Pending'); assert.equal(p.Status, 'Paid');
  assert.equal(f.data[M.invoices][0].Amount_Paid, 40); assert.equal(f.data[M.invoices][0].Status, 'Partially Paid');
  assert.equal(f.data[M.settlements][0].Total_Invoice, 80); assert.equal(f.data[M.settlements][0].Total_Paid, 40);
  assert.equal(f.data.Card_Purchases[0].Vendor_Payment.id, 'p1');
});

test('recalculates every settlement including invoice splits without double counting', async () => {
  const f = setup();
  f.data[M.settlements].push({ id: 's2', Service_Count: 1, Total_Service_Cost: 50, Admin_Status: 'Paid' });
  f.data[M.invoiceSettlementAllocations].push({ id: 'split2', Vendor_Invoice: lookup('i1'), Vendor_Settlement: lookup('s2'), Allocated_Amount: 50, Status: 'Active' });
  f.data[M.invoices].push({ id: 'i2', Invoice_Total: 200, Supplier_Settlement: lookup('s1') });
  f.data[M.invoiceSettlementAllocations].push({ id: 'split3', Vendor_Invoice: lookup('i2'), Vendor_Settlement: lookup('s1'), Allocated_Amount: 120, Status: 'Active' }, { id: 'split4', Vendor_Invoice: lookup('i2'), Vendor_Settlement: lookup('s2'), Allocated_Amount: 80, Status: 'Active' });
  await f.service.execute('i1');
  assert.equal(f.data[M.settlements][0].Total_Invoice, 120);
  assert.equal(f.data[M.settlements][1].Total_Invoice, 80);
});

test('credit note and refund amounts use negative signs and refund card status resets', async () => {
  const f = setup(); f.data.Card_Purchases[0].Transaction_Type = 'Refund';
  f.data[M.invoices].push({ id: 'credit', Invoice_Total: 20, Invoice_Type: 'Credit Note', Supplier_Settlement: lookup('s1'), Original_Invoice: lookup('i1') });
  f.data[M.payAllocations].push({ id: 'refund', Supplier_Invoice: lookup('credit'), Supplier_Settlement: lookup('s1'), Allocated_Amount: 20 });
  await f.service.execute('i1');
  assert.equal(f.data[M.invoices][0].Original_Invoice, null);
  assert.equal(f.data[M.settlements][0].Credit_Note_Amount, 20);
  assert.equal(f.data[M.settlements][0].Total_Invoice, -20);
  assert.equal(f.data[M.settlements][0].Total_Paid, -20);
  assert.equal(f.data.Card_Purchases[0].Accounting_Status, 'Pending credit note');
});

for (const [module, field, value] of [[M.invoices, 'Accounting_Status', 'Posted to Books'], [M.payments, 'Accounting_Status', 'Sent to Books'], [M.accountingEntries, 'Books_Post_Status', 'Posted']]) {
  test(`preflight blocks ${module}.${field}=${value} before any write`, async () => {
    const f = setup(); f.data[module][0][field] = value;
    await assert.rejects(f.service.execute('i1'), /Reverse/); assert.equal(f.writes.length, 0);
  });
}

test('failed reads cannot turn into empty relation lists', async () => {
  const f = setup(); f.crm.searchRecordPage = async () => { throw new Error('No permission'); };
  await assert.rejects(f.service.execute('i1'), /No permission/); assert.equal(f.writes.length, 0);
});

test('rejected settlement update keeps invoice and resumes after recreating the module', async () => {
  const f = setup(); f.setFail(m => m === M.settlements);
  await assert.rejects(f.service.execute('i1'), /Deletion incomplete/);
  assert.equal(f.data[M.invoices].length, 1); assert.equal(f.saved.size, 1);
  const confirmedDeletes = f.writes.filter(w => w[0] === 'delete').length;
  f.setFail(null); await f.create().execute('i1');
  assert.equal(f.data[M.invoices].length, 0); assert.equal(f.saved.size, 0);
  assert.equal(f.writes.filter(w => w[0] === 'delete').length, confirmedDeletes + 2); // payment and invoice
});

test('loads and deletes more than one page of invoice lines', async () => {
  const f = setup({ [M.invoiceLines]: Array.from({ length: 205 }, (_, n) => ({ id: 'line' + n, Supplier_Invoice: lookup('i1') })) });
  await f.service.execute('i1'); assert.equal(f.data[M.invoiceLines].length, 0);
  assert.ok(f.reads.some(([module, page]) => module === M.invoiceLines && page === 2));
});

test('settlement states use valid schema values for empty, unpaid and cancelled settlements', () => {
  const f = setup(); const status = f.service.statusForSettlement;
  assert.equal(status({ Service_Count: 0, Total_Service_Cost: 0 }, 0, 0), 'No Services');
  assert.equal(status({ Service_Count: 1 }, 0, 0), 'Pending Invoice');
  assert.equal(status({ Total_Service_Cost: 100 }, 50, 0), 'Partially Accounted');
  assert.equal(status({ Total_Service_Cost: 100 }, 100, 0), 'Accounted');
  assert.equal(status({ Admin_Status: 'Cancelled' }, 0, 0), 'Cancelled');
});

test('CRM client rejects error objects and accepts explicit no-content responses', async () => {
  let result = { code: 'NO_PERMISSION', message: 'Not allowed' };
  const client = ns.createCrmClient({ CRM: { API: { searchRecord: async () => result, getAllRecords: async () => result } } }, helpers);
  await assert.rejects(client.searchRecordPage('X', '(id:equals:1)', 1, 200), /Not allowed/);
  await assert.rejects(client.getAllRecords('X', 1, 200), /Not allowed/);
  result = { status: 204 };
  assert.equal((await client.searchRecordPage('X', '(id:equals:1)', 1, 200)).length, 0);
});

test('invoice without payments or settlement still deletes its related lines', async () => {
  const f = setup({ [M.payments]: [], [M.payAllocations]: [], [M.invoiceSettlementAllocations]: [], [M.accountingEntries]: [], [M.accountingEntryLines]: [], Card_Purchases: [] });
  f.data[M.invoices][0].Supplier_Settlement = null;
  await f.service.execute('i1'); assert.equal(f.data[M.invoiceLines].length, 0); assert.equal(f.data[M.invoices].length, 0);
});

test('unlinks surviving credit note lines instead of deleting them', async () => {
  const f = setup();
  f.data[M.invoices].push({ id: 'credit', Invoice_Type: 'Credit Note', Invoice_Total: 10, Original_Invoice: lookup('i1') });
  f.data[M.invoiceLines].push({ id: 'cl1', Supplier_Invoice: lookup('credit'), Original_Invoice_Line: lookup('l1') });
  await f.service.execute('i1');
  assert.equal(f.data[M.invoiceLines].length, 1); assert.equal(f.data[M.invoiceLines][0].Original_Invoice_Line, null);
});

test('empty mutation responses are rejected and never delete the parent', async () => {
  const f = setup(); f.crm.updateRecord = async () => ({});
  await assert.rejects(f.service.execute('i1'), /did not confirm/); assert.equal(f.data[M.invoices].length, 1);
});

test('repeated pagination stops before performing mutations', async () => {
  const f = setup(); f.crm.searchRecordPage = async () => Array.from({ length: 200 }, (_, n) => ({ id: String(n) }));
  await assert.rejects(f.service.execute('i1'), /repeated CRM page/); assert.equal(f.writes.length, 0);
});

test('a resumed deletion checks accounting locks again', async () => {
  const f = setup(); f.setFail(m => m === M.settlements);
  await assert.rejects(f.service.execute('i1'), /Deletion incomplete/);
  const count = f.writes.length; f.data[M.invoices][0].Accounting_Status = 'Posted to Books'; f.setFail(null);
  await assert.rejects(f.create().execute('i1'), /Reverse/); assert.equal(f.writes.length, count);
});

test('Deluge rebuild uses only valid settlement picklist states and checks update responses', () => {
  const text = fs.readFileSync('_local/crm/crm_functions/rebuildSupplierSettlementTotals', 'utf8');
  const schema = JSON.parse(fs.readFileSync('_local/crm/modules/modules_fields/Supplier_Settlements_fields')).fields;
  const values = schema.find(f => f.api_name === 'Admin_Status').pick_list_values.map(v => v.actual_value);
  for (const match of text.matchAll(/nextStatus = "([^"]+)"/g)) { assert.ok(values.includes(match[1]), match[1]); }
  assert.match(text, /updateResult == null \|\| !updateResult.containKey\("id"\)/);
  assert.match(text, /updateMap.put\("Total_Paid",totalPaidFromAllocations\)/);
});
