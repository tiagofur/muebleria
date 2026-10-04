package domain

import (
	"strings"
	"time"
)

// Contrato: identidad y acceso — roles, licencias, usuario, estado de
// cuenta y sectores de operador.
type UserRole string

const (
	RoleAdmin             UserRole = "admin"
	RoleUser              UserRole = "user" // approved account without job title
	RoleVendedor          UserRole = "vendedor"
	RoleGerenteVentas     UserRole = "gerente_ventas"
	RoleGerenteProduccion UserRole = "gerente_produccion"
	RoleIngeniero         UserRole = "ingeniero"
	RoleProduccion        UserRole = "produccion" // production worker, scoped by user_sectors
	RoleAlmacen           UserRole = "almacen"    // warehouse worker, scoped by user_sectors
)

// IsValidUserRole reports whether role is an allowed account role (F035 product roles).
func IsValidUserRole(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleUser, RoleVendedor, RoleGerenteVentas, RoleGerenteProduccion, RoleIngeniero, RoleProduccion, RoleAlmacen:
		return true
	default:
		return false
	}
}

// LicensePlan is the per-user licensing tier managed by the workshop admin.
type LicensePlan string

const (
	LicensePlanNone  LicensePlan = "none"
	LicensePlanTrial LicensePlan = "trial"
	LicensePlanPro   LicensePlan = "pro"
)

// IsValidLicensePlan reports whether plan is an allowed license tier.
func IsValidLicensePlan(plan LicensePlan) bool {
	switch plan {
	case LicensePlanNone, LicensePlanTrial, LicensePlanPro:
		return true
	default:
		return false
	}
}

// LicenseStatus is the derived, point-in-time licensing state of a user.
type LicenseStatus string

const (
	LicenseStatusNone    LicenseStatus = "none"
	LicenseStatusActive  LicenseStatus = "active"
	LicenseStatusExpired LicenseStatus = "expired"
)

// LicenseStatusAt derives the licensing state of a user at a point in time.
// A license is active when the plan is not "none" and the expiry (when set)
// is in the future. Pure function: callers pass `now` explicitly.
func LicenseStatusAt(plan LicensePlan, expiresAt *time.Time, now time.Time) LicenseStatus {
	if plan == LicensePlanNone || plan == "" {
		return LicenseStatusNone
	}
	if expiresAt != nil && !now.Before(*expiresAt) {
		return LicenseStatusExpired
	}
	return LicenseStatusActive
}

type ProjectStatus string

const (
	StatusDraft    ProjectStatus = "draft"
	StatusQuoted   ProjectStatus = "quoted"
	StatusAccepted ProjectStatus = "accepted"
	StatusProduced ProjectStatus = "produced"
)

// User identity. Roles live in memberships (ADR-0005) and licensing in the
// organization — the deprecated users.role / users.license_* columns were
// dropped in migration 000090.
type User struct {
	ID              string        `json:"id"`
	Email           string        `json:"email"`
	NormalizedEmail string        `json:"normalized_email"`
	PasswordHash    string        `json:"-"`
	Name            string        `json:"name"`
	AccountStatus   AccountStatus `json:"account_status"`
	EmailVerifiedAt *time.Time    `json:"email_verified_at,omitempty"`
	LastLoginAt     *time.Time    `json:"last_login_at,omitempty"`
	PlatformAdmin   bool          `json:"platform_admin"`
	CreatedAt       time.Time     `json:"created_at"`
	UpdatedAt       time.Time     `json:"updated_at"`
}

type AccountStatus string

const (
	AccountStatusActive   AccountStatus = "active"
	AccountStatusDisabled AccountStatus = "disabled"
)

// NormalizeEmail is the single identity key normalization used by login,
// invitation and administrative identity commands. PostgreSQL independently
// enforces uniqueness on the resulting normalized_email value.
func NormalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// UserSector maps an operator to one or more production sectors.
type UserSector struct {
	UserID    string    `json:"user_id"`
	Sector    string    `json:"sector"`
	SubSector string    `json:"sub_sector,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// ProjectPicking is one project × material picking state (Fase 3 — Compras/Almacén).
// Status is "pendiente" or "despachado"; MarkedAt/MarkedBy are stamped by the
// server on despacho (who/when traceability). MarkedByName is the joined user
// display name for the list response.
