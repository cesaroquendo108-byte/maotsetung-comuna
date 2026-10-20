# Importación del censo y pagos

El proceso está diseñado para ser conservador: inspecciona, normaliza, permite revisar y solo escribe cuando se agrega `--apply`.

## 1. Inspeccionar

Para el libro histórico de Uroprofin, cuyas 40 hojas representan zonas, usa el importador consolidado:

```powershell
npm run census:uroprofin -- --file "C:\ruta\CORPOMIRANDA CENSO UROPROFIN.xls"
```

Este comando reconoce `.xls` y `.xlsx`, propaga `N° FAMILIA`, conserva la fila original y calcula agregados de zonas, viviendas provisionales, familias y personas. Consulta [el modelo consolidado](consolidated-census.md) antes de aplicar cambios.

```powershell
npm run census:inspect -- --census "C:\ruta\censo.xlsx" --payments "C:\ruta\pagos.xlsx"
```

La salida contiene solo agregados. Antes de continuar, comparar los conteos con [la auditoría base](data-audit.md) y explicar cualquier diferencia.

## 2. Generar una vista privada

```powershell
npm run census:import -- --census "C:\ruta\censo.xlsx" --payments "C:\ruta\pagos.xlsx"
```

Sin `--apply`, el comando solo muestra agregados: no crea archivos ni escribe en PocketBase. Para una revisión excepcional de las filas normalizadas:

```powershell
npm run census:import -- --census "C:\ruta\censo.xlsx" --payments "C:\ruta\pagos.xlsx" --export-private
```

Esta opción crea un JSON en `imports/`; contiene datos personales y debe eliminarse al finalizar la revisión.

Revisar como mínimo:

- duplicados por cédula;
- residentes sin cédula;
- familiares sin hogar enlazado;
- residentes presentes solo en la copia;
- fechas imposibles o faltantes;
- pagos sin pagador y referencias repetidas;
- hogares provisionales con estado `review`.

## 3. Preparar PocketBase

1. Usar una instancia exclusiva de Uroprofin y un entorno de ensayo.
2. Ejecutar las migraciones o `npm run pb:setup` desde un equipo administrativo autorizado.
3. Crear un usuario de servicio dedicado con permisos de importación; no usar una cuenta personal.
4. Cargar las variables de servidor en el proceso actual mediante un almacén de secretos. No usar prefijo `VITE_` para credenciales.
   `UROPROFIN_IMPORT_HMAC_KEY` debe ser una clave aleatoria estable y distinta por instalación; nunca se rota sin un plan de migración de claves externas.
5. Respaldar el directorio de datos y archivos de PocketBase.

## 4. Aplicar en ensayo

```powershell
npm run census:import -- --census "C:\ruta\censo.xlsx" --payments "C:\ruta\pagos.xlsx" --apply --accept-review-queue
```

Sin `--accept-review-queue`, el importador aborta ante las 209 incidencias actuales. La bandera no las resuelve: solo confirma que se cargarán con estado de revisión.

El importador crea un `import_batch`, hace *upsert* por `externalKey`, asigna la procedencia del lote y deja los pagos en `payment_import_staging` con estado `unmatched`. Si falla, el lote queda marcado como `failed`; hay que revisar qué registros alcanzaron a escribirse antes de reintentar.

## 5. Validar y promover

- Repetir conteos desde PocketBase por comuna y estado.
- Confirmar que una segunda ejecución no duplica hogares, residentes ni pagos.
- Probar acceso con admin, colaborador y regular de dos comunas distintas.
- Conciliar manualmente una muestra de pagos sin usar coincidencia por nombre como evidencia única.
- Documentar correcciones y conservar el identificador del lote.
- Solo después repetir contra producción con un respaldo reciente.

## Reglas de manejo

- No adjuntar la salida normalizada a issues, commits, chats o correos.
- No editar los Excel originales; trabajar sobre una copia controlada.
- No importar filas de total como transacciones.
- No convertir cédulas o teléfonos a números que pierdan formato.
- No calcular edad cero cuando falta la fecha de nacimiento.
- No borrar automáticamente duplicados: registrar la incidencia y resolverla con un operador.
