const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('app/scripts/payment-create.js', 'utf8');
function fixture(accounts, options = {}) {
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
    getSupplierRecordById: () => options.supplier || ({ Default_Payment_Account: { id: 'default' } }),
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

test('shared SION is selectable only for agency commission context and its configured default', () => {
  const sion = {id:'616617000166884362',Owner_Type:'Agency',Method_Type:'SION',Status:'Active',Allowed_For_Supplier_Payments:false};
  const supplier = {Vendor_Type:'Agency',Agency:{id:'agency'},Default_Payment_Account:{id:sion.id}};
  const ctx = fixture([sion],{supplier});
  ctx.state.paymentCreation.context.invoices[0].supplierId = 'tripme';
  ctx.state.paymentCreation.context.invoices[0].invoiceType = 'Commission';
  assert.equal(ctx.getPreferredPaymentAccountIdForSupplier('tripme'),sion.id);
  for (const changes of [{Status:'Inactive'},{Locked__s:true},{Owner_Type:'Own'},{Method_Type:'Bank Transfer'},{Owner_Supplier:{id:'other'}}]) {
    const f = fixture([{...sion,...changes}],{supplier});
    f.state.paymentCreation.context.invoices[0] = {supplierId:'tripme',invoiceType:'Commission'};
    assert.equal(f.getPreferredPaymentAccountIdForSupplier('tripme'),'');
  }
  ctx.state.paymentCreation.context.invoices[0].invoiceType = 'Final Invoice';
  assert.equal(ctx.getAllowedPaymentAccountsForSupplier('tripme').length,0);
  ctx.state.paymentCreation.context.invoices[0].invoiceType = 'Commission';
  supplier.Vendor_Type = 'Supplier';
  assert.equal(ctx.getAllowedPaymentAccountsForSupplier('tripme').length,0);
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

test('correction payment uses its explicit invoice after table selection is cleared or differs', () => {
  for (const selected of [[], [{id:'other'}], [{id:'invoice'}, {id:'other'}]]) {
    const ctx = fixture([]);
    ctx.state.paymentCreation.context.invoiceCorrection = true;
    ctx.state.paymentCreation.context.correctionInvoice = {id:'invoice', Modified_Time:'after-edit'};
    ctx.buildInvoicesView = () => ({selectedFilteredRecords:selected});
    assert.equal(ctx.validateInvoicePaymentSubmission().error, undefined);
    ctx.state.paymentCreation.form.allocations.invoice = 101;
    assert.match(ctx.validateInvoicePaymentSubmission().error, /pending amount/);
  }
});

test('ordinary payments still reject a changed table selection', () => {
  const ctx = fixture([]);
  ctx.buildInvoicesView = () => ({selectedFilteredRecords:[]});
  assert.match(ctx.validateInvoicePaymentSubmission().error, /selected invoices changed/);
});

test('correction payments reject missing, mismatched or multiple invoice contexts', () => {
  for (const record of [null, {id:'other'}]) {
    const ctx = fixture([]);
    ctx.state.paymentCreation.context.invoiceCorrection = true;
    ctx.state.paymentCreation.context.correctionInvoice = record;
    assert.match(ctx.validateInvoicePaymentSubmission().error, /corrected invoice/);
  }
  const ctx = fixture([]);
  ctx.state.paymentCreation.context.invoiceCorrection = true;
  ctx.state.paymentCreation.context.correctionInvoice = {id:'invoice'};
  ctx.state.paymentCreation.context.invoices.push({id:'other',pendingAmount:10});
  assert.match(ctx.validateInvoicePaymentSubmission().error, /corrected invoice/);
});
