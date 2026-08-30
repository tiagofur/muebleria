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

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func toFactoryOrganization(o domain.Organization) openapi.FactoryOrganization {
	return openapi.FactoryOrganization{
		ID: o.ID, Name: o.Name, Slug: o.Slug, Type: string(o.Type),
		Status: openapi.OrganizationStatus(o.Status), CreatedAt: o.CreatedAt.UTC().Format(time.RFC3339Nano), Version: o.Version,
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

var validOrganizationSlug = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])$`)

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
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	list, err := s.Store.ListConnectedOrganizations(r.Context(), claims.OrgID)
	if err != nil {
		respondWithInternalError(w, err, "factory network")
		return
	}
	out := make([]openapi.FactoryOrganization, 0, len(list))
	for _, organization := range list {
		out = append(out, toFactoryOrganization(organization))
	}
	respondWithJSON(w, http.StatusOK, out)
}
