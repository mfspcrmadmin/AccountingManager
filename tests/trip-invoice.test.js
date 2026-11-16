const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {transpile}=require('./helpers/deluge-registration-harness');
function setup(options={}) {
  const db={Deals:{'1':{id:'1',Modified_Time:'v1',Closure_Status:'Closure Completed',Balance_Amount:0,Account_Name:{id:'a',name:'Client'},MFSP_Reference:'MFSP2601234',Currency:'EUR',Sales_Price_inc_Taxes:1200,Final_Commission:100}},Supplier_Settlements:{'s1':{id:'s1',Booking:{id:'1'},Admin_Status:'Active',Closure_Review_Status:'Reviewed',Modified_Time:'v1'}},Invoices:{},Payment_Requests:{},Invoices_X_Payment_R:{}};
  const ctx=vm.createContext({}),writes=[];
  vm.runInContext(`
  function Map(){return {}};function List(){return []};function ifnull(v,f){return v==null?f:v};
  Object.defineProperties(Object.prototype,{get:{value:function(k){return this[k]==null?null:this[k]}},put:{value:function(k,v){this[k]=v}},toString:{value:function(){return JSON.stringify(this)},configurable:true}});
  Array.prototype.add=function(v){this.push(v)};Array.prototype.size=function(){return this.length};Array.prototype.contains=function(v){return this.includes(v)};
  String.prototype.toTime=function(){return Date.parse(this.replace(" ","T")+"Z")};String.prototype.replaceAll=String.prototype.replaceAll;String.prototype.contains=function(v){return this.includes(v)};String.prototype.toMap=function(){return JSON.parse(this)};String.prototype.toList=function(s){return this.split(s)};String.prototype.matches=function(s){return new RegExp('^(?:'+s+')$').test(this)};
  String.prototype.toLong=String.prototype.toDecimal=function(){if(!Number.isFinite(Number(this)))throw Error('Invalid number');return Number(this)};
  Number.prototype.toLong=Number.prototype.toDecimal=function(){return Number(this)};Number.prototype.round=function(n){return Math.round(Number(this)*10**n)/10**n};String.prototype.subString=String.prototype.substring;
  String.prototype.toDate=function(){const d=new Date(this+'T00:00:00Z');return {toString:()=>d.toISOString().slice(0,10)}};
  var standalone={};`,ctx);
  const inside=o=>vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(o))+')',ctx);
  let next=10;
  ctx.zoho={loginuser:'accountant@example.com',currenttime:{toString:()=> '2026-11-04T12:00:00'},creator:{getRecords:(owner,app,report,criteria,start,limit)=>{if(options.creatorFailure)return inside({code:401});const data=report==='All_Travellers_Payments'?(options.creatorPayments===undefined?[{ID:'301',Status:'PAID',Amount:'1200.00',Payment_Date:'2026-11-01'}]:options.creatorPayments):(options.creatorRefunds||[]);const batch=data.slice(start-1,start-1+limit);return inside({code:batch.length?3000:3100,data:batch});}},crm:{getRelatedRecords:(relation,module,id,page,limit)=>inside((options.notes||[]).slice((page-1)*limit,page*limit)),getRecordById:(module,id)=>inside(db[module]?.[id]||{}),createRecord:(module,values)=>{
    const row=JSON.parse(JSON.stringify(values));
    if(options.collision){options.collision=false;db.Invoices['9']={id:'9',Trip_Invoice_Number:row.Trip_Invoice_Number,Trip_Invoice_Sequence:row.Trip_Invoice_Sequence,Trip_Invoice_Year:row.Trip_Invoice_Year,Deal_Name__s:{id:options.sameBooking?'1':'2'},Subject:row.Subject,Invoice_Date:row.Invoice_Date,Grand_Total:1200};if(options.sameBooking)db.Invoices[9].Trip_Booking_Key=row.Trip_Booking_Key;}
    const duplicate=Object.values(db.Invoices).find(r=>r.Trip_Invoice_Number===row.Trip_Invoice_Number||r.Trip_Booking_Key===row.Trip_Booking_Key);
    if(duplicate)return inside({code:'DUPLICATE_DATA',details:{id:duplicate.id}});
    if(options.createFailure)return inside({code:'NO_PERMISSION'});
    const id=String(next++);db.Invoices[id]={id,...row,Grand_Total:row.Invoiced_Items[0].List_Price,Balance_Due:row.Invoiced_Items[0].List_Price-Number(row.Total_Paid_Amount||0),Modified_Time:'i-v1',Deal_Name__s:{id:String(row.Deal_Name__s)}};writes.push(['create',id,row]);
    if(options.lostResponse){options.lostResponse=false;throw Error('Lost response');}
    return inside({id});
  },updateRecord:(module,id,values)=>{
    if(options.linkFailure)throw Error('Link failed');
    Object.assign(db[module][id],JSON.parse(JSON.stringify(values)));if(db[module][id].Sales_Invoice)db[module][id].Sales_Invoice={id:String(typeof db[module][id].Sales_Invoice==='object'?db[module][id].Sales_Invoice.id:db[module][id].Sales_Invoice)};writes.push(['link',id]);return inside({id:String(id)});
  }}};
  ctx.invoke=o=>{
    if(options.readFailure)return inside({responseCode:503,responseText:'Unavailable'});
    if(o.url.includes('/creator/v2.1/')) {
      const id=o.url.split('/').at(-1),refund=o.url.includes('All_Refunds');
      const rows=refund?(options.creatorRefunds||[]):(options.creatorPayments===undefined?[{ID:'301',Status:'PAID',Amount:'1200.00',Payment_Date:'2026-11-01'}]:options.creatorPayments);
      const row=rows.find(r=>r.ID===id);
      const full={...row,Booking_Id:options.wrongPaymentBooking?'2':'1','Travellers_Payment_Request.Booking_Id':options.wrongPaymentBooking?'2':'1'};
      return inside({responseCode:200,responseText:JSON.stringify({code:3000,data:full})});
    }
    if(o.url.match(/\/Invoices\/[^/]+$/)&&o.type==='PUT') {
      const id=o.url.split('/').at(-1),values=JSON.parse(o.parameters).data[0];
      if(o.headers['If-Unmodified-Since']!==db.Invoices[id].Modified_Time)return inside({responseCode:412,responseText:JSON.stringify({code:'RECORD_LOCKED'})});
      Object.assign(db.Invoices[id],values);db.Invoices[id].Balance_Due=db.Invoices[id].Grand_Total-db.Invoices[id].Total_Paid_Amount;db.Invoices[id].Modified_Time+='x';writes.push(['invoice-update',id,values]);
      return inside({responseCode:200,responseText:JSON.stringify({data:[{code:'SUCCESS'}]})});
    }
    if(o.url.endsWith('/Invoices')) {
      const created=ctx.zoho.crm.createRecord('Invoices',JSON.parse(o.parameters).data[0]);
      const row=created.id?{code:'SUCCESS',status:'success',details:{id:created.id}}:JSON.parse(JSON.stringify(created));
      return inside({responseCode:created.id?201:400,responseText:JSON.stringify({data:[row]})});
    }
    const query=JSON.parse(o.parameters).select_query;
    if(query.includes('Trip_Invoice_Year =')) {
      const year=Number(query.match(/Trip_Invoice_Year = (\d+)/)[1]);
      const rows=Object.values(db.Invoices).filter(r=>r.Trip_Invoice_Year===year).sort((a,b)=>b.Trip_Invoice_Sequence-a.Trip_Invoice_Sequence).slice(0,1);
      return inside({responseCode:rows.length?200:204,responseText:JSON.stringify({data:rows})});
    }
    const [,module,field,id,offset]=query.match(/from (\w+) where (\w+) = '(\d+)' order by id asc limit (\d+), 200/);
    let rows=Object.values(db[module]).filter(r=>String(r[field]?.id||r[field])===id);
    const batch=rows.slice(Number(offset),Number(offset)+200);
    return inside({responseCode:batch.length?200:204,responseText:JSON.stringify({data:batch,info:{more_records:rows.length>Number(offset)+200}})});
  };
  for(const name of ['tripInvoice_readRelated','tripInvoice_collections','tripInvoice_manage']){
    vm.runInContext(transpile(fs.readFileSync('crm/trip-invoice/'+name+'.dg','utf8')),ctx);ctx.standalone[name]=ctx[name];
  }
  function run(action='preview',date='2026-11-04',snapshot='',basis='gross'){return JSON.parse(ctx.tripInvoice_manage('1',action,date,basis,snapshot))}
  return {db,writes,options,run,issue(date='2026-11-04'){const preview=run('preview',date);assert.equal(preview.success,true,preview.message);return run('issue',date,preview.snapshot)}};
}
test('preview is read-only and issue creates one full-price invoice and links its chosen date',()=>{
  const f=setup(),p=f.run();assert.equal(p.success,true,p.message);assert.equal(p.amount,1200);assert.equal(f.writes.length,0);
  const issued=f.run('issue','2026-11-04',p.snapshot);assert.equal(issued.success,true,issued.message);assert.equal(issued.invoice_number,'FV-2026-000001');
  const row=f.db.Invoices[issued.invoice_id];assert.equal(row.Invoice_Date,'2026-11-04');assert.equal(row.Invoiced_Items[0].List_Price,1200);assert.equal(row.Tax,0);assert.equal(row.Agent_commission,100);assert.equal(f.db.Deals[1].Sales_Invoice_Number,issued.invoice_number);
  assert.equal(f.run('issue','2027-01-01').invoice_id,issued.invoice_id);assert.equal(Object.keys(f.db.Invoices).length,1);
});
test('number collisions advance the sequence and a concurrent same-Booking issue is recovered',()=>{
  const f=setup({collision:true});const result=f.issue();assert.equal(result.invoice_number,'FV-2026-000002',JSON.stringify(result));assert.equal(f.writes.filter(w=>w[0]==='create').length,1);
  const same=setup({collision:true,sameBooking:true});assert.equal(same.issue().invoice_id,'9');assert.equal(same.writes.filter(w=>w[0]==='create').length,0);
});
test('annual sequence restarts for the selected invoice year',()=>{
  const f=setup();f.db.Invoices.old={id:'old',Deal_Name__s:{id:'2'},Trip_Invoice_Year:2026,Trip_Invoice_Sequence:23,Trip_Invoice_Number:'FV-2026-000023'};
  assert.equal(f.issue('2027-01-05').invoice_number,'FV-2027-000001');
});
test('lost create response and failed link never produce a second invoice on retry',()=>{
  const f=setup({lostResponse:true});assert.equal(f.issue().success,false);const result=f.run('issue');assert.equal(result.success,true,result.message);assert.equal(Object.keys(f.db.Invoices).length,1);
  const link=setup({linkFailure:true});assert.ok(link.issue().warning);link.options.linkFailure=false;assert.equal(link.run('issue').warning,undefined);assert.equal(Object.keys(link.db.Invoices).length,1);
});
test('changed preview, nonzero or unavailable balance, unreviewed or incomplete closures block all writes',()=>{
  for(const change of [b=>b.Balance_Amount=1,b=>b.Balance_Amount=-1,b=>b.Balance_Amount=null,b=>b.Closure_Status='Closure In Review',b=>b.Account_Name=null,b=>b.Sales_Price_inc_Taxes=null,b=>b.Currency='']){
    const f=setup();change(f.db.Deals[1]);const result=f.run('issue');assert.equal(result.success,false);assert.equal(f.writes.length,0);
  }
  const f=setup(),p=f.run();f.db.Deals[1].Sales_Price_inc_Taxes=1300;assert.equal(f.run('issue','2026-11-04',p.snapshot).success,false);assert.equal(f.writes.length,0);
  const pending=setup();pending.db.Supplier_Settlements.s1.Closure_Review_Status='Pending review';assert.equal(pending.run().success,false);
});
test('No Services settlements do not block reviewed active settlements, but active reviews remain required',()=>{
  for(const status of ['No Services','No services','NO SERVICES']) {
    const f=setup();
    f.db.Supplier_Settlements.empty={id:'empty',Booking:{id:'1'},Admin_Status:status,Closure_Review_Status:null};
    assert.equal(f.run('inspect').success,true,status);
    assert.equal(f.writes.length,0);
    f.db.Supplier_Settlements.s1.Closure_Review_Status='Pending review';
    assert.equal(f.run('inspect').success,false);
    delete f.db.Supplier_Settlements.s1;
    assert.equal(f.run('inspect').success,false);
  }
});
test('pagination checks settlement 201 and read errors never permit an invoice',()=>{
  const f=setup();for(let i=0;i<201;i++)f.db.Supplier_Settlements['x'+i]={id:'x'+i,Booking:{id:'1'},Closure_Review_Status:i===200?'Pending review':'Reviewed'};
  assert.equal(f.run().success,false);assert.equal(f.writes.length,0);
  assert.equal(setup({readFailure:true}).run().success,false);
});
test('legacy invoices are recovered and multiple invoices, stale links, invalid dates and net amounts are rejected',()=>{
  const f=setup();f.db.Invoices.old={id:'old',Subject:'206877',Invoice_Date:'2026-07-31',Grand_Total:1200,Deal_Name__s:{id:'1'},Type:'Invoice'};
  assert.equal(f.run().invoice_id,'old');assert.equal(f.writes.length,0);
  f.db.Invoices.other={...f.db.Invoices.old,id:'other'};assert.equal(f.run().multiple,true);
  const missing=setup();missing.db.Deals[1].Sales_Invoice={id:'absent'};assert.equal(missing.run().success,false);
  const date=setup();assert.equal(date.run('preview','2026-02-30').success,false);assert.equal(date.run('preview','2026-11-04','','net').success,false);
});

