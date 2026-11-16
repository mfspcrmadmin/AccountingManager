const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const file of ['config.js', 'helpers.js', 'payments.js', 'remote-data.js']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + file, 'utf8'), { window });
}
const ns = window.AccountingManagerApp;
const clone = value => JSON.parse(JSON.stringify(value));
function setup(fetch) {
  const state = ns.createInitialState(), calls = [];
  const deps = { state, helpers: ns.helpers, MODULES: ns.MODULES,
    INVOICE_STATUS_FILTER_OPTIONS: ['-None-', 'Received', 'Partially Paid', 'Paid', 'Cancelled', 'Rejected'],
    cloneFilterState: clone, renderAll() {}, debugError() {},
    resolveCoqlFields: async (module, fields) => fields,
    resolveFieldApiByCandidates: async (module, candidates, fallback) => fallback,
    escapeCoqlValue: value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
    getNormalizedStatusFilterValues: values => values || [],
    hasAllStatusFilterValuesSelected: (values, options) => options.every(value => values.includes(value)),
    fetchPaymentPage: async search => { calls.push(clone(search)); return fetch(search); }
  };
  return { state, calls, deps, payments: ns.createPaymentsModule(deps) };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise, resolve, reject}; };
for (const tab of ['open','closed','all']) {
  test(tab + ': pending filters never change subsequent batches; search finds records beyond first batch', async () => {
    const records = Array.from({length:125}, (_,i)=>({id:String(i+1),Name:'PAY-'+(i+1)}));
    const {state,calls,payments} = setup(async search => {
      const matching = records.filter(r=>!search.filters.paymentName || r.Name === search.filters.paymentName);
      const start = (search.page-1)*search.perPage;
      return {records:matching.slice(start,start+search.perPage),hasMore:start+search.perPage<matching.length,nextOffset:start+search.perPage};
    });
    state.views.payments.view = tab;
    await payments.refreshTabData();
    assert.equal(state.views.payments.recordIds.length,50);
    state.views.payments.filters.paymentName='PAY-120';
    await payments.loadMore();
    assert.equal(state.views.payments.recordIds.length,100);
    assert.equal(calls[1].filters.paymentName,'');
    assert.equal(calls[1].filters.paymentView,tab);
    await payments.loadTabData();
    assert.deepEqual(Array.from(state.views.payments.recordIds),['120']);
    assert.equal(calls[2].page,1);
    assert.equal(calls[2].filters.paymentName,'PAY-120');
    const n=calls.length; await payments.loadMore(); assert.equal(calls.length,n);
    state.views.payments.filters.paymentName='PAY-1';
    state.views.payments.view=tab==='all'?'open':'all';
    await payments.refreshTabData();
    assert.equal(calls[3].filters.paymentName,'PAY-120');
  });
}
test('deduplicates records and concurrent requests; preserves batch on error and retries same page', async () => {
  const wait=deferred(); let fail=true;
  const {state,calls,payments}=setup(async s=>{
    if(s.page===1)return wait.promise;
    if(fail)throw Error('offline');
    return {records:[{id:'1'},{id:'2'}],hasMore:false};
  });
  const first=payments.refreshTabData(); const duplicate=payments.loadMore();
  assert.equal(first,duplicate); await Promise.resolve(); assert.equal(calls.length,1);
  wait.resolve({records:[{id:'1'}],hasMore:true}); await first;
  await payments.loadMore(); assert.equal(state.views.payments.recordIds.length,1); assert.ok(state.views.payments.loadError);
  fail=false; await payments.loadMore();
  assert.deepEqual(calls.map(c=>c.page),[1,2,2]);
  assert.deepEqual(Array.from(state.views.payments.recordIds),['1','2']);
});
for(const reject of [false,true])test('ignores stale '+(reject?'errors':'results')+' after a new search',async()=>{
  const old=deferred(); let n=0;
  const {state,payments}=setup(()=>++n===1?old.promise:Promise.resolve({records:[{id:'new'}],hasMore:false}));
  const first=payments.refreshTabData(); await Promise.resolve();
  state.views.payments.view='all'; await payments.refreshTabData();
  if(reject)old.reject(Error('old failure'));else old.resolve({records:[{id:'old'}],hasMore:true});
  await first; assert.deepEqual(Array.from(state.views.payments.recordIds),['new']);
  assert.equal(state.views.payments.hasMore,false); assert.equal(state.views.payments.loadError,'');
});

