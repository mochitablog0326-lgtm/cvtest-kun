# build/

electron-builder が参照するリソースを置く場所です。

## 必要なファイル（未同梱）

| ファイル | 用途 | 要件 |
|---|---|---|
| `icon.icns` | macOS アプリアイコン | 1024x1024 を含む icns |
| `icon.ico` | Windows アプリアイコン | 256x256 を含む ico |

**アイコンを置くまで `npm run dist:mac` / `dist:win` は失敗します。**
1024x1024 の PNG を用意して次で生成できます。

```bash
# macOS
npx electron-icon-builder --input=icon.png --output=build

# もしくは手動で
mkdir icon.iconset
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
# ... 各サイズを作ってから
iconutil -c icns icon.iconset -o build/icon.icns
```

`entitlements.mac.plist` は公証（notarization）に必要な権限を定義済みです。
Playwright が子プロセスでブラウザを起動するため、JIT と library validation の
緩和が入っています。
