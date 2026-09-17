# Recalcular settlements tras registrar invoices y pagos

Actualizar en CRM la función **`rebuildsuppliersettlementtotals`** con el contenido de `rebuildSupplierSettlementTotals` de esta carpeta. Se mantiene el argumento String **`settlementIdsString`**, con IDs separados por `|||`.

## Conexión

La función usa **`crm_oauth_connection`** y el endpoint europeo `https://www.zohoapis.eu/crm/v8/coql`. La conexión necesita `ZohoCRM.coql.READ` y lectura de Supplier_Invoices, Inv_Set_Allocations, Supplier_Pay_Allocations y Supplier_Payments. El usuario de ejecución necesita lectura y actualización de Supplier_Settlements.

Se usa [COQL](https://www.zoho.com/crm/developer/docs/api/v8/Get-Records-through-COQL-Query.html) para evitar el retraso de indexación de [Search Records](https://www.zoho.com/crm/developer/docs/api/v8/search-records.html) inmediatamente después de crear registros. Las lecturas fallidas detienen el recálculo; no se convierten en totales cero.

## Cambios

- Recalcula invoices directas y distribuidas entre settlements.
- Utiliza Total_Payable_Amount, también después de IRPF, como base de reparto.
- Lee las asignaciones por invoice y distribuye su importe pagado según la parte de cada settlement. No atribuye todo el pago al settlement principal.
- Cuenta pagos con Status Paid o Reconciled. Excluye invoices Cancelled/Rejected y distribuciones Void/Cancelled.
- Las credit notes y sus devoluciones restan de los totales.
- Actualiza Gross_Invoice_Amount, Credit_Note_Amount, Total_Invoice, Total_Paid y Admin_Status. Si hay cambios, deja Closure_Review_Status en Pending review.
- El widget acepta un recálculo correcto sin cambios (`processed_count` completo, `updated_count = 0`).
- Card Purchases y Prepayments recalculan después de crear el pago y antes de actualizar el vínculo de la operación. Confirmar un pago existente también recalcula.

## Validación

Pruebas locales cubren la llamada desde ambos formularios, fallos de vinculación, settlements ya actualizados, reparto parcial y las expresiones aritméticas de Deluge con IRPF y credit notes. No compilan ni ejecutan la función en CRM.

Después de desplegar: comprobar un pago completo de 846,20 EUR (Total_Paid = 846,20 y Admin_Status = Paid), un pago parcial y una invoice repartida entre dos settlements. Para registros anteriores, ejecutar el recálculo sobre sus settlements o confirmar el vínculo del pago existente; no crear otro pago.

No se ha actualizado el ZIP ni se han modificado registros CRM desde el workspace.
