const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('https://exports.test/**',r=>r.fulfill({body:'<body></body>',contentType:'text/html'}));
  await page.goto('https://exports.test/');
  await page.setContent(['payment-allocations-export','selected-payment-allocations-export'].map(id=>`<button id="${id}">Export Excel</button><span role="status" id="${id}-status"></span>`).join(''));
  for(const file of ['excel-workbook','payment-allocation-export','payment-diagnostics'])await page.addScriptTag({path:'app/scripts/'+file+'.js'});
  await page.evaluate(()=>{
   window.calls=[];
   window.state={views:{payments:{selectedId:'payment-7'},paymentAllocations:{filters:{reference:'draft'},appliedFilters:{reference:'applied'}}}};
   AccountingManagerApp.bindPaymentAllocationExports({state,fetchPage:async(payment,filters,query)=>{
    calls.push({payment,filters,query});
    const count=payment?3:205,start=(query.page-1)*query.perPage;
    return {records:Array.from({length:Math.min(query.perPage,Math.max(0,count-start))},(_,i)=>({id:String(start+i),Allocated_Amount:12.34,Name:'Allocation',Currency:'EUR'})),hasMore:start+query.perPage<count};
   }});
  });
  let downloadPromise=page.waitForEvent('download');
  await page.locator('#payment-allocations-export').click();
  const general=await downloadPromise;assert.equal(general.suggestedFilename(),'Payment-allocations.xlsx');
  assert.match(await page.locator('#payment-allocations-export-status').innerText(),/205 allocations exported/);
  assert.equal(await page.evaluate(()=>calls.length),3);
  assert.ok(await page.evaluate(()=>calls.every(c=>c.filters.reference==='applied'&&!c.payment)));
  downloadPromise=page.waitForEvent('download');
  await page.locator('#selected-payment-allocations-export').click();
  const detail=await downloadPromise;assert.equal(detail.suggestedFilename(),'Payment-allocations-payment-7.xlsx');
  assert.equal(await page.evaluate(()=>calls.at(-1).payment),'payment-7');
  await page.evaluate(()=>{
   AccountingManagerApp.startPaymentDiagnostics({mfsp:'MFSP2608663'});
   const entry=AccountingManagerApp.tracePaymentQuery('select id from Supplier_Payments');
   AccountingManagerApp.finishPaymentQuery(entry,[],{code:'INVALID_QUERY',message:'Test diagnostic'});
   AccountingManagerApp.showPaymentDiagnostics();
  });
  assert.match(await page.locator('dialog textarea').inputValue(),/INVALID_QUERY/);
  await page.getByRole('button',{name:'Copy diagnostic',exact:true}).click();
  assert.match(await page.locator('dialog [role="status"]').innerText(),/Copied|Ctrl\+C/);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await page.locator('dialog').count(),0);
  console.log('PASS: both Excel downloads, all pages, applied filter snapshot, selected-payment scope, diagnostic dialog and copy/fallback.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
