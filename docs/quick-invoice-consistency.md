# Invoices from prepayments and card purchases — 2026-10-16

These routes previously bypassed supplierinvoice_register. The supplier registration function cannot simply replace them: it requires an uploaded invoice file, accepts EUR and excludes Credit Note, while quick routes retain documents on the source and support card refunds. This change preserves those existing rules and shares keyed insert/recovery logic between the quick routes.

## Implemented locally

- Card invoices now use an immutable persistent recovery plan. Invoice, settlement allocation and optional service line use the existing unique Registration_Key fields. Lost responses and delayed search indexing recover through duplicate-key results, verifying the saved record rather than overwriting it. A double click is blocked and Web Locks serialize tabs in the same browser.
- Card purchase relationships are read again; a changed supplier, booking, service, currency, transaction type or invoice link blocks continuation. Closed movements cannot be overwritten. Existing positive Credit Note amounts and the omission of expense lines for refunds are preserved.
- Prepayment invoices persist their original payload and allocation input before insertion. Retries recover invoices and settlement allocations by unique key, and prepayment allocations by their existing unique Name. Browser storage is mandatory for new invoice requests. Existing ambiguous legacy checkpoints remain blocked for review.
- Both routes require exact cents, percentages within 0–100 and active, unlocked settlements in the matching currency. Prepayment pending balance uses Total Payable Amount minus Amount Paid rather than a possibly stale pending formula.
- Recalculation failures retain the journal and report incomplete saving. Reopening offers resume; a payment cannot start while that browser retains pending invoice work. Financial writes do not invoke accounting generators.
- Existing-entry linking from prepayments does not create or repair that invoice's settlement allocations. Pending supplier registrations/edits cannot be selected for payment.

## Validation and deployment

193 focused automated tests passed: prepayment workflow, card invoice recovery, card services, settlement refresh, widget bootstrap, invoice edit, invoice registration/client/server and accounting pause. Fault injection covers lost invoice/allocation/line/link replies, stale search indexes, modified input on retry, changed recovered records, rebuild failure and reopening recovery. No production financial records were created or changed in this review.

These are local widget changes, not a deployed widget. Runtime checks require unique Registration_Key metadata in Supplier_Invoices, Inv_Set_Allocations and Supplier_Invoice_Lines, and unique Name in Prepayment_Invoice_Allocations. Browser visual validation and live workflow integration have not been performed. The prior payment consistency server updates remain a separate deployment dependency; this change does not publish them.

## Remaining boundaries and business decisions

- Confirmed business rule: source documents stay on Prepayment Requests / Card Purchases and must not be copied to Invoice_File. Any future adjustment to invoice editing must respect source-held documents rather than introduce automatic copying.
- Implemented in the subsequent review: source-linked invoice editing and conversion now accept documents retained at their source, with no automatic copy. New quick registrations explicitly progress through Pending / Ready / Complete so the editor distinguishes completed invoices from interrupted registrations. See `crm/invoice-flow-final-review.json` for deployment boundaries.
- Prepayments can allocate multiple invoices and card purchases retain one invoice. No new invoice-splitting or service-cost distribution rule was introduced. Prepayment service selection remains attached to the request; this does not invent invoice service lines from those selections.
- Recovery plans live in browser storage. Unique keys protect replay of a saved operation, but they do not provide a transaction across users. Different users can still initiate distinct prepayment operations before seeing each other's links. Strong cross-user coordination requires moving the source-specific orchestration and immutable plan to the server; supplierinvoice_register currently does not model those sources/documents/refunds.
- The user accepts this cross-user limitation given the small team and manual coordination. Server coordination is not requested for now.
- Conditional writes for source links and global reservations across independent prepayments are not guaranteed by the browser SDK. Existing backend payment validation must remain the final check before money is allocated. No historical reconciliation or repair was run.

## Save performance (2026-10-16, local changes pending deployment)

- Editing skips empty payment and removed-accounting/card phases within the next batch, retaining live preflight, leases, recovery checkpoints and final verification. The unpaid single-settlement regression requires four server calls instead of seven.
- Allocation amounts and copied card invoice numbers are still checked for conflicts, but identical values are not rewritten.
- Once a batch confirms `saved: true`, Continue using the app minimizes the editor into a nonmodal progress panel. The same browser continues the serial resume calls with the original operation key. It does not run on a server worker or survive closing the app; reopen Edit to recover. Only one invoice editor correction runs at a time. Creating an additional payment remains an explicit foreground action.
- Completion waits for related updates and the view refresh. Failures retain Resume correction; there is no success notification for partial completion.
- Removed redundant supplier workspace reload and second invoice fetch after editing. Supplier invoice/payment refreshes run concurrently and discard results if the user has changed suppliers. Creation refreshes the invoice table and supplier activity concurrently, waiting for both even on failure.
- Tests: invoice-edit (77), accounting-paused (2), creation/registration/payment/bootstrap (33), refresh performance (2), plus a headless Edge scenario covering minimization, navigation, three viewport widths, a failed related update and same-key recovery. CRM latency and a full live accounting workflow have not been measured. No production records were changed.
- Deploy the widget and `crm/accounting-paused/supplierinvoice_edit.dg` to activate all these changes. The broader previously pending payment backend deployment remains separate.

