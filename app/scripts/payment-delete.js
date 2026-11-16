(function(global){
  'use strict';
  var ns=global.AccountingManagerApp=global.AccountingManagerApp||{};
  ns.createReliablePaymentDeletion=function(deps){
    var crm=deps.crm,storage=deps.storage,busy=false;
    function key(id){return 'accounting-manager:payment-delete:v1:'+id;}
    function pending(id){var raw=storage.getItem(key(id));if(!raw)return null;var job=JSON.parse(raw);if(job.version!==1||job.paymentId!==String(id)||!job.allocations||!Array.isArray(job.operations))throw Error('Unreadable payment deletion recovery. Review before continuing.');return job;}
    function persist(job){var raw=JSON.stringify(job);storage.setItem(key(job.paymentId),raw);if(storage.getItem(key(job.paymentId))!==raw)throw Error('Could not store payment deletion recovery.');}
    function lookup(v){return String(v&&v.id||v||'');}
    async function rows(module,field,id){var all=[],seen=new Set();for(var page=1;page<=25;page++){var batch=await crm.searchRecordPage(module,'('+field+':equals:'+id+')',page,200);if(!Array.isArray(batch))throw Error('Could not read '+module);for(var r of batch){if(!r.id||seen.has(String(r.id)))throw Error('Incomplete '+module+' list.');seen.add(String(r.id));all.push(r);}if(batch.length<200)return all;}throw Error('Related record limit reached.');}
    async function payment(id){var list=await rows('Supplier_Payments','id',id);if(list.length>1)throw Error('Ambiguous payment.');return list[0]||null;}
    function unlocked(p){if(deps.locked(p))throw Error('The payment is locked, reconciled or exported. Use a reversal.');}
    async function manage(id,allocations,preview){var response=await crm.executeFunction(deps.manageFunction,{supplierPaymentId:id,allocationsDataString:JSON.stringify({allocations:allocations,validate_only:Boolean(preview),undo_preview:Boolean(preview)})});var result=deps.output(response);if(!result||result.success!==true||result.error!==false)throw Error(result&&result.message||'Payment reconciliation is incomplete.');return result;}
    async function execute(id){
      id=String(id);if(!/^\d+$/.test(id))throw Error('Invalid payment ID.');
      if(busy)throw Error('Payment deletion is already running.');busy=true;
      async function run(){
        var job=pending(id),p=await payment(id);
        if(!job && global.sessionStorage && global.sessionStorage.getItem('accountingManager.paymentUndo.operations.'+id))throw Error('An older payment undo is pending. Its affected invoices must be reviewed before using the new recovery flow.');
        if(storage.getItem('accounting-manager:payment-allocation-edit:v1:'+id))throw Error('Finish the pending allocation correction before deleting this payment.');
        var pendingSave=JSON.parse(storage.getItem('accounting-manager:payment-save:v1')||'null');
        if(pendingSave&&(String(pendingSave.paymentId)===id||p&&pendingSave.operationKey===p.Invoice_Edit_Key))throw Error('Finish the pending payment registration before deleting it.');
        if(!job){
          if(!p)throw Error('Payment is unavailable.');unlocked(p);
          var entries=await deps.accountingEntries(id);if(entries.length||lookup(p.Accounting_Entry))throw Error('Review existing accounting links before deleting the payment.');
          var links=await rows('Supplier_Pay_Allocations','Supplier_Payment',id),allocations={};
          for(var link of links){var invoiceId=lookup(link.Supplier_Invoice);if(!invoiceId||Object.hasOwn(allocations,invoiceId))throw Error('Missing or duplicate invoice allocations.');allocations[invoiceId]=0;}
          await manage(id,allocations,true);
          var operations=await ns.preparePaymentOperationUndo(crm,id);
          for(var op of operations){var record=await crm.getRecord(op.module,op.id);if(!record||!record.id)throw Error('Linked source could not be read.');op.before={};for(var field of Object.keys(op.fields))op.before[field]=record[field]===undefined?null:record[field];}
          job={version:1,paymentId:id,payment:p,allocations:allocations,links:links,operations:operations,reconciled:false};persist(job);
        }
        if(p){
          unlocked(p);
          if((await deps.accountingEntries(id)).length||lookup(p.Accounting_Entry))throw Error('Review existing accounting links before deleting the payment.');
          for(var field of ['Status','Currency','Payment_Date','Payment_Account'])if(lookup(p[field])!==lookup(job.payment[field]))throw Error('Payment changed outside this deletion. Review before resuming.');
          if(Number(p.Payment_Amount)!==Number(job.payment.Payment_Amount)&&Number(p.Payment_Amount)!==0)throw Error('Payment amount changed outside this deletion.');
          for(var live of await rows('Supplier_Pay_Allocations','Supplier_Payment',id)){var original=job.links.find(function(r){return String(r.id)===String(live.id);});if(!original||lookup(original.Supplier_Invoice)!==lookup(live.Supplier_Invoice)||Number(original.Allocated_Amount)!==Number(live.Allocated_Amount))throw Error('Payment allocations changed outside this deletion.');}
          for(var source of await ns.preparePaymentOperationUndo(crm,id))if(!job.operations.some(function(op){return op.module===source.module&&op.id===source.id;}))throw Error('A new source was linked to the payment.');
          // Validate every snapshot before detaching any source; allow own completed writes on retry.
          for(var op of job.operations){var record=await crm.getRecord(op.module,op.id);if(!record||!record.id)throw Error('A source record disappeared.');for(var field of Object.keys(op.fields)){if(lookup(record[field])!==lookup(op.before[field])&&lookup(record[field])!==lookup(op.fields[field]))throw Error('A source changed outside this deletion: '+op.module+' '+op.id);}}
          await manage(id,job.allocations,true);
          await ns.applyPaymentOperationUndo(crm,job.operations,deps.assertSuccess);
          await manage(id,job.allocations,false);
          job.reconciled=true;persist(job);
          // Parent is removed last, after all invoices, sources, settlements and services.
          if((await rows('Supplier_Pay_Allocations','Supplier_Payment',id)).length)throw Error('Payment still has allocations.');
          if((await deps.accountingEntries(id)).length||(await ns.preparePaymentOperationUndo(crm,id)).length)throw Error('New accounting or source links appeared before deletion.');
          var finalPayment=await payment(id);if(finalPayment){unlocked(finalPayment);if(lookup(finalPayment.Accounting_Entry))throw Error('An accounting link appeared before deletion. Review before resuming.');for(var field of ['Status','Currency','Payment_Date','Payment_Account'])if(lookup(finalPayment[field])!==lookup(job.payment[field]))throw Error('Payment changed before deletion.');if(Number(finalPayment.Payment_Amount)!==0)throw Error('Payment changed before deletion.');deps.assertSuccess(await crm.deleteRecord('Supplier_Payments',id),'Payment deletion was not confirmed.');}
        }else if(!job.reconciled){throw Error('Payment disappeared before related updates were confirmed. Review recovery.');}
        await deps.refresh(id);storage.removeItem(key(id));return {success:true,deletedAllocationCount:job.links.length};
      }
      try{return await (global.navigator&&global.navigator.locks?global.navigator.locks.request(key(id),run):run());}finally{busy=false;}
    }
    return {execute:execute,pending:pending};
  };
}(window));
