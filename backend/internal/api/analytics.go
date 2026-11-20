package api

import (
	"encoding/csv"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

type bucket struct {
	At    time.Time `bson:"_id" json:"at"`
	Votes int64     `bson:"votes" json:"votes"`
}

func (s *Server) analytics(c *gin.Context) {
	ctx, cancel := request(c)
	defer cancel()
	p, ok := s.ownedPoll(ctx, c)
	if !ok {
		return
	}
	since := time.Now().UTC().Truncate(time.Hour).Add(-167 * time.Hour)
	cur, err := s.db.Votes.Aggregate(ctx, mongo.Pipeline{
		bson.D{{Key: "$match", Value: bson.M{"poll": p.ID, "timestamp": bson.M{"$gte": since}}}},
		bson.D{{Key: "$group", Value: bson.M{"_id": bson.M{"$dateTrunc": bson.M{"date": "$timestamp", "unit": "hour"}}, "votes": bson.M{"$sum": 1}}}},
		bson.D{{Key: "$sort", Value: bson.M{"_id": 1}}},
	})
	if err != nil {
		dbError(c, err)
		return
	}
	defer cur.Close(ctx)
	series := make([]bucket, 0)
	if err = cur.All(ctx, &series); err != nil {
		dbError(c, err)
		return
	}
	c.JSON(200, gin.H{"poll": viewPoll(p, true, false), "snapshot": p.Snapshot(), "since": since, "series": series})
}
func excelSafe(text string) string {
	if text != "" {
		switch text[0] {
		case '=', '+', '-', '@', '\t', '\r', '\n':
			return "'" + text
		}
	}
	return text
}
func (s *Server) export(c *gin.Context) {
	ctx, cancel := request(c)
	defer cancel()
	p, ok := s.ownedPoll(ctx, c)
	if !ok {
		return
	}
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="pulsex-results.csv"`)
	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{"choice", "votes"})
	for i, label := range p.Choices {
		_ = w.Write([]string{excelSafe(label), strconv.FormatInt(p.Counts[i], 10)})
	}
	w.Flush()
}
