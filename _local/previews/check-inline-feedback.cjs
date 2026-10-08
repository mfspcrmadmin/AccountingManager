const { chromium } = require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let html = fs.readFileSync('app/widget.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g, (_, file) => '<style>' + fs.readFileSync(path.join('app', file), 'utf8') + '</style>');
    await page.setContent(html);
    for (const name of ['config', 'helpers', 'dom', 'inline-feedback', 'render-payments', 'render-invoices', 'render-accounting', 'render', 'supplier-workspace']) {
      await page.addScriptTag({ path: `app/scripts/${name}.js` });
    }
    await page.evaluate(() => {
      const ns = window.AccountingManagerApp;
      window.state = ns.createInitialState();
      state.currentTab = 'suppliers';
      window.elements = ns.getElements();
      window.renderer = ns.createRenderer(elements, state, ns.helpers, ns.FIELD_CANDIDATES);
      window.supplierRenderer = renderer.withFeedbackTarget('supplier-search');
      renderer.renderTabs();
      window.workspace = ns.createSupplierWorkspaceModule({
        MODULES: ns.MODULES, FIELD_CANDIDATES: ns.FIELD_CANDIDATES, state, elements, helpers: ns.helpers,
        crm: { getRecord: () => new Promise(resolve => { window.resolveSupplier = resolve; }) },
        renderer: supplierRenderer, renderAll: () => renderer.renderSupplierContext(), debugError() {},
        closeCreateInvoicePanel() {}, loadInvoicesForSupplier: async () => [], loadPaymentsForSupplier: async () => [],
        resetInvoiceCreateSettlementState() {}, resetInvoiceCreateFormAfterCreate() {}, applyInvoiceCreateSupplierTaxDefaults() {}
      });
      window.loading = workspace.loadSupplierWorkspace('123');
    });
    assert.equal(await page.locator('.floating-message-stack').count(), 0);
    assert.match(await page.locator('#search-panel .inline-feedback').innerText(), /Loading supplier/);
    assert.equal(await page.locator('#search-panel .inline-feedback-spinner').isVisible(), true);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: `_local/previews/inline-supplier-loading-${width}.png`, fullPage: true });
      assert.equal(await page.locator('#search-panel .inline-feedback').evaluate(el => getComputedStyle(el).position), 'static');
      assert.equal(await page.locator('#search-panel').evaluate(el => el.scrollWidth > el.clientWidth), false);
    }
    await page.evaluate(async () => {
      resolveSupplier({ id: '123', Vendor_Name: 'Supplier sample' });
      await loading;
    });
    assert.equal(await page.locator('#search-panel .inline-feedback-spinner').isVisible(), false);
    assert.match(await page.locator('#search-panel .inline-feedback').innerText(), /Supplier loaded/);
    await page.evaluate(() => {
      supplierRenderer.setLoading(true, 'Loading supplier...');
      const invoices = renderer.withFeedbackTarget('invoices');
      invoices.setLoading(true, 'Loading invoices...');
      invoices.showError('Could not load invoices. Try again.');
      invoices.setLoading(false);
      supplierRenderer.showNotice('Supplier loaded.', { tone: 'success' });
      supplierRenderer.setLoading(false);
      state.currentTab = 'invoices'; renderer.renderTabs();
    });
    assert.equal(await page.evaluate(() => state.isLoading), false);
    assert.match(await page.locator('#invoices-filter-toolbar + .inline-feedback').innerText(), /Could not load invoices/);
    await page.waitForTimeout(5500);
    assert.equal(await page.locator('#invoices-filter-toolbar + .inline-feedback').isVisible(), true);
    await page.locator('#invoices-filter-toolbar + .inline-feedback button').click();
    assert.equal(await page.locator('#invoices-filter-toolbar + .inline-feedback').isVisible(), false);
    await page.evaluate(() => {
      document.querySelector('#invoice-create-panel').hidden = false;
      renderer.withFeedbackTarget('invoice-create').showError('Enter a valid invoice date.');
    });
    assert.match(await page.locator('#invoice-create-panel > .inline-feedback').textContent(), /valid invoice date/);
    await page.evaluate(() => {
      renderer.withFeedbackTarget('invoice-create').showNotice('<img src=x onerror=alert(1)>');
    });
    assert.equal(await page.locator('#invoice-create-panel > .inline-feedback img').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: supplier loading, mobile layout, independent feedback, persistent errors, dismiss and form validation.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
