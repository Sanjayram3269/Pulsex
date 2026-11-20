package models

import (
	"testing"
	"time"
)

func TestQuizScoreAndDeadline(t *testing.T) {
	correct := 1
	q := QuizQuestion{Correct: &correct, Seconds: 20, Points: 100}
	for _, tc := range []struct {
		choice int
		time   time.Duration
		speed  bool
		points int64
		ok     bool
	}{
		{1, 20 * time.Second, true, 150, true},
		{1, 10 * time.Second, true, 125, true},
		{1, 10 * time.Second, false, 100, true},
		{0, 10 * time.Second, true, 0, false},
		{1, 0, true, 0, false},
	} {
		if score, ok := Score(q, tc.choice, tc.time, tc.speed); score != tc.points || ok != tc.ok {
			t.Errorf("score=%d correct=%v want %+v", score, ok, tc)
		}
	}
	deadline := time.Now()
	room := Room{State: "live", Ends: &deadline}
	if room.QuizState(deadline.Add(-time.Millisecond)) != "live" || room.QuizState(deadline) != "paused" {
		t.Fatal("deadline boundaries")
	}
}
