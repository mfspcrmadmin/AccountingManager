const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Accounting Manager calls the deployed function using the CRM SDK and keeps normalized author data', async () => {
  const normalized = JSON.stringify({ version: 1, notes: [{ id: 'note', author: 'Admin', authorId: '123', authorEmail: 'admin@example.com' }] });
  let call;
  const window = { ZOHO: { CRM: { FUNCTIONS: { execute: async (name, input) => {
    call = { name, args: JSON.parse(input.arguments) };
    return { details: { output: JSON.stringify({ success: true, saved: true, notesJson: normalized, notificationStatus: 'sent' }) } };
  } } } } };
  const context = vm.createContext({ window });
  vm.runInContext(fs.readFileSync('app/scripts/accounting-notes/api.js', 'utf8').replace(/^export /gm, ''), context);
  vm.runInContext(fs.readFileSync('app/scripts/accounting-notes-save.js', 'utf8'), context);
  const result = await window.AccountingNotesSave.save({ executeFunction: context.crmExecuteFunction, bookingId: '456', currentUserId: '123', notes: 'incoming', expectedNotes: 'previous' });
  assert.equal(call.name, 'accountingnotes_saveandnotify');
  assert.equal(call.args.actingUserId, '123');
  assert.equal(call.args.expectedNotes, 'previous');
  assert.equal(result.notesJson, normalized);
  assert.equal(result.notificationWarning, '');
});

test('Accounting Manager loads the notification client before opening notes', () => {
  const html = fs.readFileSync('app/widget.html', 'utf8');
  assert.ok(html.indexOf('./scripts/accounting-notes-save.js') >= 0);
  assert.ok(html.indexOf('./scripts/accounting-notes-save.js') < html.indexOf('./scripts/prepayment-notes.js'));
});
