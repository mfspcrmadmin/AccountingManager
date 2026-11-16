(function (global) {
  'use strict';
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {}, assets;
  function base64(bytes) {
    var text = ''; for (var i = 0; i < bytes.length; i += 8192) { text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); }
    return global.btoa(text);
  }
  async function load() {
    if (!assets) { assets = (async function () {
      if (!global.jspdf) {
        await new Promise(function (resolve, reject) { var script = document.createElement('script'); script.src = './vendor/jspdf.umd.min.js'; script.onload = resolve; script.onerror = function () { reject(new Error('Could not load the PDF renderer.')); }; document.head.appendChild(script); });
      }
      return Promise.all(['Regular','Bold'].map(async function (weight) {
        var response = await global.fetch('./vendor/fonts/NotoSans-' + weight + '.ttf');
        if (!response.ok) { throw new Error('Could not load the invoice fonts.'); }
        return base64(new Uint8Array(await response.arrayBuffer()));
      }).concat([(async function () {
        var response = await global.fetch('./assets/logo-mfsp-red.png');
        if (!response.ok) { throw new Error('Could not load the invoice logo.'); }
        return 'data:image/png;base64,' + base64(new Uint8Array(await response.arrayBuffer()));
      }())]));
    }()).catch(function (error) { assets = null; throw error; }); }
    return assets;
  }
  ns.buildSalesInvoicePdf = async function (model) {
    if (!model || !model.number || !/^\d{4}-\d{2}-\d{2}$/.test(model.date) || !model.client || !model.client.name || !Number.isFinite(Number(model.total))) { throw new Error('The invoice document data is incomplete.'); }
    var fonts = await load(), doc = new global.jspdf.jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
    doc.addFileToVFS('NotoSans-Regular.ttf',fonts[0]);doc.addFont('NotoSans-Regular.ttf','NotoSans','normal');
    doc.addFileToVFS('NotoSans-Bold.ttf',fonts[1]);doc.addFont('NotoSans-Bold.ttf','NotoSans','bold');doc.setFont('NotoSans');
    var allText = JSON.stringify(model);
    var widths = doc.getFont().metadata.characterToGlyph;
    if (typeof widths === 'function') { for (var c of allText) { if (c.codePointAt(0) > 31 && !widths.call(doc.getFont().metadata,c.codePointAt(0))) { throw new Error('The invoice contains characters unsupported by the PDF font. Review the document before downloading.'); } } }
    doc.setProperties({title:'Invoice ' + model.number,subject:'Sales invoice',author:model.issuer.name,creator:'Accounting Manager'});
    var y = 48, bottom = 243, accent = [64, 64, 64], ink = [51, 51, 51], muted = [104, 104, 100];
    function text(value,x,size,bold,options) { doc.setFont('NotoSans',bold?'bold':'normal');doc.setFontSize(size||10);doc.text(String(value == null ? '' : value),x,y,options||{}); }
    function pageHeader(continued) {
      // Use the supplied logo unchanged, including its original proportions.
      doc.addImage(fonts[2],'PNG',14,0,94,47,'mfsp-logo','SLOW');
      doc.setTextColor.apply(doc,accent); y=25;text('INVOICE',192,23,true,{align:'right'});
      y=33;doc.setTextColor.apply(doc,muted);text(model.number,192,10,false,{align:'right'});
      if (continued) {y=43;text('Continued',192,8,false,{align:'right'});}
      y=48;
    }
    function next() { doc.addPage();pageHeader(true); }
    function block(value,x,width,size,bold) {
      doc.setFont('NotoSans',bold?'bold':'normal');doc.setFontSize(size||10);
      var lines = doc.splitTextToSize(String(value == null ? '' : value),width), step=(size||10)*.49;
      lines.forEach(function (line) { if (y+step>bottom) { next(); } doc.setTextColor.apply(doc,ink);text(line,x,size,bold);y+=step; });
    }
    function amount(value) { return Number(value).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ' + model.currency; }
    function label(value,x) {doc.setTextColor.apply(doc,muted);text(value.toUpperCase(),x,8,true);}
    function field(title,value) {
      var lines = doc.splitTextToSize(String(value == null || value === '' ? 'Not provided' : value),120);
      if (y + Math.max(12,lines.length*5+6)>bottom) next();
      label(title,18);var start=y;block(value == null || value === '' ? 'Not provided' : value,70,120,10);y=Math.max(y,start+6)+6;
    }
    pageHeader(false);
    doc.setTextColor.apply(doc,ink);block(model.issuer.name,18,95,10,true);
    block(model.issuer.address,18,95,8.5);block('Agencia Mayorista - Minorista',18,95,8);
    block('C.I.C. MA 1154 / C.I.F. ' + model.issuer.tax_id,18,95,8);
    y+=7;doc.setDrawColor(222,226,231);doc.line(18,y,192,y);y+=10;
    var customerTop=y;
    label('Bill to',18);y+=7;block(model.client.name,18,100,11,true);
    if(model.agent_name) block(model.agent_name,18,100,9);
    if(model.client.address) block(model.client.address,18,100,9);
    if(model.client.tax_id) block('Tax ID: '+model.client.tax_id,18,100,8);
    if(model.iata) block('IATA: '+model.iata,18,100,8);
    var customerBottom=y;
    y=customerTop;label('Invoice date',143);y+=7;doc.setTextColor.apply(doc,ink);text(model.date.split('-').reverse().join('/'),143,11,true);
    y+=12;label('Reference',143);y+=7;block(model.mfsp || model.number,143,49,10,true);
    y=Math.max(customerBottom,y)+12;
    doc.setDrawColor(222,226,231);doc.line(18,y,192,y);y+=11;
    field('MfS&P Agent / Ops', [model.sales_rep,model.operations_rep].filter(Boolean).join(' / '));
    field('Distinguished guests',model.guests || model.booking_name);
    field('Trip dates',model.travel_dates);
    field('No. of guests',model.pax);
    if(y>bottom-25) next();
    y+=4;doc.setFillColor(245,243,238);doc.roundedRect(18,y-4,174,23,3,3,'F');
    y+=10;doc.setTextColor.apply(doc,ink);text('TOTAL',24,11,true);doc.setTextColor.apply(doc,accent);text(amount(model.total),186,20,true,{align:'right'});
    var privacy='MADE FOR SPAIN S.A. will process personal data for the purpose of managing and maintaining the business relationship and complying with applicable legal obligations. Further information on the processing of personal data and the exercise of data protection rights is available in our Privacy Policy:';
    for(var page=1;page<=doc.getNumberOfPages();page++){
      doc.setPage(page);doc.setTextColor.apply(doc,muted);doc.setFont('NotoSans','normal');doc.setFontSize(8);
      doc.text('Cuotas de IVA incluidas en el precio.',18,252);
      doc.text('Operaci\u00f3n sujeta al R\u00e9gimen Especial de las Agencias de Viajes.',18,257);
      doc.setFontSize(6.5);doc.text(doc.splitTextToSize(privacy,174),18,265,{lineHeightFactor:1.35});
      doc.setTextColor.apply(doc,accent);doc.textWithLink('www.madeforspainandportugal.com/privacy-policy/',18,277,{url:'https://www.madeforspainandportugal.com/privacy-policy/'});
      doc.setDrawColor(222,226,231);doc.line(18,281,192,281);doc.setTextColor.apply(doc,muted);doc.setFontSize(6.5);
      doc.text('Made for Spain, S.A. | C.I.C. MA 1154 | CIF A-82318908',18,286);
      doc.text('C/ Castell\u00f3, 23 - Planta 2 IZQ - 28001 Madrid, Spain | T: 910 633 600',18,290);
      doc.text('Page '+page+' / '+doc.getNumberOfPages(),192,290,{align:'right'});
    }
    return new Blob([doc.output('arraybuffer')],{type:'application/pdf'});
  };
  ns.createSalesInvoicePdfDownloads = function (deps) {
    var pending = new Map();
    async function run(bookingId,invoiceId,save) {
      var prepared = await deps.call(bookingId,'pdf-prepare','','',JSON.stringify({invoice_id:String(invoiceId)}));
      var blob;
      if(prepared.file_id){
        var file = await deps.crm.getFile(prepared.file_id);
        blob = file instanceof Blob ? file : file instanceof ArrayBuffer ? new Blob([file],{type:'application/pdf'}) : ArrayBuffer.isView(file) ? new Blob([file],{type:'application/pdf'}) : null;
        if(typeof file === 'string') {
          var binary = file;
          if(/^data:application\/pdf;base64,/i.test(binary)){binary=global.atob(binary.slice(binary.indexOf(',')+1));}
          else if(binary.startsWith('JVBERi0')){binary=global.atob(binary);}
          if(binary.startsWith('%PDF-')){var bytes=new Uint8Array(binary.length);for(var i=0;i<binary.length;i++){if(binary.charCodeAt(i)>255){throw new Error('CRM returned an invalid PDF binary string. Download the original from Attachments.');}bytes[i]=binary.charCodeAt(i);}blob=new Blob([bytes],{type:'application/pdf'});}
        }
        if(!blob){throw new Error('CRM did not return the archived PDF. Open the invoice attachments to download the original.');}
      }else{blob = await ns.buildSalesInvoicePdf(prepared.model);}
      if((await blob.slice(0,5).text())!=='%PDF-'){throw new Error('The invoice PDF could not be verified. No download was started.');}
      var warning='';
      if(save&&!prepared.file_id){
        try { await deps.call(bookingId,'pdf-archive','','',JSON.stringify({invoice_id:String(invoiceId),snapshot_hash:prepared.snapshot_hash,base64:base64(new Uint8Array(await blob.arrayBuffer()))})); }
        catch(error){warning='The PDF was downloaded, but its attachment was not confirmed: '+error.message;}
      }
      var url=global.URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=prepared.filename;document.body.appendChild(link);link.click();link.remove();global.setTimeout(function(){global.URL.revokeObjectURL(url);},1000);
      return {warning:warning,saved:!warning&&(save||Boolean(prepared.file_id)),filename:prepared.filename};
    }
    return {download:function(bookingId,invoiceId,save){var key=String(invoiceId);if(pending.has(key)){return pending.get(key);}var promise=run(bookingId,invoiceId,save).finally(function(){pending.delete(key);});pending.set(key,promise);return promise;}};
  };
}(window));
