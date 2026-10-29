package domain

import (
	"fmt"
	"strings"
)

// HardwareDesignPart (#1417): one internal part of a hardware's pinned SKP
// design, declared by SketchUp component name. Parts exist to declare
// per-part presentation facts: actorMembership (#1376 vocabulary — 'body'
// stays with the furniture, 'actor:<id>' follows the actor) and an optional
// finishKey into the hardware's part_finishes (F080/#1209).
//
// Contract boundary: the server cannot enumerate component names inside a
// binary SKP, so validation here covers FORMAT only. The SketchUp host
// validates declared names against the actual SKP at sync time and fails
// explicitly — never silently.
type HardwareDesignPart struct {
	ComponentName   string `json:"componentName"`
	ActorMembership string `json:"actorMembership"`
	Label           string `json:"label,omitempty"`
	FinishKey       string `json:"finishKey,omitempty"`
}

// IsValidActorMembership reports whether m is 'body' or 'actor:<id>' (#1376).
// Shares the pattern declared in agregado_assembly.go (same #1376 vocabulary).
func IsValidActorMembership(m string) bool {
	return m == "body" || actorMembershipPattern.MatchString(m)
}

// ValidateHardwareDesignParts validates the format of declared design parts.
// nil passes (monolithic hardware, legacy behavior).
func ValidateHardwareDesignParts(parts []HardwareDesignPart) error {
	seen := make(map[string]struct{}, len(parts))
	for i, p := range parts {
		if strings.TrimSpace(p.ComponentName) == "" {
			return fmt.Errorf("design part %d requires a non-empty componentName", i)
		}
		if _, dup := seen[p.ComponentName]; dup {
			return fmt.Errorf("design part '%s' is declared more than once", p.ComponentName)
		}
		seen[p.ComponentName] = struct{}{}
		if !IsValidActorMembership(p.ActorMembership) {
			return fmt.Errorf(
				"design part '%s': invalid actorMembership '%s' (expected 'body' or 'actor:<id>')",
				p.ComponentName, p.ActorMembership)
		}
		if p.FinishKey != "" && strings.TrimSpace(p.FinishKey) == "" {
			return fmt.Errorf("design part '%s': finishKey must be non-empty when present", p.ComponentName)
		}
		if p.Label != "" && strings.TrimSpace(p.Label) == "" {
			return fmt.Errorf("design part '%s': label must be non-empty when present", p.ComponentName)
		}
	}
	return nil
}
