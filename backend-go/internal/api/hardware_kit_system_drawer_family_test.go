package api

// #1633 slice 1 — familia de cajón en los endpoints del sistema: la etiqueta
// de altura y el marcador drawer_system se persisten (alta y «Añadir altura»),
// y una etiqueta repetida — contra la letra efectiva de las alturas previas —
// es un 422 tipado, nunca una segunda «M».

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestKitSystemHeightPlan_CarriesTrimmedLabel_1633(t *testing.T) {
	body := strings.Replace(heightPayload("LBL-C", 70, 177, false, ""),
		`"variant":{"nominalDimensionMm":177,`, `"variant":{"label":"  C ","nominalDimensionMm":177,`, 1)
	var req openapi.HardwareKitSystemHeightAddRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		t.Fatalf("decode: %v", err)
	}
	plan, err := kitSystemHeightPlanFromRequest(&req)
	if err != nil {
		t.Fatalf("valid plan rejected: %v", err)
	}
	if plan.variant.Label != "C" {
		t.Fatalf("plan label = %q, want trimmed «C»", plan.variant.Label)
	}
}

func TestAddHeightVariant_RejectsEffectiveLabelDuplicate_1633(t *testing.T) {
	legacy := domain.Agregado{ID: "agr", HeightMm: 108, VariantSets: []domain.AgregadoVariantSet{{
		ID: "vs", Dimension: "height", Variants: []domain.ProductVariant{{NominalDimensionMm: 108, HardwareID: "k-m"}},
	}}}
	// A legacy unlabeled 108 is «M»: a new «m» at another nominal collides.
	_, _, problem := addHeightVariant(legacy, domain.ProductVariant{NominalDimensionMm: 110, HardwareID: "k2", Label: "m"})
	if problem == nil || problem["code"] != "HARDWARE_KIT_SYSTEM_HEIGHT_EXISTS" {
		t.Fatalf("duplicate effective label must be a typed 422, got %v", problem)
	}
	// An unlabeled new height whose derived letter collides is rejected too.
	labeledN := domain.Agregado{ID: "agr", VariantSets: []domain.AgregadoVariantSet{{
		ID: "vs", Dimension: "height", Variants: []domain.ProductVariant{{NominalDimensionMm: 90, HardwareID: "k-n", Label: "N"}},
	}}}
	if _, _, problem := addHeightVariant(labeledN, domain.ProductVariant{NominalDimensionMm: 85.5, HardwareID: "k4"}); problem == nil {
		t.Fatal("an unlabeled 85.5 (derived «N») must collide with an existing «N»")
	}
	next, _, problem := addHeightVariant(legacy, domain.ProductVariant{NominalDimensionMm: 177, HardwareID: "k3", Label: "C"})
	if problem != nil {
		t.Fatalf("a new label must be accepted: %v", problem)
	}
	if got := next.VariantSets[0].Variants[1].Label; got != "C" {
		t.Fatalf("label not appended: %q", got)
	}
}

