const { chromium } = require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs = require('node:fs'), assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
  const page = await browser.newPage();
  let html=fs.readFileSync('app/widget.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  html=html.replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g,(_,file)=>'<style>'+fs.readFileSync('app/'+file,'utf8')+'</style>');
  await page.setContent(html);await page.addScriptTag({path:'app/scripts/ui-system.js'});
  for(const name of ['config','helpers','dom']) await page.addScriptTag({path:'app/scripts/'+name+'.js'});
  const source=fs.readFileSync('app/scripts/render.js','utf8');
  const funcs=source.slice(source.indexOf('    function renderSupplierActivityDetailPopup('),source.indexOf('    function renderBookingsWorkspace('));
  await page.addScriptTag({content:`const ns=window.AccountingManagerApp, elements=ns.getElements(), helpers=ns.helpers, fieldCandidates=ns.FIELD_CANDIDATES; document.body.append(elements.supplierActivityDetailPopup); ${funcs}
  window.draw=(count,status='Paid',missing=false)=>renderSupplierActivityDetailPopup({isOpen:true,type:'invoice',isLoading:false,record:{Name:'INV-2026-0123456789-LONG-INVOICE-REFERENCE',Status:status,Invoice_Date:'2026-10-14',Booking:{name:'Madrid cultural visit and private guided museum tour'},...(missing?{}:{Invoice_Total:1200,Amount_Paid:status==='Paid'?1200:400,Unpaid_Invoiced_Amount:status==='Paid'?0:800})},lines:Array.from({length:count},(_,i)=>({Service_Date:'2026-10-14',Booking_Service:{name:'4/2'},_serviceProductDescription:i%2?'Long descriptive service '.repeat(20):'Private guided museum visit',Amount:missing?null:1200}))});`});
  for(const [width,height,count,status] of [[1440,900,1,'Paid'],[1440,900,25,'Partially Paid'],[390,700,1,'Received'],[320,640,25,'Paid'],[900,480,25,'Received']]) {
   await page.setViewportSize({width,height});await page.evaluate(([n,s])=>draw(n,s),[count,status]);
   const metrics=await page.evaluate(()=>{const p=document.querySelector('.supplier-activity-detail-card'),t=document.querySelector('.supplier-invoice-lines-scroll'),r=p.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,overflow:p.scrollWidth>p.clientWidth,scroll:t.scrollHeight>t.clientHeight};});
   assert.ok(!metrics.overflow,JSON.stringify(metrics));assert.ok(metrics.left>=0&&metrics.right<=width);
   if(count===1&&width===1440)assert.ok(metrics.height<450,JSON.stringify(metrics));
   if(count===25)assert.ok(metrics.scroll);
   assert.equal(await page.locator('.supplier-invoice-lines tbody tr').count(),count);
   assert.ok(!(await page.locator('.supplier-invoice-lines').innerText()).includes('4/2'));
   const close=page.locator('#supplier-activity-detail-close');await close.focus();assert.notEqual(await close.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
   await page.screenshot({path:`_local/previews/supplier-invoice-detail-${width}-${height}-${count}.png`});
  }
  await page.evaluate(()=>draw(1,'Paid',true));assert.equal(await page.locator('.supplier-invoice-totals dd').allTextContents().then(a=>a.join(',')),'-,-,-');
  await page.evaluate(()=>draw(1,'Paid'));assert.ok(!(await page.locator('.supplier-invoice-totals dd').nth(2).innerText()).includes('-'));assert.equal(await page.locator('.has-pending').count(),0);
  await page.evaluate(()=>draw(1,'Partially Paid'));assert.equal(await page.locator('.has-pending').count(),1);
  console.log('Passed: compact and long lists, 5 viewport cases, descriptions, payment states, absent/zero amounts, close focus.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
