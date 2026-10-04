package api

// Contrato: proyecciones DTO de identidad — usuario público, usuario/org
// OpenAPI, membresías y aliases de DTO de auth. Consumidas por handlers de
// auth, orgs y catálogo que serializan identidad y membresías.

import (
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// PublicUserDTO is the safe public representation of a user, guaranteeing
// that internal secrets (such as password hashes) are never serialized (OC-005).
// PublicUserDTO is the identity projection: roles live in the membership
// (sent as the `roles` sibling in auth responses) and licensing in the
// organization — users.role/users.license_* were dropped (000090).
type PublicUserDTO struct {
	ID            string               `json:"id"`
	Email         string               `json:"email"`
	Name          string               `json:"name"`
	AccountStatus domain.AccountStatus `json:"account_status"`
	PlatformAdmin bool                 `json:"platform_admin"`
	CreatedAt     time.Time            `json:"created_at"`
	UpdatedAt     time.Time            `json:"updated_at"`
}

func ToPublicUserDTO(u *domain.User) PublicUserDTO {
	if u == nil {
		return PublicUserDTO{}
	}
	return PublicUserDTO{
		ID:            u.ID,
		Email:         u.Email,
		Name:          u.Name,
		AccountStatus: u.AccountStatus,
		PlatformAdmin: u.PlatformAdmin,
		CreatedAt:     u.CreatedAt,
		UpdatedAt:     u.UpdatedAt,
	}
}

func ToPublicUserDTOs(users []domain.User) []PublicUserDTO {
	if users == nil {
		return []PublicUserDTO{}
	}
	out := make([]PublicUserDTO, len(users))
	for i, u := range users {
		out[i] = ToPublicUserDTO(&u)
	}
	return out
}

func toOpenAPIUser(u *domain.User) openapi.User {
	created, updated := u.CreatedAt.UTC().Format(time.RFC3339Nano), u.UpdatedAt.UTC().Format(time.RFC3339Nano)
	out := openapi.User{ID: u.ID, Email: u.Email, NormalizedEmail: u.NormalizedEmail, Name: u.Name, AccountStatus: openapi.AccountStatus(u.AccountStatus), PlatformAdmin: u.PlatformAdmin, CreatedAt: created, UpdatedAt: updated}
	if u.EmailVerifiedAt != nil {
		value := u.EmailVerifiedAt.UTC().Format(time.RFC3339Nano)
		out.EmailVerifiedAt = &value
	}
	if u.LastLoginAt != nil {
		value := u.LastLoginAt.UTC().Format(time.RFC3339Nano)
		out.LastLoginAt = &value
	}
	return out
}

func toOpenAPIOrganization(o domain.Organization) openapi.OrganizationSummary {
	license := openapi.License{Plan: string(o.LicensePlan), Status: string(domain.LicenseStatusAt(o.LicensePlan, o.LicenseExpiresAt, time.Now()))}
	if o.LicenseExpiresAt != nil {
		value := o.LicenseExpiresAt.UTC().Format(time.RFC3339Nano)
		license.ExpiresAt = &value
	}
	return openapi.OrganizationSummary{ID: o.ID, Name: o.Name, Slug: o.Slug, Type: string(o.Type), Status: openapi.OrganizationStatus(o.Status), License: license}
}

type LicenseDTO = openapi.License
type LoginResponse = openapi.LoginResponse
type OrgSummaryDTO = openapi.OrganizationSummary
type MembershipDTO = openapi.Membership

func toOrgSummaryDTO(o domain.Organization) OrgSummaryDTO {
	return toOpenAPIOrganization(o)
}

func toMembershipDTOs(list []domain.MembershipWithOrg) []MembershipDTO {
	out := make([]MembershipDTO, 0, len(list))
	for _, m := range list {
		if m.Status != domain.MembershipStatusActive || m.Organization.Status != domain.OrganizationStatusActive {
			continue
		}
		roles := make([]string, len(m.Roles))
		for i, role := range m.Roles {
			roles[i] = string(role)
		}
		out = append(out, MembershipDTO{
			ID: m.ID, OrganizationID: m.OrganizationID, UserID: m.UserID,
			Status: openapi.MembershipStatus(m.Status), Roles: roles,
			JoinedAt:     m.JoinedAt.UTC().Format(time.RFC3339Nano),
			Organization: toOrgSummaryDTO(m.Organization), Version: m.Version,
		})
	}
	return out
}

func rolesToStrings(roles []domain.UserRole) []string {
	out := make([]string, len(roles))
	for i, role := range roles {
		out[i] = string(role)
	}
	return out
}
