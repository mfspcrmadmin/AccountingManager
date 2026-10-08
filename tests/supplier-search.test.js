const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const window = {};
  for (const file of ['config', 'helpers', 'supplier-workspace']) {
    vm.runInNewContext(fs.readFileSync(`app/scripts/${file}.js`, 'utf8'), { window });
  }
  return window.AccountingManagerApp;
}

test('supplier matching and ranking include CIF/NIF and preserve existing search fields', () => {
  const { helpers, FIELD_CANDIDATES } = fixture();
  const exact = { id: '1', CIF_NIF: 'B12345678' };
  const partial = { id: '2', CIF_NIF: 'B123456789' };
  assert.equal(helpers.matchesSupplierQuery(exact, ' b12345678 ', FIELD_CANDIDATES), true);
  assert.equal(helpers.matchesSupplierQuery(exact, 'B123', FIELD_CANDIDATES), true);
  assert.equal(helpers.matchesSupplierQuery(exact, 'A999', FIELD_CANDIDATES), false);
  assert.equal(helpers.matchesSupplierQuery({}, 'B123', FIELD_CANDIDATES), false);
  assert.equal(helpers.sortSuppliersByQuery([partial, exact], 'B12345678', FIELD_CANDIDATES)[0].id, '1');
  for (const field of ['Vendor_Name', 'TP_Reference', 'Ezus_Supplier_API']) {
    assert.equal(helpers.matchesSupplierQuery({ [field]: 'Hotel123' }, 'Hotel123', FIELD_CANDIDATES), true);
  }
});

test('CIF/NIF search queries CRM and offers all suppliers sharing the same tax ID', async () => {
  const app = fixture();
  const suppliers = [{ id: '1', CIF_NIF: 'B12345678' }, { id: '2', CIF_NIF: 'B12345678' }];
  const criteria = [];
  let results;
  const workspace = app.createSupplierWorkspaceModule({
    MODULES: app.MODULES,
    FIELD_CANDIDATES: app.FIELD_CANDIDATES,
    helpers: app.helpers,
    state: { supplierIndex: {}, recentSuppliers: [suppliers[0]] },
    elements: { supplierSearch: { value: 'B12345678' } },
    crm: {
      async searchRecord(module, criterion) {
        assert.equal(module, 'Vendors');
        criteria.push(criterion);
        return criterion.startsWith('(CIF_NIF:') ? suppliers : [];
      },
      async searchWord() { return []; }
    },
    renderer: {
      setLoading() {},
      showError(message) { assert.equal(message, ''); },
      showNotice() {},
      renderSearchResults(records) { results = records; }
    }
  });
  await workspace.onLoadSupplierClick();
  assert.ok(criteria.includes('(CIF_NIF:equals:B12345678)'));
  assert.ok(criteria.includes('(CIF_NIF:starts_with:B12345678)'));
  assert.deepEqual(Array.from(results, record => record.id), ['1', '2']);
});