test('remote payment search keeps mixed allocations, crosses 100 matches, and scopes hydration to the returned batch', async () => {
  const {deps} = setup();
  deps.PAYMENT_STATUS_FILTER_OPTIONS = ['Planned','Approved','Pending Payment','Paid','Cancelled','Reconciled'];
  const all = Array.from({length:240},(_,i)=>({id:String(1000+i),Name:'PAY-'+i,Payment_Date:'2026-10-01',Status:i%2?'Paid':'Pending Payment'}));
  const allocations = all.flatMap(p=>[
    {id:p.id+'1',Supplier_Payment:{id:p.id},'Booking.MFSP_Reference':'M1','Supplier.TP_Reference':'FIRST'},
    {id:p.id+'2',Supplier_Payment:{id:p.id},'Booking.MFSP_Reference':'M2','Supplier.TP_Reference':'SECOND'}
  ]);
  const queries=[];
  deps.crm = {async coql(q, options) {
    queries.push(q); assert.equal(options.strict,true);
    const limit = q.match(/limit (\d+), (\d+)$/);
    if(q.includes(' from Supplier_Pay_Allocations') && !q.includes(' from Supplier_Payments')){
      const ids=Array.from(q.matchAll(/'(\d+)'/g),m=>m[1]);
      let rows=allocations.filter(a=>ids.includes(a.Supplier_Payment.id));
      for(const [field,value] of [['Booking.MFSP_Reference','M1'],['Supplier.TP_Reference','SECOND']]){
        if(q.includes(field+" like '%"+value+"%'"))rows=rows.filter(a=>a[field]===value);
      }
      if(q.includes('group by'))rows=[...new Map(rows.map(a=>[a.Supplier_Payment.id,a])).values()];
      return rows.slice(0,+limit[2]);
    }
    let records=all.slice();
    if(q.includes("Status = 'Pending Payment'")) records=records.filter(p=>p.Status==='Pending Payment');
    else if(q.includes("Status in ('Paid', 'Cancelled')"))records=records.filter(p=>p.Status==='Paid');
    const ids=q.match(/id in \(([^)]+)\)/);
    if(ids)records=records.filter(p=>ids[1].includes("'"+p.id+"'"));
    // Model independent server-side existential filters, not a local table filter.
    for(const [field,value] of [['Booking.MFSP_Reference','M1'],['Supplier.TP_Reference','SECOND']]){
      if(q.includes(field+" like '%"+value+"%'"))records=records.filter(p=>allocations.some(a=>a.Supplier_Payment.id===p.id && a[field]===value));
    }
    return records.slice(+limit[1],+limit[1]+ +limit[2]);
  }};
  const remote=ns.createRemoteDataModule(deps);
  for(const tab of ['open','closed','all']) {
    let offset=0, ids=[], more=true;
    while(more){
      const result=await remote.loadPaymentPage(['id','Name','Payment_Date'],['id','Supplier_Payment'],{offset,perPage:50,filters:{paymentView:tab,mfsp:'M1',supplierCode:'SECOND'}});
      assert.ok(result.records.length<=50);
      assert.equal(result.allocations.length,result.records.length*2);
      ids.push(...result.records.map(p=>p.id));more=result.hasMore;offset=result.nextOffset;
    }
    assert.equal(ids.length,tab==='all'?240:120);
    assert.equal(new Set(ids).size,ids.length);
  }
  assert.ok(queries.some(q=>q.includes('limit 100, 51')));
  for(const q of queries.filter(q=>q.includes('group by'))) {
    assert.match(q,/^select Supplier_Payment from Supplier_Pay_Allocations/);
    assert.match(q,/group by Supplier_Payment limit 0, 100$/);
    assert.doesNotMatch(q,/in \(select/);
  }
});

