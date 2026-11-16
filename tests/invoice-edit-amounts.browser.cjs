const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage();
  await page.route('https://invoice.test/**',r=>r.fulfill({body:'<body class="accounting-widget"></body>',contentType:'text/html'}));
  await page.goto('https://invoice.test/');
  for(const match of fs.readFileSync('app/widget.html','utf8').matchAll(/href="\.\/(styles\/[^"]+)"/g))await page.addStyleTag({path:'app/'+match[1]});
  await page.addScriptTag({path:'app/scripts/invoice-edit.js'});
  await page.evaluate(()=>{
   window.saved=[];
   window.editor=AccountingManagerApp.createInvoiceEditor({
    helpers:{escapeHtml:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;')},
    crm:{executeFunction:async(name,args)=>{
     const request=JSON.parse(args.requestJson);
     const output=request.action==='preview'?{success:true,paid:window.testPaid||0,reserved:window.testPaid||0,source_documents:true,
      invoice:{id:'1',Name:'INV-TEST',Invoice_Date:'2026-10-20',Invoice_Type:'Final Invoice',Invoice_File:[],Currency:'EUR',Modified_Time:'v1',Invoice_Amount_Excl_VAT:100,VAT_percentage:21,IRPF_percentage:15,Total_Payable_Amount:106},
      settlements:{s1:{Name:'Test settlement',Total_Service_Cost:window.testCost||1000,Total_Invoice:106,Total_Paid:0}},splits:[{Vendor_Settlement:{id:'s1'},Allocated_Amount:106}]
     }:(saved.push(request),{success:true,payment_action:request.payment_action});
     return {details:{output:JSON.stringify(output)}};
    }},refresh:async()=>{},notify:()=>{},openAdditionalPayment:async()=>{window.paymentFormOpened=(window.paymentFormOpened||0)+1;}
   });
  });
  await page.evaluate(()=>editor.open('1'));
  const net=page.locator('[name="Invoice_Amount_Excl_VAT"]'),gross=page.locator('[data-edit-gross]');
  assert.equal(await gross.inputValue(),'121.00');assert.ok(await gross.isEditable());
  await gross.fill('242');
  assert.equal(await gross.inputValue(),'242'); // no cursor/format rewrite while typing
  assert.equal(await net.inputValue(),'200.00');
  assert.equal(await page.locator('[data-edit-allocation]').inputValue(),'212.00'); // IRPF remains separate
  await net.fill('50');
  assert.equal(await gross.inputValue(),'60.50');
  await page.locator('[name="VAT_percentage"]').fill('0');
  assert.equal(await gross.inputValue(),'50.00');
  await gross.fill('75');assert.equal(await net.inputValue(),'75.00');
  await page.locator('[name="VAT_percentage"]').fill('21');
  await gross.fill('123.45');await gross.press('Tab');
  assert.equal(await net.inputValue(),'102.02');assert.equal(await gross.inputValue(),'123.44');
  assert.match(await gross.locator('..').innerText(),/Rounded from/);
  await page.locator('.edit-additional summary').click();
  await page.locator('[name="Additional_VAT_percentage"]').fill('10');
  await page.locator('[data-edit-extra-gross]').fill('55');
  assert.equal(await page.locator('[name="Additional_Amount_Excl_VAT"]').inputValue(),'50.00');
  await page.locator('[name="Additional_Amount_Excl_VAT"]').fill('20');
  assert.equal(await page.locator('[data-edit-extra-gross]').inputValue(),'22.00');
  await page.locator('[name="vat_reviewed"]').check();
  await gross.fill('121');
  assert.equal(await page.locator('[name="vat_reviewed"]').isChecked(),false);
  await gross.fill('-1');await page.locator('[data-edit-save]').click();
  assert.equal(await page.evaluate(()=>saved.length),0);
  assert.equal(await gross.getAttribute('aria-invalid'),'true');
  await gross.fill('121');
  await page.locator('[name="reason"]').fill('Correct supplier amount');
  for(const name of ['vat_reviewed','irpf_reviewed','additional_vat_reviewed','additional_irpf_reviewed'])await page.locator('[name="'+name+'"]').check();
  await page.locator('[data-edit-save]').click();
  await page.waitForFunction(()=>saved.length===1);
  const request=await page.evaluate(()=>saved[0]);
  assert.equal(Number(request.fields.Invoice_Amount_Excl_VAT),100);
  assert.equal(Number(request.fields.Additional_Amount_Excl_VAT),20);
  assert.equal(request.allocations.s1,128);
  await page.evaluate(()=>{window.testCost=110;window.testPaid=106;return editor.open('2');});
  await net.fill('200');
  await page.locator('[name="reason"]').fill('Correct amount above service cost');
  for(const name of ['vat_reviewed','irpf_reviewed'])await page.locator('[name="'+name+'"]').check();
  await page.locator('[data-edit-save]').click();
  assert.equal(await page.evaluate(()=>saved.length),1);
  assert.equal(await page.locator('.invoice-payment-choice').count(),0);
  assert.equal(await page.locator('[name="confirm_excess"]').getAttribute('aria-invalid'),'true');
  assert.match(await page.locator('[data-edit-message]').innerText(),/excess €102\.00/);
  await page.locator('[name="confirm_excess"]').check();
  await page.locator('[data-edit-save]').click();
  await page.locator('[name="payment_action"][value="additional"]').check();
  assert.equal(await page.evaluate(()=>window.paymentFormOpened||0),0);
  await page.locator('[data-payment-continue]').click();
  await page.waitForFunction(()=>window.paymentFormOpened===1);
  const additional=await page.evaluate(()=>saved[1]);
  assert.equal(additional.confirm_excess,true);
  assert.equal(additional.payment_action,'additional');
  assert.equal(additional.allocations.s1,212);
  console.log('PASS: editable gross/net, VAT changes, zero VAT, additional amounts, IRPF separation, cent rounding feedback, review reset, invalid value rejection and saved base/allocation.');
  console.log('PASS: settlement excess rejected before payment choice/submission; explicit confirmation saves and opens manual additional payment form.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
