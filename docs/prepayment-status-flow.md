# CRM prepayment status flow

The supported prepayment entry point is Bookings Manager's native CRM form.
It creates Prepayment_Requests and Prepayments and links Booking_Services through
Prepayment_Request_Services. New pending requests set Payment_Status to Prepayment
Requested, or Partially Paid when the service already has payment progress. It does not
write Status_EZUS or the booking status. The obsolete Creator report fallback
has been removed from Bookings Manager.

Prepayment recorded, Discard - Credit and Discard - Already Paid count as paid.
Recording/linking a payment or discarding a prepayment recalculates the request
Status and linked services' Payment_Status. Each service considers all its active
requests: Fully Paid only when all have non-cancelled prepayments and every one
counts as paid; Partially Paid when some are paid; Prepayment Requested otherwise.
Cancelled prepayments and cancelled/discarded requests are excluded from this
status aggregation. A pending request with no prepayments prevents Fully Paid.
Discard synchronization errors are visible and can be retried from the dialog.

Bookings Manager shows the original accounting status plus Paid / To pay and a
hover/focus legend. Paid totals include both discard reasons. Cancelled rows
remain excluded from monetary summary totals.

## Deployment and legacy retirement

Migrate existing service associations before deploying both updated widgets using
[the migration guide](../_local/crm/crm_functions/migratePrepaymentRequestServices.md).
This change applies to future widget actions; it
does not backfill existing discarded prepayments or change remote CRM workflows.
Disable the old Creator Proforma_Form entry points and its On Successful Submit
workflow in Zoho Creator. Its archived source under bookingsManager/_local/creator
still documents the historical Status_EZUS write and is not an active widget path.
No Creator deployment or historical CRM data migration has been performed here.
