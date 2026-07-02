/* Lawn Measure — boundary-editor model.
 * An AREA owns one boundary polygon + a list of cutouts. Net = boundary − cutouts
 * (Turf, in a Web Worker). The right panel is either the AREAS OVERVIEW or a
 * transactional per-area EDITOR (Update commits a draft, Abandon discards it).
 * Trace areas/cutouts (click corners, click the first dot to close), or draw
 * rectangles/circles/lines. After drawing, an area is reshaped in select mode by
 * dragging its vertices (right-click a vertex to delete); Undo/Redo covers mistakes.
 */
const SQFT_PER_M2 = 10.7639104;
const SQFT_PER_ACRE = 43560;
const STORAGE_KEY = "lawn-measure-v2";
const SWATCHES = ["#34c759", "#3b82f6", "#f5b942", "#f4828c", "#b69cf0", "#9aa0a6"];
const GROUP_COLORS = ["#34c759","#3b82f6","#f5b942","#f4828c","#b69cf0","#ff9500","#32ade6","#30d158"];
// Single source of truth for setting defaults — applied at init, load, and import so a
// fresh install (no saved data) gets the full set, not a partial literal. (smoothing in
// metres; magneticSnap on; labels on; hybrid imagery; imperial units.)
const DEFAULT_SETTINGS = { defaultOpacity: 0.35, defaultColor: "#34c759", units: "imperial", showLabels: true, mapType: "hybrid", smoothing: 0.10, magneticSnap: true, lineWeight: 4, areaWeight: 2 };

const state = {
  areas: [],           // {id, name, color, opacity, boundary, cutouts:[{id,geometry}], net, groupId: string}
  lines: [],           // {id, name, color, groupId, path:[{lat,lng}], length(m), hidden, hideLabel}
  groups: [],          // {id, name, color, collapsed}
  activeId: null,      // area being edited (null = overview)
  draft: null,         // working copy while editing
  lineDraft: null,     // working copy while drawing a line {id,name,color,groupId}
  drawMode: "select",  // 'select' | 'boundary' | 'cutout' | 'line'
  drawShape: "polygon",// 'polygon' | 'rectangle' | 'circle' | 'line'
  activeTool: "select",// which toolbar tool is highlighted: 'select'|'polygon'|'line'|'rectangle'|'circle'
  seq: 1, cutSeq: 1, grpSeq: 1, lineSeq: 1,
  settings: Object.assign({}, DEFAULT_SETTINGS),
};
// Stroke width (px) for ALL drawn outlines — areas, cutouts, lines, and previews.
// Stroke width (px): areas/cutouts use areaW() (thin by default), lines use lineW() (bolder).
function areaW() { return state.settings.areaWeight != null ? state.settings.areaWeight : 2; }
function lineW() { return state.settings.lineWeight != null ? state.settings.lineWeight : 4; }
// Geodesic length of an open path (array of {lat,lng}), in metres.
function lineLength(path) {
  if (!path || path.length < 2) return 0;
  let m = 0;
  for (let i = 1; i < path.length; i++) {
    m += google.maps.geometry.spherical.computeDistanceBetween(
      new google.maps.LatLng(path[i - 1].lat, path[i - 1].lng),
      new google.maps.LatLng(path[i].lat, path[i].lng));
  }
  return m;
}
function totalLines() {
  return state.lines.reduce((s, l) => s + (l.length || 0), 0);
}

let map, worker;
let mapOverlays = [];
let LabelOverlay;
let activeBoundary = null, activeBoundaryGeomType = null, activeLabel = null; // live refs for in-place metadata updates
let stylePanelOpen = false; // is the collapsible Style panel (swatches + opacity) expanded?
let addressMarker = null; // pin dropped at the searched address
const undoStack = [], redoStack = [];
let editListeners = [], editPre = null; // live shape editing (drag/delete vertices)

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
function esc(s) { return String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])); }

function unitSuffix() { return state.settings.units === "metric" ? "m²" : "sq ft"; }
function fmtArea(m2) {
  if (state.settings.units === "metric") {
    let out = Math.round(m2).toLocaleString() + " m²";
    if (m2 >= 10000) out += "  ·  " + (m2 / 10000).toFixed(2) + " ha";
    return out;
  }
  const sqft = m2 * SQFT_PER_M2;
  let out = Math.round(sqft).toLocaleString() + " sq ft";
  if (sqft >= 4356) out += "  ·  " + (sqft / SQFT_PER_ACRE).toFixed(2) + " ac";
  return out;
}
function sqftOnly(m2) {
  return state.settings.units === "metric" ? Math.round(m2).toLocaleString() : Math.round(m2 * SQFT_PER_M2).toLocaleString();
}

/* ── geometry → worker ─────────────────────────────────────────────────── */
function rectPath(b) {
  return [{ lat: b.north, lng: b.west }, { lat: b.north, lng: b.east }, { lat: b.south, lng: b.east }, { lat: b.south, lng: b.west }];
}
function areaOf(geom) {
  if (!geom) return 0;
  if (geom.type === "circle") return Math.PI * geom.radius * geom.radius;
  const path = geom.type === "rectangle" ? rectPath(geom.bounds) : geom.path;
  return google.maps.geometry.spherical.computeArea(path.map((p) => new google.maps.LatLng(p.lat, p.lng)));
}
function toWorkerShape(geom) {
  if (geom.type === "circle") return { kind: "circle", center: [geom.center.lng, geom.center.lat], radius: geom.radius };
  const pts = geom.type === "rectangle" ? rectPath(geom.bounds) : geom.path;
  return { kind: "poly", ring: pts.map((p) => [p.lng, p.lat]) };
}

/* ── perimeter / edging length (linear feet) ───────────────────────────── */
function perimeterOf(geom) {
  if (!geom) return 0;
  if (geom.type === "circle") return 2 * Math.PI * geom.radius;
  const path = geom.type === "rectangle" ? rectPath(geom.bounds) : geom.path;
  if (!path || path.length < 2) return 0;
  let per = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length]; // closed ring
    per += google.maps.geometry.spherical.computeDistanceBetween(new google.maps.LatLng(a.lat, a.lng), new google.maps.LatLng(b.lat, b.lng));
  }
  return per; // metres
}
// Total edging for an area = its boundary edge + the edge around each cutout.
function areaEdging(a) {
  let per = perimeterOf(a.boundary);
  (a.cutouts || []).forEach((c) => { per += perimeterOf(c.geometry); });
  return per;
}
function fmtLen(m) {
  if (state.settings.units === "metric") return Math.round(m).toLocaleString() + " m";
  return Math.round(m * 3.28084).toLocaleString() + " ft";
}

/* ── geometry simplification (Douglas–Peucker, meters tolerance) ──────────
 * Run once when a freehand polygon is finished: drops vertices that sit within
 * state.settings.smoothing of a straight segment. Conservative (~0.25 m) so the area drift
 * is far below the imagery error; keeps a floor so shapes never collapse. */
function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function douglasPeucker(pts, tol) {
  if (pts.length < 3) return pts;
  let maxd = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxd) { maxd = d; idx = i; }
  }
  if (maxd > tol) {
    const left = douglasPeucker(pts.slice(0, idx + 1), tol);
    const right = douglasPeucker(pts.slice(idx), tol);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}
function simplifyGeom(geom) {
  if (!geom || geom.type !== "polygon" || geom.path.length <= 5) return geom; // small shapes left intact
  const lat0 = (geom.path[0].lat * Math.PI) / 180;
  const mLat = 111320, mLng = 111320 * Math.cos(lat0);
  const pts = geom.path.map((p) => ({ x: p.lng * mLng, y: p.lat * mLat, orig: p }));
  const kept = douglasPeucker(pts, state.settings.smoothing).map((p) => p.orig);
  return kept.length >= 3 ? { type: "polygon", path: kept } : geom;
}

let workerSeq = 0; const workerCbs = {};
const WORKER_TIMEOUT_MS = 5000;
// Quick main-thread estimate used if the worker hangs or fails (e.g. Turf CDN blocked):
// boundary area minus each cutout's area. Not geometrically exact (ignores overlap),
// but keeps the UI responsive instead of stuck waiting forever.
function fallbackNet(boundary, cutouts) {
  let net = areaOf(boundary);
  (cutouts || []).forEach((c) => { net -= areaOf(c.geometry); });
  return Math.max(0, net);
}
function computeNet(boundary, cutouts) {
  return new Promise((res) => {
    if (!boundary) return res({ netArea: 0 });
    const token = "w" + (workerSeq++);
    const timeout = setTimeout(() => {
      if (workerCbs[token]) { delete workerCbs[token]; res({ netArea: fallbackNet(boundary, cutouts), fallback: true }); }
    }, WORKER_TIMEOUT_MS);
    workerCbs[token] = { res, timeout, boundary, cutouts };
    worker.postMessage({ token, grass: [toWorkerShape(boundary)], cuts: cutouts.map((c) => toWorkerShape(c.geometry)) });
  });
}

/* ── polygon drawing (generic; calls a callback with the finished path) ── */
// Boundary draws in GREEN (grass); CUTOUT draws in RED so it's obvious you're removing.
function drawColors() {
  if (state.drawMode === "cutout") {
    return { fill: "#ff3b30", stroke: "#ff453a", dot: "#b3000f" };
  }
  if (state.drawMode === "line" && state.lineDraft) {
    const lc = state.lineDraft.color || "#34c759";
    return { fill: lc, stroke: lc, dot: lc };
  }
  const c = (state.draft && state.draft.color) ? state.draft.color : "#34c759";
  return { fill: c, stroke: c, dot: c };
}
let tempPts = [], tempStart = null, tempOverlay = null, tempMarkers = [], drawerListeners = [], onDrawComplete = null, snapping = false;
let _moveRaf = null, _pendingLL = null, _prevSnapping = false;
// Invisible OverlayView used ONLY to expose Google's projection engine so we can convert
// raw browser pixels → LatLng (see domMove / the "Ghost Drag" bypass in armDraw).
let projOverlay = null;

function clearTemp() {
  if (tempOverlay) { tempOverlay.setMap(null); tempOverlay = null; }
  tempMarkers.forEach((m) => m.setMap(null)); tempMarkers = []; tempPts = []; tempStart = null; snapping = false;
}
function disarmDraw() {
  drawerListeners.forEach((l) => google.maps.event.removeListener(l)); drawerListeners = [];
  if (_moveRaf) { cancelAnimationFrame(_moveRaf); _moveRaf = null; }
  _pendingLL = null; _prevSnapping = false;
  clearTemp(); onDrawComplete = null;
  if (map) map.setOptions({ draggableCursor: null, disableDoubleClickZoom: false });
  const mw = document.getElementById("map-wrap");
  if (mw) mw.classList.remove("drawing-mode");
  $("drawHint").hidden = true;
}
function currentHint() {
  if (state.drawShape === "line") return "Click points along the line. Double-click to finish (Backspace to undo a point, Esc to cancel).";
  const role = state.drawMode === "boundary" ? "the area" : "the part to remove";
  if (state.drawShape === "rectangle") return "Click two opposite corners of " + role + ".";
  if (state.drawShape === "circle") return "Click the centre of " + role + ", then click again to set the size.";
  return "Click each corner of " + role + ". Click the first dot to finish.";
}
function armDraw(cb) {
  disarmDraw();
  onDrawComplete = cb;
  // FIX (Polygon Mouse Stealing): re-render so every existing shape becomes
  // clickable:false in draw mode — otherwise an underlying lawn steals the clicks
  // when you trace a cutout inside it, creating dead zones.
  renderMap();
  buildSnapCandidates();
  map.setOptions({ draggableCursor: "crosshair", disableDoubleClickZoom: true });
  // Force crosshair via CSS regardless of shape clickability
  const mw = document.getElementById("map-wrap");
  if (mw) mw.classList.add("drawing-mode");
  drawerListeners.push(map.addListener("click", drawerClick));
  // FIX (Double-Click Trap): Google groups fast clicks into click→dblclick and swallows
  // the 2nd as a "click". Route dblclick straight to drawerClick so that point still
  // lands. We NO LONGER finish the shape on dblclick — closing is done by clicking the
  // first/green dot. (Redundant points from a true dblclick are removed by simplifyGeom.)
  drawerListeners.push(map.addListener("dblclick", drawerDblHandler));
  // FIX (Ghost Drag): Google Maps can get stuck thinking the mouse button is held down
  // and then permanently suppresses its own "mousemove" events, freezing the preview
  // line. Bypass it entirely — listen to the RAW DOM mousemove on the map container,
  // which the browser always fires, and convert pixels→LatLng via the projection bridge.
  const mapEl = document.getElementById("map");
  drawerListeners.push(google.maps.event.addDomListener(mapEl, "mousemove", domMove));
  $("drawHintText").textContent = currentHint();
  $("drawHint").hidden = false;
}
// Double-click: finish a LINE; for area shapes, place the swallowed point (Double-Click Trap fix).
function drawerDblHandler(e) {
  if (state.drawShape === "line") { finishLine(); return; }
  drawerClick(e);
}
function finishLine() {
  if (tempPts.length < 2) return;
  finishShape({ type: "line", path: tempPts.map((p) => ({ lat: p.lat(), lng: p.lng() })) });
}
// Remove the last-placed point of an in-progress line (Backspace / Undo while drawing).
function removeLastLinePoint() {
  if (state.drawShape !== "line" || !tempPts.length) return;
  tempPts.pop();
  const m = tempMarkers.pop(); if (m) m.setMap(null);
  if (tempOverlay) tempOverlay.setPath(tempPts);
  const ht = $("drawHintText");
  if (ht) ht.textContent = tempPts.length
    ? "Line: " + fmtLen(lineLength(tempPts.map((p) => ({ lat: p.lat(), lng: p.lng() })))) + " — double-click to finish."
    : currentHint();
}
// Raw-DOM mousemove handler: convert browser pixels → LatLng using the invisible
// projOverlay, then feed our normal preview pipeline. Immune to the Ghost Drag freeze.
function domMove(e) {
  if (!projOverlay) return;
  const proj = projOverlay.getProjection();
  if (!proj) return;
  const mapEl = document.getElementById("map");
  const rect = mapEl.getBoundingClientRect();
  const point = new google.maps.Point(e.clientX - rect.left, e.clientY - rect.top);
  const latLng = proj.fromContainerPixelToLatLng(point);
  if (latLng) drawerMove({ latLng });
}
function ensureTemp() {
  if (tempOverlay) return;
  const c = drawColors();
  const style = { fillColor: c.fill, fillOpacity: 0.2, strokeColor: c.stroke, strokeWeight: areaW(), strokeOpacity: 1, clickable: false, zIndex: 70 };
  if (state.drawShape === "rectangle") tempOverlay = new google.maps.Rectangle({ ...style, map });
  else if (state.drawShape === "circle") tempOverlay = new google.maps.Circle({ ...style, map, radius: 1 });
  else if (state.drawShape === "line") tempOverlay = new google.maps.Polyline({ strokeColor: c.stroke, strokeWeight: lineW(), strokeOpacity: 1, clickable: false, zIndex: 70, map, path: [] });
  else tempOverlay = new google.maps.Polygon({ ...style, map, paths: [] });
}
function vertexDot(ll) {
  return new google.maps.Marker({ position: ll, map, clickable: false, zIndex: 71,
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 5.5, fillColor: "#fff", fillOpacity: 1, strokeColor: drawColors().dot, strokeWeight: 2.5 } });
}
function metersPerPixel() {
  const lat = map.getCenter().lat();
  return 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, map.getZoom());
}
// The first vertex is a static target dot — grows to a large green ring when close enough to snap shut.
function setFirstDotStyle(snap) {
  const m = tempMarkers[0];
  if (!m) return;
  const dot = drawColors().dot;
  m.setIcon({
    path: google.maps.SymbolPath.CIRCLE,
    scale: snap ? 13 : 10,
    fillColor: snap ? "#34c759" : "#ffffff",
    fillOpacity: 1,
    strokeColor: snap ? "#ffffff" : dot,
    strokeWeight: 3,
    strokeOpacity: 1,
  });
}
function rectBounds(a, b) {
  const bd = new google.maps.LatLngBounds(); bd.extend(a); bd.extend(b);
  const ne = bd.getNorthEast(), sw = bd.getSouthWest();
  return { north: ne.lat(), south: sw.lat(), east: ne.lng(), west: sw.lng() };
}
function finishShape(geom) { clearTemp(); if (onDrawComplete) onDrawComplete(geom); }

