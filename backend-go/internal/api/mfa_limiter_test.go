package api

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestMFAAttemptLimiter_SuccessAndNonAuthFailuresDoNotConsumeBudget(t *testing.T) {
	limiter := newUserRateLimiter(time.Hour, 5)

	for i := 0; i < 12; i++ {
		complete, ok := limiter.reserve("step-up:user")
		if !ok {
			t.Fatalf("successful attempt %d was rate limited", i)
		}
		complete(nil)
	}
	for i := 0; i < 12; i++ {
		complete, ok := limiter.reserve("step-up:user")
		if !ok {
			t.Fatalf("non-auth failure %d was rate limited", i)
		}
		complete(errors.New("database unavailable"))
	}
}

func TestMFAAttemptLimiter_ConcurrentInvalidAttemptsAdmitOnlyBurst(t *testing.T) {
	limiter := newUserRateLimiter(time.Hour, 5)
	start := make(chan struct{})
	release := make(chan struct{})
	var wg sync.WaitGroup
	var attempted sync.WaitGroup
	attempted.Add(20)
	admitted := make(chan struct{}, 20)
	rejected := make(chan struct{}, 20)

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			complete, ok := limiter.reserve("step-up:user")
			attempted.Done()
			if !ok {
				rejected <- struct{}{}
				return
			}
			admitted <- struct{}{}
			<-release
			complete(storage.ErrMFAInvalidCode)
		}()
	}
	close(start)
	attempted.Wait()
	if got := len(admitted); got != 5 {
		t.Fatalf("verification reaches = %d, want 5", got)
	}
	if got := len(rejected); got != 15 {
		t.Fatalf("rejected = %d, want 15", got)
	}
	close(release)
	wg.Wait()
	if _, ok := limiter.reserve("step-up:user"); ok {
		t.Fatal("five completed invalid attempts must consume the whole failure budget")
	}
}

func TestMFAAttemptLimiter_SuccessReleasesInFlightCapacity(t *testing.T) {
	limiter := newUserRateLimiter(time.Hour, 5)
	completions := make([]func(error), 0, 5)
	for i := 0; i < 5; i++ {
		complete, ok := limiter.reserve("step-up:user")
		if !ok {
			t.Fatalf("reservation %d rejected", i)
		}
		completions = append(completions, complete)
	}
	if _, ok := limiter.reserve("step-up:user"); ok {
		t.Fatal("sixth simultaneous attempt was admitted")
	}
	completions[0](nil)
	if complete, ok := limiter.reserve("step-up:user"); !ok {
		t.Fatal("successful completion did not release in-flight capacity")
	} else {
		complete(nil)
	}
	for _, complete := range completions[1:] {
		complete(nil)
	}
}

func TestMFAAttemptLimiter_InvalidAndMixedCompletionAccounting(t *testing.T) {
	limiter := newUserRateLimiter(time.Hour, 5)
	invalid, ok := limiter.reserve("step-up:user")
	if !ok {
		t.Fatal("invalid attempt was rejected")
	}
	success, ok := limiter.reserve("step-up:user")
	if !ok {
		t.Fatal("success attempt was rejected")
	}
	nonAuth, ok := limiter.reserve("step-up:user")
	if !ok {
		t.Fatal("non-auth attempt was rejected")
	}
	invalid(storage.ErrMFAInvalidCode)
	success(nil)
	nonAuth(errors.New("store unavailable"))

	for i := 0; i < 4; i++ {
		complete, ok := limiter.reserve("step-up:user")
		if !ok {
			t.Fatalf("invalid attempt %d rejected before budget exhausted", i)
		}
		complete(storage.ErrMFARecoveryInvalid)
	}
	if _, ok := limiter.reserve("step-up:user"); ok {
		t.Fatal("five invalid completions must exhaust budget regardless of mixed completions")
	}
}

func TestMFAAttemptLimiter_RefillsWithoutSleeping(t *testing.T) {
	now := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	limiter := newUserRateLimiter(time.Second, 2)
	limiter.now = func() time.Time { return now }

	for i := 0; i < 2; i++ {
		complete, ok := limiter.reserve("step-up:user")
		if !ok {
			t.Fatalf("attempt %d rejected", i)
		}
		complete(storage.ErrMFAInvalidCode)
	}
	if _, ok := limiter.reserve("step-up:user"); ok {
		t.Fatal("budget should be exhausted before refill")
	}
	now = now.Add(time.Second)
	complete, ok := limiter.reserve("step-up:user")
	if !ok {
		t.Fatal("one elapsed refill interval should admit one attempt")
	}
	complete(storage.ErrMFAInvalidCode)
}

func TestMFAAttemptLimiter_EvictionKeepsInFlightBucket(t *testing.T) {
	now := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	limiter := newUserRateLimiter(time.Hour, 5)
	limiter.now = func() time.Time { return now }

	complete, ok := limiter.reserve("in-flight")
	if !ok {
		t.Fatal("in-flight attempt rejected")
	}
	now = now.Add(11 * time.Minute)
	for i := 0; i < 1025; i++ {
		key := fmt.Sprintf("stale-%d", i)
		limiter.limiters[key] = &mfaAttemptBucket{lastSeen: now.Add(-11 * time.Minute)}
	}
	if _, ok := limiter.reserve("fresh"); !ok {
		t.Fatal("fresh attempt rejected")
	}
	if bucket, exists := limiter.limiters["in-flight"]; !exists || bucket.inFlight != 1 {
		t.Fatal("eviction removed an in-flight MFA attempt")
	}
	complete(nil)
}
