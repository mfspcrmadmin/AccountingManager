const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {transpile}=require('./helpers/deluge-registration-harness');
function setup(options={}){
 const db={Invoices:{2:{id:'2',Subject:'FV-2026-000001',Invoice_Date:'2026-11-04',Grand_Total:100,Currency:'EUR',Type:'Invoice',Invoice_Origin:'Accounting Manager',Trip_Booking_Key:'BOOKING-1',Booking_MFSP:'MFSP-TEST',Account_Name:{id:'3'},Deal_Name__s:{id:'1'},Modified_Time:'v1',Invoiced_Items:[{Net_Total:100,Description:'Viaje por España'}]}},Accounts:{3:{id:'3',Account_Name:'Agencia Muñoz',Billing_Street:'Calle Málaga'}},Deals:{1:{id:'1',Deal_Name:'Test trip'}}},attachments=[],calls=[];
 const ctx=vm.createContext({});vm.runInContext(`function Map(){return {}};function List(){return []};function ifnull(v,f){return v==null?f:v};
 Object.defineProperties(Object.prototype,{get:{value:function(k){return this[k]==null?null:this[k]}},put:{value:function(k,v){this[k]=v}},toString:{value:function(){return JSON.stringify(this)},configurable:true}});
 Array.prototype.add=function(v){this.push(v)};Array.prototype.size=function(){return this.length};Array.prototype.contains=function(v){return this.includes(v)};
 String.prototype.toMap=function(){return JSON.parse(this)};String.prototype.toList=function(s){return this.split(s)};String.prototype.matches=function(s){return new RegExp('^(?:'+s+')$').test(this)};
 String.prototype.toLong=String.prototype.toDecimal=function(){return Number(this)};Number.prototype.toLong=Number.prototype.toDecimal=function(){return Number(this)};Number.prototype.round=function(n){return Math.round(Number(this)*10**n)/10**n};`,ctx);
 const inside=o=>vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(o))+')',ctx);
 ctx.zoho={encryption:{sha256:text=>crypto.createHash('sha256').update(text).digest('hex'),base64DecodeToFile:(data,name)=>({name,setParamName(){}})},crm:{getRecordById:(m,id)=>inside(db[m]?.[id]||{}),updateRecord:(m,id,values)=>{if(options.failReady&&values.Invoice_PDF_State==='Ready'){options.failReady=false;return inside({code:'ERROR'})}Object.assign(db[m][id],JSON.parse(JSON.stringify(values)));db[m][id].Modified_Time+='x';return inside({id:String(id)})},attachFile:(m,id,file)=>{calls.push('attach');attachments.push({id:'8',File_Name:file.name});if(options.lostAttach){options.lostAttach=false;throw Error('Lost response')}return inside({code:'SUCCESS',details:{id:'8'}})},getRelatedRecords:(related)=>inside(related==='PAX3'?(options.guests||[]):attachments)}};
 ctx.invoke=o=>{
  if(o.url.endsWith('/files')){calls.push('upload');if(options.failUpload)throw Error('Upload uncertain');return inside({data:[{code:'SUCCESS',details:{id:'file1'}}]})}
  const id=o.url.split('/').at(-1),row=db.Invoices[id];if(o.type==='GET')return inside({responseCode:200,responseText:JSON.stringify({data:row?[row]:[]})});
  if(o.headers['If-Unmodified-Since']!==row.Modified_Time)return inside({responseCode:412,responseText:JSON.stringify({code:'STALE'})});
  Object.assign(row,JSON.parse(o.parameters).data[0]);row.Modified_Time+='x';return inside({responseCode:200,responseText:JSON.stringify({data:[{code:'SUCCESS'}]})});
 };
 vm.runInContext(transpile(fs.readFileSync('crm/trip-invoice/tripInvoice_pdf.dg','utf8')),ctx);
 const run=(action,request={invoice_id:'2'})=>JSON.parse(ctx.tripInvoice_pdf('1',action,JSON.stringify(request)));
 return {db,calls,attachments,options,run,archive(){const p=run('pdf-prepare');assert.equal(p.success,true,p.message);return run('pdf-archive',{invoice_id:'2',snapshot_hash:p.snapshot_hash,base64:Buffer.from('%PDF-1.4\nfixture').toString('base64')})}};
}
test('PDF data freezes client details and archiving confirms one attachment reused on repeat',()=>{
 const f=setup(),p=f.run('pdf-prepare');assert.equal(p.success,true,p.message);f.db.Accounts[3].Account_Name='Changed';assert.equal(f.run('pdf-prepare').model.client.name,'Agencia Muñoz');
 const result=f.archive();assert.equal(result.success,true,result.message);assert.equal(result.file_id,'file1');assert.equal(f.db.Invoices[2].Invoice_PDF_State,'Ready');
 assert.equal(f.archive().attachment_id,'8');assert.deepEqual(f.calls,['upload','attach']);
});
test('lost attachment response or final checkpoint resumes by confirming the existing file without reupload',()=>{
 for(const options of [{lostAttach:true},{failReady:true}]){const f=setup(options);assert.equal(f.archive().success,false);const recovered=f.run('pdf-prepare');assert.equal(recovered.success,true,recovered.message);assert.equal(recovered.attachment_id,'8');assert.deepEqual(f.calls,['upload','attach']);}
});
test('uncertain upload blocks duplicate retries; historical documents and changed fiscal data cannot be reissued',()=>{
 const f=setup({failUpload:true});assert.equal(f.archive().success,false);assert.equal(f.run('pdf-prepare').success,false);assert.deepEqual(f.calls,['upload']);
 const old=setup();old.db.Invoices[2].Invoice_Origin='Tourplan';assert.equal(old.run('pdf-prepare').success,false);assert.equal(old.calls.length,0);
 const changed=setup();changed.run('pdf-prepare');changed.db.Invoices[2].Grand_Total=101;assert.equal(changed.run('pdf-prepare').success,false);
});


test('new PDF snapshot includes the reference invoice fields and freezes them at first preparation',()=>{
 const f=setup({guests:[{Forename:'Helen',Name:'Willingham'},{Forename:'Jennifer',Name:'Williamson'}]});
 Object.assign(f.db.Deals[1],{Contact_Name:{name:'Chesleigh Lloyd'},IATA_Code:'05504844',Sales_Rep:{name:'Silvia Menendez'},Reservation_Rep:{name:'Ops Representative'},No_De_PAX:'6',Arrival_Date:'2026-06-25',Departure_Date:'2026-06-30'});
 const p=f.run('pdf-prepare');assert.equal(p.success,true,p.message);assert.equal(p.model.template_version,'2');assert.equal(p.model.agent_name,'Chesleigh Lloyd');assert.equal(p.model.iata,'05504844');assert.equal(p.model.sales_rep,'Silvia Menendez');assert.equal(p.model.operations_rep,'Ops Representative');assert.match(p.model.guests,/Helen Willingham/);assert.equal(p.model.pax,'6');
 f.db.Deals[1].IATA_Code='CHANGED';assert.equal(f.run('pdf-prepare').model.iata,'05504844');
});
