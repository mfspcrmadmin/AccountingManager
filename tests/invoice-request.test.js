const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = { btoa: value => Buffer.from(value, 'binary').toString('base64') };
for (const file of ['config.js', 'helpers.js', 'invoice-request.js']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + file, 'utf8'), { window, TextEncoder });
}
const ns = window.AccountingManagerApp;
const settlement = { id: '123', Name: 'SET-1', Supplier: { id: '456' } };
const booking = { MFSP_Reference: 'MFSP150857E', Account_Name: { name: 'Cohen' } };
function setup(overrides = {}) {
  const calls = [];
  const crm = {
    async getRecord(module, id) { calls.push(['record', module, id]); return { id, Vendor_Name: 'Corral de la Morería' }; },
    async searchRecordPage(module, criteria, page) {
      calls.push(['search', module, criteria, page]);
      return [{ Service_Date: '2026-10-06', Product_Description: 'Cena', Guests: 'Cohen' }];
    },
    async executeFunction(name, args) { calls.push(['send', name, args]); return { success: true, error: false }; },
    async updateRecord(module, id, fields) { calls.push(['update', module, id, fields]); return { data: [{ code: 'SUCCESS' }] }; },
    ...overrides.crm
  };
  const instance = ns.createInvoiceRequestModule({
    MODULES: ns.MODULES, helpers: ns.helpers, crm,
    hasValidEmailAddress: value => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value),
    getFunctionOutputObject: response => response,
    resolveRecipient: async supplier => { calls.push(['recipient', supplier.id]); return { email: 'accounts@example.com', message: 'AC - Accounts contact from CRM' }; },
    ...overrides.deps
  });
  return { instance, calls };
}

test('draft uses the supplier contact resolver and only services belonging to the settlement; opening does not send', async () => {
  const { instance, calls } = setup();
  const draft = await instance.loadDraft(settlement, booking);
  assert.equal(draft.recipient.email, 'accounts@example.com');
  assert.ok(calls.some(c => c[0] === 'recipient' && c[1] === '456'));
  assert.ok(calls.some(c => c[1] === 'Booking_Services' && c[2] === '(Supplier_Settlement:equals:123)'));
  assert.ok(!calls.some(c => c[0] === 'send'));
  for (const text of ['Corral de la Morería', 'MFSP150857E', 'Cohen', '06/10/2026', 'Cena', 'A82318908', 'Calle Castelló']) {
    assert.ok(draft.html.includes(text), text);
  }
});

test('all service pages are included and dates sorted', async () => {
  const { instance } = setup({ crm: { async searchRecordPage(module, criteria, page) {
    return page === 1 ? Array.from({ length: 200 }, () => ({ Service_Date: '2026-10-07', Product_Description: 'Later' })) : [{ Service_Date: '2026-10-06', Product_Description: 'Earlier' }];
  } } });
  const draft = await instance.loadDraft(settlement, booking);
  assert.ok(draft.html.indexOf('Earlier') < draft.html.indexOf('Later'));
  assert.equal((draft.html.match(/Later/g) || []).length, 200);
});

test('CRM values are escaped in the email template', () => {
  const { instance } = setup();
  const html = instance.buildMessage({ Vendor_Name: '<img src=x onerror=alert(1)>' }, { Account_Name: { name: '<script>bad()</script>' } }, [{ Product_Description: '<b>service</b>' }]);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;b&gt;service&lt;/b&gt;'));
});

test('missing default contact still allows a draft; no supplier prevents one', async () => {
  const { instance } = setup({ deps: { resolveRecipient: async () => { throw new Error('offline'); } } });
  const draft = await instance.loadDraft(settlement, booking);
  assert.equal(draft.recipient.email, '');
  await assert.rejects(instance.loadDraft({ id: '123' }, booking), /no associated supplier/);
});

test('service loading failures are not replaced with incomplete data', async () => {
  const { instance } = setup({ crm: { searchRecordPage: async () => { throw new Error('service read failed'); } } });
  await assert.rejects(instance.loadDraft(settlement, booking), /service read failed/);
});

test('send uses the edited recipient, subject and HTML and requires explicit CRM success', async () => {
  const { instance, calls } = setup();
  await instance.sendDraft('123', 'alternate@example.com', 'Asunto editado', '<p>Mensaje editado</p>');
  const send = calls.find(c => c[0] === 'send');
  assert.equal(send[1], 'sendsupplierinvoicerequest');
  assert.equal(send[2].recipientEmail, 'alternate@example.com');
  assert.equal(send[2].emailSubject, 'Asunto editado');
  assert.equal(send[2].emailBody, '<p>Mensaje editado</p>');
  const update = calls.find(c => c[0] === 'update');
  assert.equal(update[1], 'Supplier_Settlements');
  assert.equal(update[2], '123');
  assert.equal(update[3].Closure_Review_Status, 'Invoice Requested');
  assert.ok(calls.indexOf(update) > calls.indexOf(send));
  for (const response of [{}, { success: false, message: 'Mail rejected' }, { success: true, error: true }]) {
    const failed = setup({ crm: { executeFunction: async () => response } });
    await assert.rejects(failed.instance.sendDraft('123', 'a@example.com', 'Subject', '<p>Body</p>'));
    assert.ok(!failed.calls.some(c => c[0] === 'update'));
  }
});

test('status update failures preserve email success and do not update the local row or resend', async () => {
  for (const fail of [async () => ({ data: [{ code: 'INVALID_DATA', message: 'Invalid status' }] }), async () => { throw new Error('Network error'); }]) {
    let rowUpdated = false;
    const { instance, calls } = setup({ crm: { updateRecord: fail }, deps: { onInvoiceRequested: () => { rowUpdated = true; } } });
    const result = await instance.sendDraft('123', 'a@example.com', 'Subject', '<p>Body</p>');
    assert.equal(result.success, true);
    assert.match(result.statusUpdateError, /email was sent/);
    assert.equal(rowUpdated, false);
    assert.equal(calls.filter(c => c[0] === 'send').length, 1);
  }
});

test('successful status update refreshes the matching settlement in the UI', async () => {
  let updatedId;
  const { instance } = setup({ deps: { onInvoiceRequested: id => { updatedId = id; } } });
  const result = await instance.sendDraft('123', 'a@example.com', 'Subject', '<p>Body</p>');
  assert.equal(updatedId, '123');
  assert.equal(result.statusUpdateError, undefined);
});

test('invalid recipients and header injection never invoke the send function', async () => {
  const { instance, calls } = setup();
  await assert.rejects(instance.sendDraft('123', '', 'Subject', '<p>Body</p>'));
  await assert.rejects(instance.sendDraft('123', 'a@example.com\r\nBcc: b@example.com', 'Subject', '<p>Body</p>'));
  await assert.rejects(instance.sendDraft('123', 'a@example.com', 'Subject\r\nBcc: b@example.com', '<p>Body</p>'));
  assert.equal(calls.length, 0);
});

test('download retains UTF-8 HTML and creates an unsent MIME draft', () => {
  const { instance } = setup();
  const eml = instance.buildEml('a@example.com', 'Solicitud de factura · Morería', '<p>Buen día, Castelló</p>');
  assert.match(eml, /X-Unsent: 1/);
  assert.match(eml, /Content-Type: text\/html; charset=UTF-8/);
  const html = Buffer.from(eml.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.ok(html.includes('<p>Buen día, Castelló</p>'));
});
