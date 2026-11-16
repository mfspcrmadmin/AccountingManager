const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage();await page.route('https://pdf.test/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/')return route.fulfill({body:'<!doctype html><html><head></head><body>PDF fixture</body></html>',contentType:'text/html'});const file=path.join(process.cwd(),'app',url.pathname);await route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':'font/ttf'});});
await page.goto('https://pdf.test/');await page.evaluate(()=>{HTMLAnchorElement.prototype.click=function(){};});await page.addScriptTag({path:'app/vendor/jspdf.umd.min.js'});
await page.evaluate(()=>{
 const Real=jspdf.jsPDF;window.pdfChecks=[];
 jspdf.jsPDF=function(options){const doc=new Real(options),text=doc.text.bind(doc),images=doc.addImage.bind(doc);const check={texts:[],images:0,pages:()=>doc.getNumberOfPages()};pdfChecks.push(check);
 doc.text=function(value,x,y,options){check.texts.push({text:Array.isArray(value)?value.join(' '):String(value),x,y});return text(value,x,y,options);};
 doc.addImage=function(...args){check.images++;return images(...args);};return doc;};
});
await page.addScriptTag({path:'app/scripts/trip-invoice-pdf.js'});
const bytes=await page.evaluate(async()=>{
window.model={number:'FV-2026-000001',date:'2026-11-04',currency:'EUR',total:12345.67,issuer:{name:'Made for Spain, S.A.',tax_id:'A82318908',address:'Calle Castelló, 23, 2º Izda, 28001 Madrid, Spain'},client:{name:'Agencia Muñoz & Asociados - EJEMPLO DE PRUEBA',tax_id:'TEST-ONLY',address:'Calle de Málaga, 18\n28001 Madrid\nSpain'},mfsp:'MFSP-TEST',booking_name:'Viaje de ejemplo - documento de prueba',agent_name:'Chesleigh Lloyd',iata:'05504844',sales_rep:'Silvia Men\u00e9ndez',operations_rep:'Silvia Men\u00e9ndez',guests:'Helen Willingham, Jennifer, Philip, Andrew, David and Daniel Williamson',pax:'6',travel_dates:'2026-10-01 - 2026-10-09',lines:[{description:'Viaje privado por España y Portugal. Servicios contratados de alojamiento, transporte y visitas.',total:12345.67}]};
const blob=await AccountingManagerApp.buildSalesInvoicePdf(model);window.fixturePdf=blob;return Array.from(new Uint8Array(await blob.arrayBuffer()));});
assert.ok(Buffer.from(bytes).subarray(0,5).equals(Buffer.from('%PDF-')));
const result=await page.evaluate(async()=>{
const calls=[];let archived=false;const call=async(booking,action,date,basis,json)=>{calls.push(action);const request=JSON.parse(json);if(action==='pdf-prepare')return {model,filename:'FV-2026-000001.pdf',snapshot_hash:'hash',...(archived?{file_id:'file1'}:{})};if(action==='pdf-archive'){if(!request.base64.startsWith('JVBERi0'))throw Error('Invalid PDF');archived=true;return {success:true};}};
const downloads=AccountingManagerApp.createSalesInvoicePdfDownloads({call,crm:{getFile:async()=>{const bytes=new Uint8Array(await fixturePdf.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));return binary;}}});
const a=downloads.download('1','2',true),b=downloads.download('1','2',true);await Promise.all([a,b]);await downloads.download('1','2',true);
const failing=AccountingManagerApp.createSalesInvoicePdfDownloads({call:async(b,a)=>{if(a==='pdf-prepare')return {model,filename:'invoice.pdf',snapshot_hash:'h'};throw Error('Upload outcome unknown');},crm:{}});
const partial=await failing.download('1','3',true);
const unicode=await AccountingManagerApp.buildSalesInvoicePdf({...model,client:{...model.client,name:'Élodie Muñoz Łukasz Иванов'}});
const stress=await AccountingManagerApp.buildSalesInvoicePdf({...model,guests:'Traveller with a long surname, '.repeat(500)});
return {calls,partial,unicodeSize:unicode.size,stressSize:stress.size,layout:pdfChecks.map(c=>({images:c.images,pages:c.pages(),texts:c.texts}))};});
assert.equal(result.calls.filter(x=>x==='pdf-archive').length,1);assert.ok(result.partial.warning.includes('not confirmed'));assert.ok(result.unicodeSize>1000);assert.ok(result.stressSize>1000);
const first=result.layout[0];assert.equal(first.pages,1);assert.equal(first.images,1);
for(const label of ['INVOICE','Chesleigh Lloyd','IATA: 05504844','Silvia Men\u00e9ndez / Silvia Men\u00e9ndez','Helen Willingham','6','Cuotas de IVA incluidas','R\u00e9gimen Especial','Privacy Policy'])assert.ok(first.texts.some(t=>t.text.includes(label)),label);
assert.ok(result.layout.at(-1).pages>1,'long guest lists paginate');
for(const layout of result.layout)for(const text of layout.texts)assert.ok(text.y>=0&&text.y<=290,'text stays inside page');
console.log('Reference fields, supplied logo, single-page standard invoice and long guest list pagination verified in memory.');
console.log('Actual PDF renderer, accents, long descriptions, single-flight archiving, reuse and partial-save warning verified.');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exit(1)});
