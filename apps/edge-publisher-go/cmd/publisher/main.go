// Command publisher is the RVEP Go Video Publisher sidecar process.
//
// It runs as a systemd unit (one per camera) and is spawned/managed by the
// Node.js Edge Agent.  Its sole job is:
//
//  1. Connect to the Edge Agent's Unix socket (RVEP_SOCKET_PATH)
//  2. Send a "hello" IPC message
//  3. Wait for a "start" IPC message containing a Livekit token
//  4. Launch the GStreamer pipeline described in the camera profile YAML
//  5. Publish H.264 frames to the Livekit room via LocalSampleTrack
//  6. Send 1 Hz "heartbeat" IPC messages with telemetry
//  7. Gracefully shutdown on SIGTERM / SIGINT or "stop" IPC message
//
// Required environment variables:
//
//	RVEP_SOCKET_PATH        Unix socket path (e.g. /var/run/rvep/vehicle-001/publisher-front.sock)
//	RVEP_CAMERA_PROFILE     Path to camera profile YAML (e.g. /etc/rvep/cameras/front.yaml)
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/rvep/edge-publisher-go/internal/config"
	"github.com/rvep/edge-publisher-go/internal/gst"
	"github.com/rvep/edge-publisher-go/internal/ipc"
	"github.com/rvep/edge-publisher-go/internal/publisher"
)

const (
	version    = "0.1.0"
	platformID = "jetson-agx-orin"
)

func main() {
	socketPath := os.Getenv("RVEP_SOCKET_PATH")
	profilePath := os.Getenv("RVEP_CAMERA_PROFILE")
	switch {
	case socketPath != "" || profilePath != "":
		if socketPath == "" {
			fatal("RVEP_SOCKET_PATH is not set")
		}
		if profilePath == "" {
			fatal("RVEP_CAMERA_PROFILE is not set")
		}
		runIPCMode(socketPath, profilePath)
	case shouldUseDirectMode():
		runDirectMode()
	default:
		fatal("set RVEP_SOCKET_PATH+RVEP_CAMERA_PROFILE for agent mode, or LIVEKIT_URL+LIVEKIT_API_KEY+LIVEKIT_API_SECRET+ROOM for direct mode")
	}
}

