// Heavy boolean geometry runs here, off the main thread, so the UI never freezes.
importScripts("https://unpkg.com/@turf/turf@7/turf.min.js");

// Build a turf polygon Feature from a worker-shape.
//  poly   -> { kind:'poly', ring:[[lng,lat],...] }   (ring auto-closed)
//  circle -> { kind:'circle', center:[lng,lat], radius:<meters> }
function toFeature(s) {
  try {
    if (s.kind === "circle") {
      return turf.circle(s.center, s.radius / 1000, { steps: 64, units: "kilometers" });
    }
    const ring = s.ring.slice();
    const first = ring[0], last = ring[ring.length - 1];
    if (!first || ring.length < 3) return null;
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    const f = turf.polygon([ring]);
    // Drop self-intersecting / degenerate shapes rather than crashing the boolean ops.
    if (turf.kinks(f).features.length > 0) return turf.cleanCoords(f);
    return f;
  } catch (e) {
    return null;
  }
}

function unionAll(features) {
  const valid = features.filter(Boolean);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  try {
    return turf.union(turf.featureCollection(valid));
  } catch (e) {
    // Fall back to pairwise union if the bulk call chokes on a bad shape.
    let acc = valid[0];
    for (let i = 1; i < valid.length; i++) {
      try { acc = turf.union(turf.featureCollection([acc, valid[i]])) || acc; } catch (_) {}
    }
    return acc;
  }
}

self.onmessage = function (e) {
  const { token, grass, cuts } = e.data;
  let result = { token: token, netArea: 0, geojson: null };
  try {
    const grassUnion = unionAll(grass.map(toFeature));
    if (!grassUnion) { self.postMessage(result); return; }

    const cutUnion = unionAll(cuts.map(toFeature));
    let net = grassUnion;
    if (cutUnion) {
      try {
        net = turf.difference(turf.featureCollection([grassUnion, cutUnion]));
      } catch (err) {
        net = grassUnion; // if the cut fails, report gross rather than nothing
      }
    }
    // difference() returns null when the cuts remove all of the grass.
    result.netArea = net ? turf.area(net) : 0;
    result.geojson = net ? net.geometry : null;
  } catch (err) {
    result.error = String(err);
  }
  self.postMessage(result);
};
