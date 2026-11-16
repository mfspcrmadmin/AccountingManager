const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const window={};for(const file of ['config.js','helpers.js'])vm.runInNewContext(fs.readFileSync('app/scripts/'+file,'utf8'),{window,Intl});
const h=window.AccountingManagerApp.helpers;
const fields={invoice:{totalAmount:['Invoice_Total','Total_Payable_Amount'],amount:['Invoice_Amount_Excl_VAT'],unpaidAmount:['Unpaid_Invoiced_Amount'],amountPaid:['Amount_Paid']}};
test('payment amounts include reimbursables even when the formula or legacy invoice total differs',()=>{
 const invoice={Invoice_Total:106,Total_Payable_Amount:116,Amount_Paid:40,Unpaid_Invoiced_Amount:66};
 assert.equal(h.getInvoiceTotalAmount(invoice,fields),116);assert.equal(h.getInvoicePendingAmount(invoice,fields),76);
 invoice.Amount_Paid=116;assert.equal(h.getInvoicePendingAmount(invoice,fields),0);
});
test('an explicit zero payable is preserved and legacy invoices retain their fallback',()=>{
 assert.equal(h.getInvoiceTotalAmount({Invoice_Total:10,Total_Payable_Amount:0},fields),0);
 assert.equal(h.getInvoicePendingAmount({Invoice_Total:10,Amount_Paid:3},fields),7);
});
