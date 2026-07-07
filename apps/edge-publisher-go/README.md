# rvep-publisher — RVEP Go Video Publisher

Go binary sidecar that reads H.264 from a GStreamer + NVENC pipeline and
publishes it to a Livekit room via `livekit-server-sdk-go`.

See `openspec/decisions/ADR-006-go-video-publisher.md` for architecture rationale.

---

## Prerequisites (on Orin)

```bash
sudo apt update
sudo apt install -y \
    golang-go \
    libgstreamer1.0-dev \
    libgstreamer-plugins-base1.0-dev \
    libgstreamer-plugins-bad1.0-dev \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-tools \
    pkg-config
```

GStreamer NVENC plugins (`nvv4l2h264enc`, `nvarguscamerasrc`) come with the
JetPack BSP and are pre-installed on L4T R36.5 images.

---

## Build

```bash
cd apps/edge-publisher-go

# 1. Fetch Go module dependencies (requires internet on first run)
go mod tidy

# 2. Build for the current platform (aarch64 on Orin)
go build -o rvep-publisher ./cmd/publisher

# Cross-compile from x86 to aarch64 (cgo requires cross toolchain):
# GOOS=linux GOARCH=arm64 CC=aarch64-linux-gnu-gcc \
#   CGO_ENABLED=1 go build -o rvep-publisher ./cmd/publisher
```

> **Note**: cgo is required (`CGO_ENABLED=1`, default). The build links
> `libgstreamer-1.0` and `libgstreamer-app-1.0` via `pkg-config`.

---

## Run (manual / dev)

The Edge Agent normally spawns this process and provides the socket.
For manual testing, run a fake socket server or use the mock-edge Node process.

```bash
# Minimal: profile + socket path
RVEP_CAMERA_PROFILE=./configs/zed-x-front.yaml \
RVEP_SOCKET_PATH=/tmp/test-publisher-front.sock \
./rvep-publisher
```

The process will connect to the socket, send `hello`, and wait for a `start`
JSON Lines message.  To test quickly with `socat`:

```bash
# Terminal 1 — fake socket server
socat UNIX-LISTEN:/tmp/test-publisher-front.sock,fork -

# Terminal 2 — start publisher
RVEP_CAMERA_PROFILE=./configs/zed-x-front.yaml \
RVEP_SOCKET_PATH=/tmp/test-publisher-front.sock \
./rvep-publisher

# Terminal 1: after publisher sends hello, type:
{"type":"start","ts":"2026-05-17T00:00:00.000Z","seq":1,"livekitUrl":"ws://192.168.68.68:7880","livekitToken":"<JWT>","roomName":"ugv-vehicle-001","identity":"edge-front","videoProfileId":"zed-x-front-1080p30","pipelineOverride":null}
```

### Direct mode (USB camera / no IPC)

For quick bring-up with a V4L2 camera, the publisher can also mint its own
token and connect directly when `RVEP_SOCKET_PATH` / `RVEP_CAMERA_PROFILE` are
unset.

詳細更動設定:rvep-handoff/apps/edge-publisher-go/cmd/publisher/direct.go
```bash
cd apps/edge-publisher-go

LIVEKIT_URL=ws://the_domain.ip:7880 \
LIVEKIT_API_KEY=devkey \
LIVEKIT_API_SECRET=devsecret \
ROOM=ugv-vehicle-001 \
IDENTITY=r2-camera \
DEVICE=/dev/video0 \
FPS=30 \
BITRATE=1000 \
go run ./cmd/publisher
```

This direct mode uses a default pipeline equivalent to:

```text
v4l2src -> videorate -> videoconvert -> x264enc -> h264parse -> appsink
```

If your camera needs explicit caps or a custom source chain, set
`GSTREAMER_PIPELINE` to a full pipeline string that ends with
`appsink name=sink`.

---

## Unit Tests

The h264 package has pure-Go unit tests (no cgo, no hardware required):

```bash
go test ./internal/h264/...
```

---

## Systemd Deployment

```bash
# Copy binary
sudo cp rvep-publisher /usr/local/bin/

# Copy camera profiles
sudo mkdir -p /etc/rvep/cameras
sudo cp configs/zed-x-front.yaml /etc/rvep/cameras/front.yaml
sudo cp configs/zed-x-rear.yaml  /etc/rvep/cameras/rear.yaml

# Install systemd template unit
sudo cp systemd/rvep-publisher@.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable + start both cameras
sudo systemctl enable --now rvep-publisher@front
sudo systemctl enable --now rvep-publisher@rear

# Logs
journalctl -u rvep-publisher@front -f
```

---

## Project Layout

```
cmd/publisher/main.go          — entrypoint: env, IPC, lifecycle
internal/config/profile.go     — YAML profile loader + validator
internal/gst/
  pipeline.h                   — C header (cgo bridge contract)
  pipeline.go                  — cgo wrapper: GStreamer pipeline + appsink
internal/h264/
  avcc_to_annexb.go            — AVCC→Annex B conversion (no SPS/PPS injection)
  avcc_to_annexb_test.go       — unit tests
internal/publisher/livekit.go  — Livekit LocalSampleTrack publish loop
internal/ipc/
  protocol.go                  — JSON Lines message types
  server.go                    — Unix socket client + heartbeat loop
configs/
  zed-x-front.yaml             — camera 0 (front) profile
  zed-x-rear.yaml              — camera 1 (rear) profile
systemd/
  rvep-publisher@.service      — systemd template unit
```

---

## Known Build-time Gotchas

1. **`pkg-config` must find gstreamer-1.0 and gstreamer-app-1.0.**
   If `go build` fails with "package not found", run:
   ```bash
   pkg-config --modversion gstreamer-1.0 gstreamer-app-1.0
   ```
   and install the missing `-dev` packages.

2. **lksdk import path** — this module uses `github.com/livekit/server-sdk-go/v2`.
   After `go mod tidy`, verify `go.sum` is populated before committing.

3. **GStreamer 1.20 vs 1.22** — `appsink` callbacks changed signature in some
   intermediate versions.  The `GstAppSinkCallbacks` struct used in `pipeline.go`
   is the GStreamer 1.20 API (compatible with L4T R36.5).

4. **`nvarguscamerasrc` requires camera hardware.**  On a dev machine without
   ZED-X attached, the pipeline will fail to enter PLAYING state with a
   `GST_STATE_CHANGE_FAILURE`.  Use the `pipelineOverride` in the `start` IPC
   message to substitute a `videotestsrc` for local testing:
   ```json
   "pipelineOverride": "videotestsrc ! video/x-raw,width=1920,height=1080,framerate=30/1 ! x264enc ! h264parse ! video/x-h264,stream-format=avc,alignment=au ! appsink name=sink sync=false drop=true max-buffers=2 emit-signals=true"
   ```

5. **`WriteSample` frame duration** — currently hardcoded to `33ms` (30fps).
   Phase 2: derive from `profile.VideoProfile.Framerate` and pass via publisher constructor.
