package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Contrato: bindings visuales de herrajes — resolución del asset/representación
// por binding y adjunción de bindings a listas de herrajes.
func (s *PostgresStore) ResolveHardwareVisualAssetBinding(ctx context.Context, assetID, revisionID string) (*domain.HardwareVisualAssetBinding, error) {
	if !isValidUUID(assetID) || !isValidUUID(revisionID) {
		return nil, fmt.Errorf("%w: asset/revision identifiers required", domain.ErrHardwareAssetBindingInvalid)
	}
	var (
		revisionIDRow  string
		assetStatus    string
		representation string
		sha256         string
		sizeBytes      int64
		sourceRevID    *string
		originRaw      []byte
		evidence       *string
	)
	err := s.db(ctx).QueryRow(ctx, `
		SELECT r.id, a.status, r.representation, r.sha256, r.size_bytes, r.source_revision_id, r.origin,
		       (SELECT v.result FROM hardware_asset_validations v
		        WHERE v.revision_id = r.id ORDER BY v.created_at DESC, v.id DESC LIMIT 1)
		FROM hardware_assets a
		JOIN hardware_asset_revisions r ON r.asset_id = a.id AND r.id = $2
		WHERE a.id = $1 AND a.organization_id = $3
	`, assetID, revisionID, OrgFromCtx(ctx)).Scan(&revisionIDRow, &assetStatus, &representation, &sha256, &sizeBytes, &sourceRevID, &originRaw, &evidence)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Neutral: an unknown revision and a foreign one are
			// indistinguishable to the caller (no existence oracle).
			return nil, fmt.Errorf("%w: revisión de recurso no disponible", domain.ErrHardwareAssetBindingInvalid)
		}
		return nil, err
	}
	if assetStatus == string(domain.HardwareAssetStatusRetired) {
		return nil, domain.ErrHardwareAssetRetired
	}
	rep := domain.HardwareAssetRepresentation(representation)
	if rep == domain.HardwareAssetRepresentationThumbnail {
		return nil, fmt.Errorf("%w: una miniatura no puede ser el modelo del herraje", domain.ErrHardwareAssetBindingInvalid)
	}
	binding := &domain.HardwareVisualAssetBinding{
		AssetID:          assetID,
		AssetRevisionID:  revisionID,
		Representation:   rep,
		SHA256:           sha256,
		SizeBytes:        sizeBytes,
		PreparationState: domain.HardwareAssetPreparationUnprepared,
	}
	var origin *domain.HardwareAssetOrigin
	if len(originRaw) > 0 && string(originRaw) != "null" {
		origin, err = domain.ValidateHardwareAssetOrigin(json.RawMessage(originRaw))
		if err != nil {
			return nil, fmt.Errorf("%w: origen del recurso inválido: %v", domain.ErrHardwareAssetBindingInvalid, err)
		}
		if origin != nil {
			rev := domain.HardwareAssetRevision{Origin: origin}
			binding.PreparationState = rev.PreparationState()
			if binding.PreparationState == domain.HardwareAssetPreparationPrepared {
				binding.MountFrame = origin.MountFrame
			}
		}
	}
	switch {
	case evidence == nil:
		binding.ValidationState = domain.HardwareAssetValidationPending
	case *evidence == "passed":
		binding.ValidationState = domain.HardwareAssetValidationValidated
	default:
		binding.ValidationState = domain.HardwareAssetValidationFailed
	}

	// #669 server-resolved GLB co-representation for web consumers: a GLB
	// binding mirrors itself; an SKP binding resolves the latest derived GLB
	// of exactly this revision (deterministic rule). Nil when none exists or
	// its provenance is unreadable — never an invented block.
	if rep == domain.HardwareAssetRepresentationGLB {
		binding.Glb = hardwareAssetGlbRepresentation(rep, revisionID, sha256, sizeBytes, "", origin)
	} else {
		derived, err := s.latestDerivedGlbRevision(ctx, assetID, revisionID)
		if err != nil {
			derived = nil // fail-honest: unreadable provenance omits the block
		}
		if derived != nil {
			binding.Glb = hardwareAssetGlbRepresentation(derived.Representation, derived.ID, derived.SHA256, derived.SizeBytes, derived.SourceRevisionID, derived.Origin)
		}
	}
	return binding, nil
}

