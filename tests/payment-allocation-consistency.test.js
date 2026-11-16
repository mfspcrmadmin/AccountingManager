const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const {transpile}=require('./helpers/deluge-registration-harness');
function setup(){
 const db={Supplier_Invoices:{'1':{id:'1',Modified_Time:'v1',Status:'Received',Total_Payable_Amount:120,Invoice_Total:100,Amount_Paid:0,Supplier_Settlement:{id:'9'}},'2':{id:'2',Modified_Time:'v1',Status:'Received',Total_Payable_Amount:80,Amount_Paid:0,Supplier_Settlement:{id:'8'}}},Supplier_Payments:{'3':{id:'3',Modified_Time:'v1',Status:'Paid',Payment_Amount:0}},Supplier_Pay_Allocations:{},Inv_Set_Allocations:{'7':{id:'7',Vendor_Invoice:{id:'1'},Vendor_Settlement:{id:'10'},Status:'Active'}},Accounting_Entries:{},Prepayments:{},Card_Purchases:{}};
 const writes=[],rebuilt=[],fail={};let next=20;
 const ctx=vm.createContext({});
 vm.runInContext(`function Map(){return {};} function List(){return [];} function ifnull(v,d){return v==null?d:v;} function choose(c,a,b){return c?a:b;}
 Object.defineProperties(Object.prototype,{get:{value:function(k){return this[k]==null?null:this[k];}},put:{value:function(k,v){this[k]=v;}},containKey:{value:function(k){return Object.hasOwn(this,k);}},keys:{value:function(){return Object.keys(this);}},isEmpty:{value:function(){return Object.keys(this).length===0;}},toString:{value:function(){return JSON.stringify(this);},configurable:true}});
 Array.prototype.add=function(v){this.push(v)};Array.prototype.size=function(){return this.length};Array.prototype.contains=function(v){return this.includes(v)};
 String.prototype.toMap=function(){return JSON.parse(this)};String.prototype.toList=function(s){return this.split(s)};String.prototype.matches=function(s){return new RegExp('^(?:'+s+')$').test(this)};
 String.prototype.toDecimal=String.prototype.toLong=function(){return Number(this)};Number.prototype.toDecimal=Number.prototype.toLong=function(){return Number(this)};Number.prototype.round=function(n){return Math.round((Number(this)+Number.EPSILON)*10**n)/10**n};`,ctx);
 const inside=o=>vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(o))+')',ctx);
 ctx.zoho={crm:{getRecordById:(m,id)=>inside(db[m]?.[id]||{}),createRecord:(m,v)=>{const id=String(next++);const data=JSON.parse(JSON.stringify(v));for(const f of ['Supplier_Payment','Supplier_Invoice','Payment_Account'])if(typeof data[f]==='string')data[f]={id:data[f]};db[m][id]={id,Modified_Time:'v1',...data};writes.push(m);return inside({id});}}};
 ctx.standalone={supplierInvoiceEdit_read:(m,f,id)=>JSON.stringify({success:true,records:Object.values(db[m]||{}).filter(r=>String(r[f]?.id||r[f])===id)}),supplierInvoiceEdit_write:(m,id,version,data)=>{
   if(fail[m]){fail[m]--;throw Error('Injected failure');}
   assert.equal(db[m][id].Modified_Time,version);assert.ok(!Object.hasOwn(data,'Unpaid_Invoiced_Amount'));
   Object.assign(db[m][id],JSON.parse(JSON.stringify(data)));db[m][id].Modified_Time+='x';writes.push(m);return JSON.stringify({error:false});
 },rebuildSupplierSettlementTotals:ids=>{rebuilt.push(ids);if(fail.rebuild){fail.rebuild--;return JSON.stringify({error:true});}return JSON.stringify({error:false});}};
 ctx.invoke=o=>{assert.equal(o.type,'DELETE');assert.equal(o.connection,'crm_oauth_connection');assert.match(o.url,/&wf_trigger=false$/);if(fail.delete){fail.delete--;return inside({data:[{code:'NO_PERMISSION',message:'Delete rejected'}]});}const id=o.url.match(/ids=(\d+)/)[1];delete db.Supplier_Pay_Allocations[id];writes.push('delete');return inside({data:[{code:'SUCCESS'}]});};
 vm.runInContext(transpile(fs.readFileSync('crm/invoice-edit/supplierPayment_deleteAllocation.dg','utf8').replace(/\r/g,'')),ctx);
 // CRM serializes map returns for standalone functions declared as string.
 ctx.standalone.supplierPayment_deleteAllocation=id=>{const result=ctx.supplierPayment_deleteAllocation(id);return typeof result==='string'?result:JSON.stringify(result);};
 ctx.standalone.supplierPayment_readAllocations=id=>ctx.standalone.supplierInvoiceEdit_read("Supplier_Pay_Allocations","Supplier_Payment",id);
 let source=fs.readFileSync('crm/invoice-edit/managesupplierpaymentallocations.dg','utf8').replace(/\r/g,'').replace(/^\s*info [^\n]+/gm,'').replace(/\bif\(/g,'choose(').replace(/choose\(([^\n]*)\)\s*\{/g,'if($1) {');
 // Deluge conditional expressions use if(), statements use if (...) {}.
 source=source.replace(/for each\s+(\w+) in ([^{\n]+)\s*\{/g,'for each $1 in $2\n{');
 vm.runInContext(transpile(source),ctx);
 return {ctx,db,writes,rebuilt,fail,run:(allocations,extra={})=>{const r=ctx.manageSupplierPaymentAllocations('3',JSON.stringify({allocations,...extra}));return typeof r==='string'?JSON.parse(r):JSON.parse(JSON.stringify(r));}};
}
test('partial payment then full payment uses payable including reimbursables and all settlements',()=>{
 const f=setup();let r=f.run({'1':40});assert.equal(r.success,true,r.message);assert.equal(f.db.Supplier_Invoices[1].Amount_Paid,40);assert.equal(f.db.Supplier_Invoices[1].Status,'Partially Paid');
 r=f.run({'1':120});assert.equal(r.success,true,r.message);assert.equal(f.db.Supplier_Invoices[1].Status,'Paid');assert.equal(f.db.Supplier_Payments[3].Payment_Amount,120);assert.match(f.rebuilt.at(-1),/10/);
});
test('validates every invoice before writing any allocation',()=>{const f=setup();const r=f.run({'1':40,'2':81});assert.equal(r.error,true);assert.equal(f.writes.length,0);});
test('redistribution and unlink rebuild old and new invoices and preserve omitted rows',()=>{
 const f=setup();assert.equal(f.run({'1':40,'2':60}).success,true);assert.equal(f.run({'1':20}).success,true);assert.equal(f.db.Supplier_Payments[3].Payment_Amount,80);
 const r=f.run({'1':0,'2':80});assert.equal(r.success,true,r.message);assert.equal(f.db.Supplier_Invoices[1].Amount_Paid,0);assert.equal(f.db.Supplier_Invoices[1].Status,'Received');assert.equal(f.db.Supplier_Invoices[2].Status,'Paid');assert.match(f.rebuilt.at(-1),/9/);
});
test('planned payments reserve balance but do not count as paid; cancelled payments do neither',()=>{
 const f=setup();f.db.Supplier_Payments[3].Status='Planned';let r=f.run({'1':100});assert.equal(r.success,true,r.message);assert.equal(f.db.Supplier_Invoices[1].Amount_Paid,0);
 f.db.Supplier_Payments[4]={id:'4',Status:'Planned'};f.db.Supplier_Pay_Allocations[50]={id:'50',Modified_Time:'v1',Supplier_Invoice:{id:'1'},Supplier_Payment:{id:'4'},Allocated_Amount:30};r=f.run({'1':100});assert.equal(r.error,true);
 f.db.Supplier_Payments[4].Status='Cancelled';assert.equal(f.run({'1':100}).success,true);
});
test('failed invoice or settlement update resumes without duplicating allocations',()=>{
 for(const phase of ['Supplier_Invoices','rebuild']){const f=setup();f.fail[phase]=1;assert.equal(f.run({'1':40}).error,true);const r=f.run({'1':40});assert.equal(r.success,true,r.message);assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,1);assert.equal(f.db.Supplier_Invoices[1].Amount_Paid,40);}
});
test('administrative states, unfinished saves, duplicates and fractional cents block before writes',()=>{
 for(const mode of ['Cancelled','Rejected','pending','duplicate','precision']){const f=setup();if(['Cancelled','Rejected'].includes(mode))f.db.Supplier_Invoices[1].Status=mode;if(mode==='pending')f.db.Supplier_Invoices[1].Registration_Key='key';if(mode==='duplicate'){for(const id of [30,31])f.db.Supplier_Pay_Allocations[id]={id:String(id),Supplier_Invoice:{id:'1'},Supplier_Payment:{id:'3'},Allocated_Amount:1};}const r=f.run({'1':mode==='precision'?1.001:40});assert.equal(r.error,true,mode);assert.equal(f.writes.length,0);}
});
test('read-only validation performs no writes',()=>{const f=setup();const r=f.run({'1':40},{validate_only:true});assert.equal(r.success,true,r.message);assert.equal(f.writes.length,0);});

test('reconciliation batch repairs only selected invoices and defers settlements without changing payment amounts',()=>{
 const f=setup();assert.equal(f.run({'1':120,'2':80}).success,true);
 f.db.Supplier_Invoices[1].Amount_Paid=0;f.db.Supplier_Invoices[1].Status='Received';
 f.db.Supplier_Invoices[2].Amount_Paid=0;f.db.Supplier_Invoices[2].Status='Received';
 f.rebuilt.length=0;f.writes.length=0;
 const r=f.run({'1':120,'2':80},{reconcile_only:true,reconcile_invoice_ids:['1']});
 assert.equal(r.success,true,r.message);assert.equal(r.reconcile_batch,true);
 assert.deepEqual(r.affected_invoice_ids,['1']);assert.ok(r.affected_settlement_ids.includes('10'));
 assert.equal(f.db.Supplier_Invoices[1].Amount_Paid,120);assert.equal(f.db.Supplier_Invoices[2].Amount_Paid,0);
 assert.equal(f.db.Supplier_Payments[3].Payment_Amount,200);assert.equal(f.db.Supplier_Payments[3].Allocation_Count,2);
 assert.equal(f.rebuilt.length,0);assert.ok(!f.writes.includes('Supplier_Payments'));
 assert.equal(f.run({'1':120,'2':80},{reconcile_only:true,reconcile_invoice_ids:['1']}).success,true);
 assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,2);
});

test('batch mode rejects omissions, changed full totals, duplicates and mutation requests',()=>{
 for(const mode of ['omitted','amount','header','duplicate','missing','mutation']) {
  const f=setup();assert.equal(f.run({'1':120,'2':80}).success,true);f.writes.length=0;
  const amounts={'1':120,'2':80},extra={reconcile_only:true,reconcile_invoice_ids:['1']};
  if(mode==='omitted')delete amounts['2'];if(mode==='amount')amounts['2']=79;
  if(mode==='header')f.db.Supplier_Payments[3].Payment_Amount=199;
  if(mode==='duplicate')extra.reconcile_invoice_ids=['1','1'];if(mode==='missing')extra.reconcile_invoice_ids=['9'];
  if(mode==='mutation')extra.reconcile_only=false;
  assert.equal(f.run(amounts,extra).success,false,mode);assert.equal(f.writes.length,0,mode);
 }
});

test('unchanged allocations repair stale invoice status copies and payment counters',()=>{
 const f=setup();assert.equal(f.run({'1':120,'2':80}).success,true);
 f.db.Supplier_Payments[3].Allocation_Count=3;
 for(const row of Object.values(f.db.Supplier_Pay_Allocations))row.Invoice_Status='Received';
 const r=f.run({'1':120,'2':80});assert.equal(r.success,true,r.message);
 assert.equal(f.db.Supplier_Payments[3].Allocation_Count,2);
 assert.equal(f.db.Supplier_Payments[3].Payment_Amount,200);
 assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,2);
 for(const row of Object.values(f.db.Supplier_Pay_Allocations))assert.equal(row.Invoice_Status,'Paid');
});

