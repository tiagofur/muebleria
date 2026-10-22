package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1369 slice 1 — POST /api/catalog/agregados/{id}/recipe-change/simulate: a
// dry-run that classifies the candidate recipe against the persisted one and
// never mutates. The stub store panics on any write, so a passing test IS the
// no-mutation proof.

func recipeSimStubAgregado() *domain.Agregado {
	kit := "kit-drawer"
	return &domain.Agregado{
		ID: "agr-sim", Code: "AGR-SIM", Name: "Cajón simulable", Active: true, Version: 3,
		WidthMm: 600, HeightMm: 200, DepthMm: 550,
		CommercialKitHardwareID: &kit,
		VariantSets: []domain.AgregadoVariantSet{{
			ID: "vs-depth", Dimension: "depth",
			Variants: []domain.ProductVariant{{NominalDimensionMm: 450, HardwareID: "runner-450"}, {NominalDimensionMm: 500, HardwareID: "runner-500"}},
		}},
		CompatibilityRules: []domain.AssemblyCompatibilityRule{{VariantSetID: "vs-depth", ClearanceMm: 20, SelectionStrategy: "max_fitting"}},
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "runner-left", Role: "guide_left",
				Source:    domain.RigidMemberSource{Kind: domain.RigidMemberSourceVariant, Variant: &domain.VariantHardwareSource{VariantSetID: "vs-depth"}},
				Placement: domain.AssemblyAnchorRule{X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin}, Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin}, Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin}},
				BOMRole:   domain.BOMRoleIncludedInKit,
			},
			{
				MemberID: "runner-right", Role: "guide_right",
				Source:    domain.RigidMemberSource{Kind: domain.RigidMemberSourceVariant, Variant: &domain.VariantHardwareSource{VariantSetID: "vs-depth"}},
				Placement: domain.AssemblyAnchorRule{X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax}, Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin}, Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin}},
				BOMRole:   domain.BOMRoleIncludedInKit,
			},
		},
	}
}

func recipeSimRequest(t *testing.T, srv *Server, role, body string) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle("POST /api/catalog/agregados/{id}/recipe-change/simulate", http.HandlerFunc(srv.HandleAgregadoRecipeSimulation))
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/agregados/agr-sim/recipe-change/simulate", strings.NewReader(body)), "eng", role)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	return rr
}

func candidateJSON(t *testing.T, mutate func(a *domain.Agregado)) string {
	t.Helper()
	a := recipeSimStubAgregado()
	mutate(a)
	raw, err := json.Marshal(map[string]any{"candidate": a})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(raw)
}

