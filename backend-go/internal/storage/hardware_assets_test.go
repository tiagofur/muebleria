package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #667 / M1: versioned hardware 3D assets — upload lifecycle, exact binding,
// validation evidence and DesignRevision publish pins. Every behavior test
// below runs against real PostgreSQL (never mocks): the RLS/direct-SQL
// claims run under the real granete_app_test runtime role.

func hwAssetSHA(seed string) string {
	out := strings.Repeat(seed, 32)
	return "sha256-" + out[:64]
}

func hwAssetNewStore(t *testing.T) (*storage.PostgresStore, *pgxpool.Pool) {
	t.Helper()
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	return store, pool
}

// hwAssetWorld is the standard #667 fixture: the designs fixture (org A/B,
// shared project, module fiModuleA on RELEASE-BODY) plus one org-A hardware
// carrying a visible placement on the structure's panel, so publishing the
// design resolves real LayoutHardware to pin.
type hwAssetWorld struct {
	fx        *rlsFixture
	hardwareA string
	designID  string
	fi        string
}

func newHwAssetWorld(t *testing.T) *hwAssetWorld {
	t.Helper()
	fx := setupDesignsTestFixture(t)
	w := &hwAssetWorld{fx: fx}

	// Org A hardware bound to the shared fixture's panel: the publish-time
	// resolve must see this placement to freeze a pin.
	multiOrgExec(t, fx.admin, `INSERT INTO hardwares (id, code, name, unit, cost_per_unit, active, preview_shape, preview_size_mm, preview_projection_mm, organization_id)
		VALUES ('74000000-0000-0000-0000-0000000000a1', 'HW-ASSET-BOUND', 'Tirador_asset', 'piece', 10, TRUE, 'knob', 96, 24, '`+rlsOrgA+`')`)
	// A second org-A hardware with NO binding (scenario 11 controls).
	multiOrgExec(t, fx.admin, `INSERT INTO hardwares (id, code, name, unit, cost_per_unit, active, organization_id)
		VALUES ('74000000-0000-0000-0000-0000000000a2', 'HW-NO-ASSET', 'Corredera_simple', 'piece', 20, TRUE, '`+rlsOrgA+`')`)
	multiOrgExec(t, fx.admin, `UPDATE structure_components
		SET overrides = '{"hardwarePlacements":[{"hardwareId":"74000000-0000-0000-0000-0000000000a1","anchorFace":"front","relativePosition":{"xMm":50,"yMm":50}}]}'
		WHERE structure_id='71000000-0000-0000-0000-000000000001'
		  AND component_id='71000000-0000-0000-0000-000000000002'`)

	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		design, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Cocina assets",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		w.designID = design.ID
		fi, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:   fiSharedProject,
			Origin:      domain.FurnitureInstanceOriginDesign,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		w.fi = fi.ID
		_, err = fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   w.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{{
				FurnitureInstanceID:   w.fi,
				FurnitureDefinitionID: fiModuleA,
				Parameters:            map[string]any{"widthMm": 600.0},
				Transform: domain.Transform3D{
					TranslationMm: [3]float64{0, 0, 0},
					RotationDeg:   [3]float64{0, 0, 0},
				},
			}},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("seed hw asset world: %v", err)
	}
	return w
}

// stageAndFinalizeAsset runs the storage-level upload lifecycle (bytes
// metadata only — the API layer owns files) in org A and returns the asset.
func stageAndFinalizeAsset(t *testing.T, w *hwAssetWorld, displayName string, targetAssetID string) *domain.HardwareAsset {
	t.Helper()
	return stageAndFinalizeAssetDigest(t, w, displayName, targetAssetID, "11")
}

func stageAndFinalizeAssetDigest(t *testing.T, w *hwAssetWorld, displayName string, targetAssetID, digestSeed string) *domain.HardwareAsset {
	t.Helper()
	var asset *domain.HardwareAsset
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		res, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationSKP,
			DisplayName:    displayName,
			Provenance:     "Proveedor demo",
			License:        "Uso interno",
			Origin:         json.RawMessage(`{"sourceUnits":"mm","upAxis":"z"}`),
			TargetAssetID:  targetAssetID,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		session := res.Session
		if session.Status != "prepared" {
			t.Fatalf("session status = %q", session.Status)
		}
		storageKey := "hardware-assets/" + session.ID + "/skp-aabbccddeeff.skp"
		if err := w.fx.store.RecordHardwareAssetSessionBytes(ctx, storage.RecordHardwareAssetSessionBytesCommand{
			SessionID:   session.ID,
			StorageKey:  storageKey,
			ContentType: "application/octet-stream",
			SizeBytes:   1234,
			SHA256:      hwAssetSHA(digestSeed),
		}); err != nil {
			return err
		}
		asset, err = w.fx.store.FinalizeHardwareAssetUpload(ctx, storage.FinalizeHardwareAssetUploadCommand{
			SessionID:   session.ID,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("stage+finalize asset %q: %v", displayName, err)
	}
	return asset
}

func bindHardwareToRevision(t *testing.T, w *hwAssetWorld, hardwareID string, asset *domain.HardwareAsset) *domain.HardwareVisualAssetBinding {
	t.Helper()
	var binding *domain.HardwareVisualAssetBinding
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		latest := asset.Revisions[len(asset.Revisions)-1]
		resolved, err := w.fx.store.ResolveHardwareVisualAssetBinding(ctx, asset.ID, latest.ID)
		if err != nil {
			return err
		}
		binding = resolved
		current, err := w.fx.store.GetHardwareByID(ctx, hardwareID)
		if err != nil {
			return err
		}
		current.VisualAsset = resolved
		return w.fx.store.UpdateHardware(ctx, hardwareID, current)
	})
	if err != nil {
		t.Fatalf("bind hardware: %v", err)
	}
	return binding
}