test('issuance saves source, MFSP, paid receipts, completed refunds and the net invoice balance',()=>{
 const f=setup({creatorPayments:[{ID:'301',Status:'PAID',Amount:'1500.00'}],creatorRefunds:[{ID:'401',Status:'SUCCESS',Final_Amount_Refunded:'300.00'}]});
 const result=f.issue();assert.equal(result.success,true,result.message);const row=f.db.Invoices[result.invoice_id];
 assert.equal(row.Invoice_Origin,'Accounting Manager');assert.equal(row.Booking_MFSP,'MFSP2601234');assert.equal(row.Collected_Amount,1500);assert.equal(row.Refunded_Amount,300);assert.equal(row.Total_Paid_Amount,1200);assert.equal(row.Balance_Due,0);assert.equal(row.Collections_Status,'Verified');
 const evidence=JSON.parse(row.Collection_Evidence);assert.equal(evidence.records.length,2);assert.equal(evidence.net,1200);
});
test('missing, pending, overlapping and mismatched collections stop before issuing or numbering',()=>{
 for(const options of [{creatorPayments:[]},{creatorFailure:true},{creatorRefunds:[{ID:'401',Status:'PENDING'}]},{creatorRefunds:[{ID:'401',Status:'SUCCESS',Final_Amount_Refunded:''}]},{creatorPayments:[{ID:'301',Status:'PAID',Amount:'1100.00'}]}]){
  const f=setup(options),result=f.run();assert.equal(result.success,false,JSON.stringify(options));assert.equal(f.writes.length,0);
 }
 const overlap=setup();overlap.db.Payment_Requests[501]={id:'501',Booking:{id:'1'},Paid:true,Status:'Delivered',Amount:1200,Currency:'EUR'};assert.equal(overlap.run().success,false);assert.equal(overlap.writes.length,0);
});
test('legacy confirmed receipts link natively; existing allocations cannot be reused',()=>{
 const f=setup({creatorPayments:[]});f.db.Payment_Requests[501]={id:'501',Booking:{id:'1'},Paid:true,Status:'Delivered',Amount:1200,Currency:'EUR',Payment_ID:'bank-1'};
 const result=f.issue();assert.equal(result.success,true,result.message);assert.equal(f.db.Invoices[result.invoice_id].Collection_Source,'CRM Payment Requests');assert.deepEqual(f.db.Invoices[result.invoice_id].Payment_Requests,[{Payment_Requests:{id:'501'}}]);
 const reused=setup({creatorPayments:[]});reused.db.Payment_Requests[501]={...f.db.Payment_Requests[501]};reused.db.Invoices_X_Payment_R[601]={id:'601',Payment_Requests:{id:'501'},Invoices:{id:'other'}};assert.equal(reused.run().success,false);assert.equal(reused.writes.length,0);
});
test('unpaid payments and failed refunds do not count, and evidence changes invalidate the reviewed draft',()=>{
 const f=setup({creatorPayments:[{ID:'301',Status:'PAID',Amount:'1200'},{ID:'302',Status:'UNPAID',Amount:'600'}],creatorRefunds:[{ID:'401',Status:'FAILED'}]});
 const preview=f.run();assert.equal(preview.amount,1200);f.options.creatorPayments[0].Amount='1300';const issued=f.run('issue','2026-11-04',preview.snapshot);assert.equal(issued.success,false);assert.equal(f.writes.length,0);
});
test('collections refresh requires a reviewed snapshot, updates receipts without renumbering and protects historical invoices',()=>{
 const f=setup();const issued=f.issue();f.options.creatorRefunds=[{ID:'401',Status:'SUCCESS',Final_Amount_Refunded:'100'}];
 const p=f.run('collections-preview');assert.equal(p.success,true,p.message);assert.equal(p.balance_due,100);assert.equal(f.writes.filter(w=>w[0]==='invoice-update').length,0);
 const saved=f.run('collections-apply','',p.snapshot);assert.equal(saved.success,true,saved.message);assert.equal(f.db.Invoices[issued.invoice_id].Total_Paid_Amount,1100);assert.equal(f.db.Invoices[issued.invoice_id].Balance_Due,100);assert.equal(f.db.Invoices[issued.invoice_id].Subject,'FV-2026-000001');
 const legacy=setup();legacy.db.Invoices[801]={id:'801',Subject:'206877',Type:'Invoice',Deal_Name__s:{id:'1'},Grand_Total:1200};assert.equal(legacy.run('collections-preview').success,false);assert.equal(legacy.writes.length,0);
});
test('a credit note original invoice link is explicit, checks versions and changes no amounts',()=>{
 const f=setup();f.db.Invoices[801]={id:'801',Subject:'206877',Type:'Invoice',Deal_Name__s:{id:'1'},Grand_Total:1200,Currency:'EUR',Modified_Time:'v1',Invoice_Date:'2026-10-01'};f.db.Invoices[802]={id:'802',Subject:'CN1',Type:'Credit Notes',Deal_Name__s:{id:'1'},Grand_Total:1200,Currency:'EUR',Modified_Time:'v1',Invoice_Date:'2026-10-02'};
 const request={credit_id:'802',original_id:'801',credit_modified:'v1',original_modified:'v1'};
 const result=f.run('link-original','',JSON.stringify(request));assert.equal(result.success,true,result.message);assert.equal(f.db.Invoices[802].Original_Sales_Invoice,'801');assert.equal(f.db.Invoices[802].Grand_Total,1200);assert.equal(f.writes.filter(w=>w[0]==='create').length,0);
 const stale=f.run('link-original','',JSON.stringify(request));assert.equal(stale.success,false);
});

