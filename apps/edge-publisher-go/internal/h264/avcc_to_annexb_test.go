package h264

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// helper: encode one NALU into AVCC fragment (4-byte length + payload).
func avccFragment(nalu []byte) []byte {
	buf := make([]byte, 4+len(nalu))
	binary.BigEndian.PutUint32(buf[:4], uint32(len(nalu)))
	copy(buf[4:], nalu)
	return buf
}

// helper: build Annex B output for a list of NALUs.
func annexBExpected(nalus ...[]byte) []byte {
	var out []byte
	for _, n := range nalus {
		out = append(out, 0x00, 0x00, 0x00, 0x01)
		out = append(out, n...)
	}
	return out
}

// ── Single NALU ───────────────────────────────────────────────────────────────

func TestSingleNonIDRNALU(t *testing.T) {
	// Non-IDR slice NALU (type 1 = 0x41)
	nalu := []byte{0x41, 0xAA, 0xBB, 0xCC}
	avcc := avccFragment(nalu)

	got, err := AVCCToAnnexB(avcc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := annexBExpected(nalu)
	if !bytes.Equal(got, want) {
		t.Errorf("single NALU mismatch\n got:  %X\n want: %X", got, want)
	}
}

// ── Multiple NALUs in one AU ──────────────────────────────────────────────────

func TestMultipleNALUs(t *testing.T) {
	nalu1 := []byte{0x41, 0x01, 0x02}
	nalu2 := []byte{0x41, 0x03, 0x04, 0x05}

	var avcc []byte
	avcc = append(avcc, avccFragment(nalu1)...)
	avcc = append(avcc, avccFragment(nalu2)...)

	got, err := AVCCToAnnexB(avcc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := annexBExpected(nalu1, nalu2)
	if !bytes.Equal(got, want) {
		t.Errorf("multi-NALU mismatch\n got:  %X\n want: %X", got, want)
	}
}

// ── IDR frame with SPS + PPS + IDR NALUs (insert-sps-pps=true behaviour) ─────
//
// This is the most important test: SPS (type 7) and PPS (type 8) that arrive
// inside the AVCC AU MUST be passed through unchanged — not stripped, not
// injected a second time.  ADR-006 §"SPS/PPS 注入時機" explicitly forbids
// double injection.

func TestIDRFrameWithSPSAndPPS(t *testing.T) {
	// Simulate what nvv4l2h264enc + insert-sps-pps=true produces:
	// [SPS][PPS][IDR slice] as a single AVCC AU.
	spsNALU := []byte{0x67, 0x64, 0x00, 0x1F, 0xAC, 0xD9} // type 7
	ppsNALU := []byte{0x68, 0xEB, 0xEC, 0xB2, 0x2C}        // type 8
	idrNALU := []byte{0x65, 0x88, 0x84, 0x00, 0x33}        // type 5

	var avcc []byte
	avcc = append(avcc, avccFragment(spsNALU)...)
	avcc = append(avcc, avccFragment(ppsNALU)...)
	avcc = append(avcc, avccFragment(idrNALU)...)

	got, err := AVCCToAnnexB(avcc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := annexBExpected(spsNALU, ppsNALU, idrNALU)
	if !bytes.Equal(got, want) {
		t.Errorf("IDR+SPS+PPS mismatch\n got:  %X\n want: %X", got, want)
	}

	// Verify that SPS appears exactly once.
	spsStartCode := append([]byte{0x00, 0x00, 0x00, 0x01}, spsNALU...)
	count := bytes.Count(got, spsStartCode)
	if count != 1 {
		t.Errorf("SPS appears %d times in output, expected exactly 1 (no double injection)", count)
	}

	// Same for PPS.
	ppsStartCode := append([]byte{0x00, 0x00, 0x00, 0x01}, ppsNALU...)
	count = bytes.Count(got, ppsStartCode)
	if count != 1 {
		t.Errorf("PPS appears %d times in output, expected exactly 1 (no double injection)", count)
	}
}

// ── NALUType helper ───────────────────────────────────────────────────────────

func TestNALUType(t *testing.T) {
	cases := []struct {
		first byte
		want  byte
		desc  string
	}{
		{0x67, 7, "SPS"},
		{0x68, 8, "PPS"},
		{0x65, 5, "IDR"},
		{0x41, 1, "non-IDR"},
	}
	for _, c := range cases {
		got := NALUType(c.first)
		if got != c.want {
			t.Errorf("NALUType(0x%02X) = %d, want %d (%s)", c.first, got, c.want, c.desc)
		}
	}
}

// ── Error cases ───────────────────────────────────────────────────────────────

func TestEmptyBuffer(t *testing.T) {
	_, err := AVCCToAnnexB(nil)
	if err == nil {
		t.Error("expected error for nil input, got nil")
	}

	_, err = AVCCToAnnexB([]byte{})
	if err == nil {
		t.Error("expected error for empty input, got nil")
	}
}

func TestTruncatedLengthField(t *testing.T) {
	// Only 3 bytes — not enough for a 4-byte length field.
	_, err := AVCCToAnnexB([]byte{0x00, 0x00, 0x01})
	if err == nil {
		t.Error("expected error for truncated length field")
	}
}

func TestNALULengthOverrun(t *testing.T) {
	// Length field says 100 bytes but buffer only has 5.
	buf := make([]byte, 4+5)
	binary.BigEndian.PutUint32(buf[:4], 100)
	copy(buf[4:], []byte{0x41, 0x01, 0x02, 0x03, 0x04})

	_, err := AVCCToAnnexB(buf)
	if err == nil {
		t.Error("expected error for NALU length overrun")
	}
}
