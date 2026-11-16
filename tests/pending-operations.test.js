const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const window={};vm.runInNewContext(fs.readFileSync('app/scripts/pending-operations.js','utf8'),{window});
const read=window.AccountingManagerApp.readPendingOperations;
function storage(values){const entries=Object.entries(values);return {length:entries.length,key:i=>entries[i][0],getItem:k=>typeof values[k]==='string'?values[k]:JSON.stringify(values[k])};}
test('lists interrupted saves and ignores probes, unrelated storage and completed prepayment checkpoints',()=>{
 const rows=read([storage({'accounting-manager:payment-save:v1':{plan:{payment:{Name:'PAY-TEST'},entries:[]}},'accounting-manager:invoice-edit:v1:12':{operationKey:'key',request:{}},'accounting-manager:invoice-edit:v1:12:probe':'1','unrelated':'secret','accounting-manager-prepayment-3':{paymentAttempt:true,paymentComplete:true,statusSyncPending:false},'accounting-manager-prepayment-4':{invoiceAllocationIds:['9']}})]);
 assert.equal(rows.length,2);assert.equal(rows[0].reference,'PAY-TEST');assert.equal(rows[1].id,'12');
});
test('retains prepayment recovery after payment creation, source linking and request sync failures',()=>{
 for(const data of [{paymentAttempt:true},{paymentAttempt:true,paymentComplete:true},{statusSyncPending:true},{invoiceAttempt:true},{invoiceId:'5'}])assert.equal(read([storage({'accounting-manager-prepayment-3':data})]).length,1);
});
test('prefers persistent data and suppresses obsolete legacy deletion when a current journal exists',()=>{
 const key='accounting-manager:payment-delete:v1:3';
 const rows=read([storage({[key]:{allocations:{},operations:[],reconciled:true}}),storage({[key]:'invalid','accountingManager.paymentUndo.operations.3':[]})]);
 assert.equal(rows.length,1);assert.equal(rows[0].blocked,false);assert.match(rows[0].detail,/refresh/);
});
test('corrupt journals remain visible and cannot be resumed or silently deleted',()=>{
 for(const value of ['broken','null','[]','{}']){const s=storage({'accounting-manager:invoice-edit:v1:3':value});const rows=read([s]);assert.equal(rows.length,1);assert.equal(rows[0].blocked,true);assert.equal(s.getItem(s.key(0)),value);}
});
test('storage failure is visible and does not hide recoveries in the other storage',()=>{
 const rows=read([null,storage({'accounting-manager:card-payment:v1:4':{Name:'CARD TEST'}})]);assert.equal(rows.length,2);assert.equal(rows[0].blocked,true);assert.equal(rows[1].reference,'CARD TEST');
});
test('deletion describes progress without executing any steps',()=>{
 const rows=read([storage({'accountingManager.invoiceDeletion.v1.5':{operations:[{},{}],cursor:1}})]);assert.match(rows[0].detail,/1 of 2/);
});

function routes(){
 const calls=[],state={supplierId:'7',paymentCreation:{},paymentAllocationManager:{},paymentUndo:{},invoiceDeletion:{},records:{payments:[],invoices:[]},views:{payments:{},invoices:{}}};
 const ctx={state,document:{getElementById:()=>({}),querySelector:s=>s==='[aria-busy="true"]'?null:{click:()=>calls.push(s)}},MODULES:{payments:'Supplier_Payments',invoices:'Supplier_Invoices'},INVOICE_CREATE_MODES:{invoice:'invoice'},crm:{getRecord:async(m,id)=>({id,Name:'Test'})},ns:{mountPendingOperations:(host,open)=>{ctx.open=open;},openPendingPrepayment:async id=>calls.push(['prepayment',id]),openPendingCardOperation:async(id,action)=>calls.push(['card',id,action])}};
 for(const name of ['setCurrentTab','openCreatePaymentPanel','loadSupplierWorkspace','openCreateInvoicePanel','openPaymentUndoConfirmation','openPaymentAllocationManager','onSelectedInvoiceDeleteClick','onSelectedInvoiceEditClick'])ctx[name]=async(...args)=>calls.push([name,...args]);
 const main=fs.readFileSync('app/scripts/main.js','utf8'),start=main.lastIndexOf('  var openPendingOperation =');
 vm.runInNewContext(main.slice(start,main.lastIndexOf('}(window));')),ctx);
 return {ctx,calls,state};
}
test('recovery routes reopen original forms and deletion confirmations without submitting',async()=>{
 for(const [type,expected] of [['payment-create','openCreatePaymentPanel'],['payment-edit','openPaymentAllocationManager'],['payment-delete','openPaymentUndoConfirmation'],['invoice-edit','onSelectedInvoiceEditClick'],['invoice-delete','onSelectedInvoiceDeleteClick'],['invoice-create','openCreateInvoicePanel'],['prepayment','prepayment'],['card-payment','card'],['card-invoice','card']]){
  const f=routes();await f.ctx.open({type,id:'7'});assert.ok(f.calls.some(c=>c[0]===expected),type);
 }
});
test('an active save blocks routing and missing records retain recovery for review',async()=>{
 const f=routes();f.state.paymentAllocationManager.isSaving=true;
 await assert.rejects(f.ctx.open({type:'payment-delete',id:'7'}),/still running/);assert.equal(f.calls.length,0);
 f.state.paymentAllocationManager.isSaving=false;f.ctx.crm.getRecord=async()=>null;
 await assert.rejects(f.ctx.open({type:'invoice-edit',id:'7'}),/unavailable/);
 assert.equal(f.calls.some(c=>c[0]==='onSelectedInvoiceEditClick'),false);
});

test('explicit dismissal hides both storage copies without deleting recovery and changed operations return',()=>{
 const key='accounting-manager:card-payment:v1:4';
 function store(){const values=new Map([[key,'{"Name":"Test"}']]);return {get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};}
 const stores=[store(),store()];window.AccountingManagerApp.dismissPendingOperation(stores,key);
 assert.equal(read(stores).length,0);assert.equal(stores[0].getItem(key),'{"Name":"Test"}');assert.equal(stores[1].getItem(key),'{"Name":"Test"}');
 stores[0].setItem(key,'{"Name":"Changed"}');assert.equal(read(stores).length,1);
 assert.throws(()=>window.AccountingManagerApp.dismissPendingOperation(stores,'unrelated'),/cannot be dismissed/);
});

test('payment recovery identifies the saved payment, pending step and actual failure',()=>{
 const rows=read([storage({'accounting-manager:payment-save:v1':{paymentId:'42',phase:'balances',lastError:'Rebuild failed',plan:{payment:{Name:'PAY-TEST'},entries:[]}}})]);
 assert.equal(rows[0].id,'42'); assert.match(rows[0].detail,/settlement balances/); assert.match(rows[0].detail,/Last error: Rebuild failed/);
});
test('completed financial work is distinguished from unfinished writes',()=>{
 const rows=read([storage({'accounting-manager:payment-save:v1':{paymentId:'42',phase:'complete',plan:{payment:{Name:'PAY-TEST'},entries:[]}}})]);
 assert.equal(rows[0].status,'Payment saved'); assert.match(rows[0].detail,/Only the local recovery notice/);
});
