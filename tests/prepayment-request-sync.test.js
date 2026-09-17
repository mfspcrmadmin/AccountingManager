const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture(statuses) {
  const window = {}; vm.runInNewContext(fs.readFileSync('app/scripts/prepayment-request-sync.js', 'utf8'), {window});
  const payments = statuses.map((Accounting_Status, i) => ({id:String(i+1), Accounting_Status}));
  const writes = [];
  const crm = {
    getFields: async module => ({fields: module === 'Prepayment_Requests' ? [{api_name:'Status', pick_list_values:[{actual_value:'Fully Paid'}, {actual_value:'Partially Paid'}]}] : [{api_name:'Request_Link', data_type:'lookup', lookup:{module:{api_name:'Prepayment_Requests'}}}, {api_name:'Payment_Status', pick_list_values:[{actual_value:'Fully paid'}, {actual_value:'Partially paid'}]}]}),
    coql: async query => query.includes('from Prepayments') ? payments.map(p => ({id:p.id})) : [{id:'99'}],
    getRecord: async (module, id) => module === 'Prepayments' ? payments.find(p => p.id === id) : {id},
    updateRecord: async (module, id, data) => { writes.push({module, id, data}); return {data:[{code:'SUCCESS'}]}; }
  };
  return {crm, writes, sync: () => window.AccountingManagerApp.syncPrepaymentRequest(crm, '123')};
}
test('partial and full payment update the request and lookup-linked services using CRM picklist values', async () => {
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
