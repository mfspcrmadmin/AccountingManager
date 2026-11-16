const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(status = 'Closure Pending', reviews = ['Pending review'], options = {}) {
  const window = {prompt:()=>{throw Error('Native prompt must not be used')}};
  vm.runInNewContext(fs.readFileSync('app/scripts/bookings.js', 'utf8'), { window });
  const booking = { id: 'b1', Closure_Status: status, Balance_Amount: Object.hasOwn(options, 'balance') ? options.balance : 0 };
  const settlements = reviews.map((review, i) => ({ id: String(i), Booking:{id:'b1'}, Total_Service_Cost:100,Total_Invoice:100,Total_Paid:100,Closure_Review_Status: review }));
  const invoices=(options.freshSettlements||settlements).map(row=>({id:'invoice-'+row.id,Supplier_Settlement:{id:row.id},Invoice_Type:'Final Invoice',Total_Payable_Amount:100}));
  const state = { bookingClosure: { booking: { ...booking }, settlements, isOpen: true }, views: { bookings: { records: [{ ...booking }] } } };
  Object.defineProperty(state.bookingClosure,'exceptionReason',{configurable:true,get(){if(options.onPrompt)options.onPrompt();return options.exceptionReason || '';},set(value){options.exceptionReason=value;}});
  const writes = [], pages = [];
  const success = { data: [{ code: 'SUCCESS' }] };
  const module = window.AccountingManagerApp.createBookingsModule({
    reviewClosure: options.reviewClosure, verifyClosureReview: options.verifyClosureReview,
    MODULES: { bookings: 'Deals', settlements: 'Settlements', invoices:'Invoices' },
    FIELD_CANDIDATES: { booking: { closureStatus: ['Closure_Status'] }, settlement: { closureReviewStatus: ['Closure_Review_Status'] } },
    state, elements: { bookingClosureContent: { querySelector: () => ({ value: options.reason || '' }), querySelectorAll: () => options.ignoreInputs || [] } },
    helpers: {
      getCandidateValue: (record, candidates) => record && record[candidates[0]],
      normalizeString: value => String(value || '').toLowerCase().replace(/\s/g, ''),
      textValue: value => value || '', escapeCriteriaValue: value => value,
      getLookupId: value=>String(value&&value.id||''),getLookupName:()=> ''
    },
    crm: {
      getRecord: async (entity,id) => entity==='Settlements'?{...settlements.find(row=>row.id===id),...options.changedSettlement}:
        entity==='Invoices'?(options.extraInvoices||[]).find(row=>row.id===id):({ ...booking, Balance_Amount: Object.hasOwn(options, 'remoteBalance') ? options.remoteBalance : booking.Balance_Amount, Closure_Status: options.remoteStatus || booking.Closure_Status }),
      searchRecordPage: async (entity, criteria, page) => {
        if(entity==='Settlements'){pages.push(page);return (options.freshSettlements || settlements).map(row=>({Booking:{id:'b1'},Total_Service_Cost:100,Total_Invoice:100,Total_Paid:100,...row})).slice((page - 1) * 200, page * 200);}
        if(entity==='Inv_Set_Allocations'){const [,field,value]=criteria.match(/\((\w+):equals:(.*)\)/);return(options.allocations||[]).filter(row=>row[field]?.id===value);}
        return entity==='Invoices'?(options.invoices||invoices):[];
      },
      updateRecord: async (entity, id, data) => {
        writes.push({ entity, id, data });
        if (options.fail === entity) return { data: [{ code: 'NO_PERMISSION', message: 'Permission denied' }] };
        if (entity === 'Deals') Object.assign(booking, data);
        return success;
      },
      insertRecord: async (entity, data) => {
        writes.push({ entity, data });
        return options.fail === entity ? { data: [{ code: 'ERROR', message: 'Note failed' }] } : success;
      }
    },
    getCurrentUserEmail: async () => options.noUser ? '' : 'accountant@example.com',
    renderAll() {}, debugError() {}, renderer: { showNotice() {}, showError() {} }
  });
  function event(attribute, value) { return { target: { closest: () => ({ disabled: false, getAttribute: key => key === attribute ? value : null }) } }; }
  return { state, writes, pages,
    action: name => module.onClosureStatusClick(event('data-closure-action', name)),
    review: () => module.onClosureReviewClick(event('data-booking-closure-review-settlement-id', '0')) };
}

