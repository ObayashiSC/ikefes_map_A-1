/* =========================================================================
 * config.js — 地図プロバイダ設定（ここだけ変えれば CARTO ⇄ Google を切替）
 * =========================================================================
 * MAP_PROVIDER:
 *   'carto'  … CARTO(Leaflet) 版を使う（既定）
 *   'google' … Google Maps 版を使う
 *
 * URLパラメータでも一時的に切替可能:
 *   ?map=google / ?map=carto
 *   （別サイトからの event_id 遷移時はそのまま event_id も併用できます）
 * ========================================================================= */
window.APP_CONFIG = {
  // ▼▼▼ 通常はこの1行を 'carto' か 'google' に変えるだけ ▼▼▼
  MAP_PROVIDER: 'google',

  // CARTO Basemaps はラスタータイルにAPIキーが必須（?key= で付与）
  CARTO_API_KEY: 'cb1_2rcy_1_3673d2ee2e8b7013c29c99aa',

  // Google Maps JavaScript API のキー（Google Cloud で発行）
  // ※未設定のままだと Google 版は地図が表示されません
  GOOGLE_MAPS_API_KEY: 'YOUR_GOOGLE_MAPS_API_KEY',

  // 初期表示（中心・ズーム）※両プロバイダ共通
  INITIAL_CENTER: { lat: 34.6937, lng: 135.5023 },
  INITIAL_ZOOM: 14
};

/* URLの ?map= があれば優先（テスト用） */
(function () {
  try {
    var p = new URLSearchParams(window.location.search).get('map');
    if (p === 'google' || p === 'carto') {
      window.APP_CONFIG.MAP_PROVIDER = p;
    }
  } catch (e) {}
})();
