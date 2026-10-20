# Plan de Implementación: Búsqueda de Cédula en Censo Histórico (Lupita)

> **Reglas aplicables:** Zero Emojis Policy, Higiene de RAM 100%, Límite de 12 funciones serverless en Vercel Hobby, Tono institucional de banca de inversión.

**Objetivo:** Agregar una lupita de búsqueda al lado de los campos de cédula de identidad (cónyuge, titular y carga familiar) en el flujo de registro comunal de Uroprofin para consultar la base de datos de respaldo del censo anterior (1.640 registros) y autocompletar de inmediato nombres, apellidos, fecha de nacimiento, sexo, teléfono y dirección, prescindiendo del re-escaneo con IA.

**Arquitectura:**
1. Extracción y empaquetado optimizado del diccionario histórico indexado por cédula normalizada (`api/_historical_census_data.json`, ~480 KB sin comprimir, ~120 KB gzip).
2. Módulo de resolución serverless (`api/_census_lookup.js`) enrutado a través de `api/register.js` mediante reescritura en `vercel.json` (manteniendo intacto el límite de 10 funciones serverless).
3. Conector de repositorio en `src/lib/repository.js`.
4. Botón interactivo de lupa en `src/pages/RegistrationFlow.jsx` para el cónyuge (según captura de pantalla), titular y niños.
5. Fallback dual: búsqueda en memoria O(1) + consulta secundaria a PocketBase en `steam-vps` para registros nuevos.

---

## Tareas de Implementación

### Tarea 1: Extracción del Dataset Histórico de Censo
- **Archivos:**
  - Crear: `api/_historical_census_data.json`
  - Crear: `scripts/census-lookup.test.mjs`
- **Criterio de Aceptación:**
  - 1.451 cédulas válidas indexadas por dígitos puros.
  - Test unitario validando búsqueda de Rosa Acosta (`11165218`), Jesús Oquendo (`6218460`), Arianna Oquendo (`30057792`) y César Oquendo (`30821164`).

### Tarea 2: Módulo Serverless y Enrutamiento en API
- **Archivos:**
  - Crear: `api/_census_lookup.js`
  - Modificar: `api/register.js`
  - Modificar: `vercel.json`
- **Criterio de Aceptación:**
  - Manejo de `/api/register/census-lookup?idNumber=11165218`.
  - Cero funciones serverless adicionales creadas (se mantiene bajo 12).
  - Respuestas en menos de 5ms.

### Tarea 3: Conector en Frontend Repository
- **Archivos:**
  - Modificar: `src/lib/repository.js`
- **Criterio de Aceptación:**
  - Función `lookupCensusRecord(idNumber, nationality)` implementada con normalización de caracteres.

### Tarea 4: Componentes de Búsqueda (Lupita) en RegistrationFlow
- **Archivos:**
  - Modificar: `src/pages/RegistrationFlow.jsx`
- **Criterio de Aceptación:**
  - Botón de lupa en sección Cónyuge (Paso 3), con autocompletado de:
    - Nombres
    - Apellidos
    - Teléfono
    - Sexo
    - Fecha de nacimiento
  - Botón de lupa en sección Titular (Paso 1).
  - Botón de lupa en Carga Familiar (Paso 3).
  - Indicador de estado y mensaje informativo sin bloqueo en caso de no coincidencia.

### Tarea 5: Verificación, Repack de APK y Despliegue en Producción
- **Archivos:**
  - Pruebas: `npm test`
  - Build: `npm run build`
  - Repack: `python3 scripts/repack_apk.py`
  - Despliegue: `git commit`, `git push`, `npx vercel --prod`
- **Criterio de Aceptación:**
  - 100% pruebas unitarias pasando.
  - Endpoint en producción respondiendo con datos de Rosa Acosta (`11165218`).
