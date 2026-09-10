const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const file of ['config.js', 'helpers.js', 'invoices.js', 'remote-data.js']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + file, 'utf8'), { window });
}
const ns = window.AccountingManagerApp;
test('invoice controls resolve in the shipped markup', () => {
  const html = fs.readFileSync('app/widget.html', 'utf8');
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  const document = { getElementById: id => ids.has(id) ? { id } : null, querySelectorAll: () => [] };
  vm.runInNewContext(fs.readFileSync('app/scripts/dom.js', 'utf8'), { window, document });
  const elements = ns.getElements();
  for (const key of ['invoiceFilterDestinationField', 'invoiceFilterDestinationToggle', 'invoiceFilterDestinationMenu', 'invoiceFilterSelfEmployed', 'invoicesGroupBy']) {
    assert.ok(elements[key], key);
  }
});
function setup() {
  const state = ns.createInitialState();
  state.views.invoices.view = 'all';
  state.records.invoices = [
    { id: '1', Supplier: { id: 'a', name: 'Alpha' }, 'Supplier.Destination': 'Spain', 'Supplier.Is_Self_Employed': true, MFSP_Reference: 'M2', Invoice_Date: '2026-09-01' },
    { id: '2', Supplier: { id: 'b', name: 'Beta' }, 'Supplier.Destination': null, 'Supplier.Is_Self_Employed': false, MFSP_Reference: 'M1', Invoice_Date: '2026-09-02' },
    { id: '3', Supplier: { id: 'a', name: 'Alpha' }, 'Supplier.Destination': 'Spain', 'Supplier.Is_Self_Employed': true, MFSP_Reference: 'M1', Invoice_Date: '2026-09-03' },
    { id: '4', Supplier: { id: 'c', name: 'Alpha' }, 'Supplier.Destination': 'Portugal', 'Supplier.Is_Self_Employed': false, Invoice_Date: '2026-09-04' }
  ].map(record => Object.assign({ Status: 'Paid', Invoice_Type: 'Final Invoice', Total_Payable_Amount: 10 }, record));
  const deps = {
    state, helpers: ns.helpers, FIELD_CANDIDATES: ns.FIELD_CANDIDATES, MODULES: ns.MODULES,
    cloneFilterState: value => JSON.parse(JSON.stringify(value)),
    hasAnyLoadFilterValue: () => true, getNormalizedStatusFilterValues: values => values || [],
    getInvoiceType: record => record.Invoice_Type,
    getSupplierNameFromInvoice: record => record.Supplier.name,
    getMfspFromInvoice: record => record.MFSP_Reference,
    compareValues: (a, b, direction) => (a < b ? -1 : a > b ? 1 : 0) * (direction === 'desc' ? -1 : 1),
    INVOICE_STATUS_FILTER_OPTIONS: ['Paid'],
    renderAll: () => {},
    resolveFieldApiByCandidates: async (module, candidates, fallback) => fallback,
    escapeCoqlValue: value => value.replace(/'/g, "\\'"),
    hasAllStatusFilterValuesSelected: (values, options) => options.every(value => values.includes(value))
  };
  return { state, invoices: ns.createInvoicesModule(deps), remote: ns.createRemoteDataModule(deps) };
}
test('destination combinations and self-employed filters intersect', () => {
  const { state, invoices } = setup();
  const filters = state.views.invoices.appliedFilters;
  filters.destinationValues = ['Empty', 'Portugal'];
  assert.equal(invoices.buildView().filteredRecords.map(r => r.id).sort().join(','), '2,4');
  filters.selfEmployed = 'true';
  assert.equal(invoices.buildView().filteredRecords.length, 0);
  filters.destinationValues = ['Spain'];
  assert.equal(invoices.buildView().filteredRecords.length, 2);
  filters.selfEmployed = 'false';
  assert.equal(invoices.buildView().filteredRecords.length, 0);
  filters.destinationValues = [];
  assert.equal(invoices.buildView().filteredRecords.length, 0);
});
test('grouping keeps suppliers distinct, sorts inside groups and preserves selection', () => {
  const { state, invoices } = setup();
  assert.equal(state.views.invoices.groupBy, 'none');
  assert.equal(invoices.buildView().visibleRecords.map(r => r.id).join(','), '4,3,2,1');
  assert.equal(invoices.buildView().getGroup(state.records.invoices[0]), null);
  state.views.invoices.groupBy = 'supplier';
  invoices.toggleSelection('1', true);
  let view = invoices.buildView();
  assert.equal(view.visibleRecords.map(r => r.id).join(','), '3,1,4,2');
  assert.notEqual(view.getGroup(state.records.invoices[0]).key, view.getGroup(state.records.invoices[3]).key);
  state.views.invoices.groupBy = 'destination';
  view = invoices.buildView();
  assert.equal(view.visibleRecords.map(r => r.id).join(','), '2,4,3,1');
  assert.equal(view.getGroup(state.records.invoices[1]).label, 'Empty');
  state.views.invoices.groupBy = 'mfsp';
  view = invoices.buildView();
  assert.equal(view.visibleRecords.map(r => r.id).join(','), '3,2,1,4');
  assert.equal(view.selectedVisibleCount, 1);
  assert.equal(view.filteredTotalAmount, 40);
  state.views.invoices.groupBy = 'none';
  view = invoices.buildView();
  assert.equal(view.visibleRecords.map(r => r.id).join(','), '4,3,2,1');
  assert.equal(view.selectedVisibleCount, 1);
});
test('remote filters use supplier fields, null destination and boolean criteria', async () => {
  const { remote } = setup();
  const query = await remote.buildInvoiceRemoteWhereClause({ invoiceView: 'all', destinationValues: ['Empty', 'Spain'], selfEmployed: 'false' });
  assert.match(query, /Supplier\.Destination is null/);
  assert.match(query, /Supplier\.Destination = 'Spain'/);
  assert.match(query, /Supplier\.Is_Self_Employed = false/);
  assert.match(query, / or /);
  assert.match(query, / and /);
  assert.match(await remote.buildInvoiceRemoteWhereClause({ invoiceView: 'all', destinationValues: [] }), /__none__/);
  assert.equal(await remote.buildInvoiceRemoteWhereClause({ invoiceView: 'all', destinationValues: ['Empty', 'Spain', 'Portugal'], selfEmployed: '' }), '');
});
