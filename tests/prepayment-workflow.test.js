const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const file of ['invoice-name.js', 'quick-settlement-refresh.js', 'prepayments.js', 'prepayment-workflow.js']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + file, 'utf8'), { window, Intl });
}
const ns = window.AccountingManagerApp;
function fixture() {
  const db = {
    Prepayments: [{ id: 'p1', Name: 'Deposit', Amount: 300, Currency: 'EUR', Accounting_Status: 'Pending invoice', Prepayment_Request: { id: 'r1' } }],
    Prepayment_Requests: [{ id: 'r1', Supplier: { id: 's1', name: 'Hotel' }, Supplier_Code: 'SUP-001', Booking: { id: 'b1' } }],
    Vendors: [{ id: 's1', Is_Self_Employed: false }],
    Supplier_Settlements: [{ id: 'st1', Supplier: { id: 's1' }, Booking: { id: 'b1' }, Currency: 'EUR' }],
    Supplier_Invoices: [], Inv_Set_Allocations: [], Supplier_Payments: [], Supplier_Pay_Allocations: [],
    Payment_Accounts: [{ id: 'a1', Owner_Type: 'Own', Status: 'Active', Allowed_For_Supplier_Payments: false }]
  };
  const calls = [], session = new Map();
  const storage = { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value) };
  const clone = value => JSON.parse(JSON.stringify(value));
  const api = {
    async getRecord({ Entity, RecordID }) { return { data: db[Entity].filter(r => r.id === RecordID).map(clone) }; },
    async getAllRecords({ Entity }) { return { data: db[Entity].map(clone) }; },
    async searchRecord({ Entity, Query }) {
      const clauses = [...Query.matchAll(/\((\w+):equals:([^()]+)\)/g)];
      return { data: db[Entity].filter(r => clauses.every(([, key, value]) => (r[key] && r[key].id || r[key]) === value)).map(clone) };
    },
    async insertRecord({ Entity, APIData }) {
      calls.push({ Entity, create: clone(APIData[0]) });
      const record = { ...clone(APIData[0]), id: Entity + '-' + (db[Entity].length + 1) };
      db[Entity].push(record);
      return { data: [{ code: 'SUCCESS', details: { id: record.id } }] };
    },
    async updateRecord({ Entity, APIData }) {
      if (Entity === 'Prepayments') { assert.equal(Object.hasOwn(APIData, 'Status'), false, 'Removed Status must never be written'); }
      calls.push({ Entity, update: clone(APIData) });
      Object.assign(db[Entity].find(r => r.id === APIData.id), clone(APIData));
      return { data: [{ code: 'SUCCESS' }] };
    }
  };
  const zoho = { CRM: { API: api, META: { async getFields() { return { fields: [
    { api_name: 'Vendor_Invoice', data_type: 'lookup', lookup: { module: { api_name: 'Supplier_Invoices' } } },
    { api_name: 'Vendor_Payment', data_type: 'lookup', lookup: { module: { api_name: 'Supplier_Payments' } } }
  ] }; } }, FUNCTIONS: { async execute(name, args) {
    const input = JSON.parse(args.arguments);
    if (name === 'rebuildsuppliersettlementtotals') {
      calls.push({ rebuild: input.settlementIdsString });
      return { details: { output: JSON.stringify({ error: false, updated_count: input.settlementIdsString.split('|||').length, warning_count: 0, details: [] }) } };
    }
    const payment = JSON.parse(input.paymentDataString);
    calls.push({ function: name, input, payment });
    const invoice = db.Supplier_Invoices.find(r => r.id === input.supplierInvoiceIds);
    const amount = payment.allocations[invoice.id];
    db.Supplier_Payments.push({ id: 'pay1', Currency: payment.Currency, Payment_Amount: amount, Status: 'Paid' });
    db.Supplier_Pay_Allocations.push({ id: 'alloc1', Supplier_Payment: { id: 'pay1' }, Supplier_Invoice: { id: invoice.id }, Allocated_Amount: amount });
    invoice.Amount_Paid += amount;
    return { details: { output: JSON.stringify({ payment_id: 'pay1', error: false, allocation_ids: ['alloc1'] }) } };
  } } } };
  return { db, calls, api, zoho, storage, service: ns.createPrepaymentWorkflowService(zoho, storage) };
}
const invoiceInput = { reference: 'INV-1', date: '2026-09-11', amount: 1000, vat: 21, settlementId: 'st1' };
const paymentInput = { date: '2026-09-11', accountId: 'a1' };

test('prepayment offers Own accounts and keeps the supplier default out of the payment header', async () => {
  const f = fixture();
  f.db.Vendors[0].Default_Payment_Account = { id: 'supplier-bank' };
  f.db.Payment_Accounts.push({ id: 'supplier-bank', Name: 'Supplier bank', Owner_Type: 'Supplier', Status: 'Active', Allowed_For_Supplier_Payments: true, Owner_Supplier: { id: 's1' } });
  await f.service.saveInvoice('p1', invoiceInput);
  const ui = workflowUI(f);
  await ui.workflow.open('p1');
  assert.equal(ui.element('account').value, '');
  assert.match(ui.element('account').innerHTML, /value="a1"/);
  assert.doesNotMatch(ui.element('account').innerHTML, /supplier-bank|Create automatically/);
  assert.equal(ui.element('account').required, true);
  await f.service.savePayment('p1', paymentInput);
  const sent = f.calls.find(c => c.payment).payment;
  assert.equal(sent.Payment_Account, 'a1');
  assert.deepEqual(sent.Payment_Accounts_By_Supplier, {});
});

