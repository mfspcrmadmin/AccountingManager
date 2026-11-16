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
  if(file.endsWith('main.js'))body=body.replace('function renderAll()', 'function renderAll()').replace('  var supplierActivityModule =', '  window.testRender = renderAll;\n  var supplierActivityModule =');
  if(file.endsWith('main.js'))body='var originalState = window.AccountingManagerApp.createInitialState; window.AccountingManagerApp.createInitialState=function(){ window.testState=originalState(); return window.testState; };\n'+body;
  await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
 });
 await page.addInitScript(()=>{
  window.functionCalls=[];window.recipientDelay=0;window.contactFail=false;window.sendFail=false;window.queries=[];window.failLetter=false;window.letterDelay=0;
  const allocations=Array.from({length:203},(_,i)=>({id:String(3000+i),Name:'WRONG-PAYMENT-NAME',Supplier_Payment:{id:'100'},Supplier:{id:'9'},Supplier_Invoice:{id:String(6000+i),name:i?'INV-'+i:null},Invoice_Date:'2026-10-14',MFSP_Reference:'MFSP-1',Allocated_Amount:i===202?20:10,Movement_Type:i===202?'Supplier Refund':'Outbound Payment'}));
  let onLoad;
  window.ZOHO={embeddedApp:{on(n,fn){onLoad=fn;},async init(){onLoad({});}},CRM:{API:{
   async coql({select_query:q}){
    queries.push(q);
    if(!q.includes('from Supplier_Pay_Allocations')) return {data:[]};
    await new Promise(r=>setTimeout(r,letterDelay));
    if(failLetter)throw Error('Fixture failure');
    if(!q.includes("Supplier_Payment = '100'")||!q.includes("Supplier = '9'"))throw Error('Unscoped letter query');
    const m=q.match(/limit (\d+), (\d+)$/);return {data:allocations.slice(+m[1],+m[1]+ +m[2])};
   },async getRecord(r){return {data:[r.Entity==='Supplier_Invoices'?{id:r.RecordID,Name:'REAL-INVOICE-WITH-A-LONG-COMPLETE-NAME-123456789'}:{id:r.RecordID,Name:'PAY-EXAMPLE',Payment_Date:'2026-10-14',Payment_Amount:99999}]};},
   async getAllRecords(){return {data:[]};},async searchRecord(r){if(r.Entity==='Contacts'){if(contactFail)throw Error('Contacts unavailable');return {data:[{id:'c1',Full_Name:'Accounts Contact',Email:'chosen@example.com'},{id:'c2',Full_Name:'No Email',Email:''}]};}return {data:[]};}
  },FUNCTIONS:{async execute(name,request){const args=JSON.parse(request.arguments);functionCalls.push({name,args});if(name==='getSupplierContactByType'){await new Promise(r=>setTimeout(r,recipientDelay));return {details:{output:JSON.stringify({Email:'default@example.com'})}};}await new Promise(r=>setTimeout(r,150));return {details:{output:JSON.stringify(sendFail?{error:true,message:'Send rejected'}:{message:'Payment letter sent successfully.'})}};}},META:{async getFields(){return {fields:Object.keys(allocations[0]).map(api_name=>({api_name,data_type:'text'}))};}},UI:{async Resize(){}},CONFIG:{async getCurrentUser(){return {users:[{email:"sender@example.com"}]};}}}};
 });
 await page.goto('https://payments.test/');
 await page.waitForFunction(()=>window.testRender && window.testState);
 await page.evaluate(()=>{
  Object.assign(testState,{supplierId:'9',supplier:{id:'9',Vendor_Name:'Supplier Alpha'},supplierActivityTab:'payments',supplierPayments:[{id:'100',Name:'PAY-EXAMPLE',Payment_Date:'2026-10-14',Payment_Amount:99999}]});testRender();
 });
 const button=page.locator('[data-supplier-payment-letter="100"]');
 await button.click();
 const dialog=page.locator('#supplier-payment-letter-preview');
 await dialog.locator('tfoot').waitFor();
 assert.equal(await dialog.locator('tbody tr').count(),203);
 assert.match(await dialog.locator('tfoot').innerText(),/2,000.00/);
 assert.match(await dialog.locator('tbody').innerText(),/REAL-INVOICE-WITH-A-LONG-COMPLETE-NAME-123456789/);
 assert.doesNotMatch(await dialog.innerText(),/WRONG-PAYMENT-NAME|99,999/);
 assert.equal(await page.evaluate(()=>testState.supplierActivityDetail.isOpen),false);
 assert.ok((await page.evaluate(()=>queries)).some(q=>q.includes('limit 200, 200')));
 await page.screenshot({path:'_local/previews/supplier-letter-preview-1440.png'});
 const [download]=await Promise.all([page.waitForEvent('download'),dialog.locator('[data-letter-download]').click()]);
 await download.saveAs('_local/previews/supplier-letter-preview.pdf');
 assert.match(fs.readFileSync('_local/previews/supplier-letter-preview.pdf','utf8'),/2,000.00/);
 await dialog.locator('[data-letter-close]').click();
 assert.equal(await button.evaluate(e=>document.activeElement===e),true);
 await page.evaluate(()=>{window.failLetter=true;});await button.click();await dialog.locator('[data-letter-retry]:visible').waitFor();
 assert.equal(await dialog.locator('[data-letter-download]').isDisabled(),true);
 await page.evaluate(()=>{window.failLetter=false;});await dialog.locator('[data-letter-retry]').click();await dialog.locator('tfoot').waitFor();
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{window.letterDelay=250;});await button.click();await page.keyboard.press('Escape');await page.waitForTimeout(600);
 assert.equal(await dialog.evaluate(e=>e.open),false);
 await page.setViewportSize({width:390,height:844});await button.click();await dialog.locator('tfoot').waitFor();
 assert.ok((await dialog.boundingBox()).width<=390);
 await page.screenshot({path:'_local/previews/supplier-letter-preview-390.png'});
 // Opening recipient tools never sends; selecting and editing override the default email.
 await dialog.locator('[data-letter-send]').click();
 await page.waitForFunction(()=>document.querySelector('[data-letter-email]').value==='default@example.com');
 assert.equal((await page.evaluate(()=>functionCalls.filter(c=>c.name==='sendsupplierpaymentletter'))).length,0);
 await page.evaluate(()=>{contactFail=true;});
 await dialog.locator('[data-letter-contacts]').click();
 await dialog.locator('[data-letter-contact-list] .payment-letter-warning').waitFor();
 await dialog.locator('[data-letter-contacts]').click();await page.evaluate(()=>{contactFail=false;});
 await dialog.locator('[data-letter-contacts]').click();
 await dialog.locator('[data-letter-contact-search]').fill('Accounts');
 await dialog.locator('[data-payment-letter-select-contact]').click();
 assert.equal(await dialog.locator('[data-letter-email]').inputValue(),'chosen@example.com');
 await dialog.locator('[data-letter-edit]').click();
 await dialog.locator('[data-letter-email]').fill('invalid');
 assert.equal(await dialog.locator('[data-letter-confirm]').isDisabled(),true);
 await dialog.locator('[data-letter-email]').fill('edited@example.com');
 await page.screenshot({path:'_local/previews/supplier-letter-recipient-390.png'});
 await page.evaluate(()=>{sendFail=true;});
 await dialog.locator('[data-letter-confirm]').click();
 await page.waitForFunction(()=>document.querySelector('[data-letter-send-status]').textContent==='Send rejected');
 assert.equal(await dialog.locator('[data-letter-email]').inputValue(),'edited@example.com');
 await page.evaluate(()=>{sendFail=false;});
 await dialog.locator('[data-letter-confirm]').evaluate(button=>{button.click();button.click();});
 await page.keyboard.press('Escape');assert.equal(await dialog.evaluate(e=>e.open),true);
 await page.waitForFunction(()=>document.querySelector('[data-letter-confirm]').textContent==='Sent');
 const sends=await page.evaluate(()=>functionCalls.filter(c=>c.name==='sendsupplierpaymentletter'));
 assert.equal(sends.length,2); // one failed, one successful, no double send
 assert.equal(sends[1].args.paymentId,'100');assert.equal(sends[1].args.supplierIds,'9');
 assert.deepEqual(JSON.parse(sends[1].args.supplierEmailMapStr),{'9':'edited@example.com'});
 assert.equal(sends[1].args.actingUserEmail,'sender@example.com');
 await dialog.locator('[data-letter-close]').click();
 // A late default-recipient response cannot overwrite the user's chosen contact.
 await page.evaluate(()=>{recipientDelay=600;});await button.click();await dialog.locator('tfoot').waitFor();
 await dialog.locator('[data-letter-send]').click();await dialog.locator('[data-letter-contacts]').click();
 await dialog.locator('[data-payment-letter-select-contact]:enabled').click();
 await page.waitForTimeout(700);assert.equal(await dialog.locator('[data-letter-email]').inputValue(),'chosen@example.com');
 await page.setViewportSize({width:1440,height:900});
 await page.screenshot({path:'_local/previews/supplier-letter-recipient-1440.png'});

 assert.deepEqual(errors,[]);
 console.log('Supplier letter preview: scoped pagination, invoice names, refunds/total, PDF, scoped sending, contact search/selection/edit, validation, retry, duplicate prevention, stale recipient and mobile passed.');
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
