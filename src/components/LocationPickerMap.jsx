import { useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const COUNCIL_CENTER = [10.4940, -66.9048];

function MapClickHandler({ onSelect }) {
  useMapEvents({
    click(e) {
      onSelect(
        Math.round(e.latlng.lat * 1000000) / 1000000,
        Math.round(e.latlng.lng * 1000000) / 1000000
      );
    },
  });
  return null;
}

export default function LocationPickerMap({ lat, lng, onSelectLocation }) {
  const [gpsLoading, setGpsLoading] = useState(false);
  const currentPos = lat && lng ? [lat, lng] : COUNCIL_CENTER;

  const handleGpsClick = () => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onSelectLocation(
          Math.round(pos.coords.latitude * 1000000) / 1000000,
          Math.round(pos.coords.longitude * 1000000) / 1000000
        );
        setGpsLoading(false);
      },
      () => {
        onSelectLocation(10.4940, -66.9048);
        setGpsLoading(false);
      }
    );
  };

  return (
    <div className="location-picker-shell">
      <div className="location-picker-header">
        <small className="location-picker-instruction">
          <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>touch_app</span>
          Toca o haz clic en el mapa para colocar el pin:
        </small>
        <button
          type="button"
          className="text-button location-gps-button"
          onClick={handleGpsClick}
          disabled={gpsLoading}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>my_location</span>
          {gpsLoading ? 'Obteniendo...' : 'Usar mi GPS'}
        </button>
      </div>

      <div className="location-picker-map-frame">
        <MapContainer center={currentPos} zoom={17} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapClickHandler onSelect={onSelectLocation} />
          {lat && lng && (
            <CircleMarker
              center={[lat, lng]}
              radius={9}
              pathOptions={{ color: '#FFFFFF', weight: 3, fillColor: '#E23744', fillOpacity: 0.95 }}
            />
          )}
        </MapContainer>
      </div>

      {lat && lng ? (
        <small className="location-coords-badge">
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>location_on</span>
          Pin colocado en: {lat}, {lng}
        </small>
      ) : (
        <small className="location-coords-badge warning">
          Sin pin asignado todavía. Toca el mapa para colocarlo.
        </small>
      )}
    </div>
  );
}
