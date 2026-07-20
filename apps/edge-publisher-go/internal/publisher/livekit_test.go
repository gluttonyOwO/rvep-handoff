package publisher

import (
	"testing"
	"time"
)

func TestSampleDurationForFPS(t *testing.T) {
	cases := []struct {
		name string
		fps  int
		want time.Duration
	}{
		{name: "30fps", fps: 30, want: time.Second / 30},
		{name: "60fps", fps: 60, want: time.Second / 60},
		{name: "fallback", fps: 0, want: defaultSampleDuration},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sampleDurationForFPS(tc.fps); got != tc.want {
				t.Fatalf("sampleDurationForFPS(%d) = %s, want %s", tc.fps, got, tc.want)
			}
		})
	}
}
