const {chromium}=require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage();
 await page.route('https://accounting.test/**',route=>route.fulfill({contentType:'text/html',body:'<button id="navigate" onclick="this.textContent=\'Navigated\'">Navigate</button>'}));
 await page.goto('https://accounting.test/');
  await page.evaluate(()=>document.body.classList.add('accounting-widget'));
  await page.addScriptTag({path:'app/scripts/ui-system.js'});
 for(const match of fs.readFileSync('app/widget.html','utf8').matchAll(/<link[^>]*href="\.\/([^"?]+\.css)[^" ]*"/g)) await page.addStyleTag({path:'app/'+match[1]});
 await page.addScriptTag({path:'app/scripts/invoice-edit.js'});
 await page.evaluate(()=>{
  window.calls=[];window.notices=[];window.refreshes=[];localStorage.setItem('accounting-manager:invoice-edit:v1:1',JSON.stringify({operationKey:'same-key',request:{action:'resume'}}));
  window.editor=AccountingManagerApp.createInvoiceEditor({helpers:{escapeHtml:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;')},
   crm:{async executeFunction(name,args){let request=JSON.parse(args.requestJson);calls.push({key:args.operationKey,request});
    let output=request.action==='preview'?{success:true,pending:true,operation_key:'same-key',invoice:{Name:'INV-TEST',Supplier:{name:'Supplier'},Invoice_File:[],Edit_Request:JSON.stringify({phase:'Applied',before:{Total_Payable_Amount:100},header:{Total_Payable_Amount:120}})}}:await new Promise(resolve=>window.reply=resolve);
    return {details:{output:JSON.stringify(output)}};
   }},refresh:async id=>refreshes.push(id),notify:message=>notices.push(message),openAdditionalPayment:async()=>{throw Error('Unexpected payment form');}});
 });
 await page.evaluate(()=>editor.open('1'));
 const save=page.locator('[data-edit-save]'),toggle=page.locator('[data-edit-continue]');
 await save.click(); assert.equal(await toggle.isVisible(),false);
 await page.evaluate(()=>reply({success:false,pending:true,saved:true,progress:{stage:'settlements'}}));
 await toggle.waitFor({state:'visible'}); await toggle.click();
 assert.equal(await page.locator('dialog').evaluate(d=>d.matches(':modal')),false);
 await page.locator('#navigate').click();assert.equal(await page.locator('#navigate').innerText(),'Navigated');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:800});
  const r=await page.locator('dialog').evaluate(d=>{const r=d.getBoundingClientRect();return {left:r.left,right:r.right,overflow:d.scrollWidth>d.clientWidth};});
  assert.ok(r.left>=0 && r.right<=width && !r.overflow,JSON.stringify(r));
 }
 await page.evaluate(()=>editor.open('2'));
 assert.equal(await page.locator('dialog').evaluate(d=>d.matches(':modal')),true);
 assert.equal(await page.evaluate(()=>calls.length),3);
 await toggle.click();
 await page.evaluate(()=>reply({success:false,saved:true,retryable:true,message:'Rebuild unavailable'}));
 await page.waitForFunction(()=>document.querySelector('[data-edit-save]').textContent==='Resume correction');
 assert.match(await page.locator('[data-edit-message]').innerText(),/incomplete/);
 assert.equal(await page.evaluate(()=>notices.length),0);
 assert.ok(await page.evaluate(()=>localStorage.getItem('accounting-manager:invoice-edit:v1:1')));
 await page.setViewportSize({width:1440,height:900});
 await page.screenshot({path:'_local/previews/invoice-edit-background-recovery.png'});
 await save.click();
 await page.evaluate(()=>reply({success:true,payment_action:'keep'}));
 await page.waitForFunction(()=>document.querySelector('[data-edit-message]').textContent.includes('view are updated'));
 assert.deepEqual(await page.evaluate(()=>refreshes),['1']);
 assert.equal(await page.evaluate(()=>localStorage.getItem('accounting-manager:invoice-edit:v1:1')),null);
 assert.ok(await page.evaluate(()=>calls.filter(c=>c.request.action!=='preview').every(c=>c.key==='same-key')));
 await page.screenshot({path:'_local/previews/invoice-edit-background-complete.png'});
 console.log('PASS: server-confirmed minimization, usable navigation, 3 viewport widths, singleton protection, failure, same-key retry, refresh and completion.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
