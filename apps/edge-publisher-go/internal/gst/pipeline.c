// pipeline.c — GStreamer appsink wrapper implementation.
//
// Compiled by cgo as a sibling translation unit to pipeline.go.
// Definitions live here (not in pipeline.go's cgo preamble) so that the
// Go-side _cgo_export.c does not pull in duplicate symbols at link time.

#include "pipeline.h"
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#include "_cgo_export.h"   // declarations for Go-exported callback (go_on_sample)

struct Pipeline {
    GstElement *pipeline;
    GstElement *appsink;
    int         id;
};

// new_sample_cb — GStreamer "new-sample" callback.
// Maps the GstBuffer, invokes go_on_sample (Go), then unmaps + unrefs.
static GstFlowReturn new_sample_cb(GstAppSink *sink, gpointer user_data) {
    Pipeline *p = (Pipeline *)user_data;

    GstSample *sample = gst_app_sink_pull_sample(sink);
    if (!sample) {
        return GST_FLOW_ERROR;
    }

    GstBuffer *buf = gst_sample_get_buffer(sample);
    if (!buf) {
        gst_sample_unref(sample);
        return GST_FLOW_ERROR;
    }

    GstMapInfo map;
    if (!gst_buffer_map(buf, &map, GST_MAP_READ)) {
        gst_sample_unref(sample);
        return GST_FLOW_ERROR;
    }

    int is_keyframe = !GST_BUFFER_FLAG_IS_SET(buf, GST_BUFFER_FLAG_DELTA_UNIT);
    uint64_t pts_ns = (uint64_t)GST_BUFFER_PTS(buf);

    go_on_sample(p->id,
                 (uint8_t *)map.data,
                 (size_t)map.size,
                 pts_ns,
                 is_keyframe);

    gst_buffer_unmap(buf, &map);
    gst_sample_unref(sample);

    return GST_FLOW_OK;
}

Pipeline *gst_pipeline_create(const char *pipeline_str, int pipeline_id) {
    GError *err = NULL;
    GstElement *gst_pipe = gst_parse_launch(pipeline_str, &err);
    if (!gst_pipe) {
        g_printerr("gst_pipeline_create: parse error: %s\n",
                   err ? err->message : "unknown");
        if (err) g_error_free(err);
        return NULL;
    }

    GstElement *sink = gst_bin_get_by_name(GST_BIN(gst_pipe), "sink");
    if (!sink) {
        g_printerr("gst_pipeline_create: appsink named 'sink' not found\n");
        gst_object_unref(gst_pipe);
        return NULL;
    }

    GstAppSinkCallbacks callbacks = {0};
    callbacks.new_sample = new_sample_cb;

    Pipeline *p = (Pipeline *)malloc(sizeof(Pipeline));
    if (!p) {
        gst_object_unref(sink);
        gst_object_unref(gst_pipe);
        return NULL;
    }
    p->pipeline = gst_pipe;
    p->appsink  = sink;
    p->id       = pipeline_id;

    gst_app_sink_set_callbacks(GST_APP_SINK(sink), &callbacks, p, NULL);
    return p;
}

int gst_pipeline_start(Pipeline *p) {
    GstStateChangeReturn ret = gst_element_set_state(p->pipeline, GST_STATE_PLAYING);
    if (ret == GST_STATE_CHANGE_FAILURE) {
        g_printerr("gst_pipeline_start: failed to set PLAYING state\n");
        return -1;
    }
    return 0;
}

void gst_pipeline_stop(Pipeline *p) {
    gst_element_send_event(p->pipeline, gst_event_new_eos());
    GstBus *bus = gst_element_get_bus(p->pipeline);
    if (bus) {
        GstMessage *msg = gst_bus_timed_pop_filtered(
            bus, 5 * GST_SECOND,
            GST_MESSAGE_EOS | GST_MESSAGE_ERROR);
        if (msg) gst_message_unref(msg);
        gst_object_unref(bus);
    }
    gst_element_set_state(p->pipeline, GST_STATE_NULL);
}

void gst_pipeline_destroy(Pipeline *p) {
    if (!p) return;
    if (p->appsink)  gst_object_unref(p->appsink);
    if (p->pipeline) gst_object_unref(p->pipeline);
    free(p);
}
