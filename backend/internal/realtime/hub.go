package realtime

import (
	"context"
	"github.com/redis/go-redis/v9"
	"strings"
	"sync"
)

type Hub struct {
	mu     sync.Mutex
	groups map[string]map[chan struct{}]struct{}
}

func NewHub() *Hub { return &Hub{groups: make(map[string]map[chan struct{}]struct{})} }
func (h *Hub) Watch(topic string) (<-chan struct{}, func()) {
	h.mu.Lock()
	if h.groups[topic] == nil {
		h.groups[topic] = make(map[chan struct{}]struct{})
	}
	ch := make(chan struct{}, 1)
	h.groups[topic][ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.groups[topic], ch)
		if len(h.groups[topic]) == 0 {
			delete(h.groups, topic)
		}
	}
}
func (h *Hub) Run(ctx context.Context, r *redis.Client) {
	sub := r.Subscribe(ctx, Channel)
	defer sub.Close()
	messages := sub.ChannelWithSubscriptions()
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-messages:
			if !ok {
				return
			}
			h.mu.Lock()
			switch v := event.(type) {
			case *redis.Message:
				topic, _, _ := strings.Cut(v.Payload, "|")
				h.signal(h.groups[topic])
			case *redis.Subscription:
				for _, g := range h.groups {
					h.signal(g)
				}
			}
			h.mu.Unlock()
		}
	}
}
func (h *Hub) signal(g map[chan struct{}]struct{}) {
	for ch := range g {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}
