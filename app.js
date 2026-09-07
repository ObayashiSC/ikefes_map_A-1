/* =========================================================================
 * app.js — 共通ロジック（CARTO版 / Google版 で共有）
 * -------------------------------------------------------------------------
 * ここには地図ライブラリ依存のコードを一切書かない。
 * 地図操作はすべて window.MapAdapter（map-carto.js / map-google.js）経由。
 * → この app.js を1回直せば CARTO版・Google版の両方に反映される。
 * ========================================================================= */
(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const MapAPI = window.MapAdapter; // 現在有効なアダプタ（config.jsのMAP_PROVIDERで決定）

  const state = {
    categories: [],
    pois: [],
    markers: new Map(),      // event_id -> { ref, poi }（ref はアダプタのマーカーハンドル）
    active: new Set(),
    hasFitInitial: false,
    hasTargetEvent: false,
    geoPermission: 'unknown',
    userDenied: false,
    dismissedPermissionModal: false,
    guideDismissed: false
  };

  /* ---------- 共通ユーティリティ ---------- */
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function showToast(msg, ms = 2200) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._tid);
    showToast._tid = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ピン形状（両アダプタが使用）。bg は中心円の色（CARTOはCSS変数、Googleは実色を渡す）
  function pinSvg(color, bg) {
    bg = bg || 'var(--bg)';
    return '<svg viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M15 1.5 C 22.5 1.5 27.5 7 27.5 14 C 27.5 22.5 15 36 15 36 C 15 36 2.5 22.5 2.5 14 C 2.5 7 7.5 1.5 15 1.5 Z" fill="' +
      color + '"/>' +
      '<circle cx="15" cy="14" r="4.5" fill="' + bg + '"/>' +
      '</svg>';
  }

  function popupHtml(poi) {
    const cat = poi.category || {};
    const color = cat.color_code || '#999';
    const thumb = poi.thumbnail_url ?
      `<img class="pop-thumb" src="${escapeHtml(poi.thumbnail_url)}" onerror="this.style.display='none';">` : '';
    const link = poi.detail_url ?
      '<a class="pop-link" href="' + escapeHtml(poi.detail_url) +
      '" target="_blank" rel="noopener">Read more <svg><use href="#i-arrow"/></svg></a>' : '';
    const desc = (poi.description || '').replace(/<br\s*\/?>/gi, '<br>');
    const addr = (poi.spot && (poi.spot.address || poi.spot.spot_name)) || '';
    return '<div class="pop">' + thumb +
      '<div class="pop-body">' +
      '<div class="pop-cat"><span class="dot" style="background:' + color + '"></span>' +
      escapeHtml(cat.category_name || '') + '</div>' +
      '<h3 class="pop-title">' + escapeHtml(poi.event_name || '') + '</h3>' +
      (addr ? '<div class="pop-addr">' + escapeHtml(addr) + '</div>' : '') +
      (desc ? '<div class="pop-desc">' + desc + '</div>' : '') +
      link + '</div></div>';
  }

  // アダプタから呼ばれる共有ヘルパを公開（ピン形状を両版で一致させる）
  window.MapShared = { pinSvg, popupHtml, escapeHtml };

  /* ---------- GA イベント（両版共通） ---------- */
  function gaPinClick(poi) {
    if (typeof gtag === 'function') {
      gtag('event', 'pin_click', {
        event_id: poi.event_id,
        event_name: poi.event_name || '',
        category_name: (poi.category && poi.category.category_name) || '',
        category_id: (poi.category && poi.category.category_id) || ''
      });
    }
  }
  function gaBindReadMore(containerEl, poi) {
    if (!containerEl) return;
    const link = containerEl.querySelector('.pop-link');
    if (!link) return;
    link.addEventListener('click', () => {
      if (typeof gtag === 'function') {
        gtag('event', 'read_more_click', {
          event_id: poi.event_id,
          event_name: poi.event_name || '',
          category_name: (poi.category && poi.category.category_name) || '',
          category_id: (poi.category && poi.category.category_id) || '',
          link_url: poi.detail_url || ''
        });
      }
    }, { once: true });
  }

  /* ---------- カテゴリ描画 ---------- */
  function renderCategories() {
    const el = document.getElementById('catList');
    const counts = {};
    state.pois.forEach(p => {
      const id = p.category && p.category.category_id;
      if (id != null) counts[id] = (counts[id] || 0) + 1;
    });
    el.innerHTML = state.categories.map(c =>
      '<label class="cat-item" data-id="' + c.category_id + '">' +
      '<input type="checkbox" data-id="' + c.category_id + '" checked>' +
      '<span class="cat-swatch" style="background:' + c.color_code + '"></span>' +
      '<span class="cat-name">' + escapeHtml(c.category_name) + '</span>' +
      '<span class="cat-num">' + String(counts[c.category_id] || 0).padStart(2, '0') + '</span>' +
      '</label>'
    ).join('');
    el.querySelectorAll('input').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.id;
        if (cb.checked) state.active.add(id);
        else state.active.delete(id);
        cb.closest('.cat-item').classList.toggle('off', !cb.checked);
        applyFilter();
      });
    });
    document.getElementById('totalCount').textContent = String(state.pois.length).padStart(3, '0');
  }

  /* ---------- マーカー生成（アダプタ経由） ---------- */
  function renderMarkers() {
    state.pois.forEach(poi => {
      const lat = poi.spot && poi.spot.latitude;
      const lng = poi.spot && poi.spot.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      const color = (poi.category && poi.category.color_code) || '#888';
      const ref = MapAPI.addMarker({
        id: poi.event_id,
        lat, lng, color,
        popupHtml: popupHtml(poi),
        onClick: () => gaPinClick(poi),
        onPopupOpen: (containerEl) => gaBindReadMore(containerEl, poi)
      });
      state.markers.set(poi.event_id, { ref, poi });
    });
    applyFilter();
  }

  function applyFilter() {
    let v = 0;
    state.markers.forEach(({ ref, poi }) => {
      const id = String(poi.category && poi.category.category_id);
      if (state.active.has(id)) { MapAPI.showMarker(ref); v++; }
      else MapAPI.hideMarker(ref);
    });
    document.getElementById('visibleCount').textContent = String(v).padStart(3, '0');
  }

  /* ---------- event_id ディープリンク ---------- */
  function getTargetEventId() {
    const params = new URLSearchParams(window.location.search);
    let id = params.get('event_id') || params.get('event') || params.get('id');
    if (!id && window.location.hash) {
      const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      id = h.get('event_id') || h.get('event') || h.get('id');
    }
    return id ? id.trim() : null;
  }

  function focusEvent(eventId) {
    const entry = state.markers.get(eventId);
    if (!entry) { showToast('該当スポットが見つかりません: ' + eventId, 3000); return; }
    const { ref, poi } = entry;
    // 対象カテゴリが非表示なら表示に戻す
    const catId = String(poi.category && poi.category.category_id);
    if (!state.active.has(catId)) {
      state.active.add(catId);
      const cb = document.querySelector('#catList input[data-id="' + catId + '"]');
      if (cb) { cb.checked = true; cb.closest('.cat-item').classList.remove('off'); }
      applyFilter();
    }
    MapAPI.showMarker(ref);
    MapAPI.setView(poi.spot.latitude, poi.spot.longitude, Math.max(MapAPI.getZoom(), 17), { animate: true });

    // 遷移時はピンのポップアップのみ開く（サイドパネル＝カテゴリIndexは開かない）
    setTimeout(() => {
      MapAPI.openPopup(ref);
    }, 380);
  }

  /* ---------- 現在地（geolocation は共通、地図描画のみアダプタ） ---------- */
  function locate(opts) {
    opts = opts || {};
    const silent = !!opts.silent;
    const recenter = opts.recenter !== false;
    if (!navigator.geolocation) {
      if (!silent) showToast('位置情報に非対応のブラウザです');
      return Promise.reject();
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude, acc = pos.coords.accuracy;
        MapAPI.setMe(lat, lng, acc);
        const guide = document.getElementById('locationGuide');
        if (guide && !state.userDenied) {
          guide.style.display = 'none';
          requestAnimationFrame(() => MapAPI.invalidateSize());
        }
        if (recenter) MapAPI.setView(lat, lng, Math.max(MapAPI.getZoom(), 15), { animate: true });
        resolve([lat, lng]);
      }, err => {
        if (err && err.code === 1) {
          state.userDenied = true;
          const guide = document.getElementById('locationGuide');
          if (guide && window.innerWidth < 768 && !state.guideDismissed) guide.style.display = 'block';
          openSettingModal();
        }
        if (!silent) {
          if (err && err.code === 1) openSettingModal();
          else if (err && err.code === 2) showToast('位置情報を取得できません');
          else if (err && err.code === 3) showToast('位置情報の取得がタイムアウトしました');
          else showToast('位置情報エラー');
        }
        reject(err);
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  }

  /* ---------- サイドパネル ---------- */
  function togglePanel(force) {
    const panel = document.getElementById('panel');
    const overlay = document.getElementById('overlay');
    const btn = document.getElementById('toggleFilter');
    const open = force !== undefined ? force : !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    overlay.classList.toggle('show', open);
    btn.classList.toggle('active', open);
    panel.setAttribute('aria-hidden', String(!open));
    setTimeout(() => MapAPI.invalidateSize(), 300);
  }

  /* ---------- 位置情報許可モーダル ---------- */
  function openSettingModal() {
    if (window.innerWidth >= 768) return; // PCなら表示しない
    const m = document.getElementById('settingModal');
    if (!m) return;
    m.classList.add('show');
    m.setAttribute('aria-hidden', 'false');
  }
  function closeSettingModal() {
    const m = document.getElementById('settingModal');
    if (!m) return;
    m.classList.remove('show');
    m.setAttribute('aria-hidden', 'true');
  }

  /* ---------- 自動現在地 / 権限監視 ---------- */
  function tryAutoLocate() {
    // event_id 遷移時は現在地に地図を移動させない（対象ピンにフォーカスを保つ）
    const recenter = !state.hasTargetEvent;
    locate({ silent: true, recenter: recenter }).then(ll => {
      if (state.hasTargetEvent) return;
      try {
        MapAPI.recenterIfWithinPois(ll[0], ll[1], state.pois);
      } catch (_) {}
    }).catch(() => {});
  }

  function initGeoByPermission() {
    if (!navigator.geolocation) return;
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(res => {
        state.geoPermission = res.state;
        const guide = document.getElementById('locationGuide');
        if (res.state === 'denied') {
          state.userDenied = true;
          if (guide && window.innerWidth < 768) guide.style.display = 'block';
          if (!state.dismissedPermissionModal) openSettingModal();
        } else {
          state.userDenied = false;
          if (guide && state.geoPermission === 'granted') {
            guide.style.display = 'none';
            requestAnimationFrame(() => MapAPI.invalidateSize());
          }
          tryAutoLocate();
        }
        res.onchange = () => {
          state.geoPermission = res.state;
          if (res.state === 'denied') {
            state.userDenied = true;
            if (guide && window.innerWidth < 768) guide.style.display = 'block';
            if (!state.dismissedPermissionModal) openSettingModal();
          } else {
            state.userDenied = false;
            if (guide && state.geoPermission === 'granted') {
              guide.style.display = 'none';
              requestAnimationFrame(() => MapAPI.invalidateSize());
            }
            locate({ silent: true, recenter: false }).catch(() => {});
          }
        };
      }).catch(() => tryAutoLocate());
    } else {
      tryAutoLocate();
    }
  }

  /* ---------- イベント配線 ---------- */
  function wireEvents() {
    document.getElementById('locateBtn').addEventListener('click', () => locate({ silent: false, recenter: true }));
    document.getElementById('toggleFilter').addEventListener('click', () => togglePanel());
    document.getElementById('overlay').addEventListener('click', () => togglePanel(false));
    document.getElementById('selectAll').addEventListener('click', () => {
      document.querySelectorAll('#catList input').forEach(cb => {
        cb.checked = true; state.active.add(cb.dataset.id);
        cb.closest('.cat-item').classList.remove('off');
      });
      applyFilter();
    });
    document.getElementById('clearAll').addEventListener('click', () => {
      document.querySelectorAll('#catList input').forEach(cb => {
        cb.checked = false; cb.closest('.cat-item').classList.add('off');
      });
      state.active.clear();
      applyFilter();
    });
    document.getElementById('settingCancel').addEventListener('click', closeSettingModal);
    document.getElementById('closeGuideBtn').addEventListener('click', () => {
      state.guideDismissed = true;
      const guide = document.getElementById('locationGuide');
      if (guide) { guide.style.display = 'none'; requestAnimationFrame(() => MapAPI.invalidateSize()); }
    });
    document.getElementById('settingGo').addEventListener('click', () => {
      window.open('https://drop.machiapps.com/nakanoshima/location-permissions/', '_blank', 'noopener,noreferrer');
    });
    document.getElementById('settingModal').addEventListener('click', (e) => {
      if (e.target.id === 'settingModal') closeSettingModal();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!navigator.permissions || !navigator.permissions.query) return;
      navigator.permissions.query({ name: 'geolocation' }).then(res => {
        state.geoPermission = res.state;
        const guide = document.getElementById('locationGuide');
        if (res.state === 'denied') {
          state.userDenied = true;
          if (guide && window.innerWidth < 768 && !state.guideDismissed) guide.style.display = 'block';
        } else {
          state.userDenied = false;
          if (guide) guide.style.display = 'none';
          locate({ silent: true, recenter: false }).catch(() => {});
        }
      }).catch(() => {});
    });
  }

  /* ---------- データ読込 → 起動 ---------- */
  function loadData() {
    fetch('pois.json')
      .then(r => { if (!r.ok) throw new Error('pois.json 読み込みエラー (' + r.status + ')'); return r.json(); })
      .then(data => {
        state.categories = data.categories || [];
        state.pois = (data.pois || []).filter(p =>
          p.spot && typeof p.spot.latitude === 'number' && typeof p.spot.longitude === 'number');
        state.categories.forEach(c => state.active.add(String(c.category_id)));
        renderCategories();
        renderMarkers();

        MapAPI.fitBounds(state.pois.map(p => ({ lat: p.spot.latitude, lng: p.spot.longitude })), { padding: 40 });
        state.hasFitInitial = true;
        document.getElementById('loading').style.display = 'none';

        // 別サイトからの遷移（?event_id=xxxx）でピンのポップアップを自動表示
        const targetEventId = getTargetEventId();
        if (targetEventId) {
          state.hasTargetEvent = true;
          focusEvent(targetEventId);
        }
        initGeoByPermission();
      })
      .catch(err => {
        document.getElementById('loading').textContent = 'Error: ' + err.message;
        console.error(err);
      });
  }

  /* ---------- 起動シーケンス ---------- */
  function boot() {
    if (!MapAPI) {
      document.getElementById('loading').textContent = 'Error: MapAdapter 未読込（config.js の MAP_PROVIDER を確認）';
      return;
    }
    MapAPI.init({
      containerId: 'map',
      center: CFG.INITIAL_CENTER || { lat: 34.6937, lng: 135.5023 },
      zoom: CFG.INITIAL_ZOOM || 14
    }).then(() => {
      wireEvents();
      loadData();
    }).catch(err => {
      document.getElementById('loading').textContent = 'Error: 地図初期化に失敗 (' + (err && err.message ? err.message : err) + ')';
      console.error(err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
