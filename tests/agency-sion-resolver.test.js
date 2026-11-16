const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('crm/ensureSupplierPaymentAccount.dg','utf8');
const wrap = value => ({get:key => value[key] ?? null});
const supplierId = 'vendor';
const defaultId = '616617000166884362';
const vendor = {Vendor_Type:'Agency',Agency:{id:'agency'}};
const sion = {id:defaultId,Owner_Type:'Agency',Method_Type:'SION',Status:'Active',Allowed_For_Supplier_Payments:false};
function eligible(v, a, defaultValue = defaultId) {
  const supplier = wrap(v), account = wrap(a), ownerId = a.Owner_Supplier?.id || '';
  const method = a.Method_Type, iban = a.IBAN || '', hasMethod = ['Bank Transfer','Airwallex','Card','Cash','SION','Other'].includes(method), bankReady = method !== 'Bank Transfer' || !!iban;
  const rule = source.match(/isAgencySion = ([^;]+);/)[1];
  const check = source.match(/if\(\(isAgencySion[^\n]+/)[0].trim().slice(3,-1);
  return Function('supplier','account','supplierId','defaultId','ownerId','method','iban','hasMethod','bankReady', 'const isAgencySion = '+rule+';return '+check)(supplier,account,supplierId,defaultValue,ownerId,method,iban,hasMethod,bankReady);
}
test('resolver accepts the configured shared SION for a linked agency without supplier ownership or supplier flag', () => {
  assert.equal(eligible(vendor,sion),true);
});
test('resolver rejects unrelated, inactive, locked, misconfigured or non-agency SION accounts', () => {
  for(const change of [{id:'other'},{Owner_Type:'Own'},{Method_Type:'Card'},{Status:'Inactive'},{Locked__s:true},{Owner_Supplier:{id:'vendor'}}]) {
    assert.equal(eligible(vendor,{...sion,...change}),false);
  }
  assert.equal(eligible({...vendor,Vendor_Type:'Supplier'},sion),false);
  assert.equal(eligible({...vendor,Agency:null},sion),false);
  assert.equal(eligible(vendor,sion,'other'),false);
});
test('ordinary beneficiary validation retains ownership, active status, permission and IBAN requirements', () => {
  const bank = {id:'bank',Owner_Type:'Supplier',Owner_Supplier:{id:'vendor'},Method_Type:'Bank Transfer',Status:'Active',Allowed_For_Supplier_Payments:true,IBAN:'ES123'};
  assert.equal(eligible({},bank),true);
  for(const change of [{IBAN:''},{Allowed_For_Supplier_Payments:false},{Owner_Supplier:{id:'other'}},{Locked__s:true},{Status:'Inactive'}]) assert.equal(eligible({}, {...bank,...change}),false);
});
