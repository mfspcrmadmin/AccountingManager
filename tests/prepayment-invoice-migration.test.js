const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('_local/crm/crm_functions/migration/migratePrepaymentInvoiceAllocations', 'utf8');
// Execute the actual lookup guard with a small syntax adapter. This does not
// compile Deluge or emulate CRM; remote deployment must still be validated.
const block = source.slice(source.indexOf('\t\t\tinvoiceId ='), source.indexOf('\t\t\tamount ='))
  .replace(/\.put\(/g, '.set(').replace(/\.containKey\(/g, '.has(').replace(/\.add\(/g, '.push(');
function check(queryLookup, currentLookup, omitQuery = false, omitCurrent = false) {
  const row = new Map(omitQuery ? [] : [['Vendor_Invoice', queryLookup]]);
  const payment = new Map(omitCurrent ? [] : [['Vendor_Invoice', currentLookup]]);
  const run = new Function('row', 'payment', 'Map', 'ifnull', `
    let invoiceId, queryInvoiceId, skipped=0, scanned=0, cursor='previous', details=[];
    const sourceField='Vendor_Invoice', prepaymentId='616617000171959090', detail=new Map();
    for (const one of [1]) { ${block} }
    return {skipped,scanned,cursor,details};
  `);
  function DelugeMap() { return new Map(); }
  return run(row, payment, DelugeMap, (value, fallback) => value == null ? fallback : value);
}
test('explicitly null lookups advance the cursor without creating an association', () => {
  const result = check(null, null);
  assert.equal(result.skipped, 1);
  assert.equal(result.scanned, 1);
  assert.equal(result.cursor, '616617000171959090');
  assert.equal(result.details[0].get('status'), 'skipped_no_invoice');
});
test('an unreadable non-null lookup is not silently skipped', () => {
  assert.throws(() => check(new Map([['name','Unavailable']]), new Map()), /no readable ID/);
});
test('missing fields are distinguished from explicit null', () => {
  assert.throws(() => check(null,null,false,true), /record read did not return/);
  assert.throws(() => check(null,null,true,false), /source query did not return/);
});
test('a changed lookup still blocks the migration', () => {
  assert.throws(() => check(new Map([['id','123']]),null), /current invoice lookup is empty/);
  assert.throws(() => check(new Map([['id','123']]),new Map([['id','456']])), /differs between reads/);
});
test('matching invoice IDs proceed without skipping', () => {
  const result = check(new Map([['id','616617000172025302']]),new Map([['id','616617000172025302']]));
  assert.equal(result.skipped,0);
  assert.equal(result.details.length,0);
});
