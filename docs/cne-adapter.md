# Adaptador CNE

La consulta automática está desactivada por diseño hasta contar con un proveedor autorizado, documentado y revisado legalmente. Uroprofin no depende de scraping del portal del CNE ni de servicios privados sin contrato.

## Comportamiento actual

`POST /api/cne/lookup` requiere:

- sesión PocketBase válida mediante `Authorization: Bearer …`;
- membresía activa;
- cédula de un residente visible para esa membresía;
- cuerpo `{ "idNumber": "…", "consent": true, "communityId": "…" }`; `communityId` debe corresponder a la membresía activa seleccionada.

Sin configuración de proveedor responde HTTP 503 con `code=CNE_PROVIDER_DISABLED`. PocketBase conserva los intentos y aplica, por pareja actor+residente, un máximo de cinco por minuto y 25 durante una ventana móvil de 24 horas; el timeout del proveedor es de nueve segundos. La comprobación no es una reserva atómica entre varias réplicas, por lo que un despliegue distribuido deberá moverla a una transacción del servidor o a un contador compartido.

## Evaluación de los proyectos aportados

- `EdwinBetanc0urt/searchVE` y `MegaCreativoTeam/CedulaVE-API` son scrapers del HTML del CNE, no APIs oficiales ni proveedores autorizados.
- Ambos transmiten la cédula en una URL HTTP y dependen de posiciones/textos del HTML. No ofrecen garantías de autenticación, disponibilidad, retención, corrección ni tratamiento de datos.
- `searchVE` no se mantiene desde 2020 y su árbol actual tiene dependencias faltantes. `CedulaVE-API` no se actualiza desde 2022 y mantiene un error abierto para cédulas no inscritas.
- Los dominios usados por esos proyectos no estaban operativos en la verificación del 22 de julio de 2026. Se conservan solo como referencia de campos posibles, nunca como dependencia de producción.
- Las licencias GPL-3.0/MIT cubren su código; no conceden autorización para consultar, almacenar o procesar masivamente los datos retornados.

Fuentes: [searchVE](https://github.com/EdwinBetanc0urt/searchVE), [CedulaVE-API](https://github.com/MegaCreativoTeam/CedulaVE-API) y [error de no inscritos](https://github.com/MegaCreativoTeam/CedulaVE-API/issues/2).

### Evaluación adicional del 23 de julio de 2026

Se revisaron los repositorios propuestos para decidir si enriquecen la base de datos con centro electoral, estado, municipio, parroquia o dirección sin mezclar información de voto individual.

| Repositorio | Qué aporta | Decisión |
| --- | --- | --- |
| `REP98/pyelectoral` | Parser de la consulta pública del CNE con `centro`, `estado`, `municipio`, `parroquia` y `dirección`. | Útil como referencia de parser. No es fuente nueva: usa el mismo endpoint público `ce.php`. |
| `Eitol/cne_scraper` | Consulta el mismo endpoint público del CNE, pero extrae sólo nombre, estado, municipio y parroquia. | No se integra porque aporta menos campos que el adaptador actual. |
| `jeremialcala/api-python-fastapi-electors` | Repositorio sin implementación visible; sólo README/licencia. | Descartado como dependencia. |
| `phenobarbital/cne-evaluacion` | Procesamiento de imágenes de actas y extracción de QR. | Candidato futuro para catálogo/auditoría de actas, no para consulta individual por cédula. |
| `Eitol/verificador_elecciones2024_ve` | Descarga actas 2024 y consulta una URL de acta asociada a una cédula mediante endpoint externo con recaptcha. El sitio vigente `resultadosconvzla.com` expone además `/documento/V...` y CSV públicos de resultados/mesas. | Se integra como fuente auxiliar opcional 2024 para centro/mesa, nunca para inferir participación ni preferencia política. |

Resultado aplicado: el adaptador directo de Uroprofin conserva la consulta CNE protegida y ahora usa una extracción de tablas más tolerante, inspirada en `pyelectoral`/`cne_scraper`, antes de caer al parser de texto plano. Además, puede activar `CNE_2024_RESULTS_FALLBACK=true` para usar `resultadosconvzla-2024` como fuente auxiliar de centro/mesa cuando las fuentes principales no informen centro.

### Fuente auxiliar `resultadosconvzla-2024`

Flujo técnico:

1. Consultar `https://resultadosconvzla.com/documento/V{cedula}` con consentimiento comunitario.
2. Extraer temporalmente la URL de imagen de acta que devuelve la página.
3. Cruzar sólo el nombre del archivo contra `RESULTADOS_2024_CSV_V3.csv` para obtener código de centro y mesa.
4. Cruzar `centro+mesa` contra `TablaMesaEleccionPresidencial2024.csv` para obtener nombre de centro, estado, municipio y parroquia.
5. Guardar en PocketBase únicamente centro, ubicación administrativa, fuente y referencia técnica `centerCode=...;mesa=...`.

No se guarda la URL de acta, imagen, votos, candidatos, totales de mesa ni ninguna inferencia sobre si la persona votó. La propia página pública aclara que la búsqueda muestra la mesa donde la persona está inscrita, no si ejerció el voto.

Toda credencial compartida por captura o chat debe rotarse antes de usarla. La credencial nueva solo podrá residir en el servidor, nunca en GitHub, el navegador o variables `VITE_*`.

## Respuesta normalizada

```json
{
  "status": "registered | not_registered | unknown | verification_error",
  "registered": true,
  "center": "",
  "address": "",
  "state": "",
  "municipality": "",
  "parish": "",
  "source": "authorized-provider",
  "checkedAt": "ISO-8601"
}
```

`not_registered` solo es válido cuando el proveedor autorizado lo afirma explícitamente. Una respuesta vacía, un centro ausente, HTTP inesperado, timeout o falla de red se normalizan como `unknown` o `verification_error`.

## Requisitos para activarlo

- [ ] Autorización y contrato que permitan este uso y volumen.
- [ ] Especificación estable de API, autenticación, estados, límites y SLA.
- [ ] Evaluación de privacidad, consentimiento, retención y derecho de corrección.
- [ ] Entorno de ensayo con cédulas de prueba autorizadas.
- [ ] Distinción contractual entre “no inscrito” y “no verificable”.
- [ ] Política que prohíba consultas masivas y usos políticos no consentidos.
- [ ] Monitoreo sin registrar cédulas, tokens ni respuestas completas.
- [ ] Plan para interrupción del proveedor sin afectar censo, pagos o entregas.

Una vez aprobado, configurar `CNE_PROVIDER_URL`, `CNE_PROVIDER_TOKEN`, `UROPROFIN_CNE_EMAIL` y `UROPROFIN_CNE_PASSWORD` únicamente en las funciones de Vercel. La cuenta técnica debe tener solo el alcance `cne`. Nunca usar variables `VITE_*` para esos valores.
