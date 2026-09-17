const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('app/scripts/invoice-name.js','utf8'), { window });
const ns = window.AccountingManagerApp;
const context = { type: 'Tickets', supplierId: 's1', supplierCode: 'SUP-01', bookingId: 'b1', mfsp: 'MFSP123' };
const api = { async searchRecord() { return { data: [] }; } };
test('invoice types use their required default formats', async () => {
  for (const [type, prefix] of Object.entries({ Tickets: 'TICK', Proforma: 'PROF', 'Final Invoice': 'INV', 'Credit Note': 'CRED', Commission: 'COMM' })) {
    assert.equal(await ns.generateInvoiceName(api, { ...context, type }), type === 'Final Invoice' ? 'INV-MFSP123-' : prefix + '-MFSP123-SUP-01-1');
  }
});
test('sequence uses the largest matching number across all pages', async () => {
  const calls = [];
  const api = { async searchRecord(request) {
    calls.push(request);
    return request.page === 1 ? { data: [{ id: '1', Name: 'TICK-MFSP123-SUP-01-2' }, { id: '2', Name: 'PROF-MFSP123-SUP-01-99' }], info: { more_records: true } } : { data: [{ id: '3', Name: 'TICK-MFSP123-SUP-01-12' }, { id: '4', Name: 'TICK-OTHER-SUP-01-999' }] };
  } };
  assert.equal(await ns.generateInvoiceName(api, context), 'TICK-MFSP123-SUP-01-13');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].Query, '(Supplier:equals:s1)');
});
test('missing MFSP and supplier code are read from the linked booking and supplier', async () => {
  const seen = [];
  const readApi = { ...api, async getRecord(request) { seen.push(request.Entity); return { data: [request.Entity === 'Deals' ? { MFSP_Reference: 'MFSP42' } : { TP_Reference: 'SUP42' }] }; } };
  assert.equal(await ns.generateInvoiceName(readApi, { ...context, mfsp: '', supplierCode: '' }), 'TICK-MFSP42-SUP42-1');
  assert.deepEqual(seen, ['Deals', 'Vendors']);
});
test('automatic defaults change with the type but preserve a manually edited reference', async () => {
  const input = { value: '' }, controller = ns.createInvoiceNameDefault(input, () => api);
  await controller.update(context);
  assert.equal(input.value, 'TICK-MFSP123-SUP-01-1');
  await controller.update({ ...context, type: 'Proforma' });
  assert.equal(input.value, 'PROF-MFSP123-SUP-01-1');
  input.value = 'MANUAL-42';
  await controller.update({ ...context, type: 'Commission' });
  assert.equal(input.value, 'MANUAL-42');
});
test('late results cannot replace newer types, manual input or a reset form', async () => {
  const pending = [];
  const input = { value: '' }, controller = ns.createInvoiceNameDefault(input, () => ({ searchRecord: () => new Promise(resolve => pending.push(resolve)) }));
  const first = controller.update(context);
  const second = controller.update({ ...context, type: 'Proforma' });
  pending[1]({ data: [] }); await second;
  pending[0]({ data: [] }); await first;
  assert.equal(input.value, 'PROF-MFSP123-SUP-01-1');
  const third = controller.update({ ...context, type: 'Commission' });
  input.value = 'manual'; pending[2]({ data: [] }); await third;
  assert.equal(input.value, 'manual');
  controller.reset(); input.value = '';
  const fourth = controller.update(context);
  controller.reset(); pending[3]({ data: [] }); await fourth;
  assert.equal(input.value, '');
});
test('lookup failures do not suggest a potentially duplicate name', async () => {
  const input = { value: '' }, errors = [];
  const controller = ns.createInvoiceNameDefault(input, () => ({ async searchRecord() { throw new Error('CRM unavailable'); } }), error => errors.push(error.message));
  await controller.update(context);
  assert.equal(input.value, '');
  assert.deepEqual(errors, ['CRM unavailable']);
});