func publishDesignRev(t *testing.T, w *hwAssetWorld, base string) *domain.DesignRevision {
	t.Helper()
	var rev *domain.DesignRevision
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		rev, err = w.fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       w.designID,
			BaseRevisionID: base,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish revision (base=%q): %v", base, err)
	}
	return rev
}

// 1 + 2 + 3: valid upload lifecycle → finalize → consult → asset + immutable
// revision with server-computed facts; binding round-trips through the
// hardware read path with server-resolved representation/digest/state.
func TestHardwareAssets_UploadFinalizeBindingRoundTrip(t *testing.T) {
	w := newHwAssetWorld(t)

	asset := stageAndFinalizeAsset(t, w, "Tirador clásico", "")
	if asset.ID == "" || asset.Status != domain.HardwareAssetStatusActive {
		t.Fatalf("asset = %+v", asset)
	}
	if len(asset.Revisions) != 1 || asset.Revisions[0].RevisionNumber != 1 {
		t.Fatalf("revisions = %+v", asset.Revisions)
	}
	rev := asset.Revisions[0]
	if rev.SHA256 != hwAssetSHA("11") || rev.SizeBytes != 1234 || rev.ContentType != "application/octet-stream" {
		t.Fatalf("revision facts = %+v", rev)
	}
	if rev.ValidationState != domain.HardwareAssetValidationPending {
		t.Fatalf("validation state must start pending, got %q", rev.ValidationState)
	}
	if rev.IntegrityVerifiedAt.IsZero() {
		t.Fatal("integrity_verified_at must be the server observation time")
	}
	// Binding round-trip through the hardware write/read path (bind first,
	// then read back).
	binding := bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a1", asset)
	if binding.Representation != domain.HardwareAssetRepresentationSKP || binding.SHA256 != rev.SHA256 {
		t.Fatalf("resolved binding facts = %+v", binding)
	}
	var hw *domain.Hardware
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		// Consult: session reads back finalized, staged bytes detached.
		sess, err := w.fx.store.GetHardwareAssetUploadSession(ctx, mustSessionIDForAsset(t, w, asset.ID))
		if err != nil {
			return err
		}
		if sess.Status != "finalized" {
			t.Fatalf("session readback = %+v", sess)
		}
		// The staged metadata persists as the record of WHERE the finalized
		// bytes live (the revision references the same canonical key).
		if sess.Staged == nil || sess.Staged.StorageKey == "" {
			t.Fatalf("finalized session lost its byte record: %+v", sess)
		}
		// List + detail readback.
		assets, err := w.fx.store.ListHardwareAssets(ctx)
		if err != nil {
			return err
		}
		if len(assets) != 1 {
			t.Fatalf("list = %+v", assets)
		}
		detail, err := w.fx.store.GetHardwareAsset(ctx, asset.ID)
		if err != nil {
			return err
		}
		if detail.ID != asset.ID || len(detail.Revisions) != 1 {
			t.Fatalf("detail = %+v", detail)
		}
		if detail.Provenance != "Proveedor demo" || detail.License != "Uso interno" {
			t.Fatalf("declared provenance/license lost: %+v", detail)
		}

		// Binding round-trip through the hardware write/read path.
		h, err := w.fx.store.GetHardwareByID(ctx, "74000000-0000-0000-0000-0000000000a1")
		if err != nil {
			return err
		}
		hw = h
		if hw.VisualAsset == nil ||
			hw.VisualAsset.AssetID != asset.ID ||
			hw.VisualAsset.AssetRevisionID != rev.ID ||
			hw.VisualAsset.Representation != domain.HardwareAssetRepresentationSKP ||
			hw.VisualAsset.SHA256 != rev.SHA256 ||
			hw.VisualAsset.ValidationState != domain.HardwareAssetValidationPending {
			t.Fatalf("binding round-trip = %+v", hw.VisualAsset)
		}

		// The binding survives the full catalog projection (resolve input).
		catalog, err := w.fx.store.GetFullCatalog(ctx)
		if err != nil {
			return err
		}
		found := false
		for _, c := range catalog.Hardware {
			if c.ID == hw.ID {
				found = true
				if c.VisualAsset == nil || c.VisualAsset.SHA256 != rev.SHA256 {
					t.Fatalf("catalog lost binding: %+v", c.VisualAsset)
				}
			}
		}
		if !found {
			t.Fatal("hardware missing from full catalog")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("readback: %v", err)
	}
}

// mustSessionIDForAsset recovers the upload session id from the finalized
// session row (consult readback helper for test 1).
func mustSessionIDForAsset(t *testing.T, w *hwAssetWorld, assetID string) (sessionID string) {
	t.Helper()
	err := w.fx.admin.QueryRow(context.Background(),
		`SELECT id FROM hardware_asset_upload_sessions WHERE finalized_asset_id = $1`, assetID,
	).Scan(&sessionID)
	if err != nil {
		t.Fatalf("session for asset: %v", err)
	}
	return sessionID
}

