# Seguridad y privacidad

Uroprofin procesa cédulas, teléfonos, hogares, comprobantes, situación electoral y reportes sensibles. Se aplica minimización, separación por comuna y privilegio mínimo desde el primer despliegue.

## Controles obligatorios

1. Todas las colecciones de dominio filtran por una membresía activa en la misma `community`.
2. Un usuario regular solo consulta su hogar y sus propias operaciones.
3. Un colaborador puede crear y actualizar dentro de su función, pero no eliminar, aprobar cortesías ni validar pagos.
4. Las eliminaciones, cambios de rol, aprobaciones, validaciones y exportaciones generan un `audit_event` inmutable.
5. Comprobantes y adjuntos usan archivos protegidos; las reglas impiden enumerarlos fuera de su contexto.
6. Credenciales administrativas, tokens CNE y secretos de firma solo existen en variables de servidor.
7. Las respuestas de `/api` usan `Cache-Control: no-store`; no se registran cédulas, teléfonos, tokens ni cuerpos completos.
8. La interfaz de demostración se desactiva en producción.

## Reportes sensibles

Los reportes de violencia intrafamiliar, seguridad o riesgo inmediato usan `privacy=restricted`, identidad reservada y acceso administrativo. No aparecen en tableros comunitarios, exportaciones generales, notificaciones amplias ni búsquedas de colaboradores.

La plataforma no reemplaza servicios de emergencia. El procedimiento operativo debe definir a quién escalar, cómo preservar la confidencialidad y cuándo evitar contactar al posible agresor.

## CNE y datos electorales

- Solicitar consentimiento explícito antes de cada consulta.
- Consultar solo cédulas visibles para la membresía activa.
- Guardar estado, fuente, fecha de consulta y fecha de consentimiento; no guardar la respuesta bruta.
- Permitir la escritura del perfil electoral solo a la cuenta técnica con alcance exclusivo `cne`; el navegador únicamente solicita y consulta resultados autorizados.
- “Sin centro”, timeout, HTML inesperado o error del proveedor son `unknown` o `verification_error`, nunca `not_registered`.
- No realizar consultas masivas ni scraping del portal público.

## Retención y respaldo

- Definir por escrito plazos para comprobantes, pagos rechazados, consultas CNE y reportes cerrados.
- Mantener respaldos cifrados del directorio de datos de PocketBase y probar su restauración.
- Restringir los respaldos a operadores designados y conservar registro de descargas.
- Cuando un hogar salga de la comuna, desactivar antes de borrar; una eliminación definitiva requiere revisión legal y auditoría.
- Las exportaciones de trabajo deben quedar fuera de Git y eliminarse cuando termine la conciliación.

## Lista previa a producción

- [ ] Reglas de cada colección probadas con los tres roles y entre dos comunas distintas.
- [ ] Google OAuth limitado a los dominios y URI de redirección correctos.
- [ ] HTTPS activo en Vercel y PocketBase.
- [ ] Acceso administrativo de PocketBase restringido y con credenciales únicas.
- [ ] Rate limits y límites de tamaño para archivos y formularios.
- [ ] Restauración de respaldo ensayada.
- [ ] Procedimiento de incidentes y canal sensible aprobado por la junta.
- [ ] Revisión de privacidad y base legal antes de activar CNE.
