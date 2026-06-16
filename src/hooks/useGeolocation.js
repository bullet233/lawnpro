import { useState, useEffect, useRef } from 'react';

export function useGeolocation() {
  const [position, setPosition] = useState(null);
  const [speed, setSpeed] = useState(0); // mph
  const [heading, setHeading] = useState(null);
  const [poorGps, setPoorGps] = useState(false);
  const [accuracy, setAccuracy] = useState(999);

  const positionRef = useRef(null);

  useEffect(() => {
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
  }, []);

  return { position, positionRef, speed, heading, poorGps, accuracy };
}
