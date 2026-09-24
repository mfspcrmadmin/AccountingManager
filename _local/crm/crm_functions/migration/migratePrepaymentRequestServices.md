# Migrar las asociaciones antiguas de prepagos

Función temporal: `standalone.migratePrepaymentRequestServices`, definida en el archivo
[`migratePrepaymentRequestServices`](./migratePrepaymentRequestServices).

Migra cada `Booking_Services.Prepayment_Request` a un registro de
`Prepayment_Request_Services` con los lookups `Booking_Service` y `Prepayment_Request`.
No crea requests ni prepayments, no copia importes, no cambia estados y no borra
el lookup antiguo. Incluye también las solicitudes históricas pagadas o canceladas.

## Configuración

1. Crear la función standalone con retorno `string` y dos argumentos de texto:
   `mode` y `afterServiceId`. Copiar el archivo de código completo.
2. La conexión `crm_oauth_connection` debe tener acceso COQL de lectura a los tres
   módulos. La función utiliza el dominio europeo `zohoapis.eu`. Las tareas
   `zoho.crm.getRecordById` y `zoho.crm.createRecord` necesitan permisos de lectura
   y creación para el usuario que ejecute la función.
3. En el módulo nuevo, configurar `Name` para no admitir duplicados. El widget y la
   migración generan `requestId-serviceId` como nombre. Esto protege también frente
   a dos creaciones simultáneas; la comprobación previa por sí sola no es una
   restricción de unicidad. En el esquema exportado, `Name` todavía NO es único.
4. Dar a los usuarios de los widgets permisos para leer y crear asociaciones y leer
   ambos lookups. Conviene configurar ambos lookups como obligatorios.

No ejecutar varias migraciones en paralelo. Durante el cambio, detener la creación
de requests desde versiones antiguas del widget para que el lookup no cambie mientras
se recorre. La función se ha revisado localmente, pero debe guardarse y probarse en
el editor de Deluge: no hay un ejecutor Deluge local ni se ha ejecutado en CRM.

## Ejecución

Cada llamada procesa hasta 25 servicios, ordenados por ID. Los IDs se pasan como
texto para no perder precisión. El cursor evita depender de números de página.

| Fase | `mode` | `afterServiceId` inicial | Efecto |
| --- | --- | --- | --- |
| Simulación | `simulate` | `0` | Enumera asociaciones existentes, faltantes y duplicadas; no escribe. |
| Migración | `migrate` | `0` | Crea solo asociaciones faltantes y lee cada registro creado para verificarlo. |
| Verificación | `verify` | `0` | Comprueba que cada lookup antiguo tenga exactamente una asociación; no escribe. |

En cada fase, repetir la llamada usando el `next_after_service_id` de la respuesta
anterior hasta `complete: true`. Reiniciar el cursor en `0` al cambiar de fase.
Guardar las respuestas de **todos** los lotes.

Campos de la respuesta:

- `created`: asociaciones creadas y verificadas en ese lote.
- `existing`: parejas que ya tenían una asociación. Se reutilizan aunque su nombre
  sea distinto del nombre técnico generado.
- `missing`: asociaciones faltantes en simulación/verificación.
- `duplicates`: parejas con más de un registro; no se borran automáticamente.
- `failed` y `details`: errores y registros afectados.
- `next_after_service_id`: último servicio procesado correctamente. Ante un error,
  el cursor no avanza sobre el servicio fallido.
- `complete`: fin del recorrido, **no** confirmación de que se pueda borrar el campo.

Ante un error de creación o verificación, revisar el `link_id` si existe antes de
reintentar. Una llamada puede haber creado el registro aunque la respuesta posterior
falle. La siguiente ejecución vuelve a buscar la pareja; no ejecutar una inserción
manual adicional sin comprobarla.

La verificación es correcta únicamente si **todos sus lotes** tienen
`success: true`, `missing: 0`, `duplicates: 0` y `failed: 0`, y se ha llegado al final.
Una última respuesta vacía no sustituye a la revisión de los lotes anteriores.

## Cambio a los widgets nuevos y retirada del campo

1. Simular y resolver los errores de permisos o asociaciones duplicadas.
2. Ejecutar la migración completa.
3. Ejecutar la verificación completa desde `0`.
4. Publicar las versiones adaptadas de **bookingsManager** y **accountingManager**.
   Estas versiones usan exclusivamente `Prepayment_Request_Services`; no tienen
   un fallback al lookup antiguo.
5. Comprobar en CRM un servicio con dos requests y una request con varios servicios,
   y revisar workflows, funciones, informes e integraciones externas que puedan
   seguir usando el campo antiguo. Esa configuración remota no está auditada aquí.
6. Retirar exclusivamente **`Booking_Services.Prepayment_Request`** y después la
   función temporal. Conservar las respuestas de verificación y una exportación
   de las asociaciones antes de borrar el campo.

**No borrar `Prepayments.Prepayment_Request` ni el lookup homónimo del módulo nuevo.**
Ambos siguen siendo necesarios. Si el lookup antiguo se sobrescribió antes de esta
migración, solo puede recuperarse su valor actual; las asociaciones anteriores
necesitarían una exportación o un historial aparte.

Referencias de implementación: [COQL y paginación por ID](https://www.zoho.com/crm/developer/docs/api/v8/COQL-Overview.html),
[invokeurl y respuesta detallada](https://www.zoho.com/deluge/help/webhook/invokeurl-api-task.html),
[excepciones Deluge](https://www.zoho.com/deluge/help/misc-statements/throw.html).
