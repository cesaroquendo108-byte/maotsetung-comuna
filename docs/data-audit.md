# Auditoría de los Excel recibidos

Fecha de inspección: 21 de julio de 2026. Este documento contiene únicamente agregados; no incluye nombres, cédulas, teléfonos, referencias bancarias ni filas copiadas.

## Censo 2023

Libro inspeccionado: `CENSO PROTEINA1 UROPROFIN 2023.xlsx`.

### Estructura observada

| Hoja/bloque | Agregado |
|---|---:|
| `CENSO TOTAL` | 561 filas usadas × 21 columnas; 550 filas con algún contenido |
| Tabla principal | 380 registros candidatos |
| Cédulas en tabla principal | 369 informadas; 367 únicas; 2 filas duplicadas por cédula |
| Teléfono principal / alterno | 189 / 170 valores informados |
| Bloques familiares repetidos | 3 secciones, 87 filas con persona identificable |
| Residuos sin persona identificable | 17 filas con una celda de edad aislada; no se importan como residentes |
| Fechas de nacimiento normalizadas | 85 |
| `Copia de CENSO TOTAL` | 260 filas usadas × 5 columnas; 229 registros candidatos |
| Cédulas en la copia | 224 informadas; 223 únicas; 1 fila duplicada por cédula |
| Teléfonos en la copia | 139 informados |

Los 380 registros de la tabla principal y los 229 de la copia no se deben sumar: hay solapamiento entre ambas hojas. Los indicadores de niñez y adultos mayores se deben recalcular desde fecha de nacimiento después de conciliar las filas dudosas; la cobertura actual es demasiado parcial para presentarlos como totales comunitarios.

### Vista previa del normalizador actual

| Resultado | Cantidad |
|---|---:|
| Hogares propuestos | 220 |
| Residentes únicos normalizados | 533 |
| Residentes con cédula | 511 |
| Residentes sin cédula | 22 |
| Residentes con fecha de nacimiento | 85 |
| Registros principales | 380 |
| Familiares relacionados únicos | 85 |
| Residentes encontrados solo en la copia | 68 |
| Beneficiarios históricos marcados | 229 |
| Incidencias para revisión | 209 |

Desglose de incidencias: 2 duplicados de residente, 52 registros con una sola parte del nombre, 68 residentes presentes solo en la copia y 87 familiares cuyo jefe de hogar no pudo vincularse automáticamente. Los datos incompletos se conservan sin inventar nombres o apellidos y quedan en revisión. Los 220 hogares son una propuesta técnica: incluyen hogares provisionales y no deben publicarse como cifra oficial antes de la conciliación.

## Pagos CLAP del 20 de julio de 2026

Libro inspeccionado: `clap 20 julio 2026.xlsx`, hoja `Hoja1`.

| Agregado | Resultado |
|---|---:|
| Filas usadas | 110 |
| Filas con contenido, incluido el total | 72 |
| Transacciones válidas | 71 |
| Referencias distintas | 71 |
| Transacciones con nombre del pagador | 53 |
| Importe agregado | Bs. 193.700 |
| Conciliadas automáticamente | 0 |

La hoja no tiene encabezado formal. Se observaron 33 pagos de Bs. 800, 21 de Bs. 1.600 y 17 por otros importes entre Bs. 1.800 y Bs. 46.400. Los múltiplos altos son compatibles con pagos agrupados, por lo que un pago no debe equivaler forzosamente a una sola bolsa ni a un solo hogar.

## Decisiones derivadas

- No unir por nombre: es incompleto y puede identificar a la persona equivocada.
- Conservar toda transacción histórica como `unmatched` hasta revisión humana.
- Requerir fecha de nacimiento para indicadores por edad y mostrar siempre cobertura.
- Marcar hogares y residentes provisionales con estado `review`.
- Mantener procedencia por archivo, hoja y fila en el área privada de importación, pero nunca mostrarla en tableros públicos.
