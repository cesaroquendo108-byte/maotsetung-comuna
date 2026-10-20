# Censo consolidado de Uroprofin

La consolidación separa cuatro conceptos que el Excel histórico mezclaba:

```text
comunidad
└── zona
    └── vivienda física
        └── familia censal
            └── persona mediante family_memberships
```

La colección operacional existente `residents` se conserva para no romper CLAP. La nueva relación `family_memberships` permite que una persona quede vinculada a una o varias familias solo cuando un operador lo revise explícitamente.

## Importación histórica

El importador `scripts/import-uroprofin-census.mjs` acepta `.xls` y `.xlsx`, lee todas las hojas como zonas y crea una vivienda provisional por familia. La vista previa no escribe nada:

```bash
npm run census:uroprofin -- --file "/ruta/CORPOMIRANDA CENSO UROPROFIN.xls"
```

La importación real exige una clave HMAC estable y una cuenta de servicio de PocketBase:

```bash
npm run census:uroprofin -- \
  --file "/ruta/CORPOMIRANDA CENSO UROPROFIN.xls" \
  --apply --accept-review-queue
```

Requisitos del entorno de servidor:

- `POCKETBASE_URL` o `VITE_POCKETBASE_URL`.
- `UROPROFIN_SERVICE_EMAIL` y `UROPROFIN_SERVICE_PASSWORD`.
- `UROPROFIN_IMPORT_HMAC_KEY`, que no se imprime ni se envía al navegador.

El mismo archivo genera la misma clave técnica y el importador lo detecta por una huella SHA-256, por lo que repetirlo no crea zonas, viviendas, familias, personas ni casos duplicados.

## Revisión

Los casos quedan en `verification_cases` con estado `pending`. La importación nunca decide automáticamente quién vive con quién. Se registran, entre otros:

- diferencias entre `totalDeclared` y `totalReal`;
- cédulas vacías, `S/N` o duplicadas;
- teléfonos compartidos;
- fechas y edades inconsistentes;
- solicitudes de vinculación y solicitudes de nuevo hogar.

La edad histórica se guarda en `ageSource`; `ageCurrent` se calcula desde `birthDate`. El número familiar histórico nunca se reemplaza.

## Viviendas y familias

- Viviendas iniciales: `URP-{ZONA}-{CONSECUTIVO}`, estado `provisional`.
- Una fusión cambia la vivienda origen a `merged`, conserva `mergedInto` y agrega ambos códigos a `historicalCodes`.
- Una separación crea otra familia con el mismo `legacyFamilyNumber` y un `splitSequence`; las personas se mueven mediante `family_memberships` y se conserva el origen.
- Colaboradores pueden revisar y corregir personas, pero las operaciones de fusión y separación requieren administrador.

## Bombonas

`gas_periods` define jornadas como `BOMBONAS-2026-08`. Cada familia puede tener una sola `gas_registration` por período y varias `gas_cylinders`. Si la vivienda sigue provisional, el registro queda en `review` con `pendingLink=true`.

## API protegida

- `POST /api/link-requests`
- `POST /api/admin/link-requests/:id/approve`
- `POST /api/admin/dwellings/:id/merge`
- `POST /api/admin/families/:id/split`
- `POST /api/gas-periods/:id/registrations`
- `GET /api/zones`
- `GET /api/dwellings`
- `GET /api/families/:id`

Las búsquedas de residentes son exactas, limitadas y no devuelven listados. Los datos de cédula y teléfono no se publican; las respuestas de residentes regulares se enmascaran.
