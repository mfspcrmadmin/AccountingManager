const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const window = {};
  for (const file of ['prepayment-request-sync', 'prepayment-delete', 'prepayments']) {
    vm.runInNewContext(fs.readFileSync('app/scripts/' + file + '.js', 'utf8'), { window, Intl });
  }
  const records = {
    Prepayments: [{ id: '1', Prepayment_Request: { id: '10' }, Accounting_Status: 'Pending invoice' }],
    Prepayment_Requests: [{ id: '10', Status: 'To Be Paid' }],
    Prepayment_Request_Services: [{ id: '100', Prepayment_Request: { id: '10' }, Booking_Service: { id: '20' } }],
    Booking_Services: [{ id: '20', Payment_Status: 'Prepayment Requested' }],
    Prepayment_Invoice_Allocations: []
  };
  const values = new Map(), writes = [];
  const storage = { get length() { return values.size; }, key: i => [...values.keys()][i], getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const api = {
    getRecord: async ({ Entity, RecordID }) => ({ data: records[Entity].filter(r => r.id === RecordID) }),
    coql: async ({ select_query }) => {
      const [, module, field, id, offset] = select_query.match(/from (\w+) where (\w+) = '(\d+)' order by id asc limit (\d+), 200/);
      return { data: records[module].filter(r => r[field]?.id === id).slice(Number(offset), Number(offset) + 200).map(r => ({ id: r.id })) };
    },
    updateRecord: async ({ Entity, APIData }) => {
      writes.push(['update', Entity, APIData.id]);
      Object.assign(records[Entity].find(r => r.id === APIData.id), APIData);
      return { data: [{ code: 'SUCCESS' }] };
    },
    deleteRecord: async ({ Entity, RecordID }) => {
      writes.push(['delete', Entity, RecordID]);
      records[Entity] = records[Entity].filter(r => r.id !== RecordID);
      return { data: [{ code: 'SUCCESS' }] };
    }
  };
  const zoho = { CRM: { API: api, META: { getFields: async ({ Entity }) => ({ fields: Entity === 'Prepayments' ? [] : [{ api_name: Entity === 'Prepayment_Requests' ? 'Status' : 'Payment_Status', pick_list_values: ['Fully Paid', 'Partially Paid', 'To Be Paid', 'Prepayment Requested'].map(actual_value => ({ actual_value })) }] }) } } };
  const ns = window.AccountingManagerApp;
  return { records, api, writes, storage, ns, service: ns.createPrepaymentDeletionService(zoho, storage), restart: () => ns.createPrepaymentDeletionService(zoho, storage) };
}

test('last prepayment deletes request and junctions and restores the unpaid service status', async () => {
  const f = fixture();
  await f.service.remove('1');
  for (const module of ['Prepayments', 'Prepayment_Requests', 'Prepayment_Request_Services']) assert.equal(f.records[module].length, 0);
  assert.equal(f.records.Booking_Services[0].Payment_Status, 'To Be Paid');
  assert.equal(f.storage.length, 0);
});

test('siblings preserve their request and links and recalculate paid status', async () => {
  const f = fixture();
  f.records.Prepayments.push({ id: '2', Prepayment_Request: { id: '10' }, Accounting_Status: 'Prepayment recorded' });
  await f.service.remove('1');
  assert.equal(f.records.Prepayment_Requests[0].Status, 'Fully Paid');
  assert.equal(f.records.Prepayment_Request_Services.length, 1);
  assert.equal(f.records.Booking_Services[0].Payment_Status, 'Fully Paid');
  assert.equal(f.records.Prepayments[0].id, '2');
});

test('shared services derive their status from the other request after cleanup', async () => {
  const f = fixture();
  f.records.Prepayment_Requests.push({ id: '11' });
  f.records.Prepayments.push({ id: '2', Prepayment_Request: { id: '11' }, Accounting_Status: 'Prepayment recorded' });
  f.records.Prepayment_Request_Services.push({ id: '101', Prepayment_Request: { id: '11' }, Booking_Service: { id: '20' } });
  await f.service.remove('1');
  assert.equal(f.records.Booking_Services[0].Payment_Status, 'Fully Paid');
  assert.equal(f.records.Prepayment_Request_Services[0].id, '101');
  assert.equal(f.records.Prepayment_Requests[0].id, '11');
});

test('existing paid service totals survive removal of the last request', async () => {
  const f = fixture();
  Object.assign(f.records.Booking_Services[0], { Payment_Status: 'Partially Paid', Total_Paid: 100, Total_Service_Cost: 100 });
  await f.service.remove('1');
  assert.equal(f.records.Booking_Services[0].Payment_Status, 'Fully Paid');
});

test('an unreadable service prevents deletion before mutations', async () => {
  const f = fixture();
  // A malformed service read must never be interpreted as a resettable status.
  const original = f.api.getRecord;
  f.api.getRecord = async args => args.Entity === 'Booking_Services' ? { data: [] } : original(args);
  await assert.rejects(f.service.remove('1'), /Could not read/);
  assert.equal(f.writes.length, 0);
});

for (const field of ['Vendor_Invoice', 'Vendor_Payment']) test(field + ' blocks every mutation', async () => {
  const f = fixture();
  f.records.Prepayments[0][field] = { id: '50' };
  await assert.rejects(f.service.remove('1'), /associated invoices or payments/);
  assert.equal(f.writes.length, 0);
});

test('junction invoice associations block deletion regardless of status', async () => {
  const f = fixture();
  f.records.Prepayment_Invoice_Allocations.push({ id: '99', Prepayment: { id: '1' }, Status: 'Cancelled' });
  await assert.rejects(f.service.remove('1'), /associated invoices or payments/);
  assert.equal(f.writes.length, 0);
});

test('uncertain invoice/payment operations and unreadable relationships fail before writes', async () => {
  for (const mode of ['checkpoint', 'read']) {
    const f = fixture();
    if (mode === 'checkpoint') f.ns.assertPrepaymentDeletionCheckpoint = () => { throw new Error('pending operation'); };
    else f.api.coql = async () => ({ code: 'NO_PERMISSION' });
    await assert.rejects(f.service.remove('1'));
    assert.equal(f.writes.length, 0);
  }
});

test('partial cleanup survives reload and resumes without deleting twice', async () => {
  const f = fixture(), original = f.api.deleteRecord;
  f.api.deleteRecord = async args => args.Entity === 'Prepayment_Request_Services' ? { data: [{ code: 'ERROR', message: 'try again' }] } : original(args);
  await assert.rejects(f.service.remove('1'), /try again/);
  assert.equal(f.records.Prepayments.length, 0);
  const resumed = f.restart();
  assert.equal(resumed.pending()[0].id, '1');
  f.api.deleteRecord = original;
  await resumed.remove('1');
  assert.equal(f.writes.filter(w => w[0] === 'delete' && w[1] === 'Prepayments').length, 1);
  assert.equal(f.records.Prepayment_Requests.length, 0);
  assert.equal(f.storage.length, 0);
});

test('delete action exists in both table views and direct links disable it', () => {
  const f = fixture();
  for (const view of [true, false]) {
    const render = payment => f.ns.prepaymentsModel.paymentTable([{ payment, group: {} }], '2026-09-24', view);
    assert.match(render({ id: '1' }), /data-prepayment-delete="1"/);
    assert.match(render({ id: '1', Vendor_Payment: { id: '5' } }), /data-prepayment-delete="1"[^>]* disabled/);
  }
});
