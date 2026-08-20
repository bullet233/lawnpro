import { useEffect, useRef } from 'react';
import { useMapStatus } from './MapProvider';

// Address autocomplete on the child <input>. Renders a plain input until the
// Maps JS API is ready (cold PWA start, offline) so the field always works.
//
// The widget is managed imperatively here instead of via @react-google-maps/
// api's <Autocomplete>, because that component tears down only its own React
// listener on unmount — the underlying google.maps.places.Autocomplete stays
// bound to the input with live keyboard/mouse handlers, so any remount
// (StrictMode, tab switches) stacks widgets and leaks dropdown elements.
// Cleanup below detaches BOTH the instance and the input from Google's event
// system and removes this instance's dropdown from <body>.
export default function AddressAutocomplete({ onPlaceChanged, onLoad, children }) {
  const { isLoaded, loadError } = useMapStatus();
  const containerRef = useRef(null);

  // Latest callbacks without re-creating the widget on every parent render.
  const callbacksRef = useRef({ onPlaceChanged, onLoad });
  callbacksRef.current = { onPlaceChanged, onLoad };

  useEffect(() => {
    if (!isLoaded || loadError) return;
    const input = containerRef.current?.querySelector('input');
    if (!input || !window.google?.maps?.places?.Autocomplete) return;

    // Snapshot Google's dropdown elements so we can find (and later remove)
    // the one this instance appends to <body>.
    const before = new Set(document.querySelectorAll('.pac-container'));
    const ac = new window.google.maps.places.Autocomplete(input, {
      // Only the fields the app reads — an unrestricted getPlace() bills for
      // every Place Details field on each selection.
      fields: ['formatted_address', 'geometry', 'name'],
    });
    const pacEl =
      [...document.querySelectorAll('.pac-container')].find(el => !before.has(el)) || null;

    callbacksRef.current.onLoad?.(ac);
    ac.addListener('place_changed', () => callbacksRef.current.onPlaceChanged?.(ac));

    return () => {
      window.google.maps.event.clearInstanceListeners(ac);
      window.google.maps.event.clearInstanceListeners(input);
      pacEl?.remove();
    };
  }, [isLoaded, loadError]);

  return (
    <div ref={containerRef}>
      {children}
      {loadError && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>
          Address suggestions unavailable — no connection when the app opened.
          Type the full address, or close and reopen the app once you have signal.
        </div>
      )}
    </div>
  );
}
