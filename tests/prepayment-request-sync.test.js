const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture(statuses) {
  const window = {}; vm.runInNewContext(fs.readFileSync('app/scripts/prepayment-request-sync.js', 'utf8'), {window});
  const payments = statuses.map((Accounting_Status, i) => ({id:String(i+1), Accounting_Status}));
  const writes = [];
  const crm = {
    getFields: async module => ({fields: module === 'Prepayment_Requests' ? [{api_name:'Status', pick_list_values:[{actual_value:'Fully Paid'}, {actual_value:'Partially Paid'}, {actual_value:'To Be Paid'}]}] : [{api_name:'Request_Link', data_type:'lookup', lookup:{module:{api_name:'Prepayment_Requests'}}}, {api_name:'Payment_Status', pick_list_values:[{actual_value:'Fully paid'}, {actual_value:'Partially paid'}, {actual_value:'Prepayment Requested'}]}]}),
    coql: async query => query.includes('from Prepayments') ? payments.map(p => ({id:p.id})) : [{id:'88'}],
    getRecord: async (module, id) => module === 'Prepayments' ? payments.find(p => p.id === id) : module === 'Prepayment_Request_Services' ? {id, Prepayment_Request:{id:'123'}, Booking_Service:{id:'99'}} : {id},
    updateRecord: async (module, id, data) => { writes.push({module, id, data}); return {data:[{code:'SUCCESS'}]}; }
  };
  return {crm, writes, sync: () => window.AccountingManagerApp.syncPrepaymentRequest(crm, '123')};
}
test('partial and full payment update the request and junction-linked services using CRM picklist values', async () => {
  for (const all of [false,true]) {
    const f = fixture(['Prepayment recorded', all ? 'Prepayment recorded' : 'Pending invoice']);
    await f.sync();
    assert.deepEqual(JSON.parse(JSON.stringify(f.writes)), [
      {module:'Prepayment_Requests', id:'123', data:{Status:all ? 'Fully Paid':'Partially Paid'}},
      {module:'Booking_Services', id:'99', data:{Payment_Status:all ? 'Fully paid':'Partially paid'}}
    ]);
  }
});
test('incomplete reads never claim fully paid or write partial results', async () => {
  const f = fixture(['Prepayment recorded']); f.crm.getRecord = async () => null;
  await assert.rejects(f.sync(), /Could not read/); assert.equal(f.writes.length,0);
});
test('service update rejection is reported after recording request status', async () => {
  const f = fixture(['Prepayment recorded']);
  f.crm.updateRecord = async module => ({data:[{code:module === 'Booking_Services' ? 'NO_PERMISSION':'SUCCESS'}]});
  await assert.rejects(f.sync(), /Could not update Booking_Services/);
});

test('both discard reasons count as paid for request and service status', async () => {
  for (const status of ['Discard - Credit', 'Discard - Already Paid']) {
    for (const statuses of [[status], ['Prepayment recorded', status], ['Discard - Credit', 'Discard - Already Paid']]) {
      const f = fixture(statuses); await f.sync();
      assert.equal(f.writes[0].data.Status, 'Fully Paid');
      assert.equal(f.writes[1].data.Payment_Status, 'Fully paid');
    }
    const f = fixture([status, 'Pending invoice']); await f.sync();
    assert.equal(f.writes[0].data.Status, 'Partially Paid');
  }
});

for (const [otherStatuses, expected] of [
  [['Pending invoice'], 'Partially paid'],
  [['Prepayment recorded'], 'Fully paid'],
  [[], 'Partially paid'],
  [['Prepayment recorded', 'Cancelled'], 'Fully paid']
]) {
  test('service status aggregates both requests: ' + JSON.stringify(otherStatuses), async () => {
    const f = fixture(['Prepayment recorded']);
    const read = f.crm.getRecord, query = f.crm.coql;
    f.crm.coql = async sql => {
      if (sql.includes("from Prepayments") && sql.includes("'456'")) return otherStatuses.map((_, i) => ({id:String(200+i)}));
      if (sql.includes("Booking_Service = '99'")) return [{id:'88'}, {id:'89'}, {id:'90'}];
      return query(sql);
    };
    f.crm.getRecord = async (module, id) => {
      if (module === 'Prepayments' && Number(id) >= 200) return {id, Accounting_Status:otherStatuses[Number(id)-200]};
      if (module === 'Prepayment_Request_Services' && id !== '88') return {id, Prepayment_Request:{id:'456'}, Booking_Service:{id:'99'}};
      return read(module, id);
    };
    await f.sync();
    assert.equal(f.writes[0].data.Status, 'Fully Paid');
    assert.equal(f.writes[1].data.Payment_Status, expected);
    assert.equal(f.writes.length, 2);
  });
}

test('an unreadable second request prevents any status writes', async () => {
  const f = fixture(['Prepayment recorded']), query = f.crm.coql, read = f.crm.getRecord;
  f.crm.coql = async sql => sql.includes("Booking_Service = '99'") ? [{id:'88'}, {id:'89'}] : query(sql);
  f.crm.getRecord = async (module, id) => id === '89' ? {id, Booking_Service:{id:'99'}, Prepayment_Request:{id:'456'}} : id === '456' ? null : read(module, id);
  await assert.rejects(f.sync(), /Could not read request/);
  assert.equal(f.writes.length, 0);
});

test('cancelled requests do not prevent full payment of the active requests', async () => {
  const f = fixture(['Prepayment recorded']), query = f.crm.coql, read = f.crm.getRecord;
  f.crm.coql = async sql => sql.includes("Booking_Service = '99'") ? [{id:'88'}, {id:'89'}] : query(sql);
  f.crm.getRecord = async (module, id) => id === '89' ? {id, Booking_Service:{id:'99'}, Prepayment_Request:{id:'456'}} : id === '456' ? {id, Status:'Cancelled'} : read(module, id);
  await f.sync();
  assert.equal(f.writes[1].data.Payment_Status, 'Fully paid');
});
