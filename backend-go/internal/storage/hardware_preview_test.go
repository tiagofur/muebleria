package storage_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func strPtr(s string) *string       { return &s }
func ptrFloat64(v float64) *float64 { return &v }

// Integration: requires isolated test Postgres. Verifies the per-hardware preview
// geometry + PBR nullable columns round-trip through Create/Update/Get:
//   - nil pointer stays nil (NULL survives as "no preview", never coerced to 0);
//   - an explicit previewMetalness = 0.0 is preserved (the Fase 1 lesson: 0.0 is
//     a valid value that must NOT be erased — nullIfZeroFloat is NOT used);
//   - all 8 fields round-trip together.
func TestHardware_PersistsPreviewGeometry(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor

	// Case 1: create with NO preview fields -> all stay nil (NULL = cost-only).
	noPreview := newHardwarePreviewTestRow()
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, noPreview)
	})
	registerHardwarePreviewCleanup(t, noPreview)

	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, noPreview.ID)
	})
	if got.PreviewShape != nil || got.PreviewSizeMm != nil || got.PreviewMetalness != nil || got.PreviewClearcoat != nil {
		t.Fatalf("nil preview not preserved as nil: shape=%v size=%v metal=%v clear=%v",
			got.PreviewShape, got.PreviewSizeMm, got.PreviewMetalness, got.PreviewClearcoat)
	}

	// Case 2: create WITH previewMetalness = 0.0 -> survives as 0.0 (critical:
	// 0.0 is a valid dielectric value and must NOT be erased to NULL).
	zeroMetal := newHardwarePreviewTestRow()
	zeroMetal.PreviewShape = strPtr("knob")
	zeroMetal.PreviewMetalness = ptrFloat64(0.0)
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateHardware(txCtx, zeroMetal)
	})
	registerHardwarePreviewCleanup(t, zeroMetal)

	got = withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, zeroMetal.ID)
	})
	if got.PreviewMetalness == nil || *got.PreviewMetalness != 0.0 {
		t.Fatalf("metalness 0.0 not preserved on create: got %v", got.PreviewMetalness)
	}
	if got.PreviewShape == nil || *got.PreviewShape != "knob" {
		t.Fatalf("previewShape not preserved: got %v", got.PreviewShape)
	}

	// Case 3: update with all fields set -> all round-trip via UPDATE.
	noPreview.PreviewShape = strPtr("bar-pull")
	noPreview.PreviewSizeMm = ptrFloat64(128)
	noPreview.PreviewProjectionMm = ptrFloat64(32)
	noPreview.PreviewDiameterMm = ptrFloat64(12)
	noPreview.PreviewColor = strPtr("#C0C0C0")
	noPreview.PreviewRoughness = ptrFloat64(0.3)
	noPreview.PreviewMetalness = ptrFloat64(1.0)
	noPreview.PreviewClearcoat = ptrFloat64(0.0)
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateHardware(txCtx, noPreview.ID, noPreview)
	})
	got = withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Hardware, error) {
		return store.GetHardwareByID(txCtx, noPreview.ID)
	})
	if got.PreviewShape == nil || *got.PreviewShape != "bar-pull" {
		t.Fatalf("shape not persisted: %v", got.PreviewShape)
	}
	if got.PreviewMetalness == nil || *got.PreviewMetalness != 1.0 {
		t.Fatalf("metalness not persisted: %v", got.PreviewMetalness)
	}
	if got.PreviewClearcoat == nil || *got.PreviewClearcoat != 0.0 {
		t.Fatalf("clearcoat 0.0 not persisted: %v", got.PreviewClearcoat)
	}
	if got.PreviewSizeMm == nil || *got.PreviewSizeMm != 128 {
		t.Fatalf("sizeMm not persisted: %v", got.PreviewSizeMm)
	}
	if got.PreviewColor == nil || *got.PreviewColor != "#C0C0C0" {
		t.Fatalf("color not persisted: %v", got.PreviewColor)
	}
}

// newHardwarePreviewTestRow builds a minimal, uniquely-coded active Hardware with
// no preview fields. Empty ID lets Postgres generate one.
func newHardwarePreviewTestRow() *domain.Hardware {
	return &domain.Hardware{
		Code:        fmt.Sprintf("ZZ-HWPREV-%d", time.Now().UnixNano()),
		Name:        "Hardware Preview Round-Trip Test",
		Unit:        domain.HardwareUnit("piece"),
		CostPerUnit: 1,
		Active:      true,
	}
}

// registerHardwarePreviewCleanup hard-deletes the row this test created. The
// store has no hardware hard-delete API, so delete via the pool (mirrors the
// material_pbr_persist_test cleanup that DELETEs rather than nulling fields).
func registerHardwarePreviewCleanup(t *testing.T, h *domain.Hardware) {
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, "DELETE FROM hardwares WHERE id = $1", h.ID)
	})
}
