const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/scripts/payment-create.js','utf8');
function fixture(){
 const calls=[],storage=new Map(),notices=[],state={paymentCreation:{context:{invoiceCorrection:true,correctionInvoice:{id:'1',Modified_Time:'v1'}},isOpen:true},views:{payments:{},invoices:{}}};
 let failed=true;
 const ctx=vm.createContext({
  state,global:{crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},CustomEvent:class{},dispatchEvent(){}},
  renderAll(){},invalidateInvoiceCreateSettlementCache(){},closeCreatePaymentPanel(){state.paymentCreation.isOpen=false;},async refreshInvoicesAndPaymentsAfterSupplierPayment(){},
  async resolvePaymentAccountsForPaymentCreate(){return {paymentAccountsBySupplier:{'2':'31'}};},
  renderer:{showNotice:(text)=>notices.push(text)},
  crm:{async executeFunction(name,args){calls.push(JSON.parse(JSON.stringify(args)));if(failed)throw Error('Connection lost');return {details:{output:JSON.stringify({success:true,payment_id:'9'})}}}}
 });
 const start=source.indexOf('    async function submitCorrectionPayment('),end=source.indexOf('    async function onCreateSupplierPaymentSubmit(',start);
 vm.runInContext(source.slice(start,end),ctx);
 return {ctx,state,calls,storage,notices,succeed(){failed=false;}};
}
test('additional payment form persists the exact request and resumes after a lost response',async()=>{
 const f=fixture(),details={Name:'Additional payment',Status:'Paid',Payment_Amount:20,Payment_Date:'2026-10-13',Payment_Account:'30',allocations:{'1':20}};
 await f.ctx.submitCorrectionPayment(details);assert.equal(f.calls.length,1);assert.match(f.state.paymentCreation.feedback.message,/Resume payment/);assert.equal(f.storage.size,1);
 assert.equal(JSON.parse(f.calls[0].requestJson).action,'add_payment');assert.equal(JSON.parse(f.calls[0].requestJson).payment_details.Payment_Accounts_By_Supplier['2'],'31');
 f.succeed();await f.ctx.submitCorrectionPayment(null);assert.deepEqual(f.calls[1],f.calls[0]);assert.equal(f.storage.size,0);assert.equal(f.state.views.payments.selectedId,'9');assert.equal(f.state.paymentCreation.isOpen,false);assert.match(f.notices.at(-1),/balances updated/);
});
test('the normal payment submit cannot dispatch twice while its first request is running',async()=>{
 const f=fixture();f.state.paymentCreation.isBusy=true;
 const start=source.indexOf('    async function onCreateSupplierPaymentSubmit('),end=source.indexOf('\n    return {',start);
 vm.runInContext(source.slice(start,end),f.ctx);await f.ctx.onCreateSupplierPaymentSubmit({preventDefault(){}});
 assert.equal(f.calls.length,0);
});
