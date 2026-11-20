package api

import (
	"context"
	"time"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func (s *Server) createDemo(c *gin.Context) {
	ctx, cancel := request(c)
	defer cancel()
	now := time.Now()
	expires := now.Add(time.Hour)
	room := models.Room{ID: bson.NewObjectID(), Code: token(4), Title: "Demo · Workshop check-in", Theme: "aurora",
		State: "live", Active: 0, Created: now, Version: 1, Ends: &expires, DemoExpires: &expires}
	poll := models.Poll{ID: bson.NewObjectID(), Slug: token(10), RoomID: room.ID, Title: "Which activities would you try?",
		Description: "Demonstration poll. Choose up to two activities and share the room with a second browser to watch the count update.",
		Question:    &models.Question{Version: 1, Type: models.MultipleChoice, Min: 1, Max: 2},
		Choices:     []string{"Build a prototype", "Map customer needs", "Try a design sprint"}, Counts: make([]int64, 3),
		Guests: true, Visibility: "live", State: "live", Created: now, Version: 1, Closes: &expires, DemoExpires: &expires}
	room.Polls = []string{poll.Slug}
	session, err := s.db.Client.StartSession()
	if err != nil {
		dbError(c, err)
		return
	}
	defer session.EndSession(ctx)
	_, err = session.WithTransaction(ctx, func(tx context.Context) (any, error) {
		if _, err := s.db.Polls.InsertOne(tx, poll); err != nil {
			return nil, err
		}
		return s.db.Rooms.InsertOne(tx, room)
	})
	if err != nil {
		dbError(c, err)
		return
	}
	c.JSON(201, gin.H{"code": room.Code, "expires": expires})
}
func themePreset(value string) (string, bool) {
	switch value {
	case "", "obsidian":
		return "obsidian", true
	case "aurora", "ember":
		return value, true
	default:
		return "", false
	}
}
