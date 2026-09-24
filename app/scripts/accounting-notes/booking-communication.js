import { noteEditor } from "./communication-note-editor.js";
import { escapeHtml } from "./utils.js";
import { crmGetRecord, crmUpdateRecord, crmExecuteFunction } from "./api.js";
import { MODULES } from "./constants.js";
import { renderAccountingNoteContext } from "./accounting-note-context.js";

const fields = [
  ["Warnings_OP_GE", "Warnings OP GE", 32000],
  ["PAX_INFO_celebrations_special_requests_or_intere", "PAX info: celebrations, special requests or interests", 32000],
  ["Important_changes_logistic_explanation", "Important changes & logistic explanation", 32000],
  ["Information_for_admin", "Information for admin", 32000]
];
const noteFields = [["Accounting_Notes", "Accounting Notes"], ["Review_Notes", "Review Notes"]];
const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" });

export function parseCommunicationNotes(raw) {
  if (raw === undefined) throw new Error("Notes field is unavailable. Check field permissions.");
  if (raw === null || raw === "") return { version: 1, notes: [] };
  const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!doc || doc.version !== 1 || !Array.isArray(doc.notes)) throw new Error("Unsupported notes format.");
  const ids = new Set();
  for (const note of doc.notes) {
    if (!note || typeof note.id !== "string" || !note.id || ids.has(note.id) || typeof note.body !== "string" || !note.body.trim() || typeof note.author !== "string" || typeof note.at !== "string" || (note.at !== "" && !Number.isFinite(Date.parse(note.at)))) throw new Error("Invalid saved note.");
    ids.add(note.id);
    let end = 0;
    if (note.formatting !== undefined) {
      if (!Array.isArray(note.formatting)) throw new Error("Invalid note formatting.");
      for (const span of note.formatting) {
        if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < end || span.end <= span.start || span.end > note.body.length || (span.bold !== undefined && typeof span.bold !== "boolean") || (span.underline !== undefined && typeof span.underline !== "boolean")) throw new Error("Invalid note formatting.");
        end = span.end;
      }
    }
  }
  return doc;
}

export function renderCommunicationNote(note) {
  let end = 0, html = "";
  for (const span of note.formatting || []) {
    html += escapeHtml(note.body.slice(end, span.start));
    let text = escapeHtml(note.body.slice(span.start, span.end));
    if (span.bold) text = "<strong>" + text + "</strong>";
    if (span.underline) text = "<u>" + text + "</u>";
    html += text;
    end = span.end;
  }
  return html + escapeHtml(note.body.slice(end));
}

