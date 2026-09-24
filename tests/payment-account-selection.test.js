const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('app/scripts/payment-create.js', 'utf8');
function fixture(accounts) {
  const invoice = { id: 'invoice', pendingAmount: 100 };
  const state = {
    records: { paymentAccounts: accounts },
    paymentCreation: {
      context: { invoices: [invoice], suppliers: [{ id: 'tripme', name: 'TripMe' }] },
      form: { paymentDate: '2026-09-17', headerPaymentAccountId: 'own', allocations: { invoice: 100 }, paymentAccountsBySupplier: {} }
    }
  };
  const context = vm.createContext({
    state,
    getSupplierRecordById: () => ({ Default_Payment_Account: { id: 'default' } }),
    getSupplierDefaultPaymentAccountId: supplier => supplier.Default_Payment_Account.id,
    getPaymentAccountRecordById: id => accounts.find(a => a.id === id),
    isSelectablePaymentAccount: account => account.Allowed_For_Supplier_Payments === true && account.Status !== 'Inactive',
    getPaymentAccountOwnerSupplierId: account => account.Owner_Supplier?.id || '',
    paymentAccountBelongsToSupplier: (account, supplierId) => account.Owner_Supplier?.id === supplierId,
    getHeaderPaymentAccountOptionLabel: account => account.id,
    getAvailableHeaderPaymentAccounts: () => [{ id: 'own' }],
    buildInvoicesView: () => ({ selectedFilteredRecords: [invoice] }),
    getInvoicePaymentNetAmount: () => 100,
    roundCurrency: value => Math.round(value * 100) / 100,
    PAYMENT_MOVEMENT_TYPES: { outbound: 'Outbound', supplierRefund: 'Refund' }
  });
  for (const name of ['getAllowedPaymentAccountsForSupplier', 'getPreferredPaymentAccountIdForSupplier', 'validateInvoicePaymentSubmission']) {
    const start = source.indexOf('    function ' + name + '(');
    assert.ok(start >= 0);
    const tail = source.slice(start);
    const end = tail.slice(1).search(/\r?\n    (?:async )?function /) + 1;
    vm.runInContext(tail.slice(0, end), context);
  }
  return context;
}

const valid = { id: 'default', Owner_Supplier: { id: 'tripme' }, Status: 'Active', Allowed_For_Supplier_Payments: true };

test('supplier default accounts rejected by submission are never preselected', () => {
  for (const account of [
    { ...valid, Status: 'Inactive' },
    { ...valid, Allowed_For_Supplier_Payments: false },
    { ...valid, Owner_Supplier: { id: 'another-supplier' } }
  ]) {
    const ctx = fixture([account]);
    assert.equal(ctx.getPreferredPaymentAccountIdForSupplier('tripme'), '');
    ctx.state.paymentCreation.form.paymentAccountsBySupplier.tripme = account.id;
    const result = ctx.validateInvoicePaymentSubmission();
    assert.match(result.error, /TripMe/);
    assert.match(result.error, /Choose an available account/);
  }
});

test('valid defaults and alternative owned accounts pass the same submission rules', () => {
  for (const accounts of [[valid], [{ ...valid, Status: 'Inactive' }, { ...valid, id: 'alternative' }]]) {
    const ctx = fixture(accounts);
    const selected = ctx.getPreferredPaymentAccountIdForSupplier('tripme');
    assert.equal(selected, accounts.at(-1).id);
    ctx.state.paymentCreation.form.paymentAccountsBySupplier.tripme = selected;
    const result = ctx.validateInvoicePaymentSubmission();
    assert.equal(result.error, undefined);
    assert.equal(result.paymentAccountsBySupplier.tripme, selected);
  }
});

test('missing supplier accounts retain the existing Automatic path', () => {
  const ctx = fixture([]);
  assert.equal(ctx.getPreferredPaymentAccountIdForSupplier('tripme'), '');
  const result = ctx.validateInvoicePaymentSubmission();
  assert.equal(result.error, undefined);
  assert.equal(result.paymentAccountsBySupplier.tripme, '');
});
