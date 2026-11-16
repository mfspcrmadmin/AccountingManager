# Accounting generation paused — 2026-10-16

Update: the user subsequently requested removal, not a reversible feature flag. Entry generators and planners have now been removed from active sources; archived `backups/` files are historical snapshots only. CRM publication and the latest validation are recorded in `../invoice-flow-final-review.json`. References below to retaining generation behind a flag describe the earlier pause and are superseded.

Requested scope: suspend creation and regeneration of accounting entries while retaining existing entries, lines and relationships. No historical records were migrated or changed.

## Published in CRM

The five `.dg` files in this directory are the exact published pause-only versions, verified by downloading the published source after deployment:

- `accent_resolvesupplierinvoiceaccountingentry`: returns explicit disabled/error result without CRM access.
- `accent_resolvesupplierpaymentaccountingentry`: same behavior.
- `supplierinvoiceedit_applyaccounting`: prevents direct line creation/replacement or legacy accounting-plan application.
- `supplierinvoice_edit`: new financial corrections skip accounting planning; legacy pending corrections requiring accounting work stop before further writes.
- `supplierinvoiceedit_payments`: retains the existing payment entry identity, validates that relationship and skips line/header regeneration during payment corrections.

`backups/` contains the published source downloaded before these changes. The live deployment was built from those sources so it does not deploy unrelated, pending payment-consistency changes from the workspace. The original resolver/application bodies failed recompilation at pre-existing invokeurl blocks; the published disabled entry points are deliberately small no-write implementations. Successful compilation and published-source readback were confirmed for all five final versions.

## Local widget and development sources

`ACCOUNTING_ENTRY_GENERATION_ENABLED` is false in `app/scripts/config.js`. The renderer hides Sync entry and the handlers reject generation before calling CRM. Viewing, linking, modules and existing totals-rebuild controls remain available. No accounting relationships, records, states or history are removed. Existing entry amounts are intentionally not updated by new invoice/payment edits during this pause.

Local development versions in `crm/invoice-edit/` and `crm/resolveSupplierInvoiceAccountingEntry.dg` also guard accounting generation. They retain the previous implementation behind a disabled flag for future review, along with other pending development changes. Do not blindly redeploy these files or restore backups to re-enable accounting: review pending financial corrections and decide where generation should live first.

The widget package has not been deployed or rebuilt as part of this change. Older deployed widgets may still display Sync entry, but the published CRM functions reject the operation explicitly.

## Verification

103 automated tests passed across accounting-paused, invoice-edit, widget-bootstrap, payment-save and payment-allocation-consistency. New tests cover disabled CRM entry points with no CRM access, invoice and payment corrections preserving entries/lines, direct accounting application rejection, and legacy pending accounting corrections remaining pending without writes. Existing accounting-generation tests explicitly opt into the retained implementation; production pause tests use the disabled setting.

No financial mutation tests were executed against production data. No browser visual validation or full workflow inventory outside the inspected source/functions was performed. Independent CRM automations that create entries directly rather than using these entry points are outside this verified scope.
