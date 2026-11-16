const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const window = {};
for (const file of ['helpers', 'payment-allocation-export']) vm.runInNewContext(fs.readFileSync('app/scripts/' + file + '.js', 'utf8'), {window});
const helpers = window.AccountingManagerApp.helpers;
const source = fs.readFileSync('app/scripts/main.js', 'utf8');
function bankRows(invoiceMode, allocations, invoices) {
  const name = invoiceMode ? 'buildBankExportInvoiceRowsForPayment' : 'buildBankExportRowsForPayment';
  const start = source.indexOf('  function ' + name + '('), end = source.indexOf('\n  function ', start + 1);
  const context = {helpers, state: {records: {payAllocations: allocations, invoices}}, FIELD_CANDIDATES: {invoice:{number:['Name']}},
    roundCurrency: n => Math.round(n * 100) / 100, debugWarn() {},
    resolveBankExportSupplierPaymentAccount: () => ({accountRecord:{id:'a'}}),
    getOwnedPaymentAccountsForSupplierId: () => [{id:'a'}], getPaymentAccountIbanValue: () => 'ES123',
    getPaymentAccountBeneficiaryName: () => 'Supplier', getBookingNameFromInvoice: () => '', getMfspFromInvoice: () => ''};
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  return context[name]({id:'p'});
}
test('bank totals and invoice rows subtract positive or already negative credits exactly once', () => {
  for (const credit of [25, -25]) {
    for (const legacy of [false, true]) {
      const rows = [{id:'1',Supplier_Payment:{id:'p'},Supplier:{id:'s'},Supplier_Invoice:{id:'i'},Allocated_Amount:100,Movement_Type:'Outbound Payment'},
        {id:'2',Supplier_Payment:{id:'p'},Supplier:{id:'s'},Supplier_Invoice:{id:'c'},Allocated_Amount:credit,Movement_Type:legacy?'':'Supplier Refund'}];
      const invoices = [{id:'i',Name:'Invoice',Invoice_Type:'Final Invoice'}, {id:'c',Name:'Credit',Invoice_Type:'Credit Note'}];
      assert.equal(bankRows(false, rows, invoices)[0].totalAmount, 75);
      const detail = bankRows(true, rows, invoices);
      assert.equal(detail.find(r => r.invoiceId === 'c').amount, -25);
      assert.equal(detail.reduce((sum,r) => sum+r.amount,0),75);
    }
  }
});
test('allocation Excel emits numeric signed refunds, retaining existing negative values', () => {
  const sheet = window.AccountingManagerApp.paymentAllocationExportSheet([
    {id:'1', Allocated_Amount:100,Movement_Type:'Outbound Payment'},
    {id:'2', Allocated_Amount:25,Movement_Type:'Supplier Refund'},
    {id:'3', Allocated_Amount:-10,Movement_Type:'Supplier Refund'}]);
  assert.deepEqual(Array.from(sheet.rows, r => r[8].value),[100,-25,-10]);
});
test('supplier invoice total, paid and pending and payment exports sign monetary cells', () => {
  vm.runInNewContext(fs.readFileSync('app/scripts/supplier-activity.js','utf8'), {window});
  let exported;
  const invoice = {id:'c',Invoice_Type:'Credit Note',Amount_Paid:10};
  const module = window.AccountingManagerApp.createSupplierActivityModule({
    state:{supplier:{},supplierInvoices:[invoice],supplierPayments:[{Movement_Type:'Supplier Refund'}]},
    FIELD_CANDIDATES:{supplier:{name:['Name']},payment:{reference:['Name']}},
    helpers:{...helpers,getInvoiceTotalAmount:()=>25,getInvoicePendingAmount:()=>15,getInvoiceDisplayNumber:()=> 'Credit',getPaymentAmount:()=>25},
    getInvoiceBookingDisplay:()=>'',getBookingNameFromPayment:()=>'',sanitizeDownloadFileName:String,
    renderer:{showError(){},showNotice(){}},downloadFileFromText(){},
    buildSpreadsheetWorkbookXml:(name,headers,rows)=>{exported=rows;return '';}
  });
  window.AccountingManagerApp.paymentAccountLabel=()=>'';
  module.onSupplierInvoicesExportClick();
  assert.deepEqual(Array.from(exported[0].slice(6), cell=>cell.value),[-25,-10,-15]);
  module.onSupplierPaymentsExportClick(); assert.equal(exported[0][5].value,-25);
});
test('Contasol preserves debit and credit separately, including reversal entries', () => {
  const start=source.indexOf('  function getContasolDebitCreditValues('),end=source.indexOf('\n  function ',start+1);
  const context={};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  for(const [debit,credit] of [[100,0],[0,25],[-25,0],[0,-25]]) {
    const result=context.getContasolDebitCreditValues({Debit:debit,Credit:credit});
    assert.equal(result.debit,debit);assert.equal(result.credit,credit);
  }
});
test('sales and booking invoice exports retain negative prices and subtract costs and commissions', () => {
  vm.runInNewContext(fs.readFileSync('app/scripts/booking-won-report.js','utf8'),{window});
  for(const sign of [1,-1]) {
    const report={date:'2026-11-04',agencies:{},records:[{Sales_Price_inc_Taxes:121*sign,Purchase_Price_inc_Taxes:60*sign,Final_Commission:10*sign}]};
    const sales=window.AccountingManagerApp.bookingWonReportSheets(report,'sales')[0].rows[0];
    assert.equal(sales[10].value,121*sign);assert.equal(sales[12].value,61*sign);
    assert.equal(sales[18].value,10*sign);
    const invoices=window.AccountingManagerApp.bookingWonReportSheets(report,'invoices')[0].rows[0];
    assert.equal(invoices[32].value,111*sign);
  }
});
