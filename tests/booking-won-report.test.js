const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const name of ['booking-won-report', 'excel-workbook']) vm.runInNewContext(fs.readFileSync('app/scripts/' + name + '.js', 'utf8'), { window, TextEncoder, Blob });
const ns = window.AccountingManagerApp;
const date = '2026-10-06';
const row = { Ezus_Project_ID: 'project-1', id: '616617000003010705', Booking_Won_Date: date, Deal_Name: '=Example', Stage: 'Trip Accounting Closure', Travellers_Number: 4 };
test('ID-only COQL lookups resolve through CRM records for both exports', async () => {
  const record = { ...row, Account_Name: { id: '9' }, Sales_Rep: { id: '10' }, Reservation_Rep: { id: '11' }, Contact_Name: { id: '12' } };
  const report = await ns.loadBookingWonReport({ coql: async () => [record], getRecord: async module => module === 'Deals'
    ? { id: row.id, Sales_Rep: { full_name: 'Sales Person' }, Reservation_Rep: { name: 'OPS Person' }, Contact_Name: { name: 'Agent Name' } }
    : { id: '9', Account_Name: 'Agency Name', Parent_Account: { name: 'Parent' } }
  }, date);
  const sales = ns.bookingWonReportSheets(report, 'sales')[0].rows[0];
  const invoices = ns.bookingWonReportSheets(report, 'invoices')[0].rows[0];
  assert.equal(sales[2], 'Agency Name'); assert.equal(sales[5], 'Sales Person');
  assert.equal(invoices[8], 'OPS Person'); assert.equal(invoices[9], 'Sales Person');
  assert.equal(invoices[18], 'Agency Name'); assert.equal(invoices[19], 'Parent'); assert.equal(invoices[20], 'Agent Name');
  await assert.rejects(ns.loadBookingWonReport({ coql: async () => [{ ...row, Sales_Rep: { id: '10' } }], getRecord: async () => ({ id: row.id, Sales_Rep: { id: '10' } }) }, date), /Could not read Sales_Rep/);
});
test('stage selection and nonempty Ezus project apply before agency loading', async () => {
  const records = [
    { ...row, id: '1', Stage: 'Pending Res Assignment' },
    { ...row, id: '2' },
    ...[null, '', '   ', undefined].map((value, i) => ({ ...row, id: String(i + 3), Ezus_Project_ID: value }))
  ];
  const crm = { coql: async query => { assert.match(query, /Ezus_Project_ID is not null/); return records; } };
  assert.equal((await ns.loadBookingWonReport(crm, date)).records.length, 2);
  const report = await ns.loadBookingWonReport(crm, date, ['Trip Accounting Closure']);
  assert.equal(report.records.length, 1);
  assert.equal(report.records[0].id, '2');
  await assert.rejects(ns.loadBookingWonReport(crm, date, []), /Select at least one/);
});
test('filtered-out full pages still advance the cursor', async () => {
  let calls = 0;
  const report = await ns.loadBookingWonReport({ coql: async query => {
    if (!calls++) return Array.from({ length: 200 }, (_, i) => ({ ...row, id: String(i + 1), Ezus_Project_ID: ' ' }));
    assert.match(query, /id > 200/);
    return [{ ...row, id: '201' }];
  } }, date, ['Trip Accounting Closure']);
  assert.equal(report.records.length, 1);
});
test('accounting templates preserve column positions, formulas and intentionally blank invoice columns', async () => {
  const booking = { ...row, Account_Name: { id: '9', name: 'Agency' }, Sales_Rep: { id: '10', name: 'Sales person' }, Reservation_Rep: { id: '11', name: 'Operations person' }, Contact_Name: { id: '12', name: 'Agent' }, Parent_Agency: { id: '99', name: 'Wrong parent' }, Trip_Type: 'Small FIT', Sales_Price_inc_Taxes: 5130, Purchase_Price_inc_Taxes: 3863.96, Final_Commission: 564, Arrival_Date: '2026-12-30', Departure_Date: '2027-01-02', IATA_Code: '001234', Consortia: 'Virtuoso' };
  const report = { date, records: [booking], agencies: { '9': { Agent_Code: '00042', Billing_Code: '00120', Parent_Account: { id: '13', name: 'Agency parent' } } } };
  const sales = ns.bookingWonReportSheets(report, 'sales')[0];
  const invoices = ns.bookingWonReportSheets(report, 'invoices')[0];
  assert.equal(sales.preamble.length, 3);
  assert.equal(sales.rows[0].length, 20);
  assert.equal(sales.rows[0][1], '00042');
  assert.equal(sales.rows[0][2], 'Agency');
  assert.equal(sales.rows[0][5], 'Sales person');
  assert.equal(invoices.rows[0][8], 'Operations person');
  assert.equal(invoices.rows[0][9], 'Sales person');
  assert.equal(invoices.rows[0][18], 'Agency');
  assert.equal(invoices.rows[0][19], 'Agency parent');
  assert.equal(invoices.rows[0][20], 'Agent');
  assert.equal(ns.bookingWonReportSheets({ ...report, agencies: {} }, 'invoices')[0].rows[0][19], '');
  assert.equal(sales.rows[0][9].value, 'enero');
  assert.match(sales.rows[0][9].formula, /I5/);
  assert.ok(Math.abs(sales.rows[0][13].value - 1046.3140495867769) < 1e-9);
  assert.match(sales.rows[0][19].formula, /N5\/\(P5-S5\)/);
  assert.equal(invoices.preamble.length, 2);
  assert.equal(invoices.headers.length, 47);
  assert.equal(invoices.rows[0].length, 47);
  assert.equal(invoices.rows[0][4], 'x');
  assert.equal(invoices.rows[0][10], '');
  assert.equal(invoices.rows[0][22], '001234');
  assert.equal(invoices.rows[0][26], '00120');
  assert.ok(invoices.rows[0].slice(35).every(value => value === ''));
  assert.match(invoices.rows[0][14].formula, /Q4-47/);
  assert.match(invoices.rows[0][34].formula, /\(AE4-AH4\)\/1.21/);
  const xml = await ns.createExcelWorkbook([invoices]).text();
  assert.match(xml, /autoFilter ref="A3:AU4"/);
  assert.match(xml, /ySplit="3" topLeftCell="A4"/);
  assert.match(xml, /<f>IF\(Q4=/);
  assert.match(xml, /r="L4" s="1"/);
});
test('agency details load once per agency and a missing agency prevents incomplete export', async () => {
  const booking = { ...row, Account_Name: { id: '9' } };
  let calls = 0;
  const report = await ns.loadBookingWonReport({ coql: async () => [{ ...booking, id: '1' }, { ...booking, id: '2' }], getRecord: async () => { calls++; return { id: '9', Agent_Code: '001' }; } }, date);
  assert.equal(calls, 1);
  assert.equal(report.agencies['9'].Agent_Code, '001');
  await assert.rejects(ns.loadBookingWonReport({ coql: async () => [booking], getRecord: async () => null }, date), /agency/);
});
test('report selects the won day independently of current stage and preserves IDs as text', async () => {
  const report = await ns.loadBookingWonReport({ coql: async (query, options) => {
    assert.match(query, /Booking_Won_Date = '2026-10-06'/);
    assert.doesNotMatch(query, /Stage\s*=/);
    assert.equal(options.strict, true);
    return [row];
  } }, date);
  const sheets = ns.bookingWonReportSheets(report);
  assert.equal(sheets[0].rows[0][4], 4);
  assert.equal(sheets[0].headers.length, 20);
  const data = await ns.createExcelWorkbook(sheets).text();
  assert.match(data, /t="inlineStr"><is><t xml:space="preserve">=Example/);
});
test('keyset pagination includes more than 200 bookings', async () => {
  let calls = 0;
  const report = await ns.loadBookingWonReport({ coql: async query => {
    calls++;
    if (calls === 1) return Array.from({ length: 200 }, (_, i) => ({ ...row, id: String(i + 1) }));
    assert.match(query, /id > 200/);
    return [{ ...row, id: '201' }];
  } }, date);
  assert.equal(report.records.length, 201);
});
test('invalid dates, inconsistent pages and CRM errors never produce a partial report', async () => {
  await assert.rejects(ns.loadBookingWonReport({}, '2026-02-30'), /valid/);
  await assert.rejects(ns.loadBookingWonReport({}, "2026-10-06'"), /valid/);
  await assert.rejects(ns.loadBookingWonReport({ coql: async () => [row, row] }, date), /inconsistent/);
  await assert.rejects(ns.loadBookingWonReport({ coql: async () => [{ ...row, Booking_Won_Date: null }] }, date), /inconsistent/);
  let calls = 0;
  await assert.rejects(ns.loadBookingWonReport({ coql: async () => {
    if (calls++) throw Error('CRM unavailable');
    return Array.from({ length: 200 }, (_, i) => ({ ...row, id: String(i + 1) }));
  } }, date), /CRM unavailable/);
  assert.equal((await ns.loadBookingWonReport({ coql: async () => [] }, date)).records.length, 0);
});

const source = fs.readFileSync('_local/crm/crm_functions/bp_orchestrateBookingTransition', 'utf8');
const block = source.slice(source.indexOf('// Record the first Booking Won day'), source.indexOf('if(transitionCode.equals("booking_won"))'));
class DMap extends Map { put(k, v) { this.set(k, v); } }
function stamp(transitionCode, existing, failure = false, referenceType = 'booking_id') {
  const writes = [], res = new DMap();
  const context = { transitionCode, referenceType, bookingReference: '123', booking: new DMap([['id', '123'], ['Booking_Won_Date', existing]]), res,
    Map: () => new DMap(), List: () => [], ifnull: (x, y) => x == null ? y : x, isnull: x => x == null,
    zoho: { currenttime: { toString: (format, zone) => { assert.equal(zone, 'Europe/Madrid'); return date; } }, crm: {
      updateRecord: (module, id, payload) => { writes.push(payload); return new DMap(failure ? [['code', 'INVALID_DATA']] : [['id', id]]); }
    } }
  };
  vm.runInNewContext('(function () {' + block.replace(/(\w+)\.equals\(([^)]*)\)/g, '($1 === $2)').replace(/\.toLong\(\)/g, '') + '})()', context);
  return { writes, res };
}
test('both won transition paths stamp once, preserve existing dates and ignore other transitions', () => {
  for (const code of ['booking_won', 'auto_assign_booking_won']) {
    assert.equal(stamp(code, null).writes[0].get('Booking_Won_Date'), date);
    assert.equal(stamp(code, '2026-09-30').writes.length, 0);
    assert.equal(stamp(code, null, true).res.get('error'), true);
    assert.equal(stamp(code, null, false, 'ezus_project_ref').writes.length, 0);
  }
  assert.equal(stamp('have_departed', null).writes.length, 0);
});
