// Interaction contracts: option searches never execute record searches.
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'), assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:480}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<body class="accounting-widget"><div id="fixture"></div></body>');
  for(const file of ['theme','components','ui-system']) await page.addStyleTag({content:fs.readFileSync(`app/styles/${file}.css`,'utf8')});
  await page.evaluate(()=>{
   document.querySelector('#fixture').innerHTML=`
    <div class="table-filter-bar"><label>Reference<input id="reference"></label><button id="record-search">Search</button></div>
    <label>Supplier<select id="supplier"><optgroup label="Spain"><option value="a" label="Ávila">Internal text</option><option value="b">Málaga</option></optgroup><optgroup label="Other">${Array.from({length:15},(_,i)=>`<option value="${i}">Supplier ${i}</option>`).join('')}</optgroup></select></label>
    <div style="height:70px;overflow:hidden"><button id="toggle" aria-controls="statuses" aria-expanded="false">Statuses</button><div id="statuses" class="bookings-stage-menu" hidden></div></div>
    <label>Remote<input id="remote" role="combobox"></label><div class="operation-lookup-results"><button>Remote result</button></div>`;
   window.events=[]; window.searches=0; window.remoteCalls=[];
   document.querySelector('#record-search').onclick=()=>searches++;
   document.querySelector('#supplier').addEventListener('input',()=>events.push('input'));
   document.querySelector('#supplier').addEventListener('change',()=>events.push('change'));
   document.querySelector('#supplier option[value="14"]').disabled=true;
   document.querySelector('#remote').addEventListener('input',e=>remoteCalls.push(e.target.value));
   window.renderStatuses=()=>document.querySelector('#statuses').innerHTML=Array.from({length:16},(_,i)=>`<label class="bookings-stage-option"><input type="checkbox" value="${i}" ${i===3?'checked':''}>${i===3?'Málaga':`Stage ${i}`}</label>`).join('');
   renderStatuses();
   document.querySelector('#toggle').onclick=function(){const menu=document.querySelector('#statuses'); menu.hidden=!menu.hidden;this.setAttribute('aria-expanded',String(!menu.hidden));};
   document.querySelector('#statuses').addEventListener('input',()=>events.push('checkbox-input'));
   document.querySelector('#statuses').addEventListener('change',()=>events.push('checkbox-change'));
  });
  await page.addScriptTag({path:'app/scripts/ui-system.js'});
  await page.locator('#reference').press('Enter');
  assert.equal(await page.evaluate(()=>searches),1,'preserve existing Enter-to-apply on record toolbars');
  await page.locator('#supplier').click();
  await page.locator('.ui-select-menu input').fill('AVILA');
  assert.equal(await page.locator('.ui-select-option').innerText(),'Ávila');
  assert.equal(await page.locator('.ui-select-group').innerText(),'Spain');
  assert.deepEqual(await page.evaluate(()=>events),[]);
  await page.locator('.ui-option-search-clear').click();
  assert.equal(await page.locator('.ui-select-option').count(),17);
  assert.equal(await page.locator('#supplier').inputValue(),'a');
  await page.locator('.ui-select-menu input').fill('Supplier 14');
  assert.ok(await page.locator('.ui-select-option').isDisabled());
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#supplier').inputValue(),'a');
  assert.deepEqual(await page.evaluate(()=>events),[]);
  await page.locator('.ui-select-menu input').fill('malaga');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(()=>events),['input','change']);
  assert.equal(await page.locator('#supplier').inputValue(),'b');
  await page.locator('#supplier').click();
  await page.locator('.ui-select-menu input').fill('not found');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.ui-select-empty').count(),1);
  assert.equal(await page.locator('#supplier').inputValue(),'b');
  await page.evaluate(()=>{const option=document.createElement('option');option.value='new';option.label='Not found previously';document.querySelector('#supplier').append(option);});
  await page.waitForFunction(()=>document.querySelectorAll('.ui-select-option').length===1);
  await page.keyboard.press('Escape');
  await page.locator('#supplier').click();
  await page.evaluate(()=>document.querySelector('#reference').click());
  assert.equal(await page.locator('.ui-select-menu').count(),0,'click-only outside dismissal');
  await page.locator('#toggle').click();
  await page.locator('#statuses .ui-option-search input').fill('MALAGA');
  assert.equal(await page.locator('#statuses .bookings-stage-option:visible').count(),1);
  assert.ok(await page.locator('#statuses input[value="3"]').isChecked());
  await page.locator('#statuses .ui-option-search input').fill('missing');
  assert.ok(await page.locator('#statuses .ui-select-empty').isVisible());
  assert.deepEqual(await page.evaluate(()=>events),['input','change']);
  await page.locator('#statuses .ui-option-search-clear').click();
  await page.locator('#statuses input[value="2"]').check();
  assert.deepEqual(await page.evaluate(()=>events),['input','change','checkbox-input','checkbox-change']);
  assert.ok(await page.locator('#statuses input[value="3"]').isChecked());
  await page.locator('#statuses .ui-option-search input').fill('malaga');
  await page.evaluate(()=>renderStatuses());
  await page.waitForFunction(()=>document.querySelector('#statuses .ui-option-search input')?.value==='malaga');
  assert.equal(await page.locator('#statuses .bookings-stage-option:visible').count(),1);
  await page.keyboard.press('Escape');
  await page.locator('#toggle').click();
  assert.equal(await page.locator('#statuses .ui-option-search input').inputValue(),'');
  await page.keyboard.press('Escape');
  await page.locator('#remote').fill('remote API query');
  assert.deepEqual(await page.evaluate(()=>remoteCalls),['remote API query']);
  assert.equal(await page.locator('.operation-lookup-results .ui-option-search').count(),0);
  assert.equal(await page.evaluate(()=>searches),1);
  await page.evaluate(()=>{
   const menu=document.querySelector('#statuses');menu.className='card-purchases-status-menu';
   menu.innerHTML=Array.from({length:15},(_,i)=>`<button class="service-multi-filter-option card-purchase-owner-option" type="button" data-owner="${i}">${i===7?'Ángela with a very long owner display name':'Owner '+i}</button>`).join('');
   window.ownerSelections=[];
   menu.addEventListener('click',event=>{const button=event.target.closest('[data-owner]');if(button)ownerSelections.push(button.dataset.owner);});
  });
  await page.locator('#toggle').click();
  await page.locator('#statuses .ui-option-search input').fill('ANGELA');
  assert.equal(await page.locator('[data-owner]:visible').count(),1);
  const bounds=await page.locator('#statuses').boundingBox();
  assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=480);
  await page.locator('[data-owner="7"]').click();
  assert.deepEqual(await page.evaluate(()=>ownerSelections),['7']);
  await page.evaluate(()=>document.querySelectorAll('[data-owner]').forEach((button,index)=>{if(index>2)button.remove();}));
  await page.waitForFunction(()=>!document.querySelector('#statuses .ui-option-search'));
  assert.equal(await page.locator('[data-owner]:visible').count(),3,'shortened lists reset only option visibility');
  await page.keyboard.press('Escape');
  // Native fallback remains available when Popover API is absent.
  const fallback=await browser.newPage();
  await fallback.setContent('<body class="accounting-widget"><select><option>A</option><option>B</option></select></body>');
  await fallback.evaluate(()=>HTMLElement.prototype.showPopover=undefined);
  await fallback.addScriptTag({path:'app/scripts/ui-system.js'});
  await fallback.selectOption('select','B');
  assert.equal(await fallback.locator('select').inputValue(),'B');
  assert.equal(await fallback.locator('.ui-select-menu').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Option contracts passed: accents, labels/groups, clear, retained selection, exact events, live options, multiselect rerender, no-results, click-only dismissal, remote-handler preservation, native fallback.');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
