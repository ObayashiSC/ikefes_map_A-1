/* =========================================================================
 * map-carto.js — MapAdapter 実装（CARTO / Leaflet）
 * -------------------------------------------------------------------------
 * Leaflet と CARTO タイルへの依存はすべてこのファイルに閉じる。
 * app.js は window.MapAdapter のインターフェースだけを呼ぶ。
 * ========================================================================= */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  let map, tileLayer, meMarker = null, meCircle = null;

  const TILE_LIGHT =
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=' + CFG.CARTO_API_KEY;

  function makeIcon(color) {
    const pin = window.MapShared.pinSvg(color); // CSS変数 var(--bg) で中心円
    return L.divIcon({
      className: '',
      html: '<div class="poi-marker">' + pin + '</div>',
      iconSize: [30, 38], iconAnchor: [15, 36], popupAnchor: [0, -32]
    });
  }

  const Adapter = {
    init({ containerId, center, zoom }) {
      return new Promise((resolve) => {
        // Leaflet の CSS/JS が index.html で読み込まれている前提
        map = L.map(containerId, {
          zoomControl: true, attributionControl: true,
          preferCanvas: true, zoomSnap: .5
        }).setView([center.lat, center.lng], zoom);

        tileLayer = L.tileLayer(TILE_LIGHT, {
          maxZoom: 20, subdomains: 'abcd',
          referrerPolicy: 'strict-origin-when-cross-origin',
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a>'
        }).addTo(map);

        document.documentElement.setAttribute('data-theme', 'light');
        const meta = document.getElementById('themeColorMeta');
        if (meta) meta.setAttribute('content', '#ffffff');
        resolve();
      });
    },

    addMarker({ id, lat, lng, color, popupHtml, onClick, onPopupOpen }) {
      const m = L.marker([lat, lng], { icon: makeIcon(color) })
        .bindPopup(popupHtml, { maxWidth: 290, minWidth: 270, closeButton: true });
      if (onClick) m.on('click', onClick);
      if (onPopupOpen) {
        m.on('popupopen', (e) => {
          const el = e.popup.getElement();
          onPopupOpen(el);
        });
      }
      return m; // ref
    },

    showMarker(ref) { if (ref && !map.hasLayer(ref)) ref.addTo(map); },
    hideMarker(ref) { if (ref && map.hasLayer(ref)) map.removeLayer(ref); },

    openPopup(ref) { if (ref) ref.openPopup(); },
    closePopup() { map.closePopup(); },

    setView(lat, lng, zoom, opts) {
      map.setView([lat, lng], zoom, opts || { animate: true });
    },
    getZoom() { return map.getZoom(); },

    fitBounds(points, opts) {
      if (!points || !points.length) return;
      const b = L.latLngBounds(points.map(p => [p.lat, p.lng]));
      if (b.isValid()) {
        const pad = (opts && opts.padding) || 40;
        map.fitBounds(b, { padding: [pad, pad] });
      }
    },

    panBy(dx, dy) { map.panBy([dx, dy], { animate: false }); },

    setMe(lat, lng, accuracy) {
      const ll = [lat, lng];
      if (meMarker) map.removeLayer(meMarker);
      if (meCircle) map.removeLayer(meCircle);
      meMarker = L.marker(ll, {
        icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
        zIndexOffset: 1000
      }).addTo(map).bindPopup('現在地 / You are here');
      if (accuracy) {
        meCircle = L.circle(ll, {
          radius: accuracy, color: '#0a0a0a', weight: 1, fillColor: '#0a0a0a', fillOpacity: .05
        }).addTo(map);
      }
    },

    // 現在地がPOI範囲内なら寄せる（共通ロジックから呼ばれる）
    recenterIfWithinPois(lat, lng, pois) {
      try {
        const b = L.latLngBounds(pois.map(p => [p.spot.latitude, p.spot.longitude]));
        if (b.isValid() && b.pad(0.5).contains([lat, lng])) {
          map.setView([lat, lng], Math.max(15, map.getZoom()), { animate: true });
        }
      } catch (_) {}
    },

    invalidateSize() { if (map) map.invalidateSize(); }
  };

  // config の指定が carto のときだけ有効化
  if ((CFG.MAP_PROVIDER || 'carto') === 'carto') {
    window.MapAdapter = Adapter;
  }
})();
