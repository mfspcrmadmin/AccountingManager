const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('app/scripts/prepayments.js', 'utf8'), { window, Intl });
const model = window.AccountingManagerApp.prepaymentsModel;
const requests = [{ id: 'r1', Name: 'Request 1', Supplier: { name: 'Hotel One' }, MFSP_Reference: 'MFSP123', Supplier_Code: 'SUP-123', Requested_By_2: 'person@example.com' }, { id: 'r2', Name: 'Empty request' }];
const payments = [
  { id: 'p1', Name: 'Deposit', Prepayment_Request: { id: 'r1' }, Amount: 300, Currency: 'EUR', Due_Date: '2026-09-01', Accounting_Status: 'Prepayment recorded' },
  { id: 'p2', Name: 'Balance', Prepayment_Request: { id: 'r1' }, Amount: 700, Currency: 'EUR', Due_Date: '2026-09-10', Accounting_Status: 'Pending invoice' },
  { id: 'p3', Prepayment_Request: { id: 'r1' }, Amount: 10, Currency: 'USD', Due_Date: '2026-09-09', Accounting_Status: 'Cancelled' },
  { id: 'p4', Prepayment_Request: { id: 'missing', name: 'Restricted request' }, Amount: null, Accounting_Status: '-None-' },
  { id: 'p5', Amount: 0, Accounting_Status: 'Pending invoice' }
];
const groups = () => model.groupRecords(requests, payments);
const filtered = filters => model.filterGroups(groups(), filters, '2026-09-11');

test('today highlights open prepayments in both tables without marking closed or other dates', () => {
  for (const showRequest of [true, false]) {
    for (const status of ['Pending invoice', 'Pending payment record', '-None-', 'Unknown']) {
      const html = model.paymentTable([{ payment: { id: 'today', Due_Date: '2026-09-17', Accounting_Status: status }, group: {} }], '2026-09-17', showRequest);
      assert.match(html, /<tr class="prepayment-due-today">/);
      assert.match(html, />Due today<\/small>/);
      assert.doesNotMatch(html, />Overdue</);
    }
    for (const payment of [
      { Due_Date: '2026-09-16' }, { Due_Date: '2026-09-18' }, {},
      ...['Prepayment recorded', 'Cancelled', 'Discard - Credit', 'Discard - Already Paid'].map(Accounting_Status => ({ Due_Date: '2026-09-17', Accounting_Status }))
    ]) {
      assert.doesNotMatch(model.paymentTable([{ payment, group: {} }], '2026-09-17', showRequest), /prepayment-due-today|Due today/);
    }
  }
});

