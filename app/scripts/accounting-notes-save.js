(function (global) {
  'use strict';
  function errorText(error, depth = 0) {
    if (!error || depth > 5) return '';
    if (typeof error === 'string') {
      try { return errorText(JSON.parse(error), depth + 1); } catch (_) { return error.slice(0, 1200); }
    }
    if (Array.isArray(error)) return error.map(item => errorText(item, depth + 1)).filter(Boolean).join('; ');
    const nested = error.responseJSON ?? error.responseText ?? error.details?.output ?? error.response?.data;
    return [error.code, error.message, nested ? errorText(nested, depth + 1) : ''].filter(Boolean).join(' · ');
  }
  function describe(value) {
    const diagnostic = value.diagnostics || {};
    const detail = [diagnostic.phase && `Step: ${diagnostic.phase}`, diagnostic.error].filter(Boolean).join(' · ');
    const recipient = diagnostic.recipientEmail ? ` (${diagnostic.recipientEmail})` : '';
    let message;
    switch (value.notificationStatus) {
      case 'sent': message = `Notes saved. Email sent${recipient}.`; break;
      case 'skipped_same_user': message = 'Notes saved. No email: you are the prepayment requester.'; break;
      case 'skipped_no_context': message = 'Notes saved. No email: this note is not linked to a prepayment.'; break;
      case 'unchanged': message = 'No new changes saved. No email was sent for this request.'; break;
      case 'failed': message = value.notificationWarning || 'Notes saved, but the email failed. Do not repeat the edit.'; break;
      default: message = value.notificationWarning || 'Notes saved, but CRM did not report the email status. Check the deployed function.';
    }
    const warning = Boolean(value.notificationWarning) || !['sent', 'unchanged', 'skipped_same_user', 'skipped_no_context'].includes(value.notificationStatus);
    return { ...value, notificationMessage: [message, detail].filter(Boolean).join(' '),
      notificationWarning: warning ? [message, detail].filter(Boolean).join(' ') : '' };
  }
  function log(value) {
    // Never log notesJson, the email body, or the complete SDK response.
    const d = value.diagnostics || {};
    global.console?.info?.('[Accounting Notes notification]', {
      saved: value.saved, status: value.notificationStatus, phase: d.phase,
      bookingId: d.bookingId, actingUserId: d.actingUserId, ownerId: d.ownerId,
      guestId: d.guestId, recipientId: d.recipientId, recipientEmail: d.recipientEmail,
      sender: d.sender, action: d.action, error: d.error
    });
  }
  function unpack(response) {
    if (Array.isArray(response)) response = response[0];
    let value = response?.details?.output ?? response;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { throw new Error('CRM returned an unreadable Accounting Notes response. Reopen notes before retrying.'); }
    }
    if (value?.success !== true || value?.saved !== true || typeof value.notesJson !== 'string') {
      log(value || {});
      throw new Error([errorText(value) || 'CRM did not confirm the notes save. Reopen notes before retrying.',
        value?.diagnostics?.phase && `Step: ${value.diagnostics.phase}`, value?.diagnostics?.error].filter(Boolean).join(' · '));
    }
    log(value);
    return describe(value);
  }
  async function save({ executeFunction, bookingId, currentUserId, expectedNotes, notes }) {
    if (!currentUserId) throw new Error('The signed-in user is unavailable. Reload the widget.');
    if (typeof expectedNotes !== 'string' || typeof notes !== 'string') throw new Error('Accounting Notes are unavailable. Reopen the booking.');
    if (notes === expectedNotes) return describe({ success: true, saved: true, notesJson: notes, notificationStatus: 'unchanged' });
    let response;
    try {
      response = await executeFunction('accountingnotes_saveandnotify', {
        bookingId: String(bookingId), actingUserId: String(currentUserId), expectedNotes, notesJson: notes
      });
    } catch (error) {
      const message = errorText(error) || 'No error details returned by Zoho.';
      global.console?.error?.('[Accounting Notes notification] Function request failed:', message);
      throw new Error(`accountingnotes_saveandnotify: ${message} Save/email status is unknown. Reopen notes before retrying.`);
    }
    return unpack(response);
  }
  global.AccountingNotesSave = { save, unpack };
})(window);
