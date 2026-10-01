/**
 * #915 UI: component side assignments hook — list/set/remove through the
 * generated client for one SAVED component (its server uuid). Immediate-write
 * semantics: every change persists right away (these are a per-entity REST
 * resource, not part of the whole-catalog blob), then the list refetches so
 * the UI never drifts from the server.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ComponentSideAssignment, ComponentSideAssignmentWrite } from '@granete/storage';
import { GraneteApiClient } from '@granete/storage';

type SideName = ComponentSideAssignmentWrite['side'];

export interface UseComponentSideAssignmentsResult {
  readonly assignments: readonly ComponentSideAssignment[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly set: (side: SideName, profileId: string) => Promise<void>;
  readonly remove: (side: SideName) => Promise<void>;
  readonly reload: () => void;
}

export function useComponentSideAssignments(
  baseUrl: string,
  token: string | null,
  componentId: string | null,
  enabled: boolean,
): UseComponentSideAssignmentsResult {
  const [assignments, setAssignments] = useState<readonly ComponentSideAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!enabled || !token || !componentId) {
      setAssignments([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const client = new GraneteApiClient(baseUrl);
    client
      .listComponentSideAssignments(token, componentId)
      .then((rows) => {
        if (!cancelled) setAssignments(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar asignaciones');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, componentId, enabled, reloadTick]);

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

  const set = useCallback(
    async (side: SideName, profileId: string): Promise<void> => {
      if (!token || !componentId) throw new Error('sin componente guardado');
      const client = new GraneteApiClient(baseUrl);
      await client.setComponentSideAssignment(token, componentId, { side, profileId });
      reload();
    },
    [baseUrl, token, componentId, reload],
  );

  const remove = useCallback(
    async (side: SideName): Promise<void> => {
      if (!token || !componentId) throw new Error('sin componente guardado');
      const client = new GraneteApiClient(baseUrl);
      await client.removeComponentSideAssignment(token, componentId, side);
      reload();
    },
    [baseUrl, token, componentId, reload],
  );

  return { assignments, loading, error, set, remove, reload };
}
