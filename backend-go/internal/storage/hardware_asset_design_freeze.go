package storage

import (
	"context"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"strings"
)

// Contrato: freeze de assets de herrajes al publicar una DesignRevision —
// pin por composición, resolución del catálogo y lectura de pins (#667/#913).
func (s *PostgresStore) freezeDesignRevisionHardwareAssets(ctx context.Context, designOrgID, projectID, designRevisionID string, items []PublishDesignRevisionItemCommand) (int, error) {
	hardwareIDs := map[string]struct{}{}
	modules := map[string]*domain.Module{}
	var catalog *domain.Catalog

	for _, item := range items {
		if !isValidUUID(item.FurnitureDefinitionID) {
			continue
		}
		if _, cached := modules[item.FurnitureDefinitionID]; cached {
			continue
		}
		m, err := s.GetModuleByID(ctx, item.FurnitureDefinitionID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Historical/legacy definition: explicit absence, no invented
				// pins (same precedent as the presentation snapshot).
				modules[item.FurnitureDefinitionID] = nil
				continue
			}
			return 0, err
		}
		modules[item.FurnitureDefinitionID] = m
	}

	for _, module := range modules {
		if module == nil {
			continue
		}
		if catalog == nil {
			cat, err := s.publishResolutionCatalog(ctx)
			if err != nil {
				return 0, err
			}
			catalog = &cat
		}
		ids, err := compositionHardwareIDs(*module, *catalog)
		if err != nil {
			return 0, err
		}
		for id := range ids {
			hardwareIDs[id] = struct{}{}
		}
	}
	if len(hardwareIDs) == 0 {
		return 0, nil
	}

	ids := make([]string, 0, len(hardwareIDs))
	for id := range hardwareIDs {
		ids = append(ids, id)
	}
	// One atomic statement: the revision id, representation and digest of
	// each pin come from the SAME read of hardwares × hardware_asset_revisions,
	// and the derived GLB is resolved at freeze time with the same
	// deterministic rule as the live binding (highest derived revision of the
	// exact pinned SKP revision). Later re-exports create new rows and can
	// never rewrite a frozen pin (#669 historical exactness).
	pinned, err := s.db(ctx).Query(ctx, `
		WITH inserted AS (
			INSERT INTO design_revision_hardware_assets
				(organization_id, project_id, design_revision_id, hardware_id, asset_id, asset_revision_id, representation, sha256, glb_revision_id, glb_sha256)
			SELECT $1, $2, $3, h.id, r.asset_id, r.id, r.representation, r.sha256, g.id, g.sha256
			FROM hardwares h
			JOIN hardware_asset_revisions r
			  ON r.id = h.visual_asset_revision_id AND r.asset_id = h.visual_asset_id
			LEFT JOIN LATERAL (
				SELECT gr.id, gr.sha256
				FROM hardware_asset_revisions gr
				WHERE gr.organization_id = r.organization_id
				  AND gr.asset_id = r.asset_id
				  AND gr.source_revision_id = r.id
				  AND gr.representation = 'glb'
				ORDER BY gr.revision_number DESC
				LIMIT 1
			) g ON r.representation = 'skp'
			WHERE h.organization_id = $1 AND h.visual_asset_id IS NOT NULL AND h.id = ANY($4::uuid[])
			RETURNING 1
		)
		SELECT count(*) FROM inserted
	`, designOrgID, projectID, designRevisionID, ids)
	if err != nil {
		return 0, err
	}
	defer pinned.Close()
	var count int
	if pinned.Next() {
		if err := pinned.Scan(&count); err != nil {
			return 0, err
		}
	}
	return count, pinned.Err()
}

// compositionHardwareIDs walks one module's SEMANTIC composition and returns
// every hardware id it references: placement overrides on structure and
// module component instances, agregado instances' component placements and
// hardware lines, and the module's own hardware lines. A referenced
// structure or agregado that cannot be found is a resolution error — the
// caller fails the publish instead of silently dropping references.
func compositionHardwareIDs(module domain.Module, catalog domain.Catalog) (map[string]struct{}, error) {
	out := map[string]struct{}{}
	addPlacement := func(hardwareID string) {
		if strings.TrimSpace(hardwareID) != "" {
			out[hardwareID] = struct{}{}
		}
	}
	addInstances := func(instances []domain.ComponentInstance) {
		for _, ci := range instances {
			if ci.Overrides == nil {
				continue
			}
			for _, hp := range ci.Overrides.HardwarePlacements {
				addPlacement(hp.HardwareID)
			}
		}
	}
	addAgregadoInstances := func(instances []domain.ModuleAgregadoInstance) error {
		for _, ai := range instances {
			agregado, ok := findCatalogAgregado(catalog, ai.AgregadoID)
			if !ok {
				return fmt.Errorf("%w: el módulo %s referencia el agregado %s y no existe en el catálogo",
					domain.ErrCompositionUnresolvable, module.Code, ai.AgregadoID)
			}
			addInstances(agregado.Components)
			for _, hl := range agregado.HardwareLines {
				addPlacement(hl.HardwareID)
			}
		}
		return nil
	}

	if strings.TrimSpace(module.StructureID) != "" {
		structure, ok := findCatalogStructure(catalog, module.StructureID)
		if !ok {
			return nil, fmt.Errorf("%w: el módulo %s referencia la estructura %s y no existe en el catálogo",
				domain.ErrCompositionUnresolvable, module.Code, module.StructureID)
		}
		addInstances(structure.Components)
		if err := addAgregadoInstances(structure.Agregados); err != nil {
			return nil, err
		}
	}
	addInstances(module.Components)
	if err := addAgregadoInstances(module.Agregados); err != nil {
		return nil, err
	}
	for _, hl := range module.HardwareLines {
		addPlacement(hl.HardwareID)
	}
	return out, nil
}

