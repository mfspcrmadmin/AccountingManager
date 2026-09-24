const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const window = {};
  for (const file of ['prepayment-proof.js', 'prepayments.js']) vm.runInNewContext(fs.readFileSync('app/scripts/' + file, 'utf8'), { window, Intl });
  const f = { window, calls: [], record: { id: '1', Name: 'Deposit', Bank_Receipt_Needed: true, Payment_Proof: [{ id: 'existing', File_Id__s: 'old', File_Name__s: 'original.pdf' }] } };
  let nextId = 0;
  f.api = {
    getRecord: async args => { f.calls.push(['read', args]); if (f.readError) throw Error('Read denied'); return { data: [structuredClone(f.record)] }; },
    uploadFile: async args => {
      f.calls.push(['upload', args]);
      if (f.uploadError) throw Error('Upload failed');
      return { data: [{ code: 'SUCCESS', details: f.noId ? {} : { id: 'upload-' + (++nextId) } }] };
    },
    updateRecord: async args => {
      f.calls.push(['update', args]);
      if (f.updateError) return { data: [{ code: 'NO_PERMISSION', message: 'Write denied' }] };
      if (!f.ignoreWrite) f.record.Payment_Proof.push(...args.APIData.Payment_Proof.map(file => ({ id: 'link-' + file, File_Id__s: file, File_Name__s: 'receipt.pdf' })));
      if (f.timeout) throw Error('Timeout');
      return { data: [{ code: 'SUCCESS' }] };
    }
  };
  f.service = window.AccountingManagerApp.createPrepaymentProofService(f.api, { wait: async () => {} });
  f.queue = names => names.map(name => ({ file: { name, size: 1024, lastModified: 1 } }));
  return f;
}

