from pathlib import Path
import re

ROOT = Path(__file__).parent
def original(name): return (ROOT / 'backups' / (name + '.dg')).read_text(encoding='utf-8-sig')
def save(name, source): (ROOT / (name + '.dg')).write_text(source, encoding='utf-8')
def replace(s, old, new):
    assert old in s, old[:120]
    return s.replace(old, new)
def utc(s): return s.replace('toString("yyyy-MM-dd\'T\'HH:mm:ssZ")', 'toString("yyyy-MM-dd\'T\'HH:mm:ssZ","UTC")')

s = utc(original('recalculatesuppliersettlementsforbooking'))
s = replace(s, 'standalone.recalculateSupplierSettlementsForBooking(', 'standalone.settlements_recalculateCore(')
# Read complete, ordered CRM snapshots before any writes. Do not depend on search indexing.
start = s.index('allServices = List();')
end = s.index('// Apply the legacy type normalization')
s = s[:start] + '''allServices = standalone.settlements_readBookingRows(servicesModule,bookingId).get("data");
existingSettlements = standalone.settlements_readBookingRows(settlementModule,bookingId).get("data");
existingSettlementByTechnicalKey = Map();
duplicateSettlementKeys = Map();
for each st in existingSettlements
{
 stTechnicalKey = ifnull(st.get(settlementTechnicalKeyField),"").toString();
 if(stTechnicalKey == "") { throw "Settlement " + st.get("id") + " has no Technical_Key; reconcile it before recalculating"; }
 if(existingSettlementByTechnicalKey.containKey(stTechnicalKey)) { throw "Ambiguous settlement key: " + stTechnicalKey; }
 existingSettlementByTechnicalKey.put(stTechnicalKey,st);
}
''' + s[end:]
# No unconditional type backfills before input validation; active and inactive updates already set it.
s = replace(s, 'purchasePrice = 0.0;\n\t\t}', 'throw "Invalid purchase price for Booking Service " + serviceId;\n\t\t}')
s = replace(s, '\tbookingRecord = zoho.crm.getRecordById("Deals",bookingId);', '\tbookingRecord = zoho.crm.getRecordById("Deals",bookingId);\n\tif(isnull(bookingRecord.get("id"))) { throw "Booking could not be read"; }')
s = replace(s, '\tmfspReference = "";\n\tbookingStatus = "";\n\tbookingIsCancelled = false;', '\tthrow "Cannot recalculate without booking data: " + eBooking;')
s = replace(s, '''\tif(!isnull(groupData.get("first_service_date")))
\t{
\t\tsettlementMap.put(settlementFirstServiceDateField,groupData.get("first_service_date"));
\t}
\tif(!isnull(groupData.get("last_service_date")))
\t{
\t\tsettlementMap.put(settlementLastServiceDateField,groupData.get("last_service_date"));
\t}''', '''\tsettlementMap.put(settlementFirstServiceDateField,groupData.get("first_service_date"));
\tsettlementMap.put(settlementLastServiceDateField,groupData.get("last_service_date"));''')
# Financial status is recomputed at the end. Preserve cancellation policy rather than inventing new stages.
s = replace(s, 'if(oldStatus != "Paid" && oldStatus != "Cancelled")', 'if(oldSettlementType != "Agent Commission")')
s = replace(s, 'oldUpdate.put(settlementStatusField,cancelledSettlementStatus);', 'if(oldStatus != "Paid") { oldUpdate.put(settlementStatusField,cancelledSettlementStatus); }')
s = replace(s, '''\t\t\telse
\t\t\t{
\t\t\t\toldUpdate.put(settlementStatusField,noServicesStatus);
\t\t\t}''', '''\t\t\telse if(oldStatus != "Paid" && oldStatus != "Cancelled")
\t\t\t{
\t\t\t\toldUpdate.put(settlementStatusField,noServicesStatus);
\t\t\t}''')
# Every bulk response must cover the complete batch, and every row must confirm SUCCESS.
for response, batch in [('typeBackfillResponse','batchSettlementTypeBackfills'),('createRes','batchCreateSettlements'),('updateRes','batchUpdateSettlements'),('serviceUpdateRes','batchUpdateServices'),('inactiveRes','batchInactive')]:
    pattern = rf'({response} = zoho\.crm\.bulk\w+\([^\n]+\);)'
    s, count = re.subn(pattern, rf'\1\n\t\tif(isnull({response}) || {response}.size() != {batch}.size()) {{ throw "Incomplete {response}; retry required"; }}', s)
    assert count == 2, (response, count)
for prefix in ['create','update','serviceUpdate','inactive']:
    pattern = rf'if\({prefix}Code\.equalsIgnoreCase\("error"\)[^\n]+\)'
    s, count = re.subn(pattern, f'if({prefix}Code != "SUCCESS" || {prefix}Status != "success")', s)
    assert count == 2, (prefix, count)
