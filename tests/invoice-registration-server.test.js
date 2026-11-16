const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers/deluge-registration-harness');
const key = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const seed = {
    Vendors: { '1': { id: '1', Vendor_Name: 'Supplier', Is_Self_Employed: true } },
    Deals: { '2': { id: '2', MFSP_Reference: 'MFSP-1' } },
    Supplier_Settlements: { '3': { id: '3', Supplier: { id: '1' }, Booking: { id: '2' }, Currency: 'EUR', Total_Invoice: 0, Total_Service_Cost: 500 } },
    Booking_Services: { '4': { id: '4', Supplier_Settlement: { id: '3' }, Total_Purchase_Price: 500, Status_EZUS: 'Confirmed' } }
  };
  const request = { supplier_id: '1', amount_mode: 'net', confirmed_excess: [], file_id: 'zfs-id',
    invoice: { Name: 'Invoice-1', Invoice_Date: '2026-10-08', Invoice_Type: 'Final Invoice', Supplier_Settlement: { id: '3' },
      Invoice_Amount_Excl_VAT: 100, Invoice_Amount_Incl_VAT: 121, VAT_percentage: 21, VAT_Amount: 21,
      IRPF_percentage: 15, IRPF_Amount: 15, Reimbursable_Expense: 10, Invoice_Total: 106, Total_Payable_Amount: 116 },
    allocations: [{ settlement_id: '3', amount: 116 }] };
  return { seed, request };
}

test('cancelled or locked settlements cannot receive new supplier invoices', () => {
  for (const fields of [{Admin_Status:'Cancelled'}, {Locked__s:true}]) {
    const {seed,request}=fixture();Object.assign(seed.Supplier_Settlements['3'],fields);
    const f=harness(seed),result=f.run(key,request);assert.equal(result.success,false);assert.equal(f.writes.length,0);
  }
});
test('a pending registration with external allocations cannot resume from a stale zero paid balance', () => {
  const {seed,request}=fixture(),f=harness(seed,{Inv_Set_Allocations:1});const first=f.run(key,request);
  f.database.Supplier_Pay_Allocations={'900':{id:'900',Supplier_Invoice:{id:first.invoice_id},Allocated_Amount:1}};
  const count=f.writes.length,result=f.run(key,request);assert.equal(result.success,false);assert.match(result.message,/payment allocations/);assert.equal(f.writes.length,count);
});
test('server creates one received unpaid invoice, distributes payable and retries idempotently', () => {
  const { seed, request } = fixture();
  const context = harness(seed);
  const first = context.run(key, request);
  assert.equal(first.success, true, first.message);
  const invoice = context.database.Supplier_Invoices[first.invoice_id];
  assert.equal(invoice.Status, 'Received');
  assert.equal(invoice.Amount_Paid, 0);
  assert.equal(Object.hasOwn(invoice, 'Accounting_Status'), false);
  assert.equal(invoice.Total_Payable_Amount, 116);
  assert.equal(invoice.Invoice_File[0].File_Id__s, 'zfs-id');
  assert.equal(Object.values(context.database.Inv_Set_Allocations)[0].Allocated_Amount, 116);
  const writes = context.writes.length;
  assert.equal(context.run(key, request).invoice_id, first.invoice_id);
  assert.equal(context.writes.length, writes);
  assert.ok(context.writes.every(write => !/Payment|Pay_Allocations/.test(write.module)));
});
test('server blocks missing, nonexistent or foreign settlements before creating an invoice', () => {
  for (const mode of ['none', 'missing', 'foreign']) {
    const { seed, request } = fixture();
    if (mode === 'none') { request.allocations = []; }
    if (mode === 'missing') { request.allocations[0].settlement_id = '99'; }
    if (mode === 'foreign') { seed.Supplier_Settlements['3'].Supplier.id = '99'; }
    const context = harness(seed);
    const result = context.run(key, request);
    assert.equal(result.success, false);
    assert.equal(context.writes.length, 0, mode + ': ' + result.message);
  }
});
test('partial allocation rejection resumes the original invoice with no duplicate lines or allocations', () => {
  const { seed, request } = fixture();
  seed.Supplier_Settlements['5'] = { ...seed.Supplier_Settlements['3'], id: '5' };
  request.allocations = [{ settlement_id: '3', amount: 60 }, { settlement_id: '5', amount: 56 }];
  const context = harness(seed, { Inv_Set_Allocations: 1 });
  const first = context.run(key, request);
  assert.equal(first.success, false);
  assert.ok(first.invoice_id, first.message);
  assert.equal(first.retryable, true);
  const second = context.run(key, request);
  assert.equal(second.success, true, second.message);
  assert.equal(second.invoice_id, first.invoice_id);
  assert.equal(Object.keys(context.database.Supplier_Invoices).length, 1);
  assert.equal(Object.keys(context.database.Inv_Set_Allocations).length, 2);
});
test('line and rebuild failures retain a recoverable invoice and reuse confirmed children', () => {
  for (const phase of ['Supplier_Invoice_Lines', 'rebuild']) {
    const { seed, request } = fixture();
    const context = harness(seed, { [phase]: 1 });
    const first = context.run(key, request);
    assert.equal(first.success, false, phase);
    assert.ok(first.invoice_id, first.message);
    context.failures[phase] = 0;
    const second = context.run(key, request);
    assert.equal(second.success, true, second.message);
    assert.equal(second.invoice_id, first.invoice_id);
    assert.equal(Object.keys(context.database.Inv_Set_Allocations).length, 1);
    assert.equal(Object.keys(context.database.Supplier_Invoice_Lines).length, 1);
  }
});
test('different data cannot reuse a key and another operation cannot adopt a duplicate invoice number', () => {
  const { seed, request } = fixture();
  const context = harness(seed);
  const first = context.run(key, request);
  assert.equal(first.success, true, first.message);
  request.invoice.Name = 'Changed';
  assert.equal(context.run(key, request).success, false);
  request.invoice.Name = 'Invoice-1';
  const duplicate = context.run('22222222-2222-4222-8222-222222222222', request);
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.retryable, false);
  assert.equal(Object.keys(context.database.Supplier_Invoices).length, 1);
});
test('server enforces the payable sum, tax calculations, document and money precision', () => {
  const edits = [
    r => { r.allocations[0].amount = 106; },
    r => { r.invoice.Reimbursable_Expense = -10; },
    r => { r.invoice.Additional_IRPF_percentage = 15; r.invoice.Additional_Amount_Excl_VAT = 100; },
    r => { r.file_id = ''; },
    r => { r.allocations[0].amount = 116.001; }
  ];
  for (const edit of edits) {
    const { seed, request } = fixture(); edit(request);
    const context = harness(seed);
    const result = context.run(key, request);
    assert.equal(result.success, false);
    assert.equal(context.writes.length, 0, result.message);
  }
});
test('non-Commission Suppliers invoice types require a document before any records are written', () => {
  for (const type of ['Proforma', 'Final Invoice', 'Tickets']) {
    const { seed, request } = fixture();
    request.invoice.Invoice_Type = type;
    request.file_id = '';
    const context = harness(seed);
    const result = context.run(key, request);
    assert.equal(result.success, false, type);
    assert.match(result.message, /Upload the invoice document/);
    assert.equal(context.writes.length, 0, type);
  }
});

