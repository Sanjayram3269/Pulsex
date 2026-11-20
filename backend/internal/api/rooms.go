package api

import (
	"context"
	"errors"
	"strconv"
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

type roomInput struct {
	Title string   `json:"title"`
	Polls []string `json:"polls"`
}

func readRoom(c *gin.Context) (roomInput, bool) {
	var in roomInput
	if !body(c, &in) {
		return in, false
	}
	in.Title = strings.TrimSpace(in.Title)
	if !singleLine(in.Title, 3, 100) || len(in.Polls) < 1 || len(in.Polls) > 20 {
		reject(c, "Use a room title of 3–100 characters and select 1–20 polls.")
		return in, false
	}
	seen := make(map[string]bool)
	for _, slug := range in.Polls {
		if !validHex(slug, 20) || seen[slug] {
			reject(c, "Select distinct, valid polls.")
			return in, false
		}
		seen[slug] = true
	}
	return in, true
}
func (s *Server) validateRoomPolls(ctx context.Context, c *gin.Context, user bson.ObjectID, in roomInput) bool {
	n, err := s.db.Polls.CountDocuments(ctx, bson.M{"slug": bson.M{"$in": in.Polls}, "owner": user, "state": bson.M{"$in": bson.A{"draft", "live", "scheduled"}}})
	if err != nil {
		dbError(c, err)
		return false
	}
	if n != int64(len(in.Polls)) {
		reject(c, "Select only active or draft polls that you own.")
		return false
	}
	return true
}
func (s *Server) listRooms(c *gin.Context) {
	limit, skip, ok := pagination(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	id, ok := s.require(ctx, c)
	if !ok {
		return
	}
	cur, err := s.db.Rooms.Find(ctx, bson.M{"owner": id}, options.Find().SetLimit(limit+1).SetSkip(skip).SetSort(bson.D{{Key: "created", Value: -1}, {Key: "_id", Value: -1}}))
	if err != nil {
		dbError(c, err)
		return
	}
	defer cur.Close(ctx)
	list := make([]models.Room, 0)
	if err = cur.All(ctx, &list); err != nil {
		dbError(c, err)
		return
	}
	more := int64(len(list)) > limit
	if more {
		list = list[:limit]
	}
	c.JSON(200, gin.H{"items": list, "hasMore": more})
}
func (s *Server) createRoom(c *gin.Context) {
	in, ok := readRoom(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	user, ok := s.require(ctx, c)
	if !ok || !s.validateRoomPolls(ctx, c, user, in) {
		return
	}
	room := models.Room{ID: bson.NewObjectID(), Owner: user, Code: token(4), Title: in.Title, Polls: in.Polls, State: "waiting", Active: -1, Version: 1, Created: time.Now()}
	if _, err := s.db.Rooms.InsertOne(ctx, room); err != nil {
		dbError(c, err)
		return
	}
	c.JSON(201, room)
}
func (s *Server) ownedRoom(ctx context.Context, c *gin.Context) (models.Room, bool) {
	var room models.Room
	id, ok := objectID(c)
	if !ok {
		return room, false
	}
	user, ok := s.require(ctx, c)
	if !ok {
		return room, false
	}
	if err := s.db.Rooms.FindOne(ctx, bson.M{"_id": id, "owner": user}).Decode(&room); err != nil {
		dbError(c, err)
		return room, false
	}
	return room, true
}
func (s *Server) ownerRoom(c *gin.Context) {
	ctx, cancel := request(c)
	defer cancel()
	if room, ok := s.ownedRoom(ctx, c); ok {
		c.JSON(200, room)
	}
}
func (s *Server) editRoom(c *gin.Context) {
	in, ok := readRoom(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, ok := s.ownedRoom(ctx, c)
	if !ok || !s.validateRoomPolls(ctx, c, room.Owner, in) {
		return
	}
	err := s.db.Rooms.FindOneAndUpdate(ctx, bson.M{"_id": room.ID, "state": "waiting", "version": room.Version}, bson.M{"$set": bson.M{"title": in.Title, "polls": in.Polls}, "$inc": bson.M{"version": 1}}, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&room)
	if errors.Is(err, mongo.ErrNoDocuments) {
		conflict(c, "Only unchanged waiting rooms can be edited.")
		return
	}
	if err != nil {
		dbError(c, err)
		return
	}
	s.notifyRoom(ctx, room.Code)
	c.JSON(200, room)
}

var errRoomChanged = errors.New("room changed")

func (s *Server) roomAction(c *gin.Context) {
	var in struct {
		Action  string `json:"action"`
		Index   *int   `json:"index"`
		Seconds int    `json:"seconds"`
		Version int64  `json:"version"`
	}
	if !body(c, &in) {
		return
	}
	if (in.Action != "open" && in.Action != "close" && in.Action != "finish") || in.Version < 1 || in.Seconds < 0 || in.Seconds > 3600 || in.Action == "open" && (in.Index == nil || *in.Index < 0 || *in.Index > 19) {
		reject(c, "Invalid room controls.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, ok := s.ownedRoom(ctx, c)
	if !ok {
		return
	}
	if room.Version != in.Version || room.State == "ended" || in.Action == "close" && room.State != "live" || in.Action == "open" && (*in.Index >= len(room.Polls) || *in.Index <= room.Active) {
		conflict(c, "This room changed or the question is no longer available.")
		return
	}
	session, err := s.db.Client.StartSession()
	if err != nil {
		dbError(c, err)
		return
	}
	defer session.EndSession(ctx)
	var current models.Room
	_, err = session.WithTransaction(ctx, func(tx context.Context) (any, error) {
		now := time.Now()
		state, active := "paused", room.Active
		var ends *time.Time
		if room.State == "live" {
			_, err := s.db.Polls.UpdateOne(tx, bson.M{"slug": room.Polls[room.Active], "owner": room.Owner, "roomId": room.ID, "state": bson.M{"$in": bson.A{"live", "scheduled"}}}, roomPollUpdate(now, bson.M{"state": "closed"}))
			if err != nil {
				return nil, err
			}
		}
		if in.Action == "open" {
			active, state = *in.Index, "live"
			var p models.Poll
			if err := s.db.Polls.FindOne(tx, bson.M{"slug": room.Polls[active], "owner": room.Owner}).Decode(&p); err != nil {
				return nil, err
			}
			if !p.RoomID.IsZero() || p.State == "archived" || p.Status(now) == "closed" || p.Closes != nil && !p.Closes.After(now) {
				return nil, errRoomChanged
			}
			ends = p.Closes
			if in.Seconds > 0 {
				deadline := now.Add(time.Duration(in.Seconds) * time.Second)
				if ends == nil || deadline.Before(*ends) {
					ends = &deadline
				}
			}
			_, err := s.db.Polls.UpdateByID(tx, p.ID, roomPollUpdate(now, bson.M{"state": "live", "opens": nil, "closes": ends, "roomId": room.ID}))
			if err != nil {
				return nil, err
			}
		}
		if in.Action == "finish" {
			state = "ended"
		}
		err := s.db.Rooms.FindOneAndUpdate(tx, bson.M{"_id": room.ID, "version": room.Version}, bson.M{"$set": bson.M{"active": active, "state": state, "ends": ends}, "$inc": bson.M{"version": 1}}, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&current)
		return nil, err
	})
	if errors.Is(err, errRoomChanged) || errors.Is(err, mongo.ErrNoDocuments) {
		conflict(c, "This room or poll has changed.")
		return
	}
	if err != nil {
		dbError(c, err)
		return
	}
	s.notifyRoom(ctx, room.Code)
	c.JSON(200, current)
}
func roomPollUpdate(now time.Time, fields bson.M) bson.M {
	fields["pending"], fields["dirtyAt"] = true, now
	return bson.M{"$set": fields, "$inc": bson.M{"version": 1}}
}
func (s *Server) notifyRoom(ctx context.Context, code string) {
	_ = s.db.Redis.Publish(ctx, realtime.Channel, "room:"+code).Err()
}

type roomView struct {
	Title   string     `json:"title"`
	State   string     `json:"state"`
	Slug    string     `json:"slug,omitempty"`
	Version int64      `json:"version"`
	Active  int        `json:"active"`
	Total   int        `json:"total"`
	Ends    *time.Time `json:"ends"`
	Present int64      `json:"present"`
}

func roomCode(c *gin.Context) (string, bool) {
	code := c.Param("code")
	if !validHex(code, 8) {
		reject(c, "Enter an eight-character room code.")
		return "", false
	}
	return code, true
}
func (s *Server) getRoom(ctx context.Context, code string) (roomView, error) {
	var room models.Room
	if err := s.db.Rooms.FindOne(ctx, bson.M{"code": code}).Decode(&room); err != nil {
		return roomView{}, err
	}
	view := roomView{Title: room.Title, State: room.State, Version: room.Version, Active: room.Active, Total: len(room.Polls), Ends: room.Ends}
	if room.Active >= 0 && room.State != "ended" {
		poll, err := s.bySlug(ctx, room.Polls[room.Active])
		if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
			return view, err
		}
		if err == nil {
			view.Slug = poll.Slug
			if room.State == "live" && poll.Status(time.Now()) != "live" {
				view.State = "paused"
			}
		}
	}
	var err error
	view.Present, err = s.db.Redis.ZCount(ctx, "pulsex:presence:"+code, strconv.FormatInt(time.Now().Add(-45*time.Second).Unix(), 10), "+inf").Result()
	return view, err
}
func (s *Server) publicRoom(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	room, err := s.getRoom(ctx, code)
	if err != nil {
		dbError(c, err)
		return
	}
	s.guest(c, true)
	c.JSON(200, room)
}
func (s *Server) roomEvents(c *gin.Context) {
	if code, ok := roomCode(c); ok {
		s.stream(c, "room:"+code, func(ctx context.Context) (any, error) { return s.getRoom(ctx, code) })
	}
}

var touchPresence = redis.NewScript(`
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('EXPIRE', KEYS[1], 60)
return 1
`)

func (s *Server) presence(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	guest := s.guest(c, false)
	if guest == "" {
		fail(c, 428, "guest_cookie", "Open the room first.")
		return
	}
	ctx, cancel := request(c)
	defer cancel()
	if err := s.db.Rooms.FindOne(ctx, bson.M{"code": code}).Err(); err != nil {
		dbError(c, err)
		return
	}
	now := time.Now()
	if err := touchPresence.Run(ctx, s.db.Redis, []string{"pulsex:presence:" + code}, now.Add(-45*time.Second).Unix(), now.Unix(), guest).Err(); err != nil {
		unavailable(c)
		return
	}
	c.Status(204)
}
