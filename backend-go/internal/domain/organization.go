// Multi-organization identity (ADR-0004 / #325): organizations own business
// data row-level; users belong to N organizations through memberships whose
// roles reference the canonical UserRole set (contracts/roles.json).

package domain

import "time"

type OrganizationType string

const (
	OrganizationTypeFactory OrganizationType = "factory"
	OrganizationTypeStore   OrganizationType = "store"
	OrganizationTypeDealer  OrganizationType = "dealer"
)

func IsValidOrganizationType(t OrganizationType) bool {
	switch t {
	case OrganizationTypeFactory, OrganizationTypeStore, OrganizationTypeDealer:
		return true
	}
	return false
}

type Organization struct {
	ID               string           `json:"id"`
	Name             string           `json:"name"`
	Slug             string           `json:"slug"`
	Type             OrganizationType `json:"type"`
	LicensePlan      LicensePlan      `json:"license_plan"`
	LicenseExpiresAt *time.Time       `json:"license_expires_at,omitempty"`
	Active           bool             `json:"active"`
	// ParentOrganizationID links a connected store/dealer to its factory
	// (#326 sales network). Nil for independent organizations.
	ParentOrganizationID *string   `json:"parent_organization_id,omitempty"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// Membership is a user's set of roles inside one organization. Roles are a
// set (multi-role memberships) even while assignment flows still write a
// single role — the RBAC union sweep lands in F170b.
type Membership struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organization_id"`
	UserID         string    `json:"user_id"`
	Roles          []UserRole `json:"roles"`
	Active         bool      `json:"active"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// MembershipWithOrg is the login / organization-selector projection: the
// membership joined with its organization (id, name, slug, license).
type MembershipWithOrg struct {
	Membership
	Organization Organization `json:"organization"`
}

// IsValidRoleSet reports whether every entry is a canonical role and the set
// is non-empty. Mirrors the memberships.roles DB CHECK.
func IsValidRoleSet(roles []UserRole) bool {
	if len(roles) == 0 {
		return false
	}
	for _, r := range roles {
		if !IsValidUserRole(r) {
			return false
		}
	}
	return true
}

// SupportSession is a platform admin's time-boxed, reason-tagged access into
// one organization (ADR-0005 §5). Effective role is admin of that org; the
// real actor stays the platform admin in every write.
type SupportSession struct {
	ID                  string    `json:"id"`
	PlatformAdminUserID string    `json:"platform_admin_user_id"`
	OrganizationID      string    `json:"organization_id"`
	Reason              string    `json:"reason"`
	StartedAt           time.Time `json:"started_at"`
	ExpiresAt           time.Time `json:"expires_at"`
	EndedAt             *time.Time `json:"ended_at,omitempty"`
	EndedVia            string    `json:"ended_via,omitempty"`
}

// commercialRoleSet is what store/dealer organizations may use: commercial +
// coordination roles only (no engineering/production operators).
var commercialRoleSet = map[UserRole]struct{}{
	RoleAdmin: {}, RoleUser: {}, RoleVendedor: {}, RoleGerenteVentas: {},
}

// AllowedRolesForOrgType restricts which membership roles each organization
// type may assign (#326: "Store roles are restricted to allowed roles").
func AllowedRolesForOrgType(orgType OrganizationType) []UserRole {
	all := []UserRole{RoleAdmin, RoleUser, RoleVendedor, RoleGerenteVentas,
		RoleGerenteProduccion, RoleIngeniero, RoleProduccion, RoleAlmacen}
	if orgType == OrganizationTypeStore || orgType == OrganizationTypeDealer {
		out := make([]UserRole, 0, len(commercialRoleSet))
		for _, r := range all {
			if _, ok := commercialRoleSet[r]; ok {
				out = append(out, r)
			}
		}
		return out
	}
	return all
}

// RoleAllowedInOrg reports whether the role may be assigned in the org type.
func RoleAllowedInOrg(role UserRole, orgType OrganizationType) bool {
	if orgType == OrganizationTypeStore || orgType == OrganizationTypeDealer {
		_, ok := commercialRoleSet[role]
		return ok
	}
	return true
}

// RolesAllowedInOrg validates a whole set for the org type (non-empty +
// canonical + allowed).
func RolesAllowedInOrg(roles []UserRole, orgType OrganizationType) bool {
	if !IsValidRoleSet(roles) {
		return false
	}
	for _, r := range roles {
		if !RoleAllowedInOrg(r, orgType) {
			return false
		}
	}
	return true
}
