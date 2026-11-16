const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{
   const u=new URL(r.request().url());
   if(u.hostname!=='operations.test')return r.fulfill({body:''});
   const file=path.join(process.cwd(),'app',u.pathname==='/'?'widget.html':u.pathname);
   return r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
  });
  await page.addInitScript(()=>{
   window.apiCalls=[];let onLoad;
   const today=new Date().toLocaleDateString('en-CA');
   const records=Array.from({length:230},(_,i)=>({id:String(1000+i),Name:'Record '+i,Amount:100,Accounting_Status:'Pending invoice',Due_Date:today,Transaction_Date:'2026-10-20',Transaction_Type:'Purchase',MFSP_Reference:i===229?'TARGET':'COMMON',Supplier_Code:'SUP',Prepayment_Request:{id:i===229?'target':'common'},Owner:{id:'owner',name:'Owner'}}));
   const requests=[{id:'common',Name:'Common',MFSP_Reference:'COMMON'},{id:'target',Name:'Target',MFSP_Reference:'TARGET'}];
   const services=records.map((r,i)=>({id:r.id,Booking:{id:i===229?'target':'common'},Supplier:{id:'vendor'},Hotel_Check_In:'2026-10-20',Hotel_Check_Out:'2026-10-21'}));
   window.ZOHO={embeddedApp:{on(n,fn){onLoad=fn;},async init(){onLoad({});}},CRM:{
    API:{
     async getAllRecords(q){apiCalls.push(q);const all=q.Entity==='Prepayments'||q.Entity==='Card_Purchases'?records:q.Entity==='Prepayment_Requests'?requests:[];const start=((q.page||1)-1)*(q.per_page||200);return {data:all.slice(start,start+(q.per_page||200)),info:{more_records:start+(q.per_page||200)<all.length}};},
     async coql({select_query:q}){if(!q.includes('from Booking_Services'))return {data:[]};const m=q.match(/limit (\d+), (\d+)/),start=+m[1],size=+m[2];return {data:services.slice(start,start+size),info:{more_records:start+size<services.length}};},
     async getRecord(q){return {data:[q.Entity==='Vendors'?{id:q.RecordID,Destination:'Spain',TP_Reference:'SUP',Vendor_Name:'Hotel'}:q.Entity==='Deals'?{id:q.RecordID,Ezus_Project_ID:'project',MFSP_Reference:q.RecordID==='target'?'TARGET':'COMMON',Deal_Name:'Booking',Contact_Name:{id:'contact'}}:{id:q.RecordID,Email:'test@example.com'}]};},
     async searchRecord(){return {data:[]};}
    },
    FUNCTIONS:{async execute(name,args){
     if(name.toLowerCase()==='crm_gettravelersforbooking')return {details:{output:JSON.stringify([{id:'pax',Forename:'Test',Name:'Traveler',Lead_Pax:true,Email:'test@example.com'}])}};
     if(name==='creator_getrenfepayments'){
      const data=JSON.parse(args.arguments),query=JSON.parse(data.searchText);apiCalls.push({renfe:query});
      let all=records.map(r=>({id:r.id,booking_mfsp:r.MFSP_Reference,booking_name:r.Name,amount:100,requested_date:'20-Oct-2026'}));
      if(query.query)all=all.filter(r=>r.booking_mfsp.includes(query.query));
      const offset=Number(query.cursor||0),rows=all.slice(offset,offset+200),more=offset+200<all.length;
      return {details:{output:JSON.stringify({success:true,records:rows,has_more:more,next_cursor:more?String(offset+200):''})}};
     }return {details:{output:'{"success":true,"records":[]}'}};
    }},
    META:{async getFields(){return {fields:[]};}},UI:{async Resize(){}},CONFIG:{async getCurrentUser(){return {users:[]};}}
   }};
  });
  await page.goto('https://operations.test/');
  await page.locator('[data-tab-button="operations"]').click();
  await page.locator('[data-operation-type="prepayments"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-prepayments-results] tbody tr').length===50);
  const pre=page.locator('[data-prepayments-results] > .table-wrap');
  await pre.evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));});
  await page.waitForFunction(()=>document.querySelectorAll('[data-prepayments-results] tbody tr').length===100);
  assert.ok(await pre.evaluate(e=>e.scrollTop)>0);
  assert.ok(await page.locator('[data-prepayments-pager]').isHidden());
  await page.locator('[data-prepayments-mfsp]').fill('TARGET');await page.locator('[data-prepayments-mfsp]').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('[data-prepayments-results] tbody tr').length===1);
  assert.match(await page.locator('[data-prepayments-results]').innerText(),/Record 229/);
  await page.locator('[data-operation-type="card-purchases"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#operations-table-body tr').length===50);
  await page.locator('#operations-table-wrap').evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));});
  await page.waitForFunction(()=>document.querySelectorAll('#operations-table-body tr').length===100);
  await page.locator('#card-purchases-mfsp-filter').fill('TARGET');await page.locator('#card-purchases-mfsp-filter').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('#operations-table-body tr').length===1);
  assert.match(await page.locator('#operations-table-body').innerText(),/Record 229/);
  await page.locator('[data-operation-type="renfe"]').click();
  await page.locator('#operations-filter-search').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('#operations-table-body tr').length===50);
  for(const count of [100,150,200,230]){
   await page.locator('#operations-table-wrap').evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));});
   await page.waitForFunction(n=>document.querySelectorAll('#operations-table-body tr').length===n,count);
  }
  assert.ok(await page.evaluate(()=>apiCalls.some(c=>c.renfe?.cursor==='200')));
  await page.locator('#operations-filter-search').fill('TARGET');await page.locator('#operations-filter-search').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('#operations-table-body tr').length===1);
  await page.locator('[data-ministry-report-tab]').click();
  await page.locator('#ministry-date-preset').selectOption('specific');
  await page.locator('#ministry-check-in-from').fill('2026-10-01');await page.locator('#ministry-check-out-to').fill('2026-10-31');
  await page.locator('#ministry-filter-mfsp').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('#ministry-register-table-body tr').length===50);
  await page.locator('#ministry-register-table-wrap').evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));});
  await page.waitForFunction(()=>document.querySelectorAll('#ministry-register-table-body tr').length===100);
  await page.locator('#ministry-filter-mfsp').fill('TARGET');await page.locator('#ministry-filter-mfsp').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('#ministry-register-table-body tr').length===1);
  assert.match(await page.locator('#ministry-register-table-body').innerText(),/TARGET/);
  assert.deepEqual(errors,[]);
  console.log('PASS four tables: first 50, accumulated scroll, Enter searches beyond row 200, RENFE remote cursor, no previous/next.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
