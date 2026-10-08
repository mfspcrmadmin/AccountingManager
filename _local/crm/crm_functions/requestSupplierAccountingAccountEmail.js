string standalone.email_requestSupplierAccountingAccountEmail(String supplierId)
{
res = Map();
res.put("error",false);
res.put("success",true);
res.put("sent",false);
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
	supplierCrmUrl = "https://crm.zoho.eu/crm/org20093299576/tab/WebTab3?widgetparams=%7B%22supplierId%22%3A%22" + supplier.get("id").toString() + "%22%2C%22view%22%3A%22supplier%22%2C%22supplierInfoTab%22%3A%22financial%22%7D";
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
	supplierNameHtml = if(supplierName != "",supplierName,supplierId).replaceAll("&","&amp;",true).replaceAll("<","&lt;",true).replaceAll(">","&gt;",true).replaceAll("\"","&quot;",true).replaceAll("'","&#39;",true);
	tpReferenceHtml = if(tpReference != "",tpReference,"-").replaceAll("&","&amp;",true).replaceAll("<","&lt;",true).replaceAll(">","&gt;",true).replaceAll("\"","&quot;",true).replaceAll("'","&#39;",true);
	supDestinationHtml = if(supDestination != "",supDestination,"-").replaceAll("&","&amp;",true).replaceAll("<","&lt;",true).replaceAll(">","&gt;",true).replaceAll("\"","&quot;",true).replaceAll("'","&#39;",true);
	supSubdestinationHtml = if(supSubdestination != "",supSubdestination,"-").replaceAll("&","&amp;",true).replaceAll("<","&lt;",true).replaceAll(">","&gt;",true).replaceAll("\"","&quot;",true).replaceAll("'","&#39;",true);
	supCategoryHtml = if(supCategory != "",supCategory,"-").replaceAll("&","&amp;",true).replaceAll("<","&lt;",true).replaceAll(">","&gt;",true).replaceAll("\"","&quot;",true).replaceAll("'","&#39;",true);
	supSubcategoryHtml = if(supSubcategory != "",supSubcategory,"-").replaceAll("&","&amp;",true).replaceAll("<","&lt;",true).replaceAll(">","&gt;",true).replaceAll("\"","&quot;",true).replaceAll("'","&#39;",true);
	emailBody = "";
	emailBody = emailBody + "<!doctype html>";
	emailBody = emailBody + "<html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'></head>";
	emailBody = emailBody + "<body style='margin:0;padding:0;background:#f1f4f6;color:#243746;font-family:Arial,Helvetica,sans-serif;'>";
	emailBody = emailBody + "<div style='display:none;font-size:1px;line-height:1px;color:#f1f4f6;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;'>Accounting account needed for " + supplierNameHtml + ". Open the supplier, enter the account and save.</div>";
	emailBody = emailBody + "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' border='0' style='background:#f1f4f6;'><tr><td align='center' style='padding:32px 12px;'>";
	emailBody = emailBody + "<!--[if mso]><table role='presentation' width='620' cellpadding='0' cellspacing='0' border='0'><tr><td><![endif]-->";
	emailBody = emailBody + "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' border='0' style='max-width:620px;'>";
	emailBody = emailBody + "<tr><td style='padding:0 8px 18px;font-size:12px;font-weight:bold;letter-spacing:2px;color:#607482;'>ACCOUNTING MANAGER</td></tr>";
	emailBody = emailBody + "<tr><td style='background:#ffffff;border:1px solid #dce4e9;border-radius:16px;'>";
	emailBody = emailBody + "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' border='0'>";
	emailBody = emailBody + "<tr><td style='padding:28px 24px;background:#173647;border-radius:15px 15px 0 0;'>";
	emailBody = emailBody + "<p style='margin:0 0 14px;font-size:11px;line-height:18px;font-weight:bold;letter-spacing:1.5px;color:#a9dbd2;'>SUPPLIER SETUP &nbsp; / &nbsp; ACTION REQUIRED</p>";
	emailBody = emailBody + "<h1 style='margin:0 0 10px;font-size:27px;line-height:34px;font-weight:bold;color:#ffffff;'>Add an accounting account</h1>";
	emailBody = emailBody + "<p style='margin:0;font-size:15px;line-height:23px;color:#d6e4ea;'>One detail is missing from this supplier&#8217;s profile.</p>";
	emailBody = emailBody + "</td></tr>";
	emailBody = emailBody + "<tr><td style='padding:26px 24px 0;'>";
	emailBody = emailBody + "<p style='margin:0 0 12px;font-size:15px;line-height:24px;'>Hi Luciano and Claudia,</p>";
	emailBody = emailBody + "<p style='margin:0 0 22px;font-size:15px;line-height:24px;color:#536674;'>Please add the accounting account for the supplier below. You can update it directly in Accounting Manager.</p>";
	emailBody = emailBody + "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' border='0' style='background:#f4f8fa;border:1px solid #e1e9ee;border-radius:10px;'><tr><td style='padding:18px;'>";
	emailBody = emailBody + "<p style='margin:0 0 7px;font-size:10px;line-height:16px;letter-spacing:1.5px;font-weight:bold;color:#607482;'>SUPPLIER</p>";
	emailBody = emailBody + "<p style='margin:0 0 8px;font-size:21px;line-height:28px;font-weight:bold;color:#173647;overflow-wrap:anywhere;word-break:break-word;'>" + supplierNameHtml + "</p>";
	emailBody = emailBody + "<p style='margin:0;font-size:13px;line-height:20px;color:#607482;'>TP reference &nbsp; <strong style='color:#243746;'>" + tpReferenceHtml + "</strong></p>";
	emailBody = emailBody + "</td></tr></table>";
	emailBody = emailBody + "</td></tr>";
	emailBody = emailBody + "<tr><td style='padding:24px 24px 0;'>";
	emailBody = emailBody + "<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='100%'><tr><td align='center' bgcolor='#087f78' style='background:#087f78;border-radius:8px;mso-padding-alt:16px 20px;'>";
	emailBody = emailBody + "<a href='" + supplierCrmUrl + "' style='display:block;padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;'>Add accounting account &nbsp; &rarr;</a>";
	emailBody = emailBody + "</td></tr></table>";
	emailBody = emailBody + "<p style='margin:10px 0 0;text-align:center;font-size:12px;line-height:19px;color:#607482;'>Opens this supplier in Suppliers &rsaquo; Financial</p>";
	emailBody = emailBody + "</td></tr>";
	emailBody = emailBody + "<tr><td style='padding:26px 24px;'>";
	emailBody = emailBody + "<p style='margin:0 0 14px;font-size:13px;font-weight:bold;color:#173647;'>Complete the update in 3 steps</p>";
	emailBody = emailBody + "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' border='0'>";
	emailBody = emailBody + "<tr><td valign='top' width='28' style='padding:0 0 12px;font-size:14px;line-height:22px;font-weight:bold;color:#087f78;'>01</td><td style='padding:0 0 12px 8px;font-size:14px;line-height:22px;'>Click the button to open the supplier.</td></tr>";
	emailBody = emailBody + "<tr><td valign='top' width='28' style='padding:0 0 12px;font-size:14px;line-height:22px;font-weight:bold;color:#087f78;'>02</td><td style='padding:0 0 12px 8px;font-size:14px;line-height:22px;'>Under <strong>Accounting account</strong>, click <strong>Edit</strong>.</td></tr>";
	emailBody = emailBody + "<tr><td valign='top' width='28' style='font-size:14px;line-height:22px;font-weight:bold;color:#087f78;'>03</td><td style='padding-left:8px;font-size:14px;line-height:22px;'>Enter the account number and click <strong>Save</strong>.</td></tr>";
	emailBody = emailBody + "</table>";
	emailBody = emailBody + "</td></tr>";
	emailBody = emailBody + "<tr><td style='padding:22px 24px;background:#fafbfc;border-top:1px solid #e6edf1;border-radius:0 0 15px 15px;'>";
	emailBody = emailBody + "<p style='margin:0 0 12px;font-size:11px;line-height:18px;font-weight:bold;letter-spacing:1.3px;color:#607482;'>SUPPLIER DETAILS</p>";
	emailBody = emailBody + "<table width='100%' cellpadding='0' cellspacing='0' border='0' style='font-size:13px;line-height:20px;'>";
	emailBody = emailBody + "<tr><th scope='row' align='left' valign='top' width='40%' style='padding:6px 12px 6px 0;font-weight:normal;color:#607482;'>Destination</th><td valign='top' style='padding:6px 0;color:#243746;overflow-wrap:anywhere;word-break:break-word;'>" + supDestinationHtml + "</td></tr>";
	emailBody = emailBody + "<tr><th scope='row' align='left' valign='top' width='40%' style='padding:6px 12px 6px 0;font-weight:normal;color:#607482;'>Subdestination</th><td valign='top' style='padding:6px 0;color:#243746;overflow-wrap:anywhere;word-break:break-word;'>" + supSubdestinationHtml + "</td></tr>";
	emailBody = emailBody + "<tr><th scope='row' align='left' valign='top' width='40%' style='padding:6px 12px 6px 0;font-weight:normal;color:#607482;'>Category</th><td valign='top' style='padding:6px 0;color:#243746;overflow-wrap:anywhere;word-break:break-word;'>" + supCategoryHtml + "</td></tr>";
	emailBody = emailBody + "<tr><th scope='row' align='left' valign='top' width='40%' style='padding:6px 12px 6px 0;font-weight:normal;color:#607482;'>Subcategory</th><td valign='top' style='padding:6px 0;color:#243746;overflow-wrap:anywhere;word-break:break-word;'>" + supSubcategoryHtml + "</td></tr>";
	emailBody = emailBody + "</table>";
	emailBody = emailBody + "</td></tr>";
	emailBody = emailBody + "</table>";
	emailBody = emailBody + "</td></tr>";
	emailBody = emailBody + "<tr><td align='center' style='padding:18px 12px 0;font-size:11px;line-height:18px;color:#768894;'>Made for Spain &amp; Portugal<br>Sent by Accounting Manager</td></tr>";
	emailBody = emailBody + "</table>";
	emailBody = emailBody + "<!--[if mso]></td></tr></table><![endif]-->";
	emailBody = emailBody + "</td></tr></table>";
	emailBody = emailBody + "</body></html>";
	sendmail
	[
		from :"crmadmin@madeforspainandportugal.com"
		to : "luciano@madeforspainandportugal.com,claudia@madeforspainandportugal.com"
		subject :emailSubject
		message :emailBody
	]
	res.put("sent",true);
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
