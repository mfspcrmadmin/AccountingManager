const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('app/scripts/ministry-traveller-register.js','utf8');
function setup(data){
  const calls=[];
  const context=vm.createContext({global:{ZOHO:{CRM:{FUNCTIONS:{execute:async(name,args)=>{calls.push({name,args});const id=JSON.parse(args.arguments).bookingId;return {details:{output:JSON.stringify(data[id])}};}}}}}});
  vm.runInContext(src.slice(src.indexOf('  function functionOutputRecords('),src.indexOf('  function dateCriteria('))+
    src.slice(src.indexOf('  function passengerValues('),src.indexOf('  function passengerName(')),context);
  return {context,calls};
}
test('Ministerio caches the same person by booking participation, preserving opposite lead values',async()=>{
  const a={id:'201',Booking_ID:'301',PAX_Booking_ID:'101',Lead_Passenger:false,Lead_Pax:true,Forename:'Alex',Name:'Morgan'};
  const b={...a,Booking_ID:'302',PAX_Booking_ID:'102',Lead_Passenger:true};
  const {context,calls}=setup({'301':{schema_version:1,error:false,result:[a]},'302':{schema_version:1,error:false,result:[b]}});
  const r=await vm.runInContext('loadTravelersByBooking(["301","302"])',context);
  const first=r.records[r.idsByBooking['301'][0]],second=r.records[r.idsByBooking['302'][0]];
  assert.equal(first.id,second.id);assert.notEqual(r.idsByBooking['301'][0],r.idsByBooking['302'][0]);
  assert.equal(context.passengerValues(first).leadPax,'false');assert.equal(context.passengerValues(second).leadPax,'true');
  assert.equal(calls.length,2);assert.ok(calls.every(c=>c.name==='gettravellersforbooking'));
});
test('Ministerio never falls back to global PAX or accepts another booking on reader errors',async()=>{
  for(const payload of [{error:true,message:'No permission'},{schema_version:1,error:false,result:[{id:'201',Booking_ID:'999',PAX_Booking_ID:'101'}]},[{id:'201'}]]){
    const {context}=setup({'301':payload});await assert.rejects(vm.runInContext('loadTravelersByBooking(["301"])',context));
  }
  assert.doesNotMatch(src,/searchRecord\(\{ Entity: "PAX_X_Bookings"/);
});
test('export passenger selection retains the real profile ID and the participation ID',()=>{
  assert.match(src,/id: \(pax\[id\] \|\| \{\}\).id, participationId:/);
  assert.match(src,/selectedPassengerId: \(pax\[travellerIds\[0\]\] \|\| \{\}\).id/);
});
