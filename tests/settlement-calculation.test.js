const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const window = {};
  vm.runInNewContext(fs.readFileSync('app/scripts/settlement-calculation.js','utf8'),{window});
  const data={settlements:[],services:[{id:'3',Booking:{id:'2',name:'MFSP 123'}}],jobs:[]};
  const timers=new Map(), snapshots=[], changes=[], executions=[], queries=[];
  let nextTimer=0;
  const crm={
    async coql(query,options) {
      queries.push(query);assert.equal(options.strict,true);
      if(data.readFailure)throw Error('NO_PERMISSION');
      const rows=query.includes('from Deals')?(data.bookings || []):query.includes('from Supplier_Settlements')?data.settlements:query.includes('from Booking_Services')?data.services:data.jobs;
      const offset=Number(query.match(/limit (\d+), 200/)[1]);
      return structuredClone(rows.slice(offset,offset+200));
    },
    async executeFunction(name,args) { executions.push({name,args});return {details:{output:JSON.stringify(data.result || {error:false})}}; }
  };
  const monitor=window.AccountingManagerApp.createSettlementCalculationMonitor({
    crm,onChange:(view,retrying)=>changes.push({view,retrying}),onSnapshot:async(snapshot)=>snapshots.push(snapshot),
    setTimeout:(fn,ms)=>{assert.equal(ms,30000);timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:key=>timers.delete(key)
  });
  return {ns:window.AccountingManagerApp,monitor,crm,data,timers,snapshots,changes,executions,queries};
}
function job(Status, extra={}) { return {id:'8',Booking:{id:'2'},Status,Created_Time:'2026-10-08T12:00:00Z',Modified_Time:'2026-10-08T12:00:00Z',...extra}; }
test('selected scope queries only selected bookings and resolves MFSP without the global booking index',async()=>{
  const f=fixture();
  f.data.settlements=[{id:'1',Booking:{id:'2'}},{id:'3',Booking:{id:'4'}},{id:'5',Booking:{id:'2'}}];
  f.data.bookings=[{id:'2',MFSP_Reference:'MFSP2606148',Deal_Name:'Family trip'}];
  await f.monitor.start('1',[]);
  assert.equal(f.monitor.getView().rows.length,0);
  assert.equal(f.queries.some(q=>q.includes('Admin_Process_Jobs')),false);
  f.queries.length=0;
  await f.monitor.start('1',['2','2']);
  assert.equal(f.monitor.getView().rows.length,1);
  assert.equal(f.monitor.getView().rows[0].mfsp,'MFSP2606148');
  assert.equal(f.queries.some(q=>q.includes('Booking_Services')),false);
  assert.ok(f.queries.some(q=>q.includes("Booking in ('2')")));
  await f.monitor.start('1',[]);
  assert.equal(f.monitor.getView().rows.length,0);
  assert.equal(f.executions.length,0);
});
test('opening, refreshing and automatic polling never execute recovery for queued or unconfirmed bookings',async()=>{
  const f=fixture();
  for(const status of ['Pending','Processing','Error']) {
    f.data.jobs=[job(status)];
    await f.monitor.start('1');
    await f.monitor.refresh();
    const poll=[...f.timers.values()].at(-1);await poll();
    assert.equal(f.executions.length,0);
    assert.equal(f.monitor.getView().rows[0].canRetry,true);
  }
  await f.monitor.retry('2');
  assert.equal(f.executions.length,1);
  assert.equal(f.executions[0].args.bookingId,'recover:2');
});
test('refresh exposes loading while keeping rows and suppresses concurrent status queries',async()=>{
  const f=fixture();f.data.jobs=[job('Pending')];await f.monitor.start('1');
  let release; const wait=new Promise(resolve=>release=resolve); const original=f.crm.coql;
  let reads=0;f.crm.coql=async(...args)=>{reads++;await wait;return original(...args);};
  const first=f.monitor.refresh();const second=f.monitor.refresh();
  assert.equal(f.monitor.getView().loading,true);
  assert.equal(f.monitor.getView().rows[0].status,'pending');
  assert.equal(reads,2); // settlements and services, one shared refresh
  release();await Promise.all([first,second]);assert.equal(f.monitor.getView().loading,false);
});
test('pending calculations are found through booking services before a settlement exists',async()=>{
  const f=fixture();f.data.jobs=[job('Pending')];await f.monitor.start('1');
  assert.equal(f.monitor.getView().settlements.length,0);
  assert.equal(f.monitor.getView().rows[0].status,'pending');
  assert.ok(f.queries.some(q=>q.includes("Booking in ('2')")));
});
test('empty supplier and denied access are distinct outcomes, never false success',async()=>{
  const empty=fixture();empty.data.services=[];await empty.monitor.start('1');
  assert.equal(empty.monitor.getView().rows.length,0);assert.equal(empty.monitor.getView().error,'');
  const denied=fixture();denied.data.readFailure=true;await denied.monitor.start('1');
  assert.match(denied.monitor.getView().error,/could not be verified.*NO_PERMISSION/);
  assert.equal(denied.snapshots.length,0);
});
test('failed/retrying jobs expose errors; latest completed work supersedes older errors',async()=>{
  const f=fixture();f.data.jobs=[job('Retry',{Last_Error:'Write rejected',Next_Run_At:'2026-10-08T13:00:00Z'})];await f.monitor.start('1');
  assert.equal(f.monitor.getView().rows[0].canRetry,true);
  assert.equal(f.monitor.getView().rows[0].error,'Write rejected');
  f.data.jobs=[job('Error',{Last_Error:'Failed'} )];await f.monitor.refresh();
  assert.equal(f.monitor.getView().rows[0].status,'failed');
  f.data.jobs=[job('Done',{Completed_At:'2026-10-08T14:00:00Z'}),job('Error')];await f.monitor.refresh();
  assert.equal(f.monitor.getView().rows[0].status,'idle');
  assert.equal(f.monitor.getView().rows[0].lastCalculated,'2026-10-08T14:00:00Z');
});
test('manual execution leases show running, expired locks are retryable, completed leases are ignored',async()=>{
  const f=fixture();const lease={Source_Function:'settlement_recalculation_lease',Lock_Expires_At:new Date(Date.now()+60000).toISOString()};
  f.data.jobs=[job('On Hold',lease)];await f.monitor.start('1');assert.equal(f.monitor.getView().rows[0].status,'running');
  f.data.jobs=[job('On Hold',{...lease,Lock_Expires_At:'2000-01-01T00:00:00Z'})];await f.monitor.refresh();assert.equal(f.monitor.getView().rows[0].canRetry,true);
  f.data.jobs=[job('Done',lease)];await f.monitor.refresh();assert.equal(f.monitor.getView().rows[0].status,'idle');
});
test('polling refreshes records after completion and stops on close',async()=>{
  const f=fixture();f.data.jobs=[job('Processing')];await f.monitor.start('1');
  f.data.settlements=[{id:'9',Booking:{id:'2'},Total_Service_Cost:123,Last_Recalculated_At:'2026-10-08T14:00:00Z'}];
  f.data.jobs=[job('Done')];await [...f.timers.values()].at(-1)();
  assert.equal(f.snapshots.at(-1).settlements[0].Total_Service_Cost,123);
  assert.equal(f.monitor.getView().rows[0].status,'idle');
  f.monitor.stop();assert.equal(f.timers.size,0);
});
test('confirmed manual completion supersedes an older failed job; failed manual calculations stay visible',async()=>{
  const f=fixture();f.data.jobs=[job('Done',{Source_Function:'settlement_recalculation_lease',Last_Result_JSON:'{"error":false}',Completed_At:'2026-10-08T14:00:00Z'}),job('Error')];
  await f.monitor.start('1');assert.equal(f.monitor.getView().rows[0].status,'idle');
  f.data.jobs[0]=job('Error',{Source_Function:'settlement_recalculation_lease',Last_Error:'Rebuild incomplete',Last_Result_JSON:'{"error":true}'});
  await f.monitor.refresh();assert.equal(f.monitor.getView().rows[0].status,'failed');assert.equal(f.monitor.getView().rows[0].error,'Rebuild incomplete');
});
test('changing supplier or closing discards an earlier in-flight response',async()=>{
  for(const close of [false,true]){
    const f=fixture();const original=f.crm.coql;let release;
    f.crm.coql=async(q,o)=>q.includes("Supplier = '1'")?await new Promise(resolve=>{if(q.includes('Supplier_Settlements'))release=()=>resolve([]);else resolve([]);}):original(q,o);
    const pending=f.monitor.start('1');
    if(close)f.monitor.stop();else await f.monitor.start('4');
    release();await pending;
    assert.ok(f.snapshots.every(s=>s.supplierId!=='1'));
    assert.equal(f.timers.size,close?0:1);
  }
});
test('retry invokes existing protected recalc once, reloads data and rejects unconfirmed outcomes',async()=>{
  const f=fixture();f.data.jobs=[job('Error',{Modified_Time:'2000-01-01T00:00:00Z'})];await f.monitor.start('1');
  await Promise.all([f.monitor.retry('2'),f.monitor.retry('2')]);
  assert.equal(f.executions.length,1);assert.equal(f.executions[0].name,'recalculatesuppliersettlementsforbooking');
  assert.equal(f.executions[0].args.bookingId,'recover:2');assert.equal(f.monitor.getView().rows[0].status,'idle');
  const g=fixture();g.data.jobs=[job('Error')];g.data.result={error:true,message:'Partial writes'};await g.monitor.start('1');await g.monitor.retry('2');
  assert.match(g.monitor.getView().actionError,/Partial writes/);
  await g.monitor.retry('777');assert.equal(g.executions.length,1);
});
test('complete paginated reads include settlements past the first 200 and reject a truncated snapshot',async()=>{
  const f=fixture();f.data.services=[];f.data.settlements=Array.from({length:201},(_,i)=>({id:String(i+10)}));
  await f.monitor.start('1');assert.equal(f.monitor.getView().settlements.length,201);
  f.crm.coql=async()=>Array.from({length:200},()=>({id:'9'}));await f.monitor.refresh();
  assert.match(f.monitor.getView().error,/Too many records/);
});
test('automatic refresh updates selected records without changing amounts or document; unavailable selections are removed',()=>{
  const f=fixture();const document={name:'invoice.pdf'};
  const creation={selectedSettlement:{id:'9'},selectedSettlements:[{id:'9'},{id:'10'}],settlementAllocationAmounts:{9:45,10:55},documentFile:document,settlementQuery:'my filter'};
  const rows=[{id:'9',Total_Service_Cost:200},{id:'10',Total_Service_Cost:100}];
  assert.equal(f.ns.reconcileCalculationSettlements(creation,rows),false);
  assert.equal(creation.selectedSettlement.Total_Service_Cost,200);
  assert.deepEqual(creation.settlementAllocationAmounts,{9:45,10:55});assert.equal(creation.documentFile,document);assert.equal(creation.settlementQuery,'my filter');
  assert.equal(f.ns.reconcileCalculationSettlements(creation,[rows[1]]),true);
  assert.equal(creation.selectedSettlement.id,'10');assert.deepEqual(creation.settlementAllocationAmounts,{10:55});
});
test('calculation details live in the context column, start closed and load before invoice creation',()=>{
  const html=fs.readFileSync('app/widget.html','utf8');
  assert.ok(html.indexOf('id="invoice-create-calculation"')>html.indexOf('id="invoice-create-step-settlement"'));
  assert.ok(html.indexOf('id="invoice-create-calculation"')<html.indexOf('id="invoice-create-step-amounts"'));
  assert.match(html, /<div id="invoice-create-calculation-details" hidden>/);
  assert.match(html, /id="invoice-create-calculation-toggle"[^>]*aria-expanded="false"/);
  assert.ok(html.indexOf('scripts/settlement-calculation.js')<html.indexOf('scripts/invoice-create.js'));
  const window={};vm.runInNewContext(fs.readFileSync('app/scripts/dom.js','utf8'),{window,document:{getElementById:id=>html.includes('id="'+id+'"')?{id}:null,querySelectorAll:()=>[]}});
  const elements=window.AccountingManagerApp.getElements();
  for(const key of ['invoiceCreateCalculation','invoiceCreateCalculationSummary','invoiceCreateCalculationWarning','invoiceCreateCalculationRows','invoiceCreateCalculationRefresh'])assert.ok(elements[key]);
});
test('new pending work does not hide an earlier successful calculation date',async()=>{
  const f=fixture();f.data.jobs=[job('Pending'),job('Done',{Completed_At:'2026-10-08T10:00:00Z'})];
  await f.monitor.start('1'); assert.equal(f.monitor.getView().rows[0].lastCalculated,'2026-10-08T10:00:00Z');
  assert.equal(f.monitor.getView().rows[0].status,'pending');
});
test('expired processing job without a lease has an unconfirmed outcome and can be recovered',async()=>{
  const f=fixture();f.data.jobs=[job('Processing',{Modified_Time:'2000-01-01T00:00:00Z'})];
  await f.monitor.start('1'); assert.equal(f.monitor.getView().rows[0].status,'unconfirmed');
  assert.equal(f.monitor.getView().rows[0].canRetry,true);
});
test('a recent CRM timestamp protects incorrectly dated locks and disables recovery',async()=>{
  const f=fixture();f.data.jobs=[job('On Hold',{Source_Function:'settlement_recalculation_lease',Modified_Time:new Date().toISOString(),Lock_Expires_At:'2000-01-01T00:00:00Z'}),job('Retry')];
  await f.monitor.start('1'); assert.equal(f.monitor.getView().rows[0].status,'running');
  assert.equal(f.monitor.getView().rows[0].canRetry,false); await f.monitor.retry('2');assert.equal(f.executions.length,0);
});
test('partial reconciliation does not display confirmed recovery',async()=>{
  const f=fixture(); f.data.jobs=[job('Error')]; f.data.result={error:true,calculation_completed:true,message:'Some jobs could not be closed'};
  await f.monitor.start('1');await f.monitor.retry('2');assert.match(f.monitor.getView().actionError,/could not be closed/);
});

