# Migración de proformas y prepayments de Creator a CRM

La función temporal selecciona prepayments de Creator cuyo `Payment_Date` está
dentro del rango indicado, incluyendo ambos extremos. Obtiene su proforma y aplica
el filtro estricto `^[A-Za-z]{4}[0-9]{7}$` a `MFSP_Reference`: cuatro letras ASCII y
siete números, exactamente 11 caracteres. No elimina espacios ni corrige referencias.

De cada proforma seleccionada se migran **todos sus prepayments**, incluidos los
que estén fuera del rango, los cancelados y los que no tengan fecha. No se migran
proformas que no tengan ningún prepago dentro del rango. No se crean facturas,
pagos contables ni allocations. No se elimina información en Creator. En modo
`migrate`, los prepayments pasan a `Status = Migrated` tras verificar la proforma en CRM.

## Instalación en CRM

Crear estas cuatro funciones standalone, con retorno `string`, en este orden.
Cada archivo contiene la firma con los nombres y tipos de sus argumentos:

1. [`creatorMigrationRead`](../creatorMigrationRead): lectura y paginación de Creator.
2. [`creatorMigrationEnsure`](../creatorMigrationEnsure): creación, reutilización y comprobación de registros CRM.
3. [`creatorMigrationFiles`](../creatorMigrationFiles): documentos y copias JSON de origen.
4. [`migrateCreatorPrepayments`](./migrateCreatorPrepayments): función principal que se ejecuta manualmente.

Las llamadas entre funciones usan sus nombres `standalone.*`; mantener esos nombres.

Preparación de Creator y CRM:

- Añadir **`Migrated`** al campo `Status` de `Pre_Payments_Form` en Creator.
  El archivo local del formulario ya incluye la opción; falta aplicarla en Creator.
- Crear **`Prepayments.Creator_Original_Status`** como texto, no único ni obligatorio.
  Conserva `Paid`, `Not Paid` o `Cancelled` antes de marcar el origen y permite
  reintentar y verificar registros cuyo estado en Creator ya sea `Migrated`.

- Crear un campo **texto único** con nombre API **`Creator_Record_ID`** en
  `Prepayment_Requests` y otro igual en `Prepayments`. No usar un campo numérico:
  los IDs de Creator deben conservarse como texto. No marcarlos obligatorios para
  permitir las creaciones nativas de los widgets.
- Configurar `Prepayment_Request_Services.Name` como texto único. El nombre de una
  asociación sigue siendo `crmRequestId-crmServiceId`.
- Estos campos de origen no existen en los esquemas exportados que se revisaron.
  La función comprueba sus metadatos y se detiene si faltan o no son únicos.

Conexiones utilizadas, ya presentes en las funciones locales:

- `administrationmanager`: lectura de informes, descarga de archivos y actualización
  de registros de Creator (`ZohoCreator.report.UPDATE`). Ejecutar como administrador
  o desarrollador para poder usar `skip_workflow: ["all"]`.
- `crm_oauth_connection`: lectura de metadatos, COQL, archivos y attachments de CRM.
- Las tareas nativas `zoho.crm.getRecordById`, `createRecord` y `updateRecord` también
  necesitan acceso a los módulos como usuario ejecutor.

La aplicación configurada es `madeforspainandportugal/administration-manager`, en
el centro de datos EU. El informe de prepayments es `All_Pre_Payments`, utilizado
por la integración existente. El nombre del informe de proformas no se puede
deducir del nombre del formulario: se proporciona como parámetro.

Ordenar los informes por **ID ascendente**, no por estado ni fecha de modificación.
Deben incluir también los registros `Migrated`: no añadir un filtro que los excluya,
pues eso desplazaría la paginación e impediría verificar los hermanos.

Los informes deben ser completos, sin filtros que oculten registros o hermanos, y
mostrar los campos de origen en su vista rápida o de detalle. `field_config=all`
no concede acceso a campos ocultos. En particular, el de proformas debe exponer
`ID`, `MFSP_Reference`, `Service_ID`, `Supplier_Id`, `Supplier_Reference`,
`Total_Proforma_Amount`, `Transaction_Type`, `Requested_Date`, `Requested_by`,
`Observations`, `Proforma_Attached` e `Invoice_Attached`. El de prepayments debe
exponer `ID`, `Proforma_Associated`, `Amount`, `Percent`, `When_To_Be_Paid`,
`Payment_Date`, `Status`, `Accounted`, `Bank_Receipt` y `Payment_Proof`.

