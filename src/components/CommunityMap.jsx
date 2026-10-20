import { useState } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { COMMUNITY_CONFIG } from '../config/community.js';

const COUNCIL_START = [10.4965, -66.9065];
const COUNCIL_END = [10.4915, -66.9030];
const COUNCIL_CENTER = [
  (COUNCIL_START[0] + COUNCIL_END[0]) / 2,
  (COUNCIL_START[1] + COUNCIL_END[1]) / 2,
];

export default function CommunityMap({ water = 0, electricity = 0, gas = 0, total = 0, incidents = [] }) {
  const [tileError, setTileError] = useState(false);
  const aggregates = [
    { id: 'water', label: 'Agua', value: water, tone: 'water' },
    { id: 'electricity', label: 'Luz', value: electricity, tone: 'electricity' },
    { id: 'gas', label: 'Gas', value: gas, tone: 'gas' },
  ];

  const geolocated = (incidents || []).map((item, idx) => {
    let lat = item.lat;
    let lng = item.lng;
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      const step = 0.2 + ((idx % 4) * 0.2);
      lat = COUNCIL_START[0] + (COUNCIL_END[0] - COUNCIL_START[0]) * step + ((idx % 2 === 0 ? 1 : -1) * 0.0002);
      lng = COUNCIL_START[1] + (COUNCIL_END[1] - COUNCIL_START[1]) * step + ((idx % 3 === 0 ? 1 : -1) * 0.0002);
    } else {
      lat = Number(lat);
      lng = Number(lng);
    }
    return { ...item, lat, lng };
  });

  const getCategoryColor = (cat) => {
    if (cat === 'Agua') return '#2F9BC4';
    if (cat === 'Luz') return '#F2A900';
    if (cat === 'Gas') return '#E23744';
    return '#6B6470';
  };

  return (
    <div className="community-map-shell" aria-label={`Mapa agregado de la ${COMMUNITY_CONFIG.name}`}>
      <MapContainer center={COUNCIL_CENTER} zoom={17} scrollWheelZoom={false} zoomControl={false} attributionControl>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{ tileerror: () => setTileError(true), tileload: () => setTileError(false) }}
        />
        <ZoomControl position="bottomright" />
        <Polyline positions={[COUNCIL_START, COUNCIL_END]} pathOptions={{ color: '#E23744', weight: 4, opacity: 0.85, dashArray: '8 8' }} />

        <CircleMarker center={COUNCIL_START} radius={8} pathOptions={{ color: '#FFFFFF', weight: 3, fillColor: '#E23744', fillOpacity: 1 }}>
          <Tooltip permanent direction="top" offset={[0, -8]} className="entrance-tooltip">Inicio del consejo</Tooltip>
        </CircleMarker>
        <CircleMarker center={COUNCIL_END} radius={7} pathOptions={{ color: '#FFFFFF', weight: 3, fillColor: '#2F9BC4', fillOpacity: 1 }}>
          <Tooltip permanent direction="bottom" offset={[0, 10]} className="entrance-tooltip">Límite de referencia</Tooltip>
        </CircleMarker>

        {geolocated.map((item) => (
          <CircleMarker
            key={item.id}
            center={[item.lat, item.lng]}
            radius={10}
            pathOptions={{ color: '#FFFFFF', weight: 3, fillColor: getCategoryColor(item.category), fillOpacity: 0.95 }}
          >
            <Tooltip permanent direction="top" offset={[0, -10]}>{item.category}: {item.title}</Tooltip>
            <Popup>
              <div style={{ fontSize: '12px', lineHeight: '1.45', padding: '2px' }}>
                <strong style={{ color: getCategoryColor(item.category), fontSize: '13px' }}>{item.category}: {item.title}</strong><br />
                <span>Sector/Calle: {item.zone || 'Sin especificar'}</span><br />
                <small style={{ color: '#666' }}>Estado: {item.status || 'Reportado'}</small>
              </div>
            </Popup>
          </CircleMarker>
        ))}

      </MapContainer>

      {tileError && (
        <div className="map-fallback" role="status">
          <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '15px' }}>error</span>
          <p><strong>El mapa base no está disponible.</strong><small>Referencia de la comuna: 10.4965, -66.9065 hasta 10.4915, -66.9030. Los datos agregados siguen visibles en la leyenda.</small></p>
        </div>
      )}

      {!tileError && (
        <div className="map-location">
          <span>{COMMUNITY_CONFIG.name}</span>
          <strong>Parroquia {COMMUNITY_CONFIG.parish}</strong>
          <small>Caracas {COMMUNITY_CONFIG.postalCode} · {COMMUNITY_CONFIG.municipality}</small>
        </div>
      )}

      <div className="map-legend" aria-label="Resumen de incidencias agregadas">
        <strong>Conteos · {total} total ({geolocated.length} geolocalizados)</strong>
        {aggregates.map((item) => <span key={item.id}><i className={`legend-dot legend-dot--${item.tone}`} />{item.label}: {item.value}</span>)}
      </div>
      <ul className="sr-only">
        {aggregates.map((item) => <li key={item.id}>{item.label}: {item.value} reportes agregados</li>)}
      </ul>
    </div>
  );
}
