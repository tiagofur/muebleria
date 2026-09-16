package storage_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestHardwareAssets_MountFrameAndAssetNormalizationRoundtrip(t *testing.T) {
	w := newHwAssetWorld(t)

	originJSON := json.RawMessage(`{
		"sourceUnits": "mm",
		"upAxis": "z",
		"mountFrame": {
			"originMm": [0.0, 15.0, 30.0],
			"basis": {
				"x": [1.0, 0.0, 0.0],
				"y": [0.0, 1.0, 0.0],
				"z": [0.0, 0.0, 1.0]
			}
		},
		"assetNormalization": {
			"translationMm": [0.0, -15.0, -30.0],
			"basis": {
				"x": [1.0, 0.0, 0.0],
				"y": [0.0, 1.0, 0.0],
				"z": [0.0, 0.0, 1.0]
			}
		}
	}`)

	var asset *domain.HardwareAsset
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		res, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationSKP,
			DisplayName:    "Jaladera Tubular con MountFrame",
			Provenance:     "Fabricante Demo",
			License:        "Comercial",
			Origin:         originJSON,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		session := res.Session
		storageKey := "hardware-assets/" + session.ID + "/skp-prepared.skp"
		sha := "sha256-" + strings.Repeat("a1", 32)
		if _, err := w.fx.store.PromoteHardwareAssetSessionBytes(ctx, storage.PromoteHardwareAssetSessionBytesCommand{
			SessionID:      session.ID,
			StorageKey:     storageKey,
			ContentType:    "application/octet-stream",
			SizeBytes:      1024,
			SHA256:         sha,
			Representation: domain.HardwareAssetRepresentationSKP,
		}); err != nil {
			return err
		}
		a, err := w.fx.store.FinalizeHardwareAssetUpload(ctx, storage.FinalizeHardwareAssetUploadCommand{
			SessionID:   session.ID,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		asset = a
		return nil
	})
	if err != nil {
		t.Fatalf("finalize asset with mount frame: %v", err)
	}

	if len(asset.Revisions) != 1 {
		t.Fatalf("expected 1 revision, got %d", len(asset.Revisions))
	}
	r1 := asset.Revisions[0]
	if r1.Origin == nil || r1.Origin.MountFrame == nil || r1.Origin.AssetNormalization == nil {
		t.Fatalf("expected origin with MountFrame and AssetNormalization, got %+v", r1.Origin)
	}
	if r1.Origin.MountFrame.OriginMm != [3]float64{0.0, 15.0, 30.0} {
		t.Errorf("expected MountFrame origin [0, 15, 30], got %v", r1.Origin.MountFrame.OriginMm)
	}
	if r1.Origin.AssetNormalization.TranslationMm != [3]float64{0.0, -15.0, -30.0} {
		t.Errorf("expected AssetNormalization translation [0, -15, -30], got %v", r1.Origin.AssetNormalization.TranslationMm)
	}
	if r1.PreparationState() != domain.HardwareAssetPreparationPrepared {
		t.Errorf("expected PreparationState=prepared, got %s", r1.PreparationState())
	}

	// Read directly via GetHardwareAssetRevision
	var fetchedRev *domain.HardwareAssetRevision
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		rev, err := w.fx.store.GetHardwareAssetRevision(ctx, asset.ID, r1.ID)
		if err != nil {
			return err
		}
		fetchedRev = rev
		return nil
	})
	if err != nil {
		t.Fatalf("GetHardwareAssetRevision failed: %v", err)
	}
	if fetchedRev.Origin == nil || fetchedRev.Origin.MountFrame == nil {
		t.Fatalf("fetched revision missing MountFrame: %+v", fetchedRev.Origin)
	}
}

func TestHardwareAssets_Immutability_OriginCannotBeUpdatedOnR1(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Jaladera R1 Inmutable", "")
	r1 := asset.Revisions[0]

	// Direct SQL UPDATE must be rejected by PostgreSQL immutability trigger
	newOrigin := `{"sourceUnits":"mm","upAxis":"z","mountFrame":{"originMm":[99,99,99]}}`
	_, err := w.fx.admin.Exec(context.Background(), `UPDATE hardware_asset_revisions SET origin = $1::jsonb WHERE id = $2`, newOrigin, r1.ID)
	if err == nil {
		t.Fatalf("expected error updating immutable revision row, got nil")
	}
	if !strings.Contains(err.Error(), "hardware_asset_revisions is immutable once written") {
		t.Errorf("expected immutability error message, got %v", err)
	}
}

