# Prepagos con varias facturas

`Prepayment_Invoice_Allocations` es la fuente de relaciones entre un prepago y sus
facturas. Cada pareja tiene un `Name` único `prepaymentId-invoiceId`, los lookups
`Prepayment` y `Vendor_Invoice`, `Allocated_Amount` y `Currency`.
Los widgets no deducen estas asociaciones del lookup antiguo.

## Accounting Manager

El formulario permite crear o vincular una factura por vez e indicar qué parte
del prepago se aplica. Mientras quede importe sin repartir, permite añadir otra
factura y mantiene `Pending invoice`. Al completar el reparto ofrece registrar
un único pago o confirmar uno existente que cubra todas las facturas.

Ejemplo: prepago de 300 EUR, factura A por 100 EUR y factura B por 500 EUR.
Se aplican 100 EUR a A y 200 EUR a B. El pago único de 300 EUR genera dos
`Supplier_Pay_Allocations`; B conserva su saldo pendiente de 300 EUR.

La suma aplicada no puede exceder el prepago. Se verifica cada factura, su moneda,
proveedor, booking, settlement y saldo disponible antes de generar el pago.
Un pago existente debe cubrir cada parte, descontando lo ya utilizado por otros
prepagos vinculados a ese pago. Las cantidades se comparan en céntimos.

La fecha de un pago nuevo es el día de creación en CRM. El formulario del prepago
la muestra como no editable y no envía `Payment_Date`: la función existente
`createSupplierPaymentFromInvoices` aplica `zoho.currentdate` por defecto.
El prepago copia la fecha del pago guardado, también al recuperar un guardado
parcial otro día. Vincular un pago existente conserva su `Payment_Date`.

Antes de registrar el pago se puede quitar una asociación y volver a añadirla con
otro importe. Esto conserva la factura. No se permite cambiar asociaciones si
hay una creación de pago pendiente de verificar o el prepago está cerrado.
Los identificadores devueltos por CRM se conservan para recuperar operaciones
parciales aunque Search todavía no haya indexado los registros.

La sincronización de pagos creados desde Invoices también exige cubrir todas las
partes. El borrado de pagos conserva el reparto y vuelve a abrir el prepago; el
borrado de una factura elimina solo sus asociaciones y recalcula el estado del
prepago. Los planes de borrado guardados con la versión anterior se rechazan para
evitar ejecutarlos sin tener en cuenta el módulo nuevo; requieren revisión manual.

## Bookings Manager

El formulario admite varios documentos originales en **Proforma / invoices**.
Reutiliza `Prepayment_Requests.Proforma_Attached`; no requiere crear otro campo.
Subir un documento no crea una factura contable. Accounting registra las facturas
al revisar el prepago y elige `Final Invoice` cuando corresponda.

La tabla de prepagos ofrece **View invoices**. El detalle carga las asociaciones
del módulo nuevo y muestra cada factura con su importe aplicado, total y pendiente.
Una lectura fallida se muestra como error; no se interpreta como ausencia de facturas.

## Despliegue

1. Configurar `Prepayment_Invoice_Allocations.Name` como único y dar permisos de
   lectura a los usuarios de ambos widgets. Accounting necesita además crear y
   eliminar asociaciones. Mantener `Prepayments.Vendor_Payment`.
2. Pausar temporalmente escrituras del flujo antiguo, ejecutar la
   [migración](../_local/crm/crm_functions/migration/migratePrepaymentInvoiceAllocations.md)
   con `simulate`, `migrate` y `verify`, empezando cada fase desde `0`.
3. Actualizar en CRM `notif_sendprepaymentbankrequest` con
   [`sendPrepaymentBankRequest`](../_local/crm/crm_functions/sendPrepaymentBankRequest).
   Conserva sus argumentos. La conexión necesita lectura COQL del módulo nuevo
   y de `Supplier_Pay_Allocations`. No ejecutar envíos como prueba de despliegue.
4. Publicar ambos widgets durante el mismo cambio. Los ZIP con sufijo
   `-prepayment-invoices` contienen el app actual y su manifest; el código Deluge
   se despliega por separado. Conservar el lookup antiguo durante la validación,
   pero no volver a ejecutar el backfill sobre repartos múltiples ya editados.
5. Validar en CRM un prepago histórico migrado y uno nuevo con dos facturas,
   incluyendo un fallo recuperable al guardar y una vista con permisos de usuario.
   Revisar también workflows/informes externos que lean `Prepayments.Vendor_Invoice`.

La solicitud bancaria conserva una fila por prepago y exige que todas sus facturas
usen una misma cuenta del proveedor. Verifica la cobertura por factura, incluida
la suma de varios prepagos seleccionados que comparten el mismo pago/factura.
Si resuelve cuentas distintas o no puede leer todas las asignaciones, se detiene.

Las funciones Deluge están preparadas para desplegar, pero no se han compilado ni
ejecutado en CRM desde este workspace. Las pruebas locales usan CRM simulado y
una prueba de navegador completa dos facturas definitivas y un único pago.
