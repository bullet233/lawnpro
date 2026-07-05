import { Autocomplete } from '@react-google-maps/api';
import { useMapStatus } from './MapProvider';

// Google's <Autocomplete> throws if it mounts before the Maps JS API has loaded
// (cold PWA start, offline, slow network). That crash — with no map on screen —
// used to white-screen pages like Client Detail. This wrapper only mounts the
// real Autocomplete once the API is ready; until then (or offline) it renders a
// plain text input so the field still works. Same props as a bare <input>.
export default function AddressAutocomplete({ onPlaceChanged, onLoad, children }) {
  const { isLoaded, loadError } = useMapStatus();

  if (!isLoaded || loadError) {
    return children; // plain input fallback — address is still typeable/savable
  }

  return (
    <Autocomplete onLoad={onLoad} onPlaceChanged={onPlaceChanged}>
      {children}
    </Autocomplete>
  );
}
