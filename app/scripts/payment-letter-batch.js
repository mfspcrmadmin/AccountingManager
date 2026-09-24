(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  ns.createPaymentLetterBatch = function (deps) {
    var selected = new Set(), rows = [], ledger = new Map(), busy = false, loading = false;
    var doc = deps.document, view, message = "", generation = 0;
    var esc = deps.helpers.escapeHtml;
    function editable(row) { return row.status !== "sent" && row.status !== "unknown" && row.status !== "unavailable"; }
    function pending() { return rows.filter(function (row) { return row.checked && editable(row); }); }
    function contactsLoading() { return rows.some(function (row) { return row.contacts && row.contacts.status === "loading"; }); }
    function renderContacts(row, index) {
      var state = row.contacts;
      if (!state) { return ""; }
      var content = state.status === "loading" ? "Loading contacts..." : state.status === "error" ? esc(state.message) : "No contacts associated with this supplier.";
      if (state.status === "ready" && state.records.length) {
        content = '<table class="payment-letter-contacts-table"><thead><tr><th>Name</th><th>Status</th><th>Contact Type</th><th>Email</th><th></th></tr></thead><tbody>' + state.records.map(function (contact, contactIndex) {
          var email = String(contact.Email || "").trim();
          return '<tr><td>' + esc(contact.Contact_Name || contact.Full_Name || contact.Name || contact.Last_Name || "-") + '</td><td>' + esc(contact.Status || "-") + '</td><td>' + esc(contact.Contact_Type || "-") + '</td><td>' + esc(email || "-") + '</td><td><button type="button" class="button secondary compact-action-button" data-batch-contact-row="' + index + '" data-batch-contact="' + contactIndex + '"' + (busy || loading || !editable(row) || !deps.validEmail(email) ? ' disabled' : '') + '>Select</button></td></tr>';
        }).join('') + '</tbody></table>';
      }
      return '<tr><td colspan="7"><div class="payment-letter-contacts" role="region" aria-label="Contacts for ' + esc(row.supplier.name) + '" aria-live="polite">' + content + '</div></td></tr>';
    }
    async function toggleContacts(index) {
      var row = rows[index];
      if (busy || loading || !row || !editable(row) || !row.supplier.id) { return; }
      if (row.contacts) { delete row.contacts; render(); return; }
      var token = generation, state = { status: "loading", records: [] };
      row.contacts = state; render();
      try {
        var records = await deps.crm.searchRecord("Contacts", "(Vendor_Name:equals:" + String(row.supplier.id) + ")");
        if (!Array.isArray(records)) { throw new Error("Could not load supplier contacts."); }
        state.records = records; state.status = "ready";
      } catch (error) { state.status = "error"; state.message = error.message || "Could not load supplier contacts."; }
      if (token === generation && row.contacts === state) { render(); }
    }
    function selectContact(index, contactIndex) {
      var row = rows[index], state = row && row.contacts;
      if (busy || loading || !row || !editable(row) || !state || state.status !== "ready") { return; }
      var contact = state.records[contactIndex], email = String(contact && contact.Email || "").trim();
      if (!deps.validEmail(email)) { return; }
      row.email = email; row.detail = ""; delete row.contacts; message = ""; render();
    }
    function render() {
      if (!doc) { return; }
      var panel = doc.getElementById("payment-letter-batch");
      doc.getElementById("payment-letter-batch-message").textContent = message || (loading ? "Loading supplier emails..." : rows.filter(function (r) { return r.status === "sent"; }).length + " sent · " + rows.filter(function (r) { return r.status === "failed"; }).length + " failed");
      doc.getElementById("payment-letter-batch-rows").innerHTML = rows.map(function (r, i) {
        var disabled = busy || loading || !editable(r);
        return '<tr><td><input type="checkbox" aria-label="Select letter for ' + esc(r.paymentName + ' / ' + r.supplier.name) + '" data-batch-check="' + i + '"' + (r.checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '></td><td>' + esc(r.paymentName) + '</td><td>' + esc(r.supplier.name) + '</td><td>' + (r.supplier.invoiceCount || 0) + '</td><td>' + esc(deps.helpers.formatCurrency(r.supplier.totalAllocated || 0)) + '</td><td><div class="payment-letter-batch-recipient"><input type="email" aria-label="Recipient for ' + esc(r.paymentName + ' / ' + r.supplier.name) + '" data-batch-email="' + i + '" value="' + esc(r.email) + '"' + (disabled ? ' disabled' : '') + '><button type="button" class="button secondary compact-action-button payment-letter-icon-button" data-batch-contacts="' + i + '" aria-label="' + (r.contacts ? 'Hide contacts' : 'See supplier contacts') + '" title="' + (r.contacts ? 'Hide contacts' : 'See supplier contacts') + '" aria-expanded="' + Boolean(r.contacts) + '"' + (disabled ? ' disabled' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="m15 15 6 6" fill="none" stroke="currentColor" stroke-width="2"></path></svg></button></div></td><td>' + esc(r.status + (r.detail ? ': ' + r.detail : '')) + '</td></tr>' + renderContacts(r, i);
      }).join("");
      panel.querySelector('[data-batch-send]').disabled = busy || loading || contactsLoading() || !pending().length;
      panel.querySelector('[data-batch-send]').textContent = busy ? "Sending..." : "Send selected letters";
      panel.querySelector('[data-batch-close]').disabled = busy || loading;
    }
    async function open() {
      if (busy || loading || !selected.size) { return; }
      generation += 1; loading = true; rows = []; message = "";
      if (doc) { doc.getElementById("payment-letter-batch").showModal(); }
      render();
      try {
        await deps.ensureAllocations();
        deps.state.records.payments.filter(function (p) { return selected.has(String(p.id)); }).forEach(function (payment) {
          var suppliers = deps.getSuppliers(payment);
          if (!suppliers.length) { suppliers = [{ id: "", name: "No supplier allocations" }]; }
          suppliers.forEach(function (supplier) {
            var key = String(payment.id) + ":" + supplier.id;
            var previous = ledger.get(key);
            if (previous) { delete previous.contacts; }
            rows.push(previous || { key: key, paymentId: String(payment.id), paymentName: payment.Name || String(payment.id), supplier: supplier, checked: !!supplier.id, email: "", status: supplier.id ? "pending" : "unavailable", detail: "" });
          });
        });
        var recipients = new Map();
        for (var row of rows) {
          if (!editable(row) || row.email) { continue; }
          if (!recipients.has(row.supplier.id)) {
            try { recipients.set(row.supplier.id, await deps.resolveRecipient(row.supplier)); }
            catch (error) { recipients.set(row.supplier.id, { email: "", message: error.message || "Could not load email" }); }
          }
          var recipient = recipients.get(row.supplier.id);
          row.email = recipient.email || "";
          row.detail = row.email ? "" : recipient.message || "Add an email or deselect this letter";
        }
      } catch (error) { message = error.message || "Could not prepare payment letters."; }
      finally { loading = false; render(); }
    }
    async function send() {
      if (busy || loading || contactsLoading()) { return; }
      var queue = pending();
      if (!queue.length) { return; }
      if (queue.some(function (r) { return !deps.validEmail(r.email.trim()); })) {
        message = "Correct missing or invalid emails, or deselect those letters."; render(); return;
      }
      busy = true; message = ""; render();
      try {
        var actor = String(await deps.getCurrentUserEmail() || "").trim().toLowerCase();
        if (!deps.validEmail(actor)) { throw new Error("Could not identify your CRM user email. No letters were sent."); }
        for (var row of queue) {
          row.status = "sending"; row.detail = ""; render();
          var emails = {}; emails[row.supplier.id] = row.email.trim();
          try {
            var result = deps.parseResult(await deps.crm.executeFunction(deps.functionName, {
              paymentId: row.paymentId, supplierIds: row.supplier.id,
              recipientEmail: deps.defaultRecipient, supplierEmailMapStr: JSON.stringify(emails), actingUserEmail: actor
            }));
            row.status = result.success && result.sentCount === 1 ? "sent" : result.success ? "unknown" : "failed";
            row.detail = row.status === "unknown" ? "Delivery could not be confirmed. Check before sending again." : result.message || "";
          } catch (error) {
            row.status = "unknown";
            row.detail = "Delivery could not be confirmed. Check before sending again. " + (error.message || "");
          }
          if (!editable(row)) { row.checked = false; }
          ledger.set(row.key, row); render();
        }
      } catch (error) { message = error.message || "Could not identify the sender."; }
      finally { busy = false; render(); }
    }
    function renderSelection(nextView) {
      view = nextView;
      var available = new Set(view.filteredRecords.map(function (p) { return String(p.id); }));
      selected.forEach(function (id) { if (!available.has(id)) { selected.delete(id); } });
      if (!doc) { return; }
      doc.getElementById("payment-letter-batch-open").disabled = deps.state.isLoading || !selected.size;
      doc.getElementById("payment-letter-batch-count").textContent = selected.size + " selected";
      var checks = doc.querySelectorAll('[data-payment-letter-select]');
      Array.prototype.forEach.call(checks, function (input) {
        input.checked = selected.has(input.getAttribute('data-payment-letter-select'));
      });
      var all = doc.querySelector('[data-payment-letter-select-all]');
      if (all) {
        var count = view.visibleRecords.filter(function (p) { return selected.has(String(p.id)); }).length;
        all.checked = !!count && count === view.visibleRecords.length;
        all.indeterminate = count > 0 && count < view.visibleRecords.length;
        all.disabled = deps.state.isLoading || !view.visibleRecords.length;
      }
    }
    if (doc) {
      doc.getElementById("payment-letter-batch-open").addEventListener("click", open);
      var panel = doc.getElementById("payment-letter-batch");
      panel.querySelector('[data-batch-send]').addEventListener("click", send);
      panel.querySelector('[data-batch-close]').addEventListener("click", function () { if (!busy && !loading) { panel.close(); } });
      panel.addEventListener("cancel", function (e) { if (busy || loading) { e.preventDefault(); } });
      panel.addEventListener("click", function (e) {
        var button = e.target.closest("[data-batch-contacts], [data-batch-contact]");
        if (!button) { return; }
        if (button.hasAttribute("data-batch-contacts")) { return toggleContacts(Number(button.getAttribute("data-batch-contacts"))); }
        selectContact(Number(button.getAttribute("data-batch-contact-row")), Number(button.getAttribute("data-batch-contact")));
      });
      panel.addEventListener("change", function (e) {
        if (busy || loading) { return; }
        var index = e.target.getAttribute("data-batch-check");
        if (index !== null && editable(rows[index])) { rows[index].checked = e.target.checked; }
        index = e.target.getAttribute("data-batch-email");
        if (index !== null && editable(rows[index])) { rows[index].email = e.target.value.trim(); }
        message = ""; render();
      });
      doc.getElementById("payments-table-wrap").addEventListener("change", function (e) {
        if (!view || deps.state.isLoading) { return; }
        var id = e.target.getAttribute("data-payment-letter-select");
        if (id !== null) { if (e.target.checked) { selected.add(id); } else { selected.delete(id); } }
        if (e.target.hasAttribute("data-payment-letter-select-all")) {
          view.visibleRecords.forEach(function (p) { if (e.target.checked) { selected.add(String(p.id)); } else { selected.delete(String(p.id)); } });
        }
        renderSelection(view);
      });
    }
    return { selected: selected, open: open, send: send, renderSelection: renderSelection, getRows: function () { return rows; }, toggleContacts: toggleContacts, selectContact: selectContact };
  };
}(window));
