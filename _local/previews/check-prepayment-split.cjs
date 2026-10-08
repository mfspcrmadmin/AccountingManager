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

    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({width, height: 650});
      await page.waitForTimeout(260);
      const result = await page.evaluate(() => {
        const summary = document.querySelector('.prepayment-workflow-summary');
        const form = document.querySelector('.prepayment-workflow-form');
        const card = document.querySelector('.prepayment-workflow-card');
        summary.scrollTop = 30;
        const before = summary.scrollTop;
        form.scrollTop = form.scrollHeight;
        const box = form.getBoundingClientRect();
        return { before, after: summary.scrollTop, formScroll: form.scrollTop, summaryHeight: summary.clientHeight, formHeight: form.clientHeight, fits: box.right <= innerWidth && box.bottom <= innerHeight + 1, overflow: card.scrollWidth > card.clientWidth };
      });
      assert.equal(result.before, result.after, 'Summary must remain in place');
      assert.ok(result.formScroll > 0, 'Form must scroll independently');
      assert.ok(result.summaryHeight > 100 && result.formHeight > 200);
      assert.ok(result.fits && !result.overflow, JSON.stringify(result));
      await page.screenshot({path:`_local/previews/prepayment-split-invoice-${width}.png`});
    }
    assert.deepEqual(errors, []);
    console.log('Verified invoice form and independent summary scrolling at 1440, 1024, 768 and 390px.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});