test('over-capacity confirmation must identify every affected settlement', () => {
  const { seed, request } = fixture();
  seed.Supplier_Settlements['3'].Total_Service_Cost = 100;
  const context = harness(seed);
  assert.equal(context.run(key, request).success, false);
  request.confirmed_excess = ['3'];
  const result = context.run(key, request);
  assert.equal(result.success, true, result.message);
});

test('read failures never authorize a new invoice and a hidden existing key is recovered through the unique constraint', () => {
  const { seed, request } = fixture();
  const context = harness(seed, { coql: 1, Inv_Set_Allocations: 1 });
  const unreadable = context.run(key, request);
  assert.equal(unreadable.retryable, true);
  assert.equal(context.writes.length, 0);
  const partial = context.run(key, request);
  assert.ok(partial.invoice_id, partial.message);
  context.failures.hideInvoiceOnce = 1;
  const resumed = context.run(key, request);
  assert.equal(resumed.success, true, resumed.message);
  assert.equal(resumed.invoice_id, partial.invoice_id);
  assert.equal(Object.keys(context.database.Supplier_Invoices).length, 1);
});

test('manual edits to an incomplete invoice cannot be silently completed or overwritten', () => {
  for (const edit of [
    invoice => { invoice.Total_Payable_Amount = 1; },
    invoice => { invoice.Supplier.id = '99'; },
    invoice => { invoice.Booking.id = '99'; },
    invoice => { invoice.Amount_Paid = 5; },
    invoice => { invoice.Invoice_File = []; }
  ]) {
    const { seed, request } = fixture();
    const context = harness(seed, { Inv_Set_Allocations: 1 });
    const first = context.run(key, request);
    const invoice = context.database.Supplier_Invoices[first.invoice_id];
    edit(invoice);
    const before = JSON.stringify(invoice);
    const resumed = context.run(key, request);
    assert.equal(resumed.success, false);
    assert.equal(resumed.invoice_id, first.invoice_id);
    assert.equal(JSON.stringify(invoice), before);
    assert.equal(Object.keys(context.database.Supplier_Invoices).length, 1);
  }
});