test('first reviewed settlement advances Pending and updates the booking list', async () => {
  const r = setup(); await r.review();
  assert.equal(r.state.bookingClosure.booking.Closure_Status, 'Closure In Review');
  assert.equal(r.state.views.bookings.records[0].Closure_Status, 'Closure In Review');
  assert.equal(r.writes.length, 2);
});
test('review preserves Blocked and Reopened; all reviewed never auto completes', async () => {
  for (const status of ['Closure Blocked', 'Closure Reopened', 'Closure In Review']) {
    const r = setup(status); await r.review();
    assert.equal(r.state.bookingClosure.booking.Closure_Status, status);
    assert.equal(r.writes.length, 1);
  }
});
test('completed closures require reopening, including remote status changes', async () => {
  const r = setup('Closure Pending', ['Pending review'], { remoteStatus: 'Closure Completed' });
  await r.review(); assert.equal(r.writes.length, 0);
  assert.match(r.state.bookingClosure.error, /Reopen/);
  const reopened = setup('Closure Completed'); await reopened.action('reopen'); await reopened.review();
  assert.equal(reopened.state.bookingClosure.booking.Closure_Status, 'Closure Reopened');
});
test('manual completion records actor and timestamp', async () => {
  const r = setup('Closure In Review', ['Reviewed']); await r.action('complete');
  assert.equal(r.writes[0].data.Closure_Status, 'Closure Completed');
  assert.equal(r.writes[0].data.Closure_Completed_By, 'accountant@example.com');
  assert.ok(Number.isFinite(Date.parse(r.writes[0].data.Closure_Completed_At)));
});
test('completion rechecks every page, including pending settlement 201', async () => {
  const fresh = Array.from({ length: 201 }, (_, i) => ({ id: String(i), Closure_Review_Status: i === 200 ? 'Pending review' : 'Reviewed' }));
  const r = setup('Closure In Review', ['Reviewed'], { freshSettlements: fresh }); await r.action('complete');
  assert.deepEqual(r.pages, [1, 2]); assert.equal(r.writes.length, 0);
});
test('completion rejects empty, unreviewed, blocked, missing actor and incomplete loads', async () => {
  for (const [status, reviews, options] of [
    ['Closure Pending', [], {}], ['Closure In Review', ['Pending review'], {}],
    ['Closure Blocked', ['Reviewed'], {}], ['Closure In Review', ['Reviewed'], { noUser: true }]
  ]) {
    const r = setup(status, reviews, options); await r.action('complete'); assert.equal(r.writes.length, 0);
  }
  const r = setup('Closure In Review', ['Reviewed']); r.state.bookingClosure.loadFailed = true;
  await r.action('complete'); assert.equal(r.writes.length, 0);
});
test('No services settlements are excluded, but cannot alone enable closure', async () => {
  for (const active of [true, false]) {
    const fresh = [{ id: 'unused', Admin_Status: 'No services', Closure_Review_Status: 'Pending review' }];
    if (active) fresh.push({ id: 'active', Closure_Review_Status: 'Reviewed' });
    const r = setup('Closure In Review', ['Reviewed'], { freshSettlements: fresh }); await r.action('complete');
    assert.equal(r.writes.length, active ? 1 : 0);
  }
});
test('blocking requires a persisted reason; blocked closures can resume', async () => {
  const empty = setup(); await empty.action('block'); assert.equal(empty.writes.length, 0);
  const failed = setup('Closure Pending', [], { reason: 'Missing invoice', fail: 'Notes' });
  await failed.action('block'); assert.equal(failed.state.bookingClosure.booking.Closure_Status, 'Closure Pending');
  const r = setup('Closure Pending', [], { reason: 'Missing invoice' }); await r.action('block');
  assert.equal(r.writes[0].data.Note_Content, 'Missing invoice');
  assert.equal(r.writes[0].data.Parent_Id, 'b1');
  assert.equal(r.state.bookingClosure.booking.Closure_Status, 'Closure Blocked');
  await r.action('start'); assert.equal(r.state.bookingClosure.booking.Closure_Status, 'Closure In Review');
});
test('API failure preserves local status and reports partial review success', async () => {
  const r = setup('Closure Pending', ['Pending review'], { fail: 'Deals' }); await r.review();
  assert.equal(r.state.bookingClosure.booking.Closure_Status, 'Closure Pending');
  assert.equal(r.state.bookingClosure.settlements[0].Closure_Review_Status, 'Reviewed');
  assert.match(r.state.bookingClosure.error, /review saved/);
  assert.equal(r.state.bookingClosure.isSaving, false);
});
test('busy closure ignores further writes', async () => {
  const r = setup(); r.state.bookingClosure.isSaving = true;
  await r.action('start'); await r.review(); assert.equal(r.writes.length, 0);
});

