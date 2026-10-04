package api

// Contrato: stub del stubStore espejo de store_seed (store_seed.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_seed.go
import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func (s *stubStore) GetWorkshopSettings(context.Context) (domain.WorkshopSettings, error) {
	if s.workshopSettings != nil {
		return *s.workshopSettings, nil
	}
	return domain.DefaultWorkshopSettings(), nil
}

func (s *stubStore) UpsertWorkshopSettings(_ context.Context, ws domain.WorkshopSettings) (domain.WorkshopSettings, error) {
	cp := ws
	s.workshopSettings = &cp
	return ws, nil
}

func (s *stubStore) SeedCatalog(_ context.Context) error {
	return nil // not used by handler tests
}

// #110 / H15 — project templates stubs (no behavior; tests below inject data).
