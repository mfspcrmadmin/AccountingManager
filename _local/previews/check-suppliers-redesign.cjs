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
    await page.route('http://suppliers.test/', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('http://suppliers.test/');
    for (const file of ['config', 'helpers', 'dom', 'render-payments', 'render-invoices', 'render-accounting', 'render', 'supplier-workspace', 'supplier-view']) {
      await page.addScriptTag({ path: `app/scripts/${file}.js` });
    }
    // Exercise the production search and selection module with local CRM fixtures.
    await page.evaluate(() => {
      const ns = window.AccountingManagerApp;
      window.state = ns.createInitialState();
      state.currentTab = 'suppliers';
      window.elements = ns.getElements();
      window.renderer = ns.createRenderer(elements, state, ns.helpers, ns.FIELD_CANDIDATES);
      window.supplier = {
        id: 's1', Vendor_Name: 'Mediterranean Hospitality & Destination Services - International Group',
        TP_Reference: 'SUP-2048', Ezus_Supplier_API: 'ezus-2048',
        Last_Ezus_Sync_At: '2026-09-28T10:20:00+02:00', Last_Ezus_Sync_By: 'accounting.team@example.com',
        Vendor_Type: 'Hotel', Supplier_Category: 'Accommodation', Subcategory: 'Independent hotel',
        Destination: 'Spain', Subdestination: 'Barcelona', Website: 'https://example.com/hospitality',
        Tax_Name: 'Mediterranean Hospitality Services S.L.', CIF_NIF: 'B12345678', Is_Self_Employed: false,
        IBAN: 'ES91 2100 0418 4502 0005 1332', Cuenta_Contable: '41000025',
        Default_Accounting_Account: '60000001', Default_Accounting_Rule: 'Domestic accommodation',
        Payment_Method: 'Bank transfer', Commission_Status: 'Commissionable', Commission_Amount: 0,
        Commission_Notes: 'No commission for group bookings.\nSpecial event rates require prior approval.',
        Payment_Conditions: 'A 20% deposit is due on confirmation. The remaining balance is payable 30 days before arrival.\n' + 'Please include the booking reference with every transfer. '.repeat(8),
        Cancellation_Policy: 'Free cancellation until 30 days before arrival.\n' + 'Later cancellations may incur charges according to the agreed booking terms. '.repeat(8),
        Address: 'Avinguda del Mediterrani, 125\nReception, second floor', City_Town: 'Barcelona', Analysis_City: 'Barcelona', Country: 'Spain', Zip_Code: '08001'
      };
      window.draw = () => { renderer.renderSupplierContext(); renderer.renderSupplierRelatedActivity(state.supplierInvoices, state.supplierPayments); };
      window.workspace = ns.createSupplierWorkspaceModule({
        MODULES: ns.MODULES, FIELD_CANDIDATES: ns.FIELD_CANDIDATES, state, elements, helpers: ns.helpers,
        crm: { getRecord: async () => supplier, searchRecord: async () => [supplier], searchWord: async () => [] },
        renderer, renderAll: draw, debugError: (_, e) => { throw e; },
        closeCreateInvoicePanel() {}, loadInvoicesForSupplier: async () => [], loadPaymentsForSupplier: async () => [],
        resetInvoiceCreateSettlementState() {}, resetInvoiceCreateFormAfterCreate() {}, applyInvoiceCreateSupplierTaxDefaults() {}
      });
      ns.bindSupplierView(document.querySelector('#tab-suppliers'));
      elements.loadSupplier.addEventListener('click', workspace.onLoadSupplierClick);
      elements.supplierSearch.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); workspace.onLoadSupplierClick(); } });
      elements.closeSupplierWorkspace.addEventListener('click', workspace.onCloseSupplierWorkspaceClick);
      for (const tab of ['basic', 'financial', 'payment', 'address']) {
        document.querySelector('#supplier-info-tab-' + tab).addEventListener('click', () => { state.supplierInfoTab = tab; draw(); });
      }
      for (const tab of ['invoices', 'payments']) {
        document.querySelector('#supplier-related-tab-' + tab).addEventListener('click', () => { state.supplierActivityTab = tab; draw(); });
      }
      document.querySelectorAll('[data-tab-panel]').forEach(panel => { panel.hidden = panel.id !== 'tab-suppliers'; panel.classList.toggle('is-active', panel.id === 'tab-suppliers'); });
      document.querySelectorAll('[data-tab-button]').forEach(button => button.classList.toggle('is-active', button.dataset.tabButton === 'suppliers'));
      renderer.renderSupplierOptions();
      draw();
    });
    assert.equal(await page.locator('#supplier-info-empty').innerText(), 'Select a supplier to view accounting details');
    await page.screenshot({ path: '_local/previews/suppliers-empty-1440.png' });
    await page.locator('#supplier-search').fill('B12345678');
    await page.locator('#supplier-search').press('Enter');
    await page.locator('#supplier-info-content-shell').waitFor({ state: 'visible' });
    await page.evaluate(() => renderer.hideNotice());
    assert.equal(await page.locator('#supplier-info-content').getByText('Tax name', { exact: true }).count(), 0);
    await page.locator('#supplier-info-tab-basic').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#supplier-info-tab-financial').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#supplier-info-tab-financial').evaluate(el => el === document.activeElement), true);
    assert.match(await page.locator('#supplier-info-content').innerText(), /Self-employed\s+No/);
    await page.evaluate(() => { window.copied = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copied = value; } } }); Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true }); });
    await page.getByRole('button', { name: 'Copy CIF / NIF', exact: true }).click();
    assert.equal(await page.evaluate(() => copied), 'B12345678');
    assert.equal(await page.locator('#supplier-copy-feedback').innerText(), 'Copied to clipboard');
    await page.locator('.supplier-sync-details summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.supplier-sync-details').getAttribute('open'), '');
    assert.equal(await page.locator('#supplier-last-ezus-sync-by').innerText(), 'accounting.team@example.com');
    await page.keyboard.press('Enter');
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const tab of ['basic', 'financial', 'payment', 'address']) {
        await page.locator('#supplier-info-tab-' + tab).click();
        await page.evaluate(() => document.querySelector('.shell').scrollTo(0, 0));
        const dimensions = await page.evaluate(() => ({ scroll: document.querySelector('.shell').scrollWidth, width: innerWidth, search: getComputedStyle(document.querySelector('.suppliers-rail')).position }));
        assert.ok(dimensions.scroll <= dimensions.width, `${width}/${tab}: page overflow ${JSON.stringify(dimensions)}`);
        assert.equal(dimensions.search, 'static');
        assert.ok(await page.locator('.supplier-rail-search').evaluate(el => el.getBoundingClientRect().height <= 42), 'Search remains a single compact row');
        await page.screenshot({ path: `_local/previews/suppliers-${tab}-${width}.png`, fullPage: true });
        if (width === 390 && ['payment', 'address'].includes(tab)) {
          await page.evaluate(() => document.querySelector('.shell').scrollTo(0, 650));
          await page.screenshot({ path: `_local/previews/suppliers-${tab}-390-scrolled.png` });
        }
      }
    }
    assert.match(await page.locator('#supplier-info-content').innerText(), /Billing address not provided/);
    await page.evaluate(() => { state.supplier.Mailing_City = 'Madrid'; draw(); });
    assert.doesNotMatch(await page.locator('#supplier-info-content').innerText(), /Billing address not provided/);
    await page.locator('#supplier-info-tab-payment').click();
    assert.match(await page.locator('#supplier-info-content').innerText(), /Commission amount \/ rate\s+0/);
    await page.evaluate(() => document.querySelector('.shell').scrollTo(0, 600));
    assert.ok(await page.locator('#search-panel').evaluate(el => el.getBoundingClientRect().bottom < 0), 'Search scrolls out of the way');
    await page.locator('#supplier-search').fill('temporary query');
    await page.locator('#clear-supplier-search').click();
    assert.equal(await page.locator('#supplier-search').inputValue(), '');
    assert.equal(await page.evaluate(() => state.supplier.id), 's1');
    await page.evaluate(() => {
      renderer.renderSearchResults([supplier, { ...supplier, id: 's2', Vendor_Name: 'Second supplier' }], record => { window.selectedMatch = record.id; renderer.hideSearchResults(); });
    });
    await page.locator('[data-supplier-id="s2"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => selectedMatch), 's2');
    await page.evaluate(() => {
      state.supplierInvoices = [{ id: 'i1', Name: 'INV-2026-001', Invoice_Date: '2026-09-28', Total_Amount: 1200, Amount_Paid: 200, Pending_Amount: 1000, Status: 'Approved' }];
      state.supplierPayments = [{ id: 'p1', Name: 'PAY-001', Amount: 200, Payment_Date: '2026-09-28', Status: 'Paid' }];
      draw();
    });
    assert.equal(await page.locator('#supplier-export-invoices').isEnabled(), true);
    assert.equal(await page.locator('#supplier-invoices-table-body tr').count(), 1);
    const totals = await page.locator('#supplier-activity-stats').innerText();
    await page.locator('#supplier-related-tab-invoices').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#supplier-export-payments').isEnabled(), true);
    assert.equal(await page.locator('#supplier-payments-table-wrap').isVisible(), true);
    assert.equal(await page.locator('#supplier-activity-stats').innerText(), totals);
    await page.screenshot({ path: '_local/previews/suppliers-activity-390.png' });
    await page.evaluate(() => { state.supplier.Vendor_Name = 'VeryLongSupplierName'.repeat(15); state.supplierInfoTab = 'basic'; draw(); document.querySelector('.shell').scrollTo(0, 0); });
    assert.ok(await page.evaluate(() => document.querySelector('.shell').scrollWidth <= innerWidth));
    await page.evaluate(() => { state.supplier = { id: 's1', Vendor_Name: 'Minimal supplier' }; state.supplierInfoTab = 'financial'; draw(); });
    assert.match(await page.locator('#supplier-info-content').innerText(), /Not provided/);
    await page.screenshot({ path: '_local/previews/suppliers-incomplete-390.png', fullPage: true });
    await page.locator('#close-supplier-workspace').click();
    assert.equal(await page.evaluate(() => state.supplier), null);
    assert.equal(await page.locator('#clear-supplier-search').isVisible(), false);
    await page.evaluate(() => renderer.hideNotice());
    await page.screenshot({ path: '_local/previews/suppliers-empty-390.png' });
    assert.deepEqual(errors, []);
    console.log('Verified four tabs at 1440/1024/768/390px, empty/incomplete/long data, search and selection, clear actions, keyboard tabs, copy feedback and scrolling. CRM calls mocked.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

