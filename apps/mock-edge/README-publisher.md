# mock-edge — Go Video Publisher 整合說明

## 概覽

`mock-edge` 在 `VIDEO_PUBLISHER_ENABLED=true` 時，會替每顆相機 spawn 一個 Go `rvep-publisher` binary，透過 Unix socket IPC 進行握手與生命週期管理。

```text
mock-edge (Node)
  └─ GoPublisherManager × N cameras
       ├─ Unix socket: /var/run/rvep/{vehicleId}/publisher-{cameraId}.sock
       └─ child_process: rvep-publisher binary (Go)
```

## Orin 環境準備

### 1. 建立 socket 目錄並設定權限

以 `mirdc` 帳號執行：

```bash
sudo mkdir -p /var/run/rvep/vehicle-001
sudo chown mirdc:mirdc /var/run/rvep/vehicle-001
sudo chmod 700 /var/run/rvep/vehicle-001
```

若有多台車，每台 vehicleId 需各自建立目錄。

### 2. 放置 Go publisher binary

將編譯完成的 `rvep-publisher` binary 複製到 Orin：

```bash
# 從開發機複製（aarch64 build）
scp dist/rvep-publisher mirdc@192.168.68.67:/usr/local/bin/rvep-publisher
ssh mirdc@192.168.68.67 chmod +x /usr/local/bin/rvep-publisher
```

或透過 `RVEP_PUBLISHER_BIN` env 指定自訂路徑（見下方環境變數說明）。

### 3. 準備 camera profile YAML

每顆相機需要一份 YAML profile，放到 Orin 上。範例路徑：

```
/etc/rvep/cameras/front.yaml
/etc/rvep/cameras/rear.yaml
```

YAML 格式見 `openspec/edge/camera-profile.md`（或 `apps/edge-publisher-go/` 範例）。

## 環境變數

| 環境變數 | 預設值 | 說明 |
|---|---|---|
| `VIDEO_PUBLISHER_ENABLED` | `false` | 設為 `true` 才會啟動 publisher manager |
| `VIDEO_PUBLISHER_CAMERA_PROFILES` | `""` | 逗號分隔的 camera profile YAML 絕對路徑 |
| `RVEP_PUBLISHER_BIN` | `/usr/local/bin/rvep-publisher` | Go publisher binary 路徑（可覆蓋）|
| `LIVEKIT_URL` | `ws://192.168.68.68:7880` | Livekit SFU URL |
| `LIVEKIT_API_KEY` | `devkey` | Livekit API Key |
| `LIVEKIT_API_SECRET` | `devsecret` | Livekit API Secret |
| `VEHICLE_ID` | `vehicle-001` | 決定 socket 目錄名稱與房間名稱 |

## Orin 上啟動順序

```bash
# 1. 確認 binary + YAML 已就位
ls -la /usr/local/bin/rvep-publisher
ls -la /etc/rvep/cameras/

# 2. 確認 socket 目錄存在（手動建立一次即可）
ls -la /var/run/rvep/

# 3. 啟動 mock-edge（含 publisher）
cd /home/mirdc/remote-vehicle-platform
VIDEO_PUBLISHER_ENABLED=true \
VIDEO_PUBLISHER_CAMERA_PROFILES=/etc/rvep/cameras/front.yaml,/etc/rvep/cameras/rear.yaml \
LIVEKIT_URL=ws://192.168.68.68:7880 \
LIVEKIT_API_KEY=devkey \
LIVEKIT_API_SECRET=devsecret \
VEHICLE_ID=vehicle-001 \
pnpm --filter @rvep/mock-edge start
```

## 重啟與退避策略

publisher crash 時自動重啟，退避時間序列：

```
1s → 2s → 4s → 8s → 16s → 30s (cap)
```

連續失敗 10 次後標記 `publisher_failed` 並停止重啟，需人工介入。
audit log 寫入 `publisher_crashed`、`publisher_restarted`、`publisher_failed`。

## 關機順序（SIGTERM / SIGINT）

mock-edge 收到 SIGTERM 時：

1. 對所有 publisher 送 IPC `stop` 訊息（reason: `shutdown`）
2. 等待 publisher graceful exit（最多 5 秒，超時送 SIGKILL）
3. `room.disconnect()`（publisher 先離開才不會在 SFU 留 ghost track）
4. `process.exit(0)`

## 安全注意事項

- socket 目錄權限必須是 `700`，socket 檔案是 `600`
- Livekit publisher token **不**會出現在任何 log 或 audit endpoint 輸出中
- publisher token TTL 上限 3600 秒（1 小時），超過自動 clamp
