# Solicitud bancaria de prepagos desde CRM

## Despliegue necesario

Actualizar la función standalone `notif_sendPrepaymentBankRequest` con API name **`notif_sendprepaymentbankrequest`**, copiando el archivo del mismo nombre, sin extensión, de esta carpeta. Seis argumentos de tipo String: `action`, `prepaymentIds`, `recipientEmails`, `reviewToken`, **`ccEmails`**, **`emailBody`**. Los dos últimos son nuevos y deben añadirse también a la configuración de argumentos en CRM.

- Habilitar ejecución para los perfiles que usarán el widget.
- Comprobar el checkbox **Prepayments.Bank_Payment_Requested**, visible y editable para esos perfiles.
- Comprobar que **Prepayments.Bank_Receipt_Needed** sea el API name del checkbox Bank Receipt Needed y que sea visible para esos perfiles. La columna Justificante del correo usa ?nicamente ese checkbox.
- Confirmar los API names de los lookups de Prepayments: **Vendor_Invoice** y **Vendor_Payment**. Si difieren en CRM, sustituirlos en la función.
- La conexión existente **crm_oauth_connection** necesita lectura de Prepayment_Requests y de sus archivos. El endpoint utiliza el centro de datos europeo (`zohoapis.eu`).
- Verificar el remitente **crmadmin@madeforspainandportugal.com** para `sendmail`.
- Por defecto, To es `claudia@madeforspainandportugal.com`; CC incluye `luciano@madeforspainandportugal.com` y `andersson@madeforspainandportugal.com`. Los campos son editables. CC se valida y se pasa a `sendmail` sin archivos adjuntos.

No se ha desplegado la función ni enviado correo real desde este workspace. El ZIP no se ha actualizado.

## Comportamiento

Selección de hasta 25 prepagos con Accounting Status = **Prepayment recorded**, conservada al paginar y filtrar. `Select visible registered` selecciona la página visible (en agrupado, los grupos expandidos). El contador incluye selecciones de otras páginas; `Clear selection` las elimina todas.

`prepare` solo consulta datos y devuelve asunto, HTML y una huella de los datos revisados. El contenido se edita directamente en el diálogo; al pegar se inserta texto sin formato. `send` reconstruye la versión original con datos actuales y comprueba su huella antes de enviar **el HTML editado (`emailBody`)**. Así se permiten cambios deliberados en el correo sin ignorar cambios posteriores en los registros CRM. La edición afecta solo al correo, no a los registros CRM.

El correo agrupa por proveedor, cuenta bancaria y moneda; no suma monedas distintas. Se han eliminado la columna Prepago, la columna Avisar a y las instrucciones de aviso a esas personas. El justificante se representa con etiquetas de color: Solicitado (ámbar) y No necesario (gris). El correo no adjunta proformas ni consulta sus metadatos, tama?os o descargas. No necesita permisos de archivos para preparar o enviar el correo.

Correspondencias con Creator:

| Creator | CRM |
| --- | --- |
| Proforma_Associated | Prepayments.Prepayment_Request |
| Supplier_Name | Prepayment_Requests.Supplier |
| Supplier_Bank_Account | Payment_Account de Supplier_Pay_Allocations que enlaza el Vendor_Payment y Vendor_Invoice del prepago |
| MFSP_Reference / Booking_Name | Prepayment_Requests.MFSP_Reference / Booking.name |
| Referencia (supplier code) | Prepayment_Requests.Supplier_Code; si falta, Supplier_Invoices.Supplier_Code; después Vendors.TP_Reference / Connection_Reference / Supplier_Connection_Reference |
| Bank Receipt Needed | Prepayments.Bank_Receipt_Needed (checkbox de cada prepago) |

La cuenta debe tener IBAN, pertenecer al proveedor y no estar inactiva. No se sustituye por la cuenta bancaria propia del encabezado de pago ni por el default actual del proveedor. Las asignaciones deben cubrir el importe del prepago y resolver una única cuenta.

Después de `sendmail`, se marca Bank_Payment_Requested en los registros seleccionados. Si falla alguna actualización, el diálogo confirma el envío y enumera los IDs para marcarlos manualmente. El checkbox se puede marcar/desmarcar sin mandar correo y sin ejecutar workflows. No modifica el accounting status. Los registros ya marcados pueden volver a enviarse con una nueva revisión explícita.

Los timeouts no se reintentan automáticamente: pueden producirse después del envío. El resultado de sendmail confirma la aceptación del envío, no la recepción del destinatario. No hay bloqueo distribuido entre usuarios: dos envíos deliberados concurrentes pueden producir dos correos.


## Validación en CRM tras desplegar

1. Abrir Closed/All, seleccionar dos prepagos registrados y revisar To, CC, importes, proveedor, IBAN, referencias y justificantes. Editar un texto del correo.
2. Sustituir To y CC por direcciones de prueba controladas; comprobar recepción, copias, texto editado, ausencia de adjuntos y ambos checkboxes marcados.
3. Desmarcar y marcar manualmente; comprobar que no se envía correo.
4. Reabrir la solicitud con un prepago ya marcado; comprobar aviso de reenvío.
5. Cambiar el importe desde otra pestaña después de preparar el correo; el envío debe exigir una nueva revisión.
6. Probar con un perfil habitual y comprobar los permisos de función, archivos y checkbox. Un fallo descargando una proforma debe impedir el correo completo.

Pruebas locales: `node --test tests/prepayment-bank-request.test.js tests/prepayments.test.js tests/prepayment-workflow.test.js`. El entorno local no compila ni ejecuta Deluge; validar la función en el editor CRM antes de usarla.
