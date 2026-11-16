const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Execute the actual Deluge control flow with deterministic CRM and clock adapters.
// Zoho compilation and API contracts are checked separately during deployment.
function harness(options = {}) {
  const database = structuredClone(options.database || {});
  const calls = [];
  const context = vm.createContext({});
  vm.runInContext(`
    function Map(){return {};}; function List(){return [];};
    function ifnull(v,f){return v == null ? f : v;}; function isnull(v){return v == null;};
    Object.defineProperties(Object.prototype, {
      get:{value:function(k){return this[k] == null ? null : this[k];}},
      put:{value:function(k,v){this[k]=v;}},
      keys:{value:function(){return Object.keys(this);}},
      containKey:{value:function(k){return Object.hasOwn(this,k);}},
      size:{value:function(){return Object.keys(this).length;}},
      isEmpty:{value:function(){return Object.keys(this).length===0;}},
      toString:{value:function(){return JSON.stringify(this);}, configurable:true}
    });
    Array.prototype.add=function(v){this.push(v);};
    String.prototype.toList=function(s){return this.split(s);};
    String.prototype.toMap=function(){return JSON.parse(this);};
    String.prototype.toDecimal=String.prototype.toLong=function(){if(!Number.isFinite(Number(this)))throw Error('bad number');return Number(this);};
    Number.prototype.toLong=Number.prototype.toDecimal=function(){return Number(this);};
    Number.prototype.round=function(n){return Math.round(Number(this)*10**n)/10**n;};
    String.prototype.equals=String.prototype.equalsIgnoreCase=function(v){return this.toLowerCase()===String(v).toLowerCase();};
    String.prototype.contains=function(v){return this.includes(v);};
    String.prototype.subString=String.prototype.substring;
    String.prototype.left=function(n){return this.slice(0,n);};
    String.prototype.matches=function(v){return new RegExp('^(?:'+v+')$').test(this);};
    function time(v){return {valueOf:()=>new Date(v).valueOf(),toString:(format)=>new Date(v).toISOString().replace('.000Z',format?.includes("'+00:00'")?'+00:00':'+0000'),addMinutes:n=>time(new Date(new Date(v).valueOf()+n*60000))};};
    String.prototype.toTime=function(format,zone){
      if(format.includes('XXX')) throw Error('Unsafe implicit ISO timezone parsing');
      if(zone !== 'UTC') throw Error('Explicit UTC required');
      return time(String(this)+'Z');
    };
    var zoho={currenttime:time('2026-10-08T12:00:00Z'),crm:{}};
    var standalone={};
  `, context);
  if(options.now) vm.runInContext('zoho.currenttime=time('+JSON.stringify(options.now)+')',context);
  const inside = value => vm.runInContext('JSON.parse(' + JSON.stringify(JSON.stringify(value)) + ')', context);
  let nextId = 900;
  const get = (module, id) => inside(database[module]?.[id] || {});
  const update = (module, id, values) => {
    calls.push({ operation: 'update', module, id: String(id), values: structuredClone(values) });
    if (options.failFinish && values.Status === 'Done' && values.Last_Result_JSON) return inside({code:'NO_PERMISSION'});
    Object.assign(database[module][id], structuredClone(values));
    return inside({id:String(id)});
  };
  const create = (module, values) => {
    database[module] ||= {};
    const duplicate = Object.values(database[module]).find(r => values.Active_Key && r.Active_Key === values.Active_Key || values.Technical_Key && r.Technical_Key === values.Technical_Key);
    if (duplicate) return inside({code:'DUPLICATE_DATA',status:'error',details:{id:duplicate.id}});
    const id = String(nextId++);
    database[module][id] = {id, Modified_Time:'2026-10-08T11:59:00+00:00',...structuredClone(values)};
    if(options.corruptLeaseExpiry && values.Source_Function === 'settlement_recalculation_lease') database[module][id].Lock_Expires_At='2026-10-08T10:30:00+00:00';
    calls.push({operation:'create',module,id,values:structuredClone(values)});
    return inside({id});
  };
  context.zoho.crm = {
    getRecordById:get, updateRecord:update, createRecord:create,
    bulkCreate(module, records) {
      if(options.emptyBulk) return null;
      return inside(records.map(record=> {const r=create(module,record); return r.id ? {code:'SUCCESS',status:'success',details:{id:r.id}}:r;}));
    },
    bulkUpdate(module, records) {
      if(options.emptyBulk) return null;
      return inside(records.map(record=> {update(module,record.id,record);return options.rejectBulk ? {code:'NO_PERMISSION',status:'error'}:{code:'SUCCESS',status:'success',details:{id:record.id}};}));
    }
  };
  Object.assign(context.standalone, {
    jobs_conditionalUpdate(id, modified, changes) {
      if(options.conflict || options.conflictId === String(id) || database.Admin_Process_Jobs?.[id]?.Modified_Time !== modified) return inside({error:true,conflict:true});
      update('Admin_Process_Jobs',id,changes); return inside({error:false});
    },
    jobs_query(query) {
      const key = query.match(/Active_Key = '([^']+)'/);
      const booking = query.match(/Booking = '([^']+)'/);
      return inside({data: key ? Object.values(database.Admin_Process_Jobs || {}).filter(r=>r.Active_Key===key[1]):
        booking ? Object.values(database.Admin_Process_Jobs || {}).filter(r=>r.Job_Type==='Supplier Settlement Recalc' && String(r.Booking?.id || r.Booking)===booking[1] && ['Pending','Retry','Processing','Error'].includes(r.Status)):[],
        more_records: Boolean(options.tooManyJobs)});
    },
    settlements_readBookingRows(module, bookingId) {
      if(options.readFailure) throw Error('CRM read failed');
      return inside({data:Object.values(database[module] || {}).filter(r=>String(r.Booking?.id || r.Booking)===String(bookingId))});
    },
    venSet_upsertAgentCommissionSettlement:()=>inside({error:false}),
    rebuildSupplierSettlementTotals(ids) {
      calls.push({operation:'rebuild',ids});
      if(options.duringRebuild) options.duringRebuild(database);
      return inside({error:Boolean(options.rebuildFailure),processed_count:ids.split('|||').length,updated_count:0,warning_count:0});
    },
    recalculateSupplierSettlementsForBooking:()=>inside(options.recalcResult || {error:false})
  });
  function load(file) {
    const source=fs.readFileSync('crm/settlement-reliability/'+file+'.dg','utf8');
    const signature=source.match(/^string standalone\.(\w+)\(([^)]*)\)/);
    const args=signature[2].split(',').map(s=>s.trim().split(/\s+/).pop()).filter(Boolean);
    let body=source.slice(signature[0].length).replace(/\.length\(\)/g,'.length');
    const vars=[...new Set([...body.matchAll(/\b(\w+)\s*=(?!=)/g)].map(m=>m[1]))].filter(v=>!args.includes(v));
    body=body.replace(/for each\s+(\w+) in ([^{\n]+)(?=\{|\n)/g,'for (const $1 of $2)')
      .replace(/^\s*info [^\n]+;/gm,'');
    vm.runInContext('function '+signature[1]+'('+args.join(',')+')'+body.replace('{','{'+(vars.length?'let '+vars.join(',')+';':'')),context);
    context.standalone[signature[1]]=context[signature[1]];
    return (...values)=>context[signature[1]](...values.map(v=>typeof v==='object'?inside(v):v));
  }
  load('jobs_formatdatetimeforcrm');
  return {database,calls,load,options};
}
function seed() {
  return {Deals:{'1':{id:'1',MFSP_Reference:'123',Stage:'Confirmed'}},Vendors:{'2':{id:'2',TP_Reference:'SUP'}},
    Booking_Services:{'3':{id:'3',Booking:{id:'1'},Supplier:{id:'2'},Total_Purchase_Price:100}},
    Supplier_Settlements:{},Admin_Process_Jobs:{},Supplier_Invoices:{'4':{id:'4',Amount:50}}};
}
test('repeated recalc reuses settlement, links services and rebuilds financial totals without touching invoices',()=>{
  const f=harness({database:seed()}); const run=f.load('settlements_recalculateCore');
  assert.equal(run('1').error,false); assert.equal(run('1').error,false);
  assert.equal(Object.keys(f.database.Supplier_Settlements).length,1);
  assert.ok(f.database.Booking_Services['3'].Supplier_Settlement.id);
  assert.equal(f.calls.filter(c=>c.operation==='rebuild').length,2);
  assert.deepEqual(f.database.Supplier_Invoices,seed().Supplier_Invoices);
});
test('a paid settlement with no remaining services gets current service facts and a financial rebuild',()=>{
  const database=seed(); database.Booking_Services={};
  database.Supplier_Settlements['7']={id:'7',Booking:'1',Technical_Key:'1:2',Settlement_Type:'Supplier Services',Admin_Status:'Paid',Total_Service_Cost:100,Service_Count:1};
  const f=harness({database}); assert.equal(f.load('settlements_recalculateCore')('1').error,false);
  assert.equal(f.database.Supplier_Settlements['7'].Total_Service_Cost,0);
  assert.equal(f.database.Supplier_Settlements['7'].Service_Count,0);
  assert.ok(f.calls.some(c=>c.operation==='rebuild'&&c.ids==='7'));
});
for(const failure of ['readFailure','emptyBulk','rejectBulk','rebuildFailure']) {
  test('recalc propagates '+failure+' and releases its lease for recovery',()=>{
    const f=harness({database:seed(),[failure]:true}); f.load('settlements_recalculateCore');
    const result=f.load('recalculatesuppliersettlementsforbooking')('1');
    assert.equal(result.error,true);
    assert.ok(Object.values(f.database.Admin_Process_Jobs).every(j=>!j.Active_Key));
    const execution=Object.values(f.database.Admin_Process_Jobs).find(j=>j.Source_Function==='settlement_recalculation_lease');
    assert.equal(execution.Status,'Error');
    assert.equal(JSON.parse(execution.Last_Result_JSON).error,true);
  });
}
test('another live lease blocks recalculation before any service or settlement write',()=>{
  const database=seed();database.Admin_Process_Jobs['8']={id:'8',Active_Key:'SETTLEMENT_LEASE:1',Lock_Expires_At:'2026-10-08T12:20:00+00:00'};
  const f=harness({database}); f.load('settlements_recalculateCore');
  assert.equal(f.load('recalculatesuppliersettlementsforbooking')('1').error,true);
  assert.equal(f.calls.length,0);
});
test('an expired lease can be recovered, and invalid money never silently becomes zero',()=>{
  const database=seed();database.Admin_Process_Jobs['8']={id:'8',Active_Key:'SETTLEMENT_LEASE:1',Modified_Time:'2026-10-08T10:00:00+00:00',Lock_Expires_At:'2026-10-08T10:30:00+00:00'};
  const f=harness({database});f.load('settlements_recalculateCore');
  assert.equal(f.load('recalculatesuppliersettlementsforbooking')('1').error,false);
  assert.equal(f.database.Admin_Process_Jobs['8'].Status,'Cancelled');
  const broken=seed();broken.Booking_Services['3'].Total_Purchase_Price='invalid';
  const g=harness({database:broken});g.load('settlements_recalculateCore');
  const result=g.load('recalculatesuppliersettlementsforbooking')('1');
  assert.equal(result.error,true);assert.match(result.message,/Invalid purchase price/);
  assert.equal(Object.keys(g.database.Supplier_Settlements).length,0);
});
test('enqueue returns root CRM id, coalesces queued work and keeps a successor for Processing work',()=>{
  const f=harness(); const enqueue=f.load('jobs_enqueueadminprocessjob');
  const input={job_type:'Supplier Settlement Recalc',booking_id:'1',dedup_key:'SUPPLIER_SETTLEMENT_RECALC:1'};
  const first=enqueue(input); assert.ok(first.job_id);assert.equal(first.created,true);
  assert.equal(enqueue(input).job_id,first.job_id);
  Object.assign(f.database.Admin_Process_Jobs[first.job_id],{Status:'Processing',Active_Key:null});
  const second=enqueue(input); assert.equal(second.created,true);assert.notEqual(second.job_id,first.job_id);
});
function jobHarness(options={}) {
  const database={Admin_Process_Jobs:{'5':{id:'5',Job_Type:'Supplier Settlement Recalc',Status:'Pending',Booking:{id:'1'},Attempts:0,Max_Attempts:5,Modified_Time:'2026-10-08T11:00:00+00:00'}}};
  return harness({...options,database});
}
test('processor reloads job type, returns retry on partial recalc and schedules next attempt',()=>{
  const f=jobHarness({recalcResult:{error:true,message:'partial write'}});
  assert.equal(f.load('jobs_processadminprocessjob')({id:'5'}).final_status,'Retry');
  assert.match(f.database.Admin_Process_Jobs['5'].Next_Run_At,/12:05:00/);
});
test('processor respects Next_Run_At and conditional claim conflicts',()=>{
  for(const conflict of [false,true]) {
    const f=jobHarness({conflict});
    if(!conflict) f.database.Admin_Process_Jobs['5'].Next_Run_At='2026-10-08T13:00:00+00:00';
    assert.equal(f.load('jobs_processadminprocessjob')({id:'5'}).skipped,true);
    assert.equal(f.calls.length,0);
  }
});
test('large results remain valid JSON; failed finish leaves a recoverable Processing lease',()=>{
  const f=jobHarness({recalcResult:{error:false,debug:'x'.repeat(40000)}});
  assert.equal(f.load('jobs_processadminprocessjob')({id:'5'}).final_status,'Done');
  assert.equal(JSON.parse(f.database.Admin_Process_Jobs['5'].Last_Result_JSON).details_omitted,true);
  const failed=jobHarness({failFinish:true});
  assert.equal(failed.load('jobs_processadminprocessjob')({id:'5'}).final_status,'Processing');
  assert.equal(failed.database.Admin_Process_Jobs['5'].Status,'Processing');
  assert.ok(failed.database.Admin_Process_Jobs['5'].Lock_Expires_At);
});
const recoveryJob = (id, Status, extra={}) => ({id, Status, Job_Type:'Supplier Settlement Recalc', Booking:{id:'1'}, Modified_Time:'2026-10-08T10:00:00+00:00', ...extra});
function recoveryHarness(jobs, options={}) {
  const database=seed(); database.Admin_Process_Jobs=Object.fromEntries(jobs.map(j=>[j.id,j]));
  const f=harness({database,...options}); f.load('settlements_recalculateCore');
  f.run=f.load('recalculatesuppliersettlementsforbooking'); return f;
}
test('recovery closes only preexisting booking jobs after successful financial rebuild',()=>{
  const f=recoveryHarness([recoveryJob('5','Pending'), recoveryJob('6','Processing',{Lock_Expires_At:'2026-10-08T10:30:00Z'}), recoveryJob('7','Pending',{Booking:{id:'99'}})]);
  assert.equal(f.run('recover:1').error,false);
  assert.equal(f.database.Admin_Process_Jobs['5'].Status,'Done');
  assert.equal(f.database.Admin_Process_Jobs['6'].Status,'Done');
  assert.equal(f.database.Admin_Process_Jobs['7'].Status,'Pending');
  const done=f.database.Admin_Process_Jobs['5'];
  assert.ok(done.Completed_At);
  assert.equal(done.Last_Error,'');
  assert.equal(done.Next_Run_At,null);
  assert.equal(done.Active_Key,null);
  assert.equal(JSON.parse(done.Last_Result_JSON).error,false);
  assert.equal(JSON.parse(done.Last_Result_JSON).booking_id,'1');
  assert.deepEqual(f.database.Supplier_Invoices,seed().Supplier_Invoices);
  const rebuilt=f.calls.findIndex(c=>c.operation==='rebuild');
  assert.ok(f.calls.findIndex(c=>c.id==='5'&&c.values?.Status==='Done')>rebuilt);
});
test('recovery refuses a recently modified processing job even with a shifted expiry',()=>{
  const f=recoveryHarness([recoveryJob('5','Processing',{Modified_Time:'2026-10-08T11:59:00Z',Lock_Expires_At:'2026-10-08T10:30:00Z'})]);
  assert.equal(f.run('recover:1').error,true); assert.equal(f.calls.length,0);
});
test('legacy lease with wrong offset stays protected for 30 minutes by CRM Modified_Time',()=>{
  const f=recoveryHarness([{id:'5',Active_Key:'SETTLEMENT_LEASE:1',Modified_Time:'2026-10-08T11:59:00Z',Lock_Expires_At:'2026-10-08T10:30:00Z'}]);
  assert.equal(f.run('recover:1').error,true); assert.equal(f.calls.length,0);
});
test('failed calculation never discards pending work',()=>{
  const f=recoveryHarness([recoveryJob('5','Pending')],{rebuildFailure:true});
  assert.equal(f.run('recover:1').error,true); assert.equal(f.database.Admin_Process_Jobs['5'].Status,'Pending');
});
test('concurrent sync changes are preserved and incomplete reconciliation is reported',()=>{
  const f=recoveryHarness([recoveryJob('5','Pending')],{duringRebuild(db){
    db.Admin_Process_Jobs['5'].Modified_Time='2026-10-08T12:00:01Z';
    db.Admin_Process_Jobs['6']=recoveryJob('6','Pending');
  }});
  const result=f.run('recover:1'); assert.equal(result.error,true); assert.equal(result.calculation_completed,true);
  assert.equal(f.database.Admin_Process_Jobs['5'].Status,'Pending'); assert.equal(f.database.Admin_Process_Jobs['6'].Status,'Pending');
});
test('recovery fails closed on incomplete queue reads or denied reconciliation',()=>{
  const f=recoveryHarness([recoveryJob('5','Pending')],{tooManyJobs:true});
  assert.equal(f.run('recover:1').error,true); assert.equal(f.calls.length,0);
  const g=recoveryHarness([recoveryJob('5','Pending')],{conflictId:'5'});
  assert.equal(g.run('recover:1').error,true); assert.equal(g.database.Admin_Process_Jobs['5'].Status,'Pending');
});
test('repeated recovery preserves settlement identity and normal scheduled calls leave queue alone',()=>{
  const f=recoveryHarness([recoveryJob('5','Pending')]);
  assert.equal(f.run('1').error,false); assert.equal(f.database.Admin_Process_Jobs['5'].Status,'Pending');
  assert.equal(f.run('recover:1').error,false); assert.equal(f.run('recover:1').error,false);
  assert.equal(Object.keys(f.database.Supplier_Settlements).length,1);
});
test('a timezone-shifted persisted expiry aborts before recalculating and leaves queued work available',()=>{
  const f=recoveryHarness([recoveryJob('5','Pending')],{corruptLeaseExpiry:true});
  const result=f.run('recover:1');
  assert.equal(result.error,true);assert.match(result.message,/inconsistent calculation lock time/);
  assert.equal(f.calls.some(c=>c.operation==='rebuild'),false);
  assert.equal(f.database.Admin_Process_Jobs['5'].Status,'Pending');
  assert.ok(Object.values(f.database.Admin_Process_Jobs).every(j=>!j.Active_Key));
});
test('datetime formatting preserves winter, summer and UTC offsets without shifting the wall clock',()=>{
  const format=harness().load('jobs_formatdatetimeforcrm');
  for(const [raw,expected] of [['2026-10-09T14:30:00+0200','2026-10-09T14:30:00+02:00'],['2026-12-09T14:30:00+0100','2026-12-09T14:30:00+01:00'],['2026-10-09T12:30:00+0000','2026-10-09T12:30:00+00:00']]){
    assert.equal(format(raw),expected);assert.equal(format(expected),expected);
  }
});

