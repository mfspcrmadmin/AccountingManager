const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture(output, options={}) {
  const window={};
  vm.runInNewContext(fs.readFileSync('app/scripts/bookings.js','utf8'),{window});
  const calls=[], errors=[], notices=[];
  const booking={id:'1',MFSP_Reference:'ABC'};
  const module=window.AccountingManagerApp.createBookingsModule({
    MODULES:{bookings:'Deals'},FIELD_CANDIDATES:{booking:{mfsp:['MFSP_Reference'],name:['Name']}},state:{},
    elements:{bookingActionsMfsp:{value:'ABC'}},
    helpers:{escapeCriteriaValue:v=>v,normalizeQuery:v=>String(v).toLowerCase(),getCandidateValue:(r,fields)=>r[fields[0]]},
    renderer:{showError:v=>errors.push(v),showNotice:v=>notices.push(v),setLoading(){}},
    debugError(){},resolveFieldApiByCandidates:async()=> 'MFSP_Reference',
    getCurrentUserEmail:async()=> 'user@example.test',
    getFunctionOutputObject:r=>r,getFunctionResponseResult:()=>({success:true}),
    crm:{searchRecord:async()=>[booking],getRecord:async()=>booking,executeFunction:async()=>{calls.push('execute');if(options.failure)throw Error('Network');return output;}},
    refreshSettlementDataAfterBookingAction:async()=>{calls.push('refresh');if(options.refreshFailure)throw Error('Refresh failed');}
  });
  return {module,calls,errors,notices};
}
test('successful recalculation refreshes selected supplier data and blocks duplicate clicks',async()=>{
  const f=fixture({error:false});
  await Promise.all([f.module.onRecalculateSettlementClick(),f.module.onRecalculateSettlementClick()]);
  assert.deepEqual(f.calls,['execute','refresh']);
  assert.ok(f.notices.some(Boolean));
});
test('malformed and partial results fail visibly and still invalidate stale data',async()=>{
  for(const output of [null,{}, {error:false,settlement_update_errors:1},{error:true,message:'Partial writes'}]){
    const f=fixture(output);await f.module.onRecalculateSettlementClick();
    assert.ok(f.errors.some(Boolean));assert.equal(f.calls.at(-1),'refresh');
    assert.ok(!f.notices.some(Boolean));
  }
});
test('network and refresh failures describe uncertainty instead of claiming confirmed totals',async()=>{
  const f=fixture(null,{failure:true});await f.module.onRecalculateSettlementClick();
  assert.equal(f.calls.at(-1),'refresh');assert.ok(f.errors.includes('Network'));
  const g=fixture({error:false},{refreshFailure:true});await g.module.onRecalculateSettlementClick();
  assert.ok(g.errors.some(v=>v.includes('displayed settlements could not be refreshed')));
});
test('sync communicates that settlement calculation remains queued',async()=>{
  const f=fixture({error:false});await f.module.onSyncProjectClick();
  assert.ok(f.notices.some(v=>v.includes('recalculation is queued')));
  assert.deepEqual(f.calls,['execute','refresh']);
});