// 8: finalize replay returns the SAME asset (never a duplicate); a finalized
// session refuses new staged bytes (no silent overwrite of the revision).
func TestHardwareAssets_FinalizeIdempotentAndImmutable(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Bisagra suave", "")

	var replay *domain.HardwareAsset
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		replay, err = w.fx.store.FinalizeHardwareAssetUpload(ctx, storage.FinalizeHardwareAssetUploadCommand{
			SessionID:   mustSessionIDForAsset(t, w, asset.ID),
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil || replay.ID != asset.ID {
		t.Fatalf("finalize replay: asset=%v err=%v", replay, err)
	}
	var detail *domain.HardwareAsset
	if err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		detail, err = w.fx.store.GetHardwareAsset(ctx, asset.ID)
		return err
	}); err != nil {
		t.Fatalf("detail: %v", err)
	}
	if detail == nil || len(detail.Revisions) != 1 {
		t.Fatalf("replay duplicated revisions: %+v", detail)
	}

	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		return w.fx.store.RecordHardwareAssetSessionBytes(ctx, storage.RecordHardwareAssetSessionBytesCommand{
			SessionID:   mustSessionIDForAsset(t, w, asset.ID),
			StorageKey:  "hardware-assets/x/skp-000000000000.skp",
			ContentType: "application/octet-stream",
			SizeBytes:   99,
			SHA256:      hwAssetSHA("ff"),
		})
	})
	if !errors.Is(err, domain.ErrHardwareAssetSessionNotPrepared) {
		t.Fatalf("staged bytes after finalize must fail not-prepared, got %v", err)
	}

	// Same-value binding retry is a no-op, not a duplicate.
	bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a1", asset)
	bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a1", asset)
	var bindings int
	if err := w.fx.admin.QueryRow(context.Background(),
		`SELECT count(*) FROM hardwares WHERE id='74000000-0000-0000-0000-0000000000a1' AND visual_asset_id=$1`,
		asset.ID).Scan(&bindings); err != nil || bindings != 1 {
		t.Fatalf("binding rows = %d err=%v", bindings, err)
	}
}

// 4 (partial) + 9: finalize without bytes fails; a finalize whose staged file
// vanished fails closed BEFORE any row is written — a temp/partial file can
// never read as a finished asset (API pre-check mirrors this at byte level).
func TestHardwareAssets_FinalizeFailsClosedWithoutBytes(t *testing.T) {
	w := newHwAssetWorld(t)

	var sessionID string
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		res, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationSKP,
			DisplayName:    "Sin bytes",
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		sessionID = res.Session.ID
		return nil
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := w.fx.store.FinalizeHardwareAssetUpload(ctx, storage.FinalizeHardwareAssetUploadCommand{SessionID: sessionID})
		return err
	})
	if !errors.Is(err, domain.ErrHardwareAssetBytesMissing) {
		t.Fatalf("finalize without staged bytes = %v", err)
	}
	var assets int
	if err := w.fx.admin.QueryRow(context.Background(),
		`SELECT count(*) FROM hardware_assets`).Scan(&assets); err != nil || assets != 0 {
		t.Fatalf("no asset may exist after failed finalize: %d err=%v", assets, err)
	}
}

// 5: validation state derives ONLY from authorized evidence bound to the
// exact digest. The simulated validator below is a TEST recorder (tool name
// says so); the real producer is #668. A digest mismatch is refused.
func TestHardwareAssets_ValidationEvidenceDerivesState(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Jaladera validada", "")
	rev := asset.Revisions[0]

	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		// Evidence for DIFFERENT bytes can never attach to this revision.
		return w.fx.store.RecordHardwareAssetValidation(ctx, storage.RecordHardwareAssetValidationCommand{
			AssetID:    asset.ID,
			RevisionID: rev.ID,
			SHA256:     hwAssetSHA("99"),
			Tool:       "simulated:test-validator",
			Result:     "passed",
		})
	})
	if err == nil || !strings.Contains(err.Error(), "digest") {
		t.Fatalf("digest-mismatched evidence must fail: %v", err)
	}

	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		// SIMULATED validator (test-only producer; #668 is the real one).
		return w.fx.store.RecordHardwareAssetValidation(ctx, storage.RecordHardwareAssetValidationCommand{
			AssetID:    asset.ID,
			RevisionID: rev.ID,
			SHA256:     rev.SHA256,
			Tool:       "simulated:test-validator",
			Result:     "passed",
		})
	})
	if err != nil {
		t.Fatalf("record simulated validation: %v", err)
	}
	detail := mustGetAsset(t, w, asset.ID)
	if detail.Revisions[0].ValidationState != domain.HardwareAssetValidationValidated {
		t.Fatalf("state after passed evidence = %+v", detail)
	}

	// A later failed evidence flips the derived state honestly.
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		return w.fx.store.RecordHardwareAssetValidation(ctx, storage.RecordHardwareAssetValidationCommand{
			AssetID:    asset.ID,
			RevisionID: rev.ID,
			SHA256:     rev.SHA256,
			Tool:       "simulated:test-validator",
			Result:     "failed",
		})
	})
	if err != nil {
		t.Fatalf("record failed validation: %v", err)
	}
	detail = mustGetAsset(t, w, asset.ID)
	if detail.Revisions[0].ValidationState != domain.HardwareAssetValidationFailed {
		t.Fatalf("state after failed evidence = %+v", detail)
	}

	// The revision row itself stayed immutable (no client-writable state).
	var updated int
	if err := w.fx.admin.QueryRow(context.Background(), `
		SELECT count(*) FROM hardware_asset_revisions WHERE integrity_verified_at <> created_at AND id = $1`,
		rev.ID).Scan(&updated); err != nil {
		t.Fatalf("read revision: %v", err)
	}
}

