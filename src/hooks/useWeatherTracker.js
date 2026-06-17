import { useState, useEffect, useRef } from 'react';

export function useWeatherTracker(positionRef) {
  const [weather, setWeather] = useState(null);
  const weatherRef = useRef(null);
  const weatherTimerRef = useRef(null);
  const weatherInitTimeoutRef = useRef(null);

  const fetchWeather = async (lat, lng) => {
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`);
      const data = await res.json();
      if (data.current) {
        const newWeather = {
          temp: Math.round(data.current.temperature_2m),
          wind: Math.round(data.current.wind_speed_10m),
          code: data.current.weather_code
        };
        setWeather(newWeather);
        weatherRef.current = newWeather;
      }
    } catch (e) {
      console.log('Weather fetch failed', e);
    }
  };

  useEffect(() => {
    // We start polling once we have a position ref
    if (!weatherTimerRef.current) {
      // Small timeout to allow positionRef to populate initially
      weatherInitTimeoutRef.current = setTimeout(() => {
        if (positionRef.current) {
          fetchWeather(positionRef.current.lat, positionRef.current.lng);
        }
      }, 2000);
      
      weatherTimerRef.current = setInterval(() => {
        if (positionRef.current) {
          fetchWeather(positionRef.current.lat, positionRef.current.lng);
        }
      }, 10 * 60 * 1000);
    }

    return () => {
      if (weatherInitTimeoutRef.current) {
        clearTimeout(weatherInitTimeoutRef.current);
        weatherInitTimeoutRef.current = null;
      }
      if (weatherTimerRef.current) {
        clearInterval(weatherTimerRef.current);
        weatherTimerRef.current = null;
      }
    };
  }, [positionRef]);

  return { weather, weatherRef };
}
