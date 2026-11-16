const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const db={Card_Purchases:[{id:'1',Supplier:{id:'2'},Booking:{id:'3'},Boking_Service:{id:'4'},Amount:100,Currency:'EUR',Transaction_Type:'Purchase',Accounting_Status:'Pending invoice'}],Supplier_Settlements:[{id:'5',Supplier:{id:'2'},Booking:{id:'3'},Currency:'EUR'}],Supplier_Invoices:[],Inv_Set_Allocations:[],Supplier_Invoice_Lines:[]};
 const records=new Map(),storage={getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)},failures={},calls=[];
 const clone=o=>JSON.parse(JSON.stringify(o));
 const api={getRecord:async({Entity,RecordID})=>({data:db[Entity].filter(r=>r.id===RecordID).map(clone)}),searchRecord:async({Entity,Query})=>{const [,field,value]=Query.match(/\((\w+):equals:(.*)\)/);return{data:failures.stale?[]:db[Entity].filter(r=>String(r[field]?.id||r[field])===value).map(clone)};},
  insertRecord:async({Entity,APIData,Trigger})=>{assert.equal(Trigger.length,0);const old=db[Entity].find(r=>r.Registration_Key===APIData[0].Registration_Key);if(old)return{data:[{code:'DUPLICATE_DATA',details:{id:old.id}}]};const row={...clone(APIData[0]),id:String(100+calls.length)};db[Entity].push(row);calls.push(Entity);if(failures[Entity]){delete failures[Entity];throw Error('Lost '+Entity+' response');}return{data:[{code:'SUCCESS',details:{id:row.id}}]};},
  updateRecord:async({Entity,APIData})=>{Object.assign(db[Entity].find(r=>r.id===APIData.id),clone(APIData));if(Entity==='Card_Purchases'&&failures.link){delete failures.link;throw Error('Lost link response');}return{data:[{code:'SUCCESS'}]};}
 };
 const zoho={CRM:{API:api,META:{getFields:async()=>({fields:failures.schema?[]:[{api_name:'Registration_Key',unique:{casesensitive:false}}]})}}};
 const window={};for(const file of ['quick-invoice-records.js','card-purchase-settlements.js','card-invoice-save.js'])vm.runInNewContext(fs.readFileSync('app/scripts/'+file,'utf8'),{window});
 window.AccountingManagerApp.refreshQuickInvoiceSettlements=async()=>failures.rebuild?'Rebuild failed':'';
 const input={reference:'INV1',date:'2026-10-16',amount:100,vat:21,settlementId:'5',invoiceType:'Final Invoice'};
 return{db,failures,calls,records,storage,input,api,run:()=>window.AccountingManagerApp.saveCardInvoice(zoho,storage,'1',input)};
}
test('Tickets and Final Invoice cannot be saved without an invoice date',async()=>{
 for(const type of ['Tickets','Final Invoice']){
  const f=fixture();f.input.invoiceType=type;f.input.date='';
  await assert.rejects(f.run(),/date/);
  assert.equal(f.calls.length,0);
  assert.equal(f.db.Supplier_Invoices.length,0);
 }
});

test('card invoices recover lost insert, allocation, line and link responses without duplication',async()=>{
 for(const failure of ['Supplier_Invoices','Inv_Set_Allocations','Supplier_Invoice_Lines','link','rebuild']){
  const f=fixture();f.failures[failure]=true;await assert.rejects(f.run());
  f.failures.rebuild=false;f.failures.stale=true;f.input.amount=999;
  const r=await f.run();assert.equal(f.db.Supplier_Invoices.length,1);assert.equal(f.db.Inv_Set_Allocations.length,1);assert.equal(f.db.Supplier_Invoice_Lines.length,1);
  assert.equal(f.db.Supplier_Invoices[0].Total_Payable_Amount,100);assert.equal(f.db.Supplier_Invoices[0].Registration_Status,'Complete');assert.equal(f.db.Card_Purchases[0].Vendor_Invoice.id,r.invoiceId);assert.equal(f.records.size,0);
 }
});
test('card invoices reject invalid precision, closed settlement, mismatched currency and missing unique key',async()=>{
 for(const change of [f=>f.input.amount=1.001,f=>f.input.vat=101,f=>f.db.Supplier_Settlements[0].Locked__s=true,f=>f.db.Supplier_Settlements[0].Currency='USD',f=>f.failures.schema=true]){
  const f=fixture();change(f);await assert.rejects(f.run());assert.equal(f.calls.length,0);
 }
});
test('refund retains positive credit note amount and omits service expense lines',async()=>{
 const f=fixture();f.db.Card_Purchases[0].Transaction_Type='Refund';await f.run();assert.equal(f.db.Supplier_Invoices[0].Invoice_Type,'Credit Note');assert.equal(f.db.Supplier_Invoices[0].Total_Payable_Amount,100);assert.equal(f.db.Supplier_Invoice_Lines.length,0);
});
test('changed recovered accounting data is never overwritten',async()=>{
 const f=fixture();f.failures.link=true;await assert.rejects(f.run());f.db.Supplier_Invoices[0].Total_Payable_Amount=80;await assert.rejects(f.run(),/changed/);assert.equal(f.db.Supplier_Invoices.length,1);
});
test('external active allocations prevent completing a card invoice and preserve recovery',async()=>{
 const f=fixture();f.failures.rebuild=true;await assert.rejects(f.run());
 f.db.Inv_Set_Allocations.push({...f.db.Inv_Set_Allocations[0],id:'extra',Registration_Key:'external'});
 f.failures.rebuild=false;
 await assert.rejects(f.run(),/complete allocation must match/);
 assert.notEqual(f.db.Supplier_Invoices[0].Registration_Status,'Complete');assert.equal(f.records.size,1);
 f.db.Inv_Set_Allocations[1].Status='Cancelled';
 await f.run();assert.equal(f.db.Supplier_Invoices[0].Registration_Status,'Complete');
 assert.equal(f.db.Supplier_Invoices.length,1);
});
test('invoice based on service cost may exceed the card charge when its settlement allocation matches',async()=>{
 const f=fixture();f.input.amount=750;
 await f.run();
 assert.equal(f.db.Card_Purchases[0].Amount,100);
 assert.equal(f.db.Supplier_Invoices[0].Total_Payable_Amount,750);
 assert.equal(f.db.Inv_Set_Allocations[0].Allocated_Amount,750);
 assert.equal(f.db.Supplier_Invoice_Lines[0].Amount,750);
 assert.equal(f.db.Supplier_Invoices[0].Registration_Status,'Complete');
});
test('allocation validation reads all COQL pages even when Search is stale',async()=>{
 const f=fixture();f.failures.rebuild=true;await assert.rejects(f.run());
 f.failures.rebuild=false;f.failures.stale=true;
 const original=f.db.Inv_Set_Allocations[0];let pages=0;
 f.api.coql=async({select_query})=>{
  pages++;
  if(select_query.includes('limit 0, 200'))return{data:[structuredClone(original)],info:{more_records:true}};
  assert.match(select_query,/limit 200, 200/);
  return{data:[{...structuredClone(original),id:'external',Registration_Key:'external'}],info:{more_records:false}};
 };
 await assert.rejects(f.run(),/complete allocation must match/);
 assert.equal(pages,2);assert.equal(f.records.size,1);
});
