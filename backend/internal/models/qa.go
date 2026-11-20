package models

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type AudienceQuestion struct {
	ID       bson.ObjectID `bson:"_id" json:"id"`
	Room     bson.ObjectID `bson:"room" json:"-"`
	Identity string        `bson:"identity" json:"-"`
	Text     string        `bson:"text" json:"text"`
	State    string        `bson:"state" json:"state"`
	Pinned   bool          `bson:"pinned" json:"pinned"`
	Answered bool          `bson:"answered" json:"answered"`
	Votes    int64         `bson:"votes" json:"votes"`
	Created  time.Time     `bson:"created" json:"created"`
}
type AudienceUpvote struct {
	Room     bson.ObjectID `bson:"room"`
	Question bson.ObjectID `bson:"question"`
	Identity string        `bson:"identity"`
}