test('collection pagination includes payment 201, verifies Booking ownership and detects repeated provider references',()=>{
 const payments=Array.from({length:201},(_,i)=>({ID:String(1000+i),Status:'PAID',Amount:i===200?'1000':'1'}));
 const f=setup({creatorPayments:payments});assert.equal(f.run().collections.net,1200);
 const wrong=setup({wrongPaymentBooking:true});assert.equal(wrong.run().success,false);assert.equal(wrong.writes.length,0);
 const repeated=setup({creatorPayments:[{ID:'301',Status:'PAID',Amount:'600',Successful_Payment_Intent_Id:'same'},{ID:'302',Status:'PAID',Amount:'600',Successful_Payment_Intent_Id:'same'}]});assert.equal(repeated.run().success,false);assert.equal(repeated.writes.length,0);
});

function historicalSetup(options={}) { const f=setup({creatorPayments:[],...options});f.db.Deals[1].Paid_Amount=1200;return f; }
const historicalRequest=()=>JSON.stringify({historical_confirmation:{confirmed:true,amount:1200,origin:'Tourplan',reference:'Legacy bank record 123'}});
test('historical payment requires manual review and persists evidence without creating receipts',()=>{
 const f=historicalSetup();const inspect=f.run('inspect');assert.equal(inspect.success,true,inspect.message);assert.equal(inspect.historical_required,true);assert.equal(inspect.historical_amount,1200);assert.equal(f.writes.length,0);
 assert.equal(f.run('preview').success,false);
 const preview=f.run('preview','2026-11-04',historicalRequest());assert.equal(preview.success,true,preview.message);assert.equal(f.writes.length,0);
 const issued=f.run('issue','2026-11-04',preview.snapshot);assert.equal(issued.success,true,issued.message);
 const invoice=f.db.Invoices[issued.invoice_id];assert.equal(invoice.Collection_Source,'Historical manual confirmation');assert.equal(invoice.Total_Paid_Amount,1200);
 const proof=JSON.parse(invoice.Collection_Evidence);assert.equal(proof.records[0].confirmation.confirmed_by,'accountant@example.com');assert.equal(proof.records[0].confirmation.origin,'Tourplan');assert.ok(proof.confirmed_at);assert.equal(Object.keys(f.db.Payment_Requests).length,0);
 assert.equal(f.run('collections-preview').success,false);assert.equal(f.run('issue','2026-11-04',preview.snapshot).invoice_id,issued.invoice_id);
});
test('historical payment cannot bypass detailed records, refunds, failures or inconsistent Booking figures',()=>{
 for(const options of [{creatorPayments:[{ID:'301',Status:'UNPAID',Amount:'1200'}]}, {creatorRefunds:[{ID:'401',Status:'FAILED'}]}, {creatorFailure:true}]){
  const f=historicalSetup(options);const result=f.run('inspect');assert.equal(result.success,false);assert.notEqual(result.historical_required,true);assert.equal(f.writes.length,0);
 }
 for(const patch of [{Paid_Amount:null},{Paid_Amount:1100},{Balance_Amount:1},{Currency:'USD'}]){const f=historicalSetup();Object.assign(f.db.Deals[1],patch);assert.equal(f.run('inspect').success,false);assert.equal(f.writes.length,0)}
 const f=historicalSetup();f.db.Payment_Requests.p={id:'p',Booking:{id:'1'},Paid:false};assert.equal(f.run('inspect').success,false);
});
test('historical confirmation validates amount, opt-in, origin and stale preview',()=>{
 for(const patch of [{confirmed:false},{amount:1100},{origin:''}]){
  const f=historicalSetup();const request=JSON.parse(historicalRequest());Object.assign(request.historical_confirmation,patch);assert.equal(f.run('preview','2026-11-04',JSON.stringify(request)).success,false);assert.equal(f.writes.length,0);
 }
 const f=historicalSetup();const preview=f.run('preview','2026-11-04',historicalRequest());assert.equal(preview.success,true,preview.message);f.db.Deals[1].Paid_Amount=1100;assert.equal(f.run('issue','2026-11-04',preview.snapshot).success,false);assert.equal(f.writes.length,0);
 const changed=historicalSetup();const p=changed.run('preview','2026-11-04',historicalRequest());changed.options.creatorPayments=[{ID:'301',Status:'PAID',Amount:'1200'}];assert.equal(changed.run('issue','2026-11-04',p.snapshot).success,false);assert.equal(changed.writes.length,0);
});


