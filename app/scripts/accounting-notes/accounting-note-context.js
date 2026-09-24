import { escapeHtml } from "./utils.js";

export function accountingPrepaymentTarget(context) {
  if (context?.type !== "prepayment" || !/^\d+$/.test(String(context.bookingId || "")) || !/^\d+$/.test(String(context.prepaymentId || ""))) return null;
  return { view: "prepayment", bookingId: String(context.bookingId), prepaymentId: String(context.prepaymentId) };
}

export function renderAccountingNoteContext(context) {
  const target = accountingPrepaymentTarget(context);
  if (!target) return "";
  const url = "https://crm.zoho.eu/crm/org20093299576/tab/WebTab3?widgetparams=" + encodeURIComponent(JSON.stringify(target));
  const details = [context.supplier, context.amount != null && context.amount !== "" ? String(context.amount) + " " + (context.currency || "EUR") : "", context.dueDate ? "Due " + context.dueDate : ""].filter(Boolean);
  return '<aside class="accounting-note-context"><span>PREPAYMENT' + (context.reference ? ' · ' + escapeHtml(context.reference) : '') + '</span><strong>' + escapeHtml(context.name || target.prepaymentId) + '</strong><p>' + details.map(escapeHtml).join(' · ') + '</p><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" data-accounting-prepayment="' + target.prepaymentId + '" data-accounting-booking="' + target.bookingId + '">Open prepayment <small>' + target.prepaymentId + '</small> ↗</a></aside>';
}
