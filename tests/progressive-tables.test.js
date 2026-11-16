const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const file of ['config.js','helpers.js','progressive-table.js','accounting.js','remote-data.js']) vm.runInNewContext(fs.readFileSync('app/scripts/'+file,'utf8'),{window});
const ns=window.AccountingManagerApp;
const clone=x=>JSON.parse(JSON.stringify(x));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(fetch){let records=[];const view={};const calls=[];const pager=ns.createProgressiveQuery({view,getRecords:()=>records,setRecords:r=>records=r,render(){},fetch:q=>{calls.push(clone(q));return fetch(q);}});return {view,pager,calls,records:()=>records};}
test('immutable filters/order; append, deduplicate, retain records on error and retry same batch',async()=>{
 const waiting=deferred();let fail=true;
 const f=fixture(q=>q.page===1?waiting.promise:fail?Promise.reject(Error('offline')):Promise.resolve({records:[{id:'1'},{id:'2'}],hasMore:false}));
 const filters={name:'applied'},sort={direction:'desc'};
 const first=f.pager.reset({filters,sort});assert.equal(first,f.pager.more());filters.name='draft';sort.direction='asc';
 waiting.resolve({records:[{id:'1'}],hasMore:true});await first;await f.pager.more();assert.equal(f.records().length,1);assert.equal(f.view.loadError,'offline');
 fail=false;await f.pager.more();assert.deepEqual(Array.from(f.records(),r=>r.id),['1','2']);assert.deepEqual(f.calls.map(q=>q.page),[1,2,2]);assert.ok(f.calls.every(q=>q.filters.name==='applied'&&q.sort.direction==='desc'));
 await f.pager.more();assert.equal(f.calls.length,3);
});
for(const reject of [false,true])test('new query ignores stale '+(reject?'error':'success')+' and stale finally',async()=>{
 const waiting=deferred();const f=fixture(q=>q.filters.name==='old'?waiting.promise:Promise.resolve({records:[{id:'new'}],hasMore:false}));
 const old=f.pager.reset({filters:{name:'old'}});await Promise.resolve();await f.pager.reset({filters:{name:'new'}});
 if(reject)waiting.reject(Error('old'));else waiting.resolve({records:[{id:'old'}],hasMore:true});await old;
 assert.deepEqual(Array.from(f.records(),r=>r.id),['new']);assert.equal(f.view.hasMore,false);assert.equal(f.view.loadError,'');
});
for(const tab of ['entries','lines','accounts','rules'])test('Accounting '+tab+' searches across source, preserves draft and source order',async()=>{
 const state=ns.createInitialState(),keys={entries:'accountingEntries',lines:'accountingEntryLines',accounts:'accountingAccounts',rules:'accountingRules'},key=keys[tab],calls=[];
 state.currentTab='accounting';const data=Array.from({length:85},(_,i)=>({id:String(i+1),Name:'ROW-'+(i+1)}));
 const module=ns.createAccountingModule({state,elements:{},renderAll(){},cloneFilterState:clone,fetchPage:async(k,q)=>{calls.push(clone(q));const rows=data.filter(r=>!q.filters.entryName&&!q.filters.lineName||r.Name===(q.filters.entryName||q.filters.lineName));return {records:rows.slice((q.page-1)*q.perPage,q.page*q.perPage),hasMore:q.page*q.perPage<rows.length};}});
 await module.setTab(tab);assert.equal(state.views[key].browserRecords.length,10);
 const build={entries:'buildEntriesView',lines:'buildEntryLinesView',accounts:'buildAccountsView',rules:'buildRulesView'}[tab];
 if(tab==='entries'||tab==='lines')state.views[key].filters[tab==='entries'?'entryName':'lineName']='ROW-82';
 await module[build]().onLoadMore();assert.equal(state.views[key].browserRecords.length,20);assert.equal(calls[1].filters.entryName||calls[1].filters.lineName||'','');
 if(tab==='entries'||tab==='lines'){await module[tab==='entries'?'loadEntriesTabData':'loadEntryLinesTabData']();assert.deepEqual(Array.from(state.views[key].browserRecords,r=>r.id),['82']);}
 else assert.equal(module[build]().visibleRecords.length,20);
});
test('COQL applies all Accounting and Booking criteria before offset, never retries unfiltered',async()=>{
 const queries=[];const remote=ns.createRemoteDataModule({MODULES:ns.MODULES,helpers:ns.helpers,resolveCoqlFields:async(m,f)=>f,resolveFieldApiByCandidates:async(m,c,f)=>f,escapeCoqlValue:String,getNormalizedBookingStageValues:v=>v,crm:{coql:async(q,opts)=>{assert.equal(opts.strict,true);queries.push(q);return Array.from({length:11},(_,i)=>({id:String(i)}));}}});
 const where=await remote.buildAccountingEntriesRemoteWhereClause({dateFrom:'2026-01-01',dateTo:'2026-12-31',entryName:'ROW-82',mfsp:'M'});
 const order=await remote.buildAccountingEntriesRemoteOrderByClause({key:'supplier',direction:'asc'});
 await remote.loadCoqlPage('Accounting_Entries',['id'],{page:3,perPage:10,whereClause:where,orderByClause:order});
 assert.match(queries[0],/where \(/);assert.match(queries[0],/Name like '%ROW-82%'/);assert.match(queries[0],/order by Supplier.Vendor_Name asc, id asc limit 20, 11/);
 const bookings=await remote.buildBookingRemoteWhereClause({stageValues:['Won'],agency:'Agency',accountingRep:'Jane Doe'});assert.match(bookings,/Account_Name.Account_Name like/);assert.match(bookings,/Accounting_Rep.first_name/);assert.match(bookings,/Accounting_Rep.last_name/);
});

test('settlement detail services/invoices/payments have independent bounded queries and cancel on close',async()=>{
 vm.runInNewContext(fs.readFileSync('app/scripts/bookings.js','utf8'),{window});
 const state=ns.createInitialState();state.bookingClosure={settlements:[{id:'12'}],detail:{isOpen:false}};
 const calls=[];
 const module=ns.createBookingsModule({state,elements:{},MODULES:ns.MODULES,FIELD_CANDIDATES:ns.FIELD_CANDIDATES,helpers:ns.helpers,
  loadCoqlPage:async(name,fields,q)=>{calls.push({name,...q});return {records:[{id:name+'-'+q.page}],hasMore:q.page===1};}
 });
 await module.onClosureSettlementClick({target:{closest:selector=>selector==='[data-booking-closure-settlement-id]'?{getAttribute:()=> '12'}:null}});
 const detail=state.bookingClosure.detail;
 assert.equal(detail.services.length,1);assert.equal(detail.invoices.length,1);assert.equal(detail.payments.length,1);
 await detail.tables.services.view.onLoadMore();assert.equal(detail.services.length,2);assert.equal(detail.invoices.length,1);
 assert.ok(calls.every(c=>c.perPage===50));assert.ok(calls.filter(c=>c.name===ns.MODULES.bookingServices).every(c=>c.whereClause==="Supplier_Settlement = '12'"));
 module.closeBookingClosureDetail();const before=calls.length;await detail.tables.invoices.view.onLoadMore();assert.equal(calls.length,before);
});
