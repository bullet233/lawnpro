import { createContext, useContext } from 'react';
import { useJsApiLoader } from '@react-google-maps/api';

export const GOOGLE_MAPS_API_KEY = 'AIzaSyDKHm5Bv_batsuOxZFMJQTe56iYRV1f6ik';
const libraries = ['places', 'drawing', 'geometry'];

const MapContext = createContext({ isLoaded: false, loadError: null });

export default function MapProvider({ children }) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries,
  });

  return (
    <MapContext.Provider value={{ isLoaded, loadError }}>
      {children}
    </MapContext.Provider>
  );
}

export function useMapStatus() {
  return useContext(MapContext);
}
