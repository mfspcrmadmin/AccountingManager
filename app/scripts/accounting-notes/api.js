export async function crmGetRecord(entity, id) {
  const response = await window.ZOHO.CRM.API.getRecord({ Entity: entity, RecordID: id });
  const record = response?.data?.[0];
  if (!record || String(record.id) !== String(id)) throw new Error(response?.message || "Could not read the record. Check your CRM access.");
  return record;
}

export async function crmUpdateRecord(entity, data) {
  const response = await window.ZOHO.CRM.API.updateRecord({ Entity: entity, APIData: data, Trigger: [] });
  return response?.data?.[0] || { code: "ERROR", message: response?.message || "CRM did not confirm the notes update." };
}

export async function crmExecuteFunction(name, args) {
  return window.ZOHO.CRM.FUNCTIONS.execute(name, { arguments: JSON.stringify(args) });
}
