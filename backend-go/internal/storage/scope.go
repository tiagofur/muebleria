// Organization scope propagation (ADR-0004 / #325).
//
// The authenticated organization travels in the context so storage methods
// can scope reads and writes WITHOUT changing every handler call site:
// AuthMiddleware resolves the live membership, injects the scope and rejects
// org-less tokens on business routes (fail-closed); storage reads it via
// OrgFromCtx and appends `organization_id = $n` to queries.
//
// There is no runtime fallback. CLI, migrations, seed and tests must carry an
// explicit organization scope or use their dedicated administrative port.

package storage

import (
	"context"
	"errors"
)

type orgScopeKey struct{}
type actorScopeKey struct{}

// TenantActor is the database actor context installed with SET LOCAL for one
// transaction. Values come from revalidated claims or an explicit authorized
// application-service command, never from an arbitrary request body.
type TenantActor struct {
	OrganizationID            string
	UserID                    string
	MembershipID              string
	SupportSessionID          string
	AuthorizedOrganizationIDs []string
}

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

// WithTenantActorCtx carries the complete revalidated actor alongside the
// legacy organization lookup used by existing repositories.
func WithTenantActorCtx(ctx context.Context, actor TenantActor) context.Context {
	ctx = context.WithValue(ctx, actorScopeKey{}, actor)
	return WithOrgCtx(ctx, actor.OrganizationID)
}

// TenantActorFromCtx returns the actor installed for the current transaction.
func TenantActorFromCtx(ctx context.Context) (TenantActor, bool) {
	if ctx == nil {
		return TenantActor{}, false
	}
	actor, ok := ctx.Value(actorScopeKey{}).(TenantActor)
	return actor, ok
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

// OrgFromCtx resolves the explicit organization scope. Missing scope returns
// an empty value so existing SQL fails closed; new boundaries should prefer
// RequireOrgFromCtx and return ErrNoOrgScope directly.
func OrgFromCtx(ctx context.Context) string {
	if ctx != nil {
		if v, ok := ctx.Value(orgScopeKey{}).(string); ok && v != "" {
			return v
		}
	}
	return ""
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
