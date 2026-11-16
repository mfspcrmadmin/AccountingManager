const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.setContent('<style>.card{height:500px;overflow:auto}.booking-closure-table-wrap{height:300px;overflow:auto}table{width:1800px}td{height:40px}svg{height:16px}button{min-height:24px}</style><div id="detail" hidden><h2 id="detail-title"></h2><div id="detail-content"></div></div><div id="popup"><div class="card"><h2 id="title"></h2><div id="content"></div><div style="height:500px"></div></div></div>');
for(const name of ['config','helpers'])await page.addScriptTag({path:'app/scripts/'+name+'.js'});
await page.addScriptTag({content:fs.readFileSync('app/scripts/bookings.js','utf8').replace('onStageToggleClick: onBookingsStageToggleClick,','renderForTest: renderBookingClosure, renderDetailForTest: renderBookingClosureDetail, onStageToggleClick: onBookingsStageToggleClick,')});
await page.evaluate(()=>{
const ns=AccountingManagerApp;ns.tableColumns={configure(){},visibleOrder(){return ['reviewToggle','supplier','review','quoted','invoiced','paid','variance','status','finalInvoiceCheck']},resizableHeader(k,h){return h},button(){return ''}};
const booking={id:'123',Deal_Name:'Test trip',Closure_Status:'Closure In Review'};
const settlements=Array.from({length:60},(_,i)=>({id:String(i),Booking:{id:'123'},Name:'Settlement '+i,Supplier_Name:'Supplier '+String(i).padStart(3,'0'),Total_Service_Cost:100,Total_Invoice:100,Total_Paid:100,Closure_Review_Status:'Pending review'}));
settlements.forEach(s=>{s.Supplier={id:'vendor'};s.MFSP_Reference='MFSP2601234'});
window.state={bookingClosure:{booking,settlements,supplierCodes:{vendor:'00123'},invoices:[],isOpen:true},views:{bookings:{records:[]}}};
window.mod=ns.createBookingsModule({state,MODULES:ns.MODULES,FIELD_CANDIDATES:ns.FIELD_CANDIDATES,helpers:ns.helpers,
elements:{bookingClosurePopup:document.querySelector('#popup'),bookingClosureTitle:document.querySelector('#title'),bookingClosureContent:document.querySelector('#content'),bookingClosureDetailPopup:document.querySelector('#detail'),bookingClosureDetailTitle:document.querySelector('#detail-title'),bookingClosureDetailContent:document.querySelector('#detail-content')},
crm:{getRecord:async(m,id)=>{await new Promise(r=>setTimeout(r,30));return m===ns.MODULES.bookings?booking:settlements.find(s=>s.id===id)},updateRecord:async()=>({data:[{code:'SUCCESS'}]})},renderer:{showNotice(){},showError(){}},debugError(){}});
mod.renderForTest();document.querySelector('#content').addEventListener('click',mod.onClosureCopyClick);document.querySelector('#detail-content').addEventListener('click',mod.onClosureCopyClick);document.querySelector('#content').addEventListener('click',e=>{window.pendingReview=mod.onClosureReviewClick(e)});
});
for(const reviewed of [false,true]){
await page.evaluate(()=>{const w=document.querySelector('.booking-closure-table-wrap');w.scrollTop=900;w.scrollLeft=180;document.querySelector('.card').scrollTop=80});
const before=await page.evaluate(()=>({top:document.querySelector('.booking-closure-table-wrap').scrollTop,left:document.querySelector('.booking-closure-table-wrap').scrollLeft,card:document.querySelector('.card').scrollTop}));
await page.evaluate(()=>document.querySelector('[data-booking-closure-review-settlement-id="22"]').click());
await page.evaluate(()=>pendingReview);
const after=await page.evaluate(()=>({top:document.querySelector('.booking-closure-table-wrap').scrollTop,left:document.querySelector('.booking-closure-table-wrap').scrollLeft,card:document.querySelector('.card').scrollTop}));
assert.deepEqual(after,before);
}
console.log('Trip closure retains table vertical/horizontal and panel scroll through review/unreview.');
await page.evaluate(()=>{
window.copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>copied.push(text)}});Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});
state.bookingClosure.detail={isOpen:true,settlement:state.bookingClosure.settlements[0],services:[],invoices:[],payments:[]};mod.renderDetailForTest();
});
assert.equal(await page.locator('#detail-content [data-closure-copy="MFSP2601234"]').count(),1);
assert.equal(await page.locator('#detail-content [data-closure-copy="00123"]').count(),1);
await page.locator('#detail-content [data-closure-copy="MFSP2601234"]').first().evaluate(e=>e.click());
await page.locator('#content [data-closure-copy="00123"]').first().evaluate(e=>e.click());
assert.deepEqual(await page.evaluate(()=>copied),['MFSP2601234','00123']);
await page.evaluate(()=>{state.bookingClosure.supplierCodes.vendor=null;mod.renderDetailForTest()});
assert.ok((await page.locator('#detail-content').textContent()).includes('Unavailable'));
assert.equal(await page.locator('#detail-content [data-closure-copy="00123"]').count(),0);
console.log('Settlement details shows MFSP and supplier code; table copy preserves exact values and leading zeroes.');

