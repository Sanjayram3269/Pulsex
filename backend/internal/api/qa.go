package api

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"github.com/Sanjayram3269/Pulsex/backend/internal/realtime"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type qaItem struct {
	models.AudienceQuestion
	Upvoted bool `json:"upvoted,omitempty"`
}
type qaView struct {
	Version int64    `json:"version"`
	Enabled bool     `json:"enabled"`
	Open    bool     `json:"open"`
	Items   []qaItem `json:"items"`
	Pending []qaItem `json:"pending,omitempty"`
}

func qaOpen(room models.Room) bool {
	return room.QAEnabled && (room.State == "live" || room.State == "paused")
}
func (s *Server) notifyQA(ctx context.Context, code string) {
	_, _ = s.db.Redis.Pipelined(ctx, func(pipe redis.Pipeliner) error {
		for _, topic := range []string{"qa:", "room:", "quiz:"} {
			pipe.Publish(ctx, realtime.Channel, topic+code)
		}
		return nil
	})
}
func (s *Server) qaRoom(ctx context.Context, filter bson.M) (models.Room, error) {
	var room models.Room
	err := s.db.Rooms.FindOne(ctx, filter, options.FindOne().
		SetProjection(bson.M{"code": 1, "state": 1, "qaEnabled": 1, "qaVersion": 1})).Decode(&room)
	return room, err
}
func (s *Server) ownerQARoom(ctx context.Context, c *gin.Context) (models.Room, bool) {
	var room models.Room
	id, ok := objectID(c)
	if !ok {
		return room, false
	}
	owner, ok := s.require(ctx, c)
	if !ok {
		return room, false
	}
	room, err := s.qaRoom(ctx, bson.M{"_id": id, "owner": owner})
	if err != nil {
		dbError(c, err)
		return room, false
	}
	return room, true
}
func sortQA(c *gin.Context) (string, bool) {
	order := c.DefaultQuery("sort", "top")
	if order != "top" && order != "recent" {
		reject(c, "Choose top or recent.")
		return "", false
	}
	return order, true
}
func (s *Server) qaItems(ctx context.Context, filter bson.M, order string) ([]qaItem, error) {
	sort := bson.D{{Key: "pinned", Value: -1}}
	if order == "top" {
		sort = append(sort, bson.E{Key: "votes", Value: -1})
	}
	sort = append(sort, bson.E{Key: "created", Value: -1}, bson.E{Key: "_id", Value: -1})
	cur, err := s.db.Questions.Find(ctx, filter, options.Find().SetSort(sort).SetLimit(50).SetProjection(bson.M{"identity": 0}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	docs := make([]models.AudienceQuestion, 0)
	if err = cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	result := make([]qaItem, len(docs))
	for i, q := range docs {
		result[i].AudienceQuestion = q
	}
	return result, nil
}
func (s *Server) qaSnapshot(ctx context.Context, room models.Room, order, identity string, owner bool) (qaView, error) {
	out := qaView{Version: room.QAVersion, Enabled: room.QAEnabled, Open: qaOpen(room), Items: []qaItem{}}
	if !room.QAEnabled && !owner {
		return out, nil
	}
	var err error
	out.Items, err = s.qaItems(ctx, bson.M{"room": room.ID, "state": "approved"}, order)
	if err != nil {
		return out, err
	}
	if owner {
		out.Pending, err = s.qaItems(ctx, bson.M{"room": room.ID, "state": "pending"}, "recent")
		return out, err
	}
	if identity == "" || len(out.Items) == 0 {
		return out, nil
	}
	ids := make([]bson.ObjectID, len(out.Items))
	for i, q := range out.Items {
		ids[i] = q.ID
	}
	cur, err := s.db.Upvotes.Find(ctx, bson.M{"room": room.ID, "identity": identity, "question": bson.M{"$in": ids}},
		options.Find().SetProjection(bson.M{"question": 1}))
	if err != nil {
		return out, err
	}
	defer cur.Close(ctx)
	var votes []models.AudienceUpvote
	if err = cur.All(ctx, &votes); err != nil {
		return out, err
	}
	voted := make(map[bson.ObjectID]bool, len(votes))
	for _, v := range votes {
		voted[v.Question] = true
	}
	for i, q := range out.Items {
		out.Items[i].Upvoted = voted[q.ID]
	}
	return out, nil
}
func (s *Server) publicQA(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	order, ok := sortQA(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, err := s.qaRoom(ctx, bson.M{"code": code})
	if err != nil {
		dbError(c, err)
		return
	}
	out, err := s.qaSnapshot(ctx, room, order, s.guest(c, true), false)
	if err != nil {
		dbError(c, err)
		return
	}
	c.JSON(200, out)
}
func (s *Server) qaEvents(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	order, ok := sortQA(c)
	if !ok {
		return
	}
	identity := s.guest(c, false)
	s.stream(c, "qa:"+code, func(ctx context.Context) (any, error) {
		room, err := s.qaRoom(ctx, bson.M{"code": code})
		if err != nil {
			return nil, err
		}
		return s.qaSnapshot(ctx, room, order, identity, false)
	})
}
func (s *Server) ownerQA(c *gin.Context) {
	order, ok := sortQA(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, ok := s.ownerQARoom(ctx, c)
	if !ok {
		return
	}
	out, err := s.qaSnapshot(ctx, room, order, "", true)
	if err != nil {
		dbError(c, err)
		return
	}
	c.JSON(200, out)
}
func (s *Server) ownerQAEvents(c *gin.Context) {
	order, ok := sortQA(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	room, ok := s.ownerQARoom(ctx, c)
	cancel()
	if !ok {
		return
	}
	s.stream(c, "qa:"+room.Code, func(ctx context.Context) (any, error) {
		user, err := s.identity(ctx, c)
		if err != nil {
			return nil, err
		}
		current, err := s.qaRoom(ctx, bson.M{"_id": room.ID, "owner": user})
		if err != nil {
			return nil, err
		}
		return s.qaSnapshot(ctx, current, order, "", true)
	})
}
func (s *Server) toggleQA(c *gin.Context) {
	var in struct {
		Enabled *bool `json:"enabled"`
	}
	if !body(c, &in) {
		return
	}
	if in.Enabled == nil {
		reject(c, "Specify whether Q&A is enabled.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, ok := s.ownerQARoom(ctx, c)
	if !ok {
		return
	}
	if _, err := s.db.Rooms.UpdateByID(ctx, room.ID, bson.M{"$set": bson.M{"qaEnabled": *in.Enabled}, "$inc": bson.M{"qaVersion": 1}}); err != nil {
		dbError(c, err)
		return
	}
	s.notifyQA(ctx, room.Code)
	c.Status(204)
}

var errQAClosed = errors.New("Q&A closed")
var errQACapacity = errors.New("Q&A submission limit")
var errQAUnchanged = errors.New("Q&A change already applied")

// Mutating the room serializes admission and moderation with session lifecycle changes.
func (s *Server) qaWrite(ctx context.Context, filter bson.M, fn func(context.Context) error) error {
	session, err := s.db.Client.StartSession()
	if err != nil {
		return err
	}
	defer session.EndSession(ctx)
	_, err = session.WithTransaction(ctx, func(tx context.Context) (any, error) {
		res, err := s.db.Rooms.UpdateOne(tx, filter, bson.M{"$inc": bson.M{"qaVersion": 1}})
		if err != nil {
			return nil, err
		}
		if res.MatchedCount == 0 {
			return nil, errQAClosed
		}
		return nil, fn(tx)
	})
	return err
}
func openQAFilter(room models.Room) bson.M {
	return bson.M{"_id": room.ID, "qaEnabled": true, "state": bson.M{"$in": bson.A{"live", "paused"}}}
}
func (s *Server) submitQA(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	var in struct {
		Text string `json:"text"`
	}
	if !body(c, &in) {
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	if !singleLine(in.Text, 8, 240) {
		reject(c, "Write a question of 8–240 characters.")
		return
	}
	identity := s.guest(c, false)
	if identity == "" {
		fail(c, 428, "guest_cookie", "Open the room first.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, err := s.qaRoom(ctx, bson.M{"code": code})
	if err != nil {
		dbError(c, err)
		return
	}
	err = s.qaWrite(ctx, openQAFilter(room), func(tx context.Context) error {
		count, err := s.db.Questions.CountDocuments(tx, bson.M{"room": room.ID, "identity": identity}, options.Count().SetLimit(6))
		if err != nil {
			return err
		}
		if count >= 6 {
			return errQACapacity
		}
		_, err = s.db.Questions.InsertOne(tx, models.AudienceQuestion{ID: bson.NewObjectID(), Room: room.ID, Identity: identity, Text: in.Text, State: "pending", Created: time.Now()})
		return err
	})
	switch {
	case errors.Is(err, errQAClosed):
		conflict(c, "Q&A is closed.")
	case errors.Is(err, errQACapacity):
		fail(c, 429, "question_limit", "This browser has reached six submissions for this room.")
	case err != nil:
		dbError(c, err)
	default:
		s.notifyQA(ctx, code)
		c.JSON(201, gin.H{"accepted": true})
	}
}
func qaQuestionID(c *gin.Context) (bson.ObjectID, bool) {
	id, err := bson.ObjectIDFromHex(c.Param("question"))
	if err != nil || id.IsZero() {
		reject(c, "Invalid question ID.")
		return id, false
	}
	return id, true
}
func (s *Server) updateUpvote(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	id, ok := qaQuestionID(c)
	if !ok {
		return
	}
	var in struct {
		Active *bool `json:"active"`
	}
	if !body(c, &in) {
		return
	}
	if in.Active == nil {
		reject(c, "Specify the desired upvote state.")
		return
	}
	identity := s.guest(c, false)
	if identity == "" {
		fail(c, 428, "guest_cookie", "Open the room first.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, err := s.qaRoom(ctx, bson.M{"code": code})
	if err != nil {
		dbError(c, err)
		return
	}
	err = s.qaWrite(ctx, openQAFilter(room), func(tx context.Context) error {
		question := bson.M{"room": room.ID, "_id": id, "state": "approved"}
		delta := 1
		if !*in.Active {
			delta = -1
		}
		res, err := s.db.Questions.UpdateOne(tx, question, bson.M{"$inc": bson.M{"votes": delta}})
		if err != nil {
			return err
		}
		if res.MatchedCount == 0 {
			return mongo.ErrNoDocuments
		}
		if *in.Active {
			_, err = s.db.Upvotes.InsertOne(tx, models.AudienceUpvote{Room: room.ID, Question: id, Identity: identity})
			return err
		}
		deleted, err := s.db.Upvotes.DeleteOne(tx, bson.M{"room": room.ID, "question": id, "identity": identity})
		if err != nil {
			return err
		}
		if deleted.DeletedCount == 0 {
			return errQAUnchanged
		}
		return nil
	})
	switch {
	case errors.Is(err, errQAClosed):
		conflict(c, "Q&A is closed.")
	case errors.Is(err, errQAUnchanged), mongo.IsDuplicateKeyError(err):
		c.Status(204)
	case err != nil:
		dbError(c, err)
	default:
		s.notifyQA(ctx, code)
		c.Status(204)
	}
}
func (s *Server) moderateQA(c *gin.Context) {
	id, ok := qaQuestionID(c)
	if !ok {
		return
	}
	var in struct {
		Action string `json:"action"`
	}
	if !body(c, &in) {
		return
	}
	before := "approved"
	fields := bson.M{}
	switch in.Action {
	case "approve":
		before = "pending"
		fields["state"] = "approved"
	case "reject":
		before = "pending"
		fields["state"] = "rejected"
	case "hide":
		fields["state"] = "hidden"
	case "pin", "unpin":
		fields["pinned"] = in.Action == "pin"
	case "answer", "reopen":
		fields["answered"] = in.Action == "answer"
	default:
		reject(c, "Unknown moderation action.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, ok := s.ownerQARoom(ctx, c)
	if !ok {
		return
	}
	err := s.qaWrite(ctx, bson.M{"_id": room.ID}, func(tx context.Context) error {
		res, err := s.db.Questions.UpdateOne(tx, bson.M{"_id": id, "room": room.ID, "state": before}, bson.M{"$set": fields})
		if err != nil {
			return err
		}
		if res.MatchedCount == 0 {
			return mongo.ErrNoDocuments
		}
		return nil
	})
	if err != nil {
		dbError(c, err)
		return
	}
	slog.Info("audience question moderated", "action", in.Action, "room", room.ID.Hex(), "question", id.Hex())
	s.notifyQA(ctx, room.Code)
	c.Status(204)
}
