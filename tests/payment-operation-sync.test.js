const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const file of ['prepayment-allocations.js','payment-operation-sync.js']) vm.runInNewContext(fs.readFileSync('app/scripts/'+file, 'utf8'), { window });
function setup() {
  const db = { Prepayments: [], Card_Purchases: [] }, writes = [], searches = [];
  const fields = [{ api_name: 'Vendor_Invoice', data_type: 'lookup' }, { api_name: 'Vendor_Payment', data_type: 'lookup' }];
  const crm = {
    async getRecord(module, id) { return db[module].find(row => row.id === id); },
    async getFields() { return { fields }; },
    async searchRecordPage(module, query, page, size) {
      searches.push({ module, query, page });
      const [, field, invoice] = query.match(/\((\w+):equals:(\w+)\)/);
      const rows = module === 'Prepayment_Invoice_Allocations' ? (db.Prepayment_Invoice_Allocations || db.Prepayments.map(p => ({id:'link-'+p.id, Prepayment:{id:p.id}, Vendor_Invoice:p.Vendor_Invoice, Allocated_Amount:p.Amount, Currency:p.Currency}))) : db[module];
      return rows.filter(r => r[field]?.id === invoice).slice((page - 1) * size, page * size);
    },
    async updateRecord(module, recordId, data) {
      writes.push({ module, recordId, data });
      Object.assign(db[module].find(r => r.id === recordId), data);
      return { data: [{ code: 'SUCCESS' }] };
    }
  };
  const sync = window.AccountingManagerApp.createPaymentOperationSync(crm, response => { if (response.data[0].code !== 'SUCCESS') throw new Error('Update rejected'); });
  const entry = { invoiceId: 'i1', allocatedAmount: 1320, invoiceRecord: { Currency: 'EUR' }, isCreditNote: false };
  const payment = { Status: 'Paid', Payment_Date: '2026-09-16' };
  const record = (id, more = {}) => ({ id, Vendor_Invoice: { id: 'i1' }, Amount: 1320, Currency: 'EUR', Accounting_Status: 'Pending payment record', ...more });
  return { db, writes, searches, crm, fields, sync, entry, payment, record };
}

test('multi-invoice prepayments synchronize only when every invoice is covered', async () => {
  const f = setup();
  f.db.Prepayments.push(f.record('p1',{Amount:300}));
  f.db.Prepayment_Invoice_Allocations = [
    {id:'l1',Prepayment:{id:'p1'},Vendor_Invoice:{id:'i1'},Allocated_Amount:100,Currency:'EUR'},
    {id:'l2',Prepayment:{id:'p1'},Vendor_Invoice:{id:'i2'},Allocated_Amount:200,Currency:'EUR'}
  ];
  await f.sync('pay1',f.payment,[{...f.entry,allocatedAmount:300}]);
  assert.equal(f.writes.length,0);
  await f.sync('pay1',f.payment,[{...f.entry,allocatedAmount:100},{...f.entry,invoiceId:'i2',allocatedAmount:200}]);
  assert.equal(f.writes.length,1);
  await f.sync('pay1',f.payment,[{...f.entry,allocatedAmount:100},{...f.entry,invoiceId:'i2',allocatedAmount:200}]);
  assert.equal(f.writes.length,1);
});

