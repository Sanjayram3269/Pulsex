package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"github.com/Sanjayram3269/Pulsex/backend/internal/platform"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const Channel = "pulsex:updates"

func Key(slug string) string { return "pulsex:results:" + slug }

// Versions are zero-padded decimal strings so Lua never rounds a 64-bit integer.
var replace = redis.NewScript(`
local current = redis.call('GET', KEYS[1])
if current and string.sub(current, 1, 19) >= ARGV[1] then
 return 0
end
redis.call('SET', KEYS[1], ARGV[1] .. ARGV[2], 'EX', 86400)
redis.call('PUBLISH', ARGV[3], ARGV[4])
return 1
`)

func publish(ctx context.Context, s *platform.Store, p models.Poll) error {
	payload, err := json.Marshal(p.Snapshot())
	if err != nil {
		return err
	}
	version := strconv.FormatInt(p.Version, 10)
	version = strings.Repeat("0", 19-len(version)) + version
	return replace.Run(ctx, s.Redis, []string{Key(p.Slug)}, version, string(payload), Channel, "poll:"+p.Slug+"|"+version).Err()
}
func Snapshot(ctx context.Context, s *platform.Store, p models.Poll) (models.Snapshot, error) {
	read := func() (models.Snapshot, error) {
		raw, err := s.Redis.Get(ctx, Key(p.Slug)).Result()
		if err != nil {
			return models.Snapshot{}, err
		}
		var snap models.Snapshot
		if len(raw) < 20 || json.Unmarshal([]byte(raw[19:]), &snap) != nil || snap.Version < 1 || len(snap.Counts) > 10 || len(snap.Terms) > 100 {
			return snap, errors.New("invalid projection")
		}
		if p.Question == nil && snap.Version == p.Version && snap.Ballots == 0 {
			snap.Ballots = p.BallotCount()
		}
		return snap, nil
	}
	snap, err := read()
	if err == nil && snap.Version >= p.Version {
		return snap, nil
	}
	if err != nil && !errors.Is(err, redis.Nil) {
		return snap, err
	}
	if err = publish(ctx, s, p); err != nil {
		return snap, err
	}
	return read()
}
func RunWorker(ctx context.Context, s *platform.Store) {
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			job, cancel := context.WithTimeout(ctx, 5*time.Second)
			if err := drain(job, s); err != nil && ctx.Err() == nil {
				slog.Warn("projection retry", "component", "outbox")
			}
			cancel()
		}
	}
}
func drain(ctx context.Context, s *platform.Store) error {
	cur, err := s.Polls.Find(ctx, bson.M{"pending": true}, options.Find().SetSort(bson.D{{Key: "dirtyAt", Value: 1}, {Key: "_id", Value: 1}}).SetLimit(64))
	if err != nil {
		return err
	}
	defer cur.Close(ctx)
	var pending []models.Poll
	if err = cur.All(ctx, &pending); err != nil {
		return err
	}
	for _, p := range pending {
		if err = publish(ctx, s, p); err != nil {
			return err
		}
		if _, err = s.Polls.UpdateOne(ctx, bson.M{"_id": p.ID, "version": p.Version, "pending": true}, bson.M{"$set": bson.M{"pending": false}, "$unset": bson.M{"dirtyAt": ""}}); err != nil {
			return err
		}
	}
	return nil
}
