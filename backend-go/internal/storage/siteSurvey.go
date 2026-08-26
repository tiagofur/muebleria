package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Site survey storage (OC-040/OC-041, #305).
 *
 * The survey subprocess lives as a JSONB column on the projects row
 * (migration 000075) and is only mutated through this transactional entry
 * point (SELECT … FOR UPDATE + events in the same tx), same convention as
 * job costing (000074).
 */

var ErrSiteSurveyProjectNotFound = errors.New("project not found")

// MutateProjectSurvey loads the site survey with the project row locked, runs
// the mutator, and persists the new survey and the audit events in one
// transaction. A nil mutation.Survey keeps the stored one (read path).
func (s *PostgresStore) MutateProjectSurvey(
	ctx context.Context,
	projectID string,
	mutate func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error),
) (*domain.SiteSurveyMutation, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("error beginning site survey tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var surveyRaw []byte
	err = tx.QueryRow(ctx, `
		SELECT site_survey
		FROM projects WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2) FOR UPDATE;
	`, projectID, OrgFromCtx(ctx)).Scan(&surveyRaw)
	if err != nil {
		return nil, ErrSiteSurveyProjectNotFound
	}

	var snap *domain.SiteSurvey
	if len(surveyRaw) > 0 && string(surveyRaw) != "null" {
		var survey domain.SiteSurvey
		if err := json.Unmarshal(surveyRaw, &survey); err != nil {
			return nil, fmt.Errorf("error decoding site survey: %w", err)
		}
		snap = &survey
	}

	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}

	if mutation.Survey != nil {
		if err := domain.ValidateSiteSurveyShape(mutation.Survey); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}
		if _, err := tx.Exec(ctx, `
			UPDATE projects
			SET site_survey = $2,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND (organization_id = $3 OR sales_organization_id = $3 OR manufacturing_organization_id = $3);
		`, projectID, jsonbStructArg(mutation.Survey), OrgFromCtx(ctx)); err != nil {
			return nil, fmt.Errorf("error persisting site survey: %w", err)
		}
	}

	if err := upsertProjectEventsTx(ctx, tx, projectID, mutation.Events); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("error committing site survey tx: %w", err)
	}
	return mutation, nil
}