test('exceptions require a justification and a successful audit note before completing',async()=>{
 const base={freshSettlements:[{id:'0',Closure_Review_Status:'Reviewed',Total_Service_Cost:1000,Total_Invoice:0,Total_Paid:0}],invoices:[]};
 const rejected=setup('Closure In Review',['Reviewed'],base);await rejected.action('complete');
 assert.equal(rejected.writes.length,0);assert.match(rejected.state.bookingClosure.error,/justification/);
 const failed=setup('Closure In Review',['Reviewed'],{...base,exceptionReason:'Accepted write-off',fail:'Notes'});await failed.action('complete');
 assert.equal(failed.writes.filter(row=>row.entity==='Deals').length,0);
 const accepted=setup('Closure In Review',['Reviewed'],{...base,exceptionReason:'Accepted write-off'});await accepted.action('complete');
 assert.equal(accepted.writes[0].entity,'Notes');
 assert.match(accepted.writes[0].data.Note_Content,/Accepted write-off/);
 assert.match(accepted.writes[0].data.Note_Content,/accountant@example.com/);
 assert.match(accepted.writes[0].data.Note_Content,/quoted 1000, invoiced 0, paid 0, invoice missing/);
 assert.equal(accepted.writes[1].data.Closure_Status,'Closure Completed');
});
test('settlement changed since display is refreshed without approving stale data',async()=>{
 const r=setup('Closure In Review',['Pending review'],{changedSettlement:{Total_Invoice:250,Modified_Time:'new-version'}});
 await r.review();assert.equal(r.writes.length,0);
 assert.equal(r.state.bookingClosure.settlements[0].Total_Invoice,250);
 assert.match(r.state.bookingClosure.error,/changed since/);
});
test('a settlement moved to another booking cannot be reviewed',async()=>{
 const r=setup('Closure In Review',['Pending review'],{changedSettlement:{Booking:{id:'other'}}});
 await r.review();assert.equal(r.writes.length,0);assert.match(r.state.bookingClosure.error,/another booking/);
});
test('changes while entering justification block completion and the exception note',async()=>{
 const options={invoices:[],exceptionReason:'Accepted',onPrompt:()=>{options.remoteStatus='Closure Blocked';}};
 const r=setup('Closure In Review',['Reviewed'],options);await r.action('complete');
 assert.equal(r.writes.length,0);assert.match(r.state.bookingClosure.error,/data changed/);
});
test('secondary invoice allocation is included even when its main booking is elsewhere',async()=>{
 const r=setup('Closure In Review',['Reviewed'],{
  invoices:[],allocations:[{id:'a1',Vendor_Settlement:{id:'0'},Vendor_Invoice:{id:'external'},Allocated_Amount:100,Status:'Active'}],
  extraInvoices:[{id:'external',Supplier_Settlement:{id:'elsewhere'},Booking:{id:'elsewhere'},Invoice_Type:'Final Invoice',Status:'Received',Total_Payable_Amount:750}]
 });
 await r.action('complete');
 assert.equal(r.writes.length,1);assert.equal(r.writes[0].data.Closure_Status,'Closure Completed');
 assert.equal(r.state.bookingClosure.settlements[0]._closureInvoices[0].id,'external');
});
test('missing totals cannot be silently accepted as zero',async()=>{
 const r=setup('Closure In Review',['Reviewed'],{freshSettlements:[{id:'0',Closure_Review_Status:'Reviewed',Total_Paid:null}]});
 await r.action('complete');assert.equal(r.writes.length,0);assert.match(r.state.bookingClosure.error,/totals are unavailable/);
});

