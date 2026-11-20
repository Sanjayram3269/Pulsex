package api

import (
	"encoding/csv"
	"strconv"
	"time"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

type questionMetric struct {
	Label   string `json:"label"`
	Ballots int64  `json:"ballots"`
	Correct *int64 `json:"correct,omitempty"`
}
type sessionReport struct {
	Title        string              `json:"title"`
	State        string              `json:"state"`
	Active       int                 `json:"active"`
	Present      *int64              `json:"present,omitempty"`
	Joined       *int64              `json:"joined,omitempty"`
	Completed    *int64              `json:"completed,omitempty"`
	AverageScore *float64            `json:"averageScore,omitempty"`
	Questions    []questionMetric    `json:"questions"`
	Leaders      []models.QuizPlayer `json:"leaders,omitempty"`
}

func sendSessionReport(c *gin.Context, report sessionReport) {
	if c.Query("format") != "csv" {
		c.JSON(200, report)
		return
	}
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="pulsex-session-insights.csv"`)
	writer := csv.NewWriter(c.Writer)
	_ = writer.Write([]string{"question", "ballots", "correct_answers"})
	for _, question := range report.Questions {
		correct := ""
		if question.Correct != nil {
			correct = strconv.FormatInt(*question.Correct, 10)
		}
		_ = writer.Write([]string{excelSafe(question.Label), strconv.FormatInt(question.Ballots, 10), correct})
	}
	writer.Flush()
}
func (s *Server) roomInsights(c *gin.Context) {
	ctx, cancel := request(c)
	defer cancel()
	room, ok := s.ownedRoom(ctx, c)
	if !ok {
		return
	}
	audience, err := s.getRoom(ctx, room.Code)
	if err != nil {
		dbError(c, err)
		return
	}
	cur, err := s.db.Polls.Find(ctx, bson.M{"slug": bson.M{"$in": room.Polls}, "owner": room.Owner})
	if err != nil {
		dbError(c, err)
		return
	}
	defer cur.Close(ctx)
	var polls []models.Poll
	if err = cur.All(ctx, &polls); err != nil {
		dbError(c, err)
		return
	}
	metrics := make(map[string]questionMetric, len(polls))
	for _, poll := range polls {
		metrics[poll.Slug] = questionMetric{Label: poll.Title, Ballots: poll.BallotCount()}
	}
	report := sessionReport{Title: room.Title, State: audience.State, Active: room.Active, Present: &audience.Present, Questions: make([]questionMetric, 0, len(room.Polls))}
	for _, slug := range room.Polls {
		if metric, exists := metrics[slug]; exists {
			report.Questions = append(report.Questions, metric)
		}
	}
	sendSessionReport(c, report)
}
func (s *Server) quizInsights(c *gin.Context) {
	ctx, cancel := request(c)
	defer cancel()
	room, ok := s.ownedQuiz(ctx, c)
	if !ok {
		return
	}
	state := room.QuizState(time.Now())
	report := sessionReport{Title: room.Title, State: state, Active: room.Active, Joined: &room.Joined, Questions: make([]questionMetric, len(room.Quiz.Questions))}
	for i, q := range room.Quiz.Questions {
		zero := int64(0)
		report.Questions[i] = questionMetric{Label: q.Prompt, Correct: &zero}
	}
	cur, err := s.db.QuizAnswers.Aggregate(ctx, mongo.Pipeline{
		bson.D{{Key: "$match", Value: bson.M{"quiz": room.ID}}},
		bson.D{{Key: "$group", Value: bson.M{"_id": "$round", "ballots": bson.M{"$sum": 1}, "correct": bson.M{"$sum": bson.M{"$cond": bson.A{"$correct", 1, 0}}}}}},
	})
	if err != nil {
		dbError(c, err)
		return
	}
	defer cur.Close(ctx)
	var counts []struct {
		Round   int   `bson:"_id"`
		Ballots int64 `bson:"ballots"`
		Correct int64 `bson:"correct"`
	}
	if err = cur.All(ctx, &counts); err != nil {
		dbError(c, err)
		return
	}
	for _, m := range counts {
		if m.Round >= 0 && m.Round < len(report.Questions) {
			report.Questions[m.Round].Ballots, report.Questions[m.Round].Correct = m.Ballots, &m.Correct
		}
	}
	players, err := s.quizRanks(ctx, room)
	if err != nil {
		dbError(c, err)
		return
	}
	var completed, points int64
	for _, player := range players {
		points += player.Points
		if player.Answered == int64(len(room.Quiz.Questions)) {
			completed++
		}
	}
	if state == "ended" {
		report.Completed = &completed
	}
	if len(players) > 0 {
		mean := float64(points) / float64(len(players))
		report.AverageScore = &mean
	}
	report.Leaders = players[:min(5, len(players))]
	sendSessionReport(c, report)
}
