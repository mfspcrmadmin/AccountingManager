const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const window = {};
  vm.runInNewContext(fs.readFileSync('app/scripts/prepayment-bank-request.js', 'utf8'), { window });
  vm.runInNewContext(fs.readFileSync('app/scripts/prepayments.js', 'utf8'), { window, Intl });
  const calls = [];
  const f = { window, calls, output: { success: true, token: 'review', html: '<p>Draft</p>', subject: 'PREPAGOS' }, record: { id: '1', Bank_Payment_Requested: false } };
  f.zoho = { CRM: { FUNCTIONS: { execute: async (name, args) => {
    calls.push({ name, args: JSON.parse(args.arguments) });
    if (f.networkError) throw (f.networkError === true ? Error('timeout') : f.networkError);
    return { details: { output: JSON.stringify(f.output) } };
  } }, API: {
    updateRecord: async data => { calls.push(data); if (!f.ignoreWrite) Object.assign(f.record, data.APIData); return f.updateResult || { data: [{ code: 'SUCCESS' }] }; },
    getRecord: async () => ({ data: [f.record] })
  } } };
  f.service = window.AccountingManagerApp.createPrepaymentBankService(f.zoho);
  return f;
}
test('preparing is read-only and sending uses precisely the reviewed IDs and token', async () => {
  const f = fixture();
  await f.service.prepare(['1', '2']);
  assert.equal(f.calls[0].args.action, 'prepare');
  assert.equal(f.calls[0].args.prepaymentIds, '1|||2');
  f.output = { success: true, sent: true };
  await f.service.send(['1', '2'], ' a@example.com; b@example.com, a@example.com ', 'review', '', '<p>Draft</p>');
  assert.equal(f.calls[1].name, 'notif_sendprepaymentbankrequest');
  assert.deepEqual(f.calls[1].args, { action: 'send', prepaymentIds: '1|||2', recipientEmails: 'a@example.com,b@example.com', reviewToken: 'review', ccEmails: '', emailBody: '<p>Draft</p>' });
});
test('invalid selection, recipients and missing review cannot call CRM', async () => {
  const f = fixture();
  await assert.rejects(f.service.prepare([]), /Select/);
  await assert.rejects(f.service.prepare(['1)or(id:equals:2']), /Select/);
  await assert.rejects(f.service.prepare(Array.from({ length: 26 }, (_, i) => String(i))), /Select/);
  assert.throws(() => f.service.send(['1'], 'a@example.com\nBcc: b@example.com', 'review', '', '<p>Draft</p>'), /valid/);
  assert.throws(() => f.service.send(['1'], 'a@example.com', ''), /review/);
  assert.equal(f.calls.length, 0);
});
test('marked prepayments can be requested again and a partial flag failure still counts as sent', async () => {
  const f = fixture();
  f.record.Bank_Payment_Requested = true;
  f.output = { success: false, sent: true, failedIds: ['1'], message: 'Email sent; mark manually' };
  const result = await f.service.send(['1'], 'a@example.com', 'review', '', '<p>Draft</p>');
  assert.equal(result.sent, true);
  assert.deepEqual(Array.from(result.failedIds), ['1']);
  await f.service.send(['1'], 'a@example.com', 'review', '', '<p>Draft</p>');
  assert.equal(f.calls.length, 2);
});
test('unconfirmed sends and stale drafts are errors with no automatic retry or flag writes', async () => {
  const f = fixture();
  f.networkError = true;
  await assert.rejects(f.service.send(['1'], 'a@example.com', 'review', '', '<p>Draft</p>'), /Check email delivery/);
  assert.equal(f.calls.length, 1);
  f.networkError = false; f.output = { success: false, sent: false, message: 'Details changed' };
  await assert.rejects(f.service.send(['1'], 'a@example.com', 'review', '', '<p>Draft</p>'), /Details changed/);
  assert.equal(f.calls.length, 2);
  f.output = { success: true, sent: false };
  await assert.rejects(f.service.send(['1'], 'a@example.com', 'review', '', '<p>Draft</p>'), /did not confirm/);
});
test('manual mark and unmark update only the checkbox, without triggering email or workflows', async () => {
  const f = fixture();
  await f.service.setRequested('1', true);
  await f.service.setRequested('1', false);
  assert.equal(f.record.Bank_Payment_Requested, false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    { Entity: 'Prepayments', APIData: { id: '1', Bank_Payment_Requested: true }, Trigger: [] },
    { Entity: 'Prepayments', APIData: { id: '1', Bank_Payment_Requested: false }, Trigger: [] }
  ]);
});
test('unknown fields, ignored writes and permission failures are never shown as saved', async () => {
  const f = fixture(); f.ignoreWrite = true;
  await assert.rejects(f.service.setRequested('1', true), /did not confirm/);
  f.updateResult = { data: [{ code: 'NO_PERMISSION', message: 'Permission denied' }] };
  await assert.rejects(f.service.setRequested('1', true), /Permission denied/);
});
test('prepare preserves CRM errors and names the configured function', async () => {
  const f = fixture();
  f.networkError = { responseText: JSON.stringify({ code: 'INVALID_DATA', message: 'Function does not exist' }) };
  await assert.rejects(f.service.prepare(['1']), /notif_sendprepaymentbankrequest\. CRM: INVALID_DATA: Function does not exist/);
});
test('both table views put selection left of the eye and editable requested state on the right', () => {
  const f = fixture();
  const model = f.window.AccountingManagerApp.prepaymentsModel;
  for (const showRequest of [true, false]) {
    const html = model.paymentTable([{ payment: { id: '1', Name: 'Deposit', Accounting_Status: 'Prepayment recorded', Bank_Payment_Requested: true }, group: {} }], '2026-09-16', showRequest);
    assert.ok(html.indexOf('data-prepayment-select') < html.indexOf('data-prepayment-register'));
    assert.ok(html.indexOf('data-prepayment-register') < html.indexOf('data-prepayment-bank-requested'));
    assert.match(html, /data-prepayment-bank-requested value="1" checked/);
    const pending = model.paymentTable([{ payment: { id: '2', Accounting_Status: 'Pending invoice' }, group: {} }], '2026-09-16', showRequest);
    assert.match(pending, /data-prepayment-select/);
    assert.match(pending, /data-prepayment-bank-requested/);
  }
});

