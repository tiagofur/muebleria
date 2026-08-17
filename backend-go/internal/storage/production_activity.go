package storage

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ─── Insert ──────────────────────────────────────────────────────────────────

func (s *PostgresStore) InsertProductionActivity(ctx context.Context, act domain.ProductionActivity) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO production_activities (
			id, project_id, project_name, item_id, module_code, module_name,
			sector, type, operator_id, operator_name, machine_id, machine_name,
			started_at, finished_at, duration_ms, pieces_count, notes, status_before, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
	`,
		act.ID, act.ProjectID, act.ProjectName, act.ItemID, act.ModuleCode, act.ModuleName,
		string(act.Sector), string(act.Type), act.OperatorID, act.OperatorName,
		act.MachineID, act.MachineName, act.StartedAt, act.FinishedAt,
		act.DurationMillis, act.PiecesCount, act.Notes, act.StatusBefore, act.CreatedAt,
	)
	return err
}

func (s *PostgresStore) InsertDamageReport(ctx context.Context, dmg domain.DamageReport) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO damage_reports (
			id, project_id, project_name, item_id, sector, damage_type,
			description, photo_url, reported_by, reported_by_name, reported_at,
			needs_replace, resolved, resolved_at, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
	`,
		dmg.ID, dmg.ProjectID, dmg.ProjectName, dmg.ItemID,
		string(dmg.Sector), string(dmg.DamageType),
		dmg.Description, dmg.PhotoURL, dmg.ReportedBy, dmg.ReportedByName,
		dmg.ReportedAt, dmg.NeedsReplace, dmg.Resolved, dmg.ResolvedAt, dmg.ReportedAt,
	)
	return err
}

// ─── Queries ─────────────────────────────────────────────────────────────────

func (s *PostgresStore) GetActiveActivitiesBySector(ctx context.Context, sector domain.ProductionSector) ([]domain.ProductionActivity, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, project_id, project_name, item_id, module_code, module_name,
			sector, type, operator_id, operator_name, machine_id, machine_name,
			started_at, finished_at, duration_ms, pieces_count, notes, status_before, created_at
		FROM production_activities
		WHERE sector = $1 AND type = 'claim' AND finished_at IS NULL
		ORDER BY created_at DESC
	`, string(sector))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanActivities(rows)
}

func (s *PostgresStore) GetActiveActivitiesByOperator(ctx context.Context, operatorID string) ([]domain.ProductionActivity, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, project_id, project_name, item_id, module_code, module_name,
			sector, type, operator_id, operator_name, machine_id, machine_name,
			started_at, finished_at, duration_ms, pieces_count, notes, status_before, created_at
		FROM production_activities
		WHERE operator_id = $1 AND type = 'claim' AND finished_at IS NULL
		ORDER BY created_at DESC
	`, operatorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanActivities(rows)
}

func (s *PostgresStore) GetActiveActivityByID(ctx context.Context, id string) (*domain.ProductionActivity, error) {
	row := s.Pool.QueryRow(ctx, `
		SELECT id, project_id, project_name, item_id, module_code, module_name,
			sector, type, operator_id, operator_name, machine_id, machine_name,
			started_at, finished_at, duration_ms, pieces_count, notes, status_before, created_at
		FROM production_activities
		WHERE id = $1
	`, id)
	act, err := scanOneActivity(row)
	if err != nil {
		return nil, err
	}
	return act, nil
}

func (s *PostgresStore) FinishProductionActivity(ctx context.Context, id string, piecesCount int, notes string) error {
	now := time.Now().UTC()
	_, err := s.Pool.Exec(ctx, `
		UPDATE production_activities
		SET finished_at = $1, pieces_count = $2, notes = $3, type = 'finish'
		WHERE id = $4 AND finished_at IS NULL
	`, now, piecesCount, notes, id)
	return err
}

func (s *PostgresStore) ListProductionActivitiesByProject(ctx context.Context, projectID string, limit int) ([]domain.ProductionActivity, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, project_id, project_name, item_id, module_code, module_name,
			sector, type, operator_id, operator_name, machine_id, machine_name,
			started_at, finished_at, duration_ms, pieces_count, notes, status_before, created_at
		FROM production_activities
		WHERE project_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, projectID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanActivities(rows)
}

// ─── Damage Reports ──────────────────────────────────────────────────────────

