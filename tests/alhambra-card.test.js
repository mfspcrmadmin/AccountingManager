const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const alhambra='616617000003010705',iacpos='616617000003265040';
 const db={
  Card_Purchases:[{id:'1',Amount:81.66,Currency:'EUR',Supplier:{id:alhambra},Booking:{id:'3'},Vendor_Invoice:{id:'4'},Transaction_Type:'Purchase',Accounting_Status:'Pending payment record'}],
  Supplier_Invoices:[{id:'4',Name:'Alhambra tickets',Supplier:{id:alhambra},Booking:{id:'3'},Currency:'EUR',Invoice_Date:'2026-10-16',Status:'Received',Invoice_Type:'Tickets',Total_Payable_Amount:77}],
  Supplier_Settlements:[{id:'6',Name:'MFSP-IACPOS',Supplier:{id:iacpos},Booking:{id:'3'},Currency:'EUR'}],
  Vendors:[{id:iacpos,Vendor_Name:'Iacpos',TP_Reference:'IACPOS'}],
  Payment_Accounts:[{id:'5',Owner_Type:'Own',Status:'Active'}],
  Supplier_Payments:[],Supplier_Pay_Allocations:[],Inv_Set_Allocations:[],Prepayments:[],Prepayment_Invoice_Allocations:[]
 };
 const store=new Map(),fail={},calls=[];let next=10;
 const clone=v=>structuredClone(v),id=v=>String(v?.id||v||'');
 const api={
  getRecord:async({Entity,RecordID})=>({data:db[Entity].filter(r=>r.id===RecordID).map(clone)}),
  searchRecord:async({Entity,Query})=>({data:fail.searchLag && Entity==='Supplier_Invoices' ? [] : db[Entity].filter(r=>[...Query.matchAll(/(\w+):equals:([^()]+)/g)].every(m=>id(r[m[1]])===m[2])).map(clone)}),
  insertRecord:async({Entity,APIData})=>{
   const record={...clone(APIData[0]),id:String(next++)};db[Entity].push(record);calls.push('insert:'+Entity);
   if(fail.insert===Entity){delete fail.insert;throw Error('Lost insert response');}
   return{data:[{code:'SUCCESS',details:{id:record.id}}]};
  },
  updateRecord:async({Entity,APIData})=>{
   if(fail.link&&Entity==='Card_Purchases'){delete fail.link;throw Error('Link failed');}
   Object.assign(db[Entity].find(r=>r.id===APIData.id),clone(APIData));
   return{data:[{code:'SUCCESS'}]};
  }
 };
 const zoho={CRM:{API:api,META:{getFields:async()=>({fields:[{api_name:'Registration_Key',unique:{casesensitive:'1'}}]})},FUNCTIONS:{execute:async(name,args)=>{
  const request=JSON.parse(args.arguments);
  if(request.supplierInvoiceIds==='capabilities')return{details:{output:{consistency_version:2}}};
  const input=JSON.parse(request.paymentDataString);calls.push({request:input,ids:request.supplierInvoiceIds});
  let payment=db.Supplier_Payments.find(r=>r.Invoice_Edit_Key===input.operation_key);
  if(!payment){
   payment={id:String(next++),Name:input.Name,Payment_Account:{id:input.Payment_Account},Currency:input.Currency,Payment_Amount:81.66,Movement_Type:input.Movement_Type,Status:'Paid',Invoice_Edit_Key:input.operation_key};
   db.Supplier_Payments.push(payment);
   for(const [invoiceId,amount]of Object.entries(input.allocations)) db.Supplier_Pay_Allocations.push({id:String(next++),Supplier_Invoice:{id:invoiceId},Supplier_Payment:{id:payment.id},Allocated_Amount:amount,Currency:'EUR'});
  }
  if(fail.payment){delete fail.payment;throw Error('Lost payment response');}
  return{details:{output:{success:true,error:false,payment_id:payment.id,allocation_ids:db.Supplier_Pay_Allocations.map(r=>r.id)}}};
 }}}};
 const elements=new Map(),document={getElementById(id){if(!elements.has(id))elements.set(id,{hidden:false,innerHTML:'',replaceChildren(){this.innerHTML='';}});return elements.get(id);}};
 const window={ZOHO:zoho};
 for(const file of ['prepayments.js','card-purchase-settlements.js','quick-invoice-records.js','alhambra-card.js','card-payment-save.js'])vm.runInNewContext(fs.readFileSync('app/scripts/'+file,'utf8'),{window,Intl,document});
 const ns=window.AccountingManagerApp;
 ns.refreshQuickInvoiceSettlements=async(_,invoiceId)=>{calls.push('refresh:'+invoiceId);if(fail.refresh){delete fail.refresh;return 'Refresh failed';}return '';};
 const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 window.localStorage=storage;
 const deps={zoho,storage,randomUUID:()=> 'split-operation',userEmail:async()=>'',confirmExisting:async()=>true};
 const input={reference:'IACPOS receipt',date:'2026-10-16',vat:'21',settlementId:'6'};
 return{db,fail,calls,store,ns,zoho,storage,input,document,
  commission:()=>ns.alhambraCard.save(zoho,storage,'1',input),
  payment:()=>ns.saveCardPayment(deps,'1',{Name:'Card Alhambra',Payment_Date:'2026-10-16',Payment_Account:'5'}),
  context:()=>ns.alhambraCard.context(zoho,db.Card_Purchases[0])};
}
test('equal 44.54 invoice and charge keep the breakdown visible without creating a commission',async()=>{
 const f=fixture(),purchase=f.db.Card_Purchases[0];
 purchase.Amount=44.54;f.db.Supplier_Invoices[0].Total_Payable_Amount=44.54;
 await f.ns.alhambraCard.render(purchase,'payment');
 const host=f.document.getElementById('card-alhambra-commission');
 assert.equal(host.hidden,false);assert.match(host.innerHTML,/44\.54/);
 assert.match(host.innerHTML,/Iacpos difference/);assert.match(host.innerHTML,/0\.00/);
 assert.match(host.innerHTML,/correct the Alhambra invoice/);
 assert.equal(await f.context(),null);assert.equal(await f.ns.alhambraCard.beforePayment(purchase),undefined);
 assert.equal(f.db.Supplier_Invoices.length,1);assert.equal(f.db.Supplier_Payments.length,0);
 purchase.Amount=40;
 await f.ns.alhambraCard.render(purchase,'payment');
 assert.equal(host.hidden,false);assert.match(host.innerHTML,/exceeds the card charge/);
 purchase.Amount=81.66;
 await f.ns.alhambraCard.render(purchase,'payment');
 assert.match(host.innerHTML,/Iacpos invoice details/);assert.match(host.innerHTML,/37\.12/);
});