test('Due today defaults on and toggles immediately without applying other date filters', async () => {
  const elements = new Map();
  const el = key => {
    if (!elements.has(key)) elements.set(key, {
      value: '', innerHTML: '', textContent: '', listeners: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {}
    });
    return elements.get(key);
  };
  const panel = el('panel');
  panel.querySelector = selector => el(selector.match(/data-prepayments-([^\]]+)/)[1]);
  panel.querySelectorAll = () => [];
  el('filters').reset = () => { for (const element of elements.values()) element.value = ''; };
  let currentDay = '2026-09-17';
  class LocalDate {
    getFullYear() { return 2026; }
    getMonth() { return 8; }
    getDate() { return Number(currentDay.slice(-2)); }
  }
  const uiWindow = { addEventListener() {}, AccountingManagerApp: { createPrepaymentWorkflow: () => ({ close() {} }) } };
  vm.runInNewContext(fs.readFileSync('app/scripts/prepayments.js', 'utf8'), { window: uiWindow, Intl, Date: LocalDate });
  const workspace = uiWindow.AccountingManagerApp.createPrepaymentsWorkspace(panel, { CRM: { API: {
    getAllRecords: async ({ Entity }) => ({ data: Entity === 'Prepayment_Requests' ? [] : [
      { id: 'today', Name: 'Today open', Due_Date: '2026-09-17', Payment_Date: '2026-09-15' },
      { id: 'later', Name: 'Later open', Due_Date: '2026-09-18', Payment_Date: '2026-09-16' },
      { id: 'closed', Name: 'Today closed', Due_Date: '2026-09-17', Accounting_Status: 'Prepayment recorded' }
    ] })
  } } });
  workspace.activate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(el('from').value, '');
  assert.equal(el('date-mode').value, 'single');
  assert.equal(el('payment-date-mode').value, 'single');
  assert.equal(el('payment-from').value, '');
  assert.match(el('results').innerHTML, /Today open/);
  assert.doesNotMatch(el('results').innerHTML, /Later open/);
  assert.equal(el('due-today').checked, true);
  assert.equal(el('from').disabled, true);
  el('due-today').checked = false;
  el('due-today').listeners.change();
  assert.equal(el('from').disabled, false);
  assert.match(el('results').innerHTML, /Later open/);
  assert.doesNotMatch(el('results').innerHTML, /Today closed/);
  el('mfsp').value = 'unknown';
  el('date-mode').value = 'range';
  el('date-mode').listeners.change();
  el('from').value = '2026-09-01';
  el('to').value = '2026-09-30';
  el('payment-date-mode').value = 'range';
  el('payment-date-mode').listeners.change();
  el('payment-from').value = '2026-09-01';
  el('payment-to').value = '2026-09-30';
  el('reset').listeners.click();
  assert.equal(el('mfsp').value, '');
  assert.equal(el('due-today').checked, false);
  for (const prefix of ['', 'payment-']) {
    assert.equal(el(prefix + 'date-mode').value, 'single');
    assert.equal(el(prefix + 'from').value, '');
    assert.equal(el(prefix + 'to').value, '');
    assert.equal(el(prefix + 'to-field').hidden, true);
    assert.equal(el(prefix + 'to').disabled, true);
  }
  assert.match(el('results').innerHTML, /Today open/);
  assert.match(el('results').innerHTML, /Later open/);
  el('payment-from').value = '2026-09-15';
  el('filters').listeners.submit({ preventDefault() {} });
  assert.match(el('results').innerHTML, /Today open/);
  assert.doesNotMatch(el('results').innerHTML, /Later open/);
  el('payment-date-mode').value = 'range';
  el('payment-date-mode').listeners.change();
  assert.equal(el('payment-to-field').hidden, false);
  assert.equal(el('payment-to').disabled, false);
  assert.equal(el('to-field').hidden, true);
  el('payment-to').value = '2026-09-16';
  el('filters').listeners.submit({ preventDefault() {} });
  assert.match(el('results').innerHTML, /Today open/);
  assert.match(el('results').innerHTML, /Later open/);
  el('payment-to').value = '2026-09-14';
  el('filters').listeners.submit({ preventDefault() {} });
  assert.match(el('message').textContent, /Payment date from must be/);
  el('payment-date-mode').value = 'single';
  el('payment-date-mode').listeners.change();
  assert.equal(el('payment-to').value, '');
  assert.equal(el('payment-to-field').hidden, true);
  el('payment-from').value = '';
  el('filters').listeners.submit({ preventDefault() {} });
  await panel.listeners.click({ target: { closest: selector => selector === '[data-prepayments-status-view]' ? { dataset: { prepaymentsStatusView: 'closed' } } : null } });
  assert.match(el('results').innerHTML, /Today closed/);
  workspace.hide();
  currentDay = '2026-09-18';
  workspace.activate();
  assert.equal(el('from').value, '');
  assert.equal(el('due-today').checked, true);
  assert.match(el('results').innerHTML, /Later open/);
  assert.doesNotMatch(el('results').innerHTML, /Today open/);
  assert.doesNotMatch(el('results').innerHTML, /Today closed/);
});