test('MFSP resolves the related booking, with invoice fallback only when the allocation has no booking',async()=>{
  const {deps}=setup();deps.PAYMENT_STATUS_FILTER_OPTIONS=['Pending Payment','Paid'];
  const payments=[
    {id:'1',Name:'PREPAY-123'}, {id:'2',Name:'PAY-TARGET'},
    {id:'3',Name:'Legacy payment'}, {id:'4',Name:'Split payment'},
    {id:'5',Name:'Mixed payment'}
  ];
  const allocations=[
    {id:'11',Supplier_Payment:{id:'1'},Booking:{id:'a',MFSP_Reference:'TARGET'},MFSP_Reference:''},
    {id:'21',Supplier_Payment:{id:'2'},Booking:{id:'b',MFSP_Reference:'OTHER'},MFSP_Reference:'TARGET'},
    {id:'31',Supplier_Payment:{id:'3'},Booking:null,Supplier_Invoice:{Booking:{id:'a',MFSP_Reference:'TARGET'}}},
    {id:'41',Supplier_Payment:{id:'4'},Booking:{id:'b',MFSP_Reference:'OTHER'},Supplier_Invoice:{Booking:{id:'a',MFSP_Reference:'TARGET'}}},
    {id:'51',Supplier_Payment:{id:'5'},Booking:{id:'b',MFSP_Reference:'OTHER'}},
    {id:'52',Supplier_Payment:{id:'5'},Booking:{id:'a',MFSP_Reference:'TARGET'},MFSP_Reference:'OLD'}
  ];
  const queries=[];
  deps.crm={coql:async q=>{
    queries.push(q);
    if(q.startsWith('select id from Supplier_Payments'))return payments;
    if(q.startsWith('select id, Name from Supplier_Payments')){
      assert.doesNotMatch(q,/in \(select/);
      const ids=q.match(/id in \(([^)]+)\)/)[1];
      return payments.filter(p=>ids.includes("'"+p.id+"'"));
    }
    if(q.startsWith('select Supplier_Payment')){
      assert.match(q,/Booking\.MFSP_Reference like '%TARGET%'/);
      const fallback=q.includes('Supplier_Invoice.Booking.MFSP_Reference');
      // Model the actual embedded CRM limit that caused LIMIT_EXCEEDED.
      if(fallback&&/(?<![.])\bBooking\.MFSP_Reference/.test(q))throw Error('join limit exceeded');
      if(fallback)assert.match(q,/Booking is null and Supplier_Invoice\.Booking\.MFSP_Reference like '%TARGET%'/);
      return allocations.filter(row=>fallback?!row.Booking&&row.Supplier_Invoice?.Booking?.MFSP_Reference==='TARGET':row.Booking?.MFSP_Reference==='TARGET');
    }
    assert.match(q,/from Supplier_Pay_Allocations/);
    return allocations.filter(row=>['1','3','5'].includes(row.Supplier_Payment.id));
  }};
  const result=await ns.createRemoteDataModule(deps).loadPaymentPage(['id','Name'],['id','Supplier_Payment'],{
    perPage:50,filters:{paymentView:'all',mfsp:' TARGET '}
  });
  assert.deepEqual(Array.from(result.records,row=>row.id),['1','3','5']);
  assert.equal(result.allocations.length,4);
  assert.equal(result.hasMore,false);
  assert.equal(queries.length,5);
});

test('MFSP booking search escapes text and reports relationship-query failures without a name fallback',async()=>{
  const {deps}=setup();deps.PAYMENT_STATUS_FILTER_OPTIONS=[];
  const queries=[];deps.crm={coql:async q=>{
    queries.push(q);if(queries.length===1)return [{id:'1'}];
    assert.ok(q.includes("Booking.MFSP_Reference like '%O\\'Brien%'"));
    assert.ok(!q.includes("Supplier_Invoice.Booking.MFSP_Reference"));
    throw Error('relationship unavailable');
  }};
  await assert.rejects(ns.createRemoteDataModule(deps).loadPaymentPage(['id'],['id'],{
    filters:{paymentView:'all',mfsp:"O'Brien"}
  }),/relationship unavailable/);
  assert.equal(queries.length,2);
});

