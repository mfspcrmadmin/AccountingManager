"""Build read-only examples from CRM Deluge snapshots. Never executes Deluge/API calls.
Run: python tools/build-email-previews.py [--check]
HTML literals remain verbatim; only dynamic expressions use fixture values.
"""
from pathlib import Path
import json,re,sys
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'crm/email-preview-sources'
def source(name): return (SRC/(name+'.dg')).read_text(encoding='utf-8')
def parts(expr):
    start=0; quoted=False; escaped=False; depth=0
    for i,c in enumerate(expr):
        if quoted:
            if escaped: escaped=False
            elif c=='\\': escaped=True
            elif c=='"': quoted=False
        elif c=='"': quoted=True
        elif c=='(': depth+=1
        elif c==')': depth-=1
        elif c=='+' and not depth:
            yield expr[start:i].strip();start=i+1
    yield expr[start:].strip()
def evaluate(expr,values):
    result=''
    for p in parts(expr):
        if p.startswith('"'): result+=json.loads(p)
        elif p in values: result+=str(values[p])
        else: raise ValueError('Unmapped expression: '+p)
    return result
def assignments(code,var,values):
    values=dict(values); values[var]=''
    for line in code.splitlines():
        m=re.match(r'\s*'+re.escape(var)+r' = (.*);$',line)
        if m: values[var]=evaluate(m[1],values)
    return values[var]
base={'supplierName':'Proveedor de ejemplo','mfspReference':'MFSP-SAMPLE','invoiceReference':'INV-SAMPLE','formattedInvoiceDate':'01-10-2026','allocationAmount.toString()':'1250.00','paymentReference':'PAY-SAMPLE','formattedPaymentDate':'16-10-2026','invoiceCount.toString()':'1','totalAllocated.toString()':'1250.00','mfspRef':'MFSP-SAMPLE','bookingName':'Viaje de ejemplo'}
payment=source('sendsupplierpaymentletter')
base['rowsHtml']=assignments(payment,'rowsHtml',base)
base['automaticEmailNotice']=assignments(payment,'automaticEmailNotice',base)
previews={'paymentLetter':assignments(payment,'emailBody',base)}
previews['prepaymentProof']=assignments(source('notif_sendprepaymentproof'),'html',base)
account={'supplierNameHtml':'Proveedor de ejemplo','tpReferenceHtml':'TP-SAMPLE','supDestinationHtml':'Spain','supSubdestinationHtml':'Madrid','supCategoryHtml':'Accommodation','supSubcategoryHtml':'Hotel','supplierCrmUrl':'#sample-supplier'}
previews['accountingAccount']=assignments(source('email_requestsupplieraccountingaccountemail'),'emailBody',account)
bank=source('notif_sendprepaymentbankrequest')
values={'supplier':'Proveedor de ejemplo','iban':'ES00 0000 0000 0000 0000 0000','holder':'Proveedor de ejemplo','bank':'Banco de ejemplo','currency':'EUR','mfsp':'MFSP-SAMPLE','booking':'Viaje de ejemplo','reference':'REF-SAMPLE'}
bv={f'{v}.get("{k}")':value for v in ['v','values'] for k,value in values.items()}
bv.update({'g.get("rows")':'','g.get("total").round(2)':'1250.00','p.get("Amount").toDecimal().round(2)':'1250.00','totals.get(currency).round(2)':'1250.00','currency.replaceAll("&","&amp;",true).replaceAll("<","&lt;",true).replaceAll(">","&gt;",true)':'EUR'})
bv['proof']=assignments(bank,'proof',bv)
bv['cell']=assignments(bank,'cell',bv)
row=next(l.strip() for l in bank.splitlines() if l.strip().startswith('g.put("rows",g.get'))
bv['g.get("rows")']=evaluate(row[len('g.put("rows",'):-2],bv)
previews['bankRequest']=assignments(bank[:bank.index('token = zoho.encryption.sha256(html)')],'html',bv)
output='// Generated from published Deluge snapshots retrieved 2026-10-16.\n// Run python tools/build-email-previews.py; sample values only, no CRM execution.\n(function (global) {\n  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};\n  ns.emailTemplatePreviews = '+json.dumps(previews,ensure_ascii=False,indent=2)+';\n}(window));\n'
target=ROOT/'app/scripts/email-template-previews.js'
if '--check' in sys.argv:
    assert target.read_text(encoding='utf-8')==output, 'Regenerate email previews'
else: target.write_text(output,encoding='utf-8')
print('Four email previews match the Deluge HTML snapshots.')
