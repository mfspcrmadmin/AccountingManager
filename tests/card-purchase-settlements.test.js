const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('app/scripts/card-purchase-settlements.js', 'utf8'), { window });
const service = window.AccountingManagerApp.cardPurchaseSettlements;
const purchase = { Supplier: { id: '10' }, Booking: { id: '20' } };
const settlement = id => ({ id, Name: 'Settlement ' + id, Supplier: { id: '10' }, Booking: { id: '20' } });
test('filters by supplier and booking, paginates, and defaults to the linked matching settlement', async () => {
  const calls = [];
  const api = { searchRecord: async args => { calls.push(args); return { data: args.page === 1 ? [settlement('1')] : [settlement('2')], info: { more_records: args.page === 1 } }; } };
  const result = await service.load(api, { ...purchase, Settlement: { id: '2' } });
  assert.equal(calls[0].Query, '((Supplier:equals:10)and(Booking:equals:20))');
  assert.equal(calls.length, 2);
  assert.equal(result.records.length, 2);
  assert.equal(result.selectedId, '2');
});
test('single match is automatic, multiple or no matches require a choice, unrelated matches are excluded', async () => {
  for (const [data, expected] of [[[settlement('1')], '1'], [[settlement('1'), settlement('2')], ''], [[], ''], [[{ ...settlement('3'), Supplier: { id: '99' } }], '']]) {
    const result = await service.load({ searchRecord: async () => ({ data }) }, { ...purchase, Settlement: { id: '99' } });
    assert.equal(result.selectedId, expected);
  }
});
test('selection is re-read and must still match both supplier and booking before saving', async () => {
  for (const record of [null, { ...settlement('1'), Supplier: { id: '99' } }, { ...settlement('1'), Booking: { id: '99' } }]) {
    await assert.rejects(service.validate({ getRecord: async () => ({ data: record ? [record] : [] }) }, purchase, '1'), /supplier and booking/);
  }
  assert.equal((await service.validate({ getRecord: async () => ({ data: [settlement('1')] }) }, purchase, '1')).id, '1');
});
test('missing context, malformed results and repeated pages fail visibly', async () => {
  await assert.rejects(service.load({}, {}), /supplier and booking/);
  await assert.rejects(service.load({ searchRecord: async () => ({ code: 'NO_PERMISSION' }) }, purchase), /Could not load/);
  await assert.rejects(service.load({ searchRecord: async () => ({ data: [settlement('1')], info: { more_records: true } }) }, purchase), /incomplete/);
});