test('remote criteria include scope, dates, status and name; strict errors never fall back to bulk reads', async()=>{
  const {deps}=setup(); deps.PAYMENT_STATUS_FILTER_OPTIONS=['Pending Payment','Paid','Cancelled'];
  const queries=[];deps.crm={coql:async q=>{queries.push(q);return [];}};
  const remote=ns.createRemoteDataModule(deps);
  await remote.loadPaymentPage(['id'],['id'],{offset:50,perPage:17,filters:{paymentView:'closed',paymentName:"O'Brien",dateFrom:'2026-01-01',dateTo:'2026-12-31',statusValues:['Paid']}});
  assert.match(queries[0],/Status in \('Paid', 'Cancelled'\)/);
  assert.match(queries[0],/Status = 'Paid'/);
  assert.match(queries[0],/Payment_Date >= '2026-01-01'/);
  assert.match(queries[0],/Payment_Date <= '2026-12-31'/);
  assert.ok(queries[0].includes("Name like '%O\\'Brien%'"));
  assert.match(queries[0],/limit 50, 18$/);
  deps.crm.coql=async()=>{throw Error('denied');};
  await assert.rejects(remote.loadPaymentPage(['id'],['id'],{filters:{paymentView:'all'}}),/denied/);
});

test('empty relationship window advances without claiming no results or marking global datasets complete',async()=>{
  const {state,payments,calls}=setup(async s=>s.offset===0?{records:[],hasMore:true,nextOffset:50}:{records:[{id:'beyond-first'}],hasMore:false,nextOffset:100});
  state.records.payments=[{id:'other-context'}];
  await payments.refreshTabData();
  assert.equal(state.views.payments.hasMore,true);
  assert.equal(state.loaded.payments,false);
  await payments.loadMore();
  assert.equal(calls[1].offset,50);
  assert.deepEqual(Array.from(state.views.payments.recordIds),['beyond-first']);
  assert.ok(state.records.payments.some(p=>p.id==='other-context'));
});

test('a relationship page fills with matches across sparse candidate windows, including older closed payments',async()=>{
  const {deps}=setup();deps.PAYMENT_STATUS_FILTER_OPTIONS=['Paid','Cancelled'];
  const candidates=Array.from({length:160},(_,i)=>({id:String(1000+i),Name:'PAY-'+i}));
  const matched=new Set(['1002','1047','1081','1128','1159']);
  const queries=[];
  deps.crm={coql:async q=>{
    queries.push(q);
    const limit=q.match(/limit (\d+), (\d+)$/);
    if(q.startsWith('select id from Supplier_Payments')){
      assert.match(q,/Status in \('Paid', 'Cancelled'\)/);
      return candidates.slice(+limit[1],+limit[1]+ +limit[2]);
    }
    if(q.startsWith('select Supplier_Payment')){
      const scope=q.match(/Supplier_Payment (?:in \(([^)]+)\)|= ('[^']+'))/);
      const ids=scope[1]||scope[2];
      return candidates.filter(r=>matched.has(r.id)&&ids.includes("'"+r.id+"'")).map(r=>({Supplier_Payment:{id:r.id}}));
    }
    if(q.startsWith('select id, Name from Supplier_Payments')){
      const scope=q.match(/id (?:in \(([^)]+)\)|= ('[^']+'))/);
      const ids=scope[1]||scope[2];
      return candidates.filter(r=>matched.has(r.id)&&ids.includes("'"+r.id+"'"));
    }
    return [];
  }};
  const remote=ns.createRemoteDataModule(deps);
  const first=await remote.loadPaymentPage(['id','Name'],['id'],{perPage:3,filters:{paymentView:'closed',mfsp:'MFSP2608663'}});
  assert.deepEqual(Array.from(first.records,r=>r.id),['1002','1047','1081']);
  assert.equal(first.hasMore,true);
  const second=await remote.loadPaymentPage(['id','Name'],['id'],{offset:first.nextOffset,perPage:3,filters:{paymentView:'closed',mfsp:'MFSP2608663'}});
  assert.deepEqual(Array.from(second.records,r=>r.id),['1128','1159']);
  assert.equal(second.hasMore,false);
  assert.equal(second.nextOffset,160);
  const all=await remote.loadPaymentPage(['id','Name'],['id'],{perPage:50,filters:{paymentView:'closed',mfsp:'MFSP2608663'}});
  assert.deepEqual(Array.from(all.records,r=>r.id),Array.from(matched));
  assert.equal(all.hasMore,false);
});
