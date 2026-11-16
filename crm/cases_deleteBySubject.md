# Borrar Cases por Subject

Fuente: `cases_deleteBySubject.dg`. Funcion standalone de CRM, retorno String JSON.
Preparada localmente; pendiente de compilacion y prueba en Zoho. No se han borrado registros.

Usa la conexion existente `crm_oauth_connection` y el centro de datos EU del proyecto.
Comprueba permisos Cases READ/DELETE y COQL READ en la conexion y en el usuario.

Argumentos:

| Argumento | Tipo | Uso |
|---|---|---|
| subjectContains | String | Fragmento literal del asunto |
| dryRun | Boolean | true: consultar; false: borrar |

1. Filtra CRM por **Subject contiene** el texto elegido, con el mismo usuario y sin otros filtros (propietario, estado o vista).
2. Ejecuta con `subjectContains = "texto a buscar"`, `dryRun = true`.
3. Comprueba `matchedCount` y `sample` (hasta 50 asuntos con IDs). `deleted` debe ser 0. Si `countComplete=false`, el recuento es parcial y `moreMatches=true`.
4. Ejecuta con el mismo texto y `dryRun = false` para borrar las coincidencias recogidas, incluso si el recuento es parcial.

La funcion vuelve a consultar antes de borrar. No exige ni compara un recuento esperado y no bloquea por recuento parcial. No hay bloqueo transaccional durante la ejecucion. Al actualizar una funcion existente en Zoho, elimina tambien el argumento expectedCount de su configuracion.

Recoge hasta 20000 IDs por ejecucion, paginando por ID, y luego elimina en lotes de 100. Los workflows de borrado se desactivan explicitamente (`wf_trigger=false`). Si hay mas de 20000, borra los recogidos e indica `moreMatches=true`; repite con el mismo texto para continuar. `moreMatches` describe el estado al consultar, no un recuento posterior al borrado. No acepta texto vacio, comillas simples, barras inversas, `%`, `_` ni saltos de linea; devuelve error para evitar interpretar texto como consulta o comodines.

En errores devuelve `success=false` y el numero de borrados confirmados (`deleted`). Los lotes anteriores no se revierten. `lastBatchIds` identifica el ultimo lote intentado; ante timeout puede haberse borrado parte aunque no exista confirmacion. Revisa CRM y vuelve a ejecutar dryRun antes de continuar. El limite de tiempo de CRM puede terminar una ejecucion sin resultado; aplica la misma comprobacion. No hay reintentos automaticos.

Referencias: [COQL contiene](https://www.zoho.com/crm/developer/docs/api/v8/Get-Records-through-COQL-Query.html), [paginacion COQL](https://www.zoho.com/crm/developer/docs/api/v8/COQL-Overview.html), [borrado por lotes](https://www.zoho.com/crm/developer/docs/api/v8/delete-records.html).