test('bank checkbox filters intersect with each other and Open/Closed/All views', () => {
  const rows = [
    { id: '1', Accounting_Status: 'Pending invoice', Bank_Payment_Requested: true, Bank_Receipt_Needed: true },
    { id: '2', Accounting_Status: 'Prepayment recorded', Bank_Payment_Requested: false, Bank_Receipt_Needed: true },
    { id: '3', Accounting_Status: 'Prepayment recorded' }
  ];
  const list = model.groupRecords([], rows);
  const ids = filters => model.filterGroups(list, filters, '2026-09-11').flatMap(g => g.visible.map(p => p.id));
  assert.deepEqual(Array.from(ids({ bankRequested: 'yes', statusView: 'open' })), ['1']);
  assert.deepEqual(Array.from(ids({ bankRequested: 'no', bankReceipt: 'yes', statusView: 'closed' })), ['2']);
  assert.deepEqual(Array.from(ids({ bankReceipt: 'no', statusView: 'all' })), ['3']);
  assert.equal(ids({ bankRequested: 'yes', statusView: 'closed' }).length, 0);
  assert.equal(model.filterGroups(model.groupRecords([{ id: 'empty' }], []), { bankReceipt: 'yes' }, '').length, 0);
});

test('proforma precedes Reported By, with the shared preview buttons in both table views', () => {
  window.AccountingManagerApp.operationsDocuments = { files: value => value || [] };
  for (const showRequest of [true, false]) {
    const html = model.paymentTable([{ payment: payments[0], group: { key: 'r1', request: { Proforma_Attached: [{ id: 'file1', name: '<proforma>.pdf' }] } } }], '2026-09-11', showRequest);
    assert.match(html, /<th>Proforma<\/th><th>Reported By<\/th><\/tr>/);
    assert.match(html, /class="card-purchase-file"/);
    assert.match(html, /data-prepayment-proforma="r1" data-proforma-index="0"/);
    assert.match(html, /&lt;proforma&gt;\.pdf/);
  }
});

test('saved prepayment column preferences apply to header and body with the right-hand gear', () => {
  const frames = [];
  const managerWindow = { localStorage: { getItem: () => JSON.stringify({ prepayments: { order: ['Proforma', 'Amount'], visible: ['Proforma', 'Amount'] } }) }, cancelAnimationFrame() {}, requestAnimationFrame(fn) { frames.push(fn); } };
  vm.runInNewContext(fs.readFileSync('app/scripts/table-columns.js', 'utf8'), { window: managerWindow, document: { addEventListener() {} } });
  vm.runInNewContext(fs.readFileSync('app/scripts/prepayments.js', 'utf8'), { window: managerWindow, Intl });
  const html = managerWindow.AccountingManagerApp.prepaymentsModel.paymentTable([{ payment: payments[0], group: {} }], '2026-09-11', true, 'all', () => {});
  assert.match(html, /data-resizable-column="Proforma"/);
  assert.ok(html.indexOf('>Proforma</th>') < html.indexOf('>Amount</th>'));
  assert.doesNotMatch(html, /<th>Observations/);
  assert.match(html, /data-table-columns-button="prepayments"/);
  assert.equal((html.match(/<td(?:\s|>)/g) || []).length, 4);
  assert.equal(frames.length, 1);
});

test('groups by lookup ID and preserves empty requests, unavailable requests and unassigned payments', () => {
  const g = groups();
  assert.equal(g.length, 4);
  assert.equal(g.find(x => x.key === 'r1').payments.length, 3);
  assert.equal(g.find(x => x.key === 'r2').payments.length, 0);
  assert.equal(g.find(x => x.key === 'missing').label, 'Restricted request');
  assert.equal(g.find(x => x.key === 'unassigned').payments[0].id, 'p5');
  assert.equal(filtered({}).length, 4);
});

