const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
for (const file of ['helpers.js', 'config.js', 'progressive-table.js', 'invoices.js']) {
  vm.runInNewContext(fs.readFileSync('app/scripts/' + file, 'utf8'), { window });
}
const ns = window.AccountingManagerApp;

for (const mode of ['empty', 'error', 'partial']) {
  test('service lookups recover from ' + mode + ' COQL results', async () => {
    const state = ns.createInitialState();
    const calls = [];
    const invoices = ns.createInvoicesModule({ state, helpers: ns.helpers, MODULES: ns.MODULES,
      INVOICE_LINE_FIELDS: { serviceLookup: 'Booking_Service', invoiceLookup: 'Supplier_Invoice', serviceDate: 'Service_Date' },
      INVOICE_LINE_RELATED_FIELDS: ['id', 'Booking_Service'],
      resolveCoqlFields: async (_, fields) => fields,
      sortRecordsByDateDesc: records => records,
      buildCoqlOrEqualsClause: () => '', renderAll() {}, debugError() {},
      loadRecordsByCoql: async (module) => {
        if (module === ns.MODULES.invoiceLines) return [{ id: 'l1', Booking_Service: { id: 's1' } }, { id: 'l2', Booking_Service: 's1' }, { id: 'l3', Booking_Service: { id: 's2', name: 'Existing service' } }];
        if (mode === 'error') throw Error('unavailable');
        return mode === 'partial' ? [{ id: 's1', Name: 'Service one', Product_Description: 'Guided tour' }] : [];
      },
      crm: {
        coql: async () => [{ id: 'l1', Booking_Service: { id: 's1' } },
          { id: 'l2', Booking_Service: 's1' }, { id: 'l3', Booking_Service: { id: 's2', name: 'Existing service' } }],
        getRecord: async (module, id) => { calls.push([module, id]); return { id, Name: 'Service one', Product_Description: id === 's1' ? 'Guided tour' : null }; }
      }
    });
    const lines = await invoices.ensureLinesLoaded('invoice');
    assert.equal(lines[0].Booking_Service.name, 'Service one');
    assert.equal(lines[1].Booking_Service.name, 'Service one');
    assert.equal(lines[2].Booking_Service.name, 'Existing service');
    assert.equal(lines[0]._serviceProductDescription, 'Guided tour');
    assert.equal(lines[1]._serviceProductDescription, 'Guided tour');
    assert.equal(lines[2]._serviceProductDescription, '');
    assert.equal(calls.length, mode === 'partial' ? 1 : 2);
  });
}

function popup(getRecord) {
  const state = ns.createInitialState();
  state.supplierInvoices = [{ id: 'i1', Booking: { id: 'b1' } }, { id: 'i2', Booking: { id: 'b2', name: 'Already loaded' } }];
  const context = { ns, escapeCoqlValue:String, INVOICE_LINE_RELATED_FIELDS:['id'], INVOICE_LINE_FIELDS:{invoiceLookup:'Supplier_Invoice',serviceDate:'Service_Date'}, PAY_ALLOCATION_FIELDS:['id'],
    loadCoqlPage:async(module,fields,query)=>({records:[{id:'line-'+query.whereClause.match(/'([^']+)'/)[1]}],hasMore:false}),
    invoicesModule:{enrichLines:async rows=>rows}, state, helpers: ns.helpers, FIELD_CANDIDATES: ns.FIELD_CANDIDATES,
    MODULES: ns.MODULES, crm: { getRecord }, renderAll() {}, debugError() {},
    ensureInvoiceLinesLoaded: async id => { state.invoiceLinesByInvoiceId[id] = [{ id: 'line-' + id }]; },
    ensureInvoiceAllocationsLoaded: async id => { state.invoiceAllocationsByInvoiceId[id] = []; }
  };
  const source = fs.readFileSync('app/scripts/main.js', 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('  async function openSupplierActivityDetail('), source.indexOf('  function renderAll()')), context);
  return context;
}

test('supplier popup resolves booking ID and preserves related lines', async () => {
  const ctx = popup(async (module, id) => {
    assert.equal(module, 'Deals'); assert.equal(id, 'b1');
    return { id, Deal_Name: 'Booking Madrid' };
  });
  await ctx.openSupplierActivityDetail('invoice', 'i1');
  assert.equal(ctx.state.supplierActivityDetail.record.Booking.name, 'Booking Madrid');
  assert.equal(ctx.state.supplierActivityDetail.lines[0].id, 'line-i1');
  assert.equal(ctx.state.supplierActivityDetail.isLoading, false);
});

test('a delayed booking response cannot overwrite a newly selected invoice', async () => {
  let resolve;
  const ctx = popup(() => new Promise(done => { resolve = done; }));
  const first = ctx.openSupplierActivityDetail('invoice', 'i1');
  await ctx.openSupplierActivityDetail('invoice', 'i2');
  resolve({ Deal_Name: 'Old booking' });
  await first;
  assert.equal(ctx.state.supplierActivityDetail.record.id, 'i2');
  assert.equal(ctx.state.supplierActivityDetail.lines[0].id, 'line-i2');
});

test('booking read failure still displays invoice lines', async () => {
  const ctx = popup(async () => { throw Error('unavailable'); });
  await ctx.openSupplierActivityDetail('invoice', 'i1');
  assert.equal(ctx.state.supplierActivityDetail.lines.length, 1);
  assert.equal(ctx.state.supplierActivityDetail.isLoading, false);
});
