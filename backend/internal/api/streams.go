package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"github.com/Sanjayram3269/Pulsex/backend/internal/realtime"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

func (s *Server) sendResults(ctx context.Context, c *gin.Context, p models.Poll) {
	snap, err := realtime.Snapshot(ctx, s.db, p)
	if err != nil {
		unavailable(c)
		return
	}
	c.JSON(200, snap)
}
func (s *Server) ownerResults(c *gin.Context) {
	ctx, cancel := request(c)
	defer cancel()
	if p, ok := s.ownedPoll(ctx, c); ok {
		s.sendResults(ctx, c, p)
	}
}
func (s *Server) publicResults(c *gin.Context) {
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
	if !p.CanShowResults(time.Now()) {
		fail(c, 403, "hidden", "Results are hidden.")
		return
	}
	s.sendResults(ctx, c, p)
}

type resultEvent struct {
	Version int64   `json:"version"`
	State   string  `json:"state"`
	Counts  []int64 `json:"counts,omitempty"`
}

func (s *Server) pollEvent(ctx context.Context, p models.Poll, owner bool) (any, error) {
	event := resultEvent{Version: p.Version, State: p.Status(time.Now())}
	if owner || p.CanShowResults(time.Now()) {
		snap, err := realtime.Snapshot(ctx, s.db, p)
		if err != nil {
			return nil, err
		}
		// Never combine projected counts from a newer revision with stale metadata.
		if snap.Version > p.Version {
			return resultEvent{Version: p.Version, State: event.State}, nil
		}
		event.Counts = snap.Counts
	}
	return event, nil
}
func (s *Server) publicEvents(c *gin.Context) {
	slug, ok := slugParam(c)
	if !ok {
		return
	}
	s.stream(c, "poll:"+slug, func(ctx context.Context) (any, error) {
		p, err := s.bySlug(ctx, slug)
		if err != nil {
			return nil, err
		}
		return s.pollEvent(ctx, p, false)
	})
}
func (s *Server) ownerEvents(c *gin.Context) {
	ctx, cancel := request(c)
	p, ok := s.ownedPoll(ctx, c)
	cancel()
	if !ok {
		return
	}
	s.stream(c, "poll:"+p.Slug, func(ctx context.Context) (any, error) {
		owner, err := s.identity(ctx, c)
		if err != nil {
			return nil, err
		}
		var current models.Poll
		if err = s.db.Polls.FindOne(ctx, bson.M{"_id": p.ID, "owner": owner}).Decode(&current); err != nil {
			return nil, err
		}
		return s.pollEvent(ctx, current, true)
	})
}
func (s *Server) stream(c *gin.Context, topic string, load func(context.Context) (any, error)) {
	select {
	case s.streams <- struct{}{}:
		defer func() { <-s.streams }()
	default:
		fail(c, 503, "stream_capacity", "Too many live connections. Reconnect shortly.")
		return
	}
	watched, stop := s.hub.Watch(topic)
	defer stop()
	ctx := c.Request.Context()
	controller := http.NewResponseController(c.Writer)
	var last string
	write := func(data string) bool {
		if err := controller.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
			return false
		}
		defer controller.SetWriteDeadline(time.Time{})
		if _, err := fmt.Fprint(c.Writer, data); err != nil {
			return false
		}
		return controller.Flush() == nil
	}
	read := func() ([]byte, error) {
		work, cancel := context.WithTimeout(ctx, 4*time.Second)
		defer cancel()
		value, err := load(work)
		if err != nil {
			return nil, err
		}
		return json.Marshal(value)
	}
	data, err := read()
	if err != nil {
		dbError(c, err)
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("X-Accel-Buffering", "no")
	c.Header("Cache-Control", "no-store, no-transform")
	last = string(data)
	if !write("retry: 2000\ndata: " + last + "\n\n") {
		return
	}
	tick := time.NewTicker(10 * time.Second)
	defer tick.Stop()
	for {
		heartbeat := false
		select {
		case <-ctx.Done():
			return
		case <-s.shutdown.Done():
			return
		case <-watched:
		case <-tick.C:
			heartbeat = true
		}
		data, err = read()
		if err != nil {
			if err == mongo.ErrNoDocuments {
				_ = write("event: unavailable\ndata: {}\n\n")
			}
			return
		}
		next := string(data)
		if next != last {
			if !write("data: " + next + "\n\n") {
				return
			}
			last = next
		} else if heartbeat && !write(": heartbeat\n\n") {
			return
		}
	}
}
