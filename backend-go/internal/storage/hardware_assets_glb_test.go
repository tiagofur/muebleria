package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #669 GLB derivation flow: a GLB revision prepared from an exact SKP
// revision carries derivation provenance, binding resolution exposes it as
// the web co-representation, publish freezes the exact derived GLB, and a
// later re-export never rewrites a frozen pin.

func glbSummaryForTest() *domain.GlbDocumentSummary {
	return &domain.GlbDocumentSummary{
		Generator:   "granete-sketchup-glb-exporter 1.0.0",
		Scenes:      1,
		Nodes:       1,
		Meshes:      1,
		Materials:   1,
		Accessors:   2,
		Triangles:   20,
		Vertices:    12,
		BufferBytes: 1088,
	}
}

// stageDerivedGlb uploads a GLB revision derived from the given SKP revision
// (metadata-only promote like the other storage fixtures).
func stageDerivedGlb(t *testing.T, w *hwAssetWorld, assetID, sourceRevisionID, digestSeed string) *domain.HardwareAsset {
	t.Helper()
	var asset *domain.HardwareAsset
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		res, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationGLB,
			DisplayName:    "Jaladera GLB",
			TargetAssetID:  assetID,
			Origin:         json.RawMessage(`{"sourceUnits":"m","upAxis":"y"}`),
			Derivation: &domain.HardwareAssetDerivation{
				SourceRevisionID: sourceRevisionID,
				ExporterName:     "granete-sketchup-glb-exporter",
				ExporterVersion:  "1.0.0",
			},
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		session := res.Session
		storageKey := "hardware-assets/" + session.ID + "/glb-" + strings.Repeat(digestSeed, 6)[:12] + ".glb"
		if _, err := w.fx.store.PromoteHardwareAssetSessionBytes(ctx, storage.PromoteHardwareAssetSessionBytesCommand{
			SessionID:      session.ID,
			StorageKey:     storageKey,
			ContentType:    "model/gltf-binary",
			SizeBytes:      1248,
			SHA256:         hwAssetSHA(digestSeed),
			Representation: domain.HardwareAssetRepresentationGLB,
		}); err != nil {
			return err
		}
		asset, err = w.fx.store.FinalizeHardwareAssetUpload(ctx, storage.FinalizeHardwareAssetUploadCommand{
			SessionID:   session.ID,
			ActorUserID: rlsUserA,
			GlbSummary:  glbSummaryForTest(),
		})
		return err
	})
	if err != nil {
		t.Fatalf("stage derived glb: %v", err)
	}
	return asset
}

