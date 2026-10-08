const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('_local/crm/crm_functions/recalculateSupplierSettlementsForBooking', 'utf8');
const block = source.slice(source.indexOf('alhambraGroup ='), source.indexOf('for each  groupSummaryKey'));
const record = values => new Map(Object.entries(values));
const extraKey = 'booking:616617000003265040';
function run({ alhambra = true, existingCost, actualSupplierCost, pax = [10, 3] } = {}) {
  const groups = new Map();
  if (alhambra) groups.set('booking:616617000003010705', record({
    total_cost: 150, service_count: 2, first_service_date: '2026-10-06', last_service_date: '2026-10-07'
  }));
  if (actualSupplierCost !== undefined) groups.set(extraKey, record({ total_cost: actualSupplierCost, service_count: 1 }));
  const existing = new Map();
  if (existingCost !== undefined) existing.set(extraKey, record({ Total_Service_Cost: existingCost }));
  // Execute the actual Deluge exception block with its Map API adapted to JS.
  function delugeMap() { return new Map(); }
  const context = {
    bookingId: 'booking', groupDataByKey: groups, existingSettlementByTechnicalKey: existing,
    settlementTotalCostField: 'Total_Service_Cost', settlementSupplierNameField: 'Supplier_Name',
    Map: delugeMap, isnull: value => value == null, ifnull: (value, fallback) => value == null ? fallback : value
  };
  if (alhambra) {
    context.supplierId = '616617000003010705';
    context.groupData = groups.get('booking:616617000003010705');
    const calculation = source.slice(source.indexOf('// Additional Alhambra supplier cost'), source.indexOf('currentTotal ='));
    for (const value of pax) {
      context.srv = record({ Number_of_Pax: value });
      vm.runInNewContext(calculation.replace(/\.put\(/g, '.set(').replace(/\.toDecimal\(\)/g, ''), context);
    }
  }
  // Deluge round(2) is adapted to JS's numeric rounding for the test harness.
  const executable = block.replace(/\.put\(/g, '.set(').replace(/ifnull\(alhambraGroup.get\("alhambra_extra_cost"\),0.0\)\.round\(2\)/g, 'Math.round(ifnull(alhambraGroup.get("alhambra_extra_cost"),0.0) * 100) / 100');
  vm.runInNewContext(executable, context);
  vm.runInNewContext(executable, context);
  return groups;
}

test('Alhambra sums 1.27 per service PAX without duplicating or changing its own cost', () => {
  const groups = run();
  assert.equal(groups.size, 2);
  assert.equal(groups.get('booking:616617000003010705').get('total_cost'), 150);
  const extra = groups.get(extraKey);
  assert.equal(extra.get('supplier_id'), '616617000003265040');
  assert.equal(extra.get('total_cost'), 16.51);
  assert.equal(extra.get('service_count'), 2);
  assert.equal(extra.get('first_service_date'), '2026-10-06');
  assert.equal(extra.get('last_service_date'), '2026-10-07');
});

test('without active Alhambra services no additional group is created', () => {
  assert.equal(run({ alhambra: false }).size, 0);
});

test('recalculation replaces the previous cost with the current service PAX calculation', () => {
  assert.equal(run({ existingCost: 45, pax: [20, 5] }).get(extraKey).get('total_cost'), 31.75);
});

test('missing and zero PAX contribute zero', () => {
  assert.equal(run({ pax: [null, undefined, 0] }).get(extraKey).get('total_cost'), 0);
});

test('actual services for the additional supplier retain their normal settlement', () => {
  const groups = run({ actualSupplierCost: 90 });
  assert.equal(groups.size, 2);
  assert.equal(groups.get(extraKey).get('total_cost'), 90);
  assert.equal(groups.get(extraKey).get('service_count'), 1);
});
