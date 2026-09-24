const { chromium } = require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let html = fs.readFileSync('app/widget.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g, (_, file) => '<style>' + fs.readFileSync(path.join('app', file), 'utf8') + '</style>');
    await page.setContent(html);
    await page.evaluate(() => {
      document.querySelectorAll('.tab-panel').forEach(el => el.hidden = el.id !== 'tab-operations');
      const panel = document.querySelector('#prepayments-workspace');
      panel.hidden = false;
      for (const el of panel.parentElement.children) if (el !== panel && !el.classList.contains('operations-header')) el.hidden = true;
      window.deletedIds = [];
      Object.defineProperty(window, 'localStorage', { value: {} });
      window.AccountingManagerApp = {
        createPrepaymentWorkflow: () => ({ close() {}, open() {} }),
        createPrepaymentDeletionService: () => ({ pending: () => [], remove: async id => { window.deletedIds.push(id); } })
      };
    });
    await page.addScriptTag({ content: fs.readFileSync('app/scripts/prepayments.js', 'utf8') });
    await page.evaluate(async () => {
      const ns = window.AccountingManagerApp;
      const p = { id: '123', Name: 'Hotel deposit', Due_Date: ns.prepaymentsModel.today(), Accounting_Status: 'Pending invoice' };
      const workspace = ns.createPrepaymentsWorkspace(document.querySelector('#prepayments-workspace'), { CRM: { API: {
        getAllRecords: async ({ Entity }) => ({ data: Entity === 'Prepayments' && !window.deletedIds.length ? [p] : [] })
      } } });
      workspace.activate();
    });
    await page.locator('[data-prepayment-actions]').click();
    assert.equal(await page.locator('.prepayment-actions-menu:popover-open').count(), 1);
    await page.locator('[data-prepayment-delete]').click();
    assert.equal(await page.locator('[data-prepayments-delete-dialog]').evaluate(el => el.open), true);
    assert.deepEqual(await page.evaluate(() => window.deletedIds), []);
    await page.screenshot({ path: '_local/previews/prepayment-delete-confirm.png' });
    await page.locator('[data-prepayments-delete-cancel]').click();
    assert.deepEqual(await page.evaluate(() => window.deletedIds), []);
    await page.locator('[data-prepayment-actions]').click();
    await page.locator('[data-prepayment-discard]').click();
    assert.equal(await page.locator('[data-prepayments-discard-dialog]').evaluate(el => el.open), true);
    await page.locator('[data-prepayments-discard-cancel]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-prepayment-actions]').click();
    const box = await page.locator('.prepayment-actions-menu:popover-open').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
    await page.locator('[data-prepayment-delete]').click();
    await page.locator('[data-prepayments-delete-submit]').click();
    await page.waitForFunction(() => !document.querySelector('[data-prepayments-delete-dialog]').open);
    assert.deepEqual(await page.evaluate(() => window.deletedIds), ['123']);
    console.log('Desktop/mobile menu, discard dialog, delete confirmation, cancel and confirmed deletion passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
