const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 const html=fs.readFileSync('app/widget.html','utf8');
 const modal=html.slice(html.indexOf('      <section id="payment-create-feedback-popup"'),html.indexOf('      <section id="booking-closure-detail-popup"'));
 await page.setContent('<body class="accounting-widget">'+modal+'<section id="invoice-payment-panel"><h2>Create supplier payment</h2><button id="invoice-payment-submit">Resume payment</button></section></body>');
 for(const file of ['theme.css','layout.css','components.css','visual-refresh.css','ui-system.css'])await page.addStyleTag({content:fs.readFileSync('app/styles/'+file,'utf8')});
 const code=fs.readFileSync('app/scripts/payment-create.js','utf8');
 const functions=code.slice(code.indexOf('    function renderPaymentCreateFeedback()'),code.indexOf('    function buildInvoicePaymentContext('));
 await page.evaluate(functions=>{
  const elements={};
  for(const [key,id] of Object.entries({invoicePaymentPanel:'invoice-payment-panel',invoicePaymentSubmit:'invoice-payment-submit',paymentCreateFeedbackPopup:'payment-create-feedback-popup',paymentCreateFeedbackSpinner:'payment-create-feedback-spinner',paymentCreateFeedbackEyebrow:'payment-create-feedback-eyebrow',paymentCreateFeedbackTitle:'payment-create-feedback-title',paymentCreateFeedbackMessage:'payment-create-feedback-message',paymentCreateFeedbackClose:'payment-create-feedback-close'}))elements[key]=document.getElementById(id);
  const state=window.testState={paymentCreation:{isBusy:true,progressDialog:true,progressPhase:'allocations',form:{name:'PAY-20261026-133111'},feedback:{isOpen:true,status:'loading',message:'Checking invoice allocations (67 of 115)'}}};
  const renderer={showError(){throw Error('Progress must not be inline');},showNotice(){throw Error('Progress must not be inline');}};
  const ns={inlineFeedback:{finish(){}}};
  let api;
  function renderAll(){elements.invoicePaymentPanel.hidden=state.paymentCreation.progressDialog;api.render();}
  api=new Function('state','elements','renderer','ns','renderAll',functions+'; return {render:renderPaymentCreateFeedback,close:closePaymentCreateFeedback};')(state,elements,renderer,ns,renderAll);
  window.renderPaymentProgress=api.render;
  elements.paymentCreateFeedbackClose.onclick=api.close;api.render();
 },functions);
 assert.equal(await page.locator('#invoice-payment-panel').isVisible(),false);
 assert.equal(await page.getByRole('dialog').isVisible(),true);
 assert.equal(await page.locator('#payment-create-feedback-spinner').isVisible(),true);
 assert.equal(await page.getByRole('button',{name:'Back to payment'}).isVisible(),false);
 assert.match(await page.getByRole('status').innerText(),/67 of 115/);
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'payment-create-feedback-popup');
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),true);
 for(const width of [1280,390]){await page.setViewportSize({width,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'_local/payment-progress-'+width+'.png'});}
 await page.evaluate(()=>{testState.paymentCreation.isBusy=false;testState.paymentCreation.feedback={isOpen:true,status:'error',message:'CRM did not confirm the settlement update. Resume the same payment after reviewing the issue.'};renderPaymentProgress();});
 assert.equal(await page.locator('#payment-create-feedback-spinner').isVisible(),false);
 await page.getByRole('button',{name:'Back to payment'}).click();
 assert.equal(await page.getByRole('dialog').isVisible(),false);assert.equal(await page.locator('#invoice-payment-panel').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'invoice-payment-submit');
 assert.equal(await page.evaluate(()=>testState.paymentCreation.form.name),'PAY-20261026-133111');
 console.log('Passed: separate progress dialog, counters, spinner, focus containment, error recovery and 390/1280 layouts.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
