import { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleMap, Polygon, Polyline, Marker } from '@react-google-maps/api';
import { useMapStatus } from '../components/MapProvider';
import { Trash2, Map as MapIcon, WifiOff, MapPin, Undo2, Check, X, PenTool, Move } from 'lucide-react';
import { trackApiCall } from '../utils/apiTracker';

/*
  Arrival-zone editor. The "geofence" is NOT the lawn — it's the trigger zone
  on the street in front of the house: when the truck's GPS enters it, the job
  timer starts. So the primary flow is one tap on the road where you park,
  which drops a generously-sized square (GPS drifts 10–30m). Drag to nudge,
  slider to resize, or trace a custom shape for corner lots / long frontage.
*/

const containerStyle = {
  width: '100%',
  height: '65vh',
  minHeight: '450px',
  maxHeight: '800px',
};

const defaultCenter = { lat: 39.8283, lng: -98.5795 }; // US Center
const FT_PER_DEG_LAT = 364000;
const DEFAULT_ZONE_FT = 100;
const MIN_ZONE_FT = 50;
const MAX_ZONE_FT = 300;

// Google Maps can't parse CSS variables — polygon colors must be real values.
const FENCE_GREEN = '#10b981';
const FENCE_GREEN_DARK = '#059669';

// Bigger close-the-shape tap target on phones, where fingers are the pointer.
const SNAP_PX = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ? 26 : 16;

function metersPerPixel(map) {
  const lat = map.getCenter().lat();
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom());
}

function makeSquare(lat, lng, sizeFt) {
  const half = (sizeFt / 2) / FT_PER_DEG_LAT;
  const halfLng = half / Math.cos(lat * Math.PI / 180);
  return [
    { lat: lat + half, lng: lng - halfLng },
    { lat: lat + half, lng: lng + halfLng },
    { lat: lat - half, lng: lng + halfLng },
    { lat: lat - half, lng: lng - halfLng },
  ];
}

function centroidOf(pts) {
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  };
}

// Widest span of the zone in feet — the number that matters for "will my
// parked truck's GPS land inside this?"
function zoneWidthFt(pts) {
  if (pts.length < 3) return 0;
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const hFt = (Math.max(...lats) - Math.min(...lats)) * FT_PER_DEG_LAT;
  const wFt = (Math.max(...lngs) - Math.min(...lngs)) * FT_PER_DEG_LAT * Math.cos(midLat * Math.PI / 180);
  return Math.round(Math.max(hFt, wFt));
}

// Scale every vertex away from / toward the centroid, preserving the shape.
function scaleZone(pts, factor) {
  const c = centroidOf(pts);
  return pts.map(p => ({
    lat: c.lat + (p.lat - c.lat) * factor,
    lng: c.lng + (p.lng - c.lng) * factor,
  }));
}