test('81.66 charge creates separate 4.66 Iacpos invoice and a payment allocating 77 + 4.66',async()=>{
 const f=fixture(),commissionId=await f.commission();await f.payment();
 const invoice=f.db.Supplier_Invoices.find(r=>r.id===commissionId);
 assert.equal(invoice.Supplier.id,'616617000003265040');assert.equal(invoice.Supplier_Settlement.id,'6');
 assert.equal(invoice.Invoice_Type,'Final Invoice');
 assert.equal(invoice.Invoice_Amount_Excl_VAT,3.85);assert.equal(invoice.VAT_Amount,.81);
 assert.equal(invoice.Total_Payable_Amount,4.66);assert.equal(invoice.Registration_Status,'Complete');
 assert.equal(f.db.Inv_Set_Allocations[0].Allocated_Amount,4.66);
 assert.equal(f.db.Supplier_Invoices[0].Total_Payable_Amount,77);
 assert.deepEqual(f.db.Supplier_Pay_Allocations.map(r=>r.Allocated_Amount),[77,4.66]);
 assert.equal(f.db.Card_Purchases[0].Vendor_Invoice.id,'4');assert.equal(f.db.Card_Purchases[0].Accounting_Status,'Purchase recorded');
 assert.equal(f.db.Supplier_Payments.length,1);assert.deepEqual([...f.store.keys()],['accounting-manager:alhambra-commission-id:1']);
 assert.ok(f.calls.includes('refresh:4')&&f.calls.includes('refresh:'+commissionId));
});
for(const step of ['Supplier_Invoices','Inv_Set_Allocations','refresh'])test('commission retry after '+step+' creates no duplicates',async()=>{
 const f=fixture();if(step==='refresh')f.fail.refresh=true;else f.fail.insert=step;
 await assert.rejects(f.commission());await f.commission();await f.payment();
 assert.equal(f.db.Supplier_Invoices.length,2);assert.equal(f.db.Inv_Set_Allocations.length,1);assert.equal(f.db.Supplier_Payments.length,1);
});
for(const step of ['payment','link'])test('split payment resumes '+step+' failure without duplication',async()=>{
 const f=fixture();await f.commission();f.fail[step]=true;await assert.rejects(f.payment());await f.payment();
 assert.equal(f.db.Supplier_Payments.length,1);assert.equal(f.db.Supplier_Pay_Allocations.length,2);assert.deepEqual([...f.store.keys()],['accounting-manager:alhambra-commission-id:1']);
});
test('old rejected 81.66 single-invoice request retains its key and becomes the reviewed split',async()=>{
 const f=fixture();await f.commission();
 f.store.set('accounting-manager:card-payment:v1:1',JSON.stringify({version:2,invoiceId:'4',amount:8166,currency:'EUR',movement:'Outbound Payment',supplierId:'616617000003010705',bookingId:'3',request:{operation_key:'old-key',allocations:{4:81.66},Name:'Saved',Payment_Date:'2026-10-16',Payment_Account:'5',Currency:'EUR',Movement_Type:'Outbound Payment',Status:'Paid'}}));
 await f.payment();assert.equal(f.db.Supplier_Payments[0].Invoice_Edit_Key,'old-key');assert.deepEqual(f.db.Supplier_Pay_Allocations.map(r=>r.Allocated_Amount),[77,4.66]);
});
test('no payment until commission is complete; invalid VAT or settlement prevents creation',async()=>{
 const f=fixture();await assert.rejects(f.payment(),/Iacpos/);assert.equal(f.db.Supplier_Payments.length,0);
 f.input.vat='invalid';await assert.rejects(f.commission(),/VAT/);assert.equal(f.db.Supplier_Invoices.length,1);
 f.input.vat='21';f.db.Supplier_Settlements[0].Supplier.id='other';
 await assert.rejects(f.commission(),/settlement/);assert.equal(f.db.Supplier_Invoices.length,1);
});
test('optional VAT defaults to zero without increasing the commission or card total',async()=>{
 for(const vat of ['',undefined,'0']){
  const f=fixture();f.input.vat=vat;const invoiceId=await f.commission();await f.payment();
  const invoice=f.db.Supplier_Invoices.find(r=>r.id===invoiceId);
  assert.equal(invoice.VAT_percentage,0);assert.equal(invoice.VAT_Amount,0);
  assert.equal(invoice.Invoice_Amount_Excl_VAT,4.66);assert.equal(invoice.Total_Payable_Amount,4.66);
  assert.equal(f.db.Supplier_Payments[0].Payment_Amount,81.66);
 }
});
test('changed commission amount, supplier or booking blocks payment',async()=>{
 for(const change of [{Total_Payable_Amount:5},{Supplier:{id:'wrong'}},{Booking:{id:'wrong'}}]){
  const f=fixture();await f.commission();Object.assign(f.db.Supplier_Invoices[1],change);
  await assert.rejects(f.payment(),/Iacpos invoice/);assert.equal(f.db.Supplier_Payments.length,0);
 }
});
test('split already saved with a different allocation cannot be silently relinked',async()=>{
 const f=fixture();await f.commission();f.fail.link=true;await assert.rejects(f.payment());
 f.db.Supplier_Pay_Allocations[1].Allocated_Amount=4;
 await assert.rejects(f.payment(),/split does not match/);assert.equal(f.db.Card_Purchases[0].Vendor_Payment,undefined);
});
test('non-Alhambra and refunds do not enable commission flow',async()=>{
 const f=fixture();f.db.Card_Purchases[0].Supplier.id='other';assert.equal(await f.context(),null);
 f.db.Card_Purchases[0].Supplier.id='616617000003010705';f.db.Card_Purchases[0].Transaction_Type='Refund';assert.equal(await f.context(),null);
});
test('new commission remains usable when CRM search has not indexed it, including payment retry',async()=>{
 const f=fixture();f.fail.searchLag=true;
 const commissionId=await f.commission();
 assert.equal(f.store.get('accounting-manager:alhambra-commission-id:1'),commissionId);
 f.fail.payment=true;await assert.rejects(f.payment(),/Lost payment response/);
 await f.payment();
 assert.equal(f.db.Supplier_Invoices.length,2);assert.equal(f.db.Supplier_Payments.length,1);
 assert.deepEqual(f.db.Supplier_Pay_Allocations.map(r=>r.Allocated_Amount),[77,4.66]);
});
test('confirmed commission removed from CRM is not silently replaced',async()=>{
 const f=fixture();await f.commission();f.db.Supplier_Invoices.pop();
 await assert.rejects(f.payment(),/Could not read Supplier_Invoices/);
 await assert.rejects(f.commission(),/Could not read Supplier_Invoices/);
 assert.equal(f.db.Supplier_Invoices.length,1);assert.equal(f.db.Supplier_Payments.length,0);
});