test('closure metrics use settlement totals for split invoices, credit notes and cancelled invoices',()=>{
 const source=fs.readFileSync('app/scripts/bookings.js','utf8');
 const ctx={helpers:{getLookupId:r=>r?.id||'',getLookupName:()=>'',normalizeString:v=>String(v).toLowerCase()},
  getClosureNumber:(r,f)=>Number(r[f])||0,getClosureReviewStatus:()=> 'Pending review',getClosureRowColor:()=>''};
 for(const [start,end] of [
  ['    function activeClosureInvoice','    async function loadClosureSnapshot'],
  ['    function getClosureSettlementMetrics','    function renderBookingClosure()']
 ])vm.runInNewContext(source.slice(source.indexOf(start),source.indexOf(end)),ctx);
 const settlement={id:'s1',Total_Service_Cost:80,Total_Invoice:80,Total_Paid:80};
 for(const invoices of [
  [{id:'i1',Supplier_Settlement:{id:'s1'},Total_Payable_Amount:100},{id:'cn',Supplier_Settlement:{id:'s1'},Total_Payable_Amount:20,Invoice_Type:'Credit Note'}],
  [{id:'i1',Supplier_Settlement:{id:'s1'},Total_Payable_Amount:80},{id:'cancelled',Supplier_Settlement:{id:'s1'},Total_Payable_Amount:100,Status:'Cancelled'}],
  [{id:'split',Supplier_Settlement:{id:'s1'},Total_Payable_Amount:750}]
 ]){
  const metrics=ctx.getClosureSettlementMetrics(settlement,invoices);
  assert.equal(metrics.invoiced,80);assert.equal(metrics.variance,0);assert.equal(metrics.status,'Matched and paid');
 }
 assert.equal(ctx.getClosureSettlementMetrics(settlement,[{Supplier_Settlement:{id:'s1'},Status:'Cancelled'}]).hasInvoice,false);
});

test('nonzero and unavailable booking balances block closure without exception overrides or writes',async()=>{
 for(const balance of [10,-10,0.01,-0.01,null,undefined,'','invalid']) {
  const r=setup('Closure In Review',['Reviewed'],{balance,exceptionReason:'Accept anyway'});
  await r.action('complete');assert.equal(r.writes.length,0);
  assert.match(r.state.bookingClosure.error,/Balance Due Amount/);
 }
});
test('completion uses the current CRM balance, not the displayed zero',async()=>{
 const r=setup('Closure In Review',['Reviewed'],{balance:0,remoteBalance:25,exceptionReason:'Accepted'});
 await r.action('complete');assert.equal(r.writes.length,0);assert.match(r.state.bookingClosure.error,/25.00/);
});
test('balance becoming nonzero during exception review blocks before the audit note and completion',async()=>{
 const options={balance:0,invoices:[],exceptionReason:'Accepted',onPrompt:()=>{options.remoteBalance=-5;}};
 const r=setup('Closure In Review',['Reviewed'],options);await r.action('complete');
 assert.equal(r.writes.length,0);assert.match(r.state.bookingClosure.error,/Balance Due Amount/);
});
test('numeric and string zero allow completion',async()=>{
 for(const balance of [0,'0','0.00']) {
  const r=setup('Closure In Review',['Reviewed'],{balance});await r.action('complete');
  assert.equal(r.writes.at(-1).data.Closure_Status,'Closure Completed',r.state.bookingClosure.error);
 }
});

