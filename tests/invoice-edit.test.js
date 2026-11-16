const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {transpile} = require('./helpers/deluge-registration-harness');
const window = {};
vm.runInNewContext(fs.readFileSync('app/scripts/invoice-edit.js','utf8'),{window});
const totals = window.AccountingManagerApp.invoiceEditTotals;
const key='11111111-1111-4111-8111-111111111111';
// Legacy accounting tests explicitly exercise the retained, opt-in implementation.
function setup(legacyConversion = false, accountingEnabled = false) {
 const database={Supplier_Invoices:{'1':{id:'1',Modified_Time:'v1',Name:'INV1',Invoice_Date:'2026-10-09',Invoice_Type:'Final Invoice',Supplier:{id:'2'},Supplier_Settlement:{id:'3'},Status:'Paid',Amount_Paid:100,Invoice_Amount_Excl_VAT:100,VAT_percentage:0,IRPF_percentage:0,Invoice_Amount_Incl_VAT:100,Invoice_Total:100,Total_Payable_Amount:100,Reimbursable_Expense:0,Invoice_File:[{id:'9',File_Id__s:'file-original'}]}},Supplier_Settlements:{'3':{id:'3',Supplier:{id:'2'},Admin_Status:'Paid',Total_Invoice:100,Total_Service_Cost:120}},Vendors:{'2':{id:'2',Is_Self_Employed:true}},Supplier_Payments:{'4':{id:'4',Status:'Paid'}},Inv_Set_Allocations:{'5':{id:'5',Modified_Time:'v1',Vendor_Invoice:{id:'1'},Vendor_Settlement:{id:'3'},Status:'Active',Allocated_Amount:100}},Supplier_Pay_Allocations:{'6':{id:'6',Supplier_Invoice:{id:'1'},Supplier_Payment:{id:'4'},Allocated_Amount:100}},Accounting_Entries:{},Card_Purchases:{},Prepayment_Invoice_Allocations:{}};
 const writes=[], failures={}, fileContents={};let version=1;
 Object.assign(database.Supplier_Payments['4'],{Modified_Time:'p1',Payment_Amount:100,Accounting_Status:'Pending'});
 database.Supplier_Pay_Allocations['6'].Modified_Time='a1';
 const ctx=vm.createContext({});
 vm.runInContext(`
 function choose(c,a,b){return c?a:b;} function Map(){return {};} function List(){return [];} function ifnull(v,d){return v==null?d:v;}
 Object.defineProperties(Object.prototype,{get:{value:function(k){return this[k]==null?null:this[k];}},put:{value:function(k,v){this[k]=v;}},containKey:{value:function(k){return Object.hasOwn(this,k);}},keys:{value:function(){return Object.keys(this);}},isEmpty:{value:function(){return Object.keys(this).length===0;}},toString:{value:function(){return JSON.stringify(this);},configurable:true}});
 Array.prototype.add=function(v){this.push(v)};Array.prototype.size=function(){return this.length};Array.prototype.contains=function(v){return this.includes(v)};
 String.prototype.subString=function(a,b){return this.substring(a,b)};
 String.prototype.toMap=function(){return JSON.parse(this)};String.prototype.toList=function(s){return this.split(s)};String.prototype.matches=function(s){return new RegExp('^(?:'+s+')$').test(this)};String.prototype.contains=function(s){return this.includes(s)};
 String.prototype.toDecimal=String.prototype.toLong=function(){return Number(this)};Number.prototype.toDecimal=Number.prototype.toLong=function(){return Number(this)};Number.prototype.round=function(n){return Math.round((Number(this)+Number.EPSILON)*10**n)/10**n};
 Number.prototype.toLong=function(){return Math.trunc(Number(this));};
 String.prototype.toDate=function(){const d=new Date(this+'T00:00:00Z');return {toString:function(){return d.toISOString().slice(0,10)}}};
 var standalone={};
 `,ctx);
 const inside=o=>vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(o))+')',ctx);
 ctx.zoho={currenttime:{toLong:()=>1000000},crm:{getRecordById:(m,id)=>inside(database[m]?.[id]||{})}};
 let partNext=90000;database.Admin_Process_Jobs={};
 ctx.zoho.encryption={sha256:s=>crypto.createHash('sha256').update(s).digest('hex')};
 ctx.zoho.encryption.base64Encode=file=>Buffer.from(file.bytes).toString('base64');
 ctx.invoke=options=>{
  if(failures.fileRead)throw Error('Document download unavailable');
  const upload=options.url.match(/\/files\?id=([^&]+)/),attachment=options.url.match(/fields_attachment_id=([^&]+)/);
  if(!upload&&!attachment)throw Error('Unexpected file request');
  const identifier=(upload||attachment)[1],bytes=fileContents[identifier]||identifier;
  const response = inside({responseCode: failures.fileResponse ? failures.fileResponse.status : 200});
  response.responseText = failures.fileResponse ? inside(failures.fileResponse.body) : {isFile:()=>true,getFileSize:()=>bytes.length,bytes};
  if (failures.fileResponse && response.responseText) response.responseText.isFile=()=>false;
  return options.detailed ? response : response.responseText;
 };
 vm.runInContext(transpile(fs.readFileSync('crm/invoice-edit/supplierInvoiceEdit_fileDigest.dg','utf8')),ctx);
 ctx.standalone.supplierInvoiceEdit_fileDigest=(...args)=>ctx.supplierInvoiceEdit_fileDigest(...args);
 ctx.zoho.crm.createRecord=(m,values)=>{
  const data=JSON.parse(JSON.stringify(values));if(m!=='Admin_Process_Jobs')throw Error('Unexpected create '+m);
  if(failures.part){failures.part--;throw Error('Plan storage unavailable');}
  const old=Object.values(database[m]).find(r=>r.Active_Key===data.Active_Key);if(old)return inside({code:'DUPLICATE_DATA',details:{id:old.id}});
  const id=String(partNext++);database[m][id]={id,...data};writes.push({m,id,data});
  if(failures.lostPart){failures.lostPart--;throw Error('Lost plan creation response');}return inside({id});
 };
 const codec=fs.readFileSync('crm/invoice-edit/supplierInvoiceEdit_journal.dg','utf8').replace(/for each\s+(\w+) in ([^{\n]+)\s*\{/g,'for each $1 in $2\n{');
 vm.runInContext(transpile(codec),ctx);ctx.standalone.supplierInvoiceEdit_journal=(...args)=>ctx.supplierInvoiceEdit_journal(...args);
 ctx.standalone.supplierInvoiceEdit_read=(m,field,id)=>JSON.stringify({success:true,records:Object.values(database[m]||{}).filter(r=>field==='Payment_Source' ? r.Name?.endsWith('-PAY-'+id)||r.Name==='Supplier_Payment_'+id : String(r[field]?.id||r[field])===String(id))});
 ctx.standalone.supplierInvoiceEdit_write=(m,id,modified,changes)=>{
  if(failures[m]){failures[m]--;throw Error('Injected '+m+' failure')}
  const row=database[m]?.[id]; if(!row||row.Modified_Time!==modified)return JSON.stringify({error:true,conflict:true});
  const data=JSON.parse(JSON.stringify(changes));if(data.Name && failures.header){failures.header--;throw Error("Header rejected");}
  const applied=structuredClone(data);
  if(data.Invoice_File){
   let files=structuredClone(row.Invoice_File || []);
   for(const file of data.Invoice_File){if(Object.hasOwn(file,'_delete'))files=files.filter(f=>(f.id || f.attachment_Id)!==file.id);else if(file.File_Id__s){const linkId=String(10000+version);fileContents[linkId]=fileContents[file.File_Id__s]||file.File_Id__s;files.push({id:linkId,File_Id__s:failures.remapFiles?'qakpv-stored-'+version:file.File_Id__s});}}
   if(files.length>1)throw Error('LIMIT_EXCEEDED Invoice_File maximum_length 1');
   applied.Invoice_File=files;
  }
  Object.assign(row,applied,{Modified_Time:'v'+(++version)});writes.push({m,id,data});
  if(data.Name && failures.lostHeader){failures.lostHeader--;throw Error('Lost response after header write');}
  if(failures['lost'+m]){failures['lost'+m]--;throw Error('Lost response after '+m);}
  return JSON.stringify({error:false});
 };
 ctx.standalone.rebuildSupplierSettlementTotals=()=>JSON.stringify({error:Boolean(failures.rebuild),message:'Rebuild pending',warning_count:0});
 ctx.standalone.supplierInvoiceEdit_accountingPlan=()=>JSON.stringify({error:true,message:'Missing accounting rule'});
 const paymentSource=fs.readFileSync(accountingEnabled ? 'crm/accounting-paused/backups/supplierinvoiceedit_payments.dg' : 'crm/invoice-edit/supplierInvoiceEdit_payments.dg','utf8').replace('accountingGenerationEnabled = false;', 'accountingGenerationEnabled = '+accountingEnabled+';').replace(/for each\s+(\w+) in ([^{\n]+)\s*\{/g,'for each $1 in $2\n{');
 vm.runInContext(transpile(paymentSource).replace(/= if\(/g,'= choose('),ctx);
 ctx.standalone.supplierInvoiceEdit_payments=(...args)=>ctx.supplierInvoiceEdit_payments(...args);
 const additionalSource=fs.readFileSync('crm/invoice-edit/supplierInvoiceEdit_addPayment.dg','utf8').replace(/for each\s+(\w+) in ([^{\n]+)\s*\{/g,'for each $1 in $2\n{');
 vm.runInContext(transpile(additionalSource).replace(/,if\(/g,',choose('),ctx);
 ctx.standalone.supplierInvoiceEdit_addPayment=(...args)=>ctx.supplierInvoiceEdit_addPayment(...args);
 const conversionSource=fs.readFileSync('crm/invoice-edit/supplierInvoice_convertFinal.dg','utf8').replace(/for each\s+(\w+) in ([^{\n]+)\s*\{/g,'for each $1 in $2\n{');
 vm.runInContext(transpile(conversionSource),ctx);
 ctx.standalone.supplierInvoice_convertFinal=(...args)=>ctx.supplierInvoice_convertFinal(...args);
 let source=fs.readFileSync(accountingEnabled ? 'crm/accounting-paused/backups/supplierinvoice_edit.dg' : 'crm/invoice-edit/supplierInvoice_edit.dg','utf8').replace('accountingGenerationEnabled = false;', 'accountingGenerationEnabled = '+accountingEnabled+';').replace(/for each\s+(\w+) in ([^{\n]+)\s*\{/g,'for each $1 in $2\n{');
 // Generate old financial journals to retain coverage of pre-migration recovery.
 if(legacyConversion)source=source.replace('return standalone.supplierInvoice_convertFinal(operationKey,requestJson);','');
 vm.runInContext(transpile(source).replace(/= if\(/g, "= choose("),ctx);
 const request={action:'save',payment_action:'keep',invoice_id:'1',modified_time:'v1',reason:'Supplier reported missing expenses',vat_reviewed:true,irpf_reviewed:true,allocations:{'3':120},fields:{Name:'INV1',Invoice_Date:'2026-10-09',Invoice_Type:'Final Invoice',Invoice_Amount_Excl_VAT:100,VAT_percentage:0,IRPF_percentage:0,Reimbursable_Expense:20}};
 return {ctx,inside,database,writes,failures,fileContents,request,run:(r=request,k=key)=>JSON.parse(ctx.supplierInvoice_edit(k,JSON.stringify(r)))};
}
test('reimbursable expense increases payable without changing invoice taxes',()=>{
 const t=totals({Invoice_Amount_Excl_VAT:100,VAT_percentage:21,IRPF_percentage:15,Reimbursable_Expense:20});assert.equal(t.invoice,106);assert.equal(t.payable,126);
 assert.throws(()=>totals({Reimbursable_Expense:-1}),/valid non-negative/);
});
test('paid invoice becomes partially paid after expense correction and existing payment is unchanged',()=>{
 const f=setup(),result=f.run();assert.equal(result.success,true,result.message);
 const invoice=f.database.Supplier_Invoices['1'];assert.equal(invoice.Total_Payable_Amount,120);assert.equal(invoice.Amount_Paid,100);assert.equal(invoice.Status,'Partially Paid');assert.equal(invoice.Edit_Status,'Complete');assert.equal(f.database.Inv_Set_Allocations['5'].Allocated_Amount,120);assert.ok(f.writes.every(w=>w.m!=='Supplier_Payments'));assert.equal(f.database.Supplier_Pay_Allocations['6'].Allocated_Amount,100);assert.equal(f.database.Supplier_Pay_Allocations['6'].Invoice_Status,'Partially Paid');
 const count=f.writes.length;assert.equal(f.run().success,true);assert.equal(f.writes.length,count);
});

test('an unpaid invoice edit recalculates taxes, reimbursables and settlement allocations without creating payments',()=>{
 const f=setup();f.database.Supplier_Payments={};f.database.Supplier_Pay_Allocations={};
 Object.assign(f.database.Supplier_Invoices['1'],{Status:'Received',Amount_Paid:0});
 Object.assign(f.request.fields,{Invoice_Amount_Excl_VAT:100,VAT_percentage:21,IRPF_percentage:15,Reimbursable_Expense:10});
 f.request.allocations['3']=116;
 const r=f.run();assert.equal(r.success,true,r.message);const invoice=f.database.Supplier_Invoices['1'];
 assert.equal(invoice.Invoice_Total,106);assert.equal(invoice.Total_Payable_Amount,116);assert.equal(invoice.Amount_Paid,0);assert.equal(invoice.Status,'Received');
 assert.equal(f.database.Inv_Set_Allocations['5'].Allocated_Amount,116);assert.equal(Object.keys(f.database.Supplier_Payments).length,0);
});
test('rejects stale invoice, missing reviews, missing file, invalid type and allocation mismatch before writes',()=>{
 for(const edit of [f=>f.request.modified_time='old',f=>f.request.vat_reviewed=false,f=>f.database.Supplier_Invoices['1'].Invoice_File=[],f=>f.request.fields.Invoice_Type='',f=>f.request.allocations['3']=110,f=>f.request.fields.Reimbursable_Expense=-1]){const f=setup();edit(f);const r=f.run();assert.equal(r.success,false);assert.equal(f.writes.length,0,r.message);}
});
test('does not reduce payable below existing paid or reserved allocations',()=>{
 const f=setup();f.request.fields.Invoice_Amount_Excl_VAT=50;f.request.allocations['3']=70;assert.equal(f.run().success,false);assert.equal(f.writes.length,0);
});
test('partial save resumes its immutable correction without creating another invoice or payment',()=>{
 const f=setup();f.failures.Inv_Set_Allocations=1;let r=f.run();assert.equal(r.saved,true);assert.equal(r.success,false);assert.equal(f.database.Supplier_Invoices['1'].Edit_Status,'Pending');
 r=f.run({action:'resume',invoice_id:'1'});assert.equal(r.success,true,r.message);assert.equal(f.database.Inv_Set_Allocations['5'].Allocated_Amount,120);assert.equal(Object.keys(f.database.Supplier_Invoices).length,1);
});
test('rebuild failures keep a recoverable pending edit and block different operation keys',()=>{
 const f=setup();f.failures.rebuild=true;assert.equal(f.run().success,false);const count=f.writes.length;
 assert.equal(f.run(f.request,'22222222-2222-4222-8222-222222222222').success,false);assert.equal(f.writes.length,count);
 f.failures.rebuild=false;assert.equal(f.run({action:'resume',invoice_id:'1'}).success,true);
});
test('posted accounting entries block edits; unposted entries require no generation configuration',()=>{
 for(const posted of [true,false]){const f=setup();f.database.Accounting_Entries['8']={id:'8',Supplier_Invoice:{id:'1'},Books_Post_Status:posted?'Posted':'Not Ready'};assert.equal(f.run().success,!posted);if(posted)assert.equal(f.writes.length,0);}
});
test('pending edit does not overwrite a later external change',()=>{
 const f=setup();f.failures.rebuild=true;f.run();f.database.Supplier_Invoices['1'].Reimbursable_Expense=35;const count=f.writes.length;assert.equal(f.run({action:'resume',invoice_id:'1'}).success,false);assert.equal(f.writes.length,count);
});

function accountingFixture(accountingEnabled = true) {
 const f=setup(false, accountingEnabled);let next=100;
 f.database.Accounting_Entries['8']={id:'8',Modified_Time:'v1',Supplier_Invoice:{id:'1'},Name:'Old entry',Books_Post_Status:'Not Ready',Total_Debit:100,Total_Credit:100,Line_Count:2};
 f.database.Accounting_Entry_Lines={
  '10':{id:'10',Modified_Time:'v1',Accounting_Entry:{id:'8'},Account:{id:'20'},Debit:100,Credit:0},
  '11':{id:'11',Modified_Time:'v1',Accounting_Entry:{id:'8'},Account:{id:'21'},Debit:0,Credit:100}
 };
 f.ctx.standalone.supplierInvoiceEdit_accountingPlan=()=>JSON.stringify({error:false,entry:{Name:'Corrected entry',Books_Post_Status:'Not Ready',Total_Debit:120,Total_Credit:120,Line_Count:3,Source_Date:'2026-10-09'},lines:[{account_id:'20',debit:100,credit:0,line_type:'Expense',account_role:'Base Expense',is_irpf_line:false,is_reimbursable:false},{account_id:'22',debit:20,credit:0,line_type:'Reimbursable',account_role:'Reimbursable Expense',is_irpf_line:false,is_reimbursable:true},{account_id:'21',debit:0,credit:120,line_type:'Supplier',account_role:'Supplier Payable',is_irpf_line:false,is_reimbursable:false}]});
 const storageCreate=f.ctx.zoho.crm.createRecord;
 f.ctx.zoho.crm.createRecord=(m,values)=>{
  if(m==='Admin_Process_Jobs')return storageCreate(m,values);
  const data=JSON.parse(JSON.stringify(values));const old=Object.values(f.database[m]).find(r=>r.Invoice_Edit_Key===data.Invoice_Edit_Key);
  if(old)return f.inside({code:'DUPLICATE_DATA',details:{id:old.id}});
  const id=String(next++);data.Accounting_Entry={id:data.Accounting_Entry};data.Account={id:data.Account};data.Supplier_Invoice={id:data.Supplier_Invoice};f.database[m][id]={...data,id,Modified_Time:'v1'};f.writes.push({m,id,data});
  if(f.failures.lostLine){f.failures.lostLine--;throw Error('Lost line creation response');}
  return f.inside({id});
 };
 const fileInvoke=f.ctx.invoke;
 f.ctx.invoke=options=>{if(options.type==='GET')return fileInvoke(options);const id=options.url.match(/Accounting_Entry_Lines\/(\d+)/)[1];delete f.database.Accounting_Entry_Lines[id];f.writes.push({m:'Accounting_Entry_Lines',id,data:{deleted:true}});return f.inside({responseCode:200,responseText:JSON.stringify({data:[{code:'SUCCESS'}]})});};
 const source=fs.readFileSync(accountingEnabled ? 'crm/accounting-paused/backups/supplierinvoiceedit_applyaccounting.dg' : 'crm/invoice-edit/supplierInvoiceEdit_applyAccounting.dg','utf8').replace('accountingGenerationEnabled = false;', 'accountingGenerationEnabled = '+accountingEnabled+';').replace(/for each\s+(\w+) in ([^{\n]+)\s*\{/g,'for each $1 in $2\n{');
 vm.runInContext(transpile(source),f.ctx);
 f.ctx.standalone.supplierInvoiceEdit_applyAccounting=(...args)=>f.ctx.supplierInvoiceEdit_applyAccounting(...args);
 return f;
}

test('production pause edits invoice amounts without planning or writing accounting records',()=>{
 const f=accountingFixture(false);
 const before=JSON.stringify([f.database.Accounting_Entries,f.database.Accounting_Entry_Lines]);
 f.ctx.standalone.supplierInvoiceEdit_accountingPlan=()=>{throw Error('Accounting planning must remain paused');};
 const r=f.run();assert.equal(r.success,true,r.message);
 assert.equal(f.database.Supplier_Invoices['1'].Total_Payable_Amount,120);
 assert.equal(JSON.stringify([f.database.Accounting_Entries,f.database.Accounting_Entry_Lines]),before);
 assert.ok(f.writes.every(w=>!w.m.startsWith('Accounting_')));
});

test('source-linked invoice edits and resumes without copying a document from its card purchase',()=>{
 const f=setup(false,false);f.database.Supplier_Invoices['1'].Invoice_File=[];
 f.database.Card_Purchases['50']={id:'50',Modified_Time:'v1',Vendor_Invoice:{id:'1'},Supporting_Documents:[{id:'source-file'}]};
 assert.equal(f.run({action:'preview',invoice_id:'1'}).source_documents,true);
 f.failures.rebuild=true;assert.equal(f.run().success,false);f.failures.rebuild=false;
 const r=f.run({action:'resume',invoice_id:'1'});assert.equal(r.success,true,r.message);
 assert.deepEqual(f.database.Supplier_Invoices['1'].Invoice_File,[]);
 assert.ok(f.writes.every(w=>!Object.hasOwn(w.data,'Invoice_File')));
});

test('source-linked proforma converts without moving source documents to the invoice',()=>{
 const f=setup(false,false);Object.assign(f.database.Supplier_Invoices['1'],{Invoice_Type:'Proforma',Invoice_File:[]});
 f.database.Card_Purchases['50']={id:'50',Modified_Time:'v1',Vendor_Invoice:{id:'1'}};
 const r=f.run({action:'convert_proforma',invoice_id:'1',modified_time:'v1',invoice_number:'FINAL',invoice_date:'2026-10-10',invoice_type:'Final Invoice'});
 assert.equal(r.success,true,r.message);assert.deepEqual(f.database.Supplier_Invoices['1'].Invoice_File,[]);
 assert.equal(f.database.Supplier_Invoices['1'].Invoice_Type,'Final Invoice');assert.ok(f.writes.every(w=>!Object.hasOwn(w.data,'Invoice_File')));
});

test('production pause retains payment accounting linkage while correcting payment amounts',()=>{
 const f=accountingFixture(false);correctPayment(f);
 f.database.Accounting_Entries['80']={id:'80',Name:'INV-INV1-VENDOR-PAY-4',Books_Post_Status:'Not Ready'};
 const before=JSON.stringify([f.database.Accounting_Entries,f.database.Accounting_Entry_Lines]);
 f.ctx.standalone.supplierInvoiceEdit_paymentAccountingPlan=()=>{throw Error('Payment accounting planning must remain paused');};
 const r=f.run();assert.equal(r.success,true,r.message);
 assert.equal(f.database.Supplier_Payments['4'].Payment_Amount,120);
 assert.equal(JSON.stringify([f.database.Accounting_Entries,f.database.Accounting_Entry_Lines]),before);
});

test('production pause blocks direct accounting application without writes',()=>{
 const f=accountingFixture(false);
 const r=JSON.parse(f.ctx.supplierInvoiceEdit_applyAccounting('8','1',key,'{}'));
 assert.equal(r.success,false);assert.equal(r.disabled,true);assert.equal(f.writes.length,0);
});

test('production pause does not resume a legacy pending accounting correction or claim completion',()=>{
 const legacy=accountingFixture();legacy.failures.rebuild=true;assert.equal(legacy.run().success,false);
 const f=accountingFixture(false);Object.assign(f.database,structuredClone(legacy.database));
 const r=f.run({action:'resume',invoice_id:'1'});
 assert.equal(r.success,false);assert.match(r.message,/removed/);
 assert.equal(f.writes.length,0);assert.equal(f.database.Supplier_Invoices['1'].Edit_Status,'Pending');
});
test('editing rebuilds an existing unposted accounting entry and preserves its id',()=>{
 const f=accountingFixture(),r=f.run();assert.equal(r.success,true,r.message);
 const rows=Object.values(f.database.Accounting_Entry_Lines);assert.equal(rows.reduce((s,l)=>s+l.Debit,0),120);assert.equal(rows.reduce((s,l)=>s+l.Credit,0),120);assert.equal(f.database.Accounting_Entries['8'].Total_Debit,120);assert.equal(Object.keys(f.database.Accounting_Entries).length,1);
});
test('a lost accounting-line creation response resumes without duplicated amounts',()=>{
 const f=accountingFixture();f.failures.lostLine=1;assert.equal(f.run().success,false);const r=f.run({action:'resume',invoice_id:'1'});assert.equal(r.success,true,r.message);const rows=Object.values(f.database.Accounting_Entry_Lines);assert.equal(rows.length,3);assert.equal(rows.reduce((s,l)=>s+l.Debit,0),120);assert.equal(rows.reduce((s,l)=>s+l.Credit,0),120);
});
test('new split relationships are rejected when resuming a partial correction',()=>{
 const f=setup();f.failures.rebuild=true;f.run();f.database.Inv_Set_Allocations['5'].Vendor_Settlement={id:'7'};f.database.Supplier_Settlements['7']={id:'7',Supplier:{id:'2'}};const count=f.writes.length;assert.equal(f.run({action:'resume',invoice_id:'1'}).success,false);assert.equal(f.writes.length,count);
});

test('a rejected header can be discarded, but a partially applied correction cannot',()=>{
 const f=setup();f.failures.header=1;const r=f.run();assert.equal(r.success,false);assert.equal(r.saved,false);assert.equal(f.database.Supplier_Invoices['1'].Reimbursable_Expense,0);
 const preview=f.run({action:'preview',invoice_id:'1'});assert.equal(preview.can_discard,true);assert.equal(f.run({action:'discard',invoice_id:'1'}).discarded,true);
 const g=setup();g.failures.rebuild=true;g.run();assert.equal(g.run({action:'discard',invoice_id:'1'}).success,false);
});
test('an active save lease prevents a second worker from applying the same edit',()=>{
 const f=setup();f.failures.rebuild=true;f.run();const invoice=f.database.Supplier_Invoices['1'],journal=JSON.parse(invoice.Edit_Request);journal.busy_until=2000000;invoice.Edit_Request=JSON.stringify(journal);const count=f.writes.length;assert.equal(f.run({action:'resume',invoice_id:'1'}).success,false);assert.equal(f.writes.length,count);
});
test('multiple settlement allocations are updated to the complete corrected payable',()=>{
 const f=setup();f.database.Inv_Set_Allocations['5'].Allocated_Amount=50;f.database.Inv_Set_Allocations['7']={id:'7',Modified_Time:'v1',Vendor_Invoice:{id:'1'},Vendor_Settlement:{id:'9'},Allocated_Amount:50,Status:'Active'};f.database.Supplier_Settlements['9']={id:'9',Supplier:{id:'2'},Total_Service_Cost:100,Total_Invoice:50};f.request.allocations={'3':60,'9':60};const r=f.run();assert.equal(r.success,true,r.message);assert.equal(f.database.Inv_Set_Allocations['5'].Allocated_Amount,60);assert.equal(f.database.Inv_Set_Allocations['7'].Allocated_Amount,60);
});
test('file replacement removes the old link and adds the new file in the same header write',()=>{
 const f=setup();f.request.file_id='file-corrected';f.request.remove_file_ids=['9'];
 const result=f.run();assert.equal(result.success,true,result.message);
 assert.equal(f.database.Supplier_Invoices['1'].Invoice_File.length,1);assert.equal(f.database.Supplier_Invoices['1'].Invoice_File[0].File_Id__s,'file-corrected');
 const commands=f.writes.find(w=>w.data.Invoice_File).data.Invoice_File;assert.deepEqual(commands,[{id:'9',_delete:null},{File_Id__s:'file-corrected'}]);
});
test('cannot append a second file, delete an unrelated file, repeat deletion, or leave the invoice without its document',()=>{
 for(const change of [{file_id:'new'},{file_id:'new',remove_file_ids:['999']},{file_id:'new',remove_file_ids:['9','9']},{remove_file_ids:['9']}]){
  const f=setup();Object.assign(f.request,change);assert.equal(f.run().success,false);assert.equal(f.writes.length,0);assert.equal(f.database.Supplier_Invoices['1'].Invoice_File[0].id,'9');
 }
});
test('a rejected replacement preserves the saved document and remains discardable',()=>{
 const f=setup();Object.assign(f.request,{file_id:'new',remove_file_ids:['9']});f.failures.header=1;
 assert.equal(f.run().success,false);assert.equal(f.database.Supplier_Invoices['1'].Invoice_File[0].id,'9');assert.equal(f.run({invoice_id:'1',action:'preview'}).can_discard,true);
 assert.equal(f.run({invoice_id:'1',action:'resume'}).success,true);
});
test('replacement resumes after a lost response without deleting or adding the file twice',()=>{
 const f=setup();Object.assign(f.request,{file_id:'new',remove_file_ids:['9']});f.failures.lostHeader=1;
 assert.equal(f.run().success,false);assert.equal(f.database.Supplier_Invoices['1'].Invoice_File[0].File_Id__s,'new');
 assert.equal(f.run({invoice_id:'1',action:'resume'}).success,true);
 assert.equal(f.writes.filter(w=>w.data.Invoice_File).length,1);
});
test('recovery refuses a document changed by another user',()=>{
 const f=setup();Object.assign(f.request,{file_id:'new',remove_file_ids:['9']});f.failures.header=1;f.run();
 f.database.Supplier_Invoices['1'].Invoice_File=[{id:'external',File_Id__s:'external'}];const count=f.writes.length;
 assert.equal(f.run({invoice_id:'1',action:'resume'}).success,false);assert.equal(f.writes.length,count);
});
test('legacy pending append provides a safe discard path instead of removing a file without consent',()=>{
 const f=setup();Object.assign(f.request,{file_id:'new',remove_file_ids:['9']});f.failures.header=1;f.run();
 const invoice=f.database.Supplier_Invoices['1'],journal=JSON.parse(invoice.Edit_Request);delete journal.file_before_ids;delete journal.file_remove_ids;delete journal.file_kept_ids;invoice.Edit_Request=JSON.stringify(journal);
 const result=f.run({invoice_id:'1',action:'resume'});assert.equal(result.success,false);assert.match(result.message,/Discard the unsaved correction/);assert.equal(invoice.Invoice_File[0].id,'9');
});

test('changed payable with a payment requires an explicit choice on the server',()=>{
 const f=setup();delete f.request.payment_action;assert.equal(f.run().success,false);assert.equal(f.writes.length,0);
});
function correctPayment(f){Object.assign(f.request,{payment_action:'correct',payment_id:'4',confirm_actual_payment:true});}
test('confirmed correction updates payment, allocation, paid amount and invoice status together',()=>{
 const f=setup();correctPayment(f);const r=f.run();assert.equal(r.success,true,r.message);
 assert.equal(f.database.Supplier_Payments['4'].Payment_Amount,120);assert.equal(f.database.Supplier_Pay_Allocations['6'].Allocated_Amount,120);
 assert.equal(f.database.Supplier_Invoices['1'].Amount_Paid,120);assert.equal(f.database.Supplier_Invoices['1'].Status,'Paid');assert.equal(f.database.Inv_Set_Allocations['5'].Allocated_Amount,120);
 const writes=f.writes.length;assert.equal(f.run().success,true);assert.equal(f.writes.length,writes);
});
test('payment correction can reduce an incorrectly recorded payment without creating a refund',()=>{
 const f=setup();correctPayment(f);f.request.fields.Invoice_Amount_Excl_VAT=60;f.request.allocations['3']=80;
 const r=f.run();assert.equal(r.success,true,r.message);assert.equal(f.database.Supplier_Payments['4'].Payment_Amount,80);assert.equal(f.database.Supplier_Invoices['1'].Amount_Paid,80);
});
test('a shared payment retains every other invoice allocation and amount paid',()=>{
 const f=setup();correctPayment(f);f.database.Supplier_Invoices['20']={id:'20',Modified_Time:'other1',Amount_Paid:50,Status:'Paid'};
 f.database.Supplier_Pay_Allocations['21']={id:'21',Modified_Time:'other2',Supplier_Payment:{id:'4'},Supplier_Invoice:{id:'20'},Allocated_Amount:50};
 f.database.Supplier_Payments['4'].Payment_Amount=150;const before=structuredClone(f.database.Supplier_Invoices['20']);
 const r=f.run();assert.equal(r.success,true,r.message);assert.equal(f.database.Supplier_Payments['4'].Payment_Amount,170);assert.equal(f.database.Supplier_Pay_Allocations['21'].Allocated_Amount,50);assert.deepEqual(f.database.Supplier_Invoices['20'],before);
});
test('payment correction requires actual-payment confirmation, a related eligible payment and reconciled totals',()=>{
 for(const change of [f=>f.request.confirm_actual_payment=false,f=>f.request.payment_id='99',f=>f.database.Supplier_Payments['4'].Status='Reconciled',f=>f.database.Supplier_Payments['4'].Accounting_Status='Posted',f=>f.database.Supplier_Payments['4'].Zoho_Books_Payment_ID='posted',f=>f.database.Supplier_Payments['4'].Payment_Amount=99]){
  const f=setup();correctPayment(f);change(f);const r=f.run();assert.equal(r.success,false);assert.equal(f.writes.length,0,r.message);
 }
});
test('both lost payment responses resume without doubling an amount',()=>{
 for(const failure of ['lostSupplier_Pay_Allocations','lostSupplier_Payments','Supplier_Payments']){
  const f=setup();correctPayment(f);f.failures[failure]=1;let r=f.run();assert.equal(r.success,false);assert.equal(r.saved,true);
  assert.equal(f.run({action:'discard',invoice_id:'1'}).success,false);
  r=f.run({action:'resume',invoice_id:'1'});assert.equal(r.success,true,r.message);assert.equal(f.database.Supplier_Payments['4'].Payment_Amount,120);assert.equal(f.database.Supplier_Pay_Allocations['6'].Allocated_Amount,120);
 }
});
test('external payment edits during recovery are not overwritten',()=>{
 const f=setup();correctPayment(f);f.failures.Supplier_Payments=1;f.run();f.database.Supplier_Payments['4'].Payment_Amount=110;const count=f.writes.length;assert.equal(f.run({action:'resume',invoice_id:'1'}).success,false);assert.equal(f.writes.length,count);
});
test('additional payment action saves a partial invoice and creates no payment before payment form confirmation',()=>{
 const f=setup();f.request.payment_action='additional';const r=f.run();assert.equal(r.success,true,r.message);assert.equal(r.payment_action,'additional');assert.equal(f.database.Supplier_Invoices['1'].Status,'Partially Paid');assert.equal(f.database.Supplier_Invoices['1'].Amount_Paid,100);assert.equal(f.database.Supplier_Payments['4'].Payment_Amount,100);assert.equal(Object.keys(f.database.Supplier_Payments).length,1);assert.equal(f.run().payment_action,'additional');
});
test('posted payment accounting blocks the edit before changing the invoice, even when keeping the payment',()=>{
 const f=setup();f.database.Accounting_Entries['80']={id:'80',Name:'INV-INV1-VENDOR-PAY-4',Books_Post_Status:'Posted'};
 const r=f.run();assert.equal(r.success,false);assert.match(r.message,/payment accounting entry/);assert.equal(f.writes.length,0);
});
function additionalFixture(){
 const f=setup();f.request.payment_action='additional';assert.equal(f.run().success,true);
 f.database.Payment_Accounts={'30':{id:'30',Status:'Active',Owner_Type:'Own'},'31':{id:'31',Owner_Type:'Supplier',Owner_Supplier:{id:'2'},Allowed_For_Supplier_Payments:true,Status:'Active'}};
 let next=300;
 f.ctx.zoho.crm.createRecord=(m,values)=>{
  const data=JSON.parse(JSON.stringify(values)),old=Object.values(f.database[m]).find(row=>row.Invoice_Edit_Key===data.Invoice_Edit_Key);
  if(old)return f.inside({code:'DUPLICATE_DATA',details:{id:old.id}});
  const id=String(next++);for(const field of ['Supplier_Payment','Supplier_Invoice','Supplier','Supplier_Settlement','Payment_Account','Booking'])if(data[field])data[field]={id:data[field]};
  f.database[m][id]={...data,id,Modified_Time:'new1'};f.writes.push({m,id,data});
  if(f.failures['create'+m]){f.failures['create'+m]--;throw Error('Lost create response');}return f.inside({id});
 };
 const request={action:'add_payment',invoice_id:'1',modified_time:f.database.Supplier_Invoices['1'].Modified_Time,payment_details:{Name:'Extra payment',Payment_Amount:20,Payment_Date:'2026-10-13',Payment_Account:'30',Payment_Accounts_By_Supplier:{'2':'31'},Status:'Paid'}};
 return {...f,additional:()=>f.run(request,'22222222-2222-4222-8222-222222222222'),resumeAdditional:()=>f.run({action:'resume',invoice_id:'1'},'22222222-2222-4222-8222-222222222222'),additionalRequest:request};
}
test('confirmed additional payment is created once and updates all invoice and settlement amounts',()=>{
 const f=additionalFixture(),r=f.additional();assert.equal(r.success,true,r.message);assert.ok(r.payment_id);assert.equal(f.database.Supplier_Invoices['1'].Amount_Paid,120);assert.equal(f.database.Supplier_Invoices['1'].Status,'Paid');
 assert.equal(f.database.Supplier_Payments['4'].Payment_Amount,100);assert.equal(f.database.Supplier_Payments[r.payment_id].Payment_Amount,20);
 const count=f.writes.length;assert.equal(f.additional().payment_id,r.payment_id);assert.equal(f.writes.length,count);
});
test('lost creation responses for additional payment and allocation recover by unique key',()=>{
 for(const module of ['Supplier_Payments','Supplier_Pay_Allocations']){
  const f=additionalFixture();f.failures['create'+module]=1;const r=f.additional();assert.equal(r.success,false);assert.equal(r.saved,true);
  const retried=f.resumeAdditional();assert.equal(retried.success,true,retried.message);assert.equal(Object.keys(f.database.Supplier_Payments).length,2);assert.equal(Object.keys(f.database.Supplier_Pay_Allocations).length,2);assert.equal(f.database.Supplier_Invoices['1'].Amount_Paid,120);
 }
});
test('additional payment rejects excess, invalid account, stale invoice and unconfirmed paid status before writes',()=>{
 for(const change of [f=>f.additionalRequest.payment_details.Payment_Amount=21,f=>f.additionalRequest.payment_details.Payment_Account='999',f=>f.additionalRequest.modified_time='stale',f=>f.additionalRequest.payment_details.Status='Planned']){
  const f=additionalFixture();change(f);const count=f.writes.length;const r=f.additional();assert.equal(r.success,false);assert.equal(f.writes.length,count,r.message);
 }
});
function paymentAccountingFixture(){
 const f=accountingFixture();
 Object.assign(f.database.Supplier_Payments['4'],{Payment_Date:'2026-10-10',Payment_Account:{id:'30'}});
 f.database.Vendors['2'].Default_Accounting_Account={id:'21'};
 f.database.Payment_Accounts={'30':{id:'30',Accounting_Account:{id:'23'}}};
 f.database.Accounting_Accounts={'21':{id:'21'},'23':{id:'23'}};
 f.database.Accounting_Entries['80']={id:'80',Name:'INV-INV1-VENDOR-PAY-4',Modified_Time:'p-entry-1',Books_Post_Status:'Not Ready',Source_Date:'2026-10-10',Total_Debit:100,Total_Credit:100,Line_Count:2};
 f.database.Accounting_Entry_Lines['81']={id:'81',Modified_Time:'p-line-1',Accounting_Entry:{id:'80'},Supplier_Invoice:{id:'1'},Account:{id:'21'},Debit:100,Credit:0};
 f.database.Accounting_Entry_Lines['82']={id:'82',Modified_Time:'p-line-2',Accounting_Entry:{id:'80'},Supplier_Invoice:{id:'1'},Account:{id:'23'},Debit:0,Credit:100};
 const source=fs.readFileSync('crm/invoice-edit/backups/supplierInvoiceEdit_paymentAccountingPlan.before-removal-20261016.dg','utf8').replace(/for each\s+(\w+) in ([^{\n]+)\s*\{/g,'for each $1 in $2\n{');
 vm.runInContext(transpile(source).replace(/([=+]) if\(/g,'$1 choose('),f.ctx);
 f.ctx.standalone.supplierInvoiceEdit_paymentAccountingPlan=(...args)=>{const result=f.ctx.supplierInvoiceEdit_paymentAccountingPlan(...args);return typeof result==='string'?result:JSON.stringify(result);};
 return f;
}
test('keeping payment recalculates its reimbursable split with the production accounting rules',()=>{
 const f=paymentAccountingFixture(),r=f.run();assert.equal(r.success,true,r.message);
 const lines=Object.values(f.database.Accounting_Entry_Lines).filter(l=>l.Accounting_Entry.id==='80');
 assert.equal(lines.length,3);assert.equal(lines.find(l=>l.Is_Reimbursable).Credit,16.67);assert.equal(lines.reduce((s,l)=>s+l.Credit,0),100);assert.equal(lines.reduce((s,l)=>s+l.Debit,0),100);
});
test('correcting payment rebuilds invoice and payment accounting separately',()=>{
 const f=paymentAccountingFixture();correctPayment(f);const r=f.run();assert.equal(r.success,true,r.message);
 const lines=Object.values(f.database.Accounting_Entry_Lines).filter(l=>l.Accounting_Entry.id==='80');
 assert.equal(lines.find(l=>l.Is_Reimbursable).Credit,20);assert.equal(lines.reduce((s,l)=>s+l.Credit,0),120);assert.equal(lines.reduce((s,l)=>s+l.Debit,0),120);
 assert.equal(f.database.Accounting_Entries['8'].Total_Debit,120);assert.equal(f.database.Accounting_Entries['80'].Total_Debit,120);
});
function proformaFixture(legacy = true){
 const f=setup(legacy);f.database.Supplier_Invoices['1'].Invoice_Type='Proforma';
 f.request={action:'convert_proforma',invoice_id:'1',modified_time:'v1',invoice_type:'Final Invoice',invoice_number:'INV-FINAL',file_id:'final-file',remove_file_ids:['9']};
 return {...f,convert:()=>f.run(f.request)};
}

test('dedicated conversion reads only document references and never reads or updates financial relationships',()=>{
 const f=proformaFixture(false),before=structuredClone(f.database),reads=[];
 const original=f.ctx.standalone.supplierInvoiceEdit_read;
 f.ctx.standalone.supplierInvoiceEdit_read=(m,...args)=>{reads.push(m);assert.ok(['Card_Purchases','Accounting_Entries'].includes(m));return original(m,...args);};
 f.ctx.standalone.supplierInvoiceEdit_payments=()=>{throw Error('Financial path forbidden');};
 f.ctx.standalone.rebuildSupplierSettlementTotals=()=>{throw Error('Settlement path forbidden');};
 f.request.fields={Reimbursable_Expense:999};f.request.allocations={'3':999};f.request.payment_action='correct';
 const result=f.convert();assert.equal(result.success,true,result.message);assert.deepEqual(reads,['Card_Purchases','Accounting_Entries']);
 for(const module of ['Supplier_Settlements','Supplier_Payments','Supplier_Pay_Allocations','Inv_Set_Allocations'])assert.deepEqual(f.database[module],before[module]);
 assert.equal(f.database.Supplier_Invoices['1'].Total_Payable_Amount,100);
 assert.ok(f.writes.every(w=>w.m==='Supplier_Invoices'));
 const count=f.writes.length;assert.equal(f.convert().success,true);assert.equal(f.writes.length,count);
});

test('conversion preview reads just the invoice and validates required inputs before writes',()=>{
 const f=proformaFixture(false);f.ctx.standalone.supplierInvoiceEdit_read=()=>{throw Error('No related reads on preview');};
 assert.equal(f.run({action:'preview_conversion',invoice_id:'1'}).success,true);
 for(const change of [f=>f.request.invoice_number='',f=>f.request.invoice_type='Tickets',f=>f.request.file_id='',f=>f.request.invoice_date='2026-02-30',f=>f.request.modified_time='stale']){
  const item=proformaFixture(false);change(item);assert.equal(item.convert().success,false);assert.equal(item.writes.length,0);
 }
});

test('dedicated conversion resumes lost header responses without reuploading or depending on the expired upload',()=>{
 const f=proformaFixture(false);f.failures.remapFiles=true;f.failures.lostHeader=1;
 assert.equal(f.convert().success,false);const invoke=f.ctx.invoke;
 f.ctx.invoke=options=>{assert.ok(!options.url.includes('/files?'));return invoke(options);};
 const result=f.run({action:'resume',invoice_id:'1'});assert.equal(result.success,true,result.message);
 assert.equal(f.writes.filter(w=>w.data.Invoice_File).length,1);
});

test('conversion updates copied references in bounded batches, without rebuilding accounting lines',()=>{
 const f=proformaFixture(false);
 for(let n=0;n<12;n++)f.database.Card_Purchases[String(100+n)]={id:String(100+n),Modified_Time:'v1',Vendor_Invoice:{id:'1'},Invoice_Number:'OLD'};
 f.database.Accounting_Entries['80']={id:'80',Modified_Time:'v1',Supplier_Invoice:{id:'1'},Accounting_Status:'Ready to Review',Total_Debit:100,Name:'OLD',Entry_Date:'2026-10-09'};
 f.request.invoice_date='2026-10-14';
 const first=f.convert();assert.equal(first.pending,true,first.message);
 assert.equal(f.writes.filter(w=>w.m==='Card_Purchases').length,10);
 finishBatches(f,first);
 assert.equal(f.database.Accounting_Entries['80'].Entry_Date,'2026-10-14');
 assert.equal(f.database.Accounting_Entries['80'].Total_Debit,100);
 assert.equal(f.database.Accounting_Entries['80'].Accounting_Status,'Ready to Review');
 assert.ok(f.writes.every(w=>['Supplier_Invoices','Card_Purchases','Accounting_Entries'].includes(w.m)));
});

test('conversion rejects posted accounting and changed saved documents',()=>{
 const posted=proformaFixture(false);posted.database.Accounting_Entries['80']={id:'80',Supplier_Invoice:{id:'1'},Posted_At:'2026-10-14'};
 assert.equal(posted.convert().success,false);assert.equal(posted.writes.length,0);
 const f=proformaFixture(false);f.failures.remapFiles=true;f.failures.lostHeader=1;f.convert();
 f.fileContents[f.database.Supplier_Invoices['1'].Invoice_File[0].id]='wrong';
 const result=f.run({action:'resume',invoice_id:'1'});assert.equal(result.success,false);assert.match(result.message,/does not match/);
 assert.equal(f.database.Supplier_Invoices['1'].Edit_Status,'Pending');
});
test('quick conversion replaces the proforma document and retains invoice identity, date, amounts and payments',()=>{
 const f=proformaFixture(),before=structuredClone(f.database.Supplier_Invoices['1']);const r=f.convert();assert.equal(r.success,true,r.message);
 const after=f.database.Supplier_Invoices['1'];assert.equal(after.id,before.id);assert.equal(after.Invoice_Type,'Final Invoice');assert.equal(after.Name,'INV-FINAL');assert.equal(after.Invoice_File.length,1);assert.equal(after.Invoice_File[0].File_Id__s,'final-file');
 for(const field of ['Invoice_Date','Invoice_Total','Total_Payable_Amount','Amount_Paid','Invoice_Amount_Excl_VAT','Reimbursable_Expense','Status'])assert.equal(after[field],before[field],field);
 assert.equal(f.database.Supplier_Payments['4'].Payment_Amount,100);
});
test('conversion server requires Proforma, Final Invoice target, a number and a new replacement file',()=>{
 for(const change of [f=>f.database.Supplier_Invoices['1'].Invoice_Type='Final Invoice',f=>f.request.invoice_type='Tickets',f=>f.request.invoice_number=' ',f=>delete f.request.file_id,f=>f.request.file_id='file-original',f=>f.request.modified_time='stale']){
  const f=proformaFixture();change(f);const r=f.convert();assert.equal(r.success,false);assert.equal(f.writes.length,0,r.message);
 }
});
test('conversion ignores injected financial changes and preserves a chosen existing number',()=>{
 const f=proformaFixture();f.request.invoice_number='INV1';f.request.fields={Reimbursable_Expense:100,Invoice_Date:'2000-01-01'};f.request.allocations={'3':200};f.request.payment_action='correct';const r=f.convert();assert.equal(r.success,true,r.message);const invoice=f.database.Supplier_Invoices['1'];assert.equal(invoice.Name,'INV1');assert.equal(invoice.Invoice_Date,'2026-10-09');assert.equal(invoice.Total_Payable_Amount,100);
});
test('conversion retry after a lost header response does not replace the file twice',()=>{
 const f=proformaFixture();f.failures.lostHeader=1;assert.equal(f.convert().success,false);const r=f.convert();assert.equal(r.success,true,r.message);assert.equal(f.writes.filter(w=>w.data.Invoice_File).length,1);const count=f.writes.length;assert.equal(f.convert().success,true);assert.equal(f.writes.length,count);
});
test('rejected conversion header retains the original type, number and document',()=>{
 const f=proformaFixture();f.failures.header=1;assert.equal(f.convert().success,false);const invoice=f.database.Supplier_Invoices['1'];assert.equal(invoice.Invoice_Type,'Proforma');assert.equal(invoice.Name,'INV1');assert.equal(invoice.Invoice_File[0].File_Id__s,'file-original');assert.equal(f.run({action:'preview',invoice_id:'1'}).can_discard,true);
});
test('final number suggestions stop after the MFSP and trailing hyphen',()=>{
 const suggest=window.AccountingManagerApp.proposeFinalInvoiceNumber;
 assert.equal(suggest('PROF-MFSP123-SUP1-2'),'INV-MFSP123-');assert.equal(suggest('PF123'),'INV-PF123-');assert.equal(suggest('PROF-MFSP-123-SUP1-2'),'INV-MFSP-123-');assert.equal(suggest('custom-name', 'MFSP456'),'INV-MFSP456-');assert.equal(suggest('X'.repeat(120)).length,120);
});

test('conversion saves the selected date and rejects empty or invalid dates before writes',()=>{
 const f=proformaFixture();f.request.invoice_date='2026-10-13';assert.equal(f.convert().success,true);assert.equal(f.database.Supplier_Invoices['1'].Invoice_Date,'2026-10-13');
 for(const value of ['',null,'invalid','2026-02-30']) { const f=proformaFixture();f.request.invoice_date=value;assert.equal(f.convert().success,false);assert.equal(f.writes.length,0); }
});

test('conversion replaces all saved documents automatically, including legacy attachment identifiers',()=>{
 for(const legacy of [false,true]) {
 const f=proformaFixture();delete f.request.remove_file_ids;
 if(legacy) f.database.Supplier_Invoices['1'].Invoice_File=[{attachment_Id:'9',file_Id:'file-original',file_Name:'proforma.pdf'}];
 assert.equal(f.convert().success,true);const header=f.writes.find(w=>w.data.Invoice_File).data;
 assert.deepEqual(header.Invoice_File,[{id:'9',_delete:null},{File_Id__s:'final-file'}]);assert.equal(f.database.Supplier_Invoices['1'].Invoice_File.length,1);
 }
});
test('automatic replacement resolves removals on the server and rejects missing identifiers before writes',()=>{
 const f=proformaFixture();f.request.remove_file_ids=['unrelated'];assert.equal(f.convert().success,true);assert.equal(f.writes.find(w=>w.data.Invoice_File).data.Invoice_File[0].id,'9');
 const missing=proformaFixture();delete missing.database.Supplier_Invoices['1'].Invoice_File[0].id;assert.equal(missing.convert().success,false);assert.equal(missing.writes.length,0);
});

function finishBatches(f,result,onBatch=()=>{}) {
 let count=0;
 while(result.pending){assert.ok(count++<150,'batch progress must terminate');onBatch(result,count);result=f.run({action:'resume',invoice_id:'1'});}
 assert.equal(result.success,true,result.message);return count;
}
function largeAccountingFixture(){
 const f=paymentAccountingFixture();correctPayment(f);f.request.batch=true;
 const lines=Array.from({length:80},()=>({account_id:'20',debit:1.5,credit:0,line_type:'Expense',account_role:'Base Expense',is_irpf_line:false,is_reimbursable:false}));
 lines.push({account_id:'21',debit:0,credit:120,line_type:'Supplier',account_role:'Supplier Payable',is_irpf_line:false,is_reimbursable:false});
 f.ctx.standalone.supplierInvoiceEdit_accountingPlan=()=>JSON.stringify({error:false,entry:{Name:'Corrected entry',Books_Post_Status:'Not Ready',Total_Debit:120,Total_Credit:120,Line_Count:81,Source_Date:'2026-10-09'},lines});
 // Many original lines reproduce the plan-size failure with actual snapshots.
 for(let i=0;i<150;i++)f.database.Accounting_Entry_Lines[String(1000+i)]={id:String(1000+i),Modified_Time:'v1',Accounting_Entry:{id:'8'},Account:{id:'20',name:'Expense account'},Debit:0,Credit:0};
 return f;
}
test('batched correction resumes all stages and only completes after related totals are verified',()=>{
 const f=paymentAccountingFixture();correctPayment(f);f.request.batch=true;
 const count=finishBatches(f,f.run(),()=>assert.equal(f.database.Supplier_Invoices['1'].Edit_Status,'Pending'));
 assert.ok(count>=6);assert.equal(f.database.Supplier_Invoices['1'].Edit_Status,'Complete');assert.equal(f.database.Supplier_Payments['4'].Payment_Amount,120);assert.equal(f.database.Inv_Set_Allocations['5'].Allocated_Amount,120);
});
test('large plans are stored in verified parts and accounting writes are bounded on every resume',()=>{
 const f=largeAccountingFixture();let result=f.run();assert.equal(result.pending,true,result.message);
 const manifest=JSON.parse(f.database.Supplier_Invoices['1'].Edit_Request);assert.equal(manifest.storage,'parts_v1');assert.ok(manifest.parts.length>3);assert.ok(f.database.Supplier_Invoices['1'].Edit_Request.length<30000);
 let before=f.writes.length;const count=finishBatches(f,result,()=>{const changes=f.writes.slice(before).filter(w=>w.m==='Accounting_Entry_Lines');assert.ok(changes.length<=10);before=f.writes.length;});
 assert.ok(count>15);assert.equal(f.database.Accounting_Entries['8'].Total_Debit,120);assert.equal(Object.values(f.database.Accounting_Entry_Lines).filter(l=>l.Accounting_Entry.id==='8').length,81);
 const writes=f.writes.length;assert.equal(f.run({action:'resume',invoice_id:'1'}).success,true);assert.equal(f.writes.length,writes);
});
test('plan storage lost responses reuse unique parts and never apply an invoice before the complete plan is stored',()=>{
 const f=largeAccountingFixture();f.failures.lostPart=1;assert.equal(f.run().success,false);assert.equal(f.database.Supplier_Invoices['1'].Edit_Status,undefined);
 const partIds=Object.keys(f.database.Admin_Process_Jobs);assert.equal(partIds.length,1);
 const r=f.run();assert.equal(r.pending,true,r.message);assert.ok(JSON.parse(f.database.Supplier_Invoices['1'].Edit_Request).parts.includes(partIds[0]));finishBatches(f,r);
});
test('missing or altered plan parts stop recovery without financial writes',()=>{
 for(const tamper of ['missing','changed']){
 const f=largeAccountingFixture();assert.equal(f.run().pending,true);const manifest=JSON.parse(f.database.Supplier_Invoices['1'].Edit_Request);
 if(tamper==='missing')delete f.database.Admin_Process_Jobs[manifest.parts[0]];else f.database.Admin_Process_Jobs[manifest.parts[0]].Payload_JSON=JSON.stringify({chunk:'changed'});
 const before=f.writes.length;const result=f.run({action:'resume',invoice_id:'1'});assert.equal(result.success,false);assert.equal(f.writes.length,before);
 }
});
test('batched correction rejects external payment changes and a second operation key',()=>{
 const f=paymentAccountingFixture();correctPayment(f);f.request.batch=true;assert.equal(f.run().pending,true);
 const before=f.writes.length;assert.equal(f.run({action:'resume',invoice_id:'1'},'22222222-2222-4222-8222-222222222222').success,false);assert.equal(f.writes.length,before);
 f.database.Supplier_Payments['4'].Payment_Amount=105;assert.equal(f.run({action:'resume',invoice_id:'1'}).success,false);assert.equal(f.database.Supplier_Payments['4'].Payment_Amount,105);
});
test('batched lost accounting creation and header responses resume without duplicates',()=>{
 const f=largeAccountingFixture();f.failures.lostHeader=1;assert.equal(f.run().success,false);
 let r=f.run({action:'resume',invoice_id:'1'});assert.equal(r.pending,true,r.message);f.failures.lostLine=1;
 r=f.run({action:'resume',invoice_id:'1'});assert.equal(r.success,false);finishBatches(f,f.run({action:'resume',invoice_id:'1'}));
 const keys=Object.values(f.database.Accounting_Entry_Lines).map(l=>l.Invoice_Edit_Key);assert.equal(new Set(keys).size,keys.length);
});

test('completed accounting stages are verified again before completing the invoice',()=>{
 const f=paymentAccountingFixture();correctPayment(f);f.request.batch=true;
 let r=f.run();while(r.pending && r.progress.stage!=='verify')r=f.run({action:'resume',invoice_id:'1'});
 assert.equal(r.progress.stage,'verify');const line=Object.values(f.database.Accounting_Entry_Lines).find(l=>l.Accounting_Entry.id==='80');line.Debit+=1;
 const last=f.run({action:'resume',invoice_id:'1'});assert.equal(last.success,false);assert.equal(f.database.Supplier_Invoices['1'].Edit_Status,'Pending');
});
test('settlement allocations are applied in batches of at most ten and recalculated individually',()=>{
 const f=setup();f.request.batch=true;f.request.allocations={'3':15};f.database.Inv_Set_Allocations['5'].Allocated_Amount=16;
 for(let n=0;n<21;n++){const sid=String(100+n),aid=String(200+n);f.database.Supplier_Settlements[sid]={id:sid,Supplier:{id:'2'},Total_Service_Cost:100,Total_Invoice:4};f.database.Inv_Set_Allocations[aid]={id:aid,Modified_Time:'v1',Vendor_Invoice:{id:'1'},Vendor_Settlement:{id:sid},Allocated_Amount:4,Status:'Active'};f.request.allocations[sid]=5;}
 const rebuilt=[];f.ctx.standalone.rebuildSupplierSettlementTotals=id=>{rebuilt.push(id);return JSON.stringify({error:false,warning_count:0});};
 let before=0;finishBatches(f,f.run(),()=>{assert.ok(f.writes.slice(before).filter(w=>w.m==='Inv_Set_Allocations').length<=10);before=f.writes.length;});
 assert.equal(new Set(rebuilt).size,22);assert.equal(rebuilt.length,22);assert.equal(Object.values(f.database.Inv_Set_Allocations).reduce((n,r)=>n+r.Allocated_Amount,0),120);
});

test('conversion includes the existing reimbursable expense in a legacy single-settlement allocation without changing the paid amount',()=>{
 const f=proformaFixture();f.request.batch=true;
 Object.assign(f.database.Supplier_Invoices['1'],{Invoice_Amount_Excl_VAT:193,VAT_percentage:21,IRPF_percentage:15,Invoice_Total:204.58,Reimbursable_Expense:60,Total_Payable_Amount:264.58,Amount_Paid:264.58});
 f.database.Inv_Set_Allocations['5'].Allocated_Amount=204.58;Object.assign(f.database.Supplier_Settlements['3'],{Total_Service_Cost:342,Total_Invoice:204.58});
 f.database.Supplier_Pay_Allocations['6'].Allocated_Amount=264.58;f.database.Supplier_Payments['4'].Payment_Amount=264.58;
 finishBatches(f,f.convert());const invoice=f.database.Supplier_Invoices['1'];
 assert.equal(f.database.Inv_Set_Allocations['5'].Allocated_Amount,264.58);assert.equal(invoice.Invoice_Total,204.58);assert.equal(invoice.Reimbursable_Expense,60);assert.equal(invoice.Total_Payable_Amount,264.58);assert.equal(invoice.Amount_Paid,264.58);assert.equal(invoice.Status,'Paid');assert.equal(invoice.Invoice_Type,'Final Invoice');assert.equal(f.database.Supplier_Payments['4'].Payment_Amount,264.58);
});

test('Zoho may remap the uploaded file ID: batched conversion verifies the bytes and completes without another upload',()=>{
 const f=proformaFixture();f.request.batch=true;f.failures.remapFiles=true;
 f.fileContents['final-file']='%PDF\u0000\u00ff identical binary content';
 const first=f.convert();assert.equal(first.pending,true,first.message);
 assert.match(f.database.Supplier_Invoices['1'].Invoice_File[0].File_Id__s,/qakpv/);
 finishBatches(f,first);assert.equal(f.database.Supplier_Invoices['1'].Edit_Status,'Complete');
 assert.equal(f.writes.filter(w=>w.data.Invoice_File).length,1);
});

test('legacy Applied journal without a digest resumes by verifying original upload against saved attachment',()=>{
 const f=proformaFixture();f.request.batch=true;f.failures.remapFiles=true;
 const first=f.convert();assert.equal(first.pending,true);
 const journal=JSON.parse(f.database.Supplier_Invoices['1'].Edit_Request);delete journal.file_digest;
 f.database.Supplier_Invoices['1'].Edit_Request=JSON.stringify(journal);
 finishBatches(f,first);assert.equal(f.database.Supplier_Invoices['1'].Edit_Status,'Complete');
 assert.equal(f.writes.filter(w=>w.data.Invoice_File).length,1);
});

test('a remapped file with different bytes is rejected, even with an unchanged attachment ID and size',()=>{
 const f=proformaFixture();f.request.batch=true;f.failures.remapFiles=true;
 const first=f.convert();assert.equal(first.pending,true);
 const file=f.database.Supplier_Invoices['1'].Invoice_File[0];
 f.fileContents[file.id]='wrong-file';
 const writes=f.writes.length,r=f.run({action:'resume',invoice_id:'1'});
 assert.equal(r.success,false);assert.match(r.message,/differs/);assert.equal(f.writes.length,writes);
});

test('file verification read errors never authorize replacement or recovery',()=>{
 const before=proformaFixture();before.failures.fileRead=true;const r=before.convert();assert.equal(r.success,false);assert.equal(before.writes.length,0);
 const after=proformaFixture();after.request.batch=true;after.failures.remapFiles=true;after.convert();after.failures.fileRead=true;
 const writes=after.writes.length;assert.equal(after.run({action:'resume',invoice_id:'1'}).success,false);assert.equal(after.writes.length,writes);
});

test('document verification reports missing connection scopes without writing or removing files',()=>{
 const f=proformaFixture();f.failures.fileResponse={status:401,body:{code:'OAUTH_SCOPE_MISMATCH'}};
 const result=f.convert();
 assert.equal(result.success,false);assert.match(result.message,/original uploaded document.*HTTP 401, OAUTH_SCOPE_MISMATCH/);
 assert.match(result.message,/crm_oauth_connection with ZohoCRM.Files.READ/);assert.equal(f.writes.length,0);
});

test('unavailable legacy upload is distinguished from permission errors and does not change the pending invoice',()=>{
 const f=proformaFixture();f.request.batch=true;f.failures.remapFiles=true;f.convert();
 const invoice=f.database.Supplier_Invoices['1'],journal=JSON.parse(invoice.Edit_Request);delete journal.file_digest;invoice.Edit_Request=JSON.stringify(journal);
 f.failures.fileResponse={status:204,body:null};const before=JSON.stringify(invoice),writes=f.writes.length;
 const result=f.run({action:'resume',invoice_id:'1'});
 assert.equal(result.success,false);assert.match(result.message,/original upload is no longer available/);
 assert.equal(JSON.stringify(invoice),before);assert.equal(f.writes.length,writes);
});

test('explicit review recovers a legacy applied document without reuploading or changing amounts',()=>{
 const f=proformaFixture();f.request.batch=true;f.failures.remapFiles=true;f.convert();
 const invoice=f.database.Supplier_Invoices['1'],journal=JSON.parse(invoice.Edit_Request);delete journal.file_digest;invoice.Edit_Request=JSON.stringify(journal);
 const file=invoice.Invoice_File[0],originalInvoke=f.ctx.invoke;
 f.ctx.invoke=options=>options.url.includes('/files?')?f.inside({responseCode:204,responseText:null}):originalInvoke(options);
 const result=f.run({action:'resume',invoice_id:'1',confirm_saved_document:true,confirmed_attachment_id:file.id,modified_time:invoice.Modified_Time});
 assert.equal(result.pending,true,result.message);
 assert.equal(JSON.parse(invoice.Edit_Request).document_recovery.attachment_id,file.id);
 finishBatches(f,result);assert.equal(invoice.Edit_Status,'Complete');
 assert.equal(f.writes.filter(w=>w.data.Invoice_File).length,1);
});

test('document recovery rejects stale confirmation, wrong attachment and unreadable saved file',()=>{
 for(const failure of ['stale','wrong','unreadable']) {
  const f=proformaFixture();f.request.batch=true;f.failures.remapFiles=true;f.convert();
  const invoice=f.database.Supplier_Invoices['1'],journal=JSON.parse(invoice.Edit_Request);delete journal.file_digest;invoice.Edit_Request=JSON.stringify(journal);
  const request={action:'resume',invoice_id:'1',confirm_saved_document:true,confirmed_attachment_id:invoice.Invoice_File[0].id,modified_time:invoice.Modified_Time};
  if(failure==='stale')request.modified_time='old';if(failure==='wrong')request.confirmed_attachment_id='other';if(failure==='unreadable')f.failures.fileRead=true;
  const writes=f.writes.length;assert.equal(f.run(request).success,false);assert.equal(f.writes.length,writes);
 }
});

test('recovered document proof survives multipart storage and still detects later content changes',()=>{
 const f=largeAccountingFixture();f.request.file_id='new-file';f.request.remove_file_ids=['9'];f.failures.remapFiles=true;
 // Simulate a plan created by the older function that did not save a digest.
 const originalStore=f.ctx.standalone.supplierInvoiceEdit_journal;
 f.ctx.standalone.supplierInvoiceEdit_journal=(id,action,json)=>{
  if(action==='store'){const journal=JSON.parse(json);delete journal.file_digest;json=JSON.stringify(journal);}
  return originalStore(id,action,json);
 };
 f.run();const invoice=f.database.Supplier_Invoices['1'],file=invoice.Invoice_File[0];
 let result=f.run({action:'resume',invoice_id:'1',confirm_saved_document:true,confirmed_attachment_id:file.id,modified_time:invoice.Modified_Time});
 assert.equal(result.pending,true,result.message);assert.equal(JSON.parse(invoice.Edit_Request).storage,'parts_v1');
 assert.equal(JSON.parse(invoice.Edit_Request).document_recovery.attachment_id,file.id);
 f.fileContents[file.id]='changed externally';const writes=f.writes.length;
 result=f.run({action:'resume',invoice_id:'1'});assert.equal(result.success,false);assert.match(result.message,/differs/);assert.equal(f.writes.length,writes);
});

test('remapped document proof survives immutable multipart journals and accounting batches',()=>{
 const f=largeAccountingFixture();f.request.file_id='new-file';f.request.remove_file_ids=['9'];f.failures.remapFiles=true;
 const first=f.run();assert.equal(first.pending,true,first.message);
 assert.equal(JSON.parse(f.database.Supplier_Invoices['1'].Edit_Request).storage,'parts_v1');
 finishBatches(f,first);assert.equal(f.database.Supplier_Invoices['1'].Edit_Status,'Complete');
 assert.equal(f.writes.filter(w=>w.data.Invoice_File).length,1);
});
test('conversion does not guess the distribution of reimbursables across settlements or repair unrelated allocation differences',()=>{
 for(const multiple of [true,false]){
 const f=proformaFixture();Object.assign(f.database.Supplier_Invoices['1'],{Reimbursable_Expense:20,Total_Payable_Amount:120});f.database.Inv_Set_Allocations['5'].Allocated_Amount=70;
 if(multiple){f.database.Supplier_Settlements['30']={id:'30',Supplier:{id:'2'},Total_Service_Cost:100};f.database.Inv_Set_Allocations['50']={id:'50',Modified_Time:'v1',Vendor_Settlement:{id:'30'},Vendor_Invoice:{id:'1'},Status:'Active',Allocated_Amount:30};}
 const result=f.convert();assert.equal(result.success,false);assert.match(result.message,/Use Edit invoice/);assert.equal(f.writes.length,0);
 }
});

test('unchanged allocations and copied card references are checked without rewriting them', () => {
 const f=setup(); f.request.fields.Reimbursable_Expense=0; f.request.allocations={'3':100};
 f.database.Card_Purchases['8']={id:'8',Modified_Time:'c1',Vendor_Invoice:{id:'1'},Invoice_Number:'INV1'};
 const result=f.run(); assert.equal(result.success,true,result.message);
 assert.equal(f.writes.filter(w=>['Inv_Set_Allocations','Card_Purchases'].includes(w.m)).length,0);
});

test('an unpaid batched edit skips empty payment and accounting/card round trips', () => {
 const f=setup(); f.request.batch=true; f.database.Supplier_Pay_Allocations={};
 f.database.Supplier_Invoices['1'].Amount_Paid=0; f.database.Supplier_Invoices['1'].Status='Received';
 const stages=[]; let r=f.run(), calls=1;
 while(r.pending && calls<12){stages.push(r.progress.stage);r=f.run({action:'resume',invoice_id:'1'});calls++;}
 assert.equal(r.success,true,r.message); assert.equal(calls,4,JSON.stringify(stages));
 assert.equal(f.database.Supplier_Invoices['1'].Edit_Status,'Complete');
 assert.equal(f.database.Inv_Set_Allocations['5'].Allocated_Amount,120);
});
