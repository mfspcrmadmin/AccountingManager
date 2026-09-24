const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '../_local/crm/crm_functions');
const source = fs.readFileSync(path.join(root, 'migration/migrateCreatorPrepayments'), 'utf8');

// Exercise the actual side-effect-free Deluge mapping block, not a second mapping.
// This tiny syntax adapter is not a Deluge compiler and cannot validate CRM deployment.
function evaluate(block, variables, output, setup = "") {
  block = block.replace(/for each (\w+) in (\{[^{}]*\}|[^\n]+)\n/g, 'for ($1 of $2)\n');
  block = block.replace(/\{((?:"[^"\n]*"\s*,\s*)*"[^"\n]*")\}/g, '[$1]');
  block = block.replace(/\.get\(/g, '.dget(').replace(/\.put\(/g, '.dput(');
  const context = vm.createContext({ input: JSON.stringify(variables) });
  vm.runInContext(`
    Object.defineProperty(Object.prototype, 'dget', {__proto__:null,value:function(k) {return this[k];}});
    Object.defineProperty(Object.prototype, 'dput', {__proto__:null,value:function(k,v) {this[k]=v;}});
    Object.defineProperty(Object.prototype, 'containKey', {__proto__:null,value:function(k) {return Object.hasOwn(this,k);}});
    Array.prototype.size = function() {return this.length;};
    Number.prototype.toLong = function() {return Number(this);};
    Array.prototype.add = Array.prototype.push;
    Array.prototype.contains = Array.prototype.includes;
    String.prototype.toDecimal = function() { const n = Number(String(this)); if (!Number.isFinite(n)) throw Error('Invalid number'); return n; };
    String.prototype.matches = function(pattern) {return new RegExp(pattern).test(String(this));};
    String.prototype.toMap = function() {return JSON.parse(String(this));};
    String.prototype.toLong = function() {return Number(this);};
    Number.prototype.abs = function() {return Math.abs(Number(this));};
    String.prototype.toDate = function(format) {
      const raw = String(this);
      let iso = raw;
      if (format === 'dd/MM/yyyy') iso = raw.split('/').reverse().join('-');
      const date = new Date(iso + 'T00:00:00Z');
      if (!Number.isFinite(date.getTime())) throw Error('Invalid date');
      return {toString:() => date.toISOString().slice(0,10), valueOf:() => date.getTime()};
    };
    function List() {return [];}
    function Map() {return {};}
    function ifnull(value, fallback) {return value == null ? fallback : value;}
    Object.assign(globalThis, JSON.parse(input));
  `, context);
  if (setup) vm.runInContext(setup, context);
  vm.runInContext(block, context);
  return JSON.parse(vm.runInContext('JSON.stringify(' + output + ')', context));
}

function mapping(parent, children, originalStatuses = {}) {
  const block = source.slice(source.indexOf('\t\tpaymentPlans = List();'), source.indexOf('\t\t// Preflight'));
  return evaluate(block, {parent, children, originalStatuses, parentId:parent.ID, reference:parent.MFSP_Reference,
    supplierId:'616617000000000001', bookingId:'616617000000000002', creatorDateFormat:'yyyy-MM-dd', warnings:[]},
    '{paymentPlans, requestPayload, requestStatus, warnings}');
}

function validate(options = {}) {
  const block = source.slice(source.indexOf('\tallowedModes ='), source.indexOf('\t// Return this same state'));
  return evaluate(block, {mode:'simulate', paymentDateFrom:'2026-09-01', paymentDateTo:'2026-09-30', proformaReport:'All_Proformas', creatorDateFormat:'yyyy-MM-dd', resumeState:'', ...options}, 'state');
}

function fixture() {
  return {
    parent: {ID:'1234567890123456789', MFSP_Reference:'ABCD1234567', Supplier_Reference:'SUP1', Total_Proforma_Amount:'1000.00', Transaction_Type:'Partial Payment', Requested_Date:'2026-09-01', Requested_by:'operator@example.com', Observations:'Original notes'},
    children: [
      {ID:'2234567890123456789', Amount:'300.00', Percent:'30', When_To_Be_Paid:'On a specific date', Payment_Date:'2026-09-10', Status:'Paid', Accounted:true, Bank_Receipt:true, Payment_Proof:[]},
      {ID:'3234567890123456789', Amount:'700.00', Percent:'70', When_To_Be_Paid:'Within 1 day', Payment_Date:'2026-12-10', Status:'Not Paid', Accounted:false, Bank_Receipt:false, Payment_Proof:[]}
    ]
  };
}

test('MFSP filter accepts exactly four letters and seven digits, without trimming', () => {
  const expression = source.match(/reference\.matches\("([^"\n]+)"\)/)[1];
  const valid = new RegExp(expression);
  for (const value of ['MFSP1234567', 'AbCd0000001']) assert.equal(valid.test(value), true);
  for (const value of ['MFSP123456', 'MFSP12345678', 'ABCDE123456', '1234ABCDEFG', ' MFSP1234567', 'MFSP1234567 ', 'MFSP-1234567', 'ÁBCD1234567', '']) assert.equal(valid.test(value), false, value);
});

test('mapping preserves all sibling payments, origin IDs, amounts and planned dates', () => {
  const f = fixture(), result = mapping(f.parent, f.children);
  assert.equal(result.paymentPlans.length, 2);
  assert.equal(result.paymentPlans[1].payload.Due_Date, '2026-12-10');
  assert.equal(result.paymentPlans[0].creator_id, '2234567890123456789');
  assert.equal(result.paymentPlans[0].payload.Name, 'CREATOR-PREPAY-2234567890123456789');
  assert.equal(result.paymentPlans[0].payload.Accounting_Status, 'Prepayment recorded');
  assert.equal(result.paymentPlans[1].payload.Accounting_Status, 'Pending invoice');
  assert.equal(result.paymentPlans[0].payload.When_To_Be_Paid, 'Specific Date');
  assert.equal(result.paymentPlans[0].payload.Accounted, true);
  assert.equal(Object.hasOwn(result.paymentPlans[0].payload, 'Payment_Date'), false);
  assert.equal(Object.hasOwn(result.paymentPlans[0].payload, 'Status'), false);
  assert.equal(result.requestPayload.Amount, 1000);
  assert.equal(result.requestPayload.Status, 'Partially Paid');
  assert.equal(result.requestPayload.Requested_Date, '2026-09-01T00:00:00+00:00');
  assert.equal(result.paymentPlans[0].source.Bank_Receipt, true, 'unmapped data stays in the source snapshot');
});

test('request status considers all active siblings and retains cancelled children', () => {
  for (const [statuses, expected] of [
    [['Paid','Paid'],'Fully Paid'], [['Not Paid','Not Paid'],'To Be Paid'],
    [['Paid','Cancelled'],'Fully Paid'], [['Cancelled','Cancelled'],'Cancelled']
  ]) {
    const f = fixture();
    f.children.forEach((child, index) => child.Status = statuses[index]);
    const result = mapping(f.parent, f.children);
    assert.equal(result.requestStatus, expected);
    assert.equal(result.paymentPlans.length, 2);
  }
});

test('unknown statuses, invalid numbers and missing source fields block the mapping', () => {
  for (const mutate of [
    f => f.children[0].Status = 'Unknown',
    f => f.children[0].Amount = '-1',
    f => f.children[0].Amount = 'unreadable',
    f => f.children[0].Accounted = 'unknown',
    f => delete f.children[0].Payment_Proof,
    f => f.children[0].Percent = '101',
    f => f.parent.Transaction_Type = 'Unknown'
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => mapping(f.parent, f.children));
  }
});

test('source totals are preserved, discrepancies are reported and undated siblings are retained', () => {
  const f = fixture(); f.parent.Total_Proforma_Amount = '2000'; f.children[1].Payment_Date = '';
  const result = mapping(f.parent, f.children);
  assert.equal(result.requestPayload.Amount, 2000);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.paymentPlans.length, 2);
  assert.equal(Object.hasOwn(result.paymentPlans[1].payload, 'Due_Date'), false);
});

test('date parameters reject missing, reversed and invalid calendar ranges', () => {
  assert.equal(validate().row_index, 0);
  for (const options of [
    {paymentDateFrom:''}, {paymentDateTo:'2026-08-31'}, {paymentDateFrom:'2026-02-30'},
    {paymentDateFrom:'01/09/2026'}, {mode:'delete'}, {proformaReport:'../other'}, {creatorDateFormat:'unknown'}
  ]) assert.throws(() => validate(options));
});

test('resume state cannot be reused with another mode or date range', () => {
  const state = validate();
  assert.deepEqual(validate({resumeState:JSON.stringify(state)}), state);
  assert.throws(() => validate({mode:'migrate', resumeState:JSON.stringify(state)}));
  assert.throws(() => validate({paymentDateTo:'2026-10-01', resumeState:JSON.stringify(state)}));
});

test('the actual Creator date criteria includes both range boundaries', () => {
  const criteriaLine = source.split('\n').find(line => line.trim().startsWith('criteria = "Payment_Date'));
  const criteria = evaluate('fromDate = "2026-09-01".toDate("yyyy-MM-dd"); toDate = "2026-09-30".toDate("yyyy-MM-dd");' + criteriaLine,
    {creatorDateFormat:'yyyy-MM-dd'}, 'criteria');
  assert.equal(criteria, "Payment_Date >= '2026-09-01' && Payment_Date <= '2026-09-30'");
});

test('Migrated children recover original accounting states without changing amounts or snapshots', () => {
  const f = fixture();
  const before = mapping(f.parent, f.children);
  f.children.forEach(child => child.Status = 'Migrated');
  const original = {[f.children[0].ID]:'Paid', [f.children[1].ID]:'Not Paid'};
  const after = mapping(f.parent, f.children, original);
  assert.deepEqual(after, before);
  assert.equal(after.paymentPlans[0].payload.Creator_Original_Status, 'Paid');
  assert.equal(after.paymentPlans[1].payload.Creator_Original_Status, 'Not Paid');
});

test('Migrated without a preserved valid original status never guesses paid or unpaid', () => {
  const f = fixture(); f.children[0].Status = 'Migrated';
  assert.throws(() => mapping(f.parent, f.children));
  assert.throws(() => mapping(f.parent, f.children, {[f.children[0].ID]:'Migrated'}));
});

function markCreator(mode, options = {}) {
  let block = source.slice(source.indexOf('\t\t// Only acknowledge Creator'), source.indexOf('\t\tresult.put("missing",missing);'));
  block = block.replace(/invokeurl\s*\[[\s\S]*?\];/g, 'patchCreator(childId, markerPayload);');
  return evaluate(block, {mode, paymentPlans:[{creator_id:'123', payload:{Creator_Original_Status:'Paid'}}],
    creatorStatus:'Paid', missing:0, details:[], writes:[], ...options}, '{missing,details,writes,creatorStatus}', `
    const standalone = {creatorMigrationRead:() => JSON.stringify({records:[{ID:'123', Status:creatorStatus}]})};
    function patchCreator(id, payload) {
      writes.push({id,payload});
      if (globalThis.failUpdate) return {code:4000};
      if (!globalThis.failConfirm) creatorStatus = payload.data.Status;
      return {code:3000};
    }
  `);
}

test('Creator is marked only in migrate and already Migrated records are not patched twice', () => {
  const migrated = markCreator('migrate');
  assert.equal(migrated.creatorStatus, 'Migrated');
  assert.deepEqual(migrated.writes, [{id:'123', payload:{data:{Status:'Migrated'},skip_workflow:['all']}}]);
  for (const mode of ['simulate','verify']) {
    const result = markCreator(mode);
    assert.equal(result.writes.length, 0);
    assert.equal(result.creatorStatus, 'Paid');
    assert.equal(result.missing, mode === 'verify' ? 1 : 0);
  }
  assert.equal(markCreator('migrate', {creatorStatus:'Migrated'}).writes.length, 0);
});

test('failed Creator acknowledgement or changed source status prevents successful completion', () => {
  assert.throws(() => markCreator('migrate', {failUpdate:true}));
  assert.throws(() => markCreator('migrate', {failConfirm:true}));
  assert.throws(() => markCreator('migrate', {creatorStatus:'Cancelled'}));
  assert.ok(source.indexOf('// Only acknowledge Creator') > source.indexOf('The final request status was not confirmed'));
  assert.ok(source.indexOf('// Only acknowledge Creator') > source.indexOf('Payment documents could not be verified'));
});


test('selection totals deduplicate proformas and include all their children', () => {
  const block = source.slice(source.indexOf('\t// Count each eligible proforma'), source.indexOf('\t// Advance only'));
  let state = { counted_proforma_ids: [], selected_prepayments: 0, candidates_reviewed: 0, invalid_mfsp_candidates: 0 };
  for (const [parentId, action, children] of [['r1', 'simulate', [{}, {}]], ['r1', 'simulate', [{}, {}]], ['r2', 'skipped_invalid_mfsp', []]]) {
    state = evaluate(block, { state, parentId, result: { action }, children }, 'state');
  }
  assert.equal(state.selected_prepayments, 2);
  assert.equal(state.counted_proforma_ids.length, 1);
  assert.equal(state.invalid_mfsp_candidates, 1);
  assert.equal(state.candidates_reviewed, 3);
});


test('batch orchestration advances 25 candidates, crosses pages, and stops at completion', () => {
  const batchSource = source.replace(/\r\n/g, '\n');
  let block = batchSource.slice(batchSource.indexOf('\tbatchResults = List();'), batchSource.indexOf('\n}\ncatch (error)'));
  const begin = block.indexOf('\tcandidate = candidates.get(rowIndex);');
  const end = block.indexOf('\t// Count each eligible proforma');
  block = block.slice(0, begin) + `
    candidate = candidates.get(rowIndex);
    candidateId = candidate.get("ID");
    parentId = candidateId;
    children = List();
    result.put("action","skipped_invalid_mfsp");
  ` + block.slice(end);
  block = block.replace(/for each batchPosition in \{([^}]+)\}/, 'for each batchPosition in [$1]');
  const setup = `
    Object.defineProperty(Object.prototype, 'remove', {value:function(k) {delete this[k];}});
    Array.prototype.isEmpty = function() {return this.length === 0;};
    Object.prototype.toString = function() {return JSON.stringify(this);};
    var reads = 0;
    var standalone = {creatorMigrationRead:function(report, criteria, cursor) {
      reads++;
      var offset = cursor === '' ? 0 : Number(cursor);
      var rows = allRows.slice(offset, offset + 10);
      return JSON.stringify({records:rows,next_cursor:offset+10 < allRows.length ? String(offset+10) : ''});
    }};
  `;
  for (const size of [0, 7, 25, 31]) {
    const state = { record_cursor:'', row_index:0, expected_payment_id:'', counted_proforma_ids:[], selected_prepayments:0, candidates_reviewed:0, invalid_mfsp_candidates:0 };
    const out = evaluate(block, { allRows:Array.from({length:size}, (_,i) => ({ID:String(i+1)})), state, result:{complete:false}, summary:{}, criteria:'', mode:'simulate' }, '{state,result,reads}', setup);
    assert.equal(out.result.processed_in_batch, Math.min(size,25));
    assert.equal(out.state.candidates_reviewed, Math.min(size,25));
    assert.equal(out.result.complete, size <= 25);
    assert.ok(out.reads <= 3);
    if (size > 25) {
      assert.equal(out.state.record_cursor, '20');
      assert.equal(out.state.row_index, 5);
      assert.equal(out.state.expected_payment_id, '26');
    }
  }
});


function runAuto(saved, migrationResult, failSave = false) {
  let code = fs.readFileSync(path.join(root, 'migration/migrateCreatorPrepaymentsAuto'), 'utf8').replace(/\r\n/g, '\n');
  code = code.replace(/^string standalone\.migrateCreatorPrepaymentsAuto\([^\n]+/, 'function runAutoMigration()');
  return evaluate(code + '\noutput = JSON.parse(runAutoMigration());', { saved, migrationResult, failSave, mode: 'migrate', paymentDateFrom: '2026-09-23', paymentDateTo: '2026-09-23', proformaReport: 'All_Proformas', creatorDateFormat: 'dd-MMM-yyyy' }, '{output,calls,saved}', `
    Object.prototype.toString = function() {return JSON.stringify(this);};
    var calls = [];
    var standalone = {
      creatorMigrationProgress: function(action, config, value) {
        calls.push({action:action});
        if (action === 'save') {
          if (failSave && calls.some(c => c.action === 'migrate')) throw Error('Progress save failed');
          saved = JSON.parse(value);
        }
        return JSON.stringify(saved);
      },
      migrateCreatorPrepayments: function(mode, from, to, report, format, resume) {
        calls.push({action:'migrate',resume:resume});
        return JSON.stringify(migrationResult);
      }
    };
  `);
}

test('auto migration resumes saved progress and stores the next state without manual input', () => {
  const out = runAuto({ complete:false, resume_state:'previous' }, { success:true, complete:false, next_state:'next', summary:{selected_prepayments:25} });
  assert.equal(out.calls.find(c => c.action === 'migrate').resume, 'previous');
  assert.equal(out.saved.resume_state, 'next');
  assert.equal(out.output.progress_saved, true);
});

test('auto migration does not restart completed runs and preserves a failed checkpoint', () => {
  const complete = runAuto({ complete:true, resume_state:'end' }, {});
  assert.equal(complete.calls.some(c => c.action === 'migrate'), false);
  assert.equal(complete.output.complete, true);
  const failed = runAuto({ complete:false, resume_state:'old' }, { success:false, complete:false, next_state:'failing-candidate' });
  assert.equal(failed.saved.resume_state, 'failing-candidate');
  assert.equal(failed.output.success, false);
  const rejected = runAuto({ complete:false, resume_state:'old' }, { success:true, complete:false, next_state:'next' }, true);
  assert.equal(rejected.output.progress_saved, false);
  assert.equal(rejected.output.next_state, 'next');
  assert.equal(rejected.output.success, false);
});

test('fast skip requires every child to be Migrated and never skips simulate or verify', () => {
  const block = source.slice(source.indexOf('\t\tallChildrenMigrated = true;'), source.indexOf('\t\t// Migrated is a transport marker'));
  const probe = block + '\nresult.put("full_processing",true);\n}';
  for (const mode of ['migrate', 'simulate', 'verify']) {
    for (const states of [['Migrated','Migrated'], ['Migrated','Not Paid']]) {
      const result = evaluate(probe, { mode, children:states.map(Status => ({Status})), result:{} }, 'result');
      assert.equal(result.action === 'skipped_already_migrated', mode === 'migrate' && states.every(s => s === 'Migrated'));
    }
  }
});
