const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.stack));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='payments.test')return route.fulfill({body:''});
  let file=path.join(process.cwd(),'app',url.pathname==='/'?'widget.html':url.pathname);
  let body=fs.readFileSync(file,'utf8');
  if(file.endsWith('main.js'))body='var originalState = window.AccountingManagerApp.createInitialState; window.AccountingManagerApp.createInitialState=function(){ window.testState=originalState(); return window.testState; };\n'+body;
  await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
 });
 await page.addInitScript(()=>{
  window.queries=[];window.bulkReads=[];window.detailReads=[];window.detailDelay={};window.failDetail=false;window.failNext=false;window.delay=20;
  const data=Array.from({length:360},(_,i)=>({id:String(100000+i),Name:'PAY-'+String(i+1).padStart(3,'0'),Status:i%2?'Paid':'Pending Payment',Payment_Date:'2026-10-01',Payment_Type:'Final Payment',Supplier:{id:'9',name:'Example'},Supplier_Name:'Example',Supplier_Code:'ABC',MFSP_Reference:'MFSP',Payment_Amount:100,Created_By:{id:'creator-'+i,name:null},Movement_Type:'Outbound Payment',Payment_Account:i%3===2?null:{id:i%3?'account-b':'account-a',name:i%3?null:'Bank Alpha'},'Payment_Account.Name':i%3===2?null:i%3?'Card Beta':'Bank Alpha','Supplier.Destination':'Spain','Supplier.Is_Self_Employed':true}));
  let onLoad;
  window.ZOHO={embeddedApp:{on(name,fn){onLoad=fn;},async init(){onLoad({});}},CRM:{API:{
   async coql({select_query:q}){
    if(!q.includes('from Supplier_Payments'))return {data:[]};
    queries.push(q);const fail=failNext;failNext=false;await new Promise(r=>setTimeout(r,delay));if(fail)throw Error('Test network failure');
    let rows=data.slice();
    if(q.includes("Status = 'Pending Payment'"))rows=rows.filter(r=>r.Status==='Pending Payment');
    else if(q.includes('Status in'))rows=rows.filter(r=>r.Status==='Paid');
    const name=q.match(/Name like '%([^']*)%'/);if(name)rows=rows.filter(r=>r.Name.includes(name[1]));
    const ids=q.match(/id in \(([^)]+)\)/);
    if(ids)rows=rows.filter(r=>ids[1].includes("'"+r.id+"'"));
    if(q.includes("MFSP_Reference like '%TARGET%'"))rows=rows.filter(r=>r.Name==='PAY-359');
    const limit=q.match(/limit (\d+), (\d+)$/);rows=rows.slice(+limit[1],+limit[1]+ +limit[2]);return {data:rows};
   },async getRecord(request){
    detailReads.push([request.Entity,request.RecordID]);
    const fail=failDetail;await new Promise(r=>setTimeout(r,detailDelay[request.RecordID] || 30));
    if(fail)throw Error('Detail unavailable');
    if(request.Entity==='Payment_Accounts')return {data:[{id:request.RecordID,Name:'Card Beta'}]};
    const record=data.find(r=>r.id===request.RecordID);
    return {data:[Object.assign({},record,{Created_By:{id:'creator',name:'Creator '+record.Name},Owner:{name:'Different owner'},Modified_By:{name:'Different editor'}})]};
   },async getAllRecords(request){bulkReads.push(request.Entity);return {data:[]};},async searchRecord(){return {data:[]};}
  },META:{async getFields(){return {fields:Object.keys(data[0]).filter(k=>!k.includes('.')).map(api_name=>({api_name,data_type:'text'}))};}},UI:{async Resize(){}},CONFIG:{async getCurrentUser(){return {users:[]};}}}};
 });
 await page.goto('https://payments.test/');
 await page.locator('[data-tab-button="payments"]').click();
 await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 await page.locator('[data-payment-view="all"]').click();await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 const panel=page.locator('#payment-detail-sidebar'),layout=page.locator('#payments-list-layout'),table=page.locator('#payments-table-wrap');
 const row=id=>page.locator('[data-payment-id="'+id+'"]');
 const snapshot=()=>page.evaluate(()=>({ids:testState.views.payments.recordIds.slice(),filters:JSON.stringify(testState.views.payments.filters),applied:JSON.stringify(testState.views.payments.appliedFilters),page:testState.views.payments.page,top:document.querySelector('#payments-table-wrap').scrollTop,queries:queries.length}));
 assert.equal(await page.evaluate(()=>testState.views.payments.selectedId),'');
 assert.equal(await row('100000').getAttribute('aria-selected'),'false');
 assert.equal(await panel.isVisible(),false);
 const fullWidth=await page.locator('#payments-list-layout > .wide-panel').evaluate(e=>e.getBoundingClientRect().width);
 assert.ok(Math.abs(fullWidth-(await layout.boundingBox()).width)<2);
 assert.equal(await page.evaluate(()=>detailReads.length),0);
 await page.locator('#payment-filter-name').fill('draft not applied');
 await table.evaluate(e=>{e.scrollTop=120;});
 const before=await snapshot();
 await row('100000').dispatchEvent('click');
 await page.waitForTimeout(80);
 const intermediateWidth=(await page.locator('#payments-list-layout > .wide-panel').boundingBox()).width;
 assert.ok(intermediateWidth<fullWidth-5);
 await page.waitForFunction(()=>testState.views.payments.detailLoad && !testState.views.payments.detailLoad.loading);
 await page.waitForTimeout(260);
 assert.equal(await panel.isVisible(),true);assert.equal(await row('100000').getAttribute('aria-selected'),'true');
 assert.match(await page.locator('#selected-payment-created-by').innerText(),/Created by Creator PAY-001/);
 assert.equal(await page.locator('#selected-payment-account').innerText(),'Bank Alpha');
 assert.equal(await page.locator('#selected-payment-hero-meta').innerText(),'Outbound Payment | Bank Alpha');
 assert.ok(await page.locator('#payments-list-layout > .wide-panel').evaluate((e,w)=>e.getBoundingClientRect().width<w-200,fullWidth));
 assert.ok(intermediateWidth>(await page.locator('#payments-list-layout > .wide-panel').boundingBox()).width+5);
 assert.deepEqual(await snapshot(),before);
 await page.screenshot({path:'_local/previews/payment-detail-open-1440.png'});
 // Opening another payment keeps the panel open and uses that payment's lookup.
 await row('100001').dispatchEvent('click');
 assert.equal(await layout.evaluate(e=>e.classList.contains('is-detail-open')),true);
 assert.equal(await page.locator('#selected-payment-title').innerText(),'PAY-002');
 assert.doesNotMatch(await page.locator('#selected-payment-created-by').innerText(),/PAY-001/);
 await page.waitForFunction(()=>!testState.views.payments.detailLoad.loading);
 assert.equal(await page.locator('#selected-payment-account').innerText(),'Card Beta');
 assert.ok(await page.evaluate(()=>detailReads.some(([m,id])=>m==='Payment_Accounts'&&id==='account-b')));
 await row('100002').dispatchEvent('click');await page.waitForFunction(()=>!testState.views.payments.detailLoad.loading);
 assert.equal(await page.locator('#selected-payment-account').innerText(),'No payment account');
 assert.equal(await page.locator('#selected-payment-hero-meta').innerText(),'Outbound Payment | No payment account');
 assert.deepEqual(await snapshot(),before);
 const close=page.locator('#payment-detail-close');
 assert.equal(await close.getAttribute('title'),'Close');assert.ok((await close.boundingBox()).width>=36);
 await close.click();await page.waitForTimeout(260);
 assert.equal(await panel.isVisible(),false);assert.equal(await page.evaluate(()=>testState.views.payments.selectedId),'');
 assert.deepEqual(await snapshot(),before);
 assert.ok(Math.abs(fullWidth-(await page.locator('#payments-list-layout > .wide-panel').boundingBox()).width)<2);
 await page.screenshot({path:'_local/previews/payment-detail-closed-1440.png'});
 // Rapid selection: the first request resolves last and cannot replace the second.
 await page.evaluate(()=>{detailDelay['100000']=500;});
 await row('100000').dispatchEvent('click');await row('100001').dispatchEvent('click');
 await page.waitForFunction(()=>!testState.views.payments.detailLoad.loading);await page.waitForTimeout(550);
 assert.equal(await page.locator('#selected-payment-title').innerText(),'PAY-002');
 assert.equal(await page.locator('#selected-payment-account').innerText(),'Card Beta');
 // Closing during a request must not reopen or populate the inspector.
 await row('100000').dispatchEvent('click');await close.click();await page.waitForTimeout(550);
 assert.equal(await panel.isVisible(),false);assert.equal(await page.evaluate(()=>testState.views.payments.selectedId),'');
 await page.evaluate(()=>{failDetail=true;});await row('100003').dispatchEvent('click');await page.waitForFunction(()=>!testState.views.payments.detailLoad.loading);
 assert.match(await page.locator('#payment-detail-feedback').innerText(),/Could not load payment details/);
 await page.evaluate(()=>{failDetail=false;});await page.locator('#payment-detail-feedback button').click();await page.waitForFunction(()=>!testState.views.payments.detailLoad.loading);
 assert.match(await page.locator('#selected-payment-created-by').innerText(),/Creator PAY-004/);
 await close.click();await page.waitForTimeout(260);
 await page.emulateMedia({reducedMotion:'reduce'});await row('100001').dispatchEvent('click');
 assert.equal(await layout.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
 assert.equal(await panel.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
 await close.click();
 // Filters and refresh also leave no payment selected.
 await page.locator('#payment-filter-name').fill('');await page.locator('#payments-apply-filters').click();await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 assert.equal(await page.evaluate(()=>testState.views.payments.selectedId),'');
 await page.locator('#payments-refresh').click();await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 assert.equal(await panel.isVisible(),false);
 // A search that closes the inspector must still advance through empty
 // relationship windows when its first reply arrives during the transition.
 await page.emulateMedia({reducedMotion:'no-preference'});
 await row('100001').dispatchEvent('click');await page.waitForFunction(()=>!testState.views.payments.detailLoad.loading);
 await page.waitForTimeout(260);
 await page.locator('#payment-filter-mfsp').fill('TARGET');await page.locator('#payments-apply-filters').click();
 await page.waitForFunction(()=>testState.views.payments.hasLoaded && !testState.views.payments.hasMore);
 assert.equal(await page.locator('#payments-table-body [data-payment-id]').count(),1);
 assert.equal(await panel.isVisible(),false);
 await page.locator('#payment-filter-mfsp').fill('');await page.locator('#payments-apply-filters').click();await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 await page.setViewportSize({width:390,height:850});await row('100001').dispatchEvent('click');await page.waitForFunction(()=>!testState.views.payments.detailLoad.loading);
 assert.ok(await page.locator('#payments-list-layout > .wide-panel').evaluate(e=>e.getBoundingClientRect().width>300));
 await panel.scrollIntoViewIfNeeded();await page.screenshot({path:'_local/previews/payment-detail-open-390.png'});
 assert.deepEqual(errors,[]);
 console.log('Payments inspector: full-width empty state, open/close, preserved scroll/filter/page state, real lookup shapes, account fallback/null, rapid selection, retry and reduced motion passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