func TestHardwareAssets_R2CanShareSHAWithNewPreparation(t *testing.T) {
	w := newHwAssetWorld(t)
	sha := "sha256-" + strings.Repeat("33", 32)

	// Finalize R1 with initial MountFrame
	originR1 := json.RawMessage(`{
		"sourceUnits": "mm",
		"upAxis": "z",
		"mountFrame": {
			"originMm": [0.0, 0.0, 0.0],
			"basis": {"x":[1,0,0],"y":[0,1,0],"z":[0,0,1]}
		},
		"assetNormalization": {
			"translationMm": [0.0, 0.0, 0.0],
			"basis": {"x":[1,0,0],"y":[0,1,0],"z":[0,0,1]}
		}
	}`)
	var asset *domain.HardwareAsset
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		res, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationSKP,
			DisplayName:    "Jaladera Piloto",
			Provenance:     "Test",
			Origin:         originR1,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		storageKey := "hardware-assets/" + res.Session.ID + "/jaladera.skp"
		if _, err := w.fx.store.PromoteHardwareAssetSessionBytes(ctx, storage.PromoteHardwareAssetSessionBytesCommand{
			SessionID:      res.Session.ID,
			StorageKey:     storageKey,
			ContentType:    "application/octet-stream",
			SizeBytes:      2048,
			SHA256:         sha,
			Representation: domain.HardwareAssetRepresentationSKP,
		}); err != nil {
			return err
		}
		a, err := w.fx.store.FinalizeHardwareAssetUpload(ctx, storage.FinalizeHardwareAssetUploadCommand{
			SessionID:   res.Session.ID,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		asset = a
		return nil
	})
	if err != nil {
		t.Fatalf("create R1: %v", err)
	}

	// Finalize R2 on same asset (TargetAssetID = asset.ID), using the SAME SHA256 bytes,
	// but with an adjusted MountFrame (e.g. origin shifted by 10mm)
	originR2 := json.RawMessage(`{
		"sourceUnits": "mm",
		"upAxis": "z",
		"mountFrame": {
			"originMm": [10.0, 0.0, 0.0],
			"basis": {"x":[1,0,0],"y":[0,1,0],"z":[0,0,1]}
		},
		"assetNormalization": {
			"translationMm": [-10.0, 0.0, 0.0],
			"basis": {"x":[1,0,0],"y":[0,1,0],"z":[0,0,1]}
		}
	}`)
	var assetAfterR2 *domain.HardwareAsset
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		res, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationSKP,
			DisplayName:    "Jaladera Piloto R2",
			Provenance:     "Test",
			TargetAssetID:  asset.ID,
			Origin:         originR2,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		storageKey := "hardware-assets/" + res.Session.ID + "/jaladera.skp"
		if _, err := w.fx.store.PromoteHardwareAssetSessionBytes(ctx, storage.PromoteHardwareAssetSessionBytesCommand{
			SessionID:      res.Session.ID,
			StorageKey:     storageKey,
			ContentType:    "application/octet-stream",
			SizeBytes:      2048,
			SHA256:         sha,
			Representation: domain.HardwareAssetRepresentationSKP,
		}); err != nil {
			return err
		}
		a, err := w.fx.store.FinalizeHardwareAssetUpload(ctx, storage.FinalizeHardwareAssetUploadCommand{
			SessionID:   res.Session.ID,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		assetAfterR2 = a
		return nil
	})
	if err != nil {
		t.Fatalf("create R2: %v", err)
	}

	if len(assetAfterR2.Revisions) != 2 {
		t.Fatalf("expected 2 revisions, got %d", len(assetAfterR2.Revisions))
	}
	r1After := assetAfterR2.Revisions[0]
	r2After := assetAfterR2.Revisions[1]

	// Invariant check: R1 origin is untouched!
	if r1After.Origin.MountFrame.OriginMm != [3]float64{0.0, 0.0, 0.0} {
		t.Errorf("R1 origin was mutated! Got %v", r1After.Origin.MountFrame.OriginMm)
	}
	// R2 has new origin:
	if r2After.Origin.MountFrame.OriginMm != [3]float64{10.0, 0.0, 0.0} {
		t.Errorf("R2 origin mismatch! Got %v", r2After.Origin.MountFrame.OriginMm)
	}
	// Same SHA256 preserved:
	if r1After.SHA256 != sha || r2After.SHA256 != sha {
		t.Errorf("expected both revisions to share SHA256 %s, got r1=%s r2=%s", sha, r1After.SHA256, r2After.SHA256)
	}
}

func TestHardwareAssets_ValidationMeasuredBoundsDoesNotMutateRevision(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Jaladera Medida", "")
	r1 := asset.Revisions[0]

	// Host sends validation report with measuredBoundsMm in details
	detailsJSON := json.RawMessage(`{
		"tool": "sketchup-validator-v1",
		"host": {
			"version": "24.0.553",
			"os": "mac"
		},
		"measuredBoundsMm": {
			"width": 160.4,
			"height": 22.1,
			"depth": 37.0
		},
		"bounds": {
			"empty": false,
			"width_mm": 160.4,
			"height_mm": 22.1,
			"depth_mm": 37.0,
			"diagonal_mm": 166.0,
			"min_mm": [-80.2, -11.0, 0.0],
			"max_mm": [80.2, 11.1, 37.0]
		}
	}`)

	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		return w.fx.store.RecordHardwareAssetValidation(ctx, storage.RecordHardwareAssetValidationCommand{
			AssetID:     asset.ID,
			RevisionID:  r1.ID,
			SHA256:      r1.SHA256,
			Tool:        "sketchup-validator-v1",
			Result:      "passed",
			Details:     detailsJSON,
			ActorUserID: rlsUserA,
		})
	})
	if err != nil {
		t.Fatalf("record validation with measured bounds: %v", err)
	}

	// Verify revision row was NOT mutated:
	var fetchedRev *domain.HardwareAssetRevision
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		rev, err := w.fx.store.GetHardwareAssetRevision(ctx, asset.ID, r1.ID)
		if err != nil {
			return err
		}
		fetchedRev = rev
		return nil
	})
	if err != nil {
		t.Fatalf("fetch revision: %v", err)
	}

	// ValidationState is now validated
	if fetchedRev.ValidationState != domain.HardwareAssetValidationValidated {
		t.Errorf("expected ValidationState=validated, got %s", fetchedRev.ValidationState)
	}

	// Revision Origin is completely unmodified and does NOT contain measuredBoundsMm
	if fetchedRev.Origin == nil || fetchedRev.Origin.SourceUnits != "mm" {
		t.Errorf("origin corrupted: %+v", fetchedRev.Origin)
	}
}