export function parseNotesField(raw, field) {
  // Older Review Notes are free text. Preserve them without inventing an author or date.
  if (noteFields.some(item => item[0] === field) && typeof raw === "string" && raw.trim() && !/^[{\[]/.test(raw.trim())) {
    return { version: 1, notes: [], legacyText: raw };
  }
  return parseCommunicationNotes(raw);
}

export function changeCommunicationNote(raw, note, original, remove = false, field = "h_Notes") {
  const doc = parseNotesField(raw, field);
  if (original) {
    const current = doc.notes.find(item => item.id === original.id);
    if (JSON.stringify(current) !== JSON.stringify(original)) throw new Error("This note changed in another session. Reopen notes.");
    doc.notes = doc.notes.flatMap(item => item.id !== original.id ? [item] : remove ? [] : [note]);
  } else if (!doc.notes.some(item => item.id === note.id)) doc.notes.push(note);
  const value = JSON.stringify(doc);
  parseCommunicationNotes(value);
  if (value.length > 30000) throw new Error("The notes field is full. Shorten the note before saving.");
  return value;
}

export function appendCommunicationNote(raw, note) {
  return changeCommunicationNote(raw, note);
}

function renderNoteCard(note) {
  return '<article class="communication-note"><strong>' + escapeHtml(note.author) + '</strong><time>' + (note.at ? escapeHtml(dateFormat.format(new Date(note.at))) : '') + '</time>' + (note.context ? renderAccountingNoteContext(note.context) : '') + '<div class="communication-text">' + renderCommunicationNote(note) + '</div>' + (note.editedAt && Number.isFinite(Date.parse(note.editedAt)) ? '<small>Edited ' + escapeHtml(dateFormat.format(new Date(note.editedAt))) + (note.editedBy ? ' by ' + escapeHtml(note.editedBy) : '') + '</small>' : '') + '</article>';
}

function legacyNotes(doc, field = "Review_Notes") {
  const label = field === "Accounting_Notes" ? "Previous accounting notes" : "Previous review notes";
  return typeof doc.legacyText === "string" && doc.legacyText ? '<article class="communication-note"><strong>' + label + '</strong><div class="communication-text">' + escapeHtml(doc.legacyText) + '</div></article>' : '';
}

const pencilIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/></svg>';

const deleteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>';
const closeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const confirmDeleteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>';

export function renderBookingCommunication(booking, activeNotes = "Review_Notes") {
  if (activeNotes !== "Review_Notes") activeNotes = "Review_Notes";
  const button = (field, label) => '<button type="button" class="button tertiary compact' + (label === "Edit" ? ' communication-edit-icon' : ' communication-add-button') + '" data-communication-edit="' + field + '"' + (label === "Edit" ? ' aria-label="Edit" title="Edit"' : '') + '>' + (label === "Edit" ? pencilIcon : label) + '</button>';
  const histories = noteFields.map(([field, label]) => {
    let notes, manage = "";
    try {
      const doc = parseNotesField(booking[field], field);
      notes = legacyNotes(doc, field) + doc.notes.map(renderNoteCard).join("");
      notes = notes || '<p class="muted">No notes yet.</p>';
      manage = field === "Accounting_Notes" ? "" : button(field, "Add / Manage notes");
    } catch (error) { notes = '<p role="status">' + escapeHtml(error.message) + '</p>'; }
    return '<section id="communication-history-' + field + '" class="communication-history" role="tabpanel" aria-labelledby="communication-switch-' + field + '"' + (field === activeNotes ? '' : ' hidden') + '><div class="communication-history-scroll">' + notes + '</div><div class="communication-history-footer">' + manage + '</div></section>';
  }).join("");
  const switcher = '<div class="communication-notes-tabs"><div class="segmented-control" role="tablist" aria-label="Internal notes">' + noteFields.map(([field, label]) => field === 'Accounting_Notes' ? '<button type="button" id="communication-switch-Accounting_Notes" class="segmented-control-button" role="tab" aria-selected="false" aria-disabled="true" title="Accounting Notes is currently unavailable." disabled>Accounting Notes</button>' : '<button type="button" id="communication-switch-' + field + '" class="segmented-control-button' + (field === activeNotes ? ' is-active' : '') + '" role="tab" aria-selected="' + (field === activeNotes) + '" aria-controls="communication-history-' + field + '" data-communication-switch="' + field + '">' + label + '</button>').join('') + '<button type="button" id="communication-switch-h_Notes" class="segmented-control-button" role="tab" aria-selected="false" aria-disabled="true" disabled>24h Notes</button></div><span class="communication-coming-soon" tabindex="0" role="img" aria-label="24h Notes: future functionality, currently unavailable." aria-describedby="communication-24h-tooltip"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v2"/></svg><span class="communication-coming-soon-tooltip" id="communication-24h-tooltip" role="tooltip">24h Notes is a future feature and is not available yet.</span></span></div>';
  return '<div class="communication-layout"><div class="communication-fields">' + fields.map(([field, label]) => '<section class="summary-section"><div class="summary-section-header"><h2>' + escapeHtml(label) + '</h2>' + (booking[field] !== undefined ? button(field, "Edit") : '') + '</div><div class="communication-text">' + escapeHtml(booking[field] === undefined ? "Field unavailable." : booking[field] || "No notes yet.") + '</div></section>').join("") + '</div><div class="communication-notes-workspace">' + switcher + '<div class="summary-section communication-history-container">' + histories + '</div></div></div>';
}

export async function openBookingCommunicationEditor(state, field, onSaved) {
  if (field === "h_Notes" || field === "Accounting_Notes") return;
  if (noteFields.some(item => item[0] === field)) return openNotesDialog(state, field, onSaved);
  const config = fields.find(item => item[0] === field);
  if (!config) return;
  const id = String(state.selectedBooking.id);
  const dialog = document.createElement("dialog");
  dialog.className = "communication-editor";
  dialog.innerHTML = '<form><h2>' + escapeHtml(config[1]) + '</h2><label>Note<textarea required rows="10" disabled></textarea></label><p role="status">Loading…</p><div class="communication-editor-actions"><button type="button" class="button tertiary">Cancel</button><button type="submit" class="button primary" disabled>Save</button></div></form>';
  document.body.append(dialog);
  const form = dialog.querySelector("form"), input = dialog.querySelector("textarea"), status = dialog.querySelector('[role="status"]'), save = dialog.querySelector('[type="submit"]');
  let busy = false, initial;
  input.required = false;
  input.maxLength = config[2];
  dialog.querySelector('[type="button"]').onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  try {
    const fresh = await crmGetRecord(MODULES.bookings, id);
    if (!dialog.isConnected) return;
    if (!fresh || fresh[field] === undefined) throw new Error("This field is unavailable. Check field permissions.");
    initial = fresh[field] || "";
    input.value = initial;
    input.disabled = save.disabled = false;
    status.textContent = "";
    input.focus();
  } catch (error) { status.textContent = error.message; return; }
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    input.disabled = save.disabled = true;
    status.textContent = "Saving…";
    try {
      const latest = await crmGetRecord(MODULES.bookings, id);
      if (!latest || latest[field] === undefined) throw new Error("This field is unavailable.");
      const value = input.value;
      if ((latest[field] || "") !== initial) throw new Error("This field changed in another session. Copy your text, then reopen the editor.");
      const result = await crmUpdateRecord(MODULES.bookings, { id, [field]: value });
      if (result.code !== "SUCCESS") throw new Error(result.message || "CRM could not save this note.");
      if (String(state.selectedBooking?.id) === id) state.selectedBooking[field] = value;
      for (const booking of state.bookings || []) if (String(booking.id) === id) booking[field] = value;
      onSaved();
      dialog.close();
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; input.disabled = save.disabled = false; }
  };
}

export async function saveCommunicationNotes(field, bookingId, notes, expectedNotes, currentUserId) {
  if (field === "Review_Notes") {
    return window.ReviewNotesSave.save({ executeFunction: crmExecuteFunction, bookingId,
      currentUserId, expectedNotes: expectedNotes ?? '', notes });
  }
  if (field !== "Accounting_Notes") throw new Error("Unsupported notes field.");
  parseCommunicationNotes(notes);
  return window.AccountingNotesSave.save({ executeFunction: crmExecuteFunction, bookingId,
    currentUserId, expectedNotes: expectedNotes ?? '', notes });
}

async function openNotesDialog(state, field, onSaved) {
  const id = String(state.selectedBooking.id);
  const label = noteFields.find(item => item[0] === field)[1];
  const dialog = document.createElement("dialog");
  dialog.className = "communication-editor communication-notes-dialog";
  dialog.setAttribute("aria-label", label);
  dialog.innerHTML = '<header class="summary-section-header"><h2>' + label + '</h2><button type="button" class="button tertiary communication-edit-icon" data-close aria-label="Close" title="Close">' + closeIcon + '</button></header><p role="status"></p><div data-notes-body></div>';
  const body = dialog.querySelector("[data-notes-body]"), feedback = dialog.querySelector('[role="status"]');
  let busy = false, fresh;
  const button = (label, action) => {
    const node = document.createElement("button");
    node.type = "button"; node.className = "button tertiary compact"; node.textContent = label; node.onclick = action;
    if (label === "Edit" || label === "Delete") { node.innerHTML = label === "Edit" ? pencilIcon : deleteIcon; node.classList.add("communication-edit-icon"); node.setAttribute("aria-label", label); node.title = label; }
    return node;
  };
  const setBusy = value => {
    busy = value;
    dialog.querySelectorAll("button").forEach(node => { node.disabled = value; });
    dialog.querySelectorAll(".note-rich-input").forEach(node => { node.contentEditable = String(!value); node.setAttribute("aria-disabled", String(value)); });
  };
  dialog.querySelector("[data-close]").onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();

  const save = async (note, original, remove = false) => {
    if (busy) return;
    setBusy(true); feedback.textContent = "Saving…";
    try {
      const latest = await crmGetRecord(MODULES.bookings, id);
      const value = changeCommunicationNote(latest?.[field], note, original, remove, field);
      const result = await saveCommunicationNotes(field, id, value, latest[field], state.currentUserId);
      fresh = result.notesJson;
      if (String(state.selectedBooking?.id) === id) state.selectedBooking[field] = fresh;
      for (const booking of state.bookings || []) if (String(booking.id) === id) booking[field] = fresh;
      onSaved(); draw(); feedback.textContent = result.notificationWarning || result.notificationMessage || "Saved";
    } catch (error) { feedback.textContent = error.message; }
    finally { setBusy(false); }
  };
  const draw = () => {
    const doc = parseNotesField(fresh, field);
    const list = document.createElement("div");
    list.className = "communication-notes-list";
    list.setAttribute("aria-label", label + " history");
    list.tabIndex = 0;
    list.innerHTML = legacyNotes(doc, field);
    body.replaceChildren(list);
    if (!doc.notes.length && !doc.legacyText) list.innerHTML = '<p class="muted">No notes yet.</p>';
    for (const note of doc.notes) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderNoteCard(note);
      const card = wrapper.firstElementChild;
      const actions = document.createElement("div"); actions.className = "communication-editor-actions";
      actions.append(button("Edit", () => {
        const editor = noteEditor("Edit note", note);
        const controls = document.createElement("div"); controls.className = "communication-editor-actions";
        controls.append(button("Cancel", draw), button("Save", () => {
          try {
            const value = editor.read();
            if (!value.body) throw new Error("Enter a note.");
            void save({ ...note, ...value, editedAt: new Date().toISOString() }, note);
          } catch (error) { feedback.textContent = error.message; }
        }));
        card.replaceChildren(editor.node, controls); editor.input.focus();
      }));
      let confirming = false;
      const remove = button("Delete", () => {
        if (!confirming) { confirming = true; remove.innerHTML = confirmDeleteIcon; remove.setAttribute("aria-label", "Confirm delete"); remove.title = "Confirm delete"; remove.classList.add("is-confirming-delete"); feedback.textContent = "Click the checkmark to confirm deletion."; return; }
        void save(note, note, true);
      });
      actions.append(remove);
      const head = document.createElement("div"); head.className = "communication-note-head";
      head.append(card.querySelector("strong"), actions); card.prepend(head); list.append(card);
    }
    const composer = document.createElement("form"), editor = noteEditor("New note");
    const context = field === "Accounting_Notes" ? state.accountingNoteContext : null;
    if (context) {
      const preview = document.createElement("div");
      preview.innerHTML = renderAccountingNoteContext(context);
      editor.node.insertBefore(preview, editor.input);
    }
    composer.className = "communication-note-composer";
    const add = button("Add note", null); add.type = "submit"; add.className = "button primary communication-add-button";
    composer.append(editor.node, add);
    let pending;
    composer.onsubmit = event => {
      event.preventDefault();
      if (busy) return;
      try {
        const value = editor.read();
        if (!value.body) throw new Error("Enter a note.");
        if (!state.currentUserId || !state.currentUserName) throw new Error("Current user is unavailable. Reload before adding a note.");
        if (!pending || pending.body !== value.body || JSON.stringify(pending.formatting) !== JSON.stringify(value.formatting)) pending = { id: crypto.randomUUID(), ...value, author: state.currentUserName, authorId: state.currentUserId, at: new Date().toISOString(), ...(context ? { context } : {}) };
        void save(pending);
      } catch (error) { feedback.textContent = error.message; }
    };
    body.append(composer);
  };
  const load = async () => {
    setBusy(true); feedback.textContent = "Loading…"; body.replaceChildren();
    try {
      const record = await crmGetRecord(MODULES.bookings, id);
      if (!dialog.isConnected) return;
      fresh = record?.[field]; draw(); feedback.textContent = "";
    } catch (error) {
      feedback.textContent = error.message;
      body.append(button("Retry", () => void load()));
    } finally { setBusy(false); }
  };
  await load();
}
