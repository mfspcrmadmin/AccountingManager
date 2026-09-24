const {chromium}=require('C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('fs'); const path=require('path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
let html=fs.readFileSync('app/widget.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('<head>','<head><base href="file:///'+path.resolve('app').replace(/\\/g,'/')+'/">');
html=html.replace(/<link[^>]*href="\.\/([^"?]+)"[^>]*>/g,(_,p)=>'<style>'+fs.readFileSync(path.join('app',p),'utf8')+'</style>');
await page.setContent(html); await page.waitForTimeout(300);
await page.evaluate(()=>{document.querySelectorAll('.tab-panel').forEach(x=>x.hidden=x.id!=='tab-operations');document.querySelector('#tab-operations').hidden=false;const w=document.querySelector('#prepayments-workspace');w.hidden=false;for(const x of w.parentElement.children)if(x!==w&&!x.classList.contains('operations-header'))x.hidden=true;document.querySelector('[data-prepayments-message]').textContent='';});
console.log(await page.evaluate(()=>Object.fromEntries(['#tab-operations','.prepayments-filters','.prepayments-general-filters','.prepayments-date-row','.prepayments-date-filter','.prepayments-date-controls','.prepayments-date-controls select','.prepayments-date-control','.prepayment-bank-toolbar'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),c=getComputedStyle(e);return[s,{x:r.x,y:r.y,w:r.width,h:r.height,display:c.display,gap:c.gap,padding:c.padding,flex:c.flex,overflow:c.overflow}]}))));
await page.screenshot({path:'_local/previews/prepayments-before-layout.png',fullPage:true});await browser.close();})();