test('a confirmed payment marks linked prepayments and card purchases recorded and saves its lookup', async () => {
  const f = setup();
  f.db.Prepayments.push(f.record('p1'));
  f.db.Card_Purchases.push(f.record('c1', { Transaction_Type: 'Purchase' }));
  const result = await f.sync('pay1', f.payment, [f.entry]);
  assert.equal(result.updated, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(f.db.Prepayments[0].Accounting_Status, 'Prepayment recorded');
  assert.equal(f.db.Prepayments[0].Payment_Date, '2026-09-16');
  assert.equal(f.db.Card_Purchases[0].Accounting_Status, 'Purchase recorded');
  for (const write of f.writes) assert.equal(write.data.Vendor_Payment.id, 'pay1');
  assert.match(f.db.Card_Purchases[0].Accounting_Processed_At, /\+00:00$/);
});

test('draft payments, cancelled operations and already linked records are untouched', async () => {
  const f = setup();
  f.db.Prepayments.push(f.record('cancelled', { Accounting_Status: 'Cancelled' }), f.record('linked', { Vendor_Payment: { id: 'other' } }), f.record('done', { Accounting_Status: 'Prepayment recorded' }));
  await f.sync('pay1', { ...f.payment, Status: 'Draft' }, [f.entry]);
  assert.equal(f.searches.length, 0);
  await f.sync('pay1', f.payment, [f.entry]);
  assert.equal(f.writes.length, 0);
});

test('partial allocations only cover their amount and retries reserve previously linked amounts', async () => {
  const f = setup();
  f.entry.allocatedAmount = 600;
  f.db.Prepayments.push(f.record('a', { Amount: 400 }), f.record('z', { Amount: 300, Vendor_Payment: { id: 'pay1' }, Accounting_Status: 'Prepayment recorded' }));
  await f.sync('pay1', f.payment, [f.entry]);
  assert.equal(f.writes.length, 0);
  f.db.Prepayments[0].Amount = 300;
  await f.sync('pay1', f.payment, [f.entry]);
  assert.equal(f.writes.length, 1);
  await f.sync('pay1', f.payment, [f.entry]);
  assert.equal(f.writes.length, 1);
});

test('one partial invoice payment cannot record multiple prepayments beyond its allocated amount', async () => {
  const f = setup();
  f.entry.allocatedAmount = 300;
  f.db.Prepayments.push(f.record('a', { Amount: 300 }), f.record('b', { Amount: 300 }));
  await f.sync('pay1', f.payment, [f.entry]);
  assert.equal(f.writes.length, 1);
  assert.equal(f.db.Prepayments[1].Accounting_Status, 'Pending payment record');
});

test('refund allocations update refund card requests and do not mark prepayments paid', async () => {
  const f = setup();
  f.entry.isCreditNote = true;
  f.db.Prepayments.push(f.record('p1'));
  f.db.Card_Purchases.push(f.record('c1', { Transaction_Type: 'Refund' }), f.record('c2', { Transaction_Type: 'Purchase' }));
  await f.sync('pay1', f.payment, [f.entry]);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].data.Accounting_Status, 'Refund recorded');
});

test('prepayment lookup metadata and search pagination are respected', async () => {
  const f = setup();
  f.fields.splice(0, 2, { api_name: 'Invoice_Link', lookup: { module: { api_name: 'Supplier_Invoices' } } }, { api_name: 'Payment_Link', lookup: { module: { api_name: 'Supplier_Payments' } } });
  for (let i = 0; i < 201; i++) f.db.Prepayments.push(f.record(String(i), { Invoice_Link: { id: 'i1' }, Amount: 1 }));
  const result = await f.sync('pay1', f.payment, [f.entry]);
  assert.equal(result.updated, 201);
  assert.equal(f.searches.filter(s => s.module === 'Prepayment_Invoice_Allocations' && s.query === '(Vendor_Invoice:equals:i1)').length, 2);
  assert.equal(f.db.Prepayments[200].Payment_Link.id, 'pay1');
});

test('update failures are reported separately and other operations still update', async () => {
  const f = setup(), update = f.crm.updateRecord;
  f.db.Prepayments.push(f.record('p1'));
  f.db.Card_Purchases.push(f.record('c1'));
  f.crm.updateRecord = async (module, ...args) => module === 'Prepayments' ? { data: [{ code: 'NO_PERMISSION' }] } : update(module, ...args);
  const result = await f.sync('pay1', f.payment, [f.entry]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.updated, 1);
  assert.equal(f.db.Prepayments[0].Accounting_Status, 'Pending payment record');
});

