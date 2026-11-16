// Executes the registration Deluge source with CRM calls replaced by an in-memory
// fake. This checks control flow and recovery, not the Zoho compiler/API contract.
const fs = require('node:fs');
const vm = require('node:vm');
function transpile(source) {
  const signature = source.match(/^string standalone\.(\w+)\(([^)]*)\)/);
  const args = signature[2].split(',').map(a => a.trim().split(/\s+/).pop()).filter(Boolean);
  let body = source.slice(signature[0].length);
  body = body.replace(/\.length\(\)/g, '.length');
  const vars = [...new Set([...body.matchAll(/\b([A-Za-z_]\w*)\s*=(?!=)/g)].map(m => m[1]))].filter(v => !args.includes(v));
  body = body.replace(/for each\s+(\w+) in ([^\n]+)\n/g, 'for (const $1 of $2)\n');
  body = body.replace(/invokeurl\s*\[([\s\S]*?)\]/g, (_, block) => {
    const properties = block.trim().split('\n').map(line => {
      const match = line.trim().match(/^(\w+)\s*:(.*)$/);
      if (!match) { throw Error('Unsupported invokeurl line: ' + line); }
      return match[1] + ':' + (/^(GET|POST|PUT|DELETE)$/.test(match[2].trim()) ? JSON.stringify(match[2].trim()) : match[2]);
    });
    return 'invoke({' + properties.join(',') + '})';
  });
  body = body.replace('{{"File_Id__s":fileId}}', '[{"File_Id__s":fileId}]')
    .replace('{"data":{payload},"trigger":{"workflow"}}', '{"data":[payload],"trigger":["workflow"]}');
  return 'function ' + signature[1] + '(' + args.join(',') + ') ' + body.replace('{', '{\nlet ' + vars.join(',') + ';');
}
function harness(seed, failures = {}) {
  const database = JSON.parse(JSON.stringify(seed));
  const writes = [];
  let nextId = 1000;
  const context = vm.createContext({ console });
  vm.runInContext(`
    function Map() { return {}; } function List() { return []; }
    function ifnull(v, fallback) { return v == null ? fallback : v; }
    Object.defineProperties(Object.prototype, {
      get: {value:function(k){return this[k] == null ? null : this[k];}},
      put: {value:function(k,v){this[k]=v;}},
      containKey: {value:function(k){return Object.hasOwn(this,k);}},
      keys: {value:function(){return Object.keys(this);}},
      isEmpty: {value:function(){return Object.keys(this).length===0;}},
      toString: {value:function(){return JSON.stringify(this);}, configurable:true}
    });
    Array.prototype.add=function(v){this.push(v);}; Array.prototype.size=function(){return this.length;};
    Array.prototype.contains=function(v){return this.includes(v);};
    String.prototype.toMap=function(){return JSON.parse(this);}; String.prototype.toList=function(s){return this.split(s);};
    String.prototype.matches=function(s){return new RegExp('^(?:'+s+')$').test(this);};
    String.prototype.replaceAll=function(pattern,replacement){return this.replace(new RegExp(pattern,'g'),replacement);};
    String.prototype.toDecimal=String.prototype.toLong=function(){if(!Number.isFinite(Number(this)))throw Error('Invalid number');return Number(this);};
    Number.prototype.toDecimal=Number.prototype.toLong=function(){return Number(this);};
    Number.prototype.round=function(n){return Math.round(Number(this)*10**n)/10**n;};
    String.prototype.toDate=function(){const d=new Date(this+'T00:00:00Z');return {toString:function(){return d.toISOString().slice(0,10);}};};
  `, context);
  const inside = obj => vm.runInContext('JSON.parse(' + JSON.stringify(JSON.stringify(obj)) + ')', context);
  function get(module, id) { return inside(database[module]?.[id] || {}); }
  function create(module, data) {
    const values = JSON.parse(JSON.stringify(data));
    if (failures[module]) { failures[module]--; return inside({ code: 'INVALID_DATA', status: 'error', message: 'Injected rejection' }); }
    database[module] ||= {};
    const existing = Object.values(database[module]).find(r => r.Registration_Key === values.Registration_Key || module === 'Supplier_Invoices' && r.Name === values.Name);
    if (existing) { return inside({ code: 'DUPLICATE_DATA', status: 'error', details: { id: existing.id } }); }
    const id = String(nextId++);
    database[module][id] = { id, ...values };
    writes.push({ module, id, data: values });
    return inside({ id });
  }
  context.zoho = { crm: { getRecordById: get, createRecord: create, updateRecord(module, id, values) {
    Object.assign(database[module][id], JSON.parse(JSON.stringify(values)));
    return inside({ id: String(id) });
  } } };
  context.invoke = options => {
    const body = JSON.parse(options.parameters);
    if (options.url.endsWith('/coql')) {
      if (failures.coql) { failures.coql--; return inside({ responseCode: 503, responseText: 'Unavailable' }); }
      const match = body.select_query.match(/from (\w+) where (\w+) = '([^']+)' order by id asc limit (\d+), 200/);
      const [, module, field, value, offset] = match;
      if (module === 'Supplier_Invoices' && failures.hideInvoiceOnce) {
        failures.hideInvoiceOnce--;
        return inside({ responseCode: 204, responseText: '' });
      }
      const records = Object.values(database[module] || {}).filter(r => String(typeof r[field] === 'object' ? r[field]?.id : r[field]) === value).slice(Number(offset), Number(offset) + 200).map(r => ({ id: r.id }));
      return inside({ responseCode: records.length ? 200 : 204, responseText: JSON.stringify({ data: records }) });
    }
    const created = create('Supplier_Invoices', body.data[0]);
    if (created.id) { return inside({ data: [{ status: 'success', code: 'SUCCESS', details: { id: created.id } }] }); }
    return inside({ data: [created] });
  };
  vm.runInContext('var standalone = {};', context);
  for (const file of ['supplierInvoiceRegistration_read', 'supplierInvoiceRegistration_ensureRecord', 'supplierInvoice_discardRegistration', 'supplierInvoice_register']) {
    vm.runInContext(transpile(fs.readFileSync('crm/' + file + '.dg', 'utf8')), context);
    context.standalone[file] = context[file];
  }
  context.standalone.rebuildSupplierSettlementTotals = () => JSON.stringify({ error: Boolean(failures.rebuild), message: failures.rebuild ? 'Rebuild failed' : 'Done' });
  context.standalone.supplierInvoiceEdit_read = (module, field, id) => JSON.stringify({success: !failures.discardRead, records: Object.values(database[module] || {}).filter(row => String(row[field]?.id || row[field]) === String(id))});
  context.standalone.supplierInvoiceEdit_write = (module, id, version, changes) => {
    if (failures.conflict) return JSON.stringify({error:true,conflict:true});
    Object.assign(database[module][id], JSON.parse(JSON.stringify(changes)));
    return JSON.stringify({error:false});
  };
  return { database, writes, failures, run: (key, request) => JSON.parse(context.supplierInvoice_register(key, JSON.stringify(request))) };
}
module.exports = { harness, transpile };
