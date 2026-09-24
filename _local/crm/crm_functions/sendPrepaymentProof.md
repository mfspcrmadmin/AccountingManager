# Send Payment Proof

Crear en CRM una función standalone `notif_sendPrepaymentProof`, API name
`notif_sendprepaymentproof`, con un argumento **String `prepaymentId`**. Copiar
el archivo `sendPrepaymentProof` de esta carpeta en el editor de Deluge.

El botón **Send Payment Proof** está en el popup **Payment proof** del anticipo.
Solo permite enviar archivos ya guardados y se bloquea si hay archivos pendientes
de adjuntar. Abrir el popup o adjuntar archivos no envía ningún correo.

## Configuración

- Mantener la conexión `crm_oauth_connection` con lectura de `Prepayments`,
  `Prepayment_Requests` y descarga de archivos de campos. Se usa el dominio EU.
- Verificar el remitente `crmadmin@madeforspainandportugal.com` para `sendmail`.
- No se aplica la lista de usuarios heredada de Creator ni se consulta `zoho.loginuserid`.
  La disponibilidad de la funci?n depende de la configuraci?n de acceso de CRM.

## Equivalencia con Creator

| Creator | CRM |
| --- | --- |
| `Proforma_Associated` | `Prepayments.Prepayment_Request` |
| `Proforma_Associated.Requested_by` | `Prepayment_Requests.Requested_By_2` |
| `MFSP_Reference` | `Prepayment_Requests.MFSP_Reference` |
| `Booking_Name` | `Prepayment_Requests.Booking.name` |
| `Supplier_Name` | `Prepayment_Requests.Supplier.name` |
| `Payment_Proof` | Todos los archivos de `Prepayments.Payment_Proof` |

Remitente, CC y asunto son fijos, como en Creator. No se admiten destinatarios ni
adjuntos arbitrarios desde el widget. Se conserva el texto en español y la tabla
resumen, escapando los valores CRM para mostrarlos como texto. No se modifican
estados contables ni los checkboxes bancarios.

Se descargan todos los justificantes antes de enviar. Una descarga fallida, un
archivo vacío, un destinatario inválido o adjuntos que sumen más de 15 MB bloquean
el correo completo. El límite del campo para subir archivos y el de envío por
correo son distintos.

El botón evita dobles clics y queda bloqueado tras un intento hasta reabrir el
popup o guardar nuevos archivos. No hay reintentos automáticos ni deduplicación
entre sesiones: tras un timeout, comprobar el envío antes de repetirlo.

## Validación

Pruebas locales con CRM simulado: `node --test tests/prepayment-proof.test.js`.
No ejecutan ni compilan Deluge, ni envían correos reales. La función no se ha
desplegado desde este workspace. El ZIP no se actualiza.

En CRM, validar el código en el editor y probar con un anticipo de prueba cuyo
`Requested_By_2` sea un buzón controlado. Verificar remitente, CC, asunto, tabla,
nombres y contenido de varios adjuntos. Probar tambi?n sin archivos y con un
destinatario vac?o: no debe salir ning?n correo.

Referencias: [descarga de archivos de campos](https://www.zoho.com/crm/developer/docs/api/v8/download_field_attachments.html),
[adjuntos y límite de sendmail](https://www.zoho.com/deluge/help/misc-statements/send-mail.html).