test('NOSUPPLIER exclusion is explicit, justified and audited with missing values preserved', async () => {
  const fresh=[{id:'0',Name:'MFSP151026E-NOSUPPLIER',Service_Count:2,Closure_Review_Status:'Reviewed',Total_Service_Cost:35,Total_Invoice:null,Total_Paid:null}];
  const normal=setup('Closure In Review',['Reviewed'],{freshSettlements:fresh});
  await normal.action('complete');assert.equal(normal.writes.length,0);assert.match(normal.state.bookingClosure.error,/totals are unavailable/);
  const missingReason=setup('Closure In Review',['Reviewed'],{freshSettlements:fresh});
  missingReason.state.bookingClosure.ignoredNoSupplierIds=['0'];await missingReason.action('complete');assert.equal(missingReason.writes.length,0);assert.match(missingReason.state.bookingClosure.error,/justification/);
  const accepted=setup('Closure In Review',['Reviewed'],{freshSettlements:fresh,exceptionReason:'Taxi paid independently; documents reviewed'});
  accepted.state.bookingClosure.ignoredNoSupplierIds=['0'];await accepted.action('complete');
  assert.equal(accepted.state.bookingClosure.booking.Closure_Status,'Closure Completed');
  const note=accepted.writes.find(w=>w.entity==='Notes');assert.match(note.data.Note_Content,/Explicitly ignored NOSUPPLIER/);assert.match(note.data.Note_Content,/invoiced null, paid null/);assert.match(note.data.Note_Content,/Taxi paid independently/);
});
test('NOSUPPLIER choice cannot ignore a normal supplier or bypass mandatory review or customer balance', async () => {
  for(const name of ['MFSP151026E-REALSUPPLIER','MFSP151026E-NOSUPPLIER']){
    const r=setup('Closure In Review',['Reviewed'],{freshSettlements:[{id:'0',Name:name,Closure_Review_Status:name.endsWith('NOSUPPLIER')?'Pending review':'Reviewed',Total_Invoice:null}]});
    r.state.bookingClosure.ignoredNoSupplierIds=['0'];await r.action('complete');assert.equal(r.writes.length,0);
  }
  const r=setup('Closure In Review',['Reviewed'],{remoteBalance:35});r.state.bookingClosure.ignoredNoSupplierIds=['0'];await r.action('complete');assert.equal(r.writes.length,0);
});

test('completion takes NOSUPPLIER choice from the displayed checkbox before the saving render', async()=>{
 const fresh=[{id:'0',Name:'MFSP151026E-NOSUPPLIER',Closure_Review_Status:'Reviewed',Total_Service_Cost:35,Total_Invoice:null,Total_Paid:null}];
 const input={checked:true,disabled:false,getAttribute:()=> '0'};
 const r=setup('Closure In Review',['Reviewed'],{freshSettlements:fresh,ignoreInputs:[input],exceptionReason:'Reviewed taxi cost'});
 r.state.bookingClosure.ignoredNoSupplierIds=[];await r.action('complete');
 assert.equal(r.state.bookingClosure.booking.Closure_Status,'Closure Completed');assert.match(r.writes.find(w=>w.entity==='Notes').data.Note_Content,/Explicitly ignored NOSUPPLIER/);
 const u=setup('Closure In Review',['Reviewed'],{freshSettlements:fresh,ignoreInputs:[{...input,checked:false}],exceptionReason:'Reviewed taxi cost'});
 u.state.bookingClosure.ignoredNoSupplierIds=['0'];await u.action('complete');assert.equal(u.writes.length,0);assert.match(u.state.bookingClosure.error,/MFSP151026E-NOSUPPLIER.*Total_Invoice, Total_Paid/);
});

