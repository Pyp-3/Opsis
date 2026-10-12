package generation

import (
	"context"
	"encoding/json"
	"os"
	"sync"
	"time"
)

// LimitProviders are the CLIs whose subscription limits can be read without a model call.
var LimitProviders = []string{"claude", "codex"}

// LimitCheckInterval keeps checks to one per provider per minute, however many views ask.
const LimitCheckInterval = time.Minute

var limitProblems = map[string]string{
	"missing": "The CLI is not installed here, or its version is not supported.",
	"none":    "The CLI reported no subscription limits. An API key may power it.",
	"failed":  "Could not read the limits. Check the CLI’s login on this host.",
	"off":     "Limit checks are turned off on this host.",
}

type limitEntry struct {
	limits  json.RawMessage
	problem string
	freshAt time.Time
	pending chan struct{}
}

// Limits mirrors the browser API's tracker (apps/api/src/provider-limits.ts): the latest report
// per provider in memory, merged by the shared rule, with one check at a time per provider.
type Limits struct {
	engine *Engine
	// observing orders reports from requests, so a later one is never merged under an earlier.
	observing sync.Mutex
	mu        sync.Mutex
	entries   map[string]*limitEntry
	now       func() time.Time
}

func NewLimits(engine *Engine) *Limits {
	return &Limits{engine: engine, entries: map[string]*limitEntry{}, now: time.Now}
}

func (l *Limits) entry(provider string) *limitEntry {
	entry := l.entries[provider]
	if entry == nil {
		entry = &limitEntry{}
		l.entries[provider] = entry
	}
	return entry
}

func (l *Limits) merge(ctx context.Context, previous, next json.RawMessage) (json.RawMessage, error) {
	return l.engine.execute(ctx, "mergeLimits", []string{string(previous), string(next)}, nil)
}

// Observe records limits a provider reported during a request (a `limits` progress event).
func (l *Limits) Observe(ctx context.Context, report json.RawMessage) {
	var shape struct {
		Provider string `json:"provider"`
	}
	if json.Unmarshal(report, &shape) != nil || !isLimitProvider(shape.Provider) {
		return
	}
	l.observing.Lock()
	defer l.observing.Unlock()
	l.mu.Lock()
	previous := l.entry(shape.Provider).limits
	l.mu.Unlock()
	merged, err := l.merge(ctx, previous, report)
	if err != nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.entry(shape.Provider)
	entry.limits, entry.problem, entry.freshAt = merged, "", l.now()
}

// Refresh checks each provider whose report is older than the interval and waits for them.
func (l *Limits) Refresh(ctx context.Context, providers []string) {
	var wait []chan struct{}
	for _, provider := range providers {
		if !isLimitProvider(provider) {
			continue
		}
		l.mu.Lock()
		entry := l.entry(provider)
		if entry.pending != nil {
			wait = append(wait, entry.pending)
			l.mu.Unlock()
			continue
		}
		if l.now().Sub(entry.freshAt) < LimitCheckInterval {
			l.mu.Unlock()
			continue
		}
		done := make(chan struct{})
		entry.pending, entry.freshAt = done, l.now()
		previous := entry.limits
		l.mu.Unlock()
		wait = append(wait, done)
		go func() {
			// A check outlives the request that started it, so others asking can share it.
			check, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			defer cancel()
			limits, problem := l.check(check, provider, previous)
			l.mu.Lock()
			if limits != nil {
				entry.limits = limits
			}
			entry.problem, entry.pending = problem, nil
			l.mu.Unlock()
			close(done)
		}()
	}
	for _, done := range wait {
		select {
		case <-done:
		case <-ctx.Done():
			return
		}
	}
}

func (l *Limits) check(ctx context.Context, provider string, previous json.RawMessage) (json.RawMessage, string) {
	// Checks use the host's real CLI logins; test runs turn them off.
	if os.Getenv("OPSIS_LIMIT_CHECKS") == "off" {
		return nil, limitProblems["off"]
	}
	raw, err := l.engine.execute(ctx, "checkLimits", []string{provider}, nil)
	if err != nil {
		return nil, limitProblems["failed"]
	}
	var outcome struct {
		Limits json.RawMessage `json:"limits"`
		Error  string          `json:"error"`
	}
	if json.Unmarshal(raw, &outcome) != nil {
		return nil, limitProblems["failed"]
	}
	switch {
	case outcome.Error == "harness_missing" || outcome.Error == "harness_config":
		return nil, limitProblems["missing"]
	case outcome.Error != "":
		return nil, limitProblems["failed"]
	case len(outcome.Limits) == 0 || string(outcome.Limits) == "null":
		return nil, limitProblems["none"]
	}
	merged, err := l.merge(ctx, previous, outcome.Limits)
	if err != nil {
		return nil, limitProblems["failed"]
	}
	return merged, ""
}

// Snapshot is the `GET /v1/providers/limits` response.
func (l *Limits) Snapshot() map[string]any {
	l.mu.Lock()
	defer l.mu.Unlock()
	providers := make([]map[string]any, 0, len(LimitProviders))
	for _, provider := range LimitProviders {
		entry := l.entry(provider)
		var limits any
		if len(entry.limits) > 0 {
			limits = entry.limits
		}
		var problem any
		if entry.problem != "" {
			problem = entry.problem
		}
		providers = append(providers, map[string]any{
			"provider": provider,
			"limits":   limits,
			"problem":  problem,
			"checking": entry.pending != nil,
		})
	}
	return map[string]any{"providers": providers}
}

func isLimitProvider(provider string) bool {
	for _, known := range LimitProviders {
		if provider == known {
			return true
		}
	}
	return false
}
