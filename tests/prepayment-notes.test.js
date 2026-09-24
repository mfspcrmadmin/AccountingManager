const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('app/scripts/prepayment-notes.js', 'utf8'), { window });
const ns = window.AccountingManagerApp;
test('prepayment context snapshots its booking, supplier and amount', () => {
  const payment = { id: '5725767000001234567', Name: 'Deposit', Amount: 250, Currency: 'EUR', Due_Date: '2026-09-18' };
  const request = { Booking: { id: '5725767000001234568' }, Supplier: { name: 'Hotel' }, MFSP_Reference: 'MFSP123' };
  const context = ns.buildPrepaymentNoteContext(payment, request);
  assert.equal(context.prepaymentId, payment.id);
  assert.equal(context.bookingId, request.Booking.id);
  assert.equal(context.amount, 250);
  assert.equal(context.supplier, 'Hotel');
  assert.equal(context.reference, 'MFSP123');
  assert.throws(() => ns.buildPrepaymentNoteContext(payment, {}), /no accessible booking/);
});
test('current user accepts CRM response shapes and refuses unknown authors', () => {
  for (const response of [{ users: [{ id: '123', full_name: 'Admin' }] }, { data: [{ id: '123', name: 'Admin' }] }, { id: '123', fullName: 'Admin' }]) {
    assert.equal(ns.accountingNotesUser(response).name, 'Admin');
  }
  assert.throws(() => ns.accountingNotesUser({}), /identify/);
  assert.throws(() => ns.accountingNotesUser({ id: '123' }), /name/);
});
test('accounting adapter saves only the booking field and does not trigger workflows', async () => {
  let sent;
  const c = { window: { ZOHO: { CRM: { API: { updateRecord: async args => { sent = args; return { data: [{ code: 'SUCCESS' }] }; } } } } } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('app/scripts/accounting-notes/api.js', 'utf8').replace(/^export /gm, ''), c);
  assert.equal((await c.crmUpdateRecord('Deals', { id: '123', Accounting_Notes: 'notes' })).code, 'SUCCESS');
  assert.equal(sent.Entity, 'Deals');
  assert.equal(sent.APIData.Accounting_Notes, 'notes');
  assert.equal(sent.Trigger.length, 0);
});