test('MFSP and supplier code filters match only their own fields and intersect', () => {
  assert.equal(filtered({ mfsp: '  mfsp123 ' })[0].visible.length, 3);
  assert.equal(filtered({ supplierCode: 'sup-123' })[0].visible.length, 3);
  assert.equal(filtered({ mfsp: 'MFSP123', supplierCode: 'SUP-123' })[0].payments.length, 3);
  assert.equal(filtered({ mfsp: 'Hotel One' }).length, 0);
  assert.equal(filtered({ supplierCode: 'MFSP123' }).length, 0);
  assert.equal(filtered({ mfsp: 'MFSP123', supplierCode: 'other' }).length, 0);
});

test('filters intersect on due date, accounting status, including boundary dates', () => {
  const result = filtered({ from: '2026-09-10', to: '2026-09-10', accountingStatus: 'Pending invoice' });
  assert.equal(result.length, 1);
  assert.equal(result[0].visible[0].id, 'p2');
  assert.equal(filtered({ accountingStatus: 'Prepayment recorded' })[0].visible[0].id, 'p1');
  assert.equal(filtered({ accountingStatus: 'No status' })[0].visible[0].id, 'p4');
  assert.equal(model.overdue(payments[1], '2026-09-11'), true);
  assert.equal(model.overdue(payments[0], '2026-09-11'), false);
  assert.equal(model.overdue(payments[1], '2026-09-10'), false);
  assert.equal(model.overdue(payments[2], '2026-09-11'), false);
});

test('totals separate currencies, retain zero and flag missing amounts', () => {
  const totals = model.totals(payments);
  assert.equal(totals.sums.EUR, 1000);
  assert.equal(totals.sums.USD, 10);
  assert.equal(totals.missing, 1);
  assert.equal(model.totals([payments[4]]).sums.EUR, 0);
  assert.equal(model.totals(payments, model.isPending).sums.EUR, 700);
});

test('accounting filters use CRM accounting statuses without the removed Status field', () => {
  const states = ['Pending invoice', 'Pending payment record', 'Prepayment recorded', 'Cancelled', '-None-'];
  const records = states.map((Accounting_Status, index) => ({
    id: String(index), Accounting_Status, Prepayment_Request: { id: 'r1' }
  }));
  const grouped = model.groupRecords(requests, records);
  states.forEach((value, index) => {
    const result = model.filterGroups(grouped, {
      accountingStatus: value === '-None-' ? 'No status' : value
    }, '2026-09-11');
    assert.equal(result.length, 1);
    assert.equal(result[0].visible.length, 1);
    assert.equal(result[0].visible[0].id, String(index));
  });
});

test('open and closed partition all prepayments, including missing and unknown statuses', () => {
  const records = payments.concat({ id: 'p6', Accounting_Status: 'Needs review' });
  const grouped = model.groupRecords(requests, records);
  const ids = statusView => Array.from(model.filterGroups(grouped, { statusView }, '2026-09-11').flatMap(g => g.visible.map(p => p.id))).sort();
  assert.deepEqual(ids('open'), ['p2', 'p4', 'p5', 'p6']);
  assert.deepEqual(ids('closed'), ['p1', 'p3']);
  assert.deepEqual(ids('all'), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  assert.equal(filtered({ statusView: 'closed' }).some(g => g.key === 'r2'), false);
  assert.equal(filtered({ statusView: 'open' }).some(g => g.key === 'r2'), true);
  assert.equal(filtered({ statusView: 'open', accountingStatus: 'Cancelled' }).length, 0);
  assert.equal(filtered({ statusView: 'closed', search: 'Hotel One', from: '2026-09-09' })[0].visible[0].id, 'p3');
});

test('accounting status headers and cells precede due date in both table views', () => {
  for (const showRequest of [true, false]) {
    const html = model.paymentTable([{ payment: payments[0], group: groups()[0] }], '2026-09-11', showRequest);
    const headers = Array.from(html.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/g), match => match[1]);
    const cells = Array.from(html.matchAll(/<td(?:\s[^>]*)?>(.*?)<\/td>/g), match => match[1]);
    const index = headers.indexOf('Accounting Status');
    assert.equal(headers[index], 'Accounting Status');
    assert.equal(headers[index + 1], 'Due date');
    assert.equal(headers[index - 1], 'Observations');
    if (showRequest) assert.equal(headers[index - 2], 'Request / supplier / booking');
    assert.match(cells[index], /Prepayment recorded/);
    assert.match(cells[index + 1], /01\/09\/2026/);
    assert.equal(cells.length, headers.length);
  }
});

