const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='invoices.test')return route.fulfill({body:''});
  let file=path.join(process.cwd(),'app',url.pathname==='/'?'widget.html':url.pathname);
  let body=fs.readFileSync(file,'utf8');
  if(file.endsWith('main.js'))body='var originalState = window.AccountingManagerApp.createInitialState; window.AccountingManagerApp.createInitialState=function(){ window.testState=originalState(); return window.testState; };\n'+body;
  await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
 });
 await page.addInitScript(()=>{
  window.queries=[];window.failNext=false;window.delay=20;
  const data=Array.from({length:360},(_,i)=>({id:String(100000+i),Name:'INV-'+String(i+1).padStart(3,'0'),Status:i%2?'Paid':'Received',Invoice_Date:'2026-10-01',Invoice_Type:'Final Invoice',Supplier:{id:'9',name:'Example'},Supplier_Name:'Example',Supplier_Code:'ABC',MFSP_Reference:'MFSP',Total_Payable_Amount:100,'Supplier.Destination':'Spain','Supplier.Is_Self_Employed':true}));
  let onLoad;
  window.ZOHO={embeddedApp:{on(name,fn){onLoad=fn;},async init(){onLoad({});}},CRM:{API:{
   async coql({select_query:q}){
    if(!q.includes('from Supplier_Invoices'))return {data:[]};
    queries.push(q);const fail=failNext;failNext=false;await new Promise(r=>setTimeout(r,delay));if(fail)throw Error('Test network failure');
    let rows=data.slice();
    if(q.includes('Status not in'))rows=rows.filter(r=>r.Status==='Received');
    else if(q.includes('Status in'))rows=rows.filter(r=>r.Status==='Paid');
    const name=q.match(/Name like '%([^']*)%'/);if(name)rows=rows.filter(r=>r.Name.includes(name[1]));
    const limit=q.match(/limit (\d+), (\d+)/);rows=rows.slice(+limit[1],+limit[1]+ +limit[2]);return {data:rows};
   },async getAllRecords(){return {data:[]};},async searchRecord(){return {data:[]};}
  },META:{async getFields(){return {fields:Object.keys(data[0]).filter(k=>!k.includes('.')).map(api_name=>({api_name,data_type:'text'}))};}},UI:{async Resize(){}},CONFIG:{async getCurrentUser(){return {users:[]};}}}};
 });
 await page.goto('https://invoices.test/');
 await page.locator('[data-tab-button="invoices"]').click();
 await page.waitForFunction(()=>window.testState.views.invoices.hasLoaded);
 const rows=()=>page.locator('#invoices-table-body tr[data-invoice-id]').count();
 assert.equal(await rows(),50);
 for(const tab of ['open','closed','all']){
  await page.locator('#invoice-filter-number').fill('');await page.locator('#invoices-apply-filters').click();
  await page.waitForFunction(()=>!testState.views.invoices.loadingInitial);
  await page.locator('[data-invoice-view="'+tab+'"]').click();
  await page.waitForFunction(()=>testState.views.invoices.hasLoaded);
  assert.equal(await rows(),50);
  const n=await page.evaluate(()=>queries.length);
  await page.locator('#invoice-filter-number').fill('INV-359');await page.waitForTimeout(500);
  assert.equal(await rows(),50);assert.equal(await page.evaluate(()=>queries.length),n);
  const top=await page.locator('#invoices-table-wrap').evaluate(e=>{e.scrollTop=e.scrollHeight-e.clientHeight-50;e.dispatchEvent(new Event('scroll'));return e.scrollTop;});
  await page.waitForFunction(()=>testState.records.invoices.length===100);
  assert.equal(await rows(),100);
  assert.equal(await page.locator('#invoices-table-wrap').evaluate(e=>e.scrollTop),top);
  assert.ok(!(await page.evaluate(()=>queries.at(-1))).includes('INV-359'));
  if(tab==='closed')await page.locator('#invoice-filter-number').fill('INV-360');
  await page.locator('#invoices-apply-filters').click();await page.waitForFunction(()=>testState.views.invoices.hasLoaded);
  assert.equal(await rows(),1);assert.equal(await page.locator('#invoices-table-wrap').evaluate(e=>e.scrollTop),0);
 }
 await page.locator('#invoice-filter-number').fill('');await page.locator('#invoices-apply-filters').click();await page.waitForFunction(()=>testState.views.invoices.hasLoaded);
 await page.evaluate(()=>{failNext=true;delay=200;});
 await page.locator('#invoices-table-wrap').evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));});
 await page.waitForSelector('.invoice-load-spinner');assert.equal(await rows(),50);
 await page.waitForFunction(()=>!!testState.views.invoices.loadError);assert.equal(await rows(),50);
 await page.getByRole('button',{name:'Retry',exact:true}).click();await page.waitForFunction(()=>testState.records.invoices.length===100);
 await page.locator('#invoice-filter-number').fill('MISSING');await page.locator('#invoices-apply-filters').click();await page.waitForFunction(()=>testState.views.invoices.hasLoaded);
 assert.match(await page.locator('#invoices-empty').innerText(),/No invoices match/);
 await page.locator('#invoice-filter-number').fill('');await page.locator('#invoices-apply-filters').click();await page.waitForFunction(()=>testState.views.invoices.hasLoaded);
 // Switching tabs must retain applied values, including when a draft differs.
 await page.locator('#invoice-filter-number').fill('INV-359');
 await page.locator('[data-invoice-view="open"]').click();
 await page.waitForFunction(()=>testState.views.invoices.hasLoaded);
 assert.equal(await rows(),50);
 assert.ok(!(await page.evaluate(()=>queries.at(-1))).includes('INV-359'));
 // A newer search may finish first. The older response must not overwrite it.
 await page.evaluate(()=>{delay=600;});
 await page.locator('#invoices-apply-filters').click();
 await page.waitForFunction(()=>queries.at(-1).includes('INV-359'));
 await page.evaluate(()=>{delay=20;});
 await page.locator('#invoice-filter-number').fill('INV-357');
 await page.locator('#invoices-apply-filters').click();
 await page.waitForFunction(()=>testState.views.invoices.hasLoaded);
 await page.waitForTimeout(650);
 assert.equal(await rows(),1);
 assert.match(await page.locator('#invoices-table-body').innerText(),/INV-357/);
 await page.locator('#invoice-filter-number').fill('');await page.locator('#invoices-apply-filters').click();await page.waitForFunction(()=>testState.views.invoices.hasLoaded);
 await page.screenshot({path:'_local/previews/invoices-pagination-1440.png'});
 await page.setViewportSize({width:390,height:850});await page.screenshot({path:'_local/previews/invoices-pagination-390.png'});
 assert.deepEqual(errors,[]);console.log('Full widget: Open/Closed/All, pending input, remote search beyond first batch, scroll position, spinner, retry and empty state passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