test('reported October 14 booking can recover with explicit offsets and writes genuine UTC timestamps',()=>{
  const f=recoveryHarness([
    recoveryJob('5','Processing',{Modified_Time:'2026-10-14T08:03:22+02:00',Lock_Expires_At:'2026-10-13T23:33:21+02:00'}),
    {id:'6',Active_Key:'SETTLEMENT_LEASE:1',Modified_Time:'2026-10-14T08:03:22+02:00',Lock_Expires_At:'2026-10-13T23:33:22+02:00'}
  ],{now:'2026-10-14T12:57:25Z'});
  assert.equal(f.run('recover:1').error,false);
  assert.equal(f.database.Admin_Process_Jobs['5'].Status,'Done');
  const lease=f.calls.find(c=>c.operation==='create'&&c.values.Source_Function==='settlement_recalculation_lease');
  assert.equal(lease.values.Locked_At,'2026-10-14T12:57:25+00:00');
  assert.equal(lease.values.Lock_Expires_At,'2026-10-14T13:27:25+00:00');
});

test('equivalent recent instants in summer, winter, negative and fractional offsets remain protected',()=>{
  for(const stamp of ['2026-10-08T13:59:00+02:00','2026-10-08T12:59:00+01:00','2026-10-08T04:59:00-07:00','2026-10-08T17:29:00+05:30','2026-10-08T11:59:00Z']) {
    const f=recoveryHarness([recoveryJob('5','Processing',{Modified_Time:stamp,Lock_Expires_At:'2026-10-08T10:00:00Z'})]);
    assert.match(f.run('recover:1').message,/blocked by recent modification/);
    assert.equal(f.calls.length,0);
  }
});

test('future expiry and retry times respect their explicit offset',()=>{
  const f=recoveryHarness([recoveryJob('5','Processing',{Lock_Expires_At:'2026-10-08T05:20:00-07:00'})]);
  assert.match(f.run('recover:1').message,/blocked by lock expiry/);
  assert.equal(f.calls.length,0);
  for(const [stamp,skipped] of [['2026-10-08T14:01:00+02:00',true],['2026-10-08T13:59:00+02:00',false]]) {
    const g=jobHarness(); g.database.Admin_Process_Jobs['5'].Next_Run_At=stamp;
    const result=g.load('jobs_processadminprocessjob')({id:'5'});
    assert.equal(result.skipped===true,skipped);
  }
});

test('an unparseable CRM timestamp prevents recovery writes',()=>{
  const f=recoveryHarness([recoveryJob('5','Processing',{Modified_Time:'2026-10-08T10:00:00'})]);
  assert.match(f.run('recover:1').message,/Invalid CRM timestamp/);
  assert.equal(f.calls.length,0);
});
