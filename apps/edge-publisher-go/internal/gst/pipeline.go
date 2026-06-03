// Package gst provides a cgo wrapper around a GStreamer pipeline that outputs
// encoded H.264 samples via appsink.
//
// Pipeline lifecycle:
//
//	NewPipeline(pipelineStr) → p.Start() → read p.Samples() → p.Stop()
//
// Each Sample received on the Samples() channel contains an AVCC-format H.264
// access unit (AU) as produced by h264parse with stream-format=avc,alignment=au.
// The caller (internal/h264) converts AVCC to Annex B before publishing.
//
// CGO resource rules (matching pipeline.h contract):
//   - The C appsink callback maps the GstBuffer, copies bytes into go_on_sample,
//     then immediately unmaps and unrefs the buffer.
//   - Go receives a fresh []byte copy per sample — no C memory is retained.
//   - On Stop(), the pipeline is set to NULL state and unreffed via gst_pipeline_destroy().
//
// Function definitions for the C wrapper live in pipeline.c (sibling translation
// unit) to avoid duplicate-symbol errors at link time with the cgo-generated
// _cgo_export.c file.
package gst

/*
#cgo pkg-config: gstreamer-1.0 gstreamer-app-1.0
#include "pipeline.h"
#include <gst/gst.h>
*/
import "C"

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

// Sample is one complete H.264 access unit received from appsink.
// Data is in AVCC format (4-byte length prefix per NALU).
// Call internal/h264.AVCCToAnnexB before passing to Livekit.
type Sample struct {
	Data       []byte
	PTS        time.Duration
	IsKeyframe bool
}

// Pipeline wraps a running GStreamer pipeline and exposes a sample channel.
type Pipeline struct {
	id      int
	cPipe   *C.Pipeline
	samples chan Sample
	once    sync.Once
}

// ── global registry maps pipeline_id → *Pipeline for CGo callbacks ───────────

var (
	registryMu sync.RWMutex
	registry   = make(map[int]*Pipeline)
	nextID     int32
)

func registerPipeline(p *Pipeline) {
	registryMu.Lock()
	registry[p.id] = p
	registryMu.Unlock()
}

func unregisterPipeline(id int) {
	registryMu.Lock()
	delete(registry, id)
	registryMu.Unlock()
}

func lookupPipeline(id int) (*Pipeline, bool) {
	registryMu.RLock()
	p, ok := registry[id]
	registryMu.RUnlock()
	return p, ok
}

// go_on_sample is called from C for each complete AU buffer.
// It MUST copy data before returning (C unmaps + unrefs immediately after).
//
//export go_on_sample
func go_on_sample(pipelineID C.int, data *C.uint8_t, size C.size_t, ptsNs C.uint64_t, isKeyframe C.int) {
	p, ok := lookupPipeline(int(pipelineID))
	if !ok {
		return
	}
	buf := C.GoBytes(unsafe.Pointer(data), C.int(size))
	s := Sample{
		Data:       buf,
		PTS:        time.Duration(ptsNs),
		IsKeyframe: isKeyframe != 0,
	}
	select {
	case p.samples <- s:
	default:
		// Consumer lagging; drop this sample to avoid blocking the GStreamer thread.
	}
}

// NewPipeline parses pipelineStr and prepares the GStreamer pipeline.
// The pipeline is NOT started yet; call Start() to begin capture.
// pipelineStr must end with `appsink name=sink …`.
func NewPipeline(pipelineStr string) (*Pipeline, error) {
	C.gst_init(nil, nil)
	id := int(atomic.AddInt32(&nextID, 1))

	cStr := C.CString(pipelineStr)
	defer C.free(unsafe.Pointer(cStr))

	cPipe := C.gst_pipeline_create(cStr, C.int(id))
	if cPipe == nil {
		return nil, fmt.Errorf("gst: failed to create pipeline (see stderr for GStreamer error)")
	}

	p := &Pipeline{
		id:      id,
		cPipe:   cPipe,
		samples: make(chan Sample, 8),
	}
	registerPipeline(p)
	return p, nil
}

// Start sets the pipeline to PLAYING state.
func (p *Pipeline) Start() error {
	if rc := C.gst_pipeline_start(p.cPipe); rc != 0 {
		return fmt.Errorf("gst: pipeline start failed (state change error)")
	}
	return nil
}

// Samples returns the channel on which encoded H.264 samples arrive (AVCC format).
func (p *Pipeline) Samples() <-chan Sample {
	return p.samples
}

// Stop gracefully shuts down the pipeline: sends EOS, waits up to 5 s,
// then sets NULL state.  Must be called before Destroy().
func (p *Pipeline) Stop() {
	p.once.Do(func() {
		unregisterPipeline(p.id)
		C.gst_pipeline_stop(p.cPipe)
	})
}

// Destroy releases all C-level resources.  Call after Stop().
func (p *Pipeline) Destroy() {
	C.gst_pipeline_destroy(p.cPipe)
	p.cPipe = nil
}
