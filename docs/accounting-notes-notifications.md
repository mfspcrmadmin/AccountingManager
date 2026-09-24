# Accounting Notes: avisos al solicitante del prepago

## Instalación

Crear en CRM una función Standalone de retorno String con nombre API `accountingnotes_saveandnotify`, usando [accountingNotes_saveAndNotify.dg](../crm/accountingNotes_saveAndNotify.dg). Argumentos String: `bookingId`, `actingUserId`, `expectedNotes`, `notesJson`. Hay una copia idéntica en `accountingManager/crm/`.

Usa la conexión existente `crm_oauth_connection` para actualizar Deals, y lectura de Deals, Prepayments, Prepayment_Requests y User_Relationships. El remitente autorizado es `crmadmin@madeforspainandportugal.com`, como en Review Notes. Publicar después ambos widgets: sus editores de Accounting Notes usan esta función y ya no guardan directamente el campo. No añadir un segundo workflow de correo para las mismas notas.

Los archivos están preparados localmente; la función no está publicada ni se han enviado correos reales. Validar en Zoho la compilación de Deluge, permisos, remitente y recepción antes de usarlo en producción.

## Autor y destinatario

La nota registra `authorId`, `author`, `authorEmail` y fecha del servidor. Las ediciones conservan el autor original y añaden `editedById`, `editedBy`, `editedByEmail`, `editedAt`; el chat muestra quién editó. No hace falta crear otro campo CRM: son propiedades del JSON de `Deals.Accounting_Notes`.

El autor se resuelve por `User_Relationships.User_ID` y debe tener un único registro Active con Email. Se admite a perfiles Finance Standard, Finance Administrator, Administrator, al Owner/Guest Relations del booking o al propio solicitante del prepago. Como en la función de referencia, `actingUserId` lo aporta el widget; no constituye autenticación independiente. Restringir la invocación de la función a los perfiles autorizados. Las credenciales de la conexión CRM determinan el acceso técnico.

El destinatario se obtiene de `Prepayments.Prepayment_Request` → `Prepayment_Requests.Requested_By_2`, que es un campo Email y se rellena con el usuario que solicita el prepago. Se verifica que la solicitud pertenezca al booking. No se confía en un email enviado por el navegador, ni se sustituye el solicitante por Owner/Created_By.

Al añadir, editar o eliminar una nota contextual se envía un aviso al solicitante, con autor de la acción, mensaje, booking, importe e ID del prepago y enlace a sus detalles en Bookings Manager. El correo usa naranja y Reply-To del autor. No se copia el CC de depuración presente en la función de reconfirmationManager. Las respuestas por correo no se importan al chat. Esta primera dirección es Administración → solicitante; no se implementan avisos de vuelta a Administración.

## Guardado y errores

Se compara `expectedNotes` y se usa [If-Unmodified-Since](https://www.zoho.com/crm/developer/docs/api/v8/update-records.html) para evitar sobrescribir cambios concurrentes. Solo se permite una operación por llamada; el autor y el contexto de notas existentes se conservan. La identidad añadida por el servidor se devuelve al widget para la siguiente edición.

Una nota sin contexto de prepago se guarda sin aviso (`skipped_no_context`). Si autor y solicitante comparten email, no hay autoaviso (`skipped_same_user`). Si falta Requested_By_2, se guarda con advertencia explícita. Si falla sendmail después del guardado, el mensaje queda guardado y no se invita a repetirlo. No hay cola persistente ni reintentos automáticos. `sent` confirma que terminó [sendmail](https://www.zoho.com/deluge/help/misc-statements/send-mail.html), no recepción en Outlook.

Pruebas locales: `node --test tests/accounting-notes-save.test.cjs tests/booking-communication.test.cjs`. Cubren el cliente y el contrato estático del servidor, no ejecutan Deluge. Probar en Zoho dos usuarios distintos, cambio de autor en edición, solicitud sin email, otra reserva, conflicto, nota sin contexto y error de correo.
