// Local browser verification only; no CRM credentials or remote writes.
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const html=fs.readFileSync('app/widget.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
    .replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g,(_,file)=>'<style>'+fs.readFileSync('app/'+file,'utf8')+'</style>');
  await page.route('https://widget.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('https://widget.test/');
  await page.addScriptTag({path:'app/scripts/ui-system.js'});
  fs.mkdirSync('_local/previews/ui-system',{recursive:true});
  const audit=[];
  for(const width of [1440,1024,390]){
   await page.setViewportSize({width,height:900});
   for(const tab of ['operations','bookings','suppliers','invoices','payments','accounting','setup']){
    await page.evaluate(tab=>{
     document.querySelectorAll('[data-tab-panel]').forEach(panel=>panel.hidden=panel.dataset.tabPanel!==tab);
     document.querySelectorAll('[data-tab-button]').forEach(button=>button.classList.toggle('is-active',button.dataset.tabButton===tab));
     document.querySelector('.shell').scrollTop=0;
    },tab);
    const panel=page.locator('[data-tab-panel="'+tab+'"]');
    assert.ok(await panel.isVisible(),tab);
    const overflow=await panel.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
    audit.push({tab,viewport:width,...overflow,font:await panel.evaluate(el=>getComputedStyle(el).fontFamily)});
    assert.ok(overflow.scroll<=overflow.width+1,tab+' overflows at '+width);
    if(width===390) {
     const last=await page.locator('[data-tab-button="setup"]').boundingBox();
     assert.ok(last.x+last.width<=width,'last navigation item is reachable');
    }
    await page.screenshot({path:`_local/previews/ui-system/${tab}-${width}.png`});
   }
  }
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:800});
   for(const [name,selector] of [
    ['closure','#booking-closure-popup'],['closure-detail','#booking-closure-detail-popup'],
    ['card-invoice','#card-purchase-workflow-modal'],['prepayment-invoice','[data-prepayment-workflow]'],
    ['supplier-invoice','#invoice-create-panel'],['supplier-payment','#invoice-payment-panel'],
    ['allocation-manager','#payment-allocation-manager']
   ]) {
    await page.evaluate(selector=>{
     const root=document.querySelector(selector);
     window.revealed=[];let el=root;
     while(el){if(el.hidden){revealed.push(el);el.hidden=false;}el=el.parentElement;}
     if(root.classList.contains('card-purchase-workflow-modal'))root.classList.add('is-open');
     const ownTab=root.closest('[data-tab-panel]');
     document.querySelectorAll('[data-tab-panel]').forEach(panel=>{if(panel!==ownTab&&!panel.hidden){panel.hidden=true;window.formHiddenTab=panel;}});
     document.querySelector('.shell').scrollTop=0;
    },selector);
    assert.ok(await page.locator(selector).isVisible(),name);
    await page.screenshot({path:`_local/previews/ui-system/form-${name}-${width}.png`,animations:'disabled'});
    await page.evaluate(selector=>{
     revealed.forEach(el=>el.hidden=true);document.querySelector(selector).classList.remove('is-open');
     if(window.formHiddenTab){formHiddenTab.hidden=false;window.formHiddenTab=null;}
    },selector);
   }
  }
  // Controls in a narrow, clipped form and a native modal use the same values,
  // accessible labels and change events. Source <select> remains authoritative.
  await page.evaluate(()=>{
   document.querySelector('.shell').hidden=true;
   const fixture=document.createElement('section');fixture.id='ui-fixture';fixture.style.cssText='margin:16px;max-width:500px';
   fixture.innerHTML='<button id="opener" class="button primary">Open form</button><div style="overflow:hidden;height:120px"><label class="field"><span>Supplier</span><select id="long-select"></select></label><label class="field"><span>Invoice type</span><select id="short-select"><option>Final Invoice</option><option>Proforma</option></select></label></div><label class="field"><span>Multiple</span><select id="multi-select" multiple><option>A</option><option>B</option></select></label><label class="field"><span>Disabled</span><select id="disabled-select" disabled><option>Unavailable</option></select></label><div role="dialog" aria-modal="true" aria-label="Edit invoice" id="fixture-modal" hidden><button id="close-fixture" class="button secondary">Close</button><label class="field"><span>Amount</span><input id="amount" type="number" value="100"></label><button id="save-fixture" class="button primary">Save</button></div>';
   document.body.appendChild(fixture);
   const select=document.getElementById('long-select');
   select.innerHTML='<option value="">Choose supplier</option><optgroup label="Suppliers">'+Array.from({length:60},(_,i)=>'<option value="'+i+'">Supplier '+i+' with a long descriptive name</option>').join('')+'</optgroup>';
   window.changes=[];select.addEventListener('change',()=>changes.push(select.value));
   document.getElementById('opener').onclick=()=>document.getElementById('fixture-modal').hidden=false;
   document.getElementById('close-fixture').onclick=()=>{if(window.preventClose)return;document.getElementById('fixture-modal').hidden=true;};
  });
  await page.locator('#long-select').click();
  await page.locator('.ui-select-menu input').fill('Supplier 59');
  assert.equal(await page.locator('.ui-select-option').count(),1);
  const menuBox=await page.locator('.ui-select-menu').boundingBox();
  assert.ok(menuBox.x>=0&&menuBox.x+menuBox.width<=390);
  await page.screenshot({path:'_local/previews/ui-system/searchable-select-390.png'});
  await page.locator('.ui-select-option').click();
  assert.equal(await page.locator('#long-select').inputValue(),'59');
  assert.deepEqual(await page.evaluate(()=>changes),['59']);
  await page.locator('#long-select').press('ArrowDown');
  await page.locator('.ui-select-menu input').fill('nothing matches');
  assert.equal(await page.locator('.ui-select-empty').innerText(),'No matching options');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.ui-select-menu').count(),0);
  assert.ok(await page.locator('#long-select').evaluate(el=>el===document.activeElement));
  await page.locator('#short-select').click();
  assert.equal(await page.locator('.ui-select-menu input').count(),0);
  assert.equal(await page.locator('.ui-select-option[aria-selected="true"]').count(),1);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#short-select').inputValue(),'Proforma');
  await page.locator('#short-select').click();await page.locator('#opener').click();
  assert.equal(await page.locator('.ui-select-menu').count(),0);
  assert.ok(await page.locator('#close-fixture').evaluate(el=>el===document.activeElement));
  await page.locator('#save-fixture').focus();await page.keyboard.press('Tab');
  assert.ok(await page.locator('#close-fixture').evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Shift+Tab');
  assert.ok(await page.locator('#save-fixture').evaluate(el=>el===document.activeElement));
  await page.evaluate(()=>window.preventClose=true);
  await page.locator('#close-fixture').click();
  assert.ok(await page.locator('#fixture-modal').isVisible());
  await page.evaluate(()=>window.preventClose=false);
  await page.locator('#close-fixture').click();
  assert.ok(await page.locator('#opener').evaluate(el=>el===document.activeElement));
  await page.evaluate(()=>{
   const dialog=document.createElement('dialog');dialog.id='native-fixture';
   dialog.innerHTML='<label class="field"><span>Payment method</span><select id="native-select"><option>Bank</option><option>Card</option></select></label><button class="button secondary" onclick="this.closest(\'dialog\').close()">Close</button>';
   document.body.appendChild(dialog);dialog.showModal();
  });
  await page.locator('#native-select').click();await page.locator('.ui-select-option').nth(1).click();
  assert.equal(await page.locator('#native-select').inputValue(),'Card');
  await page.locator('#native-fixture button').click();
  await page.evaluate(()=>{
   const box=document.createElement('div');box.style.cssText='height:80px;overflow:hidden';
   box.innerHTML='<button id="legacy-toggle" class="button secondary bookings-stage-toggle" aria-expanded="false" aria-controls="legacy-menu">Statuses</button><div id="legacy-menu" class="bookings-stage-menu" hidden><label class="bookings-stage-option"><input type="checkbox">Pending review</label><label class="bookings-stage-option"><input type="checkbox">Reviewed</label></div>';
   document.getElementById('ui-fixture').prepend(box);
   document.getElementById('legacy-toggle').onclick=function(){const menu=document.getElementById('legacy-menu');menu.hidden=!menu.hidden;this.setAttribute('aria-expanded',String(!menu.hidden));};
  });
  await page.locator('#legacy-toggle').click();
  await page.waitForFunction(()=>document.getElementById('legacy-menu').matches(':popover-open'));
  await page.locator('#legacy-menu input').first().check();
  assert.equal(await page.locator('#legacy-menu input').first().isChecked(),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#legacy-toggle').getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('#legacy-menu').isVisible(),false);
  await page.evaluate(()=>{
   document.querySelector('#amount').closest('label').insertAdjacentHTML('beforeend','<small class="field-error">Enter a positive amount.</small>');
   document.querySelector('#fixture-modal').hidden=false;
  });
  await page.waitForFunction(()=>document.getElementById('amount').getAttribute('aria-invalid')==='true');
  assert.ok(await page.locator('#amount').getAttribute('aria-describedby'));
  await page.evaluate(()=>document.querySelector('.field-error').hidden=true);
  await page.waitForFunction(()=>!document.getElementById('amount').hasAttribute('aria-invalid'));
  await page.locator('#close-fixture').click();
  await page.addScriptTag({path:'app/scripts/operation-edit.js'});
  await page.evaluate(fields=>{
   window.operationFixtureFields=fields;
   window.operationEditor=AccountingManagerApp.createOperationEditor({CRM:{
    API:{},META:{getFields:async({Entity})=>({fields:operationFixtureFields[Entity]})},
    FUNCTIONS:{execute:async(name,args)=>{
     const request=JSON.parse(JSON.parse(args.arguments).requestJson);
     return {details:{output:JSON.stringify({success:true,financial_locked:window.lockedOperation,record:{
      id:request.id,Name:'Long operation reference for layout review',Amount:100,Currency:'EUR',Percent:25,
      Accounting_Status:'Pending invoice',Transaction_Type:'Purchase',Review_Notes:'Review note',Payment_Proof:[],Supporting_Documents:[]
     }})}};
    }}
   }});
  },JSON.parse(fs.readFileSync('tests/fixtures/operation-edit-fields.json','utf8')));
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:800});
   for(const module of ['Prepayments','Card_Purchases']){
    await page.evaluate(async module=>{window.lockedOperation=module==='Card_Purchases';await operationEditor.open(module,'fixture',document.getElementById('opener'));},module);
    assert.ok(await page.locator('.operation-edit-dialog').isVisible());
    const bounds=await page.locator('.operation-edit-dialog').boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
    if(module==='Card_Purchases')assert.ok(await page.locator('[data-field="Amount"]').isDisabled());
    await page.screenshot({path:`_local/previews/ui-system/edit-${module}-${width}.png`});
    await page.locator('.operation-edit-dialog [data-close]').first().click();
   }
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('#opener').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  assert.deepEqual(errors,[]);
  fs.writeFileSync('_local/previews/ui-system/audit.json',JSON.stringify(audit,null,2));
  console.log('Shared UI checks passed: 7 static views × 3 widths; long/short selectors, values/events, clipping, no results, keyboard, outside click, modal focus/guard/restore, native modal, reduced motion.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
