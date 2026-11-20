package main

import (
	"context"
	"errors"
	"github.com/Sanjayram3269/Pulsex/backend/internal/api"
	"github.com/Sanjayram3269/Pulsex/backend/internal/platform"
	"github.com/Sanjayram3269/Pulsex/backend/internal/realtime"
	"log/slog"
	"net/http"
	"time"
)

func main() { platform.Run(serve) }
func serve(ctx context.Context, cfg platform.Config, db *platform.Store) error {
	hub := realtime.NewHub()
	g, err := api.Router(ctx, cfg, db, hub)
	if err != nil {
		return errors.New("invalid reverse proxy configuration")
	}
	go hub.Run(ctx, db.Redis)
	if cfg.InternalWorker {
		go realtime.RunWorker(ctx, db)
	}
	server := &http.Server{Addr: ":" + cfg.Port, Handler: g, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 75 * time.Second, MaxHeaderBytes: 16 << 10}
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	slog.Info("API listening", "port", cfg.Port)
	select {
	case err = <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return errors.New("could not serve HTTP")
	case <-ctx.Done():
		end, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(end)
	}
}
