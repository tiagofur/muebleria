package api

import (
	"context"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Contrato: catálogo comercial — tableros, ambientes, categorías, cANTON,
// edge bands, herrajes, perfiles HW (#913) y side assignments (#915).
type CatalogStore interface {
	// #1369/#1393: filas + receta vigente (vive en agregado_revisions) leídas
	// en UNA transacción — lista sin N+1 de transacciones y detalle sin la
	// carrera de dos lecturas frente a un PUT concurrente.
	ListAgregadosWithRecipes(ctx context.Context) ([]domain.Agregado, error)
	GetAgregadoByIDWithRecipe(ctx context.Context, id string) (*domain.Agregado, error)

	// Catalog: workshop kit templates (#1422 slice 2) — hardware-kit wizard
	// blueprints. DELETE is the soft deactivate.
	ListKitTemplates(ctx context.Context) ([]domain.KitTemplate, error)
	GetKitTemplateByID(ctx context.Context, id string) (*domain.KitTemplate, error)
	CreateKitTemplate(ctx context.Context, t *domain.KitTemplate) error
	UpdateKitTemplate(ctx context.Context, id string, expectedVersion int64, t *domain.KitTemplate) error
	DeactivateKitTemplate(ctx context.Context, id string, expectedVersion int64) error

	// Catalog: the factory construction policy (#1078/#1218) — the parsed
	// standard-library overlay; nil when no active overlay governs.
	GetFactoryConstructionPolicy(ctx context.Context) (*engine.FactoryConstructionPolicy, error)

	// Catalog: opening capabilities (#1134) projected from the grip styles
	// (#1531); nil when the organization has no styles. Available governs
	// new-authoring offering only, never existing designs.
	GetOpeningCapabilities(ctx context.Context) (*domain.OpeningCapabilities, error)

	// Catalog: the overhang millimetres of v1 bottom_overhang selections,
	// from the grip styles (#1531). Never nil: 20 mm by default (A4).
	GetOpeningOverhangRule(ctx context.Context) (*domain.OpeningOverhangRule, error)

	// Catalog: grip styles (#1531) — If-Match guarded, audited writes.
	ListGripStyles(ctx context.Context) ([]domain.GripStyle, error)
	GetGripStyle(ctx context.Context, id string) (*domain.GripStyle, error)

	// Project grip (#1532, ADR-0009 Amendment 1 A2.3/A7): the project's
	// frozen snapshot, per-furniture overrides and the explicit refresh.
	GetProjectGrip(ctx context.Context, projectID string) (*storage.ProjectGrip, error)
	SetProjectGrip(ctx context.Context, projectID, styleID string, expectedVersion int64, meta storage.ProjectGripWriteMeta) (*storage.ProjectGrip, error)
	SetFurnitureGripOverrides(ctx context.Context, projectID string, overrides []storage.FurnitureGripOverrideCommand, expectedVersion int64, meta storage.ProjectGripWriteMeta) error
	RefreshProjectGrip(ctx context.Context, projectID string, includeOverrides bool, expectedVersion int64, meta storage.ProjectGripWriteMeta) error
	GetFurnitureEffectiveGrip(ctx context.Context, projectID, furnitureInstanceID string) (*domain.GripSnapshot, error)
	ListFurnitureInstanceSummariesByProject(ctx context.Context, projectID string, withPresentation bool) ([]storage.FurnitureInstanceSummary, error)
	CreateGripStyle(ctx context.Context, style *domain.GripStyle, meta storage.GripStyleWriteMeta) error
	UpdateGripStyle(ctx context.Context, id string, expectedVersion int64, style *domain.GripStyle, meta storage.GripStyleWriteMeta) error
	DeleteGripStyle(ctx context.Context, id string, expectedVersion int64, meta storage.GripStyleWriteMeta) error

	// Catalog: opening profiles (#1130) — the grip profile catalog.
	ListOpeningProfiles(ctx context.Context) ([]domain.OpeningProfile, error)
	GetOpeningProfileByID(ctx context.Context, id string) (*domain.OpeningProfile, error)
	CreateOpeningProfile(ctx context.Context, profile *domain.OpeningProfile) error
	UpdateOpeningProfile(ctx context.Context, id string, expectedVersion int64, profile *domain.OpeningProfile) error
	DeactivateOpeningProfile(ctx context.Context, id string, expectedVersion int64) error

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

	// Catalog: hardware categories (#1507: subgrupos de herrajes)
	ListHardwareCategories(ctx context.Context) ([]domain.HardwareCategory, error)
	GetHardwareCategoryByID(ctx context.Context, id string) (*domain.HardwareCategory, error)
	CreateHardwareCategory(ctx context.Context, c *domain.HardwareCategory) error
	UpdateHardwareCategory(ctx context.Context, id string, expectedVersion int64, c *domain.HardwareCategory) error
	DeleteHardwareCategory(ctx context.Context, id string, expectedVersion int64) error

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
