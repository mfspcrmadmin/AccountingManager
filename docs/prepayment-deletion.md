# Borrado de prepagos

La acción **Delete** está disponible en las dos vistas de prepagos y solicita
confirmación. Antes de modificar registros consulta CRM y bloquea el borrado si
hay un lookup de factura o pago, cualquier `Prepayment_Invoice_Allocations`, un
estado `Prepayment recorded` o una operación de registro pendiente de verificar.
Un error al consultar relaciones también bloquea la operación.

Si quedan otros prepagos, conserva la solicitud y sus relaciones con servicios,
y recalcula sus estados excluyendo el prepago eliminado. Si se elimina el último,
borra también los registros `Prepayment_Request_Services` y la solicitud vacía.
Los servicios compartidos conservan el estado calculado por sus otras solicitudes.
Sin solicitudes activas, los estados derivados del prepago vuelven a `To Be Paid`,
o a `Fully Paid` / `Partially Paid` si `Total_Paid` acredita pagos existentes.
Los estados ajenos a este flujo se conservan. No existe una instantánea del estado
histórico previo: se recalcula con los datos actuales.

El plan se valida antes de escribir y se guarda en localStorage. Si CRM rechaza
un paso, **Delete** permite reanudar desde el último confirmado, incluso tras
recargar. Los prepagos cuyo borrado está incompleto siguen apareciendo para poder
terminar la limpieza. Un resultado incierto se muestra como error; no se declara
éxito sin confirmación de CRM.

Las operaciones del SDK no son una transacción. Se vuelve a comprobar el prepago
antes de borrarlo y se verifica que la solicitud esté vacía antes de eliminarla.
Estas comprobaciones no sustituyen una restricción transaccional en CRM frente a
escrituras simultáneas desde otras sesiones o aplicaciones.
