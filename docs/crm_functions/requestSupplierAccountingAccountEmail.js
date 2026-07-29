string standalone.email_requestSupplierAccountingAccountEmail(String supplierId)
{
res = Map();
res.put("error",false);
res.put("success",true);
res.put("message","");
res.put("supplier_id","");
res.put("supplier_name","");
res.put("target_email","luciano@madeforspainandportugal.com,claudia@madeforspainandportugal.com");
res.put("crm_url","");
try 
{
	supplierId = ifnull(supplierId,"").toString().trim();
	res.put("supplier_id",supplierId);
	if(supplierId == "")
	{
		res.put("error",true);
		res.put("success",false);
		res.put("message","supplierId is empty.");
		return res;
	}
	supplier = zoho.crm.getRecordById("Vendors",supplierId);
	if(supplier == null || !supplier.containKey("id"))
	{
		res.put("error",true);
		res.put("success",false);
		res.put("message","Supplier not found.");
		return res;
	}
	supplierName = ifnull(supplier.get("Vendor_Name"),"").toString().trim();
	tpReference = ifnull(supplier.get("TP_Reference"),"").toString().trim();
	supDestination = ifnull(supplier.get("Destination"),"").toString().trim();
	supSubdestination = ifnull(supplier.get("Subdestination"),"").toString().trim();
	supCategory = ifnull(supplier.get("Supplier_Category"),"").toString().trim();
	supSubcategory = ifnull(supplier.get("Subcategory"),"").toString().trim();
	accountingCode = ifnull(supplier.get("Cuenta_Contable"),"").toString().trim();
	res.put("supplier_name",supplierName);
	if(accountingCode != "")
	{
		res.put("message","Supplier already has an accounting account: " + accountingCode + ".");
		return res;
	}
	supplierCrmUrl = "https://crm.zoho.eu/crm/org20093299576/tab/Vendors/" + supplierId;
	res.put("crm_url",supplierCrmUrl);
	subjectParts = List();
	subjectParts.add("Accounting account request");
	if(supplierName != "")
	{
		subjectParts.add(supplierName);
	}
	if(tpReference != "")
	{
		subjectParts.add(tpReference);
	}
	emailSubject = subjectParts.toString(" | ");
	emailBody = "";
	emailBody = emailBody + "<div style='margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;'>";
	emailBody = emailBody + "  <table role='presentation' width='100%' cellpadding='0' cellspacing='0' border='0' style='width:100%;border-collapse:collapse;background:#f4f7fb;'>";
	emailBody = emailBody + "    <tr>";
	emailBody = emailBody + "      <td align='center' style='padding:28px 14px;'>";
	emailBody = emailBody + "        <table role='presentation' width='100%' cellpadding='0' cellspacing='0' border='0' style='width:100%;max-width:760px;border-collapse:collapse;'>";
	emailBody = emailBody + "          <tr>";
	emailBody = emailBody + "            <td style='border:1px solid #dbe3ef;background:#ffffff;border-radius:16px;overflow:hidden;'>";
	emailBody = emailBody + "              <div style='padding:20px 22px;background:#eaf2ff;border-bottom:1px solid #d6e4ff;'>";
	emailBody = emailBody + "                <div style='font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:#285ea8;margin-bottom:6px;'>Supplier setup request</div>";
	emailBody = emailBody + "                <div style='font-size:22px;font-weight:700;line-height:1.2;color:#0f172a;margin-bottom:4px;'>" + if(supplierName != "",supplierName,supplierId) + "</div>";
	emailBody = emailBody + "                <div style='font-size:13px;line-height:1.5;color:#334155;'>Please create the accounting account for this supplier in Zoho CRM.</div>";
	emailBody = emailBody + "              </div>";
	emailBody = emailBody + "              <div style='padding:20px 22px 10px 22px;font-size:13px;line-height:1.6;color:#334155;'>";
	emailBody = emailBody + "                <p style='margin:0 0 12px 0;'>Hi Luciano and Claudia,</p>";
	emailBody = emailBody + "                <p style='margin:0 0 16px 0;'>The Accounting Manager App detected that this supplier <strong>does not yet have an accounting account assigned</strong>. Please create it when you can.</p>";
	emailBody = emailBody + "                <p style='margin:0 0 18px 0;'><a href='" + supplierCrmUrl + "' style='display:inline-block;padding:10px 14px;border-radius:10px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;'>Open supplier in CRM</a></p>";
	emailBody = emailBody + "              </div>";
	emailBody = emailBody + "              <div style='padding:0 22px 22px 22px;'>";
	emailBody = emailBody + "                <table role='presentation' width='100%' cellpadding='0' cellspacing='0' border='0' style='width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;'>";
	emailBody = emailBody + "                  <tr><td style='padding:9px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;width:34%;'>Supplier</td><td style='padding:9px 12px;border-bottom:1px solid #e2e8f0;'>" + if(supplierName != "",supplierName,"-") + "</td></tr>";
	emailBody = emailBody + "                  <tr><td style='padding:9px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;'>TP Reference</td><td style='padding:9px 12px;border-bottom:1px solid #e2e8f0;'>" + if(tpReference != "",tpReference,"-") + "</td></tr>";
	emailBody = emailBody + "                  <tr><td style='padding:9px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;'>Destination</td><td style='padding:9px 12px;border-bottom:1px solid #e2e8f0;'>" + if(supDestination != "",supDestination,"-") + "</td></tr>";
	emailBody = emailBody + "                  <tr><td style='padding:9px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;'>Subdestination</td><td style='padding:9px 12px;border-bottom:1px solid #e2e8f0;'>" + if(supSubdestination != "",supSubdestination,"-") + "</td></tr>";
	emailBody = emailBody + "                  <tr><td style='padding:9px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;'>Category</td><td style='padding:9px 12px;border-bottom:1px solid #e2e8f0;'>" + if(supCategory != "",supCategory,"-") + "</td></tr>";
	emailBody = emailBody + "                  <tr><td style='padding:9px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;'>Subcategory</td><td style='padding:9px 12px;border-bottom:1px solid #e2e8f0;'>" + if(supSubcategory != "",supSubcategory,"-") + "</td></tr>";
	emailBody = emailBody + "                </table>";
	emailBody = emailBody + "              </div>";
	emailBody = emailBody + "            </td>";
	emailBody = emailBody + "          </tr>";
	emailBody = emailBody + "        </table>";
	emailBody = emailBody + "      </td>";
	emailBody = emailBody + "    </tr>";
	emailBody = emailBody + "  </table>";
	emailBody = emailBody + "</div>";
	sendmail
	[
		from :"crmadmin@madeforspainandportugal.com"
		to : "luciano@madeforspainandportugal.com,claudia@madeforspainandportugal.com"
		subject :emailSubject
		message :emailBody
	]
	res.put("message","Accounting account request sent to Luciano and Claudia.");
}
catch (e)
{
	res.put("error",true);
	res.put("success",false);
	res.put("message",ifnull(e,"").toString());
}
return res;
}