test('loads successive CRM pages for the requested module', async () => {
  const calls = [];
  const records = await model.loadModule({ async getAllRecords(args) {
    calls.push(args);
    return { data: [{ id: String(args.page) }], info: { more_records: args.page < 3 } };
  } }, 'Prepayments');
  assert.equal(records.length, 3);
  assert.deepEqual(calls.map(call => call.page), [1, 2, 3]);
  assert.ok(calls.every(call => call.Entity === 'Prepayments' && call.per_page === 200));
});

test('read errors, invalid responses and repeated pages are never presented as empty or complete results', async () => {
  for (const response of [undefined, { code: 'NO_PERMISSION', message: 'Permission denied' }, { data: [] , info: { more_records: true } }]) {
    await assert.rejects(model.loadModule({ getAllRecords: async () => response }, 'Prepayment_Requests'));
  }
  await assert.rejects(model.loadModule({ getAllRecords: async () => ({ data: [{ id: 'same' }], info: { more_records: true } }) }, 'Prepayments'), /repeated/);
  assert.equal((await model.loadModule({ getAllRecords: async () => ({ status: 204 }) }, 'Prepayments')).length, 0);
  assert.equal((await model.loadModule({ getAllRecords: async () => { throw { code: 'NO_CONTENT' }; } }, 'Prepayments')).length, 0);
});

test('discard statuses are closed, not overdue, and have a read-only action in both views', () => {
  for (const status of ['Discard - Credit', 'Discard - Already Paid']) {
    const payment = { id: 'discarded', Name: 'Deposit', Accounting_Status: status, Due_Date: '2026-01-01' };
    const grouped = model.groupRecords([], [payment]);
    assert.equal(model.isClosed(payment), true);
    assert.equal(model.isPending(payment), false);
    assert.equal(model.overdue(payment, '2026-09-16'), false);
    assert.equal(model.filterGroups(grouped, { statusView: 'open' }, '2026-09-16').length, 0);
    assert.equal(model.filterGroups(grouped, { statusView: 'closed' }, '2026-09-16')[0].visible.length, 1);
    for (const showRequest of [false, true]) {
      const html = model.paymentTable([{ payment, group: { request: {} } }], '2026-09-16', showRequest);
      assert.match(html, /aria-label="View Deposit"/);
      assert.doesNotMatch(html, /data-prepayment-discard/);
    }
  }
});

test('discard shortcut follows the registration button for open prepayments', () => {
  const html = model.paymentTable([{ payment: { id: 'p1', Name: 'Deposit', Accounting_Status: 'Pending invoice' }, group: { request: {} } }], '2026-09-16', false);
  assert.ok(html.indexOf('data-prepayment-discard="p1"') > html.indexOf('data-prepayment-register="p1"'));
});

test('discard writes only the selected Accounting Status after reading the live prepayment', async () => {
  for (const status of ['Discard - Credit', 'Discard - Already Paid']) {
    const writes = [];
    const api = {
      async getRecord() { return { data: [{ id: 'p1', Accounting_Status: 'Pending invoice' }] }; },
      async updateRecord(args) { writes.push(args); return { data: [{ code: 'SUCCESS' }] }; }
    };
    await window.AccountingManagerApp.discardPrepayment(api, 'p1', status);
    assert.equal(writes[0].Entity, 'Prepayments');
    assert.deepEqual(JSON.parse(JSON.stringify(writes[0].APIData)), { id: 'p1', Accounting_Status: status });
  }
});

