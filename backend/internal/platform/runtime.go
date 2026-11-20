package platform

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func Run(main func(context.Context, Config, *Store) error) {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := start(ctx, main); err != nil {
		slog.Error("startup or runtime failure", "error", err.Error())
		os.Exit(1)
	}
}
func start(ctx context.Context, main func(context.Context, Config, *Store) error) error {
	cfg, err := Load()
	if err != nil {
		return err
	}
	boot, cancel := context.WithTimeout(ctx, 24*time.Second)
	defer cancel()
	db, err := Connect(boot, cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	if err = db.Indexes(boot); err != nil {
		return err
	}
	return main(ctx, cfg, db)
}
