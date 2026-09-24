# Migración de facturas asociadas a prepagos

Función temporal: [`migratePrepaymentInvoiceAllocations`](./migratePrepaymentInvoiceAllocations).

Convierte cada relación `Prepayments.Vendor_Invoice` en un registro de
`Prepayment_Invoice_Allocations`, con `Prepayment`, `Vendor_Invoice`,
`Allocated_Amount = Prepayments.Amount` y la misma `Currency`.
El importe es el del prepago, no el total de la factura ni su saldo pendiente.

Solo recorre prepagos con el lookup antiguo informado, incluidos los históricos,
cancelados y descartados. Conserva su asociación documental; los consumidores nuevos
deberán seguir excluyendo los cancelados de los totales que correspondan.
Los prepagos sin factura quedan fuera: no se inventan relaciones por proveedor,
booking, nombre o coincidencia de importe.
Si COQL devuelve un registro con el lookup explícitamente `null` y la lectura
directa confirma lo mismo, se cuenta como `skipped`, con estado
`skipped_no_invoice`, y el cursor avanza sin crear una asociación. Una referencia
no nula sin ID sigue siendo un error y devuelve ambos lookups para su revisión.

No crea facturas, pagos ni asignaciones de pago; no modifica estados, importes,
requests ni lookups antiguos. Esta función no adapta el widget al modelo múltiple.

## Preparación

1. En `Prepayment_Invoice_Allocations`, configurar **Name para no admitir duplicados**.
   La exportación local todavía muestra `unique: {}`. El nombre generado es
   `prepaymentId-invoiceId`. La función comprueba los metadatos reales y bloquea
   `migrate` si Name no es único. Simulación y verificación siguen disponibles.
2. Conservar `Prepayments.Vendor_Invoice` y `Vendor_Payment`.
   Ambos están presentes en la exportación actualizada. Recomendable configurar
   los dos lookups y el importe del módulo nuevo como obligatorios.
3. Crear una función standalone con retorno `string` y tres argumentos String:
   `mode`, `afterPrepaymentId`, `invoiceLookupApiName`. Copiar el archivo completo.
4. La conexión `crm_oauth_connection` necesita lectura de metadatos de campos y
   acceso COQL a `Prepayments` y `Prepayment_Invoice_Allocations`.
   El usuario que ejecuta las tareas CRM necesita lectura de esos módulos,
   `Prepayment_Requests` y `Supplier_Invoices`, y creación en el módulo nuevo.
5. Exportar las relaciones antiguas y cualquier asignación ya existente como respaldo.
   Durante el recorrido, detener cambios en los prepagos y sus asignaciones y
   ejecutar una sola migración a la vez. No introducir repartos múltiples hasta
   terminar la verificación y adaptar los consumidores.

La función se ha revisado localmente; no se ha compilado ni ejecutado en CRM.
Debe guardarse y probarse en el editor Deluge antes de la ejecución completa.

## Ejecución

Usar siempre `invoiceLookupApiName = "Vendor_Invoice"` para el esquema actual.

| Fase | mode | afterPrepaymentId inicial | Resultado |
| --- | --- | --- | --- |
| Simular | `simulate` | `0` | Detecta faltantes y conflictos, sin escribir. |
| Migrar | `migrate` | `0` | Crea únicamente asociaciones faltantes y verifica lo guardado. |
| Verificar | `verify` | `0` | Comprueba correspondencia de factura, importe y moneda, sin escribir. |

Cada llamada procesa hasta 25 prepagos por ID. Repetir con el valor de
`next_after_prepayment_id` devuelto hasta `complete: true`. Reiniciar en `0` al
cambiar de fase y guardar las respuestas de todos los lotes.

La función comprueba que la factura exista, tenga la misma moneda, corresponda al
proveedor y booking de la request y tenga un total a pagar suficiente para ese
prepago. Estos controles no constituyen una conciliación global de todos los pagos
o de la suma de distintos prepagos aplicados a una misma factura.

Si ya existe exactamente una asignación que coincide, se conserva, incluso con
otro nombre. Si hay varias, otra factura, diferente importe o moneda, la función
se detiene sin sobrescribirlas. Esta migración presupone el modelo antiguo de una
factura por prepago; un reparto múltiple ya realizado requiere revisión manual.

Ante un error, `failed` aumenta y el cursor permanece antes del registro afectado.
Consultar `details`, resolver la causa y reintentar con el cursor devuelto. Si hubo
una creación incierta, revisar primero el registro en CRM y `link_id`, si se conoce.
No insertar otra asociación manualmente sin comprobar la anterior. El nombre único
protege los reintentos de la misma pareja; no sustituye la pausa de otros escritores.

Si la consulta inicial y la lectura del registro no coinciden, el detalle devuelve
`query_invoice_id`, `invoice_id`, `source_field` y `source_field_returned`.
Esto distingue un lookup vacío de un campo no devuelto y de dos IDs distintos.
La consulta COQL y la lectura `zoho.crm.getRecordById` pueden utilizar contextos
de acceso distintos; el resultado por sí solo no demuestra que alguien modificara
el registro. Revisar los valores y permisos antes de continuar. Usar el cursor
devuelto, nunca el ID del registro fallido, para no saltarlo.

La verificación termina correctamente solo si **todos** los lotes tienen
`success: true`, `missing: 0` y `failed: 0`, y el recorrido llega a `complete: true`.
Una respuesta final vacía no sustituye la revisión de los lotes anteriores.

## Comprobaciones en CRM

- Prepago de 100 EUR asociado a factura de 250 EUR: crea una asignación de 100 EUR.
- Repetir el mismo lote: cuenta la asignación como `existing`, sin duplicarla.
- Asignación existente con importe distinto u otra factura: error sin modificación.
- Dos asignaciones existentes: error para revisar el reparto, sin añadir una tercera.
- Moneda o proveedor/booking incompatibles: error sin inserción.
- Simulación y verificación: no crean registros.
- Prepago con lookup vacío: permanece sin asignación.
- Varios lotes: el cursor conserva IDs como texto y permite continuar sin saltar el fallo.

## Después de migrar

Mantener el lookup antiguo hasta adaptar y validar el registro de facturas y pagos,
la solicitud bancaria, los estados y los demás consumidores que lo utilizan.
La migración por sí sola no habilita varias facturas en la pantalla del prepago.
Si el flujo antiguo sigue escribiendo después del backfill, repetir migración y
verificación durante el cambio final. No retirar ningún campo con esta función.

Referencias: [consultas COQL y paginación](https://www.zoho.com/crm/developer/docs/api/v8/COQL-Overview.html),
[creación de registros y control de triggers](https://www.zoho.com/deluge/help/crm/create-record.html).