// Snap targets are flattened ONCE when drawing arms (not re-derived every mousemove),
// and matched with cheap planar math instead of per-vertex geodesic trig.
let snapCandidates = [];
function buildSnapCandidates() {
  snapCandidates = [];
  if (state.settings.magneticSnap === false) return;
  const add = (geom) => {
    if (!geom || geom.type === "circle") return;
    const pts = geom.type === "rectangle" ? rectPath(geom.bounds) : geom.path;
    if (pts) for (let i = 0; i < pts.length; i++) snapCandidates.push(pts[i]);
  };
  state.areas.forEach((a) => {
    if (a.hidden) return;
    add(a.boundary);
    if (a.cutouts) a.cutouts.forEach((c) => add(c.geometry));
  });
}
function getMagneticSnap(ll) {
  if (state.settings.magneticSnap === false || !snapCandidates.length) return ll;
  const lat = ll.lat(), lng = ll.lng();
  const mLat = 111320, mLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const thr = 14 * metersPerPixel(), thr2 = thr * thr;
  let best = null, bestD2 = thr2;
  for (let i = 0; i < snapCandidates.length; i++) {
    const c = snapCandidates[i];
    const dx = (c.lng - lng) * mLng, dy = (c.lat - lat) * mLat;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = c; }
  }
  return best ? new google.maps.LatLng(best.lat, best.lng) : ll;
}

function drawerClick(e) {
  const ll = getMagneticSnap(e.latLng);
  if (state.drawShape === "line") {
    tempPts.push(ll); ensureTemp(); tempOverlay.setPath(tempPts);
    tempMarkers.push(vertexDot(ll));
    return;
  }
  if (state.drawShape === "polygon") {
    // Close when clicking on/near the first vertex — checked directly here (not just
    // via the snap flag) so it works even when placing points quickly without a
    // mousemove in between. Redundant points are cleaned up by simplifyGeom on commit.
    if (tempPts.length >= 3 &&
        (snapping || google.maps.geometry.spherical.computeDistanceBetween(ll, tempPts[0]) < 14 * metersPerPixel())) {
      finishShape({ type: "polygon", path: tempPts.map((p) => ({ lat: p.lat(), lng: p.lng() })) }); return;
    }
    tempPts.push(ll); ensureTemp(); tempOverlay.setPath(tempPts);
    tempMarkers.push(vertexDot(ll));
    if (tempPts.length === 1) setFirstDotStyle(false);
  } else if (state.drawShape === "rectangle") {
    if (!tempStart) { tempStart = ll; ensureTemp(); }
    else finishShape({ type: "rectangle", bounds: rectBounds(tempStart, ll) });
  } else {
    if (!tempStart) { tempStart = ll; ensureTemp(); tempOverlay.setCenter(ll); }
    else finishShape({ type: "circle", center: { lat: tempStart.lat(), lng: tempStart.lng() }, radius: google.maps.geometry.spherical.computeDistanceBetween(tempStart, ll) });
  }
}
// Coalesce mousemoves to at most one update per animation frame.
function drawerMove(e) {
  if (!e.latLng) return;
  _pendingLL = e.latLng;
  if (_moveRaf) return;
  _moveRaf = requestAnimationFrame(processMove);
}
function processMove() {
  _moveRaf = null;
  const raw = _pendingLL; if (!raw) return;
  try {
    const ll = getMagneticSnap(raw);
    if (state.drawShape === "line") {
      if (!tempPts.length) return;
      ensureTemp();
      tempOverlay.setPath(tempPts.concat([ll]));
      const ht = $("drawHintText"); if (ht) ht.textContent = "Line: " + fmtLen(lineLength(tempPts.concat([ll]).map(p => ({ lat: p.lat(), lng: p.lng() })))) + " — double-click to finish.";
      return;
    }
    if (state.drawShape === "polygon") {
      if (!tempPts.length) return;
      ensureTemp();
      let snap = false, preview = tempPts.concat([ll]);
      if (tempPts.length >= 3 && google.maps.geometry.spherical.computeDistanceBetween(ll, tempPts[0]) < 14 * metersPerPixel()) {
        snap = true; preview = tempPts.concat([tempPts[0]]);
      }
      tempOverlay.setPath(preview);
      snapping = snap;
      if (snap !== _prevSnapping) { // only touch cursor/hint/dot when the state flips
        _prevSnapping = snap;
        setFirstDotStyle(snap);
        map.setOptions({ draggableCursor: snap ? "pointer" : "crosshair" });
        const ht = $("drawHintText"); if (ht) ht.textContent = snap ? "Click the green dot to close the shape." : currentHint();
      }
    }
    else if (state.drawShape === "rectangle") { if (tempStart) { ensureTemp(); tempOverlay.setBounds(rectBounds(tempStart, ll)); } }
    else { if (tempStart) { ensureTemp(); tempOverlay.setRadius(Math.max(1, google.maps.geometry.spherical.computeDistanceBetween(tempStart, ll))); } }
  } catch (err) {
    // A transient error must NEVER permanently freeze the live preview. Log it, then
    // drop the temp overlay so it's rebuilt cleanly on the next mousemove. Drawing
    // (the click handler) is unaffected.
    console.error("[preview] move handler error — recovering:", err);
    if (tempOverlay) { try { tempOverlay.setMap(null); } catch (_) {} tempOverlay = null; }
  }
}

/* ── map rendering ─────────────────────────────────────────────────────── */
function clearMap() {
  editListeners.forEach((l) => google.maps.event.removeListener(l)); editListeners = [];
  mapOverlays.forEach((o) => o.setMap(null)); mapOverlays = [];
  activeBoundary = null; activeBoundaryGeomType = null; activeLabel = null;
}
function makeShapeOverlay(geom, style) {
  if (geom.type === "circle") return new google.maps.Circle({ ...style, center: geom.center, radius: geom.radius, map });
  if (geom.type === "rectangle") return new google.maps.Rectangle({ ...style, bounds: geom.bounds, map });
  return new google.maps.Polygon({ ...style, paths: geom.path, map });
}
function geomBounds(geom) {
  if (geom.type === "circle") return new google.maps.Circle({ center: geom.center, radius: geom.radius }).getBounds();
  const b = new google.maps.LatLngBounds();
  (geom.type === "rectangle" ? rectPath(geom.bounds) : geom.path).forEach((p) => b.extend(p));
  return b;
}
function drawArea(a, opts) {
  // EDITING: the active area, while in select mode, is reshapeable — its boundary and
  // cutouts become Google-Maps editable overlays (drag a vertex, right-click a vertex to
  // delete). Whole-shape drag is intentionally OFF. See the "live shape editing" block.
  const editing = !!opts.active && state.drawMode === "select" && !!state.draft;
  if (a.boundary) {
    // While editing in a draw mode (boundary/cutout), EVERY shape must be click-through
    // so map clicks reach the draw listener — otherwise you can't trace a cutout inside
    // a shape. Only in overview (no draft) are boundaries clickable, to open the editor.
    const drawing = !!state.draft && state.drawMode !== "select";
    const ov = makeShapeOverlay(a.boundary, {
      fillColor: a.color, fillOpacity: opts.faint ? 0.1 : (a.opacity != null ? a.opacity : 0.35),
      strokeColor: a.color, strokeWeight: areaW(), strokeOpacity: opts.faint ? 0.5 : 1,
      clickable: drawing ? false : (editing ? true : !!opts.onClick),
      // Vertex editing only — the whole shape is NOT draggable, so clicking/panning
      // inside an area can't accidentally move it. Reshape via vertex handles.
      editable: editing, draggable: false,
      zIndex: 10,
    });
    if (opts.onClick) ov.addListener("click", opts.onClick);
    if (editing) wireEditable(ov, a.boundary.type, () => onBoundaryEdit(ov, a.boundary.type), true);
    mapOverlays.push(ov);
    if (opts.active) { activeBoundary = ov; activeBoundaryGeomType = a.boundary.type; }

    if (LabelOverlay && !a.hideLabel) {
      const net = a._net != null ? a._net : (a.net != null ? a.net : areaOf(a.boundary));
      const bounds = geomBounds(a.boundary);
      const label = new LabelOverlay(bounds, a.name, sqftOnly(net) + " " + unitSuffix(), map);
      if (opts.faint) label.div.style.opacity = 0.5;
      mapOverlays.push(label);
      if (opts.active) activeLabel = label;
    }
  }
  (a.cutouts || []).forEach((c) => {
    const co = makeShapeOverlay(c.geometry, {
      fillColor: "#16202c", fillOpacity: opts.faint ? 0.12 : 0.5,
      strokeColor: "#ffffff", strokeWeight: areaW(), strokeOpacity: 0.85,
      clickable: editing, editable: editing, draggable: false, zIndex: 20,
    });
    if (editing) wireEditable(co, c.geometry.type, () => onCutoutEdit(co, c.id, c.geometry.type), false);
    mapOverlays.push(co);
  });
}
function drawLineOverlay(l) {
  if (!l.path || l.path.length < 2) return;
  const pl = new google.maps.Polyline({ path: l.path, strokeColor: l.color, strokeWeight: lineW(), strokeOpacity: 0.95, clickable: false, zIndex: 15, map });
  mapOverlays.push(pl);
  if (LabelOverlay && !l.hideLabel) {
    const b = new google.maps.LatLngBounds(); l.path.forEach((p) => b.extend(p));
    const label = new LabelOverlay(b, l.name, fmtLen(l.length), map);
    mapOverlays.push(label);
  }
}
function renderMap() {
  clearMap();
  if (state.draft) {
    state.areas.forEach((a) => { if (a.id !== state.activeId && !a.hidden) drawArea(a, { faint: true }); });
    if (!state.draft.hidden) drawArea(state.draft, { faint: false, active: true });
  } else {
    state.areas.forEach((a) => { if (!a.hidden) drawArea(a, { faint: false, onClick: () => openEditor(a.id) }); });
  }
  state.lines.forEach((l) => { if (!l.hidden) drawLineOverlay(l); });
  // While the active boundary is editable, a map-level mouseup also ends a drag gesture
  // (releasing off the shape) — backstop for the per-overlay mouseup/dragend.
  if (state.draft && state.draft.boundary && state.drawMode === "select") {
    editListeners.push(map.addListener("mouseup", finalizeEditGesture));
  }
}

/* ── transactional editor ──────────────────────────────────────────────── */
const MAX_UNDO = 40;
function pushUndo() {
  undoStack.push(clone({ boundary: state.draft.boundary, cutouts: state.draft.cutouts }));
  if (undoStack.length > MAX_UNDO) undoStack.shift(); // bound memory in long sessions
  redoStack.length = 0;
}
function undo() {
  if (state.lineDraft && state.drawShape === "line") { removeLastLinePoint(); return; }
  if (!undoStack.length) return;
  redoStack.push(clone({ boundary: state.draft.boundary, cutouts: state.draft.cutouts }));
  const s = undoStack.pop(); state.draft.boundary = s.boundary; state.draft.cutouts = s.cutouts;
  afterDraftChange();
  renderPanel();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(clone({ boundary: state.draft.boundary, cutouts: state.draft.cutouts }));
  const s = redoStack.pop(); state.draft.boundary = s.boundary; state.draft.cutouts = s.cutouts;
  afterDraftChange();
  renderPanel();
}
function afterDraftChange() {
  autoCommit();
  renderMap();
  // Only patch the specific DOM nodes that changed — avoid full re-render.
  patchSqft();
  reArm();
  recomputeLive();
}
// Patch just the sqft numbers without rebuilding the whole panel.
function patchSqft() {
  const d = state.draft;
  if (!d) return;
  const gross = areaOf(d.boundary);
  const net = (d.cutouts && d.cutouts.length > 0) ? (d._net != null ? d._net : gross) : gross;
  const cuts = gross - net;

  const an = $("activeNet"); if (an) an.textContent = sqftOnly(net);
  const ls = $("liveSqft"); if (ls) ls.innerHTML = sqftOnly(net) + ' <small>' + unitSuffix() + '</small>';
  const lg = $("liveGross"); if (lg) lg.innerHTML = sqftOnly(gross) + ' <small>' + unitSuffix() + '</small>';
  const lc = $("liveCuts"); if (lc) lc.innerHTML = '-' + sqftOnly(cuts) + ' <small>' + unitSuffix() + '</small>';
  const lp = $("livePerim"); if (lp) lp.textContent = fmtLen(areaEdging(d));

  const tg = $("totalGrass"); if (tg) tg.textContent = fmtArea(totalDisplay());
  const te = $("totalEdging"); if (te) te.textContent = fmtLen(totalEdging()) + " of edging";
  // Also update the category total pill for the active area's group
  if (d.groupId) {
    const grpEls = document.querySelectorAll(".tz-group-hdr");
    grpEls.forEach(hdr => {
      if (hdr.getAttribute("data-group") === d.groupId) {
        const pill = hdr.querySelector(".tz-gtotal");
        if (pill) {
          const grpAreas = state.areas.filter(a => a.groupId === d.groupId);
          const total = grpAreas.reduce((s, a) => s + (a.id === state.activeId ? (d._net || 0) : (a.net || 0)), 0);
          pill.innerHTML = sqftOnly(total) + ' <small style="color:var(--text-dim);font-weight:500;">' + unitSuffix() + '</small>';
        }
      }
    });
  }
}

