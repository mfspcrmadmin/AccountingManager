const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const window={};vm.runInNewContext(fs.readFileSync('app/scripts/payment-save.js','utf8'),{window});
 const allocations=Object.fromEntries(Array.from({length:115},(_,i)=>[String(i+1),100]));
 const calls=[],progress=[];let failure='';
 const deps={progress:(...args)=>progress.push(args),execute:async(name,args)=>{
  calls.push({name,args});
  if(name==='managesupplierpaymentallocations'){
   const data=JSON.parse(args.allocationsDataString);assert.equal(Object.keys(data.allocations).length,115);assert.ok(data.reconcile_invoice_ids.length<=5);
   if(failure==='invoice'&&data.reconcile_invoice_ids.includes('11'))throw Error('Lost response');
   return {success:true,error:false,reconcile_batch:failure!=='old-server',affected_invoice_ids:data.reconcile_invoice_ids,affected_settlement_ids:data.reconcile_invoice_ids.map(id=>String(1000+Number(id)))};
  }
  if(failure==='settlement'&&args.settlementIdsString==='1011')return {error:false,warning_count:1,processed_count:1,message:'Not confirmed'};
  return {error:false,warning_count:0,processed_count:1};
 }};
 return {calls,progress,fail:value=>failure=value,run:()=>window.AccountingManagerApp.reconcileSavedPayment(deps,'payment',allocations)};
}
test('115 invoices use 23 bounded calls followed by individual settlement rebuilds',async()=>{
 const f=fixture();await f.run();assert.equal(f.calls.filter(c=>c.name==='managesupplierpaymentallocations').length,23);
 assert.equal(f.calls.filter(c=>c.name==='rebuildsuppliersettlementtotals').length,115);
 assert.equal(f.progress.at(-1)[1],115);
});
test('unconfirmed batches and settlement warnings stop completion and can be retried',async()=>{
 for(const phase of ['invoice','settlement','old-server']){
  const f=fixture();f.fail(phase);await assert.rejects(f.run());
  if(phase!=='settlement')assert.equal(f.calls.some(c=>c.name==='rebuildsuppliersettlementtotals'),false);
  f.fail('');await f.run();assert.equal(f.progress.at(-1)[1],115);
 }
});
