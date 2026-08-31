export type ServerSessionMode = 'auth' | 'support' | 'recovery';

export interface SessionScope {
  readonly userId: string;
  readonly membershipId: string | null;
  readonly organizationId: string | null;
  readonly mode: ServerSessionMode;
  readonly supportSessionId: string | null;
  readonly recoverySessionId: string | null;
  readonly membershipCredentialVersion: number | null;
  readonly organizationCredentialVersion: number | null;
  readonly absoluteExpiresAt: string;
}

export function sessionScopeKey(scope: SessionScope) {
  return [
    'session',
    scope.userId,
    scope.membershipId,
    scope.organizationId,
    scope.mode,
    scope.supportSessionId,
    scope.recoverySessionId,
    scope.membershipCredentialVersion,
    scope.organizationCredentialVersion,
    scope.absoluteExpiresAt,
  ] as const;
}
