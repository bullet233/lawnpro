import { useState, useEffect, useRef } from 'react';

// No fix for this long means job tracking has no evidence to work with — the
// same span after which the geofence engine restarts its debounce clocks.
export const GPS_SILENT_MS = 30000;

// `enabled` gates the GPS watch. LiveMap stays mounted on every route (to keep
// job/timer state alive), so watching unconditionally kept the GPS radio on —
// and flooded errors when permission was denied — even while the user was just
// browsing Stats at home. Callers pass enabled=false when tracking isn't needed.
export function useGeolocation(enabled = true) {
  const [position, setPosition] = useState(null);
  const [speed, setSpeed] = useState(0); // mph
  const [heading, setHeading] = useState(null);
  const [poorGps, setPoorGps] = useState(false);
  const [accuracy, setAccuracy] = useState(999);
  // One object per GPS fix. The geofence engine is fed from this — never from
  // `position` alongside other state — so it sees each real fix exactly once,
  // stamped when it arrived. `speedMph` stays null when the device reports no
  // speed (0 would read as "definitely parked").
  const [fix, setFix] = useState(null);
  // 'ok' | 'denied' (permission off) | 'silent' (no fixes arriving)
  const [gpsStatus, setGpsStatus] = useState('ok');

  const positionRef = useRef(null);
  const lastFixAtRef = useRef(null);
  const seqRef = useRef(0);
  const deniedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setGpsStatus('ok');
      return;
    }
    if (!navigator.geolocation) {
      setGpsStatus('denied');
      return;
    }

    const watchStartedAt = Date.now();
    lastFixAtRef.current = null;
    deniedRef.current = false;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const gpsAccuracy = pos.coords.accuracy || 999;
        const rawSpeed = pos.coords.speed;
        const hasSpeed = rawSpeed !== null && rawSpeed !== undefined && !isNaN(rawSpeed);

        positionRef.current = loc;
        lastFixAtRef.current = now;
        deniedRef.current = false;
        setPosition(loc);
        setAccuracy(gpsAccuracy);
        setSpeed(hasSpeed ? rawSpeed * 2.237 : 0);
        setFix({
          lat: loc.lat,
          lng: loc.lng,
          accuracy: gpsAccuracy,
          speedMph: hasSpeed ? rawSpeed * 2.237 : null,
          ts: now,
          seq: ++seqRef.current
        });
        setGpsStatus('ok');

        if (pos.coords.heading && !isNaN(pos.coords.heading)) {
          setHeading(pos.coords.heading);
        }

        if (gpsAccuracy > 30) {
          setPoorGps(true);
        } else {
          setPoorGps(false);
        }
      },
      (err) => {
        console.error('Geolocation error:', err);
        // code 1 = PERMISSION_DENIED. Timeouts / unavailable are covered by the
        // silence watchdog below, which also catches a watch that just stalls.
        if (err && err.code === 1) {
          deniedRef.current = true;
          setGpsStatus('denied');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
      }
    );

    const watchdog = setInterval(() => {
      if (deniedRef.current) return;
      const last = lastFixAtRef.current ?? watchStartedAt;
      if (Date.now() - last > GPS_SILENT_MS) setGpsStatus('silent');
    }, 5000);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(watchdog);
    };
  }, [enabled]);

  return { position, positionRef, speed, heading, poorGps, accuracy, fix, gpsStatus };
}
