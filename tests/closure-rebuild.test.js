const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(options = {}) {
  const window = {};
  vm.runInNewContext(fs.readFileSync('app/scripts/bookings.js', 'utf8'), { window });
  const settlement = { id: 's1', Total_Paid: 0, Closure_Review_Status: 'Reviewed' };
  const closure = { isOpen: true, booking: { id: 'b1', Closure_Status: options.status || 'Closure In Review' }, settlements: options.all ? [settlement, {id:'s2',Closure_Review_Status:'Reviewed'}] : [settlement] };
  const calls = [], errors = [], notices = [];
  const module = window.AccountingManagerApp.createBookingsModule({
    state: { bookingClosure: closure }, elements: {}, MODULES: { settlements: 'Supplier_Settlements', bookings: 'Deals', invoices: 'Supplier_Invoices' },
    FIELD_CANDIDATES: { booking: { closureStatus: ['Closure_Status'] } },
    helpers: { getLookupId: v => v && v.id, escapeCriteriaValue: String, textValue: v => v || '', normalizeString: v => String(v || '').toLowerCase().replace(/\s/g, ''), getCandidateValue: (r, fields) => r[fields[0]] },
    renderer: { showError: value => errors.push(value), showNotice: value => notices.push(value) }, debugError() {},
    getFunctionOutputObject: r => r,
    crm: {
      executeFunction: async (name, args) => { calls.push({name, args}); if (options.network) throw Error('Unknown result'); return options.result || {error:false,processed_count:options.all ? 2 : 1,warning_count:0}; },
      searchRecordPage: async module => options.all && module === 'Supplier_Settlements' ? [{id:'s1',Total_Paid:0,Closure_Review_Status:'Reviewed'}, {id:'s2',Total_Paid:0,Closure_Review_Status:'Reviewed'}] : [],
      getRecord: async (module, id) => options.readFailure ? null : module === 'Deals' ? {id, Closure_Status:'Closure In Review', Balance_Amount:0} : {id,Total_Paid:100,Admin_Status:'Paid',Closure_Review_Status:'Pending review'}
    },
    refreshSettlementDataAfterBookingAction: async () => { calls.push('refresh'); }
  });
  const event = { target: { closest: () => ({getAttribute: () => options.id || 's1'}) } };
  return { closure, settlement, calls, errors, notices, run: () => module.onClosureRebuildClick(event) };
}

test('rebuild targets one settlement, blocks duplicate clicks and reads persisted totals and review state', async () => {
  const f = fixture(); await Promise.all([f.run(), f.run()]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].name, 'rebuildsuppliersettlementtotals');
  assert.equal(f.calls[0].args.settlementIdsString, 's1');
  assert.equal(f.settlement.Total_Paid, 100);
  assert.equal(f.settlement.Closure_Review_Status, 'Pending review');
  assert.equal(f.notices.length, 1);
  assert.equal(f.closure.isSaving, false);
});
test('completed closures and unknown rows cannot invoke rebuild', async () => {
  for (const options of [{status:'Closure Completed'}, {id:'other'}]) {
    const f = fixture(options); await f.run(); assert.equal(f.calls.length, 0);
  }
});
test('uncertain, malformed, partial and unreadable results require refresh without claiming success', async () => {
  for (const options of [{network:true}, {result:{}}, {result:{error:false,processed_count:0}}, {readFailure:true}]) {
    const f = fixture(options); await f.run();
    assert.equal(f.notices.length, 0); assert.equal(f.closure.loadFailed, true);
    assert.equal(f.closure.isSaving, false); assert.equal(f.settlement.Total_Paid, 0);
    await f.run(); assert.equal(f.calls.length, 1);
  }
});
test('warnings retain refreshed values but do not report clean success', async () => {
  const f = fixture({result:{error:false,processed_count:1,warning_count:1,warnings:['Mismatch']}});
  await f.run(); assert.equal(f.settlement.Total_Paid,100);
  assert.equal(f.notices.length,0); assert.ok(f.errors.some(value => value.includes('Mismatch')));
});

test('bulk rebuild targets every settlement once and reloads the closure snapshot', async () => {
  const f = fixture({all:true,id:'all'});
  await Promise.all([f.run(), f.run()]);
  assert.equal(f.calls[0].args.settlementIdsString, 's1|||s2');
  assert.equal(f.calls.filter(call => call.name).length, 1);
  assert.equal(f.notices.length, 1);
  assert.equal(f.closure.loadFailed, undefined);
  assert.equal(f.closure.settlements.length, 2);
  assert.ok(f.closure.settlements.every(row => row.Total_Paid === 100 && row.Closure_Review_Status === 'Pending review'));
  assert.equal(f.closure.booking.Balance_Amount, 0);
  assert.equal(f.closure.isSaving, false);
});

