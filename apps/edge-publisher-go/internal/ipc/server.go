// Package ipc — Unix socket client for the RVEP publisher ↔ agent protocol.
//
// The Edge Agent (Node.js) is the socket SERVER: it creates the socket file
// and listens.  The Go publisher is the CLIENT: it dials the socket path
// provided in the RVEP_SOCKET_PATH environment variable.
//
// Usage pattern (from main.go):
//
//	conn, err := ipc.Dial(ctx, socketPath)
//	defer conn.Close()
//	conn.SendHello(...)
//	start, err := conn.WaitForStart(ctx)
//	// … run pipeline …
//	go conn.HeartbeatLoop(ctx, 1*time.Second, &state, metricsFunc)
//	<-conn.StopCh()  // blocks until "stop" or context cancelled
package ipc

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

// Conn is a connected IPC client to the Edge Agent Unix socket.
type Conn struct {
	conn    net.Conn
	scanner *bufio.Scanner
	enc     *json.Encoder
	mu      sync.Mutex // guards enc (writes)

	seq    int64         // atomic; incremented on each send
	stopCh chan StopMsg  // closed when a "stop" msg arrives or context cancelled
	once   sync.Once

	// Received StartMsg — populated by WaitForStart().
	start *StartMsg
}

// Dial connects to the Unix domain socket at socketPath.
// It retries until ctx is cancelled or the connection succeeds.
func Dial(ctx context.Context, socketPath string) (*Conn, error) {
	var conn net.Conn
	var err error

	for {
		conn, err = net.DialUnix("unix", nil, &net.UnixAddr{Name: socketPath, Net: "unix"})
		if err == nil {
			break
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("ipc: dial %q: context cancelled: %w", socketPath, ctx.Err())
		case <-time.After(500 * time.Millisecond):
			// Edge Agent socket not ready yet; retry.
		}
	}

	c := &Conn{
		conn:    conn,
		scanner: bufio.NewScanner(conn),
		enc:     json.NewEncoder(conn),
		stopCh:  make(chan StopMsg, 1),
	}
	go c.readLoop(ctx)
	return c, nil
}

// Close closes the underlying connection.
func (c *Conn) Close() error {
	c.once.Do(func() { close(c.stopCh) })
	return c.conn.Close()
}

// StopCh returns a channel that receives the StopMsg when the agent sends "stop".
// The channel is also closed when the connection drops or context is cancelled.
func (c *Conn) StopCh() <-chan StopMsg {
	return c.stopCh
}

// nextSeq atomically increments and returns the next sequence number.
func (c *Conn) nextSeq() int64 {
	return atomic.AddInt64(&c.seq, 1)
}

// send serialises msg as a JSON Line and writes it to the socket.
// It is safe to call from multiple goroutines.
func (c *Conn) send(msg any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.enc.Encode(msg); err != nil {
		return fmt.Errorf("ipc: send: %w", err)
	}
	return nil
}

// SendHello transmits the initial hello message.
func (c *Conn) SendHello(cameraID, platformID, version string, pid int) error {
	msg := NewHello(c.nextSeq(), cameraID, platformID, version, pid)
	return c.send(msg)
}

// SendHeartbeat transmits one heartbeat message.
func (c *Conn) SendHeartbeat(state PublisherState, metrics HeartbeatMetrics) error {
	msg := NewHeartbeat(c.nextSeq(), state, metrics)
	return c.send(msg)
}

// SendError transmits an error message.  If fatal is true the publisher should
// exit shortly after calling this.
func (c *Conn) SendError(code ErrorCode, message string, fatal bool) error {
	msg := NewError(c.nextSeq(), code, message, fatal)
	return c.send(msg)
}

// WaitForStart blocks until a "start" message arrives from the agent or ctx is done.
// Returns the StartMsg (containing Livekit URL, token, room) or an error.
func (c *Conn) WaitForStart(ctx context.Context) (*StartMsg, error) {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("ipc: WaitForStart: context cancelled: %w", ctx.Err())
		case <-ticker.C:
			if c.start != nil {
				return c.start, nil
			}
		}
	}
}

// HeartbeatLoop sends heartbeats at the given interval until ctx is cancelled.
// metricsFunc is called once per heartbeat to get fresh metrics.
// state is a pointer to a PublisherState that the caller updates concurrently.
func (c *Conn) HeartbeatLoop(ctx context.Context, interval time.Duration, state *PublisherState, metricsFunc func() HeartbeatMetrics) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.SendHeartbeat(*state, metricsFunc()); err != nil {
				// Socket likely broken; readLoop will detect and signal via stopCh.
				return
			}
		}
	}
}

// readLoop continuously reads JSON Lines from the socket and dispatches them.
// Runs in a dedicated goroutine started by Dial().
func (c *Conn) readLoop(ctx context.Context) {
	for c.scanner.Scan() {
		line := c.scanner.Bytes()

		// Peek at the "type" field to route the message.
		var base Base
		if err := json.Unmarshal(line, &base); err != nil {
			// Malformed line; log and continue.
			fmt.Printf("ipc: readLoop: malformed message: %v\n", err)
			continue
		}

		switch base.Type {
		case "start":
			var msg StartMsg
			if err := json.Unmarshal(line, &msg); err != nil {
				fmt.Printf("ipc: readLoop: bad start msg: %v\n", err)
				continue
			}
			c.start = &msg

		case "stop":
			var msg StopMsg
			if err := json.Unmarshal(line, &msg); err != nil {
				fmt.Printf("ipc: readLoop: bad stop msg: %v\n", err)
				continue
			}
			c.once.Do(func() {
				select {
				case c.stopCh <- msg:
				default:
				}
			})

		default:
			// Unknown or future message type — ignore gracefully.
		}
	}

	// Scanner finished (EOF or error) — signal stop with zero value.
	c.once.Do(func() { close(c.stopCh) })
}
