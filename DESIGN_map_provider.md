# イケフェス大阪2026 MAP ― 地図プロバイダ差し替え設計案

## 1. 目的 / 背景
- 現状 `index.html` が**ペライチ**（HTML＋CSS＋JS 全部入り）で、地図描画（Leaflet + CARTOタイル）と
  アプリ共通ロジック（POI読込・カテゴリ・フィルタ・サイドパネル・event_id ディープリンク等）が混在。
- 今後、背景地図を **CARTO** にするか **Google Maps** にするか未確定。両方を並行して持ちたい。
- **要件**：片方（例：フィルタUIやディープリンク）の変更が、できるだけ CARTO版・Google版の両方に自動反映されること。

## 2. 設計方針（結論）
**「共通ロジック」と「地図固有処理」を分離**し、両者の間に **MapAdapter（地図アダプタ）という共通インターフェース**を挟む。
アプリ本体は地図ライブラリを直接触らず、必ず `MapAdapter` 経由で地図を操作する。
→ 地図の違い（Leaflet か Google Maps か）は各アダプタ内に**閉じる**ので、共通ロジックの変更は1回で両対応。

```
┌─────────────────────────────────────────────┐
│ index.html  … 共通のHTML骨格＋CSS＋各JS読込     │
│   ├─ config.js   … MAP_PROVIDER と APIキー（ここを1行変えるだけで切替）│
│   ├─ app.js      … 共通ロジック（両版で共有＝ここを直せば両方に反映）│
│   └─ 地図アダプタ（config.jsの指定に応じて片方だけ読込）           │
│        ├─ map-carto.js   … CARTO/Leaflet 実装                    │
│        └─ map-google.js  … Google Maps 実装                      │
└─────────────────────────────────────────────┘
        ↓ 共有
      pois.json / style.css （変更なし・共通）
```

## 3. ファイル構成
| ファイル | 役割 | 変更頻度 |
|---|---|---|
| `index.html` | HTML骨格・CSS/JS読込のみ（ロジックは持たない） | 低 |
| `config.js` | `MAP_PROVIDER:'carto'│'google'`、CARTO_API_KEY、GOOGLE_MAPS_API_KEY | 切替時のみ |
| `app.js` | **共通ロジック**（POI・カテゴリ・フィルタ・サイドパネル・event_id・トースト・ガイド・テーマ） | 高（＝両版共通） |
| `map-carto.js` | MapAdapter実装（Leaflet＋CARTOタイル）。Leaflet CSS/JSを動的ロード | 地図固有のみ |
| `map-google.js` | MapAdapter実装（Google Maps JS API）。Maps APIを動的ロード | 地図固有のみ |
| `style.css` | 共通スタイル（現状のCSSを外だし） | 中（両版共通） |
| `pois.json` | POIデータ（現状のまま） | ― |

> 既定は `config.js` の `MAP_PROVIDER:'carto'`。Google版で確認したいときだけ `'google'` に変える
> （または `?map=google` のようなURLパラメータで一時切替も可能にできる）。

## 4. MapAdapter インターフェース（両アダプタが実装する契約）
`app.js` はこの関数群しか呼ばない。CARTO/Google はそれぞれこの契約を満たすだけ。

```js
window.MapAdapter = {
  init({ containerId, theme }),          // 地図初期化（Promiseでready）
  setTheme(theme),                        // 'light' | 'dark' 切替
  addMarker({ id, lat, lng, category, onClick }) => markerRef,  // ピン生成
  removeMarker(markerRef),
  showMarker(markerRef), hideMarker(markerRef),  // フィルタ表示/非表示
  clearMarkers(),
  openPopup(markerRef, htmlString),       // 吹き出し表示（Leaflet=Popup / Google=InfoWindow）
  closePopup(),
  setView(lat, lng, zoom, opts),          // 中心・ズーム
  fitBounds(bounds, opts),                // 全ピンにフィット
  panBy(dx, dy),                          // ピクセル単位移動（サイドパネル回避に使用）
  getZoom(),
  locate({ silent, recenter }) => Promise<{lat,lng}>,  // 現在地
  invalidateSize()                        // リサイズ再計算
};
```

### 地図固有の差異と吸収方法
| 機能 | CARTO(Leaflet) | Google Maps | Adapterでの吸収 |
|---|---|---|---|
| 吹き出し | `L.popup` / `bindPopup` | `InfoWindow` | `openPopup(ref, html)` |
| ピンクリック | `marker.on('click')` | `marker.addListener('click')` | `addMarker({onClick})` |
| ライト/ダーク | タイルURL差し替え | `styledMapType`(JSON) | `setTheme()` |
| 現在地 | 独自 `locate()` | `navigator.geolocation` | `locate()` |
| ピクセル移動 | `map.panBy` | `map.panBy` | `panBy()` |

## 5. 「変更が両方に反映される」担保
- **UI・データ・挙動（フィルタ、サイドパネル、event_idディープリンク、トースト、ガイド、カテゴリ）は
  すべて `app.js` に集約** → ここを直せば CARTO版・Google版の両方に自動反映。
- **地図ライブラリ依存コードだけ**が `map-carto.js` / `map-google.js` に存在 → 地図固有のバグ修正のみ個別対応。
- インターフェース（第4章）を崩さない限り、アダプタ差し替えは `config.js` の1行変更で完結。

## 6. 想定リスク / 相談したい論点（→日野さん）
1. **Google Maps の課金**：Maps JavaScript API は従量課金（Map loads 課金）。イベント時の高トラフィックで
   想定コスト・上限アラート設計が必要。無料枠（月$200相当）で足りるか要試算。
2. **APIキーの露出**：GitHub Pages公開のためソースにキーが乗る。Google側はHTTPリファラ制限必須、
   CARTOキーも同様にドメイン制限を推奨。
3. **ライセンス/表記**：CARTO・Google それぞれの帰属表示（attribution）要件の担保。
4. **UI差異**：Google Maps は既定UI（Googleロゴ・ストリートビュー等）が入るため、現行のミニマルな
   デザインにどこまで寄せるか（styledMapType＋UIオプションで調整）。
5. **保守体制**：アダプタ2本持ちの保守コスト。将来的にどちらか一本化する判断基準。

## 7. 実装ステップ（提案）
1. 現行 `index.html` のCSSを `style.css`、JSを `app.js` に分離（挙動は変えない）。
2. 地図操作箇所を `MapAdapter` 呼び出しに置換し、`map-carto.js` に現行Leaflet実装を移設。
3. `config.js` を新設（既定 `carto`）。ここまでで**CARTO版はリファクタ完了・従来通り動作**。
4. `map-google.js` を新規実装（同一インターフェース）。`config.js` を `google` にしてGoogle版を確認。
5. 両版で event_id ディープリンク・フィルタ・サイドパネルの回帰テスト。
