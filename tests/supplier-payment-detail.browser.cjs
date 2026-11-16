const { chromium } = require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs = require('node:fs'), assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
  const page = await browser.newPage();
  let html=fs.readFileSync('app/widget.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  html=html.replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g,(_,file)=>'<style>'+fs.readFileSync('app/'+file,'utf8')+'</style>');
  await page.setContent(html);await page.addScriptTag({path:'app/scripts/ui-system.js'});
  for(const name of ['config','helpers','dom','payments']) await page.addScriptTag({path:'app/scripts/'+name+'.js'});
  const source=fs.readFileSync('app/scripts/render.js','utf8');
  const funcs=source.slice(source.indexOf('    function renderSupplierActivityDetailPopup('),source.indexOf('    function renderBookingsWorkspace('));
  await page.addScriptTag({content:`const ns=window.AccountingManagerApp, elements=ns.getElements(), helpers=ns.helpers, fieldCandidates=ns.FIELD_CANDIDATES; document.body.append(elements.supplierActivityDetailPopup); ${funcs}
  window.draw=(count,status='Paid',mode='ready')=>renderSupplierActivityDetailPopup({isOpen:true,type:'payment',isLoading:mode==='loading',error:mode==='error'?'Could not load payment allocations.':'',accountDisplay:mode==='loading'?null:{text:mode==='error'?'Payment account unavailable':'Banco supplier operating account',error:mode==='error'},record:{Name:'PAY-2026-0123456789-LONG-PAYMENT-REFERENCE',Status:status,Payment_Date:'2026-10-14',Movement_Type:'Outbound Payment',Payment_Amount:mode==='missing'?null:1200,Payment_Account:{id:'account'}},allocations:Array.from({length:count},(_,i)=>({Name:'PAY combined allocation name',_invoiceDisplay:{text:'INV-2026-'+i+'-Supplier-reference'},_bookingDisplay:{text:i%2?'Barcelona cultural tour with private transport and a long description':'Madrid museum visit'},Allocation_Date:'2026-10-14',Allocated_Amount:i?0:800}))});`});
  for(const [width,height,count,status] of [[1440,900,1,'Paid'],[1440,900,25,'Received'],[390,700,1,'Paid'],[320,640,25,'Paid'],[900,480,25,'Received']]) {
   await page.setViewportSize({width,height});await page.evaluate(([n,s])=>draw(n,s),[count,status]);
   const metrics=await page.evaluate(()=>{const p=document.querySelector('.supplier-activity-detail-card'),t=document.querySelector('.supplier-invoice-lines-scroll'),r=p.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right,overflow:p.scrollWidth>p.clientWidth,scroll:t.scrollHeight>t.clientHeight};});
   assert.ok(!metrics.overflow,JSON.stringify(metrics));assert.ok(metrics.left>=0&&metrics.right<=width);
   if(count===1&&width===1440)assert.ok(metrics.height<450,JSON.stringify(metrics));
   if(count===25)assert.ok(metrics.scroll);
   assert.equal(await page.locator('tbody tr').filter({has:page.locator('td')}).count()>0,true);
   assert.ok(!(await page.locator('#supplier-activity-detail-content').innerText()).includes('combined allocation'));
   const close=page.locator('#supplier-activity-detail-close');await close.focus();assert.notEqual(await close.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
   await page.screenshot({path:`_local/previews/supplier-payment-detail-${width}-${height}-${count}.png`});
  }
  await page.evaluate(()=>draw(1,'Paid','loading'));assert.match(await page.locator('#supplier-activity-detail-content').innerText(),/Loading payment account/);assert.equal(await page.locator('[role="status"]').count()>0,true);
  await page.evaluate(()=>draw(1,'Paid','error'));assert.equal(await page.locator('#supplier-activity-detail-content [role="alert"]').innerText(),'Could not load payment allocations.');assert.match(await page.locator('.lookup-unavailable').innerText(),/unavailable/);
  await page.evaluate(()=>draw(1,'Paid','missing'));assert.equal(await page.locator('.supplier-payment-amount strong').innerText(),'-');
  console.log('Passed: 5 viewport cases, compact/scrolling allocations, payment states, loading/errors, missing amount, focus.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
