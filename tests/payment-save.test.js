const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const window = {}; vm.runInNewContext(fs.readFileSync('app/scripts/payment-save.js','utf8'), {window});
  const db = {Supplier_Invoices: {1: {id:'1',Status:'Received',Currency:'EUR',Total_Payable_Amount:120,Invoice_Total:100,Supplier:{id:'3'},Supplier_Settlement:{id:'4'}}}, Supplier_Payments:{},Supplier_Pay_Allocations:{}};
  const storage = new Map(), fail = {}, calls = []; let next = 10;
  const crm = {
    async searchRecordPage(m,q,page,size) { const [,field,value] = q.match(/\((\w+):equals:([^)]*)\)/); return Object.values(db[m]).filter(r=>String(r[field]?.id||r[field])===value).slice((page-1)*size,page*size); },
    async getRecord(m,id) { return structuredClone(db[m][id]); },
    async insertRecord(m,p,options) {
      assert.equal(options.trigger.length, 0); calls.push(m);
      const duplicate = Object.values(db[m]).find(r=>r.Invoice_Edit_Key===p.Invoice_Edit_Key);
      if(duplicate) return {data:[{code:'DUPLICATE_DATA',details:{id:duplicate.id}}]};
      const id = String(next++); db[m][id]={id,...structuredClone(p)};
      if(fail[m]) { fail[m]--; throw Error('Lost response'); }
      return {data:[{code:'SUCCESS',details:{id}}]};
    }
  };
  const plan = {payment:{Name:'P1',Payment_Amount:120,Currency:'EUR',Movement_Type:'Outbound Payment',Status:'Paid'}, entries:[{invoiceId:'1',invoiceNumber:'I1',allocatedAmount:120,isCreditNote:false,invoiceRecord:structuredClone(db.Supplier_Invoices[1])}]};
  const deps = {crm,storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}, randomUUID:()=> 'test-key',
    allocationPayload:(pid,p,e)=>({Supplier_Payment:{id:pid},Supplier_Invoice:{id:e.invoiceId},Allocated_Amount:e.allocatedAmount}),
    async reconcile(pid,p,validate) { if (!validate && fail.reconcile) {fail.reconcile--;throw Error('Rebuild failed');} },
    async sync(){if(fail.sync){fail.sync--;throw Error('Operation failed');}},
    async refresh(){if(fail.refresh){fail.refresh--;throw Error('Refresh failed');}}
  };
  return {db,plan,fail,calls,storage,deps,saver:window.AccountingManagerApp.createReliablePaymentSave(deps),create:()=>window.AccountingManagerApp.createReliablePaymentSave(deps)};
}
for (const phase of ['Supplier_Payments','Supplier_Pay_Allocations','reconcile','sync']) {
  test('resumes without duplicates after '+phase+' failure, including after reopening',async()=>{
    const f=fixture();f.fail[phase]=1;
    await assert.rejects(f.saver.run(f.plan)); assert.equal(f.storage.size,1);
    const result=await f.create().run();assert.equal(result.success,true);
    assert.equal(Object.keys(f.db.Supplier_Payments).length,1);assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,1);assert.equal(f.storage.size,0);
  });
}
test('double submission performs only one payment insert',async()=>{
  const f=fixture(); const results=await Promise.all([f.saver.run(f.plan),f.saver.run(f.plan)]);
  assert.equal(results.filter(r=>r.busy).length,1);assert.equal(f.calls.filter(m=>m==='Supplier_Payments').length,1);
});
test('validates all invoices before creating records and counts pending reservations',async()=>{
  const f=fixture();f.db.Supplier_Payments[5]={id:'5',Status:'Planned'};f.db.Supplier_Pay_Allocations[6]={id:'6',Supplier_Invoice:{id:'1'},Supplier_Payment:{id:'5'},Allocated_Amount:30};
  await assert.rejects(f.saver.run(f.plan),/available payable/);assert.equal(f.calls.length,0);
  f.plan.entries[0].allocatedAmount=90;f.plan.payment.Payment_Amount=90;await f.saver.run(f.plan);assert.equal(f.calls.length,2);
});
test('includes reimbursables and permits distribution over multiple invoices',async()=>{
  const f=fixture();f.db.Supplier_Invoices[2]={...f.db.Supplier_Invoices[1],id:'2',Total_Payable_Amount:50};
  f.plan.entries.push({...f.plan.entries[0],invoiceId:'2',allocatedAmount:50});f.plan.payment.Payment_Amount=170;
  await f.saver.run(f.plan);assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,2);
});
test('rejects changed relations, mixed currencies, duplicate invoices and overprecision before writes',async()=>{
  for(const mode of ['relation','currency','duplicate','precision']){
    const f=fixture();if(mode==='relation')f.db.Supplier_Invoices[1].Supplier={id:'8'};
    if(mode==='currency')f.db.Supplier_Invoices[1].Currency='USD';
    if(mode==='duplicate')f.plan.entries.push(f.plan.entries[0]);
    if(mode==='precision')f.plan.entries[0].allocatedAmount=1.001;
    await assert.rejects(f.saver.run(f.plan));assert.equal(f.calls.length,0);
  }
});
test('never recreates a saved payment with externally changed amounts',async()=>{
  const f=fixture();f.fail.reconcile=1;await assert.rejects(f.saver.run(f.plan));
  Object.values(f.db.Supplier_Payments)[0].Payment_Amount=99;
  await assert.rejects(f.create().run(),/changed/);assert.equal(Object.keys(f.db.Supplier_Payments).length,1);
});

