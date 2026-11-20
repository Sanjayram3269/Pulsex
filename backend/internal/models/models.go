package models

import (
	"go.mongodb.org/mongo-driver/v2/bson"
	"time"
)

type User struct {
	ID       bson.ObjectID `bson:"_id" json:"id"`
	Name     string        `bson:"name" json:"name"`
	Email    string        `bson:"email" json:"email"`
	Password []byte        `bson:"password" json:"-"`
}
type Login struct {
	Hash    string        `bson:"_id"`
	UserID  bson.ObjectID `bson:"userId"`
	Expires time.Time     `bson:"expires"`
}
type Poll struct {
	DemoExpires *time.Time           `bson:"demoExpires,omitempty" json:"-"`
	Question    *Question            `bson:"question,omitempty" json:"question,omitempty"`
	Ballots     int64                `bson:"ballots" json:"-"`
	RankPoints  []int64              `bson:"rankPoints,omitempty" json:"-"`
	Terms       map[string]TermCount `bson:"terms,omitempty" json:"-"`
	RoomID      bson.ObjectID        `bson:"roomId,omitempty" json:"-"`
	ID          bson.ObjectID        `bson:"_id" json:"id"`
	Owner       bson.ObjectID        `bson:"owner" json:"-"`
	Slug        string               `bson:"slug" json:"slug"`
	Title       string               `bson:"title" json:"title"`
	Description string               `bson:"description" json:"description"`
	Choices     []string             `bson:"choices" json:"choices"`
	State       string               `bson:"state" json:"state"`
	Visibility  string               `bson:"visibility" json:"visibility"`
	Guests      bool                 `bson:"guests" json:"guests"`
	Opens       *time.Time           `bson:"opens" json:"opens"`
	Closes      *time.Time           `bson:"closes" json:"closes"`
	Created     time.Time            `bson:"created" json:"created"`
	Version     int64                `bson:"version" json:"-"`
	Counts      []int64              `bson:"counts" json:"-"`
	Pending     bool                 `bson:"pending" json:"-"`
	DirtyAt     time.Time            `bson:"dirtyAt,omitempty" json:"-"`
}

func (p Poll) Status(now time.Time) string {
	if p.State == "scheduled" || p.State == "live" {
		if p.Closes != nil && !now.Before(*p.Closes) {
			return "closed"
		}
		if p.State == "scheduled" && p.Opens != nil && !now.Before(*p.Opens) {
			return "live"
		}
	}
	return p.State
}
func (p Poll) Public() bool { return p.State != "draft" && p.State != "archived" }
func (p Poll) CanShowResults(now time.Time) bool {
	return p.Visibility == "live" || p.Visibility == "after_close" && p.Status(now) == "closed"
}

type Vote struct {
	DemoExpires *time.Time    `bson:"demoExpires,omitempty"`
	ID          bson.ObjectID `bson:"_id,omitempty"`
	Kind        string        `bson:"kind,omitempty"`
	Selections  []int         `bson:"selections,omitempty"`
	Term        string        `bson:"term,omitempty"`
	Moderation  string        `bson:"moderation,omitempty"`
	Poll        bson.ObjectID `bson:"poll"`
	Identity    string        `bson:"identity"`
	Choice      int           `bson:"choice"`
	Timestamp   time.Time     `bson:"timestamp"`
}
type Snapshot struct {
	Version    int64       `json:"version"`
	Counts     []int64     `json:"counts"`
	Ballots    int64       `json:"ballots"`
	RankPoints []int64     `json:"rankPoints,omitempty"`
	Terms      []TermCount `json:"terms,omitempty"`
}

type Room struct {
	Theme          string        `bson:"theme,omitempty" json:"theme,omitempty"`
	DemoExpires    *time.Time    `bson:"demoExpires,omitempty" json:"-"`
	QAEnabled      bool          `bson:"qaEnabled" json:"qaEnabled"`
	QAVersion      int64         `bson:"qaVersion" json:"-"`
	Quiz           *QuizConfig   `bson:"quiz,omitempty" json:"-"`
	Control        int64         `bson:"control,omitempty" json:"-"`
	Joined         int64         `bson:"joined" json:"-"`
	RoundResponses int64         `bson:"roundResponses,omitempty" json:"-"`
	ID             bson.ObjectID `bson:"_id" json:"id"`
	Owner          bson.ObjectID `bson:"owner" json:"-"`
	Code           string        `bson:"code" json:"code"`
	Title          string        `bson:"title" json:"title"`
	Polls          []string      `bson:"polls" json:"polls"`
	Active         int           `bson:"active" json:"active"`
	State          string        `bson:"state" json:"state"`
	Ends           *time.Time    `bson:"ends" json:"ends"`
	Version        int64         `bson:"version" json:"version"`
	Created        time.Time     `bson:"created" json:"created"`
}
