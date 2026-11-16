const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(refund = false) {
  const storage = new Map();
  const window = {
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    navigator: { locks: { request: (_, execute) => execute() } },
    ZOHO: { CRM: { API: { async searchRecord() { return { data: [] }; } } } },
    AccountingManagerApp: {}
  };
  for (const file of ['invoice-name', 'invoice-registration', 'invoice-create']) {
    const source = fs.readFileSync('app/scripts/' + file + '.js', 'utf8').replace('bindEvents: bindEvents,', 'bindEvents: bindEvents, testName: updateInvoiceNameDefault, testNext: onInvoiceCreateNextClick, testAmounts: validateInvoiceCreateAmountsStep,');
    vm.runInNewContext(source, { window });
  }
  const elements = new Proxy({}, { get(target, name) {
    return target[name] ||= { value: '', checked: false, dataset: {}, textContent: '', hidden: false,
      setCustomValidity() {}, setAttribute() {}, removeAttribute() {}, classList: { toggle() {}, add() {}, remove() {} } };
  } });
  const state = { supplierId: '1', isLoading: false, invoiceCreation: {
    isOpen: false, settlements: [], settlementStatusOptions: [], selectedSettlements: [{ id: '3' }], settlementAllocationAmounts: {}
  } };
  const errors = [], calls = [];
  const deps = {
    state, elements, renderAll() {},
    INVOICE_CREATE_VALIDATION_FIELD_KEYS: [],
    FIELD_CANDIDATES: { supplier: { connectionReference: ['TP_Reference'] } },
    getInvoiceCreateSelectedTypeValue: () => elements.invoiceCreateType.value,
    getInvoiceCreateDocumentFile: () => null,
    getInvoiceCreateRecordLabel: () => 'invoice',
    getInvoiceCreateStep: () => 'amounts', INVOICE_CREATE_STEPS: { amounts: 'amounts', settlement: 'settlement' },
    renderer: { setLoading(value) { state.isLoading = value; }, showNotice() {}, showError(message) { errors.push(message); } },
    crm: { async executeFunction(...args) { calls.push(args); return { details: { output: JSON.stringify({ success: false, retryable: true, invoice_id: '7', message: 'Totals pending' }) } }; } },
    helpers: { formatCurrency: value => value.toFixed(2), getLookupId: value => value && value.id || '', getCandidateValue: (record, fields) => record && record[fields[0]] },
    getInvoiceCreateNumberValue: value => Number(value) || 0,
    isInvoiceCreateRefundMode: () => refund,
    roundCurrency: value => Math.round((value + Number.EPSILON) * 100) / 100
  };
  const module = window.AccountingManagerApp.createInvoiceCreateModule(deps);
  return { module, elements, state, errors, calls, storage, deps };
}

test('Create invoice suggests the shared number from its settlement and preserves manual edits', async () => {
  const { module, elements, state } = setup();
  state.supplier = { TP_Reference: 'SUP-01' };
  state.indexes = { mfspByBookingId: { b1: 'MFSP123', b2: 'MFSP456' } };
  state.invoiceCreation.selectedSettlement = { id: '3', Booking: { id: 'b1' } };
  elements.invoiceCreateType.value = 'Tickets';
  await module.testName();
  assert.equal(elements.invoiceCreateNumber.value, 'TICK-MFSP123-SUP-01-1');
  elements.invoiceCreateType.value = 'Proforma';
  await module.testName();
  assert.equal(elements.invoiceCreateNumber.value, 'PROF-MFSP123-SUP-01-1');
  state.invoiceCreation.selectedSettlement = { id: '4', Booking: { id: 'b2' } };
  await module.testName();
  assert.equal(elements.invoiceCreateNumber.value, 'PROF-MFSP456-SUP-01-1');
  elements.invoiceCreateNumber.value = 'SUPPLIER-2026-42';
  elements.invoiceCreateType.value = 'Final Invoice';
  await module.testName();
  assert.equal(elements.invoiceCreateNumber.value, 'SUPPLIER-2026-42');
});

