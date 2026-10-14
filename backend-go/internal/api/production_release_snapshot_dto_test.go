package api

import (
	"encoding/json"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1327 slice 3: the frozen bevel operation must carry its wedge payload
// through the wire DTO — a snapshot whose JSON drops the wedge would serve a
// door without its grip cut as valid frozen evidence.
func TestManufacturingSnapshotDTOCarriesBevelWedge(t *testing.T) {
	snapshot := &storage.ReleaseManufacturingSnapshot{
		SchemaVersion: 2,
		Routing: &engine.ReleaseRoutingProgram{
			Contract: engine.ReleaseRoutingProgramContract,
			Units: []engine.ReleaseRoutingUnit{{
				FurnitureInstanceID:   "fi-1",
				FurnitureDefinitionID: "def-1",
				MachiningFingerprint:  "fp-1",
				Parts: []engine.ReleaseRoutingPart{{
					PartID:      "puerta",
					Cut:         true,
					CncRequired: true,
					Operations: []engine.ReleaseRoutingOperation{{
						OperationID: "puerta:bevel-0",
						Provenance: engine.ResolvedMachiningProvenance{
							SourceKind:       "openingProfile",
							OpeningProfileID: "profile.gola-italiano.tira",
							Boundary:         "top",
						},
						Operation: engine.ReleaseRoutingOperationBevel,
						Holes:     []engine.ReleaseRoutingHole{},
						Bevel: &engine.ReleaseRoutingBevel{
							StartMm:  [3]float64{0, 2, 707},
							SizeMm:   [3]float64{596, 13, 13},
							AngleDeg: 45,
							Edge:     "top_front",
						},
					}},
				}},
			}},
		},
	}

	dto := toManufacturingSnapshotDTO(snapshot)
	wire, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("marshal DTO: %v", err)
	}
	var decoded struct {
		Routing struct {
			Units []struct {
				Parts []struct {
					PartId     string `json:"partId"`
					Operations []struct {
						OperationId string           `json:"operationId"`
						Operation   string           `json:"operation"`
						Bevel       *json.RawMessage `json:"bevel"`
					} `json:"operations"`
				} `json:"parts"`
			} `json:"units"`
		} `json:"routing"`
	}
	if err := json.Unmarshal(wire, &decoded); err != nil {
		t.Fatalf("unmarshal wire: %v", err)
	}
	if len(decoded.Routing.Units) != 1 || len(decoded.Routing.Units[0].Parts) != 1 || len(decoded.Routing.Units[0].Parts[0].Operations) != 1 {
		t.Fatalf("dto shape drifted: %s", wire)
	}
	op := decoded.Routing.Units[0].Parts[0].Operations[0]
	if op.Operation != "bevel" || op.Bevel == nil {
		t.Fatalf("bevel operation %s lost its wedge payload on the wire: %s", op.OperationId, op.Bevel)
	}
	var wedge struct {
		AngleDeg float64   `json:"angleDeg"`
		Edge     string    `json:"edge"`
		SizeMm   []float64 `json:"sizeMm"`
		StartMm  []float64 `json:"startMm"`
	}
	if err := json.Unmarshal(*op.Bevel, &wedge); err != nil {
		t.Fatalf("unmarshal wedge: %v", err)
	}
	if wedge.AngleDeg != 45 || wedge.Edge != "top_front" || len(wedge.SizeMm) != 3 || wedge.SizeMm[1] != 13 {
		t.Fatalf("wedge payload drifted: %+v", wedge)
	}
}