test('rejected allocation deletion keeps balances and permits the same retry',()=>{
 const f=setup();assert.equal(f.run({'1':40}).success,true);f.fail.delete=1;
 const rejected=f.run({'1':0});assert.equal(rejected.success,false);assert.match(rejected.message,/Delete rejected/);
 assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,1);assert.equal(f.db.Supplier_Invoices[1].Amount_Paid,40);assert.equal(f.db.Supplier_Payments[3].Payment_Amount,40);
 assert.equal(f.run({'1':0}).success,true);assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,0);assert.equal(f.db.Supplier_Invoices[1].Amount_Paid,0);assert.equal(f.db.Supplier_Payments[3].Payment_Amount,0);
});

function creationFixture(){
 const f=setup(),ctx=f.ctx;
 f.db.Payment_Accounts={'5':{id:'5',Owner_Type:'Own'}};
 vm.runInContext("String.prototype.toDate=function(){const s=String(this);return {toString:()=>s};};",ctx);
 Object.assign(f.db.Supplier_Invoices[1],{Name:'I1',Supplier:{id:'6'},Invoice_Date:'2026-10-16'});
 ctx.zoho.currentdate={toString:()=> '2026-10-16'};ctx.zoho.currenttime={toString:()=> '120000'};
 ctx.standalone.manageSupplierPaymentAllocations=(...args)=>{const result=ctx.manageSupplierPaymentAllocations(...args);return typeof result==='string'?result:JSON.stringify(result);};
 let source=fs.readFileSync('crm/invoice-edit/createsupplierpaymentfrominvoices.dg','utf8').replace(/\r/g,'').replace(/^\s*info [^\n]+/gm,'').replace(/\bif\(/g,'choose(').replace(/choose\(([^\n]*)\)\s*\{/g,'if($1) {');
 source=source.replace(/for each\s+(\w+) in ([^{\n]+)\s*\{/g,'for each $1 in $2\n{');
 vm.runInContext(transpile(source),ctx);
 const request={operation_key:'test-create',Name:'P1',Payment_Date:'2026-10-16',Payment_Account:'5',Currency:'EUR',Status:'Paid',Accounting_Status:'Pending',allocations:{'1':120},Payment_Accounts_By_Supplier:{'6':'7'}};
 return {...f,request,create:()=>{const r=ctx.createSupplierPaymentFromInvoices('1',JSON.stringify(request));return JSON.parse(typeof r==='string'?r:JSON.stringify(r));}};
}
test('operation payment creation shares reconciliation and is idempotent after a lost reply',()=>{
 const f=creationFixture();const first=f.create();assert.equal(first.success,true,first.message);
 const second=f.create();assert.equal(second.success,true,second.message);assert.equal(first.payment_id,second.payment_id);
 assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,1);assert.equal(f.db.Supplier_Invoices[1].Amount_Paid,120);
});
test('operation payment creation resumes partial reconciliation without another payment',()=>{
 const f=creationFixture();f.fail.rebuild=1;const first=f.create();assert.equal(first.error,true);assert.ok(first.payment_id);
 const second=f.create();assert.equal(second.success,true,second.message);assert.equal(first.payment_id,second.payment_id);
 assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,1);
});
test('credit-note operation creates a refund with a positive payment amount',()=>{
 const f=creationFixture();f.db.Supplier_Invoices[1].Invoice_Type='Credit Note';const r=f.create();assert.equal(r.success,true,r.message);
 assert.equal(f.db.Supplier_Payments[r.payment_id].Movement_Type,'Supplier Refund');assert.equal(f.db.Supplier_Payments[r.payment_id].Payment_Amount,120);
});
for(const module of ['Supplier_Payments','Supplier_Pay_Allocations']){
 test('operation route recovers a lost '+module+' insert response by its unique key',()=>{
  const f=creationFixture(),create=f.ctx.zoho.crm.createRecord;let failed=false;
  f.ctx.zoho.crm.createRecord=(m,...args)=>{const result=create(m,...args);if(m===module&&!failed){failed=true;throw Error('Lost insert response');}return result;};
  assert.equal(f.create().error,true);const result=f.create();assert.equal(result.success,true,result.message);
  assert.equal(Object.values(f.db.Supplier_Payments).filter(p=>p.Invoice_Edit_Key==='test-create').length,1);assert.equal(Object.keys(f.db.Supplier_Pay_Allocations).length,1);assert.equal(f.db.Supplier_Invoices[1].Amount_Paid,120);
 });
}

test('undo preview validates linked source payments without bypassing guards for actual writes',()=>{const f=setup();assert.equal(f.run({'1':100}).success,true);f.db.Prepayments['6']={id:'6',Vendor_Payment:{id:'3'}};const before=f.writes.length;assert.equal(f.run({'1':0},{validate_only:true,undo_preview:true}).success,true);assert.equal(f.writes.length,before);assert.equal(f.run({'1':0},{undo_preview:true}).success,false);assert.equal(f.writes.length,before);delete f.db.Prepayments['6'];assert.equal(f.run({'1':0}).success,true);assert.equal(f.db.Supplier_Invoices['1'].Amount_Paid,0);assert.equal(f.db.Supplier_Payments['3'].Payment_Amount,0);assert.ok(f.rebuilt.at(-1).includes('10'));});
test('settlement warnings prevent reporting a completed payment reconciliation',()=>{const f=setup();f.ctx.standalone.rebuildSupplierSettlementTotals=()=>JSON.stringify({error:false,warning_count:1,message:'Service updates pending'});const r=f.run({'1':100});assert.equal(r.success,false);assert.match(r.message,/Service updates pending/);});
test('undo exposes the blocking warning even when settlement rebuild says completed',()=>{const f=setup();assert.equal(f.run({'1':100}).success,true);f.ctx.standalone.rebuildSupplierSettlementTotals=()=>JSON.stringify({error:false,warning_count:1,message:'Rebuild completed. Processed 34 settlement(s) and updated 0.',warnings:['Settlement TEST has a paid mismatch: invoices = 100, allocations = 0.']});const r=f.run({'1':0});assert.equal(r.success,false);assert.equal(r.error,true);assert.match(r.message,/Blocking settlement warnings:.*TEST.*paid mismatch/);assert.equal(r.settlement_rebuild.warning_count,1);assert.equal(f.db.Supplier_Payments['3'].Payment_Amount,100);});
function overpaidRebuild(){return {error:false,warning_count:1,processed_count:1,warnings:['Existing overpayment after credit note'],details:[{has_payment_mismatch:false,is_overpaid:true}]};}
test('full outbound undo completes with consistent overpayment warnings from other payments',()=>{const f=setup();assert.equal(f.run({'1':100}).success,true);f.ctx.standalone.rebuildSupplierSettlementTotals=()=>JSON.stringify(overpaidRebuild());const r=f.run({'1':0});assert.equal(r.success,true,r.message);assert.equal(f.db.Supplier_Payments['3'].Payment_Amount,0);assert.equal(r.warnings.length,1);assert.equal(r.settlement_rebuild.warning_count,1);});
for(const mode of ['partial','refund','mismatch','error','unknown-warning','missing-details']){
 test('overpayment exception remains blocked for '+mode,()=>{const f=setup();assert.equal(f.run({'1':100}).success,true);const rebuilt=overpaidRebuild();if(mode==='refund')f.db.Supplier_Payments['3'].Movement_Type='Supplier Refund';if(mode==='mismatch')rebuilt.details[0].has_payment_mismatch=true;if(mode==='error')rebuilt.error=true;if(mode==='unknown-warning'){rebuilt.warning_count++;rebuilt.warnings.push('Unrelated warning');}if(mode==='missing-details')delete rebuilt.details;f.ctx.standalone.rebuildSupplierSettlementTotals=()=>JSON.stringify(rebuilt);const r=f.run({'1':mode==='partial'?50:0});assert.equal(r.success,false);assert.equal(f.db.Supplier_Payments['3'].Payment_Amount,100);});
}
