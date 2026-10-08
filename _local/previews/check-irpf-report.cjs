const { chromium } = require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let html = fs.readFileSync('app/widget.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g, (_, file) => '<style>' + fs.readFileSync(path.join('app', file), 'utf8') + '</style>');
    await page.setContent(html);
    await page.evaluate(() => { document.querySelectorAll('[data-tab-panel]').forEach(el => el.hidden = el.id !== 'tab-invoices'); });
    for (const file of ['excel-workbook', 'irpf-report']) { await page.addScriptTag({ path: 'app/scripts/' + file + '.js' }); }
    await page.evaluate(() => {
      window.failReport = false;
      const invoice = { id: '1', Name: 'INV-2026-001', Supplier: { id: '10', name: 'Guide' }, Booking: { id: '20', name: 'BOOKING-001' }, Invoice_Date: '2026-07-01', Invoice_Type: 'Final Invoice', Status: 'Paid', Currency: 'EUR', Invoice_Amount_Excl_VAT: 100, Invoice_Amount_Incl_VAT: 121, IRPF_Amount: 15 };
      AccountingManagerApp.initIrpfReport({ coql: async () => { if (window.failReport) throw new Error('CRM unavailable'); return [invoice, { ...invoice, id: '2', Invoice_Type: 'Credit Note', IRPF_Amount: 5 }, { ...invoice, id: '3', Invoice_Type: 'Proforma' }]; }, getRecord: async () => ({ id: '10', Vendor_Name: 'Guide & Co', CIF_NIF: '00123456A', Country: 'Spain', Is_Self_Employed: true }) });
    });
    await page.click('#irpf-open');
    await page.fill('#irpf-year', '2026'); await page.selectOption('#irpf-quarter', '3');
    assert.equal(await page.inputValue('#irpf-from'), '2026-07-01'); assert.equal(await page.inputValue('#irpf-to'), '2026-09-30');
    await page.click('#irpf-generate'); await page.waitForFunction(() => !document.getElementById('irpf-export').disabled);
    assert.match(await page.textContent('#irpf-message'), /2 invoices · 1 suppliers · IRPF: 10.00 EUR · 1 records to review/);
    assert.equal(await page.locator('#irpf-summary tbody tr').count(), 1);
    const download = page.waitForEvent('download'); await page.click('#irpf-export');
    const file = await download; assert.equal(file.suggestedFilename(), 'IRPF-Spain-2026-07-01-2026-09-30.xlsx'); await file.saveAs('_local/previews/irpf-sample.xlsx');
    await page.locator('#irpf-panel').screenshot({ path: '_local/previews/irpf-report-1440.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#irpf-panel').screenshot({ path: '_local/previews/irpf-report-390.png' });
    assert.equal(await page.evaluate(() => document.getElementById('irpf-panel').scrollWidth <= document.getElementById('irpf-panel').clientWidth + 1), true);
    await page.fill('#irpf-from', '2026-08-01'); assert.equal(await page.locator('#irpf-export').isDisabled(), true);
    await page.evaluate(() => window.failReport = true); await page.click('#irpf-generate'); await page.waitForFunction(() => document.getElementById('irpf-message').textContent === 'CRM unavailable');
    assert.equal(await page.locator('#irpf-export').isDisabled(), true); assert.equal(await page.locator('#irpf-results').isHidden(), true);
    assert.deepEqual(errors, []); console.log('Browser checks passed: preview, quarter, totals, download, mobile, invalidation and API failure.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
