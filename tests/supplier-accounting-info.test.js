const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('account editing writes only the selected vendor accounting field and preserves leading zeros', async () => {
  const f = fixture(), calls = [];
  const zoho = { CRM: { API: { updateRecord: async payload => { calls.push(payload); return { data: [{ code: 'SUCCESS' }] }; } } } };
  assert.equal(await f.info.saveAccount(zoho, '123', ' 004001 '), '004001');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { Entity: 'Vendors', APIData: { id: '123', Cuenta_Contable: '004001' }, Trigger: [] });
  await f.info.saveAccount(zoho, '123', '');
  assert.equal(calls[1].APIData.Cuenta_Contable, null);
  await assert.rejects(f.info.saveAccount(zoho, 'bad', '42'), /valid supplier/);
  await assert.rejects(f.info.saveAccount(zoho, '123', '1'.repeat(256)), /255/);
  assert.equal(calls.length, 2);
});
test('account editor escapes values and reports failed CRM writes', async () => {
  const f = fixture();
  assert.match(f.info.editorHtml('123', '0042'), /value="0042"/);
  assert.doesNotMatch(f.info.editorHtml('123', '<script>'), /<script>/);
  await assert.rejects(f.info.saveAccount({ CRM: { API: { updateRecord: async () => ({ data: [{ code: 'NO_PERMISSION', message: 'Denied' }] }) } } }, '123', '42'), /Denied/);
});
function fixture(execute) {
  const popups = [];
  const window = { AccountingManagerApp: { showErrorPopup: (message, title) => popups.push({ message, title }) } };
  vm.runInNewContext(fs.readFileSync('app/scripts/supplier-accounting-info.js', 'utf8'), { window });
  return { popups, info: window.AccountingManagerApp.supplierAccountingInfo, zoho: { CRM: { FUNCTIONS: { execute } } } };
}
test('requests existing CRM function once with supplier ID only, and renders the confirmed message', async () => {
  const calls = [];
  const f = fixture(async (name, args) => { calls.push({ name, args: JSON.parse(args.arguments) }); return { details: { output: JSON.stringify({ success: true, error: false, message: 'Request sent' }) } }; });
  await Promise.all([f.info.request(f.zoho, '123'), f.info.request(f.zoho, '123')]);
  assert.deepEqual(calls, [{ name: 'email_requestsupplieraccountingaccountemail', args: { supplierId: '123' } }]);
  assert.match(f.info.requestHtml('123'), /disabled/);
  assert.match(f.info.requestHtml('123'), /Request sent/);
  assert.equal(f.popups.length, 0);
});

test('both accounting account request entry points match the CRM function declaration', () => {
  const declaration = fs.readFileSync('_local/crm/crm_functions/requestSupplierAccountingAccountEmail.js', 'utf8');
  const apiName = declaration.match(/standalone\.(\w+)\(/)[1].toLowerCase();
  const info = fs.readFileSync('app/scripts/supplier-accounting-info.js', 'utf8');
  const main = fs.readFileSync('app/scripts/main.js', 'utf8');
  assert.equal(info.match(/FUNCTIONS\.execute\("([^"]+)"/)[1], apiName);
  assert.equal(main.match(/REQUEST_SUPPLIER_ACCOUNTING_ACCOUNT_EMAIL_FUNCTION = "([^"]+)"/)[1], apiName);
});
test('unconfirmed requests are not reported as successful or retried', async () => {
  for (const output of [null, 'not json', { success: false, error: true, message: 'Denied' }, { success: true, sent: false, message: 'Supplier already has an account' }]) {
    let calls = 0;
    const f = fixture(async () => { calls++; return { details: { output } }; });
    const result = await f.info.request(f.zoho, '123');
    assert.match(result, /Check email delivery/);
    assert.equal(f.popups.length, 1);
    assert.equal(f.popups[0].message, result);
    await f.info.request(f.zoho, '123');
    assert.equal(calls, 1);
  }
});
test('supplier controls escape IDs and do not request on rendering', () => {
  const f = fixture(() => { throw Error('Unexpected send'); });
  assert.equal(f.info.infoHtml(''), '');
  assert.match(f.info.infoHtml('123'), /data-supplier-account-info="123"/);
  assert.doesNotMatch(f.info.requestHtml('<bad>'), /<bad>/);
});

 test('connection errors display an error popup with the reason', async () => {
  const f = fixture(async () => { throw new Error('Network unavailable'); });
  await f.info.request(f.zoho, '123');
  assert.equal(f.popups.length, 1);
  assert.match(f.popups[0].message, /Network unavailable/);
});

test('invoice request shows a popup for every unconfirmed response and transport failure', async () => {
  const source = fs.readFileSync('app/scripts/main.js', 'utf8');
  const handler = source.slice(source.indexOf('  async function onInvoiceCreateRequestAccountingAccountClick()'), source.indexOf('  function summarizePaymentAccountForDebug'));
  for (const output of [{}, { success: false, message: 'Denied' }, { success: true, sent: false, message: 'Already assigned' }, null, { success: true }]) {
    const popups = [], notices = [];
    const context = {
      state: { supplierId: '123', supplier: {} },
      getSupplierResolvedAccountingAccount: () => ({ hasValue: false }),
      renderer: { withFeedbackTarget() { return this; }, showError() {}, showNotice: (message) => notices.push(message), showErrorPopup: (message) => popups.push(message) },
      setInvoiceCreateLoading() {}, renderAll() {}, debugError() {},
      REQUEST_SUPPLIER_ACCOUNTING_ACCOUNT_EMAIL_FUNCTION: 'test',
      crm: { executeFunction: async () => { if (output === null) throw new Error('Network unavailable'); return output; } },
      getFunctionOutputObject: (response) => response,
      getFunctionResponseResult: () => ({ success: true })
    };
    vm.runInNewContext(handler, context);
    await context.onInvoiceCreateRequestAccountingAccountClick();
    assert.equal(popups.length, output && output.success === true && output.sent !== false ? 0 : 1);
    if (popups.length) assert.match(popups[0], /could not be sent or confirmed/);
    else assert.ok(notices.some(message => /successfully/.test(message)));
  }
});
