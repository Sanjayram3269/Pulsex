package models

import (
	"testing"
	"time"
)

func TestScheduleAndVisibility(t *testing.T) {
	start := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Minute)
	p := Poll{State: "scheduled", Opens: &start, Closes: &end, Visibility: "after_close"}
	for _, tt := range []struct {
		now   time.Time
		state string
		show  bool
	}{
		{start.Add(-time.Nanosecond), "scheduled", false},
		{start, "live", false},
		{end.Add(-time.Nanosecond), "live", false},
		{end, "closed", true},
	} {
		if got := p.Status(tt.now); got != tt.state {
			t.Errorf("status at %s = %s, want %s", tt.now, got, tt.state)
		}
		if got := p.CanShowResults(tt.now); got != tt.show {
			t.Errorf("visibility at %s = %t, want %t", tt.now, got, tt.show)
		}
	}
	p.State = "archived"
	if p.Public() {
		t.Fatal("archived poll is public")
	}
}
