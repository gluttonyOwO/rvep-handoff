#!/usr/bin/env bash
# r2-camera-publisher — C270 → CPU x264enc H.264 → LiveKit room
#
# Pipeline (Updated for Jetson Thor - CPU Compatibility Mode):
#   v4l2src → videoconvert → x264enc (Software) → h264parse → fdsink fd=1
#   → socat stdin → UNIX-LISTEN socket
#   → lk room join --publish=h264:///socket → LiveKit SFU
#
# Reads config from /etc/rvep/r2-bridge.env.

set -e

: "${LIVEKIT_URL:?LIVEKIT_URL required}"
: "${LIVEKIT_API_KEY:?LIVEKIT_API_KEY required}"
: "${LIVEKIT_API_SECRET:?LIVEKIT_API_SECRET required}"
: "${ROOM:?ROOM required}"
: "${IDENTITY:=r2-camera}"
: "${FPS:=30}"
: "${BITRATE:=1500}"
: "${DEVICE:=/dev/video0}"

SOCK=/tmp/r2cam.sock
rm -f "$SOCK"

trap 'jobs -p | xargs -r kill 2>/dev/null; rm -f "$SOCK"; exit' EXIT INT TERM

# Pipeline 1: GStreamer 透過 CPU 進行 H.264 軟編碼，並輸出至 UNIX socket
# 使用 I420 格式對接 x264enc，開啟非常快速與零延遲模式
( gst-launch-1.0 -q \
      v4l2src device="$DEVICE" \
    ! videoconvert \
    ! 'video/x-raw, format=I420' \
    ! x264enc speed-preset=veryfast tune=zerolatency bitrate="$BITRATE" \
    ! h264parse \
    ! fdsink fd=1 \
  | socat - UNIX-LISTEN:"$SOCK",fork,reuseaddr ) &
PIPE_PID=$!

# Wait for UNIX socket to appear (socat creates it when gst starts writing)
for i in 1 2 3 4 5 6 7 8 9 10; do
  [ -S "$SOCK" ] && break
  sleep 0.5
done

if [ ! -S "$SOCK" ]; then
  echo "ERROR: socket $SOCK never appeared" >&2
  exit 2
fi

# Pipeline 2: lk (v2.7.0) reads from UNIX socket, publishes to LiveKit room
exec /usr/local/bin/lk room join \
  --url "$LIVEKIT_URL" \
  --api-key "$LIVEKIT_API_KEY" \
  --api-secret "$LIVEKIT_API_SECRET" \
  --identity "$IDENTITY" \
  --publish "h264:///$SOCK" \
  --fps "$FPS" \
  "$ROOM"