function openEditor(id, groupId = null) {
  if (state.draft) {
    if (id === state.activeId) return;
    autoCommit(); closeEditor();
  }
  const a = id ? state.areas.find((x) => x.id === id) : null;
  if (a) {
    state.activeId = a.id;
    state.draft = clone(a);
    // Ensure the draft starts with the known net area so UI doesn't flash raw boundary area
    if (a.net != null) state.draft._net = a.net;
  }
  else {
    const grp = groupId ? state.groups.find((g) => g.id === groupId) : null;
    const base = grp ? grp.name : "Area";
    const countInGroup = state.areas.filter((x) => x.groupId === groupId).length;
    const color = grp && grp.color ? grp.color : (state.settings ? state.settings.defaultColor : SWATCHES[0]);
    const opacity = state.settings ? state.settings.defaultOpacity : 0.35;
    state.activeId = "a" + state.seq++;
    state.draft = { id: state.activeId, name: base + " " + (countInGroup + 1), color, opacity, boundary: null, cutouts: [], collapsed: false, hidden: false, net: 0, groupId: groupId };
  }
  undoStack.length = 0; redoStack.length = 0;
  state.drawMode = state.draft.boundary ? "select" : "boundary";
  state.activeTool = state.draft.boundary ? "select" : state.drawShape;
  stylePanelOpen = false; // each area starts with the Style panel collapsed
  renderMap(); renderPanel(); reArm(); recomputeLive();
  if (state.draft.boundary) { const b = geomBounds(state.draft.boundary); if (b) map.fitBounds(b); }
}
// Auto-commit: sync the current draft into state.areas immediately, using the net
// we already know (state.draft._net). Does NOT call the worker — geometry changes
// recompute the net via recomputeLive(); metadata changes (name/colour/opacity/group)
// don't change the area at all.
function autoCommit() {
  if (!state.draft || !state.draft.boundary) return;
  const gross = areaOf(state.draft.boundary);
  state.draft.net = (state.draft.cutouts && state.draft.cutouts.length > 0) ? (state.draft._net != null ? state.draft._net : gross) : gross;
  const committed = clone(state.draft);
  const idx = state.areas.findIndex(x => x.id === state.activeId);
  if (idx >= 0) state.areas[idx] = committed; else state.areas.push(committed);
  save();
}
function closeEditor() {
  if (!state.draft) return;
  disarmDraw();
  state.draft = null; state.activeId = null;
  undoStack.length = 0; redoStack.length = 0;
  renderMap(); renderPanel();
}

function reArm() {
  if (state.drawMode === "boundary") armBoundary();
  else if (state.drawMode === "cutout") armCutout();
  else if (state.drawMode === "line") armLine();
  else armSelect();
}
function armSelect() {
  state.drawMode = "select";
  state.activeTool = "select";
  disarmDraw();
  // Re-enable clickability is handled automatically by the next renderMap call
  // via drawArea which sets clickable:false only in non-select modes
  enableVertexEditing();
  applyModeChrome();
}

// In select mode the active boundary/cutouts are already made editable+draggable by
// drawArea/renderMap; nothing extra to arm here. (Kept as a hook in case select mode
// ever needs map-level setup.)
function enableVertexEditing() {}

/* ── live shape editing (drag / delete vertices) ───────────────────────────
   Each drag gesture is ONE undo step: the first geometry change snapshots the
   pre-edit boundary+cutouts into editPre; releasing the mouse (finalizeEditGesture)
   pushes that snapshot onto the undo stack and commits. Live changes update the
   draft + sqft readout WITHOUT a re-render, so the drag stays smooth — Google
   renders the overlay itself while the gesture is in flight. */
function readOverlayGeom(ov, type) {
  if (type === "circle") {
    const c = ov.getCenter();
    return { type: "circle", center: { lat: c.lat(), lng: c.lng() }, radius: ov.getRadius() };
  }
  if (type === "rectangle") {
    const b = ov.getBounds(), ne = b.getNorthEast(), sw = b.getSouthWest();
    return { type: "rectangle", bounds: { north: ne.lat(), south: sw.lat(), east: ne.lng(), west: sw.lng() } };
  }
  return { type: "polygon", path: ov.getPath().getArray().map((p) => ({ lat: p.lat(), lng: p.lng() })) };
}
function snapshotForEdit() {
  if (!editPre && state.draft) editPre = clone({ boundary: state.draft.boundary, cutouts: state.draft.cutouts });
}
// Live update during a gesture — patch numbers + recompute net, but never re-render.
function liveEditUpdate() { patchSqft(); recomputeLive(); }
function onBoundaryEdit(ov, type) {
  if (!state.draft) return;
  snapshotForEdit();
  state.draft.boundary = readOverlayGeom(ov, type);
  liveEditUpdate();
}
function onCutoutEdit(ov, cid, type) {
  if (!state.draft) return;
  snapshotForEdit();
  const c = (state.draft.cutouts || []).find((x) => x.id === cid);
  if (c) c.geometry = readOverlayGeom(ov, type);
  liveEditUpdate();
}
// Mouse release: commit the gesture as a single undo step, then resync overlays + label.
function finalizeEditGesture() {
  if (!editPre) return;
  undoStack.push(editPre);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  editPre = null;
  afterDraftChange();
}
// Right-click a polygon vertex to delete it (keep at least a triangle).
function removeVertexAt(ov, idx) {
  if (!state.draft) return;
  const path = ov.getPath();
  if (path.getLength() <= 3) { toast("A shape needs at least 3 points."); return; }
  snapshotForEdit();
  path.removeAt(idx); // fires remove_at → onBoundaryEdit reads the new path back
  finalizeEditGesture();
}
// Wire one editable overlay: per-type geometry-change events + whole-shape drag,
// all collected in editListeners so clearMap() tears them down on the next render.
function wireEditable(ov, type, onEdit, isBoundary) {
  if (type === "polygon") {
    const p = ov.getPath();
    editListeners.push(google.maps.event.addListener(p, "set_at", onEdit));
    editListeners.push(google.maps.event.addListener(p, "insert_at", onEdit));
    editListeners.push(google.maps.event.addListener(p, "remove_at", onEdit));
    if (isBoundary) editListeners.push(ov.addListener("rightclick", (e) => { if (e.vertex != null) removeVertexAt(ov, e.vertex); }));
  } else if (type === "rectangle") {
    editListeners.push(ov.addListener("bounds_changed", onEdit));
  } else { // circle
    editListeners.push(ov.addListener("radius_changed", onEdit));
    editListeners.push(ov.addListener("center_changed", onEdit));
  }
  // Whole-shape drag is disabled (draggable:false) to prevent accidental moves;
  // mouseup ends a vertex-drag gesture (the map-level mouseup in renderMap is a backstop).
  editListeners.push(ov.addListener("mouseup", finalizeEditGesture));
}
function armBoundary() { state.drawMode = "boundary"; state.activeTool = state.drawShape; armDraw(onBoundaryDraw); applyModeChrome(); }
function armCutout() { state.drawMode = "cutout"; state.activeTool = state.drawShape; armDraw(onCutoutDraw); applyModeChrome(); }
function armLine() { state.drawMode = "line"; state.drawShape = "line"; state.activeTool = "line"; armDraw(onLineDraw); applyModeChrome(); }

// Start drawing a new line (its own mini-draft, independent of the area editor).
function startLineDraft(groupId) {
  if (state.draft) { autoCommit(); closeEditor(); }
  const grp = groupId ? state.groups.find((g) => g.id === groupId) : null;
  const count = state.lines.filter((l) => l.groupId === groupId).length;
  const color = grp && grp.color ? grp.color : (state.settings.defaultColor || "#34c759");
  state.lineDraft = { id: "l" + state.lineSeq++, name: (grp ? grp.name : "Line") + " line " + (count + 1), color, groupId: groupId || null };
  state.drawShape = "line";
  renderMap(); renderPanel(); armLine();
}
// Toolbar Line button: draw a line in the most sensible category — the area being
// edited, else the only/first category. If no categories exist, ask to make one.
function startLineFromToolbar() {
  let gid = null;
  if (state.draft && state.draft.groupId) gid = state.draft.groupId;
  else if (state.groups.length === 1) gid = state.groups[0].id;
  else if (state.groups.length > 1) gid = state.groups[0].id;
  if (!state.groups.length) { toast("Add a category first, then draw a line into it."); return; }
  startLineDraft(gid);
}
function cancelLineDraft() {
  state.lineDraft = null;
  state.drawShape = "polygon";
  disarmDraw();
  state.drawMode = "select";
  state.activeTool = "select";
  renderMap(); renderPanel();
}
function onLineDraw(geom) {
  const d = state.lineDraft;
  if (!d) return;
  const line = { id: d.id, name: d.name, color: d.color, groupId: d.groupId, path: geom.path, length: lineLength(geom.path), hidden: false, hideLabel: false };
  state.lines.push(line);
  state.lineDraft = null;
  state.drawShape = "polygon";
  state.drawMode = "select";
  disarmDraw();
  save(); renderMap(); renderPanel();
}
function deleteLine(id) {
  const l = state.lines.find((x) => x.id === id);
  if (!l) return;
  if (!confirm('Delete "' + l.name + '"?')) return;
  state.lines = state.lines.filter((x) => x.id !== id);
  save(); renderMap(); renderPanel();
}
function renameLine(id) {
  const l = state.lines.find((x) => x.id === id);
  if (!l) return;
  const n = prompt("Rename line:", l.name);
  if (n && n.trim()) { l.name = n.trim(); save(); renderMap(); renderPanel(); }
}
function toggleLineHidden(id) {
  const l = state.lines.find((x) => x.id === id);
  if (!l) return;
  l.hidden = !l.hidden; save(); renderMap(); renderPanel();
}
function setLineColor(id, c) {
  const l = state.lines.find((x) => x.id === id);
  if (!l) return;
  l.color = c; save(); renderMap(); renderPanel();
}
// Recolor the editor header (green = boundary, red = removing) live when the mode changes.
function applyModeChrome() {
  const cut = state.drawMode === "cutout";
  const sel = state.drawMode === "select";
  const dock = $("dock");
  if (dock) dock.style.background = cut ? "var(--red-head)" : "var(--green)";
  const act = $("dockActive");
  if (act) {
    const action = cut ? "Subtracting" : (sel ? "Editing" : "Adding");
    const name = state.draft ? state.draft.name : "";
    const canReshape = sel && state.draft && state.draft.boundary;
    const hint = canReshape
      ? ' <span style="opacity:0.8;font-weight:400;font-size:13px;margin-left:8px;">Drag a point to reshape · right-click a point to delete</span>'
      : (sel ? '' : ' <span style="opacity:0.8;font-weight:400;font-size:13px;margin-left:8px;">(Esc to cancel)</span>');
    act.innerHTML = '<span class="pulse"></span>' + action + ' - ' + esc(name) + hint;
  }
  markTools();

  document.querySelectorAll(".tz-inline-add").forEach(b => b.style.display = cut ? "none" : "flex");
  document.querySelectorAll(".tz-inline-cancel").forEach(b => b.style.display = cut ? "flex" : "none");
}
function setShape(s) {
  state.drawShape = s; state.activeTool = s;
  // Re-arm only if we're actively drawing into a draft; when idle this just picks the next shape.
  if (state.draft && (state.drawMode === "boundary" || state.drawMode === "cutout")) reArm();
  markTools();
}
// Highlight exactly one toolbar tool (Select / Area / Line / Rect / Circle) — the active one.
function markTools() {
  const t = state.activeTool || "select";
  const sb = $("modeSelectBtn"); if (sb) sb.classList.toggle("active", t === "select");
  const lb = $("lineToolBtn"); if (lb) lb.classList.toggle("active", t === "line");
  document.querySelectorAll(".shape-btn").forEach((b) => b.classList.toggle("active", b.getAttribute("data-shape") === t));
}
function onBoundaryDraw(geom) {
  pushUndo();
  state.draft.boundary = simplifyGeom(geom);
  state.drawMode = "select"; // boundary done → move to select
  state.activeTool = "select";
  afterDraftChange();
  renderPanel();
}
function onCutoutDraw(geom) {
  pushUndo();
  state.draft.cutouts.push({ id: "c" + state.cutSeq++, geometry: simplifyGeom(geom) });
  // Stay in cutout mode so the user can immediately draw another cutout
  afterDraftChange();
  renderPanel();
  // Re-arm cutout mode after the re-render
  armCutout();
}
function deleteCutout(cid) {
  pushUndo();
  state.draft.cutouts = state.draft.cutouts.filter((c) => c.id !== cid);
  afterDraftChange();
  renderPanel();
}

const recomputeLive = debounce(() => {
  if (!state.draft) return;
  const id = state.activeId; // remember which area we're computing for
  computeNet(state.draft.boundary, state.draft.cutouts).then((r) => {
    // The editor may have closed or switched areas during the async compute — bail
    // rather than throwing on a null draft or writing a stale result to another area.
    if (!state.draft || state.activeId !== id) return;
    state.draft._net = r.netArea;
    state.draft.net = r.netArea;
    // keep the committed copy's net in sync too
    const idx = state.areas.findIndex((a) => a.id === state.activeId);
    if (idx >= 0) state.areas[idx].net = r.netArea;
    // Patch only the numbers + the on-map label — no full re-render.
    const el = $("liveSqft"); if (el) el.textContent = sqftOnly(r.netArea);
    const an = $("activeNet"); if (an) an.textContent = sqftOnly(r.netArea);
    const tg = $("totalGrass"); if (tg) tg.textContent = fmtArea(totalDisplay());
    if (activeLabel) activeLabel.setContent(state.draft.name, sqftOnly(r.netArea) + " " + unitSuffix());
    save();
  });
}, 400); // 400ms debounce — worker is expensive, batch rapid changes

