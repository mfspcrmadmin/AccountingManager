# Vincular cuentas beneficiarias separadas

`suppliers_fillMissingBeneficiaryAccounts.dg` sustituye la primera version que completaba `Vendors.Account_Number`.

Esta version usa exclusivamente el IBAN de la lista para encontrar una cuenta existente en `Payment_Accounts`, vinculada mediante `Owner_Supplier`. Completa `Vendors.Default_Payment_Account` solo si esta vacio. No escribe en `Account_Number`, no crea cuentas, no cambia IBAN ni titulares, no reactiva cuentas y no modifica pagos, facturas o asignaciones historicas.

## Revision en CRM del 10 de noviembre de 2026

Se encontraron los 44 suppliers sin duplicados. Cuarenta tienen un enlace predeterminado a una cuenta activa de su propiedad y permitida para pagos. Los cuatro restantes ya tienen una cuenta separada activa, con titular e IBAN coincidentes con la tabla:

| Codigo | Supplier ID | Payment Account ID |
| --- | --- | --- |
| LIS192 | 616617000003265605 | 616617000164637011 |
| LUDOVI | 616617000003265881 | 616617000164650032 |
| FEELDO | 616617000029491923 | 616617000165188026 |
| MESAFR | 616617000037771009 | 616617000163229130 |

La funcion vuelve a consultar CRM al ejecutarse; estos datos son una fotografia de revision, no un resultado de ejecucion.

## Uso

Crear una funcion Standalone con el codigo y el argumento booleano `dryRun`.

1. Ejecutar con `dryRun = true` y revisar `details`. Con el estado observado se esperan cuatro `would_link_existing_account`, treinta `skipped_existing_default` y diez `skipped_no_source_iban`.
2. Ejecutar con `dryRun = false` para guardar los enlaces. Cada enlace se relee y verifica.
3. Si aparece `requiresCrmReview`, revisar el supplier indicado antes de repetir. No ejecutar simultaneamente ni mientras otro proceso cambia la cuenta predeterminada: la comprobacion seguida de actualizacion no es una operacion atomica.

Si no existe exactamente una cuenta elegible con el IBAN indicado, el codigo devuelve un error para ese supplier. No crea una cuenta nueva porque la revision real confirma que ya existen todas las cuentas necesarias. Las cuentas inactivas y las cuentas con otros IBAN permanecen intactas.

## Dependencia antigua del widget

El codigo local `payment-create.js` llama a `ensuresupplierpaymentaccount` al preparar un pago. El 10 de noviembre se corrigio y publico esta funcion: ahora solo resuelve cuentas separadas existentes, sin leer `Vendors.Account_Number`, crear cuentas, reactivar cuentas inactivas ni cambiar la configuracion contable. Conserva su firma y los campos de respuesta usados por el widget.

La separacion ya existe en el modelo mediante `Payment_Accounts.Owner_Supplier`, `Status` y las referencias de pagos/asignaciones. La funcion publicada ya no depende del campo antiguo. Aun hay lectores locales que lo muestran; esta correccion no elimina campos ni borra datos antiguos.

## Estado

Codigo local preparado; lista de 44 codigos y 34 IBAN validada localmente. No compilado, publicado ni ejecutado en Zoho. Sin archivos ZIP.
