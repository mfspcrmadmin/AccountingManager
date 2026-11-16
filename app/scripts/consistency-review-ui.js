(function(global){
  'use strict';
  var ns=global.AccountingManagerApp;
  ns.mountConsistencyReview=function(panel,crm,openRecord){
    if(!panel)return;
    var syncCopies=ns.createStatusCopySync(crm),reader=ns.createConsistencyReader(crm),content=document.getElementById('booking-closure-content');
    var icons={info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',open:'<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',back:'<path d="m12 5-7 7 7 7M5 12h15"/>',chevron:'<path d="m6 9 6 6 6-6"/>',check:'<path d="m5 12 4 4L19 6"/>'};
    function icon(name){return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+icons[name]+'</svg>';}
    panel.innerHTML='<div class="consistency-bar" data-review="bar"><strong>'+icon('info')+'Consistency</strong><span data-review="status" role="status" aria-live="polite">Not checked</span><time data-review="time"></time><div class="consistency-actions"><button class="button secondary" data-review="view" hidden>View issues</button><button class="button secondary" data-review="run">Check consistency</button><details class="consistency-info"><summary aria-label="About consistency checks" title="About consistency checks">'+icon('info')+'</summary><div>Read-only checks of invoices, payments, allocations, settlements, prepayments and card purchases. Issues cover this booking and its linked payments. Records from other bookings are used only to verify shared payment totals and counts. Checks do not modify records. The separate Sync status copies action updates only copied invoice/payment statuses on allocations belonging to this booking. These checks do not approve settlements or close the trip. Taxes, documents, service statuses and automations are outside scope. Different currencies require manual review.</div></details></div></div>'+
      '<section data-review="detail" class="consistency-detail" hidden aria-label="Consistency results"><div class="consistency-detail-heading"><button class="button secondary" data-review="back">'+icon('back')+'Back to review</button><h3 tabindex="-1" data-review="heading">Consistency results</h3><button class="button primary" data-review="sync" hidden title="Refresh copied invoice and payment statuses for this booking; amounts are unchanged">Sync status copies</button><button class="button secondary" data-review="rerun">Run again</button></div><p data-review="summary" role="status"></p><p data-review="sync-result" role="status" hidden></p><div class="consistency-toolbar"><select data-review="filter" aria-label="Filter issues"><option value="">All categories</option><option value="amount">Amounts</option><option value="status">Statuses and counts</option><option value="relation">Relationships</option><option value="review">Review required</option></select><span data-review="count"></span><details class="consistency-info"><summary>'+icon('chevron')+'Checked records</summary><div data-review="records"></div></details></div><div class="consistency-results-scroll" data-review="results"></div></section>';
    var find=function(name){return panel.querySelector('[data-review="'+name+'"]');};
    var sync=find('sync'),syncResult=find('sync-result'),bar=find('bar'),status=find('status'),time=find('time'),run=find('run'),view=find('view'),detail=find('detail'),back=find('back'),rerun=find('rerun'),heading=find('heading'),summary=find('summary'),filter=find('filter'),count=find('count'),results=find('results'),records=find('records');
    panel.querySelectorAll('button').forEach(function(b){b.type='button';});
    var context=null,bookingId='',available=false,busy=false,generation=0,findings=[],graph=null,checkedAt=null,mode='idle',inDetail=false,stale=false;
    var labels={amount:'Amounts',status:'Statuses and counts',relation:'Relationships',review:'Review required'};
    var modules={Supplier_Invoices:'Invoice',Supplier_Payments:'Payment',Supplier_Pay_Allocations:'Payment allocation',Supplier_Settlements:'Settlement',Inv_Set_Allocations:'Invoice settlement allocation',Prepayments:'Prepayment',Card_Purchases:'Card purchase'};
    var collections={Supplier_Invoices:'invoices',Supplier_Payments:'payments',Supplier_Pay_Allocations:'allocations',Supplier_Settlements:'settlements',Inv_Set_Allocations:'splits',Prepayments:'prepayments',Card_Purchases:'cards'};
    var descriptions={Amount_Paid:'Invoice amount paid mismatch',Payment_Amount:'Payment amount mismatch',Allocation_Count:'Allocation count mismatch',Supplier_Count:'Supplier count mismatch',Booking_Count:'Booking count mismatch',Settlement_Count:'Settlement count mismatch',Total_Invoice:'Settlement invoice total mismatch',Total_Paid:'Settlement paid total mismatch',Gross_Invoice_Amount:'Settlement gross invoice total mismatch',Credit_Note_Amount:'Settlement credit note total mismatch','Invoice status copy':'Invoice status copy mismatch on payment allocation','Payment status copy':'Payment status copy mismatch on payment allocation'};
    function id(value){return String(value&&value.id||'');}
    function node(tag,text,cls){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
    function display(value,row){if(value===undefined||value===null)return '\u2014';if(row.kind==='amount'&&typeof value==='number')return value.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})+(row.currency?' '+row.currency:'');return String(value);}
    function showDetail(show){inDetail=show;detail.hidden=!show;content.hidden=show;bar.hidden=show||!available;panel.classList.toggle('is-detail',show);if(show)heading.focus();}
    function paint(){
      var message=mode==='loading'?'Checking\u2026':mode==='error'?'Check incomplete':mode==='done'?(findings.length?findings.length+' issues':'No issues found'):'Not checked';
      status.textContent=message;bar.querySelector('strong').innerHTML=icon(mode==='done'&&!findings.length?'check':'info')+'Consistency';bar.dataset.state=mode;bar.classList.toggle('is-clean',mode==='done'&&!findings.length);
      time.textContent=checkedAt?'Last checked '+checkedAt.toLocaleTimeString('en-GB')+(stale?' - Recheck recommended':''):'';
      time.title=checkedAt?checkedAt.toLocaleString('en-GB')+'; results reflect this read, not live data.':'';
      run.textContent=mode==='idle'?'Check consistency':mode==='error'?'Retry':'Run again';
      sync.hidden=!findings.some(ns.isStatusCopyFinding);sync.disabled=busy||!available||!!(context&&context.isSaving);
      run.disabled=rerun.disabled=busy||!available||!!(context&&context.isSaving);
      view.hidden=!(mode==='error'||(mode==='done'&&findings.length));view.textContent=mode==='error'?'View details':'View issues';view.disabled=busy;
      filter.disabled=busy;panel.setAttribute('aria-busy',String(busy));
    }
    function markStale(){if(mode==='done'){stale=true;paint();summary.textContent=findings.length+' issues. Last checked '+checkedAt.toLocaleString('en-GB')+'. Recheck recommended after visiting or changing related records.';}}
    function place(){var economic=content.querySelector('.booking-closure-summary');if(economic)economic.after(bar);else panel.prepend(bar);bar.hidden=inDetail||!available;content.hidden=inDetail;}
    function setContext(closure){
      // Preserve the bar before the parent renderer replaces the review contents.
      panel.prepend(bar);
      var nextId=closure&&closure.booking&&String(closure.booking.id||'');
      var ready=!!(closure&&closure.isOpen&&!closure.isLoading&&!closure.loadFailed&&nextId);
      if(context!==closure||bookingId!==nextId||available!==ready){generation++;busy=false;findings=[];graph=null;checkedAt=null;mode='idle';stale=false;results.replaceChildren();summary.textContent='';syncResult.hidden=true;syncResult.textContent='';showDetail(false);filter.value='';}
      context=closure;bookingId=nextId;available=ready;panel.hidden=!ready;paint();
    }
    function render(){
      results.replaceChildren();var shown=findings.filter(function(r){return !filter.value||r.kind===filter.value;});
      count.textContent='Showing '+shown.length+' of '+findings.length+' issues';
      if(!shown.length){results.appendChild(node('p',findings.length?'No issues match this filter':'No issues found','consistency-empty'));return;}
      var table=node('table',undefined,'consistency-table');var head=node('thead'),hr=node('tr');['Issue','Related record','Recorded','Expected','Action'].forEach(function(t){var th=node('th',t);th.scope='col';hr.appendChild(th);});head.appendChild(hr);table.appendChild(head);var body=node('tbody');
      shown.forEach(function(row){
        var tr=node('tr'),issue=node('td'),related=node('td');issue.appendChild(node('strong',descriptions[row.description]||row.description));issue.appendChild(node('small',labels[row.kind]));
        var record=(graph[collections[row.module]]||[]).find(function(r){return id(r)===row.id;})||{};
        var primary=row.module==='Supplier_Pay_Allocations'?'Payment allocation':row.name===row.id?(modules[row.module]||'Record'):row.name;
        related.appendChild(node('span',primary,'consistency-reference'));if(primary!==modules[row.module])related.appendChild(node('small',modules[row.module]||'Related record'));
        var invoice=(graph.invoices||[]).find(function(i){return id(i)===id(record.Supplier_Invoice||record.Vendor_Invoice);});
        [['Invoice',record.Supplier_Invoice||record.Vendor_Invoice],['Payment',record.Supplier_Payment],['Settlement',record.Vendor_Settlement]].forEach(function(pair){if(pair[1])related.appendChild(node('small',pair[0]+': '+(pair[1].name||id(pair[1]))));});
        var booking=record.Booking||(invoice&&invoice.Booking);
        if(booking&&id(booking)!==bookingId)related.appendChild(node('small','Other booking: '+(booking.name||id(booking)),'consistency-other-booking'));
        if(row.module==='Supplier_Payments'){
          var others=(graph.allocations||[]).filter(function(a){return id(a.Supplier_Payment)===row.id;}).map(function(a){return (graph.invoices||[]).find(function(i){return id(i)===id(a.Supplier_Invoice);});}).filter(function(i){return i&&id(i.Booking)&&id(i.Booking)!==bookingId;});
          if(others.length)related.appendChild(node('small','Shared payment - includes other bookings','consistency-other-booking'));
        }
        var technical=node('details',undefined,'consistency-technical'),toggle=node('summary');toggle.innerHTML=icon('chevron');toggle.appendChild(document.createTextNode('Record details'));technical.appendChild(toggle);
        technical.appendChild(node('div','Record name: '+row.name));technical.appendChild(node('div','Module: '+row.module+' | ID: '+row.id));
        if(row.description==='Invoice status copy')technical.appendChild(node('div','Supplier_Pay_Allocations.Invoice_Status compared with Supplier_Invoices.Status.'));
        if(row.description==='Payment status copy')technical.appendChild(node('div','Supplier_Pay_Allocations.Payment_Status compared with Supplier_Payments.Status.'));
        technical.appendChild(node('div','Check: '+row.description));related.appendChild(technical);
        tr.appendChild(issue);tr.appendChild(related);tr.appendChild(node('td',display(row.stored,row),'consistency-value'));tr.appendChild(node('td',display(row.expected,row),'consistency-value'));
        var action=node('td'),button=node('button',undefined,'button secondary consistency-open');button.type='button';button.innerHTML=icon('open');button.title='Open '+(modules[row.module]||'record');button.setAttribute('aria-label',button.title+' '+primary);
        button.addEventListener('click',async function(){button.disabled=true;try{await openRecord(row.module,row.id);markStale();}catch(error){summary.textContent='Could not open record: '+error.message;}finally{button.disabled=false;}});action.appendChild(button);tr.appendChild(action);body.appendChild(tr);
      });table.appendChild(body);results.appendChild(table);
    }
    async function scan(){
      if(busy||!available||context.isSaving)return;var token=++generation;busy=true;mode='loading';status.title='';records.replaceChildren();count.textContent='';findings=[];checkedAt=null;stale=false;results.replaceChildren();summary.textContent='Checking records...';filter.value='';paint();
      try{
        var data=await reader.scan(bookingId,function(message){if(token===generation)summary.textContent=message;});if(token!==generation)return;
        graph=data;findings=ns.analyzeConsistency(data);checkedAt=new Date();mode='done';render();
        summary.textContent=findings.length+' issues. Last checked '+checkedAt.toLocaleString('en-GB')+'. Results reflect this read; run again after corrections.';
        records.replaceChildren();[['Invoices in this booking',data.scopeInvoiceIds],['Payments (including shared)',data.payments],['Settlements linked to this booking',data.settlements],['Payment allocations (including shared payment inputs)',data.allocations],['Invoice settlement allocations',data.splits],['Prepayments',data.prepayments],['Card purchases',data.cards]].forEach(function(pair){if(pair[1]&&pair[1].length)records.appendChild(node('div',pair[0]+': '+pair[1].length));});
        var excluded=(context.settlements||[]).filter(function(s){return String(s.Admin_Status||'').replace(/\s/g,'').toLowerCase()==='noservices';}).length;
        if(excluded)records.appendChild(node('div','No services settlements excluded from the closure view: '+excluded));
        records.appendChild(node('p','The settlement check includes all linked settlements. Trip closure excludes "No services" settlements and its table may also be filtered. Records from other bookings are used to calculate shared payment totals and counts; their individual issues are not listed here.'));
      }catch(error){if(token!==generation)return;mode='error';graph=null;results.replaceChildren();count.textContent='';summary.textContent='Check incomplete. Figures could not be confirmed. '+error.message;status.title=error.message;}
      finally{if(token===generation){busy=false;paint();if(mode==='error')status.title=summary.textContent;}}
    }
    sync.addEventListener('click',async function(){
      if(busy||!available||context.isSaving)return;
      var owner=context,scope=bookingId,token=generation,selected=findings.slice();
      busy=true;owner.isSaving=true;syncResult.hidden=false;syncResult.textContent='Synchronizing status copies...';paint();
      var report;
      try{
        report=await syncCopies(scope,selected,function(done,total){if(token===generation)syncResult.textContent='Synchronizing status copies: '+done+' / '+total;});
      }catch(error){report={verified:0,failed:[{message:error.message}]};}
      finally{owner.isSaving=false;}
      if(token!==generation)return;
      busy=false;
      // Re-read the graph: do not remove findings based only on write responses.
      await scan();
      if(context!==owner)return;
      syncResult.hidden=false;
      syncResult.textContent=report.verified+' allocations verified. '+(report.failed.length?report.failed.length+' could not be synchronized. '+report.failed.map(function(f){return (f.id?'Allocation '+f.id+': ':'')+f.message;}).join(' ')+' Run the check and retry; completed updates will not be duplicated.':'Status copies synchronized.')+(mode==='error'?' The final consistency check failed; run it again before relying on the results.':'');
    });
    run.addEventListener('click',scan);rerun.addEventListener('click',scan);view.addEventListener('click',function(){showDetail(true);});back.addEventListener('click',function(){showDetail(false);view.focus();});filter.addEventListener('change',render);
    global.addEventListener('focus',markStale);
    paint();return {setContext:setContext,place:place};
  };
}(window));
