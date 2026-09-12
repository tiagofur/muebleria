import type { MachineOutputSelection } from '@granete/domain';

/**
 * Request truth for the cutting MachineOutputSelection. A successful empty
 * response is intentionally distinct from every state where the server truth
 * is unknown or the exact tuple cannot be used.
 */
export type CuttingOutputSelectionState =
  | { readonly status: 'loading'; readonly scopeKey: string | null }
  | { readonly status: 'error'; readonly scopeKey: string; readonly error: string }
  | { readonly status: 'empty'; readonly scopeKey: string }
  | {
      readonly status: 'configured';
      readonly scopeKey: string;
      readonly selection: MachineOutputSelection;
    }
  | {
      readonly status: 'blocked';
      readonly scopeKey: string;
      readonly selection: MachineOutputSelection;
      readonly reason: string;
    };

export class CuttingOutputUnavailableError extends Error {
  constructor(
    readonly status: 'loading' | 'error' | 'blocked',
    message: string,
  ) {
    super(message);
    this.name = 'CuttingOutputUnavailableError';
  }
}

/**
 * A response from another session/organization is unknown for the current
 * scope. Convert it to loading synchronously, before effects have a chance to
 * reset state, so one render can never expose the previous tenant's policy.
 */
export function forCurrentMachineOutputScope(
  state: CuttingOutputSelectionState,
  currentScopeKey: string | null,
): CuttingOutputSelectionState {
  if (currentScopeKey !== null && state.scopeKey === currentScopeKey) return state;
  return { status: 'loading', scopeKey: currentScopeKey };
}

/** A response may commit only to the exact scope that started its request. */
export function isCurrentMachineOutputRequest(
  requestedScopeKey: string,
  currentScopeKey: string | null,
): boolean {
  return requestedScopeKey === currentScopeKey;
}

/**
 * Single policy boundary shared by direct cutting downloads and Production
 * Pack. Legacy is legal only after a successful, confirmed-empty response.
 */
export async function runWithCuttingOutputAuthority<T>(
  state: CuttingOutputSelectionState,
  routes: {
    readonly selected: (selection: MachineOutputSelection) => Promise<T> | T;
    readonly legacy: () => Promise<T> | T;
  },
): Promise<T> {
  switch (state.status) {
    case 'configured':
      return routes.selected(state.selection);
    case 'empty':
      return routes.legacy();
    case 'loading':
      throw new CuttingOutputUnavailableError(
        'loading',
        'La configuración de salida de corte todavía se está cargando.',
      );
    case 'error':
      throw new CuttingOutputUnavailableError('error', state.error);
    case 'blocked':
      throw new CuttingOutputUnavailableError('blocked', state.reason);
  }
}