// labeledAgregado reads the ensamble recipe: drawer marker and height labels.
func (e *kitSysE2E) labeledAgregado(t *testing.T, id string) (*domain.AgregadoDrawerSystem, []string) {
	t.Helper()
	actor := storage.TenantActor{OrganizationID: e.org, UserID: kitSysActor}
	var marker *domain.AgregadoDrawerSystem
	var labels []string
	err := e.store.WithinTenantTx(context.Background(), actor, func(ctx context.Context) error {
		a, err := e.store.GetAgregadoByIDWithRecipe(ctx, id)
		if err != nil {
			return err
		}
		marker = a.DrawerSystem
		for _, vs := range a.VariantSets {
			for _, v := range vs.Variants {
				labels = append(labels, v.Label)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("agregado readback: %v", err)
	}
	return marker, labels
}

func TestHardwareKitSystem_PersistsDrawerFamilyData_1633(t *testing.T) {
	e := kitSystemE2EStore(t)
	payload := kitSystemPayload("FAM-A", 71, "")
	payload = strings.Replace(payload, `"variants":[{"nominalDimensionMm":209,`, `"variants":[{"label":"E","nominalDimensionMm":209,`, 1)
	payload = strings.Replace(payload, `"variant_sets": [{`, `"drawer_system": {"brand":" Blum ","line":"Merivobox"},
			"variant_sets": [{`, 1)
	rec := e.run(t, payload)
	if rec.Code != http.StatusCreated {
		t.Fatalf("system create = %d %s", rec.Code, rec.Body.String())
	}
	agrID := decodeKitSystemResponse(rec).AgregadoID
	marker, labels := e.labeledAgregado(t, agrID)
	if marker == nil || marker.Brand != "Blum" || marker.Line != "Merivobox" {
		t.Fatalf("drawer marker not persisted (trimmed): %+v", marker)
	}
	if len(labels) != 1 || labels[0] != "E" {
		t.Fatalf("labels = %v, want [E]", labels)
	}

	// «Añadir altura» persists its label; repeating it is a typed 422 with
	// no writes (the ensamble version does not move).
	if _, err := e.migrationPool.Exec(context.Background(),
		`UPDATE organizations SET library_type = 'custom' WHERE id = $1`, e.org); err != nil {
		t.Fatalf("enable custom library: %v", err)
	}
	version, _, _ := e.agregadoState(t, agrID)
	add := strings.Replace(heightPayload("FAM-A-C", 72, 177, false, ""),
		`"variant":{"nominalDimensionMm":177,`, `"variant":{"label":"C","nominalDimensionMm":177,`, 1)
	if rec := e.runHeight(t, agrID, version, add); rec.Code != http.StatusCreated {
		t.Fatalf("add labeled height = %d %s", rec.Code, rec.Body.String())
	}
	_, labels = e.labeledAgregado(t, agrID)
	if len(labels) != 2 || labels[1] != "C" {
		t.Fatalf("labels after add = %v, want [E C]", labels)
	}
	version, _, _ = e.agregadoState(t, agrID)
	dup := strings.Replace(heightPayload("FAM-A-C2", 73, 190, false, ""),
		`"variant":{"nominalDimensionMm":190,`, `"variant":{"label":"c","nominalDimensionMm":190,`, 1)
	rec = e.runHeight(t, agrID, version, dup)
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "HARDWARE_KIT_SYSTEM_HEIGHT_EXISTS") {
		t.Fatalf("duplicate label = %d %s, want 422 HEIGHT_EXISTS", rec.Code, rec.Body.String())
	}
	if after, _, _ := e.agregadoState(t, agrID); after != version {
		t.Fatalf("a rejected label must not move the ensamble version: %d → %d", version, after)
	}
	if got := e.sqlCount(t, "hardwares", []string{"FAM-A-C2"}); got != 0 {
		t.Fatalf("rejected height left hardware rows: %d", got)
	}
}

func TestHardwareKitSystem_RejectsDuplicateLabelsBeforeWrites_1633(t *testing.T) {
	e := kitSystemE2EStore(t)
	payload := kitSystemPayload("FAM-B", 74, "")
	payload = strings.Replace(payload,
		`"variants":[{"nominalDimensionMm":209,"hardwareId":`,
		`"variants":[{"label":"M","nominalDimensionMm":108,"hardwareId":`+`"`+kitSystemUUID(741)+`"},{"label":" m ","nominalDimensionMm":209,"hardwareId":`, 1)
	rec := e.run(t, payload)
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "duplicate label") {
		t.Fatalf("duplicate labels = %d %s, want 422 naming the duplicate label", rec.Code, rec.Body.String())
	}
	if got := e.sqlCount(t, "agregados", []string{"FAM-B-CAJON"}); got != 0 {
		t.Fatalf("rejected system left an agregado: %d", got)
	}
}
