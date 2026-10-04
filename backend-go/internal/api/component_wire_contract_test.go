package api

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// R3 parity (#1063): contracts/componentWire.contract.json is the server READ
// wire for a fully-populated Component — the exact JSON Go emits for
// domain.Component, including the #1052 construction block and omitempty
// behavior (absent rotate_y/rotate_z, no empty strings). The TS side
// (packages/storage/src/componentWireContract.test.ts) pins componentFromApi/
// componentToApi against the same file. This test proves the fixture never
// drifts from the Go wire. Runs without a database (same tier as
// model_binding_contract_test.go).
const componentWireFixturePath = "../../../contracts/componentWire.contract.json"

func componentWireFixture(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile(componentWireFixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return raw
}

func TestComponentWireContractFixtureMatchesGoWire(t *testing.T) {
	raw := componentWireFixture(t)
	var c domain.Component
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("unmarshal fixture into domain.Component: %v", err)
	}
	if c.Placement != "lateral_izquierdo" {
		t.Fatalf("fixture placement drifted: %q", c.Placement)
	}
	if c.Construction == nil || c.Construction.JoinerySystemID != "screw-only" {
		t.Fatalf("fixture must carry the #1052 construction block, got %+v", c.Construction)
	}
	out, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("marshal round-trip: %v", err)
	}
	var fixtureAny, outAny any
	if err := json.Unmarshal(raw, &fixtureAny); err != nil {
		t.Fatalf("re-parse fixture: %v", err)
	}
	if err := json.Unmarshal(out, &outAny); err != nil {
		t.Fatalf("re-parse marshalled wire: %v", err)
	}
	if !reflect.DeepEqual(fixtureAny, outAny) {
		t.Fatalf("fixture diverges from the Go wire round-trip\nfixture:   %s\nmarshalled: %s", raw, out)
	}
}

// The write wire the TS client emits (componentToApi) uses explicit nulls and
// empty strings instead of omitempty and carries no timestamps; the handler
// must decode it into the same domain shape (null rotations decode as 0).
func TestComponentWireContractDecodesTsWriteWire(t *testing.T) {
	write := []byte(`{
		"id": "wire-comp-001",
		"code": "COM-WIRE-001",
		"name": "Lateral de prueba",
		"placement": "lateral_izquierdo",
		"geometry_kind": "rectangular_board",
		"length_mm": 720,
		"width_mm": 560,
		"thickness_mm": 18,
		"length_formula": "PH",
		"width_formula": "PD",
		"x_formula": "0",
		"y_formula": "0",
		"z_formula": "0",
		"rotate_x": 90,
		"rotate_y": null,
		"rotate_z": null,
		"default_edges": [
			{ "side": "L1", "enabled": true },
			{ "side": "W1", "enabled": false }
		],
		"option_roles": ["INTERIOR", "LATERAL"],
		"construction": {
			"constructive_role": "lateral",
			"connection_faces": ["left", "right"],
			"joinery_system_id": "screw-only"
		},
		"notes": "Lateral estándar del wire contract",
		"active": true
	}`)
	var c domain.Component
	if err := json.Unmarshal(write, &c); err != nil {
		t.Fatalf("decode TS write wire: %v", err)
	}
	if c.ID != "wire-comp-001" || c.Code != "COM-WIRE-001" {
		t.Fatalf("identity drifted: %q/%q", c.ID, c.Code)
	}
	if c.Placement != "lateral_izquierdo" || c.RotateX != 90 || c.RotateY != 0 || c.RotateZ != 0 {
		t.Fatalf("placement/rotation drifted: %+v", c)
	}
	if c.Construction == nil || c.Construction.ConstructiveRole != "lateral" ||
		len(c.Construction.ConnectionFaces) != 2 || c.Construction.JoinerySystemID != "screw-only" {
		t.Fatalf("construction block drifted: %+v", c.Construction)
	}
	if len(c.DefaultEdges) != 2 || !c.DefaultEdges[0].Enabled || c.DefaultEdges[1].Enabled {
		t.Fatalf("default edges drifted: %+v", c.DefaultEdges)
	}
	if !c.Active || c.Notes == "" || c.LengthFormula != "PH" {
		t.Fatalf("scalar fields drifted: active=%v notes=%q formula=%q", c.Active, c.Notes, c.LengthFormula)
	}
}