test('missing, supplier-owned and inactive source accounts cannot create a prepayment payment', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', invoiceInput);
  await assert.rejects(f.service.savePayment('p1', { date: '2026-09-11', accountId: '' }), /Own payment account/);
  f.db.Payment_Accounts[0].Owner_Type = 'Supplier';
  await assert.rejects(f.service.savePayment('p1', paymentInput), /Own payment account/);
  f.db.Payment_Accounts[0].Owner_Type = 'Own'; f.db.Payment_Accounts[0].Status = 'Inactive';
  await assert.rejects(f.service.savePayment('p1', paymentInput), /Own payment account/);
  assert.equal(f.calls.filter(c => c.function).length, 0);
});

test('Own account choices paginate, exclude inactive accounts and prefer the card only if it is Own', async () => {
  const f = fixture();
  f.db.Payment_Accounts.push({ id: 'a2', Owner_Type: 'Own', Status: 'Active' });
  f.api.getAllRecords = async ({ page }) => ({ data: [f.db.Payment_Accounts[page - 1]], info: { more_records: page === 1 } });
  assert.equal((await ns.loadOwnPaymentAccountChoices(f.api, 'a2')).defaultAccountId, 'a2');
  f.db.Payment_Accounts[1].Owner_Type = 'Supplier';
  assert.equal((await ns.loadOwnPaymentAccountChoices(f.api, 'a2')).defaultAccountId, '');
  f.db.Payment_Accounts[0].Status = 'Inactive';
  assert.equal((await ns.loadOwnPaymentAccountChoices(f.api)).accounts.length, 0);
});

test('prepayment observations remain readable in invoice, payment and closed details and both tables', async () => {
  const f = fixture();
  f.db.Prepayment_Requests[0].Observations = 'Request note';
  f.db.Prepayments[0].Observations = 'First line\n<Important>';
  const ui = workflowUI(f);
  for (const phase of ['invoice', 'payment', 'closed']) {
    if (phase === 'payment') await f.service.saveInvoice('p1', invoiceInput);
    if (phase === 'closed') await f.service.savePayment('p1', paymentInput);
    await ui.workflow.open('p1');
    assert.match(ui.element('context').innerHTML, /Observations/);
    assert.match(ui.element('context').innerHTML, /First line\n&lt;Important&gt;/);
  }
  for (const grouped of [true, false]) {
    const html = ns.prepaymentsModel.paymentTable([{ payment: f.db.Prepayments[0], group: { request: f.db.Prepayment_Requests[0] } }], '2026-09-11', grouped);
    assert.match(html, /<th>Observations<\/th>/);
    assert.match(html, /First line\n&lt;Important&gt;/);
  }
});

test('row registration button precedes the prepayment in both table variants', () => {
  for (const showRequest of [false, true]) {
    const html = ns.prepaymentsModel.paymentTable([{ payment: { id: 'p1', Name: '<Deposit>' }, group: { request: {} } }], '2026-09-11', showRequest);
    assert.ok(html.indexOf('data-prepayment-register="p1"') < html.indexOf('data-prepayment-record="p1"'));
    assert.ok(html.includes('Register invoice and payment for &lt;Deposit&gt;'));
    assert.equal((html.match(/<th>Accounting Status<\/th>/g) || []).length, 1);
    assert.ok(!html.includes('<th>Status</th>'));
    assert.ok(!html.includes('<th>Accounted</th>'));
  }
});

test('invoice creation links the settlement, then pays only the prepayment amount', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', invoiceInput);
  assert.equal(f.db.Supplier_Invoices.length, 1);
  assert.equal(f.db.Supplier_Invoices[0].Supplier_Code, 'SUP-001');
  assert.equal(f.db.Supplier_Invoices[0].Invoice_Type, 'Proforma');
  assert.equal(f.db.Supplier_Invoices[0].Invoice_Amount_Excl_VAT, 826.45);
  assert.equal(f.db.Inv_Set_Allocations[0].Allocated_Amount, 1000);
  assert.equal(f.db.Prepayments[0].Accounting_Status, 'Pending payment record');
  await f.service.savePayment('p1', paymentInput);
  const call = f.calls.find(c => c.function);
  assert.equal(call.payment.allocations[f.db.Supplier_Invoices[0].id], 300);
  assert.equal(call.payment.Currency, 'EUR');
  assert.equal(f.db.Supplier_Invoices[0].Amount_Paid, 300);
  assert.equal(f.db.Prepayments[0].Vendor_Payment.id, 'pay1');
  assert.equal(f.db.Prepayments[0].Accounting_Status, 'Prepayment recorded');
  await assert.rejects(f.service.savePayment('p1', paymentInput), /already recorded/);
  assert.equal(f.calls.filter(c => c.function).length, 1);
});

test('existing invoice is linked without creating a duplicate invoice or settlement allocation', async () => {
  const f = fixture();
  f.db.Supplier_Invoices.push({ id: 'existing', Supplier: { id: 's1' }, Booking: { id: 'b1' }, Supplier_Settlement: { id: 'st1' }, Total_Payable_Amount: 1000, Amount_Paid: 0 });
  await f.service.saveInvoice('p1', { existingInvoiceId: 'existing' });
  assert.equal(f.db.Prepayments[0].Vendor_Invoice.id, 'existing');
  assert.equal(f.calls.filter(c => c.create).length, 0);
});

test('invoice lookup failure resumes the returned invoice ID after reopening', async () => {
  const f = fixture(), update = f.api.updateRecord;
  f.api.updateRecord = async args => {
    if (args.APIData.Vendor_Invoice) { throw new Error('Link failed'); }
    return update(args);
  };
  await assert.rejects(f.service.saveInvoice('p1', invoiceInput), /Link failed/);
  f.api.updateRecord = update;
  const reopened = ns.createPrepaymentWorkflowService(f.zoho, f.storage);
  await reopened.saveInvoice('p1', invoiceInput);
  assert.equal(f.db.Supplier_Invoices.length, 1);
  assert.equal(f.db.Inv_Set_Allocations.length, 1);
});

