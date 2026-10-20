# PocketBase de Uroprofin

Esta carpeta describe una instancia **dedicada** de PocketBase para Uroprofin. No debe instalarse sobre la instancia compartida por Arocha/Alacena ni reutilizar sus colecciones: las reglas, los hooks y el ciclo de actualización son independientes.

La migración fue validada con PocketBase `0.39.8`. Antes de actualizar el binario en producción, se debe ejecutar la migración y las pruebas de acceso en staging con exactamente la versión candidata.

## Estructura

- `pb_migrations/1784678400_initial_uroprofin_schema.js`: esquema normalizado, índices y reglas por comuna.
- `pb_migrations/1784742600_allow_legacy_partial_names.js`: permite conservar nombres históricos incompletos sin inventar datos; el hook exige al menos una parte y el importador los deja en revisión.
- `pb_hooks/uroprofin.pb.js`: invariantes de tenant, normalización, límite de retiros, protección de reportes, cuota CNE y auditoría.
- `pb_hooks/lib/uroprofin.js`: helpers CommonJS cargados dentro del runtime aislado de cada hook.
- `tests/runtime-smoke.mjs`: prueba de integración de roles e invariantes contra un PocketBase real.
- `pb_data/`: datos y ficheros locales. Está ignorado por Git y debe respaldarse fuera del repositorio.

## Arranque seguro

Desde esta carpeta, con el binario oficial de PocketBase:

```powershell
.\pocketbase.exe migrate up --dir .\pb_data --migrationsDir .\pb_migrations --hooksDir .\pb_hooks
.\pocketbase.exe serve --dir .\pb_data --migrationsDir .\pb_migrations --hooksDir .\pb_hooks
```

El primer superusuario se crea por el instalador de PocketBase o con `pocketbase superuser create`. No se incluyen correos, contraseñas, tokens ni secretos de OAuth en la migración.

Google OAuth se configura en Dashboard → Collections → `users` → OAuth2. La migración permite el alta automática solo en contexto OAuth; las cuentas con contraseña (incluidas las de servicio) las crea un superusuario.

## Autorización

Los roles viven en `community_memberships`, no en `users`, y siempre están ligados a una `community`:

- `admin`: gestión completa de su comuna, incluida eliminación y cortesías.
- `collaborator`: consulta operativa, alta y corrección; nunca elimina, da de baja residentes ni aprueba cortesías.
- `regular`: ve su hogar, informa pagos/entregas, responde encuestas y crea reportes.

Una cuenta puede tener membresías distintas en varias comunas. Las relaciones entre hogar, ciclo, residente, encuesta, entrega y reporte se vuelven a validar en hooks; una API rule mal usada no puede mover datos entre comunas.

Las cuentas técnicas usan `users.serviceAccount = true` y un único valor en `users.serviceScopes`: `import`, `payments` o `cne`. Solo un superusuario puede cambiar esos campos. Debe usarse una cuenta distinta por integración y guardar su credencial solo en el servidor.

## Contratos importantes

### CNE

`electoral_profiles` usa exactamente estos campos:

- `community`, `resident`
- `status`: `unknown`, `registered`, `not_registered` o `verification_error`
- `votingCenterName`, `votingCenterAddress`
- `source`, `checkedAt`, `consentAt`, `checkedBy`
- `providerReference`, `errorCode` (ocultos al cliente)

El residente puede consultar el perfil de una persona de su hogar, pero no crearlo ni editarlo. El endpoint valida primero residente, hogar, comuna y consentimiento; solo una cuenta técnica con alcance exclusivo `cne` puede escribir el resultado. Así, el estado y el centro no pueden falsificarse desde el navegador.

`cne_query_attempts` registra `community`, `resident`, `actor`, `consentAt`, `status`, `provider`, `requestKey`, `errorCode` y `completedAt`. El usuario puede crear un intento para una persona de su hogar, pero no listar intentos; solo administración y el servicio CNE pueden leerlos. El hook aplica 5 intentos por minuto y 25 por ventana móvil de 24 horas para la pareja actor+residente.

La cuota del hook es una defensa de aplicación, no un contador distribuido estrictamente atómico. Si se ejecutan varias réplicas o se necesita garantía dura bajo concurrencia, se debe exponer una ruta personalizada de PocketBase que reserve el intento dentro de `app.runInTransaction`; el endpoint de Vercel no debe depender solo de memoria local.

### Encuesta de gas

`survey_responses` acepta el contrato actual sin almacenar pagos: `community`, `household`, `campaign` opcional, `surveyKey`, `createdBy`, `requestKey` y `data` JSON. `surveyKey = "gas-demand"` es válido. El JSON puede conservar proveedor, intención, cantidad/tamaño de bombonas y notas.

Solo existe una respuesta por hogar, encuesta y campaña. El residente puede corregir esa misma respuesta; un segundo registro paralelo queda bloqueado por índice único.

### Idempotencia

Los siguientes registros aceptan `requestKey` opcional, normalizado y con índice único parcial:

- `payment_reports`: actor + hogar + ciclo + clave.
- `delivery_self_reports`: actor + hogar + ciclo + clave.
- `pickup_authorizations`: actor + hogar + ciclo + clave.
- `survey_responses`: actor + hogar + encuesta + clave.
- `cne_query_attempts`: actor + clave.

El cliente debe generar una clave estable por envío y reutilizarla al reintentar. Una clave vacía conserva compatibilidad con importaciones antiguas, pero no ofrece deduplicación.

### Retiros, cortesías y reportes sensibles

- `pickup_batches` + `pickup_lines` representa el retiro físico. Los hooks impiden superar 17 bolsas y exigen que, al verificar o entregar, las líneas sumen la cantidad declarada.
- Una asignación `bag_allocations.allocationType = "courtesy"` exige administrador activo, `approvedBy` y `courtesyReason`; su alta/cambio/eliminación queda en `audit_events`.
- `community_reports.category = "Violencia intrafamiliar"` fuerza `privacy = "restricted"`, prioridad urgente e `identityReserved = true`. Solo el creador y administradores de la misma comuna pueden abrirlo; colaboradores no.
- `receipt`, evidencias y adjuntos son campos PocketBase `protected`; los comprobantes admiten hasta 8 MiB. Solo se descargan mediante token corto si también se cumple la View Rule del registro.

## Operación

Antes de cada despliegue:

1. Crear un backup consistente de `pb_data` y comprobar su restauración.
2. Ejecutar `migrate up` en staging con una copia anonimizada o vacía.
3. Probar al menos admin, collaborator, regular y cada cuenta de servicio.
4. Reiniciar PocketBase después de una migración manual para recargar el esquema en caché.

PocketBase usa SQLite como fuente de verdad en esta instancia. PostgreSQL puede incorporarse después como réplica analítica o destino de migración, pero no debe operar en paralelo como segunda fuente de escritura.
