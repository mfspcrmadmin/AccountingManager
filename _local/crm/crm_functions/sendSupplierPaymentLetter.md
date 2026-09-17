# Payment letter: remitente del usuario del widget

Actualizar la función CRM existente `email_sendSupplierPaymentLetter` (nombre de
ejecución del widget: `sendsupplierpaymentletter`) con el contenido de
`sendSupplierPaymentLetter` y añadir el argumento **actingUserEmail**, tipo String.
Conservar los cuatro argumentos anteriores. Actualizar la función antes de subir
el ZIP del widget: ambos cambios deben desplegarse juntos.

El widget obtiene el correo del usuario actual mediante `getCurrentUserEmail`,
lo normaliza y lo pasa en `actingUserEmail`. Si no puede identificarlo, bloquea la
llamada y muestra un popup. No utiliza un remitente por defecto.

La función valida el email contra los 27 remitentes del ejemplo proporcionado de
`comm_sendCommunicationDraft`, antes de consultar pagos o enviar mensajes. Cada
remitente tiene su propio `if/else` con un `from` literal. Para ampliar la lista,
actualizar tanto `authorizedSenders` como el correspondiente bloque `sendmail`.
Los remitentes compartidos del ejemplo solo se usan si coinciden con el email
del usuario; no son alternativas automáticas.

La función devuelve `error: true`, `code: UNAUTHORIZED_SENDER` y un mensaje cuando
el correo no está permitido. El widget muestra el error en un diálogo modal y
conserva la selección de proveedores. También muestra en ese diálogo los errores
de identificación y envío.

La identidad se recibe del widget, siguiendo el patrón del ejemplo; la lista
valida remitentes permitidos, no autentica por sí misma al llamante de la función.

Validación local: `node --test tests/*.test.js`. Después de desplegar, verificar en
CRM el remitente real con un usuario de la lista y el popup con uno no incluido.
Las pruebas locales no ejecutan Deluge ni envían correos reales.
