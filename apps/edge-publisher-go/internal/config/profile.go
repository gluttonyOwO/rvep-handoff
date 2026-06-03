// Package config loads and validates camera profile YAML files.
// Each profile fully describes one camera's hardware parameters,
// GStreamer pipeline string, and Livekit connection details.
// This keeps all platform-specific knowledge in YAML (ADR-003).
package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// VideoProfile holds resolution / encoding parameters for the capture pipeline.
type VideoProfile struct {
	Width                int `yaml:"width"`
	Height               int `yaml:"height"`
	Framerate            int `yaml:"framerate"`
	BitrateBps           int `yaml:"bitrateBps"`
	IframeIntervalFrames int `yaml:"iframeIntervalFrames"`
}

// LivekitConfig holds Livekit server connection credentials.
// NOTE: The token is NOT stored in YAML; it is delivered at runtime
// via the IPC `start` message from Edge Agent (see edge/ipc-protocol.md §Security).
type LivekitConfig struct {
	URL       string `yaml:"url"`
	APIKey    string `yaml:"apiKey"`
	APISecret string `yaml:"apiSecret"`
	Room      string `yaml:"room"`
}

// CameraProfile is the top-level struct loaded from a YAML profile file.
// Fields map 1-to-1 to configs/zed-x-front.yaml.
type CameraProfile struct {
	// CameraID is the logical identifier used in IPC messages and systemd unit name.
	CameraID string `yaml:"cameraId"`

	// SensorID corresponds to nvarguscamerasrc sensor-id property (0 or 1).
	SensorID int `yaml:"sensorId"`

	// Identity is the Livekit participant identity for this publisher.
	Identity string `yaml:"identity"`

	// TrackName labels the published video track in the Livekit room.
	TrackName string `yaml:"trackName"`

	// VideoProfile contains codec / resolution parameters.
	VideoProfile VideoProfile `yaml:"videoProfile"`

	// GStreamerPipeline is the full pipeline description string.
	// It must end with "appsink name=sink".
	// If empty, the publisher will construct a default pipeline from VideoProfile.
	GStreamerPipeline string `yaml:"gstreamerPipeline"`

	// Livekit holds Livekit server URL and credentials for initial connection.
	// The runtime token is injected from the IPC `start` message and overrides
	// any value derived from APIKey/APISecret at publish time.
	Livekit LivekitConfig `yaml:"livekit"`
}

// LoadProfile reads and unmarshals a YAML camera profile from path.
// Returns a validated CameraProfile or a descriptive error.
func LoadProfile(path string) (*CameraProfile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: read profile %q: %w", path, err)
	}

	var p CameraProfile
	if err := yaml.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("config: unmarshal profile %q: %w", path, err)
	}

	if err := p.validate(); err != nil {
		return nil, fmt.Errorf("config: invalid profile %q: %w", path, err)
	}

	return &p, nil
}

// validate checks required fields and sane ranges.
func (p *CameraProfile) validate() error {
	if p.CameraID == "" {
		return fmt.Errorf("cameraId is required")
	}
	if p.SensorID < 0 || p.SensorID > 3 {
		return fmt.Errorf("sensorId must be 0–3, got %d", p.SensorID)
	}
	if p.Identity == "" {
		return fmt.Errorf("identity is required")
	}
	if p.Livekit.URL == "" {
		return fmt.Errorf("livekit.url is required")
	}
	if p.VideoProfile.Width <= 0 || p.VideoProfile.Height <= 0 {
		return fmt.Errorf("videoProfile.width/height must be positive")
	}
	if p.VideoProfile.Framerate <= 0 {
		return fmt.Errorf("videoProfile.framerate must be positive")
	}
	if p.VideoProfile.BitrateBps <= 0 {
		return fmt.Errorf("videoProfile.bitrateBps must be positive")
	}
	return nil
}

// DefaultPipelineString returns the standard NVENC pipeline for this profile.
// Callers should prefer the pipeline from the YAML when GStreamerPipeline is set.
func (p *CameraProfile) DefaultPipelineString() string {
	return fmt.Sprintf(
		`nvarguscamerasrc sensor-id=%d ! `+
			`video/x-raw(memory:NVMM),width=%d,height=%d,framerate=%d/1 ! `+
			`nvv4l2h264enc bitrate=%d iframeinterval=%d preset-level=1 EnableTwopassCBR=0 insert-sps-pps=true ! `+
			`h264parse ! `+
			`video/x-h264,stream-format=avc,alignment=au ! `+
			`appsink name=sink sync=false drop=true max-buffers=2 emit-signals=true`,
		p.SensorID,
		p.VideoProfile.Width,
		p.VideoProfile.Height,
		p.VideoProfile.Framerate,
		p.VideoProfile.BitrateBps,
		p.VideoProfile.IframeIntervalFrames,
	)
}

// ActivePipeline returns the pipeline string to use: YAML override if set,
// otherwise the constructed default.
func (p *CameraProfile) ActivePipeline() string {
	if p.GStreamerPipeline != "" {
		return p.GStreamerPipeline
	}
	return p.DefaultPipelineString()
}
