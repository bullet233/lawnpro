import { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleMap, Polygon } from '@react-google-maps/api';
import { Check, Square, Map as MapIcon } from 'lucide-react';

const containerStyle = {
  width: '100%',
  height: '400px',
  borderRadius: 'var(--radius-md)',
  marginTop: '1rem'
};

const defaultCenter = { lat: 39.8283, lng: -98.5795 }; // US Center, should ideally be user's location

export default function GeofenceEditor({ initialPolygon, onSave, address }) {
  const [polygonPath, setPolygonPath] = useState(initialPolygon || []);
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const mapRef = useRef(null);
  const polygonRef = useRef(null);

  const onMapLoad = useCallback((map) => {
    mapRef.current = map;
    if (polygonPath && polygonPath.length > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      polygonPath.forEach(coord => bounds.extend(coord));
      map.fitBounds(bounds);
    } else {
      // Try to get user location
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setMapCenter(loc);
          map.panTo(loc);
          map.setZoom(18);
        });
      }
    }
  }, [initialPolygon]);

  useEffect(() => {
    if (address && mapRef.current && (!polygonPath || polygonPath.length === 0)) {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK' && results[0]) {
          const loc = results[0].geometry.location;
          mapRef.current.panTo(loc);
          mapRef.current.setZoom(19);
          
          // Auto-place boundary
          const lat = loc.lat();
          const lng = loc.lng();
          const offsetLat = 0.0002;
          const offsetLng = 0.0002;
          const square = [
            { lat: lat + offsetLat, lng: lng - offsetLng }, // NW
            { lat: lat + offsetLat, lng: lng + offsetLng }, // NE
            { lat: lat - offsetLat, lng: lng + offsetLng }, // SE
            { lat: lat - offsetLat, lng: lng - offsetLng }  // SW
          ];
          setPolygonPath(square);
          onSave(square);
        }
      });
    }
  }, [address, polygonPath]);

  const drawSquare = () => {
    if (!mapRef.current) return;
    const center = mapRef.current.getCenter();
    const lat = center.lat();
    const lng = center.lng();
    
    // Create a rough 50m x 50m square around center (approximate offset)
    const offsetLat = 0.0002;
    const offsetLng = 0.0002;

    const square = [
      { lat: lat + offsetLat, lng: lng - offsetLng }, // NW
      { lat: lat + offsetLat, lng: lng + offsetLng }, // NE
      { lat: lat - offsetLat, lng: lng + offsetLng }, // SE
      { lat: lat - offsetLat, lng: lng - offsetLng }  // SW
    ];
    setPolygonPath(square);
  };

  const handleSave = () => {
    if (polygonRef.current) {
      const path = polygonRef.current.getPath();
      const newPath = [];
      for (let i = 0; i < path.getLength(); i++) {
        const pt = path.getAt(i);
        newPath.push({ lat: pt.lat(), lng: pt.lng() });
      }
      onSave(newPath);
    } else {
      onSave(polygonPath);
    }
  };

  return (
    <div style={{ padding: '1rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginTop: '1rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MapIcon size={18} /> Geofence Boundary
          </h4>
        </div>
        
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
          Navigate to the property. Click "Add Square", then drag the corners to fit the property lines.
        </p>

        <GoogleMap
          mapContainerStyle={containerStyle}
          center={mapCenter}
          zoom={4}
          onLoad={onMapLoad}
          options={{ mapTypeId: 'satellite', disableDefaultUI: false }}
        >
          {polygonPath.length > 0 && (
            <Polygon
              path={polygonPath}
              editable={true}
              draggable={true}
              onLoad={(p) => { polygonRef.current = p; }}
              options={{
                fillColor: 'var(--color-primary)',
                fillOpacity: 0.4,
                strokeColor: 'var(--color-primary-hover)',
                strokeOpacity: 1,
                strokeWeight: 2,
              }}
            />
          )}
        </GoogleMap>

        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
          <button className="btn btn-secondary" onClick={drawSquare} style={{ flex: 1 }}>
            <Square size={18} /> Add Square
          </button>
          <button className="btn btn-secondary" onClick={handleSave} style={{ flex: 1 }}>
            <Check size={18} /> Update Boundary
          </button>
        </div>
      </div>
    </div>
  );
}
