module github.com/rvep/edge-publisher-go

go 1.22

require (
	github.com/livekit/server-sdk-go/v2 v2.2.1
	github.com/pion/webrtc/v3 v3.2.50
	gopkg.in/yaml.v3 v3.0.1
)

// Run `go mod tidy` on Orin to populate transitive deps + go.sum.