## Parámetros de la función principal

| Parámetro | Valor |
| --- | --- |
| `mode` | `simulate`, `migrate` o `verify`. |
| `paymentDateFrom` | Fecha inicial obligatoria `yyyy-MM-dd`, inclusive. |
| `paymentDateTo` | Fecha final obligatoria `yyyy-MM-dd`, inclusive. |
| `proformaReport` | Nombre de enlace real del informe de `Proforma_Form`. No es necesariamente `Proforma_Form`. |
| `creatorDateFormat` | Formato configurado en Creator: `dd-MMM-yyyy`, `dd/MM/yyyy` o `yyyy-MM-dd`. Se usa para consultar y leer fechas. |
| `resumeState` | Vacío o `{}` en la primera llamada. Después, el texto JSON devuelto en `next_state`. |

Ejemplo de primera llamada, sustituyendo el informe por su nombre real:

```text
mode = simulate
paymentDateFrom = 2026-09-01
paymentDateTo = 2026-09-30
proformaReport = <nombre real del informe de proformas>
creatorDateFormat = dd-MMM-yyyy
resumeState = {}
```

Cada llamada revisa hasta **25 prepagos candidatos**, en los tres modos. Por cada
proforma valida procesa todos sus hijos, aunque sean mas de 25. Una proforma no
se procesa dos veces dentro del mismo lote. `processed_in_batch` indica cuantos
candidatos se completaron y `batch_results` resume sus resultados. Los contadores
de `summary` son acumulados y no duplican proformas. Si quedan candidatos,
continuar con `next_state`. Un error detiene el lote y conserva en `next_state`
el candidato que fallo; los anteriores ya completados no se repiten.
No hay continuacion automatica entre llamadas.

El estado está vinculado al modo, rango e informe. Empezar con `{}` al cambiar de
modo. No cambiar el orden del informe ni editar manualmente los registros de origen durante
el recorrido. Si cambia la selección o caduca el cursor, reiniciar desde `{}`:
los identificadores únicos permiten reconocer los registros ya migrados.

## Correspondencia de campos

| Creator | CRM |
| --- | --- |
| `Proforma_Form.ID` | `Prepayment_Requests.Creator_Record_ID` |
| ID de proforma | Nombre `CREATOR-PROFORMA-<ID>` |
| `Service_ID` | Asociación en `Prepayment_Request_Services` al servicio CRM exacto |
| Booking y Supplier del servicio | `Booking` y `Supplier` de la request; se verifica la referencia y, si existe, `Supplier_Id` de Creator |
| `MFSP_Reference` | `MFSP_Reference`, conservando el texto exacto |
| `Supplier_Reference` | `Supplier_Code` |
| `Total_Proforma_Amount` | `Amount`, sin recalcularlo |
| `Transaction_Type` | `Transaction_Type` |
| `Requested_by` | `Requested_By_2` |
| `Requested_Date` | `Requested_Date`, conservando el día y añadiendo `00:00:00+00:00` porque Creator solo guarda una fecha |
| `Observations` | `Observations` |
| `Proforma_Attached` | Campo `Proforma_Attached` |
| `Invoice_Attached` | Attachments generales de la request; el esquema CRM exportado no tiene un campo `Invoice_Attached` |
| `Pre_Payments_Form.ID` | `Prepayments.Creator_Record_ID` |
| ID de prepago | Nombre `CREATOR-PREPAY-<ID>` |
| `Proforma_Associated` | Lookup `Prepayment_Request` a la request migrada |
| `Amount`, `Percent`, `Accounted` | Campos homónimos |
| `When_To_Be_Paid` | Campo homónimo; `On a specific date` pasa a `Specific Date` |
| `Payment_Date` | **`Due_Date`**: en el formulario Creator representa el vencimiento previsto |
| `Payment_Proof` | Campo `Payment_Proof` |

Los formularios Creator usan EUR, por lo que los registros CRM se crean con esa
moneda. No se inventa una fecha real de pago: `Prepayments.Payment_Date` queda sin
rellenar. Los importes que no puedan interpretarse o los estados desconocidos
detienen el registro, en lugar de sustituirse por cero o por un estado genérico.

Estados de los prepayments:

- `Not Paid` → `Accounting_Status = Pending invoice`.
- `Paid` → `Accounting_Status = Prepayment recorded`.
- `Cancelled` → `Accounting_Status = Cancelled`.

Los pagados históricos quedan cerrados en el widget aunque no tengan factura o
pago contable vinculado. La migración no crea esos documentos ni acredita haber
reconstruido su contabilidad. No escribe el antiguo `Prepayments.Status`.

