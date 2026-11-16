const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const name of ['config', 'helpers', 'supplier-activity']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + name + '.js', 'utf8'), { window });
}
const ns = window.AccountingManagerApp;

function setup(options = {}) {
  const state = ns.createInitialState();
  state.records.payments = [{ id: 'p1' }];
  state.records.payAllocations = [{ Supplier_Payment: { id: 'p1' }, Supplier: { id: 's1', name: 'Supplier' }, Allocated_Amount: 10 }];
  Object.assign(state.paymentLetter, { paymentId: 'p1', isOpen: true, selectedSupplierIds: { s1: true }, manualEmailBySupplierId: { s1: 'supplier@example.com' } });
  const elements = new Proxy({}, { get(target, key) { return target[key] ||= { closest() { return null; } }; } });
  const calls = [], popups = [], downloads = [];
  const mod = ns.createSupplierActivityModule({
    state, elements, helpers: ns.helpers, MODULES: ns.MODULES,
    FIELD_CANDIDATES: ns.FIELD_CANDIDATES,
    sanitizeDownloadFileName: value => value,
    downloadFileFromText: (name, type, text) => downloads.push({ name, type, text }),
    SEND_SUPPLIER_PAYMENT_LETTER_FUNCTION: 'sendsupplierpaymentletter',
    PAYMENT_LETTER_DEFAULT_RECIPIENT: '',
    getCurrentUserEmail: options.getEmail || (async () => '  ALBA@madeforspainandportugal.com '),
    hasValidEmailAddress: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    crm: { getRecord: options.getRecord, async executeFunction(name, args) { calls.push({ name, args }); return options.result || { success: true }; } },
    getPaymentLetterFunctionResult: value => value,
    renderer: { showError() {}, showNotice() {}, refreshActionState() {}, showErrorPopup(message) { popups.push(message); } },
    renderAll() {}, debugError() {}
  });
  return { mod, state, calls, popups, downloads };
}

function download(ctx) {
  const button = { getAttribute: name => name === 'data-payment-letter-download-pdf' ? 's1' : null };
  return ctx.mod.onSelectedPaymentLetterEmailEditClick({ target: { closest: () => button }, preventDefault() {}, stopPropagation() {} });
}

test('PDF resolves invoice IDs, wraps complete names and emits euro glyphs on every amount', async () => {
  const name = 'INVOICE-2026-VERY-LONG-REFERENCE-WITHOUT-ELLIPSIS-123456789';
  let reads = 0;
  const ctx = setup({ getRecord: async (module, id) => {
    assert.equal(module, 'Supplier_Invoices'); assert.equal(id, 'i1'); reads++;
    return { id, Name: name };
  }});
  ctx.state.records.payAllocations = Array.from({length: 50}, (_, index) => ({
    Name: 'WRONG-PAYMENT-NAME', Supplier_Payment: { id: 'p1' }, Supplier: { id: 's1', name: 'Supplier' },
    Supplier_Invoice: { id: 'i1', name: null }, Allocated_Amount: index ? 123.45 : 30,
    Movement_Type: index ? 'Outbound Payment' : 'Supplier Refund', Invoice_Date: '2026-10-14'
  }));
  await download(ctx);
  assert.equal(reads, 1);
  assert.equal(ctx.downloads.length, 1);
  const pdf = ctx.downloads[0].text;
  assert.doesNotMatch(pdf, /WRONG-PAYMENT-NAME|\.\.\./);
  assert.match(pdf, /WinAnsiEncoding/);
  assert.equal((pdf.match(/\\200/g) || []).length, 50 + Number(pdf.match(/\/Count (\d+)/)[1]));
  const invoiceLines = [...pdf.matchAll(/58 [\d.]+ Td \(([^)]*)\) Tj/g)].map(match => match[1]).filter(line => name.includes(line));
  assert.equal(invoiceLines.join(''), name.repeat(50));
  fs.mkdirSync('_local/previews', { recursive: true });
  fs.writeFileSync('_local/previews/payment-letter-corrected.pdf', pdf);
});

test('lookup names need no query and failed invoice reads prevent an incorrect PDF', async () => {
  const ctx = setup({getRecord: async () => { throw new Error('CRM unavailable'); }});
  ctx.state.records.payAllocations[0].Supplier_Invoice = {id: 'i1', name: 'REAL-INVOICE'};
  await download(ctx);
  assert.match(ctx.downloads[0].text, /REAL-INVOICE/);
  ctx.state.records.payAllocations[0].Supplier_Invoice = {id: 'i2'};
  await download(ctx);
  assert.equal(ctx.downloads.length, 1);
});
