// Integrated closure lifecycle: actual Deluge closure blocks and widget handlers
// share a persistent CRM fake. External stage changes and Zoho APIs are simulated.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));
class DMap extends Map { put(k, v) { this.set(k, v); } }
class DList extends Array { add(v) { this.push(v); } size() { return this.length; } isEmpty() { return !this.length; } get(i) { return this[i]; } }
const map = value => new DMap(Object.entries(value));

function fixture(withException) {
  const booking = {id:'123', Balance_Amount:0, Closure_Status:''};
  const settlements = [
    {id:'1',Booking:{id:'123'},Settlement_Type:'Supplier Services',Total_Service_Cost:100,Total_Invoice:100,Total_Paid:withException?60:100},
    {id:'2',Booking:{id:'123'},Settlement_Type:'Agent Commission',Total_Service_Cost:25,Total_Invoice:25,Total_Paid:25}
  ];
  const invoices = settlements.map(row=>({id:'invoice-'+row.id,Booking:{id:'123'},Supplier_Settlement:{id:row.id},Invoice_Type:'Final Invoice',Status:'Received',Total_Payable_Amount:row.Total_Invoice}));
  const notes = [], writes = [];
  const control = {reason:null, failNote:false, onPrompt:null};
  const data = {Deals:[booking],Supplier_Settlements:settlements,Supplier_Invoices:invoices,Inv_Set_Allocations:[],Notes:notes};
  function update(entity,id,values) {
    Object.assign(data[entity].find(row=>row.id===String(id)),clone(values));
    writes.push({entity,id,values:clone(values)});
  }
  function transition() {
    const source = fs.readFileSync('crm/settlement-reliability/bp_orchestratebookingtransition.dg','utf8');
    const guard = source.slice(source.indexOf('// Preserve completed closures'),source.indexOf('// End completed closure guard.'));
    const init = source.slice(source.indexOf('// Initialize accounting review'),source.indexOf('if(transitionCode.equals("marked_dead") && referenceType'));
    const js = (guard+'\n'+init).replace(/for each\s+(\w+) in ([^\n]+)\n/g,'for (const $1 of $2)\n')
      .replace(/\.equals\(([^)]*)\)/g,' === $1').replace(/\.toLong\(\)/g,'').replace(/\.toList\(/g,'.split(');
    const result = new DMap();
    vm.runInNewContext('(function(){'+js+'})()',{
      res:result,transitionCode:'trip_accounting_closure',referenceType:'booking_id',bookingReference:'123',ezusProjectRef:'ezus123',
      Map:()=>new DMap(),List:()=>new DList(),isnull:v=>v==null,ifnull:(v,f)=>v==null?f:v,
      zoho:{crm:{
        getRecordById:()=>map(clone(booking)),
        updateRecord:(entity,id,values)=>{update(entity,id,Object.fromEntries(values));return map({id:String(id)});},
        searchRecords:(entity,criteria,page,size)=>DList.from(data[entity].slice((Number(page)-1)*size,Number(page)*size).map(row=>map(clone(row)))),
        bulkUpdate:(entity,batch)=>DList.from(batch.map(values=>{update(entity,values.get('id'),Object.fromEntries(values));return map({status:'success'});}))
      }}
    });
    assert.notEqual(result.get('error'),true,result.get('message'));
    return result;
  }
  transition();
  const window = {prompt:()=>{throw Error('Native prompt must not be used')}};
  vm.runInNewContext(fs.readFileSync('app/scripts/bookings.js','utf8'),{window});
  const state = {bookingClosure:{booking:clone(booking),settlements:clone(settlements),isOpen:true},views:{bookings:{records:[clone(booking)]}}};
  Object.defineProperty(state.bookingClosure,'exceptionReason',{get(){control.onPrompt?.();return control.reason||'';},set(value){control.reason=value;}});
  const success = {data:[{code:'SUCCESS'}]};
  const widget = window.AccountingManagerApp.createBookingsModule({
    MODULES:{bookings:'Deals',settlements:'Supplier_Settlements',invoices:'Supplier_Invoices'},
    FIELD_CANDIDATES:{booking:{closureStatus:['Closure_Status']},settlement:{closureReviewStatus:['Closure_Review_Status']}},
    state,elements:{bookingClosureContent:{querySelector:()=>({value:'Awaiting supplier confirmation'})}},
    helpers:{getCandidateValue:(r,fields)=>r?.[fields[0]],normalizeString:v=>String(v||'').toLowerCase().replace(/\s/g,''),
      textValue:v=>v||'',escapeCriteriaValue:v=>v,getLookupId:v=>String(v?.id||''),getLookupName:()=>''},
    crm:{
      getRecord:async(entity,id)=>clone(data[entity].find(row=>row.id===id)),
      searchRecordPage:async(entity,criteria,page)=>{
        const [,field,value] = criteria.match(/\((\w+):equals:(.*)\)/);
        return clone(data[entity].filter(row=>row[field]?.id===value).slice((page-1)*200,page*200));
      },
      updateRecord:async(entity,id,values)=>{update(entity,id,values);return success;},
      insertRecord:async(entity,values)=>{
        if(control.failNote)return {data:[{code:'ERROR',message:'Injected note failure'}]};
        notes.push(clone(values));writes.push({entity,values:clone(values)});return success;
      }
    },
    getCurrentUserEmail:async()=> 'integration@example.com',
    renderAll(){},debugError(){},renderer:{showNotice(){},showError(){}}
  });
  const event = (attribute,value)=>({target:{closest:()=>({disabled:false,getAttribute:key=>key===attribute?value:null})}});
  return {booking,settlements,notes,writes,control,state,transition,
    action:name=>widget.onClosureStatusClick(event('data-closure-action',name)),
    review:id=>widget.onClosureReviewClick(event('data-booking-closure-review-settlement-id',id))};
}

