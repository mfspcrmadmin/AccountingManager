(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var fields = "id,Name,Booking,Supplier,Supplier_Name,Ezus_Supplier_Reference,Total_Service_Cost,Total_Invoice,Total_Paid,Admin_Status,First_Service_Date,Last_Service_Date,Service_Count,Last_Recalculated_At,Settlement_Type";
  function id(value) { return String(value && typeof value === "object" ? value.id || "" : value || ""); }
  function date(value) { return Date.parse(value || "") || 0; }
  function lockIsActive(job) {
    var modified = date(job.Modified_Time);
    // Match the server's conservative guard for legacy timezone/missing-expiry data.
    return !modified || Math.max(modified + 30 * 60000, date(job.Lock_Expires_At)) >= Date.now();
  }
  function validId(value) {
    if (!/^[0-9]+$/.test(value)) { throw new Error("Invalid CRM record identifier."); }
    return value;
  }
  async function readAll(crm, query) {
    var result = [];
    for (var offset = 0; offset < 5000; offset += 200) {
      var page = await crm.coql(query + " limit " + offset + ", 200", { strict: true });
      if (!Array.isArray(page)) { throw new Error("CRM returned an incomplete calculation status response."); }
      result = result.concat(page);
      if (page.length < 200) { return result; }
    }
    throw new Error("Too many records to verify the complete calculation status. Narrow the supplier's records in CRM.");
  }
  ns.readSupplierCalculationSettlements = function (crm, supplierId) {
    return readAll(crm, "select " + fields + " from Supplier_Settlements where Supplier = '" + validId(supplierId) + "' order by id asc");
  };
  ns.reconcileCalculationSettlements = function (creation, records) {
    var byId = {};
    records.forEach(function (record) { byId[String(record.id)] = record; });
    var previous = creation.selectedSettlements || [];
    creation.settlements = records;
    creation.selectedSettlements = previous.map(function (record) { return byId[String(record.id)]; }).filter(Boolean);
    previous.forEach(function (record) {
      if (!byId[String(record.id)]) { delete creation.settlementAllocationAmounts[record.id]; }
    });
    var selectedId = creation.selectedSettlement && String(creation.selectedSettlement.id);
    creation.selectedSettlement = byId[selectedId] || creation.selectedSettlements[0] || null;
    return previous.length !== creation.selectedSettlements.length;
  };
  async function snapshot(crm, supplierId, manualSuccess, selectedIds) {
    var inputs = await Promise.all([
      ns.readSupplierCalculationSettlements(crm, supplierId),
      selectedIds ? Promise.resolve([]) : readAll(crm, "select id,Booking from Booking_Services where Supplier = '" + validId(supplierId) + "' order by id asc")
    ]);
    var settlements = inputs[0];
    var bookings = {};
    inputs[0].concat(inputs[1]).forEach(function (record) {
      var bookingId = id(record.Booking);
      if (!bookingId) { return; }
      if (selectedIds && selectedIds.indexOf(bookingId) === -1) { return; }
      validId(bookingId);
      var item = bookings[bookingId] || { id: bookingId, label: record.Booking.name || bookingId, jobs: [], lastCalculated: "" };
      if (date(record.Last_Recalculated_At) > date(item.lastCalculated)) { item.lastCalculated = record.Last_Recalculated_At; }
      bookings[bookingId] = item;
    });
    var ids = Object.keys(bookings);
    for (var offset = 0; offset < ids.length; offset += 50) {
      var values = ids.slice(offset, offset + 50).map(function (value) { return "'" + value + "'"; }).join(",");
      if (selectedIds) {
        var bookingRecords = await readAll(crm, "select id,MFSP_Reference,Deal_Name from Deals where id in (" + values + ") order by id asc");
        bookingRecords.forEach(function (record) {
          if (bookings[id(record)]) {
            bookings[id(record)].mfsp = record.MFSP_Reference || "";
            bookings[id(record)].label = record.Deal_Name || bookings[id(record)].label;
          }
        });
      }
      var jobs = await readAll(crm, "select id,Booking,Status,Source_Function,Created_Time,Modified_Time,Last_Run_At,Completed_At,Next_Run_At,Last_Error,Last_Result_JSON,Lock_Expires_At from Admin_Process_Jobs where (Job_Type = 'Supplier Settlement Recalc' and Booking in (" + values + ")) order by Created_Time desc, id desc");
      jobs.forEach(function (job) { if (bookings[id(job.Booking)]) { bookings[id(job.Booking)].jobs.push(job); } });
    }
    var rows = ids.map(function (bookingId) {
      var item = bookings[bookingId];
      var business = item.jobs.filter(function (job) {
        if (job.Source_Function !== "settlement_recalculation_lease") { return true; }
        if (job.Status === "Error") { return true; }
        // Older leases used Done for both success and failure. Only trust an explicit result.
        if (job.Status !== "Done") { return false; }
        try { return JSON.parse(job.Last_Result_JSON || "{}").error === false; } catch (_) { return false; }
      });
      var active = business.filter(function (job) { return ["Pending", "Processing", "Retry", "On Hold"].indexOf(job.Status) !== -1; });
      var lease = item.jobs.find(function (job) { return job.Source_Function === "settlement_recalculation_lease" && job.Status === "On Hold"; });
      var latest = business[0];
      var completedAt = business.filter(function (job) { return job.Status === "Done"; }).reduce(function (latestDate, job) {
        return date(job.Completed_At) > date(latestDate) ? job.Completed_At : latestDate;
      }, "");
      var failed = latest && latest.Status === "Error" && date(latest.Modified_Time) >= Math.max(date(completedAt), manualSuccess[bookingId] || 0);
      var liveJob = active.some(function (job) { return job.Status === "Processing" && lockIsActive(job); });
      var staleJob = active.some(function (job) { return job.Status === "Processing" && !lockIsActive(job); });
      var status = "idle";
      if (active.length) { status = liveJob ? "running" : staleJob ? "unconfirmed" : "pending"; }
      else if (failed) { status = "failed"; }
      if (lease) { status = lockIsActive(lease) || liveJob ? "running" : "unconfirmed"; }
      var retryJob = active.find(function (job) { return job.Status === "Retry"; });
      var onHold = active.some(function (job) { return job.Status === "On Hold"; });
      return { bookingId: bookingId, label: item.label, mfsp: item.mfsp || "", status: status,
        lastCalculated: date(item.lastCalculated) > date(completedAt) ? item.lastCalculated : completedAt,
        lastCompleted: completedAt,
        error: status === "unconfirmed" ? "The previous calculation lock expired; completion was not confirmed." :
          failed ? latest.Last_Error || "The last calculation failed." : retryJob ? retryJob.Last_Error || "A previous attempt failed." : "",
        nextRunAt: (retryJob || active[0] || {}).Next_Run_At || "",
        onHold: onHold,
        canRetry: status !== "running" && !onHold && (status === "failed" || status === "unconfirmed" || status === "pending")
      };
    });
    return { supplierId: supplierId, settlements: settlements, rows: rows, checkedAt: new Date().toISOString(), error: "", loading: false };
  }
  ns.createSettlementCalculationMonitor = function (deps) {
    var supplierId = "", generation = 0, timer = null, inFlight = null, retrying = "", selectedIds = null, selectionKey = "";
    var manualSuccess = {}, actions = {};
    var view = { rows: [], loading: false, error: "" };
    var schedule = deps.setTimeout || global.setTimeout.bind(global);
    var cancel = deps.clearTimeout || global.clearTimeout.bind(global);
    function emit() {
      (view.rows || []).forEach(function (row) { row.recovery = actions[row.bookingId] || null; });
      deps.onChange(view, retrying);
    }
    function stop() {
      generation++; supplierId = ""; retrying = ""; manualSuccess = {}; actions = {}; inFlight = null;
      if (timer !== null) { cancel(timer); timer = null; }
      view = { rows: [], loading: false, error: "" };
    }
    async function refresh() {
      if (!supplierId || inFlight) { return inFlight; }
      if (timer !== null) { cancel(timer); timer = null; }
      var token = generation, currentSupplier = supplierId;
      view.loading = true; emit();
      var request = (async function () {
        try {
          var next = await snapshot(deps.crm, currentSupplier, manualSuccess, selectedIds);
          if (token !== generation) { return; }
          await deps.onSnapshot(next, function () { return token === generation; });
          if (token !== generation) { return; }
          view = next; emit();
        } catch (error) {
          if (token !== generation) { return; }
          view = { rows: [], supplierId: currentSupplier, loading: false, error: "Calculation status could not be verified. " + (error.message || "Check CRM permissions and retry.") };
          emit();
        } finally {
          if (token === generation) {
            inFlight = null;
            timer = schedule(refresh, 30000);
          }
        }
      }());
      inFlight = request;
      return request;
    }
    function start(value, bookingIds) {
      value = String(value || "");
      var nextIds = Array.isArray(bookingIds) ? Array.from(new Set(bookingIds.map(String).filter(Boolean))).sort() : null;
      var nextKey = JSON.stringify(nextIds);
      if (supplierId === value && selectionKey === nextKey) { return; }
      stop();
      selectedIds = nextIds; selectionKey = nextKey;
      if (!value) { return; }
      supplierId = value;
      view = { supplierId: value, rows: [], loading: true, error: "" }; emit();
      return refresh();
    }
    async function retry(bookingId) {
      var row = view.rows.find(function (item) { return item.bookingId === bookingId; });
      if (retrying || !row || !row.canRetry || view.error) { return; }
      var token = generation;
      view.actionError = "";
      actions[bookingId] = { status: "running", message: "Recovering calculation. Waiting for CRM to confirm completion..." };
      retrying = bookingId; emit();
      try {
        var response = await deps.crm.executeFunction("recalculatesuppliersettlementsforbooking", { bookingId: "recover:" + validId(bookingId) });
        var output = response && response.details && response.details.output;
        output = typeof output === "string" ? JSON.parse(output) : output;
        if (!output || output.error !== false) { throw new Error(output && output.message || "The calculation outcome was not confirmed. Refresh the status before retrying."); }
        if (token !== generation) { return; }
        manualSuccess[bookingId] = Date.now();
        actions[bookingId] = { status: "success", message: output.message || "CRM confirmed calculation completion. Checking the queue..." };
      } catch (error) {
        if (token === generation) {
          view.actionError = error.message || "Calculation failed.";
          actions[bookingId] = { status: "error", message: view.actionError };
        }
      } finally {
        if (token === generation) {
          retrying = "";
          var actionError = view.actionError;
          if (inFlight) { await inFlight; }
          await refresh();
          if (token === generation) {
            var refreshed = (view.rows || []).find(function (item) { return item.bookingId === bookingId; });
            if (actions[bookingId] && actions[bookingId].status === "success") {
              actions[bookingId].message = refreshed && refreshed.status === "idle"
                ? "Calculation recovered. CRM confirms no pending work for this booking."
                : "CRM returned a successful calculation, but pending or unconfirmed work remains. Review the current status before recovering again.";
            }
            if (actionError) { view.actionError = actionError; }
            emit();
          }
        }
      }
    }
    return { start: start, stop: stop, refresh: refresh, retry: retry, getView: function () { return view; } };
  };
}(window));
