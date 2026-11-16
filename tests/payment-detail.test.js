const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const file of ['config.js','helpers.js','payments.js']) vm.runInNewContext(fs.readFileSync('app/scripts/'+file,'utf8'),{window});
const ns=window.AccountingManagerApp;
function setup(read) {
  const state=ns.createInitialState();
  state.views.payments.recordIds=['1','2','3'];
  state.records.payments=[
    {id:'1',Name:'PAY-1',Created_By:{id:'creator1',name:null},Payment_Account:{id:'a1',name:'Bank one'},Movement_Type:'Outbound Payment'},
    {id:'2',Name:'PAY-2',Created_By:{id:'creator2',name:null},Payment_Account:{id:'a2'},Movement_Type:'Outbound Payment'},
    {id:'3',Name:'PAY-3',Created_By:null,Payment_Account:null,Movement_Type:'Outbound Payment'}
  ];
  const calls=[];
  const module=ns.createPaymentsModule({state,helpers:ns.helpers,MODULES:ns.MODULES,FIELD_CANDIDATES:ns.FIELD_CANDIDATES,
    crm:{getRecord:async(m,id)=>{calls.push([m,id]);return read(m,id);}},
    renderAll(){},debugError(){},closeSelectedPaymentLetterPanel(){},cloneFilterState:v=>JSON.parse(JSON.stringify(v)),
    hasAnyLoadFilterValue:()=>false,buildCombinedStatusOptions:values=>values.map(value=>({value})),
    PAYMENT_STATUS_FILTER_OPTIONS:['Pending Payment','Paid'],fetchPaymentPage:async()=>({records:[],hasMore:false,nextOffset:50})});
  return {state,module,calls};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('no automatic selection on initial load, invalid selection, search or refresh',async()=>{
  const {state,module,calls}=setup();
  assert.equal(module.buildView().selectedRecord,null);
  state.views.payments.selectedId='absent';
  assert.equal(module.buildView().selectedRecord,null);
  assert.equal(state.views.payments.selectedId,'');
  await module.refreshTabData();assert.equal(module.buildView().selectedRecord,null);
  assert.equal(calls.length,0);
});
test('reads actual Created_By, preserves Owner separately, resolves account ID through Payment_Accounts',async()=>{
  const {state,module,calls}=setup(async(m,id)=>m==='Payment_Accounts'?{id,Name:'Card two'}:
    {id,Created_By:{id:'creator2',name:'Actual creator'},Owner:{name:'Different owner'},Modified_By:{name:'Different editor'},Payment_Account:{id:'a2'},Movement_Type:'Outbound Payment'});
  await module.selectPayment('2');
  const payment=module.buildView().selectedRecord;
  assert.equal(payment.Created_By.name,'Actual creator');
  assert.equal(ns.paymentAccountLabel(payment),'Card two');
  assert.equal(ns.paymentDescription(payment),'Outbound Payment | Card two');
  assert.deepEqual(calls,[['Supplier_Payments','2'],['Payment_Accounts','a2']]);
  assert.equal(state.views.payments.detailLoad.loading,false);
});
test('explicit null account and creator differ from failed or omitted data',async()=>{
  const {state,module}=setup(async(m,id)=>({id,Created_By:null,Payment_Account:null,Movement_Type:'Outbound Payment'}));
  await module.selectPayment('3');
  assert.equal(ns.paymentDescription(module.buildView().selectedRecord),'Outbound Payment | No payment account');
  assert.equal(state.views.payments.detailLoad.error,'');
  assert.equal(state.views.payments.detailLoad.creatorError,'');
  const missing=setup(async(m,id)=>({id}));await missing.module.selectPayment('1');
  assert.ok(missing.state.views.payments.detailLoad.creatorError);
  assert.ok(missing.state.views.payments.detailLoad.accountError);
  const denied=setup(async()=>{throw Error('permission denied');});await denied.module.selectPayment('1');
  assert.match(denied.state.views.payments.detailLoad.error,/Could not load/);
});
test('missing lookup label uses joined account Name and never renders an ID or a separator dash',()=>{
  assert.equal(ns.paymentAccountLabel({Payment_Account:{id:'12'},'Payment_Account.Name':'Joined bank'}),'Joined bank');
  assert.equal(ns.paymentDescription({Payment_Account:null,Movement_Type:null}),'No payment account');
  assert.equal(ns.paymentAccountLabel({Payment_Account:'123456'}),'Payment account name unavailable');
});
for(const outcome of ['resolve','reject','close'])test('late detail '+outcome+' cannot overwrite a newer selection',async()=>{
  const slow=deferred();
  const {state,module}=setup(async(m,id)=>id==='1'?slow.promise:{id,Created_By:{name:'Second creator'},Payment_Account:{id:'a2',name:'Second bank'}});
  const first=module.selectPayment('1');await Promise.resolve();
  if(outcome==='close')module.closeDetail();else await module.selectPayment('2');
  if(outcome==='reject')slow.reject(Error('old error'));else slow.resolve({id:'1',Created_By:{name:'Old creator'},Payment_Account:{name:'Old bank'}});
  await first;
  assert.equal(state.views.payments.selectedId,outcome==='close'?'':'2');
  assert.equal(state.records.payments[0].Created_By.name,null);
  if(outcome!=='close')assert.equal(module.buildView().selectedRecord.Created_By.name,'Second creator');
});
test('close preserves filters, record IDs, pagination and cached data',async()=>{
  const {state,module}=setup(async(m,id)=>({id,Created_By:{name:'Creator'},Payment_Account:null}));
  state.views.payments.filters.paymentName='pending draft';state.views.payments.page=4;state.views.payments.hasMore=true;
  await module.selectPayment('1');module.closeDetail();
  assert.equal(state.views.payments.selectedId,'');assert.equal(state.views.payments.filters.paymentName,'pending draft');
  assert.equal(state.views.payments.page,4);assert.equal(state.views.payments.hasMore,true);
  assert.equal(state.views.payments.recordIds.join(','),'1,2,3');assert.equal(state.records.payments.length,3);
});

test('late related-account response cannot enrich a payment after switching selection',async()=>{
  const account=deferred();
  const {state,module,calls}=setup(async(m,id)=>m==='Payment_Accounts'?account.promise:
    {id,Created_By:{name:'Creator '+id},Payment_Account:id==='1'?{id:'a1'}:{id:'a2',name:'Bank two'}});
  const first=module.selectPayment('1');
  while(!calls.some(c=>c[0]==='Payment_Accounts'))await Promise.resolve();
  await module.selectPayment('2');account.resolve({id:'a1',Name:'Late bank'});await first;
  assert.equal(module.buildView().selectedRecord.Payment_Account.name,'Bank two');
  assert.equal(state.records.payments[0].Created_By.name,null);
});

test('related-account failures remain visible and can be retried without changing selection',async()=>{
  let failed=true;
  const {state,module}=setup(async(m,id)=>{
    if(m==='Payment_Accounts') { if(failed)throw Error('denied');return {id,Name:'Recovered bank'}; }
    return {id,Created_By:{name:'Creator'},Payment_Account:{id:'a2'}};
  });
  await module.selectPayment('2');assert.ok(state.views.payments.detailLoad.accountError);
  assert.equal(state.views.payments.selectedId,'2');failed=false;await module.retryDetail();
  assert.equal(state.views.payments.detailLoad.accountError,'');
  assert.equal(module.buildView().selectedRecord.Payment_Account.name,'Recovered bank');
});
