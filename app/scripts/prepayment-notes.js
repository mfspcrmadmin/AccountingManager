(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  ns.accountingNotesEnabled = false;
  var opening = false;
  function id(value) { return String(value && value.id || ""); }
  ns.buildPrepaymentNoteContext = function (payment, request) {
    if (!/^\d+$/.test(id(payment)) || !/^\d+$/.test(id(request.Booking))) throw new Error("This prepayment has no accessible booking to report to.");
    return { type: "prepayment", bookingId: id(request.Booking), prepaymentId: id(payment),
      name: payment.Name || id(payment), supplier: request.Supplier && request.Supplier.name || "",
      amount: payment.Amount == null ? "" : payment.Amount, currency: payment.Currency || "EUR",
      dueDate: payment.Due_Date || "", reference: request.MFSP_Reference || "" };
  };
  ns.accountingNotesUser = function (response) {
    var user = response && (response.users && response.users[0] || response.data && response.data[0] || response.user || response);
    if (!user || !user.id) throw new Error("Could not identify your CRM user. Reload before writing an accounting note.");
    var name = user.full_name || user.fullName || user.name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
    if (!name) throw new Error("Your CRM user name is unavailable. Reload before writing an accounting note.");
    return { id: String(user.id), name: name };
  };
  ns.openPrepaymentAccountingNotes = async function (prepaymentId) {
    if (!ns.accountingNotesEnabled) return;
    if (opening || document.querySelector(".communication-notes-dialog")) return;
    opening = true;
    try {
      var modules = await Promise.all([import("./accounting-notes/booking-communication.js"), import("./accounting-notes/api.js")]);
      var read = modules[1].crmGetRecord;
      var payment = await read("Prepayments", prepaymentId);
      if (!id(payment.Prepayment_Request)) throw new Error("This prepayment has no request linked to a booking.");
      var request = await read("Prepayment_Requests", id(payment.Prepayment_Request));
      var context = ns.buildPrepaymentNoteContext(payment, request);
      var booking = await read("Deals", context.bookingId);
      var user = ns.accountingNotesUser(await global.ZOHO.CRM.CONFIG.getCurrentUser());
      var state = { selectedBooking: booking, bookings: [booking], currentUserId: user.id, currentUserName: user.name, accountingNoteContext: context };
      await modules[0].openBookingCommunicationEditor(state, "Accounting_Notes", function () {});
    } finally { opening = false; }
  };
})(window);
