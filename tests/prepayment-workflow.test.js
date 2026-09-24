const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const file of ['invoice-name.js', 'quick-settlement-refresh.js', 'prepayments.js', 'prepayment-allocations.js', 'prepayment-workflow.js']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + file, 'utf8'), { window, Intl });
}
const ns = window.AccountingManagerApp;
function fixture() {
  const db = {
    Prepayment_Invoice_Allocations: [], Prepayment_Request_Services: [], Booking_Services: [],
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
    async deleteRecord({ Entity, RecordID }) {
      db[Entity] = db[Entity].filter(row => row.id !== RecordID);
      return {data:[{code:'SUCCESS'}]};
    },
    async insertRecord({ Entity, APIData }) {
      APIData = Array.isArray(APIData) ? APIData : [APIData];
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
  const zoho = { CRM: { API: api, META: { async getFields({ Entity } = {}) { if (Entity === "Prepayment_Invoice_Allocations") return {fields:[{api_name:"Name",unique:{casesensitive:false}}]}; return { fields: [
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
    const invoices = input.supplierInvoiceIds.split('|||').map(id => db.Supplier_Invoices.find(r => r.id === id));
    const amount = Object.values(payment.allocations).reduce((a,b) => a+b,0);
    db.Supplier_Payments.push({ id: 'pay1', Currency: payment.Currency, Payment_Date: '2026-09-23', Payment_Amount: amount, Status: 'Paid' });
    invoices.forEach((invoice,index) => { db.Supplier_Pay_Allocations.push({ id: 'alloc' + (index+1), Supplier_Payment: { id: 'pay1' }, Supplier_Invoice: { id: invoice.id }, Allocated_Amount: payment.allocations[invoice.id] }); invoice.Amount_Paid += payment.allocations[invoice.id]; });
    return { details: { output: JSON.stringify({ payment_id: 'pay1', error: false, allocation_ids: invoices.map((_,index) => 'alloc' + (index+1)) }) } };
  } } } };
  return { db, calls, api, zoho, storage, service: ns.createPrepaymentWorkflowService(zoho, storage) };
}
const invoiceInput = { reference: 'INV-1', date: '2026-09-11', amount: 1000, vat: 21, settlementId: 'st1' };
const paymentInput = { date: '2026-09-11', accountId: 'a1' };

test('prepayment creation lets CRM assign today and copies the saved date instead of form or old prepayment dates', async () => {
  const f = fixture();
  f.db.Prepayments[0].Payment_Date = '2020-01-01';
  await f.service.saveInvoice('p1', invoiceInput);
  const ui = workflowUI(f);
  await ui.workflow.open('p1');
  assert.equal(ui.element('payment-date').readOnly,true);
  assert.notEqual(ui.element('payment-date').value,'2020-01-01');
  await f.service.savePayment('p1',{...paymentInput,date:'2000-01-01'});
  assert.equal(Object.hasOwn(f.calls.find(c=>c.payment).payment,'Payment_Date'),false);
  assert.equal(f.db.Prepayments[0].Payment_Date,'2026-09-23');
});

test('retrying the prepayment link preserves the original saved payment date', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1',invoiceInput);
  const update=f.api.updateRecord;
  f.api.updateRecord=async args=>{if(args.APIData.Vendor_Payment) throw Error('Link failed'); return update(args);};
  await assert.rejects(f.service.savePayment('p1',paymentInput),/Link failed/);
  f.api.updateRecord=update;
  await ns.createPrepaymentWorkflowService(f.zoho,f.storage).savePayment('p1',{...paymentInput,date:'2026-10-01'});
  assert.equal(f.db.Supplier_Payments.length,1);
  assert.equal(f.db.Prepayments[0].Payment_Date,'2026-09-23');
});

test('two final invoices split one prepayment into one payment with two verified allocations', async () => {
  const f = fixture();
  let ctx = await f.service.saveInvoice('p1', { ...invoiceInput, reference:'A', amount:100, allocatedAmount:100, invoiceType:'Final Invoice' });
  assert.equal(ctx.allocations.remaining, 200);
  assert.equal(ctx.payment.Accounting_Status, 'Pending invoice');
  await assert.rejects(f.service.savePayment('p1', paymentInput), /full prepayment/);
  ctx = await f.service.saveInvoice('p1', { ...invoiceInput, reference:'B', amount:500, allocatedAmount:200, invoiceType:'Final Invoice' });
  assert.equal(ctx.allocations.complete, true);
  assert.equal(f.db.Prepayment_Invoice_Allocations.length, 2);
  assert.equal(ctx.payment.Vendor_Invoice, undefined);
  assert.deepEqual(f.db.Supplier_Invoices.map(row => row.Invoice_Type), ['Final Invoice','Final Invoice']);
  await f.service.savePayment('p1', paymentInput);
  const call = f.calls.find(row => row.payment);
  assert.equal(call.input.supplierInvoiceIds, f.db.Supplier_Invoices.map(row => row.id).join('|||'));
  assert.deepEqual(Object.values(call.payment.allocations), [100,200]);
  assert.equal(f.db.Supplier_Payments.length, 1);
  assert.equal(f.db.Supplier_Payments[0].Payment_Amount, 300);
  assert.equal(f.db.Prepayments[0].Accounting_Status, 'Prepayment recorded');
});

test('two-invoice form remains on invoice entry until fully allocated and displays both associations', async () => {
  const f = fixture(), ui = workflowUI(f);
  await f.service.saveInvoice('p1', { ...invoiceInput, reference:'A', allocatedAmount:100 });
  await ui.workflow.open('p1');
  assert.equal(ui.element('invoice-fields').hidden, false);
  assert.equal(ui.element('allocated').value, 200);
  assert.match(ui.element('allocations').innerHTML, /Remaining:.*200/);
  await f.service.saveInvoice('p1', { ...invoiceInput, reference:'B', allocatedAmount:200 });
  await ui.workflow.open('p1');
  assert.equal(ui.element('payment-fields').hidden, false);
  assert.equal((ui.element('allocations').innerHTML.match(/data-remove-allocation=/g) || []).length, 2);
});

test('removing an association preserves the invoice and permits a corrected split', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', { ...invoiceInput, allocatedAmount:100 });
  const invoiceId = f.db.Supplier_Invoices[0].id;
  await f.service.removeInvoice('p1', f.db.Prepayment_Invoice_Allocations[0].id);
  assert.equal(f.db.Supplier_Invoices.length, 1);
  assert.equal(f.db.Prepayment_Invoice_Allocations.length, 0);
  const ctx = await f.service.saveInvoice('p1', { existingInvoiceId:invoiceId, allocatedAmount:300 });
  assert.equal(ctx.allocations.complete, true);
});

test('over-allocation and non-unique allocation names prevent any invoice creation', async () => {
  const f = fixture();
  await assert.rejects(f.service.saveInvoice('p1', {...invoiceInput, allocatedAmount:301}), /remaining/);
  const metadata = f.zoho.CRM.META.getFields;
  f.zoho.CRM.META.getFields = args => args.Entity === 'Prepayment_Invoice_Allocations' ? {fields:[{api_name:'Name',unique:{}}]} : metadata(args);
  await assert.rejects(f.service.saveInvoice('p1', invoiceInput), /disallow duplicates/);
  assert.equal(f.db.Supplier_Invoices.length, 0);
});

test('one paid invoice cannot confirm a prepayment spread across two invoices', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', {...invoiceInput, reference:'A', allocatedAmount:100});
  await f.service.saveInvoice('p1', {...invoiceInput, reference:'B', allocatedAmount:200});
  f.db.Supplier_Payments.push({id:'old',Status:'Paid',Currency:'EUR',Payment_Amount:300});
  f.db.Supplier_Pay_Allocations.push({id:'a', Supplier_Payment:{id:'old'},Supplier_Invoice:{id:f.db.Supplier_Invoices[0].id},Allocated_Amount:300});
  await assert.rejects(f.service.linkPayment('p1','old'), /no longer associated/);
  assert.equal(f.db.Prepayments[0].Vendor_Payment, undefined);
});

test('an existing payment cannot be consumed twice by different prepayments', async () => {
  const f = fixture();
  attachExistingPayment(f);
  f.db.Prepayments.push({id:'other',Amount:1200,Currency:'EUR',Vendor_Payment:{id:'paid1'}});
  f.db.Prepayment_Invoice_Allocations.push({id:'other-link',Prepayment:{id:'other'},Vendor_Invoice:{id:'existing'},Allocated_Amount:1200,Currency:'EUR'});
  await assert.rejects(f.service.linkPayment('p1','paid1'), /no longer associated/);
  assert.equal(f.db.Prepayments[0].Vendor_Payment, undefined);
});

test('failure verifying the second payment allocation preserves the payment for retry', async () => {
  const f = fixture();
  await f.service.saveInvoice('p1', {...invoiceInput, reference:'A', allocatedAmount:100});
  await f.service.saveInvoice('p1', {...invoiceInput, reference:'B', allocatedAmount:200});
  const get = f.api.getRecord;
  f.api.getRecord = args => {
    if (args.Entity === 'Supplier_Pay_Allocations' && args.RecordID === 'alloc2') throw Error('temporarily unavailable');
    return get(args);
  };
  await assert.rejects(f.service.savePayment('p1',paymentInput), /No additional payment/);
  await assert.rejects(f.service.removeInvoice('p1',f.db.Prepayment_Invoice_Allocations[0].id), /pending operation/);
  f.api.getRecord = get;
  await ns.createPrepaymentWorkflowService(f.zoho,f.storage).savePayment('p1',paymentInput);
  assert.equal(f.db.Supplier_Payments.length,1);
  assert.equal(f.db.Prepayments[0].Accounting_Status,'Prepayment recorded');
});

test('associated services use only the junction, deduplicate and support multiple requests', async () => {
  const f = fixture();
  f.db.Booking_Services = [
    { id: 'sv2', Product_Description: 'Later', Service_Date: '2026-09-12' },
    { id: 'sv1', Product_Description: 'First', Service_Date: '2026-09-11' },
    { id: 'sv3', Supplier: { id: 's1' }, Booking: { id: 'b1' } }
  ];
  f.db.Prepayment_Request_Services = [
    {id:'l1', Prepayment_Request:{id:'r1'}, Booking_Service:{id:'sv1'}},
    {id:'l2', Prepayment_Request:{id:'r1'}, Booking_Service:{id:'sv2'}},
    {id:'l3', Prepayment_Request:{id:'r1'}, Booking_Service:{id:'sv1'}},
    {id:'l4', Prepayment_Request:{id:'other'}, Booking_Service:{id:'sv1'}}
  ];
  const result = await f.service.relatedServices(await f.service.context('p1'), 'st1');
  assert.deepEqual(Array.from(result.records, row => row.id), ['sv1', 'sv2']);
  assert.match(result.description, /linked to this prepayment request/);
});

test('an empty junction does not associate unrelated supplier or settlement services', async () => {
  const f = fixture();
  f.db.Booking_Services = [{id:'sv1', Supplier_Settlement:{id:'st1'}, Supplier:{id:'s1'}, Booking:{id:'b1'}, Prepayment_Request:{id:'r1'}}];
  const result = await f.service.relatedServices(await f.service.context('p1'), 'st1');
  assert.equal(result.records.length, 0);
});

test('association search and missing service errors are not reported as an empty result', async () => {
  const f = fixture(), ctx = await f.service.context('p1');
  const search = f.api.searchRecord;
  f.api.searchRecord = async () => { throw Error('Permission denied'); };
  await assert.rejects(f.service.relatedServices(ctx), /Permission denied/);
  f.api.searchRecord = search;
  f.db.Prepayment_Request_Services = [{id:'l1', Prepayment_Request:{id:'r1'}, Booking_Service:{id:'missing'}}];
  await assert.rejects(f.service.relatedServices(ctx), /Could not read/);
});

test('associated service descriptions and dates appear in invoice, payment and read-only asides', async () => {
  for (const phase of ['invoice', 'payment', 'view']) {
    const f = fixture();
    f.db.Booking_Services = [{ id: 'sv1', Supplier: { id: 's1' }, Booking: { id: 'b1' }, Supplier_Settlement: { id: 'st1' }, Product_Description: 'Tour <private>\nPickup at hotel', Service_Date: '2026-09-17' }];
    f.db.Prepayment_Request_Services = [{id:'l1', Prepayment_Request:{id:'r1'}, Booking_Service:{id:'sv1'}}];
    if (phase !== 'invoice') await f.service.saveInvoice('p1', invoiceInput);
    if (phase === 'view') f.db.Prepayments[0].Accounting_Status = 'Prepayment recorded';
    const ui = workflowUI(f);
    await ui.workflow.open('p1');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(ui.element('services').innerHTML, /Tour &lt;private&gt;\nPickup at hotel/);
    assert.match(ui.element('services').innerHTML, /17\/09\/2026/);
  }
});

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
  assert.equal(f.db.Prepayment_Invoice_Allocations[0].Vendor_Invoice.id, 'existing');
  assert.equal(f.calls.filter(c => c.create && c.Entity !== 'Prepayment_Invoice_Allocations').length, 0);
});

