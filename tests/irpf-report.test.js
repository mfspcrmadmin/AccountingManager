const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const file of ['irpf-report', 'excel-workbook', 'helpers', 'crm']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + file + '.js', 'utf8'), { window, TextEncoder, Blob, console });
}
const ns = window.AccountingManagerApp;
const options = { from: '2026-07-01', to: '2026-09-30', countryField: 'Country' };
const supplier = { id: '10', Vendor_Name: 'Guide & Co', CIF_NIF: '00123456A', Country: 'Spain', Is_Self_Employed: true };
const invoice = { id: '1', Name: '=001/26', Supplier: { id: '10', name: 'Guide' }, Booking: { id: '20', name: 'Trip' }, Invoice_Date: '2026-07-01', Invoice_Type: 'Final Invoice', Status: 'Paid', Currency: 'EUR', Invoice_Amount_Excl_VAT: 100, Invoice_Amount_Incl_VAT: 121, IRPF_Amount: 15 };
function build(rows, vendor = supplier) { return ns.buildIrpfReport(rows, { '10': vendor }, options); }
test('inclusive dates, current Country and recorded IRPF select all statuses of valid invoices', () => {
  const report = build([invoice, { ...invoice, id: '2', Invoice_Date: '2026-09-30', Status: 'Received' }, { ...invoice, id: '3', Invoice_Date: '2026-10-01' }, { ...invoice, id: '4', IRPF_Amount: 0 }]);
  assert.equal(report.detail.length, 2);
  assert.equal(report.summary[0][5], 30);
  assert.equal(report.detail[0][4], '=001/26');
  assert.equal(build([invoice], { ...supplier, Country: 'France', Destination: 'Spain' }).detail.length, 0);
  assert.equal(build([invoice], { ...supplier, Country: 'España' }).detail.length, 1);
});
test('additional bases and withholding, including additional-only IRPF, are counted once', () => {
  const report = build([{ ...invoice, IRPF_Amount: 0, Additional_IRPF_Amount: 7.5, Additional_Amount_Excl_VAT: 50, Additional_Amount_Incl_VAT: 60.5 }]);
  assert.equal(report.detail[0][5], 150);
  assert.equal(report.detail[0][6], 181.5);
  assert.equal(report.summary[0][5], 7.5);
});
test('credit notes subtract with positive or negative stored amounts; duplicates do not double totals', () => {
  const report = build([invoice, invoice, { ...invoice, id: '2', Invoice_Type: 'Credit Note', IRPF_Amount: 3 }, { ...invoice, id: '3', Invoice_Type: 'Credit Note', IRPF_Amount: -2 }]);
  assert.equal(report.summary[0][2], 3);
  assert.equal(report.summary[0][5], 10);
});
test('incomplete suppliers, proformas and cancelled invoices are visible in review, outside totals', () => {
  for (const vendor of [{ ...supplier, CIF_NIF: '' }, { ...supplier, Country: '' }, { ...supplier, Is_Self_Employed: false }, {}]) {
    const report = build([invoice], vendor); assert.equal(report.detail.length, 0); assert.equal(report.review.length, 1);
  }
  for (const change of [{ Status: 'Cancelled' }, { Status: 'Rejected' }, { Invoice_Type: 'Proforma' }, { Currency: null }]) {
    const report = build([{ ...invoice, ...change }]); assert.equal(report.summary.length, 0); assert.equal(report.review.length, 1);
  }
});
test('summary groups by supplier ID and currency and uses integer cents', () => {
  const report = build([ { ...invoice, IRPF_Amount: 0.1 }, { ...invoice, id: '2', IRPF_Amount: 0.2 }, { ...invoice, id: '3', Currency: 'USD' } ]);
  assert.equal(report.summary.length, 2); assert.equal(report.summary[0][5], 0.3); assert.equal(report.supplierCount, 1);
});
test('invalid dates and amounts stop report generation', async () => {
  for (const change of [{ from: '2026-02-30' }, { from: '2026-10-01' }, { countryField: 'Destination' }]) {
    await assert.rejects(ns.loadIrpfReport({}, { ...options, ...change }));
  }
  assert.throws(() => build([{ ...invoice, IRPF_Amount: 'bad' }]));
});
test('keyset pagination loads beyond the first 200 records and reads each supplier once', async () => {
  const calls = []; let reads = 0;
  const report = await ns.loadIrpfReport({
    coql: async (query, mode) => { calls.push(query); assert.equal(mode.strict, true); return calls.length === 1 ? Array.from({ length: 200 }, (_, n) => ({ ...invoice, id: String(n + 1) })) : [{ ...invoice, id: '201' }]; },
    getRecord: async () => { reads++; return supplier; }
  }, options);
  assert.equal(report.detail.length, 201); assert.equal(reads, 1); assert.match(calls[1], /id > 200/); assert.equal(report.summary[0][5], 3015);
});
test('repeated pages and supplier failures cannot produce a partial report', async () => {
  await assert.rejects(ns.loadIrpfReport({ coql: async () => Array.from({ length: 200 }, (_, n) => ({ ...invoice, id: String(n + 1) })) }, options), /pagination/);
  await assert.rejects(ns.loadIrpfReport({ coql: async () => [invoice], getRecord: async () => null }, options), /No partial report/);
});
test('strict CRM reads reject API error payloads and accept no content', async () => {
  const client = response => ns.createCrmClient({ CRM: { API: { coql: async () => response } } }, ns.helpers);
  await assert.rejects(client({ code: 'INVALID_QUERY', message: 'Bad query' }).coql('query', { strict: true }), /Bad query/);
  assert.equal((await client({ status: 204 }).coql('query', { strict: true })).length, 0);
});
test('xlsx contains numeric amounts, literal invoice numbers, preserved NIF and separate review/criteria sheets', async () => {
  const blob = ns.createExcelWorkbook(ns.irpfReportSheets(build([invoice])));
  const buffer = Buffer.from(await blob.arrayBuffer()); let offset = 0; const files = {};
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString(); const start = offset + 30 + nameLength + extra;
    files[name] = buffer.subarray(start, start + size).toString(); offset = start + size;
  }
  assert.match(files['xl/workbook.xml'], /Supplier summary/); assert.match(files['xl/workbook.xml'], /Review/); assert.match(files['xl/workbook.xml'], /Criteria/);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /00123456A/); assert.match(sheet, /=001\/26/); assert.match(sheet, /Guide &amp; Co/); assert.match(sheet, /<v>15<\/v>/); assert.doesNotMatch(sheet, /<f[ >]/);
});
