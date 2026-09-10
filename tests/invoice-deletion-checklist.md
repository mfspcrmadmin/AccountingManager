# Invoice deletion deployment and verification

The widget implements deletion in `app/scripts/invoice-delete.js`; Delete no longer
calls the optional settlement rebuild after removing the invoice. It prepares all
dependent mutations first, validates CRM responses, recalculates balances, and
deletes the invoice last. The settlement checkbox is mandatory.

Deploy `dist/AccountingManager.zip`. Also replace the CRM function
`rebuildsuppliersettlementtotals` with the source in
`_local/crm/crm_functions/rebuildSupplierSettlementTotals` so other rebuild actions
use the corrected settlement calculation. Widget packaging does not deploy Deluge.

Behavior:

- Delete invoice lines, payment allocations, invoice/settlement allocations and
  unposted accounting entries and their lines.
- Delete payments with no remaining allocations. Shared payments retain their
  payment status and remaining allocations, get a recalculated amount and context
  counts, and return to Pending accounting. Their previous accounting entries are
  removed and can be generated again using Sync accounting.
- Preserve card purchases, clear the deleted invoice/payment references and audit
  fields, and restore the corresponding pending invoice/credit note/payment state.
- Preserve credit notes and their lines, clearing references to the deleted parent.
- Recalculate remaining invoice paid amounts from allocations. CRM computes formula
  balances. Recalculate every affected settlement, respecting active invoice splits
  and credit note signs, and reset closure review to Pending review.
- Reject posted/exported/reconciled records before writing. An unrelated shared
  accounting journal must be reversed/unlinked before deleting its invoice lines.

Run `node --test tests/invoice-delete.test.js` and `zet validate` locally. Tests use
an in-memory CRM and validate mutation fields/picklists against the local schema;
they do not execute Deluge or prove the deployed CRM permissions and automation.

In a CRM test environment verify a last unpaid invoice, a paid invoice, a shared
payment, a multi-settlement invoice and a credit note/card refund. Reopen each
affected record and check its amounts, states and relationships. Verify the payment
accounting reset and regeneration, and that rebuilding a settlement retains the
same totals. A rejected update must show an incomplete deletion, never success.

CRM mutations are sequential, not a transaction. A sessionStorage journal keeps
confirmed progress in the same browser tab (including reloads). Retry Confirm
deletion in that tab after resolving a failed request. Do not edit the affected
records concurrently with deletion/recovery: the plan contains balances computed
at preparation time. Closing the tab clears its recovery journal. Records already
deleted by the old implementation require a separate data repair.

SDK pagination and `Trigger: []` follow the [Zoho widget SDK documentation](https://help.zwidgets.com/help/latest/ZOHO.CRM.API.html).
