const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function setup(file,name,next,extras){const source=fs.readFileSync(file,'utf8'),start=source.indexOf('    async function '+name+'('),end=source.indexOf('    '+next,start);const context=vm.createContext(extras);vm.runInContext(source.slice(start,end),context);return context[name];}
test('creation refreshes independent views concurrently and waits for both before reporting failure',async()=>{
 const supplier=deferred(),table=deferred(),calls=[],state={currentTab:'invoices',loaded:{},views:{invoices:{hasLoaded:true}},records:{}};
 const run=setup('app/scripts/invoice-create.js','refreshInvoicesAfterCreate','function renderInvoiceCreatePanel(',{state,renderAll(){calls.push('render');},refreshSupplierRelatedActivity(){calls.push('supplier');return supplier.promise;},refreshInvoicesTabData(){calls.push('table');return table.promise;}});
 let settled=false;const result=run('1').finally(()=>{settled=true;});const rejected=assert.rejects(result,/failed/);
 assert.deepEqual(calls,['supplier','table']);supplier.reject(Error('failed'));await new Promise(r=>setImmediate(r));assert.equal(settled,false);
 table.resolve();await rejected;assert.ok(!calls.includes('render'));
});
test('payment and invoice refresh fetch concurrently and cannot replace another supplier workspace',async()=>{
 const invoices=deferred(),payments=deferred(),calls=[],state={currentTab:'suppliers',supplierId:'1',loaded:{},records:{},views:{invoices:{},payments:{}},supplierInvoices:['current'],supplierPayments:['current']};
 const run=setup('app/scripts/payment-create.js','refreshInvoicesAndPaymentsAfterSupplierPayment','async function submitCorrectionPayment(',{state,resetPaymentRelationshipIndexes(){},async ensurePayAllocationsLoaded(){},loadInvoicesForSupplier(id){calls.push('invoice:'+id);return invoices.promise;},loadPaymentsForSupplier(id){calls.push('payment:'+id);return payments.promise;}});
 const result=run();await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['invoice:1','payment:1']);state.supplierId='2';invoices.resolve(['old']);payments.resolve(['old']);await result;
 assert.deepEqual(state.supplierInvoices,['current']);assert.deepEqual(state.supplierPayments,['current']);
});
