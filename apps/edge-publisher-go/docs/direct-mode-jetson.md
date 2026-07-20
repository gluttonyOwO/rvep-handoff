# Jetson direct mode

Use this command to publish `/dev/video0` to LiveKit with the default
direct-mode pipeline:

```bash
cd /home/mic-742/rvep-handoff/apps/edge-publisher-go

LIVEKIT_URL=ws://lk.o3o.tw:7880 \
LIVEKIT_API_KEY=devkey \
LIVEKIT_API_SECRET=devsecret \
ROOM=ugv-vehicle-001 \
IDENTITY=r2-camera-test \
DEVICE=/dev/video0 \
FPS=30 \
BITRATE=4000 \
go run ./cmd/publisher
```

## Default direct-mode pipeline

```text
nvv4l2camerasrc device=/dev/video0 !
video/x-raw(memory:NVMM),width=1920,height=1536,format=UYVY,framerate=30/1 !
nvvidconv !
video/x-raw(memory:NVMM),width=1920,height=1536,format=NV12 !
nvv4l2h264enc bitrate=4000000 iframeinterval=30 preset-level=3 insert-sps-pps=true !
h264parse !
video/x-h264,stream-format=avc,alignment=au !
h264parse !
video/x-h264,stream-format=byte-stream,alignment=au !
appsink name=sink sync=false drop=true max-buffers=1 emit-signals=true
```

## Pipeline explanation

1. `nvv4l2camerasrc`: capture from the Jetson V4L2 camera as NVMM buffers.
2. `video/x-raw(... UYVY ...)`: lock the source to `1920x1536 @ 30fps`.
3. `nvvidconv`: convert the camera output into an encoder-friendly NVMM format.
4. `video/x-raw(... NV12 ...)`: keep the original frame size and convert to the encoder's preferred pixel format.
5. `nvv4l2h264enc`: Jetson hardware H.264 encoder. `BITRATE=4000` becomes `4000000` bps, and `preset-level=3` selects the low-latency preset.
6. First `h264parse`: normalize the encoder output to AVC access-unit format.
7. Second `h264parse`: convert the same stream into byte-stream format, which is the path already validated in this repo for full `1920x1536` direct mode.
8. `appsink`: hand encoded H.264 frames to the Go publisher with `max-buffers=1` so backpressure drops old frames instead of adding latency.

## Notes

- Keep `IDENTITY` unique inside the room. Reusing the same identity can trigger
  `DUPLICATE_IDENTITY`.
- If you want a different encoded size, set `OUTPUT_WIDTH` and `OUTPUT_HEIGHT`.
- If you need a one-off custom pipeline, set `GSTREAMER_PIPELINE` to the full
  pipeline string and keep the tail as `appsink name=sink`.