await page.addScriptTag({path:'app/scripts/invoice-request.js'});
await page.evaluate(async()=>{
const ns=AccountingManagerApp;
window.request=ns.createInvoiceRequestModule({MODULES:ns.MODULES,helpers:ns.helpers,getCurrentUserEmail:async()=> 'luciano@madeforspainandportugal.com',
  hasValidEmailAddress:email=>/^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(email),resolveRecipient:async()=>({email:'supplier@example.com'}),
  crm:{getRecord:async()=>({id:'456',Vendor_Name:'Supplier'}),searchRecordPage:async()=>[]}});
await request.open({id:'1',Supplier:{id:'456'}},{MFSP_Reference:'TEST'},null);
});
assert.equal(await page.locator('.invoice-request-content input[readonly]').inputValue(),'luciano@madeforspainandportugal.com');
await page.locator('[data-request-cancel]').click();
console.log('Invoice request From displays the active user in the rendered dialog.');

await page.evaluate(()=>{
  const c=state.bookingClosure;
  c.settlements=c.settlements.slice(0,3);c.settlements.forEach(s=>s.Closure_Review_Status='Reviewed');
  c.settlements[0].Total_Invoice=90;c.settlements[0].Total_Paid=90;
  c.settlements[1].Total_Paid=50;
  c.invoices=c.settlements.map(s=>({id:'inv'+s.id,Supplier_Settlement:{id:s.id},Invoice_Type:'Final Invoice'}));
  document.querySelector('#content').addEventListener('click',mod.onClosureTableControlClick);
  document.querySelector('#content').addEventListener('change',mod.onClosureTableControlClick);
  mod.renderForTest();
});
assert.equal(await page.locator('.closure-metric-group').count(),3);
assert.equal(await page.locator('[data-booking-closure-review-settlement-id]').count(),3);
await page.locator('[data-booking-closure-filter="variance"]').click();
assert.equal(await page.locator('tbody tr[data-booking-closure-settlement-id]').count(),1);
assert.equal(await page.locator('[data-booking-closure-filter="variance"]').getAttribute('aria-pressed'),'true');
await page.locator('[data-booking-closure-filter="pending"]').click();
assert.equal(await page.locator('tbody tr[data-booking-closure-settlement-id]').count(),1);
await page.evaluate(()=>{state.bookingClosure.filter='all';state.bookingClosure.booking.Closure_Status='Closure Completed';mod.renderForTest()});
assert.equal(await page.locator('.closure-review-control:disabled').count(),3);
await page.evaluate(()=>{
 state.bookingClosure.settlements[0].Settlement_Type='Agent Commission';
 state.bookingClosure.invoices[0].Invoice_Type='Credit Note';mod.renderForTest();
});
assert.equal(await page.locator('[data-booking-closure-settlement-id="0"] .is-incomplete').count(),0);
assert.ok((await page.locator('[data-booking-closure-settlement-id="0"]').textContent()).includes('Commission: same document rules apply.'));
await page.evaluate(()=>{state.bookingClosure.invoices[0].Invoice_Type='Proforma Invoice';mod.renderForTest()});
assert.equal(await page.locator('[data-booking-closure-settlement-id="0"] a.is-incomplete').count(),1);
assert.ok((await page.locator('[data-booking-closure-settlement-id="0"] a.is-incomplete').getAttribute('href')).endsWith('/Supplier_Invoices/inv0'));
console.log('Grouped metrics, independent financial filters, locked reviews, credit notes and commission document links verified.');

