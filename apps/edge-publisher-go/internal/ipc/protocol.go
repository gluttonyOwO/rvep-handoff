// Package ipc implements the Phase 1 subset of the RVEP IPC protocol
// described in openspec/edge/ipc-protocol.md.
//
// Transport: Unix domain socket, JSON Lines (one JSON object per line, \n delimited).
//
// Phase 1 message set (publisher → agent):
//   hello, heartbeat, error
//
// Phase 1 message set (agent → publisher):
//   start, stop
//
// All messages share a base with "type", "ts" (ISO 8601 UTC ms), and "seq".
package ipc

import "time"

// ── Shared base ───────────────────────────────────────────────────────────────

// Base contains fields common to every message.
type Base struct {
	Type string `json:"type"`
	Ts   string `json:"ts"`
	Seq  int64  `json:"seq"`
}

// now returns the current time formatted as ISO 8601 with millisecond precision in UTC.
func now() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

// ── Publisher → Agent messages ────────────────────────────────────────────────

// HelloMsg is the first message sent after connecting to the Unix socket.
// It announces the publisher's version, PID, and camera identity.
type HelloMsg struct {
	Base
	Version    string `json:"version"`
	PID        int    `json:"pid"`
	CameraID   string `json:"cameraId"`
	PlatformID string `json:"platformId"`
}

// PublisherState enumerates valid values for HeartbeatMsg.PublisherState.
type PublisherState string

const (
	StateStarting     PublisherState = "starting"
	StatePublishing   PublisherState = "publishing"
	StateReconnecting PublisherState = "reconnecting"
	StateError        PublisherState = "error"
)

// HeartbeatMetrics carries per-second telemetry data.
type HeartbeatMetrics struct {
	FPS              float64 `json:"fps"`
	EncodeLatencyMs  float64 `json:"encodeLatencyMs"`
	BitrateBps       int64   `json:"bitrateBps"`
	FramesPublished  int64   `json:"framesPublished"`
	FramesDropped    int64   `json:"framesDropped"`
	NvencSessionID   int     `json:"nvencSessionId"`
}

// HeartbeatMsg is sent every second from publisher to agent.
type HeartbeatMsg struct {
	Base
	PublisherState PublisherState   `json:"publisherState"`
	Metrics        HeartbeatMetrics `json:"metrics"`
}

// ErrorCode identifies the class of a fatal or recoverable error.
type ErrorCode string

const (
	ErrGstPipelineFailed ErrorCode = "gst_pipeline_failed"
	ErrNVENCUnavailable  ErrorCode = "nvenc_unavailable"
	ErrLivekitAuthFailed ErrorCode = "livekit_auth_failed"
	ErrSocketClosed      ErrorCode = "socket_closed"
)

// ErrorMsg reports a publisher error.  When Fatal is true the publisher will
// exit after sending this message; the Edge Agent should schedule a respawn.
type ErrorMsg struct {
	Base
	Code    ErrorCode `json:"code"`
	Message string    `json:"message"`
	Fatal   bool      `json:"fatal"`
}

// ── Agent → Publisher messages ────────────────────────────────────────────────

// StartMsg is sent by the agent in response to HelloMsg.
// It delivers the Livekit credentials and optional pipeline override.
type StartMsg struct {
	Base
	LivekitURL      string  `json:"livekitUrl"`
	LivekitToken    string  `json:"livekitToken"`
	RoomName        string  `json:"roomName"`
	Identity        string  `json:"identity"`
	VideoProfileID  string  `json:"videoProfileId"`
	PipelineOverride *string `json:"pipelineOverride"` // nil → use profile default
}

// StopReason describes why the agent is requesting a stop.
type StopReason string

const (
	StopUserRequest StopReason = "user_request"
	StopSafeMode    StopReason = "safe_mode"
	StopShutdown    StopReason = "shutdown"
)

// StopMsg instructs the publisher to gracefully shut down.
type StopMsg struct {
	Base
	Reason StopReason `json:"reason"`
}

// ── Constructors ──────────────────────────────────────────────────────────────

// NewHello builds a HelloMsg ready to send.
func NewHello(seq int64, cameraID, platformID, version string, pid int) HelloMsg {
	return HelloMsg{
		Base:       Base{Type: "hello", Ts: now(), Seq: seq},
		Version:    version,
		PID:        pid,
		CameraID:   cameraID,
		PlatformID: platformID,
	}
}

// NewHeartbeat builds a HeartbeatMsg.
func NewHeartbeat(seq int64, state PublisherState, metrics HeartbeatMetrics) HeartbeatMsg {
	return HeartbeatMsg{
		Base:           Base{Type: "heartbeat", Ts: now(), Seq: seq},
		PublisherState: state,
		Metrics:        metrics,
	}
}

// NewError builds an ErrorMsg.
func NewError(seq int64, code ErrorCode, msg string, fatal bool) ErrorMsg {
	return ErrorMsg{
		Base:    Base{Type: "error", Ts: now(), Seq: seq},
		Code:    code,
		Message: msg,
		Fatal:   fatal,
	}
}
