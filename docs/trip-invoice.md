# Factura de venta del viaje

Trip closure incorpora `Invoice trip`. Requiere cierre completado, saldo cero y todos los settlements activos revisados. El formulario pide una fecha sin valor predeterminado y presenta el cliente y el importe antes de crear la factura.

Se crea una factura nativa de CRM en `Invoices` (etiqueta actual: `Sales Invoices`), vinculada a `Deals` mediante `Deal_Name__s`. Usa una linea global con el producto existente `616617000025032722`, el Sales Price integro y sin IVA desglosado. La comision se guarda separadamente y no reduce el importe. No genera asientos ni envia correos.

La serie es `FV-AAAA-000001`, con seis digitos. El ano corresponde a la fecha elegida y cada ano comienza en uno. Los campos unicos `Trip_Invoice_Number` y `Trip_Booking_Key` impiden que dos ejecuciones de este flujo guarden el mismo numero o creen dos facturas para el mismo Booking. Una colision de numero reintenta con el siguiente; una colision de Booking recupera la factura existente.

Antes de emitir se vuelven a leer el Booking y todos sus settlements, comparandolos con el borrador revisado. Cualquier cambio exige una nueva revision. Las consultas paginan hasta 5.000 registros y fallan si no pueden comprobar el conjunto completo.

Si ya existe una factura antigua asociada al Booking, se muestra y no se crea otra. Varias facturas, una nota de credito aislada o un enlace incoherente requieren revision manual. Nunca se renumera una factura existente. Si falla el enlace al Booking despues de crear la factura, `Restore Booking link` permite recuperar la asociacion sin emitir otra factura.

## CRM instalado

- `tripinvoice_readrelated`, ID `616617000177031279`: consulta interna de registros asociados.
- `tripinvoice_manage`, ID `616617000177035431`: inspeccion, vista previa y emision.
- Invoices: `Trip_Invoice_Number` (unico), `Trip_Booking_Key` (unico), `Trip_Invoice_Year`, `Trip_Invoice_Sequence`.
- Deals: `Sales_Invoice` (lookup a Invoices), `Sales_Invoice_Number`, `Sales_Invoice_Date`.

Las funciones compilaron y su codigo publicado se volvio a leer. No se ha emitido ninguna factura real.

## Activacion

OAuth de `tripinvoice_manage` esta habilitado y verificado. Las consultas internas siguen sin acceso REST publico. Falta publicar el widget actualizado y realizar la primera emision controlada. No se han emitido facturas reales ni generado ZIP.

## Origen, abonos y cobros

Se han creado `Invoice_Origin`, `Booking_MFSP`, `Original_Sales_Invoice`, `Collections_Status`, `Collected_Amount`, `Refunded_Amount`, `Collection_Source`, `Collection_Evidence` y `Collections_Checked_At`.

Las nuevas facturas se identifican como Accounting Manager. Los origenes historicos no se rellenan ni se deducen automaticamente: los registros antiguos con origen vacio aparecen como historicos sin clasificar. El MFSP del Booking se guarda separado del antiguo campo de referencia de documento.

Los pagos actuales se leen de Creator Administration Manager: All Travellers Payments (solo PAID) y All Refunds (solo SUCCESS, usando el importe final EUR). Cada registro confirmado se verifica por ID y Booking, y se detectan referencias de proveedor repetidas. Los reembolsos pendientes bloquean la verificacion. No se suman solicitudes sin pagar ni se usa el importe solicitado de una devolucion como si fuera el definitivo.

Si no hay movimientos confirmados en Creator, se comprueban los Payment Requests del CRM marcados como pagados, excluyendo estados fallidos o cancelados y comprobando que no esten asociados a otra factura. Estos se enlazan con el campo nativo Payment Requests al crear o actualizar la factura. Cuando ambos circuitos contienen movimientos confirmados se exige revision para no duplicar importes. Las referencias de Creator quedan guardadas en la evidencia de la factura; no se fabrican solicitudes de pago CRM.

