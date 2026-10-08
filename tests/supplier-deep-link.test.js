const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('app/scripts/helpers.js', 'utf8'), { window });
const helpers = window.AccountingManagerApp.helpers;
const target = { supplierId: '616617000003010705', view: 'supplier', supplierInfoTab: 'financial' };

test('supplier email URL decodes to the financial detail target', () => {
  const source = fs.readFileSync('_local/crm/crm_functions/requestSupplierAccountingAccountEmail.js', 'utf8');
  const parts = source.match(/supplierCrmUrl = "([^"]+)" \+ supplier.get\("id"\).toString\(\) \+ "([^"]+)"/);
  assert.ok(parts);
  const url = new URL(parts[1] + target.supplierId + parts[2]);
  assert.equal(url.pathname, '/crm/org20093299576/tab/WebTab3');
  assert.deepEqual(JSON.parse(url.searchParams.get('widgetparams')), target);
});

test('PageLoad accepts direct, nested, JSON and encoded widget parameters', () => {
  for (const payload of [target, { data: target }, { Message: target }, { widgetparams: target },
    { widgetparams: JSON.stringify(target) }, { data: { widgetparams: encodeURIComponent(JSON.stringify(target)) } }]) {
    const parsed = helpers.getClientPayload(payload);
    assert.equal(helpers.getSupplierIdFromPayload(parsed), target.supplierId);
    assert.equal(parsed.supplierInfoTab, 'financial');
  }
  assert.equal(helpers.getClientPayload({ widgetparams: '%broken' }), null);
  assert.equal(helpers.getClientPayload(null), null);
});

function startup(payload) {
  const source = fs.readFileSync('app/scripts/main.js', 'utf8');
  const block = source.slice(source.indexOf('  var zohoPageLoadReceived = false;'), source.indexOf('  async function bootstrap()'));
  const calls = [];
  const state = { clientPayload: payload, selectedIds: [], views: { invoices: {} } };
  const context = { state, helpers,
    setCurrentTab: async tab => { calls.push(tab); state.currentTab = tab; },
    loadSupplierWorkspace: async id => { calls.push(id); state.supplier = { id }; },
    setSupplierInfoTab: tab => { calls.push(tab); state.supplierInfoTab = tab; },
    refreshInvoicesTabData: async () => calls.push('invoices') };
  vm.createContext(context);
  vm.runInContext(block, context);
  return { context, calls, state };
}

test('supplier link waits for both SDK and PageLoad, loads once and keeps Suppliers selected', async () => {
  for (const first of ['zohoSdkInitialized', 'zohoPageLoadReceived']) {
    const f = startup(target);
    vm.runInContext(first + ' = true;', f.context);
    await f.context.loadInitialOpenInvoices();
    assert.deepEqual(f.calls, []);
    vm.runInContext('zohoSdkInitialized = zohoPageLoadReceived = true;', f.context);
    await f.context.loadInitialOpenInvoices();
    await f.context.loadInitialOpenInvoices();
    assert.deepEqual(f.calls, ['suppliers', target.supplierId, 'financial']);
    assert.equal(f.state.currentTab, 'suppliers');
  }
});

test('ordinary startup still opens invoices', async () => {
  const f = startup(null);
  vm.runInContext('zohoSdkInitialized = zohoPageLoadReceived = true;', f.context);
  await f.context.loadInitialOpenInvoices();
  assert.deepEqual(f.calls, ['invoices']);
});