test('discard rejects invalid choices, closed records and unconfirmed CRM updates', async () => {
  const discard = window.AccountingManagerApp.discardPrepayment;
  await assert.rejects(discard({}, 'p1', 'Paid'), /reason/);
  for (const status of ['Prepayment recorded', 'Cancelled', 'Discard - Already Paid']) {
    await assert.rejects(discard({ getRecord: async () => ({ data: [{ id: 'p1', Accounting_Status: status }] }) }, 'p1', 'Discard - Credit'), /already closed/);
  }
  await assert.rejects(discard({ getRecord: async () => ({ data: [{ id: 'p1' }] }), updateRecord: async () => ({ data: [{ code: 'NO_PERMISSION', message: 'Denied' }] }) }, 'p1', 'Discard - Credit'), /Denied/);
});

test('inline due date editing is available in both table views, including missing dates', () => {
  for (const showRequest of [true, false]) {
    for (const Due_Date of ['2026-09-17', '']) {
      const html = model.paymentTable([{ payment: { id: 'p1', Name: 'Deposit', Due_Date }, group: {} }], '2026-09-17', showRequest);
      assert.match(html, /data-prepayment-due-edit="p1"/);
      assert.match(html, /Edit due date for Deposit/);
    }
  }
});

test('due date persistence validates calendar dates and surfaces CRM rejection', async () => {
  const save = window.AccountingManagerApp.updatePrepaymentDueDate;
  const writes = [];
  const api = { updateRecord: async args => { writes.push(args); return { data: [{ code: 'SUCCESS' }] }; } };
  for (const invalid of ['', '2026-02-30', '2026-13-01', '17/09/2026']) {
    await assert.rejects(save(api, 'p1', invalid), /valid due date/);
  }
  assert.equal(writes.length, 0);
  await save(api, 'p1', '2028-02-29');
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), { Entity: 'Prepayments', APIData: { id: 'p1', Due_Date: '2028-02-29' }, Trigger: ['workflow'] });
  await assert.rejects(save({ updateRecord: async () => ({ data: [{ code: 'NO_PERMISSION', message: 'Denied' }] }) }, 'p1', '2026-09-18'), /Denied/);
  await assert.rejects(save({ updateRecord: async () => ({}) }, 'p1', '2026-09-18'), /did not confirm/);
});

test('saving a row date prevents duplicate writes and updates date-filtered results only on success', async () => {
  const elements = new Map();
  const el = key => {
    if (!elements.has(key)) elements.set(key, { value: '', listeners: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {} });
    return elements.get(key);
  };
  const panel = el('panel');
  panel.querySelector = selector => el(selector.match(/data-prepayments-([^\]]+)/)[1]);
  panel.querySelectorAll = () => [];
  const uiWindow = { addEventListener() {}, AccountingManagerApp: { createPrepaymentWorkflow: () => ({ close() {} }) } };
  vm.runInNewContext(fs.readFileSync('app/scripts/prepayments.js', 'utf8'), { window: uiWindow, Intl });
  let resolveWrite, writes = 0;
  const workspace = uiWindow.AccountingManagerApp.createPrepaymentsWorkspace(panel, { CRM: { API: {
    getAllRecords: async ({ Entity }) => ({ data: Entity === 'Prepayment_Requests' ? [] : [{ id: 'p1', Name: 'Deposit', Due_Date: '2026-09-17' }] }),
    updateRecord: () => { writes++; return new Promise(resolve => { resolveWrite = resolve; }); }
  } } });
  await workspace.load();
  el('from').value = '2026-09-17'; el('date-mode').value = 'single';
  el('filters').listeners.submit({ preventDefault() {} });
  const input = { value: '2026-09-18' }, status = {};
  const form = { closest() { return this; }, getAttribute() { return 'p1'; }, reportValidity() { return true; }, querySelector: selector => selector === 'input' ? input : status, querySelectorAll: () => [input] };
  const event = { target: form, preventDefault() {} };
  let pending = el('results').listeners.submit(event);
  await el('results').listeners.submit(event);
  assert.equal(writes, 1); assert.equal(input.disabled, true);
  resolveWrite({ data: [{ code: 'NO_PERMISSION', message: 'Denied' }] }); await pending;
  assert.match(el('results').innerHTML, /Deposit/); assert.equal(status.textContent, 'Denied'); assert.equal(input.disabled, false);
  pending = el('results').listeners.submit(event);
  resolveWrite({ data: [{ code: 'SUCCESS' }] }); await pending;
  assert.doesNotMatch(el('results').innerHTML, /Deposit/);
  el('from').value = '2026-09-18'; el('filters').listeners.submit({ preventDefault() {} });
  assert.match(el('results').innerHTML, /Deposit/);
  assert.match(el('results').innerHTML, /18\/09\/2026/);
});

