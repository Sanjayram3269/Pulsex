package api

import (
	"context"
	"errors"
	"time"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type pendingTerm struct {
	ID        bson.ObjectID `bson:"_id" json:"id"`
	Term      string        `bson:"term" json:"term"`
	Timestamp time.Time     `bson:"timestamp" json:"timestamp"`
}

func (s *Server) pendingTerms(c *gin.Context) {
	limit, skip, valid := pagination(c)
	if !valid {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	poll, ok := s.ownedPoll(ctx, c)
	if !ok {
		return
	}
	if poll.QuestionType() != models.WordCloud {
		missing(c)
		return
	}
	cur, err := s.db.Votes.Find(ctx, bson.M{"poll": poll.ID, "moderation": "pending"},
		options.Find().SetSort(bson.D{{Key: "timestamp", Value: 1}, {Key: "_id", Value: 1}}).SetSkip(skip).SetLimit(limit+1).
			SetProjection(bson.M{"term": 1, "timestamp": 1}))
	if err != nil {
		dbError(c, err)
		return
	}
	defer cur.Close(ctx)
	items := make([]pendingTerm, 0)
	if err = cur.All(ctx, &items); err != nil {
		dbError(c, err)
		return
	}
	more := int64(len(items)) > limit
	if more {
		items = items[:limit]
	}
	c.JSON(200, gin.H{"items": items, "hasMore": more})
}

var errCloudCapacity = errors.New("cloud capacity")

func (s *Server) moderateTerm(c *gin.Context) {
	id, err := bson.ObjectIDFromHex(c.Param("term"))
	if err != nil || id.IsZero() {
		reject(c, "Invalid submission ID.")
		return
	}
	var in struct {
		Action string `json:"action"`
	}
	if !body(c, &in) {
		return
	}
	if in.Action != "approve" && in.Action != "reject" {
		reject(c, "Choose approve or reject.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	poll, ok := s.ownedPoll(ctx, c)
	if !ok {
		return
	}
	if poll.QuestionType() != models.WordCloud {
		missing(c)
		return
	}
	session, err := s.db.Client.StartSession()
	if err != nil {
		dbError(c, err)
		return
	}
	defer session.EndSession(ctx)
	_, err = session.WithTransaction(ctx, func(tx context.Context) (any, error) {
		var term pendingTerm
		filter := bson.M{"_id": id, "poll": poll.ID, "moderation": "pending"}
		state := "rejected"
		if in.Action == "approve" {
			state = "approved"
		}
		if err := s.db.Votes.FindOneAndUpdate(tx, filter, bson.M{"$set": bson.M{"moderation": state}}).Decode(&term); err != nil {
			return nil, err
		}
		if in.Action == "reject" {
			return nil, nil
		}

		// The same poll document serializes additions and capacity checks across moderators.
		var current models.Poll
		if err := s.db.Polls.FindOne(tx, bson.M{"_id": poll.ID, "owner": poll.Owner}).Decode(&current); err != nil {
			return nil, err
		}
		key := digest(term.Term)
		if _, exists := current.Terms[key]; !exists && len(current.Terms) >= 100 {
			return nil, errCloudCapacity
		}
		field := "terms." + key
		return s.db.Polls.UpdateByID(tx, poll.ID, bson.M{
			"$inc": bson.M{field + ".count": 1, "version": 1},
			"$set": bson.M{field + ".text": term.Term, "pending": true},
			"$min": bson.M{"dirtyAt": time.Now()},
		})
	})
	switch {
	case errors.Is(err, errCloudCapacity):
		conflict(c, "This cloud has reached 100 distinct terms. Reject new terms or approve repeats.")
	case errors.Is(err, mongo.ErrNoDocuments):
		conflict(c, "The submission is unavailable or was already reviewed.")
	case err != nil:
		dbError(c, err)
	default:
		c.Status(204)
	}
}
