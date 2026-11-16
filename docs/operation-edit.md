# Prepayment and card purchase editing

Both operation tables expose **Edit** in their three-dot menu. The shared editor
loads fresh records through `accountingoperation_edit` and current CRM field
metadata. It includes every business field from the two modules; audit fields,
cached supplier/booking codes, generated financial links and exchange rates are
displayed as system data. It does not edit the parent Prepayment Request itself.

Financial fields are disabled after an invoice or payment is linked, or the
operation is recorded/discarded. For Prepayments the server also checks
`Prepayment_Invoice_Allocations.Prepayment`, including multiple invoice relations.
Other fields and documents remain editable. State transitions that require
registration cannot be manufactured through this editor.

The server independently checks the allowed fields, amounts, status transitions,
supplier/booking relationships, payment accounts and document removals. A single
CRM v8 PUT with `If-Unmodified-Since` updates the record and its file upload field.
Document replacement combines deletion markers and uploaded file IDs in that same
request. It does not change invoices, payments, allocations or settlement amounts.

After saving a Prepayment, the widget reuses `syncPrepaymentRequestFromSDK` for
its previous and current request. This recalculates request and associated service
states. A failed synchronization displays **Changes saved** and offers a retry of
the related updates alone. The table reloads after completion.

An uncertain save is stored in sessionStorage and offers **Check saved changes**.
The widget verifies field values and documents before synchronizing anything or
submitting another update. Reopening the same record in the same browser session
restores this check. This is a recovery mechanism, not a multi-record transaction.
If the user leaves with synchronization pending, it must be resumed in the editor.

Production deployment uses the existing authenticated `supplierinvoice_register`
entry point with `operation=edit_operation`. The helper requires no additional
public API authentication. Original invoice registration/edit routes are preserved.
No production business records were edited during development or testing.

Validation: `node --test tests/operation-edit.test.js` exercises the published
Deluge source in the project's mock CRM harness. Browser checks live in
`_local/previews/check-operation-edit.cjs`, covering mobile/desktop layouts,
financial locks, minimal field updates, file replacement, uncertain saves and
related-update retries. Tests use mock records; a real end-to-end save remains to
be checked after uploading the widget.

SDK integration follows the [Zoho widget SDK API reference](https://help.zwidgets.com/help/v1.2/ZOHO.CRM.API.html)
and the existing project's document upload implementation.
