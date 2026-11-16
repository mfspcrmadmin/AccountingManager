const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};
for(const file of ['config','helpers','render-invoices'])vm.runInNewContext(fs.readFileSync('app/scripts/'+file+'.js','utf8'),{window,Intl});
const ns=window.AccountingManagerApp;
const totals=rows=>JSON.parse(JSON.stringify(ns.invoiceSelectionPaymentTotals(rows,ns.helpers,ns.FIELD_CANDIDATES)));
test('selected invoice total is separate from unpaid balance, summed in cents',()=>{
  const invoice={Total_Payable_Amount:4283.99,Amount_Paid:4238.99,Invoice_Type:'Final Invoice',Currency:'EUR'};
  assert.deepEqual(totals([invoice]),{EUR:{total:428399,pending:4500}});
  assert.deepEqual(totals([invoice,{...invoice,Total_Payable_Amount:100,Amount_Paid:75}]),{EUR:{total:438399,pending:7000}});
  assert.equal(totals([{...invoice,Amount_Paid:4283.99}]).EUR.pending,0);
});
test('credit notes reduce only their remaining balance and currencies remain separate',()=>{
  assert.deepEqual(totals([
    {Total_Payable_Amount:100,Amount_Paid:20,Currency:'EUR'},
    {Total_Payable_Amount:30,Amount_Paid:10,Currency:'EUR',Invoice_Type:'Credit Note'},
    {Total_Payable_Amount:100,Amount_Paid:95,Currency:'USD'}
  ]),{EUR:{total:7000,pending:6000},USD:{total:10000,pending:500}});
});