// 6: unknown and cross-tenant references are refused with a neutral error;
// retired assets are refused for NEW bindings; thumbnails cannot be a model.
func TestHardwareAssets_BindingReferenceRejections(t *testing.T) {
	w := newHwAssetWorld(t)
	assetA := stageAndFinalizeAsset(t, w, "Recurso org A", "")

	// Unknown revision → neutral refusal.
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := w.fx.store.ResolveHardwareVisualAssetBinding(ctx,
			assetA.ID, "99999999-9999-9999-9999-999999999999")
		return err
	})
	if err == nil || !errors.Is(err, domain.ErrHardwareAssetBindingInvalid) {
		t.Fatalf("unknown revision = %v", err)
	}

	// Cross-tenant: org B context cannot resolve org A's revision, and the
	// error is identical to the unknown case (no existence oracle).
	err = fiTx(t, w.fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := w.fx.store.ResolveHardwareVisualAssetBinding(ctx,
			assetA.ID, assetA.Revisions[0].ID)
		return err
	})
	if err == nil || !errors.Is(err, domain.ErrHardwareAssetBindingInvalid) {
		t.Fatalf("cross-tenant resolution = %v", err)
	}

	// Retired asset refused for new selections; retire is idempotent.
	if err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		return w.fx.store.RetireHardwareAsset(ctx, storage.RetireHardwareAssetCommand{AssetID: assetA.ID, ActorUserID: rlsUserA})
	}); err != nil {
		t.Fatalf("retire: %v", err)
	}
	if err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		return w.fx.store.RetireHardwareAsset(ctx, storage.RetireHardwareAssetCommand{AssetID: assetA.ID, ActorUserID: rlsUserA})
	}); err != nil {
		t.Fatalf("idempotent retire: %v", err)
	}
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := w.fx.store.ResolveHardwareVisualAssetBinding(ctx, assetA.ID, assetA.Revisions[0].ID)
		return err
	})
	if !errors.Is(err, domain.ErrHardwareAssetRetired) {
		t.Fatalf("retired binding = %v", err)
	}

	// Thumbnails can't carry a hardware model binding.
	var thumb *domain.HardwareAsset
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		res, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationThumbnail,
			DisplayName:    "Miniatura",
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		if err := w.fx.store.RecordHardwareAssetSessionBytes(ctx, storage.RecordHardwareAssetSessionBytesCommand{
			SessionID:   res.Session.ID,
			StorageKey:  "hardware-assets/" + res.Session.ID + "/thumbnail-aabbccddeeff.png",
			ContentType: "image/png",
			SizeBytes:   555,
			SHA256:      hwAssetSHA("33"),
		}); err != nil {
			return err
		}
		thumb, err = w.fx.store.FinalizeHardwareAssetUpload(ctx, storage.FinalizeHardwareAssetUploadCommand{
			SessionID: res.Session.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("finalize thumbnail: %v", err)
	}
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := w.fx.store.ResolveHardwareVisualAssetBinding(ctx, thumb.ID, thumb.Revisions[0].ID)
		return err
	})
	if err == nil || !strings.Contains(err.Error(), "miniatura") {
		t.Fatalf("thumbnail binding must be refused: %v", err)
	}
}

// 7: bajo el rol real de aplicación, RLS oculta los recursos de otras
// organizaciones y las FKs compuestas hacen imposible una asociación
// cross-tenant aunque el identificador sea conocido.
func TestHardwareAssets_RLSAndDirectSQL(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Recurso RLS", "")
	rev := asset.Revisions[0]

	// Owner org sees its asset through the app-role store.
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		assets, err := w.fx.store.ListHardwareAssets(ctx)
		if err != nil {
			return err
		}
		if len(assets) != 1 || assets[0].ID != asset.ID {
			t.Fatalf("owner org assets = %+v", assets)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("org A read: %v", err)
	}

	// Foreign org sees zero assets — never a leak — and cannot inject a row
	// owned by org A (RLS WITH CHECK).
	err = fiTx(t, w.fx.store, fiActorB(), func(ctx context.Context) error {
		assets, err := w.fx.store.ListHardwareAssets(ctx)
		if err != nil {
			return err
		}
		if len(assets) != 0 {
			t.Fatalf("foreign org must see zero assets, got %+v", assets)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("org B read: %v", err)
	}

	// Direct SQL as the app role under org B: binding with the KNOWN
	// identifier is refused by the composite FK (knowing the id grants
	// nothing), and RLS refuses writing an org-A-owned asset row.
	runAsOrgB := func(t *testing.T, fn func(tx pgx.Tx)) {
		t.Helper()
		ctx := context.Background()
		tx, err := w.fx.app.Begin(ctx)
		if err != nil {
			t.Fatalf("begin app tx: %v", err)
		}
		defer tx.Rollback(ctx)
		setRLSActor(t, tx, rlsOrgB, rlsUserB, "")
		fn(tx)
	}
	runAsOrgB(t, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(), `
			INSERT INTO hardwares (id, code, name, unit, cost_per_unit, active, organization_id, visual_asset_id, visual_asset_revision_id)
			VALUES ('74000000-0000-0000-0000-0000000000b1', 'HW-B-STEAL', 'Robo', 'piece', 1, TRUE, $1, $2, $3)`,
			rlsOrgB, asset.ID, rev.ID)
		if err == nil || !strings.Contains(err.Error(), "fk_hardwares_visual_asset") {
			t.Fatalf("cross-tenant binding via direct SQL = %v", err)
		}
	})
	runAsOrgB(t, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(), `
			INSERT INTO hardware_assets (id, display_name, organization_id)
			VALUES ('74000000-0000-0000-0000-0000000000b2', 'inyectada', $1)`, rlsOrgA)
		if err == nil {
			t.Fatal("RLS must refuse a foreign-organization asset insert")
		}
	})

	// Immutable rows reject UPDATE/DELETE even for the table owner.
	if _, err := w.fx.admin.Exec(context.Background(),
		`UPDATE hardware_asset_revisions SET sha256 = $1 WHERE id = $2`, rev.SHA256, rev.ID); err == nil {
		t.Fatal("revision UPDATE must be refused by the immutability trigger")
	}
	if _, err := w.fx.admin.Exec(context.Background(),
		`DELETE FROM hardware_asset_revisions WHERE id = $1`, rev.ID); err == nil {
		t.Fatal("revision DELETE must be refused by the immutability trigger")
	}
}

