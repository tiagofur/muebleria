/**
 * #1325: opening profiles data hook — list/create/update/deactivate through
 * the generated client, org-scoped by the session token. Writes are
 * If-Match guarded (412 surfaces as VERSION_CONFLICT for the stale-write
 * UX); the list refetch is the version authority after every accepted
 * write. Mirrors useHardwareProfiles.
 */

import { useCallback, useEffect, useState } from 'react';
import type { OpeningProfile } from '@granete/storage';
import { GraneteApiClient } from '@granete/storage';
import {
  openingProfileWriteBody,
  type OpeningProfileDraft,
  type OpeningProfileRow,
} from '@granete/ui';

function toRow(profile: OpeningProfile): OpeningProfileRow {
  return {
    id: profile.id,
    code: profile.code,
    name: profile.name,
    gripType: profile.grip_type,
    crossSection: profile.cross_section_shape ?? null,
    placements: profile.compatible_placements,
    datasheetStatus: profile.datasheet_status,
    frontReductionMm: profile.front_reduction_mm ?? null,
    gripClearanceMm: profile.grip_clearance_mm ?? null,
    profileHeightMm: profile.profile_height_mm ?? null,
    profileDepthMm: profile.profile_depth_mm ?? null,
    geometryOrigin: profile.geometry_origin ?? null,
    bodyModifiers: profile.body_modifiers ?? [],
    bomMembers: profile.bom_members ?? null,
    bomMemberKeys: Object.keys(profile.bom_members ?? {}),
    active: profile.active,
    version: profile.version,
  };
}

export interface UseOpeningProfilesResult {
  readonly profiles: readonly OpeningProfileRow[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => void;
  readonly create: (id: string, draft: OpeningProfileDraft) => Promise<void>;
  readonly update: (id: string, expectedVersion: number, draft: OpeningProfileDraft) => Promise<void>;
  readonly deactivate: (id: string, expectedVersion: number) => Promise<void>;
}

export function useOpeningProfiles(
  baseUrl: string,
  token: string | null,
  enabled: boolean,
): UseOpeningProfilesResult {
  const [profiles, setProfiles] = useState<readonly OpeningProfileRow[]>([]);
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
      .listOpeningProfiles(token)
      .then((rows) => {
        if (!cancelled) setProfiles(rows.map(toRow));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar perfiles de apertura');
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
    async (id: string, draft: OpeningProfileDraft): Promise<void> => {
      if (!token) throw new Error('sin sesión');
      const client = new GraneteApiClient(baseUrl);
      await client.createOpeningProfile(token, {
        id,
        ...openingProfileWriteBody(draft),
      });
      reload();
    },
    [baseUrl, token, reload],
  );

  const update = useCallback(
    async (id: string, expectedVersion: number, draft: OpeningProfileDraft): Promise<void> => {
      if (!token) throw new Error('sin sesión');
      const client = new GraneteApiClient(baseUrl);
      await client.updateOpeningProfile(token, id, expectedVersion, openingProfileWriteBody(draft));
      reload();
    },
    [baseUrl, token, reload],
  );

  const deactivate = useCallback(
    async (id: string, expectedVersion: number): Promise<void> => {
      if (!token) throw new Error('sin sesión');
      const client = new GraneteApiClient(baseUrl);
      await client.deactivateOpeningProfile(token, id, expectedVersion);
      reload();
    },
    [baseUrl, token, reload],
  );

  return { profiles, loading, error, reload, create, update, deactivate };
}
