const { chromium } = require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let html = fs.readFileSync('app/widget.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
    html = html.replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g,(_,p)=>'<style>'+fs.readFileSync(path.join('app',p),'utf8')+'</style>');
    await page.route('http://prepayment.test/',route=>route.fulfill({contentType:'text/html',body:html}));
    await page.goto('http://prepayment.test/');
    for (const file of ['invoice-name.js','quick-settlement-refresh.js','prepayments.js','prepayment-allocations.js','prepayment-workflow.js']) await page.addScriptTag({path:'app/scripts/'+file});
    const source = fs.readFileSync('tests/prepayment-workflow.test.js','utf8');
    const fixture = source.slice(source.indexOf('function fixture()'),source.indexOf('const invoiceInput'));
    await page.evaluate(fixture => {
      const ns = window.AccountingManagerApp;
      const assert = {equal(a,b) {if(a!==b) throw Error('Fixture assertion failed');}};
      window.f = eval('('+fixture.trim()+')')();
      ns.operationsDocuments = {files:()=>[]}; ns.syncPrepaymentRequest = async()=>{};
      document.querySelector('#tab-operations').hidden=false;
      document.querySelector('#prepayments-workspace').hidden=false;
      window.flow = ns.createPrepaymentWorkflow(document.querySelector('#prepayments-workspace'),f.zoho,async()=>{});
      return flow.open('p1');
    },fixture);
    const field = key=>page.locator('[data-prepayment-workflow-'+key+']');
    for (const [name,amount] of [['FINAL-A','100'],['FINAL-B','200']]) {
      await field('invoice-type').selectOption('Final Invoice');
      await field('reference').fill(name); await field('allocated').fill(amount); await field('amount').fill(amount);
      await field('submit').click();
      await page.waitForFunction(()=>document.querySelector('[data-prepayment-workflow]').getAttribute('aria-busy')==='false');
      assert.equal(await page.evaluate(()=>f.db.Supplier_Invoices.length),name==='FINAL-A'?1:2,await field('message').innerText());
    }
    assert.equal(await field('payment-fields').isVisible(),true);
    assert.equal(await field('allocations').locator('li').count(),2);
    await page.screenshot({path:'_local/previews/prepayment-two-invoices-1440.png',fullPage:true});
    await field('account').selectOption('a1'); await field('submit').click();
    await page.waitForFunction(()=>document.querySelector('[data-prepayment-workflow]').getAttribute('aria-busy')==='false');
    assert.equal(await page.evaluate(()=>f.db.Prepayments[0].Accounting_Status),'Prepayment recorded',await field('message').innerText());
    assert.equal(await page.evaluate(()=>f.db.Supplier_Payments.length),1);
    await page.setViewportSize({width:390,height:844});
    await field('allocations').scrollIntoViewIfNeeded();
    assert.equal(await field('allocations').isVisible(),true);
    assert.equal(await field('allocations').evaluate(node=>node.getBoundingClientRect().right <= window.innerWidth),true);
    await page.screenshot({path:'_local/previews/prepayment-two-invoices-390.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('Browser: two final invoices -> one payment; desktop and mobile screenshots saved; no page errors.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
