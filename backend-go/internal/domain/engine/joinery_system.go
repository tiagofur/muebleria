package engine

import (
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1052 slice 2 / #1219 — the component's construction block joins the
// joinery-system ladder. Until now the effective system was authored intent
// (the relationship's joinerySystemId) falling straight to the kind default:
// the slice-1 data (Component.Construction) and the factory family systemId
// were declared but unconsumed. The ladder, one rung per authority:
//
//	relationship explicit > source component > factory family rule > kind default
//
// Empty rungs inherit. A resolved system the active catalog does not know
// fails closed at the machining layer (JOINERY_SYSTEM_UNSUPPORTED) — the
// ladder never guesses.

// EffectiveJoinerySystem is the pure precedence ladder, shared with the TS
// mirror through contracts/joinerySystemResolution.contract.json (one
// authority for the rung order on both stacks).
func EffectiveJoinerySystem(relationshipSystemID, componentSystemID, factorySystemID, kindDefault string) string {
	if id := strings.TrimSpace(relationshipSystemID); id != "" {
		return id
	}
	if id := strings.TrimSpace(componentSystemID); id != "" {
		return id
	}
	if id := strings.TrimSpace(factorySystemID); id != "" {
		return id
	}
	return kindDefault
}

// joinerySystemLadderInput carries the rung lookups the machining layer
// already has in hand when it resolves a relationship's system.
type joinerySystemLadderInput struct {
	boardIndex     map[string]*layoutBoard
	componentsByID map[string]*domain.Component
	policy         *FactoryConstructionPolicy
	kindDefaults   map[string]string
}

// resolveJoinerySystem walks the ladder for one relationship. The factory
// rung lights up for kinds with a factory family (floor-side, fixed-shelf-side,
// back-panel); kinds without one (v1 shelf-support) run
// explicit > component > kind default — the family surface arrives when the
// panel derivations branch by system.
func resolveJoinerySystem(relationship AuthoringRelationship, in joinerySystemLadderInput) string {
	componentSystemID := ""
	if source := in.boardIndex[relationship.Source.ComponentInstanceID]; source != nil {
		if comp := in.componentsByID[source.catalogComponentID]; comp != nil && comp.Construction != nil {
			componentSystemID = comp.Construction.JoinerySystemID
		}
	}
	factorySystemID := ""
	if rule := in.policy.RuleForKind(relationship.Kind); rule != nil {
		factorySystemID = rule.SystemId
	}
	return EffectiveJoinerySystem(
		relationship.JoinerySystemID,
		componentSystemID,
		factorySystemID,
		in.kindDefaults[relationship.Kind],
	)
}

// connectionFaceViolation reports the first anchor whose face falls outside
// its component's DECLARED connection faces (#1219): the component's
// construction block is a physical capacity declaration. An empty declaration
// is compatible with everything (legacy components keep working); an anchor
// without a face cannot violate a capacity it does not name. The returned
// anchor role + face describe the violation for the workshop-facing issue.
func connectionFaceViolation(relationship AuthoringRelationship, in joinerySystemLadderInput) (string, string, bool) {
	anchors := make([]AuthoringRelationshipAnchor, 0, len(relationship.Targets)+1)
	anchors = append(anchors, relationship.Source)
	anchors = append(anchors, relationship.Targets...)
	for _, anchor := range anchors {
		if strings.TrimSpace(anchor.Face) == "" {
			continue
		}
		board := in.boardIndex[anchor.ComponentInstanceID]
		if board == nil {
			continue
		}
		comp := in.componentsByID[board.catalogComponentID]
		if comp == nil || comp.Construction == nil {
			continue
		}
		declared := comp.Construction.ConnectionFaces
		if len(declared) == 0 {
			continue
		}
		allowed := make(map[string]bool, len(declared))
		for _, face := range declared {
			allowed[strings.TrimSpace(face)] = true
		}
		if !allowed[strings.TrimSpace(anchor.Face)] {
			return anchor.Role, anchor.Face, true
		}
	}
	return "", "", false
}