test('Suppliers form distributes payable including reimbursables and computes additional withholding', () => {
  const { module, elements, state } = setup();
  elements.invoiceCreateAmountNet.value = '100';
  elements.invoiceCreateVatPercent.value = '21';
  elements.invoiceCreateIrpfPercent.value = '15';
  elements.invoiceCreateReimbursableExpense.value = '10';
  elements.invoiceCreateAdditionalVatEnabled.checked = true;
  elements.invoiceCreateAdditionalAmountExclVat.value = '50';
  elements.invoiceCreateAdditionalVatPercent.value = '10';
  elements.invoiceCreateAdditionalIrpfPercent.value = '7';
  elements.invoiceCreateAdditionalIrpfAmount.value = '99';
  const amounts = module.updateComputedAmounts('net');
  assert.equal(amounts.primaryIrpfAmount, 15);
  assert.equal(amounts.additionalIrpfAmount, 3.5);
  assert.equal(amounts.invoiceTotal, 157.5);
  assert.equal(amounts.totalPayableAmount, 167.5);
  assert.equal(state.invoiceCreation.settlementAllocationAmounts['3'], 167.5);
  assert.equal(elements.invoiceCreateAdditionalIrpfAmount.readOnly, true);
});

test('gross entry rounds base and withholding to cents before computing payable', () => {
  const { module, elements, state } = setup();
  elements.invoiceCreateAmountGross.value = '10';
  elements.invoiceCreateVatPercent.value = '21';
  elements.invoiceCreateIrpfPercent.value = '15';
  elements.invoiceCreateReimbursableExpense.value = '0.01';
  const amounts = module.updateComputedAmounts('gross');
  assert.equal(amounts.netAmount, 8.26);
  assert.equal(amounts.vatAmount, 1.74);
  assert.equal(amounts.primaryIrpfAmount, 1.24);
  assert.equal(state.invoiceCreation.settlementAllocationAmounts['3'], 8.77);
});

test('the form resumes a pending registration without requiring another settlement selection or a file', async () => {
  const { module, state, storage, deps, errors } = setup();
  state.invoiceCreation.selectedSettlements = [];
  storage.set('accounting-manager:supplier-invoice:v1:1', JSON.stringify({
    version: 1, operationKey: '11111111-1111-4111-8111-111111111111',
    requestJson: JSON.stringify({ supplier_id: '1', invoice: { Name: 'Original invoice' } })
  }));
  let release, writes = 0;
  deps.crm.executeFunction = () => { writes++; return new Promise(resolve => { release = resolve; }); };
  const first = module.onSubmit({ preventDefault() {} });
  await module.onSubmit({ preventDefault() {} });
  assert.equal(writes, 1);
  release({ details: { output: JSON.stringify({ success: false, retryable: true, invoice_id: '7', message: 'Totals pending' }) } });
  await first;
  assert.equal(state.isLoading, false);
  assert.match(errors.at(-1), /Invoice 7 was created.*Totals pending/);
  assert.equal(JSON.parse(storage.values().next().value).invoiceId, '7');
});

 test('Commission passes the amounts step without a file; other invoice types still require it', () => {
  const { module, state, elements } = setup();
  state.supplier = { id: '1' };
  state.invoiceCreation.lastEditedAmountMode = 'gross';
  elements.invoiceCreateNumber.value = 'COM-TEST';
  elements.invoiceCreateDate.value = '2026-10-15';
  elements.invoiceCreateAmountGross.value = '100';
  elements.invoiceCreateType.value = 'Commission';
  assert.equal(module.testAmounts(), true);
  module.renderDocumentFilePreview();
  assert.equal(elements.invoiceCreateFileRequired.hidden, true);
  for (const type of ['Final Invoice', 'Proforma', 'Tickets']) {
    elements.invoiceCreateType.value = type;
    assert.equal(module.testAmounts(), false, type);
    assert.equal(state.invoiceCreation.validationFields.invoiceFile, 'Invoice File is required.');
    module.renderDocumentFilePreview();
    assert.equal(elements.invoiceCreateFileRequired.hidden, false);
  }
});