test('a deleted confirmed payment cannot be recreated by resuming after reopening',async()=>{
  const f=fixture();f.fail.sync=1;await assert.rejects(f.saver.run(f.plan));
  const paymentId=f.saver.pending().paymentId;
  delete f.db.Supplier_Payments[paymentId];f.db.Supplier_Pay_Allocations={};
  const writes=f.calls.length;
  await assert.rejects(f.create().run(),/previously saved payment is unavailable/);
  assert.equal(f.calls.length,writes);assert.equal(Object.keys(f.db.Supplier_Payments).length,0);
  assert.equal(f.saver.pending().paymentId,paymentId);
});

test('recovery reads the confirmed payment directly even when search has not indexed it',async()=>{
  const f=fixture();f.fail.sync=1;await assert.rejects(f.saver.run(f.plan));
  const search=f.deps.crm.searchRecordPage;
  f.deps.crm.searchRecordPage=async(m,...args)=>m==='Supplier_Payments'?[]:search(m,...args);
  const writes=f.calls.length;
  assert.equal((await f.create().run()).success,true);assert.equal(f.calls.length,writes);
});

test('confirmed insert identity survives a failed readback and prevents replacement after deletion',async()=>{
  const f=fixture(),get=f.deps.crm.getRecord;
  f.deps.crm.getRecord=async(m,id)=>{if(m==='Supplier_Payments')throw Error('Read unavailable');return get(m,id);};
  await assert.rejects(f.saver.run(f.plan),/Read unavailable/);
  const paymentId=f.saver.pending().paymentId;assert.ok(paymentId);
  delete f.db.Supplier_Payments[paymentId];f.deps.crm.getRecord=get;
  await assert.rejects(f.create().run(),/previously saved payment is unavailable/);
  assert.equal(f.calls.filter(m=>m==='Supplier_Payments').length,1);
});

test('failed direct reads and changed identities retain recovery without new writes',async()=>{
  for(const mode of ['read','identity']){
    const f=fixture();f.fail.sync=1;await assert.rejects(f.saver.run(f.plan));
    const writes=f.calls.length,paymentId=f.saver.pending().paymentId,get=f.deps.crm.getRecord;
    if(mode==='identity')f.db.Supplier_Payments[paymentId].Invoice_Edit_Key='different-operation';
    else f.deps.crm.getRecord=async(m,id)=>{if(m==='Supplier_Payments')throw Error('Read unavailable');return get(m,id);};
    await assert.rejects(f.create().run(),mode==='read'?/Read unavailable/:/identity/);
    assert.equal(f.calls.length,writes);assert.equal(f.saver.pending().paymentId,paymentId);
  }
});


test('a failed display refresh completes the payment and clears its financial recovery',async()=>{
  const f=fixture(); f.fail.refresh=1;
  const result=await f.saver.run(f.plan);
  assert.equal(result.success,true); assert.equal(result.refreshRequired,true);
  assert.equal(f.storage.size,0); assert.equal(f.saver.pending(),null);
  assert.equal(Object.keys(f.db.Supplier_Payments).length,1);
  assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,1);
});

