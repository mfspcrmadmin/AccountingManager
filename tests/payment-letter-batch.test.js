const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const name of ['config', 'helpers', 'supplier-activity', 'payment-letter-batch']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + name + '.js', 'utf8'), { window });
}
const ns = window.AccountingManagerApp;
function setup(options = {}) {
  const state = ns.createInitialState();
  state.records.payments = [{ id: 'p1', Name: 'Payment 1' }, { id: 'p2', Name: 'Payment 2' }];
  state.records.payAllocations = [
    ['p1', 's1', 'i1', 10], ['p2', 's1', 'i2', 20], ['p2', 's1', 'i3', 30], ['p2', 's2', 'i4', 40]
  ].map(([p, s, i, amount]) => ({ Supplier_Payment: { id: p }, Supplier: { id: s, name: s }, Supplier_Invoice: { id: i }, Allocated_Amount: amount }));
  const activity = ns.createSupplierActivityModule({ state, helpers: ns.helpers });
  const calls = [], lookups = [];
  const batch = ns.createPaymentLetterBatch({
    state, helpers: ns.helpers, ensureAllocations: async () => {}, getSuppliers: activity.getPaymentLetterSuppliers,
    resolveRecipient: async supplier => { lookups.push(supplier.id); return { email: supplier.id + '@example.com' }; },
    getCurrentUserEmail: options.identity || (async () => ' USER@example.com '),
    validEmail: email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    parseResult: result => result, functionName: 'sendletter', defaultRecipient: '',
    crm: { searchRecord: options.contacts || (async () => []), executeFunction: async (name, args) => { calls.push(args); return options.send ? options.send(args, calls.length) : { success: true, sentCount: 1 }; } }
  });
  batch.selected.add('p1'); batch.selected.add('p2');
  return { batch, calls, lookups, state };
}

test('supplier contact picker fills only the chosen letter and does not send', async () => {
  const f = setup({contacts:async (module,query)=>{
    assert.equal(module,'Contacts'); assert.equal(query,'(Vendor_Name:equals:s1)');
    return [{Full_Name:'Finance',Email:'finance@example.com'},{Full_Name:'Missing',Email:''}];
  }});
  await f.batch.open(); f.batch.getRows()[0].email='';
  await f.batch.toggleContacts(0);
  f.batch.selectContact(0,1);
  assert.equal(f.batch.getRows()[0].email,'');
  f.batch.selectContact(0,0);
  assert.equal(f.batch.getRows()[0].email,'finance@example.com');
  assert.equal(f.batch.getRows()[0].contacts,undefined);
  assert.equal(f.batch.getRows()[1].email,'s1@example.com');
  assert.equal(f.calls.length,0);
  await f.batch.send();
  assert.equal(JSON.parse(f.calls[0].supplierEmailMapStr).s1,'finance@example.com');
  await f.batch.toggleContacts(0);
  assert.equal(f.batch.getRows()[0].contacts,undefined,'sent letters cannot change recipients');
});

test('contact lookup errors remain visible and can be retried', async () => {
  let attempts=0;
  const f=setup({contacts:async()=>{if(++attempts===1) throw Error('Permission denied'); return [];}});
  await f.batch.open(); await f.batch.toggleContacts(0);
  assert.equal(f.batch.getRows()[0].contacts.message,'Permission denied');
  await f.batch.toggleContacts(0); await f.batch.toggleContacts(0);
  assert.equal(f.batch.getRows()[0].contacts.status,'ready');
  assert.equal(f.batch.getRows()[0].contacts.records.length,0);
  assert.equal(f.calls.length,0);
});

test('pending contact selection blocks sending and a closed picker is not reopened by a late response', async () => {
  let resolve;
  const f=setup({contacts:()=>new Promise(done=>{resolve=done;})});
  await f.batch.open(); const request=f.batch.toggleContacts(0);
  await f.batch.send(); assert.equal(f.calls.length,0);
  await f.batch.toggleContacts(0);
  resolve([{Email:'late@example.com'}]); await request;
  assert.equal(f.batch.getRows()[0].contacts,undefined);
  assert.equal(f.batch.getRows()[0].email,'s1@example.com');
});
test('mixed payments create one letter per supplier with all related invoices', async () => {
  const ctx = setup(); await ctx.batch.open();
  assert.equal(ctx.batch.getRows().length, 3);
  const multi = ctx.batch.getRows()[1];
  assert.equal(multi.supplier.invoiceCount, 2); assert.equal(multi.supplier.totalAllocated, 50);
  assert.deepEqual(ctx.lookups, ['s1', 's2']);
  await ctx.batch.send();
  assert.equal(ctx.calls.length, 3);
  assert.equal(ctx.calls[0].actingUserEmail, 'user@example.com');
  assert.deepEqual(JSON.parse(ctx.calls[2].supplierEmailMapStr), { s2: 's2@example.com' });
  await ctx.batch.open(); await ctx.batch.send(); assert.equal(ctx.calls.length, 3);
});
test('batch letter amounts subtract refunds separately for each supplier', async () => {
  const ctx = setup();
  ctx.state.records.payAllocations[2].Movement_Type = 'Supplier Refund';
  await ctx.batch.open();
  assert.deepEqual(Array.from(ctx.batch.getRows(), row => row.supplier.totalAllocated), [10, -10, 40]);
  await ctx.batch.send();
  assert.equal(ctx.calls.length, 3);
});