func TestHardwareAssets_GlbDerivationProvenanceAndFailClosedFrontiers(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Jaladera SKP", "")
	skpRevision := asset.Revisions[0]

	// A derivation block is refused on non-GLB uploads.
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationSKP,
			DisplayName:    "otro skp",
			TargetAssetID:  asset.ID,
			Derivation: &domain.HardwareAssetDerivation{
				SourceRevisionID: skpRevision.ID,
				ExporterName:     "granete-sketchup-glb-exporter",
				ExporterVersion:  "1.0.0",
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrHardwareAssetInvalid) {
		t.Fatalf("derivation on skp upload = %v", err)
	}

	// A derivation source from ANOTHER asset is rejected.
	other := stageAndFinalizeAsset(t, w, "Otro asset", "")
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationGLB,
			DisplayName:    "glb de otro asset",
			TargetAssetID:  asset.ID,
			Derivation: &domain.HardwareAssetDerivation{
				SourceRevisionID: other.Revisions[0].ID,
				ExporterName:     "granete-sketchup-glb-exporter",
				ExporterVersion:  "1.0.0",
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrHardwareAssetRevisionNotFound) && !errors.Is(err, domain.ErrHardwareAssetInvalid) {
		t.Fatalf("cross-asset derivation source = %v", err)
	}

	// GLB finalize without the structural validation summary is refused —
	// an unvalidated GLB revision can never exist. The staged session and the
	// SKP revision survive; only the GLB revision is never created.
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		res, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationGLB,
			DisplayName:    "glb sin summary",
			TargetAssetID:  asset.ID,
			Origin:         json.RawMessage(`{"sourceUnits":"m","upAxis":"y"}`),
			Derivation: &domain.HardwareAssetDerivation{
				SourceRevisionID: skpRevision.ID,
				ExporterName:     "granete-sketchup-glb-exporter",
				ExporterVersion:  "1.0.0",
			},
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		session := res.Session
		storageKey := "hardware-assets/" + session.ID + "/glb-aabbccddeeff.glb"
		if _, err := w.fx.store.PromoteHardwareAssetSessionBytes(ctx, storage.PromoteHardwareAssetSessionBytesCommand{
			SessionID:      session.ID,
			StorageKey:     storageKey,
			ContentType:    "model/gltf-binary",
			SizeBytes:      1248,
			SHA256:         hwAssetSHA("ab"),
			Representation: domain.HardwareAssetRepresentationGLB,
		}); err != nil {
			return err
		}
		_, err = w.fx.store.FinalizeHardwareAssetUpload(ctx, storage.FinalizeHardwareAssetUploadCommand{
			SessionID:   session.ID,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrHardwareAssetInvalid) {
		t.Fatalf("glb finalize without summary = %v", err)
	}

	// Happy path: derived GLB revision with full provenance.
	withGlb := stageDerivedGlb(t, w, asset.ID, skpRevision.ID, "33")
	if len(withGlb.Revisions) != 2 {
		t.Fatalf("revisions = %+v", withGlb.Revisions)
	}
	glbRevision := withGlb.Revisions[1]
	if glbRevision.Representation != domain.HardwareAssetRepresentationGLB {
		t.Fatalf("new revision representation = %q", glbRevision.Representation)
	}
	if glbRevision.SourceRevisionID != skpRevision.ID {
		t.Fatalf("source_revision_id = %q, want the pinned SKP revision", glbRevision.SourceRevisionID)
	}
	if glbRevision.ExporterName != "granete-sketchup-glb-exporter" || glbRevision.ExporterVersion != "1.0.0" {
		t.Fatalf("exporter provenance = %q / %q", glbRevision.ExporterName, glbRevision.ExporterVersion)
	}

	// The structural validation is recorded as append-only evidence, so the
	// derived revision's validation state is 'validated' by fact.
	if glbRevision.ValidationState != domain.HardwareAssetValidationValidated {
		t.Fatalf("glb revision validation state = %q", glbRevision.ValidationState)
	}
	// ValidationState is derived from the latest evidence row, so 'validated'
	// proves the granete-glb-structure-validator evidence exists.
}

func TestHardwareAssets_BindingResolvesDerivedGlbAndPublishFreezesIt(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Jaladera SKP", "")
	skpRevision := asset.Revisions[0]

	// Before any derived GLB exists the binding exposes no glb block.
	binding := bindHardwareToRevision(t, w, "74000000-0000-0000-0000-0000000000a1", asset)
	if binding.Glb != nil {
		t.Fatalf("binding must not invent a glb representation: %+v", binding.Glb)
	}

	// Derived GLB G1 appears: binding resolves it with the declared space.
	withG1 := stageDerivedGlb(t, w, asset.ID, skpRevision.ID, "44")
	g1 := withG1.Revisions[1]
	binding = resolveBindingFor(t, w, asset.ID, skpRevision.ID)
	if binding.Glb == nil {
		t.Fatal("binding must expose the derived glb")
	}
	if binding.Glb.RevisionID != g1.ID || binding.Glb.SourceRevisionID != skpRevision.ID {
		t.Fatalf("binding glb = %+v", binding.Glb)
	}
	if binding.Glb.SourceUnits != "m" || binding.Glb.UpAxis != "y" {
		t.Fatalf("binding glb space = %q/%q", binding.Glb.SourceUnits, binding.Glb.UpAxis)
	}

	// Publish R1: the pin freezes the EXACT derived GLB G1.
	rev1 := publishDesignRev(t, w, "")
	pins1 := mustListPins(t, w, rev1.ID)
	if len(pins1) != 1 {
		t.Fatalf("R1 pins = %+v", pins1)
	}
	if pins1[0].GlbRevisionID == nil || *pins1[0].GlbRevisionID != g1.ID {
		t.Fatalf("R1 pin glb = %+v", pins1[0].GlbRevisionID)
	}

	// Re-export G2 (new derived revision of the same SKP): the LIVE binding
	// moves to G2 (deterministic latest) but the R1 pin stays on G1.
	withG2 := stageDerivedGlb(t, w, asset.ID, skpRevision.ID, "55")
	g2 := withG2.Revisions[2]
	if g2.RevisionNumber <= g1.RevisionNumber {
		t.Fatalf("G2 must be a newer revision: %+v", withG2.Revisions)
	}
	binding = resolveBindingFor(t, w, asset.ID, skpRevision.ID)
	if binding.Glb == nil || binding.Glb.RevisionID != g2.ID {
		t.Fatalf("live binding must resolve the latest derived glb, got %+v", binding.Glb)
	}
	pinsAfter := mustListPins(t, w, rev1.ID)
	if pinsAfter[0].GlbRevisionID == nil || *pinsAfter[0].GlbRevisionID != g1.ID {
		t.Fatalf("R1 pin must stay frozen on G1, got %+v", pinsAfter[0].GlbRevisionID)
	}
}

func TestHardwareAssets_DerivationSourceIsTenantScoped(t *testing.T) {
	w := newHwAssetWorld(t)
	asset := stageAndFinalizeAsset(t, w, "Jaladera SKP org A", "")

	// Actor B (another organization) cannot derive from org A's revision.
	err := fiTx(t, w.fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := w.fx.store.CreateHardwareAssetUploadSession(ctx, storage.CreateHardwareAssetUploadSessionCommand{
			Representation: domain.HardwareAssetRepresentationGLB,
			DisplayName:    "glb cruzado",
			TargetAssetID:  asset.ID,
			Derivation: &domain.HardwareAssetDerivation{
				SourceRevisionID: asset.Revisions[0].ID,
				ExporterName:     "granete-sketchup-glb-exporter",
				ExporterVersion:  "1.0.0",
			},
			ActorUserID: rlsUserB,
		})
		return err
	})
	if err == nil {
		t.Fatal("cross-org derivation source must fail closed")
	}
	if !errors.Is(err, domain.ErrHardwareAssetRevisionNotFound) &&
		!errors.Is(err, domain.ErrHardwareAssetInvalid) &&
		!errors.Is(err, domain.ErrHardwareAssetNotFound) &&
		!strings.Contains(err.Error(), "no rows") {
		t.Fatalf("cross-org derivation source must fail with a typed tenant-scoped error, got %v", err)
	}
}

func resolveBindingFor(t *testing.T, w *hwAssetWorld, assetID, revisionID string) *domain.HardwareVisualAssetBinding {
	t.Helper()
	var binding *domain.HardwareVisualAssetBinding
	err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		resolved, err := w.fx.store.ResolveHardwareVisualAssetBinding(ctx, assetID, revisionID)
		binding = resolved
		return err
	})
	if err != nil {
		t.Fatalf("resolve binding: %v", err)
	}
	return binding
}

