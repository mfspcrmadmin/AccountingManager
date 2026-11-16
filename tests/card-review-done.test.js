const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/scripts/operations.js','utf8');
function setup(purchase,invoice={id:'2',Status:'Paid'},payment={id:'3',Status:'Paid'}){
 const writes=[];const ctx={activePurchase:{id:'1',Accounting_Status:'Needs review',...purchase},lookupId:r=>String(r&&r.id||''),responseRecords:r=>r.data,workflowNotes:{value:'Checked'},MODULES:{purchases:'Card_Purchases'},records:[],cardPurchases:async()=>[],syncOwnerFilter(){},render(){},openWorkflow(){},setMessage(){}};
 ctx.api=()=>({getRecord:async({Entity})=>({data:[Entity==='Supplier_Invoices'?invoice:Entity==='Supplier_Payments'?payment:ctx.activePurchase]})});
 ctx.updatePurchase=async data=>{writes.push(data);Object.assign(ctx.activePurchase,data);};
 vm.runInNewContext(source.slice(source.indexOf('  function reviewedCardStatus'),source.indexOf('  async function validateWorkflowAction')),ctx);
 return {ctx,writes,run:()=>ctx.completeCardReview()};
}
test('review completion uses existing purchase/refund statuses for all valid link combinations',async()=>{
 for(const type of ['Purchase','Refund'])for(const links of [0,1,2]){
  const f=setup({Transaction_Type:type,Vendor_Invoice:links?{id:'2'}:null,Vendor_Payment:links===2?{id:'3'}:null});await f.run();
  assert.equal(f.writes[0].Accounting_Status,(type==='Purchase'?['Pending invoice','Pending payment record','Purchase recorded']:['Pending credit note','Pending refund record','Refund recorded'])[links]);
  assert.deepEqual(Object.keys(f.writes[0]).sort(),['Accounting_Status','Review_Notes']);
 }
});
test('payment without invoice, unfinished invoice and unpaid payment cannot complete review',async()=>{
 for(const f of [setup({Vendor_Payment:{id:'3'}}),setup({Vendor_Invoice:{id:'2'}},{id:'2',Edit_Status:'Pending'}),setup({Vendor_Invoice:{id:'2'},Vendor_Payment:{id:'3'}},undefined,{id:'3',Status:'Planned'})]){
  await assert.rejects(f.run());assert.equal(f.writes.length,0);
 }
});
test('review completion reports an unconfirmed write instead of success',async()=>{
 const f=setup({Vendor_Invoice:{id:'2'}});f.ctx.updatePurchase=async()=>{};await assert.rejects(f.run(),/could not be verified/);
});
