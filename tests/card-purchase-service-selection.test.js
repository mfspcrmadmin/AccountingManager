const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('app/scripts/card-purchase-services.js', 'utf8'), { window });
const services = window.AccountingManagerApp.cardPurchaseServices;
const purchase = { id: '1', Supplier: { id: '10' }, Booking: { id: '20' }, Boking_Service: { id: '30' } };
const service = id => ({ id, Supplier: { id: '10' }, Booking: { id: '20' } });

test('service choices paginate and exclude other suppliers and bookings', async () => {
  const calls = [];
  const result = await services.load({ searchRecord: async args => {
    calls.push(args);
    return { data: args.page === 1 ? [service('30'), { ...service('99'), Booking: { id: '99' } }] : [service('31')], info: { more_records: args.page === 1 } };
  } }, purchase);
  assert.equal(calls[0].Query, '((Supplier:equals:10)and(Booking:equals:20))');
  assert.deepEqual(Array.from(result, row => row.id), ['30', '31']);
  await assert.rejects(services.load({ searchRecord: async () => ({ code: 'NO_PERMISSION' }) }, purchase), /Could not load/);
});

test('service save changes only the single service lookup after verifying fresh records', async () => {
  const writes = [];
  const selected = await services.save({
    getRecord: async args => ({ data: [args.Entity === 'Card_Purchases' ? purchase : service('31')] }),
    updateRecord: async args => { writes.push(args); return { data: [{ code: 'SUCCESS' }] }; }
  }, purchase, '31');
  assert.equal(selected.id, '31');
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].APIData)), { id: '1', Boking_Service: { id: '31' } });
  assert.equal(purchase.Boking_Service.id, '30');
});

test('concurrent invoice or service changes and foreign services prevent any write', async () => {
  for (const [current, selected] of [
    [{ ...purchase, Vendor_Invoice: { id: '50' } }, service('31')],
    [{ ...purchase, Vendor_Payment: { id: '60' } }, service('31')],
    [{ ...purchase, Boking_Service: { id: '32' } }, service('31')],
    [purchase, { ...service('31'), Supplier: { id: '99' } }],
    [purchase, { ...service('31'), Booking: { id: '99' } }]
  ]) {
    await assert.rejects(services.save({
      getRecord: async args => ({ data: [args.Entity === 'Card_Purchases' ? current : selected] }),
      updateRecord: async () => assert.fail('must not write')
    }, purchase, '31'), /changed|supplier and booking/);
  }
});

test('missing selection and CRM update failures remain errors', async () => {
  await assert.rejects(services.save({}, purchase, ''), /Select/);
  await assert.rejects(services.save({
    getRecord: async args => ({ data: [args.Entity === 'Card_Purchases' ? purchase : service('31')] }),
    updateRecord: async () => ({ data: [{ code: 'NO_PERMISSION', message: 'Denied' }] })
  }, purchase, '31'), /Denied/);
});
