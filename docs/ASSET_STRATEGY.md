# Asset Strategy

急專補給站包含大量文字、字幕與音訊。不同資產應使用不同版本管理方式，避免 repository 變成不可維護的大型 binary 倉庫。

## 1. 普通 Git

適合：

- source code
- Markdown / TXT
- JSON / YAML / CSV 等結構化資料
- SRT / VTT / SRC 等文字型字幕
- manifests / checksums
- 小型圖片與 UI assets

優點是可以逐行比較、review、回復與追蹤歷史。

## 2. Git LFS

只在「binary 本身需要和 source commit 緊密版本綁定」時使用，例如少量較大的必要 runtime assets。啟用前要先估算 storage / bandwidth，避免無意中反覆累積完整 binary 版本。

## 3. GitHub Releases

適合完成後較少修改、可用版本號管理的大型資產包，例如：

- final audio packs
- SMAC / SNAC archive packs
- downloadable offline bundles
- migration snapshots

Repository 內保留 manifest、SHA-256、版本與下載位置，不把 release archive 再 commit 回 Git。

## 4. Private / external storage

下列資料即使技術上能存，也不應因 repository 是 Public 就直接放上去：

- 未確認公開授權的完整第三方教科書內容
- 未確認公開授權的衍生完整音訊
- 原始院內資料、病人資料或含 PHI 的檔案
- private API responses / exports

## Manifest 最低欄位

大型或外部資產至少記錄：

```json
{
  "id": "stable-asset-id",
  "collection": "rosens | tintinalli | qbank | ...",
  "kind": "audio | smac | snac | subtitle | bundle",
  "version": "...",
  "filename": "...",
  "size_bytes": 0,
  "sha256": "...",
  "storage": "release | lfs | external | private",
  "url": null,
  "rights_status": "cleared | private-only | pending-review"
}
```

## Rule of thumb

**Git 保存可審查的 source 與索引；大型 binary 保存成可驗證、可替換的資產。** 任何公開資產在上傳前都要先確認權利與隱私邊界。
