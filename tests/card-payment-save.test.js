const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const db={
  Card_Purchases:[{id:'1',Name:'Card charge',Amount:100,Currency:'EUR',Supplier:{id:'2'},Booking:{id:'3'},Vendor_Invoice:{id:'4'},Transaction_Type:'Purchase',Accounting_Status:'Pending payment record'}],
  Supplier_Invoices:[{id:'4',Supplier:{id:'2'},Booking:{id:'3'},Currency:'EUR',Status:'Received',Invoice_Type:'Final Invoice',Total_Payable_Amount:750}],
  Payment_Accounts:[{id:'5',Owner_Type:'Own',Status:'Active'}],
  Supplier_Payments:[],Supplier_Pay_Allocations:[],Prepayments:[],Prepayment_Invoice_Allocations:[]
 };
 const store=new Map(),calls=[],fail={},clone=o=>structuredClone(o);
 const api={
  getRecord:async({Entity,RecordID})=>{
   if(fail.read===Entity)throw Error('Read unavailable');
   return{data:db[Entity].filter(r=>r.id===String(RecordID)).map(clone)};
  },
  searchRecord:async({Entity,Query,page=1,per_page=200})=>{
   const [,field,value]=Query.match(/\((\w+):equals:(.*)\)/);
   return{data:db[Entity].filter(r=>String(r[field]?.id||r[field])===value).slice((page-1)*per_page,page*per_page).map(clone)};
  },
  updateRecord:async({Entity,APIData})=>{
   calls.push('link');if(fail.link==='before'){delete fail.link;throw Error('Link failed');}
   Object.assign(db[Entity].find(r=>r.id===APIData.id),clone(APIData));
   if(fail.link==='after'){delete fail.link;throw Error('Lost link response');}
   return{data:[{code:'SUCCESS'}]};
  }
 };
 let next=10,confirmed=0;
 const zoho={CRM:{API:api,FUNCTIONS:{execute:async(name,args)=>{
  const request=JSON.parse(args.arguments);
  if(request.supplierInvoiceIds==='capabilities')return{details:{output:{consistency_version:2}}};
  calls.push('create');const input=JSON.parse(request.paymentDataString);
  let payment=db.Supplier_Payments.find(r=>r.Invoice_Edit_Key===input.operation_key);
  if(!payment){
   payment={id:String(next++),Name:input.Name,Payment_Date:input.Payment_Date,Currency:input.Currency,Payment_Account:{id:input.Payment_Account},Payment_Amount:100,Movement_Type:input.Movement_Type,Status:'Paid',Invoice_Edit_Key:input.operation_key};
   db.Supplier_Payments.push(payment);
   db.Supplier_Pay_Allocations.push({id:String(next++),Supplier_Invoice:{id:'4'},Supplier_Payment:{id:payment.id},Allocated_Amount:100,Currency:'EUR'});
  }
  if(fail.reply){delete fail.reply;throw Error('Lost payment reply');}
  const result={success:!fail.partial,error:Boolean(fail.partial),payment_id:payment.id,allocation_ids:db.Supplier_Pay_Allocations.filter(r=>r.Supplier_Payment.id===payment.id).map(r=>r.id)};
  delete fail.partial;
  if(fail.paymentType)payment.Movement_Type=fail.paymentType;
  return{details:{output:result}};
 }}}};
 const window={};
 for(const file of ['prepayments.js','card-payment-save.js'])vm.runInNewContext(fs.readFileSync('app/scripts/'+file,'utf8'),{window});
 window.AccountingManagerApp.refreshQuickInvoiceSettlements=async()=>{calls.push('rebuild');return fail.rebuild?'Rebuild failed':'';};
 const deps={zoho,storage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},randomUUID:()=> 'operation-key',userEmail:async()=> 'user@example.com',confirmExisting:async()=>{confirmed++;return !fail.decline;}};
 const input={Name:'Card payment',Payment_Date:'2026-10-20',Payment_Account:'5',Review_Notes:'Checked'};
 function existing(amount=100){db.Supplier_Payments.push({id:'50',Name:'Existing',Payment_Amount:amount,Payment_Date:'2026-10-19',Currency:'EUR',Status:'Paid',Movement_Type:'Outbound Payment'});db.Supplier_Pay_Allocations.push({id:'51',Supplier_Payment:{id:'50'},Supplier_Invoice:{id:'4'},Allocated_Amount:amount,Currency:'EUR'});}
 return{db,store,calls,fail,api,deps,input,existing,confirmed:()=>confirmed,run:()=>window.AccountingManagerApp.saveCardPayment(deps,'1',input)};
}
test('creates only the card amount even when the invoice contains the higher service cost',async()=>{
 const f=fixture();await f.run();
 assert.equal(f.db.Supplier_Payments[0].Payment_Amount,100);
 assert.equal(f.db.Supplier_Invoices[0].Total_Payable_Amount,750);
 assert.equal(f.db.Card_Purchases[0].Accounting_Status,'Purchase recorded');
 assert.ok(f.calls.indexOf('rebuild')<f.calls.indexOf('link'));assert.equal(f.store.size,0);
});
test('existing unassigned payment needs confirmation and is linked without another payment',async()=>{
 const f=fixture();f.existing();await f.run();
 assert.equal(f.confirmed(),1);assert.equal(f.calls.includes('create'),false);assert.equal(f.db.Card_Purchases[0].Vendor_Payment.id,'50');
});
test('declining an existing payment creates and links nothing',async()=>{
 const f=fixture();f.existing();f.fail.decline=true;
 await assert.rejects(f.run(),/not linked/);assert.equal(f.calls.length,0);assert.equal(f.store.size,0);
});
test('multiple unassigned payments stop for review without creating another payment',async()=>{
 const f=fixture();f.existing();f.db.Supplier_Payments.push({...f.db.Supplier_Payments[0],id:'60'});
 f.db.Supplier_Pay_Allocations.push({...f.db.Supplier_Pay_Allocations[0],id:'61',Supplier_Payment:{id:'60'}});
 await assert.rejects(f.run(),/several recorded payments/);assert.equal(f.calls.length,0);
});
test('fully assigned earlier payments permit a distinct card charge; partial unassigned amounts require review',async()=>{
 for(const reserved of [100,50]){
  const f=fixture();f.existing();f.db.Card_Purchases.push({...f.db.Card_Purchases[0],id:'other',Amount:reserved,Vendor_Payment:{id:'50'}});
  if(reserved===100){await f.run();assert.equal(f.db.Supplier_Payments.length,2);}
  else{await assert.rejects(f.run(),/other operations/);assert.equal(f.calls.length,0);}
 }
});
test('payments already assigned to prepayments cannot be reused',async()=>{
 const f=fixture();f.existing(150);
 f.db.Prepayments.push({id:'pre',Vendor_Payment:{id:'50'}});
 f.db.Prepayment_Invoice_Allocations.push({id:'pa',Prepayment:{id:'pre'},Vendor_Invoice:{id:'4'},Allocated_Amount:100});
 await assert.rejects(f.run(),/other operations/);assert.equal(f.calls.length,0);
});
test('refund requires a credit note and verifies the resulting refund payment',async()=>{
 const f=fixture();f.db.Card_Purchases[0].Transaction_Type='Refund';
 await assert.rejects(f.run(),/purchase.refund type/);assert.equal(f.calls.length,0);
 f.db.Supplier_Invoices[0].Invoice_Type='Credit Note';await f.run();
 assert.equal(f.db.Supplier_Payments[0].Movement_Type,'Supplier Refund');assert.equal(f.db.Card_Purchases[0].Accounting_Status,'Refund recorded');
});
test('foreign supplier, booking, currency and unfinished invoice stop before creating',async()=>{
 for(const fields of [{Supplier:{id:'other'}},{Booking:{id:'other'}},{Currency:'USD'},{Registration_Key:'key',Registration_Status:'Ready'}]){
  const f=fixture();Object.assign(f.db.Supplier_Invoices[0],fields);
  await assert.rejects(f.run());assert.equal(f.calls.length,0);
 }
});
test('unexpected returned payment type never marks the card recorded and retains recovery',async()=>{
 const f=fixture();f.fail.paymentType='Supplier Refund';
 await assert.rejects(f.run(),/purchase.refund type/);assert.equal(f.calls.includes('link'),false);assert.equal(f.store.size,1);
});
for(const failure of ['reply','partial','rebuild','before','after']){
 test('resumes '+failure+' failure without a second payment',async()=>{
  const f=fixture();
  if(['before','after'].includes(failure))f.fail.link=failure;else f.fail[failure]=true;
  await assert.rejects(f.run());assert.equal(f.store.size,1);
  delete f.fail.rebuild;await f.run();
  assert.equal(f.db.Supplier_Payments.length,1);assert.equal(f.db.Card_Purchases[0].Accounting_Status,'Purchase recorded');assert.equal(f.store.size,0);
 });
}
test('deleted confirmed payment cannot be recreated on retry, including partial CRM results',async()=>{
 for(const partial of [false,true]){
  const f=fixture();f.fail[partial?'partial':'rebuild']=true;await assert.rejects(f.run());
  const before=f.calls.filter(c=>c==='create').length;
  f.db.Supplier_Payments=[];f.db.Supplier_Pay_Allocations=[];delete f.fail.rebuild;
  await assert.rejects(f.run(),/unavailable/);
  assert.equal(f.calls.filter(c=>c==='create').length,before);assert.equal(f.store.size,1);
 }
});
test('a confirmed ID read failure retains recovery without calling creation again',async()=>{
 const f=fixture();f.fail.rebuild=true;await assert.rejects(f.run());f.fail.read='Supplier_Payments';
 const before=f.calls.filter(c=>c==='create').length;await assert.rejects(f.run(),/Read unavailable/);
 assert.equal(f.calls.filter(c=>c==='create').length,before);assert.equal(f.store.size,1);
});
test('changed card amount on retry does not reuse the original payment',async()=>{
 const f=fixture();f.fail.rebuild=true;await assert.rejects(f.run());f.db.Card_Purchases[0].Amount=120;
 await assert.rejects(f.run(),/changed during/);assert.equal(f.calls.filter(c=>c==='create').length,1);
});
test('externally changed confirmed amount, allocation or account prevents linking on retry',async()=>{
 for(const field of ['Payment_Amount','Payment_Account','Allocated_Amount']){
  const f=fixture();f.fail.rebuild=true;await assert.rejects(f.run());delete f.fail.rebuild;
  if(field==='Allocated_Amount')f.db.Supplier_Pay_Allocations[0][field]=120;
  else f.db.Supplier_Payments[0][field]=field==='Payment_Account'?{id:'other'}:120;
  await assert.rejects(f.run(),/differ from the saved card request/);
  assert.equal(f.calls.includes('link'),false);assert.equal(f.calls.filter(c=>c==='create').length,1);
 }
});
test('existing payment is rechecked after confirmation before persisting a link',async()=>{
 const f=fixture();f.existing();f.deps.confirmExisting=async()=>{f.db.Supplier_Payments[0].Status='Cancelled';return true;};
 await assert.rejects(f.run(),/payment status/);assert.equal(f.calls.length,0);assert.equal(f.store.size,0);
});
test('legacy journal without a discoverable payment cannot recreate a deleted payment',async()=>{
 const f=fixture();f.store.set('accounting-manager:card-payment:v1:1',JSON.stringify({operation_key:'old',Currency:'EUR',Movement_Type:'Outbound Payment',allocations:{'4':100}}));
 await assert.rejects(f.run(),/older payment request/);assert.equal(f.calls.length,0);
});