// Floating pill button used in the on-map control bar.
function PillBtn({ onClick, disabled, primary, danger, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        pointerEvents: 'auto',
        display: 'flex', alignItems: 'center', gap: '0.4rem',
        background: primary ? FENCE_GREEN : '#fff',
        color: primary ? '#fff' : (danger ? '#ef4444' : '#334155'),
        border: primary ? 'none' : '1px solid #cbd5e1',
        borderRadius: '999px',
        padding: '0.65rem 1.1rem',
        fontSize: '0.9rem', fontWeight: 700,
        boxShadow: primary ? '0 6px 20px rgba(16,185,129,0.4)' : '0 6px 20px rgba(0,0,0,0.18)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

export default function GeofenceEditor({ initialPolygon, onSave, address }) {
  const [polygonPath, setPolygonPath] = useState(initialPolygon || []);
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [mapReady, setMapReady] = useState(false);
  // drawMode: null (idle) | 'place' (tap road to drop zone) | 'trace' (custom outline)
  const [drawMode, setDrawMode] = useState(null);
  const [tracePts, setTracePts] = useState([]);
  const [cursorLL, setCursorLL] = useState(null);

  const mapRef = useRef(null);
  const polygonRef = useRef(null);
  const hasGeocodedAddress = useRef('');
  const drawModeRef = useRef(null);
  const tracePtsRef = useRef([]);
  drawModeRef.current = drawMode;
  tracePtsRef.current = tracePts;
  const { isLoaded, loadError } = useMapStatus();

  // ── Saved-zone editing (drag whole zone or its white handles → auto-save) ──
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
    const google = window.google;
    if (google && google.maps && path) {
      google.maps.event.addListener(path, 'set_at', handlePolygonChange);
      google.maps.event.addListener(path, 'insert_at', handlePolygonChange);
      google.maps.event.addListener(path, 'remove_at', handlePolygonChange);
    }
  }, [handlePolygonChange]);

  // ── Zone placement / tracing ───────────────────────────────────────────────
  const startPlacing = useCallback(() => {
    polygonRef.current = null;
    setPolygonPath([]);
    setTracePts([]);
    setDrawMode('place');
  }, []);

  const startTracing = useCallback(() => {
    polygonRef.current = null;
    setPolygonPath([]);
    setTracePts([]);
    setCursorLL(null);
    setDrawMode('trace');
  }, []);

  const cancelDrawing = useCallback(() => {
    setDrawMode(null);
    setTracePts([]);
    setCursorLL(null);
  }, []);

  const finishTrace = useCallback(() => {
    const pts = tracePtsRef.current;
    if (pts.length < 3) return;
    setDrawMode(null);
    setCursorLL(null);
    setTracePts([]);
    setPolygonPath(pts);
    onSave(pts);
  }, [onSave]);

  const undoPoint = useCallback(() => {
    setTracePts(pts => pts.slice(0, -1));
  }, []);

  const placeZoneAt = useCallback((lat, lng) => {
    const square = makeSquare(lat, lng, DEFAULT_ZONE_FT);
    setDrawMode(null);
    setPolygonPath(square);
    onSave(square);
  }, [onSave]);

  const handleMapClick = useCallback((e) => {
    if (!e.latLng) return;
    const mode = drawModeRef.current;
    const ll = { lat: e.latLng.lat(), lng: e.latLng.lng() };
    if (mode === 'place') {
      placeZoneAt(ll.lat, ll.lng);
      return;
    }
    if (mode === 'trace') {
      const pts = tracePtsRef.current;
      const g = window.google;
      // Tapping near the first dot closes the shape (once it can be a shape).
      if (pts.length >= 3 && mapRef.current && g?.maps?.geometry) {
        const dist = g.maps.geometry.spherical.computeDistanceBetween(
          new g.maps.LatLng(pts[0].lat, pts[0].lng), new g.maps.LatLng(ll.lat, ll.lng));
        if (dist <= SNAP_PX * metersPerPixel(mapRef.current)) { finishTrace(); return; }
      }
      setTracePts(prev => [...prev, ll]);
    }
  }, [placeZoneAt, finishTrace]);

  const polygonPathRef = useRef(polygonPath);
  polygonPathRef.current = polygonPath;

  const resizeZone = useCallback((targetFt) => {
    const prev = polygonPathRef.current;
    if (prev.length < 3) return;
    const current = zoneWidthFt(prev);
    if (!current) return;
    const next = scaleZone(prev, targetFt / current);
    setPolygonPath(next);
    onSave(next);
  }, [onSave]);

  // Backspace = undo point, Escape = cancel, Enter = finish (desktop niceties).
  useEffect(() => {
    if (!drawMode) return;
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'Escape') cancelDrawing();
      else if (drawMode === 'trace' && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); undoPoint(); }
      else if (drawMode === 'trace' && e.key === 'Enter') finishTrace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode, undoPoint, cancelDrawing, finishTrace]);

  // ── Map lifecycle ──────────────────────────────────────────────────────────
  const onMapLoad = useCallback((map) => {
    mapRef.current = map;
    setMapReady(true);
    if (polygonPath && polygonPath.length > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      polygonPath.forEach(coord => bounds.extend(coord));
      map.fitBounds(bounds);
      // fitBounds on a small zone over-zooms; pull back so the street context shows
      window.google.maps.event.addListenerOnce(map, 'idle', () => {
        if (map.getZoom() > 19) map.setZoom(19);
      });
    } else if (!address && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMapCenter(loc);
        map.panTo(loc);
        map.setZoom(19);
      });
    }
  }, [polygonPath, address]);

  useEffect(() => {
    // New address + no zone yet: center the map and arm tap-to-place so the
    // first tap on the road drops the zone. (Previously this auto-dropped a
    // square on the geocoded rooftop, which is not where the truck parks.)
    if (address && mapReady && mapRef.current && (!polygonPath || polygonPath.length === 0)) {
      if (hasGeocodedAddress.current === address) return;
      hasGeocodedAddress.current = address;

      const geocoder = new window.google.maps.Geocoder();
      trackApiCall('geocode');
      geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK' && results[0]) {
          const loc = results[0].geometry.location;
          mapRef.current.panTo(loc);
          mapRef.current.setZoom(19);
          startPlacing();
        }
      });
    }
  }, [address, polygonPath, mapReady, startPlacing]);

  const handleClear = () => {
    polygonRef.current = null;
    setPolygonPath([]);
    onSave([]);
    setDrawMode('place'); // clearing means "start over" — arm tap-to-place
    setTracePts([]);
  };

  // ── Derived display values ────────────────────────────────────────────────
  const widthFt = zoneWidthFt(polygonPath);
  const canFinish = tracePts.length >= 3;
  const hint = drawMode === 'place'
    ? 'Tap the road where you park — the timer starts when your truck enters this zone'
    : drawMode === 'trace'
      ? (tracePts.length === 0 ? 'Tap corners to outline a custom zone'
        : !canFinish ? `${tracePts.length} of 3+ corners placed`
        : 'Tap the first dot (or Finish) to close the zone')
      : (polygonPath.length > 0 ? 'Drag the zone to reposition — saves automatically' : null);

  const g = isLoaded ? window.google : null;
  const dotIcon = g ? {
    path: g.maps.SymbolPath.CIRCLE, scale: 5.5,
    fillColor: '#ffffff', fillOpacity: 1, strokeColor: FENCE_GREEN_DARK, strokeWeight: 2,
  } : undefined;
  const firstDotIcon = g ? {
    path: g.maps.SymbolPath.CIRCLE, scale: canFinish ? 9 : 5.5,
    fillColor: canFinish ? FENCE_GREEN : '#ffffff', fillOpacity: 1,
    strokeColor: canFinish ? '#ffffff' : FENCE_GREEN_DARK, strokeWeight: 2,
  } : undefined;
  const dashedLine = g ? {
    strokeOpacity: 0,
    icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: '#ffffff', scale: 2.5 }, offset: '0', repeat: '12px' }],
  } : {};

  return (
    <div style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
      {/* Slim header: title + zone-size badge */}
      <div style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
        <h4 style={{ margin: 0, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem' }}>
          <MapIcon size={17} /> Arrival Zone
        </h4>
        {widthFt > 0 && !drawMode && (
          <span style={{
            background: 'rgba(16,185,129,0.12)', color: FENCE_GREEN_DARK,
            borderRadius: '999px', padding: '0.25rem 0.75rem', fontSize: '0.85rem', fontWeight: 700,
          }}>
            ~{widthFt} ft across
          </span>
        )}
      </div>

      {isLoaded && !loadError ? (
        <div style={{ position: 'relative' }}>
          <GoogleMap
            mapContainerStyle={containerStyle}
            center={mapCenter}
            zoom={4}
            onLoad={(map) => { onMapLoad(map); trackApiCall('mapLoad'); }}
            onClick={handleMapClick}
            onMouseMove={(e) => {
              if (drawModeRef.current === 'trace' && e.latLng) setCursorLL({ lat: e.latLng.lat(), lng: e.latLng.lng() });
            }}
            options={{
              mapTypeId: 'satellite',
              tilt: 0,
              disableDefaultUI: true,
              zoomControl: true,
              gestureHandling: 'greedy',
              clickableIcons: false,
              draggableCursor: drawMode ? 'crosshair' : undefined,
            }}
          >
            {/* Saved zone: drag whole shape to reposition, handles to reshape */}
            {!drawMode && polygonPath.length > 0 && (
              <Polygon
                path={polygonPath}
                editable={true}
                draggable={true}
                onLoad={onPolygonLoad}
                onUnmount={() => { polygonRef.current = null; }}
                onMouseUp={handlePolygonChange}
                onDragEnd={handlePolygonChange}
                options={{
                  fillColor: FENCE_GREEN,
                  fillOpacity: 0.3,
                  strokeColor: FENCE_GREEN,
                  strokeOpacity: 1,
                  strokeWeight: 2.5,
                }}
              />
            )}

            {/* In-progress custom trace: connecting line + corner dots + preview */}
            {drawMode === 'trace' && tracePts.length > 0 && (
              <>
                <Polyline
                  path={tracePts}
                  options={{ strokeColor: FENCE_GREEN, strokeOpacity: 1, strokeWeight: 3, clickable: false }}
                />
                {cursorLL && (
                  <Polyline
                    path={[tracePts[tracePts.length - 1], cursorLL]}
                    options={{ ...dashedLine, clickable: false }}
                  />
                )}
                {canFinish && (
                  <Polygon
                    path={tracePts}
                    options={{ fillColor: FENCE_GREEN, fillOpacity: 0.15, strokeOpacity: 0, clickable: false }}
                  />
                )}
                {tracePts.map((pt, i) => (
                  <Marker
                    key={i}
                    position={pt}
                    icon={i === 0 ? firstDotIcon : dotIcon}
                    onClick={i === 0 && canFinish ? finishTrace : undefined}
                    clickable={i === 0 && canFinish}
                  />
                ))}
              </>
            )}
          </GoogleMap>

          {/* Hint chip — floats top-center over the map */}
          {hint && (
            <div style={{
              position: 'absolute', top: 12, left: 0, right: 0,
              display: 'flex', justifyContent: 'center', pointerEvents: 'none',
            }}>
              <span style={{
                background: 'rgba(15,23,42,0.82)', color: '#fff', borderRadius: '999px',
                padding: '0.45rem 1rem', fontSize: '0.85rem', fontWeight: 600,
                boxShadow: '0 4px 14px rgba(0,0,0,0.25)', maxWidth: '90%', textAlign: 'center',
              }}>
                {hint}
              </span>
            </div>
          )}

          {/* Bottom overlay: size slider stacked above the action bar so they
              never collide when buttons wrap on narrow screens */}
          <div style={{
            position: 'absolute', bottom: 16, left: 0, right: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem',
            pointerEvents: 'none', padding: '0 0.75rem',
          }}>
          {!drawMode && polygonPath.length > 0 && (
            <div style={{
              pointerEvents: 'auto', background: '#fff', borderRadius: '999px',
              padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem',
              boxShadow: '0 6px 20px rgba(0,0,0,0.18)', border: '1px solid #cbd5e1',
            }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>Zone size</span>
              <input
                type="range"
                min={MIN_ZONE_FT}
                max={MAX_ZONE_FT}
                step={10}
                value={Math.min(MAX_ZONE_FT, Math.max(MIN_ZONE_FT, widthFt || DEFAULT_ZONE_FT))}
                onChange={(e) => resizeZone(Number(e.target.value))}
                style={{ width: 140, accentColor: FENCE_GREEN }}
              />
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: FENCE_GREEN_DARK, minWidth: 44, textAlign: 'right' }}>{widthFt} ft</span>
            </div>
          )}

          {/* Floating action bar */}
          <div style={{
            display: 'flex', justifyContent: 'center', gap: '0.6rem', flexWrap: 'wrap',
            pointerEvents: 'none',
          }}>
            {drawMode === 'place' ? (
              <>
                <PillBtn onClick={cancelDrawing}><X size={16} /> Cancel</PillBtn>
                <PillBtn onClick={startTracing}><PenTool size={16} /> Custom Shape</PillBtn>
              </>
            ) : drawMode === 'trace' ? (
              <>
                <PillBtn onClick={cancelDrawing}><X size={16} /> Cancel</PillBtn>
                <PillBtn onClick={undoPoint} disabled={tracePts.length === 0}><Undo2 size={16} /> Undo</PillBtn>
                <PillBtn onClick={finishTrace} disabled={!canFinish} primary><Check size={16} /> Finish</PillBtn>
              </>
            ) : polygonPath.length > 0 ? (
              <>
                <PillBtn onClick={startPlacing}><Move size={16} /> Move Zone</PillBtn>
                <PillBtn onClick={startTracing}><PenTool size={16} /> Custom Shape</PillBtn>
                <PillBtn onClick={handleClear} danger><Trash2 size={16} /> Clear</PillBtn>
              </>
            ) : (
              <>
                <PillBtn onClick={startPlacing} primary><MapPin size={16} /> Place Zone</PillBtn>
                <PillBtn onClick={startTracing}><PenTool size={16} /> Custom Shape</PillBtn>
              </>
            )}
          </div>
          </div>
        </div>
      ) : (
        <div style={{ ...containerStyle, background: '#e5e7eb', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
          <WifiOff size={40} style={{ opacity: 0.5, marginBottom: '1rem' }} />
          <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Map Unavailable Offline</div>
        </div>
      )}
    </div>
  );
}
