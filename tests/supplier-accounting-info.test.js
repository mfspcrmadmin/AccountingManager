const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture(execute) {
  const window = {};
  vm.runInNewContext(fs.readFileSync('app/scripts/supplier-accounting-info.js', 'utf8'), { window });
  return { info: window.AccountingManagerApp.supplierAccountingInfo, zoho: { CRM: { FUNCTIONS: { execute } } } };
}
test('requests existing CRM function once with supplier ID only, and renders the confirmed message', async () => {
  const calls = [];
  const f = fixture(async (name, args) => { calls.push({ name, args: JSON.parse(args.arguments) }); return { details: { output: JSON.stringify({ success: true, error: false, message: 'Request sent' }) } }; });
  await Promise.all([f.info.request(f.zoho, '123'), f.info.request(f.zoho, '123')]);
  assert.deepEqual(calls, [{ name: 'email_requestsupplieraccountingaccountemail', args: { supplierId: '123' } }]);
  assert.match(f.info.requestHtml('123'), /disabled/);
  assert.match(f.info.requestHtml('123'), /Request sent/);
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
  for (const output of [null, 'not json', { success: false, error: true, message: 'Denied' }]) {
    let calls = 0;
    const f = fixture(async () => { calls++; return { details: { output } }; });
    const result = await f.info.request(f.zoho, '123');
    assert.match(result, /Check email delivery/);
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