func (s *PostgresStore) GetDamageReportByID(ctx context.Context, id string) (*domain.DamageReport, error) {
	row := s.Pool.QueryRow(ctx, `
		SELECT id, project_id, project_name, item_id, sector, damage_type,
			description, photo_url, reported_by, reported_by_name, reported_at,
			needs_replace, resolved, resolved_at, created_at
		FROM damage_reports
		WHERE id = $1
	`, id)
	return scanOneDamage(row)
}

func (s *PostgresStore) ListDamageReportsByProject(ctx context.Context, projectID string) ([]domain.DamageReport, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, project_id, project_name, item_id, sector, damage_type,
			description, photo_url, reported_by, reported_by_name, reported_at,
			needs_replace, resolved, resolved_at, created_at
		FROM damage_reports
		WHERE project_id = $1
		ORDER BY reported_at DESC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDamages(rows)
}

func (s *PostgresStore) ResolveDamageReport(ctx context.Context, id string) error {
	now := time.Now().UTC()
	_, err := s.Pool.Exec(ctx, `
		UPDATE damage_reports
		SET resolved = true, resolved_at = $1
		WHERE id = $2 AND resolved = false
	`, now, id)
	return err
}

func (s *PostgresStore) GetTodayDamageCount(ctx context.Context) (int, error) {
	var count int
	err := s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM damage_reports
		WHERE DATE(reported_at) = CURRENT_DATE
	`).Scan(&count)
	return count, err
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

func (s *PostgresStore) GetSectorMetrics(ctx context.Context, sector domain.ProductionSector, since string) (*domain.SectorDashboard, error) {
	if since == "" {
		since = time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339)
	}

	dash := &domain.SectorDashboard{Sector: sector}

	// Active operators count
	err := s.Pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT operator_id) FROM production_activities
		WHERE sector = $1 AND type = 'claim' AND finished_at IS NULL
	`, string(sector)).Scan(&dash.ActiveOperators)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}

	// Queue length (claims not yet started by any operator)
	err = s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM production_activities
		WHERE sector = $1 AND type = 'claim' AND started_at IS NULL
	`, string(sector)).Scan(&dash.QueueLength)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}

	// Items in progress (active claims)
	err = s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM production_activities
		WHERE sector = $1 AND type = 'claim' AND finished_at IS NULL AND started_at IS NOT NULL
	`, string(sector)).Scan(&dash.ItemsInProgress)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}

	// Items completed today
	err = s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM production_activities
		WHERE sector = $1 AND type = 'finish' AND created_at >= $2
	`, string(sector), since).Scan(&dash.ItemsCompletedToday)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}

	// Average time per item
	err = s.Pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(duration_ms), 0) FROM production_activities
		WHERE sector = $1 AND type = 'finish' AND duration_ms > 0 AND created_at >= $2
	`, string(sector), since).Scan(&dash.AvgTimeMinutes)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}
	dash.AvgTimeMinutes = dash.AvgTimeMinutes / 60000.0 // ms to minutes

	// Active jobs for this sector
	rows, err := s.Pool.Query(ctx, `
		SELECT id, project_id, project_name, item_id, module_code, operator_id, operator_name,
			machine_id, machine_name, started_at
		FROM production_activities
		WHERE sector = $1 AND type = 'claim' AND finished_at IS NULL AND started_at IS NOT NULL
		ORDER BY started_at ASC
	`, string(sector))
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var job domain.ActiveJob
			if err := rows.Scan(
				&job.ActivityID, &job.ProjectID, &job.ProjectName, &job.ItemID,
				&job.ModuleCode, &job.OperatorID, &job.OperatorName,
				&job.MachineID, &job.MachineName, &job.StartedAt,
			); err == nil {
				job.DurationMin = time.Since(job.StartedAt).Minutes()
				dash.ActiveJobs = append(dash.ActiveJobs, job)
			}
		}
	}
	if dash.ActiveJobs == nil {
		dash.ActiveJobs = []domain.ActiveJob{}
	}

	return dash, nil
}