func findCatalogStructure(catalog domain.Catalog, structureID string) (domain.Structure, bool) {
	for _, st := range catalog.Structures {
		if st.ID == structureID {
			return st, true
		}
	}
	return domain.Structure{}, false
}

func findCatalogAgregado(catalog domain.Catalog, agregadoID string) (domain.Agregado, bool) {
	for _, ag := range catalog.Agregados {
		if ag.ID == agregadoID {
			return ag, true
		}
	}
	return domain.Agregado{}, false
}

// publishResolutionCatalog loads the composition the authoritative resolver
// consumes (same shape as the furniture layout endpoint).
func (s *PostgresStore) publishResolutionCatalog(ctx context.Context) (domain.Catalog, error) {
	var cat domain.Catalog
	structures, err := s.ListStructures(ctx)
	if err != nil {
		return cat, err
	}
	cat.Structures = structures
	components, err := s.ListComponents(ctx)
	if err != nil {
		return cat, err
	}
	cat.Components = components
	agregados, err := s.ListAgregados(ctx)
	if err != nil {
		return cat, err
	}
	cat.Agregados = agregados
	hardware, err := s.ListHardwares(ctx)
	if err != nil {
		return cat, err
	}
	cat.Hardware = hardware
	materials, err := s.ListMaterialBoards(ctx)
	if err != nil {
		return cat, err
	}
	cat.Materials = materials
	// #1078: the frozen release catalog carries the factory policy baked at
	// publish time — a released snapshot resolves immutably even if the org
	// overlay changes later. Same load + parse contract as the live catalog.
	orgUUID, parseErr := uuid.Parse(OrgFromCtx(ctx))
	if parseErr != nil {
		return cat, fmt.Errorf("overlay factory policy org: %w", parseErr)
	}
	overlay, err := s.GetActiveOverlayByLibrary(ctx, orgUUID, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err == nil {
		policy, perr := engine.ParseFactoryConstructionPolicy(overlay.Overrides)
		if perr != nil {
			return cat, fmt.Errorf("overlay factory policy (freeze): %w", perr)
		}
		cat.ConstructionPolicy = policy
	} else if !errors.Is(err, ErrOverlayNotFound) {
		return cat, fmt.Errorf("overlay for factory policy (freeze): %w", err)
	}
	return cat, nil
}

// ListDesignRevisionHardwareAssets reads the frozen pins of one revision
// (readback for consumers and tests).
func (s *PostgresStore) ListDesignRevisionHardwareAssets(ctx context.Context, designRevisionID string) ([]domain.DesignRevisionHardwareAssetPin, error) {
	if !isValidUUID(designRevisionID) {
		return nil, domain.ErrDesignRevisionNotFound
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, hardware_id, asset_id, asset_revision_id, representation, sha256, glb_revision_id, glb_sha256, created_at
		FROM design_revision_hardware_assets
		WHERE organization_id = $1 AND design_revision_id = $2
		ORDER BY hardware_id ASC
	`, OrgFromCtx(ctx), designRevisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pins []domain.DesignRevisionHardwareAssetPin
	for rows.Next() {
		var p domain.DesignRevisionHardwareAssetPin
		if err := rows.Scan(&p.ID, &p.HardwareID, &p.AssetID, &p.AssetRevisionID, &p.Representation, &p.SHA256, &p.GlbRevisionID, &p.GlbSHA256, &p.CreatedAt); err != nil {
			return nil, err
		}
		pins = append(pins, p)
	}
	return pins, rows.Err()
}

// attachHardwareVisualBindings resolves the exact binding details
// (representation, digest, derived validation state) for hardware rows that
// reference a revision. The identifiers live on the hardwares row; the
// resolved facts come from the referenced rows — never from client echo.