test('invoice lookup failure resumes the returned invoice ID after reopening', async () => {
  const f = fixture(), update = f.api.updateRecord;
  f.api.updateRecord = async args => {
    if (args.APIData.Accounting_Status === 'Pending payment record') { throw new Error('Link failed'); }
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
  for (const file of ['invoice-name.js', 'quick-settlement-refresh.js', 'prepayments.js', 'prepayment-allocations.js', 'prepayment-workflow.js']) vm.runInNewContext(fs.readFileSync('app/scripts/' + file, 'utf8'), context);
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
    assert.equal(f.db.Prepayment_Invoice_Allocations[0].Vendor_Invoice.id, 'existing');
    assert.equal(f.db.Prepayments[0].Accounting_Status, 'Pending payment record');
    assert.equal(f.calls.filter(c => c.function || c.create && c.Entity !== 'Prepayment_Invoice_Allocations').length, 0);
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
  f.db.Prepayment_Invoice_Allocations.push({ id: 'pia-existing', Prepayment: {id:'p1'}, Vendor_Invoice: {id:'existing'}, Currency:'EUR', get Allocated_Amount() { return f.db.Prepayments[0].Amount; } });
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
  assert.equal(f.calls.filter(c => c.function || c.create && c.Entity !== 'Prepayment_Invoice_Allocations').length, 0);
});

test('linking an invoice immediately offers its existing payment', async () => {
  const f = fixture();
  attachExistingPayment(f);
  f.db.Prepayment_Invoice_Allocations.length = 0;
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
  const invoiceId = f.db.Prepayment_Invoice_Allocations[0].Vendor_Invoice.id;
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
  assert.equal(f.calls.filter(c => c.function || c.create && c.Entity !== 'Prepayment_Invoice_Allocations').length, 0);
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
    assert.match(ui.element('documents').innerHTML, /aria-label="Preview Proforma \/ invoices: Proforma.pdf"/);
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


function serviceEditorFixture() {
  const f = fixture();
  f.storage.removeItem = key => f.storage.setItem(key, null);
  f.db.Booking_Services = [
    { id: 's-a', Booking: { id: 'b1' }, Supplier: { id: 's1' }, Service_Date: '2026-09-22', Product_Description: 'First service', Total_Purchase_Price: 100, Currency: 'EUR' },
    { id: 's-b', Booking: { id: 'b1' }, Supplier: { id: 's1' }, Service_Date: '2026-09-23', Product_Description: 'Second service', Total_Purchase_Price: 250.5, Currency: 'EUR' },
    { id: 'other-trip', Booking: { id: 'b2' }, Supplier: { id: 's1' } },
    { id: 'other-supplier', Booking: { id: 'b1' }, Supplier: { id: 's2' } }
  ];
  f.db.Prepayment_Request_Services = [{ id: 'old-link', Prepayment_Request: { id: 'r1' }, Booking_Service: { id: 's-a' } }, { id: 'other-request', Prepayment_Request: { id: 'r2' }, Booking_Service: { id: 's-a' } }];
  f.api.deleteRecord = async ({ Entity, RecordID }) => {
    const links = f.db[Entity];
    assert.ok(links.some(l => l.id !== RecordID && l.Prepayment_Request.id === 'r1'), 'retains at least one association');
    f.calls.push({ delete: RecordID });
    f.db[Entity] = links.filter(l => l.id !== RecordID);
    return { data: [{ code: 'SUCCESS' }] };
  };
  return f;
}

test('service editor lists only the supplier and booking and replaces links without touching other requests', async () => {
  const f = serviceEditorFixture();
  const choices = await f.service.serviceSelection(await f.service.context('p1'));
  assert.deepEqual(Array.from(choices.records, r => r.id), ['s-a', 's-b']);
  assert.deepEqual(Array.from(choices.selected), ['s-a']);
  const result = await f.service.saveServiceSelection('p1', ['s-b']);
  assert.deepEqual(Array.from(result.selected), ['s-b']);
  assert.ok(f.db.Prepayment_Request_Services.some(l => l.id === 'other-request'));
  assert.equal(f.calls[0].Entity, 'Prepayment_Request_Services');
  assert.equal(f.calls[1].delete, 'old-link');
  await f.service.saveServiceSelection('p1', ['s-b']);
  assert.equal(f.calls.length, 2, 'repeated saves are idempotent');
});

test('service editor rejects empty or foreign selections before writes', async () => {
  for (const selection of [[], ['other-trip'], ['other-supplier']]) {
    const f = serviceEditorFixture();
    await assert.rejects(f.service.saveServiceSelection('p1', selection), /at least one|supplier and booking/);
    assert.equal(f.calls.length, 0);
  }
});

test('failed association removal can be retried without duplicating additions', async () => {
  const f = serviceEditorFixture(), remove = f.api.deleteRecord;
  f.api.deleteRecord = async () => ({ data: [{ code: 'ERROR', message: 'Removal rejected' }] });
  await assert.rejects(f.service.saveServiceSelection('p1', ['s-b']), /Removal rejected/);
  assert.equal(f.db.Prepayment_Request_Services.filter(l => l.Prepayment_Request.id === 'r1').length, 2);
  f.api.deleteRecord = remove;
  await f.service.saveServiceSelection('p1', ['s-b']);
  assert.equal(f.calls.filter(c => c.create).length, 1);
});

test('failed association creation never removes the last service', async () => {
  const f = serviceEditorFixture();
  f.api.insertRecord = async () => ({ data: [{ code: 'ERROR', message: 'Creation rejected' }] });
  await assert.rejects(f.service.saveServiceSelection('p1', ['s-b']), /Creation rejected/);
  assert.ok(f.db.Prepayment_Request_Services.some(l => l.id === 'old-link'));
  assert.equal(f.calls.length, 0);
});

test('service editor allows native checkbox and label clicks and saves additional services', async () => {
  const f = serviceEditorFixture(), ui = workflowUI(f);
  await ui.workflow.open('p1');
  const click = attribute => ui.element('services').listeners.click({ preventDefault() {}, target: { closest: () => ({ hasAttribute: name => name === attribute }) } });
  await click('data-service-edit');
  for (const tagName of ['INPUT', 'LABEL', 'SPAN']) {
    let prevented = false;
    await ui.element('services').listeners.click({
      preventDefault() { prevented = true; },
      target: { tagName, closest: () => null }
    });
    assert.equal(prevented, false, tagName + ' must retain native checkbox activation');
  }
  ui.element('services').listeners.change({ target: { getAttribute: () => 's-b', checked: true } });
  assert.match(ui.element('services').innerHTML, /data-service-choice="s-b" checked/);
  assert.match(ui.element('services').innerHTML, /Selected: 2.*350\.50/);
  await click('data-service-save');
  assert.deepEqual(f.db.Prepayment_Request_Services.filter(l => l.Prepayment_Request.id === 'r1').map(l => l.Booking_Service.id), ['s-a', 's-b']);
});

test('service editor shows shared service details and recalculates the selected total before saving', async () => {
  const f = serviceEditorFixture(), ui = workflowUI(f);
  await ui.workflow.open('p1');
  const click = attribute => ui.element('services').listeners.click({ preventDefault() {}, target: { closest: () => ({ hasAttribute: name => name === attribute }) } });
  await click('data-service-edit');
  assert.match(ui.element('services').innerHTML, /First service/);
  assert.match(ui.element('services').innerHTML, /Second service/);
  assert.match(ui.element('services').innerHTML, /22\/09\/2026/);
  assert.match(ui.element('services').innerHTML, /Selected: 1.*100\.00/);
  const toggle = (id, checked) => ui.element('services').listeners.change({ target: { getAttribute: () => id, checked } });
  toggle('s-b', true);
  assert.match(ui.element('services').innerHTML, /Selected: 2.*350\.50/);
  toggle('s-a', false); toggle('s-b', false);
  assert.match(ui.element('services').innerHTML, /data-service-save disabled/);
  await ui.element('form').listeners.submit({ preventDefault() {} });
  assert.match(ui.element('message').textContent, /Save or cancel/);
  toggle('s-b', true);
  await click('data-service-save');
  assert.match(ui.element('services-message').textContent, /Associated services updated/);
  assert.deepEqual(f.db.Prepayment_Request_Services.filter(l => l.Prepayment_Request.id === 'r1').map(l => l.Booking_Service.id), ['s-b']);
});


test('service save uses SDK object payload and returns confirmed services despite stale search indexes', async () => {
  const f = serviceEditorFixture(), insert = f.api.insertRecord, search = f.api.searchRecord;
  const stale = structuredClone(f.db.Prepayment_Request_Services);
  f.api.insertRecord = async args => {
    assert.equal(Array.isArray(args.APIData), false);
    assert.equal(args.APIData.Booking_Service.id, 's-b');
    return insert(args);
  };
  f.api.searchRecord = args => args.Entity === 'Prepayment_Request_Services'
    ? Promise.resolve({ data: stale.filter(l => l.Prepayment_Request.id === 'r1') }) : search(args);
  const saved = await f.service.saveServiceSelection('p1', ['s-b']);
  assert.deepEqual(Array.from(saved.records, r => r.id), ['s-b']);
  assert.equal(f.db.Prepayment_Request_Services.some(l => l.id === 'old-link'), false);
});

test('service save failure stays in editor with a visible error and a successful retry restores reading mode', async () => {
  const f = serviceEditorFixture(), ui = workflowUI(f), remove = f.api.deleteRecord;
  await ui.workflow.open('p1');
  const click = (key, attribute) => ui.element(key).listeners.click({ preventDefault() {}, target: { closest: () => ({ hasAttribute: name => name === attribute }) } });
  await click('services-edit', 'data-service-edit');
  assert.equal(ui.element('services-edit').hidden, true);
  const toggle = (id, checked) => ui.element('services').listeners.change({ target: { getAttribute: () => id, checked } });
  toggle('s-b', true); toggle('s-a', false);
  f.api.deleteRecord = async () => ({ data: [{ code: 'ERROR', message: 'No permission to remove association' }] });
  await click('services', 'data-service-save');
  assert.equal(ui.element('services-message').hidden, false);
  assert.match(ui.element('services-message').textContent, /No permission/);
  assert.match(ui.element('services').innerHTML, /data-service-save/);
  assert.equal(ui.element('submit').disabled, false);
  f.api.deleteRecord = remove;
  await click('services', 'data-service-save');
  assert.doesNotMatch(ui.element('services').innerHTML, /data-service-save|First service/);
  assert.match(ui.element('services').innerHTML, /Second service/);
  assert.equal(ui.element('services-edit').hidden, false);
  assert.match(ui.element('services-message').textContent, /updated/);
});


test('associated settlement follows the linked invoice instead of a stale form selection', async () => {
  const f = fixture(), ctx = await f.service.context('p1');
  f.db.Supplier_Settlements.push({ id: 'st2', Supplier: { id: 's1' }, Booking: { id: 'b1' } });
  f.db.Supplier_Invoices.push({ id: 'inv1', Supplier_Settlement: { id: 'st2' } });
  assert.equal(await f.service.associatedSettlement(ctx, '', ''), null);
  assert.equal((await f.service.associatedSettlement(ctx, 'st1', '')).id, 'st1');
  assert.equal((await f.service.associatedSettlement(ctx, 'st1', 'inv1')).id, 'st2');
  ctx.allocations.rows = [{Vendor_Invoice:{id:'inv1'}}];
  assert.equal((await f.service.associatedSettlement(ctx, 'st1', '')).id, 'st2');
  f.db.Supplier_Settlements[1].Booking.id = 'foreign';
  await assert.rejects(f.service.associatedSettlement(ctx, '', ''), /supplier and booking/);
});

test('settlement summary shows CRM totals and pending amounts and updates for selected invoices', async () => {
  const f = fixture();
  Object.assign(f.db.Supplier_Settlements[0], { Name: 'Settlement 1', Total_Service_Cost: 1000, Total_Invoice: 600, Total_Paid: 250 });
  const ui = workflowUI(f);
  await ui.workflow.open('p1');
  await new Promise(resolve => setImmediate(resolve));
  let html = ui.element('settlement-summary').innerHTML;
  for (const value of ['Settlement 1', 'Total service cost', '1,000.00', 'Already invoiced', '600.00', 'Total paid', '250.00', 'Pending invoicing', '400.00', 'Unpaid invoiced amount', '350.00']) assert.ok(html.includes(value), value);
  f.db.Supplier_Settlements.push({ id: 'st2', Name: 'Settlement 2', Supplier: { id: 's1' }, Booking: { id: 'b1' }, Total_Service_Cost: 100, Total_Invoice: 120, Total_Paid: 120 });
  f.db.Supplier_Invoices.push({ id: 'inv2', Supplier_Settlement: { id: 'st2' } });
  ui.element('existing').value = 'inv2';
  ui.element('existing').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  html = ui.element('settlement-summary').innerHTML;
  assert.match(html, /Settlement 2/);
  assert.match(html, /-.*20\.00/);
  assert.match(html, /Unpaid invoiced amount<\/span><strong>[^<]*0\.00/);
  delete f.db.Supplier_Settlements[1].Total_Paid;
  ui.element('existing').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(ui.element('settlement-summary').innerHTML, /Unpaid invoiced amount<\/span><strong>Not provided/);
});