# Stop before linking/cleanup when settlement writes failed. The unique Technical_Key makes retries safe.
marker = '// 5) RELOAD SETTLEMENTS TO GET IDS'
i = s.index(marker)
s = s[:i] + '''// Refuse to link services against an unconfirmed settlement write.
if(createErrorCount > 0 || updateErrorCount > 0) { throw "Settlement writes failed; retry required"; }
''' + s[i:]
# Replace search-based reload and fallback with a complete current read.
a = s.index('stopReloadSettlements = false;')
b = s.index('// 6) LINK SERVICES TO SETTLEMENTS')
s = s[:a] + '''reloadedSettlements = standalone.settlements_readBookingRows(settlementModule,bookingId).get("data");
for each stReloaded in reloadedSettlements
{
 settlementIdByTechnicalKey.put(stReloaded.get(settlementTechnicalKeyField),stReloaded.get("id"));
}
for each activeKey in groupDataByKey.keys()
{
 if(isnull(settlementIdByTechnicalKey.get(activeKey))) { throw "Missing settlement for " + activeKey; }
}
''' + s[b:]
# Totals read actual invoices/payments; do not recreate or move any allocation.
i = s.index('result.put("message","Supplier Settlements recalculated successfully.");')
s = s[:i] + '''if(serviceUpdateErrorCount > 0 || inactiveErrorCount > 0 || supplierServicesTypeBackfillErrorCount > 0 || agentCommissionResult.get("error") == true)
{
 throw "Recalculation had partial write errors; retry required";
}
financialIds = "";
financialRows = standalone.settlements_readBookingRows(settlementModule,bookingId).get("data");
for each financialRow in financialRows
{
 if(financialIds != "") { financialIds = financialIds + "|||"; }
 financialIds = financialIds + financialRow.get("id");
}
if(financialIds != "")
{
 financialResult = standalone.rebuildSupplierSettlementTotals(financialIds);
 if(financialResult.get("error") != false || financialResult.get("processed_count") != financialRows.size())
 { throw "Financial totals were not fully rebuilt; retry required: " + financialResult.get("message"); }
 result.put("financial_totals",financialResult);
}
''' + s[i:]
save('settlements_recalculateCore', s)

s = utc(original('jobs_enqueueadminprocessjob'))
a = s.index('if(dedupKey != "")\n{\n\ttry')
b = s.index('createMap = Map();', a)
s = s[:a] + s[b:]
s = replace(s, 'createMap.put("Dedup_Key",dedupKey);', 'createMap.put("Dedup_Key",dedupKey);\n\tcreateMap.put("Active_Key","QUEUED:" + dedupKey);')
a = s.index('\tcreateCode =')
b = s.index('\tresult.put("created",true);', a)
s = s[:a] + '''\tcreatedJobId = ifnull(createRes.get("id"),"").toString();
\tif(createdJobId == "" && createRes.get("code") == "DUPLICATE_DATA" && dedupKey != "")
\t{
\t\tduplicateId = ifnull(ifnull(createRes.get("details"),Map()).get("id"),"").toString();
\t\tif(duplicateId != "")
\t\t{
\t\t\texisting = zoho.crm.getRecordById(adminJobsModule,duplicateId);
\t\t\tif(existing.get("Dedup_Key") == dedupKey)
\t\t\t{
\t\t\t\tresult.put("dedup_skipped",true);
\t\t\t\tresult.put("job_id",duplicateId);
\t\t\t\tresult.put("message","Recalculation request already queued");
\t\t\t\treturn result;
\t\t\t}
\t\t}
\t}
\tif(createdJobId == "") { throw "Job creation was not confirmed: " + createRes; }
''' + s[b:]
save('jobs_enqueueadminprocessjob',s)

