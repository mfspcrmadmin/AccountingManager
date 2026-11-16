const {chromium}=require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage();
  await page.route('https://accounting.test/**',route=>route.fulfill({contentType:'text/html',body:'<details id="pending" class="pending-operations" hidden></details>'}));
  await page.goto('https://accounting.test/');
  await page.evaluate(()=>document.body.classList.add('accounting-widget'));
  await page.addScriptTag({path:'app/scripts/ui-system.js'});
  for(const file of ['theme.css','layout.css','components.css','visual-refresh.css','pending-operations.css','ui-system.css']) await page.addStyleTag({content:fs.readFileSync('app/styles/'+file,'utf8')});
  await page.addScriptTag({path:'app/scripts/pending-operations.js'});
  await page.evaluate(()=>{
   window.opened=[];
   window.panel=AccountingManagerApp.mountPendingOperations(document.getElementById('pending'),async row=>{opened.push(row.type);if(window.waitOpen)await new Promise(resolve=>window.finishOpen=resolve);if(window.failOpen)throw Error('CRM unavailable');});
  });
  assert.equal(await page.locator('#pending').isVisible(),false);
  await page.evaluate(()=>{localStorage.setItem('accounting-manager:payment-save:v1',JSON.stringify({plan:{payment:{Name:'<img src=x onerror=alert(1)>'},entries:[]}}));panel.refresh();});
  await page.locator('#pending > summary').click();
  assert.equal(await page.locator('img').count(),0);
  await page.evaluate(()=>window.waitOpen=true);
  await page.getByRole('button',{name:'Review operation'}).click();
  assert.equal(await page.locator('.pending-feedback.is-loading').isVisible(),true);
  assert.match(await page.locator('.pending-feedback').innerText(),/Opening/);
  await page.evaluate(()=>{window.waitOpen=false;window.finishOpen();});
  await page.waitForFunction(()=>!document.querySelector('.pending-feedback.is-loading'));
  assert.deepEqual(await page.evaluate(()=>opened),['payment-create']);
  assert.equal(await page.evaluate(()=>localStorage.length),1);
  await page.locator('#pending > summary').click();
  await page.evaluate(()=>window.failOpen=true);
  await page.getByRole('button',{name:'Review operation'}).click();
  assert.match(await page.getByRole('status').innerText(),/CRM unavailable/);
  assert.equal(await page.getByRole('button',{name:'Review operation'}).isEnabled(),true);
  await page.evaluate(()=>{localStorage.setItem('accounting-manager:invoice-edit:v1:5','broken');panel.refresh();});
  assert.equal(await page.locator('article').count(),2);
  assert.equal(await page.getByRole('button',{name:'Dismiss notice',exact:true}).count(),2);
  assert.equal(await page.getByRole('button',{name:'Dismiss notice',exact:true}).first().isVisible(),true);
  for(const width of [390,1280]){await page.setViewportSize({width,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.locator('article').filter({has:page.getByRole('button',{name:'Review operation'})}).getByRole('button',{name:'Dismiss notice',exact:true}).click();
  assert.equal(await page.locator('.pending-confirmation:not([hidden])').isVisible(),true);
  await page.setViewportSize({width:390,height:800});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'_local/pending-confirmation-390.png'});
  await page.getByRole('button',{name:'Keep notice',exact:true}).click();assert.equal(await page.locator('article').count(),2);
  await page.locator('article').filter({has:page.getByRole('button',{name:'Review operation'})}).getByRole('button',{name:'Dismiss notice',exact:true}).click();
  await page.getByRole('button',{name:'Yes, dismiss notice',exact:true}).click();assert.equal(await page.locator('article').count(),1);
  assert.ok(await page.evaluate(()=>localStorage.getItem('accounting-manager:payment-save:v1')));
  await page.evaluate(()=>{let key='accounting-manager:payment-save:v1';let d=JSON.parse(localStorage.getItem(key));d.paymentId='9';localStorage.setItem(key,JSON.stringify(d));panel.refresh();});assert.equal(await page.locator('article').count(),2);
  await page.evaluate(()=>{localStorage.clear();for(let i=0;i<16;i++)localStorage.setItem('accounting-manager:card-payment:v1:'+i,JSON.stringify({Name:'CARD-'+i+' long reference '.repeat(15)}));panel.refresh();});
  assert.equal(await page.locator('article').count(),16);
  assert.equal(await page.locator('.pending-status').first().innerText(),'Status unverified');
  assert.ok(await page.locator('.pending-list').evaluate(e=>e.scrollHeight>e.clientHeight));
  await page.evaluate(()=>{document.body.setAttribute('aria-busy','true');window.failOpen=false;});
  const before=await page.evaluate(()=>opened.length);await page.getByRole('button',{name:'Review operation'}).first().click();
  assert.equal(await page.evaluate(()=>opened.length),before);assert.match(await page.getByRole('status').innerText(),/still running/);
  await page.evaluate(()=>document.body.removeAttribute('aria-busy'));
  for(const width of [390,1280]){await page.setViewportSize({width,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('accounting-manager:card-payment:v1:4',JSON.stringify({Name:'CARD-INV-2026-042 / MFSP2608578'}));panel.refresh();});
  await page.evaluate(()=>document.querySelector('.pending-feedback').textContent='');
  await page.setViewportSize({width:1280,height:800});assert.ok(await page.locator('#pending').evaluate(e=>e.getBoundingClientRect().height<=140));await page.screenshot({path:'_local/pending-operations-compact.png'});
  await page.evaluate(()=>{localStorage.clear();panel.refresh();panel.destroy();});
  assert.equal(await page.locator('#pending').isVisible(),false);
  console.log('Passed: empty state, saved operation routing, escaped text, preserved journals, failed-open retry, corrupt journal, narrow layout and completed-operation removal.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
