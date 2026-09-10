(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createInvoiceRequestModule = function (deps) {
    var crm = deps.crm, helpers = deps.helpers, modules = deps.MODULES;
    var dialog = null, requestToken = 0, returnFocus = null, sending = false;
    var esc = helpers.escapeHtml;

    async function searchAll(entity, criteria) {
      var records = [], page = 1, batch;
      do {
        batch = await crm.searchRecordPage(entity, criteria, page++, 200);
        records = records.concat(batch);
      } while (batch.length === 200);
      return records;
    }

    function formatDate(value) {
      var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      return match ? match[3] + "/" + match[2] + "/" + match[1] : "Pendiente de indicar";
    }

    function buildMessage(supplier, booking, services) {
      var name = supplier.Vendor_Name || "";
      var reference = booking.MFSP_Reference || "";
      var client = helpers.getLookupName(booking.Account_Name) || booking.Deal_Name || "";
      var cell = 'padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:left;';
      var section = 'width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;margin:16px 0;';
      var rows = services.map(function (service) {
        return '<tr><td style="' + cell + '">' + esc(formatDate(service.Service_Date)) + '</td><td style="' + cell + '">' + esc(service.Product_Description || service.Name || "Pendiente de indicar") + '</td><td style="' + cell + '">' + esc(service.Guests || client || "Pendiente de indicar") + '</td></tr>';
      }).join("");
      return '<div lang="es" style="background:#f4f7fb;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#334155;"><div style="max-width:840px;margin:0 auto;">' +
        '<p>Buen día ' + esc(name) + ',</p><p>Espero se encuentre bien.</p>' +
        '<p>Nos ponemos en contacto para informarle que, hasta la fecha, no hemos recibido la factura correspondiente al servicio prestado, necesaria para poder procesar el pago y cerrar contablemente el viaje.</p>' +
        '<table style="' + section + '"><tbody><tr><th colspan="3" style="padding:12px;background:#eaf2ff;color:#163b73;text-align:center;">DETALLES DEL SERVICIO</th></tr>' +
        '<tr><td colspan="3" style="' + cell + '"><strong>Referencia MFSP:</strong> ' + esc(reference || "Pendiente de indicar") + '</td></tr>' +
        '<tr><td colspan="3" style="' + cell + '"><strong>Clientes:</strong> ' + esc(client || "Pendiente de indicar") + '</td></tr>' +
        '<tr style="background:#f8fafc;"><th style="' + cell + '">Fecha de servicio</th><th style="' + cell + '">Servicio</th><th style="' + cell + '">Clientes</th></tr>' +
        (rows || '<tr><td colspan="3" style="' + cell + '">Pendiente de indicar los servicios.</td></tr>') + '</tbody></table>' +
        '<p>Agradeceríamos nos la pudiera enviar a la mayor brevedad posible para completar ambos trámites.</p>' +
        '<p>Asimismo, les facilitamos a continuación nuestros datos fiscales, en caso de que los necesiten para la emisión de la factura:</p>' +
        '<table style="' + section + '"><tbody><tr><th style="padding:12px;background:#f2dada;color:#633737;text-align:center;">Datos fiscales</th></tr>' +
        '<tr><td style="' + cell + '">Made for Spain, S.A.</td></tr><tr><td style="' + cell + '">A82318908</td></tr>' +
        '<tr><td style="' + cell + '">Calle Castelló, 23, 2º Izda, 28001 Madrid</td></tr></tbody></table>' +
        '<p>Quedamos atentos a su envío y a cualquier información adicional que necesite.</p><p>Atentamente,<br>Made for Spain and Portugal</p></div></div>';
    }

    async function loadDraft(settlement, booking) {
      var supplierId = helpers.getLookupId(settlement.Supplier);
      if (!supplierId) { throw new Error("This settlement has no associated supplier."); }
      var result = await Promise.all([
        crm.getRecord(modules.suppliers, supplierId),
        searchAll(modules.bookingServices, "(Supplier_Settlement:equals:" + settlement.id + ")"),
        deps.resolveRecipient({ id: supplierId }).catch(function () {
          return { email: "", message: "Could not load the default contact. Select another contact or enter an email." };
        })
      ]);
      var supplier = result[0];
      if (!supplier || !supplier.id) { throw new Error("Could not load the settlement supplier."); }
      var services = result[1].sort(function (a, b) { return String(a.Service_Date || "").localeCompare(String(b.Service_Date || "")); });
      return {
        supplierId: supplierId,
        recipient: result[2],
        subject: "Solicitud de factura | " + (booking.MFSP_Reference || settlement.Name || "") + " | " + supplier.Vendor_Name,
        html: buildMessage(supplier, booking, services),
        warning: !services.length ? "No services were found for this settlement. Complete the service details before using this draft." : ""
      };
    }

    function close() {
      if (sending) { return; }
      requestToken++;
      if (dialog) { dialog.remove(); dialog = null; }
      if (returnFocus && returnFocus.isConnected) { returnFocus.focus(); }
    }

    function encodeBase64(value) {
      var bytes = new TextEncoder().encode(value), binary = "";
      bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
      return global.btoa(binary);
    }

    function buildEml(email, subject, html) {
      validateMessage(email, subject, html);
      // RFC 2047 encoded words must remain below 75 characters, including wrappers.
      var chunks = [], chunk = "";
      Array.from(subject).forEach(function (character) {
        if (new TextEncoder().encode(chunk + character).length > 42) { chunks.push(chunk); chunk = ""; }
        chunk += character;
      });
      if (chunk) { chunks.push(chunk); }
      return 'From: crmadmin@madeforspainandportugal.com\r\nTo: ' + email + '\r\nSubject: ' + chunks.map(function (part) { return '=?UTF-8?B?' + encodeBase64(part) + '?='; }).join('\r\n ') +
        '\r\nX-Unsent: 1\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
        (encodeBase64('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' + html + '</body></html>').match(/.{1,76}/g) || []).join('\r\n') + '\r\n';
    }

    async function open(settlement, booking, trigger) {
      if (sending) { return; }
      close();
      returnFocus = trigger;
      var token = ++requestToken;
      var backdrop = document.createElement("div");
      backdrop.className = "invoice-request-backdrop";
      var current = document.createElement("section");
      dialog = backdrop;
      current.className = "invoice-request-dialog";
      current.setAttribute("role", "dialog");
      current.setAttribute("aria-modal", "true");
      current.setAttribute("aria-labelledby", "invoice-request-title");
      current.innerHTML = '<header><h2 id="invoice-request-title">Request invoice · Draft</h2><button type="button" class="close-supplier-control" data-request-close aria-label="Close">&times;</button></header><div class="invoice-request-content"><p role="status">Loading supplier and service details...</p></div>';
      backdrop.appendChild(current);
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", function (event) {
        event.stopPropagation();
        if (event.target === backdrop) { close(); }
      });
      backdrop.addEventListener("keydown", function (event) {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === "Tab") {
          var controls = Array.prototype.filter.call(current.querySelectorAll('button:not(:disabled), input:not(:disabled), [contenteditable="true"]'), function (control) { return control.getClientRects().length; });
          var first = controls[0], last = controls[controls.length - 1];
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      });
      current.querySelector("[data-request-close]").onclick = close;
      current.querySelector("[data-request-close]").focus();
      try {
        var draft = await loadDraft(settlement, booking);
        if (token !== requestToken) { return; }
        var content = current.querySelector(".invoice-request-content");
        content.innerHTML = '<label class="field"><span>From</span><input type="email" value="crmadmin@madeforspainandportugal.com" readonly></label><label class="field"><span>To</span><input type="email" data-request-email value="' + esc(draft.recipient.email || "") + '"></label>' +
          '<div class="invoice-request-recipient-actions"><span data-request-recipient-note></span><button type="button" class="button secondary compact-action-button" data-request-contacts>See contacts</button></div>' +
          '<div data-request-contact-list hidden></div><label class="field"><span>Subject</span><input type="text" data-request-subject value="' + esc(draft.subject) + '"></label>' +
          '<p class="payment-letter-warning" data-request-warning hidden></p><span id="invoice-request-message-label">Message</span>' +
          '<div class="invoice-request-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="invoice-request-message-label" data-request-body>' + draft.html + '</div>' +
          '<footer><button type="button" class="button secondary" data-request-cancel>Cancel</button><button type="button" class="button secondary" data-request-download>Download draft (.eml)</button><button type="button" class="button primary" data-request-send>Send</button></footer>';
        var email = content.querySelector("[data-request-email]"), subject = content.querySelector("[data-request-subject]");
        var editor = content.querySelector("[data-request-body]"), warning = content.querySelector("[data-request-warning]");
        function showWarning(message) { warning.textContent = message; warning.hidden = !message; }
        content.querySelector("[data-request-recipient-note]").textContent = draft.recipient.message || "";
        showWarning(draft.warning);
        content.querySelector("[data-request-cancel]").onclick = close;
        content.querySelector("[data-request-contacts]").onclick = async function () {
          var list = content.querySelector("[data-request-contact-list]");
          if (!list.hidden) { list.hidden = true; this.textContent = "See contacts"; return; }
          list.hidden = false;
          this.textContent = "Hide contacts";
          list.textContent = "Loading contacts...";
          try {
            var contacts = await searchAll("Contacts", "(Vendor_Name:equals:" + draft.supplierId + ")");
            if (token !== requestToken) { return; }
            list.innerHTML = contacts.length ? '<table class="payment-letter-contacts-table"><thead><tr><th>Name</th><th>Status</th><th>Contact Type</th><th>Email</th><th></th></tr></thead><tbody>' + contacts.map(function (contact, index) {
              var address = String(contact.Email || "").trim();
              return '<tr><td>' + esc(contact.Contact_Name || contact.Full_Name || contact.Name || contact.Last_Name || "-") + '</td><td>' + esc(contact.Status || "-") + '</td><td>' + esc(contact.Contact_Type || "-") + '</td><td>' + esc(address || "-") + '</td><td><button type="button" class="button secondary compact-action-button" data-contact-index="' + index + '"' + (deps.hasValidEmailAddress(address) ? '' : ' disabled') + '>Select</button></td></tr>';
            }).join("") + '</tbody></table>' : 'No contacts associated with this supplier.';
            list.onclick = function (event) {
              var button = event.target.closest("[data-contact-index]");
              if (!button || button.disabled || sending) { return; }
              email.value = String(contacts[Number(button.getAttribute("data-contact-index"))].Email || "").trim();
              content.querySelector("[data-request-recipient-note]").textContent = "Selected supplier contact";
              list.hidden = true;
              content.querySelector("[data-request-contacts]").textContent = "See contacts";
            };
          } catch (error) {
            if (token === requestToken) { list.textContent = "Could not load supplier contacts. Close and reopen the contact list to retry."; }
          }
        };
        // Paste as text to keep pasted markup and external assets out of the draft.
        editor.addEventListener("paste", function (event) {
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
        });
        editor.addEventListener("drop", function (event) { event.preventDefault(); });
        content.querySelector("[data-request-download]").onclick = function () {
          try {
            if (!editor.textContent.trim()) { throw new Error("Enter a message."); }
            var eml = buildEml(email.value.trim(), subject.value, editor.innerHTML);
            var url = global.URL.createObjectURL(new Blob([eml], { type: "message/rfc822" }));
            var link = document.createElement("a");
            link.href = url;
            link.download = 'invoice-request-' + String(settlement.id).replace(/[^a-z0-9_-]/gi, '') + '.eml';
            document.body.appendChild(link);
            link.click();
            link.remove();
            global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
            showWarning("");
          } catch (error) { showWarning(error.message); }
        };
        content.querySelector("[data-request-send]").onclick = async function () {
          if (sending) { return; }
          var button = this;
          try {
            if (!editor.textContent.trim()) { throw new Error("Enter a message."); }
            validateMessage(email.value.trim(), subject.value, editor.innerHTML);
            sending = true;
            current.querySelectorAll("button, input").forEach(function (control) {
              control.dataset.requestWasDisabled = control.disabled ? "true" : "false";
              control.disabled = true;
            });
            editor.contentEditable = "false";
            button.textContent = "Sending...";
            var result = await sendDraft(settlement.id, email.value.trim(), subject.value, editor.innerHTML);
            sending = false;
            close();
            deps.renderer.showNotice(result.statusUpdateError || "Invoice request sent. Settlement marked as Invoice Requested.", { tone: result.statusUpdateError ? "warning" : "success" });
          } catch (error) {
            sending = false;
            current.querySelectorAll("[data-request-was-disabled]").forEach(function (control) {
              control.disabled = control.dataset.requestWasDisabled === "true";
              delete control.dataset.requestWasDisabled;
            });
            editor.contentEditable = "true";
            button.textContent = "Send";
            showWarning(error.message || "Could not send the invoice request. Your draft is still available.");
          }
        };
        email.focus();
      } catch (error) {
        if (token === requestToken) { current.querySelector(".invoice-request-content").textContent = error.message || "Could not load the invoice request draft."; }
      }
    }

    function validateMessage(email, subject, html) {
      if (!deps.hasValidEmailAddress(email) || /[\r\n]/.test(email)) { throw new Error("Enter a valid recipient email."); }
      if (!subject.trim() || /[\r\n]/.test(subject)) { throw new Error("Enter a valid subject."); }
      if (!html.trim()) { throw new Error("Enter a message."); }
    }

    async function sendDraft(settlementId, email, subject, html) {
      validateMessage(email, subject, html);
      var response = await crm.executeFunction("sendsupplierinvoicerequest", {
        settlementId: String(settlementId), recipientEmail: email, emailSubject: subject, emailBody: html
      });
      var result = deps.getFunctionOutputObject(response);
      if (!result || result.success !== true || result.error === true) {
        throw new Error(result && result.message || "CRM did not confirm the email was sent. Check the invoice request function and email delivery before retrying.");
      }
      // Email has already been sent: a status failure must not offer to resend it.
      try {
        var update = await crm.updateRecord(modules.settlements, String(settlementId), {
          Closure_Review_Status: "Invoice Requested"
        });
        var recordResult = update && Array.isArray(update.data) ? update.data[0] : update;
        if (!recordResult || recordResult.code !== "SUCCESS") {
          throw new Error(recordResult && recordResult.message || "CRM did not confirm the status update.");
        }
        if (deps.onInvoiceRequested) { deps.onInvoiceRequested(String(settlementId)); }
      } catch (error) {
        result.statusUpdateError = "The email was sent, but the settlement could not be marked as Invoice Requested. Update its Closure review status manually; do not resend the email. " + (error.message || "");
      }
      return result;
    }

    return { open: open, close: close, loadDraft: loadDraft, buildMessage: buildMessage, buildEml: buildEml, sendDraft: sendDraft };
  };
}(window));