test('payment lookup failure retries the link without creating another payment', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', invoiceInput);
  const update = f.api.updateRecord;
  f.api.updateRecord = async args => {
    if (args.APIData.Vendor_Payment) { throw new Error('Link failed'); }
    return update(args);
  };
  await assert.rejects(f.service.savePayment('p1', paymentInput), /Link failed/);
  f.api.updateRecord = update;
  await ns.createPrepaymentWorkflowService(f.zoho, f.storage).savePayment('p1', paymentInput);
  assert.equal(f.calls.filter(c => c.function).length, 1);
  assert.equal(f.db.Prepayments[0].Accounting_Status, 'Prepayment recorded');
});

test('cancelled records and unrelated invoices cannot be registered', async () => {
  const f = fixture();
  f.db.Prepayments[0].Accounting_Status = 'Cancelled';
  await assert.rejects(f.service.saveInvoice('p1', invoiceInput), /cancelled/);
  f.db.Prepayments[0].Accounting_Status = 'Pending invoice';
  f.db.Supplier_Invoices.push({ id: 'wrong', Supplier: { id: 'other' }, Booking: { id: 'b1' } });
  await assert.rejects(f.service.saveInvoice('p1', { existingInvoiceId: 'wrong' }), /supplier and booking/);
  assert.equal(f.calls.length, 0);
});

test('an uncertain payment response blocks duplicate attempts', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', invoiceInput);
  let attempts = 0;
  f.zoho.CRM.FUNCTIONS.execute = async () => { attempts++; throw new Error('Connection lost'); };
  await assert.rejects(f.service.savePayment('p1', paymentInput), /Connection lost/);
  await assert.rejects(f.service.savePayment('p1', paymentInput), /previous payment request/);
  assert.equal(attempts, 1);
});

test('missing payment allocation does not mark a prepayment recorded', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', invoiceInput);
  const execute = f.zoho.CRM.FUNCTIONS.execute;
  f.zoho.CRM.FUNCTIONS.execute = async (...args) => {
    const response = await execute(...args);
    f.db.Supplier_Pay_Allocations = [];
    return response;
  };
  await assert.rejects(f.service.savePayment('p1', paymentInput), /allocation needs review/);
  assert.equal(f.db.Prepayments[0].Accounting_Status, 'Pending payment record');
});

test('USD prepayments preserve currency through invoice and payment registration', async () => {
  const f = fixture();
  f.db.Prepayments[0].Currency = 'USD';
  f.db.Supplier_Settlements[0].Currency = 'USD';
  await f.service.saveInvoice('p1', invoiceInput);
  await f.service.savePayment('p1', paymentInput);
  assert.equal(f.db.Supplier_Invoices[0].Currency, 'USD');
  assert.equal(f.calls.find(c => c.function).payment.Currency, 'USD');
  assert.equal(f.db.Supplier_Payments[0].Currency, 'USD');
});

test('missing CRM lookups fail before any record is created', async () => {
  const f = fixture();
  f.zoho.CRM.META.getFields = async () => ({ fields: [] });
  await assert.rejects(f.service.saveInvoice('p1', invoiceInput), /needs a lookup/);
  assert.equal(f.calls.length, 0);
});

test('IRPF uses the net base, reduces payable and settlement allocation, and preserves the selected type', async () => {
  const f = fixture();
  f.db.Vendors[0].Is_Self_Employed = true;
  await f.service.saveInvoice('p1', { ...invoiceInput, amount: 1210, irpf: 15, invoiceType: 'Final Invoice' }, () => { throw new Error('Already self-employed'); });
  const invoice = f.db.Supplier_Invoices[0];
  assert.equal(invoice.Invoice_Type, 'Final Invoice');
  assert.equal(invoice.Invoice_Amount_Excl_VAT, 1000);
  assert.equal(invoice.Invoice_Amount_Incl_VAT, 1210);
  assert.equal(invoice.IRPF_percentage, 15);
  assert.equal(invoice.IRPF_Amount, 150);
  assert.equal(invoice.Invoice_Total, 1060);
  assert.equal(invoice.Total_Payable_Amount, 1060);
  assert.equal(f.db.Inv_Set_Allocations[0].Allocated_Amount, 1060);
  await f.service.savePayment('p1', paymentInput);
  assert.equal(f.calls.find(c => c.function).payment.allocations[invoice.id], 300);
});

test('new payment allocations are verified directly even while Search has not indexed them', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', invoiceInput);
  const search = f.api.searchRecord;
  f.api.searchRecord = async args => args.Entity === 'Supplier_Pay_Allocations' ? { status: 204 } : search(args);
  await f.service.savePayment('p1', paymentInput);
  assert.equal(f.db.Prepayments[0].Vendor_Payment.id, 'pay1');
  assert.equal(f.calls.filter(c => c.function).length, 1);
});

test('an allocation read failure resumes by its saved ID after reopening without a second payment', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', invoiceInput);
  const get = f.api.getRecord;
  f.api.getRecord = async args => { if (args.Entity === 'Supplier_Pay_Allocations') throw Error('Temporary read failure'); return get(args); };
  await assert.rejects(f.service.savePayment('p1', paymentInput), /Temporary read failure.*No additional payment/);
  f.api.getRecord = get;
  f.service = ns.createPrepaymentWorkflowService(f.zoho, f.storage);
  await f.service.savePayment('p1', paymentInput);
  assert.equal(f.calls.filter(c => c.function).length, 1);
  assert.equal(f.db.Prepayments[0].Vendor_Payment.id, 'pay1');
});

