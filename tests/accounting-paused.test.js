const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {transpile} = require('./helpers/deluge-registration-harness');

test('published accounting entry points return disabled without reading or mutating CRM',()=>{
 for(const [file,fn] of [
  ['accent_resolvesupplierinvoiceaccountingentry','accEnt_resolveSupplierInvoiceAccountingEntry'],
  ['accent_resolvesupplierpaymentaccountingentry','accEnt_resolveSupplierPaymentAccountingEntry'],
  ['supplierinvoiceedit_applyaccounting','supplierInvoiceEdit_applyAccounting']
 ]){
  const ctx=vm.createContext({});
  vm.runInContext('Object.prototype.toString=function(){return JSON.stringify(this)};',ctx);
  // No CRM API is provided: any attempt to access records fails the test.
  vm.runInContext(transpile(fs.readFileSync('crm/accounting-paused/'+file+'.dg','utf8')),ctx);
  const result=JSON.parse(ctx[fn]('1','true','key','{}'));
  assert.equal(result.disabled,true);assert.equal(result.error,true);
  assert.equal(result.success,false);assert.equal(result.created,false);assert.equal(result.updated,false);
 }
});

test('widget defaults to disabled generation and retains accounting modules',()=>{
 const window={};vm.runInNewContext(fs.readFileSync('app/scripts/config.js','utf8'),{window});
 const ns=window.AccountingManagerApp;
 assert.equal(ns.ACCOUNTING_ENTRY_GENERATION_ENABLED,false);
 assert.equal(ns.MODULES.accountingEntries,'Accounting_Entries');
 assert.equal(ns.MODULES.accountingEntryLines,'Accounting_Entry_Lines');
 const source=fs.readFileSync('app/scripts/main.js','utf8');
 for(const name of ['Invoice','Payment']){
  const start=source.indexOf('async function syncAccountingEntryFor'+name+'(');
  assert.match(source.slice(start,start+240),/throw new Error/);
  assert.doesNotMatch(source.slice(start,start+240),/executeFunction/);
 }
});
