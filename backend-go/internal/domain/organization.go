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

type OrganizationStatus string

const (
	OrganizationStatusProvisioning       OrganizationStatus = "provisioning"
	OrganizationStatusActive             OrganizationStatus = "active"
	OrganizationStatusSuspended          OrganizationStatus = "suspended"
	OrganizationStatusOffboarding        OrganizationStatus = "offboarding"
	OrganizationStatusTerminated         OrganizationStatus = "terminated"
	OrganizationStatusProvisioningFailed OrganizationStatus = "provisioning_failed"
)

func IsValidOrganizationStatus(status OrganizationStatus) bool {
	switch status {
	case OrganizationStatusProvisioning,
		OrganizationStatusActive,
		OrganizationStatusSuspended,
		OrganizationStatusOffboarding,
		OrganizationStatusTerminated,
		OrganizationStatusProvisioningFailed:
		return true
	}
	return false
}

func CanTransitionOrganizationStatus(from, to OrganizationStatus) bool {
	switch from {
	case OrganizationStatusProvisioning:
		return to == OrganizationStatusActive || to == OrganizationStatusProvisioningFailed
	case OrganizationStatusProvisioningFailed:
		return to == OrganizationStatusProvisioning || to == OrganizationStatusTerminated
	case OrganizationStatusActive:
		return to == OrganizationStatusSuspended || to == OrganizationStatusOffboarding
	case OrganizationStatusSuspended:
		return to == OrganizationStatusActive || to == OrganizationStatusOffboarding
	case OrganizationStatusOffboarding:
		return to == OrganizationStatusTerminated
	}
	return false
}

type OrganizationEntitlementSource string

const (
	OrganizationEntitlementSourceLegacyUnlimited  OrganizationEntitlementSource = "legacy_unlimited"
	OrganizationEntitlementSourcePlanDefault      OrganizationEntitlementSource = "plan_default"
	OrganizationEntitlementSourcePlatformOverride OrganizationEntitlementSource = "platform_override"
)

type OrganizationEntitlements struct {
	OrganizationID       string                        `json:"organization_id"`
	MaxActiveMembers     *int64                        `json:"max_active_members"`
	MaxSalesPartners     int64                         `json:"max_sales_partners"`
	ManufacturingEnabled bool                          `json:"manufacturing_enabled"`
	SalesNetworkEnabled  bool                          `json:"sales_network_enabled"`
	SketchupSeats        int64                         `json:"sketchup_seats"`
	AdvancedAuditEnabled bool                          `json:"advanced_audit_enabled"`
	Source               OrganizationEntitlementSource `json:"source"`
	DefaultsRevision     string                        `json:"defaults_revision"`
	Version              int64                         `json:"version"`
	UpdatedAt            time.Time                     `json:"updated_at"`
}

type Organization struct {
	ID                   string             `json:"id"`
	Name                 string             `json:"name"`
	Slug                 string             `json:"slug"`
	Type                 OrganizationType   `json:"type"`
	LicensePlan          LicensePlan        `json:"license_plan"`
	LicenseExpiresAt     *time.Time         `json:"license_expires_at,omitempty"`
	Status               OrganizationStatus `json:"status"`
	CredentialVersion    int64              `json:"credential_version"`
	StatusChangedAt      time.Time          `json:"status_changed_at"`
	StatusChangedBy      *string            `json:"status_changed_by,omitempty"`
	StatusReason         *string            `json:"status_reason,omitempty"`
	SuspendedAt          *time.Time         `json:"suspended_at,omitempty"`
	OffboardingStartedAt *time.Time         `json:"offboarding_started_at,omitempty"`
	TerminatedAt         *time.Time         `json:"terminated_at,omitempty"`
	// ParentOrganizationID links a connected store/dealer to its factory
	// (#326 sales network). Nil for independent organizations.
	ParentOrganizationID *string   `json:"parent_organization_id,omitempty"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
	Version              int64     `json:"version"`
}

// Membership is a user's set of roles inside one organization. Roles are a
// set (multi-role memberships) even while assignment flows still write a
// single role — the RBAC union sweep lands in F170b.
type Membership struct {
	ID                string           `json:"id"`
	OrganizationID    string           `json:"organization_id"`
	UserID            string           `json:"user_id"`
	Roles             []UserRole       `json:"roles"`
	Status            MembershipStatus `json:"status"`
	JoinedAt          time.Time        `json:"joined_at"`
	SuspendedAt       *time.Time       `json:"suspended_at,omitempty"`
	SuspendedBy       *string          `json:"suspended_by,omitempty"`
	SuspensionReason  *string          `json:"suspension_reason,omitempty"`
	LeftAt            *time.Time       `json:"left_at,omitempty"`
	LeftBy            *string          `json:"left_by,omitempty"`
	LeaveReason       *string          `json:"leave_reason,omitempty"`
	CreatedAt         time.Time        `json:"created_at"`
	UpdatedAt         time.Time        `json:"updated_at"`
	Version           int64            `json:"version"`
	CredentialVersion int64            `json:"credential_version"`
	SessionsRevokedAt *time.Time       `json:"sessions_revoked_at,omitempty"`
}

type MembershipStatus string

const (
	MembershipStatusActive    MembershipStatus = "active"
	MembershipStatusSuspended MembershipStatus = "suspended"
	MembershipStatusLeft      MembershipStatus = "left"
)

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
	ID                                string             `json:"id"`
	PlatformAdminUserID               string             `json:"platform_admin_user_id"`
	OrganizationID                    string             `json:"organization_id"`
	OrganizationCredentialVersion     int64              `json:"organization_credential_version"`
	LiveOrganizationStatus            OrganizationStatus `json:"-"`
	LiveOrganizationCredentialVersion int64              `json:"-"`
	Reason                            string             `json:"reason"`
	StartedAt                         time.Time          `json:"started_at"`
	ExpiresAt                         time.Time          `json:"expires_at"`
	EndedAt                           *time.Time         `json:"ended_at,omitempty"`
	EndedVia                          string             `json:"ended_via,omitempty"`
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
