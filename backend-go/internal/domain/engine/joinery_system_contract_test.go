package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1052 slice 2 / #1219 — the shared TS↔Go parity contract for the joinery
// system ladder (relationship explicit > source component > factory family >
// kind default) and the declared connection faces gate. One authority, both
// stacks: contracts/joinerySystemResolution.contract.json.
func TestJoinerySystemResolutionContract(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "contracts", "joinerySystemResolution.contract.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Schema        int `json:"schema"`
		LadderCases   []struct {
			Name                  string `json:"name"`
			RelationshipSystemID  string `json:"relationshipSystemId"`
			ComponentSystemID     string `json:"componentSystemId"`
			FactorySystemID       string `json:"factorySystemId"`
			KindDefault           string `json:"kindDefault"`
			Expected              string `json:"expected"`
		} `json:"ladderCases"`
		FaceGateCases []struct {
			Name              string   `json:"name"`
			DeclaredFaces     []string `json:"declaredFaces"`
			AnchorFace        string   `json:"anchorFace"`
			ExpectedViolation bool     `json:"expectedViolation"`
		} `json:"faceGateCases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if fixture.Schema != 1 {
		t.Fatalf("fixture schema = %d, want 1", fixture.Schema)
	}

	for _, tc := range fixture.LadderCases {
		if got := EffectiveJoinerySystem(tc.RelationshipSystemID, tc.ComponentSystemID, tc.FactorySystemID, tc.KindDefault); got != tc.Expected {
			t.Fatalf("%s: EffectiveJoinerySystem = %q, want %q", tc.Name, got, tc.Expected)
		}
	}

	for _, tc := range fixture.FaceGateCases {
		// The Go gate reads the capacity off the component's construction
		// block through the board index — exercise the same lookup shape.
		board := layoutBoard{id: "b1", catalogComponentID: "comp-1"}
		in := joinerySystemLadderInput{
			boardIndex:     map[string]*layoutBoard{"b1": &board},
			componentsByID: map[string]*domain.Component{
				"comp-1": {ID: "comp-1", Construction: &domain.ComponentConstruction{ConnectionFaces: tc.DeclaredFaces}},
			},
		}
		relationship := AuthoringRelationship{
			RelationshipID: "r1",
			Source:         AuthoringRelationshipAnchor{ComponentInstanceID: "b1", Face: tc.AnchorFace},
		}
		_, _, violated := connectionFaceViolation(relationship, in)
		if violated != tc.ExpectedViolation {
			t.Fatalf("%s: connectionFaceViolation = %v, want %v", tc.Name, violated, tc.ExpectedViolation)
		}
	}
}
