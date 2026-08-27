// Organization scope propagation (ADR-0004 / #325).
//
// The authenticated organization travels in the context so storage methods
// can scope reads and writes WITHOUT changing every handler call site:
// AuthMiddleware resolves the live membership, injects the scope and rejects
// org-less tokens on business routes (fail-closed); storage reads it via
// OrgFromCtx and appends `organization_id = $n` to queries.
//
// The initial-organization fallback below is unreachable from HTTP: the
// middleware guarantees a scope on every business route. It remains for
// direct-storage callers only (CLI, migration tooling, tests bootstrapping
// the initial org). The transitional column DEFAULTs were dropped in
// migration 000088 — every write now passes the organization explicitly.

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

// RequireOrgFromCtx resolves the organization scope or fails with
// ErrNoOrgScope — for callers that must not silently fall back.
func RequireOrgFromCtx(ctx context.Context) (string, error) {
	if ctx != nil {
		if v, ok := ctx.Value(orgScopeKey{}).(string); ok && v != "" {
			return v, nil
		}
	}
	return "", ErrNoOrgScope
}

// OrgFromCtx resolves the organization scope. HTTP callers always carry a
// scope (the middleware rejects org-less business requests); the initial-org
// fallback only serves direct-storage tooling (CLI/migrations/tests).
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