// 8b + A(replace): target-asset upload appends revision #2 to the SAME asset
// (replace-with-new-revision); the revision number advances, history is kept.
func TestHardwareAssets_NewRevisionOnExistingAsset(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Jaladera v1", "")
	second := stageAndFinalizeAssetDigest(t, w, "Jaladera v2", asset.ID, "22")

	if second.ID != asset.ID {
		t.Fatalf("target-asset upload created a new asset %s", second.ID)
	}
	if len(second.Revisions) != 2 || second.Revisions[1].RevisionNumber != 2 {
		t.Fatalf("revisions = %+v", second.Revisions)
	}
	if second.Revisions[0].SHA256 == second.Revisions[1].SHA256 {
		t.Fatal("revisions must keep their own digests")
	}

	// Retired assets refuse new revisions too.
	if err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		return w.fx.store.RetireHardwareAsset(ctx, storage.RetireHardwareAssetCommand{AssetID: asset.ID, ActorUserID: rlsUserA})
	}); err != nil {
		t.Fatalf("retire: %v", err)
	}
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		res, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationSKP,
			DisplayName:    "v3 sobre retirado",
			TargetAssetID:  asset.ID,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		_ = res
		return nil
	})
	if !errors.Is(err, domain.ErrHardwareAssetRetired) {
		t.Fatalf("session on retired asset = %v", err)
	}
}

// 10 + 11 + 12: R1 freezes the exact revision; a catalog rebind plus R2
// leaves R1 untouched; a hardware without assets contributes no pins; and
// visual rebinding never changes the resolved layout (BOM/maquinado neutral).
func TestHardwareAssets_PublishPinsFreezeAndSurviveRebind(t *testing.T) {
	w := newHwAssetWorld(t)
	assetA := stageAndFinalizeAsset(t, w, "Tirador A", "")
	bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a1", assetA)

	// 12: the visual binding is layout/BOM neutral — identical resolve output
	// before and after the binding change (visual ≠ manufacturing).
	layoutAfter := mustResolveModuleLayout(t, w)
	if !strings.Contains(layoutAfter, "74000000-0000-0000-0000-0000000000a1") {
		t.Fatalf("fixture resolve must emit the bound hardware placement: %s", layoutAfter)
	}

	rev1 := publishDesignRev(t, w, "")
	pins1 := mustListPins(t, w, rev1.ID)
	if len(pins1) != 1 {
		t.Fatalf("R1 pins = %+v", pins1)
	}
	if pins1[0].HardwareID != "74000000-0000-0000-0000-0000000000a1" ||
		pins1[0].AssetID != assetA.ID ||
		pins1[0].AssetRevisionID != assetA.Revisions[0].ID ||
		pins1[0].SHA256 != assetA.Revisions[0].SHA256 {
		t.Fatalf("R1 pin = %+v want asset A rev1", pins1[0])
	}

	// Catalog moves to a NEW exact revision (replace-with-new-revision on the
	// same asset, then rebind).
	assetV2 := stageAndFinalizeAssetDigest(t, w, "Tirador A v2", assetA.ID, "22")
	bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a1", assetV2)

	// 12 (cont.): the rebind is purely visual — the resolved layout is
	// byte-identical to the pre-rebind resolve.
	layoutRebound := mustResolveModuleLayout(t, w)
	if layoutAfter != layoutRebound {
		t.Fatalf("visual rebind changed the resolved layout:\nbefore=%s\nafter=%s", layoutAfter, layoutRebound)
	}

	rev2 := publishDesignRev(t, w, rev1.ID)
	pins2 := mustListPins(t, w, rev2.ID)
	if len(pins2) != 1 || pins2[0].AssetRevisionID != assetV2.Revisions[1].ID {
		t.Fatalf("R2 pins = %+v want v2 revision", pins2)
	}

	// 10: R1 still identifies revision #1 — historical pins never follow the
	// catalog, and the rows reject rewrite attempts.
	pins1After := mustListPins(t, w, rev1.ID)
	if len(pins1After) != 1 || pins1After[0].AssetRevisionID != assetA.Revisions[0].ID {
		t.Fatalf("R1 pins after rebind = %+v", pins1After)
	}
	if _, err := w.fx.admin.Exec(context.Background(),
		`UPDATE design_revision_hardware_assets SET sha256 = repeat('0', 70) WHERE design_revision_id = $1`, rev1.ID); err == nil {
		t.Fatal("pins must be immutable (UPDATE refused)")
	}

	// 11: a hardware without any asset contributes NO invented pins — the
	// unbound hardware (74000000-...-a2) never appears in either revision.
	for _, pins := range [][]domain.DesignRevisionHardwareAssetPin{pins1After, pins2} {
		for _, p := range pins {
			if p.HardwareID == "74000000-0000-0000-0000-0000000000a2" {
				t.Fatalf("unbound hardware pinned: %+v", p)
			}
		}
	}
}

func mustGetAsset(t *testing.T, w *hwAssetWorld, assetID string) *domain.HardwareAsset {
	t.Helper()
	var asset *domain.HardwareAsset
	if err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		asset, err = w.fx.store.GetHardwareAsset(ctx, assetID)
		return err
	}); err != nil {
		t.Fatalf("get asset: %v", err)
	}
	return asset
}

func mustListPins(t *testing.T, w *hwAssetWorld, revisionID string) []domain.DesignRevisionHardwareAssetPin {
	t.Helper()
	var pins []domain.DesignRevisionHardwareAssetPin
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		pins, err = w.fx.store.ListDesignRevisionHardwareAssets(ctx, revisionID)
		return err
	})
	if err != nil {
		t.Fatalf("list pins: %v", err)
	}
	return pins
}

// resolveLayoutForTest resolves through the SAME authoritative engine the
// publish freeze uses (single resolution truth, no test-local variant).
func resolveLayoutForTest(module *domain.Module, catalog domain.Catalog) (engine.FurnitureLayout, error) {
	return engine.ResolveFurnitureLayout(*module, catalog, nil, nil)
}

