const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(preferences = {}) {
  const elements = new Map();
  const previews = [], requestedFiles = [], revokedUrls = [];
  const document = {
    body: { appendChild(modal) { previews.push(modal); } },
    createElement() {
      const children = {};
      return { querySelector(selector) { return children[selector] || (children[selector] = {}); }, remove() { this.removed = true; } };
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        value: '', innerHTML: '', listeners: {},
        classList: { toggle() {}, add() {}, remove() {} },
        addEventListener(name, handler) { this.listeners[name] = handler; },
        querySelectorAll() { return []; }, setAttribute() {}
      });
      return elements.get(id);
    },
    querySelectorAll() { return []; }, querySelector() { return null; }, addEventListener() {}
  };
  const frames = [];
  const window = {
    ZOHO: { CRM: { API: { getFile(request) { requestedFiles.push(request.id); return Promise.resolve(new Blob(['PDF'], { type: 'application/pdf' })); } } } },
    URL: { createObjectURL() { return 'blob:preview'; }, revokeObjectURL(url) { revokedUrls.push(url); } },
    addEventListener() {}, cancelAnimationFrame() {},
    requestAnimationFrame(fn) { frames.push(fn); },
    localStorage: { getItem() { return JSON.stringify(preferences); } }
  };
  const context = { window, document, Intl, Blob };
  vm.runInNewContext(fs.readFileSync('app/scripts/invoice-name.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('app/scripts/table-columns.js', 'utf8'), context);
  const source = fs.readFileSync('app/scripts/operations.js', 'utf8').replace('  controls();', `
    global.testCards = {
      render: function(data) { selectedType = 'card-purchases'; records = data; render(); },
      sortValue: sortValue, files: files
    };
  `);
  vm.runInNewContext(source, context);
  return { app: window.testCards, element: document.getElementById, frames, previews, requestedFiles, revokedUrls };
}

test('saved column visibility and order apply to both headers and rows and schedule resizing', () => {
  const fixture = setup({ cardPurchases: { order: ['Supporting_Documents', 'Supplier'], visible: ['Supporting_Documents', 'Supplier'], widths: { Supplier: 280 } } });
  fixture.app.render([{ id: '1', Supplier: { name: 'Hotel' }, Supplier_Code: 'SUP-1', Supporting_Documents: [{ File_Name: '<receipt>.pdf', $file_id: 'file' }] }]);
  const head = fixture.element('operations-table-head').innerHTML;
  const body = fixture.element('operations-table-body').innerHTML;
  assert.ok(head.indexOf('Supporting documents') < head.indexOf('Supplier'));
  assert.match(head, /data-table-columns-button="cardPurchases"/);
  assert.match(head, /data-resizable-column="Supplier"/);
  assert.doesNotMatch(head, /data-card-purchase-sort="Amount"/);
  assert.ok(body.indexOf('&lt;receipt&gt;.pdf') < body.indexOf('Hotel'));
  assert.match(body, /data-card-purchase-file="0"/);
  assert.match(body, /SUP-1/);
  assert.equal((head.match(/<th\b/g) || []).length, (body.match(/<td\b/g) || []).length);
  assert.equal(fixture.frames.length, 1);
});

test('clicking a supporting document fetches its file and opens a closable PDF preview', async () => {
  const fixture = setup();
  fixture.app.render([{ id: 'purchase', Supporting_Documents: [{ File_Name: 'Receipt.pdf', id: 'relation', $file_id: 'file-id' }] }]);
  fixture.element('operations-table-body').listeners.click({ target: { closest(selector) {
    if (selector === '[data-card-purchase-id]') return { getAttribute() { return 'purchase'; } };
    if (selector === '[data-card-purchase-file]') return { getAttribute() { return '0'; } };
    return null;
  } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fixture.requestedFiles, ['file-id']);
  assert.equal(fixture.previews.length, 1);
  const modal = fixture.previews[0];
  assert.match(modal.querySelector('.operations-file-preview-content').innerHTML, /<iframe src="blob:preview" title="Receipt.pdf"/);
  modal.querySelector('button').onclick();
  assert.equal(modal.removed, true);
  assert.deepEqual(fixture.revokedUrls, ['blob:preview']);
});

test('all data columns are sortable and supporting documents is last by default', () => {
  const fixture = setup();
  fixture.app.render([{ id: '1', Amount: 20 }, { id: '2', Amount: 3 }]);
  const head = fixture.element('operations-table-head').innerHTML;
  assert.equal((head.match(/data-card-purchase-sort=/g) || []).length, 11);
  assert.ok(head.indexOf('Supporting documents') > head.indexOf('Payment record'));
  const sort = fixture.element('operations-table-head').listeners.click;
  sort({ target: { closest() { return { getAttribute() { return 'Amount'; } }; } } });
  let body = fixture.element('operations-table-body').innerHTML;
  assert.ok(body.indexOf('data-card-purchase-id="2"') < body.indexOf('data-card-purchase-id="1"'));
  sort({ target: { closest() { return { getAttribute() { return 'Amount'; } }; } } });
  body = fixture.element('operations-table-body').innerHTML;
  assert.ok(body.indexOf('data-card-purchase-id="1"') < body.indexOf('data-card-purchase-id="2"'));
  assert.equal(fixture.app.sortValue({ Supporting_Documents: [{ File_Name: 'Receipt.pdf' }] }, 'Supporting_Documents'), 'receipt.pdf');
  assert.equal(fixture.app.files([{ id: 'record-id', $file_id: 'download-id' }])[0].id, 'download-id');
});