func TestRecipeSimulation_ClassifiesChangeAndNeverMutates(t *testing.T) {
	store := &stubStore{agregadoReturnedByID: recipeSimStubAgregado()}
	srv := &Server{Store: store}
	body := candidateJSON(t, func(a *domain.Agregado) {
		a.RigidMembers[1].Placement.X.OffsetMm = -10 // runner-right moves 10 mm inward
	})

	rr := recipeSimRequest(t, srv, string(domain.RoleIngeniero), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("ETag"); got != `"v3"` {
		t.Fatalf("ETag = %s, want \"v3\" (the If-Match the apply must carry)", got)
	}
	var res recipeChangeSimulationResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res.AgregadoID != "agr-sim" || res.CurrentVersion != 3 {
		t.Fatalf("identity/version = %s/%d", res.AgregadoID, res.CurrentVersion)
	}
	if res.Diff.State != engine.RecipeChangeValid || !res.Diff.CandidateResolved {
		t.Fatalf("diff state = %s resolved=%v", res.Diff.State, res.Diff.CandidateResolved)
	}
	var moved *engine.RecipeMemberChange
	for i := range res.Diff.Members {
		if res.Diff.Members[i].MemberID == "runner-right" {
			moved = &res.Diff.Members[i]
		}
	}
	if moved == nil || moved.Change != engine.ChangeMoved || moved.TranslationDeltaMm == nil || moved.TranslationDeltaMm[0] != -10 {
		t.Fatalf("runner-right row = %+v", moved)
	}
	// Dimensions default to the agregado's own external dims.
	if res.Diff.Params.WidthMm != 600 || res.Diff.Params.DepthMm != 550 || res.Diff.Params.HeightMm != 200 {
		t.Fatalf("params = %+v, want the agregado dims", res.Diff.Params)
	}

	// Idempotent: the same request yields the same bytes.
	again := recipeSimRequest(t, srv, string(domain.RoleIngeniero), body)
	if again.Body.String() != rr.Body.String() {
		t.Fatalf("second simulation differs:\n%s\n%s", rr.Body.String(), again.Body.String())
	}
}

func TestRecipeSimulation_RejectedVariantIsPartiallyInvalidWithAlternatives(t *testing.T) {
	store := &stubStore{agregadoReturnedByID: recipeSimStubAgregado()}
	srv := &Server{Store: store}
	// Depth 480: the current recipe selects 450 (480 - 20 clearance = 460);
	// the user explicitly asks for 500, which does not fit → rejected with the
	// single alternative the narrowed set offers, and nothing is clamped to 450.
	body := `{"candidate":` + strings.TrimSuffix(strings.TrimPrefix(candidateJSON(t, func(*domain.Agregado) {}), `{"candidate":`), `}`) +
		`,"params":{"widthMm":600,"depthMm":480,"heightMm":200},"variantSelections":{"vs-depth":500}}`

	rr := recipeSimRequest(t, srv, string(domain.RoleIngeniero), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	var res recipeChangeSimulationResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res.Diff.State != engine.RecipeChangePartiallyInvalid || res.Diff.CandidateResolved {
		t.Fatalf("state = %s resolved=%v", res.Diff.State, res.Diff.CandidateResolved)
	}
	if len(res.Diff.Variants) != 1 || res.Diff.Variants[0].Change != engine.ChangeVariantRejected || res.Diff.Variants[0].Rejection == nil {
		t.Fatalf("variants = %+v", res.Diff.Variants)
	}
	rej := res.Diff.Variants[0].Rejection
	if len(rej.AvailableNominals) != 1 || rej.AvailableNominals[0] != 500 || len(rej.FittingNominals) != 0 {
		t.Fatalf("rejection = %+v", rej)
	}
	if res.Diff.Variants[0].Before == nil || res.Diff.Variants[0].Before.NominalDimensionMm != 450 {
		t.Fatalf("the current selection (450) must travel with the rejection: %+v", res.Diff.Variants[0].Before)
	}
}

// La receta vigente vive en la revisión actual, no en la fila del catálogo:
// con revisión presente, la lectura combinada (#1369/#1393) entrega el
// agregado con LA RECETA DE LA REVISIÓN aplicada (no los campos inline de la
// fila) — exactamente lo que la DB real expuso. domain.ApplyRecipe es el
// mismo helper que usa la store real, así el stub no deriva una segunda
// hidratación.
func TestRecipeSimulation_UsesCurrentRevisionRecipe(t *testing.T) {
	kit := "kit-drawer"
	revRecipe := domain.AgregadoRecipePayload{
		CommercialKitHardwareID: &kit,
		RigidMembers: []domain.AgregadoRigidMember{{
			MemberID: "runner-solo",
			Role:     "guide_left",
			Source:   domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: "hw-runner-500"}},
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			},
			BOMRole: domain.BOMRoleIncludedInKit,
		}},
	}
	row := recipeSimStubAgregado()
	row.ApplyRecipe(revRecipe)
	store := &stubStore{agregadoReturnedByID: row}
	srv := &Server{Store: store}

	body := candidateJSON(t, func(*domain.Agregado) {})
	body = strings.TrimSuffix(body, "}") + `,"params":{"widthMm":600,"depthMm":550,"heightMm":200}}`
	rr := recipeSimRequest(t, srv, string(domain.RoleIngeniero), body)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	var res recipeChangeSimulationResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Current = receta de la revisión (runner-solo); candidata = los 2 del
	// stub ⇒ runner-solo sale (removed) y los otros entran (added). Si el
	// simulate usara los campos inline de la fila, runner-solo no existiría.
	removed := false
	for _, m := range res.Diff.Members {
		if m.MemberID == "runner-solo" && m.Change == engine.ChangeAdded {
			t.Fatalf("runner-solo vive en la revisión: no debe aparecer como añadido")
		}
		if m.Change == engine.ChangeRemoved && m.MemberID == "runner-solo" {
			removed = true
		}
	}
	if !removed {
		t.Fatalf("el diff no usa la receta de la revisión como current: %+v", res.Diff.Members)
	}
	// La identidad y la versión viajan de la fila, nunca de la receta.
	if res.AgregadoID != "agr-sim" || res.CurrentVersion != 3 {
		t.Fatalf("identity/version = %s/%d, want agr-sim/3", res.AgregadoID, res.CurrentVersion)
	}
}

