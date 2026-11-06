package engine

// #1529 — Go side of the shared v2 fixture
// (contracts/openingFrontEdgeStack.contract.json); the TS twin is
// packages/domain/src/openingEdgeStack.contract.test.ts.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type edgeStackFixture struct {
	Contract        string `json:"contract"`
	ResolutionCases []struct {
		Name     string                     `json:"name"`
		Input    OpeningEdgeStackInput      `json:"input"`
		Expected OpeningEdgeStackResolution `json:"expected"`
	} `json:"resolutionCases"`
	InvalidCases []struct {
		Name              string                `json:"name"`
		Input             OpeningEdgeStackInput `json:"input"`
		ExpectedErrorCode string                `json:"expectedErrorCode"`
	} `json:"invalidCases"`
}

func loadEdgeStackFixture(t *testing.T) edgeStackFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "openingFrontEdgeStack.contract.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture edgeStackFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestOpeningEdgeStackContract(t *testing.T) {
	fixture := loadEdgeStackFixture(t)
	if fixture.Contract != OpeningFrontContractV2 {
		t.Fatalf("contract %q, want %q", fixture.Contract, OpeningFrontContractV2)
	}
	if len(fixture.ResolutionCases) < 7 {
		t.Fatalf("the datasheet fixtures are missing: %d cases", len(fixture.ResolutionCases))
	}
	for _, tc := range fixture.ResolutionCases {
		t.Run(tc.Name, func(t *testing.T) {
			got, err := ResolveOpeningEdgeStack(tc.Input)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.TopEdgeMm != tc.Expected.TopEdgeMm || got.BottomEdgeMm != tc.Expected.BottomEdgeMm ||
				got.RemainderRow != tc.Expected.RemainderRow || len(got.Rows) != len(tc.Expected.Rows) {
				t.Fatalf("got %+v, want %+v", got, tc.Expected)
			}
			for i := range got.Rows {
				if got.Rows[i] != tc.Expected.Rows[i] {
					t.Fatalf("row %d: got %+v, want %+v", i, got.Rows[i], tc.Expected.Rows[i])
				}
			}
		})
	}
	for _, tc := range fixture.InvalidCases {
		t.Run(tc.Name, func(t *testing.T) {
			_, err := ResolveOpeningEdgeStack(tc.Input)
			if err == nil || err.Code != tc.ExpectedErrorCode {
				t.Fatalf("got %v, want %s", err, tc.ExpectedErrorCode)
			}
		})
	}
}