El estado de la request se calcula usando todos sus hijos: `Fully Paid`,
`Partially Paid`, `To Be Paid` o `Cancelled` si todos están cancelados. No se marca
el estado final hasta terminar los hijos, documentos y asociación. No se modifican
`Payment_Status` o `Status_EZUS` de los servicios, ni el estado del booking.

Cada request y prepago recibe además una copia JSON de su registro Creator como
attachment. Conserva campos sin equivalencia en el esquema CRM exportado, como
`Bank_Receipt`, datos informativos del servicio o datos bancarios del proveedor.
Esos datos quedan archivados, no convertidos en campos operativos de los widgets.
Los archivos tienen nombres estables con su ID Creator para poder reanudar.
Las copias JSON excluyen `Modified_Time`, `Modified_User` y el bloque `Payments`
del padre (cada hijo tiene su propia copia). En los hijos se conserva el estado
original, no el marcador `Migrated`, para que el marcado no genere otra copia en
cada reintento.

## Simular, migrar y verificar

1. **simulate**: recorrer todo el rango. Solo lee. Muestra payloads faltantes,
   documentos que habría que copiar, referencias excluidas y problemas de datos.
2. **migrate**: reiniciar con `{}` y recorrer de nuevo. Crea solo los registros
   que no existen; conserva documentos existentes y verifica los nuevos.
3. **verify**: reiniciar con `{}` y recorrer todo el rango. No escribe. Comprueba
   campos migrados, vínculos y presencia de los documentos por sus nombres de
   origen. No realiza una comparación binaria del contenido de los archivos.

Guardar las respuestas de todos los lotes. `complete` significa final del
recorrido, no ausencia de errores en respuestas anteriores. La verificación solo
es correcta si todas las proformas elegibles terminan con `success: true` y
`missing: 0`, y no quedan errores sin resolver. Revisar también las exclusiones
`skipped_invalid_mfsp` y las advertencias sobre diferencias de importes.

Ante un error, el estado no avanza: usar el mismo `next_state` tras resolverlo.
La función conserva los registros y archivos confirmados, y no los borra como
compensación. No ejecutar dos migraciones a la vez ni usar los registros migrados
para nuevas operaciones contables mientras el recorrido está incompleto.

Las funciones no enlazan automáticamente duplicados históricos creados manualmente
sin `Creator_Record_ID`. Identificarlos en la simulación y asignar su ID de origen
solo tras comprobar que representan exactamente el mismo registro. Una discrepancia
en los campos de un registro con ese ID se informa sin sobrescribirlo.

Las descargas y cargas están sujetas a los límites de archivos y ejecución de Zoho.
Un archivo que exceda los límites produce un error y deja la proforma incompleta;
no se omite silenciosamente. Una proforma con muchos documentos puede requerir
reintentos si se alcanza el tiempo de ejecución. El lector de hijos tiene un tope
explícito de 2.000 registros por proforma y falla si no puede confirmar el final.

## Validación realizada

Se han comprobado los nombres de campos contra los archivos locales. Las pruebas
Node ejecutan el bloque de transformación de datos extraído del Deluge mediante
un adaptador limitado y prueban el filtro de referencias, los hermanos fuera del
rango, estados, importes y errores. No sustituyen al compilador de Deluge ni a una
prueba real de permisos, respuestas API y archivos.

No se ha instalado ni ejecutado esta migración en CRM. Guardar las funciones en
el editor de Deluge y empezar por `simulate` antes de realizar escrituras.

