package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Contrato: seed demo del catálogo y workshop settings (F031/F044).
type SeedSettingsStore interface {
	// Seed: populate catalog from plantilla fixtures
	SeedCatalog(ctx context.Context) error

	// Workshop settings (F031 defaults + F044 COST-02 flag)
	GetWorkshopSettings(ctx context.Context) (domain.WorkshopSettings, error)
	UpsertWorkshopSettings(ctx context.Context, ws domain.WorkshopSettings) (domain.WorkshopSettings, error)
}
