const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const window={};vm.runInNewContext(fs.readFileSync('app/scripts/consistency-review.js','utf8'),{window});const ns=window.AccountingManagerApp;
function fixture(){
 const invoice=(id,booking,settlement,amount)=>({id,Name:'Invoice '+id,Booking:{id:booking},Supplier:{id:'50'},Supplier_Settlement:{id:settlement},Currency:'EUR',Status:'Paid',Invoice_Type:'Final Invoice',Total_Payable_Amount:amount,Amount_Paid:amount});
 const db={Deals:[{id:'1',Deal_Name:'Test',MFSP_Reference:'TEST-1'}],Supplier_Invoices:[invoice('10','1','20',100),invoice('11','2','21',200)],Supplier_Payments:[{id:'30',Name:'Shared payment',Booking:{id:'2'},Currency:'EUR',Payment_Amount:300,Status:'Paid',Movement_Type:'Outbound Payment',Allocation_Count:2,Supplier_Count:1,Booking_Count:2,Settlement_Count:2}],Supplier_Pay_Allocations:[{id:'40',Booking:{id:'1'},Supplier_Invoice:{id:'10'},Supplier_Payment:{id:'30'},Allocated_Amount:100,Currency:'EUR',Invoice_Status:'Paid',Payment_Status:'Paid'},{id:'41',Booking:{id:'2'},Supplier_Invoice:{id:'11'},Supplier_Payment:{id:'30'},Allocated_Amount:200,Currency:'EUR',Invoice_Status:'Paid',Payment_Status:'Paid'}],Supplier_Settlements:[{id:'20',Name:'Settlement',Booking:{id:'1'},Currency:'EUR',Total_Invoice:100,Total_Paid:100,Gross_Invoice_Amount:100,Credit_Note_Amount:0}],Inv_Set_Allocations:[{id:'60',Vendor_Invoice:{id:'10'},Vendor_Settlement:{id:'20'},Allocated_Amount:100,Status:'Active'},{id:'61',Vendor_Invoice:{id:'11'},Vendor_Settlement:{id:'21'},Allocated_Amount:200,Status:'Active'}],Prepayments:[],Card_Purchases:[]};
 const calls=[];
 const crm={coql:async(q,options)=>{assert.equal(options.strict,true);calls.push(q);const m=q.match(/from (\w+) where (.+) order by id asc limit (\d+), 200/);assert.ok(m,q);const [,module,where,offset]=m;let rows=db[module];const condition=where.match(/^([\w.]+) (?:in \(([^)]+)\)|= (.+))$/);assert.ok(condition,where);const keys=(condition[2]||condition[3]).replace(/'/g,'').split(',');rows=rows.filter(r=>keys.includes(String(r[condition[1]]?.id||r[condition[1]])));return structuredClone(rows.slice(Number(offset),Number(offset)+200));}};
 return {db,calls,crm,scan:()=>ns.createConsistencyReader(crm).scan('1')};
}
test('booking review loads all shared-payment allocations and avoids false payment mismatches',async()=>{const f=fixture(),g=await f.scan();assert.equal(g.invoices.length,2);assert.equal(g.scopeInvoiceIds.length,1);assert.equal(g.allocations.length,2);assert.equal(ns.analyzeConsistency(g).length,0);assert.ok(f.calls.every(q=>q.startsWith('select ')));});
test('finds stale invoice amounts, copies and payment counters independently',async()=>{const f=fixture();f.db.Supplier_Invoices[0].Amount_Paid=80;f.db.Supplier_Pay_Allocations[0].Invoice_Status='Received';f.db.Supplier_Payments[0].Allocation_Count=3;const rows=ns.analyzeConsistency(await f.scan());for(const field of ['Amount_Paid','Invoice status copy','Allocation_Count'])assert.ok(rows.some(r=>r.description===field),field);});
test('credit notes use positive allocations and signed payment and settlement totals',async()=>{const f=fixture();f.db.Supplier_Invoices[0].Invoice_Type='Credit Note';f.db.Supplier_Payments[0].Payment_Amount=100;Object.assign(f.db.Supplier_Settlements[0],{Total_Invoice:-100,Total_Paid:-100,Gross_Invoice_Amount:0,Credit_Note_Amount:100});assert.equal(ns.analyzeConsistency(await f.scan()).length,0);});
test('planned allocations reserve the invoice but do not count as paid',async()=>{const f=fixture();f.db.Supplier_Payments[0].Status='Planned';f.db.Supplier_Invoices.forEach(i=>Object.assign(i,{Amount_Paid:0,Status:'Received'}));f.db.Supplier_Pay_Allocations.forEach(a=>Object.assign(a,{Payment_Status:'Planned',Invoice_Status:'Received'}));f.db.Supplier_Settlements[0].Total_Paid=0;assert.equal(ns.analyzeConsistency(await f.scan()).length,0);f.db.Supplier_Pay_Allocations[0].Allocated_Amount=101;assert.ok(ns.analyzeConsistency(await f.scan()).some(r=>r.description==='Allocations exceed the payable'));});
test('orphan settlement allocations are visible and settlement comparison is explicitly skipped',async()=>{const f=fixture();f.db.Inv_Set_Allocations.push({id:'62',Vendor_Invoice:null,Vendor_Settlement:{id:'20'},Allocated_Amount:120,Status:'Active'});const rows=ns.analyzeConsistency(await f.scan());assert.ok(rows.some(r=>r.id==='62'&&r.kind==='relation'));assert.ok(rows.some(r=>r.id==='20'&&r.kind==='review'));assert.ok(!rows.some(r=>r.id==='20'&&r.kind==='amount'));});
test('currency conflicts and duplicate allocations do not generate unreliable totals',async()=>{for(const variant of ['currency','duplicate']){const f=fixture();if(variant==='currency')f.db.Supplier_Pay_Allocations[0].Currency='USD';else f.db.Supplier_Pay_Allocations.push({...f.db.Supplier_Pay_Allocations[0],id:'42'});const rows=ns.analyzeConsistency(await f.scan());assert.ok(rows.some(r=>['review','relation'].includes(r.kind)));assert.ok(!rows.some(r=>r.kind==='amount'));}});
test('pending edits are flagged and manual administrative states are never inferred',async()=>{const f=fixture();f.db.Supplier_Invoices[0].Edit_Status='Pending';let rows=ns.analyzeConsistency(await f.scan());assert.ok(rows.some(r=>r.id==='10'&&r.kind==='review'));assert.ok(!rows.some(r=>r.kind==='amount'));delete f.db.Supplier_Invoices[0].Edit_Status;f.db.Supplier_Invoices[0].Status='Manual review';f.db.Supplier_Pay_Allocations[0].Invoice_Status='Manual review';rows=ns.analyzeConsistency(await f.scan());assert.ok(!rows.some(r=>r.description==='Financial invoice status'));});
test('invalid query input and failed reads never return a successful review',async()=>{const f=fixture(),reader=ns.createConsistencyReader(f.crm);await assert.rejects(reader.scan("1' or id is not null"),/Invalid/);await assert.rejects(reader.search("x' OR id"),/reference/);const broken=ns.createConsistencyReader({coql:async()=>{throw Error('Permission denied');}});await assert.rejects(broken.scan('1'),/Permission denied/);});
test('repeated pages abort the review instead of accepting incomplete data',async()=>{const reader=ns.createConsistencyReader({coql:async()=>Array.from({length:200},(_,i)=>({id:String(i+1)}))});await assert.rejects(reader.search('123'),/repeated/);});
test('source links and statuses are checked without changing administrative discarded states',async()=>{const f=fixture();f.db.Card_Purchases=[{id:'70',Booking:{id:'1'},Name:'Source',Currency:'EUR',Vendor_Payment:{id:'30'},Accounting_Status:'Pending payment record'}];let rows=ns.analyzeConsistency(await f.scan());assert.ok(rows.some(r=>r.id==='70'&&r.kind==='status'));f.db.Card_Purchases[0].Accounting_Status='Discard - Already Paid';rows=ns.analyzeConsistency(await f.scan());assert.ok(!rows.some(r=>r.id==='70'));});
test('empty aggregates with no component records equal zero under the existing rebuild rules',async()=>{const f=fixture();f.db.Supplier_Settlements.push({id:'22',Booking:{id:'1'},Currency:'EUR',Total_Paid:null,Total_Invoice:null,Gross_Invoice_Amount:null,Credit_Note_Amount:null});assert.equal(ns.analyzeConsistency(await f.scan()).length,0);});

test('other booking status copies and split issues do not become local issues',async()=>{
 const f=fixture();f.db.Supplier_Pay_Allocations[1].Invoice_Status='Received';f.db.Supplier_Pay_Allocations[1].Payment_Status='Planned';
 f.db.Inv_Set_Allocations[1].Allocated_Amount=-1;
 const rows=ns.analyzeConsistency(await f.scan());assert.equal(rows.length,0);
 f.db.Supplier_Pay_Allocations[0].Invoice_Status='Received';
 assert.ok(ns.analyzeConsistency(await f.scan()).some(r=>r.id==='40'&&r.description==='Invoice status copy'));
});
test('shared payment totals still include external allocations and expose genuine payment mismatches',async()=>{
 const f=fixture();f.db.Supplier_Pay_Allocations[1].Invoice_Status='Received';f.db.Supplier_Payments[0].Payment_Amount=100;
 const rows=ns.analyzeConsistency(await f.scan());assert.equal(rows.length,1);assert.equal(rows[0].description,'Payment_Amount');assert.equal(rows[0].expected,300);
});
test('invalid external allocations cannot produce a falsely clean shared payment check',async()=>{
 const f=fixture();f.db.Supplier_Pay_Allocations[1].Currency='USD';
 const rows=ns.analyzeConsistency(await f.scan());assert.ok(!rows.some(r=>r.id==='41'));assert.ok(rows.some(r=>r.id==='30'&&r.kind==='review'));assert.ok(!rows.some(r=>r.id==='30'&&r.kind==='amount'));
});
test('an orphan allocation explicitly linked to the booking remains visible',async()=>{
 const f=fixture();f.db.Supplier_Pay_Allocations[0].Supplier_Invoice=null;
 assert.ok(ns.analyzeConsistency(await f.scan()).some(r=>r.id==='40'&&r.kind==='relation'));
});
function syncFixture(){
 const db={Supplier_Pay_Allocations:{'40':{id:'40',Booking:{id:'1'},Supplier_Invoice:{id:'10'},Supplier_Payment:{id:'30'},Invoice_Status:'Received',Payment_Status:'Planned',Allocated_Amount:100}},Supplier_Invoices:{'10':{id:'10',Booking:{id:'1'},Status:'Paid'}},Supplier_Payments:{'30':{id:'30',Status:'Paid'}}};
 const writes=[];const crm={getRecord:async(m,id)=>structuredClone(db[m][id]||null),updateRecord:async(m,id,changes,options)=>{writes.push({m,id,changes,options});Object.assign(db[m][id],changes);return {data:[{code:'SUCCESS'}]};}};
 const findings=['Invoice status copy','Payment status copy'].map(description=>({module:'Supplier_Pay_Allocations',kind:'status',id:'40',description,expected:'Wrong stale value'}));
 return {db,writes,crm,findings};
}
test('copy sync re-reads sources, changes only requested copies and is idempotent',async()=>{
 const f=syncFixture(),sync=ns.createStatusCopySync(f.crm);const r=await sync('1',f.findings);
 assert.equal(r.verified,1);assert.equal(r.failed.length,0);assert.deepEqual(JSON.parse(JSON.stringify(f.writes[0].changes)),{Invoice_Status:'Paid',Payment_Status:'Paid'});assert.equal(f.writes[0].options.trigger.length,0);assert.equal(f.db.Supplier_Pay_Allocations['40'].Allocated_Amount,100);
 await sync('1',f.findings);assert.equal(f.writes.length,1);
});
test('copy sync rejects external booking and pending invoice operations',async()=>{
 for(const variant of ['external','pending']){const f=syncFixture();if(variant==='external')f.db.Supplier_Invoices['10'].Booking.id='2';else f.db.Supplier_Invoices['10'].Edit_Status='Pending';const r=await ns.createStatusCopySync(f.crm)('1',f.findings);assert.equal(r.failed.length,1);assert.equal(f.writes.length,0);}
});
test('copy sync retries safely after an unconfirmed response',async()=>{
 const f=syncFixture(),write=f.crm.updateRecord;f.crm.updateRecord=async(...args)=>{await write(...args);throw Error('Connection lost');};const sync=ns.createStatusCopySync(f.crm);let r=await sync('1',f.findings);assert.equal(r.failed.length,1);f.crm.updateRecord=write;r=await sync('1',f.findings);assert.equal(r.verified,1);assert.equal(f.writes.length,1);
});
test('copy sync detects changed source status during verification and blocks duplicate clicks',async()=>{
 const f=syncFixture(),write=f.crm.updateRecord;let release;f.crm.updateRecord=async(...args)=>{await new Promise(r=>release=r);const result=await write(...args);f.db.Supplier_Invoices['10'].Status='Partially Paid';return result;};const sync=ns.createStatusCopySync(f.crm);const pending=sync('1',f.findings);await new Promise(r=>setImmediate(r));await assert.rejects(sync('1',f.findings),/already running/);release();const result=await pending;assert.equal(result.failed.length,1);assert.equal(result.verified,0);
});
