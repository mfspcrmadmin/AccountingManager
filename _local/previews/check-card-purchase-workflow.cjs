const { chromium } = require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 850 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let html = fs.readFileSync('app/widget.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g, (_, file) => '<style>' + fs.readFileSync(path.join('app', file), 'utf8') + '</style>');
    await page.route('http://cards.test/', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('http://cards.test/');
    await page.evaluate(() => {
      window.purchase = { id: '1', Name: 'CARD-1', Amount: 121, Transaction_Date: '2026-09-10', Transaction_Type: 'Purchase', Supplier: { id: '10', name: 'Supplier' }, Booking: { id: '20', name: 'Booking' }, Supplier_Code: 'SUP', MFSP_Reference: 'MFSP', Card_Payment_Account: { id: '40', name: 'Own card' }, Boking_Service: { id: '30' } };
      window.services = ['30', '31'].map((id, index) => ({ id, Name: 'Service ' + id, Supplier: purchase.Supplier, Booking: purchase.Booking, Product_Description: index ? 'New service <details>' : 'Original service', Service_Date: '2026-09-10', Total_Purchase_Price: index ? 121 : 0 }));
      window.writes = []; window.failSave = false;
      window.ZOHO = { CRM: { API: {
        getRecord: async ({ Entity, RecordID }) => ({ data: [Entity === 'Card_Purchases' ? purchase : Entity === 'Booking_Services' ? services.find(s => s.id === RecordID) : Entity === 'Supplier_Settlements' ? { id: '50', Name: 'Settlement', Supplier: purchase.Supplier, Booking: purchase.Booking } : { id: '40', Name: 'Own card' }] }),
        searchRecord: async ({ Entity }) => ({ data: Entity === 'Booking_Services' ? services : Entity === 'Supplier_Settlements' ? [{ id: '50', Name: 'Settlement', Supplier: purchase.Supplier, Booking: purchase.Booking }] : [] }),
        updateRecord: async args => { if (failSave && args.APIData.Boking_Service) return { data: [{ code: 'ERROR', message: 'Save failed' }] }; writes.push(args); Object.assign(purchase, args.APIData); return { data: [{ code: 'SUCCESS' }] }; },
        insertRecord: async args => { writes.push(args); return { data: [{ code: 'SUCCESS', details: { id: args.Entity === 'Supplier_Invoices' ? '60' : '61' } }] }; },
        getAllRecords: async () => ({ data: [purchase] })
      }, FUNCTIONS: { execute: async (name, args) => { writes.push({ functionName: name, ...args }); return { details: { output: JSON.stringify({ success: true, payment_id: '70' }) } }; } } } };
      window.AccountingManagerApp = {
        loadOwnPaymentAccountChoices: async (api, preferred) => ({ accounts: [{ id: '40', Name: 'Own card' }], defaultAccountId: preferred }),
        isOwnQuickPaymentAccount: () => true,
        refreshQuickInvoiceSettlements: async () => ''
      };
      document.querySelector('#tab-operations').hidden = false;
    });
    for (const file of ['invoice-name.js', 'card-purchase-settlements.js', 'card-purchase-services.js']) await page.addScriptTag({ path: 'app/scripts/' + file });
    await page.addScriptTag({ content: fs.readFileSync('app/scripts/operations.js', 'utf8').replace('  controls();', '  global.openCardTest = openWorkflow; controls();') });
    const field = id => page.locator('#card-purchase-' + id);
    await page.evaluate(() => openCardTest(purchase, 'invoice'));
    await page.waitForFunction(() => document.querySelector('#card-purchase-reference').value === 'TICK-MFSP-SUP-1');
    assert.equal(await field('date').inputValue(), '2026-09-10');
    assert.equal(await field('amount').inputValue(), '121.00');
    assert.equal(await field('vat').inputValue(), '0');
    assert.equal(await field('invoice-type').inputValue(), 'Tickets');
    assert.equal(await field('settlement').inputValue(), '50');
    await field('reference').fill('MANUAL-INV');
    await field('service-edit').click();
    await page.locator('[data-card-service-choice="31"]').check();
    await page.locator('#card-purchase-workflow-form [data-card-purchase-close]').click();
    await page.waitForTimeout(260);
    await page.evaluate(() => openCardTest(purchase, 'invoice'));
    await page.waitForFunction(() => document.querySelector('#card-purchase-reference').value === 'TICK-MFSP-SUP-1');
    assert.equal(await field('workflow-submit').isDisabled(), false);
    assert.equal(await page.evaluate(() => purchase.Boking_Service.id), '30');
    await field('reference').fill('MANUAL-INV');
    await field('service-edit').click();
    await page.locator('[data-card-service-choice="31"]').check();
    assert.equal(await field('workflow-submit').isDisabled(), true);
    await page.locator('[data-card-service-cancel]').click();
    assert.match(await field('workflow-service').innerText(), /Original service/);
    assert.equal(await field('reference').inputValue(), 'MANUAL-INV');
    assert.equal(await page.evaluate(() => writes.length), 0);
    await field('service-edit').click();
    await page.locator('[data-card-service-choice="31"]').check();
    await page.evaluate(() => { failSave = true; });
    await page.locator('[data-card-service-save]').click();
    await page.waitForFunction(() => document.querySelector('#card-purchase-service-message').textContent === 'Save failed');
    assert.equal(await page.locator('[data-card-service-choice="31"]').isChecked(), true);
    await page.evaluate(() => { failSave = false; });
    await page.locator('[data-card-service-save]').click();
    await page.waitForFunction(() => document.querySelector('#card-purchase-service-message').textContent === 'Associated service updated.');
    assert.match(await field('workflow-service').innerText(), /New service <details>/);
    assert.equal(await field('reference').inputValue(), 'MANUAL-INV');
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.screenshot({ path: `_local/previews/card-purchase-invoice-${width}.png` });
      assert.equal(await page.evaluate(() => {
        const card = document.querySelector('#card-purchase-workflow-modal .card-purchase-workflow-card');
        return card.scrollWidth <= card.clientWidth;
      }), true);
    }
    await field('amount').fill('0');
    await field('workflow-submit').click();
    await page.waitForFunction(() => document.querySelector('#card-purchase-workflow-message').textContent.includes('positive amount'));
    assert.equal(await page.evaluate(() => writes.filter(w => w.Entity === 'Supplier_Invoices').length), 0);
    await field('amount').fill('121');
    await field('vat').fill('21');
    await field('workflow-submit').click();
    await page.waitForFunction(() => !document.querySelector('#card-purchase-workflow-payment-fields').hidden);
    assert.equal(await field('payment-reference').inputValue(), 'CARD-PAY-MANUAL-INV');
    assert.equal(await field('payment-date').inputValue(), '2026-09-10');
    assert.equal(await field('payment-account').inputValue(), '40');
    assert.equal(await field('service-edit').isVisible(), false);
    const created = await page.evaluate(() => writes.find(w => w.Entity === 'Supplier_Invoices').APIData[0]);
    assert.equal(created.Invoice_Amount_Excl_VAT, 100);
    assert.equal(created.VAT_Amount, 21);
    assert.equal(await page.evaluate(() => writes.find(w => w.Entity === 'Supplier_Invoice_Lines').APIData[0].Booking_Service.id), '31');
    await page.screenshot({ path: '_local/previews/card-purchase-payment-390.png' });
    await page.setViewportSize({ width: 1440, height: 850 });
    await page.screenshot({ path: '_local/previews/card-purchase-payment-1440.png' });
    await field('payment-reference').fill('');
    await field('workflow-submit').click();
    await page.waitForFunction(() => document.querySelector('#card-purchase-workflow-message').textContent.includes('payment reference'));
    await field('payment-reference').fill('CARD-PAY-EDITED');
    await field('payment-date').fill('2026-09-11');
    await field('workflow-submit').click();
    await page.waitForFunction(() => purchase.Accounting_Status === 'Purchase recorded');
    const payment = await page.evaluate(() => JSON.parse(JSON.parse(writes.find(w => w.functionName).arguments).paymentDataString));
    assert.equal(payment.Name, 'CARD-PAY-EDITED');
    assert.equal(payment.Payment_Date, '2026-09-11');
    assert.equal(payment.Payment_Account, '40');
    await page.waitForTimeout(950);
    await page.evaluate(() => openCardTest(purchase, 'review'));
    assert.equal(await field('workflow-submit').isVisible(), false);
    assert.equal(await field('service-edit').isVisible(), false);
    assert.equal(await field('review-notes').isDisabled(), true);
    await page.evaluate(() => openCardTest({ ...purchase, Accounting_Status: 'Pending invoice', Vendor_Invoice: null, Vendor_Payment: null, Invoice_Number: '', Transaction_Type: 'Refund' }, 'invoice'));
    await page.waitForFunction(() => document.querySelector('#card-purchase-reference').value === 'CRED-MFSP-SUP-1');
    assert.equal(await field('invoice-type').inputValue(), 'Credit Note');
    assert.equal(await field('invoice-type').isDisabled(), true);
    assert.equal(await field('date').inputValue(), '2026-09-10');
    await page.evaluate(() => openCardTest({ ...purchase, Accounting_Status: 'Pending refund record', Vendor_Payment: null, Transaction_Type: 'Refund' }, 'payment'));
    assert.equal(await field('payment-reference').inputValue(), 'CARD-REFUND-CARD-1');
    assert.deepEqual(errors, []);
    console.log('Verified invoice/payment defaults, validation, payloads, service edit/cancel/failure/retry, read-only mode and responsive layouts. CRM mocked; no live writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
