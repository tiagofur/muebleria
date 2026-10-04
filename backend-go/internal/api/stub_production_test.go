package api

// Contrato: stub del stubStore espejo de store_production (store_production.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_production.go
import (
	"context"
	"fmt"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"time"
)

func (s *stubStore) FinishProductionActivityWithPhysicalEffect(_ context.Context, cmd storage.FinishActivityPhysicalCommand) (*storage.FinishActivityResult, error) {
	// Mirror of the real transaction: gate blocker first (everything rolls
	// back), then finish + physical effect together.
	if s.physicalAuthErr != nil {
		return nil, s.physicalAuthErr
	}
	var act *domain.ProductionActivity
	for i := range s.activitiesByID {
		if s.activitiesByID[i].ID == cmd.ActivityID {
			act = &s.activitiesByID[i]
			break
		}
	}
	if act == nil {
		return nil, fmt.Errorf("NOT_FOUND:actividad no encontrada")
	}
	now := time.Now().UTC()
	finished := *act
	finished.FinishedAt = &now
	finished.PiecesCount = cmd.PiecesCount
	finished.Notes = cmd.Notes
	result := &storage.FinishActivityResult{Activity: finished}
	target := domain.TargetStatusForSector(string(act.Sector))
	if act.ItemID == "" || target == "" {
		return nil, fmt.Errorf("BAD_REQUEST:la actividad no produce efecto físico")
	}
	before := "pending"
	if s.projectReturnedByID != nil {
		for i := range s.projectReturnedByID.Items {
			if s.projectReturnedByID.Items[i].ID == act.ItemID {
				before = domain.NormalizeItemFloorStatus(s.projectReturnedByID.Items[i].FloorStatus)
				break
			}
		}
	}
	result.FromStatus = before
	result.ToStatus = before
	if before != target && domain.FloorStatusRank(before) < domain.FloorStatusRank(target) {
		s.floorStatusWrites = append(s.floorStatusWrites, floorStatusWrite{act.ProjectID, act.ItemID, target})
		s.floorEventWrites = append(s.floorEventWrites, domain.FloorStatusEvent{
			ID: newFloorEventID(), ProjectID: act.ProjectID, ItemID: act.ItemID,
			From: before, To: target, At: now, ByUserID: cmd.ActorID,
			ByName: act.OperatorName, Source: domain.FloorEventSourceActivity,
		})
		result.FloorAdvanced = true
		result.ToStatus = target
	}
	return result, nil
}

// Production activity stubs
func (s *stubStore) InsertProductionActivity(_ context.Context, activity domain.ProductionActivity) error {
	s.insertedActivities = append(s.insertedActivities, activity)
	return nil
}

func (s *stubStore) GetActiveActivitiesBySector(_ context.Context, sector domain.ProductionSector) ([]domain.ProductionActivity, error) {
	activities := []domain.ProductionActivity{}
	for _, activity := range s.insertedActivities {
		if activity.Sector == sector && activity.FinishedAt == nil {
			activities = append(activities, activity)
		}
	}
	return activities, nil
}

func (s *stubStore) GetActiveActivitiesByOperator(_ context.Context, _ string) ([]domain.ProductionActivity, error) {
	return []domain.ProductionActivity{}, nil
}

func (s *stubStore) GetActiveActivityByID(_ context.Context, id string) (*domain.ProductionActivity, error) {
	for i := range s.activitiesByID {
		if s.activitiesByID[i].ID == id {
			act := s.activitiesByID[i]
			return &act, nil
		}
	}
	return nil, nil
}

func (s *stubStore) FinishProductionActivity(_ context.Context, _ string, _ int, _ string) error {
	return nil
}

func (s *stubStore) ListProductionActivitiesByProject(_ context.Context, _ string, _ int) ([]domain.ProductionActivity, error) {
	return []domain.ProductionActivity{}, nil
}

func (s *stubStore) GetSectorMetrics(_ context.Context, _ domain.ProductionSector, _ string) (*domain.SectorDashboard, error) {
	return &domain.SectorDashboard{}, nil
}

func (s *stubStore) GetOperatorMetrics(_ context.Context, _, _ string) (*domain.OperatorMetrics, error) {
	return &domain.OperatorMetrics{}, nil
}

func (s *stubStore) GetDashboardMetrics(_ context.Context) (*domain.DashboardMetrics, error) {
	return &domain.DashboardMetrics{}, nil
}

func (s *stubStore) InsertDamageReport(_ context.Context, _ domain.DamageReport) error {
	return nil
}

func (s *stubStore) GetDamageReportByID(_ context.Context, _ string) (*domain.DamageReport, error) {
	return nil, nil
}

func (s *stubStore) ListDamageReportsByProject(_ context.Context, _ string) ([]domain.DamageReport, error) {
	return []domain.DamageReport{}, nil
}

func (s *stubStore) ResolveDamageReport(_ context.Context, _ string) error {
	return nil
}

func (s *stubStore) GetTodayDamageCount(_ context.Context) (int, error) {
	return 0, nil
}

// User sector stubs