El importe bruto cobrado y las devoluciones se guardan por separado; Total Paid Amount contiene el neto y Balance Due conserva su formula nativa. La emision exige que el neto confirmado coincida con Sales Price. La comprobacion es en EUR: otros casos de moneda, falta de cobros historicos o importes incoherentes requieren revision, sin asumir tipos de cambio ni dar la factura por pagada solo porque el Booking tenga saldo cero.

Review current receipts permite revisar los movimientos y Save verified receipts guarda los nuevos totales, con control de version. No cambia el numero ni el importe de la factura y solo se permite para documentos emitidos por Accounting Manager. El estado Verified se muestra con la fecha de la comprobacion; no es un estado bancario actualizado automaticamente en segundo plano.

Los Bookings con varios documentos muestran facturas y abonos separados, con signo de abono negativo para la revision. No emiten otra factura global. El usuario puede seleccionar y confirmar la factura original de un abono. El servidor valida Booking, moneda, tipo, fechas y versiones antes de guardar solo el lookup Original Sales Invoice. No se crean abonos, se renumeran historicos ni se alteran sus importes o cobros.

La funcion interna `tripinvoice_collections`, ID `616617000177026279`, compilo en CRM y utiliza la conexion existente `administrationmanager` de Creator y `crm_oauth_connection` para CRM. La lectura de campos se contrasto con registros reales de Creator sin modificar datos. Las primeras operaciones financieras reales siguen pendientes de aceptacion.

## Validacion

`node --test tests/trip-invoice.test.js tests/trip-closure-workflow.test.js tests/trip-closure-integration.test.js tests/invoice-request.test.js tests/widget-bootstrap.test.js` pasa 56 pruebas.

`node tests/trip-invoice.browser.cjs` comprueba formulario en 1440 y 390 px, fecha obligatoria, importe integro, invalidacion de la vista previa, doble clic, factura existente, restauracion del enlace, actualizacion de cobros con revision y enlace explicito de abonos a su original, ademas del foco. `node tests/trip-closure-scroll.browser.cjs` conserva las comprobaciones de scroll, referencias y remitente.

