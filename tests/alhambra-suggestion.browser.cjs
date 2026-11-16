const {chromium}=require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.route('https://widget.test/**',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync('app/widget.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g,(_,f)=>'<style>'+fs.readFileSync('app/'+f,'utf8')+'</style>')}));
 await page.goto('https://widget.test/');
 for(const file of ['card-purchase-settlements','alhambra-card'])await page.addScriptTag({path:'app/scripts/'+file+'.js'});
 await page.evaluate(()=>{
  document.querySelectorAll('[data-tab-panel]').forEach(p=>p.hidden=p.dataset.tabPanel!=='operations');
  document.getElementById('card-purchase-workflow-modal').hidden=false;
  document.getElementById('card-purchase-workflow-modal').classList.add('is-open');
  window.purchase={id:'1',Supplier:{id:'616617000003010705'},Booking:{id:'3'},Amount:44.54,Currency:'EUR',Transaction_Type:'Purchase'};
  window.rows=[{id:'6',Name:'MFSP2608663-IACPOS',Supplier:{id:'616617000003265040'},Booking:{id:'3'},Currency:'EUR',Total_Service_Cost:2.54,Total_Invoice:null}];
  window.ZOHO={CRM:{API:{searchRecord:async()=>({data:rows})}}};
  document.getElementById('card-purchase-amount').value='44.54';
  return AccountingManagerApp.alhambraCard.render(purchase,'invoice');
 });
 assert.equal(await page.locator('#card-purchase-amount').inputValue(),'42.00');
 assert.equal(await page.locator('#card-purchase-amount').isEditable(),true);
 assert.match(await page.locator('#card-alhambra-commission').innerText(),/next step creates a separate Iacpos invoice/);
 assert.match(await page.locator('#card-purchase-amount-label').innerText(),/Alhambra tickets only/);
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('#card-alhambra-commission').scrollIntoViewIfNeeded();await page.screenshot({path:'_local/previews/alhambra-suggestion-'+width+'.png',fullPage:true});}
 await page.evaluate(()=>{ZOHO.CRM.API.searchRecord=()=>new Promise(r=>window.resolveSuggestion=r);document.getElementById('card-purchase-amount').value='44.54';window.pending=AccountingManagerApp.alhambraCard.render(purchase,'invoice');});
 await page.locator('#card-purchase-amount').fill('41');
 await page.evaluate(async()=>{resolveSuggestion({data:rows});await pending;});
 assert.equal(await page.locator('#card-purchase-amount').inputValue(),'41');
 await page.evaluate(async()=>{ZOHO.CRM.API.searchRecord=async()=>({data:rows});rows[0].Total_Invoice=2.54;document.getElementById('card-purchase-amount').value='44.54';await AccountingManagerApp.alhambraCard.render(purchase,'invoice');});
 assert.equal(await page.locator('#card-purchase-amount').inputValue(),'44.54');
 assert.match(await page.locator('[data-suggestion]').innerText(),/No unambiguous/);
 await page.evaluate(async()=>{rows[0].Total_Invoice=0;rows.push({...rows[0],id:'7'});await AccountingManagerApp.alhambraCard.render(purchase,'invoice');});
 assert.match(await page.locator('[data-suggestion]').innerText(),/No unambiguous/);
 await page.evaluate(async()=>{ZOHO.CRM.API.searchRecord=async()=>{throw Error('offline');};await AccountingManagerApp.alhambraCard.render(purchase,'invoice');});
 assert.match(await page.locator('[data-suggestion]').innerText(),/Could not load/);
 console.log('Alhambra suggestion: editable 42 EUR, separate-invoice instructions, late edit preserved, ambiguous/invoiced/error fallbacks passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