func TestRecipeSimulation_ErrorsAreExplicit(t *testing.T) {
	t.Run("404 when the agregado does not exist", func(t *testing.T) {
		store := &stubStore{agregadoGetByIDErr: storage.ErrAgregadoNotFound}
		rr := recipeSimRequest(t, &Server{Store: store}, string(domain.RoleIngeniero), candidateJSON(t, func(*domain.Agregado) {}))
		if rr.Code != http.StatusNotFound {
			t.Fatalf("status = %d", rr.Code)
		}
	})
	t.Run("500 when the store fails for another reason — never disguised as 404", func(t *testing.T) {
		store := &stubStore{agregadoGetByIDErr: errors.New("connection reset by peer")}
		rr := recipeSimRequest(t, &Server{Store: store}, string(domain.RoleIngeniero), candidateJSON(t, func(*domain.Agregado) {}))
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
	})
	t.Run("403 for a role that cannot mutate the catalog", func(t *testing.T) {
		store := &stubStore{agregadoReturnedByID: recipeSimStubAgregado()}
		rr := recipeSimRequest(t, &Server{Store: store}, string(domain.RoleVendedor), candidateJSON(t, func(*domain.Agregado) {}))
		if rr.Code != http.StatusForbidden {
			t.Fatalf("status = %d", rr.Code)
		}
	})
	t.Run("422 when the agregado has no dims and none are given", func(t *testing.T) {
		a := recipeSimStubAgregado()
		a.WidthMm, a.HeightMm, a.DepthMm = 0, 0, 0
		store := &stubStore{agregadoReturnedByID: a}
		rr := recipeSimRequest(t, &Server{Store: store}, string(domain.RoleIngeniero), candidateJSON(t, func(*domain.Agregado) {}))
		if rr.Code != http.StatusUnprocessableEntity || !strings.Contains(rr.Body.String(), "RECIPE_SIMULATION_DIMENSIONS_REQUIRED") {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
	})
	t.Run("422 when a variant selection names an unknown set", func(t *testing.T) {
		store := &stubStore{agregadoReturnedByID: recipeSimStubAgregado()}
		body := `{"candidate":` + strings.TrimSuffix(strings.TrimPrefix(candidateJSON(t, func(*domain.Agregado) {}), `{"candidate":`), `}`) +
			`,"variantSelections":{"vs-ghost":500}}`
		rr := recipeSimRequest(t, &Server{Store: store}, string(domain.RoleIngeniero), body)
		if rr.Code != http.StatusUnprocessableEntity || !strings.Contains(rr.Body.String(), "RECIPE_CANDIDATE_INVALID") {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
	})
	t.Run("422 when the candidate definition is invalid", func(t *testing.T) {
		store := &stubStore{agregadoReturnedByID: recipeSimStubAgregado()}
		rr := recipeSimRequest(t, &Server{Store: store}, string(domain.RoleIngeniero), candidateJSON(t, func(a *domain.Agregado) {
			a.RigidMembers[0].Source.Variant.VariantSetID = "vs-ghost"
		}))
		if rr.Code != http.StatusUnprocessableEntity || !strings.Contains(rr.Body.String(), "RECIPE_CANDIDATE_INVALID") {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
	})
	t.Run("identity is never taken from the body", func(t *testing.T) {
		store := &stubStore{agregadoReturnedByID: recipeSimStubAgregado()}
		rr := recipeSimRequest(t, &Server{Store: store}, string(domain.RoleIngeniero), candidateJSON(t, func(a *domain.Agregado) {
			a.ID = "someone-elses-agregado"
		}))
		if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"agregadoId":"agr-sim"`) {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
	})
}
