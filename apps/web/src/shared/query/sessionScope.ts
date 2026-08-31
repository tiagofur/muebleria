import { parseGenerated, type MeResponse } from '@granete/storage';

declare const sessionGenerationBrand: unique symbol;
const sessionScopeBrand: unique symbol = Symbol('SessionScope');

export type SessionGeneration = string & {
  readonly [sessionGenerationBrand]: true;
};

export type SessionScope = {
  readonly [sessionScopeBrand]: true;
  readonly sessionGeneration: SessionGeneration;
  readonly userId: string;
  readonly organizationId: string | null;
  readonly mode: 'auth' | 'support';
  readonly supportSessionId: string | null;
  readonly transport: MeResponse['transport'];
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
  return {
    [sessionScopeBrand]: true,
    sessionGeneration,
    userId: validated.user.id,
    organizationId: validated.organization?.id ?? null,
    mode: validated.support ? 'support' : 'auth',
    supportSessionId: validated.support?.session_id ?? null,
    transport: validated.transport,
  };
}

export function sessionScopeKey(scope: SessionScope) {
  return [
    'session',
    scope.sessionGeneration,
    scope.userId,
    scope.organizationId,
    scope.mode,
    scope.supportSessionId,
    scope.transport,
  ] as const;
}
