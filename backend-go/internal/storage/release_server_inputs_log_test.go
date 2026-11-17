package storage

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// #1645: pinned-profile load failures are classified so a manifest-less
// release does not flood the log, a client abort is not an error, and every
// other failure keeps logging at ERROR.
func TestLogPinnedProfileLoadFailureClassification(t *testing.T) {
	var logs strings.Builder
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })

	release := uuid.New()
	manifestMissing := fmt.Errorf("release %s has no manifest; it is not a published release: %w", release, ErrManifestNotFound)

	for i := 0; i < 3; i++ {
		logPinnedProfileLoadFailure(context.Background(), release, manifestMissing)
	}
	if got := strings.Count(logs.String(), "release has no manifest"); got != 1 {
		t.Fatalf("manifest-missing warnings = %d, want exactly 1:\n%s", got, logs.String())
	}
	if strings.Contains(logs.String(), "level=ERROR") {
		t.Fatalf("manifest-missing logged at ERROR:\n%s", logs.String())
	}

	logs.Reset()
	other := uuid.New()
	logPinnedProfileLoadFailure(context.Background(), other, manifestMissing)
	if !strings.Contains(logs.String(), "level=WARN") {
		t.Fatalf("a different manifest-less release must warn once on its own:\n%s", logs.String())
	}

	logs.Reset()
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	logPinnedProfileLoadFailure(canceled, uuid.New(), errors.New("get resource blob: context canceled"))
	if !strings.Contains(logs.String(), "level=INFO") || strings.Contains(logs.String(), "level=ERROR") {
		t.Fatalf("client cancellation must log at INFO only:\n%s", logs.String())
	}

	logs.Reset()
	for i := 0; i < 2; i++ {
		logPinnedProfileLoadFailure(context.Background(), release, errors.New("decode release manifest: unexpected EOF"))
	}
	if got := strings.Count(logs.String(), "level=ERROR"); got != 2 {
		t.Fatalf("real failures must keep logging at ERROR every time, got %d:\n%s", got, logs.String())
	}
}