test('partial failures only retry failed letters, including after closing and reopening', async () => {
  const ctx = setup({ send: (_, index) => ({ success: index !== 2, sentCount: index === 2 ? 0 : 1, message: 'result' }) });
  await ctx.batch.open(); await ctx.batch.send();
  assert.deepEqual(Array.from(ctx.batch.getRows(), r => r.status), ['sent', 'failed', 'sent']);
  await ctx.batch.open(); await ctx.batch.send();
  assert.equal(ctx.calls.length, 4); assert.equal(ctx.calls[3].paymentId, 'p2'); assert.equal(ctx.calls[3].supplierIds, 's1');
});
test('unconfirmed sends cannot be automatically retried', async () => {
  const ctx = setup({ send: (_, index) => { if (index === 1) throw new Error('timeout'); return { success: true, sentCount: 0 }; } });
  await ctx.batch.open(); await ctx.batch.send(); await ctx.batch.send();
  assert.equal(ctx.calls.length, 3);
  assert.ok(ctx.batch.getRows().every(r => r.status === 'unknown'));
});
test('invalid recipients block sending until corrected or deselected', async () => {
  const ctx = setup(); await ctx.batch.open(); ctx.batch.getRows()[0].email = '';
  await ctx.batch.send(); assert.equal(ctx.calls.length, 0);
  ctx.batch.getRows()[0].checked = false; ctx.batch.getRows()[1].email = 'manual@example.com';
  await ctx.batch.send(); assert.equal(ctx.calls.length, 2);
  assert.equal(JSON.parse(ctx.calls[0].supplierEmailMapStr).s1, 'manual@example.com');
});
test('sender lookup prevents duplicate submissions and unidentified users cannot send', async () => {
  let resolve; const ctx = setup({ identity: () => new Promise(done => { resolve = done; }) });
  await ctx.batch.open(); const pending = ctx.batch.send(); await ctx.batch.send();
  resolve('user@example.com'); await pending; assert.equal(ctx.calls.length, 3);
  const missing = setup({ identity: async () => '' }); await missing.batch.open(); await missing.batch.send(); assert.equal(missing.calls.length, 0);
});
test('selection drops payments removed by filtering and payments without allocations cannot send', async () => {
  const ctx = setup(); ctx.batch.renderSelection({ filteredRecords: [ctx.state.records.payments[0]] });
  assert.deepEqual([...ctx.batch.selected], ['p1']); ctx.state.records.payAllocations = [];
  await ctx.batch.open(); await ctx.batch.send(); assert.equal(ctx.calls.length, 0);
  assert.equal(ctx.batch.getRows()[0].status, 'unavailable');
});


test('renderer forwards batch selection and row/select-all changes update the action', () => {
  const nodes = new Map();
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, { disabled: false, checked: false, listeners: {},
      addEventListener(event, fn) { this.listeners[event] = fn; },
      querySelector: selector => node(selector),
      getAttribute(name) { return this.attributes?.[name] ?? null; },
      hasAttribute(name) { return Object.hasOwn(this.attributes || {}, name); }
    });
    return nodes.get(key);
  }
  const first = node('first'), second = node('second'), all = node('all');
  first.attributes = { 'data-payment-letter-select': 'p1' };
  second.attributes = { 'data-payment-letter-select': 'p2' };
  all.attributes = { 'data-payment-letter-select-all': '' };
  const doc = { getElementById: node, querySelectorAll: () => [first, second], querySelector: () => all };
  const state = { isLoading: false };
  const batch = ns.createPaymentLetterBatch({ document: doc, state, helpers: ns.helpers });
  const records = [{ id: 'p1' }, { id: 'p2' }];
  const view = { filteredRecords: records, visibleRecords: records };
  // Exercise the actual renderer forwarding function where the regression occurred.
  const source = fs.readFileSync('app/scripts/render.js', 'utf8');
  const wrapper = source.match(/function renderPaymentsWorkspace\([^)]*\) \{[\s\S]*?\n    \}/)[0];
  const context = { paymentsRenderer: { renderPaymentsWorkspace(nextView, onSelected, controller) {
    assert.equal(controller, batch);
    controller.renderSelection(nextView);
  } } };
  vm.runInNewContext(wrapper + '; this.renderWorkspace = renderPaymentsWorkspace;', context);
  context.renderWorkspace(view, () => {}, batch);
  assert.equal(node('payment-letter-batch-open').disabled, true);
  const change = target => node('payments-table-wrap').listeners.change({ target });
  first.checked = true; change(first);
  assert.equal(node('payment-letter-batch-open').disabled, false);
  assert.equal(node('payment-letter-batch-count').textContent, '1 selected');
  assert.equal(all.indeterminate, true);
  all.checked = true; change(all);
  assert.equal(first.checked, true); assert.equal(second.checked, true);
  assert.equal(all.indeterminate, false);
  assert.equal(node('payment-letter-batch-count').textContent, '2 selected');
  // Rerendering retains checked rows.
  context.renderWorkspace(view, () => {}, batch);
  assert.equal(first.checked, true); assert.equal(second.checked, true);
  all.checked = false; change(all);
  assert.equal(first.checked, false); assert.equal(second.checked, false);
  assert.equal(node('payment-letter-batch-open').disabled, true);
  // Select-all only applies to the visible page, then filtering prunes selection.
  context.renderWorkspace({ filteredRecords: records, visibleRecords: [records[1]] }, () => {}, batch);
  all.checked = true; change(all);
  assert.deepEqual([...batch.selected], ['p2']);
  context.renderWorkspace({ filteredRecords: [records[0]], visibleRecords: [records[0]] }, () => {}, batch);
  assert.equal(batch.selected.size, 0);
  assert.equal(node('payment-letter-batch-open').disabled, true);
});
