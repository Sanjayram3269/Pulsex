package main

import (
	"context"
	"github.com/Sanjayram3269/Pulsex/backend/internal/platform"
	"github.com/Sanjayram3269/Pulsex/backend/internal/realtime"
)

func main() {
	platform.Run(func(ctx context.Context, _ platform.Config, s *platform.Store) error {
		realtime.RunWorker(ctx, s)
		return nil
	})
}
