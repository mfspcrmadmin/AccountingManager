const { chromium } = require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs = require('node:fs'), assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
  const page = await browser.newPage({viewport:{width:1440,height:900}}), errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  let html=fs.readFileSync('app/widget.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  html=html.replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g,(_,file)=>'<style>'+fs.readFileSync('app/'+file,'utf8')+'</style>');
  await page.route('https://invoice.test/',r=>r.fulfill({contentType:'text/html',body:html}));
  await page.goto('https://invoice.test/');
  await page.addScriptTag({path:'app/scripts/ui-system.js'});
  for (const name of ['config','helpers','dom','invoice-registration','settlement-calculation','invoice-create']) await page.addScriptTag({path:'app/scripts/'+name+'.js'});
  await page.evaluate(()=>{
   const ns=window.AccountingManagerApp, e=window.e=ns.getElements(), s=window.s=ns.createInitialState();
   document.body.append(e.invoiceCreatePanel);
   s.supplierId='1';s.supplier={id:'1',Vendor_Name:'Supplier Costa Mediterránea',Self_Employed:false};
   window.records=[{id:'9',Name:'SET-2026-001',Booking:{id:'2',name:'Barcelona autumn discovery'},Admin_Status:'Pending Invoice',Total_Service_Cost:800,Total_Invoice:200,Total_Paid:50},{id:'10',Name:'SET-2026-002',Booking:{id:'3',name:'Madrid cultural weekend'},Admin_Status:'Partially Paid',Total_Service_Cost:400,Total_Invoice:100,Total_Paid:30}];
   s.indexes.mfspByBookingId={'2':'MFSP-1001','3':'MFSP-1002'};
   Object.assign(s.invoiceCreation,{isOpen:true,settlementDropdownOpen:true,settlements:records,settlementStatusValues:['Pending Invoice','Partially Paid'],settlementStatusOptions:[{value:'Pending Invoice',label:'Pending Invoice'},{value:'Partially Paid',label:'Partially Paid'}]});
   s.invoiceCreation.invoiceFields.invoiceType={enable_colour_code:true,pick_list_values:[{actual_value:'Final Invoice',colour_code:'#25b52a'},{actual_value:'Proforma',colour_code:'#add9ff'},{actual_value:'Tickets',colour_code:'#e972fd'}]};
   window.jobs=[];window.writes=[];window.lastError='';window.statusError=false;
   ns.createInvoiceNameDefault=()=>({update(){},reset(){}});
   ns.supplierAccountingInfo={infoHtml:()=>'<button type="button" aria-label="Supplier information">ⓘ</button>'};
   const factory=ns.createSettlementCalculationMonitor;ns.createSettlementCalculationMonitor=d=>window.monitor=factory(d);
   const noop=()=>{}, types=['Final Invoice','Proforma','Tickets'].map(value=>({value,label:value}));
   const deps=window.deps={...ns,state:s,elements:e,helpers:ns.helpers,
    INVOICE_CREATE_STEPS:{settlement:1,amounts:2},INVOICE_CREATE_MODES:{invoice:'invoice',refund:'refund'},INVOICE_TYPES:{finalInvoice:'Final Invoice',creditNote:'Credit Note'},DEFAULT_INVOICE_STATUS:'Received',
    INVOICE_CREATE_VALIDATION_FIELD_KEYS:['settlement','invoiceNumber','invoiceDate','invoiceType','invoiceFile','allocation','amountGross','vatReviewed','additionalVatPercent','additionalAmountExclVat','additionalAmountInclVat','additionalVatReviewed','additionalIrpfReviewed','irpfReviewed'],
    renderAll(){window.module?.renderPanel();},debugError(...args){console.error(...args)},debugWarn:noop,
    setInvoiceCreateStep:v=>s.invoiceCreation.step=v,getInvoiceCreateStep:()=>s.invoiceCreation.step,getLocalIsoDate:()=> '2026-10-08',
    applyInvoiceCreateSupplierTaxDefaults:noop,isInvoiceCreateRefundMode:()=>s.invoiceCreation.mode==='refund',getInvoiceCreateRecordLabel:()=> 'invoice',getInvoiceCreateStepForFieldKey:()=>1,
    getInvoiceCreateSelectedTypeValue:()=>e.invoiceCreateType.value,getInvoiceCreateTypeOptionsForMode:()=>types,getInvoiceCreateTitleText:()=> 'Create supplier invoice',syncInvoiceCreateModeDefaults:noop,
    ensureBookingsLoaded:async()=>{},ensureInvoiceCreateFieldMetadataLoaded:async()=>{},ensureInvoiceCreateSettlementStatusOptionsLoaded:async()=>{},
    getDefaultInvoiceCreateSettlementStatusValues:()=>['Pending Invoice','Partially Paid'],getNormalizedInvoiceCreateSettlementStatusValues:v=>[...new Set(v||[])],hasAllInvoiceCreateSettlementStatusesSelected:()=>true,getUniqueSortedValues:v=>[...new Set(v)].sort(),
    getResolvedInvoiceCreateFieldApi:(k,f)=>f,validateInvoiceCreateSettlementCapacity:async()=>({valid:true}),validateInvoiceCreateNumberUniqueness:async()=>true,
    isSupplierSelfEmployed:r=>r.Self_Employed,updateSupplierSelfEmployedStatus:async()=>{s.supplier.Self_Employed=true;},recalculateSettlementTotals:async()=>{},invalidateInvoiceCreateSettlementCache:noop,
    getSupplierResolvedAccountingAccount:()=>null,getSupplierDefaultPaymentAccountLabel:()=>'',
    renderInvoiceCreateSelect:(el,options)=>{el.disabled=false;el.innerHTML='<option value="">Select invoice type</option>'+options.map(o=>'<option>'+o.value+'</option>').join('');},
    getInvoiceCreateSettlementUnpaidInvoicedAmount:r=>r.Total_Invoice-r.Total_Paid,getInvoiceCreateSettlementRemainingToInvoice:r=>r.Total_Service_Cost-r.Total_Invoice,
    resolveCoqlFields:async(m,f)=>f,escapeCoqlValue:String,formatFileSize:v=>v+' bytes',getInvoiceCreateDocumentFile:()=>s.invoiceCreation.documentFile,
    getInvoiceCreateNumberValue:v=>Number(v)||0,roundCurrency:v=>Math.round((v+Number.EPSILON)*100)/100,
    isPreviewableImageFile:()=>false,isPreviewablePdfFile:()=>true,clearInvoiceCreateDocumentFileSelection:()=>{e.invoiceCreateFileInput.value='';s.invoiceCreation.documentFile=null;window.module.renderDocumentFilePreview();},
    onInvoiceCreateDocumentFileChange:()=>{window.module.clearValidationState();s.invoiceCreation.documentFile=e.invoiceCreateFileInput.files[0];window.module.renderDocumentFilePreview();},onInvoiceCreateDocumentFilePreviewClick:noop,
    renderer:{setLoading(v){s.isLoading=v;},showError(v){window.lastError=v;},showNotice:noop},
    crm:{async coql(q){if(window.statusError)throw Error('Access unavailable');if(q.includes('Supplier_Settlements'))return records;if(q.includes('Booking_Services'))return [{id:'30',Booking:{id:'2',name:'Barcelona autumn discovery'},Product_Description:'Museum visit and private guide',Service_Date:'2026-10-08',Total_Purchase_Price:121,Final_Purchase_Cost:100}];return window.jobs;},async getRecord(){return {id:'2',MFSP:'MFSP-1001'};},async executeFunction(...args){writes.push(args);return {details:{output:JSON.stringify({success:false,retryable:true,invoice_id:'77',message:'Rebuild pending'})}};}}
   };
   window.module=ns.createInvoiceCreateModule(deps);module.bindEvents();module.renderPanel();module.setDefaultStatus();
   deps.crm.uploadFile=async()=>({data:[{status:'success',details:{id:'900'}}]});
   e.invoiceCreateDate.value='2026-10-08';e.invoiceCreateNumber.value='SUP-2026-17';e.invoiceCreateVatPercent.value='21';e.invoiceCreateIrpfPercent.value='0';
  });

  await page.waitForFunction(()=>!monitor.getView().loading);
  await page.locator('[data-settlement-selection-id="9"]').check();
  await page.waitForFunction(()=>s.invoiceCreation.selectedSettlement && !s.invoiceCreation.isLoadingServices);
  const list=page.locator('#invoice-create-services-table-wrap'), section=page.locator('#invoice-create-services-panel');
  for(const [width,height,count] of [[1440,900,0],[1440,900,1],[1440,900,7],[1440,900,45],[1024,600,7],[1440,480,45],[390,700,7],[320,480,45]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(count=>{
      s.invoiceCreation.services=Array.from({length:count},(_,i)=>({id:String(i),Product_Description:(i===count-1?'LAST SERVICE: ':'Service '+(i+1)+': ')+(i%3===0?'Private guided museum visit with a long description and transfers to the historic city centre':'Airport transfer'),Service_Date:'2026-10-14',Total_Purchase_Price:1234.56,Final_Purchase_Cost:i%2?1234.56:987.65}));
      module.renderPanel();e.invoiceCreateServicesPanel.open=true;
    },count);
    assert.equal(await page.locator('#invoice-create-services-count').innerText(),count===1?'1 service':count+' services');
    assert.equal(await page.locator('.supplier-service-item').count(),count);
    if(!count){assert.equal(await page.locator('#invoice-create-services-empty').isVisible(),true);continue;}
    await list.scrollIntoViewIfNeeded();
    assert.equal(await list.evaluate(e=>e.scrollWidth<=e.clientWidth),true,'horizontal overflow '+width);
    const before=await page.locator('.supplier-invoice-editor').evaluate(e=>e.scrollTop);
    await list.focus();await page.keyboard.press('End');await page.waitForTimeout(250);
    assert.equal(await list.evaluate(e=>Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop)<2),true,'End reaches last service');
    const last=await page.locator('.supplier-service-item').last().boundingBox(),box=await list.boundingBox();
    assert.ok(last.y+last.height<=box.y+box.height+1,'last service fits');
    if(width>850)assert.equal(await page.locator('.supplier-invoice-editor').evaluate(e=>e.scrollTop),before,'independent form scroll');
    await list.evaluate(e=>e.scrollTop=0);await list.hover();await page.mouse.wheel(0,10000);await page.waitForTimeout(250);
    assert.equal(await list.evaluate(e=>Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop)<2),true,'wheel reaches end');
    await list.evaluate(e=>e.scrollTop=0);
    for(let i=0;i<50;i++)await page.mouse.wheel(0,40);
    await page.waitForTimeout(200);
    if(count===7)assert.equal(await list.evaluate(e=>Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop)<2),true,'trackpad-size deltas reach end');
    await list.evaluate(e=>e.scrollTop=0);await list.scrollIntoViewIfNeeded();
    await page.screenshot({path:`_local/previews/related-services-${width}-${height}-${count}.png`});
  }
  await section.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await section.evaluate(e=>e.open),false);await page.keyboard.press('Enter');assert.equal(await section.evaluate(e=>e.open),true);
  assert.deepEqual(errors,[]);console.log('Related services: counts 0/1/7/45, long names, desktop/low/mobile layouts, independent scroll, wheel/trackpad-size deltas/keyboard and collapse passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