function refreshArea(a) {
  // After committing, recompute the stored net for this area then patch just the numbers.
  computeNet(a.boundary, a.cutouts).then((r) => {
    a.net = r.netArea;
    const tg = $("totalGrass"); if (tg) tg.textContent = fmtArea(totalDisplay());
    const an = $("activeNet"); if (an) an.textContent = sqftOnly(r.netArea);
    save();
  });
}
function totalDisplay() {
  let t = 0;
  state.areas.forEach((a) => {
    t += (state.draft && a.id === state.activeId && state.draft._net != null) ? state.draft._net : (a.net || 0);
  });
  if (state.draft && !state.areas.find((a) => a.id === state.activeId)) t += state.draft._net || 0;
  return t;
}
function totalEdging() {
  let t = 0;
  state.areas.forEach((a) => { t += (state.draft && a.id === state.activeId) ? areaEdging(state.draft) : areaEdging(a); });
  if (state.draft && !state.areas.find((a) => a.id === state.activeId)) t += areaEdging(state.draft);
  return t;
}

/* ── panel rendering ───────────────────────────────────────────────────── */
function renderPanel() {
  const editing = !!state.draft;
  const rows = state.areas.slice();
  if (state.draft && !state.areas.find((a) => a.id === state.activeId)) rows.push(state.draft);

  // Show onboarding card when no categories exist yet
  const oc = $("onboardCard");
  if (oc) oc.hidden = state.groups.length > 0;

  let treeHtml = "";
  if (!rows.length && !state.groups.length && !state.lines.length) {
    treeHtml = '<div class="area-empty">No areas yet. Create a category or add your first area.</div>';
  } else {
    // Render groups
    state.groups.forEach((g) => {
      const gRows = rows.filter((r) => (r.id === state.activeId && editing ? state.draft.groupId : r.groupId) === g.id);
      const gLines = state.lines.filter((l) => l.groupId === g.id);
      treeHtml += treeGroupHtml(g, gRows, gLines);
    });
    // Render ungrouped
    const ugRows = rows.filter((r) => !(r.id === state.activeId && editing ? state.draft.groupId : r.groupId));
    const ugLines = state.lines.filter((l) => !l.groupId);
    if (ugRows.length || ugLines.length) {
      treeHtml += treeGroupHtml(null, ugRows, ugLines);
    }
  }

  $("panel").innerHTML =
    '<div class="total-card card">' +
      '<div class="total-content">' +
        '<div class="total-label">Total measured area</div>' +
        '<div class="total-value" id="totalGrass">' + fmtArea(totalDisplay()) + '</div>' +
        '<div class="total-sub"><span id="totalEdging">' + fmtLen(totalEdging()) + ' of edging</span>' +
          (state.lines.length ? ' &middot; ' + fmtLen(totalLines()) + ' of lines' : '') + '</div>' +
      '</div>' +
    '</div>' +
    dockHtml() +
    '<div class="tree-region-wrap">' +
    '<div class="tree-region" id="treeRegion">' +
      '<div class="areas-hdr">' +
        '<h3 class="areas-hdr-title">Your areas</h3>' +
        '<div class="areas-hdr-actions">' +
          '<button id="toggleAllBtn" class="areas-hdr-icon" title="Toggle visibility"><i class="ti ti-eye"></i></button>' +
          '<button id="calcBtn" class="areas-hdr-icon" title="Material calculator"><i class="ti ti-calculator"></i></button>' +
          '<button id="settingsBtn" class="areas-hdr-icon" title="Settings"><i class="ti ti-settings"></i></button>' +
          '<button class="add-cat-pill" onclick="addGroup()"><i class="ti ti-folder-plus"></i> Add Category</button>' +
        '</div>' +
      '</div>' +
      '<div class="tree' + (state.draft && state.activeId ? ' has-active' : '') + '">' + treeHtml + "</div>" +
      '<div class="ov-data">' +
        '<button id="exportBtn"><i class="ti ti-download"></i> Export</button>' +
        '<button id="importBtn"><i class="ti ti-upload"></i> Import</button>' +
        '<button id="clearAll" class="danger"><i class="ti ti-x"></i> Clear</button>' +
        '<input id="importFile" type="file" accept="application/json" hidden />' +
    "</div>" +
    "</div>" +
    "</div>";

  // Wire scroll fade
  const tr = $("treeRegion");
  const wrap = tr ? tr.closest(".tree-region-wrap") : null;
  function updateScrollFade() {
    if (!tr || !wrap) return;
    const canScroll = tr.scrollHeight > tr.clientHeight + 4;
    wrap.classList.toggle("can-scroll", canScroll && tr.scrollTop < tr.scrollHeight - tr.clientHeight - 4);
  }
  if (tr) { tr.addEventListener("scroll", updateScrollFade); updateScrollFade(); }

  const addCatTop = $("addCatBtnTop"); if (addCatTop) addCatTop.onclick = addGroup;
  $("exportBtn").onclick = exportJSON;
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = importJSON;
  $("clearAll").onclick = clearAll;
  wireTree();
  // The toolbar (Select / Area / Line / Rect / Circle / Undo / Redo) is always visible, so
  // wire it and refresh its highlight on every render — not only while editing.
  wireToolbar();
  if (editing) { wireDock(); applyModeChrome(); }
  markTools();
}

function lineRowHtml(l) {
  const hidden = !!l.hidden;
  return '<div class="tz-card card tz-line-card' + (hidden ? " hidden" : "") + '" style="border-left:4px solid ' + l.color + '">' +
    '<div class="tz-card-hdr">' +
      '<label class="tz-line-icon tz-lcolor" style="color:' + l.color + '" title="Change line color"><i class="ti ti-line"></i>' +
        '<input type="color" value="' + l.color + '" data-lcolor="' + l.id + '" style="position:absolute;opacity:0;width:0;height:0;"></label>' +
      '<div class="tz-card-info">' +
        '<div class="tz-card-title"><span class="tz-card-name">' + esc(l.name) + '</span></div>' +
        '<div class="tz-card-stats">Line &middot; ' + fmtLen(l.length) + '</div>' +
      '</div>' +
      '<div class="tz-card-net"><div class="tz-card-net-val">' + Math.round(l.length * (state.settings.units === "metric" ? 1 : 3.280839895)).toLocaleString() + '</div><div class="tz-card-net-unit">' + (state.settings.units === "metric" ? "m" : "ft") + '</div></div>' +
      '<div class="tz-card-sep"></div>' +
      '<div class="tz-card-actions">' +
        '<button class="tz-act-btn tz-lrename" data-lrename="' + l.id + '"><i class="ti ti-pencil"></i><span>Rename</span></button>' +
        '<button class="tz-act-btn tz-leye' + (hidden ? " off" : "") + '" data-leye="' + l.id + '"><i class="ti ti-eye' + (hidden ? "-off" : "") + '"></i><span>Hide</span></button>' +
        '<button class="tz-act-btn tz-ldel" data-ldel="' + l.id + '"><i class="ti ti-trash"></i><span>Delete</span></button>' +
      '</div>' +
    '</div>' +
  '</div>';
}
function treeGroupHtml(g, areas, lines) {
  lines = lines || [];
  let h = "";
  if (g) {
    const col = g.color || "#9aa0a6";
    const total = areas.reduce((s, a) => s + (a.net || 0), 0);
    const anyHidden = areas.length && areas.every(a => a.hidden);
    h += '<div class="tz-group"><div class="tz-group-hdr" data-group="' + g.id + '">' +
         '<span class="tz-chev" data-gcollapse="' + g.id + '"><i class="ti ti-chevron-' + (g.collapsed ? "right" : "up") + '"></i></span>' +
         '<span class="tz-gcolor" style="background:' + col + '"></span>' +
         '<span class="tz-gname">' + esc(g.name) + '</span>' +
         '<span class="tz-gtotal">' + sqftOnly(total) + ' <small>' + unitSuffix() + '</small></span>' +
         '<span class="tz-gactions">' +
           '<button class="tz-gbtn tz-grename" data-grename="' + g.id + '" title="Rename"><i class="ti ti-pencil"></i><span>Rename</span></button>' +
           '<button class="tz-gbtn tz-geye" data-geye="' + g.id + '" title="Hide all"><i class="ti ti-eye' + (anyHidden ? "-off" : "") + '"></i><span>Hide</span></button>' +
           '<button class="tz-gbtn tz-gdel" data-gdel="' + g.id + '" title="Delete category"><i class="ti ti-trash"></i><span>Delete</span></button>' +
         '</span>' +
         '</div>';
    if (g.collapsed) return h + '</div>';
  }
  h += '<div class="tz-group-items">';
  if (!areas.length && !lines.length && g) h += '<div class="tz-cut empty" style="padding-left:16px;">Nothing in this category yet.</div>';
  else h += areas.map(treeAreaHtml).join("") + lines.map(lineRowHtml).join("");
  h += '</div>';
  if (g) {
    const col = g.color || "#34c759";
    h += '<button class="tz-add-area tz-add-area-btn" data-add-to="' + g.id + '" style="--gc:' + col + '">' +
         '<i class="ti ti-plus"></i> Add Area to ' + esc(g.name) + '</button>';
  }
  h += '</div>';
  return h;
}