// hardwareAssetValidationStates derives the authoritative validation state of
// each revision from its latest evidence row (no evidence = pending). The
// revision rows themselves are immutable.
func (s *PostgresStore) attachHardwareVisualBindings(ctx context.Context, items []domain.Hardware) error {
	revisionIDs := make([]string, 0, len(items))
	for _, h := range items {
		if h.VisualAsset != nil && h.VisualAsset.AssetRevisionID != "" {
			revisionIDs = append(revisionIDs, h.VisualAsset.AssetRevisionID)
		}
	}
	if len(revisionIDs) == 0 {
		return nil
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT r.id, r.representation, r.sha256, r.size_bytes, r.source_revision_id, r.origin
		FROM hardware_asset_revisions r
		WHERE r.organization_id = $1 AND r.id = ANY($2::uuid[])
	`, OrgFromCtx(ctx), revisionIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	type revisionFacts struct {
		Representation   domain.HardwareAssetRepresentation
		SHA256           string
		SizeBytes        int64
		SourceRevisionID string
		Origin           *domain.HardwareAssetOrigin
		PreparationState domain.HardwareAssetPreparationState
		MountFrame       *domain.HardwareMountFrame
	}
	details := map[string]revisionFacts{}
	for rows.Next() {
		var revisionID, representation, sha256 string
		var sizeBytes int64
		var sourceRevisionID *string
		var originRaw []byte
		if err := rows.Scan(&revisionID, &representation, &sha256, &sizeBytes, &sourceRevisionID, &originRaw); err != nil {
			return err
		}
		prepState := domain.HardwareAssetPreparationUnprepared
		var mountFrame *domain.HardwareMountFrame
		var origin *domain.HardwareAssetOrigin
		if len(originRaw) > 0 && string(originRaw) != "null" {
			origin, err = domain.ValidateHardwareAssetOrigin(json.RawMessage(originRaw))
			if err != nil {
				return fmt.Errorf("%w: revision %s origen del recurso inválido: %v", domain.ErrHardwareAssetBindingInvalid, revisionID, err)
			}
			if origin != nil {
				rev := domain.HardwareAssetRevision{Origin: origin}
				prepState = rev.PreparationState()
				if prepState == domain.HardwareAssetPreparationPrepared {
					mountFrame = origin.MountFrame
				}
			}
		}
		facts := revisionFacts{
			Representation:   domain.HardwareAssetRepresentation(representation),
			SHA256:           sha256,
			SizeBytes:        sizeBytes,
			Origin:           origin,
			PreparationState: prepState,
			MountFrame:       mountFrame,
		}
		if sourceRevisionID != nil {
			facts.SourceRevisionID = *sourceRevisionID
		}
		details[revisionID] = facts
	}
	if err := rows.Err(); err != nil {
		return err
	}
	states, err := s.hardwareAssetValidationStates(ctx, revisionIDs)
	if err != nil {
		return err
	}

	// #669: resolve the GLB co-representation of every SKP-bound revision in
	// one batched read of the deterministic latest-derived rule. Unreadable
	// provenance omits the block (fail-honest, never invented).
	derivedBySource := map[string]*domain.HardwareVisualGlbRepresentation{}
	skpBoundIDs := make([]string, 0, len(revisionIDs))
	for _, id := range revisionIDs {
		if d, ok := details[id]; ok && d.Representation == domain.HardwareAssetRepresentationSKP {
			skpBoundIDs = append(skpBoundIDs, id)
		}
	}
	if len(skpBoundIDs) > 0 {
		derivedRows, err := s.db(ctx).Query(ctx, `
			SELECT DISTINCT ON (d.source_revision_id) d.source_revision_id, d.id, d.sha256, d.size_bytes, d.origin
			FROM hardware_asset_revisions d
			WHERE d.organization_id = $1 AND d.representation = 'glb'
			  AND d.source_revision_id IS NOT NULL AND d.source_revision_id = ANY($2::uuid[])
			ORDER BY d.source_revision_id, d.revision_number DESC
		`, OrgFromCtx(ctx), skpBoundIDs)
		if err != nil {
			return err
		}
		for derivedRows.Next() {
			var sourceRevisionID, revisionID, sha256 string
			var sizeBytes int64
			var originRaw []byte
			if err := derivedRows.Scan(&sourceRevisionID, &revisionID, &sha256, &sizeBytes, &originRaw); err != nil {
				derivedRows.Close()
				return err
			}
			var origin *domain.HardwareAssetOrigin
			if len(originRaw) > 0 && string(originRaw) != "null" {
				if origin, err = domain.ValidateHardwareAssetOrigin(json.RawMessage(originRaw)); err != nil {
					origin = nil // unreadable provenance omits the block
				}
			}
			derivedBySource[sourceRevisionID] = hardwareAssetGlbRepresentation(
				domain.HardwareAssetRepresentationGLB, revisionID, sha256, sizeBytes, sourceRevisionID, origin)
		}
		derivedRows.Close()
		if err := derivedRows.Err(); err != nil {
			return err
		}
	}

	for i := range items {
		binding := items[i].VisualAsset
		if binding == nil {
			continue
		}
		d, ok := details[binding.AssetRevisionID]
		if !ok {
			// Referenced revision unreadable in this org: keep identifiers,
			// expose no fabricated facts (fail-honest read).
			binding.Representation = ""
			binding.SHA256 = ""
			binding.SizeBytes = 0
			binding.ValidationState = ""
			binding.PreparationState = ""
			binding.MountFrame = nil
			binding.Glb = nil
			continue
		}
		binding.Representation = d.Representation
		binding.SHA256 = d.SHA256
		binding.SizeBytes = d.SizeBytes
		binding.ValidationState = states[binding.AssetRevisionID]
		binding.PreparationState = d.PreparationState
		binding.MountFrame = d.MountFrame
		binding.Glb = nil
		switch d.Representation {
		case domain.HardwareAssetRepresentationGLB:
			binding.Glb = hardwareAssetGlbRepresentation(d.Representation, binding.AssetRevisionID, d.SHA256, d.SizeBytes, d.SourceRevisionID, d.Origin)
		case domain.HardwareAssetRepresentationSKP:
			binding.Glb = derivedBySource[binding.AssetRevisionID]
		}
	}
	return nil
}

// hardwareAssetContentTypeMatchesRepresentation is the storage-frontier
// coherence table (#667 R3): which staged content types may finalize under
// each representation.
