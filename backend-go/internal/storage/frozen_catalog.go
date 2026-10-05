package storage

// #1102 frozen geometry: a pinned consumer resolves from the release's
// frozen resources instead of live tables. The compiler freezes every
// authoring-catalog entity per resource kind (see
// application.BuildStandardReleaseInputs); this decoder reconstructs the
// assembled domain.Catalog (+ material categories for the furniture
// projection) from the manifest and its content-addressed blobs.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ReleaseContentReader is the read surface the frozen catalog needs;
// satisfied by *storage.PostgresStore and by handler-test stubs.
type ReleaseContentReader interface {
	GetReleaseManifest(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryManifest, []byte, error)
	GetResourceBlob(ctx context.Context, sha256 string) (*domain.ResourceBlob, error)
}

// ErrFrozenCatalogIncomplete is returned when a frozen geometry resource
// references a blob that cannot be loaded: a pinned resolve must never
// silently fall back to live rows.
var ErrFrozenCatalogIncomplete = errors.New("frozen catalog resource unavailable")

// FrozenCatalogForRelease reconstructs the authoring catalog frozen inside
// one exact release. Every geometry kind decodes from its own
// content-addressed blob; a missing or undecodable blob fails closed.
func FrozenCatalogForRelease(
	ctx context.Context,
	store ReleaseContentReader,
	releaseID uuid.UUID,
) (domain.Catalog, []domain.MaterialCategory, error) {
	manifest, _, err := store.GetReleaseManifest(ctx, releaseID)
	if err != nil {
		return domain.Catalog{}, nil, fmt.Errorf("load frozen manifest: %w", err)
	}

	var catalog domain.Catalog
	var materialCategories []domain.MaterialCategory
	decode := func(ref domain.ManifestResourceRef, target any) error {
		blob, err := store.GetResourceBlob(ctx, ref.DefinitionHash)
		if err != nil {
			return fmt.Errorf("%w: %s %s (%s): %w", ErrFrozenCatalogIncomplete, ref.Kind, ref.ID, ref.DefinitionHash, err)
		}
		if err := json.Unmarshal(blob.Content, target); err != nil {
			return fmt.Errorf("decode frozen %s %s: %w", ref.Kind, ref.ID, err)
		}
		return nil
	}

	for _, ref := range manifest.Resources {
		switch ref.Kind {
		case "material":
			var entity domain.MaterialBoard
			if err := decode(ref, &entity); err != nil {
				return domain.Catalog{}, nil, err
			}
			catalog.Materials = append(catalog.Materials, entity)
		case "edge_band":
			var entity domain.EdgeBand
			if err := decode(ref, &entity); err != nil {
				return domain.Catalog{}, nil, err
			}
			catalog.Edges = append(catalog.Edges, entity)
		case "hardware":
			var entity domain.Hardware
			if err := decode(ref, &entity); err != nil {
				return domain.Catalog{}, nil, err
			}
			catalog.Hardware = append(catalog.Hardware, entity)
		case "option_group":
			var entity domain.OptionGroup
			if err := decode(ref, &entity); err != nil {
				return domain.Catalog{}, nil, err
			}
			catalog.OptionGroups = append(catalog.OptionGroups, entity)
		case "module_category":
			var entity domain.ModuleCategory
			if err := decode(ref, &entity); err != nil {
				return domain.Catalog{}, nil, err
			}
			catalog.Categories = append(catalog.Categories, entity)
		case "material_category":
			var entity domain.MaterialCategory
			if err := decode(ref, &entity); err != nil {
				return domain.Catalog{}, nil, err
			}
			materialCategories = append(materialCategories, entity)
		case "agregado":
			var entity domain.Agregado
			if err := decode(ref, &entity); err != nil {
				return domain.Catalog{}, nil, err
			}
			catalog.Agregados = append(catalog.Agregados, entity)
		case "component":
			var entity domain.Component
			if err := decode(ref, &entity); err != nil {
				return domain.Catalog{}, nil, err
			}
			catalog.Components = append(catalog.Components, entity)
		case "structure":
			var entity domain.Structure
			if err := decode(ref, &entity); err != nil {
				return domain.Catalog{}, nil, err
			}
			catalog.Structures = append(catalog.Structures, entity)
		case "module":
			var entity domain.Module
			if err := decode(ref, &entity); err != nil {
				return domain.Catalog{}, nil, err
			}
			catalog.Modules = append(catalog.Modules, entity)
		default:
			// hardware_profile and any future non-catalog kind are not part
			// of the geometry snapshot.
		}
	}
	return catalog, materialCategories, nil
}
