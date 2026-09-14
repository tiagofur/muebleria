package storage

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

var ErrInvalidProjectDesignBootstrap = errors.New("invalid project design bootstrap")

type BootstrapProjectDesignCommand struct {
	ProjectName        string
	DesignName         string
	ExistingCustomerID string
	NewCustomerName    string
	ActorUserID        string
	ActorRoles         []domain.UserRole
	IP                 string
	RequestID          string
}

type BootstrapProjectDesignResult struct {
	Customer domain.Customer
	Project  domain.Project
	Design   domain.Design
}

// BootstrapProjectDesign creates the complete SketchUp-first commercial
// context in the idempotency middleware's transaction. No business identity
// is accepted from the client; every ID is returned by PostgreSQL.
func (s *PostgresStore) BootstrapProjectDesign(ctx context.Context, cmd BootstrapProjectDesignCommand) (*BootstrapProjectDesignResult, error) {
	cmd.ProjectName = strings.TrimSpace(cmd.ProjectName)
	cmd.DesignName = strings.TrimSpace(cmd.DesignName)
	cmd.ExistingCustomerID = strings.TrimSpace(cmd.ExistingCustomerID)
	cmd.NewCustomerName = strings.TrimSpace(cmd.NewCustomerName)
	if cmd.ProjectName == "" || cmd.DesignName == "" ||
		(cmd.ExistingCustomerID == "") == (cmd.NewCustomerName == "") ||
		(cmd.ExistingCustomerID != "" && !isValidUUID(cmd.ExistingCustomerID)) {
		return nil, ErrInvalidProjectDesignBootstrap
	}

	if transactionFromContext(ctx) == nil {
		var result *BootstrapProjectDesignResult
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			created, err := s.BootstrapProjectDesign(txCtx, cmd)
			if err != nil {
				return err
			}
			result = created
			return nil
		})
		return result, err
	}

	tx := transactionFromContext(ctx)
	orgID := OrgFromCtx(ctx)
	if orgID == "" {
		return nil, ErrInvalidProjectDesignBootstrap
	}

	customer := domain.Customer{ID: cmd.ExistingCustomerID}
	if cmd.NewCustomerName != "" {
		customer.Name = cmd.NewCustomerName
		customer.Active = true
		customer.OwnerUserID = domain.ResolveOwnerOnCreateRoles(cmd.ActorUserID, cmd.ActorRoles, "")
		if err := createCustomerTx(ctx, tx, &customer, orgID); err != nil {
			return nil, err
		}
	} else {
		var ownerID string
		err := tx.QueryRow(ctx, `
			SELECT id, name, active, COALESCE(owner_user_id::text, '')
			FROM customers
			WHERE id = $1 AND organization_id = $2
			FOR SHARE
		`, cmd.ExistingCustomerID, orgID).Scan(&customer.ID, &customer.Name, &customer.Active, &ownerID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrCustomerNotFound
			}
			return nil, err
		}
		customer.OwnerUserID = ownerID
		if !customer.Active || !domain.CanAccessOwnedResourceRoles(cmd.ActorUserID, cmd.ActorRoles, ownerID) {
			return nil, ErrCustomerNotFound
		}
	}

	settings, err := s.GetWorkshopSettings(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve project defaults: %w", err)
	}
	project := domain.Project{
		Name:           cmd.ProjectName,
		CustomerID:     customer.ID,
		CreatedBy:      cmd.ActorUserID,
		OwnerUserID:    domain.ResolveOwnerOnCreateRoles(cmd.ActorUserID, cmd.ActorRoles, ""),
		Currency:       settings.DefaultCurrency,
		MarginFactor:   settings.DefaultMarginFactor,
		LaborFixedCost: settings.DefaultLaborFixedCost,
		Status:         domain.StatusDraft,
		Items:          []domain.ProjectItem{},
	}
	if err := createProjectTx(ctx, tx, &project); err != nil {
		return nil, err
	}

	design, err := s.CreateDesign(ctx, CreateDesignCommand{
		ProjectID: project.ID, Name: cmd.DesignName, Status: domain.DesignStatusActive,
		ActorUserID: cmd.ActorUserID, IP: cmd.IP, RequestID: cmd.RequestID,
	})
	if err != nil {
		return nil, err
	}

	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType: "sketchup_project_design_bootstrapped", ActorUserID: cmd.ActorUserID,
		OrganizationID: orgID, IP: cmd.IP, RequestID: cmd.RequestID,
		Details: map[string]any{
			"customer_id": customer.ID, "project_id": project.ID, "design_id": design.ID,
			"customer_created": cmd.NewCustomerName != "",
		},
	}); err != nil {
		return nil, fmt.Errorf("audit sketchup project bootstrap: %w", err)
	}

	return &BootstrapProjectDesignResult{Customer: customer, Project: project, Design: *design}, nil
}
