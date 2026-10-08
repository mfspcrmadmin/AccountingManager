const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('_local/crm/crm_functions/upsertAgentCommissionSettlement', 'utf8');
// Exercise the vendor reuse branch from Deluge, adapting its loop and map syntax.
const branch = source.slice(source.indexOf('\t\tvendorId = "";'), source.indexOf('\n\t\tif(vendorId == "")'))
  .replace('for each vendorMatch in vendorMatches', 'for (const vendorMatch of vendorMatches)')
  .replace(/\.trim\(\)\.equalsIgnoreCase\(agencyCode\)/g, '.trim().toLowerCase() == agencyCode.toLowerCase()');
function map(data = {}) {
  return {
    get: key => data[key], put: (key, value) => { data[key] = value; },
    containKey: key => Object.hasOwn(data, key), size: () => Object.keys(data).length,
    toString: () => JSON.stringify(data), data
  };
}
function run(type, agency = 'agency-1', response = { id: 'vendor-1' }, reference = 'church') {
  const updates = [];
  const context = {
    vendorMatches: [map({ id: 'vendor-1', TP_Reference: reference, Vendor_Type: type, Agency: agency ? map({ id: agency }) : null })],
    agencyCode: 'CHURCH', agencyId: 'agency-1', res: map(), Map: map,
    ifnull: (value, fallback) => value == null ? fallback : value,
    zoho: { crm: { updateRecord(module, id, payload) {
      updates.push({ module, id, data: payload.data });
      return response == null ? null : map(response);
    } } }
  };
  vm.runInNewContext('(function () {' + branch + '\n})();', context);
  return { vendorId: context.vendorId, result: context.res.data, updates };
}

test('empty vendor types are filled and the existing vendor is reused', () => {
  for (const type of [null, '', '  ', '-None-']) {
    const actual = run(type);
    assert.equal(actual.vendorId, 'vendor-1');
    assert.deepEqual(actual.updates, [{ module: 'Vendors', id: 'vendor-1', data: { Vendor_Type: 'Agency' } }]);
  }
});

test('a missing agency link is filled when repairing the vendor', () => {
  const actual = run(null, null);
  assert.equal(actual.vendorId, 'vendor-1');
  assert.deepEqual(actual.updates[0].data, { Vendor_Type: 'Agency', Agency: 'agency-1' });
});

test('a correctly configured agency vendor is reused without updates', () => {
  const actual = run('Agency');
  assert.equal(actual.vendorId, 'vendor-1');
  assert.equal(actual.updates.length, 0);
});

test('another agency or a nonempty different type is not overwritten', () => {
  for (const actual of [run(null, 'agency-2'), run('Supplier'), run('Agent')]) {
    assert.equal(actual.result.error, true);
    assert.equal(actual.vendorId, '');
    assert.equal(actual.updates.length, 0);
  }
});

test('a failed update stops reuse and exposes the CRM failure', () => {
  for (const response of [null, { code: 'INVALID_DATA', message: 'invalid data' }]) {
    const actual = run(null, 'agency-1', response);
    assert.equal(actual.result.error, true);
    assert.equal(actual.vendorId, '');
    assert.match(actual.result.message, /could not be updated/);
  }
});

test('a nonmatching reference is not reused or changed', () => {
  const actual = run(null, null, undefined, 'CHURCH-OTHER');
  assert.equal(actual.vendorId, '');
  assert.equal(actual.updates.length, 0);
});
