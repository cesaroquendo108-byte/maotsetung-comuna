# Mapa comunitario

## Ancla inicial

- Coordenadas suministradas: `10.459537, -66.798778`.
- Etiqueta: Calle Principal Mirador del Este, Caracas 1073.
- Una consulta puntual de geocodificación inversa en OpenStreetMap ubicó el punto en el sector Carpintero, Parroquia Petare, Municipio Sucre, Miranda.
- Esta coordenada representa el inicio/ancla de la comuna, no su perímetro legal ni operativo.

Para dibujar límites reales se requieren varios vértices revisados por la comunidad o un polígono oficial. El `boundingbox` devuelto por un geocodificador describe la vía encontrada y no debe reutilizarse como frontera de Uroprofin.

## Proveedor

La primera versión usa Leaflet con cartografía de OpenStreetMap y atribución visible. No necesita una clave de Google. Los tiles públicos solo son apropiados para tráfico moderado y no se usarán para descargas masivas, modo offline o análisis automatizado. Al escalar a varias comunas se deberá contratar un proveedor de tiles con SLA o desplegar infraestructura propia.

Fuentes: [Leaflet](https://leafletjs.com/examples/quick-start/), [política de tiles de OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/) y [política de Nominatim](https://operations.osmfoundation.org/policies/nominatim/).

## Privacidad

- Mostrar cantidades agregadas por sector y categoría.
- No publicar coordenadas de hogares, residentes, recolectores o comprobantes.
- No ubicar denuncias de seguridad o violencia intrafamiliar en el mapa comunitario.
- Redondear o agrupar puntos operativos cuando una ubicación exacta pueda identificar a una persona.
- Mantener el mapa desacoplado: una falla del proveedor no puede bloquear censo, pagos o entregas.

## Evolución

Con un polígono validado se podrán incorporar sectores, punto de entrega CLAP, rutas de traslado, averías agregadas, infraestructura y centros de votación agregados. Los centros y votantes nunca deben representarse como pines individuales asociados a una identidad.
