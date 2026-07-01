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

func TestPipelineStringUsesOverride(t *testing.T) {
	cfg := directConfig{Pipeline: "videotestsrc ! appsink name=sink"}
	if got := cfg.pipelineString(); got != cfg.Pipeline {
		t.Fatalf("expected override pipeline %q, got %q", cfg.Pipeline, got)
	}
}

func TestPipelineStringBuildsUSBPipeline(t *testing.T) {
	cfg := directConfig{
		Device:  "/dev/video0",
		FPS:     30,
		Bitrate: 1000,
	}

	pipeline := cfg.pipelineString()
	for _, want := range []string{
		"v4l2src device=/dev/video0",
		"video/x-raw,framerate=30/1",
		"x264enc tune=zerolatency bitrate=1000 key-int-max=30",
		"appsink name=sink",
	} {
		if !strings.Contains(pipeline, want) {
			t.Fatalf("expected pipeline to contain %q, got %q", want, pipeline)
		}
	}
}