test('missing justification opens inline review and retries with the entered reason without a native prompt',async()=>{
 const r=setup('Closure In Review',['Reviewed'],{invoices:[]});await r.action('complete');assert.equal(r.writes.length,0);assert.equal(r.state.bookingClosure.exceptionReasonRequired,true);assert.ok(r.state.bookingClosure.exceptionIssues.length);
 r.state.bookingClosure.exceptionReason='Invoice exception reviewed and accepted';await r.action('complete');assert.equal(r.state.bookingClosure.booking.Closure_Status,'Closure Completed');assert.match(r.writes.find(w=>w.entity==='Notes').data.Note_Content,/Invoice exception reviewed and accepted/);
});

test('TP migration missing totals require explicit selection and an audited justification', async () => {
 const options={freshSettlements:[{id:'0',Name:'MFSP149750E-FATIMA',Closure_Review_Status:'Reviewed',Total_Service_Cost:0,Total_Invoice:null,Total_Paid:null}]};
 const r=setup('Closure In Review',['Reviewed'],options);
 r.state.bookingClosure.ignoredMigrationIds=['0'];
 await r.action('complete');
 assert.equal(r.writes.length,0);
 assert.equal(r.state.bookingClosure.exceptionReasonRequired,true);
 options.exceptionReason='Migrated from TP; historical settlement totals unavailable, reviewed and accepted.';
 await r.action('complete');
 assert.equal(r.writes.length,2);
 assert.match(r.writes[0].data.Note_Content,/Explicitly ignored TP migration settlement: MFSP149750E-FATIMA/);
 assert.match(r.writes[0].data.Note_Content,/paid null/);
 assert.equal(r.writes[1].data.Closure_Status,'Closure Completed');
});

test('TP migration exception cannot bypass the booking balance or settlement review', async () => {
 for (const [reviews,extra] of [[['Pending review'],{}],[['Reviewed'],{remoteBalance:10}]]) {
  const r=setup('Closure In Review',reviews,{...extra,freshSettlements:[{id:'0',Closure_Review_Status:reviews[0],Total_Paid:null}],exceptionReason:'Migrated from TP'});
  r.state.bookingClosure.ignoredMigrationIds=['0'];
  await r.action('complete');
  assert.equal(r.writes.length,0);
 }
});


test('completion dialog cancels without any writes and receives all local problems', async () => {
  let issues;
  const r = setup('Closure In Review', ['Pending review'], {balance:20,
    reviewClosure: async load => { issues = (await load()).issues; return null; }});
  await r.action('complete');
  assert.equal(r.writes.length,0);
  assert.ok(issues.some(issue => issue.title === 'Customer balance requires reconciliation'));
  assert.ok(issues.some(issue => issue.title === 'Settlement not reviewed'));
});
test('explicit dialog exceptions are audited before closure; failed revalidation never writes', async () => {
  for (const valid of [true,false]) {
    const r = setup('Closure In Review',['Pending review'], {balance:20,
      reviewClosure: async load => ({issues:(await load()).issues.map(issue=>issue.title), reason:'Migrated legacy evidence', evidence:'snapshot'}),
      verifyClosureReview:async()=>valid});
    await r.action('complete');
    if (valid) {
      assert.equal(r.writes[0].entity,'Notes');
      assert.match(r.writes[0].data.Note_Content,/Migrated legacy evidence/);
      assert.equal(r.writes[1].data.Closure_Status,'Closure Completed');
    } else { assert.equal(r.writes.length,0); assert.match(r.state.bookingClosure.error,/changed/); }
  }
});
