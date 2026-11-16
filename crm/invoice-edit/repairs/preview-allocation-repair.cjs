const fs = require('node:fs');
const vm = require('node:vm');
const { transpile } = require('../../../tests/helpers/deluge-registration-harness');
const dir = __dirname;
const verification = process.argv.includes('--verify');
const backup = verification ? { ...JSON.parse(fs.readFileSync(dir + '/20261013-verification.json')).after, allocationUpdates: [] } : JSON.parse(fs.readFileSync(dir + '/20261013-allocation-backup.json'));
const db = Object.fromEntries(Object.entries({Inv_Set_Allocations:backup.allocations,Supplier_Invoices:backup.invoices,Supplier_Settlements:backup.settlements,Supplier_Pay_Allocations:backup.paymentAllocations}).map(([m,rows])=>[m,Object.fromEntries(rows.map(r=>[r.id,structuredClone(r)]))]));
db.Supplier_Payments = {};
for(const r of backup.paymentAllocations) if(r.Supplier_Payment) db.Supplier_Payments[r.Supplier_Payment.id]={id:r.Supplier_Payment.id,Status:r['Supplier_Payment.Status']};
for(const r of backup.allocationUpdates) Object.assign(db.Inv_Set_Allocations[r.id],r);
const ctx = vm.createContext({});
vm.runInContext(`
function Map(){return {};} function List(){return [];} function ifnull(v,b){return v==null?b:v;}
Object.defineProperties(Object.prototype,{
 get:{value:function(k){return this[k]??null;}}, put:{value:function(k,v){this[k]=v;}},
 containKey:{value:function(k){return Object.hasOwn(this,k);}},keys:{value:function(){return Object.keys(this);}},
 isEmpty:{value:function(){return Object.keys(this).length===0;}},toString:{value:function(){return JSON.stringify(this);},configurable:true}
});
Array.prototype.add=function(v){this.push(v);};Array.prototype.size=function(){return this.length;};
String.prototype.toMap=function(){return JSON.parse(this);};String.prototype.toList=function(s){return this.split(s);};
String.prototype.toLong=function(){return this.length>15?String(this):Number(this);};
String.prototype.toDecimal=function(){return Number(this);};
Number.prototype.toLong=Number.prototype.toDecimal=function(){return Number(this);};
Number.prototype.round=function(n){return Math.round((Number(this)+Number.EPSILON)*10**n)/10**n;};
`,ctx);
const inside=o=>vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(o))+')',ctx);
const writes=[];
ctx.zoho={crm:{getRecordById:(m,id)=>inside(db[m]?.[id]||{}),updateRecord:(m,id,values)=>{if(m!=='Supplier_Settlements')throw Error('Unexpected write');const data=JSON.parse(JSON.stringify(values));writes.push({id:String(id),...data});Object.assign(db[m][id],data);return inside({id:String(id)});}}};
ctx.invoke=options=>{
 if(!options.url.endsWith('/coql'))throw Error('Unexpected API');
 const query=JSON.parse(options.parameters).select_query;
 const match=query.match(/from (\w+) where (\w+) = '([^']+)' order by id asc limit (\d+), 200/);
 if(!match)throw Error('Unsupported query: '+query);
 const [,m,f,v,offset]=match;
 const rows=Object.values(db[m]||{}).filter(r=>String(typeof r[f]==='object'?r[f]?.id:r[f])===v).sort((a,b)=>a.id.localeCompare(b.id)).slice(Number(offset),Number(offset)+200);
 return inside({responseCode:rows.length?200:204,responseText:JSON.stringify({data:rows})});
};
vm.runInContext(transpile(fs.readFileSync(dir+'/20261013-rebuild-production.dg','utf8')),ctx);
const result=JSON.parse(JSON.stringify(ctx.rebuildSupplierSettlementTotals(backup.settlements.map(r=>r.id).join('|||'))));
if(result.error || result.processed_count!==backup.settlements.length)throw Error(JSON.stringify(result));
fs.writeFileSync(dir+(verification?'/20261013-rebuild-verification.json':'/20261013-settlement-plan.json'),JSON.stringify({result,writes},null,2));
if(verification && writes.length) throw Error('Settlement totals still require updates: '+JSON.stringify(writes));
console.log(JSON.stringify({processed:result.processed_count,updates:writes.length,warnings:result.warnings},null,2));
