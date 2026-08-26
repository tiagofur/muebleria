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
	CreatedAt        time.Time        `json:"created_at"`
	UpdatedAt        time.Time        `json:"updated_at"`
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
