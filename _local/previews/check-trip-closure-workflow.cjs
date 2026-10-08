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
    for (const file of ['config', 'helpers', 'table-columns', 'bookings']) await page.addScriptTag({ path: 'app/scripts/' + file + '.js' });
    await page.evaluate(async () => {
      const ns = AccountingManagerApp;
      const booking = { id: 'b1', Deal_Name: 'Madrid autumn trip', MFSP_Reference: 'MFSP-001', Closure_Status: 'Closure Pending', Sales_Price_inc_Taxes: 1500 };
      const settlements = [{ id: 's1', Name: 'Hotel settlement', Supplier_Name: 'Madrid Hotel', Closure_Review_Status: 'Pending review', Total_Service_Cost: 500 }];
      const state = { bookingClosure: {}, views: { bookings: { records: [booking] } } };
      const elements = {};
      for (const suffix of ['Popup', 'Title', 'Status', 'AccountingRep', 'Content', 'Controls']) {
        elements['bookingClosure' + suffix] = document.getElementById('booking-closure-' + suffix.replace(/[A-Z]/g, (v, i) => (i ? '-' : '') + v.toLowerCase()));
      }
      const success = { data: [{ code: 'SUCCESS' }] };
      const notes = [];
      const module = ns.createBookingsModule({ MODULES: ns.MODULES, FIELD_CANDIDATES: ns.FIELD_CANDIDATES, state, elements, helpers: ns.helpers,
        crm: {
          searchRecord: async () => [booking], getRecord: async () => ({ ...booking }),
          searchRecordPage: async entity => entity === ns.MODULES.settlements ? settlements.map(s => ({ ...s })) : [],
          getRelatedRecords: async () => notes,
          insertRecord: async (entity, data) => { notes.push(data); return success; },
          updateRecord: async (entity, id, data) => { window.writeCount++; await new Promise(resolve => setTimeout(resolve, window.saveDelay || 0)); if (window.failSave) return { data: [{ code: 'ERROR', message: 'Save failed. Try again.' }] }; Object.assign(entity === ns.MODULES.bookings ? booking : settlements[0], data); return success; }
        }, resolveFieldApiByCandidates: async () => 'MFSP_Reference', getCurrentUserEmail: async () => 'accountant@example.com',
        renderAll() {}, debugError() {}, renderer: { showError() {}, showNotice() {} }
      });
      elements.bookingClosureControls.addEventListener('click', module.onClosureStatusClick);
      elements.bookingClosureContent.addEventListener('click', module.onClosureReviewClick);
      elements.bookingClosureControls.addEventListener('keydown', module.onClosurePopoverDismiss);
      document.addEventListener('click', module.onClosurePopoverDismiss);
      elements.bookingClosureControls.addEventListener('input', event => {
        if (event.target.matches('[data-closure-block-reason]')) state.bookingClosure.blockReason = event.target.value;
      });
      window.writeCount = 0;
      window.setScenario = async (status, count = 6, reviewed = 0) => {
        booking.Closure_Status = status;
        if (status === 'Closure Pending' || status === 'Closure In Review' || status === 'Closure Blocked') {
          delete booking.Closure_Completed_By;
          delete booking.Closure_Completed_At;
        }
        settlements.splice(0, settlements.length, ...Array.from({ length: count }, (_, i) => ({ id: 's' + i, Name: 'Settlement ' + i, Closure_Review_Status: i < reviewed ? 'Reviewed' : 'Pending review' })));
        await module.onTripClosureClick('MFSP-001');
      };
      window.testClosure = module;
      await module.onTripClosureClick('MFSP-001');
    });
    const action = name => page.locator('[data-closure-action="' + name + '"]');
    await page.evaluate(() => setScenario('Closure Pending'));
    assert.equal(await action('start').count(), 1);
    assert.equal(await page.locator('[data-closure-block-reason]').count(), 0);
    const height = await page.locator('.booking-closure-workflow').evaluate(el => el.getBoundingClientRect().height);
    assert.ok(height <= 76, 'Compact header height: ' + height);
    assert.equal(await page.locator('.booking-closure-header .booking-closure-workflow').count(), 1);
    assert.equal(await page.locator('#booking-closure-content .booking-closure-workflow').count(), 0);
    await action('open-block').click();
    assert.equal(await page.locator('[data-closure-block-reason]').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.evaluate(() => writeCount), 0);
    await action('block').click();
    assert.match(await page.locator('#closure-block-error').innerText(), /Enter a blocking reason/);
    assert.equal(await page.evaluate(() => writeCount), 0);
    await page.keyboard.press('Escape');
    assert.equal(await action('open-block').evaluate(el => el === document.activeElement), true);
    await action('open-block').click();
    await action('cancel-block').click();
    assert.equal(await page.locator('#closure-block-popover').count(), 0);
    await action('start').click();
    await page.waitForFunction(() => document.getElementById('booking-closure-status').textContent === 'Closure In Review');
    assert.equal(await action('start').count(), 0);
    assert.equal(await action('complete').isDisabled(), true);
    assert.equal(await action('complete').getAttribute('aria-describedby'), 'closure-complete-help');
    await page.evaluate(() => setScenario('Closure In Review', 6, 6));
    assert.equal(await action('complete').isEnabled(), true);
    assert.equal(await page.locator('.closure-progress-track.is-ready').count(), 1);
    await page.evaluate(() => { window.failSave = true; });
    await action('complete').click();
    await page.waitForSelector('.booking-closure-error');
    assert.equal(await page.locator('#booking-closure-status').innerText(), 'Closure In Review');
    await page.evaluate(() => { window.failSave = false; });
    await action('open-block').click();
    await page.fill('[data-closure-block-reason]', 'Invoice needs correction');
    await page.evaluate(() => { window.failSave = true; window.saveDelay = 150; });
    await action('block').click();
    await page.waitForSelector('#closure-block-error');
    assert.equal(await page.locator('#booking-closure-status').innerText(), 'Closure In Review');
    assert.equal(await page.locator('[data-closure-block-reason]').inputValue(), 'Invoice needs correction');
    await page.evaluate(() => { window.failSave = false; window.saveDelay = 500; });
    await action('block').click();
    assert.equal(await action('block').isDisabled(), true);
    assert.match(await action('block').innerText(), /Saving/);
    await page.waitForFunction(() => document.getElementById('booking-closure-status').textContent === 'Closure Blocked');
    assert.equal(await action('complete').count(), 0);
    await page.evaluate(() => testClosure.onClosureRefreshClick());
    assert.match(await page.locator('.closure-blocked-reason').innerText(), /Invoice needs correction/);
    await action('start').click();
    await page.waitForFunction(() => document.getElementById('booking-closure-status').textContent === 'Closure In Review');
    await action('complete').click();
    await page.waitForFunction(() => document.getElementById('booking-closure-status').textContent === 'Closure Completed');
    assert.equal(await page.locator('[data-booking-closure-review-settlement-id]').first().isDisabled(), true);
    assert.match(await page.locator('.closure-workflow-audit').innerText(), /accountant@example.com/);
    assert.equal(await action('open-block').count(), 0);
    await page.evaluate(() => { window.saveDelay = 0; });
    for (const width of [1440, 800, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [status, reviewed] of [['Closure Pending', 0], ['Closure In Review', 3], ['Closure Blocked', 3], ['Closure Completed', 6], ['Closure Reopened', 6]]) {
        await page.evaluate(([status, reviewed]) => setScenario(status, 6, reviewed), [status, reviewed]);
        const size = await page.locator('.booking-closure-workflow').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
        assert.ok(size.scroll <= size.width + 1, width + ' ' + status + JSON.stringify(size));
        if ([1440, 390].includes(width)) await page.screenshot({ path: '_local/previews/trip-closure-' + status.replaceAll(' ', '-').toLowerCase() + '-' + width + '.png' });
      }
      await page.evaluate(() => setScenario('Closure Pending'));
      await action('open-block').click();
      const bounds = await page.locator('#closure-block-popover').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'Popover fits at ' + width);
      await page.screenshot({ path: '_local/previews/trip-closure-popover-' + width + '.png' });
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => setScenario('Closure In Review', 0, 0));
    assert.equal(await action('complete').isDisabled(), true);
    assert.equal(await page.locator('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
    assert.match(await page.locator('#closure-complete-help').innerText(), /No active settlements/);
    assert.deepEqual(errors, []);
    console.log('Trip closure workflow passed in desktop and mobile browser previews.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
