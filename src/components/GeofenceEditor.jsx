import { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleMap, Polygon } from '@react-google-maps/api';
import { useMapStatus } from '../components/MapProvider';
import { Square, Trash2, Map as MapIcon, WifiOff } from 'lucide-react';
import { trackApiCall } from '../utils/apiTracker';

const containerStyle = {
  width: '100%',
  height: '65vh',
  minHeight: '450px',
  maxHeight: '800px',
  borderBottomLeftRadius: 'var(--radius-md)',
  borderBottomRightRadius: 'var(--radius-md)'
};

const defaultCenter = { lat: 39.8283, lng: -98.5795 }; // US Center

export default function GeofenceEditor({ initialPolygon, onSave, address }) {
  const [polygonPath, setPolygonPath] = useState(initialPolygon || []);
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [mapReady, setMapReady] = useState(false);

  const mapRef = useRef(null);
  const polygonRef = useRef(null);
  const hasGeocodedAddress = useRef('');
  const { isLoaded, loadError } = useMapStatus();

  // Auto-sync function
  const handlePolygonChange = useCallback(() => {
    if (polygonRef.current && polygonRef.current.getPath) {
      const path = polygonRef.current.getPath();
      if (!path) return;
      const newPath = [];
      for (let i = 0; i < path.getLength(); i++) {
        const pt = path.getAt(i);
        newPath.push({ lat: pt.lat(), lng: pt.lng() });
      }
      setPolygonPath(newPath);
      onSave(newPath);
    }
  }, [onSave]);

  const onPolygonLoad = useCallback((p) => {
    polygonRef.current = p;
    const path = p.getPath();
    
    // Listen for drag/edit events so it auto-saves immediately without a save button
    const google = window.google;
    if (google && google.maps && path) {
      google.maps.event.addListener(path, 'set_at', handlePolygonChange);
      google.maps.event.addListener(path, 'insert_at', handlePolygonChange);
      google.maps.event.addListener(path, 'remove_at', handlePolygonChange);
    }
  }, [handlePolygonChange]);

  const onMapLoad = useCallback((map) => {
    mapRef.current = map;
    setMapReady(true);
    if (polygonPath && polygonPath.length > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      polygonPath.forEach(coord => bounds.extend(coord));
      map.fitBounds(bounds);
    } else {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setMapCenter(loc);
          map.panTo(loc);
          map.setZoom(18);
        });
      }
    }
  }, [polygonPath]);

  const drawSquare = useCallback((centerLat, centerLng) => {
    const lat = centerLat !== undefined ? centerLat : (mapRef.current ? mapRef.current.getCenter().lat() : mapCenter.lat);
    const lng = centerLng !== undefined ? centerLng : (mapRef.current ? mapRef.current.getCenter().lng() : mapCenter.lng);
    
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
  }, [mapCenter, onSave]);

  useEffect(() => {
    // Only auto-geocode and center if we have a new address and no polygon yet.
    // Depends on mapReady so it re-runs once the map's onLoad has set mapRef,
    // avoiding a race where this runs before the map is available.
    if (address && mapReady && mapRef.current && (!polygonPath || polygonPath.length === 0)) {
      if (hasGeocodedAddress.current === address) return; // Don't re-geocode if they click "Clear"
      hasGeocodedAddress.current = address;
      
      const geocoder = new window.google.maps.Geocoder();
      trackApiCall('geocode');
      geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK' && results[0]) {
          const loc = results[0].geometry.location;
          mapRef.current.panTo(loc);
          mapRef.current.setZoom(19);
          // Automatically drop a square for new properties
          drawSquare(loc.lat(), loc.lng());
        }
      });
    }
  }, [address, polygonPath, drawSquare, mapReady]);

  const handleClear = () => {
    polygonRef.current = null;
    setPolygonPath([]);
    onSave([]);
  };

  return (
    <div style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
      <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <h4 style={{ margin: 0, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MapIcon size={18} /> Property Geofence Boundary
          </h4>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.3rem', marginBottom: 0 }}>
            {polygonPath.length > 0 
              ? "Drag the white circles to adjust the boundary lines. (Auto-saves)" 
              : "Click Add Square to place a default boundary, then drag it to fit."}
          </p>
        </div>
        
        {/* Actions Menu */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {polygonPath.length > 0 ? (
            <button className="btn btn-secondary" onClick={handleClear} style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
              <Trash2 size={14} /> Clear Boundary
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => drawSquare()} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
              <Square size={14} /> Add Square
            </button>
          )}
        </div>
      </div>

      {isLoaded && !loadError ? (
        <GoogleMap
          mapContainerStyle={containerStyle}
          center={mapCenter}
          zoom={4}
          onLoad={(map) => {
            onMapLoad(map);
            trackApiCall('mapLoad');
          }}
          options={{ 
            mapTypeId: 'satellite', 
            disableDefaultUI: false,
            tilt: 0 // Keep overhead view
          }}
        >
          {polygonPath.length > 0 && (
            <Polygon
              path={polygonPath}
              editable={true}
              draggable={true}
              onLoad={onPolygonLoad}
              onUnmount={() => { polygonRef.current = null; }}
              onMouseUp={handlePolygonChange}
              onDragEnd={handlePolygonChange}
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
      ) : (
        <div style={{ ...containerStyle, background: '#e5e7eb', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
          <WifiOff size={40} style={{ opacity: 0.5, marginBottom: '1rem' }} />
          <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Map Unavailable Offline</div>
        </div>
      )}
    </div>
  );
}
