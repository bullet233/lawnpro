/* ────────────────────────────────────────────────────────────────────────────
   Embed bridge — ONLY active when the Lawn Measure tool is loaded inside an
   <iframe> by the Lawn Route Tracker. It adds a "Use this measurement" button,
   reports the total mowable area + edging length back to the parent app, and
   (optionally) recenters the map on a customer address passed via ?address=.
   Reads the tool's own globals (state, totalDisplay, totalEdging, map) which are
   in shared classic-script global scope. No effect when opened standalone.
──────────────────────────────────────────────────────────────────────────── */
(function () {
  if (window.parent === window) return; // standalone — do nothing

  var SQFT_PER_M2 = 10.7639104;
  var FT_PER_M = 3.28084;

  function post(msg) { try { window.parent.postMessage(msg, '*'); } catch (e) {} }

  function currentResult() {
    var m2 = (typeof totalDisplay === 'function') ? totalDisplay() : 0;
    var perM = (typeof totalEdging === 'function') ? totalEdging() : 0;
    var areaCount = (typeof state !== 'undefined' && state.areas) ? state.areas.length : 0;
    return {
      sqft: Math.round(m2 * SQFT_PER_M2),
      perimeterFt: Math.round(perM * FT_PER_M),
      areaCount: areaCount
    };
  }

  function sendResult() {
    var r = currentResult();
    if (!r.sqft) {
      post({ type: 'lawn-measure-empty' });
      return;
    }
    post({ type: 'lawn-measure-result', sqft: r.sqft, perimeterFt: r.perimeterFt, areaCount: r.areaCount });
  }

  function addButton() {
    if (document.getElementById('embedUseBtn')) return;
    // On phones the tool's panel is a bottom SHEET with a ~30px peek handle at the
    // very bottom. Lift our action bar above that handle so the two stack cleanly
    // instead of overlapping. On desktop (side-panel layout) keep the low position.
    var coarse = window.matchMedia('(max-width: 700px)').matches;
    var sheetH = document.getElementById('sheetHandle');
    var peek = (coarse && sheetH) ? (sheetH.offsetHeight || 34) : 0; // actual handle height (safe-area aware)
    var barBottom = coarse ? peek + 14 : 16;  // clears the sheet handle + gap
    // Phones stack TWO rows above the Use bar while tracing (the tool's own
    // Undo/Finish/Cancel bar rides at barBottom+~64) — lift the locate button
    // above both so nothing shares its row. Desktop keeps the tight offset.
    var locBottom = coarse ? barBottom + 118 : barBottom + 62;
    var wrap = document.createElement('div');
    wrap.id = 'embedUseWrap';
    wrap.style.cssText = 'position:fixed;left:0;right:0;bottom:' + barBottom + 'px;z-index:99999;display:flex;justify-content:center;gap:10px;pointer-events:none;';

    var cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'pointer-events:auto;background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:999px;padding:12px 18px;font-size:15px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.18);cursor:pointer;font-family:system-ui,sans-serif;';
    cancel.onclick = function () { post({ type: 'lawn-measure-cancel' }); };

    var btn = document.createElement('button');
    btn.id = 'embedUseBtn';
    btn.textContent = '✓ Use this measurement';
    btn.style.cssText = 'pointer-events:auto;background:#10b981;color:#fff;border:none;border-radius:999px;padding:12px 22px;font-size:15px;font-weight:700;box-shadow:0 6px 20px rgba(16,185,129,.4);cursor:pointer;font-family:system-ui,sans-serif;';
    btn.onclick = sendResult;

    wrap.appendChild(cancel);
    wrap.appendChild(btn);
    document.body.appendChild(wrap);

    // Live total ON the button — "Use 6,240 sq ft" says exactly what will be
    // saved, instead of making the driver trust a number elsewhere on screen.
    setInterval(function () {
      var r = currentResult();
      btn.textContent = r.sqft > 0 ? ('✓ Use ' + r.sqft.toLocaleString() + ' sq ft') : '✓ Use this measurement';
    }, 800);

    // Locate-me: jump the map to the phone's GPS position — for prospects you're
    // parked in front of, faster than typing an address on a phone keyboard.
    var loc = document.createElement('button');
    loc.title = 'Go to my location';
    loc.innerHTML = '<i class="ti ti-current-location"></i>';
    loc.style.cssText = 'position:fixed;right:12px;bottom:' + locBottom + 'px;z-index:99999;width:46px;height:46px;border-radius:50%;background:#fff;color:#334155;border:1px solid #cbd5e1;box-shadow:0 6px 20px rgba(0,0,0,.18);cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;';
    loc.onclick = function () {
      if (!navigator.geolocation) return;
      loc.style.opacity = '0.5';
      navigator.geolocation.getCurrentPosition(function (pos) {
        loc.style.opacity = '1';
        if (typeof map !== 'undefined' && map) {
          map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          map.setZoom(20);
        }
      }, function () { loc.style.opacity = '1'; }, { enableHighAccuracy: true, timeout: 8000 });
    };
    document.body.appendChild(loc);

    // The fixed buttons float over the panel's bottom edge (especially in the
    // stacked phone layout) — pad the panel so its last rows can scroll clear.
    var panel = document.getElementById('panel');
    if (panel) panel.style.paddingBottom = '84px';
  }

  // Recenter on ?address= using the Geocoder (Autocomplete needs a manual pick).
  function centerOnAddress() {
    try {
      var addr = new URLSearchParams(location.search).get('address');
      if (!addr || typeof google === 'undefined' || !google.maps) return;
      var input = document.getElementById('addressInput');
      if (input) input.value = addr;
      new google.maps.Geocoder().geocode({ address: addr }, function (results, status) {
        if (status === 'OK' && results && results[0] && typeof map !== 'undefined' && map) {
          map.setCenter(results[0].geometry.location);
          map.setZoom(20);
        }
      });
    } catch (e) {}
  }

  // Skip the onboarding ceremony. The modal opens the tool with cleared storage
  // every time, so without this every measurement starts with: welcome card →
  // "Add Your First Category" → name it → add area → draw. Instead: auto-create
  // a "Lawn" category and open a fresh area already in boundary-trace mode, so
  // the first tap on the map places the first corner.
  function autoStartDrawing() {
    try {
      if (typeof state === 'undefined' || typeof openEditor !== 'function') return;
      if (state.groups.length > 0 || state.areas.length > 0 || state.draft) return; // not a fresh session
      var g = { id: 'g' + state.grpSeq++, name: 'Lawn', color: '#34c759', collapsed: false };
      state.groups.push(g);
      if (typeof save === 'function') save();
      openEditor(null, g.id); // new draft, drawMode "boundary" → trace armed
    } catch (e) {}
  }

  // Wait for the tool to finish booting (map + globals exist), then wire up.
  function whenReady() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var ready = (typeof map !== 'undefined' && map) && (typeof totalDisplay === 'function');
      if (ready) {
        clearInterval(iv);
        addButton();
        centerOnAddress();
        autoStartDrawing();
        post({ type: 'lawn-measure-ready' });
      } else if (tries > 200) { // ~20s safety cap
        clearInterval(iv);
        addButton();
      }
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
  else whenReady();
})();
