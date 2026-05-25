import { useJsApiLoader } from '@react-google-maps/api';

const GOOGLE_MAPS_API_KEY = 'AIzaSyDKHm5Bv_batsuOxZFMJQTe56iYRV1f6ik';
const libraries = ['places', 'drawing', 'geometry'];

export default function MapProvider({ children }) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries,
  });

  if (loadError) {
    return <div style={{ padding: '2rem', color: 'red' }}>Error loading Google Maps API</div>;
  }

  if (!isLoaded) {
    return <div style={{ padding: '2rem' }}>Loading Map...</div>;
  }

  return children;
}
