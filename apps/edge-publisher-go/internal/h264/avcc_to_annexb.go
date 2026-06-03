// Package h264 provides AVCC → Annex B bitstream conversion.
//
// # AVCC vs Annex B
//
// AVCC (also called length-delimited format) uses a 4-byte big-endian length
// prefix before each NALU:
//
//	[length 4B][NALU bytes][length 4B][NALU bytes]…
//
// Annex B uses a 3- or 4-byte start code before each NALU:
//
//	00 00 00 01 [NALU bytes] 00 00 00 01 [NALU bytes]…
//
// Livekit's LocalSampleTrack.WriteSample expects Annex B.
//
// # SPS/PPS handling (ADR-006 §"SPS/PPS 注入時機")
//
// The GStreamer pipeline is configured with insert-sps-pps=true on nvv4l2h264enc.
// This means SPS and PPS NALUs are already embedded in the AVCC bitstream at
// every IDR frame boundary.  AVCCToAnnexB therefore does a STRAIGHT pass-through:
// it converts the length-prefix framing to start-code framing for EVERY NALU,
// including any SPS/PPS NALUs that happen to appear.  It does NOT:
//   - Cache or strip SPS/PPS NALUs
//   - Inject additional SPS/PPS NALUs
//   - Reorder NALUs
//
// Doing any of the above would cause double SPS/PPS at the decoder and result
// in decoding artefacts or PPS reference errors.
package h264

import (
	"encoding/binary"
	"fmt"
)

// annexBStartCode is the 4-byte Annex B start code prepended to every NALU.
// Using the 4-byte variant (rather than 3-byte 00 00 01) is required for
// the first NALU in an AU to allow unambiguous byte-stream parsing.
var annexBStartCode = [4]byte{0x00, 0x00, 0x00, 0x01}

// NALUType extracts the NALU type nibble from the first byte of a NALU payload.
// Values 7 = SPS, 8 = PPS, 5 = IDR slice, 1 = non-IDR slice.
func NALUType(firstByte byte) byte {
	return firstByte & 0x1F
}

// AVCCToAnnexB converts a complete AVCC-format H.264 access unit (AU) to
// Annex B format.
//
// avcc is expected to contain one or more NALUs, each preceded by a 4-byte
// big-endian length field (the length counts only the NALU bytes, not itself).
//
// The returned slice is newly allocated.  It is safe to retain across calls.
//
// Returns an error if avcc is malformed (truncated length field or NALU overrun).
func AVCCToAnnexB(avcc []byte) ([]byte, error) {
	if len(avcc) == 0 {
		return nil, fmt.Errorf("h264: empty AVCC buffer")
	}

	// Pre-allocate: Annex B is at most 4 bytes larger per NALU than AVCC
	// (swap 4-byte length for 4-byte start code → same size in worst case,
	//  but we don't know the NALU count yet so allocate len(avcc)+4 as a
	//  conservative first guess).
	out := make([]byte, 0, len(avcc)+4)

	remaining := avcc
	for len(remaining) > 0 {
		if len(remaining) < 4 {
			return nil, fmt.Errorf("h264: truncated AVCC length field: %d bytes remaining", len(remaining))
		}

		naluLen := int(binary.BigEndian.Uint32(remaining[:4]))
		remaining = remaining[4:]

		if naluLen < 1 {
			return nil, fmt.Errorf("h264: AVCC NALU length is zero")
		}
		if naluLen > len(remaining) {
			return nil, fmt.Errorf("h264: AVCC NALU length %d exceeds buffer (%d bytes remaining)", naluLen, len(remaining))
		}

		nalu := remaining[:naluLen]
		remaining = remaining[naluLen:]

		// Prepend 4-byte Annex B start code, then copy NALU verbatim.
		// SPS (type 7), PPS (type 8), IDR (type 5), and inter (type 1)
		// all receive the same treatment — no special-casing per ADR-006.
		out = append(out, annexBStartCode[:]...)
		out = append(out, nalu...)
	}

	if len(out) == 0 {
		return nil, fmt.Errorf("h264: no NALUs found in AVCC buffer")
	}

	return out, nil
}
