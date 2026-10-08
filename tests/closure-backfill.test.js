const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('_local/crm/crm_functions/backfillTripAccountingClosure', 'utf8');
class DMap extends Map { put(k, v) { this.set(k, v); } containKey(k) { return this.has(k); } }
class DList extends Array { add(v) { this.push(v); } isEmpty() { return !this.length; } }
const wrap = value => Array.isArray(value) ? DList.from(value.map(wrap)) : value && typeof value === 'object' ? new DMap(Object.entries(value).map(([k, v]) => [k, wrap(v)])) : value;
function run({ phase = 'bookings', dryRun = false, rows, more = false, failId, current = {}, httpCode = 200 } = {}) {
  rows = rows || [{ id: '1', Stage: 'Trip Accounting Closure', Closure_Status: null }];
  const writes = [];
  const data = wrap({ data: rows, info: { more_records: more } });
  const context = {
    phase, afterId: '0', dryRun, Map: () => new DMap(), List: () => new DList(),
    ifnull: (v, fallback) => v == null ? fallback : v, isnull: v => v == null,
    mockResponse: new DMap([['responseCode', httpCode], ['responseText', { toString: () => ({ toMap: () => data }) }]]),
    zoho: { crm: {
      getRecordById(module, id) { return wrap(current[id] || rows.find(r => r.id === id)); },
      updateRecord(module, id, payload, options) {
        writes.push({ module, id, payload, options });
        return wrap(id === failId ? { code: 'INVALID_DATA' } : { id });
      }
    } }
  };
  const executable = source.replace(/^string standalone[^\n]+/, '')
    .replace(/invokeurl\s*\[[\s\S]*?\];/, 'mockResponse;')
    .replace(/for each (\w+) in ([^\n]+)\n/g, 'for (const $1 of $2)\n')
    .replace(/\.toLong\(\)/g, '').replace(/cursor.matches\("\^\[0-9\]\+\$"\)/g, '/^[0-9]+$/.test(cursor)');
  const result = vm.runInNewContext('(function () ' + executable + ')()', context);
  return { result, writes, query: context.query?.get('select_query') };
}
test('only empty booking closure fields are populated; other stages and populated values survive', () => {
  const rows = [null, '', '  ', '-None-', 'Closure In Review', 'Closure Completed'].map((status, i) => ({ id: String(i + 1), Stage: 'Trip Accounting Closure', Closure_Status: status }));
  rows.push({ id: '7', Stage: 'Booking Completed', Closure_Status: null });
  const r = run({ rows });
  assert.equal(r.result.get('error'), false);
  assert.deepEqual(r.writes.map(w => w.id), ['1', '2', '3', '4']);
  for (const w of r.writes) {
    assert.equal(w.payload.get('Closure_Status'), 'Closure Pending');
    assert.equal(w.payload.size, 1);
    assert.equal(w.options.get('trigger').length, 0);
  }
  assert.equal(r.result.get('next_phase'), 'settlements');
  assert.equal(r.result.get('next_after_id'), '0');
  assert.equal(r.result.get('complete'), false);
});
test('settlements are repaired independently of the booking closure status and preserve Reviewed', () => {
  const r = run({ phase: 'settlements', rows: [
    { id: '1', Booking: { id: '10' }, Closure_Review_Status: null, Settlement_Type: 'Agent Commission' },
    { id: '2', Booking: { id: '10' }, Closure_Review_Status: 'Reviewed' }
  ], current: { '10': { id: '10', Stage: 'Trip Accounting Closure', Closure_Status: 'Closure In Review' } } });
  assert.equal(r.result.get('error'), false);
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].payload.get('Closure_Review_Status'), 'Pending review');
  assert.equal(r.result.get('complete'), true);
  assert.match(r.query, /Booking.Stage = 'Trip Accounting Closure'/);
});
test('simulation reports candidates without writing', () => {
  const r = run({ dryRun: true });
  assert.equal(r.writes.length, 0);
  assert.equal(r.result.get('eligible'), 1);
  assert.equal(r.result.get('updated'), 0);
});
test('pagination advances by ID and failed writes remain retryable', () => {
  const rows = ['1', '2'].map(id => ({ id, Stage: 'Trip Accounting Closure', Closure_Status: null }));
  const r = run({ rows, more: true });
  assert.equal(r.result.get('next_phase'), 'bookings');
  assert.equal(r.result.get('next_after_id'), '2');
  const failed = run({ rows, failId: '2' });
  assert.equal(failed.result.get('error'), true);
  assert.equal(failed.result.get('next_after_id'), '1');
  assert.equal(failed.result.get('complete'), false);
});
test('missing fields and query failures do not become successful empty scans', () => {
  assert.equal(run({ current: { '1': { id: '1', Stage: 'Trip Accounting Closure' } } }).result.get('error'), true);
  assert.equal(run({ httpCode: 403 }).result.get('error'), true);
  assert.equal(run({ httpCode: 204, phase: 'settlements' }).result.get('complete'), true);
});
