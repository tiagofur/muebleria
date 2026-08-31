import {
  parseGenerated,
  type MeResponse,
  type SessionScope as GeneratedSessionScope,
} from '@granete/storage';

declare const sessionGenerationBrand: unique symbol;
const sessionScopeBrand: unique symbol = Symbol('SessionScope');

export type SessionGeneration = string & {
  readonly [sessionGenerationBrand]: true;
};

export type SessionScope = {
  readonly [sessionScopeBrand]: true;
  readonly sessionGeneration: SessionGeneration;
  readonly userId: string;
  readonly membershipId: string | null;
  readonly organizationId: string | null;
  readonly mode: GeneratedSessionScope['mode'];
  readonly supportSessionId: string | null;
  readonly recoverySessionId: string | null;
  readonly membershipCredentialVersion: number | null;
  readonly organizationCredentialVersion: number | null;
  readonly absoluteExpiresAt: string;
};

export function createSessionGeneration(): SessionGeneration {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value) throw new Error('Secure session generation is unavailable');
  return value as SessionGeneration;
}

/**
 * Internal cache-key projection of the generated, runtime-validated session DTO.
 * #460 will replace the ephemeral generation with its authoritative sessionId.
 */
export function sessionScopeFromSession(
  session: unknown,
  sessionGeneration: SessionGeneration,
): SessionScope {
  const validated = parseGenerated<MeResponse>('MeResponse', session);
  const scope = validated.session_scope;
  return {
    [sessionScopeBrand]: true,
    sessionGeneration,
    userId: scope.user_id,
    membershipId: scope.membership_id,
    organizationId: scope.organization_id,
    mode: scope.mode,
    supportSessionId: scope.support_session_id,
    recoverySessionId: scope.recovery_session_id,
    membershipCredentialVersion: scope.membership_credential_version,
    organizationCredentialVersion: scope.organization_credential_version,
    absoluteExpiresAt: scope.absolute_expires_at,
  };
}

export function sessionScopeKey(scope: SessionScope) {
  return [
    'session',
    scope.sessionGeneration,
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
