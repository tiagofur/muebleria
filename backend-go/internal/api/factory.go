package api

// Factory sales network (#326): "Factory Settings → Sales Network → Create
// Store → Invite Team". A factory admin creates connected store/dealer
// organizations; each new org is cloned from the factory's own catalog and
// the creator gets an admin membership so they can switch into it and invite
// the store team. Licenses stay a platform-console concern (ADR-0005).

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ConnectedOrgDTO is the sales-network listing projection.
type ConnectedOrgDTO struct {
	ID        string                  `json:"id"`
	Name      string                  `json:"name"`
	Slug      string                  `json:"slug"`
	Type      domain.OrganizationType `json:"type"`
	Active    bool                    `json:"active"`
	CreatedAt time.Time               `json:"created_at"`
}

func toConnectedOrgDTO(o domain.Organization) ConnectedOrgDTO {
	return ConnectedOrgDTO{
		ID: o.ID, Name: o.Name, Slug: o.Slug, Type: o.Type,
		Active: o.Active, CreatedAt: o.CreatedAt,
	}
}

// requireFactoryAdmin gates the sales-network endpoints: org admin whose
// active organization is a factory.
func (s *Server) requireFactoryAdmin(w http.ResponseWriter, r *http.Request) (*auth.Claims, *domain.Organization, bool) {
	claims, org, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return nil, nil, false
	}
	if org.Type != domain.OrganizationTypeFactory {
		respondWithError(w, http.StatusForbidden, "sólo una fábrica puede gestionar una red de ventas")
		return nil, nil, false
	}
	return claims, org, true
}

// organizations.slug CHECK (000080): ^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$
// — 2..64 chars, no leading/trailing dash.
const orgSlugMaxLen = 64

// slugifyOrgName derives a URL-safe slug from the organization name, clamped
// to the column CHECK. Returns "" when the name cannot produce a valid slug.
func slugifyOrgName(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	re := regexp.MustCompile(`[^a-z0-9]+`)
	s = re.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > orgSlugMaxLen {
		s = strings.Trim(s[:orgSlugMaxLen], "-")
	}
	if len(s) < 2 {
		return ""
	}
	return s
}

// uniqueOrgSlug appends -2, -3… until the slug is free, re-clamping so the
// suffix always fits the column CHECK.
func (s *Server) uniqueOrgSlug(r *http.Request, base string) string {
	slug := base
	for i := 2; ; i++ {
		if _, err := s.Store.GetOrganizationBySlug(r.Context(), slug); err != nil {
			return slug
		}
		suffix := fmt.Sprintf("-%d", i)
		cut := orgSlugMaxLen - len(suffix)
		if cut > len(base) {
			cut = len(base)
		}
		candidate := strings.Trim(base[:cut], "-") + suffix
		if candidate == slug {
			return candidate // defensive: cannot happen with i incrementing
		}
		slug = candidate
	}
}

// HandleFactoryOrganizations: GET /api/factory/organizations (sales network
// listing) and POST (create a connected store/dealer).
func (s *Server) HandleFactoryOrganizations(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := s.requireFactoryAdmin(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListConnectedOrganizations(r.Context(), claims.OrgID)
		if err != nil {
			respondWithInternalError(w, err, "factory network")
			return
		}
		out := make([]ConnectedOrgDTO, 0, len(list))
		for _, o := range list {
			out = append(out, toConnectedOrgDTO(o))
		}
		respondWithJSON(w, http.StatusOK, out)

	case http.MethodPost:
		var body struct {
			Name string `json:"name"`
			Type string `json:"type"`
		}
		if !decodeJSONBody(w, r, &body) || strings.TrimSpace(body.Name) == "" {
			respondWithError(w, http.StatusBadRequest, "name es obligatorio")
			return
		}
		orgType := domain.OrganizationType(body.Type)
		if orgType != domain.OrganizationTypeStore && orgType != domain.OrganizationTypeDealer {
			respondWithError(w, http.StatusBadRequest, "type inválido (store|dealer)")
			return
		}
		baseSlug := slugifyOrgName(body.Name)
		if baseSlug == "" {
			respondWithError(w, http.StatusBadRequest,
				"el nombre es demasiado corto para generar un identificador de taller (mínimo 2 letras o números)")
			return
		}

		child := &domain.Organization{
			Name:   strings.TrimSpace(body.Name),
			Slug:   s.uniqueOrgSlug(r, baseSlug),
			Type:   orgType,
			Active: true,
			// Licenses are assigned per organization by the platform console;
			// a factory cannot grant them (ADR-0005 §3).
			LicensePlan: domain.LicensePlanNone,
		}
		child.ParentOrganizationID = &claims.OrgID
		if err := s.Store.CreateOrganization(r.Context(), child); err != nil {
			respondWithInternalError(w, err, "factory create connected org")
			return
		}

		// Clone the factory's catalog so the store sells the factory's
		// products. A fresh organization is always an empty destination.
		catalogCloned := true
		if err := s.Store.CloneCatalog(r.Context(), claims.OrgID, child.ID); err != nil {
			catalogCloned = false
		}

		// The creator becomes admin of the connected org — that membership is
		// what lets them switch into it (select-org) and invite its team.
		membershipGranted := true
		if err := s.Store.EnsureMembership(r.Context(), child.ID, claims.UserID, []domain.UserRole{domain.RoleAdmin}); err != nil {
			membershipGranted = false
		}

		s.audit(r.Context(), "connected_org_created", claims.UserID, child.ID, clientIP(r), map[string]interface{}{
			"parent_organization_id": claims.OrgID,
			"name":                   child.Name,
			"type":                   string(child.Type),
			"catalog_cloned":         catalogCloned,
			"membership_granted":     membershipGranted,
		})
		respondWithJSON(w, http.StatusCreated, map[string]interface{}{
			"organization":       toConnectedOrgDTO(*child),
			"catalog_cloned":     catalogCloned,
			"membership_granted": membershipGranted,
		})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
