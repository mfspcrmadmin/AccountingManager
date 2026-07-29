(function (global) {
var ns = global.PurchasesManagerApp = global.PurchasesManagerApp || {};

  ns.createCrmClient = function (zoho, helpers) {
    function debugLog(label, payload) {
      if (global.console && typeof global.console.log === "function") {
        global.console.log("[PurchasesManager][CRM] " + label, payload || "");
      }
    }

    function debugError(label, error, payload) {
      var details = payload || {};

      if (error) {
        details.errorMessage = error.message || String(error);
        details.errorName = error.name || "";
        details.errorStack = error.stack || "";
        details.errorKeys = Object.keys(error);
        details.errorObject = error;
      }

      if (global.console && typeof global.console.error === "function") {
        global.console.error("[PurchasesManager][CRM] " + label, details);
      }
    }

    function getApi() {
      return zoho && zoho.CRM && zoho.CRM.API;
    }

    function getMeta() {
      return zoho && zoho.CRM && zoho.CRM.META;
    }

    async function getRecord(entity, recordId) {
      var response;
      var record;

      try {
        debugLog("getRecord request", {
          Entity: entity,
          RecordID: recordId
        });
        response = await getApi().getRecord({
          Entity: entity,
          RecordID: recordId
        });
        record = helpers.extractRecords(response)[0] || null;
        debugLog("getRecord response", {
          Entity: entity,
          RecordID: recordId,
          found: Boolean(record)
        });
        return record;
      } catch (error) {
        debugError("getRecord failed", error, {
          Entity: entity,
          RecordID: recordId
        });
        throw error;
      }
    }

    async function getAllRecords(entity, page, perPage) {
      var response;
      var records;

      try {
        debugLog("getAllRecords request", {
          Entity: entity,
          page: page || 1,
          per_page: perPage || 200
        });
        response = await getApi().getAllRecords({
          Entity: entity,
          page: page || 1,
          per_page: perPage || 200
        });
        records = helpers.extractRecords(response);
        debugLog("getAllRecords response", {
          Entity: entity,
          count: records.length
        });
        return records;
      } catch (error) {
        debugError("getAllRecords failed", error, {
          Entity: entity,
          page: page || 1,
          per_page: perPage || 200
        });
        throw error;
      }
    }

    async function searchRecord(entity, criteria) {
      return searchRecordPage(entity, criteria, 1, 200);
    }

    async function searchRecordPage(entity, criteria, page, perPage) {
      var response;
      var records;
      var normalizedPage = page || 1;
      var normalizedPerPage = perPage || 200;

      try {
        debugLog("searchRecord request", {
          Entity: entity,
          Type: "criteria",
          Query: criteria,
          page: normalizedPage,
          per_page: normalizedPerPage
        });
        response = await getApi().searchRecord({
          Entity: entity,
          Type: "criteria",
          Query: criteria
        }, normalizedPage, normalizedPerPage);
        records = helpers.extractRecords(response);
        debugLog("searchRecord response", {
          Entity: entity,
          Query: criteria,
          count: records.length,
          page: normalizedPage,
          per_page: normalizedPerPage
        });
        return records;
      } catch (error) {
        debugError("searchRecord failed", error, {
          Entity: entity,
          Type: "criteria",
          Query: criteria,
          page: normalizedPage,
          per_page: normalizedPerPage
        });
        throw error;
      }
    }

    async function searchWord(entity, query) {
      var response;
      var records;

      try {
        debugLog("searchWord request", {
          Entity: entity,
          Type: "word",
          Query: query
        });
        response = await getApi().searchRecord({
          Entity: entity,
          Type: "word",
          Query: query
        }, 1, 100);
        records = helpers.extractRecords(response);
        debugLog("searchWord response", {
          Entity: entity,
          Query: query,
          count: records.length
        });
        return records;
      } catch (error) {
        debugError("searchWord failed", error, {
          Entity: entity,
          Type: "word",
          Query: query
        });
        throw error;
      }
    }

    async function coql(selectQuery) {
      var response;
      var records;

      try {
        debugLog("coql request", {
          select_query: selectQuery
        });
        response = await getApi().coql({
          select_query: selectQuery
        });
        records = helpers.extractRecords(response);
        debugLog("coql response", {
          select_query: selectQuery,
          count: records.length
        });
        return records;
      } catch (error) {
        debugError("coql failed", error, {
          select_query: selectQuery
        });
        throw error;
      }
    }

    async function insertRecord(entity, data) {
      var request = {
        Entity: entity,
        APIData: [data],
        Trigger: ["workflow"]
      };
      var response;

      try {
        debugLog("insertRecord request", request);
        response = await getApi().insertRecord(request);
        debugLog("insertRecord response", response);
        return response;
      } catch (error) {
        debugError("insertRecord failed", error, request);
        throw error;
      }
    }

    async function updateRecord(entity, recordId, data) {
      var payload = Object.assign({
        id: recordId
      }, data || {});
      var request = {
        Entity: entity,
        RecordID: recordId,
        APIData: payload,
        Trigger: ["workflow"]
      };
      var response;

      try {
        debugLog("updateRecord request", request);
        response = await getApi().updateRecord(request);
        debugLog("updateRecord response", response);
        return response;
      } catch (error) {
        debugError("updateRecord failed", error, request);
        throw error;
      }
    }

    async function deleteRecord(entity, recordId) {
      var request = {
        Entity: entity,
        RecordID: recordId
      };
      var response;

      try {
        debugLog("deleteRecord request", request);
        response = await getApi().deleteRecord(request);
        debugLog("deleteRecord response", response);
        return response;
      } catch (error) {
        debugError("deleteRecord failed", error, request);
        throw error;
      }
    }

    async function getFields(entity) {
      try {
        debugLog("getFields request", {
          Entity: entity
        });
        return await getMeta().getFields({
          Entity: entity
        });
      } catch (error) {
        debugError("getFields failed", error, {
          Entity: entity
        });
        throw error;
      }
    }

    async function attachFile(entity, recordId, fileName, fileContent) {
      var request = {
        Entity: entity,
        RecordID: recordId,
        File: {
          Name: fileName,
          Content: fileContent
        }
      };

      try {
        debugLog("attachFile request", {
          Entity: entity,
          RecordID: recordId,
          fileName: fileName
        });
        return await getApi().attachFile(request);
      } catch (error) {
        debugError("attachFile failed", error, {
          Entity: entity,
          RecordID: recordId,
          fileName: fileName
        });
        throw error;
      }
    }

    async function getFile(fileId) {
      var request = {
        id: fileId
      };
      var response;

      try {
        debugLog("getFile request", request);
        response = await getApi().getFile(request);
        debugLog("getFile response", {
          id: fileId,
          valueType: typeof response,
          hasValue: response != null
        });
        return response;
      } catch (error) {
        debugError("getFile failed", error, request);
        throw error;
      }
    }

    async function uploadFile(file) {
      var request = {
        CONTENT_TYPE: "multipart",
        PARTS: [{
          headers: {
            "Content-Disposition": "file;"
          },
          content: "__FILE__"
        }],
        FILE: {
          fileParam: "content",
          file: file
        }
      };
      var response;

      try {
        debugLog("uploadFile request", {
          fileName: file && file.name ? file.name : "",
          fileSize: file && typeof file.size === "number" ? file.size : 0
        });
        response = await getApi().uploadFile(request);
        debugLog("uploadFile response", response);
        return response;
      } catch (error) {
        debugError("uploadFile failed", error, {
          fileName: file && file.name ? file.name : "",
          fileSize: file && typeof file.size === "number" ? file.size : 0
        });
        throw error;
      }
    }

    async function getRelatedRecords(entity, recordId, relatedList, page, perPage) {
      var response;
      var records;
      var request = {
        Entity: entity,
        RecordID: recordId,
        RelatedList: relatedList,
        page: page || 1,
        per_page: perPage || 200
      };

      try {
        debugLog("getRelatedRecords request", request);
        response = await getApi().getRelatedRecords(request);
        records = helpers.extractRecords(response);
        debugLog("getRelatedRecords response", {
          Entity: entity,
          RecordID: recordId,
          RelatedList: relatedList,
          count: records.length
        });
        return records;
      } catch (error) {
        debugError("getRelatedRecords failed", error, request);
        throw error;
      }
    }

    async function executeFunction(functionName, args) {
      var request = {
        arguments: JSON.stringify(args || {})
      };

      try {
        debugLog("executeFunction request", {
          functionName: functionName,
          request: request
        });
        return await zoho.CRM.FUNCTIONS.execute(functionName, request);
      } catch (error) {
        debugError("executeFunction failed", error, {
          functionName: functionName,
          request: request
        });
        throw error;
      }
    }

    return {
      attachFile: attachFile,
      coql: coql,
      deleteRecord: deleteRecord,
      executeFunction: executeFunction,
      getFile: getFile,
      getAllRecords: getAllRecords,
      getFields: getFields,
      getRecord: getRecord,
      getRelatedRecords: getRelatedRecords,
      insertRecord: insertRecord,
      searchRecordPage: searchRecordPage,
      uploadFile: uploadFile,
      updateRecord: updateRecord,
      searchRecord: searchRecord,
      searchWord: searchWord
    };
  };
}(window));