## Service Payment Status (2026-10-16; local, pending deployment)

The confirmed rule uses Supplier_Invoice_Lines.Booking_Service, never settlement-wide payment distribution. A service without a prepayment request is Fully Paid only when all its active ordinary invoices have paid/reconciled allocations covering their Total_Payable_Amount; some payment gives Partially Paid, otherwise To Be Paid. Repeated lines count the invoice once. Cancelled/rejected invoices and cancelled/void allocations are excluded. Pending payments are not paid money. Settlement service cost is not the denominator.

Services linked through Prepayment_Request_Services keep the existing prepayment rule. The user also confirmed refund synchronization: actual Paid/Reconciled allocations on active credit notes give Partially Refunded, and Refunded when every active credit note linked to the service is fully refunded. These refund states take precedence once money has been returned; an unpaid credit note alone retains the ordinary payment state. Cancelling/removing a refund or credit-note line recomputes the state, including returning to the ordinary payment state. Prepayment services remain excluded from this new rule. Missing service lines are not guessed from the settlement. Note that creation from supplier currently generates lines for all settlement services.

The canonical settlement rebuild invokes syncSupplierServicePaymentStatus even when settlement totals are unchanged. Reads and validation precede writes; record-version checks and suppressed workflows protect each status write. Partial errors are returned to the existing operation recovery path. Retry reads current records and skips unchanged statuses. No bulk historical update is run. Deployment dependencies and verification limits are in crm/service-payment-status.deployment.json.

## Payment creation, edit and undo review � 2026-10-19

The user reports that the earlier changes have been published and initial invoice flows work. The changes in this section are subsequent local corrections, not yet published by this review. Deploy supplierPayment_deleteAllocation first, then managesupplierpaymentallocations, then the widget including payment-delete.js. The CRM connector was unavailable; no deployed code or external automation was independently verified.

Payment undo now journals the complete original allocation/source plan, validates current records, detaches sources, reconciles explicit zero allocations through the existing server manager, and deletes the payment last. This removes the former cached paid-sum calculation, unsupported Approved fallback and write to the invoice's calculated unpaid field. Original invoice IDs survive partial deletion and reopening. New allocations/source links, locks, accounting links, unreadable pages and conflicting pending operations stop the operation. The server recalculates all invoice settlements (including split allocations) and service statuses through the canonical rebuild. Source request/service failures remain recoverable. Old session-only incomplete deletions require review because their removed invoice relationships cannot be safely inferred.

Card purchase registration now saves status, payment link and audit fields together and permits same-operation recovery after a lost source-update response. Prepayment registration now retains a Resume related updates action when request/service synchronization fails after payment linking; this continues without creating a new payment.

Source-linked payment allocations and registered source financial fields retain their existing restrictions: undo the payment and register the corrected one instead of silently changing its source amount. Reconciled/posted payments and accounting-linked payment deletions require reversal/review. No new accounting entries are generated, no currency conversion or unapplied balance policy is introduced, and no historical records were modified.

209 focused automated tests passed, including partial/complete payments, multiple invoices, allocation redistribution/unlinking, deletion failures and reopening, source link loss, request status recovery, locks and service payment/refund states. JavaScript syntax checks passed. These tests use mocked CRM calls/Deluge execution; live CRM compilation and end-to-end validation remain pending. Details: crm/payment-flow-review-20261019.deployment.json.

Compilation follow-up: the full source supplied from the editor contains the invokeurl terminator and matches the local version. The parser error after that block has no confirmed cause. DELETE is now isolated in supplierPayment_deleteAllocation to narrow compilation diagnosis, preserving the EU v8 endpoint, connection, wf_trigger=false and the manager response checks. All 15 allocation mock tests pass, including rejected deletion and retry. Live compilation remains pending; save the helper before replacing the manager. This is not evidence that the Zoho compilation error is resolved.

Payment follow-up: user reports functions now work after direct map returns in the delete helper. No independent live verification. 175 focused tests passed; after adding a final direct Accounting_Entry guard, all 9 deletion tests passed. The no-allocation undo message now explains source unlinking. These widget changes remain local pending publication.
