const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const name of ['config', 'helpers', 'supplier-activity']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + name + '.js', 'utf8'), { window });
}
const ns = window.AccountingManagerApp;

function setup(options = {}) {
  const state = ns.createInitialState();
  state.records.payments = [{ id: 'p1' }];
  state.records.payAllocations = [{ Supplier_Payment: { id: 'p1' }, Supplier: { id: 's1', name: 'Supplier' }, Allocated_Amount: 10 }];
  Object.assign(state.paymentLetter, { paymentId: 'p1', isOpen: true, selectedSupplierIds: { s1: true }, manualEmailBySupplierId: { s1: 'supplier@example.com' } });
  const elements = new Proxy({}, { get(target, key) { return target[key] ||= { closest() { return null; } }; } });
  const calls = [], popups = [];
  const mod = ns.createSupplierActivityModule({
    state, elements, helpers: ns.helpers,
    SEND_SUPPLIER_PAYMENT_LETTER_FUNCTION: 'sendsupplierpaymentletter',
    PAYMENT_LETTER_DEFAULT_RECIPIENT: '',
    getCurrentUserEmail: options.getEmail || (async () => '  ALBA@madeforspainandportugal.com '),
    hasValidEmailAddress: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    crm: { async executeFunction(name, args) { calls.push({ name, args }); return options.result || { success: true }; } },
    getPaymentLetterFunctionResult: value => value,
    renderer: { showError() {}, showNotice() {}, refreshActionState() {}, showErrorPopup(message) { popups.push(message); } },
    renderAll() {}, debugError() {}
  });
  return { mod, state, calls, popups };
}

test('payment letter sends the current user email and preserves supplier recipients', async () => {
  const ctx = setup();
  await ctx.mod.onSelectedPaymentLetterSubmitClick();
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].args.actingUserEmail, 'alba@madeforspainandportugal.com');
  assert.equal(JSON.parse(ctx.calls[0].args.supplierEmailMapStr).s1, 'supplier@example.com');
  assert.equal(ctx.state.paymentLetter.isOpen, false);
  assert.deepEqual(ctx.popups, []);
});

test('unidentified current user never invokes sending and opens an error popup', async () => {
  for (const getEmail of [async () => '', async () => { throw new Error('Could not identify your CRM user email.'); }]) {
    const ctx = setup({ getEmail });
    await ctx.mod.onSelectedPaymentLetterSubmitClick();
    assert.equal(ctx.calls.length, 0);
    assert.match(ctx.popups[0], /identify your CRM user email/);
    assert.equal(ctx.state.paymentLetter.isBusy, false);
    assert.equal(ctx.state.paymentLetter.isOpen, true);
  }
});

test('server authorization rejection is shown in a popup and preserves the selection', async () => {
  const ctx = setup({ getEmail: async () => 'unauthorized@example.com', result: { success: false, message: 'You are not authorized to send payment letters.' } });
  await ctx.mod.onSelectedPaymentLetterSubmitClick();
  assert.match(ctx.popups[0], /not authorized/);
  assert.equal(ctx.state.paymentLetter.selectedSupplierIds.s1, true);
  assert.equal(ctx.state.paymentLetter.isBusy, false);
});

test('double click during identity lookup only sends once', async () => {
  let resolve;
  const ctx = setup({ getEmail: () => new Promise(done => { resolve = done; }) });
  const pending = ctx.mod.onSelectedPaymentLetterSubmitClick();
  await ctx.mod.onSelectedPaymentLetterSubmitClick();
  resolve('alba@madeforspainandportugal.com');
  await pending;
  assert.equal(ctx.calls.length, 1);
});

test('Deluge authorizes before loading payments and has a literal sender for every allowed email', () => {
  const source = fs.readFileSync('_local/crm/crm_functions/sendSupplierPaymentLetter', 'utf8');
  const allowed = [...source.match(/authorizedSenders = \{([^}]+)\}/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]).sort();
  const senders = [...source.matchAll(/from\s*:\s*"([^"]+)"/g)].map(match => match[1]).sort();
  assert.equal(allowed.length, 27);
  assert.deepEqual(senders, allowed);
  assert.ok(source.indexOf('!authorizedSenders.contains(actingUserEmail)') < source.indexOf('zoho.crm.getRecordById'));
  assert.equal([...source.matchAll(/sendmail\s*\[/g)].length, senders.length);
  for (const email of allowed) {
    assert.ok(source.includes('if(actingUserEmail == "' + email + '")'));
  }
});