function uiFixture() {
  const f = fixture(), elements = new Map();
  function element() { return { disabled: false, value: '', checked: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, matches(selector) { return selector === this.selector; }, closest() { return null; } }; }
  f.el = key => { if (!elements.has(key)) elements.set(key, element()); return elements.get(key); };
  f.inputs = ['1', '2'].map(value => Object.assign(element(), { value, selector: '[data-prepayment-select]' }));
  const panel = element();
  panel.querySelector = selector => f.el(selector.match(/bank-([^\]]+)/)[1]);
  panel.querySelectorAll = selector => selector === '[data-prepayment-select]' ? f.inputs : [];
  f.el('dialog').showModal = () => { f.el('dialog').open = true; };
  f.el('dialog').close = () => { f.el('dialog').open = false; };
  f.reloads = 0; f.errors = [];
  f.actions = f.window.AccountingManagerApp.createPrepaymentBankActions(panel, f.zoho, async () => { f.reloads++; }, e => f.errors.push(e.message));
  f.change = input => panel.listeners.change({ target: input });
  f.render = () => f.actions.render(['1', '2', '3'].map(id => ({ id, Accounting_Status: 'Prepayment recorded' })));
  return f;
}
test('selection survives pagination and filters, clears explicitly and drops no longer eligible records', async () => {
  const f = uiFixture(); f.render();
  f.inputs.forEach(input => { input.checked = true; f.change(input); });
  assert.equal(f.el('count').textContent, '2 selected');
  const oldInputs = f.inputs;
  f.inputs = []; f.render();
  assert.equal(f.el('count').textContent, '2 selected');
  f.inputs = oldInputs; f.render();
  assert.equal(f.inputs[0].checked, true);
  f.actions.render([{ id: '2', Accounting_Status: 'Prepayment recorded' }]);
  assert.equal(f.inputs[0].checked, false);
  assert.equal(f.el('count').textContent, '1 selected');
  f.inputs.forEach(input => { input.checked = false; f.change(input); });
  assert.equal(f.el('open').disabled, true);
});
test('dialog closes after sending, clears selection and reports flag failures outside the popup', async () => {
  const f = uiFixture(); f.render(); f.inputs.forEach(input => { input.checked = true; f.change(input); });
  await f.el('open').listeners.click();
  assert.equal(f.el('preview').innerHTML, '<p>Draft</p>');
  assert.equal(f.el('recipients').value, 'claudia@madeforspainandportugal.com');
  assert.equal(f.el('cc').value, 'luciano@madeforspainandportugal.com, andersson@madeforspainandportugal.com');
  f.el('preview').innerHTML = '<p>Please process these payments tomorrow.</p>';
  f.el('recipients').value = 'a@example.com';
  f.output = { sent: true, success: true, failedIds: ['2'], message: 'Sent; mark 2 manually' };
  await f.el('form').listeners.submit({ preventDefault() {} });
  assert.equal(f.calls[1].args.emailBody, '<p>Please process these payments tomorrow.</p>');
  assert.equal(f.calls[1].args.ccEmails, 'luciano@madeforspainandportugal.com,andersson@madeforspainandportugal.com');
  assert.equal(f.reloads, 1);
  assert.equal(f.el('dialog').open, false);
  assert.deepEqual(f.errors, ['Sent; mark 2 manually']);
  assert.equal(f.el('message').textContent, 'Sent; mark 2 manually');
  assert.equal(f.el('send').disabled, true);
  assert.equal(f.el('count').textContent, '0 selected');
  await f.el('form').listeners.submit({ preventDefault() {} });
  assert.equal(f.calls.length, 2);
});