function quickCreateCategory(name, color, startDrawing) {
  const m = $("catModalOverlay"); if (m) m.remove();
  let g = state.groups.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!g) {
    g = { id: "g" + state.grpSeq++, name, color: color || GROUP_COLORS[state.groups.length % GROUP_COLORS.length], collapsed: false };
    state.groups.push(g);
    save();
    renderPanel();
  }
  if (startDrawing) {
    openEditor(null, g.id);
  }
};
function customCreateCategory(startDrawing) {
  const input = $("customCatInput");
  if (input && input.value.trim()) {
    quickCreateCategory(input.value.trim(), null, startDrawing);
  }
};
function closeCategoryModal() {
  const m = $("catModalOverlay"); if (m) m.remove();
};
function openCategoryModal(startDrawing = false) {
  const defaults = [
    { name: 'Lawn', icon: 'ti-plant-2' },
    { name: 'Pavement', icon: 'ti-road' },
    { name: 'Flower Beds', icon: 'ti-flower' },
    { name: 'Driveway', icon: 'ti-car' },
    { name: 'Patio', icon: 'ti-armchair' },
    { name: 'Mulch', icon: 'ti-leaf' },
  ];
  const btns = defaults.map((d, i) => {
    const col = GROUP_COLORS[i % GROUP_COLORS.length];
    return `<button class="cat-chip" onclick="quickCreateCategory('${d.name}','${col}',${startDrawing})">` +
      `<span class="cat-chip-ic" style="background:${col}1f;color:${col}"><i class="ti ${d.icon}"></i></span>` +
      `<span class="cat-chip-nm">${d.name}</span></button>`;
  }).join('');
  const modalHtml = `
    <div id="catModalOverlay" class="cal-backdrop" onclick="if(event.target===this)closeCategoryModal()">
      <div class="cal-sheet" style="width:396px" role="dialog" aria-label="Add a category">
        <div class="cal-grab"></div>
        <div class="cal-head"><span class="cal-title">Add a category</span>
          <button type="button" class="cal-close" onclick="closeCategoryModal()" aria-label="Close"><i class="ti ti-x"></i></button></div>
        <p class="cal-sub">Pick a preset or name your own.</p>
        <div class="cat-grid">${btns}</div>
        <div class="cal-sec-label">Custom</div>
        <div class="cal-group"><div class="cal-row">
          <input type="text" id="customCatInput" class="cal-edit cat-custom" placeholder="Category name…" aria-label="Custom category name">
          <button type="button" class="cal-add-btn" onclick="customCreateCategory(${startDrawing})">Add</button>
        </div></div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  $("customCatInput").focus();
  $("customCatInput").onkeydown = (e) => { if (e.key === 'Enter') customCreateCategory(startDrawing); };
}

function closeSettingsModal() {
  const m = $("setModalOverlay"); if (m) m.remove();
};
function openSettingsModal() {
  const defOp = state.settings.defaultOpacity;
  const defCol = state.settings.defaultColor;
  const un = state.settings.units;
  const mt = state.settings.mapType;
  const sl = state.settings.showLabels;
  const sm = state.settings.smoothing;
  const ms = state.settings.magneticSnap !== false;
  const lw = state.settings.lineWeight != null ? state.settings.lineWeight : 4;
  const aw = state.settings.areaWeight != null ? state.settings.areaWeight : 2;
  
  const tog = (checked, fn) => `<label class="sw"><input type="checkbox" ${checked ? 'checked' : ''} onchange="${fn}"><span class="sw-track"></span><span class="sw-thumb"></span></label>`;
  const seg = (opts, cur, fn) => `<div class="cal-seg-mini">${opts.map(o => `<button type="button" class="${o.v === cur ? 'active' : ''}" onclick="${fn}('${o.v}');openSettingsModal()">${o.l}</button>`).join('')}</div>`;
  const swatches = SWATCHES.map(c =>
    `<button onclick="setDefColor('${c}')" class="swatch ${c === defCol ? 'active' : ''}" style="background:${c}"></button>`
  ).join('');
  const smLabel = sm < 0.05 ? 'Strict' : sm > 0.15 ? 'Smooth' : 'Normal';
  const catRows = state.groups.map(g => `
    <div class="cal-row set-cat-row">
      <label class="set-cat-color" style="background:${g.color}" title="Change color"><input type="color" value="${g.color}" onchange="updateCatColor('${g.id}', this.value)"></label>
      <span class="cal-lbl">${esc(g.name)}</span>
      <button class="set-icon-btn" onclick="renameGroup('${g.id}'); openSettingsModal();" aria-label="Rename ${esc(g.name)}"><i class="ti ti-pencil"></i></button>
      <button class="set-icon-btn" onclick="deleteGroup('${g.id}'); openSettingsModal();" aria-label="Delete ${esc(g.name)}"><i class="ti ti-trash"></i></button>
    </div>`).join('');

  const modalHtml = `
    <div id="setModalOverlay" class="cal-backdrop" onclick="if(event.target===this)closeSettingsModal()">
      <div class="cal-sheet" role="dialog" aria-label="Settings">
        <div class="cal-grab"></div>
        <div class="cal-head"><span class="cal-title">Settings</span>
          <button type="button" class="cal-close" onclick="closeSettingsModal()" aria-label="Close"><i class="ti ti-x"></i></button></div>

        <div class="cal-sec-label">Map</div>
        <div class="cal-group">
          <div class="cal-row"><span class="cal-lbl">Map style</span>${seg([{ v: 'hybrid', l: 'Hybrid' }, { v: 'satellite', l: 'Satellite' }], mt, 'updateMapType')}</div>
          <div class="cal-row"><span class="cal-lbl">Units</span>${seg([{ v: 'imperial', l: 'Imperial' }, { v: 'metric', l: 'Metric' }], un, 'updateUnits')}</div>
          <div class="cal-row"><span class="cal-lbl">Show map labels</span>${tog(sl, 'updateShowLabels(this.checked)')}</div>
        </div>

        <div class="cal-sec-label">Areas</div>
        <div class="cal-group">
          <div class="cal-row cal-row-slider"><div class="cal-slider-top"><span class="cal-lbl">Default opacity</span><span class="v">${Math.round(defOp * 100)}%</span></div>
            <input type="range" min="10" max="80" value="${Math.round(defOp * 100)}" oninput="updateDefOpacity(this.value)" onchange="openSettingsModal()"></div>
          <div class="cal-row"><span class="cal-lbl">Default color</span><div class="set-swatches">${swatches}</div></div>
          <div class="cal-row cal-row-slider"><div class="cal-slider-top"><span class="cal-lbl">Area outline</span><span class="v">${aw} px</span></div>
            <input type="range" min="0" max="12" value="${aw}" oninput="updateAreaWeight(this.value)" onchange="openSettingsModal()"></div>
          <div class="cal-row cal-row-slider"><div class="cal-slider-top"><span class="cal-lbl">Line thickness</span><span class="v">${lw} px</span></div>
            <input type="range" min="0" max="12" value="${lw}" oninput="updateLineWeight(this.value)" onchange="openSettingsModal()"></div>
        </div>

        <div class="cal-sec-label">Drawing</div>
        <div class="cal-group">
          <div class="cal-row cal-row-slider"><div class="cal-slider-top"><span class="cal-lbl">Smoothing</span><span class="v">${smLabel}</span></div>
            <input type="range" min="2" max="25" value="${sm * 100}" oninput="updateSmoothing(this.value)" onchange="openSettingsModal()"></div>
          <div class="cal-row"><span class="cal-lbl">Magnetic snapping</span>${tog(ms, 'updateMagneticSnap(this.checked)')}</div>
        </div>

        <div class="cal-sec-label">Categories</div>
        <div class="cal-group">
          ${catRows || '<div class="cal-row"><span class="cal-lbl" style="color:var(--text-dim)">No categories yet.</span></div>'}
        </div>
      </div>
    </div>`;
  const existing = $("setModalOverlay");
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
};

/* ── material calculator ──────────────────────────────────────────────────
 * Turns the measured area (total, a category, or a typed custom number) into
 * "how much to buy" for seed / fertilizer / mulch / sod. Lawn-care product
 * rates are universally imperial, so the math runs in sq ft regardless of the
 * app's display-unit setting. Inputs persist in state.settings.calc.            */
const SEED_PRESETS = {
  "tall-fescue":   { label: "Tall Fescue",        new: 8,   over: 4 },
  "kentucky-blue": { label: "Kentucky Bluegrass", new: 2.5, over: 1.5 },
  "perennial-rye": { label: "Perennial Ryegrass", new: 7,   over: 4 },
  "fine-fescue":   { label: "Fine Fescue",        new: 4,   over: 2 },
  "bermuda":       { label: "Bermudagrass",       new: 1.5, over: 1 },
  "custom":        { label: "Custom / other",     new: 6,   over: 3 },
};
const MATERIALS = [
  { k: "seed",       label: "Seed",       icon: "ti-seeding" },
  { k: "fertilizer", label: "Fertilizer", icon: "ti-flask" },
  { k: "mulch",      label: "Mulch",      icon: "ti-leaf" },
  { k: "sod",        label: "Sod",        icon: "ti-stack-2" },
];
const CALC_DEFAULTS = {
  material: "seed", source: "total", customSqft: 1000,
  seedType: "tall-fescue", seedMode: "new", seedRate: 8, seedPrice: 0,
  fertN: 0.75, fertPct: 24, fertBag: 50, fertPrice: 0,
  mulchDepth: 3, mulchBag: 2, mulchPrice: 0,
  sodWaste: 7, sodPallet: 450, sodPrice: 0,
};
let calc = null;
function calcInit() {
  if (!calc) calc = Object.assign({}, CALC_DEFAULTS, (state.settings && state.settings.calc) || {});
  return calc;
}
function calcPersist() { state.settings.calc = Object.assign({}, calc); save(); }
function fmtSqft(n) { return Math.round(n || 0).toLocaleString(); }
function calcLiveNet(a) { return (state.draft && a.id === state.activeId && state.draft._net != null) ? state.draft._net : (a.net || 0); }
function calcIsUngrouped(a) { return !a.groupId || !state.groups.find((g) => g.id === a.groupId); }
// Source is a multi-select set of areas ("pick" via calc.pickIds) or a manual "custom" size.
function calcSelectedAreas() {
  if (calc.source === "custom") return [];
  const set = new Set(calc.pickIds || []);
  return state.areas.filter((a) => set.has(a.id));
}
function calcAllSelected() { return state.areas.length > 0 && calc.source !== "custom" && state.areas.every((a) => (calc.pickIds || []).indexOf(a.id) !== -1); }
// Migrate legacy single-select values (total / cat: / area: / bare id) into the pick set; drop dangling ids.
function calcNormalizeSource() {
  const s = calc.source;
  if (s === "custom") return;
  if (s === "total") { calc.source = "pick"; calc.pickIds = state.areas.map((a) => a.id); return; }
  if (typeof s === "string" && s.indexOf("cat:") === 0) { const id = s.slice(4); calc.source = "pick"; calc.pickIds = state.areas.filter((a) => a.groupId === id).map((a) => a.id); return; }
  if (typeof s === "string" && s.indexOf("area:") === 0) { const id = s.slice(5); calc.source = "pick"; calc.pickIds = state.areas.find((a) => a.id === id) ? [id] : []; return; }
  if (s !== "pick" && state.groups.find((g) => g.id === s)) { calc.source = "pick"; calc.pickIds = state.areas.filter((a) => a.groupId === s).map((a) => a.id); return; }
  calc.source = "pick";
  if (!Array.isArray(calc.pickIds)) calc.pickIds = state.areas.map((a) => a.id);
  else { const ids = new Set(state.areas.map((a) => a.id)); calc.pickIds = calc.pickIds.filter((x) => ids.has(x)); }
}
function calcAreaSqft() {
  if (calc.source === "custom") return Math.max(0, parseFloat(calc.customSqft) || 0);
  let m2 = 0;
  calcSelectedAreas().forEach((a) => { m2 += calcLiveNet(a); });
  return m2 * SQFT_PER_M2;
}
function calcAreaLabel() {
  const note = state.settings.units === "metric" ? " · material math uses sq ft" : "";
  if (calc.source === "custom") return "sq ft" + note;
  const n = calcSelectedAreas().length;
  return "sq ft · " + n + " area" + (n === 1 ? "" : "s") + note;
}
function calcCompute() {
  const a = calcAreaSqft();
  if (a <= 0) return null;
  const f = (n, d = 0) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
  const M = calc.material;
  if (M === "seed") {
    const rate = parseFloat(calc.seedRate) || 0, price = parseFloat(calc.seedPrice) || 0;
    const lbs = (a / 1000) * rate;
    return { val: f(lbs, 1), unit: "lbs of seed",
      sub: `At <b>${rate} lbs / 1,000 sq ft</b> over <b>${f(a)} sq ft</b>.`,
      cost: price > 0 ? lbs * price : 0, costLbl: `${f(lbs, 1)} lbs × $${price.toFixed(2)}/lb` };
  }
  if (M === "fertilizer") {
    const nRate = parseFloat(calc.fertN) || 0, pct = parseFloat(calc.fertPct) || 0;
    const bag = parseFloat(calc.fertBag) || 0, price = parseFloat(calc.fertPrice) || 0;
    if (pct <= 0) return { val: "—", unit: "set the N %", sub: "Enter the first number from the bag's N-P-K (e.g. <b>24</b>-0-6 → 24)." };
    const lbsProduct = (a / 1000) * (nRate / (pct / 100));
    const bags = bag > 0 ? Math.ceil(lbsProduct / bag) : null;
    let sub = `Delivers <b>${nRate} lb N / 1,000 sq ft</b> from a <b>${pct}%</b>-N product over <b>${f(a)} sq ft</b>.`;
    if (bags != null) sub += ` ≈ <b>${bags}</b> × ${bag} lb bag${bags > 1 ? "s" : ""}.`;
    return { val: f(lbsProduct, 1), unit: "lbs of product", sub,
      cost: (price > 0 && bags != null) ? bags * price : 0, costLbl: `${bags} bag${bags > 1 ? "s" : ""} × $${price.toFixed(2)}` };
  }
  if (M === "mulch") {
    const depth = parseFloat(calc.mulchDepth) || 0, bag = parseFloat(calc.mulchBag) || 0, price = parseFloat(calc.mulchPrice) || 0;
    const cuft = a * (depth / 12), cuyd = cuft / 27;
    const bags = bag > 0 ? Math.ceil(cuft / bag) : null;
    let sub = `<b>${f(cuft)} cu ft</b> at <b>${depth}"</b> deep over <b>${f(a)} sq ft</b>.`;
    if (bags != null) sub += ` ≈ <b>${bags}</b> × ${bag} cu ft bag${bags > 1 ? "s" : ""}.`;
    return { val: f(cuyd, 1), unit: "cubic yards", sub,
      cost: (price > 0 && bags != null) ? bags * price : 0, costLbl: `${bags} bag${bags > 1 ? "s" : ""} × $${price.toFixed(2)}` };
  }
  if (M === "sod") {
    const waste = parseFloat(calc.sodWaste) || 0, pallet = parseFloat(calc.sodPallet) || 0, price = parseFloat(calc.sodPrice) || 0;
    const withWaste = a * (1 + waste / 100);
    const pallets = pallet > 0 ? Math.ceil(withWaste / pallet) : null;
    let sub = `<b>${f(a)} sq ft</b> + <b>${waste}%</b> waste = <b>${f(withWaste)} sq ft</b> to buy.`;
    if (pallets != null) sub += ` ≈ <b>${pallets}</b> pallet${pallets > 1 ? "s" : ""} (${pallet} sq ft each).`;
    return { val: f(withWaste), unit: "sq ft of sod", sub,
      cost: price > 0 ? withWaste * price : 0, costLbl: `${f(withWaste)} sq ft × $${price.toFixed(2)}/sq ft` };
  }
}
function calcResultHtml() {
  const r = calcCompute();
  if (!r) return '<div class="cal-hero-cap">Estimate</div><div class="cal-hero-empty">Draw an area, choose a category, or enter a custom size to see how much to buy.</div>';
  let h = '<div class="cal-hero-cap">You’ll need</div>' +
    '<div class="cal-hero-main"><span class="cal-hero-val">' + r.val + '</span><span class="cal-hero-unit">' + r.unit + '</span></div>';
  if (r.sub) h += '<div class="cal-hero-sub">' + r.sub + '</div>';
  if (r.cost && r.cost > 0) h += '<div class="cal-hero-cost"><span>Estimated cost</span><span class="cal-hero-cost-val">$' +
    r.cost.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</span></div>';
  return h;
}
// One iOS-style "menu" row: fully tappable, shows the current value + chevron; opens a custom popover.
function calcMenuRow(label, valueText, kind) {
  return '<div class="cal-row cal-row-menu" onclick="calcOpenMenu(this,\'' + kind + '\')">' +
    '<span class="cal-lbl">' + label + '</span>' +
    '<span class="cal-menu-val">' + esc(valueText) + '</span>' +
    '<i class="ti ti-selector cal-menu-chev"></i></div>';
}
// The display label for the current scope (Source row value).
function calcSourceLabel() {
  if (calc.source === "custom") return "Custom size";
  if (!state.areas.length) return "No areas yet";
  const sel = calcSelectedAreas();
  if (!sel.length) return "No areas selected";
  if (sel.length === state.areas.length) return "All areas";
  if (sel.length === 1) return sel[0].name;
  return sel.length + " areas";
}
function calcCloseMenu() {
  const m = document.getElementById("calMenu"); if (m) m.remove();
  const b = document.getElementById("calMenuBackdrop"); if (b) b.remove();
}
// Single-select popover (grass type / seeding job): pick one, closes.
function calcSimpleMenuInner(kind) {
  let items = [], cur = "";
  if (kind === "seedType") { cur = calc.seedType; Object.keys(SEED_PRESETS).forEach((k) => items.push({ value: k, label: SEED_PRESETS[k].label })); }
  else if (kind === "seedMode") { cur = calc.seedMode; items.push({ value: "new", label: "New lawn" }, { value: "over", label: "Overseed" }); }
  return items.map((it) =>
    '<div class="cal-mn-item' + (it.value === cur ? " on" : "") + '" onclick="calcMenuPick(\'' + kind + "','" + it.value + '\')">' +
    '<span class="cal-mn-label">' + esc(it.label) + '</span><i class="ti ti-check cal-mn-chk"></i></div>').join("");
}
// Multi-select Source popover: a checkbox per area; a category checkbox toggles all its areas.
function calcSourceMenuInner() {
  const sel = new Set(calc.source === "custom" ? [] : (calc.pickIds || []));
  const sq = (a) => calcLiveNet(a) * SQFT_PER_M2;
  const box = (cls) => '<i class="ti ti-' + cls + ' cal-mn-box"></i>';
  let h = '<div class="cal-mn-actions"><button type="button" class="cal-mn-act" onclick="calcMenuAll()">Select all</button>' +
          '<button type="button" class="cal-mn-act" onclick="calcMenuClear()">Clear</button></div><div class="cal-mn-div"></div>';
  const block = (g, areas) => {
    if (!areas.length) return "";
    const on = areas.filter((a) => sel.has(a.id));
    const st = on.length === areas.length ? "square-check on" : (on.length ? "square-minus on" : "square off");
    const col = (g && g.color) || "#9aa0a6";
    let s = '<div class="cal-mn-item cat" onclick="calcMenuToggleCat(\'' + (g ? g.id : "") + '\')">' + box(st) +
      '<span class="cal-mn-dot" style="background:' + col + '"></span>' +
      '<span class="cal-mn-label">' + (g ? esc(g.name) : "Ungrouped") + "</span>" +
      '<span class="cal-mn-count">' + on.length + "/" + areas.length + "</span></div>";
    s += areas.map((a) =>
      '<div class="cal-mn-item sub' + (sel.has(a.id) ? " on" : "") + '" onclick="calcMenuToggleArea(\'' + a.id + '\')">' + box(sel.has(a.id) ? "square-check on" : "square off") +
      '<span class="cal-mn-label">' + esc(a.name) + '</span><span class="cal-mn-count">' + fmtSqft(sq(a)) + "</span></div>").join("");
    return '<div class="cal-mn-grp">' + s + "</div>";
  };
  state.groups.forEach((g) => { h += block(g, state.areas.filter((a) => a.groupId === g.id)); });
  h += block(null, state.areas.filter(calcIsUngrouped));
  if (!state.areas.length) h += '<div class="cal-mn-head">No areas yet — draw one on the map, or use a custom size.</div>';
  h += '<div class="cal-mn-div"></div>' +
    '<div class="cal-mn-item' + (calc.source === "custom" ? " on" : "") + '" onclick="calcMenuCustom()">' +
    '<i class="ti ti-ruler-2 cal-mn-box" aria-hidden="true"></i><span class="cal-mn-label">Custom size…</span><i class="ti ti-check cal-mn-chk"></i></div>';
  return h;
}
function calcRenderSourceMenu() {
  const m = document.getElementById("calMenu"); if (m) m.innerHTML = calcSourceMenuInner();
  const sv = document.getElementById("calcSourceVal"); if (sv) sv.textContent = calcSourceLabel();
  calcRecompute();
}
// Build + position the popover anchored to the tapped row.
function calcOpenMenu(rowEl, kind) {
  calcCloseMenu();
  const inner = kind === "source" ? calcSourceMenuInner() : calcSimpleMenuInner(kind);
  document.body.insertAdjacentHTML("beforeend",
    '<div id="calMenuBackdrop" onclick="calcCloseMenu()"></div><div id="calMenu" class="cal-mn' + (kind === "source" ? " cal-mn-multi" : "") + '">' + inner + "</div>");
  const menu = document.getElementById("calMenu");
  const r = rowEl.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = r.right - mw - 12; if (left < 8) left = 8;
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) { top = r.top - mh - 4; if (top < 8) top = 8; }
  menu.style.left = left + "px"; menu.style.top = top + "px";
  const onItem = menu.querySelector(".cal-mn-item.on"); if (onItem) onItem.scrollIntoView({ block: "nearest" });
}
function calcMenuPick(kind, value) {
  calcCloseMenu();
  if (kind === "seedType") calcSetSeedType(value);
  else if (kind === "seedMode") calcSetSeedMode(value);
}
function calcMenuToggleArea(id) {
  if (calc.source === "custom") calc.source = "pick";
  const s = new Set(calc.pickIds || []); s.has(id) ? s.delete(id) : s.add(id); calc.pickIds = [...s];
  calcPersist(); calcRenderSourceMenu();
}
function calcMenuToggleCat(gid) {
  if (calc.source === "custom") calc.source = "pick";
  const areas = state.areas.filter((a) => (gid ? a.groupId === gid : calcIsUngrouped(a)));
  const s = new Set(calc.pickIds || []); const allOn = areas.length && areas.every((a) => s.has(a.id));
  areas.forEach((a) => { allOn ? s.delete(a.id) : s.add(a.id); }); calc.pickIds = [...s];
  calcPersist(); calcRenderSourceMenu();
}
function calcMenuAll() { calc.source = "pick"; calc.pickIds = state.areas.map((a) => a.id); calcPersist(); calcRenderSourceMenu(); }
function calcMenuClear() { calc.source = "pick"; calc.pickIds = []; calcPersist(); calcRenderSourceMenu(); }
function calcMenuCustom() { calc.source = "custom"; calcPersist(); calcCloseMenu(); openCalcModal(); }
// One stepper row: label left, optional unit + a −/[editable value]/+ stepper on the right.
function calcStepRow(label, optional, field, step, min, max, dec, unit) {
  const mn = min == null ? "null" : min, mx = max == null ? "null" : max;
  return '<div class="cal-row"><span class="cal-lbl">' + label + (optional ? ' <span class="cal-opt">optional</span>' : "") + '</span>' +
    '<div class="cal-ctl">' + (unit ? '<span class="cal-unit">' + unit + '</span>' : "") +
    '<div class="cal-stepper">' +
      '<button type="button" class="cal-step-btn" onclick="calcStep(\'' + field + '\',' + (-step) + ',' + mn + ',' + mx + ',' + dec + ')" aria-label="decrease ' + label + '"><i class="ti ti-minus"></i></button>' +
      '<input class="cal-step-val" data-stepfield="' + field + '" value="' + calc[field] + '" inputmode="decimal" oninput="calcSet(\'' + field + '\',this.value)" aria-label="' + label + '">' +
      '<button type="button" class="cal-step-btn cal-plus" onclick="calcStep(\'' + field + '\',' + step + ',' + mn + ',' + mx + ',' + dec + ')" aria-label="increase ' + label + '"><i class="ti ti-plus"></i></button>' +
    '</div></div></div>';
}
function calcInputsHtml() {
  const M = calc.material;
  if (M === "seed") {
    return '<div class="cal-sec-label">Seed</div><div class="cal-group">' +
      calcMenuRow("Grass type", SEED_PRESETS[calc.seedType].label, "seedType") +
      calcMenuRow("Job", calc.seedMode === "over" ? "Overseed" : "New lawn", "seedMode") +
      calcStepRow("Rate", false, "seedRate", 0.5, 0, 50, 1, "lb / 1k") +
      calcStepRow("Price", true, "seedPrice", 0.25, 0, 999, 2, "$ / lb") + "</div>";
  }
  if (M === "fertilizer") {
    return '<div class="cal-sec-label">Fertilizer</div><div class="cal-group">' +
      calcStepRow("Target N", false, "fertN", 0.05, 0, 5, 2, "lb / 1k") +
      calcStepRow("N in bag", false, "fertPct", 1, 0, 100, 0, "%") +
      calcStepRow("Bag size", false, "fertBag", 1, 1, 500, 0, "lb") +
      calcStepRow("Price / bag", true, "fertPrice", 1, 0, 999, 2, "$") + "</div>";
  }
  if (M === "mulch") {
    return '<div class="cal-sec-label">Mulch</div><div class="cal-group">' +
      calcStepRow("Depth", false, "mulchDepth", 0.5, 0, 24, 1, "in") +
      calcStepRow("Bag size", false, "mulchBag", 0.5, 0.5, 10, 1, "cu ft") +
      calcStepRow("Price / bag", true, "mulchPrice", 0.5, 0, 99, 2, "$") + "</div>";
  }
  if (M === "sod") {
    return '<div class="cal-sec-label">Sod</div><div class="cal-group">' +
      calcStepRow("Waste", false, "sodWaste", 1, 0, 50, 0, "%") +
      calcStepRow("Pallet size", false, "sodPallet", 10, 10, 2000, 0, "sq ft") +
      calcStepRow("Price", true, "sodPrice", 0.05, 0, 99, 2, "$ / sq ft") + "</div>";
  }
  return "";
}
function calcSourceHtml() {
  let h = '<div class="cal-sec-label">Measure for</div><div class="cal-group">' +
    '<div class="cal-row cal-row-menu" onclick="calcOpenMenu(this,\'source\')">' +
      '<span class="cal-lbl">Source</span>' +
      '<span class="cal-menu-val" id="calcSourceVal">' + esc(calcSourceLabel()) + '</span>' +
      '<i class="ti ti-selector cal-menu-chev"></i></div>';
  if (calc.source === "custom")
    h += '<div class="cal-row"><span class="cal-lbl">Area</span><div class="cal-ctl"><input class="cal-edit" inputmode="numeric" value="' + calc.customSqft + '" oninput="calcSet(\'customSqft\',this.value)" aria-label="Custom area in square feet"><span class="cal-unit">sq ft</span></div></div>';
  else
    h += '<div class="cal-row"><span class="cal-lbl">Area</span><span class="cal-area-val"><span id="calcAreaVal">' + fmtSqft(calcAreaSqft()) + '</span> <span class="cal-unit" id="calcAreaLbl">' + calcAreaLabel() + '</span></span></div>';
  h += "</div>";
  return h;
}
function openCalcModal() {
  calcInit();
  calcNormalizeSource();
  calcCloseMenu();
  const existing = $("calcModalOverlay"); if (existing) existing.remove();
  const seg = MATERIALS.map((m) => '<button type="button" class="cal-seg-item' + (calc.material === m.k ? " active" : "") + '" onclick="calcSetMaterial(\'' + m.k + '\')">' + m.label + "</button>").join("");
  const html =
    '<div id="calcModalOverlay" class="cal-backdrop" onclick="if(event.target===this)closeCalcModal()">' +
      '<div class="cal-sheet" role="dialog" aria-label="Material calculator">' +
        '<div class="cal-grab"></div>' +
        '<div class="cal-head"><span class="cal-title">Materials</span>' +
          '<button type="button" class="cal-close" onclick="closeCalcModal()" aria-label="Close"><i class="ti ti-x"></i></button></div>' +
        '<div class="cal-seg">' + seg + "</div>" +
        '<div class="cal-body">' +
          '<div class="cal-hero' + (calcCompute() ? "" : " empty") + '" id="calcResult">' + calcResultHtml() + "</div>" +
          calcSourceHtml() +
          calcInputsHtml() +
        "</div>" +
      "</div></div>";
  document.body.insertAdjacentHTML("beforeend", html);
}
function calcRecompute() {
  const cr = $("calcResult"); if (cr) { cr.className = "cal-hero" + (calcCompute() ? "" : " empty"); cr.innerHTML = calcResultHtml(); }
  const av = $("calcAreaVal"); if (av) av.textContent = fmtSqft(calcAreaSqft());
  const al = $("calcAreaLbl"); if (al) al.textContent = calcAreaLabel();
  const sv = $("calcSourceVal"); if (sv) sv.textContent = calcSourceLabel();
}
// Nudge a numeric field by ±step (clamped), keep the input in sync, recompute.
function calcStep(field, delta, min, max, dec) {
  let v = parseFloat(calc[field]); if (!isFinite(v)) v = 0;
  v += delta;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  v = parseFloat(v.toFixed(dec == null ? 2 : dec));
  calc[field] = v; calcPersist();
  const inp = document.querySelector('[data-stepfield="' + field + '"]'); if (inp) inp.value = v;
  calcRecompute();
}
function calcSet(field, val) { calc[field] = val; calcPersist(); calcRecompute(); }
function calcSetMaterial(m) { calc.material = m; calcPersist(); openCalcModal(); }
function calcSetSeedType(v) { calc.seedType = v; const p = SEED_PRESETS[v]; if (p) calc.seedRate = p[calc.seedMode === "over" ? "over" : "new"]; calcPersist(); openCalcModal(); }
function calcSetSeedMode(v) { calc.seedMode = v; const p = SEED_PRESETS[calc.seedType]; if (p) calc.seedRate = p[v === "over" ? "over" : "new"]; calcPersist(); openCalcModal(); }
function closeCalcModal() { calcCloseMenu(); const m = $("calcModalOverlay"); if (m) m.remove(); }

