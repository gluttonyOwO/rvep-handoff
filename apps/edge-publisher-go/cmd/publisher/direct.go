package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/livekit/protocol/auth"

	"github.com/rvep/edge-publisher-go/internal/gst"
	"github.com/rvep/edge-publisher-go/internal/publisher"
)

type directConfig struct {
	LivekitURL string
	APIKey     string
	APISecret  string
	Room       string
	Identity   string
	Device     string
	FPS        int
	Bitrate    int
	Pipeline   string
}

func shouldUseDirectMode() bool {
	return os.Getenv("LIVEKIT_URL") != "" ||
		os.Getenv("LIVEKIT_API_KEY") != "" ||
		os.Getenv("LIVEKIT_API_SECRET") != "" ||
		os.Getenv("ROOM") != ""
}

func runDirectMode() {
	cfg, err := loadDirectConfig()
	if err != nil {
		fatal("load direct-mode config: %v", err)
	}

	token, err := mintDirectToken(cfg)
	if err != nil {
		fatal("mint Livekit token: %v", err)
	}

	pipelineStr := cfg.pipelineString()
	logf("starting direct mode: room=%s identity=%s device=%s", cfg.Room, cfg.Identity, cfg.Device)
	logf("pipeline: %s", summarizePipeline(pipelineStr))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	pipe, err := gst.NewPipeline(pipelineStr)
	if err != nil {
		fatal("create pipeline: %v", err)
	}
	defer pipe.Destroy()

	if err := pipe.Start(); err != nil {
		fatal("start pipeline: %v", err)
	}
	logf("GStreamer pipeline started")
	defer pipe.Stop()

	pub := publisher.New()
	if err := pub.Connect(ctx, cfg.LivekitURL, token, cfg.Identity); err != nil {
		fatal("connect to Livekit: %v", err)
	}
	logf("connected to Livekit room %q as %q", cfg.Room, cfg.Identity)
	defer pub.Disconnect()

	publishErrCh := make(chan error, 1)
	go func() {
		publishErrCh <- pub.PublishLoop(ctx, pipe.Samples(), cfg.LivekitURL, token, cfg.Identity)
	}()

	select {
	case sig := <-sigCh:
		logf("received signal %v; shutting down", sig)
	case err := <-publishErrCh:
		if err != nil {
			fatal("publish loop: %v", err)
		}
		logf("publish loop exited; shutting down")
	}

	cancel()
	logf("publisher exiting cleanly")
}

func loadDirectConfig() (directConfig, error) {
	fps, err := getenvPositiveInt("FPS", 30)
	if err != nil {
		return directConfig{}, err
	}
	bitrate, err := getenvPositiveInt("BITRATE", 1000)
	if err != nil {
		return directConfig{}, err
	}

	cfg := directConfig{
		LivekitURL: requiredEnv("LIVEKIT_URL"),
		APIKey:     requiredEnv("LIVEKIT_API_KEY"),
		APISecret:  requiredEnv("LIVEKIT_API_SECRET"),
		Room:       requiredEnv("ROOM"),
		Identity:   getenvDefault("IDENTITY", "r2-camera"),
		Device:     getenvDefault("DEVICE", "/dev/video0"),
		FPS:        fps,
		Bitrate:    bitrate,
		Pipeline:   os.Getenv("GSTREAMER_PIPELINE"),
	}

	switch {
	case cfg.LivekitURL == "":
		return directConfig{}, fmt.Errorf("LIVEKIT_URL is required")
	case cfg.APIKey == "":
		return directConfig{}, fmt.Errorf("LIVEKIT_API_KEY is required")
	case cfg.APISecret == "":
		return directConfig{}, fmt.Errorf("LIVEKIT_API_SECRET is required")
	case cfg.Room == "":
		return directConfig{}, fmt.Errorf("ROOM is required")
	}

	return cfg, nil
}

func mintDirectToken(cfg directConfig) (string, error) {
	at := auth.NewAccessToken(cfg.APIKey, cfg.APISecret)
	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     cfg.Room,
	}
	grant.SetCanPublish(true)
	at.AddGrant(grant).
		SetIdentity(cfg.Identity).
		SetName(cfg.Identity)

	return at.ToJWT()
}

func (cfg directConfig) pipelineString() string {
	if cfg.Pipeline != "" {
		return cfg.Pipeline
	}

	return fmt.Sprintf(
		`v4l2src device=%s !
		  videorate !
		  video/x-raw,framerate=%d/1 !
		  videoconvert !
		  video/x-raw,format=I420 !
		  x264enc tune=zerolatency bitrate=%d key-int-max=%d speed-preset=ultrafast bframes=0 !
		  h264parse config-interval=1 !
		  video/x-h264,stream-format=avc,alignment=au !
		  appsink name=sink sync=false drop=true max-buffers=2 emit-signals=true`,
		cfg.Device,
		cfg.FPS,
		cfg.Bitrate,
		cfg.FPS,
	)
}

func getenvDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func requiredEnv(key string) string {
	return os.Getenv(key)
}

func getenvPositiveInt(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer: %w", key, err)
	}
	if parsed <= 0 {
		return 0, fmt.Errorf("%s must be positive, got %d", key, parsed)
	}
	return parsed, nil
}
