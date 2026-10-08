const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(status = 'Closure Pending', reviews = ['Pending review'], options = {}) {
  const window = {};
  vm.runInNewContext(fs.readFileSync('app/scripts/bookings.js', 'utf8'), { window });
  const booking = { id: 'b1', Closure_Status: status };
  const settlements = reviews.map((review, i) => ({ id: String(i), Closure_Review_Status: review }));
  const state = { bookingClosure: { booking: { ...booking }, settlements, isOpen: true }, views: { bookings: { records: [{ ...booking }] } } };
  const writes = [], pages = [];
  const success = { data: [{ code: 'SUCCESS' }] };
  const module = window.AccountingManagerApp.createBookingsModule({
    MODULES: { bookings: 'Deals', settlements: 'Settlements' },
    FIELD_CANDIDATES: { booking: { closureStatus: ['Closure_Status'] }, settlement: { closureReviewStatus: ['Closure_Review_Status'] } },
    state, elements: { bookingClosureContent: { querySelector: () => ({ value: options.reason || '' }) } },
    helpers: {
      getCandidateValue: (record, candidates) => record && record[candidates[0]],
      normalizeString: value => String(value || '').toLowerCase().replace(/\s/g, ''),
      textValue: value => value || '', escapeCriteriaValue: value => value
    },
    crm: {
      getRecord: async () => ({ ...booking, Closure_Status: options.remoteStatus || booking.Closure_Status }),
      searchRecordPage: async (entity, criteria, page) => {
        pages.push(page);
        return (options.freshSettlements || settlements).slice((page - 1) * 200, page * 200);
      },
      updateRecord: async (entity, id, data) => {
        writes.push({ entity, id, data });
        if (options.fail === entity) return { data: [{ code: 'NO_PERMISSION', message: 'Permission denied' }] };
        if (entity === 'Deals') Object.assign(booking, data);
        return success;
      },
      insertRecord: async (entity, data) => {
        writes.push({ entity, data });
        return options.fail === entity ? { data: [{ code: 'ERROR', message: 'Note failed' }] } : success;
      }
    },
    getCurrentUserEmail: async () => options.noUser ? '' : 'accountant@example.com',
    renderAll() {}, debugError() {}, renderer: { showNotice() {}, showError() {} }
  });
  function event(attribute, value) { return { target: { closest: () => ({ disabled: false, getAttribute: key => key === attribute ? value : null }) } }; }
  return { state, writes, pages,
    action: name => module.onClosureStatusClick(event('data-closure-action', name)),
    review: () => module.onClosureReviewClick(event('data-booking-closure-review-settlement-id', '0')) };
}

test('first reviewed settlement advances Pending and updates the booking list', async () => {
  const r = setup(); await r.review();
  assert.equal(r.state.bookingClosure.booking.Closure_Status, 'Closure In Review');
  assert.equal(r.state.views.bookings.records[0].Closure_Status, 'Closure In Review');
  assert.equal(r.writes.length, 2);
});
test('review preserves Blocked and Reopened; all reviewed never auto completes', async () => {
  for (const status of ['Closure Blocked', 'Closure Reopened', 'Closure In Review']) {
    const r = setup(status); await r.review();
    assert.equal(r.state.bookingClosure.booking.Closure_Status, status);
    assert.equal(r.writes.length, 1);
  }
});
test('completed closures require reopening, including remote status changes', async () => {
  const r = setup('Closure Pending', ['Pending review'], { remoteStatus: 'Closure Completed' });
  await r.review(); assert.equal(r.writes.length, 0);
  assert.match(r.state.bookingClosure.error, /Reopen/);
  const reopened = setup('Closure Completed'); await reopened.action('reopen'); await reopened.review();
  assert.equal(reopened.state.bookingClosure.booking.Closure_Status, 'Closure Reopened');
});
test('manual completion records actor and timestamp', async () => {
  const r = setup('Closure In Review', ['Reviewed']); await r.action('complete');
  assert.equal(r.writes[0].data.Closure_Status, 'Closure Completed');
  assert.equal(r.writes[0].data.Closure_Completed_By, 'accountant@example.com');
  assert.ok(Number.isFinite(Date.parse(r.writes[0].data.Closure_Completed_At)));
});
test('completion rechecks every page, including pending settlement 201', async () => {
  const fresh = Array.from({ length: 201 }, (_, i) => ({ id: String(i), Closure_Review_Status: i === 200 ? 'Pending review' : 'Reviewed' }));
  const r = setup('Closure In Review', ['Reviewed'], { freshSettlements: fresh }); await r.action('complete');
  assert.deepEqual(r.pages, [1, 2]); assert.equal(r.writes.length, 0);
});
test('completion rejects empty, unreviewed, blocked, missing actor and incomplete loads', async () => {
  for (const [status, reviews, options] of [
    ['Closure Pending', [], {}], ['Closure In Review', ['Pending review'], {}],
    ['Closure Blocked', ['Reviewed'], {}], ['Closure In Review', ['Reviewed'], { noUser: true }]
  ]) {
    const r = setup(status, reviews, options); await r.action('complete'); assert.equal(r.writes.length, 0);
  }
  const r = setup('Closure In Review', ['Reviewed']); r.state.bookingClosure.loadFailed = true;
  await r.action('complete'); assert.equal(r.writes.length, 0);
});
test('No services settlements are excluded, but cannot alone enable closure', async () => {
  for (const active of [true, false]) {
    const fresh = [{ id: 'unused', Admin_Status: 'No services', Closure_Review_Status: 'Pending review' }];
    if (active) fresh.push({ id: 'active', Closure_Review_Status: 'Reviewed' });
    const r = setup('Closure In Review', ['Reviewed'], { freshSettlements: fresh }); await r.action('complete');
    assert.equal(r.writes.length, active ? 1 : 0);
  }
});
test('blocking requires a persisted reason; blocked closures can resume', async () => {
  const empty = setup(); await empty.action('block'); assert.equal(empty.writes.length, 0);
  const failed = setup('Closure Pending', [], { reason: 'Missing invoice', fail: 'Notes' });
  await failed.action('block'); assert.equal(failed.state.bookingClosure.booking.Closure_Status, 'Closure Pending');
  const r = setup('Closure Pending', [], { reason: 'Missing invoice' }); await r.action('block');
  assert.equal(r.writes[0].data.Note_Content, 'Missing invoice');
  assert.equal(r.writes[0].data.Parent_Id, 'b1');
  assert.equal(r.state.bookingClosure.booking.Closure_Status, 'Closure Blocked');
  await r.action('start'); assert.equal(r.state.bookingClosure.booking.Closure_Status, 'Closure In Review');
});
test('API failure preserves local status and reports partial review success', async () => {
  const r = setup('Closure Pending', ['Pending review'], { fail: 'Deals' }); await r.review();
  assert.equal(r.state.bookingClosure.booking.Closure_Status, 'Closure Pending');
  assert.equal(r.state.bookingClosure.settlements[0].Closure_Review_Status, 'Reviewed');
  assert.match(r.state.bookingClosure.error, /review saved/);
  assert.equal(r.state.bookingClosure.isSaving, false);
});
test('busy closure ignores further writes', async () => {
  const r = setup(); r.state.bookingClosure.isSaving = true;
  await r.action('start'); await r.review(); assert.equal(r.writes.length, 0);
});