test('failed operation sync persists its exact phase and error until a safe retry',async()=>{
  const f=fixture(); f.fail.sync=1;
  await assert.rejects(f.saver.run(f.plan),/Operation failed/);
  assert.equal(f.saver.pending().phase,'operations');
  assert.equal(f.saver.pending().lastError,'Operation failed');
  await f.create().run(); assert.equal(f.storage.size,0);
});

test('completed recovery after a storage cleanup failure never repeats financial work',async()=>{
  const f=fixture(), remove=f.deps.storage.removeItem;
  f.deps.storage.removeItem=()=>{throw Error('Storage unavailable');};
  await assert.rejects(f.saver.run(f.plan),/Storage unavailable/);
  assert.equal(f.saver.pending().phase,'complete');
  f.deps.storage.removeItem=remove;
  for(const method of ['ready','reconcile','sync']) f.deps[method]=async()=>{throw Error('Must not repeat '+method);};
  f.deps.crm.getRecord=async()=>{throw Error('Must not replay a completed payment');};
  assert.equal((await f.create().run()).success,true); assert.equal(f.storage.size,0);
});

test('188-invoice remittance retains one payment across a lost reconciliation response',async()=>{
  const f=fixture();
  for(let i=2;i<=188;i++) {
    f.db.Supplier_Invoices[i]={...f.db.Supplier_Invoices[1],id:String(i)};
    f.plan.entries.push({...f.plan.entries[0],invoiceId:String(i)});
  }
  f.plan.payment.Payment_Amount=188*120;
  f.fail.reconcile=1;
  await assert.rejects(f.saver.run(f.plan),/Rebuild failed/);
  assert.equal(f.saver.pending().phase,'balances');
  assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,188);
  f.fail.refresh=1;
  const result=await f.create().run();
  assert.equal(result.success,true); assert.equal(result.refreshRequired,true);
  assert.equal(Object.keys(f.db.Supplier_Payments).length,1);
  assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,188);
  assert.equal(f.storage.size,0);
});

test('invoice preflight names the invoice and distinguishes every blocking reason before writes',async()=>{
 for(const [fields,reason] of [[{Edit_Status:'Pending'},/unfinished correction/],[{Locked__s:true},/locked in CRM/],[{Registration_Key:'registration',Registration_Status:'Pending'},/unfinished registration.*Resume invoice registration/],[{Status:'Rejected'},/status Rejected/]]) {
  const f=fixture();Object.assign(f.db.Supplier_Invoices[1],fields,{Name:'INV-MFSP2606156- 058/2026'});
  await assert.rejects(f.saver.run(f.plan),e=>{assert.match(e.message,/INV-MFSP2606156- 058\/2026/);assert.match(e.message,reason);return true;});
  assert.equal(f.calls.length,0);assert.equal(f.storage.size,0);
 }
 const f=fixture();delete f.db.Supplier_Invoices[1];
 await assert.rejects(f.saver.run(f.plan),/Invoice I1 \(1\).*could not be read/);assert.equal(f.calls.length,0);
});

test('progress identifies validation, allocations, reconciliation and display refresh',async()=>{
 const f=fixture(),events=[];f.deps.progress=e=>events.push(e);
 await f.saver.run(f.plan);
 assert.ok(events.some(e=>e.phase==='validation'&&e.current===1&&e.total===1));
 assert.ok(events.some(e=>e.phase==='allocations'&&e.current===1&&e.total===1));
 assert.ok(events.findIndex(e=>e.phase==='balances')<events.findIndex(e=>e.phase==='complete'));
 assert.equal(events.at(-1).phase,'refresh');
});
test('a rejected tab lock does not execute payment work or erase recovery',async()=>{
 const f=fixture();f.fail.sync=1;await assert.rejects(f.saver.run(f.plan));
 const saved=f.saver.pending(),writes=f.calls.length;
 f.deps.withLock=async()=>{throw Error('Already running in another tab');};
 await assert.rejects(f.create().run(),/another tab/);
 assert.equal(f.calls.length,writes);assert.deepEqual(f.saver.pending(),saved);
});
