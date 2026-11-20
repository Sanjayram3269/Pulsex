package api

import (
	"context"
	"encoding/csv"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"github.com/Sanjayram3269/Pulsex/backend/internal/realtime"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type quizInput struct {
	Theme string `json:"theme"`
	Title string `json:"title"`
	models.QuizConfig
}

func readQuiz(c *gin.Context) (quizInput, bool) {
	var in quizInput
	if !body(c, &in) {
		return in, false
	}
	in.Title = strings.TrimSpace(in.Title)
	var themeOK bool
	in.Theme, themeOK = themePreset(in.Theme)
	if !themeOK {
		reject(c, "Choose a valid theme.")
		return in, false
	}
	if !singleLine(in.Title, 3, 100) || len(in.Questions) < 1 || len(in.Questions) > 20 {
		reject(c, "Use a title of 3–100 characters and 1–20 questions.")
		return in, false
	}
	if (in.Reveal != "each" && in.Reveal != "final") || (in.Participation != "named" && in.Participation != "anonymous") {
		reject(c, "Choose valid reveal and participation rules.")
		return in, false
	}
	for i := range in.Questions {
		q := &in.Questions[i]
		q.Prompt = strings.TrimSpace(q.Prompt)
		if !singleLine(q.Prompt, 3, 140) || q.Correct == nil || *q.Correct < 0 || *q.Correct >= len(q.Choices) || q.Seconds < 5 || q.Seconds > 180 || q.Points < 1 || q.Points > 10000 {
			reject(c, "Each question needs a prompt, correct choice, 5–180 seconds and 1–10,000 points.")
			return in, false
		}
		p := pollInput{Choices: q.Choices}
		if err := configureQuestion(&p); err != nil {
			reject(c, err.Error())
			return in, false
		}
	}
	return in, true
}

type quizOwnerView struct {
	models.Room
	Config    *models.QuizConfig `json:"config"`
	Control   int64              `json:"control"`
	Joined    int64              `json:"joined"`
	Responses int64              `json:"responses"`
}

func ownerQuizView(room models.Room) quizOwnerView {
	room.State = room.QuizState(time.Now())
	return quizOwnerView{Room: room, Config: room.Quiz, Control: room.Control, Joined: room.Joined, Responses: room.RoundResponses}
}
func (s *Server) ownedQuiz(ctx context.Context, c *gin.Context) (models.Room, bool) {
	var room models.Room
	id, ok := objectID(c)
	if !ok {
		return room, false
	}
	user, ok := s.require(ctx, c)
	if !ok {
		return room, false
	}
	if err := s.db.Rooms.FindOne(ctx, bson.M{"_id": id, "owner": user, "quiz": bson.M{"$ne": nil}}).Decode(&room); err != nil {
		dbError(c, err)
		return room, false
	}
	return room, true
}
func (s *Server) getOwnedQuiz(c *gin.Context) {
	ctx, cancel := request(c)
	defer cancel()
	if room, ok := s.ownedQuiz(ctx, c); ok {
		c.JSON(200, ownerQuizView(room))
	}
}
func (s *Server) listQuizzes(c *gin.Context) {
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
	cur, err := s.db.Rooms.Find(ctx, bson.M{"owner": user, "quiz": bson.M{"$ne": nil}}, options.Find().
		SetSort(bson.D{{Key: "created", Value: -1}, {Key: "_id", Value: -1}}).SetSkip(skip).SetLimit(limit+1).
		SetProjection(bson.M{"quiz": 0}))
	if err != nil {
		dbError(c, err)
		return
	}
	defer cur.Close(ctx)
	items := make([]models.Room, 0)
	if err = cur.All(ctx, &items); err != nil {
		dbError(c, err)
		return
	}
	more := int64(len(items)) > limit
	if more {
		items = items[:limit]
	}
	for i := range items {
		items[i].State = items[i].QuizState(time.Now())
	}
	c.JSON(200, gin.H{"items": items, "hasMore": more})
}
func (s *Server) insertQuiz(ctx context.Context, c *gin.Context, owner bson.ObjectID, in quizInput) {
	room := models.Room{ID: bson.NewObjectID(), Owner: owner, Code: token(4), Title: in.Title, Theme: in.Theme, Quiz: &in.QuizConfig,
		State: "waiting", Active: -1, Version: 1, Control: 1, Created: time.Now()}
	if _, err := s.db.Rooms.InsertOne(ctx, room); err != nil {
		dbError(c, err)
		return
	}
	c.JSON(201, ownerQuizView(room))
}
func (s *Server) createQuiz(c *gin.Context) {
	in, ok := readQuiz(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	owner, ok := s.require(ctx, c)
	if ok {
		s.insertQuiz(ctx, c, owner, in)
	}
}
func (s *Server) editQuiz(c *gin.Context) {
	in, ok := readQuiz(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, ok := s.ownedQuiz(ctx, c)
	if !ok {
		return
	}
	err := s.db.Rooms.FindOneAndUpdate(ctx, bson.M{"_id": room.ID, "state": "waiting", "control": room.Control},
		bson.M{"$set": bson.M{"title": in.Title, "theme": in.Theme, "quiz": in.QuizConfig}, "$inc": bson.M{"version": 1, "control": 1}},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&room)
	if errors.Is(err, mongo.ErrNoDocuments) {
		conflict(c, "Only a waiting quiz can be edited.")
		return
	}
	if err != nil {
		dbError(c, err)
		return
	}
	s.notifyQuiz(ctx, room.Code)
	c.JSON(200, ownerQuizView(room))
}
func (s *Server) quizAction(c *gin.Context) {
	var in struct {
		Action  string `json:"action"`
		Control int64  `json:"control"`
	}
	if !body(c, &in) {
		return
	}
	switch in.Action {
	case "next", "pause", "finish", "duplicate":
	default:
		reject(c, "Invalid quiz action.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, ok := s.ownedQuiz(ctx, c)
	if !ok {
		return
	}
	if in.Action == "duplicate" {
		s.insertQuiz(ctx, c, room.Owner, quizInput{Title: room.Title, Theme: room.Theme, QuizConfig: *room.Quiz})
		return
	}
	now := time.Now()
	state, active, ends := room.QuizState(now), room.Active, room.Ends
	responses := room.RoundResponses
	if room.Control != in.Control || state == "ended" {
		conflict(c, "Refresh the quiz controls.")
		return
	}
	changes := bson.M{}
	switch in.Action {
	case "next":
		if (state != "waiting" && state != "paused") || active+1 >= len(room.Quiz.Questions) {
			conflict(c, "Close the current question before advancing.")
			return
		}
		active++
		deadline := now.Add(time.Duration(room.Quiz.Questions[active].Seconds) * time.Second)
		state, ends, responses = "live", &deadline, 0
		changes["roundResponses"] = responses
	case "pause":
		if room.State != "live" {
			conflict(c, "There is no open question.")
			return
		}
		state, ends = "paused", nil
	case "finish":
		if active < 0 {
			conflict(c, "Open at least one question before finishing.")
			return
		}
		state, ends = "ended", nil
	}
	changes["state"], changes["active"], changes["ends"] = state, active, ends
	err := s.db.Rooms.FindOneAndUpdate(ctx, bson.M{"_id": room.ID, "control": room.Control},
		bson.M{"$set": changes, "$inc": bson.M{"version": 1, "control": 1}}, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&room)
	if errors.Is(err, mongo.ErrNoDocuments) {
		conflict(c, "A host already changed this quiz.")
		return
	}
	if err != nil {
		dbError(c, err)
		return
	}
	s.notifyQuiz(ctx, room.Code)
	c.JSON(200, ownerQuizView(room))
}
func (s *Server) notifyQuiz(ctx context.Context, code string) {
	_ = s.db.Redis.Publish(ctx, realtime.Channel, "quiz:"+code).Err()
}

func (s *Server) exportQuiz(c *gin.Context) {
	ctx, cancel := request(c)
	defer cancel()
	room, ok := s.ownedQuiz(ctx, c)
	if !ok {
		return
	}
	players, err := s.quizRanks(ctx, room)
	if err != nil {
		dbError(c, err)
		return
	}
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="pulsex-quiz.csv"`)
	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{"rank", "points", "correct_answers", "submitted_answers"})
	for i, p := range players {
		_ = w.Write([]string{strconv.Itoa(i + 1), strconv.FormatInt(p.Points, 10), strconv.FormatInt(p.Correct, 10), strconv.FormatInt(p.Answered, 10)})
	}
	w.Flush()
}
