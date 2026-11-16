(function (global) {
  'use strict';
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var fields = {
    Deals: 'id, Deal_Name, MFSP_Reference',
    Supplier_Invoices: 'id, Name, Booking, Supplier, Supplier_Settlement, Currency, Invoice_Type, Invoice_Total, Total_Payable_Amount, Amount_Paid, Status, Registration_Status, Edit_Status',
    Supplier_Payments: 'id, Name, Currency, Payment_Amount, Status, Movement_Type, Allocation_Count, Supplier_Count, Booking_Count, Settlement_Count',
    Supplier_Pay_Allocations: 'id, Name, Booking, Supplier_Invoice, Supplier_Payment, Allocated_Amount, Currency, Payment_Status, Invoice_Status',
    Supplier_Settlements: 'id, Name, Booking, Currency, Service_Count, Total_Service_Cost, Total_Invoice, Total_Paid, Gross_Invoice_Amount, Credit_Note_Amount',
    Inv_Set_Allocations: 'id, Vendor_Invoice, Vendor_Settlement, Allocated_Amount, Status',
    Prepayments: 'id, Name, Amount, Currency, Accounting_Status, Vendor_Payment, Prepayment_Request',
    Card_Purchases: 'id, Name, Amount, Currency, Accounting_Status, Vendor_Payment, Vendor_Invoice, Transaction_Type'
  };
  function id(v) { return String(v && v.id || ''); }
  function unique(values) { return Array.from(new Set(values.filter(Boolean))); }
  function merge(a,b) { return Array.from(new Map(a.concat(b).map(function (r) { return [id(r),r]; })).values()); }
  function numeric(value) { if (!/^\d+$/.test(String(value))) throw Error('Invalid record ID.'); return String(value); }
  function money(value) { if (value === null || value === undefined || value === '') return null; var n=Number(value); return Number.isFinite(n) && Math.abs(n*100-Math.round(n*100))<0.00001 ? Math.round(n*100) : null; }
  function active(i) { return !['Cancelled','Rejected'].includes(i.Status); }
  function ready(i) { return i.Registration_Status !== 'Pending' && i.Edit_Status !== 'Pending'; }
  function paid(p) { return ['Paid','Reconciled'].includes(p.Status); }
  function activeSplit(a) { return !['Void','Cancelled'].includes(a.Status); }
  ns.createConsistencyReader = function (crm) {
    async function rows(module,where) {
      var result=[], seen=new Set();
      for (var offset=0;offset<5000;offset+=200) {
        var batch=await crm.coql('select '+fields[module]+' from '+module+' where '+where+' order by id asc limit '+offset+', 200',{strict:true});
        if (!Array.isArray(batch)) throw Error('Incomplete read: '+module);
        batch.forEach(function (r) { if (!/^\d+$/.test(id(r)) || seen.has(id(r))) throw Error('Incomplete or repeated results: '+module);seen.add(id(r));result.push(r); });
        if(batch.length<200)return result;
      }
      throw Error('The review reached its record limit for '+module+'. No complete result can be reported.');
    }
    async function related(module,field,ids) {
      var result=[]; ids=unique(ids);
      for(var start=0;start<ids.length;start+=50) result=merge(result,await rows(module,field+' in ('+ids.slice(start,start+50).map(numeric).join(',')+')'));
      return result;
    }
    async function search(text) {
      text=String(text||'').trim();if(text.length<3)throw Error('Enter at least three characters of a booking reference or its record ID.');
      if(/^\d+$/.test(text))return rows('Deals','id = '+numeric(text));
      // An exact booking reference avoids ambiguous wildcard matches and escaping.
      if(!/^[\w-]{3,80}$/.test(text))throw Error('Enter the booking reference (for example TEST2026-003) or record ID.');
      return rows('Deals',"MFSP_Reference = '"+text+"'");
    }
    async function scan(bookingId,progress) {
      numeric(bookingId);progress=progress||function(){};
      progress('Reading invoices, payments and settlements…');
      var initial=await Promise.all([
        rows('Supplier_Invoices','Booking = '+bookingId),Promise.resolve([]),
        rows('Supplier_Settlements','Booking = '+bookingId),rows('Supplier_Pay_Allocations','Booking = '+bookingId),
        rows('Prepayments','Prepayment_Request.Booking = '+bookingId),rows('Card_Purchases','Booking = '+bookingId)
      ]);
      var invoices=initial[0],payments=initial[1],settlements=initial[2],allocations=initial[3],prepayments=initial[4],cards=initial[5];
      progress('Reading all related allocations, including shared payments…');
      var splits=await related('Inv_Set_Allocations','Vendor_Settlement',settlements.map(id));
      invoices=merge(invoices,await related('Supplier_Invoices','id',splits.map(function(s){return id(s.Vendor_Invoice);}))); 
      var scopeInvoiceIds=invoices.map(id);
      allocations=merge(allocations,await related('Supplier_Pay_Allocations','Supplier_Invoice',scopeInvoiceIds));
      var paymentIds=unique(payments.map(id).concat(allocations.map(function(a){return id(a.Supplier_Payment);}),prepayments.concat(cards).map(function(s){return id(s.Vendor_Payment);}))); 
      payments=merge(payments,await related('Supplier_Payments','id',paymentIds));
      allocations=merge(allocations,await related('Supplier_Pay_Allocations','Supplier_Payment',paymentIds));
      invoices=merge(invoices,await related('Supplier_Invoices','id',allocations.map(function(a){return id(a.Supplier_Invoice);}))); 
      splits=merge(splits,await related('Inv_Set_Allocations','Vendor_Invoice',invoices.map(id)));
      return {bookingId:bookingId,scopeInvoiceIds:scopeInvoiceIds,invoices:invoices,payments:payments,allocations:allocations,settlements:settlements,splits:splits,prepayments:prepayments,cards:cards};
    }
    return {search:search,scan:scan};
  };
  ns.isStatusCopyFinding = function (row) {
    return row.module==='Supplier_Pay_Allocations' && row.kind==='status' && ['Invoice status copy','Payment status copy'].includes(row.description);
  };
  ns.createStatusCopySync = function (crm) {
    var running=false;
    return async function (bookingId,findings,progress) {
      if(running)throw Error('Status synchronization is already running.');
      numeric(bookingId);running=true;
      var report={verified:0,failed:[]},targets=new Map();
      findings.filter(ns.isStatusCopyFinding).forEach(function(row){
        var fields=targets.get(row.id)||new Set();fields.add(row.description==='Invoice status copy'?'Invoice_Status':'Payment_Status');targets.set(row.id,fields);
      });
      async function read(module,recordId){
        var record=await crm.getRecord(module,numeric(recordId));
        if(!record||id(record)!==recordId)throw Error('A related record is no longer available.');
        if(record.Locked__s||record.Edit_Status==='Pending'||record.Registration_Status==='Pending')throw Error('Finish the pending operation or unlock the record first.');
        return record;
      }
      async function current(allocationId){
        var a=await read('Supplier_Pay_Allocations',allocationId);
        var linked=await Promise.all([read('Supplier_Invoices',id(a.Supplier_Invoice)),read('Supplier_Payments',id(a.Supplier_Payment))]);
        // An inconsistent booking relationship needs manual review, not a copy fix.
        if(id(linked[0].Booking)!==bookingId||(id(a.Booking)&&id(a.Booking)!==bookingId))throw Error('The allocation no longer belongs to this booking.');
        return {allocation:a,Invoice_Status:linked[0].Status,Payment_Status:linked[1].Status};
      }
      try {
        for(var entry of targets){
          var allocationId=entry[0],fields=entry[1];
          try {
            var fresh=await current(allocationId),changes={};
            fields.forEach(function(field){
              if(typeof fresh[field]!=='string'||!fresh[field])throw Error('The source status is missing.');
              if(fresh.allocation[field]!==fresh[field])changes[field]=fresh[field];
            });
            if(Object.keys(changes).length){
              var response=await crm.updateRecord('Supplier_Pay_Allocations',allocationId,changes,{trigger:[]});
              if(!response||!Array.isArray(response.data)||response.data.length!==1||response.data[0].code!=='SUCCESS')throw Error('The status update was not confirmed. Run again to retry safely.');
            }
            var verified=await current(allocationId);
            fields.forEach(function(field){if(verified.allocation[field]!==verified[field])throw Error('The related status changed during synchronization. Run again.');});
            report.verified++;
          }catch(error){report.failed.push({id:allocationId,message:error.message||'Synchronization failed.'});}
          if(progress)progress(report.verified+report.failed.length,targets.size);
        }
        return report;
      }finally{running=false;}
    };
  };
  ns.analyzeConsistency = function (graph) {
    var findings=[], invoices=new Map(graph.invoices.map(function(r){return[id(r),r];})), payments=new Map(graph.payments.map(function(r){return[id(r),r];}));
    var badInvoices=new Set(),badPayments=new Set();
    var scopeInvoices=new Set(graph.scopeInvoiceIds),scopeSettlements=new Set(graph.settlements.map(id));
    function add(kind,module,record,description,stored,expected) {
      // External records are calculation inputs for shared payments, not issues
      // belonging to this booking. Keep full-graph validation and arithmetic.
      if(module==='Supplier_Pay_Allocations'&&!scopeInvoices.has(id(record.Supplier_Invoice))&&!(graph.bookingId&&id(record.Booking)===String(graph.bookingId)))return;
      if(module==='Inv_Set_Allocations'&&!scopeInvoices.has(id(record.Vendor_Invoice))&&!scopeSettlements.has(id(record.Vendor_Settlement)))return;
      findings.push({kind:kind,module:module,id:id(record),name:record.Name||id(record),description:description,stored:stored,expected:expected,currency:record.Currency||''});
    }
    // Canonical rebuilds treat empty aggregate fields as zero (ifnull(...,0)).
    function amount(module,r,field,expected) { var stored=money(r[field]==null?0:r[field]); if(stored!==expected)add('amount',module,r,field,stored===null?'Invalid amount':stored/100,expected/100); }
    var pairs=new Set();
    graph.allocations.forEach(function(a){
      var i=invoices.get(id(a.Supplier_Invoice)),p=payments.get(id(a.Supplier_Payment)),value=money(a.Allocated_Amount),pair=id(a.Supplier_Payment)+'/'+id(a.Supplier_Invoice);
      if(!i||!p){add('relation','Supplier_Pay_Allocations',a,'Allocation has no readable invoice or payment.');badInvoices.add(id(a.Supplier_Invoice));badPayments.add(id(a.Supplier_Payment));return;}
      if(pairs.has(pair)){add('relation','Supplier_Pay_Allocations',a,'Duplicate payment/invoice allocation.');badInvoices.add(id(i));badPayments.add(id(p));}pairs.add(pair);
      if(value===null||value<0||!i.Currency||i.Currency!==p.Currency||a.Currency!==i.Currency){add('review','Supplier_Pay_Allocations',a,'Invalid amount or different/missing currencies. Financial comparison skipped; review conversion.');badInvoices.add(id(i));badPayments.add(id(p));}
      if(a.Payment_Status!==p.Status)add('status','Supplier_Pay_Allocations',a,'Payment status copy',a.Payment_Status||'Not recorded',p.Status);
      if(a.Invoice_Status!==i.Status)add('status','Supplier_Pay_Allocations',a,'Invoice status copy',a.Invoice_Status||'Not recorded',i.Status);
    });
    graph.invoices.forEach(function(i){if(!ready(i)){badInvoices.add(id(i));if(graph.scopeInvoiceIds.includes(id(i)))add('review','Supplier_Invoices',i,'Invoice registration or correction is pending. Financial comparison skipped.');}});
    graph.scopeInvoiceIds.forEach(function(invoiceId){
      var i=invoices.get(invoiceId);if(!i||!ready(i))return;
      var allocations=graph.allocations.filter(function(a){return id(a.Supplier_Invoice)===invoiceId;}),payable=money(i.Total_Payable_Amount==null?i.Invoice_Total:i.Total_Payable_Amount);
      if(payable===null||payable<0){badInvoices.add(invoiceId);add('review','Supplier_Invoices',i,'Invalid or missing payable amount.');}
      if(badInvoices.has(invoiceId))return;
      var total=allocations.reduce(function(n,a){return n+(paid(payments.get(id(a.Supplier_Payment)))?money(a.Allocated_Amount):0);},0);
      var reserved=allocations.reduce(function(n,a){return n+(payments.get(id(a.Supplier_Payment)).Status!=='Cancelled'?money(a.Allocated_Amount):0);},0);
      if(!active(i)){if(reserved>0)add('relation','Supplier_Invoices',i,'Cancelled or rejected invoice still has payment allocations.');return;}
      amount('Supplier_Invoices',i,'Amount_Paid',total);
      if(reserved>payable)add('amount','Supplier_Invoices',i,'Allocations exceed the payable',reserved/100,payable/100);
      var status=total>=payable&&payable>0?'Paid':total>0?'Partially Paid':'Received';
      if(['Received','Partially Paid','Paid'].includes(i.Status)&&i.Status!==status)add('status','Supplier_Invoices',i,'Financial invoice status',i.Status,status);
    });
    graph.payments.forEach(function(p){
      var allocations=graph.allocations.filter(function(a){return id(a.Supplier_Payment)===id(p);});
      if(badPayments.has(id(p))||allocations.some(function(a){return badInvoices.has(id(a.Supplier_Invoice));})){add('review','Supplier_Payments',p,'Payment totals not compared because a related invoice or allocation needs review.');return;}
      var total=allocations.reduce(function(n,a){return n+money(a.Allocated_Amount)*(invoices.get(id(a.Supplier_Invoice)).Invoice_Type==='Credit Note'?-1:1);},0);
      amount('Supplier_Payments',p,'Payment_Amount',Math.abs(total));
      if(total!==0&&p.Movement_Type!==(total<0?'Supplier Refund':'Outbound Payment'))add('status','Supplier_Payments',p,'Payment movement type',p.Movement_Type,total<0?'Supplier Refund':'Outbound Payment');
      var positive=allocations.filter(function(a){return money(a.Allocated_Amount)>0;}),linked=positive.map(function(a){return invoices.get(id(a.Supplier_Invoice));});
      var settlementIds=linked.map(function(i){return id(i.Supplier_Settlement);}).concat(graph.splits.filter(function(s){return activeSplit(s)&&linked.some(function(i){return id(i)===id(s.Vendor_Invoice);});}).map(function(s){return id(s.Vendor_Settlement);}));
      var counts={Allocation_Count:positive.length,Supplier_Count:unique(linked.map(function(i){return id(i.Supplier);})).length,Booking_Count:unique(linked.map(function(i){return id(i.Booking);})).length,Settlement_Count:unique(settlementIds).length};
      Object.keys(counts).forEach(function(field){if(p[field]==null||Number(p[field])!==counts[field])add('status','Supplier_Payments',p,field,p[field]==null?'Not recorded':p[field],counts[field]);});
    });
    var badSettlements=new Set(),splitPairs=new Set();
    graph.splits.filter(activeSplit).forEach(function(s){
      var pair=id(s.Vendor_Invoice)+'/'+id(s.Vendor_Settlement);
      if(!invoices.has(id(s.Vendor_Invoice))||!id(s.Vendor_Settlement)||money(s.Allocated_Amount)===null||money(s.Allocated_Amount)<0||splitPairs.has(pair)){
        add('relation','Inv_Set_Allocations',s,'Missing invoice/settlement, invalid amount or duplicate settlement allocation.');badSettlements.add(id(s.Vendor_Settlement));
      }splitPairs.add(pair);
    });
    graph.settlements.forEach(function(s){
      if (ns.isEmptyNoSupplierSettlement && ns.isEmptyNoSupplierSettlement(s)) return;
      var total=0,paidTotal=0,gross=0,credits=0,blocked=badSettlements.has(id(s));
      graph.invoices.forEach(function(i){
        var all=graph.splits.filter(function(a){return activeSplit(a)&&id(a.Vendor_Invoice)===id(i);}),own=all.filter(function(a){return id(a.Vendor_Settlement)===id(s);});
        if(!own.length&&id(i.Supplier_Settlement)!==id(s))return;
        if(!ready(i)||badInvoices.has(id(i))){blocked=true;return;}if(!active(i))return;
        var full=money(i.Total_Payable_Amount==null?i.Invoice_Total:i.Total_Payable_Amount),share=all.length?own.reduce(function(n,a){return n+money(a.Allocated_Amount);},0):full;
        if(full===null||!s.Currency||i.Currency!==s.Currency||own.some(function(a){return money(a.Allocated_Amount)===null;})){blocked=true;return;}
        var sign=i.Invoice_Type==='Credit Note'?-1:1;
        total+=share*sign;if(sign<0)credits+=share;else gross+=share;
        graph.allocations.filter(function(a){return id(a.Supplier_Invoice)===id(i);}).forEach(function(a){var p=payments.get(id(a.Supplier_Payment));if(!p){blocked=true;return;}if(paid(p)&&full!==0)paidTotal+=money(a.Allocated_Amount)*share/full*sign;});
      });
      if(blocked){add('review','Supplier_Settlements',s,'Settlement amounts not compared: incomplete relationships, pending invoices or currency/amount issues.');return;}
      amount('Supplier_Settlements',s,'Total_Invoice',Math.round(total));amount('Supplier_Settlements',s,'Total_Paid',Math.round(paidTotal));
      amount('Supplier_Settlements',s,'Gross_Invoice_Amount',Math.round(gross));amount('Supplier_Settlements',s,'Credit_Note_Amount',Math.round(credits));
    });
    [['Prepayments',graph.prepayments],['Card_Purchases',graph.cards]].forEach(function(group){group[1].forEach(function(s){
      var paymentId=id(s.Vendor_Payment),recorded=['Prepayment recorded','Purchase recorded','Refund recorded'].includes(s.Accounting_Status);
      if(!paymentId){if(recorded)add('relation',group[0],s,'Source is recorded but has no payment linked.');return;}
      var p=payments.get(paymentId);if(!p){add('relation',group[0],s,'Linked payment could not be read.');return;}
      if(s.Currency!==p.Currency)add('review',group[0],s,'Source and payment currencies differ; review conversion.');
      if(recorded&&!paid(p))add('status',group[0],s,'Source is recorded but its payment is not Paid/Reconciled.',s.Accounting_Status,p.Status);
      if(paid(p)&&!['Cancelled','Discard - Credit','Discard - Already Paid'].includes(s.Accounting_Status)){
        var expected=group[0]==='Prepayments'?'Prepayment recorded':s.Transaction_Type==='Refund'?'Refund recorded':'Purchase recorded';
        if(s.Accounting_Status!==expected)add('status',group[0],s,'Source payment status',s.Accounting_Status,expected);
      }
    });});
    return findings;
  };
}(window));