Contrato contrastado con [Insert Records V8 de Zoho](https://www.zoho.com/crm/developer/docs/api/v8/insert-records.html) y la configuracion de [seguridad de Functions](https://www.zoho.com/crm/developer/docs/functions/security.html). Las pruebas locales ejecutan el control de flujo Deluge con un adaptador CRM simulado; no sustituyen la primera emision real.

## Descarga y archivo PDF

Download invoice PDF genera el documento de las facturas emitidas por Accounting Manager. Se usan los datos de la factura, una linea de viaje sin desglose de IVA y los datos fiscales del emisor ya utilizados por la aplicacion. Los datos del cliente se leen de Accounts y quedan congelados en Invoice PDF Snapshot al generar el primer documento; no se inventa un identificador fiscal del cliente si no existe en los datos.

Save a copy in Attachments aparece marcado y es visible antes de descargar. Si se mantiene marcado, el servidor almacena el PDF en Files, lo adjunta a la factura y vuelve a leer Attachments para confirmar su persistencia. Las siguientes descargas reutilizan el archivo original mediante el SDK, tambien cuando devuelve el contenido como cadena binaria. Si se desmarca, se descarga sin crear un adjunto, conservando la copia de los datos del documento en la factura.

Los campos de control son Invoice_PDF_Snapshot, Invoice_PDF_Hash, Invoice_PDF_File_ID, Invoice_PDF_Attachment_ID e Invoice_PDF_State. El archivo se reclama con control de version; una subida de resultado incierto queda pendiente de revision y no se reenvia automaticamente. Si el adjunto existe pero fallo el ultimo guardado de su enlace, una nueva consulta puede recuperar el enlace sin subir otra copia. No se sobrescribe ningun adjunto.

El PDF no contiene estados de cobro variables. Si se modifican numero, fecha, moneda, cliente o total despues de generar el documento, la aplicacion exige revisar la discrepancia en vez de cambiar silenciosamente el documento guardado. Los originales historicos de Tourplan deben descargarse desde sus adjuntos: este flujo no los vuelve a emitir.

El renderizador jsPDF 4.2.1 y las fuentes Noto Sans se incluyen localmente con sus licencias. No hay dependencia de una CDN en tiempo de ejecucion. La funcion interna tripinvoice_pdf, ID 616617000176992888, esta publicada y se llama desde tripinvoice_manage, que conserva OAuth.

El modulo se ha renombrado a Sales Invoices (singular: Sales Invoice), manteniendo la API Invoices y los mismos perfiles de acceso.

Validacion adicional: 59 pruebas Node; tests/trip-invoice-pdf.browser.cjs genera el PDF con el mismo renderizador del widget, comprueba caracteres acentuados, textos largos, descarga, archivo unico y recuperacion parcial. Se renderizo e inspecciono visualmente output/pdf/sales-invoice-example.pdf, un documento de prueba que no corresponde a una factura emitida. La descarga y la primera subida reales quedan pendientes de aceptacion despues de publicar el widget.

Referencias tecnicas: [jsPDF](https://github.com/parallax/jsPDF/releases/tag/v4.2.1), [Attach File Deluge](https://www.zoho.com/deluge/help/crm/attach-file.html), [SDK getFile](https://help.zwidgets.com/help/latest/ZOHO.CRM.API.html).


## Confirmacion manual de cobros historicos

La opcion se ofrece solo cuando Creator no devuelve ningun registro de pago ni reembolso (incluidos pendientes, fallidos o sin pagar) y CRM no tiene Payment Requests para el Booking. Exige EUR, Balance_Amount cero y Paid_Amount positivo que coincida con Sales_Price_inc_Taxes. Los errores de consulta y los registros parciales nunca habilitan esta via.

Invoice trip muestra venta, importe historico y saldo. Origen, referencia o justificacion y casilla de confirmacion son obligatorios. La casilla empieza desmarcada. El usuario revisa expresamente el importe neto despues de considerar reembolsos. La funcion reconstruye la evidencia y su identidad de ejecucion en servidor; no confia en el usuario ni la fecha enviados por el cliente. La evidencia queda ligada al snapshot y, al emitir, se guarda la fecha UTC. Cambiar datos, confirmacion o registros de cobro invalida la revision. No se crean Payment Requests ni registros en Creator. El PDF conserva su flujo actual.

La fuente de la factura sera Historical manual confirmation. Las actualizaciones automaticas de cobros de estas facturas quedan bloqueadas para conservar la evidencia manual; cualquier conciliacion posterior se revisara en CRM.

### Estado de activacion, 12 noviembre 2026

1. Anadir a Invoices.Collection_Source el valor Historical manual confirmation, conservando todas las opciones actuales (Creator y CRM Payment Requests).
2. Publicar tripinvoice_collections (616617000177026279) y tripinvoice_manage (616617000177035431), conservando firmas y OAuth actuales, y releer el codigo publicado.
3. Publicar el widget actualizado. No generar ZIP desde Codex.
4. Verificar inspect y preview de MFSP148132E sin emitir factura. La primera emision y la identidad auditada necesitan aceptacion en la sesion real del usuario.

Collection_Source ya incluye Historical manual confirmation conservando las opciones anteriores. tripinvoice_collections y tripinvoice_manage compilaron y se publicaron correctamente; se releyo el codigo publicado de ambas. El compilador elimino parentesis redundantes en la condicion inicial de collections, sin otros cambios en sus tokens. Copias previas en crm/trip-invoice/backups/*.before-historical-20261112.dg.

Pendiente: actualizar el widget y verificar inspect/preview en la sesion real. El conector disponible permite publicar y releer funciones, pero no ejecutarlas directamente. La primera emision y la identidad de la confirmacion quedan pendientes de aceptacion. No se ha emitido ninguna factura ni se ha confirmado ningun cobro por el usuario.

Identidad de ejecucion: [variables de sistema en CRM Functions](https://www.zoho.com/crm/developer/docs/functions/language-guide/deluge.html).


Ajuste 12 noviembre 2026: se elimina Reference or reason del formulario y deja de ser obligatorio en CRM. Permanecen el origen y la confirmacion explicita. Las referencias de evidencias historicas ya existentes se conservan.
