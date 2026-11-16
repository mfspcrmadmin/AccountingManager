const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('app/scripts/invoice-registration.js', 'utf8');
const key = '11111111-1111-4111-8111-111111111111';
const request = { supplier_id: '123', invoice: { Name: 'INV-1' }, allocations: [{ settlement_id: '456', amount: 116 }] };
const answer = result => ({ details: { output: JSON.stringify(result) } });
const complete = { success: true, retryable: false, invoice_id: '789', message: 'Saved' };
function setup(overrides = {}, storage = new Map()) {
  const window = {};
  vm.runInNewContext(code, { window });
  const calls = [];
  const deps = {
    storage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    randomUUID: () => key,
    getInvoice: async id => ({id, Registration_Key:key}),
    executeFunction: async (name, args) => { calls.push({ name, args }); return answer(complete); },
    uploadFile: async () => ({ data: [{ status: 'success', details: { id: 'zfs-file' } }] }),
    refresh: async () => {}, ...overrides
  };
  return { client: window.AccountingManagerApp.createInvoiceRegistration(deps), calls, storage, deps, cents: window.AccountingManagerApp.invoiceRegistrationCents };
}
test('uploads the document first and persists the immutable request before creating', async () => {
  const context = setup();
  const execute = context.deps.executeFunction;
  context.deps.executeFunction = async (...args) => {
    assert.equal(context.client.pending('123').operationKey, key);
    return execute(...args);
  };
  await context.client.run('123', request, { name: 'invoice.pdf' });
  assert.equal(context.calls[0].name, 'supplierinvoice_register');
  assert.equal(JSON.parse(context.calls[0].args.requestJson).file_id, 'zfs-file');
  assert.equal(context.client.pending('123'), null);
});
test('lost response survives a reload and retries the same key and request', async () => {
  const context = setup({ executeFunction: async () => { throw Error('Network lost after create'); } });
  await assert.rejects(context.client.run('123', request), /Network lost/);
  const journal = context.client.pending('123');
  const reloaded = setup({}, context.storage);
  await reloaded.client.run('123', { ...request, invoice: { Name: 'DO-NOT-USE' } });
  assert.equal(reloaded.calls[0].args.operationKey, journal.operationKey);
  assert.equal(reloaded.calls[0].args.requestJson, journal.requestJson);
});
test('double submit starts only one request', async () => {
  let release, calls = 0;
  const context = setup({ executeFunction: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const first = context.client.run('123', request);
  const second = await context.client.run('123', request);
  assert.equal(second.busy, true);
  release(answer(complete));
  await first;
  assert.equal(calls, 1);
});
test('partial creation preserves ID and retries without uploading the file again', async () => {
  let uploads = 0;
  const context = setup({
    uploadFile: async () => { uploads++; return { data: [{ code: 'SUCCESS', details: { id: 'file' } }] }; },
    executeFunction: async () => answer({ success: false, retryable: true, invoice_id: '789', message: 'Allocation rejected' })
  });
  await context.client.run('123', request, {});
  assert.equal(context.client.pending('123').invoiceId, '789');
  await context.client.run('123', null, {});
  assert.equal(uploads, 1);
});
test('failed refresh retains a confirmed invoice ID for recovery', async () => {
  const context = setup({ refresh: async () => { throw Error('Read failed'); } });
  await assert.rejects(context.client.run('123', request), /Read failed/);
  assert.equal(context.client.pending('123').invoiceId, '789');
});
test('missing, unreadable or replaced confirmed invoices cannot trigger another registration', async () => {
  for (const mode of ['missing','unreadable','replaced']) {
    const first=setup({refresh:async()=>{throw Error('Refresh failed');}});
    await assert.rejects(first.client.run('123',request));
    const retry=setup({getInvoice:async()=>{
      if(mode==='unreadable')throw Error('Read failed');
      return mode==='missing'?null:{id:'789',Registration_Key:'another-operation'};
    }},first.storage);
    await assert.rejects(retry.client.run('123',request));
    assert.equal(retry.calls.length,0);assert.equal(retry.client.pending('123').invoiceId,'789');
  }
});
test('confirmed invoice recovery uses its ID and preserves the immutable request', async () => {
  const first=setup({refresh:async()=>{throw Error('Refresh failed');}});
  await assert.rejects(first.client.run('123',request));
  let reads=0;
  const retry=setup({getInvoice:async id=>{assert.equal(id,'789');reads++;return{id,Registration_Key:key};}},first.storage);
  await retry.client.run('123',null);
  assert.equal(reads,1);assert.equal(retry.calls[0].args.requestJson,JSON.stringify(request));
});
test('explicit pre-create rejection unlocks editing; missing IDs never count as success', async () => {
  const context = setup({ executeFunction: async () => answer({ success: false, retryable: false, invoice_id: '', message: 'Wrong supplier' }) });
  await context.client.run('123', request);
  assert.equal(context.client.pending('123'), null);
  context.deps.executeFunction = async () => answer({ success: true, retryable: false });
  await assert.rejects(context.client.run('123', request), /invoice ID/);
  assert.ok(context.client.pending('123'));
});
test('unavailable durable storage and upload rejections prevent invoice requests', async () => {
  let writes = 0;
  const context = setup({ storage: { getItem: () => null, setItem: () => { throw Error('Storage blocked'); } }, executeFunction: async () => { writes++; } });
  await assert.rejects(context.client.run('123', request), /Storage blocked/);
  const uploadFailure = setup({ uploadFile: async () => ({ data: [{ status: 'error' }] }), executeFunction: async () => { writes++; } });
  await assert.rejects(uploadFailure.client.run('123', request, {}), /upload/);
  assert.equal(writes, 0);
});
test('money validation rejects negatives, non-finite amounts and fractional cents', () => {
  const { cents } = setup();
  assert.equal(cents('116.20'), 11620);
  for (const invalid of [-1, Infinity, 'text', 1.001]) { assert.throws(() => cents(invalid)); }
});

test('a corrupted or foreign-supplier journal fails closed', async () => {
  const context = setup();
  context.storage.set('accounting-manager:supplier-invoice:v1:123', JSON.stringify({
    version: 1, operationKey: key, requestJson: JSON.stringify({ ...request, supplier_id: '999' })
  }));
  await assert.rejects(context.client.run('123', request), /cannot be read/);
  assert.equal(context.calls.length, 0);
  assert.equal(context.storage.size, 1);
});

test('two tabs serialize access and retain the first pending operation', async () => {
  let tail = Promise.resolve(), release, entered;
  const firstEntered = new Promise(resolve => { entered = resolve; });
  const withLock = (_, execute) => {
    const result = tail.then(execute);
    tail = result.catch(() => {});
    return result;
  };
  const first = setup({ withLock, executeFunction: () => { entered(); return new Promise(resolve => { release = resolve; }); } });
  const second = setup({ withLock }, first.storage);
  const saving = first.client.run('123', request);
  await firstEntered;
  const retry = second.client.run('123', request);
  assert.equal(second.calls.length, 0);
  release(answer({ success: false, retryable: true, invoice_id: '789', message: 'Pending totals' }));
  await saving;
  await retry;
  assert.equal(second.calls[0].args.operationKey, key);
  assert.equal(second.client.pending('123'), null);
});

test('discard preserves recovery after a lost reply and resumes discard instead of registration',async()=>{
 const f=setup({executeFunction:async()=>answer({success:false,retryable:true,invoice_id:'789',message:'Pending'})});await f.client.run('123',request);
 f.deps.executeFunction=async()=>{throw Error('Lost discard reply');};await assert.rejects(f.client.discard('123'),/Lost discard/);
 assert.equal(f.client.pending('123').discardRequested,true);
 f.deps.executeFunction=async(name,args)=>{assert.equal(JSON.parse(args.requestJson).operation,'discard_registration');assert.equal(JSON.parse(args.requestJson).original_request,JSON.stringify(request));return answer({...complete,phase:'discarded'});};
 await f.client.run('123',request);assert.equal(f.client.pending('123'),null);
});
test('discard rejects ambiguous success and retains its original request',async()=>{
 const f=setup({refresh:async()=>{throw Error('refresh');}});await assert.rejects(f.client.run('123',request));
 await assert.rejects(f.client.discard('123'),/did not confirm.*discarded/);assert.equal(f.client.pending('123').requestJson,JSON.stringify(request));
});
test('confirmed discard clears recovery even when display refresh fails; explicit validation rejection permits resume',async()=>{
 const f=setup({executeFunction:async()=>answer({success:false,retryable:true,invoice_id:'789',message:'Pending'})});await f.client.run('123',request);
 f.deps.executeFunction=async()=>answer({success:false,retryable:true,phase:'validate',invoice_id:'789',message:'Already complete'});
 await f.client.discard('123');assert.equal(f.client.pending('123').discardRequested,undefined);
 f.deps.executeFunction=async()=>answer({...complete,phase:'discarded'});f.deps.refresh=async()=>{throw Error('Refresh');};
 const result=await f.client.discard('123');assert.equal(result.refreshRequired,true);assert.equal(f.client.pending('123'),null);
});