s = utc(original('jobs_processadminprocessjob'))
i = s.index('attempts = 0;')
s = s[:i] + '''// The scheduler's snapshot may already be stale. Check current state and due time.
jobRecord = zoho.crm.getRecordById(adminJobsModule,jobId);
if(ifnull(jobRecord.get("id"),"").toString() != jobId) { throw "Job could not be reloaded"; }
currentStatus = ifnull(jobRecord.get("Status"),"").toString();
if(currentStatus != "Pending" && currentStatus != "Retry")
{
 result.put("skipped",true); result.put("final_status",currentStatus); return result;
}
due = ifnull(jobRecord.get("Next_Run_At"),"").toString();
if(due != "" && due.toTime("yyyy-MM-dd'T'HH:mm:ssXXX") > zoho.currenttime)
{
 result.put("skipped",true); result.put("final_status",currentStatus); return result;
}
''' + s[i:]
s = replace(s, 'startUpdate.put("Status","Processing");', 'startUpdate.put("Status","Processing");\n// Release the queue slot before reading booking data: a new sync creates a successor.\nstartUpdate.put("Active_Key",null);')
a = s.index('\tstartUpdateRes = zoho.crm.updateRecord')
b = s.index('\n}\ncatch (eStartUpdate)',a)
s = s[:a] + '''\tstartUpdateRes = standalone.jobs_conditionalUpdate(jobId,jobRecord.get("Modified_Time"),startUpdate);
\tif(startUpdateRes.get("error") == true)
\t{
\t\tresult.put("skipped",true); result.put("message","Job changed before claim"); return result;
\t}''' + s[b:]
s = replace(s, 'if(settlementRecalcRes.get("error") == true)', 'if(settlementRecalcRes.get("error") != false)') if 'if(settlementRecalcRes.get("error") == true)' in s else s
s = replace(s, 'lastResultJson = lastResultJson.subString(0,30000) + "... [truncated]";', '''compactResult = Map();
 compactResult.put("details_omitted",true);
 compactResult.put("error",jobError);
 compactResult.put("message",finalMessage.left(2000));
 lastResultJson = compactResult.toString();''')
s = replace(s, 'finishUpdate.put("Status",finalStatus);\n\tfinishUpdate.put("Last_Error",finalMessage);', '''finishUpdate.put("Status",finalStatus);
\tfinishUpdate.put("Next_Run_At",standalone.jobs_formatDateTimeForCRM(zoho.currenttime.addMinutes((attempts + 1) * 5).toString("yyyy-MM-dd'T'HH:mm:ssZ","UTC")));
\tfinishUpdate.put("Last_Error",finalMessage.left(2000));''')
s = replace(s, 'if(finishUpdateCode.equalsIgnoreCase("error") || finishUpdateStatus.equalsIgnoreCase("error") || finishUpdateCode.equalsIgnoreCase("INVALID_DATA"))', 'if(ifnull(finishUpdateRes.get("id"),"").toString() != jobId)')
a = s.index('\t// Best-effort minimal update:')
b = s.index('\n}\nresult.put("error",jobError);',a)
s = s[:a] + '''\t// Leave Processing and its expiry intact: the runner will recover this safely.
\tfinalStatus = "Processing";
\tfinalMessage = finalMessage + " | Final write not confirmed; recovery will retry after lease expiry.";''' + s[b:]
save('jobs_processadminprocessjob',s)

s = s.replace('currentStatus = ifnull(jobRecord.get("Status"),"").toString();', 'jobType = ifnull(jobRecord.get("Job_Type"),"").toString();\nresult.put("job_type",jobType);\ncurrentStatus = ifnull(jobRecord.get("Status"),"").toString();')
s = s.replace('if(recalcRes.get("error") == true)', 'if(recalcRes.get("error") != false)')
save('jobs_processadminprocessjob',s)

s = original('bp_orchestratebookingtransition')
s = replace(s, 'res.put("ezus_stage",standalone.changeEzusProjectStage(ezusProjectRef,newStage));', '''ezusStageResult = standalone.changeEzusProjectStage(ezusProjectRef,newStage);
\tres.put("ezus_stage",ezusStageResult);
\tif(ezusStageResult.get("error") != false)
\t{
\t\tres.put("error",true); res.put("message","Ezus stage update failed: " + ezusStageResult.get("message")); return res;
\t}''')
s = replace(s, 'if(transitionCode.equals("fid_sent") || transitionCode.equals("changes_completed"))', 'if(transitionCode.equals("fid_sent") || transitionCode.equals("changes_completed") || transitionCode.equals("cancelled") || transitionCode.equals("cancelled_with_charges") || transitionCode.equals("marked_dead"))')
s = replace(s, 'res.put("sync",standalone.sync_syncFullProjectFromEzus(syncBookingId,syncArgs.toString()));', '''transitionSyncResult = standalone.sync_syncFullProjectFromEzus(syncBookingId,syncArgs.toString());
\t\tres.put("sync",transitionSyncResult);
\t\tif(transitionSyncResult.get("error") != false)
\t\t{
\t\t\tres.put("error",true); res.put("message","Transition applied, but booking synchronization is incomplete: " + transitionSyncResult.get("message")); return res;
\t\t}''')
save('bp_orchestratebookingtransition',s)

