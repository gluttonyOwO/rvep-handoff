// Package publisher wraps livekit-server-sdk-go to publish H.264 video
// from a GStreamer appsink to a Livekit room.
//
// Workflow:
//
//	p := publisher.New()
//	err := p.Connect(ctx, livekitURL, token, identity)
//	defer p.Disconnect()
//	go p.PublishLoop(ctx, samplesCh, livekitURL, token, identity)
//
// Reconnection: up to maxReconnectAttempts retries with exponential backoff.
// Thread safety: Connect/Disconnect/PublishLoop must not be called concurrently.
package publisher

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/webrtc/v3"
	"github.com/pion/webrtc/v3/pkg/media"

	"github.com/rvep/edge-publisher-go/internal/gst"
	"github.com/rvep/edge-publisher-go/internal/h264"
)

const (
	maxReconnectAttempts = 3
	reconnectBaseDelay   = 1 * time.Second
)

// Publisher manages a Livekit room connection and a LocalTrack for H.264 video.
type Publisher struct {
	room     *lksdk.Room
	track    *lksdk.LocalTrack
	trackPub *lksdk.LocalTrackPublication

	framesPublished int64
	framesDropped   int64
}

// New creates an uninitialised Publisher.  Call Connect before PublishLoop.
func New() *Publisher {
	return &Publisher{}
}

// FramesPublished returns the number of frames successfully written.
func (p *Publisher) FramesPublished() int64 {
	return atomic.LoadInt64(&p.framesPublished)
}

// FramesDropped returns the number of frames dropped due to conversion or write errors.
func (p *Publisher) FramesDropped() int64 {
	return atomic.LoadInt64(&p.framesDropped)
}

// Connect joins the Livekit room (room name is encoded in the JWT token) and
// publishes a LocalTrack for H.264 video.
//
// livekitURL: e.g. "ws://192.168.68.68:7880"
// token:      JWT with publisher permission (delivered via IPC start msg)
// identity:   participant identity (used for track name); the token's identity
//
//	claim ultimately determines the room participant id.
func (p *Publisher) Connect(ctx context.Context, livekitURL, token, identity string) error {
	roomCB := &lksdk.RoomCallback{}
	room, err := lksdk.ConnectToRoomWithToken(livekitURL, token, roomCB)
	if err != nil {
		return fmt.Errorf("publisher: connect with token at %q: %w", livekitURL, err)
	}
	p.room = room

	track, err := lksdk.NewLocalSampleTrack(webrtc.RTPCodecCapability{
		MimeType:  webrtc.MimeTypeH264,
		ClockRate: 90000,
		// profile-level-id=42c028 → Baseline Profile, Level 4.0.
		// Level 3.1 (42e01f) is insufficient for 1080p30 (MaxDPB / MaxMBPS
		// exceeded); some browser H.264 decoders silently drop frames or
		// reject the track entirely if the announced level is too low for
		// the actual bitstream — see slice-9.5 diagnostic notes.
		SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42c028",
	})
	if err != nil {
		room.Disconnect()
		return fmt.Errorf("publisher: create LocalTrack: %w", err)
	}
	p.track = track

	pub, err := room.LocalParticipant.PublishTrack(track, &lksdk.TrackPublicationOptions{
		Name: identity + "-video",
	})
	if err != nil {
		room.Disconnect()
		return fmt.Errorf("publisher: publish track: %w", err)
	}
	p.trackPub = pub

	return nil
}

// Disconnect gracefully leaves the Livekit room.
func (p *Publisher) Disconnect() {
	if p.room != nil {
		p.room.Disconnect()
		p.room = nil
	}
}

// PublishLoop reads gst.Sample values from samplesCh, converts AVCC→Annex B,
// and writes each frame to the Livekit LocalTrack.  Blocks until ctx is cancelled
// or max reconnect attempts is exceeded.
func (p *Publisher) PublishLoop(
	ctx context.Context,
	samplesCh <-chan gst.Sample,
	livekitURL, token, identity string,
) error {
	attempts := 0
	for {
		err := p.publishUntilDisconnect(ctx, samplesCh)
		if err == nil || ctx.Err() != nil {
			return nil
		}

		attempts++
		if attempts > maxReconnectAttempts {
			return fmt.Errorf("publisher: exceeded %d reconnect attempts: %w", maxReconnectAttempts, err)
		}
		delay := reconnectBaseDelay * (1 << (attempts - 1))
		fmt.Printf("publisher: room disconnected (%v); reconnect %d/%d in %s\n",
			err, attempts, maxReconnectAttempts, delay)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(delay):
		}
		p.Disconnect()
		if connectErr := p.Connect(ctx, livekitURL, token, identity); connectErr != nil {
			fmt.Printf("publisher: reconnect attempt %d failed: %v\n", attempts, connectErr)
		}
	}
}

func (p *Publisher) publishUntilDisconnect(ctx context.Context, samplesCh <-chan gst.Sample) error {
	for {
		select {
		case <-ctx.Done():
			return nil
		case s, ok := <-samplesCh:
			if !ok {
				return nil
			}
			annexB, err := h264.AVCCToAnnexB(s.Data)
			if err != nil {
				atomic.AddInt64(&p.framesDropped, 1)
				fmt.Printf("publisher: AVCC→AnnexB error (dropping frame): %v\n", err)
				continue
			}
			if err := p.track.WriteSample(media.Sample{
				Data:     annexB,
				Duration: 33 * time.Millisecond,
			}, nil); err != nil {
				atomic.AddInt64(&p.framesDropped, 1)
				return fmt.Errorf("publisher: WriteSample: %w", err)
			}
			atomic.AddInt64(&p.framesPublished, 1)
		}
	}
}
