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
  window.queries=[];window.bulkReads=[];window.failNext=false;window.delay=20;
  const data=Array.from({length:360},(_,i)=>({id:String(100000+i),Name:'PAY-'+String(i+1).padStart(3,'0'),Status:i%2?'Paid':'Pending Payment',Payment_Date:'2026-10-01',Payment_Type:'Final Payment',Supplier:{id:'9',name:'Example'},Supplier_Name:'Example',Supplier_Code:'ABC',MFSP_Reference:'MFSP',Payment_Amount:100,'Supplier.Destination':'Spain','Supplier.Is_Self_Employed':true}));
  let onLoad;
  window.ZOHO={embeddedApp:{on(name,fn){onLoad=fn;},async init(){onLoad({});}},CRM:{API:{
   async coql({select_query:q}){
    if(q.includes('in (select'))throw Error('Nested queries are unavailable in this SDK fixture');
    if(q.includes('Supplier_Invoice.Booking.MFSP_Reference')&&/(?<![.])\bBooking\.MFSP_Reference/.test(q))throw {code:'LIMIT_EXCEEDED',message:'join limit exceeded',details:{by:'relation',limit:2}};
    if(q.startsWith('select Supplier_Payment from Supplier_Pay_Allocations')){
      const scope=q.match(/Supplier_Payment (?:in \(([^)]+)\)|= ('[^']+'))/);
      const ids=scope[1]||scope[2];
      return {data:ids.includes("'100358'")?[{Supplier_Payment:{id:'100358'}}]:[]};
    }
    if(!q.includes('from Supplier_Payments'))return {data:[]};
    queries.push(q);const fail=failNext;failNext=false;await new Promise(r=>setTimeout(r,delay));if(fail)throw Error('Test network failure');
    let rows=data.slice();
    if(q.includes("Status = 'Pending Payment'"))rows=rows.filter(r=>r.Status==='Pending Payment');
    else if(q.includes('Status in'))rows=rows.filter(r=>r.Status==='Paid');
    const name=q.match(/Name like '%([^']*)%'/);if(name)rows=rows.filter(r=>r.Name.includes(name[1]));
    const ids=q.match(/id in \(([^)]+)\)/);
    if(ids)rows=rows.filter(r=>ids[1].includes("'"+r.id+"'"));
    const single=q.match(/\bid = '([^']+)'/);if(single)rows=rows.filter(r=>r.id===single[1]);
    if(q.includes("MFSP_Reference like '%TARGET%'"))rows=rows.filter(r=>r.Name==='PAY-359');
    const limit=q.match(/limit (\d+), (\d+)$/);rows=rows.slice(+limit[1],+limit[1]+ +limit[2]);return {data:rows};
   },async getAllRecords(request){bulkReads.push(request.Entity);return {data:[]};},async searchRecord(){return {data:[]};}
  },META:{async getFields(){return {fields:Object.keys(data[0]).filter(k=>!k.includes('.')).map(api_name=>({api_name,data_type:'text'}))};}},UI:{async Resize(){}},CONFIG:{async getCurrentUser(){return {users:[]};}}}};
 });
 await page.goto('https://payments.test/');
 await page.locator('[data-tab-button="payments"]').click();
 await page.waitForFunction(()=>window.testState.views.payments.hasLoaded);
 const rows=()=>page.locator('#payments-table-body tr[data-payment-id]').count();
 assert.equal(await rows(),50);
 for(const tab of ['open','closed','all']){
  await page.locator('#payment-filter-name').fill('');await page.locator('#payments-apply-filters').click();
  await page.waitForFunction(()=>!testState.views.payments.loadingInitial);
  await page.locator('[data-payment-view="'+tab+'"]').click();
  await page.waitForFunction(()=>testState.views.payments.hasLoaded);
  assert.equal(await rows(),50);
  const n=await page.evaluate(()=>queries.length);
  await page.locator('#payment-filter-name').fill('PAY-359');await page.waitForTimeout(500);
  assert.equal(await rows(),50);assert.equal(await page.evaluate(()=>queries.length),n);
  const top=await page.locator('#payments-table-wrap').evaluate(e=>{e.scrollTop=e.scrollHeight-e.clientHeight-50;e.dispatchEvent(new Event('scroll'));return e.scrollTop;});
  await page.waitForFunction(()=>testState.views.payments.recordIds.length===100);
  assert.equal(await rows(),100);
  assert.equal(await page.locator('#payments-table-wrap').evaluate(e=>e.scrollTop),top);
  assert.ok(!(await page.evaluate(()=>queries.at(-1))).includes('PAY-359'));
  if(tab==='closed')await page.locator('#payment-filter-name').fill('PAY-360');
  await page.locator('#payments-apply-filters').click();await page.waitForFunction(()=>testState.views.payments.hasLoaded);
  assert.equal(await rows(),1);assert.equal(await page.locator('#payments-table-wrap').evaluate(e=>e.scrollTop),0);
 }
 await page.locator('#payment-filter-name').fill('');await page.locator('#payments-apply-filters').click();await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 await page.evaluate(()=>{failNext=true;delay=200;});
 await page.locator('#payments-table-wrap').evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));});
 await page.waitForSelector('.payment-load-spinner');assert.equal(await rows(),50);
 await page.waitForFunction(()=>!!testState.views.payments.loadError);assert.equal(await rows(),50);
 await page.getByRole('button',{name:'Retry',exact:true}).click();await page.waitForFunction(()=>testState.views.payments.recordIds.length===100);
 await page.locator('#payment-filter-name').fill('MISSING');await page.locator('#payments-apply-filters').click();await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 assert.match(await page.locator('#payments-empty').innerText(),/No payments match/);
 await page.locator('#payment-filter-name').fill('');await page.locator('#payments-apply-filters').click();await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 // Switching tabs must retain applied values, including when a draft differs.
 await page.locator('#payment-filter-name').fill('PAY-359');
 await page.locator('[data-payment-view="open"]').click();
 await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 assert.equal(await rows(),50);
 assert.ok(!(await page.evaluate(()=>queries.at(-1))).includes('PAY-359'));
 // A newer search may finish first. The older response must not overwrite it.
 await page.evaluate(()=>{delay=600;});
 await page.locator('#payments-apply-filters').click();
 await page.waitForFunction(()=>queries.at(-1).includes('PAY-359'));
 await page.evaluate(()=>{delay=20;});
 await page.locator('#payment-filter-name').fill('PAY-357');
 await page.locator('#payments-apply-filters').click();
 await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 await page.waitForTimeout(650);
 assert.equal(await rows(),1);
 assert.match(await page.locator('#payments-table-body').innerText(),/PAY-357/);
 await page.locator('#payment-filter-name').fill('');await page.locator('#payments-apply-filters').click();await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 // Sparse relation search must continue across empty windows and find a
 // payment beyond both the first batch and the 100-row subquery limit.
 await page.locator('[data-payment-view="all"]').click();await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 await page.locator('#payment-filter-mfsp').fill('TARGET');
 await page.locator('#payment-filter-supplier-code').fill('SECOND');
 await page.locator('#payments-apply-filters').click();
 await page.waitForFunction(()=>testState.views.payments.hasLoaded && !testState.views.payments.hasMore);
 assert.equal(await rows(),1);assert.match(await page.locator('#payments-table-body').innerText(),/PAY-359/);
 assert.ok(!(await page.evaluate(()=>queries)).some(q=>q.includes('in (select')));
 await page.locator('#payment-filter-mfsp').fill('');await page.locator('#payment-filter-supplier-code').fill('');
 await page.locator('#payments-apply-filters').click();await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 assert.equal(await page.evaluate(()=>bulkReads.includes('Supplier_Payments') || bulkReads.includes('Supplier_Pay_Allocations')),false);
 // Accounts owns a separate progressive query and never downloads the global payment context.
 await page.locator('#payments-section-tab-accounts').click();
 await page.waitForFunction(()=>testState.views.paymentAccounts.hasLoaded);
 assert.equal(await page.evaluate(()=>bulkReads.includes('Supplier_Payments') || bulkReads.includes('Supplier_Pay_Allocations')),false);
 await page.locator('#payments-section-tab-payments').click();
 await page.waitForFunction(()=>testState.views.payments.hasLoaded);
 assert.equal(await rows(),50);
 await page.screenshot({path:'_local/previews/payments-pagination-1440.png'});
 await page.setViewportSize({width:390,height:850});assert.ok(await page.locator('#payments-browser-workspace .wide-panel').evaluate(e=>e.getBoundingClientRect().width>300));await page.screenshot({path:'_local/previews/payments-pagination-390.png'});
 assert.deepEqual(errors,[]);console.log('Full widget: Open/Closed/All, pending input, remote search beyond first batch, scroll position, spinner, retry and empty state passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

