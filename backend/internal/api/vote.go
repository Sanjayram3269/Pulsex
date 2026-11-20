package api

import (
	"context"
	"errors"
	"strconv"
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

func (s *Server) vote(c *gin.Context) {
	slug, ok := slugParam(c)
	if !ok {
		return
	}
	var in ballotInput
	if !body(c, &in) {
		return
	}
	if !in.validate() {
		reject(c, "Send one valid ballot for this question.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	p, err := s.bySlug(ctx, slug)
	if err != nil {
		dbError(c, err)
		return
	}
	ballot, valid := in.forPoll(p)
	if !valid {
		reject(c, "The response does not match this question.")
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
	err = s.cast(ctx, p, id, ballot)
	switch {
	case errors.Is(err, errClosed):
		conflict(c, "This poll is not accepting votes.")
	case mongo.IsDuplicateKeyError(err):
		fail(c, 409, "already_voted", "You have already voted on this poll.")
	case err != nil:
		dbError(c, err)
	default:
		c.JSON(201, gin.H{"accepted": true})
	}
}
func (s *Server) cast(ctx context.Context, p models.Poll, id string, vote models.Vote) error {
	vote.ID, vote.Poll, vote.Identity = bson.NewObjectID(), p.ID, id
	vote.DemoExpires = p.DemoExpires
	increments := countBallot(p, vote)
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
		update := bson.M{"$inc": increments, "$set": bson.M{"pending": true}, "$min": bson.M{"dirtyAt": now}}
		res, err := s.db.Polls.UpdateOne(tx, filter, update)
		if err != nil {
			return nil, err
		}
		if res.MatchedCount != 1 {
			return nil, errClosed
		}
		vote.Timestamp = now
		return s.db.Votes.InsertOne(tx, vote)
	}, options.Transaction().SetReadConcern(readconcern.Snapshot()).SetWriteConcern(writeconcern.Majority()))
	return err
}
func rankPoints(question *models.Question, size int) []int64 {
	if question != nil && question.Type == models.RankedChoice {
		return make([]int64, size)
	}
	return nil
}

func countBallot(p models.Poll, vote models.Vote) bson.M {
	changes := bson.M{"version": 1, "ballots": 1}
	switch vote.Kind {
	case models.SingleChoice, models.Rating:
		changes["counts."+strconv.Itoa(vote.Choice)] = 1
	case models.MultipleChoice:
		for _, choice := range vote.Selections {
			changes["counts."+strconv.Itoa(choice)] = 1
		}
	case models.RankedChoice:
		changes["counts."+strconv.Itoa(vote.Selections[0])] = 1
		for rank, choice := range vote.Selections {
			points := len(p.Choices) - rank - 1
			if points > 0 {
				changes["rankPoints."+strconv.Itoa(choice)] = points
			}
		}
	}
	return changes
}
