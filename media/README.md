# Media

`media/` 主要保存 **資產索引與小型必要 runtime assets**，不是把所有學習音檔直接塞進普通 Git。

大型音訊、SMAC / SNAC、offline bundle 的實際儲存策略請依 [`../docs/ASSET_STRATEGY.md`](../docs/ASSET_STRATEGY.md)。

未來建議至少維護：

```text
media/
├── manifests/
│   ├── audio.json
│   └── bundles.json
└── README.md
```

每個 manifest item 應可透過 stable ID 對應 collection、chapter、檔名、checksum、size、storage location 與 rights status。

公開 repository 中不直接提交未確認可公開散布的第三方衍生音訊或其他受限制資產。