await page.evaluate(()=>{
 state.bookingClosure.booking.Closure_Status='Closure In Review';
 state.bookingClosure.settlements[0].Name='MFSP151026E-NOSUPPLIER';
 state.bookingClosure.settlements[0].Total_Invoice=null;state.bookingClosure.settlements[0].Total_Paid=null;
 mod.renderForTest();
});
assert.equal(await page.locator('[data-closure-ignore-nosupplier]').isChecked(),false);
assert.equal(await page.locator('[data-closure-nosupplier-detail]').count(),1);
assert.ok((await page.locator('.closure-nosupplier').textContent()).includes('Invoiced: Unavailable'));
await page.locator('[data-closure-ignore-nosupplier]').check();
assert.deepEqual(await page.evaluate(()=>state.bookingClosure.ignoredNoSupplierIds),['0']);
assert.equal(await page.locator('[data-closure-ignore-nosupplier]').isChecked(),true);
await page.locator('[data-closure-ignore-nosupplier]').uncheck();
assert.deepEqual(await page.evaluate(()=>state.bookingClosure.ignoredNoSupplierIds),[]);
await page.evaluate(()=>{
 state.bookingClosure.detail={isOpen:true,settlement:state.bookingClosure.settlements[0],services:[{id:'svc',Product_Description:'Taxi HD',Final_Purchase_Cost:35,Currency:'EUR'}],invoices:[],payments:[]};mod.renderDetailForTest();
 state.bookingClosure.booking.Closure_Status='Closure Completed';mod.renderForTest();
});
assert.ok((await page.locator('#detail-content').textContent()).includes('35 EUR'));
assert.equal(await page.locator('[data-closure-ignore-nosupplier]').isDisabled(),true);
console.log('NOSUPPLIER defaults off, supports reversible individual selection, exposes details/costs and locks after closure.');

for (const totals of [
 {Total_Service_Cost:0,Total_Invoice:null,Total_Paid:null,visible:false},
 {Total_Service_Cost:0,Total_Invoice:0,Total_Paid:0,visible:false},
 {Total_Service_Cost:35,Total_Invoice:null,Total_Paid:null,visible:true},
 {Total_Service_Cost:null,Total_Invoice:null,Total_Paid:null,visible:true},
 {Total_Service_Cost:0,Total_Invoice:35,Total_Paid:0,visible:true}
]) {
 await page.evaluate(t=>{Object.assign(state.bookingClosure.settlements[0],t);mod.renderForTest()},totals);
 assert.equal(await page.locator('.closure-nosupplier').count(),totals.visible?1:0,JSON.stringify(totals));
}
console.log('Zero-cost NOSUPPLIER warning hidden; nonzero movements and unknown costs remain visible.');


// Exercise the actual stylesheet without creating screenshots or preview files.
await page.locator('style').evaluateAll(nodes=>nodes.forEach(n=>n.remove()));
await page.addStyleTag({path:'app/styles/components.css'});
await page.evaluate(()=>{
  document.body.classList.add('accounting-widget');
  const popup=document.querySelector('#popup');popup.className='booking-closure-popup';
  const card=popup.querySelector('.card');card.className='booking-closure-card';
  const frame=document.createElement('div');frame.className='booking-closure-frame';card.before(frame);frame.append(card);
  const header=document.createElement('div');header.className='panel-header booking-closure-header';
  card.prepend(header);header.append(document.querySelector('#title'));
  const billing=document.createElement('div');billing.className='booking-closure-billing';billing.innerHTML='<span>Closure completed. Invoice eligibility will be checked.</span><button class="button primary">Invoice trip</button>';header.after(billing);
  mod.renderForTest();
});
for(const width of [1440,390]){
 await page.setViewportSize({width,height:800});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const layout=await page.evaluate(()=>{
   const card=document.querySelector('.booking-closure-card'),header=card.querySelector('.booking-closure-header');
   card.scrollTop=0;const initialTop=header.getBoundingClientRect().top;
   card.scrollTop=1;const firstScrollTop=header.getBoundingClientRect().top;
   card.scrollTop=200;
   return {initialTop,firstScrollTop,scrolledTop:header.getBoundingClientRect().top,frameRadius:getComputedStyle(card.parentElement).borderRadius,frameOverflow:getComputedStyle(card.parentElement).overflow,cardWidth:card.getBoundingClientRect().width,viewport:innerWidth,sticky:getComputedStyle(header).position,tableHeight:document.querySelector('.booking-closure-table-wrap').getBoundingClientRect().height,groups:document.querySelectorAll('.closure-metric-group').length,summaryHeight:document.querySelector('.booking-closure-summary').getBoundingClientRect().height,metricHeights:Array.from(document.querySelectorAll('.closure-metric-group'),n=>n.getBoundingClientRect().height),amountTops:Array.from(document.querySelectorAll('.closure-metric-items strong'),n=>n.getBoundingClientRect().top)};
 });
 assert.ok(layout.cardWidth<=layout.viewport,JSON.stringify(layout));assert.equal(layout.sticky,'sticky');assert.ok(Math.abs(layout.initialTop-layout.firstScrollTop)<1,JSON.stringify(layout));assert.ok(Math.abs(layout.initialTop-layout.scrolledTop)<1,JSON.stringify(layout));assert.equal(layout.frameRadius,'14px');assert.equal(layout.frameOverflow,'hidden');assert.equal(layout.tableHeight,420);assert.equal(layout.groups,3);if(width===1440){assert.ok(layout.summaryHeight<160,JSON.stringify(layout));assert.ok(Math.max(...layout.metricHeights)-Math.min(...layout.metricHeights)<1,JSON.stringify(layout));assert.ok(Math.max(...layout.amountTops)-Math.min(...layout.amountTops)<1,JSON.stringify(layout));}
}
console.log('Actual stylesheet: persistent header, bounded table and responsive metric groups at 1440 and 390 px.');

