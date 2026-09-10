const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Bookings DOM references resolve against the shipped widget HTML', () => {
  const html = fs.readFileSync('app/widget.html', 'utf8');
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  const window = {};
  const document = {
    getElementById: id => ids.has(id) ? { id } : null,
    querySelectorAll: () => []
  };
  vm.runInNewContext(fs.readFileSync('app/scripts/dom.js', 'utf8'), { window, document });
  const elements = window.AccountingManagerApp.getElements();
  for (const key of ['bookingsTableHead', 'bookingsTableBody', 'bookingsTableWrap', 'bookingsLoad', 'bookingsFilterMfsp']) {
    assert.ok(elements[key], key + ' must exist in widget.html');
  }
  assert.match(html, /class="results-table bookings-results-table">\s*<thead id="bookings-table-head">/);
});