test('recovery feedback remains on its booking after automatic polling',async()=>{
 const f=fixture();f.data.jobs=[job('Pending')];f.data.result={error:true,message:'A calculation job is still active.'};
 await f.monitor.start('1');await f.monitor.retry('2');
 assert.equal(f.monitor.getView().rows[0].recovery.status,'error');
 await [...f.timers.values()].at(-1)();
 assert.equal(f.monitor.getView().rows[0].recovery.message,'A calculation job is still active.');
 f.monitor.stop();await f.monitor.start('1');assert.equal(f.monitor.getView().rows[0].recovery,null);
});
test('successful recovery response does not claim a pending queue is clear',async()=>{
 const f=fixture();f.data.jobs=[job('Pending')];await f.monitor.start('1');await f.monitor.retry('2');
 assert.match(f.monitor.getView().rows[0].recovery.message,/pending or unconfirmed work remains/);
 assert.equal(f.monitor.getView().rows[0].status,'pending');
 f.crm.executeFunction=async()=>{f.data.jobs=[];return {details:{output:JSON.stringify({error:false})}};};
 await f.monitor.retry('2');
 assert.match(f.monitor.getView().rows[0].recovery.message,/no pending work/);
 assert.equal(f.monitor.getView().rows[0].status,'idle');
});