s = original('deletebookingservice')
marker = '//delete record from creator database'
s = replace(s, marker, '''bookingId = ifnull(ifnull(service.get("Booking"),Map()).get("id"),"").toString();
if(bookingId == "") { throw "Cannot delete service without identifying its booking for recalculation"; }
// Persist recovery work before deleting anything. If deletion fails, the recalculation is harmless.
jobInput = Map();
jobInput.put("job_type","Supplier Settlement Recalc");
jobInput.put("booking_id",bookingId);
jobInput.put("dedup_key","SUPPLIER_SETTLEMENT_RECALC:" + bookingId);
jobInput.put("source_function","deleteBookingService");
jobInput.put("trigger_reason","Booking Service deletion requested");
jobInput.put("next_run_at",zoho.currenttime.addMinutes(2));
queued = standalone.jobs_enqueueAdminProcessJob(jobInput);
if(queued.get("error") != false) { throw "Deletion aborted: settlement recovery job was not queued"; }
''' + marker)
s = replace(s, 'res = zoho.crm.invokeConnector("crm.delete",deleteServiceMap);', '''res = standalone.settlements_deleteService(serviceId.toString());
if(res.get("error") != false) { throw "CRM service deletion was not confirmed: " + res; }
followup = standalone.jobs_enqueueSupplierSettlementRecalcForBooking(bookingId,"Booking Service deleted","deleteBookingService");
if(followup.get("error") != false) { throw "Service deleted; followup recalculation could not be confirmed: " + followup; }''')
s = replace(s, '\t\tinfo res;', '\t\tif(res.get("code") != 3000) { throw "Creator availability deletion was not confirmed: " + res; }\n\t\tinfo res;')
save('deletebookingservice',s)

s = original('syncservicesfromezuswithtoken')
for response in ['stepCreateRes','stepUpdateRes']:
    pattern = rf'({response} = zoho\.crm\.bulk\w+\(stepModule,batch\);)'
    s, count = re.subn(pattern, rf'\1\n\tif(isnull({response}) || {response}.size() != batch.size()) {{ stepSyncErrors.add("Incomplete {response}"); }}', s)
    assert count == 2
for prefix in ['stepCreate','stepUpdate']:
    s = re.sub(rf'if\({prefix}Code\.equalsIgnoreCase\("error"\)[^\n]+\)', f'if({prefix}Code != "SUCCESS" || {prefix}Status != "success")', s)
    fallback = 'fallback' + prefix[0].upper() + prefix[1:]
    s = replace(s, f'{fallback}Id = "";', f'{fallback}Id = ifnull({fallback}Res.get("id"),"").toString();') if f'{fallback}Id = "";' in s else s
for response, batch in [('createRes','batchCreate'),('updateRes','batchUpdate')]:
    pattern = rf'({response} = zoho\.crm\.bulk\w+\("Booking_Services",{batch}\);)'
    s, count = re.subn(pattern, rf'\1\n\tif(isnull({response}) || {response}.size() != {batch}.size()) {{ hasSyncError = true; serviceSyncErrors.add("Incomplete {response}"); }}', s)
    assert count == 2
for prefix in ['create','update']:
    s = re.sub(rf'if\({prefix}Code\.equalsIgnoreCase\("error"\)[^\n]+\)', f'if({prefix}Code != "SUCCESS" || {prefix}Status != "success")', s)
# Queue before the first service write as recovery, then enqueue again after mutations.
s = replace(s, 'hasSyncError = false;', '''recoveryJob = standalone.jobs_enqueueSupplierSettlementRecalcForBooking(bookingId,"Service sync recovery","sync_syncServicesFromEzusWithToken");
if(recoveryJob.get("error") != false) { res.put("error",true); res.put("message","Services sync aborted: recovery job unavailable"); return res; }
hasSyncError = false;''')
s = replace(s, 'if(hasSyncError)\n{', 'if(hasSyncError || stepSyncErrors.size() > 0)\n{\n\tres.put("supplierSettlementRecalcJob",standalone.jobs_enqueueSupplierSettlementRecalcForBooking(bookingId,"Partial service sync recovery","sync_syncServicesFromEzusWithToken"));')
s = replace(s, 'delRes = zoho.crm.invokeConnector("crm.delete",deleteMap);', '''delRes = standalone.settlements_deleteService(bsId.toString());
\t\tif(delRes.get("error") != false) { serviceSyncErrors.add("SERVICE_DELETE " + bsId + ": " + delRes); }''')
s = replace(s, 'bookingCommissionUpdateMap = Map();', '''supplierSettlementJobRes = standalone.jobs_enqueueSupplierSettlementRecalcForBooking(bookingId,"Booking services synced from EZUS","sync_syncServicesFromEzusWithToken");
res.put("supplierSettlementRecalcJob",supplierSettlementJobRes);
bookingCommissionUpdateMap = Map();''')
s = replace(s, 'if(!isnull(bookingCommissionUpdateRes.get("status")) && bookingCommissionUpdateRes.get("status") == "error")', 'if(isnull(bookingCommissionUpdateRes) || isnull(bookingCommissionUpdateRes.get("id")))')
save('syncservicesfromezuswithtoken',s)
