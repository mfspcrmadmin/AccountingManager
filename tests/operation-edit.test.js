const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {transpile} = require('./helpers/deluge-registration-harness');
function server({module='Prepayments', linked=false, linkError=false, conflict=false, timeout=false, current={}, related={}}={}) {
 const writes=[];
 const db={ [module]: {'1':{id:'1',Name:'Example',Amount:100,Currency:'EUR',Modified_Time:'2026-10-13T14:00:00+02:00',Accounting_Status:'Pending invoice',...current}},...related};
 const ctx=vm.createContext({});
 vm.runInContext(`
 function Map(){return {};} function List(){return [];} function ifnull(v,b){return v==null?b:v;}
 Object.defineProperties(Object.prototype,{get:{value:function(k){return this[k]??null;}},put:{value:function(k,v){this[k]=v;}},putAll:{value:function(o){Object.assign(this,o);}},containKey:{value:function(k){return Object.hasOwn(this,k);}},keys:{value:function(){return Object.keys(this);}},isEmpty:{value:function(){return Object.keys(this).length===0;}},toString:{value:function(){return JSON.stringify(this);},configurable:true}});
 Array.prototype.add=function(v){this.push(v);};Array.prototype.size=function(){return this.length;};Array.prototype.contains=function(v){return this.includes(v);};
 String.prototype.toMap=function(){return JSON.parse(this);};String.prototype.toList=function(s){return this.split(s);};String.prototype.matches=function(s){return new RegExp('^(?:'+s+')$').test(this);};String.prototype.toLong=String.prototype.toDecimal=function(){return Number(this);};
 Number.prototype.toLong=Number.prototype.toDecimal=function(){return Number(this);};Number.prototype.round=function(n){return Math.round(Number(this)*10**n)/10**n;};
 `,ctx);
 const inside=o=>vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(o))+')',ctx);
 ctx.zoho={crm:{getRecordById:(m,id)=>inside(db[m]?.[id]||{})}};
 ctx.invoke=options=>{
  if(options.url.endsWith('/coql')) return inside({responseCode:linkError?503:linked?200:204,responseText:linked?JSON.stringify({data:[{id:'88'}]}):''});
  assert.equal(options.type,'PUT');
  if(timeout) throw Error('Connection lost');
  if(conflict) return inside({responseCode:412});
  const body=JSON.parse(options.parameters); assert.deepEqual(body.trigger,[]); assert.equal(options.headers['If-Unmodified-Since'],db[module]['1'].Modified_Time);
  writes.push(body.data[0]);Object.assign(db[module]['1'],body.data[0]);
  return inside({responseCode:200,responseText:JSON.stringify({data:[{code:'SUCCESS',status:'success'}]})});
 };
 vm.runInContext(transpile(fs.readFileSync('crm/operation-edit/accountingOperation_edit.dg','utf8')),ctx);
 return {writes,run:(changes={},extra={})=>JSON.parse(ctx.accountingOperation_edit(JSON.stringify({module,id:'1',action:'save',modified_time:db[module]['1'].Modified_Time,changes,remove_files:[],add_files:[],...extra})))};
}
test('unregistered prepayment amount can be corrected in one conditional update',()=>{const s=server();assert.equal(s.run({Amount:120}).success,true);assert.equal(s.writes.length,1);assert.equal(s.writes[0].Amount,120);});
test('direct invoice, payment and indirect allocations prevent financial edits',()=>{for(const cfg of [{current:{Vendor_Invoice:{id:'2'}}},{current:{Vendor_Payment:{id:'3'}}},{linked:true}]){const s=server(cfg);assert.equal(s.run({Amount:120}).success,false);assert.equal(s.writes.length,0);}});
test('recorded card purchase blocks financial fields but permits review notes',()=>{const s=server({module:'Card_Purchases',current:{Accounting_Status:'Purchase recorded'}});assert.equal(s.run({Currency:'USD'}).success,false);assert.equal(s.run({Review_Notes:'Corrected reference'}).success,true);});
test('failed allocation reads fail closed',()=>{const s=server({linkError:true});assert.equal(s.run({Amount:120}).success,false);assert.equal(s.writes.length,0);});
test('stale records and write-time conflicts never produce a confirmed save',()=>{const s=server();assert.equal(s.run({Amount:120},{modified_time:'old'}).saved,false);assert.equal(s.writes.length,0);const race=server({conflict:true});assert.equal(race.run({Amount:120}).success,false);assert.equal(race.writes.length,0);});
test('an interrupted CRM write is reported as uncertain and requires readback',()=>{const s=server({timeout:true});const r=s.run({Amount:120});assert.equal(r.success,false);assert.equal(r.saved,false);assert.equal(r.uncertain,true);});
test('system financial links and impossible amounts cannot be forged',()=>{for(const changes of [{Vendor_Invoice:{id:'2'}},{Amount:-1},{Amount:1.001},{Percent:101},{Accounting_Status:'Prepayment recorded'}]){const s=server();assert.equal(s.run(changes).success,false);assert.equal(s.writes.length,0);}});
test('card settlement must match supplier and booking',()=>{const s=server({module:'Card_Purchases',current:{Supplier:{id:'2'},Booking:{id:'3'}},related:{Supplier_Settlements:{'4':{id:'4',Supplier:{id:'9'},Booking:{id:'3'}}}}});assert.equal(s.run({Settlement:{id:'4'}}).success,false);assert.equal(s.writes.length,0);});
test('refund type updates pending status without creating financial records',()=>{const s=server({module:'Card_Purchases',current:{Transaction_Type:'Purchase'}});assert.equal(s.run({Transaction_Type:'Refund'}).success,true);assert.equal(s.writes[0].Accounting_Status,'Pending credit note');});
test('files are removed and replaced in the same conditional update',()=>{const s=server({current:{Payment_Proof:[{id:'44'}]}});const result=s.run({}, {remove_files:['44'],add_files:[{id:'upload123'}]});assert.equal(result.success,true);assert.deepEqual(s.writes[0].Payment_Proof,[{id:'44',_delete:null},{File_Id__s:'upload123'}]);});
test('unknown document IDs and excessive file counts do not update records',()=>{const s=server({current:{Payment_Proof:[{id:'44'}]}});assert.equal(s.run({}, {remove_files:['55']}).success,false);assert.equal(s.run({}, {add_files:Array.from({length:5},(_,i)=>({id:'f'+i}))}).success,false);assert.equal(s.writes.length,0);});
const ui=vm.createContext({window:{AccountingManagerApp:{}}});vm.runInContext(fs.readFileSync('app/scripts/operation-edit.js','utf8'),ui);
const model=ui.window.AccountingManagerApp.operationEditModel;
test('readback verification handles timezone formatting and rejects missing documents',()=>{const req={module:'Card_Purchases',id:'1',changes:{Transaction_Date:'2026-10-13T12:00:00Z'},remove_files:['old'],before_files:['old'],add_files:[{id:'new',name:'invoice.pdf',size:100}]};assert.equal(model.verify({id:'1',Transaction_Date:'2026-10-13T14:00:00+02:00',Supporting_Documents:[{id:'45',file_Id:'new'}]},req),true);assert.equal(model.verify({id:'1',Transaction_Date:'2026-10-13T14:00:00+02:00',Supporting_Documents:[]},req),false);});
test('all business fields are either editable or explicitly displayed as system data',()=>{const fields=require('./fixtures/operation-edit-fields.json');for(const [module,definition] of Object.entries(model.definitions)){const shown=[...definition.groups.flatMap(g=>g[1].split(',')),...definition.readonly.split(','),definition.file];for(const field of fields[module].filter(f=>f.view_type?.edit&&!['Unsubscribed_Mode','Unsubscribed_Time'].includes(f.api_name)))assert.ok(shown.includes(field.api_name),module+': '+field.api_name);}});
