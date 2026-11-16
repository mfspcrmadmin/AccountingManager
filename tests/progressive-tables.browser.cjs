const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>{errors.push(e.stack);console.error(e.stack);});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='payments.test')return route.fulfill({body:''});
  let file=path.join(process.cwd(),'app',url.pathname==='/'?'widget.html':url.pathname);
  let body=fs.readFileSync(file,'utf8');
  if(file.endsWith('main.js'))body='var originalState = window.AccountingManagerApp.createInitialState; window.AccountingManagerApp.createInitialState=function(){ window.testState=originalState(); return window.testState; };\n'+body;
  await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
 });

 await page.addInitScript(()=>{
  window.queries=[];window.failNext=false;window.slowNext=false;
  const data=Array.from({length:160},(_,i)=>({id:String(10000+i),Name:'ROW-'+(i+1),Deal_Name:'ROW-'+(i+1),Stage:'Won',Arrival_Date:'2026-10-01',Entry_Date:'2026-10-01',Source_Date:'2026-10-01',Accounting_Status:'Posted',Total_Debit:i,Total_Credit:i,Amount:i,Service_Date:'2026-10-01'}));
  let onLoad;
  window.ZOHO={embeddedApp:{on(n,f){onLoad=f;},async init(){onLoad({});}},CRM:{API:{
   async coql({select_query:q}){queries.push(q);const fail=failNext,slow=slowNext;failNext=false;slowNext=false;await new Promise(r=>setTimeout(r,slow?350:15));if(fail)throw Error('Network offline');let rows=data.slice();
    const name=q.match(/(?:Deal_Name|Name) like '%([^']*)%'/);if(name)rows=rows.filter(r=>r.Name===name[1]);
    const ids=q.match(/id in \(([^)]+)\)/);if(ids)rows=rows.filter(r=>ids[1].includes("'"+r.id+"'"));
    if(q.includes('Total_Debit asc'))rows.sort((a,b)=>a.Total_Debit-b.Total_Debit);if(q.includes('Total_Debit desc'))rows.sort((a,b)=>b.Total_Debit-a.Total_Debit);
    const lim=q.match(/limit (\d+), (\d+)$/);if(lim)rows=rows.slice(+lim[1],+lim[1]+ +lim[2]);return {data:rows};
   },async getAllRecords(){throw Error('Unexpected full download');},async searchRecord(){return {data:[]};},async getRecord({RecordID}){return {data:[data.find(r=>r.id===RecordID)]};}
  },META:{async getFields(){return {fields:Object.keys(data[0]).map(api_name=>({api_name,data_type:'text'}))};}},UI:{async Resize(){}},CONFIG:{async getCurrentUser(){return {users:[]};}}}};
 });
 page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(10000);
 await page.goto('https://payments.test/');
 for(const [tab,key,prefix,filter,load] of [
  ['bookings','bookings','bookings','#bookings-filter-name','#bookings-load'],
  ['accounting','accountingEntries','accounting-entries','#accounting-entry-filter-name','#accounting-entries-load']
 ]){
  await page.locator('[data-tab-button="'+tab+'"]').click();
  await page.waitForFunction(k=>testState.views[k].hasLoaded&&!testState.views[k].loadingMore,key);
  const wrap=page.locator('#'+prefix+'-table-wrap');
  await page.waitForFunction(id=>{const e=document.getElementById(id);return e.scrollHeight>e.clientHeight},prefix+'-table-wrap');
  const before=await page.locator('#'+prefix+'-table-body tr').count();assert.ok(before>=10&&before<160);
  await page.locator(filter).fill('ROW-159');const n=await page.evaluate(()=>queries.length);await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>queries.length),n);
  const top=await wrap.evaluate(e=>{e.scrollTop=e.scrollHeight-e.clientHeight;e.dispatchEvent(new Event('scroll'));return e.scrollTop;});
  await page.waitForFunction(({id,n})=>document.querySelectorAll('#'+id+'-table-body tr').length>n,{id:prefix,n:before});
  assert.equal(await wrap.evaluate(e=>e.scrollTop),top);
  await page.locator(load).click();await page.waitForFunction(k=>testState.views[k].hasLoaded&&!testState.views[k].loadingInitial,key);
  assert.equal(await page.locator('#'+prefix+'-table-body tr').count(),1);assert.ok((await page.locator('#'+prefix+'-table-body').textContent()).includes('ROW-159'));
  await page.evaluate(()=>slowNext=true);await page.locator(filter).fill('ROW-158');await page.locator(load).click();
  await page.locator(filter).fill('ROW-157');await page.locator(filter).press('Enter');await page.waitForTimeout(450);
  assert.ok((await page.locator('#'+prefix+'-table-body').textContent()).includes('ROW-157'));assert.ok(!(await page.locator('#'+prefix+'-table-body').textContent()).includes('ROW-158'));
  await page.evaluate(()=>failNext=true);await page.locator(load).click();await page.locator('#'+prefix+'-table-wrap .progressive-table-footer button').waitFor();
  await page.locator('#'+prefix+'-table-wrap .progressive-table-footer button').click();await page.waitForFunction(k=>testState.views[k].hasLoaded,key);
  assert.equal(await page.locator('#'+prefix+'-pagination-bar').count(),0);
 }
 for(const [tab,key,prefix] of [['lines','accountingEntryLines','accounting-entry-lines'],['accounts','accountingAccounts','accounting-accounts'],['rules','accountingRules','accounting-rules']]){
  await page.locator('#accounting-tab-'+tab).click();await page.waitForFunction(k=>testState.views[k].hasLoaded,key);
  assert.ok(await page.locator('#'+prefix+'-table-body tr').count()>0);assert.equal(await page.locator('#'+prefix+'-pagination-bar').count(),0);
 }
 await page.screenshot({path:'_local/previews/progressive-accounting-1440.png'});
 await page.locator('[data-tab-button="payments"]').click();
 for(const [section,key,prefix,field] of [['allocations','paymentAllocations','payment-allocations','payment-allocation-filter-reference'],['accounts','paymentAccounts','payment-accounts','payment-account-filter-query']]){
  await page.locator('#payments-section-tab-'+section).click();
  await page.waitForFunction(k=>testState.views[k].hasLoaded&&!testState.views[k].loadingMore,key);
  await page.locator('#'+field).fill('ROW-159');
  await page.locator('#'+prefix+'-apply-filters').click();
  await page.waitForFunction(k=>testState.views[k].hasLoaded,key);
  assert.equal(await page.locator('#'+prefix+'-table-body tr').count(),1);
  assert.ok((await page.locator('#'+prefix+'-table-body').textContent()).includes('ROW-159'));
 }
 await page.locator('[data-tab-button="invoices"]').click();
 await page.waitForFunction(()=>testState.views.invoices.hasLoaded);
 await page.locator('#invoices-table-body tr[data-invoice-id]').first().click();
 await page.locator('#selected-invoice-tab-payment').click();
 await page.waitForFunction(()=>document.querySelectorAll('#selected-invoice-lines-list tr').length===50).catch(async error=>{ console.log(await page.evaluate(()=>({rows:document.querySelectorAll('#selected-invoice-lines-list tr').length,text:document.getElementById('selected-invoice-lines-table-wrap').textContent,queries:queries.slice(-6)})));throw error; });
 const detailWrap=page.locator('#selected-invoice-lines-table-wrap');
 await detailWrap.evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));});
 await page.waitForFunction(()=>document.querySelectorAll('#selected-invoice-lines-list tr').length===100);
 assert.ok(await page.evaluate(()=>queries.some(q=>q.includes("from Supplier_Invoice_Lines")&&q.includes("Supplier_Invoice = '10000'")&&q.includes('limit 50, 51'))));
 await page.locator('[data-tab-button="accounting"]').click();
 await page.locator('#accounting-tab-rules').click();
 await page.waitForFunction(()=>testState.views.accountingRules.hasLoaded);
 await page.setViewportSize({width:390,height:850});
 assert.ok(await page.locator('#accounting-rules-table-wrap').evaluate(e=>e.clientWidth<390));
 await page.screenshot({path:'_local/previews/progressive-accounting-390.png'});
 assert.deepEqual(errors,[]);console.log('Bookings and all four Accounting tabs: automatic fill, append, scroll preservation, source search, draft filters, race isolation and retry passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
