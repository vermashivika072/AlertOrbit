/**
 * location.js — Geolocation service
 * Tracks user location and updates status indicators on the main page.
 */

const LocationService = (() => {
  let _lat = null, _lng = null, _address = 'Unknown', _watchId = null;

  function init() {
    const badge   = document.getElementById('locationBadge');
    const dot     = document.getElementById('locDot');
    const label   = document.getElementById('locLabel');
    const locText = document.getElementById('locationText');
    const locBadge= document.getElementById('locBadge');

    if (!navigator.geolocation) {
      _setStatus('Location unavailable', 'error', dot, label, locText, locBadge);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        _lat = pos.coords.latitude;
        _lng = pos.coords.longitude;
        _address = `${_lat.toFixed(4)}°N, ${_lng.toFixed(4)}°E`;

        // Try reverse geocode via public API (no key needed)
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${_lat}&lon=${_lng}&format=json`)
          .then(r => r.json())
          .then(data => {
            const addr = data.address;
            const parts = [
              addr.suburb || addr.neighbourhood,
              addr.city || addr.town || addr.village,
              addr.state
            ].filter(Boolean);
            _address = parts.slice(0,2).join(', ') || _address;
            _updateUI(_address, 'active', 'LIVE', dot, label, locText, locBadge);
          })
          .catch(() => {
            _updateUI(_address, 'active', 'LIVE', dot, label, locText, locBadge);
          });
      },
      err => {
        console.warn('Geolocation error:', err.message);
        _setStatus('Location denied', 'error', dot, label, locText, locBadge);
        // Use fallback city
        _address = 'Indore, Madhya Pradesh';
        _lat = 22.7196; _lng = 75.8577;
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );

    // Watch position for updates
    _watchId = navigator.geolocation.watchPosition(
      pos => {
        _lat = pos.coords.latitude;
        _lng = pos.coords.longitude;
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000 }
    );
  }

  function _updateUI(addr, dotClass, badgeText, dot, label, locText, locBadge) {
    if (dot)     { dot.className = 'loc-dot ' + dotClass; }
    if (label)   { label.textContent = addr.length > 24 ? addr.slice(0,22)+'…' : addr; }
    if (locText) { locText.textContent = addr; }
    if (locBadge){ locBadge.className = 'sc-badge sc-badge--ok'; locBadge.textContent = badgeText; }
  }

  function _setStatus(msg, dotClass, dot, label, locText, locBadge) {
    if (dot)     dot.className = 'loc-dot ' + dotClass;
    if (label)   label.textContent = msg;
    if (locText) locText.textContent = msg;
    if (locBadge){ locBadge.className = 'sc-badge sc-badge--' + (dotClass==='error'?'error':'pending'); locBadge.textContent = dotClass==='error'?'OFF':'…'; }
  }

  function getCoords()  { return { lat: _lat, lng: _lng }; }
  function getAddress() { return _address; }
  function destroy()    { if (_watchId !== null) navigator.geolocation.clearWatch(_watchId); }

  return { init, getCoords, getAddress, destroy };
})();

window.LocationService = LocationService;