await page.setViewportSize({width:1440,height:900});
await page.evaluate(()=>{
 const c=state.bookingClosure,base=c.settlements[0];
 c.settlements=Array.from({length:30},(_,i)=>({...base,id:'row'+i,Name:'Settlement '+i}));mod.renderForTest();
 document.querySelector('.booking-closure-table-wrap table').style.width='1800px';
 document.querySelector('thead .table-columns-gear-cell').innerHTML='<button class="table-columns-button" aria-label="Edit columns">Columns</button>';
});
assert.equal(await page.locator('tbody td.table-columns-gear-cell').count(),0);
assert.equal(await page.locator('.booking-closure-table-wrap tbody tr:first-child td:last-child').getAttribute('colspan'),'2');
const fixed=await page.evaluate(()=>{
 const wrap=document.querySelector('.booking-closure-table-wrap'),head=wrap.querySelector('thead .table-columns-gear-cell');
 wrap.scrollTop=0;wrap.scrollLeft=0;const before=head.getBoundingClientRect();
 wrap.scrollTop=500;wrap.scrollLeft=150;const after=head.getBoundingClientRect();
 return {beforeTop:before.top,afterTop:after.top,beforeRight:before.right,afterRight:after.right,scrollTop:wrap.scrollTop,scrollLeft:wrap.scrollLeft,position:getComputedStyle(head).position,right:getComputedStyle(head).right,wrapRight:wrap.getBoundingClientRect().right};
});
assert.ok(fixed.scrollTop>0);assert.ok(fixed.scrollLeft>0);
assert.ok(Math.abs(fixed.beforeTop-fixed.afterTop)<2,JSON.stringify(fixed));
assert.ok(Math.abs(fixed.beforeRight-fixed.afterRight)<2,JSON.stringify(fixed));
console.log('Column editor stays at the top-right while scrolling; data spans the former blank body column.');

await page.evaluate(()=>{
 state.bookingClosure.booking.Closure_Status='Closure In Review';state.bookingClosure.exceptionReasonRequired=true;state.bookingClosure.exceptionIssues=['NOSUPPLIER explicitly ignored'];mod.renderForTest();
 document.querySelector('#content').addEventListener('input',event=>{if(event.target.matches('[data-closure-exception-reason]'))state.bookingClosure.exceptionReason=event.target.value});
});
await page.locator('[data-closure-exception-reason]').fill('Taxi expense reviewed and accepted');
assert.equal(await page.evaluate(()=>state.bookingClosure.exceptionReason),'Taxi expense reviewed and accepted');
await page.evaluate(()=>mod.renderForTest());
assert.equal(await page.locator('[data-closure-exception-reason]').inputValue(),'Taxi expense reviewed and accepted');
assert.equal(await page.locator('.closure-exception-review [data-closure-action="complete"]').count(),1);
await page.setViewportSize({width:390,height:800});
assert.equal(await page.locator('.closure-exception-review').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
console.log('Exception justification is visible, editable and retained inside Trip Closure on mobile.');





}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