test('partial historical confirmation preserves detailed receipts and refunds and confirms only the remainder',()=>{
 const f=setup({creatorPayments:[{ID:'301',Status:'PAID',Amount:'869'}],creatorRefunds:[{ID:'401',Status:'SUCCESS',Final_Amount_Refunded:'100'}]});
 Object.assign(f.db.Deals[1],{Sales_Price_inc_Taxes:3329,Paid_Amount:3329});
 const inspect=f.run('inspect');assert.equal(inspect.success,true,inspect.message);assert.equal(inspect.detailed_net,769);assert.equal(inspect.historical_amount,2560);assert.equal(f.writes.length,0);
 const request=JSON.stringify({historical_confirmation:{confirmed:true,amount:2560,origin:'Tourplan',reference:'Bank migration 149750'}});
 const p=f.run('preview','2026-11-04',request);assert.equal(p.success,true,p.message);assert.equal(p.collections.net,3329);assert.equal(p.collections.refunded,100);
 const issued=f.run('issue','2026-11-04',p.snapshot);assert.equal(issued.success,true,issued.message);
 const invoice=f.db.Invoices[issued.invoice_id],proof=JSON.parse(invoice.Collection_Evidence);
 assert.equal(invoice.Collected_Amount,3429);assert.equal(invoice.Refunded_Amount,100);assert.equal(invoice.Total_Paid_Amount,3329);
 assert.equal(proof.records.length,3);assert.equal(proof.records[0].amount_eur,869);assert.equal(proof.records[1].amount_eur,100);assert.equal(proof.records[2].amount_eur,2560);
 assert.equal(proof.records[2].confirmation.reference,'Bank migration 149750');assert.ok(proof.records[2].confirmation.confirmed_at);
 assert.equal(f.run('collections-preview').success,false);assert.equal(Object.keys(f.db.Payment_Requests).length,0);
 assert.equal(f.run('issue','2026-11-04',p.snapshot).invoice_id,issued.invoice_id);
});
test('partial historical remainder cannot cover overpayments, unconfirmed requests, failed reads or stale evidence',()=>{
 for(const payments of [[{ID:'301',Status:'PAID',Amount:'1300'}],[{ID:'301',Status:'PAID',Amount:'869'},{ID:'302',Status:'UNPAID',Amount:'331'}]]){
  const f=historicalSetup({creatorPayments:payments});assert.equal(f.run('inspect').success,false);assert.equal(f.writes.length,0);
 }
 const f=historicalSetup({creatorPayments:[{ID:'301',Status:'PAID',Amount:'869'}]});
 const request=JSON.stringify({historical_confirmation:{confirmed:true,amount:331,origin:'Tourplan',reference:'Bank entry 123'}});
 const p=f.run('preview','2026-11-04',request);assert.equal(p.success,true,p.message);
 f.options.creatorPayments[0].Amount='900';assert.equal(f.run('issue','2026-11-04',p.snapshot).success,false);assert.equal(f.writes.length,0);
 const missing=JSON.parse(request);missing.historical_confirmation.reference='';assert.equal(f.run('preview','2026-11-04',JSON.stringify(missing)).success,false);
});