test('unexpected additional allocations prevent completion', () => {
  const { seed, request } = fixture();
  const context = harness(seed, { Supplier_Invoice_Lines: 1 });
  const first = context.run(key, request);
  context.database.Inv_Set_Allocations['777'] = { id: '777', Vendor_Invoice: { id: first.invoice_id }, Status: 'Active', Allocated_Amount: 1 };
  const resumed = context.run(key, request);
  assert.equal(resumed.success, false);
  assert.match(resumed.message, /allocation total has changed/);
  assert.equal(context.database.Supplier_Invoices[first.invoice_id].Registration_Status, 'Pending');
});

 test('Commission can register and resume without a document', () => {
  for (const failures of [{}, { Inv_Set_Allocations: 1 }]) {
    const { seed, request } = fixture();
    request.invoice.Invoice_Type = 'Commission';
    request.file_id = '';
    const context = harness(seed, failures);
    const first = context.run(key, request);
    assert.ok(first.invoice_id, first.message);
    const resumed = context.run(key, request);
    assert.equal(resumed.success, true, resumed.message);
    assert.equal(resumed.invoice_id, first.invoice_id);
    assert.equal(Object.keys(context.database.Supplier_Invoices).length, 1);
  }
});

test('registration resumes when CRM has collapsed repeated spaces in the invoice name',()=>{
 const {seed,request}=fixture();request.invoice.Name='INV-MFSP2606156-  058/2026';
 const f=harness(seed,{Inv_Set_Allocations:1});const first=f.run(key,request);
 assert.equal(first.success,false);
 f.database.Supplier_Invoices[first.invoice_id].Name='INV-MFSP2606156- 058/2026';
 const result=f.run(key,request);assert.equal(result.success,true,result.message);
 assert.equal(result.invoice_id,first.invoice_id);assert.equal(Object.keys(f.database.Supplier_Invoices).length,1);
 assert.equal(f.database.Supplier_Invoices[first.invoice_id].Name,'INV-MFSP2606156- 058/2026');
});
test('registration still refuses a changed invoice number after whitespace normalization',()=>{
 const {seed,request}=fixture();const f=harness(seed,{Inv_Set_Allocations:1});const first=f.run(key,request);
 f.database.Supplier_Invoices[first.invoice_id].Name='Different invoice';const writes=f.writes.length;
 const result=f.run(key,request);assert.equal(result.success,false);assert.match(result.message,/details have changed/);assert.equal(f.writes.length,writes);
});

function discardFixture(failures={}) {
 const {seed,request}=fixture(),f=harness(seed,{Inv_Set_Allocations:1,...failures});
 const created=f.run(key,request);
 return {...f,request,id:created.invoice_id,discard:()=>f.run(key,{operation:'discard_registration',original_request:JSON.stringify(request)})};
}
test('discard cancels unfinished invoice and retains its document and identity; retries cannot revive it',()=>{
 const f=discardFixture(),result=f.discard();assert.equal(result.success,true,result.message);assert.equal(result.phase,'discarded');
 const invoice=f.database.Supplier_Invoices[f.id];assert.equal(invoice.Status,'Cancelled');assert.equal(invoice.Registration_Status,'Discarded');assert.ok(invoice.Invoice_File.length);
 assert.equal(f.discard().success,true);assert.equal(f.run(key,f.request).success,false);assert.equal(Object.keys(f.database.Supplier_Invoices).length,1);
});
test('discard remains recoverable when settlement rebuild fails',()=>{
 const f=discardFixture({rebuild:1});assert.equal(f.discard().success,false);
 assert.equal(f.database.Supplier_Invoices[f.id].Registration_Status,'Discarding');
 assert.equal(f.run(key,f.request).success,false);f.failures.rebuild=0;
 assert.equal(f.discard().success,true);assert.equal(f.database.Supplier_Invoices[f.id].Registration_Status,'Discarded');
});
test('discard refuses completed, paid, locked or corrected invoices and foreign requests',()=>{
 for(const patch of [{Registration_Status:'Complete'},{Amount_Paid:1},{Locked__s:true},{Edit_Status:'Pending'}]){
  const f=discardFixture();Object.assign(f.database.Supplier_Invoices[f.id],patch);
  assert.equal(f.discard().success,false);assert.equal(f.database.Supplier_Invoices[f.id].Status,'Received');
 }
 const f=discardFixture();assert.equal(f.run(key,{operation:'discard_registration',original_request:'{}'}).success,false);
});
test('linked payments, source operations and accounting entries prevent discarding',()=>{
 for(const module of ['Supplier_Pay_Allocations','Prepayment_Invoice_Allocations','Card_Purchases','Accounting_Entries']){
  const f=discardFixture(),field=['Supplier_Pay_Allocations','Accounting_Entries'].includes(module)?'Supplier_Invoice':'Vendor_Invoice';
  f.database[module]={9:{id:'9',[field]:{id:f.id}}};assert.equal(f.discard().success,false,module);assert.equal(f.database.Supplier_Invoices[f.id].Status,'Received');
 }
});
test('unknown creation outcome, read errors and concurrent changes do not authorize cancellation',()=>{
 const {seed,request}=fixture(),f=harness(seed);assert.equal(f.run(key,{operation:'discard_registration',original_request:JSON.stringify(request)}).success,false);assert.equal(f.writes.length,0);
 for(const failure of ['discardRead','conflict']){const f=discardFixture();f.failures[failure]=1;assert.equal(f.discard().success,false);assert.equal(f.database.Supplier_Invoices[f.id].Status,'Received');}
});
