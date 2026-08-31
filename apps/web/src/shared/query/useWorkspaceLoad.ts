import { useEffect } from 'react';
import type { SessionMode } from '../../session';
import type { SessionScope } from './sessionScope';
export function workspaceLoadScopeKey(
  session: SessionMode | null,
  scope: SessionScope | null,
): string | null {
  if (session === null) return null;
  if (session === 'guest') return 'guest';
  if (!scope) return null;
  return JSON.stringify([
    scope.sessionGeneration,
    scope.userId,
    scope.organizationId,
    scope.mode,
  ]);
}
export function useWorkspaceLoad({
  session,
  sessionScope,
  loadWorkspace,
  resetWorkspace,
}: {
  readonly session: SessionMode | null;
  readonly sessionScope: SessionScope | null;
  readonly loadWorkspace: () => Promise<void>;
  readonly resetWorkspace: () => void;
}): void {
  const scopeKey = workspaceLoadScopeKey(session, sessionScope);
  useEffect(() => {
    if (scopeKey === null) return;
    resetWorkspace();
    void loadWorkspace();
  }, [scopeKey, loadWorkspace, resetWorkspace]);
}