test('cancelled or expired payment requests do not block a verified partial historical remainder',()=>{
 for(const status of ['CANCELLED','EXPIRED']){
  const f=setup({creatorPayments:[{ID:'301',Status:status,Amount:'130'},{ID:'302',Status:'PAID',Amount:'130'}]});
  Object.assign(f.db.Deals[1],{Sales_Price_inc_Taxes:39021,Paid_Amount:39021});
  const inspected=f.run('inspect');assert.equal(inspected.success,true,inspected.message);assert.equal(inspected.historical_required,true);assert.equal(inspected.historical_amount,38891);assert.equal(inspected.detailed_net,130);
  const request=JSON.stringify({historical_confirmation:{confirmed:true,amount:38891,origin:'Tourplan',reference:'Original payment ledger'}});
  const p=f.run('preview','2026-11-13',request);assert.equal(p.success,true,p.message);assert.equal(p.collections.net,39021);assert.equal(f.writes.length,0);
 }
});


test('historical remainder requires origin and explicit confirmation but no supporting reference',()=>{
 const f=historicalSetup({creatorPayments:[{ID:'301',Status:'PAID',Amount:'869'}]});
 const request=JSON.stringify({historical_confirmation:{confirmed:true,amount:331,origin:'Tourplan'}});
 const preview=f.run('preview','2026-11-13',request);assert.equal(preview.success,true,preview.message);
 assert.equal(f.writes.length,0);
});