test('CC validation rejects header injection and empty edited content before calling CRM', () => {
  const f = fixture();
  assert.throws(() => f.service.send(['1'], 'a@example.com', 'review', 'b@example.com\nBcc:c@example.com', '<p>Edited</p>'), /CC emails/);
  assert.throws(() => f.service.send(['1'], 'a@example.com', 'review', '', '<p><br>&nbsp;</p>'), /content/);
  assert.equal(f.calls.length, 0);
});

test('a recipient typo preserves the edited message and allows correction without reopening', async () => {
  const f = uiFixture(); f.render(); f.inputs.forEach(input => { input.checked = true; f.change(input); });
  await f.el('open').listeners.click();
  f.el('cc').value = 'invalid';
  f.el('preview').innerHTML = '<p>My edited message</p>';
  await f.el('form').listeners.submit({ preventDefault() {} });
  assert.equal(f.calls.length, 1);
  assert.equal(f.el('send').disabled, false);
  assert.equal(f.el('preview').contentEditable, 'true');
  assert.equal(f.el('preview').innerHTML, '<p>My edited message</p>');
  assert.equal(f.el('dialog').open, true);
});

 test('receipt checkbox saves and clears independently of bank request, and verifies CRM writes', async () => {
  const f = fixture(); f.record.Bank_Payment_Requested = true;
  await f.service.setReceiptNeeded('1', true);
  assert.equal(f.record.Bank_Receipt_Needed, true);
  await f.service.setReceiptNeeded('1', false);
  assert.equal(f.record.Bank_Receipt_Needed, false);
  assert.equal(f.record.Bank_Payment_Requested, true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    { Entity: 'Prepayments', APIData: { id: '1', Bank_Receipt_Needed: true }, Trigger: [] },
    { Entity: 'Prepayments', APIData: { id: '1', Bank_Receipt_Needed: false }, Trigger: [] }
  ]);
  f.ignoreWrite = true;
  await assert.rejects(f.service.setReceiptNeeded('1', true), /did not confirm Bank Receipt Needed/);
});
test('receipt is editable in all views beside bank requested and missing proof is a dash', () => {
  const f = fixture();
  for (const view of ['open', 'closed', 'all']) {
    const html = f.window.AccountingManagerApp.prepaymentsModel.paymentTable([{payment: {id: '1', Bank_Receipt_Needed: true}, group: {}}], '2026-09-16', true, view);
    assert.match(html, /data-prepayment-bank-receipt value="1" checked/);
    assert.ok(html.indexOf('data-prepayment-bank-receipt') > html.indexOf('data-prepayment-bank-requested'));
    assert.match(html, /<td>-<\/td>/);
  }
});
test('receipt changes from the table persist and reload, with rollback on unconfirmed writes', async () => {
  const f = uiFixture();
  const input = {value: '1', checked: true, matches: selector => selector === '[data-prepayment-bank-receipt]'};
  await f.change(input);
  assert.equal(f.record.Bank_Receipt_Needed, true);
  assert.equal(f.reloads, 1);
  f.ignoreWrite = true; input.checked = false;
  await f.change(input);
  assert.equal(input.checked, true);
  assert.equal(f.errors.length, 1);
});

test('Open supports bulk receipts and hides email; other views only send registered selections', async () => {
  for (const view of ['open', 'closed', 'all']) {
    const f = uiFixture();
    f.actions.render([{id:'1', Accounting_Status:'Pending invoice'}, {id:'2', Accounting_Status:'Prepayment recorded'}], view);
    assert.equal(f.el('open').hidden, view === 'open');
    f.inputs[0].checked = true; await f.change(f.inputs[0]);
    assert.equal(f.el('receipt-bulk').disabled, false);
    assert.equal(f.el('open').disabled, true);
    await f.el('open').listeners.click();
    assert.equal(f.calls.length, 0);
    f.inputs[1].checked = true; await f.change(f.inputs[1]);
    await f.el('receipt-bulk').listeners.click();
    assert.equal(f.reloads, 1);
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every(call => call.APIData.Bank_Receipt_Needed === true));
    assert.equal(f.el('count').textContent, '0 selected');
  }
});
test('bulk receipt failures remain selected and do not prevent the other updates', async () => {
  const f = uiFixture(); f.render();
  f.inputs.forEach(input => { input.checked = true; f.change(input); });
  f.zoho.CRM.API.updateRecord = async data => {
    f.calls.push(data);
    if (data.APIData.id === '1') return {data:[{code:'NO_PERMISSION', message:'Permission denied'}]};
    Object.assign(f.record, data.APIData); return {data:[{code:'SUCCESS'}]};
  };
  await f.el('receipt-bulk').listeners.click();
  assert.equal(f.calls.length, 2);
  assert.equal(f.el('count').textContent, '1 selected');
  assert.equal(f.inputs[0].checked, true);
  assert.equal(f.inputs[1].checked, false);
  assert.match(f.errors[0], /Permission denied/);
});
