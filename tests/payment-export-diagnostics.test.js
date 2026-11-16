const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};
for(const name of ['helpers','payment-diagnostics','payment-allocation-export','excel-workbook','crm']){
  vm.runInNewContext(fs.readFileSync('app/scripts/'+name+'.js','utf8'),{window,Blob,TextEncoder,Set,console});
}
const ns=window.AccountingManagerApp;
test('export retrieves every page, retains numeric amounts and IDs as text, rejects incomplete results',async()=>{
  const records=Array.from({length:205},(_,i)=>({id:'616617000173617'+String(i).padStart(3,'0'),Name:i?'Allocation':'=HYPERLINK("bad")',Allocated_Amount:i===0?-12.34:20,Currency:'EUR'}));
  const rows=await ns.collectPaymentAllocationExport(async({page,perPage})=>({records:records.slice((page-1)*perPage,page*perPage),hasMore:page*perPage<records.length}));
  assert.equal(rows.length,205);
  const sheet=ns.paymentAllocationExportSheet(rows);
  assert.equal(sheet.rows[0][0],records[0].id);
  assert.equal(sheet.rows[0][8].value,-12.34);
  const bytes=await ns.createExcelWorkbook([sheet]).text();
  assert.ok(bytes.includes('=HYPERLINK(&quot;bad&quot;)'));
  assert.ok(!bytes.includes('<f>'));
  assert.ok(bytes.includes('<v>-12.34</v>'));
  await assert.rejects(ns.collectPaymentAllocationExport(async()=>({records:[records[0]],hasMore:true})),/repeated/);
  await assert.rejects(ns.collectPaymentAllocationExport(async({page})=>{if(page===2)throw Error('offline');return {records:[records[0]],hasMore:true};}),/offline/);
});
test('CRM diagnostics record query, count, raw error details and final failure without row contents',async()=>{
  let fail=false;
  const client=ns.createCrmClient({CRM:{API:{coql:async()=>{if(fail)throw {code:'INVALID_QUERY',message:'Bad query',details:{column_name:'Booking'}};return {data:[{id:'private-record',Name:'private-name'}]};}}}},{extractRecords:r=>r.data});
  ns.startPaymentDiagnostics({mfsp:'MFSP2608663',paymentView:'closed'});
  await client.coql('select id from Supplier_Payments',{strict:true});
  fail=true;
  await assert.rejects(client.coql('select Booking from Supplier_Pay_Allocations',{strict:true}));
  ns.failPaymentDiagnostics(Error('Search failed'));
  const text=ns.paymentDiagnosticsText(),report=JSON.parse(text);
  assert.equal(report.queries[0].count,1);
  assert.equal(report.queries[1].error.code,'INVALID_QUERY');
  assert.match(report.queries[1].error.details,/Booking/);
  assert.equal(report.failure.error.message,'Search failed');
  assert.ok(!text.includes('private-name'));assert.ok(!text.includes('private-record'));
});
