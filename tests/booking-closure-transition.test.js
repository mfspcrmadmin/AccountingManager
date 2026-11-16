const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('crm/settlement-reliability/bp_orchestratebookingtransition.dg', 'utf8');
const block = source.slice(source.indexOf('// Initialize accounting review'), source.indexOf('if(transitionCode.equals("marked_dead") && referenceType'));
class DMap extends Map { put(k, v) { this.set(k, v); } }
class DList extends Array { add(v) { this.push(v); } size() { return this.length; } isEmpty() { return !this.length; } get(i) { return this[i]; } }
const map = obj => new DMap(Object.entries(obj));
const list = values => DList.from(values);
function run({ transition = 'have_departed', refType = 'booking_id', count = 1, matches = 1, failBooking = false, failSettlement = false, throwSearch = false, closureStatus = '', reviewStatus = '', guardOnly = false } = {}) {
  const updates = [], batches = [], searches = [];
  const records = Array.from({ length: count }, (_, i) => map({ id: String(i), Closure_Review_Status:reviewStatus, Settlement_Type: i % 2 ? 'Agent Commission' : 'Supplier Services' }));
  const result = new DMap();
  const context = {
    res: result, transitionCode: transition, referenceType: refType, bookingReference: refType === 'booking_id' ? '123' : 'ezus123', ezusProjectRef: 'ezus123',
    Map: () => new DMap(), List: () => new DList(), isnull: x => x == null, ifnull: (x, fallback) => x == null ? fallback : x,
    zoho: { crm: {
      getRecordById() { return map({id:'123',Closure_Status:closureStatus}); },
      updateRecord(module, id, data) { updates.push({ module, id, data }); return failBooking ? map({ code: 'INVALID_DATA' }) : map({ id: '123' }); },
      searchRecords(module, criteria, page, size) {
        searches.push({ module, criteria, page });
        if (throwSearch) throw Error('search failed');
        if (module === 'Deals') return list(Array.from({ length: matches }, () => map({ id: '123' })));
        return list(records.slice((Number(page) - 1) * size, Number(page) * size));
      },
      bulkUpdate(module, batch) {
        batches.push({ module, batch });
        return list(batch.map((_, i) => map(failSettlement && i === 0 ? { status: 'error', code: 'INVALID_DATA' } : { status: 'success', code: 'SUCCESS' })));
      }
    } }
  };
  const selectedBlock=guardOnly?source.slice(source.indexOf('// Preserve completed closures'),source.indexOf('// End completed closure guard.'))+'\nres.put("would_change_stage",true);':block;
  const js = selectedBlock.replace(/for each\s+(\w+) in ([^\n]+)\n/g, 'for (const $1 of $2)\n')
    .replace(/\.equals\(([^)]*)\)/g, ' === $1').replace(/\.toLong\(\)/g, '').replace(/\.toList\(/g, '.split(');
  vm.runInNewContext('(function () {\n' + js + '\n})()', context);
  return { result, updates, batches, searches };
}
test('both closure transitions initialize booking and every settlement, including commissions', () => {
  for (const transition of ['have_departed', 'trip_accounting_closure']) {
    const r = run({ transition, count: 205 });
    assert.equal(r.updates[0].data.get('Closure_Status'), 'Closure Pending');
    assert.deepEqual(r.batches.map(x => x.batch.length), [100, 100, 5]);
    assert.equal(r.result.get('closure_settlements_updated'), 205);
    for (const { batch } of r.batches) for (const data of batch) {
      assert.equal(data.get('Closure_Review_Status'), 'Pending review');
      assert.equal(data.size, 2); // id and review status only; financial status is preserved.
    }
  }
});
test('other transitions do not reset review', () => {
  assert.equal(run({ transition: 'accounting_completed' }).updates.length, 0);
});
test('Ezus references resolve a unique CRM booking', () => {
  const r = run({ refType: 'ezus_project_ref' });
  assert.equal(r.updates[0].id, '123');
  assert.equal(r.searches[1].criteria, '(Booking:equals:123)');
  for (const matches of [0, 2]) {
    const failed = run({ refType: 'ezus_project_ref', matches });
    assert.equal(failed.result.get('error'), true);
    assert.equal(failed.updates.length, 0);
  }
});
test('bookings without settlements still enter closure pending', () => {
  const r = run({ count: 0 });
  assert.equal(r.updates.length, 1);
  assert.equal(r.batches.length, 0);
  assert.equal(r.result.get('closure_settlements_updated'), 0);
});
test('booking failures, settlement failures and search exceptions are reported', () => {
  assert.equal(run({ failBooking: true }).result.get('error'), true);
  assert.equal(run({ failBooking: true }).batches.length, 0);
  assert.equal(run({ failSettlement: true }).result.get('error'), true);
  assert.equal(run({ throwSearch: true }).result.get('error'), true);
});
test('search limit never reports a successful partial initialization', () => {
  const r = run({ count: 2001 });
  assert.equal(r.result.get('error'), true);
  assert.equal(r.batches.length, 0);
});
test('repeated initialization preserves existing closure and settlement review states',()=>{
 for(const closureStatus of ['Closure Pending','Closure In Review','Closure Blocked','Closure Reopened','Closure Completed']){
  const r=run({closureStatus,reviewStatus:'Reviewed',count:205});
  assert.equal(r.updates.length,0);assert.equal(r.batches.length,0);
 }
});
test('retry initializes only missing review statuses without resetting booking status',()=>{
 const r=run({closureStatus:'Closure In Review',count:1});
 assert.equal(r.updates.length,0);assert.equal(r.batches.length,1);
});
test('a completed closure cannot repeat the remote stage transition through either reference type',()=>{
 for(const refType of ['booking_id','ezus_project_ref']){
  const r=run({refType,closureStatus:'Closure Completed',guardOnly:true});
  assert.equal(r.result.get('would_change_stage'),undefined);
  assert.match(r.result.get('message'),/already completed/);
  assert.equal(run({refType,closureStatus:'Closure Pending',guardOnly:true}).result.get('would_change_stage'),true);
 }
});
