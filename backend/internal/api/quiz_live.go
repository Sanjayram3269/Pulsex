package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const capacityQuiz = 200

var errQuizChanged = errors.New("quiz state changed")
var errQuizFull = errors.New("quiz full")

type quizRoundView struct {
	Prompt  string   `json:"prompt"`
	Choices []string `json:"choices"`
	Correct *int     `json:"correct,omitempty"`
}
type quizView struct {
	QAEnabled     bool                `json:"qaEnabled"`
	QAVersion     int64               `json:"qaVersion"`
	Theme         string              `json:"theme,omitempty"`
	Review        []quizRoundView     `json:"review,omitempty"`
	Title         string              `json:"title"`
	Version       int64               `json:"version"`
	State         string              `json:"state"`
	Active        int                 `json:"active"`
	Total         int                 `json:"total"`
	Ends          *time.Time          `json:"ends"`
	Participation string              `json:"participation"`
	Joined        int64               `json:"joined"`
	Responses     int64               `json:"responses"`
	Player        *bson.ObjectID      `json:"player,omitempty"`
	Answered      bool                `json:"answered"`
	Question      *quizRoundView      `json:"question,omitempty"`
	Leaderboard   []models.QuizPlayer `json:"leaderboard,omitempty"`
}

func (s *Server) quizByCode(ctx context.Context, code string) (models.Room, error) {
	var room models.Room
	err := s.db.Rooms.FindOne(ctx, bson.M{"code": code, "quiz": bson.M{"$ne": nil}}).Decode(&room)
	return room, err
}
func (s *Server) quizRanks(ctx context.Context, room models.Room) ([]models.QuizPlayer, error) {
	cur, err := s.db.QuizPlayers.Find(ctx, bson.M{"quiz": room.ID}, options.Find().
		SetSort(bson.D{{Key: "points", Value: -1}, {Key: "correct", Value: -1}, {Key: "_id", Value: 1}}).SetLimit(capacityQuiz).
		SetProjection(bson.M{"alias": 1, "points": 1, "correct": 1, "answered": 1}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	players := make([]models.QuizPlayer, 0)
	if err = cur.All(ctx, &players); err != nil {
		return nil, err
	}
	return players, nil
}

type cacheRanks struct {
	Version int64               `json:"version"`
	Players []models.QuizPlayer `json:"players"`
}

var cacheLeaderboard = redis.NewScript(`
local have=redis.call('GET',KEYS[1])
if have and string.sub(have,1,19)>=ARGV[1] then return 0 end
redis.call('SET',KEYS[1],ARGV[1]..ARGV[2],'EX',3600)
return 1
`)

func (s *Server) quizLeaderboard(ctx context.Context, room models.Room) ([]models.QuizPlayer, error) {
	key := "pulsex:quiz:ranks:" + room.Code
	raw, err := s.db.Redis.Get(ctx, key).Result()
	var cached cacheRanks
	if err == nil && len(raw) > 19 && json.Unmarshal([]byte(raw[19:]), &cached) == nil && cached.Version == room.Version {
		return cached.Players, nil
	}
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}
	players, err := s.quizRanks(ctx, room)
	if err != nil {
		return nil, err
	}
	// The scoreboard must not cross a host transition or a newer answer.
	if err = s.db.Rooms.FindOne(ctx, bson.M{"_id": room.ID, "version": room.Version}).Err(); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, errQuizChanged
		}
		return nil, err
	}
	payload, err := json.Marshal(cacheRanks{room.Version, players})
	if err != nil {
		return nil, err
	}
	if err = cacheLeaderboard.Run(ctx, s.db.Redis, []string{key}, fmt.Sprintf("%019d", room.Version), string(payload)).Err(); err != nil {
		return nil, err
	}
	return players, nil
}
func (s *Server) liveQuiz(ctx context.Context, code, identity string) (quizView, error) {
	room, err := s.quizByCode(ctx, code)
	if err != nil {
		return quizView{}, err
	}
	state := room.QuizState(time.Now())
	view := quizView{Title: room.Title, Theme: room.Theme, QAEnabled: room.QAEnabled, QAVersion: room.QAVersion, Version: room.Version, State: state, Active: room.Active, Total: len(room.Quiz.Questions), Ends: room.Ends,
		Participation: room.Quiz.Participation, Joined: room.Joined, Responses: room.RoundResponses}
	reveal := state == "ended" || state == "paused" && room.Quiz.Reveal == "each"
	if room.Active >= 0 {
		question := room.Quiz.Questions[room.Active]
		view.Question = &quizRoundView{Prompt: question.Prompt, Choices: question.Choices}
		if reveal {
			view.Question.Correct = question.Correct
		}
	}
	if state == "ended" && room.Active >= 0 {
		for _, question := range room.Quiz.Questions[:room.Active+1] {
			view.Review = append(view.Review, quizRoundView{Prompt: question.Prompt, Choices: question.Choices, Correct: question.Correct})
		}
	}
	if identity != "" {
		var player models.QuizPlayer
		err = s.db.QuizPlayers.FindOne(ctx, bson.M{"quiz": room.ID, "identity": identity}, options.FindOne().SetProjection(bson.M{"_id": 1})).Decode(&player)
		if err == nil {
			view.Player = &player.ID
			if room.Active >= 0 {
				err = s.db.QuizAnswers.FindOne(ctx, bson.M{"quiz": room.ID, "identity": identity, "round": room.Active}).Err()
				view.Answered = err == nil
			}
		}
		if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
			return view, err
		}
	}
	if reveal {
		view.Leaderboard, err = s.quizLeaderboard(ctx, room)
		return view, err
	}
	return view, nil
}
func (s *Server) publicQuiz(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	view, err := s.liveQuiz(ctx, code, s.guest(c, true))
	if err != nil {
		dbError(c, err)
		return
	}
	c.JSON(200, view)
}
func (s *Server) quizEvents(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	identity := s.guest(c, false)
	s.stream(c, "quiz:"+code, func(ctx context.Context) (any, error) { return s.liveQuiz(ctx, code, identity) })
}
func (s *Server) joinQuiz(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !body(c, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if !singleLine(in.Name, 0, 32) {
		reject(c, "Use a display name of up to 32 characters.")
		return
	}
	identity := s.guest(c, false)
	if identity == "" {
		fail(c, 428, "guest_cookie", "Open the quiz first.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, err := s.quizByCode(ctx, code)
	if err != nil {
		dbError(c, err)
		return
	}
	player := models.QuizPlayer{ID: bson.NewObjectID(), Quiz: room.ID, Identity: identity, Alias: in.Name}
	if room.Quiz.Participation == "anonymous" {
		player.Alias = "Player " + strings.ToUpper(token(3))
	}
	if player.Alias == "" {
		reject(c, "Enter a display name.")
		return
	}
	session, err := s.db.Client.StartSession()
	if err != nil {
		dbError(c, err)
		return
	}
	defer session.EndSession(ctx)
	_, err = session.WithTransaction(ctx, func(tx context.Context) (any, error) {
		filter := bson.M{"_id": room.ID, "state": bson.M{"$ne": "ended"}, "joined": bson.M{"$lt": capacityQuiz}, "control": room.Control}
		res, err := s.db.Rooms.UpdateOne(tx, filter, bson.M{"$inc": bson.M{"version": 1, "joined": 1}})
		if err != nil {
			return nil, err
		}
		if res.MatchedCount == 0 {
			return nil, errQuizFull
		}
		return s.db.QuizPlayers.InsertOne(tx, player)
	})
	if mongo.IsDuplicateKeyError(err) || errors.Is(err, errQuizFull) {
		if lookup := s.db.QuizPlayers.FindOne(ctx, bson.M{"quiz": room.ID, "identity": identity}).Decode(&player); lookup == nil {
			c.JSON(200, gin.H{"id": player.ID, "alias": player.Alias})
			return
		} else if !errors.Is(lookup, mongo.ErrNoDocuments) {
			dbError(c, lookup)
			return
		}
	}
	if errors.Is(err, errQuizFull) {
		conflict(c, "The room changed, ended, or reached its 200-player limit.")
		return
	}
	if err != nil {
		dbError(c, err)
		return
	}
	s.notifyQuiz(ctx, code)
	c.JSON(201, gin.H{"id": player.ID, "alias": player.Alias})
}
func (s *Server) answerQuiz(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	var in struct {
		Round  *int `json:"round"`
		Choice *int `json:"choice"`
	}
	if !body(c, &in) {
		return
	}
	if in.Round == nil || *in.Round < 0 || *in.Round >= 20 || in.Choice == nil || *in.Choice < 0 || *in.Choice >= 8 {
		reject(c, "Send a valid question and choice.")
		return
	}
	identity := s.guest(c, false)
	if identity == "" {
		fail(c, 428, "guest_cookie", "Join the quiz to answer.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, err := s.quizByCode(ctx, code)
	if err != nil {
		dbError(c, err)
		return
	}
	if room.Active != *in.Round || room.State != "live" || room.Ends == nil {
		conflict(c, "That question is no longer open.")
		return
	}
	question := room.Quiz.Questions[room.Active]
	if *in.Choice >= len(question.Choices) {
		reject(c, "Invalid choice for this question.")
		return
	}
	session, err := s.db.Client.StartSession()
	if err != nil {
		dbError(c, err)
		return
	}
	defer session.EndSession(ctx)
	_, err = session.WithTransaction(ctx, func(tx context.Context) (any, error) {
		now := time.Now()
		filter := bson.M{"_id": room.ID, "state": "live", "active": room.Active, "control": room.Control, "ends": bson.M{"$gt": now}}
		res, err := s.db.Rooms.UpdateOne(tx, filter, bson.M{"$inc": bson.M{"version": 1, "roundResponses": 1}})
		if err != nil {
			return nil, err
		}
		if res.MatchedCount == 0 {
			return nil, errQuizChanged
		}
		points, correct := models.Score(question, *in.Choice, room.Ends.Sub(now), room.Quiz.SpeedBonus)
		increments := bson.M{"points": points, "answered": 1}
		if correct {
			increments["correct"] = 1
		}
		res, err = s.db.QuizPlayers.UpdateOne(tx, bson.M{"quiz": room.ID, "identity": identity}, bson.M{"$inc": increments})
		if err != nil {
			return nil, err
		}
		if res.MatchedCount == 0 {
			return nil, mongo.ErrNoDocuments
		}
		return s.db.QuizAnswers.InsertOne(tx, models.QuizAnswer{Quiz: room.ID, Identity: identity, Round: room.Active, Choice: *in.Choice, Points: points, Correct: correct, At: now})
	})
	switch {
	case errors.Is(err, mongo.ErrNoDocuments):
		fail(c, 403, "join_required", "Join the quiz to answer.")
	case errors.Is(err, errQuizChanged):
		conflict(c, "That question is no longer open.")
	case mongo.IsDuplicateKeyError(err):
		fail(c, 409, "already_answered", "Your answer was already recorded.")
	case err != nil:
		dbError(c, err)
	default:
		s.notifyQuiz(ctx, code)
		c.JSON(201, gin.H{"accepted": true})
	}
}
