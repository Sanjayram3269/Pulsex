package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/Sanjayram3269/Pulsex/backend/internal/platform"
	"github.com/Sanjayram3269/Pulsex/backend/internal/realtime"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

type Server struct {
	cfg       platform.Config
	db        *platform.Store
	hub       *realtime.Hub
	shutdown  context.Context
	streams   chan struct{}
	passwords chan struct{}
}

func Router(ctx context.Context, cfg platform.Config, db *platform.Store, hub *realtime.Hub) (*gin.Engine, error) {
	gin.SetMode(gin.ReleaseMode)
	g := gin.New()
	if err := g.SetTrustedProxies(cfg.Proxies); err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, db: db, hub: hub, shutdown: ctx, streams: make(chan struct{}, 512), passwords: make(chan struct{}, 4)}
	g.Use(func(c *gin.Context) {
		start := time.Now()
		c.Header("X-Content-Type-Options", "nosniff")
		if cfg.Secure {
			c.Header("Strict-Transport-Security", "max-age=31536000")
		}
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("X-Frame-Options", "DENY")
		c.Next()
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			slog.Info("request", "method", c.Request.Method, "route", c.FullPath(), "status", c.Writer.Status(), "ms", time.Since(start).Milliseconds())
		}
	}, gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, _ any) {
		slog.Error("recovered handler panic", "route", c.FullPath())
		fail(c, 500, "internal", "Unexpected server error.")
	}))
	a := g.Group("/api/v1", s.origins)
	a.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok"}) })
	a.GET("/ready", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if db.Ready(ctx) != nil {
			fail(c, 503, "unavailable", "A dependency is unavailable.")
			return
		}
		c.JSON(200, gin.H{"status": "ready"})
	})
	auth := a.Group("/auth")
	auth.POST("/register", s.limit("register", 12, time.Hour), s.passwordCapacity(), s.register)
	auth.POST("/login", s.limit("login", 30, 15*time.Minute), s.passwordCapacity(), s.login)
	auth.POST("/logout", s.logout)
	auth.GET("/me", s.me)
	auth.PATCH("/me", s.profile)
	p := a.Group("/polls")
	p.GET("", s.listPolls)
	p.POST("", s.limit("create", 60, time.Hour), s.createPoll)
	p.GET("/:id", s.ownerPoll)
	p.PUT("/:id", s.limit("manage", 180, time.Minute), s.editPoll)
	p.POST("/:id/action", s.limit("manage", 180, time.Minute), s.pollAction)
	p.GET("/:id/analytics", s.analytics)
	p.GET("/:id/export", s.export)
	p.GET("/:id/results", s.ownerResults)
	p.GET("/:id/events", s.ownerEvents)
	p.GET("/:id/terms", s.pendingTerms)
	p.POST("/:id/terms/:term", s.limit("manage", 180, time.Minute), s.moderateTerm)
	pub := a.Group("/public")
	pub.POST("/demo", s.limit("demo", 10, time.Hour), s.createDemo)
	pub.GET("/polls/:slug", s.publicPoll)
	pub.GET("/polls/:slug/results", s.publicResults)
	pub.GET("/polls/:slug/events", s.publicEvents)
	pub.POST("/polls/:slug/votes", s.limit("vote", 300, time.Minute), s.vote)
	a.GET("/quizzes", s.listQuizzes)
	a.POST("/quizzes", s.limit("room", 30, time.Hour), s.createQuiz)
	a.GET("/quizzes/:id", s.getOwnedQuiz)
	a.PUT("/quizzes/:id", s.limit("manage", 180, time.Minute), s.editQuiz)
	a.POST("/quizzes/:id/action", s.limit("manage", 180, time.Minute), s.quizAction)
	a.GET("/quizzes/:id/export", s.exportQuiz)
	a.GET("/quizzes/:id/insights", s.quizInsights)
	pub.GET("/quizzes/:code", s.publicQuiz)
	pub.GET("/quizzes/:code/events", s.quizEvents)
	pub.POST("/quizzes/:code/join", s.limit("quiz-join", 140, time.Minute), s.joinQuiz)
	pub.POST("/quizzes/:code/answers", s.limit("vote", 300, time.Minute), s.answerQuiz)
	a.GET("/rooms", s.listRooms)
	a.POST("/rooms", s.limit("room", 30, time.Hour), s.createRoom)
	a.GET("/rooms/:id", s.ownerRoom)
	a.GET("/rooms/:id/insights", s.roomInsights)
	a.GET("/rooms/:id/qa", s.ownerQA)
	a.GET("/rooms/:id/qa/events", s.ownerQAEvents)
	a.PUT("/rooms/:id/qa", s.limit("manage", 180, time.Minute), s.toggleQA)
	a.POST("/rooms/:id/qa/:question", s.limit("manage", 180, time.Minute), s.moderateQA)
	pub.GET("/rooms/:code/qa", s.publicQA)
	pub.GET("/rooms/:code/qa/events", s.qaEvents)
	pub.POST("/rooms/:code/qa", s.limit("qa-submit", 40, time.Minute), s.submitQA)
	pub.PUT("/rooms/:code/qa/:question/vote", s.limit("qa-vote", 240, time.Minute), s.updateUpvote)
	a.PUT("/rooms/:id", s.limit("manage", 180, time.Minute), s.editRoom)
	a.POST("/rooms/:id/action", s.limit("manage", 180, time.Minute), s.roomAction)
	pub.GET("/rooms/:code", s.publicRoom)
	pub.GET("/rooms/:code/events", s.roomEvents)
	pub.POST("/rooms/:code/presence", s.limit("presence", 300, time.Minute), s.presence)
	g.NoRoute(func(c *gin.Context) {
		if cfg.Static == "" || strings.HasPrefix(c.Request.URL.Path, "/api") || c.Request.Method != "GET" && c.Request.Method != "HEAD" {
			fail(c, 404, "not_found", "Page not found.")
			return
		}
		f := strings.TrimPrefix(path.Clean(c.Request.URL.Path), "/")
		if strings.HasPrefix(f, "assets/") || f == "favicon.svg" {
			if strings.HasPrefix(f, "assets/") {
				c.Header("Cache-Control", "public, max-age=31536000, immutable")
			}
			http.FileServer(http.Dir(cfg.Static)).ServeHTTP(c.Writer, c.Request)
			return
		}
		c.Header("Cache-Control", "no-cache")
		c.Header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
		if _, err := os.Stat(cfg.Static + "/index.html"); err != nil {
			fail(c, 503, "unavailable", "Frontend build is missing.")
			return
		}
		c.File(cfg.Static + "/index.html")
	})
	return g, nil
}
func fail(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}
func reject(c *gin.Context, message string) { fail(c, 400, "invalid_input", message) }
func missing(c *gin.Context)                { fail(c, 404, "not_found", "The requested resource was not found.") }
func unavailable(c *gin.Context) {
	fail(c, 503, "unavailable", "Service temporarily unavailable. Please try again.")
}
func conflict(c *gin.Context, message string) { fail(c, 409, "conflict", message) }
func dbError(c *gin.Context, err error) {
	if errors.Is(err, mongo.ErrNoDocuments) {
		missing(c)
		return
	}
	slog.Warn("database operation failed", "route", c.FullPath())
	unavailable(c)
}
func body(c *gin.Context, out any) bool {
	if c.ContentType() != "application/json" {
		fail(c, 415, "invalid_content_type", "Use application/json.")
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 24<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		reject(c, "Malformed or oversized JSON.")
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		reject(c, "Send one JSON value.")
		return false
	}
	return true
}
func request(c *gin.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(c.Request.Context(), 8*time.Second)
}
func objectID(c *gin.Context) (bson.ObjectID, bool) {
	id, err := bson.ObjectIDFromHex(c.Param("id"))
	if err != nil || id.IsZero() {
		reject(c, "Invalid resource ID.")
		return id, false
	}
	return id, true
}
func pagination(c *gin.Context) (int64, int64, bool) {
	limit, e1 := strconv.ParseInt(c.DefaultQuery("limit", "30"), 10, 32)
	page, e2 := strconv.ParseInt(c.DefaultQuery("page", "1"), 10, 32)
	if e1 != nil || e2 != nil || limit < 1 || limit > 100 || page < 1 || page > 1000 {
		reject(c, "Invalid pagination.")
		return 0, 0, false
	}
	return limit, (page - 1) * limit, true
}
func (s *Server) origins(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	method := c.Request.Method
	origin := c.GetHeader("Origin")
	if origin != "" && origin != s.cfg.Origin || method != "GET" && method != "HEAD" && origin != s.cfg.Origin {
		fail(c, 403, "origin", "Request origin is not allowed.")
		return
	}
	c.Next()
}

var fixedWindow = redis.NewScript(`
local n=redis.call('INCR',KEYS[1])
if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end
return n
`)

func (s *Server) limit(scope string, max int64, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
		n, err := fixedWindow.Run(ctx, s.db.Redis, []string{"pulsex:rate:" + scope + ":" + digest(c.ClientIP())}, int(window.Seconds())).Int64()
		cancel()
		if err != nil {
			unavailable(c)
			return
		}
		if n > max {
			c.Header("Retry-After", strconv.Itoa(int(window.Seconds())))
			fail(c, 429, "rate_limit", "Too many requests. Try again shortly.")
			return
		}
		c.Next()
	}
}

func (s *Server) passwordCapacity() gin.HandlerFunc {
	return func(c *gin.Context) {
		select {
		case s.passwords <- struct{}{}:
			defer func() { <-s.passwords }()
			c.Next()
		default:
			c.Header("Retry-After", "2")
			unavailable(c)
		}
	}
}
