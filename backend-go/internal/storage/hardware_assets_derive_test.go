package storage_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestHardwareAssets_DeriveRevision_ByteReuseAndImmutability(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Jaladera Base R1", "")
	if len(asset.Revisions) != 1 {
		t.Fatalf("expected 1 revision, got %d", len(asset.Revisions))
	}
	r1 := asset.Revisions[0]
	if r1.PreparationState() != domain.HardwareAssetPreparationUnprepared {
		t.Fatalf("expected R1 to be unprepared, got %s", r1.PreparationState())
	}

	mountOriginJSON := []byte(`{
		"sourceUnits": "mm",
		"upAxis": "z",
		"mountFrame": {
			"originMm": [10.0, 20.0, 30.0],
			"basis": {
				"x": [1.0, 0.0, 0.0],
				"y": [0.0, 1.0, 0.0],
				"z": [0.0, 0.0, 1.0]
			}
		}
	}`)

	var r2 *domain.HardwareAssetRevision
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		rev, err := w.fx.store.DeriveHardwareAssetRevision(ctx, storage.DeriveHardwareAssetRevisionCommand{
			AssetID:          asset.ID,
			SourceRevisionID: r1.ID,
			Origin:           mountOriginJSON,
			ActorUserID:      rlsUserA,
		})
		if err != nil {
			return err
		}
		r2 = rev
		return nil
	})
	if err != nil {
		t.Fatalf("DeriveHardwareAssetRevision failed: %v", err)
	}

	// Verify R2 byte and metadata reuse
	if r2.RevisionNumber != 2 {
		t.Errorf("expected revision_number 2, got %d", r2.RevisionNumber)
	}
	if r2.StorageKey != r1.StorageKey {
		t.Errorf("expected storage_key %q, got %q", r1.StorageKey, r2.StorageKey)
	}
	if r2.SHA256 != r1.SHA256 {
		t.Errorf("expected sha256 %q, got %q", r1.SHA256, r2.SHA256)
	}
	if r2.SizeBytes != r1.SizeBytes {
		t.Errorf("expected size_bytes %d, got %d", r1.SizeBytes, r2.SizeBytes)
	}
	if r2.Representation != r1.Representation {
		t.Errorf("expected representation %q, got %q", r1.Representation, r2.Representation)
	}
	if r2.ContentType != r1.ContentType {
		t.Errorf("expected content_type %q, got %q", r1.ContentType, r2.ContentType)
	}
	if r2.ValidationState != domain.HardwareAssetValidationPending {
		t.Errorf("expected validation_state pending, got %q", r2.ValidationState)
	}
	if r2.Origin == nil || r2.Origin.MountFrame == nil {
		t.Fatalf("expected R2 to have MountFrame in Origin, got %+v", r2.Origin)
	}
	if r2.PreparationState() != domain.HardwareAssetPreparationPrepared {
		t.Errorf("expected R2 to be prepared, got %s", r2.PreparationState())
	}
	expectedNorm := [3]float64{-10.0, -20.0, -30.0}
	if r2.Origin.AssetNormalization == nil || r2.Origin.AssetNormalization.TranslationMm != expectedNorm {
		t.Errorf("expected derived translation %v, got %+v", expectedNorm, r2.Origin.AssetNormalization)
	}

	// Verify asset re-read: R1 remains unchanged, R2 appended
	var reloaded *domain.HardwareAsset
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		a, err := w.fx.store.GetHardwareAsset(ctx, asset.ID)
		if err != nil {
			return err
		}
		reloaded = a
		return nil
	})
	if err != nil {
		t.Fatalf("GetHardwareAsset failed: %v", err)
	}
	if len(reloaded.Revisions) != 2 {
		t.Fatalf("expected 2 revisions, got %d", len(reloaded.Revisions))
	}
	reloadedR1 := reloaded.Revisions[0]
	if reloadedR1.RevisionNumber != 1 {
		t.Errorf("expected R1 revision_number 1, got %d", reloadedR1.RevisionNumber)
	}
	if reloadedR1.PreparationState() != domain.HardwareAssetPreparationUnprepared {
		t.Errorf("expected R1 to remain unprepared, got %s", reloadedR1.PreparationState())
	}
	reloadedR2 := reloaded.Revisions[1]
	if reloadedR2.RevisionNumber != 2 {
		t.Errorf("expected R2 revision_number 2, got %d", reloadedR2.RevisionNumber)
	}
	if reloadedR2.PreparationState() != domain.HardwareAssetPreparationPrepared {
		t.Errorf("expected R2 to be prepared, got %s", reloadedR2.PreparationState())
	}
}

