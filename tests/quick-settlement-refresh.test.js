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

test('Card Purchase UI delegates payment recovery and confirms an existing payment explicitly', async () => {
  const source=fs.readFileSync('app/scripts/operations.js','utf8');
  const purchase={id:'c1'},calls=[];
  const context={activePurchase:purchase,userEmail:async()=>'',workflowPaymentAccount:{value:'own'},workflowPaymentReference:{value:'PAY1'},workflowPaymentDate:{value:'2026-10-20'},workflowNotes:{value:'Checked'}};
  context.global={ZOHO:{},localStorage:{},crypto:{randomUUID:()=> 'key'},confirm:message=>{calls.push(message);return true;},AccountingManagerApp:{saveCardPayment:async(deps,id,input)=>{
    assert.equal(id,'c1');assert.equal(input.Payment_Account,'own');assert.equal(input.Name,'PAY1');
    assert.equal(await deps.confirmExisting({id:'p1',Name:'Saved payment',Payment_Amount:100,Currency:'EUR'},purchase),true);
    return{changes:{Vendor_Payment:{id:'p1'},Accounting_Status:'Purchase recorded'}};
  }}};
  vm.runInNewContext(source.slice(source.indexOf('  async function createPayment()'),source.indexOf('  function reviewedCardStatus')),context);
  await context.createPayment();assert.equal(purchase.Vendor_Payment.id,'p1');assert.equal(purchase.Accounting_Status,'Purchase recorded');assert.match(calls[0],/Saved payment/);
});
