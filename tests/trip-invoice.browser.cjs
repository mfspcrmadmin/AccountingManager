const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const html=fs.readFileSync('app/widget.html','utf8');
  const styles=[...html.matchAll(/href="\.\/(styles\/[^\"]+)"/g)].map(m=>fs.readFileSync('app/'+m[1],'utf8')).join('\n');
  await page.setContent('<style>'+styles+'</style><body class="accounting-widget"><button id="trigger">Invoice trip</button></body>');
  await page.addScriptTag({path:'app/scripts/trip-invoice.js'});
  await page.evaluate(()=>{
    window.pdfCalls=[];AccountingManagerApp.createSalesInvoicePdfDownloads=()=>({download:async(...args)=>{pdfCalls.push(args);return {saved:args[2]}}});
    window.calls=[];window.mode='new';window.saved=[];window.opened=[];
    const collections={source:'Creator',paid:1500,refunded:300,net:1200,evidence:{records:[{source:'All_Travellers_Payments',id:'301',status:'PAID',amount_eur:1500},{source:'All_Refunds',id:'401',status:'SUCCESS',amount_eur:300}]}};
    const info={collections,mfsp:'MFSP2601234',client:{id:'a',name:'Test agency'},sales_price:1200,commission:100,currency:'EUR'};
    const existing={success:true,existing:true,invoice_id:'invoice1',invoice_number:'FV-2026-000001',invoice_date:'2026-11-04',amount:1200,currency:'EUR',origin:'Accounting Manager',collections_status:'Verified',net_paid:1200,balance_due:0,collections};
    window.module=AccountingManagerApp.createTripInvoiceModule({
      crm:{executeFunction:async(name,args)=>{
        calls.push({...args});if(mode==='loading-error')return await new Promise(resolve=>window.finishInspection=()=>resolve({success:false,message:'Error at line : 230, Error at line : 223, Confirmed receipts are missing or refunds exceed receipts. Review the Booking payment records.'}));await new Promise(r=>setTimeout(r,50));
        if(mode==='legacy')return {...existing,origin:'Tourplan',historical:true,booking_link_missing:true};
        if(mode==='mixed') {
          if(args.action==='link-original')return {success:true,original_linked:true};
          return {success:true,existing:true,multiple:true,documents:[{id:'801',Subject:'206877',Type:'Invoice',Grand_Total:1200,Currency:'EUR',Invoice_Date:'2026-10-01',Modified_Time:'v1'},{id:'802',Subject:'CN1',Type:'Credit Notes',Grand_Total:1200,Currency:'EUR',Invoice_Date:'2026-10-02',Modified_Time:'v1'}]};
        }
        if(args.action==='collections-preview')return {...existing,collections_preview:true,snapshot:'receipt-v1',collections:{...collections,refunded:400,net:1100}};
        if(args.action==='collections-apply')return {...existing,collections_saved:true,net_paid:1100,balance_due:100,collections:{...collections,refunded:400,net:1100}};
        if(args.action==='inspect'&&mode==='partial')return {success:true,existing:false,...info,sales_price:3329,collections:{source:'Creator',paid:869,refunded:0,net:869,evidence:{records:[]}},historical_required:true,historical_amount:2460,detailed_net:869,balance:0};
        if(args.action==='inspect'&&mode==='historical')return {success:true,existing:false,...info,collections:null,historical_required:true,historical_amount:1200,balance:0};
        if(args.action==='inspect')return {success:true,existing:false,...info};
        if(mode==='changed')return {success:false,message:'The Booking changed. Review again.'};
        if(args.action==='preview')return {success:true,existing:false,...info,invoice_date:args.invoiceDate,amount:1200,snapshot:'snapshot'};
        return existing;
      }},output:value=>value,openRecord:async(m,id)=>opened.push([m,id]),onSaved:(id,result)=>saved.push([id,result])
    });
    document.querySelector('#trigger').onclick=function(){module.open({id:'1',Currency:'EUR'},this)};
  });
  await page.evaluate(()=>{mode='loading-error'});
  await page.locator('#trigger').click();
  assert.equal(await page.locator('dialog').getAttribute('aria-busy'),'true');
  const spinner=await page.locator('[data-invoice-status]').evaluate(e=>{const c=getComputedStyle(e,'::before');return{content:c.content,animation:c.animationName,width:c.width}});
  assert.equal(spinner.width,'30px');assert.equal(spinner.animation,'trip-invoice-spin');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('[data-invoice-status]').evaluate(e=>getComputedStyle(e,'::before').animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>finishInspection());
  await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
  assert.ok(!(await page.locator('[data-invoice-status]').textContent()).includes('Error at line'));
  await page.locator('[data-invoice-cancel]').click();await page.evaluate(()=>{mode='new'});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await page.locator('#trigger').click();
    await page.locator('[data-invoice-date]').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-invoice-date]').inputValue(),'');
    assert.equal(await page.locator('[data-invoice-issue]').isDisabled(),true);
    await page.locator('[data-invoice-date]').fill('2026-11-04');
    await page.locator('[data-invoice-review]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-invoice-issue]').disabled);
    assert.ok((await page.locator('[data-invoice-preview]').textContent()).includes('1,200.00 EUR'));
    assert.equal(await page.locator('[data-invoice-basis]').count(),0);
    const fits=await page.locator('dialog').evaluate(e=>e.getBoundingClientRect().width<=innerWidth&&e.scrollWidth<=e.clientWidth+1);assert.equal(fits,true);
    await page.locator('[data-invoice-date]').fill('2026-11-05');assert.equal(await page.locator('[data-invoice-issue]').isDisabled(),true);
    await page.locator('[data-invoice-cancel]').click();assert.equal(await page.locator('#trigger').evaluate(e=>document.activeElement===e),true);
  }
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await page.evaluate(()=>{mode='historical'});
    await page.locator('#trigger').click();await page.locator('[data-invoice-historical]').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-historical-confirm]').isChecked(),false);
    assert.equal(await page.locator('[data-historical-reference]').count(),0);
    assert.equal(await page.locator('[data-invoice-issue]').isHidden(),true);
    assert.equal(await page.locator('[data-invoice-cancel]').evaluate(e=>e.closest('.trip-invoice-form-actions')!==null),true);
    const spacing=await page.locator('[data-invoice-historical]').evaluate(e=>{
      const fields=e.querySelector('.trip-invoice-fields'),reference=e.querySelector('[data-historical-origin]'),confirm=e.querySelector('.trip-invoice-historical-confirm');
      return {gap:parseFloat(getComputedStyle(fields).gap),originWidth:e.querySelector('[data-historical-origin]').getBoundingClientRect().width,confirmGap:confirm.getBoundingClientRect().top-reference.getBoundingClientRect().bottom,badge:getComputedStyle(e.querySelector('label.field > span'),'::after').display};
    });
    assert.ok(spacing.gap>=14);assert.ok(spacing.originWidth>200);assert.ok(spacing.confirmGap>=14);assert.equal(spacing.badge,'none');

    assert.ok((await page.locator('[data-historical-totals]').textContent()).includes('1,200.00 EUR'));
    await page.locator('[data-invoice-date]').fill('2026-11-04');
    const before=await page.evaluate(()=>calls.length);await page.locator('[data-invoice-review]').click();assert.equal(await page.evaluate(()=>calls.length),before);
    await page.locator('[data-historical-origin]').fill('Tourplan');await page.locator('[data-historical-confirm]').check();
    await page.locator('[data-invoice-review]').click();await page.waitForFunction(()=>!document.querySelector('[data-invoice-issue]').disabled);
    const request=await page.evaluate(()=>JSON.parse(calls.filter(c=>c.action==='preview').at(-1).expectedSnapshot));assert.equal(request.historical_confirmation.confirmed,true);assert.equal(request.historical_confirmation.amount,1200);
    assert.equal(await page.locator('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
    await page.locator('[data-historical-confirm]').uncheck();assert.equal(await page.locator('[data-invoice-issue]').isDisabled(),true);
    await page.locator('[data-invoice-cancel]').click();
  }
  await page.evaluate(()=>{mode='partial'});
  await page.locator('#trigger').click();await page.locator('[data-invoice-historical]').waitFor({state:'visible'});
  const partialTotals=await page.locator('[data-historical-totals]').innerText();
  for(const amount of ['3,329.00 EUR','869.00 EUR','2,460.00 EUR'])assert.ok(partialTotals.includes(amount),partialTotals);
  await page.locator('[data-invoice-date]').fill('2026-11-04');await page.locator('[data-historical-origin]').fill('Tourplan');await page.locator('[data-historical-confirm]').check();
  await page.locator('[data-invoice-review]').click();await page.waitForFunction(()=>!document.querySelector('[data-invoice-issue]').disabled);
  const partialRequest=await page.evaluate(()=>JSON.parse(calls.filter(c=>c.action==='preview').at(-1).expectedSnapshot));assert.equal(partialRequest.historical_confirmation.amount,2460);assert.equal(partialRequest.historical_confirmation.reference,undefined);
  await page.locator('[data-invoice-cancel]').click();
  await page.evaluate(()=>{mode='new'});
  await page.locator('#trigger').click();await page.locator('[data-invoice-date]').waitFor({state:'visible'});
  await page.locator('[data-invoice-date]').fill('2026-11-04');await page.locator('[data-invoice-review]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-invoice-issue]').disabled);
  await page.evaluate(()=>{const button=document.querySelector('[data-invoice-issue]');button.click();button.click()});
  await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').count(),1);
  await page.locator('[data-invoice-open]').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='issue').length),1);
  assert.equal(await page.evaluate(()=>calls.find(c=>c.action==='issue').amountBasis),'gross');
  assert.equal(await page.locator('.trip-invoice-number').textContent(),'FV-2026-000001');
  assert.equal(await page.locator('.trip-invoice-result-heading').textContent(),'Invoice registered');
  await page.evaluate(()=>{window.copiedNumbers=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>copiedNumbers.push(value)}});Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});});
  await page.getByRole('button',{name:'Copy invoice number',exact:true}).click();assert.deepEqual(await page.evaluate(()=>copiedNumbers),['FV-2026-000001']);assert.equal(await page.getByRole('button',{name:'Invoice number copied',exact:true}).count(),1);
  for(const width of [1440,390]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);assert.ok(await page.locator('.trip-invoice-number').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=26));}
  await page.locator('[data-invoice-pdf]').click();assert.deepEqual(await page.evaluate(()=>pdfCalls),[['1','invoice1',true]]);
  await page.locator('[data-invoice-open]').click();assert.deepEqual(await page.evaluate(()=>opened),[['Invoices','invoice1']]);
  await page.locator('[data-invoice-refresh-collections]').click();await page.locator('[data-invoice-apply-collections]').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='collections-apply').length),0);
  await page.locator('[data-invoice-apply-collections]').click();await page.waitForFunction(()=>document.querySelector('.trip-invoice-result-facts').textContent.includes('100.00 EUR'));
  assert.equal(await page.evaluate(()=>calls.find(c=>c.action==='collections-apply').expectedSnapshot),'receipt-v1');
  await page.locator('[data-invoice-cancel]').click();
  await page.evaluate(()=>mode='legacy');await page.locator('#trigger').click();await page.locator('[data-invoice-open]').waitFor({state:'visible'});
  assert.equal(await page.locator('form').isVisible(),false);assert.equal(await page.locator('[data-invoice-retry-link]').isVisible(),false);assert.equal(await page.locator('[data-invoice-refresh-collections]').isVisible(),false);await page.locator('[data-invoice-cancel]').click();
  await page.evaluate(()=>mode='mixed');await page.locator('#trigger').click();await page.locator('[data-invoice-documents] select').waitFor({state:'visible'});
  assert.ok((await page.locator('[data-invoice-documents]').textContent()).includes('-1,200.00 EUR'));
  await page.locator('[data-invoice-documents] select').selectOption('801');await page.getByRole('button',{name:'Link original invoice',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-invoice-status]').textContent.includes('Original invoice linked'));
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='link-original').length),1);await page.locator('[data-invoice-cancel]').click();
  assert.deepEqual(errors,[]);
  console.log('Trip invoice desktop/mobile: date, full-price review, preview invalidation, single creation, existing invoice, open and focus verified.');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exit(1)});
