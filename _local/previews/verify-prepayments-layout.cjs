const {chromium}=require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let html=fs.readFileSync('app/widget.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 html=html.replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g,(_,p)=>'<style>'+fs.readFileSync(path.join('app',p),'utf8')+'</style>');
 await page.setContent(html);
 await page.evaluate(()=>{
  document.querySelectorAll('.tab-panel').forEach(x=>x.hidden=x.id!=='tab-operations');
  document.querySelector('#tab-operations').hidden=false;
  const w=document.querySelector('#prepayments-workspace');w.hidden=false;
  for(const x of w.parentElement.children)if(x!==w&&!x.classList.contains('operations-header'))x.hidden=true;
  document.querySelectorAll('[data-tab-button]').forEach(x=>x.classList.toggle('is-active',x.dataset.tabButton==='operations'));
  window.AccountingManagerApp={createPrepaymentWorkflow:()=>({close(){}}),createPrepaymentProofSender:()=>({send:async()=>({sent:true})})};
 });
 await page.addScriptTag({path:'app/scripts/prepayments.js'});
 await page.addScriptTag({path:'app/scripts/prepayment-bank-request.js'});
 await page.evaluate(()=>{
  const ns=window.AccountingManagerApp, today=ns.prepaymentsModel.today();
  window.testPayments=[{id:'1',Name:'Hotel deposit',Amount:1200,Accounting_Status:'Pending invoice',Due_Date:today,Prepayment_Request:{id:'10'},Bank_Payment_Requested:false,Bank_Receipt_Needed:false}, {id:'2',Name:'Final payment',Amount:800,Accounting_Status:'Prepayment recorded',Due_Date:today,Payment_Date:today,Prepayment_Request:{id:'10'},Bank_Payment_Requested:false,Bank_Receipt_Needed:false}, {id:'3',Name:'Other deposit',Amount:300,Accounting_Status:'Pending invoice',Due_Date:'2026-10-01',Prepayment_Request:{id:'11'},Bank_Payment_Requested:false,Bank_Receipt_Needed:false}];
  const requests=[{id:'10',Name:'Hotel request',MFSP_Reference:'MFSP-100',Supplier_Code:'SUP01',Supplier:{id:'20',name:'Example Hotel'}},{id:'11',Name:'Other request',MFSP_Reference:'MFSP-200',Supplier_Code:'SUP02',Supplier:{id:'21',name:'Other Hotel'}}];
  window.testWrites=[];
  const zoho={CRM:{API:{getAllRecords:async({Entity})=>({data:Entity==='Prepayments'?window.testPayments:requests,info:{more_records:false}}),getRecord:async({RecordID})=>({data:[window.testPayments.find(p=>p.id===RecordID)]}),updateRecord:async({APIData})=>{window.testWrites.push(APIData);Object.assign(window.testPayments.find(p=>p.id===APIData.id),APIData);return {data:[{code:'SUCCESS'}]};}},FUNCTIONS:{execute:async()=>({details:{output:JSON.stringify({success:true,html:'<p>Bank request</p>',token:'test',subject:'Bank payment'})}})}}};
  window.workspace=ns.createPrepaymentsWorkspace(document.querySelector('#prepayments-workspace'),zoho);window.workspace.activate();
 });
 const field=k=>page.locator('[data-prepayments-'+k+']');
 const rows=()=>page.locator('.prepayments-table tbody tr').count();
 await page.waitForSelector('.prepayments-table tbody tr');assert.equal(await rows(),1);
 await field('reset').click();assert.equal(await rows(),2);
 await field('mfsp').fill('MFSP-100');await page.locator('.prepayments-filters [type="submit"]').click();assert.equal(await rows(),1);
 await field('reset').click();await field('due-today').check();assert.equal(await rows(),1);assert.equal(await field('from').isDisabled(),true);
 await field('reset').click();
 const metrics=[];
 for(const width of [1440,1280,1024,768,390]){
  await page.setViewportSize({width,height:900});
  for(const mode of ['single','range']){
   await field('date-mode').selectOption(mode);await field('payment-date-mode').selectOption(mode);
   const m=await page.evaluate(()=>{
    const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
    const controls=[...document.querySelectorAll('.prepayments-filters input:not([type="checkbox"]),.prepayments-filters select,.prepayments-filter-actions button')].filter(e=>e.getClientRects().length);
    return {filter:box('.prepayments-filters'),due:box('.prepayments-date-filter'),payment:box('.prepayments-date-filter:nth-child(2)'),table:box('.prepayments-results'),overflow:document.documentElement.scrollWidth>innerWidth,heights:controls.map(e=>e.getBoundingClientRect().height),modePadding:getComputedStyle(document.querySelector('[data-prepayments-date-mode]')).paddingRight,dateWidths:[...document.querySelectorAll('.prepayments-date-control')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().width)};
   });
   assert.equal(m.overflow,false,'page overflow at '+width+' '+mode);assert.ok(m.heights.every(h=>h===36));assert.equal(m.modePadding,'30px');assert.ok(m.dateWidths.every(w=>w>=148));
   if(width>=1280){assert.equal(m.due.y,m.payment.y);assert.equal(m.filter.h,130);}
   metrics.push({width,mode,height:m.filter.h,tableY:m.table.y});
   await page.screenshot({path:'_local/previews/prepayments-layout-'+width+'-'+mode+'.png',fullPage:true});
  }
 }
 await page.setViewportSize({width:1440,height:900});await field('reset').click();
 await page.locator('[data-prepayments-status-view="closed"]').click();assert.equal(await rows(),1);
 const toolbar=page.locator('.prepayment-bank-toolbar'), before=await toolbar.boundingBox();
 assert.equal(await field('bank-receipt-bulk').isDisabled(),true);
 await page.locator('[data-prepayment-select]').check();
 assert.equal(await field('bank-receipt-bulk').isDisabled(),false);assert.equal(await field('bank-proof-bulk').isDisabled(),false);assert.equal(await field('bank-open').isDisabled(),false);
 assert.deepEqual(await toolbar.boundingBox(),before);
 await field('bank-receipt-bulk').click();await page.waitForFunction(()=>window.testWrites.some(p=>p.id==='2'&&p.Bank_Receipt_Needed===true));
 await page.locator('[data-prepayment-select]').check();await field('bank-open').click();await page.waitForSelector('[data-prepayments-bank-dialog][open]');await field('bank-cancel').click();
 await field('bank-proof-bulk').click();assert.match(await field('bank-proof-status').textContent(),/1 of 1/);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({metrics,checks:'search, reset, due today, modes, responsive overflow, selection stability, bulk receipt, bank request preview, proof send (mock CRM)'},null,2));
 await page.setViewportSize({width:390,height:900});
 await page.locator('.prepayments-results').scrollIntoViewIfNeeded();
 assert.ok(await page.locator('.prepayments-table').isVisible());
 assert.ok(await page.evaluate(()=>document.querySelector('.shell').scrollTop>0));
 await page.screenshot({path:'_local/previews/prepayments-layout-mobile-table.png'});
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
