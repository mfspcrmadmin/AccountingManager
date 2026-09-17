const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('app/scripts/quick-settlement-refresh.js', 'utf8'), { window });
vm.runInNewContext(fs.readFileSync('app/scripts/prepayments.js', 'utf8'), { window });
const refresh = window.AccountingManagerApp.refreshQuickInvoiceSettlements;
function fixture() {
  const calls = [];
  const zoho = { CRM: { API: {
    async getRecord() { return { data: [{ id: 'i1', Supplier_Settlement: { id: 's1' } }] }; },
    async searchRecord() { return { data: [
      { id: 'a1', Vendor_Settlement: { id: 's1' }, Status: 'Active' },
      { id: 'a2', Vendor_Settlement: { id: 's2' }, Status: 'Active' },
      { id: 'a3', Vendor_Settlement: { id: 'void' }, Status: 'Void' }
    ] }; }
  }, FUNCTIONS: { async execute(name, args) { calls.push({ name, args: JSON.parse(args.arguments) }); return { details: { output: JSON.stringify({ error: false, updated_count: 2, warning_count: 0, details: [] }) } }; } } } };
  return { zoho, calls };
}
test('rebuilds the primary and all active allocated settlements once', async () => {
  const f = fixture();
  assert.equal(await refresh(f.zoho, 'i1'), '');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'rebuildsuppliersettlementtotals');
  assert.equal(f.calls[0].args.settlementIdsString, 's1|||s2');
});
test('partial rebuilds, errors and malformed responses return a saved-record warning', async () => {
  for (const output of [null, { error: true, message: 'Permission denied' }, { error: false, updated_count: 1 }, { error: false, updated_count: 2, warning_count: 1 }]) {
    const f = fixture();
    f.zoho.CRM.FUNCTIONS.execute = async () => ({ details: { output: JSON.stringify(output) } });
    assert.match(await refresh(f.zoho, 'i1'), /record was saved, but settlement totals/);
  }
});

test('an already correct settlement is a successful rebuild even with zero updates', async () => {
  const f = fixture();
  f.zoho.CRM.FUNCTIONS.execute = async () => ({ details: { output: JSON.stringify({ error: false, processed_count: 2, updated_count: 0, warning_count: 0 }) } });
  assert.equal(await refresh(f.zoho, 'i1'), '');
});

test('COQL discovers newly created split allocations without waiting for Search indexing', async () => {
  const f = fixture();
  const queries = [];
  f.zoho.CRM.API.coql = async ({ select_query }) => { queries.push(select_query); return { data: [{ id: 'new', Status: 'Active', Vendor_Settlement: { id: 's2' } }] }; };
  f.zoho.CRM.API.searchRecord = async () => { throw Error('Search must not be used'); };
  assert.equal(await refresh(f.zoho, 'i1'), '');
  assert.match(queries[0], /from Inv_Set_Allocations where Vendor_Invoice/);
  assert.equal(f.calls[0].args.settlementIdsString, 's1|||s2');
});
test('failed allocation reads do not silently rebuild only the primary settlement', async () => {
  const f = fixture();
  f.zoho.CRM.API.searchRecord = async () => { throw new Error('Read failed'); };
  assert.match(await refresh(f.zoho, 'i1'), /Read failed/);
  assert.equal(f.calls.length, 0);
});
test('all allocation pages are included before rebuilding', async () => {
  const f = fixture();
  f.zoho.CRM.API.searchRecord = async ({ page }) => page === 1 ? { data: [{ id: 'a1', Vendor_Settlement: { id: 's1' }, Status: 'Active' }], info: { more_records: true } } : { data: [{ id: 'a2', Vendor_Settlement: { id: 's2' }, Status: 'Active' }] };
  assert.equal(await refresh(f.zoho, 'i1'), '');
  assert.equal(f.calls[0].args.settlementIdsString, 's1|||s2');
});

test('Card Purchase recalculates after creation and before linking the payment to the purchase', async () => {
  const source = fs.readFileSync('app/scripts/operations.js', 'utf8');
  const calls = [];
  const purchase = { id: 'c1', Supplier: { id: 'supplier' }, Settlement: { id: 'settlement' }, Card_Payment_Account: { id: 'card' }, Transaction_Type: 'Purchase' };
  const context = {
    activePurchase: purchase, MODULES: { invoices: 'Supplier_Invoices', invoiceSettlements: 'Inv_Set_Allocations' }, CREATE_PAYMENT_FUNCTION: 'createPayment',
    lookupId: value => value && value.id || '', lookupName: () => '',
    workflowReference: { value: 'INV1' }, workflowDate: { value: '2026-09-16' }, workflowAmount: { value: '1320' }, workflowVat: { value: '0' }, workflowInvoiceType: { value: 'Tickets' }, workflowNotes: { value: '' },
    workflowPaymentAccount: { value: 'own-bank' }, workflowPaymentReference: { value: 'PAY1' }, workflowPaymentDate: { value: '2026-09-16' },
    api: () => ({ getRecord: async () => ({ data: [{ id: 'own-bank', Owner_Type: 'Own', Status: 'Active' }] }) }),
    responseRecords: response => response.data,
    create: async (module, data) => { calls.push(module); return { details: { id: module === 'Supplier_Invoices' ? 'i1' : 'allocation' } }; },
    updatePurchase: async data => { calls.push('updatePurchase'); Object.assign(purchase, data); },
    global: { ZOHO: { CRM: { FUNCTIONS: { execute: async (name, args) => {
      const payload = JSON.parse(JSON.parse(args.arguments).paymentDataString);
      assert.equal(payload.Payment_Account, 'own-bank');
      assert.deepEqual(payload.Payment_Accounts_By_Supplier, {});
      return { details: { output: { payment_id: 'pay1', error: false } } };
    } } } }, AccountingManagerApp: {
      isOwnQuickPaymentAccount: window.AccountingManagerApp.isOwnQuickPaymentAccount,
      refreshQuickInvoiceSettlements: async (zoho, invoiceId) => { assert.equal(invoiceId, 'i1'); assert.equal(purchase.Vendor_Invoice.id, 'i1'); calls.push('rebuild'); return ''; }
    } }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  async function createInvoice()'), source.indexOf('  async function submit(event)')), context);
  await context.createInvoice();
  assert.equal(calls.at(-1), 'rebuild');
  assert.equal(purchase.Accounting_Status, 'Pending payment record');
  await context.createPayment();
  assert.ok(calls.lastIndexOf('rebuild') < calls.lastIndexOf('updatePurchase'));
  assert.equal(calls.filter(c => c === 'rebuild').length, 2);
  assert.equal(purchase.Accounting_Status, 'Purchase recorded');
  assert.equal(purchase.Vendor_Payment.id, 'pay1');
  context.updatePurchase = async () => { throw Error('Purchase link failed'); };
  await assert.rejects(context.createPayment(), /Purchase link failed/);
  assert.equal(calls.filter(c => c === 'rebuild').length, 3);
});