func TestHardwareAssets_DeriveRevision_ConcurrentFinalizeAndDerive(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Jaladera Concurrencia R1", "")
	r1 := asset.Revisions[0]

	// 1. Prepare a second upload session targeting the same asset (replace flow)
	var uploadSession *domain.HardwareAssetUploadSession
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		res, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationSKP,
			DisplayName:    "Jaladera Concurrencia Finalize R2",
			TargetAssetID:  asset.ID,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		uploadSession = res.Session
		storageKey := fmt.Sprintf("hardware-assets/%s/upload.skp", uploadSession.ID)
		sha := "sha256-" + strings.Repeat("bb", 32)
		if _, err := w.fx.store.PromoteHardwareAssetSessionBytes(ctx, storage.PromoteHardwareAssetSessionBytesCommand{
			SessionID:      uploadSession.ID,
			StorageKey:     storageKey,
			ContentType:    "application/octet-stream",
			SizeBytes:      2048,
			SHA256:         sha,
			Representation: domain.HardwareAssetRepresentationSKP,
		}); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		t.Fatalf("prepare upload session failed: %v", err)
	}

	mountOriginJSON := []byte(`{
		"sourceUnits": "mm",
		"upAxis": "z",
		"mountFrame": {
			"originMm": [0.0, 0.0, 0.0],
			"basis": {
				"x": [1.0, 0.0, 0.0],
				"y": [0.0, 1.0, 0.0],
				"z": [0.0, 0.0, 1.0]
			}
		}
	}`)

	// 2. Concurrently execute FinalizeHardwareAssetUpload and DeriveHardwareAssetRevision
	var wg sync.WaitGroup
	wg.Add(2)
	var errFinalize, errDerive error

	go func() {
		defer wg.Done()
		errFinalize = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
			_, err := w.fx.store.FinalizeHardwareAssetUpload(ctx, storage.FinalizeHardwareAssetUploadCommand{
				SessionID:   uploadSession.ID,
				ActorUserID: rlsUserA,
			})
			return err
		})
	}()

	go func() {
		defer wg.Done()
		errDerive = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
			_, err := w.fx.store.DeriveHardwareAssetRevision(ctx, storage.DeriveHardwareAssetRevisionCommand{
				AssetID:          asset.ID,
				SourceRevisionID: r1.ID,
				Origin:           mountOriginJSON,
				ActorUserID:      rlsUserA,
			})
			return err
		})
	}()

	wg.Wait()

	if errFinalize != nil {
		t.Errorf("concurrent finalize failed: %v", errFinalize)
	}
	if errDerive != nil {
		t.Errorf("concurrent derive failed: %v", errDerive)
	}

	// 3. Re-read asset and verify revisions: must be exactly 3 revisions with numbers 1, 2, 3
	var reloaded *domain.HardwareAsset
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		a, err := w.fx.store.GetHardwareAsset(ctx, asset.ID)
		if err != nil {
			return err
		}
		reloaded = a
		return nil
	})
	if err != nil {
		t.Fatalf("GetHardwareAsset failed: %v", err)
	}

	if len(reloaded.Revisions) != 3 {
		t.Fatalf("expected 3 revisions after concurrent derive+finalize, got %d", len(reloaded.Revisions))
	}

	seenNumbers := make(map[int]bool)
	for _, rev := range reloaded.Revisions {
		if seenNumbers[rev.RevisionNumber] {
			t.Errorf("duplicate revision_number detected: %d", rev.RevisionNumber)
		}
		seenNumbers[rev.RevisionNumber] = true
	}
	for i := 1; i <= 3; i++ {
		if !seenNumbers[i] {
			t.Errorf("missing revision_number %d in consecutive sequence", i)
		}
	}
}

func TestHardwareAssets_DeriveRevision_ValidationAndMultiTenant(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Jaladera Tenant A", "")
	r1 := asset.Revisions[0]

	mountOriginJSON := []byte(`{
		"sourceUnits": "mm",
		"upAxis": "z",
		"mountFrame": {
			"originMm": [0.0, 0.0, 0.0],
			"basis": {
				"x": [1.0, 0.0, 0.0],
				"y": [0.0, 1.0, 0.0],
				"z": [0.0, 0.0, 1.0]
			}
		}
	}`)

	// Reject without MountFrame
	invalidOriginJSON := []byte(`{"sourceUnits":"mm","upAxis":"z"}`)
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := w.fx.store.DeriveHardwareAssetRevision(ctx, storage.DeriveHardwareAssetRevisionCommand{
			AssetID:          asset.ID,
			SourceRevisionID: r1.ID,
			Origin:           invalidOriginJSON,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrHardwareAssetInvalid) {
		t.Errorf("expected ErrHardwareAssetInvalid for origin without mountFrame, got %v", err)
	}

	// Multi-tenant isolation: Actor B cannot derive from Asset of Tenant A
	err = fiTx(t, w.fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := w.fx.store.DeriveHardwareAssetRevision(ctx, storage.DeriveHardwareAssetRevisionCommand{
			AssetID:          asset.ID,
			SourceRevisionID: r1.ID,
			Origin:           mountOriginJSON,
			ActorUserID:      rlsUserB,
		})
		return err
	})
	if !errors.Is(err, domain.ErrHardwareAssetNotFound) {
		t.Errorf("expected ErrHardwareAssetNotFound for foreign tenant asset, got %v", err)
	}

	// Cannot derive on retired asset
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		return w.fx.store.RetireHardwareAsset(ctx, storage.RetireHardwareAssetCommand{
			AssetID:     asset.ID,
			ActorUserID: rlsUserA,
		})
	})
	if err != nil {
		t.Fatalf("retire asset failed: %v", err)
	}

	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := w.fx.store.DeriveHardwareAssetRevision(ctx, storage.DeriveHardwareAssetRevisionCommand{
			AssetID:          asset.ID,
			SourceRevisionID: r1.ID,
			Origin:           mountOriginJSON,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrHardwareAssetRetired) {
		t.Errorf("expected ErrHardwareAssetRetired, got %v", err)
	}
}
