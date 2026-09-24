# Relaciones entre requests y servicios

`Prepayment_Request_Services` es la única fuente de asociaciones entre servicios y
solicitudes de prepago. Cada registro contiene `Prepayment_Request` y `Booking_Service`;
no guarda cantidades. `Name` se genera como `requestId-serviceId` y debe configurarse
como único en CRM para impedir duplicados concurrentes.

En bookingsManager, un servicio puede participar en más de una request. El selector
de servicios indica las asociaciones existentes; seleccionar una request incorpora
sus servicios ya vinculados. Guardar añade las asociaciones faltantes y verifica los
registros por ID antes de continuar con los prepayments. Los reintentos conservan los
IDs confirmados durante la sesión, incluso si CRM Search todavía no los ha indexado.
Una creación incierta se detiene para evitar insertar de nuevo a ciegas.

En accountingManager, el panel de prepayment carga los servicios a través del módulo
intermedio y elimina IDs repetidos. No deduce asociaciones por proveedor, booking o
settlement. Los errores de lectura se muestran como errores, no como una lista vacía.

Al registrar o descartar un prepago, la sincronización calcula el estado de su request
y el de cada servicio asociado considerando todas sus requests activas:

- Fully paid: todas las requests activas tienen prepayments y todos están resueltos.
- Partially paid: hay algún prepago resuelto y quedan requests o prepayments pendientes.
- Prepayment Requested: ninguna request activa tiene un prepago resuelto.

`Prepayment recorded`, `Discard - Credit` y `Discard - Already Paid` cuentan como
resueltos. Se excluyen prepayments cancelados y requests canceladas o descartadas.
Una request activa sin prepayments impide marcar el servicio como Fully paid.
Si no queda ninguna request activa, la sincronización conserva el estado del servicio.
El cálculo representa el estado de las solicitudes asociadas, no un reparto del coste
del servicio. No genera invoice lines ni cantidades por servicio.

La migración temporal y el orden de despliegue se explican en
[`migratePrepaymentRequestServices.md`](../_local/crm/crm_functions/migratePrepaymentRequestServices.md).