test('invoice honors the exact unchanged settlement review exception accepted at closure',()=>{
 const note={Note_Title:'Trip closure accepted exceptions',Created_Time:'2026-11-13T14:19:45+01:00',Note_Content:'Accepted by: accountant@example.com\nReason: TP migration\nSettlement not reviewed | NOSUPPLIER [s1] | Explicit migration exception'};
 const f=setup({notes:[note]});Object.assign(f.db.Supplier_Settlements.s1,{Closure_Review_Status:null,Modified_Time:'2026-09-22T12:01:58+02:00'});
 const result=f.run('inspect');assert.equal(result.success,true,result.message);assert.equal(f.writes.length,0);
});
test('review exceptions never authorize another settlement, an older acceptance or changed records',()=>{
 const accepted='Accepted by: accountant@example.com\nReason: TP migration\nSettlement not reviewed | NOSUPPLIER [s1] | Explicit migration exception';
 for(const [body,modified,extra] of [
  [accepted.replace('[s1]','[s2]'),'2026-09-22T12:01:58+02:00',[]],
  [accepted,'2026-11-13T14:20:00+01:00',[]],
  [accepted,'2026-11-13T14:20:00+02:00',[{Note_Title:'Trip closure accepted exceptions',Created_Time:'2026-11-13T14:21:00+01:00',Note_Content:'Accepted by: accountant@example.com\nReason: New review excludes this settlement'}]]
 ]){
  const f=setup({notes:[{Note_Title:'Trip closure accepted exceptions',Created_Time:'2026-11-13T14:19:45+01:00',Note_Content:body},...extra]});
  Object.assign(f.db.Supplier_Settlements.s1,{Closure_Review_Status:null,Modified_Time:modified});assert.equal(f.run('inspect').success,false);assert.equal(f.writes.length,0);
 }
});
