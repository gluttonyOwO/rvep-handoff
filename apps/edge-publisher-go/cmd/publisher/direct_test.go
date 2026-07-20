package main

import (
	"strings"
	"testing"
)

func TestShouldUseDirectMode(t *testing.T) {
	t.Setenv("LIVEKIT_URL", "")
	t.Setenv("LIVEKIT_API_KEY", "")
	t.Setenv("LIVEKIT_API_SECRET", "")
	t.Setenv("ROOM", "")
	if shouldUseDirectMode() {
		t.Fatal("expected direct mode to be disabled without LiveKit env")
	}

	t.Setenv("ROOM", "ugv-vehicle-001")
	if !shouldUseDirectMode() {
		t.Fatal("expected direct mode to be enabled when ROOM is set")
	}
}

func TestLoadDirectConfigDefaults(t *testing.T) {
	t.Setenv("LIVEKIT_URL", "wss://lk.o3o.tw:7880")
	t.Setenv("LIVEKIT_API_KEY", "devkey")
	t.Setenv("LIVEKIT_API_SECRET", "devsecret")
	t.Setenv("ROOM", "ugv-vehicle-001")
	t.Setenv("IDENTITY", "")
	t.Setenv("DEVICE", "")
	t.Setenv("FPS", "")
	t.Setenv("BITRATE", "")
	t.Setenv("GSTREAMER_PIPELINE", "")

	cfg, err := loadDirectConfig()
	if err != nil {
		t.Fatalf("loadDirectConfig returned error: %v", err)
	}

	if cfg.Identity != "r2-camera" {
		t.Fatalf("expected default identity r2-camera, got %q", cfg.Identity)
	}
	if cfg.Device != "/dev/video0" {
		t.Fatalf("expected default device /dev/video0, got %q", cfg.Device)
	}
	if cfg.FPS != 30 {
		t.Fatalf("expected default fps 30, got %d", cfg.FPS)
	}
	if cfg.Bitrate != 1000 {
		t.Fatalf("expected default bitrate 1000, got %d", cfg.Bitrate)
	}
	if cfg.InputWidth != 1920 || cfg.InputHeight != 1536 {
		t.Fatalf("expected default input size 1920x1536, got %dx%d", cfg.InputWidth, cfg.InputHeight)
	}
	if cfg.OutputWidth != 1920 || cfg.OutputHeight != 1536 {
		t.Fatalf("expected default output size 1920x1536, got %dx%d", cfg.OutputWidth, cfg.OutputHeight)
	}
	if cfg.InputFormat != "UYVY" {
		t.Fatalf("expected default input format UYVY, got %q", cfg.InputFormat)
	}
}

func TestLoadDirectConfigRejectsBadBitrate(t *testing.T) {
	t.Setenv("LIVEKIT_URL", "wss://lk.o3o.tw:7880")
	t.Setenv("LIVEKIT_API_KEY", "devkey")
	t.Setenv("LIVEKIT_API_SECRET", "devsecret")
	t.Setenv("ROOM", "ugv-vehicle-001")
	t.Setenv("BITRATE", "0")

	if _, err := loadDirectConfig(); err == nil {
		t.Fatal("expected BITRATE=0 to fail")
	}
}

func TestLoadDirectConfigDefaultsOutputToInputSize(t *testing.T) {
	t.Setenv("LIVEKIT_URL", "wss://lk.o3o.tw:7880")
	t.Setenv("LIVEKIT_API_KEY", "devkey")
	t.Setenv("LIVEKIT_API_SECRET", "devsecret")
	t.Setenv("ROOM", "ugv-vehicle-001")
	t.Setenv("INPUT_WIDTH", "1280")
	t.Setenv("INPUT_HEIGHT", "720")
	t.Setenv("OUTPUT_WIDTH", "")
	t.Setenv("OUTPUT_HEIGHT", "")

	cfg, err := loadDirectConfig()
	if err != nil {
		t.Fatalf("loadDirectConfig returned error: %v", err)
	}

	if cfg.OutputWidth != cfg.InputWidth || cfg.OutputHeight != cfg.InputHeight {
		t.Fatalf("expected default output size to match input size, got input=%dx%d output=%dx%d",
			cfg.InputWidth, cfg.InputHeight, cfg.OutputWidth, cfg.OutputHeight)
	}
}

func TestLoadDirectConfigHonorsOutputAndFormatOverrides(t *testing.T) {
	t.Setenv("LIVEKIT_URL", "wss://lk.o3o.tw:7880")
	t.Setenv("LIVEKIT_API_KEY", "devkey")
	t.Setenv("LIVEKIT_API_SECRET", "devsecret")
	t.Setenv("ROOM", "ugv-vehicle-001")
	t.Setenv("INPUT_WIDTH", "1920")
	t.Setenv("INPUT_HEIGHT", "1536")
	t.Setenv("OUTPUT_WIDTH", "1280")
	t.Setenv("OUTPUT_HEIGHT", "720")
	t.Setenv("INPUT_FORMAT", "YUY2")

	cfg, err := loadDirectConfig()
	if err != nil {
		t.Fatalf("loadDirectConfig returned error: %v", err)
	}

	if cfg.OutputWidth != 1280 || cfg.OutputHeight != 720 {
		t.Fatalf("expected explicit output size 1280x720, got %dx%d", cfg.OutputWidth, cfg.OutputHeight)
	}
	if cfg.InputFormat != "YUY2" {
		t.Fatalf("expected input format override YUY2, got %q", cfg.InputFormat)
	}
}

func TestPipelineStringUsesOverride(t *testing.T) {
	cfg := directConfig{Pipeline: "videotestsrc ! appsink name=sink"}
	if got := cfg.pipelineString(); got != cfg.Pipeline {
		t.Fatalf("expected override pipeline %q, got %q", cfg.Pipeline, got)
	}
}

func TestPipelineStringBuildsJetsonPipeline(t *testing.T) {
	cfg := directConfig{
		Device:       "/dev/video0",
		FPS:          30,
		Bitrate:      1000,
		InputWidth:   1920,
		InputHeight:  1536,
		OutputWidth:  1920,
		OutputHeight: 1536,
		InputFormat:  "UYVY",
	}

	pipeline := cfg.pipelineString()
	for _, want := range []string{
		"nvv4l2camerasrc device=/dev/video0",
		"video/x-raw(memory:NVMM),width=1920,height=1536,format=UYVY,framerate=30/1",
		"video/x-raw(memory:NVMM),width=1920,height=1536,format=NV12",
		"nvv4l2h264enc bitrate=1000000 iframeinterval=30 preset-level=3 insert-sps-pps=true",
		"video/x-h264,stream-format=avc,alignment=au",
		"video/x-h264,stream-format=byte-stream,alignment=au",
		"appsink name=sink sync=false drop=true max-buffers=1 emit-signals=true",
	} {
		if !strings.Contains(pipeline, want) {
			t.Fatalf("expected pipeline to contain %q, got %q", want, pipeline)
		}
	}

	avcIdx := strings.Index(pipeline, "video/x-h264,stream-format=avc,alignment=au")
	byteStreamIdx := strings.Index(pipeline, "video/x-h264,stream-format=byte-stream,alignment=au")
	if avcIdx == -1 || byteStreamIdx == -1 || avcIdx >= byteStreamIdx {
		t.Fatalf("expected AVC parse stage before byte-stream stage, got %q", pipeline)
	}
}
