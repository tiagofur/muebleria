package domain

import (
	"errors"
	"time"
)

// #740 PR 1: durable Engineering state bound to the EXACT ProductionRelease.
//
// Engineering completion is its own authority: a ProductionRelease authorizes
// technical content, Engineering completion records that the preparation of
// THAT release finished, and neither implies material authorization or the
// start of physical work. The evidence is server-authored only (commands),
// one row per release — an absent row means the release's engineering is
// still pending. The legacy projects.engineering_log JSONB (project-global,
// client-authored) is never interpreted as completion of a specific release.

// ReleaseEngineeringStatus is the durable per-release engineering phase.
// "pending" is not stored: it is the absent row.
type ReleaseEngineeringStatus string

const (
	ReleaseEngineeringInProgress ReleaseEngineeringStatus = "in_progress"
	ReleaseEngineeringCompleted  ReleaseEngineeringStatus = "completed"
)

var (
	// ErrEngineeringNotStarted: completion requires the release's engineering
	// to have started first.
	ErrEngineeringNotStarted = errors.New("release engineering has not started")
	// ErrEngineeringRoutingUnavailable: the minimal objective preparation
	// evidence — the release's frozen schema-v2 routing program — is missing,
	// so engineering cannot honestly complete for that release.
	ErrEngineeringRoutingUnavailable = errors.New("release engineering preparation evidence unavailable")
)

// ReleaseEngineeringState is the durable evidence row for one release.
// Version drives optimistic concurrency for the completion command.
type ReleaseEngineeringState struct {
	ReleaseID   string                   `json:"release_id"`
	Status      ReleaseEngineeringStatus `json:"status"`
	StartedBy   string                   `json:"started_by"`
	StartedAt   time.Time                `json:"started_at"`
	CompletedBy *string                  `json:"completed_by,omitempty"`
	CompletedAt *time.Time               `json:"completed_at,omitempty"`
	Version     int                      `json:"version"`
}