func (s *PostgresStore) GetOperatorMetrics(ctx context.Context, operatorID, since string) (*domain.OperatorMetrics, error) {
	if since == "" {
		since = time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339)
	}

	met := &domain.OperatorMetrics{OperatorID: operatorID}

	// Jobs completed
	err := s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM production_activities
		WHERE operator_id = $1 AND type = 'finish' AND created_at >= $2
	`, operatorID, since).Scan(&met.JobsCompleted)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}

	// Total pieces
	err = s.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(pieces_count), 0) FROM production_activities
		WHERE operator_id = $1 AND type = 'finish' AND created_at >= $2
	`, operatorID, since).Scan(&met.TotalPieces)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}

	// Total time
	err = s.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(duration_ms), 0) FROM production_activities
		WHERE operator_id = $1 AND type = 'finish' AND created_at >= $2
	`, operatorID, since).Scan(&met.TotalTimeMin)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}
	met.TotalTimeMin = met.TotalTimeMin / 60000.0 // ms to minutes

	// Average time per job
	if met.JobsCompleted > 0 {
		met.AvgTimePerJob = met.TotalTimeMin / float64(met.JobsCompleted)
	}

	// Damages reported by this operator
	err = s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM damage_reports
		WHERE reported_by = $1 AND created_at >= $2
	`, operatorID, since).Scan(&met.DamagesCount)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}

	return met, nil
}

func (s *PostgresStore) GetDashboardMetrics(ctx context.Context) (*domain.DashboardMetrics, error) {
	dash := &domain.DashboardMetrics{}

	since := time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339)

	// Today completed
	err := s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM production_activities
		WHERE type = 'finish' AND created_at >= $1
	`, since).Scan(&dash.TodayCompleted)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}

	// Today damages
	err = s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM damage_reports
		WHERE created_at >= $1
	`, since).Scan(&dash.TodayDamages)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}

	// Sectors
	sectors := []domain.ProductionSector{
		domain.SectorCutting,
		domain.SectorEdgeBanding,
		domain.SectorCNC,
		domain.SectorAssembly,
		domain.SectorPackaging,
	}
	dash.Sectors = make([]domain.SectorDashboard, 0, len(sectors))
	for _, sec := range sectors {
		secDash, err := s.GetSectorMetrics(ctx, sec, since)
		if err != nil {
			continue
		}
		dash.Sectors = append(dash.Sectors, *secDash)
	}

	return dash, nil
}

// ─── Scan Helpers ────────────────────────────────────────────────────────────

func scanActivities(rows pgx.Rows) ([]domain.ProductionActivity, error) {
	var acts []domain.ProductionActivity
	for rows.Next() {
		act, err := scanOneActivity(rows)
		if err != nil {
			return nil, err
		}
		acts = append(acts, *act)
	}
	if acts == nil {
		acts = []domain.ProductionActivity{}
	}
	return acts, rows.Err()
}

func scanOneActivity(row rowScanner) (*domain.ProductionActivity, error) {
	var act domain.ProductionActivity
	var sector, actType string
	err := row.Scan(
		&act.ID, &act.ProjectID, &act.ProjectName, &act.ItemID,
		&act.ModuleCode, &act.ModuleName, &sector, &actType,
		&act.OperatorID, &act.OperatorName, &act.MachineID, &act.MachineName,
		&act.StartedAt, &act.FinishedAt, &act.DurationMillis,
		&act.PiecesCount, &act.Notes, &act.StatusBefore, &act.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	act.Sector = domain.ProductionSector(sector)
	act.Type = domain.ProductionActivityType(actType)
	return &act, nil
}

func scanDamages(rows pgx.Rows) ([]domain.DamageReport, error) {
	var dmg []domain.DamageReport
	for rows.Next() {
		d, err := scanOneDamage(rows)
		if err != nil {
			return nil, err
		}
		dmg = append(dmg, *d)
	}
	if dmg == nil {
		dmg = []domain.DamageReport{}
	}
	return dmg, rows.Err()
}

func scanOneDamage(row rowScanner) (*domain.DamageReport, error) {
	var dmg domain.DamageReport
	var sector, dmgType string
	err := row.Scan(
		&dmg.ID, &dmg.ProjectID, &dmg.ProjectName, &dmg.ItemID,
		&sector, &dmgType, &dmg.Description, &dmg.PhotoURL,
		&dmg.ReportedBy, &dmg.ReportedByName, &dmg.ReportedAt,
		&dmg.NeedsReplace, &dmg.Resolved, &dmg.ResolvedAt, &dmg.ReportedAt,
	)
	if err != nil {
		return nil, err
	}
	dmg.Sector = domain.ProductionSector(sector)
	dmg.DamageType = domain.DamageType(dmgType)
	return &dmg, nil
}