test('846.20 payment with a failed prepayment link reopens as confirmation even before Search indexes it', async () => {
  const f = fixture();
  f.db.Prepayments[0].Amount = 846.20;
  await f.service.saveInvoice('p1', invoiceInput);
  const update = f.api.updateRecord;
  f.api.updateRecord = async args => { if (args.Entity === 'Prepayments' && args.APIData.Vendor_Payment) throw Error('Link temporarily unavailable'); return update(args); };
  await assert.rejects(f.service.savePayment('p1', paymentInput), /Confirm the existing payment/);
  assert.equal(f.db.Supplier_Invoices[0].Amount_Paid, 846.20);
  const search = f.api.searchRecord;
  f.api.searchRecord = async args => args.Entity === 'Supplier_Pay_Allocations' ? { status: 204 } : search(args);
  f.api.updateRecord = update;
  const ui = workflowUI(f);
  await ui.workflow.open('p1');
  assert.equal(ui.element('payment-fields').hidden, true);
  assert.equal(ui.element('submit').textContent, 'Confirm payment link');
  await ui.element('form').listeners.submit({ preventDefault() {} });
  assert.equal(f.db.Prepayments[0].Vendor_Payment.id, 'pay1');
  assert.equal(f.db.Prepayments[0].Accounting_Status, 'Prepayment recorded');
  assert.equal(f.calls.filter(c => c.function).length, 1);
});

test('saved and searchable allocations are counted once when confirming an existing payment', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', invoiceInput);
  const update = f.api.updateRecord;
  f.api.updateRecord = async args => { if (args.Entity === 'Prepayments' && args.APIData.Vendor_Payment) throw Error('Link failed'); return update(args); };
  await assert.rejects(f.service.savePayment('p1', paymentInput), /Link failed/);
  assert.equal(f.calls.filter(c => c.rebuild).length, 2, 'invoice and payment both rebuild before the failed prepayment link');
  const choices = await f.service.options(await f.service.context('p1'));
  assert.equal(choices.existingPayments[0].allocated, 300);
});

test('mismatched created payments report actual values and remain unlinked on retry', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', invoiceInput);
  const execute = f.zoho.CRM.FUNCTIONS.execute;
  f.zoho.CRM.FUNCTIONS.execute = async (...args) => {
    const result = await execute(...args);
    Object.assign(f.db.Supplier_Payments[0], { Payment_Amount: 1000, Currency: 'USD', Status: 'Draft' });
    f.db.Supplier_Pay_Allocations[0].Allocated_Amount = 1000;
    return result;
  };
  await assert.rejects(f.service.savePayment('p1', paymentInput), /currency is USD.*status is Draft.*payment amount is 1000.*prepayment amount is 300.*allocated.*1000.*expected 300/);
  await assert.rejects(f.service.savePayment('p1', paymentInput), /No additional payment/);
  assert.equal(f.calls.filter(c => c.function).length, 1);
  assert.equal(f.db.Prepayments[0].Vendor_Payment, undefined);
});

test('returned allocation IDs must belong to the created payment and selected invoice', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', invoiceInput);
  const execute = f.zoho.CRM.FUNCTIONS.execute;
  f.zoho.CRM.FUNCTIONS.execute = async (...args) => {
    const result = await execute(...args);
    f.db.Supplier_Pay_Allocations[0].Supplier_Payment = { id: 'other-payment' };
    return result;
  };
  await assert.rejects(f.service.savePayment('p1', paymentInput), /no matching allocation found/);
  assert.equal(f.db.Prepayments[0].Vendor_Payment, undefined);
});

test('IRPF requires confirmation and updates the vendor before creating an invoice', async () => {
  const f = fixture();
  let confirmations = 0;
  await f.service.saveInvoice('p1', { ...invoiceInput, irpf: 7 }, async () => { confirmations++; return true; });
  assert.equal(confirmations, 1);
  assert.equal(f.db.Vendors[0].Is_Self_Employed, true);
  assert.equal(f.calls[0].Entity, 'Vendors');
  assert.equal(f.db.Supplier_Invoices[0].IRPF_Amount, 57.85);
});

test('declining self-employment creates nothing and permits retry with zero IRPF', async () => {
  const f = fixture();
  await assert.rejects(f.service.saveInvoice('p1', { ...invoiceInput, irpf: 15 }, async () => false), { code: 'IRPF_RESET' });
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.Vendors[0].Is_Self_Employed, false);
  await f.service.saveInvoice('p1', { ...invoiceInput, irpf: 0 });
  assert.equal(f.db.Supplier_Invoices[0].IRPF_Amount, 0);
});

test('a failed vendor update prevents invoice creation and can be retried', async () => {
  const f = fixture(), update = f.api.updateRecord;
  f.api.updateRecord = async () => ({ data: [{ code: 'NO_PERMISSION', message: 'Cannot update vendor' }] });
  await assert.rejects(f.service.saveInvoice('p1', { ...invoiceInput, irpf: 15 }, async () => true), /Cannot update vendor/);
  assert.equal(f.db.Supplier_Invoices.length, 0);
  f.api.updateRecord = update;
  await f.service.saveInvoice('p1', { ...invoiceInput, irpf: 15 }, async () => true);
  assert.equal(f.db.Supplier_Invoices.length, 1);
});

