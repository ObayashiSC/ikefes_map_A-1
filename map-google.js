/* =========================================================================
 * map-google.js — MapAdapter 実装（Google Maps JavaScript API）
 * -------------------------------------------------------------------------
 * Google Maps への依存はすべてこのファイルに閉じる。
 * app.js は window.MapAdapter のインターフェースだけを呼ぶ（CARTO版と同一契約）。
 * ========================================================================= */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  if ((CFG.MAP_PROVIDER || 'carto') !== 'google') return; // Google指定のときだけ有効化

  let map, infoWindow, meMarker = null, meCircle = null;
  let currentOpenPopupHandler = null;

  // 現行サイトのミニマルな見た目に寄せる淡色スタイル
  const LIGHT_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#fafafa' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#737373' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
    { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#e5eef5' }] }
  ];

  // Google Maps JS API を動的ロード
  function loadGoogleMaps() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.maps) { resolve(); return; }
      const key = CFG.GOOGLE_MAPS_API_KEY;
      if (!key || key === 'YOUR_GOOGLE_MAPS_API_KEY') {
        reject(new Error('Google Maps APIキー未設定（config.js の GOOGLE_MAPS_API_KEY）'));
        return;
      }
      const cbName = '__gmapsCb_' + Date.now();
      window[cbName] = () => { resolve(); try { delete window[cbName]; } catch (e) {} };
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
        '&callback=' + cbName + '&language=ja&region=JP';
      s.async = true; s.defer = true;
      s.onerror = () => reject(new Error('Google Maps スクリプトの読み込みに失敗'));
      document.head.appendChild(s);
    });
  }

  function pinIcon(color) {
    // 中心円は白（データURIではCSS変数が効かないため実色を指定）
    const svg = window.MapShared.pinSvg(color, '#ffffff');
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(30, 38),
      anchor: new google.maps.Point(15, 36)
    };
  }
  function meIcon() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
      '<circle cx="8" cy="8" r="6" fill="#0a0a0a" stroke="#ffffff" stroke-width="2.5"/></svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(16, 16),
      anchor: new google.maps.Point(8, 8)
    };
  }

  const Adapter = {
    init({ containerId, center, zoom }) {
      return loadGoogleMaps().then(() => {
        map = new google.maps.Map(document.getElementById(containerId), {
          center: { lat: center.lat, lng: center.lng },
          zoom: zoom,
          disableDefaultUI: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          clickableIcons: false,
          styles: LIGHT_STYLE,
          gestureHandling: 'greedy'
        });
        infoWindow = new google.maps.InfoWindow({ maxWidth: 290 });
        document.documentElement.setAttribute('data-theme', 'light');
        const meta = document.getElementById('themeColorMeta');
        if (meta) meta.setAttribute('content', '#ffffff');
      });
    },

    addMarker({ id, lat, lng, color, popupHtml, onClick, onPopupOpen }) {
      const marker = new google.maps.Marker({
        position: { lat, lng },
        icon: pinIcon(color),
        optimized: false
      });
      marker._popupHtml = popupHtml;
      marker._onPopupOpen = onPopupOpen;
      marker.addListener('click', () => {
        if (onClick) onClick();
        Adapter.openPopup(marker);
      });
      return marker; // ref
    },

    showMarker(ref) { if (ref && ref.getMap() !== map) ref.setMap(map); },
    hideMarker(ref) { if (ref && ref.getMap()) ref.setMap(null); },

    openPopup(ref) {
      if (!ref) return;
      infoWindow.setContent(ref._popupHtml);
      // domready で InfoWindow の中身が生成された後に Read more を配線
      if (currentOpenPopupHandler) google.maps.event.removeListener(currentOpenPopupHandler);
      currentOpenPopupHandler = google.maps.event.addListenerOnce(infoWindow, 'domready', () => {
        const container = document.querySelector('.gm-style-iw-d') || document.querySelector('.gm-style-iw');
        if (ref._onPopupOpen && container) ref._onPopupOpen(container);
      });
      infoWindow.open({ map, anchor: ref });
    },
    closePopup() { if (infoWindow) infoWindow.close(); },

    setView(lat, lng, zoom, opts) {
      map.setZoom(zoom);
      if (opts && opts.animate) map.panTo({ lat, lng });
      else map.setCenter({ lat, lng });
    },
    getZoom() { return map.getZoom(); },

    fitBounds(points, opts) {
      if (!points || !points.length) return;
      const b = new google.maps.LatLngBounds();
      points.forEach(p => b.extend({ lat: p.lat, lng: p.lng }));
      const pad = (opts && opts.padding) || 40;
      map.fitBounds(b, { top: pad, right: pad, bottom: pad, left: pad });
    },

    panBy(dx, dy) { map.panBy(dx, dy); },

    setMe(lat, lng, accuracy) {
      const pos = { lat, lng };
      if (meMarker) meMarker.setMap(null);
      if (meCircle) meCircle.setMap(null);
      meMarker = new google.maps.Marker({ position: pos, icon: meIcon(), map, zIndex: 1000, optimized: false });
      if (accuracy) {
        meCircle = new google.maps.Circle({
          center: pos, radius: accuracy, map,
          strokeColor: '#0a0a0a', strokeWeight: 1, fillColor: '#0a0a0a', fillOpacity: .05
        });
      }
    },

    recenterIfWithinPois(lat, lng, pois) {
      try {
        const b = new google.maps.LatLngBounds();
        pois.forEach(p => b.extend({ lat: p.spot.latitude, lng: p.spot.longitude }));
        // 0.5相当の余白を持たせて内外判定
        const ne = b.getNorthEast(), sw = b.getSouthWest();
        const latPad = (ne.lat() - sw.lat()) * 0.5, lngPad = (ne.lng() - sw.lng()) * 0.5;
        const within = lat <= ne.lat() + latPad && lat >= sw.lat() - latPad &&
                       lng <= ne.lng() + lngPad && lng >= sw.lng() - lngPad;
        if (within) { map.setZoom(Math.max(15, map.getZoom())); map.panTo({ lat, lng }); }
      } catch (_) {}
    },

    invalidateSize() {
      if (map && window.google) google.maps.event.trigger(map, 'resize');
    }
  };

  window.MapAdapter = Adapter;
})();
