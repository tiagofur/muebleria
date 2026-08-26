// Organization scope propagation (ADR-0004 / #325).
//
// The authenticated organization travels in the context so storage methods
// can scope reads and writes WITHOUT changing every handler call site:
// AuthMiddleware resolves the live membership and injects the scope; storage
// reads it via OrgFromCtx and appends `organization_id = $n` to queries.
//
// Fail-open is deliberate and transitional: requests without a scope (CLI,
// background jobs, legacy tests) resolve to the initial organization, which
// is the entire pre-multi-org dataset. As soon as a request carries a scope,
// isolation is enforced: cross-org reads see nothing and cross-org writes
// affect nothing. The transitional DEFAULT on organization_id columns is
// removed once every write path is scoped.

package storage

import (
	"context"
	"errors"
)

type orgScopeKey struct{}

// ErrNoOrgScope is returned by RequireOrgFromCtx when the context carries no
// organization scope at all (no fallback applies).
var ErrNoOrgScope = errors.New("no organization scope in context")

// WithOrgCtx returns a context carrying the organization scope. An empty
// orgID is ignored (keeps the caller's scope if any).
func WithOrgCtx(ctx context.Context, orgID string) context.Context {
	if orgID == "" {
		return ctx
	}
	return context.WithValue(ctx, orgScopeKey{}, orgID)
}

// OrgFromCtx resolves the organization scope. When absent it falls back to
// the initial organization (transitional single-workshop semantics).
func OrgFromCtx(ctx context.Context) string {
	if ctx != nil {
		if v, ok := ctx.Value(orgScopeKey{}).(string); ok && v != "" {
			return v
		}
	}
	return InitialOrganizationID
}

// HasOrgScope reports whether the context explicitly carries an organization
// scope (used by tests to tell scoped from fallback paths).
func HasOrgScope(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	_, ok := ctx.Value(orgScopeKey{}).(string)
	return ok
}
