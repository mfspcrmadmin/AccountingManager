const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('app/scripts/main.js', 'utf8');
const bootstrap = source.slice(source.indexOf('  async function bootstrap() {'), source.indexOf('  async function getModuleFields('));

function setup(resize, init = async () => {}) {
  const errors = [], warnings = [], modes = [];
  let supplierLoads = 0;
  const ZOHO = { embeddedApp: { on() {}, init }, CRM: { UI: { Resize: resize } } };
  const context = vm.createContext({ global: { ZOHO }, ZOHO, state: {},
    loadInitialTab() {}, bootstrapRecentSuppliers: async () => { supplierLoads++; },
    debugWarn: (...args) => warnings.push(args), debugError() {},
    renderer: { showError: message => errors.push(message), setMode: mode => modes.push(mode) }
  });
  vm.runInContext(bootstrap, context);
  return { context, errors, warnings, modes, supplierLoads: () => supplierLoads };
}

for (const kind of ['success', 'throws', 'rejects', 'unanswered', 'missing']) {
  test('optional panel resize does not block initialization: ' + kind, async () => {
    const failure = new Error('Host panel unavailable');
    const resize = { success: async () => {}, throws: () => { throw failure; },
      rejects: async () => { throw failure; }, unanswered: () => new Promise(() => {}), missing: undefined }[kind];
    const fixture = setup(resize);
    await fixture.context.bootstrap();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.context.state.zohoReady, true);
    assert.equal(fixture.supplierLoads(), 1);
    assert.deepEqual(fixture.errors, []);
    assert.deepEqual(fixture.modes, ['Connected to CRM']);
    assert.equal(fixture.warnings.length, ['throws', 'rejects'].includes(kind) ? 1 : 0);
  });
}

test('actual SDK initialization failures still display an error', async () => {
  const fixture = setup(undefined, async () => { throw new Error('SDK unavailable'); });
  await fixture.context.bootstrap();
  assert.equal(fixture.errors.length, 1);
  assert.equal(fixture.supplierLoads(), 0);
  assert.notEqual(fixture.context.state.zohoReady, true);
});
