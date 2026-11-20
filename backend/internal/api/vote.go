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
	"go.mongodb.org/mongo-driver/v2/mongo/readconcern"
	"go.mongodb.org/mongo-driver/v2/mongo/writeconcern"
)

var errClosed = errors.New("poll closed")
var errChoice = errors.New("invalid choice")

func (s *Server) vote(c *gin.Context) {
	slug, ok := slugParam(c)
	if !ok {
		return
	}
	var in struct {
		Choice *int `json:"choice"`
	}
	if !body(c, &in) {
		return
	}
	if in.Choice == nil || *in.Choice < 0 || *in.Choice > 7 {
		reject(c, "Choose a valid option.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	p, err := s.bySlug(ctx, slug)
	if err != nil {
		dbError(c, err)
		return
	}
	id, err := s.voter(ctx, c, p, false)
	if errors.Is(err, mongo.ErrNoDocuments) {
		fail(c, 401, "sign_in", "Sign in to vote on this poll.")
		return
	}
	if err != nil {
		dbError(c, err)
		return
	}
	if id == "" {
		fail(c, 428, "guest_cookie", "Open the poll first and enable cookies to vote.")
		return
	}
	err = s.cast(ctx, p, id, *in.Choice)
	switch {
	case errors.Is(err, errClosed):
		conflict(c, "This poll is not accepting votes.")
	case errors.Is(err, errChoice):
		reject(c, "That option is not part of this poll.")
	case mongo.IsDuplicateKeyError(err):
		fail(c, 409, "already_voted", "You have already voted on this poll.")
	case err != nil:
		dbError(c, err)
	default:
		c.JSON(201, gin.H{"accepted": true})
	}
}
func (s *Server) cast(ctx context.Context, p models.Poll, id string, choice int) error {
	if choice >= len(p.Choices) {
		return errChoice
	}
	session, err := s.db.Client.StartSession()
	if err != nil {
		return err
	}
	defer session.EndSession(ctx)
	_, err = session.WithTransaction(ctx, func(tx context.Context) (any, error) {
		now := time.Now()
		filter := bson.M{"_id": p.ID, "$and": bson.A{
			bson.M{"$or": bson.A{bson.M{"state": "live"}, bson.M{"state": "scheduled", "opens": bson.M{"$lte": now}}}},
			bson.M{"$or": bson.A{bson.M{"closes": nil}, bson.M{"closes": bson.M{"$gt": now}}}},
		}}
		update := bson.M{"$inc": bson.M{"counts." + choiceField(choice): 1, "version": 1}, "$set": bson.M{"pending": true}, "$min": bson.M{"dirtyAt": now}}
		res, err := s.db.Polls.UpdateOne(tx, filter, update)
		if err != nil {
			return nil, err
		}
		if res.MatchedCount != 1 {
			return nil, errClosed
		}
		return s.db.Votes.InsertOne(tx, models.Vote{Poll: p.ID, Identity: id, Choice: choice, Timestamp: now})
	}, options.Transaction().SetReadConcern(readconcern.Snapshot()).SetWriteConcern(writeconcern.Majority()))
	return err
}
func choiceField(choice int) string { return string(rune('0' + choice)) }
