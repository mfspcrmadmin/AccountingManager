(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var amountFields = [
    ["Invoice_Amount_Excl_VAT", "Amount excl. VAT"], ["VAT_percentage", "VAT %"], ["IRPF_percentage", "IRPF %"],
    ["Additional_Amount_Excl_VAT", "Additional amount excl. VAT"], ["Additional_VAT_percentage", "Additional VAT %"],
    ["Additional_IRPF_percentage", "Additional IRPF %"], ["Reimbursable_Expense", "Reimbursable Expense"]
  ];
  function round(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
  function totals(fields) {
    var n = function (key) {
      var value = Number(fields[key] || 0);
      if (!Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > .000001 || (/percentage/.test(key) && value > 100)) {
        var error = new Error("Enter a valid non-negative value with up to two decimals for " + key.replace(/_/g, " ") + ".");
        error.field = key; throw error;
      }
      return value;
    };
    var base = n("Invoice_Amount_Excl_VAT"), extra = n("Additional_Amount_Excl_VAT");
    var gross = round(base * (1 + n("VAT_percentage") / 100)), extraGross = round(extra * (1 + n("Additional_VAT_percentage") / 100));
    var tax = round(base * n("IRPF_percentage") / 100), extraTax = round(extra * n("Additional_IRPF_percentage") / 100);
    var total = round(gross + extraGross - tax - extraTax);
    return { invoice: total, payable: round(total + n("Reimbursable_Expense")), vat: round(gross - base), irpf: tax, additionalVat: round(extraGross - extra), additionalIrpf: extraTax };
  }
  ns.invoiceEditTotals = totals;
  ns.proposeFinalInvoiceNumber = function (name, mfspReference) {
    var mfsp = String(mfspReference || "").trim();
    if (!mfsp) {
      var reference = String(name || "").trim().replace(/^(?:PROF|INV)[-_\s]+/i, "");
      var match = reference.match(/^(MFSP[-_]?[^-_\s]+)/i);
      mfsp = match ? match[1] : reference.split(/[-_\s]/)[0];
    }
    return ("INV-" + mfsp).slice(0, 119) + "-";
  };
  ns.createInvoiceEditor = function (deps) {
    var dialog, context, invoiceId, busy = false, recovery = null, completed = false, completedAction = "keep", removedFileIds = [], finalizeProforma = false;
    var background = false, canContinue = false;
    function updateContinueButton() {
      var button = dialog.querySelector("[data-edit-continue]");
      if (!button) { return; }
      button.hidden = !canContinue && !background;
      button.disabled = false;
      button.textContent = background ? "Show details" : "Continue using the app";
    }
    function toggleBackground() {
      if (!background && !canContinue) { return; }
      background = !background;
      dialog.close();
      dialog.classList.toggle("invoice-edit-background", background);
      if (background) { dialog.show(); } else { dialog.showModal(); }
      updateContinueButton();
    }
    var esc = deps.helpers.escapeHtml;
    function uuid() { return global.crypto.randomUUID(); }
    function documentIcon(kind) {
      var paths = kind === "download" ? '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>' : kind === "upload" ? '<path d="M12 16V4m-4 4 4-4 4 4M5 16v4h14v-4"/>' : '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>';
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
    }
    function updateFinalNumber() {
      var current = String(context.invoice.Name || ""), suggested = ns.proposeFinalInvoiceNumber(current, context.invoice.MFSP_Reference), value = field("Name").value.trim();
      dialog.querySelectorAll("[data-final-number]").forEach(function (button) {
        button.hidden = current === suggested;
        button.setAttribute("aria-pressed", String(value === (button.dataset.finalNumber === "original" ? current : suggested)));
      });
      dialog.querySelector("[data-final-number-status]").textContent = value === current ? "Using current number" : value === suggested ? "Using suggested number" : value ? "Custom number" : "";
    }
    function renderFinalFiles(selected) {
      dialog.querySelector(".edit-saved-files").innerHTML = (context.invoice.Invoice_File || []).map(function (file, index) {
        var name = file.File_Name__s || file.File_Name || file.file_Name || file.name || "Invoice document";
        return '<li class="final-document-row">' + documentIcon("document") + '<div class="final-document-info"><small>Current document</small><span class="final-document-name" title="' + esc(name) + '">' + esc(name) + '</span></div><button type="button" class="button secondary final-document-download" data-edit-download="' + index + '" title="Download" aria-label="Download ' + esc(name) + '">' + documentIcon("download") + '</button></li>';
      }).join("");
      var zone = dialog.querySelector("[data-edit-drop]"), picker = dialog.querySelector("[data-edit-file]");
      zone.classList.toggle("has-new-file", Boolean(selected));
      dialog.querySelector("[data-final-selected]").hidden = !selected;
      var nameNode = dialog.querySelector("[data-edit-file-name]");
      nameNode.textContent = selected ? selected.name : ""; nameNode.title = selected ? selected.name : "";
      dialog.querySelector("[data-final-file-size]").textContent = selected ? "Not saved · " + (selected.size < 1024 ? selected.size + " B" : selected.size < 1048576 ? (selected.size / 1024).toFixed(1) + " KB" : (selected.size / 1048576).toFixed(1) + " MB") : "";
      picker.innerHTML = selected ? "Change" : documentIcon("upload") + '<span>Drop a file here or <span class="final-browse">browse</span></span>';
      picker.title = selected ? "Change selected file" : "Choose final invoice document";
      picker.setAttribute("aria-label", picker.title);
      dialog.querySelector("[data-edit-clear-file]").hidden = !selected;
      dialog.querySelector("[data-edit-file-plan]").textContent = selected ? ((context.invoice.Invoice_File || []).length ? "Replaces the current document when you save." : "This document will be attached when you save.") : context.source_documents ? "Documents remain on the linked prepayment or card purchase; no copy is required." : "";
    }
    function renderFiles() {
      var selected = field("file").files[0];
      if (finalizeProforma) { renderFinalFiles(selected); return; }
      dialog.querySelector(".edit-saved-files").innerHTML = (context.invoice.Invoice_File || []).map(function (file, index) {
        var name = file.File_Name__s || file.File_Name || file.file_Name || file.name || "Invoice document";
        var removed = removedFileIds.indexOf(String(file.id)) !== -1;
        return '<li class="' + (removed ? 'is-removed' : '') + '"><span><small>' + (removed ? 'Removed on save' : 'Saved document') + '</small><span class="edit-saved-file-name">' + esc(name) + '</span></span><div class="edit-file-actions"><button type="button" class="button secondary" data-edit-download="' + index + '" title="Download saved document" aria-label="Download ' + esc(name) + '">Download</button><button type="button" class="button secondary" data-edit-remove-file="' + index + '" title="' + (removed ? 'Undo removal' : 'Remove on save') + '" aria-label="' + (removed ? 'Restore ' : 'Remove ') + esc(name) + '">' + (removed ? 'Undo' : 'Remove') + '</button></div></li>';
      }).join("");
      dialog.querySelector("[data-edit-file-name]").textContent = selected ? selected.name : "Drop a corrected document here";
      dialog.querySelector("[data-edit-clear-file]").hidden = !selected;
      dialog.querySelector("[data-edit-file]").textContent = (context.invoice.Invoice_File || []).length ? "Replace file" : "Choose file";
      dialog.querySelector("[data-edit-file-plan]").textContent = removedFileIds.length ? (selected ? "The new document will replace the removed file when you save." : "Attach a replacement document before saving.") : context.source_documents ? "Documents remain on the linked prepayment or card purchase; no copy is required." : "";
    }
    async function downloadFile(index) {
      var file = context.invoice.Invoice_File[index];
      var fileId = file.File_Id__s || file.$file_id || file.file_Id || file.File_Id || file.id;
      try {
        if (!fileId) { throw new Error("The saved document has no downloadable file identifier."); }
        var data = await deps.crm.getFile(fileId);
        var blob = data instanceof Blob ? data : data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? new Blob([data]) : null;
        if (!blob) { throw new Error("CRM did not return the document. Try opening it from the invoice record."); }
        var url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = file.File_Name__s || file.File_Name || file.file_Name || "invoice-document";
        link.click(); global.setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      } catch (error) { message(error.message, true); }
    }
    function key() { return "accounting-manager:invoice-edit:v1:" + invoiceId; }
    function message(text, error) { var node = dialog.querySelector("[data-edit-message]"); node.classList.remove("is-loading"); node.setAttribute("aria-live", error ? "assertive" : "polite"); node.textContent = text || ""; node.classList.toggle("is-error", Boolean(error)); }
    function progress(title, detail) {
      var node = dialog.querySelector("[data-edit-message]");
      node.classList.remove("is-error"); node.classList.add("is-loading"); node.setAttribute("aria-live", "polite");
      node.innerHTML = '<span class="inline-feedback-spinner" aria-hidden="true"></span><span class="edit-progress-copy"><strong>' + esc(title) + '</strong><span>' + esc(detail || "") + '</span></span>';
    }
    function invalid(name, text) {
      var node = typeof name === "string" ? field(name) : name;
      if (node) {
        node.setAttribute("aria-invalid", "true");
        var parent = node.closest(".edit-tax") || node.closest("label") || node.parentElement;
        var hint = document.createElement("span"); hint.className = "edit-field-error"; hint.textContent = text;
        hint.id = "edit-error-" + (node.name || "allocation");
        node.setAttribute("aria-describedby", hint.id); parent.appendChild(hint);
        if (finalizeProforma && node.name === "file") {
          var picker = dialog.querySelector("[data-edit-file]");
          picker.setAttribute("aria-invalid", "true"); picker.setAttribute("aria-describedby", hint.id);
        }
        var detail = node.closest("details"); if (detail) { detail.open = true; }
        parent.scrollIntoView({ block: "nearest" });
      }
      return new Error(text);
    }
    function clearErrors() {
      dialog.querySelectorAll(".edit-field-error").forEach(function (n) { n.remove(); });
      dialog.querySelectorAll("[aria-invalid]").forEach(function (n) { n.removeAttribute("aria-invalid"); n.removeAttribute("aria-describedby"); });
    }
    function field(name) { return dialog.querySelector('[name="' + name + '"]'); }
    function money(value) { return new Intl.NumberFormat("en-GB", { style: "currency", currency: context.invoice.Currency || "EUR" }).format(Number(value || 0)); }
    async function call(request, operationKey) {
      if (finalizeProforma && request.action === "preview") { request = Object.assign({}, request, { action: "preview_conversion" }); }
      var response = await deps.crm.executeFunction("supplierinvoice_register", { operationKey: operationKey, requestJson: JSON.stringify(Object.assign({ operation: "edit", invoice_id: invoiceId }, request)) });
      var result = response && response.details && response.details.output;
      if (typeof result === "string") { result = JSON.parse(result); }
      if (!result || typeof result.success !== "boolean") { throw new Error("CRM did not confirm the edit result. Reopen Edit to check or resume this correction."); }
      return result;
    }
    function fields() {
      var values = {};
      ["Name", "Invoice_Date", "Invoice_Type"].concat(amountFields.map(function (f) { return f[0]; })).forEach(function (name) { values[name] = field(name).value; });
      return values;
    }
    function review(name) { return '<label class="inline-review-toggle"><input type="checkbox" name="' + name + '" aria-required="true">Reviewed<span class="invoice-required">*</span></label>'; }
    function amount(name, caption) {
      return '<label class="field"><span>' + caption + '</span><input data-edit-amount name="' + name + '" type="number" step="0.01" min="0"' + (/percentage/.test(name) ? ' max="100"' : '') + ' value="' + esc(String(context.invoice[name] || 0)) + '"></label>';
    }
    function tax(name, caption, reviewed) {
      return '<div class="edit-tax"><label for="edit-' + name + '">' + caption + '</label><div class="invoice-create-tax-input-row"><input id="edit-' + name + '" data-edit-amount name="' + name + '" type="number" step="0.01" min="0" max="100" value="' + esc(String(context.invoice[name] || 0)) + '">' + review(reviewed) + '</div></div>';
    }
    function readonly(caption, marker) { return '<div class="invoice-create-calculated-field"><span>' + caption + '</span><strong ' + marker + '></strong></div>'; }
    function allocationTotals() {
      try {
        var sum = 0; dialog.querySelectorAll("[data-edit-allocation]").forEach(function (input) { sum += Number(input.value || 0); });
        dialog.querySelector("[data-edit-allocated]").textContent = money(round(sum));
        dialog.querySelector("[data-edit-remaining]").textContent = money(round(totals(fields()).payable - sum));
      } catch (_) { /* Field validation will explain invalid amounts. */ }
    }
    async function loadSettlementContext() {
      var container = dialog.querySelector("[data-edit-context]");
      var currentId = invoiceId;
      await Promise.all(Object.keys(context.settlements).map(async function (sid) {
        var settlement = context.settlements[sid];
        var target = container.querySelector('[data-services="' + sid + '"]');
        try {
          if (!/^[0-9]+$/.test(sid) || !deps.crm.coql) { throw new Error("Services could not be loaded."); }
          var records = [], complete = false;
          for (var offset = 0; offset < 5000; offset += 200) {
            var rows = await deps.crm.coql("select id,Name,Product_Description,Service_Date,Total_Purchase_Price,Final_Purchase_Cost from Booking_Services where Supplier_Settlement = '" + sid + "' order by Service_Date asc, id asc limit " + offset + ", 200", { strict: true });
            if (!Array.isArray(rows)) { throw new Error("Incomplete services response."); }
            records = records.concat(rows);
            if (rows.length < 200) { complete = true; break; }
          }
          if (!complete) { throw new Error("Too many services to display completely."); }
          if (currentId !== invoiceId || !container.isConnected) { return; }
          target.innerHTML = '<summary>Related booking services <span>(' + records.length + ')</span></summary>' +
            (records.length ? records.map(function (s) { return '<article class="supplier-service-item"><div><strong>' + esc(s.Product_Description || s.Name || "Service") + '</strong><span>' + esc(s.Service_Date || "Date unavailable") + '</span></div><dl><div><dt>Total purchase price</dt><dd>' + money(s.Total_Purchase_Price) + '</dd></div><div><dt>Final purchase cost</dt><dd>' + money(s.Final_Purchase_Cost) + '</dd></div></dl></article>'; }).join("") : '<p>No related booking services.</p>');
        } catch (_) { if (target.isConnected) { target.innerHTML = '<summary>Related booking services</summary><p role="status">Services could not be loaded. Reopen the invoice to retry.</p>'; target.open = true; } }
        var bookingId = settlement.Booking && settlement.Booking.id;
        if (bookingId && deps.crm.getRecord) {
          try {
            var booking = await deps.crm.getRecord("Deals", bookingId);
            if (currentId === invoiceId && container.isConnected) {
              container.querySelector('[data-booking="' + sid + '"]').textContent = [booking.MFSP_Reference, booking.Deal_Name || settlement.Booking.name].filter(Boolean).join(" · ");
            }
          } catch (_) { /* Keep the saved booking lookup when a detail read is unavailable. */ }
        }
      }));
    }
    function contextMarkup() {
      return '<h3>Associated settlements</h3><p class="edit-caption">Saved settlement totals</p>' + Object.keys(context.settlements).map(function (sid) {
        var s = context.settlements[sid], cost = Number(s.Total_Service_Cost || 0), invoiced = Number(s.Total_Invoice || 0), paid = Number(s.Total_Paid || 0);
        return '<section class="edit-settlement"><strong>' + esc(s.Name || sid) + '</strong><p data-booking="' + sid + '">' + esc(s.Booking && (s.Booking.name || s.Booking.id) || "Booking unavailable") + '</p><span class="edit-status">' + esc(s.Admin_Status || "Status unavailable") + '</span><h4>Settlement totals</h4><dl class="edit-settlement-totals">' +
          [["Pending invoicing", round(cost - invoiced)], ["Total service cost", cost], ["Already invoiced", invoiced], ["Total paid", paid], ["Unpaid invoiced amount", round(invoiced - paid)]].map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + money(r[1]) + '</dd></div>'; }).join("") +
          '</dl><details open class="invoice-create-services-panel" data-services="' + sid + '"><summary>Related booking services</summary><p>Loading services…</p></details></section>';
      }).join("");
    }
    function grossAmount(attribute, caption) {
      return '<label class="field"><span>' + caption + '</span><input ' + attribute + ' type="number" step="0.01" min="0"><small data-gross-rounding hidden role="status"></small></label>';
    }
    function updateGross(input, value, source) {
      var note = input.parentElement.querySelector("[data-gross-rounding]");
      if (input === source) {
        var differs = input.value !== "" && Math.abs(Number(input.value) - value) >= .005;
        note.hidden = !differs;
        note.textContent = differs ? "With a base rounded to cents, the amount including VAT is " + money(value) + "." : "";
      } else {
        input.value = value.toFixed(2);
        note.hidden = true;
      }
    }
    function updateTotals(source) {
      try {
        var calculated = totals(fields());
        dialog.querySelector("[data-edit-total]").textContent = money(calculated.payable);
        dialog.querySelector("[data-edit-pending]").textContent = money(round(calculated.payable - context.paid));
        updateGross(dialog.querySelector("[data-edit-gross]"), round(Number(field("Invoice_Amount_Excl_VAT").value || 0) + calculated.vat), source);
        updateGross(dialog.querySelector("[data-edit-extra-gross]"), round(Number(field("Additional_Amount_Excl_VAT").value || 0) + calculated.additionalVat), source);
        [["vat", calculated.vat], ["irpf", calculated.irpf], ["additional-vat", calculated.additionalVat], ["additional-irpf", calculated.additionalIrpf], ["invoice", calculated.invoice], ["payable", calculated.payable]].forEach(function (pair) { dialog.querySelector('[data-result="' + pair[0] + '"]').textContent = money(pair[1]); });
        ["additional_vat_reviewed", "additional_irpf_reviewed"].forEach(function (name) {
          field(name).closest("label").hidden = Number(field("Additional_Amount_Excl_VAT").value) <= 0;
        });
        var rows = dialog.querySelectorAll("[data-edit-allocation]");
        if (rows.length === 1) { rows[0].value = calculated.payable.toFixed(2); }
        allocationTotals();
      } catch (error) { message(error.message, true); }
    }
    function lock(value) {
      busy = value;
      dialog.setAttribute("aria-busy", String(value));
      dialog.querySelector("[data-edit-save]").classList.toggle("is-saving", value);
      if (!value) { dialog.querySelector("[data-edit-message]").classList.remove("is-loading"); }
      dialog.querySelectorAll("button,input,select,textarea").forEach(function (node) { node.disabled = value; });
      dialog.querySelector("[data-edit-save]").textContent = value ? "Saving..." : completed ? "Refresh view" : recovery ? "Resume correction" : finalizeProforma ? "Convert to final invoice" : "Save changes";
      var closeButton = dialog.querySelector("footer [data-edit-close]");
      if (closeButton) { closeButton.textContent = completed || recovery ? "Close" : "Cancel"; }
      updateContinueButton();
    }
    function persist(journal) {
      var serialized = JSON.stringify(journal);
      global.localStorage.setItem(key(), serialized);
      if (global.localStorage.getItem(key()) !== serialized) { throw new Error("Recovery information could not be stored. The edit has not been submitted."); }
      recovery = journal;
    }
    function choosePaymentAction(payable) {
      return new Promise(function (resolve) {
        var popup = document.createElement("dialog");
        popup.className = "invoice-payment-choice";
        popup.setAttribute("aria-labelledby", "invoice-payment-choice-title");
        var delta = round(payable - context.paid), reserved = Number(context.reserved || 0);
        var payments = (context.payments || []).filter(function (p) { return p.can_correct && round(Number(p.allocated) + delta) > 0; });
        var canKeep = payable >= reserved, canCorrect = payments.length > 0 && delta !== 0 && reserved <= context.paid;
        popup.innerHTML = '<form><h2 id="invoice-payment-choice-title">Update the related payment?</h2><dl><div><dt>Previous payable</dt><dd>' + money(context.invoice.Total_Payable_Amount) + '</dd></div><div><dt>New payable</dt><dd>' + money(payable) + '</dd></div><div><dt>Already paid</dt><dd>' + money(context.paid) + '</dd></div></dl>' +
          '<label class="payment-choice-option"><input type="radio" name="payment_action" value="keep"' + (canKeep ? ' checked' : ' disabled') + '><span><strong>Keep existing payments</strong><small>Keep ' + money(context.paid) + ' paid. Pending balance: ' + money(delta) + '. The invoice status will reflect this balance.</small></span></label>' +
          '<label class="payment-choice-option"><input type="radio" name="payment_action" value="correct"' + (canCorrect ? '' : ' disabled') + '><span><strong>Correct an existing payment</strong><small>Adjust a recorded payment so this invoice is fully paid. Only use this if the amount actually paid changed.</small></span></label>' +
          '<div data-payment-correction hidden><label>Payment<select data-payment-id>' + payments.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select></label><p data-payment-effect></p><label class="payment-choice-confirm"><input type="checkbox" data-payment-confirm> I confirm this is the amount actually paid.</label></div>' +
          '<label class="payment-choice-option"><input type="radio" name="payment_action" value="additional"' + (payable > reserved && deps.openAdditionalPayment ? '' : ' disabled') + '><span><strong>Add a payment for the difference</strong><small>Save this correction, then confirm the date, account and amount in the payment form. Until then, ' + money(delta) + ' remains unpaid.</small></span></label>' +
          (!canCorrect ? '<p class="payment-choice-hint">No eligible payment can be corrected here. Reconciled, exported or locked payments require review.</p>' : '') +
          (!canKeep ? '<p class="payment-choice-hint">The new payable is below existing allocations. Correct the payment amount to continue.</p>' : '') +
          '<footer><button type="button" class="button secondary" data-payment-cancel>Back</button><button type="submit" class="button primary" data-payment-continue>Continue</button></footer></form>';
        document.body.appendChild(popup);
        var finished = false;
        function finish(value) { if (finished) { return; } finished = true; popup.close(); popup.remove(); resolve(value); }
        function update() {
          var chosen = popup.querySelector('[name="payment_action"]:checked'), correct = chosen && chosen.value === "correct";
          popup.querySelector("[data-payment-correction]").hidden = !correct;
          var payment = payments.find(function (p) { return String(p.id) === popup.querySelector("[data-payment-id]").value; });
          if (payment) { popup.querySelector("[data-payment-effect]").textContent = "Payment total: " + money(payment.amount) + " → " + money(round(Number(payment.amount) + delta)) + ". Allocated to this invoice: " + money(payment.allocated) + " → " + money(round(Number(payment.allocated) + delta)) + "."; }
          popup.querySelector("[data-payment-continue]").disabled = !chosen || (correct && !popup.querySelector("[data-payment-confirm]").checked);
        }
        popup.addEventListener("change", function (event) { if (!event.target.matches("[data-payment-confirm]")) { popup.querySelector("[data-payment-confirm]").checked = false; } update(); });
        popup.addEventListener("cancel", function (event) { event.preventDefault(); finish(null); });
        popup.querySelector("[data-payment-cancel]").onclick = function () { finish(null); };
        popup.querySelector("form").onsubmit = function (event) {
          event.preventDefault();
          var chosen = popup.querySelector('[name="payment_action"]:checked');
          if (!chosen || popup.querySelector("[data-payment-continue]").disabled) { return; }
          finish({ payment_action: chosen.value, payment_id: chosen.value === "correct" ? popup.querySelector("[data-payment-id]").value : "", confirm_actual_payment: chosen.value === "correct" });
        };
        update(); popup.showModal();
      });
    }
    async function finishSaved() {
      progress("Changes saved. Refreshing the view...", finalizeProforma ? "Showing the final invoice details and document." : "Updating the invoice, payment balances and settlement totals on screen.");
      await deps.refresh(invoiceId);
      if (background && completedAction === "additional") {
        message("Invoice saved and balances updated. Show details, then choose Refresh view to open the additional payment form.");
        return;
      }
      if (completedAction === "additional") {
        await deps.openAdditionalPayment(invoiceId);
        completedAction = "keep";
        deps.notify("Invoice saved. Confirm the additional payment in the payment form.");
      } else { deps.notify(finalizeProforma ? "Proforma converted to Final Invoice." : "Invoice, payment balances and settlement totals updated."); }
      if (background) { message("Invoice " + (context.invoice.Name || invoiceId) + " saved. Related balances and the view are updated."); }
      else { dialog.close(); }
    }
    async function save(event) {
      event.preventDefault();
      if (busy) { return; }
      message(""); clearErrors();
      lock(true);
      progress(recovery ? "Resuming the correction..." : "Checking your changes...", recovery ? "Checking saved progress before continuing the remaining updates." : "Validating invoice details, amounts and the document.");
      try {
        if (completed) { await finishSaved(); return; }
        if (!recovery) {
          var request, file;
          if (finalizeProforma) {
            if (context.invoice.Invoice_Type !== "Proforma" || field("Invoice_Type").value !== "Final Invoice") { throw invalid("Invoice_Type", "Only a proforma can be converted to Final Invoice."); }
            var number = field("Name").value.trim();
            if (!number || number.length > 120) { throw invalid("Name", "Enter the final invoice number (up to 120 characters)."); }
            var invoiceDate = field("Invoice_Date").value;
            if (!invoiceDate || !field("Invoice_Date").validity.valid) { throw invalid("Invoice_Date", "Enter a valid invoice date."); }
            file = field("file").files[0];
            if (!file && (!context.source_documents || (context.invoice.Invoice_File || []).length)) { throw invalid("file", "Attach the final invoice document to replace the proforma."); }
            request = { action: "convert_proforma", modified_time: context.invoice.Modified_Time, invoice_type: "Final Invoice", invoice_number: number, invoice_date: invoiceDate };
          } else {
          // Local validation explains errors; the server repeats all business checks.
          dialog.querySelectorAll("[data-edit-gross], [data-edit-extra-gross]").forEach(function (input) {
            var value = Number(input.value);
            if (input.validity.badInput || !Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > .000001) {
              throw invalid(input, "Enter a non-negative amount including VAT with up to two decimals.");
            }
          });
          var values = fields(), computed = totals(values);
          var missing = ["Invoice_Type", "Name", "Invoice_Date"].find(function (name) { return !values[name].trim(); });
          if (missing) { throw invalid(missing, "Invoice type, number and date are required."); }
          if (!field("reason").value.trim()) { throw invalid("reason", "Enter the reason for this correction."); }
          var reviews = ["vat_reviewed", "irpf_reviewed"];
          if (Number(values.Additional_Amount_Excl_VAT) > 0) { reviews = reviews.concat(["additional_vat_reviewed", "additional_irpf_reviewed"]); }
          var unreviewed = reviews.find(function (name) { return !field(name).checked; });
          if (unreviewed) { throw invalid(unreviewed, "Confirm the Reviewed checkboxes before saving."); }
          var allocations = {}, sum = 0;
          dialog.querySelectorAll("[data-edit-allocation]").forEach(function (input) { var value = Number(input.value); if (!(value > 0) || Math.abs(value * 100 - Math.round(value * 100)) > .000001) { throw invalid(input, "Enter a positive allocation with up to two decimals for each settlement."); } allocations[input.dataset.editAllocation] = value; sum += value; });
          if (round(sum) !== computed.payable || computed.invoice <= 0) { throw invalid(dialog.querySelector("[data-edit-allocation]"), "Allocate the complete payable amount across the settlements."); }
          if (!field("confirm_excess").checked) {
            var excesses = Object.keys(allocations).map(function (sid) {
              var settlement = context.settlements[sid];
              var split = context.splits.find(function (row) { return String(row.Vendor_Settlement.id) === sid; });
              var previous = Number(split ? split.Allocated_Amount : context.invoice.Total_Payable_Amount) || 0;
              var invoiced = round(Number(settlement.Total_Invoice || 0) - previous + allocations[sid]);
              var cost = Number(settlement.Total_Service_Cost || 0);
              return invoiced > cost ? (settlement.Name || sid) + ": corrected invoiced total " + money(invoiced) + ", service cost " + money(cost) + ", excess " + money(round(invoiced - cost)) + "." : "";
            }).filter(Boolean);
            if (excesses.length) {
              throw invalid("confirm_excess", excesses.join(" ") + " Review the amounts. If the excess is intentional, select Allow allocations above the settlement service cost, then save again. No correction has been submitted.");
            }
          }
          var file = field("file").files[0];
          var keptFiles = (context.invoice.Invoice_File || []).filter(function (f) { return removedFileIds.indexOf(String(f.id)) === -1; });
          if (!file && !keptFiles.length && (!context.source_documents || (context.invoice.Invoice_File || []).length)) { throw invalid("file", "Attach the invoice document before saving."); }
          if (keptFiles.length + (file ? 1 : 0) > 1) { throw invalid("file", "Remove the current document before adding its replacement."); }
          var paymentChoice = { payment_action: "keep" };
          if (Number(context.reserved) > 0 && computed.payable !== round(Number(context.invoice.Total_Payable_Amount || 0))) {
            paymentChoice = await choosePaymentAction(computed.payable);
            if (!paymentChoice) { message(""); return; }
          }
          if (paymentChoice.payment_action !== "correct" && computed.payable < context.reserved) { throw invalid(dialog.querySelector("[data-edit-allocation]"), "The payable cannot be below existing payment allocations."); }
          // Verify storage before uploading or submitting.
          global.localStorage.setItem(key() + ":probe", "1"); global.localStorage.removeItem(key() + ":probe");
          var request = { action: "save", modified_time: context.invoice.Modified_Time, reason: field("reason").value.trim(), fields: values, allocations: allocations, confirm_excess: field("confirm_excess").checked };
          Object.assign(request, paymentChoice);
          request.remove_file_ids = removedFileIds.slice();
          ["vat_reviewed", "irpf_reviewed", "additional_vat_reviewed", "additional_irpf_reviewed"].forEach(function (name) { request[name] = field(name).checked; });
          }
          global.localStorage.setItem(key() + ":probe", "1"); global.localStorage.removeItem(key() + ":probe");
          if (file) {
            progress("Uploading the invoice document...", "The saved document will be replaced when the invoice is saved.");
            var uploaded = await deps.crm.uploadFile(file), row = uploaded && uploaded.data && uploaded.data[0];
            if (!row || row.status !== "success" || !row.details || !row.details.id) { throw new Error("The invoice file could not be uploaded. No edit was submitted."); }
            request.file_id = String(row.details.id);
          }
          request.batch = true;
          persist({ operationKey: uuid(), request: request });
        }
        var documentReview = field("confirm_saved_document");
        if (documentReview) {
          if (!documentReview.checked) { throw invalid(documentReview, "Download and review the saved document, then confirm it is the correct invoice document."); }
          var reviewedFile = context.invoice.Invoice_File[0];
          recovery.request = { action: "resume", confirm_saved_document: true, confirmed_attachment_id: String(reviewedFile.id || reviewedFile.attachment_Id), modified_time: context.invoice.Modified_Time };
          persist(recovery);
        }
        progress(recovery.request.action === "resume" ? "Resuming the correction..." : finalizeProforma ? "Converting to final invoice..." : "Preparing and saving the correction...", finalizeProforma ? "Saving the invoice details and replacing the proforma document." : "Checking related records and saving a recovery plan. Please keep this window open.");
        var result = await call(recovery.request, recovery.operationKey);
        while (result.pending === true) {
          var step = result.progress || {}, stages = {
            conversion_references: ["Updating invoice references...", "Updating the copied invoice number and date."],
            header: ["Saving invoice details...", "Saving the number, date, amounts and document."],
            payments: ["Updating payment...", "Checking payment amounts and allocations."],
            splits: ["Updating settlement allocations...", "Applying the corrected invoice amounts to its settlements."],
            accounting: ns.ACCOUNTING_ENTRY_GENERATION_ENABLED === true ? ["Updating invoice accounting...", "Updating and checking the invoice accounting entries."] : ["Checking invoice...", "Accounting generation is paused; existing entries and links are preserved."],
            cards: ["Updating related records...", "Updating invoice references in linked records."],
            settlements: ["Recalculating settlement totals...", "Updating invoiced amounts, paid amounts and outstanding balances."],
            verify: ["Checking the final result...", "Verifying the invoice, payments and related records before confirming completion."]
          }, stage = stages[step.stage] || ["Completing the correction...", "Updating the remaining related records."];
          progress(stage[0], (result.saved ? "Invoice saved. " : "") + stage[1] + (step.detail ? " " + step.detail + "." : ""));
          canContinue = result.saved === true && recovery.request.payment_action !== "additional";
          updateContinueButton();
          dialog.querySelector("[data-edit-save]").textContent = "Saving...";
          result = await call({ action: "resume" }, recovery.operationKey);
        }
        if (!result.success) {
          if (!result.retryable && !context.pending && !result.saved) {
            // A fresh preview distinguishes validation rejection from an uncertain save.
            var latest = await call({ action: "preview" }, uuid());
            if (latest.success && !latest.pending) { global.localStorage.removeItem(key()); recovery = null; }
          }
          if (!recovery && !result.saved && /The corrected invoice exceeds a settlement service cost/.test(result.message || "")) {
            throw invalid("confirm_excess", "The corrected invoiced total exceeds the settlement service cost. Review the amounts and select Allow allocations above the settlement service cost if the excess is intentional, then save again.");
          }
          throw new Error((result.saved ? "The invoice was saved, but related updates are incomplete. " : "") + (result.message || "Could not complete the correction.") + (result.recovery_message ? " " + result.recovery_message : ""));
        }
        completedAction = result.payment_action || recovery.request.payment_action || "keep";
        global.localStorage.removeItem(key()); recovery = null; completed = true;
        canContinue = false;
        dialog.querySelector(".invoice-edit-background-note").textContent = "Related updates are complete.";
        try { await finishSaved(); }
        catch (_) { message("The correction was saved. " + (completedAction === "additional" ? "The payment form could not open; no additional payment was created. " : "") + "Use Refresh view to retry.", true); }
      } catch (error) { if (error.field) { invalid(error.field, error.message); } message(error.message || "Could not save the correction.", true); }
      finally { lock(false); if (recovery) { var fs = dialog.querySelector("fieldset"); if (fs) { fs.disabled = true; } } }
    }
    async function discard() {
      if (busy || !recovery) { return; }
      lock(true);
      progress("Discarding the unsaved correction...", "Checking that no invoice changes have been applied.");
      try {
        var result = await call({ action: "discard" }, recovery.operationKey);
        if (!result.success || !result.discarded) { throw new Error(result.message || "Could not discard the correction."); }
        global.localStorage.removeItem(key()); recovery = null; dialog.close(); busy = false; await open(invoiceId, { finalizeProforma: finalizeProforma });
      } catch (error) { message(error.message, true); lock(false); }
    }
    async function open(id, options) {
      if (busy || (dialog && dialog.open)) {
        if (background) { toggleBackground(); }
        return;
      }
      background = false; canContinue = false;
      invoiceId = String(id); completed = false; completedAction = "keep"; context = null; recovery = null; removedFileIds = [];
      finalizeProforma = Boolean(options && options.finalizeProforma);
      if (!dialog) {
        dialog = global.document.createElement("dialog"); dialog.className = "invoice-edit-dialog"; dialog.setAttribute("aria-labelledby", "invoice-edit-heading");
        global.document.body.appendChild(dialog);
        dialog.addEventListener("cancel", function (event) { if (busy) { event.preventDefault(); } });
        dialog.addEventListener("submit", save);
        dialog.addEventListener("click", function (event) {
          if (event.target.closest("[data-edit-continue]")) { toggleBackground(); return; }
          var numberAction = event.target.closest("[data-final-number]");
          if (numberAction && !busy && !recovery) { field("Name").value = numberAction.dataset.finalNumber === "original" ? context.invoice.Name || "" : ns.proposeFinalInvoiceNumber(context.invoice.Name, context.invoice.MFSP_Reference); updateFinalNumber(); field("Name").focus(); return; }
          var remove = event.target.closest("[data-edit-remove-file]");
          if (remove && !busy && !recovery) {
            var savedFile = context.invoice.Invoice_File[Number(remove.dataset.editRemoveFile)];
            if (!savedFile.id) { message("The document identifier is unavailable. Reopen the invoice before replacing it.", true); return; }
            var id = String(savedFile.id);
            if (removedFileIds.indexOf(id) === -1) { removedFileIds.push(id); }
            else { removedFileIds = removedFileIds.filter(function (v) { return v !== id; }); field("file").value = ""; }
            renderFiles(); return;
          }
          if (event.target.closest("[data-edit-clear-file]") && !busy && !recovery) { field("file").value = ""; removedFileIds = []; renderFiles(); return; }
          var download = event.target.closest("[data-edit-download]");
          if (download && !busy) { downloadFile(Number(download.dataset.editDownload)); return; }
          if (event.target.closest("[data-edit-file]") && !busy && !recovery) { field("file").click(); return; }
          if (event.target.closest("[data-edit-discard]")) { discard(); return; }
          if (event.target.closest("[data-edit-close]") && !busy) { dialog.close(); }
        });
        dialog.addEventListener("input", function (event) {
          var input = event.target;
          if (!input.matches("[data-edit-amount], [data-edit-gross], [data-edit-extra-gross]")) { return; }
          ["vat_reviewed", "irpf_reviewed", "additional_vat_reviewed", "additional_irpf_reviewed"].forEach(function (name) { field(name).checked = false; });
          if (input.matches("[data-edit-gross], [data-edit-extra-gross]")) {
            var extra = input.hasAttribute("data-edit-extra-gross");
            var rate = Number(field(extra ? "Additional_VAT_percentage" : "VAT_percentage").value || 0);
            var value = Number(input.value);
            if (input.validity.badInput || !Number.isFinite(value) || value < 0 || rate < 0 || rate > 100) { return; }
            field(extra ? "Additional_Amount_Excl_VAT" : "Invoice_Amount_Excl_VAT").value = input.value === "" ? "" : round(value / (1 + rate / 100)).toFixed(2);
          }
          updateTotals(input);
        });
        dialog.addEventListener("change", function (event) {
          if (event.target.name === "Invoice_Type") { field("Invoice_Date").value = ns.defaultInvoiceDate(event.target.value); }
          if (event.target.matches("[data-edit-gross], [data-edit-extra-gross]") && event.target.validity.valid) {
            var entered = Number(event.target.value);
            updateTotals();
            if (Math.abs(entered - Number(event.target.value)) >= .005) {
              var note = event.target.parentElement.querySelector("[data-gross-rounding]");
              note.hidden = false;
              note.textContent = "Rounded from " + money(entered) + " to " + money(event.target.value) + " to match the base rounded to cents.";
            }
          }
        });
        dialog.addEventListener("input", function (event) { if (event.target.matches("[data-edit-allocation]")) { allocationTotals(); } });
        dialog.addEventListener("input", function (event) { if (finalizeProforma && event.target.name === "Name") { updateFinalNumber(); } });
        dialog.addEventListener("dragover", function (event) { var zone = event.target.closest("[data-edit-drop]"); if (zone) { event.preventDefault(); if (!busy && !recovery) { zone.classList.add("is-dragging-file"); } } });
        dialog.addEventListener("dragleave", function (event) { var zone = event.target.closest("[data-edit-drop]"); if (zone && !zone.contains(event.relatedTarget)) { zone.classList.remove("is-dragging-file"); } });
        dialog.addEventListener("drop", function (event) {
          if (!event.target.closest("[data-edit-drop]")) { return; } event.preventDefault();
          event.target.closest("[data-edit-drop]").classList.remove("is-dragging-file");
          if (busy || recovery || !event.dataTransfer.files.length) { return; }
          if (event.dataTransfer.files.length > 1) { var fileError = finalizeProforma ? "Choose one final invoice document at a time." : "Choose one corrected document at a time."; clearErrors(); invalid("file", fileError); message(fileError, true); return; }
          field("file").files = event.dataTransfer.files; field("file").dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
      dialog.innerHTML = '<header class="panel-header"><div><h2 id="invoice-edit-heading">Edit supplier invoice</h2><p data-edit-supplier></p></div><button type="button" data-edit-close aria-label="Close" title="Close" class="widget-popup-close">&times;</button></header><form novalidate><div data-edit-body></div><footer><button type="button" class="button secondary" data-edit-close>Cancel</button><p data-edit-message role="status" aria-live="polite" aria-atomic="true">Loading invoice and related records...</p><button type="submit" class="button primary" data-edit-save disabled>Save changes</button></footer></form>';
      dialog.classList.remove("invoice-edit-background");
      var continueButton = global.document.createElement("button");
      continueButton.type = "button"; continueButton.className = "button secondary";
      continueButton.setAttribute("data-edit-continue", ""); continueButton.hidden = true;
      dialog.querySelector("footer").appendChild(continueButton);
      var backgroundNote = global.document.createElement("p");
      backgroundNote.className = "invoice-edit-background-note";
      backgroundNote.textContent = "Keep this app open while related records update. Balances may be pending. If interrupted, reopen Edit to resume.";
      dialog.querySelector("footer").appendChild(backgroundNote);
      dialog.classList.toggle("invoice-finalize-dialog", finalizeProforma);
      if (finalizeProforma) { dialog.querySelector("#invoice-edit-heading").textContent = "Convert to final invoice"; }
      dialog.onchange = function (event) {
        if (event.target.name === "file") {
          if (event.target.files[0]) {
            if (!finalizeProforma && (context.invoice.Invoice_File || []).some(function (f) { return !f.id; })) { field("file").value = ""; message("The document identifier is unavailable. Reopen the invoice before replacing it.", true); return; }
            removedFileIds = finalizeProforma ? [] : (context.invoice.Invoice_File || []).map(function (f) { return String(f.id); });
            if (field("file").getAttribute("aria-invalid") === "true") { clearErrors(); message(""); }
          }
          renderFiles();
        }
      };
      dialog.showModal(); busy = true; dialog.setAttribute("aria-busy", "true");
      progress("Loading invoice...", finalizeProforma ? "Loading the invoice details and saved document." : "Checking the document, settlements and related payments.");
      try {
        context = await call({ action: "preview" }, uuid());
        if (!context.success) { throw new Error(context.message || "The invoice cannot be edited."); }
        dialog.querySelector("[data-edit-supplier]").textContent = context.invoice.Supplier && context.invoice.Supplier.name || "";
        var stored = global.localStorage.getItem(key());
        if (stored) { recovery = JSON.parse(stored); if (!recovery.operationKey || !recovery.request) { throw new Error("The saved correction cannot be read. Contact support before editing."); } }
        if (context.pending) { recovery = { operationKey: context.operation_key, request: { action: "resume" } }; }
        if (recovery) {
          var pending = context.pending ? JSON.parse(context.invoice.Edit_Request) : null;
          var recoveryHtml = '<div class="invoice-edit-recovery"><strong>' + esc(context.invoice.Name || invoiceId) + '</strong>';
          if (pending) {
            recoveryHtml += '<p>' + esc(pending.reason || "") + '</p><p>Previous payable: ' + money(pending.before.Total_Payable_Amount) + ' / Corrected payable: ' + money(pending.flow === "conversion_v1" ? context.invoice.Total_Payable_Amount : pending.header.Total_Payable_Amount) + '</p>';
          }
          if (context.can_discard) { recoveryHtml += '<button type="button" class="button secondary" data-edit-discard>Discard unsaved correction</button>'; }
          var savedFiles = context.invoice.Invoice_File || [];
          if (pending && pending.phase === "Applied" && pending.file_id && !pending.file_digest && !pending.document_recovery && pending.file_before_ids && savedFiles.length === 1 && pending.file_before_ids.indexOf(String(savedFiles[0].id || savedFiles[0].attachment_Id)) === -1) {
            recoveryHtml += '<section><h3>Review saved invoice document</h3><p>This older correction has no stored document fingerprint. Download and check the saved file before continuing. The document will be kept.</p><ul class="edit-saved-files"><li><span class="edit-saved-file-name">' + esc(savedFiles[0].File_Name__s || savedFiles[0].file_Name || "Invoice document") + '</span><button type="button" class="button secondary" data-edit-download="0">Download</button></li></ul><label class="invoice-review-check"><input type="checkbox" name="confirm_saved_document" required> I have reviewed this file and confirm it is the correct invoice document.</label></section>';
          }
          dialog.querySelector("[data-edit-body]").innerHTML = recoveryHtml + '</div>';
          message(pending && pending.phase === "Applied" ? "The invoice was saved. Resume to finish and verify the related updates." : "Resume to verify the outcome and complete this correction.");
          if (pending && pending.phase === "Prepared" && pending.file_id && !pending.file_before_ids && (context.invoice.Invoice_File || []).length) {
            message("The previous correction could not add a second document. Discard the unsaved correction, then reopen Edit to replace the file.", true);
          }
          lock(false); return;
        }
        var invoice = context.invoice, star = '<span class="invoice-required" aria-hidden="true"> *</span>';
        if (finalizeProforma) {
          if (invoice.Invoice_Type !== "Proforma") { throw new Error("Only proforma invoices can use this action. Reload the invoice."); }
          var quick = '<fieldset><section><div class="final-details-heading"><h3>Invoice details</h3><span class="final-type-badge">Final Invoice</span><input type="hidden" name="Invoice_Type" value="Final Invoice" readonly required></div>';
          quick += '<div class="final-invoice-fields"><label class="field"><span>Invoice Number' + star + '</span><input name="Name" value="' + esc(ns.proposeFinalInvoiceNumber(invoice.Name, invoice.MFSP_Reference)) + '" maxlength="120" required aria-required="true"></label><label class="field"><span>Invoice Date' + star + '</span><input name="Invoice_Date" type="date" value="" required aria-required="true"></label></div>';
          quick += '<div class="invoice-finalize-number"><div><button type="button" class="button secondary" data-final-number="suggested" aria-pressed="false">Use suggested number</button><button type="button" class="button secondary" data-final-number="original" aria-pressed="false">Keep current number</button></div><small data-final-number-status role="status"></small></div></section>';
          quick += '<section><h3>Amounts &amp; taxes</h3><dl class="final-invoice-amounts">' + [
            ["Invoice_Amount_Excl_VAT", "Invoice Amount Excl VAT"], ["Invoice_Amount_Incl_VAT", "Invoice Amount Incl VAT"], ["Reimbursable_Expense", "Reimbursable Expense"],
            ["VAT_Amount", "VAT", "VAT_percentage"], ["Additional_Amount_Incl_VAT", "Additional Amount Incl VAT"], ["Additional_VAT_Amount", "Additional VAT", "Additional_VAT_percentage"],
            ["Additional_IRPF_Amount", "Additional IRPF", "Additional_IRPF_percentage"], ["IRPF_Amount", "IRPF", "IRPF_percentage"], ["Invoice_Total", "Invoice Total"], ["Total_Payable_Amount", "Total Payable Amount"]
          ].map(function (item) { return '<div' + (item[0] === "Total_Payable_Amount" ? ' class="final-payable"' : '') + '><dt>' + item[1] + '</dt><dd>' + esc(money(invoice[item[0]])) + (item[2] ? ' <small>(' + esc(Number(invoice[item[2]] || 0)) + '%)</small>' : '') + '</dd></div>'; }).join('') + '</dl></section>';
          quick += '<section><h3>Invoice document</h3><ul class="edit-saved-files"></ul><div class="final-upload-label" id="final-upload-label">Final invoice document' + star + '</div><div class="final-upload-zone" data-edit-drop><input name="file" type="file" hidden required aria-required="true" aria-labelledby="final-upload-label"><div class="final-selected-file" data-final-selected hidden>' + documentIcon("document") + '<div class="final-document-info"><span class="final-document-name" data-edit-file-name></span><small data-final-file-size></small></div></div><button type="button" class="button secondary" data-edit-file></button><button type="button" class="button secondary final-file-remove" data-edit-clear-file hidden title="Remove selected file" aria-label="Remove selected file">&times;</button></div><p class="edit-file-plan" data-edit-file-plan role="status"></p></section></fieldset>';
          dialog.querySelector("[data-edit-body]").className = "invoice-finalize-body";
          dialog.querySelector("[data-edit-body]").innerHTML = quick;
          if (context.source_documents && !(context.invoice.Invoice_File || []).length) { field("file").required = false; field("file").setAttribute("aria-required", "false"); dialog.querySelector("#final-upload-label").textContent = "Optional invoice document"; }
          renderFiles(); updateFinalNumber(); message(""); lock(false); field("Name").focus(); return;
        }

        var html = '<aside class="supplier-invoice-context" data-edit-context>' + contextMarkup() + '</aside><div class="supplier-invoice-editor"><fieldset>';
        html += '<section><h3>Invoice details</h3><div class="invoice-document-grid">';
        html += '<label class="field"><span>Invoice Type' + star + '</span><select name="Invoice_Type" required><option value="">Select type</option>' + ["Proforma", "Final Invoice", "Tickets", "Commission"].map(function (v) { return '<option' + (invoice.Invoice_Type === v ? ' selected' : '') + '>' + v + '</option>'; }).join("") + '</select></label>';
        html += '<label class="field"><span>Invoice Number' + star + '</span><input name="Name" required maxlength="120" value="' + esc(invoice.Name || "") + '"></label><label class="field"><span>Invoice Date' + star + '</span><input name="Invoice_Date" type="date" required value="' + esc(invoice.Invoice_Date || "") + '"></label></div></section>';
        html += '<section><h3>Amounts &amp; taxes</h3><div class="invoice-create-main-amounts-grid">' + amount("Invoice_Amount_Excl_VAT", "Invoice Amount Excl VAT") + grossAmount("data-edit-gross", "Invoice Amount Incl VAT") + amount("Reimbursable_Expense", "Reimbursable Expense") + '</div>';
        html += '<div class="invoice-create-tax-grid">' + tax("VAT_percentage", "VAT %", "vat_reviewed") + tax("IRPF_percentage", "IRPF %", "irpf_reviewed") + '</div>';
        var hasAdditional = amountFields.some(function (f) { return f[0].indexOf("Additional_") === 0 && Number(invoice[f[0]]) !== 0 && Number.isFinite(Number(invoice[f[0]])); });
        html += '<details class="edit-additional"' + (hasAdditional ? ' open' : '') + '><summary>Add additional VAT / IRPF</summary><div class="invoice-create-tax-grid">' + amount("Additional_Amount_Excl_VAT", "Additional Amount Excl VAT") + grossAmount("data-edit-extra-gross", "Additional Amount Incl VAT") + tax("Additional_VAT_percentage", "Additional VAT %", "additional_vat_reviewed") + tax("Additional_IRPF_percentage", "Additional IRPF %", "additional_irpf_reviewed") + '</div></details>';
        html += '<div class="invoice-create-calculated-grid">' + readonly("VAT Amount", 'data-result="vat"') + readonly("IRPF Amount", 'data-result="irpf"') + readonly("Additional VAT Amount", 'data-result="additional-vat"') + readonly("Additional IRPF Amount", 'data-result="additional-irpf"') + readonly("Invoice Total", 'data-result="invoice"') + readonly("Total Payable Amount", 'data-result="payable"') + '</div>';
        html += '<div class="invoice-edit-summary"><span>Previous payable<strong>' + money(invoice.Total_Payable_Amount) + '</strong></span><span class="edit-emphasis">New payable<strong data-edit-total></strong></span><span>Paid<strong>' + money(context.paid) + '</strong></span><span class="edit-emphasis">New pending<strong data-edit-pending></strong></span></div></section>';
        html += '<section><h3>Settlement allocations</h3><table class="edit-allocations"><thead><tr><th>Settlement</th><th>Allocated amount</th></tr></thead><tbody>';
        Object.keys(context.settlements).forEach(function (sid) {
          var settlement = context.settlements[sid], split = context.splits.find(function (r) { return String(r.Vendor_Settlement.id) === sid; });
          html += '<tr><td><strong>' + esc(settlement.Name || sid) + '</strong><small>' + esc(settlement.Booking && settlement.Booking.name || "") + '</small></td><td><input class="invoice-create-allocation-input" type="number" step="0.01" min="0.01" required' + (Object.keys(context.settlements).length === 1 ? ' readonly' : '') + ' aria-label="Allocation for ' + esc(settlement.Name || sid) + '" data-edit-allocation="' + sid + '" value="' + Number(split ? split.Allocated_Amount : invoice.Total_Payable_Amount).toFixed(2) + '"></td></tr>';
        });
        html += '</tbody></table><div class="invoice-create-allocation-totals"><span>Allocated <strong data-edit-allocated></strong></span><span>Remaining <strong data-edit-remaining></strong></span></div><label class="inline-review-toggle edit-excess"><input type="checkbox" name="confirm_excess"><span>Allow allocations above the settlement service cost</span></label></section>';
        html += '<section><h3>Invoice file' + star + '</h3><ul class="edit-saved-files"></ul>';
        html += '<div class="invoice-create-file-strip" data-edit-drop><span class="edit-file-icon" aria-hidden="true">&#8613;</span><span><small>New document</small><span data-edit-file-name></span></span><input name="file" type="file" hidden aria-label="Corrected invoice document"><div class="edit-file-actions"><button type="button" class="button secondary invoice-create-file-picker-button" data-edit-file>Choose file</button><button type="button" class="button secondary" data-edit-clear-file hidden title="Remove new document" aria-label="Remove new document">&times;</button></div></div><p class="edit-file-plan" data-edit-file-plan role="status"></p></section>';
        html += '<section><label class="field"><span>Reason for correction' + star + '</span><textarea name="reason" required maxlength="500" rows="2"></textarea></label></section></fieldset></div>';
        dialog.querySelector("[data-edit-body]").className = "supplier-invoice-layout";
        dialog.querySelector("[data-edit-body]").innerHTML = html; renderFiles(); message(""); updateTotals(); lock(false); field("Name").focus();
        loadSettlementContext();

      } catch (error) { message(error.message, true); lock(false); dialog.querySelector("[data-edit-save]").disabled = true; }
    }
    return { open: open };
  };
})(window);
