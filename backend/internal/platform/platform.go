package platform

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readconcern"
	"go.mongodb.org/mongo-driver/v2/mongo/writeconcern"
)

type Config struct {
	Origin, Port, MongoURI, Database, RedisURL, GuestSecret, Static string
	Secure, InternalWorker                                          bool
	Proxies                                                         []string
}

func env(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}
func Load() (Config, error) {
	c := Config{Origin: env("APP_ORIGIN", "http://localhost:8080"), Port: env("PORT", env("HTTP_PORT", "8080")), MongoURI: os.Getenv("MONGO_URI"), Database: env("MONGO_DB", "pulsex"), RedisURL: os.Getenv("REDIS_URL"), GuestSecret: os.Getenv("GUEST_SECRET"), Static: os.Getenv("STATIC_DIR")}
	c.InternalWorker = os.Getenv("RUN_WORKER") == "true"
	switch os.Getenv("COOKIE_SECURE") {
	case "true":
		c.Secure = true
	case "", "false":
	default:
		return c, errors.New("COOKIE_SECURE must be true or false")
	}
	if v := os.Getenv("TRUSTED_PROXY_CIDRS"); v != "" {
		c.Proxies = strings.Split(v, ",")
	}
	u, err := url.Parse(c.Origin)
	if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return c, errors.New("APP_ORIGIN must be an HTTP origin with no path")
	}
	if c.Secure != (u.Scheme == "https") || !c.Secure && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" {
		return c, errors.New("public origins require HTTPS and secure cookies")
	}
	if c.Secure && strings.HasPrefix(c.GuestSecret, "local-development-only") {
		return c, errors.New("configure a production guest signing secret")
	}
	if len(c.GuestSecret) < 32 || c.MongoURI == "" || c.RedisURL == "" {
		return c, errors.New("set MongoDB, Redis and a guest signing secret of at least 32 bytes")
	}
	return c, nil
}

type Store struct {
	Client                             *mongo.Client
	Redis                              *redis.Client
	Users, Logins, Polls, Votes, Rooms *mongo.Collection
}

func Connect(ctx context.Context, c Config) (*Store, error) {
	ro, err := redis.ParseURL(c.RedisURL)
	if err != nil {
		return nil, errors.New("invalid REDIS_URL")
	}
	ro.DialTimeout = 3 * time.Second
	ro.ReadTimeout = 3 * time.Second
	ro.WriteTimeout = 3 * time.Second
	ro.PoolSize = 32
	m, err := mongo.Connect(options.Client().ApplyURI(c.MongoURI).SetMaxPoolSize(64).SetReadConcern(readconcern.Majority()).SetWriteConcern(writeconcern.Majority()).SetServerSelectionTimeout(4 * time.Second))
	if err != nil {
		return nil, errors.New("invalid MongoDB configuration")
	}
	db := m.Database(c.Database)
	s := &Store{m, redis.NewClient(ro), db.Collection("users"), db.Collection("auth_sessions"), db.Collection("polls"), db.Collection("votes"), db.Collection("rooms")}
	if err = s.Ready(ctx); err != nil {
		s.Close()
		return nil, err
	}
	var hello struct {
		Set     string `bson:"setName"`
		Message string `bson:"msg"`
	}
	if err = db.RunCommand(ctx, bson.D{{Key: "hello", Value: 1}}).Decode(&hello); err != nil || hello.Set == "" && hello.Message != "isdbgrid" {
		s.Close()
		return nil, errors.New("MongoDB transactions require a replica set or mongos")
	}
	return s, nil
}
func (s *Store) Ready(ctx context.Context) error {
	if s.Client.Ping(ctx, nil) != nil {
		return errors.New("MongoDB unavailable")
	}
	if s.Redis.Ping(ctx).Err() != nil {
		return errors.New("Redis unavailable")
	}
	return nil
}
func (s *Store) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	_ = s.Redis.Close()
	_ = s.Client.Disconnect(ctx)
}
func (s *Store) Indexes(ctx context.Context) error {
	index := func(unique bool, fields ...string) mongo.IndexModel {
		keys := bson.D{}
		for _, f := range fields {
			keys = append(keys, bson.E{Key: f, Value: 1})
		}
		return mongo.IndexModel{Keys: keys, Options: options.Index().SetUnique(unique)}
	}
	groups := []struct {
		collection *mongo.Collection
		indexes    []mongo.IndexModel
	}{
		{s.Users, []mongo.IndexModel{index(true, "email")}},
		{s.Logins, []mongo.IndexModel{{Keys: bson.D{{Key: "expires", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)}}},
		{s.Polls, []mongo.IndexModel{index(true, "slug"), index(false, "owner", "created", "_id"), index(false, "pending", "dirtyAt", "_id")}},
		{s.Votes, []mongo.IndexModel{index(true, "poll", "identity"), index(false, "poll", "timestamp")}},
		{s.Rooms, []mongo.IndexModel{index(true, "code"), index(false, "owner", "created", "_id")}},
	}
	for _, g := range groups {
		if _, err := g.collection.Indexes().CreateMany(ctx, g.indexes); err != nil {
			return errors.New("could not initialize " + g.collection.Name() + " indexes")
		}
	}
	return nil
}
