const {chromium}=require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('fs'),assert=require('assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.setContent(fs.readFileSync('app/widget.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link[^>]*>/gi,''));
 for(const match of fs.readFileSync('app/widget.html','utf8').matchAll(/href="\.\/(styles\/[^"]+)"/g)) await page.addStyleTag({content:fs.readFileSync('app/'+match[1],'utf8')});
 await page.addScriptTag({path:'app/scripts/ui-system.js'});
 await page.addScriptTag({path:'app/scripts/consistency-review.js'});await page.addScriptTag({path:'app/scripts/consistency-review-ui.js'});
 await page.evaluate(()=>{
  const popup=document.getElementById('booking-closure-popup');document.body.replaceChildren(popup);popup.hidden=false;
  document.getElementById('booking-closure-content').innerHTML='<div class="booking-closure-summary">Economic indicators</div><div class="booking-closure-legend"><input id="saved-filter" value="pending"></div><div id="saved-scroll" style="overflow:auto;height:180px"><div style="height:1000px">Settlements</div></div>';
  window.syncs=0;AccountingManagerApp.createStatusCopySync=()=>async()=>{syncs++;await new Promise(r=>setTimeout(r,40));window.empty=true;return {verified:1,failed:[]};};
  window.scans=0;window.fail=false;window.hold=false;window.empty=false;window.opened=[];
  AccountingManagerApp.createConsistencyReader=()=>({scan:async(id,progress)=>{scans++;if(hold)await new Promise(r=>window.release=r);progress('Reading');if(fail)throw Error('Permission denied');return {scopeInvoiceIds:['i'],invoices:[{id:'i',Booking:{id:'2',name:'Other trip'}}],payments:[],settlements:[{}],splits:[],allocations:[{id:'a',Supplier_Invoice:{id:'i',name:'INV-2026'},Supplier_Payment:{id:'p',name:'PAY-2026'}}],prepayments:[],cards:[]};}});
  AccountingManagerApp.analyzeConsistency=()=>empty?[]:[{kind:'status',module:'Supplier_Pay_Allocations',id:'a',name:'Very long name '.repeat(25),description:'Invoice status copy',stored:'Received',expected:'Paid'},{kind:'amount',module:'Supplier_Invoices',id:'i',name:'<img src=x onerror=alert(1)>',description:'Amount_Paid',stored:59.59,expected:79.59,currency:'EUR'}];
  window.closure={isOpen:true,booking:{id:'1'}};window.review=AccountingManagerApp.mountConsistencyReview(document.getElementById('booking-closure-consistency'),{},async(m,id)=>opened.push([m,id]));review.setContext(closure);review.place();
 });
 const click=async(name)=>page.getByRole('button',{name,exact:true}).click();
 assert.equal(await page.evaluate(()=>scans),0);assert.equal(await page.locator('[data-review="status"]').innerText(),'Not checked');
 assert.equal(await page.evaluate(()=>document.querySelector('.booking-closure-summary').nextElementSibling.dataset.review),'bar');
 await page.evaluate(()=>window.hold=true);await click('Check consistency');assert.match(await page.locator('[data-review="status"]').innerText(),/Checking/);assert.ok(await page.locator('[data-review="run"]').isDisabled());await page.evaluate(()=>{hold=false;release();});
 await page.getByRole('button',{name:'View issues',exact:true}).waitFor();
 await page.evaluate(()=>document.getElementById('saved-scroll').scrollTop=90);await click('View issues');
 assert.equal(await page.locator('.consistency-table tbody tr').count(),2);assert.equal(await page.locator('img').count(),0);assert.match(await page.locator('[data-review="results"]').innerText(),/Invoice status copy mismatch on payment allocation/);assert.match(await page.locator('[data-review="results"]').innerText(),/Other booking/);
 await page.locator('[data-review="filter"]').selectOption('relation');assert.match(await page.locator('[data-review="results"]').innerText(),/No issues match/);await page.locator('[data-review="filter"]').selectOption('status');assert.match(await page.locator('[data-review="count"]').innerText(),/Showing 1 of 2/);
 await page.locator('.consistency-open').click();assert.equal(await page.evaluate(()=>opened.length),1);
 await click('Back to review');assert.equal(await page.locator('#saved-filter').inputValue(),'pending');assert.equal(await page.locator('#saved-scroll').evaluate(e=>e.scrollTop),90);assert.equal(await page.evaluate(()=>scans),1);
 await click('View issues');assert.equal(await page.locator('[data-review="filter"]').inputValue(),'status');
 for(const [width,height] of [[1280,800],[1280,440],[390,640]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.locator('[data-review="results"]').evaluate(e=>e.getBoundingClientRect().height>40));}
 await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'_local/consistency-results-redesign.png'});
 await page.evaluate(()=>window.fail=true);await click('Run again');assert.match(await page.locator('[data-review="summary"]').innerText(),/Check incomplete/);assert.equal(await page.locator('.consistency-table').count(),0);
 await page.evaluate(()=>{fail=false;empty=true;});await click('Run again');assert.match(await page.locator('[data-review="results"]').innerText(),/No issues found/);await click('Back to review');assert.equal(await page.locator('[data-review="status"]').innerText(),'No issues found');
 await page.evaluate(()=>window.empty=false);await click('Run again');await click('View issues');await click('Sync status copies');await page.waitForFunction(()=>document.querySelector('[data-review="sync-result"]').textContent.includes('1 allocations verified'));assert.equal(await page.evaluate(()=>syncs),1);assert.match(await page.locator('[data-review="results"]').innerText(),/No issues found/);await click('Back to review');
 await page.evaluate(()=>{hold=true;empty=false;});await click('Run again');await page.evaluate(()=>{closure.isOpen=false;review.setContext(closure);release();});await page.waitForTimeout(30);assert.equal(await page.locator('.consistency-table').count(),0);
 console.log('Passed: all scan states, precise labels, other bookings, filters, long references, safe text, navigation preservation, low-height/mobile layouts and late-response invalidation.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
