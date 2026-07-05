import { useState, useEffect, useRef } from 'react';

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

  const positionRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const gpsAccuracy = pos.coords.accuracy || 999;
        
        positionRef.current = loc;
        setPosition(loc);
        setAccuracy(gpsAccuracy);

        const currentSpeedMph = (pos.coords.speed || 0) * 2.237;
        setSpeed(currentSpeedMph);

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
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);

  return { position, positionRef, speed, heading, poorGps, accuracy };
}