function updateDefOpacity(val) {
  state.settings.defaultOpacity = parseInt(val) / 100;
  save();
};
function setDefColor(c) {
  state.settings.defaultColor = c;
  save();
  openSettingsModal();
};
function updateCatColor(id, c) {
  const g = state.groups.find(x => x.id === id);
  if (!g) return;
  g.color = c;
  state.areas.filter(a => a.groupId === id).forEach(a => {
    a.color = c;
    refreshArea(a);
  });
  save();
  renderPanel();
};

function updateUnits(val) {
  state.settings.units = val;
  save();
  renderPanel();
  state.areas.forEach(refreshArea);
};
function updateMapType(val) {
  state.settings.mapType = val;
  save();
  if (map) map.setMapTypeId(val);
};
function updateShowLabels(val) {
  state.settings.showLabels = val;
  save();
  renderMap(); // rebuild overlays so labels show/hide immediately (not just on next pan/zoom)
};
function updateSmoothing(val) {
  state.settings.smoothing = parseInt(val) / 100;
  save();
};
function updateMagneticSnap(val) {
  state.settings.magneticSnap = val;
  save();
}
function updateLineWeight(val) {
  state.settings.lineWeight = parseInt(val);
  save();
  renderMap(); // re-stroke existing lines + any in-progress preview
}
function updateAreaWeight(val) {
  state.settings.areaWeight = parseInt(val);
  save();
  renderMap(); // re-stroke area boundaries + cutouts
};

function addGroup() {
  openCategoryModal(true);
}
function renameGroup(id) {
  const g = state.groups.find(x => x.id === id);
  if (!g) return;
  const name = prompt("Rename category:", g.name);
  if (name && name.trim()) { g.name = name.trim(); renderPanel(); save(); }
}
function deleteGroup(id) {
  const g = state.groups.find(x => x.id === id);
  if (!g) return;
  const containedAreas = state.areas.filter(a => a.groupId === id);
  const containedLines = state.lines.filter(l => l.groupId === id);
  const parts = [];
  if (containedAreas.length) parts.push(containedAreas.length + " area(s)");
  if (containedLines.length) parts.push(containedLines.length + " line(s)");
  const msg = parts.length
    ? `Delete "${g.name}" and all ${parts.join(" and ")} inside it? This cannot be undone.`
    : `Delete "${g.name}"?`;
  if (!confirm(msg)) return;
  // If any contained area is currently being edited, close the editor first
  if (state.activeId && containedAreas.some(a => a.id === state.activeId)) {
    disarmDraw();
    state.draft = null; state.activeId = null;
    undoStack.length = 0; redoStack.length = 0;
  }
  // If a line for this group is mid-draw, cancel it
  if (state.lineDraft && state.lineDraft.groupId === id) cancelLineDraft();
  // Remove the areas, lines, and the group
  state.areas = state.areas.filter(a => a.groupId !== id);
  state.lines = state.lines.filter(l => l.groupId !== id);
  state.groups = state.groups.filter(g => g.id !== id);
  save(); renderMap(); renderPanel();
}