test('due and payment date filters intersect independently with inclusive and open bounds', () => {
  const grouped = model.groupRecords([{ id: 'empty' }], [
    { id: 'a', Due_Date: '2026-09-10', Payment_Date: '2026-09-11' },
    { id: 'b', Due_Date: '2026-09-10', Payment_Date: '2026-09-12' },
    { id: 'c', Due_Date: '2026-09-11', Payment_Date: '2026-09-12' },
    { id: 'd', Due_Date: '2026-09-10' },
    { id: 'e', Payment_Date: '2026-09-12' }
  ]);
  const ids = filters => Array.from(model.filterGroups(grouped, filters, '2026-09-18')).flatMap(g => Array.from(g.visible, p => p.id)).sort();
  assert.deepEqual(ids({ from: '2026-09-10', to: '2026-09-10', paymentFrom: '2026-09-12', paymentTo: '2026-09-12' }), ['b']);
  assert.deepEqual(ids({ paymentFrom: '2026-09-11', paymentTo: '2026-09-12' }), ['a', 'b', 'c', 'e']);
  assert.deepEqual(ids({ paymentFrom: '2026-09-12' }), ['b', 'c', 'e']);
  assert.deepEqual(ids({ paymentTo: '2026-09-11' }), ['a']);
  assert.deepEqual(ids({ from: '2026-09-10', to: '2026-09-10' }), ['a', 'b', 'd']);
  assert.equal(model.filterGroups(grouped, { paymentFrom: '2026-09-12' }, '').some(g => g.key === 'empty'), false);
});

test('discard synchronizes the linked request and permits retry after a sync failure', async () => {
  const ns = window.AccountingManagerApp;
  const original = ns.syncPrepaymentRequestFromSDK;
  const payment = { id: 'p1', Accounting_Status: 'Pending invoice', Prepayment_Request: { id: '123' } };
  const api = {
    getRecord: async () => ({ data: [payment] }),
    updateRecord: async args => { Object.assign(payment, args.APIData); return { data: [{ code: 'SUCCESS' }] }; }
  };
  let attempts = 0;
  const meta = {};
  ns.syncPrepaymentRequestFromSDK = async (actualApi, actualMeta, requestId) => {
    assert.equal(actualApi, api); assert.equal(actualMeta, meta); assert.equal(requestId, '123');
    if (++attempts === 1) throw new Error('Temporary failure');
  };
  try {
    await assert.rejects(ns.discardPrepayment(api, 'p1', 'Discard - Credit', meta), /Discard saved.*Retry/);
    assert.equal(payment.Accounting_Status, 'Discard - Credit');
    await ns.discardPrepayment(api, 'p1', 'Discard - Credit', meta);
    assert.equal(attempts, 2);
  } finally { ns.syncPrepaymentRequestFromSDK = original; }
});
