package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Contrato: actividad de producción por sector/operador, métricas de
// dashboard y reportes de daño.
type ProductionActivityStore interface {
	// Production activity tracking (gerente_produccion dashboard)
	InsertProductionActivity(ctx context.Context, act domain.ProductionActivity) error
	GetActiveActivitiesBySector(ctx context.Context, sector domain.ProductionSector) ([]domain.ProductionActivity, error)
	GetActiveActivitiesByOperator(ctx context.Context, operatorID string) ([]domain.ProductionActivity, error)
	GetActiveActivityByID(ctx context.Context, id string) (*domain.ProductionActivity, error)
	FinishProductionActivity(ctx context.Context, id string, piecesCount int, notes string) error
	// #740 review fix: activities with a physical effect finish in ONE
	// transaction — activity finish + floor status + F092 event under the
	// project row lock with the operational gate; any error rolls back all.
	FinishProductionActivityWithPhysicalEffect(ctx context.Context, cmd storage.FinishActivityPhysicalCommand) (*storage.FinishActivityResult, error)
	ListProductionActivitiesByProject(ctx context.Context, projectID string, limit int) ([]domain.ProductionActivity, error)
	GetSectorMetrics(ctx context.Context, sector domain.ProductionSector, since string) (*domain.SectorDashboard, error)
	GetOperatorMetrics(ctx context.Context, operatorID, since string) (*domain.OperatorMetrics, error)
	GetDashboardMetrics(ctx context.Context) (*domain.DashboardMetrics, error)

	// Damage reporting
	InsertDamageReport(ctx context.Context, dmg domain.DamageReport) error
	GetDamageReportByID(ctx context.Context, id string) (*domain.DamageReport, error)
	ListDamageReportsByProject(ctx context.Context, projectID string) ([]domain.DamageReport, error)
	ResolveDamageReport(ctx context.Context, id string) error
	GetTodayDamageCount(ctx context.Context) (int, error)
}
