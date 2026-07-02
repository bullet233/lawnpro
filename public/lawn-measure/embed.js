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
    var wrap = document.createElement('div');
    wrap.id = 'embedUseWrap';
    wrap.style.cssText = 'position:fixed;left:0;right:0;bottom:16px;z-index:99999;display:flex;justify-content:center;gap:10px;pointer-events:none;';

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
