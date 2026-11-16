const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(getRecord) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        innerHTML: '', classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
        addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, setAttribute() {}
      });
      return elements.get(id);
    },
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {}
  };
  const window = { ZOHO: { CRM: { API: { getRecord } } }, addEventListener() {}, requestAnimationFrame(fn) { fn(); }, setTimeout() {} };
  // Exercise the existing workflow entry point without adding a production test API.
  const source = fs.readFileSync('app/scripts/operations.js', 'utf8').replace('  controls();', '  global.openWorkflowForTest = openWorkflow; global.closeWorkflowForTest = closeWorkflow; global.validateWorkflowForTest = validateWorkflowAction; controls();');
  vm.runInNewContext(fs.readFileSync('app/scripts/invoice-name.js', 'utf8'), { window });
  window.AccountingManagerApp.alhambraCard = { render() {} };
  vm.runInNewContext(source, { window, document, Intl });
  return {
    open: purchase => window.openWorkflowForTest(Object.assign({ Amount: 10, Transaction_Type: 'Purchase' }, purchase), 'invoice'),
    close: () => window.closeWorkflowForTest(),
    validate: action => window.validateWorkflowForTest(action),
    getElement: id => document.getElementById(id),
    element: document.getElementById('card-purchase-workflow-service')
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('invoice workflow loads the linked service, escapes description and preserves zero price', async () => {
  let requested;
  const app = setup(async request => {
    requested = request;
    return { data: [{ Product_Description: '<Hotel>\nSecond line', Service_Date: '2026-09-10', Purchase_Price: 50, Total_Purchase_Price: 0 }] };
  });
  app.open({ Boking_Service: { id: 'service-1' } });
  assert.match(app.element.innerHTML, /Loading service/);
  await flush();
  assert.equal(requested.Entity, 'Booking_Services');
  assert.equal(requested.RecordID, 'service-1');
  assert.match(app.element.innerHTML, /&lt;Hotel&gt;\nSecond line/);
  assert.match(app.element.innerHTML, /10\/09\/2026/);
  assert.match(app.element.innerHTML, /€0\.00/);
});

test('late responses cannot overwrite a newly opened purchase or a closed workflow', async () => {
  let resolve;
  const app = setup(() => new Promise(done => { resolve = done; }));
  app.open({ Boking_Service: { id: 'old' } });
  app.open({});
  resolve({ data: [{ Product_Description: 'Old service' }] });
  await flush();
  assert.match(app.element.innerHTML, /No associated service/);
  app.open({ Boking_Service: { id: 'closed' } });
  app.close();
  resolve({ data: [{ Product_Description: 'Closed service' }] });
  await flush();
  assert.doesNotMatch(app.element.innerHTML, /Closed service/);
});

test('unavailable services show a load error, while absent prices do not show zero', async () => {
  const missing = setup(async () => ({ data: [] }));
  missing.open({ Boking_Service: { id: 'missing' } });
  await flush();
  assert.match(missing.element.innerHTML, /could not be loaded/);
  const app = setup(async () => ({ data: [{ Product_Description: 'Service', Purchase_Price: 50, Total_Purchase_Price: null }] }));
  app.open({ Boking_Service: { id: 'service' } });
  await flush();
  assert.match(app.element.innerHTML, /Total purchase price<\/span><strong>—/);
});


test('Needs review offers explicit completion without invoice or payment creation', async () => {
 const app=setup(async()=>({data:[]}));
 app.open({id:'616617000173295053',Accounting_Status:'Needs review',Amount:44.54,Vendor_Invoice:{id:'616617000173895270',name:'TICK-MFOF2606124-ALHAMB-1'}});
 assert.equal(app.getElement('card-purchase-workflow-submit').textContent,'Review done');
 assert.equal(app.getElement('card-purchase-workflow-needs-review').hidden,true);
 assert.equal(app.getElement('card-purchase-workflow-invoice-fields').hidden,true);
 assert.equal(app.getElement('card-purchase-workflow-payment-fields').hidden,true);
 await flush();
});
test('Needs review always offers explicit completion regardless of links',async()=>{
 const app=setup(async()=>({data:[]}));
 app.open({id:'1',Accounting_Status:'Needs review'});
 assert.equal(app.getElement('card-purchase-workflow-submit').textContent,'Review done');
 app.open({id:'2',Accounting_Status:'Needs review',Vendor_Invoice:{id:'3'},Vendor_Payment:{id:'4'}});
 assert.equal(app.getElement('card-purchase-workflow-submit').textContent,'Review done');
 assert.equal(app.getElement('card-purchase-workflow-invoice-fields').hidden,true);
 assert.equal(app.getElement('card-purchase-workflow-payment-fields').hidden,true);
 await flush();
});
test('refund under review with a credit note offers review completion and resets review visibility for other records',async()=>{
 const app=setup(async()=>({data:[]}));
 app.open({id:'1',Accounting_Status:'Needs review',Transaction_Type:'Refund',Vendor_Invoice:{id:'3'}});
 assert.equal(app.getElement('card-purchase-workflow-submit').textContent,'Review done');
 app.open({id:'2',Accounting_Status:'Pending invoice'});
 assert.equal(app.getElement('card-purchase-workflow-needs-review').hidden,false);
 await flush();
});

test('saving a stale payment form detects newly linked payments and updates the available action',async()=>{
 const original={id:'1',Accounting_Status:'Needs review',Amount:10,Transaction_Type:'Purchase',Currency:'EUR',Vendor_Invoice:{id:'3'}};
 const app=setup(async request=>({data:request.Entity==='Card_Purchases'?[{...original,Vendor_Payment:{id:'4'}}]:[]}));
 app.open(original);
 await assert.rejects(app.validate('payment'),/transaction changed/);
 assert.equal(app.getElement('card-purchase-workflow-submit').textContent,'Review done');
 await flush();
});
test('payment action remains valid for an unchanged Needs review transaction',async()=>{
 const original={id:'1',Accounting_Status:'Needs review',Amount:10,Transaction_Type:'Purchase',Currency:'EUR',Vendor_Invoice:{id:'3'}};
 const app=setup(async request=>({data:request.Entity==='Card_Purchases'?[{...original}]:[]}));
 app.open(original);await app.validate('review-done');await flush();
});
