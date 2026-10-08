package api

import (
	"context"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// Contrato: catálogo comercial — tableros, ambientes, categorías, cANTON,
// edge bands, herrajes, perfiles HW (#913) y side assignments (#915).
type CatalogStore interface {
	// Catalog: the factory construction policy (#1078/#1218) — the parsed
	// standard-library overlay; nil when no active overlay governs.
	GetFactoryConstructionPolicy(ctx context.Context) (*engine.FactoryConstructionPolicy, error)

	// Catalog: materials
	ListMaterialBoards(ctx context.Context) ([]domain.MaterialBoard, error)
	GetMaterialBoardByID(ctx context.Context, id string) (*domain.MaterialBoard, error)
	CreateMaterialBoard(ctx context.Context, m *domain.MaterialBoard) error
	UpdateMaterialBoard(ctx context.Context, id string, expectedVersion int64, m *domain.MaterialBoard) error
	DeactivateMaterialBoard(ctx context.Context, id string, expectedVersion int64) error

	// Catalog: ambient materials (presentation-only floor/wall surfaces, #4150 / F086)
	ListAmbientMaterials(ctx context.Context) ([]domain.AmbientMaterial, error)
	GetAmbientMaterialByID(ctx context.Context, id string) (*domain.AmbientMaterial, error)
	CreateAmbientMaterial(ctx context.Context, m *domain.AmbientMaterial) error
	UpdateAmbientMaterial(ctx context.Context, id string, expectedVersion int64, m *domain.AmbientMaterial) error
	DeactivateAmbientMaterial(ctx context.Context, id string, expectedVersion int64) error

	// Catalog: ambient / finish categories (F086)
	ListAmbientCategories(ctx context.Context) ([]domain.AmbientCategory, error)
	GetAmbientCategoryByID(ctx context.Context, id string) (*domain.AmbientCategory, error)
	CreateAmbientCategory(ctx context.Context, c *domain.AmbientCategory) error
	UpdateAmbientCategory(ctx context.Context, id string, expectedVersion int64, c *domain.AmbientCategory) error
	DeleteAmbientCategory(ctx context.Context, id string, expectedVersion int64) error

	// Catalog: material categories (F142: subgrupos de tableros)
	ListMaterialCategories(ctx context.Context) ([]domain.MaterialCategory, error)
	GetMaterialCategoryByID(ctx context.Context, id string) (*domain.MaterialCategory, error)
	CreateMaterialCategory(ctx context.Context, c *domain.MaterialCategory) error
	UpdateMaterialCategory(ctx context.Context, id string, expectedVersion int64, c *domain.MaterialCategory) error
	DeleteMaterialCategory(ctx context.Context, id string, expectedVersion int64) error

	// Catalog: edge bands
	ListEdgeBands(ctx context.Context) ([]domain.EdgeBand, error)
	GetEdgeBandByID(ctx context.Context, id string) (*domain.EdgeBand, error)
	CreateEdgeBand(ctx context.Context, e *domain.EdgeBand) error
	UpdateEdgeBand(ctx context.Context, id string, expectedVersion int64, e *domain.EdgeBand) error
	DeactivateEdgeBand(ctx context.Context, id string, expectedVersion int64) error

	// Catalog: hardware
	ListHardwares(ctx context.Context) ([]domain.Hardware, error)
	GetHardwareByID(ctx context.Context, id string) (*domain.Hardware, error)
	CreateHardware(ctx context.Context, h *domain.Hardware) error
	UpdateHardware(ctx context.Context, id string, expectedVersion int64, h *domain.Hardware) error
	DeactivateHardware(ctx context.Context, id string, expectedVersion int64) error

	// Catalog: hardware profiles (#913 / HW-PROFILE)
	ListHardwareProfiles(ctx context.Context) ([]domain.HardwareProfile, error)
	GetHardwareProfileByID(ctx context.Context, id string) (*domain.HardwareProfile, error)
	CreateHardwareProfile(ctx context.Context, p *domain.HardwareProfile) error
	UpdateHardwareProfile(ctx context.Context, id string, expectedVersion int64, p *domain.HardwareProfile) error
	DeactivateHardwareProfile(ctx context.Context, id string, expectedVersion int64) error
	ExistingHardwareIDs(ctx context.Context, ids []string) (map[string]bool, error)

	ListActiveHardwareProfilesAnyOrg(ctx context.Context) ([]domain.HardwareProfile, error)
	EnsureSeedPlatformUser(ctx context.Context) (string, error)
	// ResetManifestlessPublishedRelease is strictly a test/demo fixture repair helper (#955).
	ResetManifestlessPublishedRelease(ctx context.Context, releaseID string) (bool, error)

	// Component side assignments (#915 / HW-PROFILE)
	ListComponentSideAssignments(ctx context.Context, componentID string) ([]domain.ComponentSideAssignment, error)
	SetComponentSideAssignment(ctx context.Context, a *domain.ComponentSideAssignment) error
	RemoveComponentSideAssignment(ctx context.Context, componentID, side string) error
	ListAllComponentSideAssignments(ctx context.Context) ([]domain.ComponentSideAssignment, error)
}
