package models

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type QuizQuestion struct {
	Prompt  string   `json:"prompt" bson:"prompt"`
	Choices []string `json:"choices" bson:"choices"`
	Correct *int     `json:"correct" bson:"correct"`
	Seconds int      `json:"seconds" bson:"seconds"`
	Points  int      `json:"points" bson:"points"`
}
type QuizConfig struct {
	Questions     []QuizQuestion `json:"questions" bson:"questions"`
	Reveal        string         `json:"reveal" bson:"reveal"`
	Participation string         `json:"participation" bson:"participation"`
	SpeedBonus    bool           `json:"speedBonus" bson:"speedBonus"`
}
type QuizPlayer struct {
	ID       bson.ObjectID `bson:"_id" json:"id"`
	Quiz     bson.ObjectID `bson:"quiz" json:"-"`
	Identity string        `bson:"identity" json:"-"`
	Alias    string        `bson:"alias" json:"alias"`
	Points   int64         `bson:"points" json:"points"`
	Correct  int64         `bson:"correct" json:"correct"`
	Answered int64         `bson:"answered" json:"answered"`
}
type QuizAnswer struct {
	Quiz     bson.ObjectID `bson:"quiz"`
	Identity string        `bson:"identity"`
	Round    int           `bson:"round"`
	Choice   int           `bson:"choice"`
	Points   int64         `bson:"points"`
	At       time.Time     `bson:"at"`
	Correct  bool          `bson:"correct"`
}

func (r Room) QuizState(now time.Time) string {
	if r.State == "live" && r.Ends != nil && !now.Before(*r.Ends) {
		return "paused"
	}
	return r.State
}

// An integer bonus is at most half of the base score and decreases linearly.
func Score(q QuizQuestion, choice int, remaining time.Duration, speed bool) (int64, bool) {
	if q.Correct == nil || choice != *q.Correct || remaining <= 0 {
		return 0, false
	}
	points := int64(q.Points)
	if speed {
		remaining = min(remaining, time.Duration(q.Seconds)*time.Second)
		points += points * remaining.Milliseconds() / (int64(q.Seconds) * 2000)
	}
	return points, true
}