Referencias: [lectura y cursores de Creator](https://www.zoho.com/creator/help/api/v2.1/get-records.html),
[descarga de archivos](https://www.zoho.com/creator/help/api/v2.1/download-file.html),
[archivos CRM](https://www.zoho.com/crm/developer/docs/api/v8/upload-files-to-zfs.html),
[campos de archivos al actualizar registros](https://www.zoho.com/crm/developer/docs/api/v8/update-records.html).

## Marcado de Creator y actualización desde la versión anterior

El cambio de estado se hace al final, cuando todos los prepayments, documentos,
la asociación al servicio y el estado final de la request han sido verificados.
Solo `migrate` realiza el PATCH; `simulate` y `verify` nunca cambian Creator.
El PATCH modifica únicamente `Status` y solicita `skip_workflow: ["all"]` para no
activar las automatizaciones antiguas de pago. Los blueprints no se pueden omitir
con ese parámetro: si el formulario tiene uno, debe permitir esta transición.

Si el PATCH falla o su lectura posterior no confirma `Migrated`, la función devuelve
error y conserva el estado de reanudación. Los registros CRM ya confirmados se
reutilizan. Si parte de los hijos ya quedó marcada, su estado original se recupera
de `Creator_Original_Status`; nunca se interpreta `Migrated` como `Paid` o `Not Paid`.

Para registros creados con la versión anterior, volver a ejecutar `migrate` desde
`{}` después de actualizar las funciones y crear el campo nuevo. Si Creator todavía
conserva el estado original, la función rellena únicamente ese campo de auditoría
tras verificar los demás datos, y finalmente marca Creator. Puede añadirse una
copia JSON normalizada nueva; las copias anteriores se conservan. Si alguien ya
cambió manualmente Creator a `Migrated` sin guardar el estado original, la función
se detiene para que se recupere ese dato del historial o de la copia anterior.

Referencia: [actualización de registros Creator y exclusión de workflows](https://www.zoho.com/creator/help/api/v2.1/update-specific-record.html).


### Totales de la seleccion

Cada respuesta incluye `summary`: `selected_proformas`, `selected_prepayments`,
`candidates_reviewed`, `invalid_mfsp_candidates` e `is_final`.
El total incluye todos los hijos de las proformas validas seleccionadas y cuenta cada
proforma una sola vez, aunque varios hijos entren en el rango de fechas.
Son registros seleccionados, incluidos los que ya existan en CRM, no solo altas pendientes.
Hasta `is_final: true` los contadores son parciales. Para obtener el total global,
recorrer `simulate` con cada `next_state` hasta `complete: true`.
Los estados de versiones anteriores no contienen contadores: iniciar la simulacion
con `resumeState` vacio. Al pasar a `migrate`, iniciar tambien con estado vacio.


## Ejecucion con avance guardado (sin copiar resumeState)

Actualizar primero `migrateCreatorPrepayments`. Crear despues, en este orden:

1. [`creatorMigrationProgress`](../creatorMigrationProgress), standalone string, tres argumentos String: action, config, value.
2. [`migrateCreatorPrepaymentsAuto`](./migrateCreatorPrepaymentsAuto), standalone string, cinco argumentos String: mode, paymentDateFrom, paymentDateTo, proformaReport, creatorDateFormat.

Ejecutar la funcion **Auto** con los cinco parametros habituales. Ya no tiene
`resumeState`. Cada ejecucion procesa hasta 25 candidatos y guarda el siguiente
punto. Repetir con los mismos parametros hasta `complete: true`. Esto elimina la
copia manual, pero no programa ejecuciones: para ejecucion desatendida, un scheduler
puede llamar a Auto con una configuracion fija. No ejecutar llamadas simultaneas.

La conexion `crm_oauth_connection` necesita `ZohoCRM.settings.variables.ALL`.
Debe existir el grupo de variables CRM **General**. La funcion crea una variable
Textarea `CreatorPrepayment_<hash>` por configuracion, verifica escritura antes de
migrar y lee el valor guardado para detectar truncamientos. No modificar ni borrar
esa variable mientras la ejecucion este incompleta. Los modos simulate, migrate y
verify conservan avances separados. Si se cambia el rango, se inicia otra ejecucion.
Referencias API: [crear variables](https://www.zoho.com/crm/developer/docs/api/v8/create-variables.html),
[actualizar variables](https://www.zoho.com/crm/developer/docs/api/v8/update-variables.html).

`progress_saved: true` confirma el guardado. Si falla el guardado, la respuesta
conserva `next_state` para recuperacion manual. Un timeout que interrumpa toda la
llamada puede obligar a repetir el lote anterior; los IDs de origen evitan crear
registros duplicados. El tamano del estado crece con las proformas contabilizadas;
si CRM rechaza el valor o lo trunca, la funcion informa del error, no afirma que el
avance se haya guardado.

En migrate, si TODOS los hijos de una proforma ya tienen Status Migrated, se omite
su migracion y devuelve `skipped_already_migrated`. Si solo algunos lo tienen, se
continua para completar los restantes. Simulate y verify siguen inspeccionando
los registros. El filtro de la consulta mantiene los estados para no desplazar
la paginacion. El marcador se considera una confirmacion de una migracion anterior;
para auditar otra vez esos registros, usar verify. Al pasar del flujo manual a Auto
se recorre desde el principio; lo ya migrado se omite por este criterio.
