const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app/scripts/ministry-traveller-register.js', 'utf8');
const ctx = {};
vm.runInNewContext(source.slice(source.indexOf('  function date(value)'), source.indexOf('  function displayDate(')) + source.slice(source.indexOf('  function dateCriteria('), source.indexOf('  async function loadServices(')), ctx);
function filter(field, mode, from = '', to = '') { return { field, label: field, mode: {value: mode}, from: {value: from}, to: {value: to} }; }
test('October 9 check-in does not restrict October 12 check-out', () => {
  const query = ctx.dateCriteria([filter('Hotel_Check_In', 'single', '2026-10-09'), filter('Hotel_Check_Out', 'single')]);
  assert.equal(query, "Hotel_Check_In = '2026-10-09'");
});
test('check-out alone and independent inclusive ranges', () => {
  assert.equal(ctx.dateCriteria([filter('Hotel_Check_In','single'), filter('Hotel_Check_Out','single','2026-10-12')]), "Hotel_Check_Out = '2026-10-12'");
  assert.equal(ctx.dateCriteria([filter('Hotel_Check_In','range','2026-10-09','2026-10-10'), filter('Hotel_Check_Out','range','2026-10-12','2026-10-15')]), "(((Hotel_Check_In >= '2026-10-09' and Hotel_Check_In <= '2026-10-10') and Hotel_Check_Out >= '2026-10-12') and Hotel_Check_Out <= '2026-10-15')");
});
test('single mode ignores hidden range end; ranges allow one bound', () => {
  assert.equal(ctx.dateCriteria([filter('Hotel_Check_In','single','2026-10-09','2026-10-01')]), "Hotel_Check_In = '2026-10-09'");
  assert.equal(ctx.dateCriteria([filter('Hotel_Check_Out','range','','2026-10-12')]), "Hotel_Check_Out <= '2026-10-12'");
});
test('empty and reversed filters are rejected', () => {
  assert.throws(() => ctx.dateCriteria([filter('Hotel_Check_In','single')]), /at least one/);
  assert.throws(() => ctx.dateCriteria([filter('Hotel_Check_Out','range','2026-10-12','2026-10-09')]), /range start/);
});

test('Any check-out ignores previously entered dates', () => {
  assert.equal(ctx.dateCriteria([filter('Hotel_Check_In','single','2026-10-09'), filter('Hotel_Check_Out','any','2026-10-12','2026-10-01')]), "Hotel_Check_In = '2026-10-09'");
  assert.throws(() => ctx.dateCriteria([filter('Hotel_Check_In','single'), filter('Hotel_Check_Out','any','2026-10-12')]), /at least one/);
});