function treeAreaHtml(a) {
  const active = state.draft && a.id === state.activeId;
  const src = active ? state.draft : a;
  const collapsed = !!src.collapsed;
  const gross = areaOf(src.boundary);
  const net = active ? ((state.draft.cutouts && state.draft.cutouts.length > 0) ? (state.draft._net != null ? state.draft._net : gross) : gross) : (a.net || 0);
  const hidden = !!src.hidden;
  const cuts = src.cutouts || [];
  const hasSubItems = cuts.length > 0;

  let h = '<div class="tz-card card' + (active ? " active" : "") + (hidden ? " hidden" : "") + '" data-area="' + a.id + '" style="border-left:4px solid ' + src.color + '">';

  const labelHidden = !!src.hideLabel;
  h += '<div class="tz-card-hdr" data-area="' + a.id + '">' +
    '<div class="tz-card-info">' +
      '<div class="tz-card-title"><span class="tz-card-name">' + esc(src.name) + '</span>' + (active ? '<span class="tz-active-badge">ACTIVE</span>' : '') + '</div>' +
      '<div class="tz-card-stats">Gross ' + sqftOnly(gross) + ' &middot; Cutouts <span class="danger">' + sqftOnly(gross - net) + '</span> &middot; Net <span style="color:' + src.color + ';">' + sqftOnly(net) + '</span></div>' +
    '</div>' +
    '<div class="tz-card-net"><div class="tz-card-net-val">' + sqftOnly(net) + '</div><div class="tz-card-net-unit">' + unitSuffix() + '</div></div>' +
    '<div class="tz-card-sep"></div>' +
    '<div class="tz-card-actions">' +
      '<button class="tz-act-btn tz-label' + (labelHidden ? " off" : "") + '" data-label="' + a.id + '"><i class="ti ti-tag"></i><span>Label</span></button>' +
      '<button class="tz-act-btn tz-eye' + (hidden ? " off" : "") + '" data-eye="' + a.id + '"><i class="ti ti-eye' + (hidden ? "-off" : "") + '"></i><span>Hide</span></button>' +
      '<button class="tz-act-btn tz-del" data-del="' + a.id + '"><i class="ti ti-trash"></i><span>Delete</span></button>' +
    '</div>' +
  '</div>';

  // Only the ACTIVE area expands its cutouts subtree; inactive areas stay collapsed
  // to keep the tree compact (the cutout total still shows in the stats line).
  if (active) {
    h += '<div class="tz-cuts-wrap"><div class="tz-cuts-inner">';
    h += '<div class="tz-cuts-hdr" data-collapse="' + a.id + '"><i class="ti ti-chevron-' + (collapsed ? "right" : "down") + '"></i> Cutouts</div>';
    if (!collapsed) {
      h += '<div class="tz-cuts-list">' +
        cuts.map((c, i) =>
          '<div class="tz-cut-row">' +
          '<div class="tz-cut-icon"><i class="ti ti-square"></i></div>' +
          '<div class="tz-cut-name">Removed area ' + (i + 1) + '</div>' +
          '<div class="tz-cut-val">-' + sqftOnly(areaOf(c.geometry)) + ' <small>' + unitSuffix() + '</small></div>' +
          (active ? '<button class="tz-cut-x tz-cdel" data-cut="' + c.id + '" title="Delete cutout"><i class="ti ti-x"></i></button>' : '') +
          '</div>'
        ).join('') +
        (active ? '<button class="tz-add-cut" data-add-cutout="' + a.id + '"><i class="ti ti-plus"></i> Add Cutout</button>' : '') +
      '</div>';
    }
    h += '</div></div>';
  }
  return h + '</div>';
}

