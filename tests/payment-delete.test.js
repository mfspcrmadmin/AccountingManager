const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(failure){const db={payment:{id:'3',Payment_Amount:100,Status:'Paid',Currency:'EUR',Payment_Date:'2026-10-19'},links:[{id:'4',Supplier_Payment:{id:'3'},Supplier_Invoice:{id:'1'},Allocated_Amount:100}],source:{id:'7',Vendor_Payment:{id:'3'},Accounting_Status:'Prepayment recorded'}},store=new Map(),calls=[];let fail=failure;
 const window={AccountingManagerApp:{},navigator:{locks:{request:(_,fn)=>fn()}}};vm.runInNewContext(fs.readFileSync('app/scripts/payment-delete.js','utf8'),{window});const ns=window.AccountingManagerApp;
 const success={data:[{code:'SUCCESS'}]},check=where=>{if(fail===where){fail='';throw Error('Injected '+where);}};
 ns.preparePaymentOperationUndo=async()=>db.source.Vendor_Payment?[{module:'Prepayments',id:'7',fields:{Vendor_Payment:null,Accounting_Status:'Pending payment record'}}]:[];
 ns.applyPaymentOperationUndo=async(_,ops)=>{for(const op of ops)Object.assign(db.source,op.fields);check('source');};
 const deps={storage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},locked:p=>p.Status==='Reconciled',accountingEntries:async()=>[],manageFunction:'manage',output:r=>r,assertSuccess:r=>assert.equal(r.data[0].code,'SUCCESS'),refresh:async()=>{check('refresh');calls.push('refresh');},crm:{searchRecordPage:async m=>{check('read');return m==='Supplier_Payments'?(db.payment?[structuredClone(db.payment)]:[]):structuredClone(db.links);},getRecord:async()=>structuredClone(db.source),executeFunction:async(_,args)=>{const request=JSON.parse(args.allocationsDataString);calls.push(request);if(!request.validate_only){assert.equal(db.source.Vendor_Payment,null);db.links=[];check('reconcile');db.payment.Payment_Amount=0;}return {success:true,error:false};},deleteRecord:async()=>{assert.equal(db.links.length,0);assert.equal(db.payment.Payment_Amount,0);db.payment=null;check('delete');return success;}}};
 return {db,store,calls,deps,make:()=>ns.createReliablePaymentDeletion(deps),fail:v=>{fail=v;}};
}
for(const failure of ['source','reconcile','delete','refresh'])test('payment undo resumes after '+failure+' failure, including a fresh module',async()=>{const f=fixture(failure);await assert.rejects(f.make().execute('3'));assert.equal(f.store.size,1);await f.make().execute('3');assert.equal(f.db.payment,null);assert.equal(f.db.links.length,0);assert.equal(f.store.size,0);assert.ok(f.calls.some(c=>c.allocations?.['1']===0));});
test('unreadable allocations stop deletion without mutation',async()=>{const f=fixture('read');await assert.rejects(f.make().execute('3'));assert.equal(f.db.payment.Payment_Amount,100);assert.equal(f.db.links.length,1);assert.equal(f.store.size,0);});
test('an allocation added after partial failure is not silently removed',async()=>{const f=fixture('source');await assert.rejects(f.make().execute('3'));f.db.links.push({id:'9',Supplier_Invoice:{id:'2'},Allocated_Amount:1});await assert.rejects(f.make().execute('3'),/allocations changed/);assert.ok(f.db.payment);});
test('external source changes block recovery',async()=>{const f=fixture('source');await assert.rejects(f.make().execute('3'));f.db.source.Vendor_Payment={id:'99'};await assert.rejects(f.make().execute('3'),/source changed/);assert.ok(f.db.payment);});
test('reconciled payments and accounting links block deletion',async()=>{for(const lock of ['status','accounting']){const f=fixture();if(lock==='status')f.db.payment.Status='Reconciled';else f.deps.accountingEntries=async()=>[{id:'entry'}];await assert.rejects(f.make().execute('3'));assert.equal(f.db.links.length,1);}});

test('a direct accounting link appearing at final read blocks parent deletion and retains recovery',async()=>{
 const f=fixture(),search=f.deps.crm.searchRecordPage;let paymentReads=0;
 f.deps.crm.searchRecordPage=async(...args)=>{if(args[0]==='Supplier_Payments'&&++paymentReads===2)f.db.payment.Accounting_Entry={id:'88'};return search(...args);};
 await assert.rejects(f.make().execute('3'),/accounting link appeared/);
 assert.ok(f.db.payment);assert.equal(f.store.size,1);assert.equal(f.db.payment.Accounting_Entry.id,'88');
 await assert.rejects(f.make().execute('3'),/accounting links/);assert.ok(f.db.payment);
});
