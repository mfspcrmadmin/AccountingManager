# Alta de la función de reclamación de factura

El widget abre un borrador editable y llama a esta función únicamente al pulsar **Send**.

En Zoho CRM, crear una función independiente (standalone) con el código de
[sendSupplierInvoiceRequest](sendSupplierInvoiceRequest).

- Nombre de API que invoca el widget: `sendsupplierinvoicerequest`.
- Retorno: `string` con un objeto JSON.
- Argumentos de tipo `string`: `settlementId`, `recipientEmail`, `emailSubject`, `emailBody`.
- Remitente: `crmadmin@madeforspainandportugal.com`, igual que `sendSupplierPaymentLetter`.
- Habilitar su ejecución desde el widget para los perfiles que vayan a usarla.

La función devuelve `success: true` solo después de ejecutar `sendmail`. El borrador
se conserva si hay un error o falta una confirmación de éxito. Después del éxito,
el widget actualiza `Supplier_Settlements.Closure_Review_Status` a `Invoice Requested`
y refresca la fila. Si falla esta actualización, informa de que el correo sí se envió
y solicita corregir el estado manualmente. No se reintenta automáticamente un envío.

El destinatario inicial se obtiene reutilizando `getSupplierContactByType` con
`contactType: "AC - Accounts"`. La lista alternativa consulta los registros de
`Contacts` con `Vendor_Name` igual al proveedor del settlement. Los servicios se
consultan por `Booking_Services.Supplier_Settlement`, recorriendo todas las páginas.

El borrador vive en el pop-up; se puede descargar como `.eml` para conservarlo fuera
del widget. Cerrarlo no crea un borrador en Zoho Mail ni en Zoho CRM.

Después del alta, actualizar el widget con los archivos de `app` (incluido
`scripts/invoice-request.js`). Comprobar con un destinatario de prueba el envío,
la recepción y el formato antes de usarlo con proveedores reales.

Pruebas locales: `node --test tests/invoice-request.test.js`. Abrir
`tests/invoice-request.browser.html` en un navegador para comprobar el flujo con
CRM simulado; añadir `?preview` para ver la plantilla. Estas pruebas no envían correo.

El envío sigue la sintaxis de [sendmail de Deluge](https://www.zoho.com/deluge/help/misc-statements/send-mail.html),
como la carta de pago existente. La función debe validarse y publicarse en el editor
de Zoho; no se dispone de un compilador Deluge ni de acceso a la organización en este entorno.
