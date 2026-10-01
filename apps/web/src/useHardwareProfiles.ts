/**
 * #914: hardware profiles data hook — list/create/update/deactivate through
 * the generated client, org-scoped by the session token. Updates and
 * deactivations are If-Match guarded (412 surfaces as VERSION_CONFLICT for
 * the stale-write UX); the list refetch is the version authority after every
 * accepted write.
 */

import { useCallback, useEffect, useState } from 'react';
import type { HardwareProfile } from '@granete/storage';
import { GraneteApiClient } from '@granete/storage';
import type { HardwareProfileDraft } from '@granete/ui';

export interface HardwareProfileItemRowView {
  readonly hardwareId: string;
  readonly quantity: number;
  readonly applicationRole: string;
}

export interface HardwareProfileRowView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly revision: string;
  readonly itemCount: number;
  readonly hasRecipe: boolean;
  readonly active: boolean;
  readonly version: number;
  /** Full items for the edit draft (the list response carries them). */
  readonly items: readonly HardwareProfileItemRowView[];
}

function toRow(profile: HardwareProfile): HardwareProfileRowView {
  const items = (profile.items ?? []).map((item) => ({
    hardwareId: item.hardwareId,
    quantity: item.quantity,
    applicationRole: item.applicationRole ?? '',
  }));
  return {
    id: profile.id,
    code: profile.code,
    name: profile.name,
    description: profile.description ?? '',
    revision: profile.revision,
    itemCount: items.length,
    hasRecipe: profile.recipe !== undefined,
    active: profile.active,
    version: profile.version,
    items,
  };
}

function profileWriteBody(draft: HardwareProfileDraft) {
  return {
    code: draft.code,
    name: draft.name,
    description: draft.description,
    revision: draft.revision,
    items: draft.items.map((item) => ({
      hardwareId: item.hardwareId,
      quantity: Number(item.quantity),
      ...(item.applicationRole ? { applicationRole: item.applicationRole } : {}),
    })),
  };
}

export interface UseHardwareProfilesResult {
  readonly profiles: readonly HardwareProfileRowView[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => void;
  readonly create: (draft: HardwareProfileDraft) => Promise<void>;
  readonly update: (id: string, expectedVersion: number, draft: HardwareProfileDraft) => Promise<void>;
  readonly deactivate: (id: string, expectedVersion: number) => Promise<void>;
}

export function useHardwareProfiles(
  baseUrl: string,
  token: string | null,
  enabled: boolean,
): UseHardwareProfilesResult {
  const [profiles, setProfiles] = useState<readonly HardwareProfileRowView[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!enabled || !token) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const client = new GraneteApiClient(baseUrl);
    client
      .listHardwareProfiles(token)
      .then((rows) => {
        if (!cancelled) setProfiles(rows.map(toRow));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar perfiles');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, enabled, reloadTick]);

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

  const create = useCallback(
    async (draft: HardwareProfileDraft): Promise<void> => {
      if (!token) throw new Error('sin sesión');
      const client = new GraneteApiClient(baseUrl);
      await client.createHardwareProfile(token, profileWriteBody(draft));
      reload();
    },
    [baseUrl, token, reload],
  );

  const update = useCallback(
    async (id: string, expectedVersion: number, draft: HardwareProfileDraft): Promise<void> => {
      if (!token) throw new Error('sin sesión');
      const client = new GraneteApiClient(baseUrl);
      await client.updateHardwareProfile(token, id, expectedVersion, profileWriteBody(draft));
      reload();
    },
    [baseUrl, token, reload],
  );

  const deactivate = useCallback(
    async (id: string, expectedVersion: number): Promise<void> => {
      if (!token) throw new Error('sin sesión');
      const client = new GraneteApiClient(baseUrl);
      await client.deactivateHardwareProfile(token, id, expectedVersion);
      reload();
    },
    [baseUrl, token, reload],
  );

  return { profiles, loading, error, reload, create, update, deactivate };
}
