// ── Paste your Google Maps API key between the quotes below ──────────────
// How to get one (free tier covers personal use easily):
//   1. https://console.cloud.google.com/  → create/select a project
//   2. APIs & Services → Enable APIs → enable: "Maps JavaScript API",
//      "Places API", and make sure the Geometry/Drawing libraries load
//      (they come with Maps JavaScript API).
//   3. APIs & Services → Credentials → Create credentials → API key
//   4. RESTRICT the key:
//        - Application restrictions → HTTP referrers → add:  http://localhost:*/*
//        - API restrictions → restrict to: Maps JavaScript API, Places API
//   5. Enable billing on the project (required by Google; personal use stays
//      within the free monthly credit).
// Then run the app over localhost (see README.md) — NOT by double-clicking
// the file, or Google Maps will refuse to load.
window.LAWN_CONFIG = {
  GOOGLE_MAPS_API_KEY: "AIzaSyDKHm5Bv_batsuOxZFMJQTe56iYRV1f6ik"
};
