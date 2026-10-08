const { chromium } = require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs = require('node:fs'), assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
  const page = await browser.newPage({viewport:{width:390,height:500}});
  await page.setContent('<style>[hidden]{display:none!important}body{font:14px Arial;--line:#ddd;--accent-strong:#ad673b;--danger:#b42318}main{width:320px;margin:20px auto}'+fs.readFileSync('app/styles/suppliers.css','utf8')+'</style><main><label>Accounting account</label><div id="field"></div></main>');
  await page.addScriptTag({path:'app/scripts/supplier-accounting-info.js'});
  await page.evaluate(() => {
   window.calls=[];
   window.ZOHO={CRM:{API:{updateRecord: payload => { calls.push(payload); return new Promise((resolve,reject)=>{window.resolveSave=resolve;window.rejectSave=reject;}); }}}};
   field.innerHTML=AccountingManagerApp.supplierAccountingInfo.editorHtml('123','004001');
   document.addEventListener('supplier-accounting-account-saved', e => { field.innerHTML=AccountingManagerApp.supplierAccountingInfo.editorHtml(e.detail.id,e.detail.account); });
  });
  const input=page.locator('[data-account-value]');
  const before=await input.boundingBox();
  await page.locator('[data-account-edit]').click();
  assert.equal(await input.evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(await input.boundingBox(),before);
  await input.fill('009999'); await input.press('Escape');
  assert.equal(await input.inputValue(),'004001'); assert.equal(await page.evaluate(()=>calls.length),0);
  await page.locator('[data-account-edit]').click(); await input.fill('007777'); await input.press('Enter');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>calls.length),1);
  assert.equal(await page.locator('[data-account-save]').isDisabled(),true);
  await page.evaluate(()=>rejectSave(new Error('Permission denied')));
  await page.waitForFunction(()=>document.querySelector('.has-error'));
  assert.equal(await input.inputValue(),'007777');
  assert.equal(await input.evaluate(el=>el===document.activeElement && !el.readOnly),true);
  assert.match(await page.locator('[role=status]').innerText(),/Permission denied/);
  await input.press('Enter'); await page.evaluate(()=>resolveSave({data:[{code:'SUCCESS'}]}));
  await page.waitForFunction(()=>document.querySelector('[data-account-value]').readOnly);
  assert.equal(await input.inputValue(),'007777');
  assert.equal(await page.locator('[data-account-edit]').evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(await input.boundingBox(),before);
  assert.equal(await page.locator('[data-account-value]').count(),1);
  await page.locator('[data-account-edit]').click(); await input.fill('000001'); await page.locator('[data-account-cancel]').click();
  assert.equal(await input.inputValue(),'007777');
  await page.screenshot({path:'_local/previews/accounting-account-inline.png'});
  console.log('PASS: stable dimensions, focus, Enter/Escape, cancel, duplicate guard, failure retention and successful rerender.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