test('integrated balanced closure: initialize, review, repeat transition, complete, protect, reopen and complete',async()=>{
  const f=fixture(false);
  assert.equal(f.booking.Closure_Status,'Closure Pending');
  assert.ok(f.settlements.every(row=>row.Closure_Review_Status==='Pending review'));
  await f.action('complete');
  assert.equal(f.booking.Closure_Status,'Closure Pending');
  await f.review('1');
  assert.equal(f.booking.Closure_Status,'Closure In Review');
  f.transition();
  assert.equal(f.settlements[0].Closure_Review_Status,'Reviewed');
  assert.equal(f.settlements[1].Closure_Review_Status,'Pending review');
  await f.review('2');
  await f.action('complete');
  assert.equal(f.booking.Closure_Status,'Closure Completed',f.state.bookingClosure.error);
  assert.equal(f.booking.Closure_Completed_By,'integration@example.com');
  assert.ok(Number.isFinite(Date.parse(f.booking.Closure_Completed_At)));
  const count=f.writes.length;
  assert.match(f.transition().get('message'),/already completed/);
  await f.action('complete');
  assert.equal(f.writes.length,count);
  await f.action('reopen');
  assert.equal(f.booking.Closure_Status,'Closure Reopened');
  f.transition();
  assert.equal(f.booking.Closure_Status,'Closure Reopened');
  await f.action('complete');
  assert.equal(f.booking.Closure_Status,'Closure Completed');
  assert.equal(f.notes.length,0);
});

test('integrated exception closure: block, resume, require audit, recover failed note, protect completed state',async()=>{
  const f=fixture(true);
  await f.review('1');await f.review('2');
  await f.action('block');
  assert.equal(f.booking.Closure_Status,'Closure Blocked');
  await f.action('complete');
  assert.equal(f.booking.Closure_Status,'Closure Blocked');
  await f.action('start');await f.action('complete');
  assert.match(f.state.bookingClosure.error,/justification/);
  f.control.reason='Supplier approved paying the outstanding 40 next month.';
  f.control.failNote=true;await f.action('complete');
  assert.equal(f.booking.Closure_Status,'Closure In Review');
  f.control.failNote=false;await f.action('complete');
  assert.equal(f.booking.Closure_Status,'Closure Completed',f.state.bookingClosure.error);
  const audit=f.notes.filter(row=>row.Note_Title==='Trip closure accepted exceptions');
  assert.equal(audit.length,1);
  assert.equal(audit[0].Parent_Id,'123');
  assert.match(audit[0].Note_Content,/integration@example.com/);
  assert.ok(audit[0].Note_Content.includes(f.control.reason));
  const last=f.writes.slice(-2);
  assert.equal(last[0].entity,'Notes');
  assert.equal(last[1].values.Closure_Status,'Closure Completed');
  f.transition();await f.action('complete');
  assert.equal(f.notes.length,2);
});
