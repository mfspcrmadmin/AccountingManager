# Prepayments in Operations

The widget reads `Prepayment_Requests` and `Prepayments` directly through the CRM
SDK. The legacy Creator prepayment function is no longer used by Operations.
Deploy the updated `dist/AccountingManager.zip`. Update the existing
`createSupplierPaymentFromInvoices` CRM function from its local source as well: it
now honors the optional Currency parameter for payments and their allocations.
Users need read access to both prepayment modules and the related accounting
modules; registration also needs create/update access.

The default **By request** view groups payments through the
`Prepayments.Prepayment_Request` lookup. Empty requests remain visible unless a
payment-specific filter is applied. Payments whose request is missing or not
visible remain available in separate groups. **All prepayments** lists individual
payments, ordered by due date, with their request, supplier and booking context.
Request groups are ordered by next pending due date, then requested date.

The screen uses the exported field names, including `Requested_By_2`,
`Requested_Date`, `Supplier_Code`, `MFSP_Reference`, `Due_Date`, `Payment_Date`,
`Accounting_Status`. Accounting statuses are `Pending invoice`,
`Pending payment record`, `Prepayment recorded`, and `Cancelled`; empty values
are displayed and filtered as `No status`. The removed `Accounted` and `Status` fields are not read or updated on Prepayments. It does not assume that a request has an amount or a
service lookup. Totals are calculated from its child payments, separately per
currency. Missing amounts are identified instead of treated as zero.

Search includes request/prepayment names, supplier, supplier code, booking, MFSP
reference and requester email. Due-date and accounting-status filters intersect.
A request's totals always include all its prepayments; a note identifies when its
table shows only matching payments. Summary cards describe matching results.
Pending registration includes `Pending invoice`, `Pending payment record` and empty
accounting status. Overdue means pending registration with a due date strictly
before the user's local day. Recorded and cancelled totals also use Accounting_Status.

Document names link to their CRM record, where the attachments can be opened.
Each prepayment row starts with the same registration button as Card Purchases,
in both grouped and flat views. It opens a right-hand panel. Completed and
cancelled records show a view icon and their existing links.

The panel reads live Prepayments metadata to resolve the invoice and payment
lookups (preferred names Vendor_Invoice and Vendor_Payment). It reads the selected
prepayment and request afresh. Register a new supplier invoice or select an
existing invoice for the same supplier, booking and currency. New invoices require
a settlement; the panel creates the invoice/settlement allocation. Linking an
invoice changes Accounting_Status to Pending payment record. Recording a payment
uses the existing CRM function with an explicit allocation of the prepayment
amount, so it does not pay the entire invoice balance. It then saves the payment
lookup, payment date and Prepayment recorded accounting status. The separate
Supplier_Payments record still uses its own Paid status.

Session checkpoints retain returned CRM IDs if saving a link fails. A retry
resumes with those IDs; an unconfirmed creation request requires checking CRM
before a further creation. These browser safeguards do not provide a server-side
transaction or protect against simultaneous writes from separate browser sessions.
The function's payment and invoice allocation are checked before marking the
prepayment recorded. The supplied function update is required for non-default
currencies. No real bank transfer is initiated by the registration panel.

Both modules are loaded with paginated
[SDK getAllRecords](https://help.zwidgets.com/help/latest/ZOHO.CRM.API.html#.getAllRecords)
calls. The result is displayed only when both reads complete. Permission errors,
invalid responses, pagination errors (including CRM pagination limits) and
repeated pages produce an error instead of incomplete totals. Refresh retries
the load. Records open through
[SDK Record.open](https://help.zwidgets.com/help/latest/ZOHO.CRM.UI.Record.html#.open).

Local validation: `node --test tests/prepayments.test.js tests/card-purchase-service.test.js`.
Browser checks used mocked CRM records for grouped/flat views, filters, escaped
text, document/record links, report switching, narrow screens and permission
errors. Live CRM access and actual attachment access must be checked after upload.
