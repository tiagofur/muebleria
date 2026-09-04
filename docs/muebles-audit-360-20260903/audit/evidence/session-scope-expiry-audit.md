# /auth/me reports access-token expiry as SessionScope absolute expiry

HandleMe assigns SessionScope.AbsoluteExpiresAt from claims.ExpiresAt. Token minting sets that claim to transport access expiry; Web access rolls from mint and is capped by the independently stored absolute session bound. The two deadlines are not generally equal.

sessionScopeFromSession copies the value without reinterpretation; sessionScopeKey includes it, and query roots inherit the key. If /auth/me is projected again after a refresh changes access exp while retaining the same sessionGeneration, the projected cache key changes despite unchanged sid/user/org/epochs.

Normal same-identity rotateCookie only applies the Web credential and does not automatically rehydrate SessionScope. The scheduler uses accessExpiresAt and absoluteSessionExpiresAt from LoginResponse, not SessionScope.absoluteExpiresAt, so this finding does not establish broken normal refresh or premature logout.

**Not demonstrated:** No forced logout at minute 15, session extension, authorization bypass, cross-tenant leak, or runtime cache churn was demonstrated. Do not claim any of these.

Use the authoritative registry absolute deadline in /auth/me and preserve a stable query-scope identity across ordinary access refresh. Add a contract regression with a short access token, longer registry session, same sid and repeated /auth/me before/after refresh.

The regression was not executed or implemented; this report is a confirmed source-data mismatch with bounded conditional consumer impact, not an observed user incident.

Evidence: backend-go/internal/api/handlers.go:2575-2580, backend-go/internal/auth/auth.go:440-459, backend-go/internal/auth/auth.go:477-498, apps/web/src/shared/query/sessionScope.ts:38-83, apps/web/src/webAuthClient.ts:177-194, apps/web/src/shared/query/queryKeys.ts:25-28, apps/web/src/stores/workspaceStore.ts:647-696, apps/web/src/AppContent.tsx:628-631, apps/web/src/webAuthClient.ts:276-291, apps/web/src/webAuthClient.ts:423-469, apps/web/src/webAuthRuntime.ts:137-142