test('invalid IRPF, credit notes and insufficient payable fail before writes', async () => {
  for (const input of [{ irpf: -1 }, { irpf: 'invalid' }, { irpf: 150 }, { invoiceType: 'Credit Note' }, { amount: 300, irpf: 15 }]) {
    const f = fixture();
    await assert.rejects(f.service.saveInvoice('p1', { ...invoiceInput, ...input }, async () => true), /IRPF|invoice type/);
    assert.equal(f.calls.length, 0);
  }
});

function workflowUI(f) {
  const elements = new Map(), previews = [], files = [];
  function element(key) {
    if (!elements.has(key)) elements.set(key, {
      value: '', innerHTML: '', hidden: false, disabled: false, listeners: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      querySelectorAll() { return []; }, querySelector() { return null; },
      setAttribute() {}, focus() {}, reportValidity() { return true; }
    });
    return elements.get(key);
  }
  const modal = element('modal');
  modal.querySelector = selector => element(selector.includes('close') ? 'close' : selector.match(/data-prepayment-workflow-([^\]]+)/)[1]);
  const document = {
    getElementById: element, querySelectorAll() { return []; }, querySelector() { return null; }, addEventListener() {},
    body: { appendChild(preview) { previews.push(preview); } },
    createElement() { const children = {}; return { querySelector(key) { return children[key] || (children[key] = {}); }, remove() {} }; }
  };
  const uiWindow = {
    ZOHO: f.zoho, document, sessionStorage: f.storage, addEventListener() {}, requestAnimationFrame(fn) { fn(); }, setTimeout() {},
    URL: { createObjectURL() { return 'blob:prepayment'; }, revokeObjectURL() {} }
  };
  f.api.getFile = async ({ id }) => { files.push(id); return new Blob(['PDF'], { type: 'application/pdf' }); };
  const context = { window: uiWindow, document, Intl, Blob };
  for (const file of ['invoice-name.js', 'quick-settlement-refresh.js', 'prepayments.js', 'prepayment-workflow.js']) vm.runInNewContext(fs.readFileSync('app/scripts/' + file, 'utf8'), context);
  uiWindow.AccountingManagerApp.createPrepaymentsWorkspace = null;
  vm.runInNewContext(fs.readFileSync('app/scripts/operations.js', 'utf8'), context);
  const workflow = uiWindow.AccountingManagerApp.createPrepaymentWorkflow({ querySelector: () => modal }, f.zoho, async () => {});
  return { workflow, element, previews, files };
}

test('quick form defaults to Proforma, recalculates IRPF and submits the selected invoice type', async () => {
  const f = fixture(), ui = workflowUI(f);
  f.db.Vendors[0].Is_Self_Employed = true;
  await ui.workflow.open('p1');
  assert.equal(ui.element('invoice-type').value, 'Proforma');
  for (const [key, value] of Object.entries({ reference: 'QUICK-1', date: '2026-09-15', amount: '1210', vat: '21', irpf: '15', 'invoice-type': 'Final Invoice' })) ui.element(key).value = value;
  ui.element('irpf').listeners.input();
  assert.equal(ui.element('irpf-amount').value, '150.00');
  assert.equal(ui.element('total-payable').value, '1060.00');
  await ui.element('form').listeners.submit({ preventDefault() {} });
  assert.equal(f.db.Supplier_Invoices[0].Invoice_Type, 'Final Invoice');
  assert.equal(f.db.Supplier_Invoices[0].Total_Payable_Amount, 1060);
});