function wireTree() {
  const p = $("panel");
  p.querySelectorAll(".tz-cuts-hdr[data-collapse]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); toggleCollapse(b.getAttribute("data-collapse")); });
  p.querySelectorAll(".tz-chev[data-gcollapse]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); toggleGroupCollapse(b.getAttribute("data-gcollapse")); });

  // Group header actions
  p.querySelectorAll(".tz-grename").forEach((b) => b.onclick = (e) => { e.stopPropagation(); renameGroup(b.getAttribute("data-grename")); });
  p.querySelectorAll(".tz-geye").forEach((b) => b.onclick = (e) => { e.stopPropagation(); toggleGroupHidden(b.getAttribute("data-geye")); });
  p.querySelectorAll(".tz-gdel").forEach((b) => b.onclick = (e) => { e.stopPropagation(); deleteGroup(b.getAttribute("data-gdel")); });

  // Area card: click header (away from action buttons) opens the editor
  p.querySelectorAll(".tz-card-hdr[data-area]").forEach((hd) => hd.onclick = (e) => {
    if (e.target.closest(".tz-act-btn")) return;
    openEditor(hd.getAttribute("data-area"));
  });

  // Area Row actions
  p.querySelectorAll(".tz-label").forEach((b) => b.onclick = (e) => { e.stopPropagation(); toggleLabelHidden(b.getAttribute("data-label")); });
  p.querySelectorAll(".tz-eye").forEach((b) => b.onclick = (e) => { e.stopPropagation(); toggleHidden(b.getAttribute("data-eye")); });
  p.querySelectorAll(".tz-del").forEach((b) => b.onclick = (e) => { e.stopPropagation(); deleteArea(b.getAttribute("data-del")); });

  // Cutout actions
  p.querySelectorAll(".tz-cdel").forEach((b) => b.onclick = (e) => { e.stopPropagation(); deleteCutout(b.getAttribute("data-cut")); });

  // Line actions
  p.querySelectorAll("[data-add-line]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); startLineDraft(b.getAttribute("data-add-line")); });
  p.querySelectorAll("[data-lcolor]").forEach((inp) => inp.oninput = (e) => { e.stopPropagation(); setLineColor(inp.getAttribute("data-lcolor"), e.target.value); });
  p.querySelectorAll(".tz-lrename").forEach((b) => b.onclick = (e) => { e.stopPropagation(); renameLine(b.getAttribute("data-lrename")); });
  p.querySelectorAll(".tz-leye").forEach((b) => b.onclick = (e) => { e.stopPropagation(); toggleLineHidden(b.getAttribute("data-leye")); });
  p.querySelectorAll(".tz-ldel").forEach((b) => b.onclick = (e) => { e.stopPropagation(); deleteLine(b.getAttribute("data-ldel")); });

  const ca = $("addCatBtnTop"); if (ca) ca.onclick = addGroup;
  const sb = $("settingsBtn"); if (sb) sb.onclick = openSettingsModal;
  const cb = $("calcBtn"); if (cb) cb.onclick = openCalcModal;
  
  const tb = $("toggleAllBtn");
  if (tb) {
    const anyVisible = state.areas.some(a => !a.hidden) || state.lines.some(l => !l.hidden);
    tb.innerHTML = '<i class="ti ' + (anyVisible ? 'ti-eye' : 'ti-eye-off') + '" style="font-size:16px;' + (!anyVisible ? 'color:#c7c7cc;' : '') + '"></i>';
    tb.onclick = (e) => {
      e.stopPropagation();
      state.areas.forEach(a => a.hidden = anyVisible);
      state.lines.forEach(l => l.hidden = anyVisible);
      renderMap(); renderPanel(); save();
    };
  }

  p.querySelectorAll(".tz-hdr").forEach((hd) => hd.onclick = (e) => {
    if (e.target.closest(".tz-chev") || e.target.closest(".tz-eye") || e.target.closest(".tz-leye") || e.target.closest(".tz-adel") || e.target.closest(".tz-cdel") || e.target.closest(".tz-inline-add")) return;
    openEditor(hd.getAttribute("data-area"));
  });
  p.querySelectorAll(".tz-group-hdr").forEach((hd) => hd.onclick = (e) => {
    if (e.target.closest(".tz-grename") || e.target.closest(".tz-gdel") || e.target.closest(".tz-geye") || e.target.closest(".tz-chev") || e.target.closest(".tz-add-area")) return;
    toggleGroupCollapse(hd.getAttribute("data-group"));
  });
  p.querySelectorAll(".tz-add-area").forEach((b) => b.onclick = (e) => {
    e.stopPropagation(); openEditor(null, b.getAttribute("data-add-to"));
  });
  p.querySelectorAll("[data-add-cutout]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation(); armCutout();
  });
}
function toggleCollapse(id) {
  if (state.draft && state.activeId === id) { state.draft.collapsed = !state.draft.collapsed; }
  const a = state.areas.find((x) => x.id === id);
  if (a) a.collapsed = !a.collapsed;
  renderPanel(); save();
}
function toggleGroupCollapse(id) { const g = state.groups.find((x) => x.id === id); if (!g) return; g.collapsed = !g.collapsed; renderPanel(); save(); }
function toggleGroupHidden(id) {
  const containedAreas = state.areas.filter(a => a.groupId === id);
  const containedLines = state.lines.filter(l => l.groupId === id);
  if (!containedAreas.length && !containedLines.length) return;
  const allHidden = containedAreas.every(a => a.hidden) && containedLines.every(l => l.hidden);
  containedAreas.forEach(a => {
    a.hidden = !allHidden;
    if (state.draft && state.draft.id === a.id) state.draft.hidden = a.hidden;
  });
  containedLines.forEach(l => { l.hidden = !allHidden; });
  renderMap(); renderPanel(); reArm(); save();
}
function toggleLabelHidden(id) { 
  const a = state.areas.find((x) => x.id === id); 
  if (!a) return; 
  a.hideLabel = !a.hideLabel; 
  if (state.draft && state.draft.id === id) state.draft.hideLabel = a.hideLabel;
  renderMap(); renderPanel(); reArm(); save(); 
}
function toggleHidden(id) { 
  const a = state.areas.find((x) => x.id === id); 
  if (!a) return; 
  a.hidden = !a.hidden; 
  if (state.draft && state.draft.id === id) state.draft.hidden = a.hidden;
  renderMap(); renderPanel(); reArm(); save(); 
}

let _toastTimer = null;
function toast(msg) {
  let t = document.getElementById("appToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "appToast";
    t.className = "app-toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}
function statCell(id, inner, cls, label) {
  return '<div class="asc-stat"><div class="asc-stat-val ' + (cls || "") + '" id="' + id + '">' + inner + '</div>' +
         '<div class="asc-stat-lbl">' + label + '</div></div>';
}
function settingsCardHtml(d) {
  const disabled = !d;
  const color = d ? d.color : (state.settings.defaultColor || "#34c759");
  const opPct = Math.round((d ? (d.opacity != null ? d.opacity : 0.35) : 0.35) * 100);
  const grp = d ? state.groups.find(g => g.id === d.groupId) : null;
  const swatches = SWATCHES.map(c =>
    '<button type="button" class="swatch' + (c === color ? " active" : "") + '" data-color="' + c + '" style="background:' + c + '" title="' + c + '"></button>'
  ).join('');
  return '<div class="card settings-card">' +
    '<div class="set-title"><i class="ti ti-adjustments"></i> Area Settings</div>' +
    '<div class="set-row">' +
      '<div class="set-field" style="flex:2;"><div class="set-lbl">Name</div>' +
        '<input class="ed-input" id="areaName" type="text" value="' + (d ? esc(d.name) : "") + '" placeholder="Area name"' + (disabled ? " disabled" : "") + ' /></div>' +
      '<div class="set-field" style="flex:1.6;"><div class="set-lbl">Category</div>' +
        '<button type="button" class="ed-input cat-select" id="areaCatBtn"' + (disabled ? " disabled" : "") + ' onclick="openAreaCategoryMenu(this)">' +
          (grp ? '<span class="cat-select-dot" style="background:' + grp.color + '"></span>' : '<span class="cat-select-dot none"></span>') +
          '<span class="cat-select-name' + (grp ? '' : ' none') + '">' + (grp ? esc(grp.name) : 'None') + '</span>' +
          '<i class="ti ti-selector cat-select-chev"></i></button>' +
      '</div>' +
      '<div class="set-field"><div class="set-lbl">&nbsp;</div>' +
        '<button type="button" class="style-btn' + (disabled ? " disabled" : "") + (stylePanelOpen ? " active" : "") + '" id="styleBtn">' +
          '<span class="style-dot" style="background:' + color + '"></span>Style<i class="ti ti-chevron-down style-chev"></i></button>' +
      '</div>' +
    '</div>' +
  '</div>' +
  // Collapsible Style panel — pops out under the card with swatches + custom + fill opacity.
  '<div class="style-panel' + (stylePanelOpen && !disabled ? " open" : "") + '" id="stylePanel"><div class="style-panel-inner">' +
    '<div class="sp-swatches">' + swatches +
      '<label class="swatch swatch-custom" title="Custom color"><i class="ti ti-plus"></i>' +
        '<input type="color" id="customColor" value="' + color + '"' + (disabled ? " disabled" : "") + '></label>' +
    '</div>' +
    '<div class="sp-opacity"><span class="sp-lbl">Fill</span>' +
      '<input type="range" min="5" max="90" value="' + opPct + '" id="areaOpacity"' + (disabled ? " disabled" : "") + ' oninput="updateAreaOpacity(this.value)">' +
      '<span class="sp-val" id="opacityVal">' + opPct + '%</span>' +
    '</div>' +
  '</div></div>';
}
// Custom Category dropdown for the area editor — a popover (reuses the .cal-mn shell) with color dots.
function openAreaCategoryMenu(rowEl) {
  calcCloseMenu();
  const cur = state.draft ? (state.draft.groupId || "") : "";
  let inner = state.groups.map(g =>
    '<div class="cal-mn-item' + (g.id === cur ? " on" : "") + '" onclick="pickAreaCategory(\'' + g.id + '\')">' +
      '<span class="cal-mn-dot" style="background:' + g.color + '"></span>' +
      '<span class="cal-mn-label">' + esc(g.name) + '</span><i class="ti ti-check cal-mn-chk"></i></div>'
  ).join("");
  inner += '<div class="cal-mn-div"></div>' +
    '<div class="cal-mn-item' + (cur === "" ? " on" : "") + '" onclick="pickAreaCategory(\'\')">' +
      '<span class="cal-mn-label" style="color:var(--text-dim)">None</span><i class="ti ti-check cal-mn-chk"></i></div>';
  document.body.insertAdjacentHTML("beforeend", '<div id="calMenuBackdrop" onclick="calcCloseMenu()"></div><div id="calMenu" class="cal-mn">' + inner + "</div>");
  const menu = document.getElementById("calMenu");
  const r = rowEl.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = r.left; if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8; if (left < 8) left = 8;
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;
  menu.style.left = left + "px"; menu.style.top = top + "px";
  if (mw < r.width) menu.style.minWidth = r.width + "px";
}
function pickAreaCategory(gid) {
  calcCloseMenu();
  if (!state.draft) return;
  state.draft.groupId = gid || null;
  autoCommit(); renderPanel();
}
function toggleStylePanel() {
  if (!state.draft) return;
  stylePanelOpen = !stylePanelOpen;
  const p = $("stylePanel"); if (p) p.classList.toggle("open", stylePanelOpen);
  const b = $("styleBtn"); if (b) b.classList.toggle("active", stylePanelOpen);
}
function updateAreaOpacity(val) {
  if (!state.draft) return;
  state.draft.opacity = parseInt(val) / 100;
  if (activeBoundary) activeBoundary.setOptions({ fillOpacity: state.draft.opacity });
  const r = $("opacityVal"); if (r) r.textContent = Math.round(state.draft.opacity * 100) + "%";
  autoCommit();
}
function dockHtml() {
  const d = state.draft;
  const lenUnit = state.settings.units === "metric" ? "m" : "ft";

  // Toolbar Card (ALWAYS VISIBLE) — Select / Area / Line / Rect / Circle / Undo / Redo
  const tbCard = '<div class="card toolbar-card" id="dockToolbar">' +
    '<button class="tool-btn" id="modeSelectBtn" title="Select / Move"><i class="ti ti-pointer"></i><span>Select</span></button>' +
    '<div class="tool-sep"></div>' +
    '<button class="tool-btn shape-btn" data-shape="polygon" title="Draw Area (polygon)"><i class="ti ti-vector"></i><span>Area</span></button>' +
    '<div class="tool-sep"></div>' +
    '<button class="tool-btn" id="lineToolBtn" title="Measure a line"><i class="ti ti-line"></i><span>Line</span></button>' +
    '<div class="tool-sep"></div>' +
    '<button class="tool-btn shape-btn" data-shape="rectangle" title="Draw Rectangle"><i class="ti ti-square"></i><span>Rect</span></button>' +
    '<div class="tool-sep"></div>' +
    '<button class="tool-btn shape-btn" data-shape="circle" title="Draw Circle"><i class="ti ti-circle"></i><span>Circle</span></button>' +
    '<div class="tool-sep"></div>' +
    '<button class="tool-btn" id="undoBtn"' + (undoStack.length ? "" : " disabled") + '><i class="ti ti-arrow-back-up"></i><span>Undo</span></button>' +
    '<div class="tool-sep"></div>' +
    '<button class="tool-btn" id="redoBtn"' + (redoStack.length ? "" : " disabled") + '><i class="ti ti-arrow-forward-up"></i><span>Redo</span></button>' +
  '</div>';

  if (!d) {
    const disabledStats = '<div class="card stats-card-v2 disabled">' +
      '<div class="edit-banner idle"><span class="edit-banner-text">No area selected</span></div>' +
      '<div class="asc-grid">' +
        statCell("liveGross", "0 <small>" + unitSuffix() + "</small>", "", "Gross Area") +
        statCell("liveCuts", "0 <small>" + unitSuffix() + "</small>", "danger", "Cutouts") +
        statCell("liveSqft", "0 <small>" + unitSuffix() + "</small>", "success", "Net Area") +
        statCell("livePerim", "0 <small>" + lenUnit + "</small>", "", "Perimeter") +
      '</div>' +
    '</div>';
    return disabledStats + tbCard + settingsCardHtml(null);
  }

  const gross = areaOf(d.boundary);
  const live = (d.cutouts && d.cutouts.length > 0) ? (d._net != null ? d._net : gross) : gross;
  const cuts = gross - live;
  const per = areaEdging(d);

  // Active Area Stats Card — green "Editing" banner + Gross / Cutouts / Net / Perimeter
  const statsCard = '<div class="card stats-card-v2">' +
    '<div class="edit-banner" id="dock"><span class="edit-banner-text" id="dockActive"><span class="pulse"></span>Editing - ' + esc(d.name) + '</span></div>' +
    '<div class="asc-grid">' +
      statCell("liveGross", sqftOnly(gross) + " <small>" + unitSuffix() + "</small>", "", "Gross Area") +
      statCell("liveCuts", "-" + sqftOnly(cuts) + " <small>" + unitSuffix() + "</small>", "danger", "Cutouts") +
      statCell("liveSqft", sqftOnly(live) + " <small>" + unitSuffix() + "</small>", "success", "Net Area") +
      statCell("livePerim", fmtLen(per), "", "Perimeter") +
    '</div>' +
  '</div>';

  return statsCard + tbCard + settingsCardHtml(d);
}
// Wire the always-visible toolbar buttons (works with or without an active draft).
function wireToolbar() {
  const sb = $("modeSelectBtn"); if (sb) sb.onclick = () => { armSelect(); renderMap(); };
  const lb = $("lineToolBtn"); if (lb) lb.onclick = () => startLineFromToolbar();
  const ub = $("undoBtn"); if (ub) ub.onclick = undo;
  const rb = $("redoBtn"); if (rb) rb.onclick = redo;
  document.querySelectorAll(".shape-btn").forEach((b) => b.onclick = () => setShape(b.getAttribute("data-shape")));
}
function wireDock() {
  const an = $("areaName");
  if (an) an.oninput = (e) => {
    if (!state.draft) return;
    state.draft.name = e.target.value;
    const n = document.querySelector(".tz.active .tz-name"); if (n) n.textContent = e.target.value;
    if (activeLabel) activeLabel.setContent(state.draft.name, sqftOnly(state.draft._net != null ? state.draft._net : areaOf(state.draft.boundary)) + " " + unitSuffix());
    applyModeChrome(); autoCommit();
  };
  
  const cc = $("customColor");
  if (cc) cc.oninput = (e) => {
    if (state.draft) setColor(e.target.value);
  };

  const stb = $("styleBtn"); if (stb) stb.onclick = toggleStylePanel;
  const sp = $("stylePanel");
  if (sp) sp.querySelectorAll(".swatch[data-color]").forEach(b => b.onclick = () => setColor(b.getAttribute("data-color")));
}

function setColor(c) {
  state.draft.color = c;
  if (activeBoundary) activeBoundary.setOptions({ fillColor: c, strokeColor: c });
  const dot = document.querySelector(".tz.active .tz-dot");
  if (dot) dot.style.background = c;
  document.querySelectorAll(".swatch").forEach(b => b.classList.toggle("active", b.getAttribute("data-color") === c));
  const sdot = document.querySelector(".style-btn .style-dot"); if (sdot) sdot.style.background = c;
  const cinp = $("customColor"); if (cinp) cinp.value = c;
  autoCommit();
}

/* ── areas / persistence ───────────────────────────────────────────────── */
function deleteArea(id) {
  if (!id) return;
  // Determine the name whether it's a draft or a committed area
  const isDraft = state.activeId === id;
  const area = isDraft ? state.draft : state.areas.find(x => x.id === id);
  if (!area) return;
  if (!confirm('Delete "' + area.name + '"? This cannot be undone.')) return;
  // If currently editing this area, cleanly tear down the editor first
  if (isDraft) {
    disarmDraw();
    state.draft = null;
    state.activeId = null;
    undoStack.length = 0;
    redoStack.length = 0;
  }
  // Remove from committed areas (no-op if it was only a draft)
  state.areas = state.areas.filter(x => x.id !== id);
  save(); renderMap(); renderPanel();
}
function clearAll() {
  if (!state.areas.length && !state.groups.length && !state.lines.length) return;
  if (!confirm("Delete all areas, lines and categories? Save a file first if you want a backup.")) return;
  if (state.lineDraft) cancelLineDraft();
  if (state.draft) closeEditor();
  state.areas = [];
  state.lines = [];
  state.groups = [];
  state.seq = 1;
  state.grpSeq = 1;
  state.cutSeq = 1;
  state.lineSeq = 1;
  renderMap(); renderPanel(); save();
}
const save = debounce(() => {
  const data = { areas: state.areas, lines: state.lines, groups: state.groups, seq: state.seq, cutSeq: state.cutSeq, grpSeq: state.grpSeq, lineSeq: state.lineSeq, settings: state.settings,
    center: map ? { lat: map.getCenter().lat(), lng: map.getCenter().lng(), zoom: map.getZoom() } : null };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
}, 800);

function load() {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function exportJSON() {
  const blob = new Blob([JSON.stringify({ areas: state.areas, lines: state.lines, groups: state.groups, seq: state.seq, cutSeq: state.cutSeq, grpSeq: state.grpSeq, lineSeq: state.lineSeq, settings: state.settings,
    center: map ? { lat: map.getCenter().lat(), lng: map.getCenter().lng(), zoom: map.getZoom() } : null }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "lawn-measure-" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
  URL.revokeObjectURL(a.href);
}
function importJSON(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      state.areas = d.areas || []; state.seq = d.seq || state.areas.length + 1; state.cutSeq = d.cutSeq || 1;
      state.lines = d.lines || []; state.lineSeq = d.lineSeq || state.lines.length + 1;
      state.groups = d.groups || []; state.grpSeq = d.grpSeq || state.groups.length + 1;
      state.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
      if (d.center && map) { map.setCenter({ lat: d.center.lat, lng: d.center.lng }); map.setZoom(d.center.zoom || 19); }
      if (map) map.setMapTypeId(state.settings.mapType);
      state.areas.forEach(refreshArea); renderMap(); renderPanel(); save();
    } catch (err) { alert("Could not read that file: " + err.message); }
  };
  r.readAsText(file); e.target.value = "";
}

/* ── init ──────────────────────────────────────────────────────────────── */
function initApp() {
  LabelOverlay = class extends google.maps.OverlayView {
    constructor(bounds, name, sizeStr, map) {
      super();
      this.bounds = bounds;
      this.div = document.createElement("div");
      this.div.className = "shape-label";
      this.div.innerHTML = '<div class="shape-label-name">' + esc(name) + '</div>' +
                           '<div class="shape-label-size">' + esc(sizeStr) + '</div>';
      this.setMap(map);
    }
    onAdd() {
      this.getPanes().floatPane.appendChild(this.div);
    }
    draw() {
      const proj = this.getProjection();
      if (!proj) return;
      const center = this.bounds.getCenter();
      // Cull labels that aren't worth drawing: too far zoomed out, or off-screen.
      // Keeps pan/zoom smooth no matter how many areas exist.
      const mb = map.getBounds();
      if (!state.settings.showLabels || map.getZoom() < 16 || (mb && !mb.contains(center))) { this.div.style.display = "none"; return; }
      this.div.style.display = "";
      const pos = proj.fromLatLngToDivPixel(center);
      if (pos) {
        this.div.style.left = pos.x + "px";
        this.div.style.top = pos.y + "px";
      }
    }
    setContent(name, sizeStr) {
      this.div.innerHTML = '<div class="shape-label-name">' + esc(name) + '</div>' +
                           '<div class="shape-label-size">' + esc(sizeStr) + '</div>';
    }
    onRemove() {
      if (this.div.parentNode) this.div.parentNode.removeChild(this.div);
    }
  };

  map = new google.maps.Map($("map"), {
    center: { lat: 39.5, lng: -98.35 }, zoom: 5, mapTypeId: "hybrid", tilt: 0,
    streetViewControl: false, fullscreenControl: false, rotateControl: false,
    mapTypeControl: true, mapTypeControlOptions: { position: google.maps.ControlPosition.BOTTOM_LEFT },
  });

  // Projection bridge: an invisible OverlayView whose only job is to expose
  // getProjection() so domMove() can turn raw browser pixels into LatLng.
  projOverlay = new google.maps.OverlayView();
  projOverlay.onAdd = function () {};
  projOverlay.draw = function () {};
  projOverlay.onRemove = function () {};
  projOverlay.setMap(map);

  worker = new Worker("worker.js");
  worker.onmessage = (e) => {
    const entry = workerCbs[e.data.token];
    if (entry) { clearTimeout(entry.timeout); delete workerCbs[e.data.token]; entry.res(e.data); }
  };
  // If the worker itself fails (e.g. Turf failed to load), resolve every pending
  // request with the main-thread fallback so nothing hangs.
  worker.onerror = () => {
    Object.keys(workerCbs).forEach((t) => {
      const entry = workerCbs[t]; clearTimeout(entry.timeout); delete workerCbs[t];
      entry.res({ netArea: fallbackNet(entry.boundary, entry.cutouts), fallback: true });
    });
  };

  const input = $("addressInput"); input.disabled = false;
  const ac = new google.maps.places.Autocomplete(input, { fields: ["geometry"] });
  ac.addListener("place_changed", () => {
    const p = ac.getPlace();
    if (!p.geometry) return;
    if (p.geometry.viewport) map.fitBounds(p.geometry.viewport); else { map.setCenter(p.geometry.location); map.setZoom(20); }
    // Drop a pin so the user can see exactly where the address is.
    if (!addressMarker) {
      addressMarker = new google.maps.Marker({ map, clickable: false, zIndex: 5, title: "Your address", animation: google.maps.Animation.DROP });
    }
    addressMarker.setPosition(p.geometry.location);
    addressMarker.setMap(map);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (state.lineDraft) cancelLineDraft();
      else if (state.draft) {
        // Cancel the in-progress trace. If the area was brand-new with nothing drawn yet,
        // abandon it; otherwise drop back to select mode (shape stays editable).
        if (!state.draft.boundary) closeEditor();
        else { armSelect(); renderMap(); }
      }
      return;
    }
    // Backspace removes the last placed point of an in-progress line.
    if ((e.key === "Backspace" || e.key === "Delete") && state.lineDraft && state.drawShape === "line") {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      removeLastLinePoint();
    }
  });

  const data = load();
  if (data) {
    state.areas = data.areas || []; state.seq = data.seq || state.areas.length + 1; state.cutSeq = data.cutSeq || 1;
    state.lines = data.lines || []; state.lineSeq = data.lineSeq || state.lines.length + 1;
    state.groups = data.groups || []; state.grpSeq = data.grpSeq || state.groups.length + 1;
    if (data.center) { map.setCenter({ lat: data.center.lat, lng: data.center.lng }); map.setZoom(data.center.zoom || 19); }
    state.areas.forEach(refreshArea);
  }
  // Always fill the full default set (a fresh install has no data.settings).
  state.settings = Object.assign({}, DEFAULT_SETTINGS, (data && data.settings) || {});
  map.setMapTypeId(state.settings.mapType);
  renderMap(); renderPanel();
}
