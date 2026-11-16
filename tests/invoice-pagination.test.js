const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const file of ['config.js', 'helpers.js', 'invoices.js', 'remote-data.js']) {
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
    fetchInvoicePage: async search => { calls.push(clone(search)); return fetch(search); }
  };
  return { state, calls, deps, invoices: ns.createInvoicesModule(deps) };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise, resolve, reject}; };
for (const tab of ['open','closed','all']) {
  test(tab + ': pending filters never change subsequent batches; search finds records beyond first batch', async () => {
    const records = Array.from({length:125}, (_,i)=>({id:String(i+1),Name:'INV-'+(i+1)}));
    const {state,calls,invoices} = setup(async search => {
      const matching = records.filter(r=>!search.filters.invoiceNumber || r.Name === search.filters.invoiceNumber);
      const start = (search.page-1)*search.perPage;
      return {records:matching.slice(start,start+search.perPage),hasMore:start+search.perPage<matching.length};
    });
    state.views.invoices.view = tab;
    await invoices.refreshTabData();
    assert.equal(state.records.invoices.length,50);
    state.views.invoices.filters.invoiceNumber='INV-120';
    await invoices.loadMore();
    assert.equal(state.records.invoices.length,100);
    assert.equal(calls[1].filters.invoiceNumber,'');
    assert.equal(calls[1].filters.invoiceView,tab);
    await invoices.loadTabData();
    assert.deepEqual(Array.from(state.records.invoices,r=>r.id),['120']);
    assert.equal(calls[2].page,1);
    assert.equal(calls[2].filters.invoiceNumber,'INV-120');
    const n=calls.length; await invoices.loadMore(); assert.equal(calls.length,n);
    state.views.invoices.filters.invoiceNumber='INV-1';
    state.views.invoices.view=tab==='all'?'open':'all';
    await invoices.refreshTabData();
    assert.equal(calls[3].filters.invoiceNumber,'INV-120');
  });
}
test('deduplicates records and concurrent requests; preserves batch on error and retries same page', async () => {
  const wait=deferred(); let fail=true;
  const {state,calls,invoices}=setup(async s=>{
    if(s.page===1)return wait.promise;
    if(fail)throw Error('offline');
    return {records:[{id:'1'},{id:'2'}],hasMore:false};
  });
  const first=invoices.refreshTabData(); const duplicate=invoices.loadMore();
  assert.equal(first,duplicate); await Promise.resolve(); assert.equal(calls.length,1);
  wait.resolve({records:[{id:'1'}],hasMore:true}); await first;
  await invoices.loadMore(); assert.equal(state.records.invoices.length,1); assert.ok(state.views.invoices.loadError);
  fail=false; await invoices.loadMore();
  assert.deepEqual(calls.map(c=>c.page),[1,2,2]);
  assert.deepEqual(Array.from(state.records.invoices,r=>r.id),['1','2']);
});
for(const reject of [false,true])test('ignores stale '+(reject?'errors':'results')+' after a new search',async()=>{
  const old=deferred(); let n=0;
  const {state,invoices}=setup(()=>++n===1?old.promise:Promise.resolve({records:[{id:'new'}],hasMore:false}));
  const first=invoices.refreshTabData(); await Promise.resolve();
  state.views.invoices.view='all'; await invoices.refreshTabData();
  if(reject)old.reject(Error('old failure'));else old.resolve({records:[{id:'old'}],hasMore:true});
  await first; assert.deepEqual(Array.from(state.records.invoices,r=>r.id),['new']);
  assert.equal(state.views.invoices.hasMore,false); assert.equal(state.views.invoices.loadError,'');
});
test('COQL batches combine scope, every filter, stable order and real offset without fallback',async()=>{
  const {deps}=setup(); const queries=[];
  deps.crm={coql:async(q,o)=>{queries.push(q);assert.equal(o.strict,true);return Array.from({length:51},(_,i)=>({id:String(i)}));}};
  const remote=ns.createRemoteDataModule(deps);
  for(const tab of ['open','closed','all']){
    const result=await remote.loadInvoicePage(['id','Name'],{page:2,perPage:50,sort:{key:'date',direction:'desc'},filters:{invoiceView:tab,invoiceNumber:'INV-120',supplierCode:'ABC',mfsp:'MFSP',invoiceType:'Final Invoice',dateFrom:'2026-01-01',dateTo:'2026-12-31',destinationValues:['Spain'],selfEmployed:'true'}});
    const q=queries.at(-1);assert.match(q,/limit 50, 51$/);assert.match(q,/order by Invoice_Date desc, id asc/);
    for(const field of ['Name','Supplier_Code','MFSP_Reference','Invoice_Type','Invoice_Date','Supplier.Destination','Supplier.Is_Self_Employed'])assert.ok(q.includes(field),field);
    if(tab==='all')assert.ok(!q.includes('Status')); else assert.match(q,tab==='open'?/Status not in/:/Status in/);
    assert.equal(result.records.length,50);assert.equal(result.hasMore,true);
  }
  assert.equal(await remote.buildInvoiceRemoteOrderByClause({key:'total',direction:'asc'}),'Total_Payable_Amount asc, id asc');
  assert.equal(await remote.buildInvoiceRemoteOrderByClause({key:'invoiceType',direction:'asc'}),'Invoice_Type asc, id asc');
  assert.equal(await remote.buildInvoiceRemoteOrderByClause({key:'date',direction:'desc'},'supplier'),'Supplier_Name asc, Supplier asc, Invoice_Date desc, id asc');
  deps.crm.coql=async()=>{throw Error('permission denied');};
  await assert.rejects(remote.loadInvoicePage(['id'],{filters:{invoiceView:'all'},page:1}),/permission denied/);
});


test('initial failure is retryable, custom batch size persists and exact final batch stops', async () => {
  let fail = true;
  const {state,invoices,calls} = setup(async search => {
    if (fail) throw Error('offline');
    return {records:Array.from({length:search.perPage},(_,i)=>({id:String(i)})),hasMore:false};
  });
  state.views.invoices.perPage=17;
  await invoices.refreshTabData();
  assert.equal(state.records.invoices.length,0);
  assert.equal(state.views.invoices.loadingInitial,false);
  assert.ok(state.views.invoices.loadError);
  fail=false; await invoices.loadMore();
  assert.equal(state.records.invoices.length,17);
  assert.equal(calls[1].page,1);
  assert.equal(calls[1].perPage,17);
  await invoices.loadMore(); assert.equal(calls.length,2);
});