test('quick form self-employment prompt can reset IRPF or approve the vendor update', async () => {
  for (const approved of [false, true]) {
    const f = fixture(), ui = workflowUI(f);
    await ui.workflow.open('p1');
    for (const [key, value] of Object.entries({ reference: 'IRPF-1', date: '2026-09-15', amount: '1000', vat: '21', irpf: '15' })) ui.element(key).value = value;
    const save = ui.element('form').listeners.submit({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.element('self-employed-confirmation').hidden, false);
    assert.equal(ui.element('fields').disabled, true);
    assert.equal(ui.element('self-employed-yes').disabled, false);
    ui.element(approved ? 'self-employed-yes' : 'self-employed-no').listeners.click();
    await save;
    assert.equal(ui.element('self-employed-confirmation').hidden, true);
    assert.equal(f.db.Supplier_Invoices.length, approved ? 1 : 0);
    assert.equal(f.db.Vendors[0].Is_Self_Employed, approved);
    if (!approved) {
      assert.equal(ui.element('irpf').value, '0');
      assert.equal(ui.element('total-payable').value, '1000.00');
    }
  }
});

test('proforma and invoice attachments use Card Purchase file buttons and open the shared PDF preview', async () => {
  const f = fixture(), ui = workflowUI(f);
  f.db.Prepayment_Requests[0].Proforma_Attached = [{ File_Name: '<proforma>.pdf', id: 'relation1', $file_id: 'proforma-file' }];
  f.db.Prepayment_Requests[0].Invoice_Attached = [{ File_Name: 'Invoice.pdf', id: 'relation2', $file_id: 'invoice-file' }];
  await ui.workflow.open('p1');
  const html = ui.element('documents').innerHTML;
  assert.match(html, /class="card-purchase-file"/);
  assert.match(html, /&lt;proforma&gt;.pdf/);
  assert.match(html, /Invoice.pdf/);
  for (const index of [0, 1]) {
    ui.element('documents').listeners.click({ target: { closest() { return { getAttribute() { return String(index); } }; } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(ui.previews[index].querySelector('.operations-file-preview-content').innerHTML, /<iframe src="blob:prepayment"/);
  }
  assert.deepEqual(ui.files, ['proforma-file', 'invoice-file']);
});

test('linking compares 1320 EUR prepayment to Total Payable Amount regardless of the pending balance', async () => {
  for (const balance of [null, '', 0, 1000, 1320]) {
    const f = fixture();
    f.db.Prepayments[0].Amount = 1320;
    f.db.Supplier_Invoices.push({ id: 'existing', Supplier: { id: 's1' }, Booking: { id: 'b1' }, Supplier_Settlement: { id: 'st1' }, Currency: 'EUR', Total_Payable_Amount: 1320, Amount_Paid: 0, Unpaid_Invoiced_Amount: balance });
    await f.service.saveInvoice('p1', { existingInvoiceId: 'existing' });
    assert.equal(f.db.Prepayments[0].Vendor_Invoice.id, 'existing');
    assert.equal(f.db.Prepayments[0].Accounting_Status, 'Pending payment record');
    assert.equal(f.calls.filter(c => c.function || c.create).length, 0);
  }
});

test('linking uses total payable after IRPF and rejects missing or invalid totals', async () => {
  for (const total of [1122, 0, null, '', 'invalid']) {
    const f = fixture();
    f.db.Prepayments[0].Amount = 1320;
    f.db.Supplier_Invoices.push({ id: 'existing', Supplier: { id: 's1' }, Booking: { id: 'b1' }, Supplier_Settlement: { id: 'st1' }, Invoice_Total: 1320, Total_Payable_Amount: total, Amount_Paid: 0, Unpaid_Invoiced_Amount: 1320 });
    await assert.rejects(f.service.saveInvoice('p1', { existingInvoiceId: 'existing' }), /Total Payable Amount/);
    assert.equal(f.calls.length, 0);
  }
});

test('a linked invoice still needs enough pending balance before registering a payment', async () => {
  for (const amounts of [
    { Amount_Paid: 320, Unpaid_Invoiced_Amount: 1000 },
    { Amount_Paid: 1320, Unpaid_Invoiced_Amount: 0 },
    { Amount_Paid: 0, Unpaid_Invoiced_Amount: 0 },
    { Amount_Paid: 320, Unpaid_Invoiced_Amount: '' }
  ]) {
    const f = fixture();
    f.db.Prepayments[0].Amount = 1320;
    f.db.Supplier_Invoices.push({ id: 'existing', Supplier: { id: 's1' }, Booking: { id: 'b1' }, Supplier_Settlement: { id: 'st1' }, Total_Payable_Amount: 1320, ...amounts });
    await f.service.saveInvoice('p1', { existingInvoiceId: 'existing' });
    await assert.rejects(f.service.savePayment('p1', paymentInput), /pending amount .*prepayment .*1,320.00/);
    assert.equal(f.calls.filter(c => c.function).length, 0);
  }
});

function attachExistingPayment(f, overrides = {}) {
  f.db.Supplier_Invoices.push({ id: 'existing', Name: 'INV-PAID', Supplier: { id: 's1' }, Booking: { id: 'b1' }, Supplier_Settlement: { id: 'st1' }, Currency: 'EUR', Total_Payable_Amount: 1320, Amount_Paid: 1320, Unpaid_Invoiced_Amount: 0 });
  f.db.Prepayments[0].Vendor_Invoice = { id: 'existing' };
  f.db.Prepayments[0].Accounting_Status = 'Pending payment record';
  f.db.Supplier_Payments.push({ id: 'paid1', Name: 'PAY-EXISTING', Payment_Date: '2026-09-12', Currency: 'EUR', Status: 'Paid', Payment_Amount: 1320, ...overrides });
  f.db.Supplier_Pay_Allocations.push({ id: 'allocation1', Supplier_Invoice: { id: 'existing' }, Supplier_Payment: { id: 'paid1' }, Allocated_Amount: 1320 });
}

test('existing payment confirmation only updates the prepayment link, date and status', async () => {
  const f = fixture();
  attachExistingPayment(f);
  f.db.Prepayments[0].Amount = 1320;
  const choices = await f.service.options(await f.service.context('p1'));
  assert.equal(choices.existingPayments.length, 1);
  assert.equal(choices.accounts.length, 0);
  await f.service.linkPayment('p1', 'paid1');
  assert.equal(f.db.Prepayments[0].Vendor_Payment.id, 'paid1');
  assert.equal(f.db.Prepayments[0].Payment_Date, '2026-09-12');
  assert.equal(f.db.Prepayments[0].Accounting_Status, 'Prepayment recorded');
  assert.equal(f.calls.filter(c => c.update).length, 1);
  assert.equal(f.calls.find(c => c.update).Entity, 'Prepayments');
  assert.equal(f.db.Supplier_Invoices[0].Amount_Paid, 1320);
  assert.equal(f.db.Supplier_Pay_Allocations.length, 1);
});

test('existing payment is the only form action, without requiring payment account access', async () => {
  const f = fixture();
  attachExistingPayment(f);
  f.api.getAllRecords = async () => { throw new Error('Payment accounts should not be requested'); };
  const ui = workflowUI(f);
  await ui.workflow.open('p1');
  assert.equal(ui.element('payment-fields').hidden, true);
  assert.equal(ui.element('payment-fields').disabled, true);
  assert.equal(ui.element('link-payment-fields').hidden, false);
  assert.equal(ui.element('existing-payment-choice').hidden, true);
  assert.equal(ui.element('submit').textContent, 'Confirm payment link');
  assert.match(ui.element('existing-payment-details').innerHTML, /PAY-EXISTING/);
  assert.match(ui.element('existing-payment-details').innerHTML, /2026-09-12/);
  await ui.element('form').listeners.submit({ preventDefault() {} });
  assert.equal(f.db.Prepayments[0].Vendor_Payment.id, 'paid1');
  assert.equal(ui.element('submit').hidden, true);
  assert.equal(f.calls.filter(c => c.function || c.create).length, 0);
});

test('linking an invoice immediately offers its existing payment', async () => {
  const f = fixture();
  attachExistingPayment(f);
  delete f.db.Prepayments[0].Vendor_Invoice;
  f.db.Prepayments[0].Accounting_Status = 'Pending invoice';
  const ui = workflowUI(f);
  await ui.workflow.open('p1');
  ui.element('existing').value = 'existing';
  await ui.element('form').listeners.submit({ preventDefault() {} });
  assert.equal(ui.element('link-payment-fields').hidden, false);
  assert.equal(ui.element('payment-fields').hidden, true);
  assert.equal(ui.element('submit').textContent, 'Confirm payment link');
});

test('multiple invoice payments are selectable and confirmation uses the selected payment', async () => {
  const f = fixture();
  attachExistingPayment(f);
  f.db.Supplier_Payments.push({ id: 'paid2', Name: 'SECOND', Status: 'Reconciled', Payment_Amount: 500, Payment_Date: '2026-09-14' });
  f.db.Supplier_Pay_Allocations.push({ id: 'allocation2', Supplier_Invoice: { id: 'existing' }, Supplier_Payment: { id: 'paid2' }, Allocated_Amount: 500 });
  const ui = workflowUI(f);
  await ui.workflow.open('p1');
  assert.equal(ui.element('existing-payment-choice').hidden, false);
  ui.element('existing-payment').value = 'paid2';
  ui.element('existing-payment').listeners.change();
  assert.match(ui.element('existing-payment-details').innerHTML, /SECOND/);
  await ui.element('form').listeners.submit({ preventDefault() {} });
  assert.equal(f.db.Prepayments[0].Vendor_Payment.id, 'paid2');
});

test('an existing payment discovered at submit time prevents creation and switches the form to confirmation', async () => {
  const f = fixture(), ui = workflowUI(f);
  await f.service.saveInvoice('p1', invoiceInput);
  await ui.workflow.open('p1');
  const invoiceId = f.db.Prepayments[0].Vendor_Invoice.id;
  f.db.Supplier_Payments.push({ id: 'late', Name: 'Late payment', Status: 'Paid', Payment_Amount: 300 });
  f.db.Supplier_Pay_Allocations.push({ id: 'late-alloc', Supplier_Invoice: { id: invoiceId }, Supplier_Payment: { id: 'late' }, Allocated_Amount: 300 });
  ui.element('payment-date').value = '2026-09-15';
  ui.element('account').value = 'a1';
  await ui.element('form').listeners.submit({ preventDefault() {} });
  assert.equal(f.calls.filter(c => c.function).length, 0);
  assert.equal(ui.element('payment-fields').hidden, true);
  assert.equal(ui.element('submit').textContent, 'Confirm payment link');
});

test('confirmation rechecks payment status, currency and allocation before changing the prepayment', async () => {
  for (const change of [
    f => { f.db.Supplier_Payments[0].Status = 'Cancelled'; },
    f => { f.db.Supplier_Payments[0].Status = 'Draft'; },
    f => { f.db.Supplier_Payments[0].Currency = 'USD'; },
    f => { f.db.Supplier_Pay_Allocations[0].Allocated_Amount = 100; },
    f => { f.db.Supplier_Pay_Allocations = []; }
  ]) {
    const f = fixture();
    attachExistingPayment(f);
    await f.service.options(await f.service.context('p1'));
    change(f);
    await assert.rejects(f.service.linkPayment('p1', 'paid1'), /no longer associated|must be paid/);
    assert.equal(f.calls.length, 0);
  }
});

test('failed linking can be retried without creating a payment', async () => {
  const f = fixture(), update = f.api.updateRecord;
  attachExistingPayment(f);
  f.api.updateRecord = async () => { throw new Error('Link failed'); };
  await assert.rejects(f.service.linkPayment('p1', 'paid1'), /Link failed/);
  f.api.updateRecord = update;
  await f.service.linkPayment('p1', 'paid1');
  assert.equal(f.calls.filter(c => c.function || c.create).length, 0);
  assert.equal(f.db.Prepayments[0].Accounting_Status, 'Prepayment recorded');
});

test('proforma preview and Reported By remain available in invoice creation, payment creation and payment linking', async () => {
  for (const phase of ['invoice', 'payment', 'link-payment']) {
    const f = fixture();
    f.db.Prepayment_Requests[0].Requested_By_2 = '<requester>@example.com';
    f.db.Prepayment_Requests[0].Proforma_Attached = [{ File_Name: 'Proforma.pdf', $file_id: 'proforma-file' }];
    if (phase === 'payment') await f.service.saveInvoice('p1', invoiceInput);
    if (phase === 'link-payment') attachExistingPayment(f);
    const ui = workflowUI(f);
    await ui.workflow.open('p1');
    assert.match(ui.element('context').innerHTML, /Reported By<\/dt><dd>&lt;requester&gt;@example.com/);
    assert.match(ui.element('documents').innerHTML, /aria-label="Preview Proforma: Proforma.pdf"/);
    assert.match(ui.element('documents').innerHTML, /prepayment-preview-action">Preview/);
    ui.element('documents').listeners.click({ target: { closest() { return { getAttribute() { return '0'; } }; } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(ui.files, ['proforma-file']);
    assert.match(ui.previews[0].querySelector('.operations-file-preview-content').innerHTML, /<iframe.*Proforma.pdf/);
  }
});

test('quick form previews general request attachments when Proforma Attached is empty', async () => {
  const f = fixture();
  f.api.getRelatedRecords = async request => {
    assert.equal(request.Entity, 'Prepayment_Requests');
    assert.equal(request.RecordID, 'r1');
    assert.equal(request.RelatedList, 'Attachments');
    return { data: [{ id: 'attachment-relation', $file_id: 'general-proforma', File_Name: 'Proforma.pdf' }] };
  };
  const ui = workflowUI(f);
  await ui.workflow.open('p1');
  assert.equal(ui.element('documents').hidden, false);
  assert.match(ui.element('documents').innerHTML, /Request attachments/);
  assert.match(ui.element('documents').innerHTML, /Preview Request attachments: Proforma.pdf/);
  ui.element('documents').listeners.click({ target: { closest() { return { getAttribute() { return '0'; } }; } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ui.files, ['general-proforma']);
  assert.match(ui.previews[0].querySelector('.operations-file-preview-content').innerHTML, /<iframe/);
});

test('missing documents and attachment read failures are visible in the quick form', async () => {
  const f = fixture();
  f.api.getRelatedRecords = async () => { throw new Error('Permission denied'); };
  const ui = workflowUI(f);
  await ui.workflow.open('p1');
  const html = ui.element('documents').innerHTML;
  assert.match(html, /No proforma associated/);
  assert.match(html, /attachments could not be loaded/);
  assert.doesNotMatch(html, /Open prepayment request in CRM/);
});

test('prepayment quick forms rebuild settlements after invoice creation, payment creation and existing payment linking', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', invoiceInput);
  assert.equal(f.calls.filter(c => c.rebuild).length, 1);
  assert.equal(f.calls.find(c => c.rebuild).rebuild, 'st1');
  await f.service.savePayment('p1', paymentInput);
  assert.equal(f.calls.filter(c => c.rebuild).length, 2);
  const linked = fixture();
  attachExistingPayment(linked);
  await linked.service.linkPayment('p1', 'paid1');
  assert.equal(linked.calls.find(c => c.rebuild).rebuild, 'st1');
});

test('settlement rebuild failure preserves the created invoice and reports a warning without duplicating it', async () => {
  const f = fixture(), execute = f.zoho.CRM.FUNCTIONS.execute;
  f.zoho.CRM.FUNCTIONS.execute = async (name, args) => name === 'rebuildsuppliersettlementtotals' ? { details: { output: JSON.stringify({ error: true, message: 'Rebuild failed' }) } } : execute(name, args);
  const ctx = await f.service.saveInvoice('p1', invoiceInput);
  assert.match(ctx.settlementWarning, /record was saved.*Rebuild failed/);
  assert.equal(ctx.payment.Accounting_Status, 'Pending payment record');
  await f.service.saveInvoice('p1', invoiceInput);
  assert.equal(f.db.Supplier_Invoices.length, 1);
});

test('discarded prepayments cannot create invoices or payments and open in read-only mode', async () => {
  for (const status of ['Discard - Credit', 'Discard - Already Paid']) {
    const f = fixture();
    f.db.Prepayments[0].Accounting_Status = status;
    await assert.rejects(f.service.saveInvoice('p1', invoiceInput), /discarded/);
    await assert.rejects(f.service.savePayment('p1', paymentInput), /discarded/);
    await assert.rejects(f.service.linkPayment('p1', 'existing'), /discarded/);
    const ui = workflowUI(f);
    await ui.workflow.open('p1');
    assert.equal(ui.element('submit').hidden, true);
    assert.equal(ui.element('invoice-fields').disabled, true);
    assert.equal(ui.element('payment-fields').disabled, true);
    assert.equal(f.calls.length, 0);
  }
});

test('file-field previews do not query the separately restricted Attachments list', async () => {
  for (const field of ['Proforma_Attached', 'Invoice_Attached']) {
    const f = fixture();
    f.db.Prepayment_Requests[0][field] = [{ File_Name: 'Document.pdf', $file_id: 'file1' }];
    let requests = 0;
    f.api.getRelatedRecords = async () => { requests++; throw { code: 'NO_PERMISSION' }; };
    const ui = workflowUI(f);
    await ui.workflow.open('p1');
    assert.equal(requests, 0);
    assert.match(ui.element('documents').innerHTML, /Document.pdf/);
    assert.doesNotMatch(ui.element('documents').innerHTML, /could not be loaded/);
  }
});

test('optional attachment permission errors are quiet and not retried for the same request', async () => {
  for (const mode of ['resolved', 'rejected', 'xhr']) {
    const f = fixture();
    let requests = 0;
    f.api.getRelatedRecords = async () => {
      requests++;
      const error = { code: 'NO_PERMISSION', details: { permissions: ['Crm_Implied_View_Attachments'] }, message: 'permission denied', status: 'error' };
      if (mode === 'rejected') throw error;
      if (mode === 'xhr') throw { responseText: JSON.stringify(error) };
      return error;
    };
    const first = await f.service.context('p1');
    const second = await f.service.context('p1');
    assert.equal(first.request._documentError, undefined);
    assert.equal(second.request._documentError, undefined);
    assert.equal(requests, 1);
  }
});

test('quick payment synchronizes the parent after linking, and reports parent failures without duplicating payment', async () => {
  const f = fixture(), seen = [];
  ns.syncPrepaymentRequest = async (crm, requestId) => {
    assert.equal(f.db.Prepayments[0].Accounting_Status, 'Prepayment recorded');
    seen.push(requestId); throw new Error('Request permission denied');
  };
  try {
    await f.service.saveInvoice('p1', invoiceInput);
    const result = await f.service.savePayment('p1', paymentInput);
    assert.deepEqual(seen, ['r1']);
    assert.match(result.settlementWarning, /Request permission denied/);
    assert.equal(f.db.Supplier_Payments.length, 1);
  } finally { delete ns.syncPrepaymentRequest; }
});