func runIPCMode(socketPath, profilePath string) {
	// ── 1. Load camera profile YAML ─────────────────────────────────────────
	profile, err := config.LoadProfile(profilePath)
	if err != nil {
		fatal("load camera profile: %v", err)
	}

	logf("loaded profile: cameraId=%s sensorId=%d identity=%s",
		profile.CameraID, profile.SensorID, profile.Identity)

	// ── 2. Root context with signal handling ─────────────────────────────────
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	// ── 3. Panic recovery → IPC error + graceful exit ────────────────────────
	// The goroutine below is the real main; this wrapper catches panics.
	var ipcConn *ipc.Conn
	var ipcMu sync.Mutex // guards ipcConn pointer during setup

	defer func() {
		if r := recover(); r != nil {
			stack := debug.Stack()
			msg := fmt.Sprintf("panic: %v\n%s", r, stack)
			logf("PANIC RECOVERED: %s", msg)

			ipcMu.Lock()
			c := ipcConn
			ipcMu.Unlock()

			if c != nil {
				_ = c.SendError(ipc.ErrGstPipelineFailed, msg, true)
			}
			os.Exit(1)
		}
	}()

	// ── 4. Connect to Edge Agent Unix socket ─────────────────────────────────
	logf("dialing unix socket: %s", socketPath)
	conn, err := ipc.Dial(ctx, socketPath)
	if err != nil {
		fatal("dial IPC socket: %v", err)
	}
	defer conn.Close()

	ipcMu.Lock()
	ipcConn = conn
	ipcMu.Unlock()

	// ── 5. Send hello ────────────────────────────────────────────────────────
	if err := conn.SendHello(profile.CameraID, platformID, version, os.Getpid()); err != nil {
		fatal("send hello: %v", err)
	}
	logf("sent hello; waiting for start…")

	// ── 6. Wait for start (with signal / context cancellation) ───────────────
	startCtx, startCancel := context.WithTimeout(ctx, 30*time.Second)
	defer startCancel()

	var startMsg *ipc.StartMsg
	startDone := make(chan struct{})

	go func() {
		defer close(startDone)
		var e error
		startMsg, e = conn.WaitForStart(startCtx)
		if e != nil {
			logf("WaitForStart error: %v", e)
			cancel()
		}
	}()

	select {
	case sig := <-sigCh:
		logf("received signal %v during start wait; exiting", sig)
		return
	case <-ctx.Done():
		logf("context done during start wait; exiting")
		return
	case <-conn.StopCh():
		logf("stop received during start wait; exiting")
		return
	case <-startDone:
	}

	if startMsg == nil {
		fatal("did not receive start message")
	}
	logf("received start: room=%s identity=%s", startMsg.RoomName, startMsg.Identity)

	// Allow pipelineOverride from agent (null → use profile).
	pipelineStr := profile.ActivePipeline()
	if startMsg.PipelineOverride != nil && *startMsg.PipelineOverride != "" {
		pipelineStr = *startMsg.PipelineOverride
		logf("using pipeline override from start message")
	}
	logf("pipeline: %s", summarizePipeline(pipelineStr))

	// ── 7. Create GStreamer pipeline ──────────────────────────────────────────
	pipe, err := gst.NewPipeline(pipelineStr)
	if err != nil {
		_ = conn.SendError(ipc.ErrGstPipelineFailed,
			fmt.Sprintf("create pipeline: %v", err), true)
		os.Exit(1)
	}

	if err := pipe.Start(); err != nil {
		_ = conn.SendError(ipc.ErrGstPipelineFailed,
			fmt.Sprintf("start pipeline: %v", err), true)
		os.Exit(1)
	}
	logf("GStreamer pipeline started")

	// ── 8. Connect to Livekit ────────────────────────────────────────────────
	pub := publisher.New()

	livekitURL := startMsg.LivekitURL
	token := startMsg.LivekitToken
	roomName := startMsg.RoomName
	identity := startMsg.Identity

	if livekitURL == "" {
		livekitURL = profile.Livekit.URL
	}

	if err := pub.Connect(ctx, livekitURL, token, identity); err != nil {
		_ = conn.SendError(ipc.ErrLivekitAuthFailed,
			fmt.Sprintf("connect to Livekit: %v", err), true)
		pipe.Stop()
		pipe.Destroy()
		os.Exit(1)
	}
	logf("connected to Livekit room %q as %q", roomName, identity)

	// ── 9. State tracking for heartbeat ──────────────────────────────────────
	state := ipc.StatePublishing
	publishErrCh := make(chan error, 1)

	go func() {
		err := pub.PublishLoop(ctx, pipe.Samples(), livekitURL, token, identity)
		publishErrCh <- err
	}()

	// ── 10. Heartbeat loop (1 Hz) ────────────────────────────────────────────
	go conn.HeartbeatLoop(ctx, 1*time.Second, &state, func() ipc.HeartbeatMetrics {
		return ipc.HeartbeatMetrics{
			FramesPublished: pub.FramesPublished(),
			FramesDropped:   pub.FramesDropped(),
			// FPS, EncodeLatencyMs, BitrateBps: Phase 2 — add GStreamer clock queries
			NvencSessionID: 0,
		}
	})

	// ── 11. Main event loop ──────────────────────────────────────────────────
	select {
	case sig := <-sigCh:
		logf("received signal %v; shutting down", sig)

	case stopMsg := <-conn.StopCh():
		logf("received stop from agent (reason: %s); shutting down", stopMsg.Reason)

	case pubErr := <-publishErrCh:
		if pubErr != nil {
			logf("publish loop fatal error: %v", pubErr)
			state = ipc.StateError
			_ = conn.SendError(ipc.ErrLivekitAuthFailed,
				fmt.Sprintf("publish loop: %v", pubErr), true)
			// Drain pipeline before exit.
			cancel()
		}

	case <-ctx.Done():
		logf("context done; shutting down")
	}

	// ── 12. Graceful shutdown ────────────────────────────────────────────────
	logf("stopping GStreamer pipeline…")
	cancel() // signal all goroutines to stop
	pipe.Stop()
	pipe.Destroy()

	logf("disconnecting from Livekit…")
	pub.Disconnect()

	logf("closing IPC connection…")
	_ = conn.Close()

	logf("publisher exiting cleanly")
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[rvep-publisher] "+format+"\n", args...)
}

func fatal(format string, args ...any) {
	logf("FATAL: "+format, args...)
	os.Exit(1)
}

// summarizePipeline returns the first 80 chars of the pipeline string for logging.
func summarizePipeline(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 80 {
		return s[:80] + "…"
	}
	return s
}
