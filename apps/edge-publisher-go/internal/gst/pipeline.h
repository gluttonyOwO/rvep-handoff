/*
 * pipeline.h — CGO bridge header for GStreamer appsink integration.
 *
 * This header declares the C functions that Go calls via cgo.
 * The implementations live in pipeline.go's CGo preamble (//export callbacks)
 * and the C wrapper functions also in that file.
 *
 * Resource ownership rules:
 *   - gst_pipeline_create()  → caller owns returned Pipeline*; free with gst_pipeline_destroy()
 *   - on each new-sample:    C code calls go_on_sample(); Go callback receives a *copy* of
 *                            the mapped bytes — the GstBuffer is unmapped and unreffed before
 *                            the callback returns.  Go need not free anything.
 *   - gst_pipeline_destroy() → stops the bus, sends EOS, sets NULL state, unrefs pipeline.
 */

#ifndef RVEP_PIPELINE_H
#define RVEP_PIPELINE_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Opaque handle wrapping a GstPipeline + appsink. */
typedef struct Pipeline Pipeline;

/*
 * gst_pipeline_create — parse and prepare a GStreamer pipeline.
 *
 * pipeline_str: full GStreamer pipeline description ending with
 *               "appsink name=sink sync=false drop=true …"
 * pipeline_id:  integer identifier echoed back in callbacks so the Go
 *               side can route samples to the correct channel.
 *
 * Returns NULL on failure (error written to stderr via GST_ERROR).
 */
Pipeline *gst_pipeline_create(const char *pipeline_str, int pipeline_id);

/*
 * gst_pipeline_start — set the pipeline to PLAYING state.
 * Returns 0 on success, -1 on error.
 */
int gst_pipeline_start(Pipeline *p);

/*
 * gst_pipeline_stop — gracefully send EOS, then set NULL state.
 * Blocks until state change completes (up to 5 s timeout).
 */
void gst_pipeline_stop(Pipeline *p);

/*
 * gst_pipeline_destroy — free all resources held by p.
 * Must be called after gst_pipeline_stop().
 */
void gst_pipeline_destroy(Pipeline *p);

/*
 * go_on_sample — exported by Go (//export go_on_sample).
 * C appsink callback calls this for each complete AU buffer.
 *
 * pipeline_id: matches the id passed to gst_pipeline_create.
 * data:        pointer to mapped buffer bytes (valid only during this call).
 * size:        byte length of data.
 * pts_ns:      presentation timestamp in nanoseconds (GstClockTime).
 * is_keyframe: 1 if the buffer does NOT have the DELTA_UNIT flag set.
 *
 * Go MUST copy data before returning.  The C side will unmap and unref
 * the GstBuffer immediately after this function returns.
 */
extern void go_on_sample(int pipeline_id,
                         uint8_t *data, size_t size,
                         uint64_t pts_ns, int is_keyframe);

#ifdef __cplusplus
}
#endif

#endif /* RVEP_PIPELINE_H */