test('only supplied successful invoice allocations and matching currencies are synchronized', async () => {
  const f = setup();
  f.db.Prepayments.push(f.record('p1', { Vendor_Invoice: { id: 'failedInvoice' } }), f.record('p2', { Currency: 'USD' }));
  await f.sync('pay1', f.payment, [f.entry]);
  assert.equal(f.writes.length, 0);
});

test('payments do not overwrite either discard status', async () => {
  const f = setup();
  for (const status of ['Discard - Credit', 'Discard - Already Paid']) f.db.Prepayments.push(f.record(status, { Accounting_Status: status }));
  await f.sync('pay1', f.payment, [f.entry]);
  assert.equal(f.writes.length, 0);
});

test('invoice payment synchronizes requests after linking and retries already-linked request updates', async () => {
  const f = setup(), seen = [];
  f.db.Prepayments.push(f.record('p1', {Prepayment_Request:{id:'123'}}));
  window.AccountingManagerApp.syncPrepaymentRequest = async (crm, requestId) => {
    assert.equal(f.db.Prepayments[0].Accounting_Status, 'Prepayment recorded');
    seen.push(requestId);
  };
  try {
    await f.sync('pay1', f.payment, [f.entry]);
    await f.sync('pay1', f.payment, [f.entry]);
    assert.deepEqual(seen, ['123','123']);
  } finally { delete window.AccountingManagerApp.syncPrepaymentRequest; }
});


test('payment undo resets purchases, refunds and prepayments and retries request synchronization', async () => {
  const f = setup(), ns = window.AccountingManagerApp;
  f.db.Prepayments.push(f.record('pre1', { Vendor_Payment: { id: 'pay1' }, Prepayment_Request: { id: 'req1' }, Accounting_Status: 'Prepayment recorded', Payment_Date: '2026-09-22' }));
  f.db.Card_Purchases.push(f.record('card1', { Vendor_Payment: { id: 'pay1' }, Accounting_Status: 'Purchase recorded' }), f.record('refund1', { Vendor_Payment: { id: 'pay1' }, Transaction_Type: 'Refund', Accounting_Status: 'Refund recorded' }));
  let attempts = 0;
  ns.syncPrepaymentRequest = async () => { if (++attempts === 1) throw new Error('sync failed'); };
  const ops = await ns.preparePaymentOperationUndo(f.crm, 'pay1');
  const success = response => assert.equal(response.data[0].code, 'SUCCESS');
  await assert.rejects(ns.applyPaymentOperationUndo(f.crm, ops, success), /sync failed/);
  await ns.applyPaymentOperationUndo(f.crm, ops, success);
  assert.equal(attempts, 2);
  assert.equal(f.db.Prepayments[0].Accounting_Status, 'Pending payment record');
  assert.equal(f.db.Prepayments[0].Payment_Date, null);
  assert.equal(f.db.Card_Purchases[0].Accounting_Status, 'Pending payment record');
  assert.equal(f.db.Card_Purchases[1].Accounting_Status, 'Pending refund record');
  for (const r of [...f.db.Prepayments, ...f.db.Card_Purchases]) {
    assert.equal(r.Vendor_Payment, null);
    assert.equal(r.Vendor_Invoice.id, 'i1');
  }
});

test('undo preserves deliberate cancellation and discard states and handles missing invoices', () => {
  const ns = window.AccountingManagerApp;
  for (const status of ['Cancelled', 'Discard - Credit', 'Discard - Already Paid']) {
    assert.equal(ns.operationUndoFields('Prepayments', { Accounting_Status: status }, true).Accounting_Status, undefined);
  }
  assert.equal(ns.operationUndoFields('Prepayments', {}, false).Accounting_Status, 'Pending invoice');
  assert.equal(ns.operationUndoFields('Card_Purchases', { Transaction_Type: 'Refund' }, true).Accounting_Status, 'Pending credit note');
});
