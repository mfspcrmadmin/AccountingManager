const {chromium}=require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<form id="form"><input value="Existing invoice"></form>');
  const source=fs.readFileSync('app/scripts/invoice-create.js','utf8');
  const fn=source.slice(source.indexOf('    function renderRegistrationRecovery()'),source.indexOf('    async function registerSupplierInvoice('));
  await page.evaluate(fn=>{
   window.global=window; window.elements={invoiceCreateForm:document.getElementById('form')};
   window.state={supplierId:'1',isLoading:false,invoiceCreation:{isOpen:true}};
   window.registrationRecovery=null; window.submitInProgress=false; window.calls=0;
   window.pending={operationKey:'key',invoiceId:'7',requestJson:JSON.stringify({invoice:{Name:'Invoice-1'}})};
   window.registration={pending:()=>pending,discard:async()=>{calls++; await new Promise(r=>window.finish=r);return {success:true};}};
   window.handleInvoiceCreateSubmitEvent=()=>{};window.isInvoiceCreateRefundMode=()=>false;
   window.setInvoiceCreateLoading=value=>state.isLoading=value;
   window.resetInvoiceCreateFormAfterCreate=()=>{}; window.renderAll=()=>{};
   window.renderer={showNotice:message=>window.notice=message,showError:message=>window.error=message};
   (0,eval)(fn);renderRegistrationRecovery();
  },fn);
  await page.getByRole('button',{name:'Discard registration',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Yes, discard registration'}).isVisible(),true);
  assert.equal(await page.evaluate(()=>calls),0);
  await page.getByRole('button',{name:'Keep registration'}).click();
  assert.equal(await page.getByRole('button',{name:'Yes, discard registration'}).isVisible(),false);
  await page.getByRole('button',{name:'Discard registration',exact:true}).click();
  await page.getByRole('button',{name:'Yes, discard registration'}).click();
  assert.equal(await page.getByRole('button',{name:'Yes, discard registration'}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>calls),1);
  await page.evaluate(()=>finish());
  await page.waitForFunction(()=>!state.invoiceCreation.isOpen);
  assert.match(await page.evaluate(()=>notice),/Registration discarded/);
  await page.evaluate(()=>{pending.discardRequested=true;renderRegistrationRecovery();});
  assert.equal(await page.getByRole('button',{name:'Continue discarding'}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Resume invoice registration'}).isVisible(),false);
  console.log('Invoice discard confirmation, busy state, completion and recovery passed.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
