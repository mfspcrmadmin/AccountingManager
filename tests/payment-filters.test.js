const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const file of ['config.js', 'helpers.js', 'payments.js']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + file, 'utf8'), { window });
}
const ns = window.AccountingManagerApp;
const main = fs.readFileSync('app/scripts/main.js', 'utf8');
function functionSource(name) {
  const start = main.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  const tail = main.slice(start + 2);
  const end = tail.search(/\r?\n  (?:async )?function /);
  return end < 0 ? tail : tail.slice(0, end);
}

test('Today uses the local calendar day for both date boundaries', () => {
  const context = { Date };
  vm.createContext(context);
  for (const name of ['getLocalIsoDate', 'formatDateToIsoLocal', 'getDateRangeForPreset']) vm.runInContext(functionSource(name), context);
  const range = context.getDateRangeForPreset('today');
  assert.equal(range.dateFrom, context.getLocalIsoDate());
  assert.equal(range.dateTo, range.dateFrom);
});

test('status options match each workspace tab independently of loaded records', () => {
  for (const [workspace, open, closed, all] of [
    ['invoices', ['-None-', 'Received', 'Partially Paid'], ['Paid', 'Cancelled', 'Rejected'], ['-None-', 'Received', 'Partially Paid', 'Paid', 'Cancelled', 'Rejected']],
    ['payments', ['Pending Payment'], ['Paid', 'Cancelled'], ['Planned', 'Approved', 'Pending Payment', 'Cancelled', 'Paid', 'Reconciled']]
  ]) {
    for (const [tab, expected] of [['open', open], ['closed', closed], ['all', all]]) {
      assert.equal(ns.getWorkspaceStatusValues(workspace, tab, all).join(','), expected.join(','));
    }
  }
});

test('payment supplier-code filter matches any allocation supplier and combines with MFSP and name', () => {
  const state = ns.createInitialState();
  state.views.payments.view = 'all';
  state.views.payments.appliedFilters = { supplierCode: 'second', statusValues: [] };
  state.records.payments = [{ id: 'p1', Name: 'CARD-PAY-123', Status: 'Paid' }, { id: 'p2', Name: 'Other', Status: 'Paid' }];
  state.records.payAllocations = [
    { Supplier_Payment: { id: 'p1' }, Supplier: { id: 's1' }, MFSP_Reference: 'M1' },
    { Supplier_Payment: { id: 'p1' }, Supplier: { id: 's2' }, MFSP_Reference: 'M2' },
    { Supplier_Payment: { id: 'p2' }, Supplier: { id: 's1' }, MFSP_Reference: 'M3' }
  ];
  state.supplierIndex = { s1: { TP_Reference: 'FIRST-01' }, s2: { TP_Reference: 'SECOND-02' } };
  const context = { state, helpers: ns.helpers, FIELD_CANDIDATES: ns.FIELD_CANDIDATES,
    getUniqueSortedValues: values => [...new Set(values)].sort(), buildPaymentContextSummaryText: () => '' };
  vm.createContext(context);
  for (const name of ['getPaymentContext', 'getPaymentSupplierCodeValues', 'rebuildPaymentContextIndexes']) vm.runInContext(functionSource(name), context);
  context.rebuildPaymentContextIndexes();
  const module = ns.createPaymentsModule({
    state, helpers: ns.helpers, FIELD_CANDIDATES: ns.FIELD_CANDIDATES,
    cloneFilterState: value => Object.assign({}, value), getNormalizedStatusFilterValues: value => value || [],
    hasAnyLoadFilterValue: () => true, getPaymentSupplierCodeValues: context.getPaymentSupplierCodeValues,
    getPaymentMfspValues: payment => context.getPaymentContext(payment).mfsps,
    getMfspFromPayment: () => 'Multiple MFSPs', PAYMENT_STATUS_FILTER_OPTIONS: ['Paid', 'Cancelled', 'Pending Payment'],
    buildCombinedStatusOptions: values => values.map(value => ({ value, label: value }))
  });
  assert.equal(module.buildView().filteredRecords.map(record => record.id).join(','), 'p1');
  state.views.payments.appliedFilters.mfsp = 'M2';
  state.views.payments.appliedFilters.paymentName = '123';
  assert.equal(module.buildView().filteredRecords.length, 1);
  state.views.payments.appliedFilters.supplierCode = 'missing';
  assert.equal(module.buildView().filteredRecords.length, 0);
  state.views.payments.appliedFilters.supplierCode = '';
  assert.equal(module.buildView().filteredRecords.length, 1);
});

test('payment markup orders MFSP, supplier code and payment name and removes Reset', () => {
  const html = fs.readFileSync('app/widget.html', 'utf8');
  assert.ok(html.indexOf('id="payment-filter-mfsp"') < html.indexOf('id="payment-filter-supplier-code"'));
  assert.ok(html.indexOf('id="payment-filter-supplier-code"') < html.indexOf('id="payment-filter-name"'));
  assert.doesNotMatch(html, /id="payments-reset-filters"/);
  assert.match(html, /id="payment-filter-date-preset">\s*<option value="today">Today/);
});
