const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('crm/cases_deleteBySubject.dg', 'utf8');
function run(options = {}) {
  const writes = [];
  let reads = 0;
  const context = vm.createContext({ options, writes, nextRead: () => reads++ });
  vm.runInContext(`
    class DM { constructor(o={}) { this.o=o; } put(k,v) { this.o[k]=v; } get(k) { return this.o[k]; } toString() { return JSON.stringify(this.o); } toJSON() { return this.o; } }
    function wrap(v) { return Array.isArray(v) ? v.map(wrap) : v && typeof v==='object' ? new DM(Object.fromEntries(Object.entries(v).map(([k,x])=>[k,wrap(x)]))) : v; }
    function Map() { return new DM(); } function List() { return []; }
    function ifnull(x,y) { return x==null ? y : x; }
    String.prototype.contains=function(x){return this.includes(x)};
    String.prototype.toList=function(x){return this.split(x)};
    String.prototype.toMap=function(){return wrap(JSON.parse(this))};
    Array.prototype.add=function(x){this.push(x)};
    Array.prototype.size=function(){return this.length};
    Array.prototype.contains=function(x){return this.includes(x)};
    var subjectContains=options.text ?? 'spam', dryRun=options.dryRun ?? true;
    function read() {
      const i=nextRead();
      const rows=options.pages?.[i] ?? (i===0 ? [{id:'1',Subject:'spam'},{id:'2',Subject:'spam'}] : []);
      if(options.readError) return wrap({responseCode:403});
      if(!rows.length) return wrap({responseCode:204});
      return wrap({responseCode:200,responseText:JSON.stringify({data:rows,info:{more_records:options.alwaysMore || i<(options.pages?.length??1)-1}})});
    }
    function remove(batch) {
      writes.push([...batch]);
      return wrap({data:batch.map(id=> id===options.failId ? {code:'RECORD_LOCKED',status:'error'} : {code:'SUCCESS',status:'success',details:{id}})});
    }
  `, context);
  let executable = source.replace(/^string standalone[^\n]+\n/, '')
    .replace(/invokeurl\s*\[[\s\S]*?\];/, 'read();')
    .replace(/invokeurl\s*\[[\s\S]*?\];/, 'remove(batch);')
    .replace(/for each (\w+) in ([^\n]+)\n/g, 'for (const $1 of $2)\n');
  return { result: JSON.parse(vm.runInContext('(function()' + executable + ')()', context)), writes };
}
test('dry run counts all pages without deletes', () => {
  const r=run({pages:[[{id:'1',Subject:'spam'}],[{id:'2',Subject:'spam'}]]});
  assert.equal(r.result.matchedCount,2); assert.equal(r.result.countComplete,true); assert.equal(r.result.success,true); assert.deepEqual(r.writes,[]);
});
test('empty and query metacharacters fail closed', () => {
  for(const text of ['', '  ', "a'b", 'a%b', 'a_b', 'a\\b']) {
    const r=run({text,dryRun:false}); assert.equal(r.result.success,false); assert.deepEqual(r.writes,[]);
  }
});
test('read errors cannot delete', () => {
  const r=run({dryRun:false,readError:true}); assert.equal(r.result.success,false); assert.deepEqual(r.writes,[]);
});
test('deletes snapshot in batches of at most 100', () => {
  const rows=Array.from({length:205},(_,i)=>({id:String(i+1),Subject:'spam'}));
  const r=run({dryRun:false,pages:[rows]});
  assert.equal(r.result.success,true); assert.equal(r.result.deleted,205); assert.deepEqual(r.writes.map(x=>x.length),[100,100,5]);
});
test('partial delete stops later batches and reports confirmed deletions', () => {
  const rows=Array.from({length:205},(_,i)=>({id:String(i+1),Subject:'spam'}));
  const r=run({dryRun:false,pages:[rows],failId:'2'});
  assert.equal(r.result.success,false); assert.equal(r.result.deleted,99); assert.equal(r.writes.length,1);
});
test('incomplete pagination permits deletion without expected count', () => {
  const pages=Array.from({length:10},(_,i)=>[{id:String(i+1),Subject:'spam'}]);
  const r=run({dryRun:false,pages,alwaysMore:true});
  assert.equal(r.result.success,true); assert.equal(r.result.countComplete,false); assert.equal(r.result.moreMatches,true); assert.equal(r.result.deleted,10); assert.equal(r.writes.length,1);
});
test('partial dry run remains read only and clearly reports more matches', () => {
  const pages=Array.from({length:10},(_,i)=>[{id:String(i+1),Subject:'spam'}]);
  const r=run({pages,alwaysMore:true});
  assert.equal(r.result.success,true); assert.equal(r.result.countComplete,false); assert.equal(r.result.moreMatches,true); assert.equal(r.result.deleted,0); assert.deepEqual(r.writes,[]);
});
