# Despliegue: Vercel + PocketBase separado

## Estado efectivo al 2026-07-22

- La demo pública está disponible en [https://uroprofin.vercel.app](https://uroprofin.vercel.app), con `VITE_DEMO_MODE=true` y datos ficticios.
- El backend aislado de Uroprofin responde en [https://pb-uroprofin.157.173.104.214.nip.io](https://pb-uroprofin.157.173.104.214.nip.io). Su base contiene el censo y los pagos históricos reales; el acceso queda restringido por membresía, comuna y rol.
- Arocha continúa en su servicio e instancia independientes, sin cambios provocados por este despliegue.
- Google OAuth y `CNE_PROVIDER_URL` permanecen deshabilitados. La autenticación Google y la consulta real del CNE no forman parte todavía de la demo operativa.
- La carga real se completó el 22 de julio de 2026 después de una restauración aislada satisfactoria. Hay 209 incidencias aceptadas de forma controlada en la cola de revisión y 71 pagos sin asignación automática.
- La repetición idempotente terminó sin duplicados: 220 hogares, 533 residentes y 71 pagos. El respaldo final externo `post_idempotent_import_20260722_135845.zip` pesa 1.248.478 bytes y su SHA-256 es `1A21693B483CDD350761B736EE8042F66762D9B0DA507E4C5ED2E54C5B125B50`; el archivo no pertenece al repositorio.
- CORS está limitado al alias final de producción, Capacitor y desarrollo local. Los dominios variables de Preview de Vercel quedan bloqueados intencionalmente contra PocketBase de producción; un preview que necesite backend debe usar una instancia de ensayo y un origen agregado explícitamente.

La frontera de identidad del CNE exige una membresía aprobada vinculada al residente exacto mediante `membership.resident`. Las credenciales técnicas de alcance `cne` no pueden listar residentes ni consultar a otra persona del hogar.

Pagos y retiros conservan las siguientes invariantes en el backend:

- un pago verificado es inmutable;
- solo administración o el servicio de pagos puede crear asignaciones;
- toda asignación debe corresponder al hogar, ciclo, moneda y pago verificado correctos, sin sobreasignación ni reutilización;
- cada retiro valida la identidad del recolector, sus autorizaciones y el lote/ciclo correspondiente;
- una persona puede trasladar como máximo 17 bolsas y no puede consumir dos veces la misma asignación;
- una cuenta técnica deshabilitada no puede operar aunque conserve un token anterior.

## Topología recomendada

- Vercel: aplicación estática y funciones `/api`.
- VPS: instancia exclusiva de PocketBase para Uroprofin, detrás de HTTPS.
- Dominio independiente para PocketBase.
- Directorio de datos, usuario del sistema, puerto interno, respaldos y credenciales separados de Arocha/Alacena.

No se debe actualizar ni reutilizar una instancia compartida para este proyecto. PocketBase guarda su operación en SQLite; PostgreSQL no es necesario en el MVP.

## 1. Preparar PocketBase en el VPS

La infraestructura incluida fija PocketBase `0.39.8`, el servicio independiente `uroprofin-pocketbase.service`, el directorio `/opt/uroprofin/pocketbase`, el puerto privado `172.17.0.1:8093` y el dominio `pb-uroprofin.157.173.104.214.nip.io`. No modifica la instancia existente de Arocha.

1. Crear usuario de servicio y directorios exclusivos de aplicación, datos y respaldos.
2. Instalar una versión de PocketBase probada en ensayo y fijarla en la documentación operativa.
3. Ejecutar migraciones o `npm run pb:setup` desde un host administrativo autorizado.
4. Ejecutar PocketBase como servicio no privilegiado y reiniciable.
5. Exponer solo el proxy HTTPS; mantener el puerto de PocketBase accesible desde localhost/red privada.
6. Configurar límites de subida, archivos protegidos y reglas de colección.
7. Crear superusuario distinto al de cualquier otro proyecto y una cuenta de servicio para importaciones.
8. Programar respaldo cifrado del directorio de datos/archivos y probar restauración.

Antes de cargar datos reales, ejecutar pruebas de aislamiento entre dos comunas y los tres roles.

## 2. Configurar Google OAuth

1. Crear credenciales OAuth exclusivas de Uroprofin.
2. Activar Google en la configuración de autenticación de la colección `users`.
3. Registrar en Google la URI de redirección exacta mostrada por PocketBase.
4. Añadir dominios de Vercel/producción autorizados y verificar login, cierre de sesión y renovación.

No reutilizar secretos OAuth de otro producto.

Para esta instancia, la URI exacta es `https://pb-uroprofin.157.173.104.214.nip.io/api/oauth2-redirect`.

## 3. Variables por entorno

| Variable | Destino | Uso |
|---|---|---|
| `VITE_POCKETBASE_URL` | Build de Vercel/cliente | URL pública de PocketBase; no es secreto |
| `VITE_API_BASE` | Build de Vercel/cliente | Base opcional de funciones |
| `VITE_DEMO_MODE` | Build de Vercel/cliente | `true` solo para la demo pública sin PII; debe ser `false` en el entorno operativo real |
| `POCKETBASE_URL` | Funciones Vercel y tareas admin | URL de PocketBase |
| `POCKETBASE_SUPERUSER_EMAIL` / `POCKETBASE_SUPERUSER_PASSWORD` | Solo tarea de esquema autorizada | No mantener en runtime si no se necesitan |
| `UROPROFIN_SERVICE_EMAIL` / `UROPROFIN_SERVICE_PASSWORD` | Solo proceso de importación | Cuenta técnica exclusiva con alcance `import` |
| `UROPROFIN_PAYMENTS_EMAIL` / `UROPROFIN_PAYMENTS_PASSWORD` | Backops futuro | Cuenta técnica exclusiva con alcance `payments` |
| `UROPROFIN_CNE_EMAIL` / `UROPROFIN_CNE_PASSWORD` | Función CNE | Cuenta técnica exclusiva con alcance `cne` |
| `UROPROFIN_IMPORT_HMAC_KEY` | Solo importador autorizado | Genera claves técnicas estables sin exponer cédulas |
| `CNE_PROVIDER_URL` / `CNE_PROVIDER_TOKEN` | Funciones Vercel | Dejar sin configurar hasta autorización |
| `PAYMENT_VALIDATOR_URL` / `PAYMENT_VALIDATOR_SECRET` | Integración futura | Dejar sin configurar hasta implementar contrato |
| `APP_ALLOWED_ORIGINS` | Funciones Vercel | Orígenes nativos adicionales permitidos, separados por coma |

Los valores se cargan en el almacén de secretos correspondiente; nunca se pegan en documentación, commits o salidas de CI.

## 4. Desplegar en Vercel

1. Conectar el repositorio privado.
2. Configurar las variables separadas para Preview y Production.
3. Usar `npm run build` y directorio de salida `dist` (ya declarados en `vercel.json`).
4. Verificar primero un Preview con PocketBase de ensayo.
5. Promover a producción después de completar la lista de seguridad.

El alias público actual es una demo, no una autorización para conectar PII. Los previews no deben apuntar al PocketBase de producción porque sus orígenes están fuera de la lista CORS deliberadamente restringida.

Comprobación local/CI:

```powershell
npm ci
npm test
npm run build
```

Comprobación posterior:

- `/api/health` responde sin revelar secretos.
- La SPA puede recargar rutas internas.
- Login Google funciona desde el dominio final.
- Un regular no puede consultar otro hogar ni otra comuna.
- Un colaborador no puede borrar ni validar pagos.
- CNE responde `CNE_PROVIDER_DISABLED` mientras esté cerrado.
- Los adjuntos privados no abren sin una sesión autorizada.

## 5. Carga inicial y rollback

Importar primero en ensayo según [el procedimiento](importing.md). La carga inicial de producción ya cuenta con respaldo anterior y posterior, copia externa, hash SHA-256 y una restauración aislada verificada. Las 209 incidencias siguen requiriendo decisiones documentadas en la cola de revisión. Antes de toda carga posterior se debe repetir el mismo control. Si falla el frontend, Vercel permite volver al despliegue anterior; si falla el esquema o la importación, detener escrituras y restaurar el snapshot completo en una instancia de recuperación antes de reemplazar producción.

Registrar fecha, versión de aplicación, versión de PocketBase, lote de importación y responsable de cada despliegue.