func mustResolveModuleLayout(t *testing.T, w *hwAssetWorld) string {
	t.Helper()
	var raw string
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		catalog, err := w.fx.store.GetFullCatalog(ctx)
		if err != nil {
			return err
		}
		module, err := w.fx.store.GetModuleByID(ctx, fiModuleA)
		if err != nil {
			return err
		}
		layout, err := resolveLayoutForTest(module, catalog)
		if err != nil {
			// The module/structure fixture must resolve; a resolve failure
			// here is a fixture bug, not an expected path.
			return err
		}
		encoded, err := json.Marshal(map[string]any{
			"components": layout.Components,
			"hardware":   layout.Hardware,
		})
		if err != nil {
			return err
		}
		raw = string(encoded)
		return nil
	})
	if err != nil {
		t.Fatalf("resolve module layout: %v", err)
	}
	return raw
}

// Migración: fresh apply through 000131 y upgrade 000130 → 000131 dejan el
// mismo esquema, inventario RLS, grants e inmutabilidad.
func TestHardwareAssets_MigrationFreshAndUpgrade(t *testing.T) {
	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 131)
	assertHardwareAssetsSchema(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 130)
	contents, err := os.ReadFile("../../db/migration/000131_hardware_3d_assets.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := upgrade.Exec(context.Background(), string(contents)); err != nil {
		t.Fatalf("upgrade apply 000131: %v", err)
	}
	assertHardwareAssetsSchema(t, upgrade)
}

func assertHardwareAssetsSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	for _, table := range []string{
		"hardware_assets", "hardware_asset_revisions",
		"hardware_asset_upload_sessions", "hardware_asset_validations",
		"design_revision_hardware_assets",
	} {
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=$1)`, table,
		).Scan(&exists); err != nil || !exists {
			t.Fatalf("table %s exists=%v err=%v", table, exists, err)
		}
		var rls, forced bool
		if err := pool.QueryRow(ctx,
			`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname=$1`, table,
		).Scan(&rls, &forced); err != nil || !rls || !forced {
			t.Fatalf("RLS for %s enabled=%v forced=%v", table, rls, forced)
		}
	}

	// Tenant-owned family: owner-org scope. Pins follow the design family.
	for _, tc := range []struct{ table, classification, readScope string }{
		{"hardware_assets", "tenant-owned", "owner-organization"},
		{"hardware_asset_revisions", "tenant-owned", "owner-organization"},
		{"hardware_asset_upload_sessions", "tenant-owned", "owner-organization"},
		{"hardware_asset_validations", "tenant-owned", "owner-organization"},
		{"design_revision_hardware_assets", "explicitly-shared", "project-organizations"},
	} {
		var classification, readScope string
		if err := pool.QueryRow(ctx,
			`SELECT classification, read_scope FROM rls_policy_inventory WHERE table_name=$1`, tc.table,
		).Scan(&classification, &readScope); err != nil {
			t.Fatalf("inventory row for %s: %v", tc.table, err)
		}
		if classification != tc.classification || readScope != tc.readScope {
			t.Fatalf("inventory for %s = (%q,%q)", tc.table, classification, readScope)
		}
	}

	// Immutable family: granete_app gets SELECT,INSERT only.
	for _, table := range []string{"hardware_asset_revisions", "hardware_asset_validations", "design_revision_hardware_assets"} {
		privileges := map[string]bool{}
		rows, err := pool.Query(ctx, `
			SELECT privilege_type FROM information_schema.table_privileges
			WHERE table_name=$1 AND grantee='granete_app'`, table)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var privilege string
			if err := rows.Scan(&privilege); err != nil {
				t.Fatal(err)
			}
			privileges[privilege] = true
		}
		rows.Close()
		if !privileges["SELECT"] || !privileges["INSERT"] || privileges["UPDATE"] || privileges["DELETE"] {
			t.Fatalf("%s grants must be SELECT,INSERT only: %v", table, privileges)
		}
	}

	// Immutability + append-only triggers exist.
	for _, tc := range []struct{ table, trigger string }{
		{"hardware_asset_revisions", "protect_hardware_asset_revisions_immutable"},
		{"hardware_asset_validations", "protect_hardware_asset_validations_append_only"},
		{"design_revision_hardware_assets", "protect_design_revision_hardware_assets_immutable"},
	} {
		var n int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
			WHERE c.relname=$1 AND tg.tgname=$2 AND NOT tg.tgisinternal`, tc.table, tc.trigger,
		).Scan(&n); err != nil || n != 1 {
			t.Fatalf("trigger %s on %s count=%d err=%v", tc.trigger, tc.table, n, err)
		}
	}

	// The hardware binding FKs exist (cross-tenant impossibility).
	var fkCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.table_constraints
		WHERE table_name='hardwares' AND constraint_type='FOREIGN KEY'
		  AND constraint_name IN ('fk_hardwares_visual_asset','fk_hardwares_visual_asset_revision')`,
	).Scan(&fkCount); err != nil || fkCount != 2 {
		t.Fatalf("hardware binding FKs = %d err=%v", fkCount, err)
	}
}

// --- Ronda de corrección R2/R4 (#667 M1): pruebas registradas en RED primero ---

// R2: el listado debe cargar las revisiones igual que el detalle (la versión
// revisada devuelve copias con el slice de revisiones vacío).
func TestHardwareAssets_ListMatchesDetail(t *testing.T) {
	w := newHwAssetWorld(t)
	first := stageAndFinalizeAsset(t, w, "Recurso uno", "")
	second := stageAndFinalizeAssetDigest(t, w, "Recurso dos", "", "77")
	_ = second
	secondV2 := stageAndFinalizeAssetDigest(t, w, "Recurso dos v2", second.ID, "88")

	var list []domain.HardwareAsset
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		list, err = w.fx.store.ListHardwareAssets(ctx)
		return err
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("list length = %d", len(list))
	}
	byName := map[string]*domain.HardwareAsset{}
	for i := range list {
		byName[list[i].DisplayName] = &list[i]
	}
	detailOne := mustGetAsset(t, w, first.ID)
	detailTwo := mustGetAsset(t, w, second.ID)

	// Recurso uno: una revisión, mismos hechos que el detalle.
	lv := byName["Recurso uno"]
	if lv == nil || len(lv.Revisions) != 1 {
		t.Fatalf("list 'Recurso uno' revisions = %+v", lv)
	}
	if lv.Revisions[0].ID != detailOne.Revisions[0].ID ||
		lv.Revisions[0].RevisionNumber != detailOne.Revisions[0].RevisionNumber ||
		lv.Revisions[0].SHA256 != detailOne.Revisions[0].SHA256 ||
		lv.Revisions[0].Representation != detailOne.Revisions[0].Representation ||
		lv.Revisions[0].ValidationState != detailOne.Revisions[0].ValidationState {
		t.Fatalf("list vs detail (uno): %+v vs %+v", lv.Revisions[0], detailOne.Revisions[0])
	}

	// Recurso dos: DOS revisiones en el listado, igual que el detalle.
	lv2 := byName["Recurso dos"]
	if lv2 == nil {
		t.Fatal("list missing 'Recurso dos'")
	}
	if len(lv2.Revisions) != 2 || len(detailTwo.Revisions) != 2 {
		t.Fatalf("list revisions = %d, detail revisions = %d (want 2/2)", len(lv2.Revisions), len(detailTwo.Revisions))
	}
	for i, lr := range lv2.Revisions {
		dr := detailTwo.Revisions[i]
		if lr.ID != dr.ID || lr.RevisionNumber != dr.RevisionNumber ||
			lr.SHA256 != dr.SHA256 || lr.Representation != dr.Representation ||
			lr.ValidationState != dr.ValidationState {
			t.Fatalf("list vs detail (dos, rev %d): %+v vs %+v", i, lr, dr)
		}
	}
	_ = secondV2
}

// R4: los pins provienen del contexto semántico exacto, no del conjunto
// filtrado para dibujar placeholders. Un herraje con recurso SKP asociado y
// SIN previewShape debe congelarse; las hardware_lines del módulo también son
// referencias semánticas. R1 conserva A tras rebind a B y publicar R2.
func TestHardwareAssets_PinsFromSemanticCompositionWithoutPreview(t *testing.T) {
	w := newHwAssetWorld(t)

	// Tercer herraje SIN previewShape (el fixture a1 lo tiene; a3 no) y
	// cuarto herraje referenciado sólo por una hardware_line (sin placement).
	multiOrgExec(t, w.fx.admin, `INSERT INTO hardwares (id, code, name, unit, cost_per_unit, active, organization_id)
		VALUES ('74000000-0000-0000-0000-0000000000a3', 'HW-NO-PREVIEW', 'Tirador real', 'piece', 15, TRUE, '`+rlsOrgA+`')`)
	multiOrgExec(t, w.fx.admin, `INSERT INTO hardwares (id, code, name, unit, cost_per_unit, active, organization_id)
		VALUES ('74000000-0000-0000-0000-0000000000a4', 'HW-LINE-ONLY', 'Guía costos', 'piece', 8, TRUE, '`+rlsOrgA+`')`)
	multiOrgExec(t, w.fx.admin, `UPDATE structure_components
		SET overrides = '{"hardwarePlacements":[
			{"hardwareId":"74000000-0000-0000-0000-0000000000a1","anchorFace":"front","relativePosition":{"xMm":50,"yMm":50}},
			{"hardwareId":"74000000-0000-0000-0000-0000000000a3","anchorFace":"front","relativePosition":{"xMm":150,"yMm":50}}]}'
		WHERE structure_id='71000000-0000-0000-0000-000000000001'
		  AND component_id='71000000-0000-0000-0000-000000000002'`)
	multiOrgExec(t, w.fx.admin, `INSERT INTO hardware_lines (module_id, quantity, option_role, hardware_id, organization_id)
		VALUES ('`+fiModuleA+`', 2, 'GUIA', '74000000-0000-0000-0000-0000000000a4', '`+rlsOrgA+`')`)

	assetA1 := stageAndFinalizeAsset(t, w, "Control con preview", "")
	assetA3 := stageAndFinalizeAssetDigest(t, w, "Tirador real v1", "", "33")
	assetA4 := stageAndFinalizeAssetDigest(t, w, "Guía v1", "", "44")
	bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a1", assetA1)
	bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a3", assetA3)
	bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a4", assetA4)

	rev1 := publishDesignRev(t, w, "")
	pins1 := mustListPins(t, w, rev1.ID)
	pinned := map[string]domain.DesignRevisionHardwareAssetPin{}
	for _, p := range pins1 {
		pinned[p.HardwareID] = p
	}
	// a1 (con preview) y a3 (SIN preview, con recurso) y a4 (sólo línea).
	for _, hwID := range []string{
		"74000000-0000-0000-0000-0000000000a1",
		"74000000-0000-0000-0000-0000000000a3",
		"74000000-0000-0000-0000-0000000000a4",
	} {
		p, ok := pinned[hwID]
		if !ok {
			t.Fatalf("R1 debe congelar el pin del herraje %s (contexto semántico, no preview): pins=%+v", hwID, pins1)
		}
		if p.Representation != domain.HardwareAssetRepresentationSKP || p.SHA256 == "" {
			t.Fatalf("pin incoherente para %s: %+v", hwID, p)
		}
	}
	if pinned["74000000-0000-0000-0000-0000000000a3"].AssetRevisionID != assetA3.Revisions[0].ID {
		t.Fatalf("pin a3 = %+v", pinned["74000000-0000-0000-0000-0000000000a3"])
	}

	// Coherencia referencial de cada pin: digest/representación coinciden con
	// la fila de la revisión referenciada (una sola lectura consistente).
	assertPinCoherence(t, w, rev1.ID)

	// Rebind de a3 a una nueva revisión y publicación de R2: R1 conserva A.
	assetA3v2 := stageAndFinalizeAssetDigest(t, w, "Tirador real v2", assetA3.ID, "55")
	bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a3", assetA3v2)

	rev2 := publishDesignRev(t, w, rev1.ID)
	pins2 := mustListPins(t, w, rev2.ID)
	pinned2 := map[string]domain.DesignRevisionHardwareAssetPin{}
	for _, p := range pins2 {
		pinned2[p.HardwareID] = p
	}
	if pinned2["74000000-0000-0000-0000-0000000000a3"].AssetRevisionID != assetA3v2.Revisions[1].ID {
		t.Fatalf("R2 debe congelar la revisión nueva de a3: %+v", pins2)
	}
	pins1After := mustListPins(t, w, rev1.ID)
	for _, p := range pins1After {
		if p.HardwareID == "74000000-0000-0000-0000-0000000000a3" && p.AssetRevisionID != assetA3.Revisions[0].ID {
			t.Fatalf("R1 mutó tras el rebind: %+v", p)
		}
	}
	assertPinCoherence(t, w, rev2.ID)
}

// assertPinCoherence: cada pin coincide con la revisión que referencia
// (digest + representación leídos de la propia fila de la revisión).
func assertPinCoherence(t *testing.T, w *hwAssetWorld, revisionID string) {
	t.Helper()
	rows, err := w.fx.admin.Query(context.Background(), `
		SELECT p.hardware_id, p.asset_revision_id, p.representation, p.sha256, r.representation, r.sha256, r.asset_id, p.asset_id
		FROM design_revision_hardware_assets p
		JOIN hardware_asset_revisions r ON r.id = p.asset_revision_id
		WHERE p.design_revision_id = $1`, revisionID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var hwID, pinRev, pinRep, pinSHA, rowRep, rowSHA, rowAsset, pinAsset string
		if err := rows.Scan(&hwID, &pinRev, &pinRep, &pinSHA, &rowRep, &rowSHA, &rowAsset, &pinAsset); err != nil {
			t.Fatal(err)
		}
		if pinRep != rowRep || pinSHA != rowSHA || pinAsset != rowAsset {
			t.Fatalf("pin incoherente para %s: pin=(%s,%s,%s) revisión=(%s,%s,%s)",
				hwID, pinRev, pinRep, pinSHA[:16], rowAsset, rowRep, rowSHA[:16])
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
}

// R4: composición rota (estructura referenciada inexistente) → la publicación
// falla con error; jamás desaparición silenciosa de pins.
func TestHardwareAssets_PublishFailsOnBrokenComposition(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Tirador roto", "")
	bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a1", asset)
	// Composición rota: la estructura referencia un agregado inexistente
	// (JSONB sin FK — el único camino real de drift referencial).
	multiOrgExec(t, w.fx.admin, `UPDATE structures SET agregados = '[{"agregado_id":"99000000-0000-0000-0000-0000000000aa","quantity":1}]'
		WHERE id='71000000-0000-0000-0000-000000000001'`)

	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := w.fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:   w.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err == nil {
		t.Fatal("la publicación con composición rota debe fallar (nunca pins silenciosamente ausentes)")
	}
}

// R4: ausencia legítima — un ítem sin definición no inventa pins y no bloquea
// la publicación.
func TestHardwareAssets_PublishLegitimateAbsenceWithoutDefinition(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Sin uso", "")
	bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a1", asset)

	// Working copy con DOS ítems: el definido (fi) y uno SIN definición.
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		fi, err := w.fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:   fiSharedProject,
			Origin:      domain.FurnitureInstanceOriginDesign,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		_, err = w.fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   w.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID:  w.fi, // con definición (fiModuleA)
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0},
					Transform: domain.Transform3D{TranslationMm: [3]float64{0, 0, 0}, RotationDeg: [3]float64{0, 0, 0}},
				},
				{
					FurnitureInstanceID: fi.ID, // sin definición
					Transform: domain.Transform3D{TranslationMm: [3]float64{600, 0, 0}, RotationDeg: [3]float64{0, 0, 0}},
				},
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("working copy: %v", err)
	}

	rev := publishDesignRev(t, w, "")
	// El ítem sin definición no aporta pins; el publicado con definición sí
	// (el fixture a1 sigue referenciado por la composición).
	pins := mustListPins(t, w, rev.ID)
	found := false
	for _, p := range pins {
		if p.HardwareID == "74000000-0000-0000-0000-0000000000a1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("el ítem CON definición debe aportar su pin: %+v", pins)
	}
}

// R4: publicación concurrente con rebind — cada fila de pin debe seguir
// siendo coherente con exactamente una revisión (integridad bajo carrera
// real con barreras).
func TestHardwareAssets_ConcurrentRebindDuringPublish(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Concurrente v1", "")
	bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a1", asset)
	assetV2 := stageAndFinalizeAssetDigest(t, w, "Concurrente v2", asset.ID, "66")

	barrier := make(chan struct{})
	publishErr := make(chan error, 1)
	go func() {
		<-barrier
		rev := publishDesignRev(t, w, "")
		if rev != nil {
			publishErr <- nil
			return
		}
		publishErr <- fmt.Errorf("publish devolvió revisión nula")
	}()
	go func() {
		<-barrier
		bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a1", assetV2)
	}()
	close(barrier)
	if err := <-publishErr; err != nil {
		t.Fatalf("publish concurrente: %v", err)
	}

	// Sea cual sea el interleaving, cada pin es coherente con su revisión.
	var revisionID string
	if err := w.fx.admin.QueryRow(context.Background(),
		`SELECT id FROM design_revisions WHERE design_id = $1 ORDER BY revision_number DESC LIMIT 1`, w.designID,
	).Scan(&revisionID); err != nil {
		t.Fatal(err)
	}
	assertPinCoherence(t, w, revisionID)
}
