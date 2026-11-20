package api

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type pollInput struct {
	Question    *models.Question `json:"question"`
	Title       string           `json:"title"`
	Description string           `json:"description"`
	Choices     []string         `json:"choices"`
	Visibility  string           `json:"visibility"`
	Guests      bool             `json:"guests"`
	Opens       *time.Time       `json:"opens"`
	Closes      *time.Time       `json:"closes"`
}

func readPoll(c *gin.Context) (pollInput, bool) {
	var in pollInput
	if !body(c, &in) {
		return in, false
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	if !singleLine(in.Title, 3, 140) || !validText(in.Description, 0, 1000) {
		reject(c, "Use a question of 3–140 characters, up to 1,000 description characters, and 2–8 choices.")
		return in, false
	}
	if err := configureQuestion(&in); err != nil {
		reject(c, err.Error())
		return in, false
	}
	if in.Visibility != "live" && in.Visibility != "after_close" && in.Visibility != "private" {
		reject(c, "Invalid results visibility.")
		return in, false
	}
	now := time.Now()
	for _, t := range []*time.Time{in.Opens, in.Closes} {
		if t != nil && (!t.After(now) || t.After(now.AddDate(1, 0, 0))) {
			reject(c, "Schedule dates must be in the next year.")
			return in, false
		}
	}
	if in.Opens != nil && in.Closes != nil && !in.Closes.After(*in.Opens) {
		reject(c, "Closing time must follow opening time.")
		return in, false
	}
	return in, true
}

type pollView struct {
	models.Poll
	Revision     int64  `json:"revision"`
	AllowResults bool   `json:"allowResults"`
	Voted        bool   `json:"voted"`
	Total        *int64 `json:"total,omitempty"`
}

func viewPoll(p models.Poll, owner, voted bool) pollView {
	now := time.Now()
	show := owner || p.CanShowResults(now)
	p.State = p.Status(now)
	var total *int64
	if owner {
		n := p.BallotCount()
		total = &n
	} else {
		p.ID = bson.NilObjectID
	}
	return pollView{Poll: p, Revision: p.Version, AllowResults: show, Voted: voted, Total: total}
}
func (s *Server) listPolls(c *gin.Context) {
	limit, skip, ok := pagination(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	user, ok := s.require(ctx, c)
	if !ok {
		return
	}
	cur, err := s.db.Polls.Find(ctx, bson.M{"owner": user}, options.Find().SetSort(bson.D{{Key: "created", Value: -1}, {Key: "_id", Value: -1}}).SetSkip(skip).SetLimit(limit+1))
	if err != nil {
		dbError(c, err)
		return
	}
	defer cur.Close(ctx)
	result := make([]pollView, 0)
	for cur.Next(ctx) {
		var p models.Poll
		if err = cur.Decode(&p); err != nil {
			dbError(c, err)
			return
		}
		result = append(result, viewPoll(p, true, false))
	}
	if err = cur.Err(); err != nil {
		dbError(c, err)
		return
	}
	more := int64(len(result)) > limit
	if more {
		result = result[:limit]
	}
	c.JSON(200, gin.H{"items": result, "hasMore": more})
}
func (s *Server) createPoll(c *gin.Context) {
	in, ok := readPoll(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	user, ok := s.require(ctx, c)
	if !ok {
		return
	}
	p := models.Poll{ID: bson.NewObjectID(), Owner: user, Slug: token(10), Title: in.Title, Description: in.Description, Choices: in.Choices, Question: in.Question, RankPoints: rankPoints(in.Question, len(in.Choices)), State: "draft", Visibility: in.Visibility, Guests: in.Guests, Opens: in.Opens, Closes: in.Closes, Created: time.Now(), Counts: make([]int64, len(in.Choices)), Version: 1}
	if _, err := s.db.Polls.InsertOne(ctx, p); err != nil {
		dbError(c, err)
		return
	}
	c.JSON(201, viewPoll(p, true, false))
}
func (s *Server) ownedPoll(ctx context.Context, c *gin.Context) (models.Poll, bool) {
	var p models.Poll
	id, ok := objectID(c)
	if !ok {
		return p, false
	}
	user, ok := s.require(ctx, c)
	if !ok {
		return p, false
	}
	if err := s.db.Polls.FindOne(ctx, bson.M{"_id": id, "owner": user}).Decode(&p); err != nil {
		dbError(c, err)
		return p, false
	}
	return p, true
}
func (s *Server) ownerPoll(c *gin.Context) {
	ctx, cancel := request(c)
	defer cancel()
	if p, ok := s.ownedPoll(ctx, c); ok {
		c.JSON(200, viewPoll(p, true, false))
	}
}
func (s *Server) editPoll(c *gin.Context) {
	in, ok := readPoll(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	p, ok := s.ownedPoll(ctx, c)
	if !ok {
		return
	}
	err := s.db.Polls.FindOneAndUpdate(ctx, bson.M{"_id": p.ID, "state": "draft", "version": p.Version}, bson.M{"$set": bson.M{"title": in.Title, "description": in.Description, "choices": in.Choices, "question": in.Question, "rankPoints": rankPoints(in.Question, len(in.Choices)), "visibility": in.Visibility, "guests": in.Guests, "opens": in.Opens, "closes": in.Closes, "counts": make([]int64, len(in.Choices)), "pending": true, "dirtyAt": time.Now()}, "$inc": bson.M{"version": 1}}, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&p)
	if errors.Is(err, mongo.ErrNoDocuments) {
		conflict(c, "Only an unchanged draft can be edited. Reload the poll and try again.")
		return
	}
	if err != nil {
		dbError(c, err)
		return
	}
	c.JSON(200, viewPoll(p, true, false))
}
func (s *Server) pollAction(c *gin.Context) {
	var in struct {
		Action string `json:"action"`
	}
	if !body(c, &in) {
		return
	}
	switch in.Action {
	case "publish", "close", "archive", "duplicate":
	default:
		reject(c, "Invalid poll action.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	p, ok := s.ownedPoll(ctx, c)
	if !ok {
		return
	}
	if in.Action == "duplicate" {
		p.RoomID = bson.NilObjectID
		p.Ballots, p.RankPoints, p.Terms = 0, rankPoints(p.Question, len(p.Choices)), nil
		p.ID, p.Slug, p.State, p.Opens, p.Closes, p.Created, p.Version, p.Counts, p.Pending = bson.NewObjectID(), token(10), "draft", nil, nil, time.Now(), 1, make([]int64, len(p.Choices)), false
		if _, err := s.db.Polls.InsertOne(ctx, p); err != nil {
			dbError(c, err)
			return
		}
		c.JSON(201, viewPoll(p, true, false))
		return
	}
	now := time.Now()
	state := ""
	switch in.Action {
	case "publish":
		if p.State == "draft" && (p.Closes == nil || p.Closes.After(now)) {
			state = "live"
			if p.Opens != nil && p.Opens.After(now) {
				state = "scheduled"
			}
		}
	case "close":
		if p.State == "live" || p.State == "scheduled" {
			state = "closed"
		}
	case "archive":
		if p.State == "draft" || p.Status(now) == "closed" {
			state = "archived"
		}
	}
	if state == "" {
		conflict(c, "This action is unavailable in the current poll state.")
		return
	}
	filter := bson.M{"_id": p.ID, "state": p.State}
	if in.Action == "publish" {
		filter["version"] = p.Version
	}
	err := s.db.Polls.FindOneAndUpdate(ctx, filter, bson.M{"$set": bson.M{"state": state, "pending": true, "dirtyAt": now}, "$inc": bson.M{"version": 1}}, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&p)
	if errors.Is(err, mongo.ErrNoDocuments) {
		conflict(c, "The poll changed. Refresh and try again.")
		return
	}
	if err != nil {
		dbError(c, err)
		return
	}
	c.JSON(200, viewPoll(p, true, false))
}
func (s *Server) bySlug(ctx context.Context, slug string) (models.Poll, error) {
	var p models.Poll
	err := s.db.Polls.FindOne(ctx, bson.M{"slug": slug, "state": bson.M{"$nin": bson.A{"draft", "archived"}}}).Decode(&p)
	return p, err
}
func slugParam(c *gin.Context) (string, bool) {
	slug := c.Param("slug")
	if !validHex(slug, 20) {
		reject(c, "Invalid poll link.")
		return "", false
	}
	return slug, true
}
func (s *Server) voter(ctx context.Context, c *gin.Context, p models.Poll, issue bool) (string, error) {
	if p.Guests {
		return s.guest(c, issue), nil
	}
	id, err := s.identity(ctx, c)
	if err != nil {
		return "", err
	}
	return "u:" + id.Hex(), nil
}
func (s *Server) publicPoll(c *gin.Context) {
	slug, ok := slugParam(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	p, err := s.bySlug(ctx, slug)
	if err != nil {
		dbError(c, err)
		return
	}
	identity, err := s.voter(ctx, c, p, true)
	if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		dbError(c, err)
		return
	}
	voted := false
	if identity != "" {
		err = s.db.Votes.FindOne(ctx, bson.M{"poll": p.ID, "identity": identity}).Err()
		if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
			dbError(c, err)
			return
		}
		voted = err == nil
	}
	c.JSON(200, viewPoll(p, false, voted))
}
