# イケフェス大阪2026 MAP — ファイル構成（CARTO / Google 切替対応）

ペライチだった `index.html` を、**共通ロジック**と**地図固有処理**に分離しました。
地図の違いは `MapAdapter`（共通インターフェース）で吸収し、`config.js` の1行で切替できます。

## ファイル一覧
| ファイル | 役割 | 変更頻度 |
|---|---|---|
| `index.html` | HTML骨格・CSS/JS読込のみ | 低 |
| `config.js` | **MAP_PROVIDER** と APIキー（CARTO / Google） | 切替時のみ |
| `app.js` | **共通ロジック**（POI・カテゴリ・フィルタ・サイドパネル・event_idディープリンク・トースト・ガイド・GA計測・現在地） | 高（★両版共通） |
| `map-carto.js` | MapAdapter実装（Leaflet + CARTOタイル） | 地図固有のみ |
| `map-google.js` | MapAdapter実装（Google Maps JS API） | 地図固有のみ |
| `style.css` | 共通スタイル（外だし） | 中（両版共通） |
| `pois.json` | POIデータ（変更なし） | ― |
| `redirect_test.html` | 別サイト擬似＋プロバイダ切替テスト | ― |

## 切替方法
- **恒久切替**：`config.js` の `MAP_PROVIDER` を `'carto'` か `'google'` に変更（既定は `'carto'`）。
- **一時切替（テスト）**：URLに `?map=google` / `?map=carto`（`&event_id=◯◯` と併用可）。

## 「変更が両方に反映される」設計
- UI・データ・挙動（フィルタ／サイドパネル／event_id遷移／カテゴリ／トースト／GA）は **すべて `app.js` に集約**。
  → ここを1回直せば CARTO版・Google版の両方に自動反映。
- 地図ライブラリ依存コードだけを `map-carto.js` / `map-google.js` に隔離。
- 追加時は下記インターフェースを満たすだけ（`config.js` の1行で有効化）。

## MapAdapter インターフェース（両アダプタが実装）
```
init({containerId, center, zoom}) => Promise
addMarker({id, lat, lng, color, popupHtml, onClick, onPopupOpen}) => ref
showMarker(ref) / hideMarker(ref)
openPopup(ref) / closePopup()
setView(lat, lng, zoom, {animate}) / getZoom()
fitBounds([{lat,lng}...], {padding})
panBy(dx, dy)                       // サイドパネル回避に使用
setMe(lat, lng, accuracy)           // 現在地マーカー
recenterIfWithinPois(lat, lng, pois)
invalidateSize()
```

## Google Maps 版を使う前に（要対応）
1. Google Cloud で **Maps JavaScript API** を有効化し、APIキーを発行。
2. `config.js` の `GOOGLE_MAPS_API_KEY` に設定（未設定だと Google 版は地図が出ません）。
3. **HTTPリファラ制限**（自ドメインのみ）・**利用上限アラート**を必ず設定（GitHub Pages公開でキーが露出するため）。

## 動作確認（ローカル）
`pois.json` を fetch するためローカルサーバー経由で開いてください。
```
python -m http.server 8000
# CARTO版:  http://localhost:8000/index.html?event_id=EV01003026
# Google版: http://localhost:8000/index.html?map=google&event_id=EV01003026
# テストUI: http://localhost:8000/redirect_test.html
```
