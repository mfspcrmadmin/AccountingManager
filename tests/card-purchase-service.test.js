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
  const source = fs.readFileSync('app/scripts/operations.js', 'utf8').replace('  controls();', '  global.openWorkflowForTest = openWorkflow; global.closeWorkflowForTest = closeWorkflow; controls();');
  vm.runInNewContext(source, { window, document, Intl });
  return {
    open: purchase => window.openWorkflowForTest(Object.assign({ Amount: 10, Transaction_Type: 'Purchase' }, purchase), 'invoice'),
    close: () => window.closeWorkflowForTest(),
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
  assert.match(app.element.innerHTML, /Total purchase price<\/dt><dd>—/);
});