test('payment proof column offers Attach only when receipt is needed, in both table views', () => {
  const f = fixture();
  for (const showRequest of [true, false]) {
    const html = flag => f.window.AccountingManagerApp.prepaymentsModel.paymentTable([{ payment: { id: '1', Name: '<Deposit>', Bank_Receipt_Needed: flag }, group: {} }], '2026-09-17', showRequest);
    assert.match(html(true), /data-prepayment-proof="1"/);
    const headers = [...html(true).matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(match => match[1]);
    const cells = [...html(true).split('<tbody>')[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(match => match[1]);
    assert.match(cells[headers.indexOf('Payment proof')], /data-prepayment-proof=/);
    assert.doesNotMatch(cells[headers.indexOf('Bank Receipt Needed')], /data-prepayment-proof=/);
    assert.match(html(true), /Attach payment proof for &lt;Deposit&gt;/);
    assert.doesNotMatch(html(false), /data-prepayment-proof=/);
    assert.doesNotMatch(html(undefined), /data-prepayment-proof=/);
  }
});

test('uploads multiple files, appends to Payment Proof and preserves existing files and bank flags', async () => {
  const f = fixture(), queue = f.queue(['one.pdf', 'two.png']), progress = [];
  const record = await f.service.save('1', queue, r => progress.push(r));
  assert.equal(record.Payment_Proof.length, 3);
  assert.equal(record.Payment_Proof[0].id, 'existing');
  assert.ok(queue.every(item => item.saved));
  assert.equal(progress.length, 2);
  const updates = f.calls.filter(([type]) => type === 'update').map(([, args]) => JSON.parse(JSON.stringify(args)));
  assert.deepEqual(updates[0], { Entity: 'Prepayments', APIData: { id: '1', Payment_Proof: ['upload-1'] }, Trigger: [] });
  assert.equal(f.calls.find(([type]) => type === 'upload')[1].FILE.file, queue[0].file);
});

test('saved proofs preview in the widget and show an edit icon only when needed', () => {
  const f = fixture();
  for (const showRequest of [true, false]) {
    for (const needed of [true, false]) {
      const html = f.window.AccountingManagerApp.prepaymentsModel.paymentTable([{ payment: { id: '1', Name: 'Deposit', Bank_Receipt_Needed: needed, Payment_Proof: [{ File_Name__s: '<receipt>.pdf', File_Id__s: 'zfs' }] }, group: {} }], '2026-09-17', showRequest);
      assert.match(html, /data-prepayment-proof-preview="1" data-proof-index="0"/);
      assert.match(html, /&lt;receipt&gt;.pdf/);
      assert.doesNotMatch(html, /open in CRM|>Attach<|<strong>Proof/);
      if (needed) assert.match(html, /aria-label="Edit payment proof for Deposit"/);
      else assert.doesNotMatch(html, /data-prepayment-proof="/);
    }
  }
});

test('editing removes only the selected linked attachment and verifies the result', async () => {
  const f = fixture();
  const selected = { attachment_Id: 'remove-me', file_Name: 'receipt.pdf' };
  f.record.Payment_Proof.push(selected);
  f.api.updateRecord = async args => {
    f.calls.push(['update', args]);
    assert.deepEqual(JSON.parse(JSON.stringify(args)), { Entity: 'Prepayments', APIData: { id: '1', Payment_Proof: [{ attachment_id: 'remove-me', _delete: null }] }, Trigger: [] });
    f.record.Payment_Proof = f.record.Payment_Proof.filter(file => file.attachment_Id !== 'remove-me');
    return { data: [{ code: 'SUCCESS' }] };
  };
  const record = await f.service.remove('1', selected);
  assert.equal(record.Payment_Proof.length, 1);
  assert.equal(record.Payment_Proof[0].id, 'existing');
  await f.service.remove('1', selected);
  assert.equal(f.calls.filter(([kind]) => kind === 'update').length, 1);
});

test('attachment removal fails on missing IDs, unmarked receipts and ignored writes', async () => {
  const f = fixture();
  await assert.rejects(f.service.remove('1', { file_Id: 'zfs' }), /attachment ID/);
  f.record.Bank_Receipt_Needed = false;
  await assert.rejects(f.service.remove('1', { id: 'existing' }), /no longer marked/);
  f.record.Bank_Receipt_Needed = true;
  f.api.updateRecord = async () => ({ data: [{ code: 'SUCCESS' }] });
  await assert.rejects(f.service.remove('1', { id: 'existing' }), /not confirmed the removal/);
});

test('size, count, read errors and an unmarked receipt block uploads', async () => {
  for (const change of [
    f => { f.record.Bank_Receipt_Needed = false; },
    f => { f.readError = true; },
    f => { f.record.Payment_Proof = Array.from({ length: 5 }, (_, i) => ({ id: String(i) })); }
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.service.save('1', f.queue(['receipt.pdf'])));
    assert.equal(f.calls.some(([type]) => type === 'upload'), false);
  }
  for (const size of [0, 20 * 1024 * 1024 + 1]) {
    const f = fixture(), queue = f.queue(['receipt.pdf']); queue[0].file.size = size;
    await assert.rejects(f.service.save('1', queue), /20 MB/);
    assert.equal(f.calls.length, 0);
  }
});

test('retry reuses uploaded IDs after an explicit update rejection', async () => {
  const f = fixture(), queue = f.queue(['receipt.pdf']); f.updateError = true;
  await assert.rejects(f.service.save('1', queue), /Write denied/);
  assert.equal(queue[0].saved, undefined);
  f.updateError = false;
  await f.service.save('1', queue);
  assert.equal(f.calls.filter(([type]) => type === 'upload').length, 1);
  assert.equal(f.record.Payment_Proof.length, 2);
});

test('a timed-out confirmed write is found on retry without duplicating the file', async () => {
  const f = fixture(), queue = f.queue(['receipt.pdf']); f.timeout = true;
  await assert.rejects(f.service.save('1', queue), /Timeout/);
  f.timeout = false;
  await f.service.save('1', queue);
  assert.equal(queue[0].saved, true);
  assert.equal(f.calls.filter(([type]) => type === 'update').length, 1);
});

test('ignored writes are not reported as saved or blindly retried', async () => {
  const f = fixture(), queue = f.queue(['receipt.pdf']); f.ignoreWrite = true;
  await assert.rejects(f.service.save('1', queue), /not confirmed/);
  await assert.rejects(f.service.save('1', queue), /not confirmed/);
  assert.equal(f.calls.filter(([type]) => type === 'update').length, 1);
  assert.equal(queue[0].saved, undefined);
});

test('SDK links a list of uploaded IDs even when object payloads would silently do nothing', async () => {
  const f = fixture(), queue = f.queue(['Justificante de pago.pdf']);
  f.api.updateRecord = async args => {
    f.calls.push(['update', args]);
    for (const uploadedId of args.APIData.Payment_Proof) {
      if (typeof uploadedId === 'string') f.record.Payment_Proof.push({ attachment_Id: 'new-link', file_Id: 'linked-file-id', file_Name: queue[0].file.name, file_Size: 1024 });
    }
    return { data: [{ code: 'SUCCESS' }] };
  };
  await f.service.save('1', queue);
  assert.equal(queue[0].saved, true);
  assert.equal(f.record.Payment_Proof.length, 2);
  assert.equal(f.record.Payment_Proof[0].id, 'existing');
  assert.equal(f.calls.filter(([kind]) => kind === 'upload').length, 1);
});

test('delayed visibility is checked with reads, never by repeating the write', async () => {
  const f = fixture(), queue = f.queue(['receipt.pdf']);
  let afterWrite = false, reads = 0;
  const getRecord = f.api.getRecord;
  f.api.updateRecord = async args => { f.calls.push(['update', args]); afterWrite = true; return { data: [{ code: 'SUCCESS' }] }; };
  f.api.getRecord = async args => {
    if (afterWrite && ++reads === 3) f.record.Payment_Proof.push({ attachment_Id: 'new', fileName: 'receipt.pdf', file_Id: 'different-linked-id', file_Size: 1024 });
    return getRecord(args);
  };
  await f.service.save('1', queue);
  assert.equal(queue[0].saved, true);
  assert.equal(reads, 3);
  assert.equal(f.calls.filter(([kind]) => kind === 'update').length, 1);
});

test('a new attachment with the wrong size cannot confirm the upload', async () => {
  const f = fixture();
  f.api.updateRecord = async () => {
    f.record.Payment_Proof.push({ attachment_Id: 'new', file_Name: 'receipt.pdf', file_Id: 'different', file_Size: 999 });
    return { data: [{ code: 'SUCCESS' }] };
  };
  await assert.rejects(f.service.save('1', f.queue(['receipt.pdf'])), /not confirmed/);
});

test('formatted CRM file sizes do not cause false failures after linking', async () => {
  for (const size of ['35.78 KB', '1.23 MB', '1,23 MB', '', null]) {
    const f = fixture(), queue = f.queue(['FT555_04.09.2026_Made_for_Spain_and_Portugal_Patton.pdf']);
    f.api.updateRecord = async args => {
      f.calls.push(['update', args]);
      f.record.Payment_Proof.push({ attachment_Id: 'new-link', file_Id: 'linked-id', file_Name: queue[0].file.name, file_Size: size });
      return { data: [{ code: 'SUCCESS' }] };
    };
    await f.service.save('1', queue);
    await f.service.save('1', queue);
    assert.equal(queue[0].saved, true);
    assert.equal(f.calls.filter(([kind]) => kind === 'update').length, 1);
    assert.equal(f.calls.filter(([kind]) => kind === 'upload').length, 1);
  }
});

test('original byte counts are checked independently of rounded display sizes', async () => {
  for (const bytes of ['1024', '999']) {
    const f = fixture(), queue = f.queue(['receipt.pdf']);
    f.api.updateRecord = async () => {
      f.record.Payment_Proof.push({ attachment_Id: 'new', file_Id: 'linked', file_Name: 'receipt.pdf', original_Size_Byte: bytes, file_Size: '1 KB' });
      return { data: [{ code: 'SUCCESS' }] };
    };
    if (bytes === '1024') { await f.service.save('1', queue); assert.equal(queue[0].saved, true); }
    else { await assert.rejects(f.service.save('1', queue), /not confirmed/); }
  }
});

test('SDK attachment metadata without ZFS IDs confirms a new file and avoids duplicate retry', async () => {
  const f = fixture(), queue = f.queue(['receipt.pdf']);
  let writes = 0;
  f.api.updateRecord = async args => {
    writes++;
    assert.equal(args.APIData.Payment_Proof[0], 'upload-1');
    f.record.Payment_Proof.push({ attachment_Id: 'new-link', file_Name: 'receipt.pdf' });
    throw Error('Timeout');
  };
  await assert.rejects(f.service.save('1', queue), /Timeout/);
  await f.service.save('1', queue);
  assert.equal(queue[0].saved, true);
  assert.equal(writes, 1);
});

test('an existing same-name file does not confirm an ignored upload', async () => {
  const f = fixture();
  f.record.Payment_Proof = [{ attachment_Id: 'old-link', file_Name: 'receipt.pdf' }];
  f.ignoreWrite = true;
  await assert.rejects(f.service.save('1', f.queue(['receipt.pdf'])), /not confirmed/);
});

test('partial success survives failure and retry uploads only remaining files', async () => {
  const f = fixture(), queue = f.queue(['one.pdf', 'two.pdf']);
  await assert.rejects(f.service.save('1', queue, () => { f.uploadError = true; }), /Upload failed/);
  assert.equal(queue[0].saved, true);
  assert.equal(queue[1].saved, undefined);
  f.uploadError = false;
  await f.service.save('1', queue);
  assert.equal(f.record.Payment_Proof.length, 3);
  assert.equal(f.calls.filter(([type]) => type === 'update').length, 2);
});

test('a success response without an uploaded ID never updates the prepayment', async () => {
  const f = fixture(); f.noId = true;
  await assert.rejects(f.service.save('1', f.queue(['receipt.pdf'])), /file ID/);
  assert.equal(f.calls.some(([type]) => type === 'update'), false);
});

test('Send Payment Proof invokes the CRM function with only the prepayment ID', async () => {
  const f = fixture(), calls = [];
  const sender = f.window.AccountingManagerApp.createPrepaymentProofSender({ CRM: { FUNCTIONS: { execute: async (name, args) => {
    calls.push({ name, args: JSON.parse(args.arguments) });
    return { details: { output: JSON.stringify({ success: true, sent: true, attachment_count: 2, recipient: 'requester@example.com' }) } };
  } } } });
  const result = await sender.send('123');
  assert.equal(result.sent, true);
  assert.deepEqual(calls, [{ name: 'notif_sendprepaymentproof', args: { prepaymentId: '123' } }]);
  await assert.rejects(sender.send(''), /valid prepayment/);
  assert.equal(calls.length, 1);
});

test('authorization rejections, malformed outputs and unconfirmed sends never report success', async () => {
  const f = fixture();
  for (const output of [
    { success: false, sent: false, message: 'Acción solo disponible para Finanzas.' },
    { success: true, sent: false }, { sent: true }, 'not-json', null
  ]) {
    const sender = f.window.AccountingManagerApp.createPrepaymentProofSender({ CRM: { FUNCTIONS: { execute: async () => ({ details: { output } }) } } });
    await assert.rejects(sender.send('123'), output && output.message ? /Finanzas/ : /did not confirm/);
  }
});

test('send timeouts never cause an automatic retry', async () => {
  const f = fixture(); let calls = 0;
  const sender = f.window.AccountingManagerApp.createPrepaymentProofSender({ CRM: { FUNCTIONS: { execute: async () => { calls++; throw Error('timeout'); } } } });
  await assert.rejects(sender.send('123'), /Check email delivery/);
  assert.equal(calls, 1);
});

test('Deluge removes Creator allowlist and preserves routing and attachment requirements', () => {
  const source = fs.readFileSync('_local/crm/crm_functions/sendPrepaymentProof', 'utf8');
  assert.doesNotMatch(source, /allowedUsers|callerEmail|zoho\.loginuserid|UNAUTHORIZED_USER/);
  assert.match(source, /Requested_By_2/);
  assert.match(source, /from\s*:"crmadmin@madeforspainandportugal.com"/);
  assert.match(source, /cc\s*:"claudia@madeforspainandportugal.com"/);
  assert.match(source, /subject\s*:"Justificante de pago"/);
  assert.match(source, /Attachments\s*:file:filesToAttach/);
  const send = source.search(/\r?\n\tsendmail\r?\n/);
  assert.ok(send >= 0);
  assert.ok(source.indexOf('if(!proofFile.isFile())') < send);
  assert.ok(source.indexOf('if(totalBytes > 15000000)') < send);
  assert.ok(source.indexOf('result.put("sent",true)') > send);
  assert.doesNotMatch(source, /updateRecord|actingUserEmail|recipientEmails/);
});
