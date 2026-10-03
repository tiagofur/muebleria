/**
 * Hook for managing factory manufacturing library construction policy and overlay (#875, #944).
 * Connects SettingsScreen and component editors to the organization's active overlay,
 * published releases history, and 3-way rebase conflict resolution.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  type FactoryConstructionPolicy,
  DEFAULT_FACTORY_CONSTRUCTION_POLICY,
  overlayOverridesToPolicy,
} from '@granete/domain';
import {
  GraneteApiClient,
  type LibraryOverlayDetail,
  type LibraryReleaseSummary,
  type LibraryOverlayConflictDetail,
  type LibraryOverlayRebaseResult,
} from '@granete/storage';

export interface UseFactoryConstructionPolicyOptions {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly enabled?: boolean;
}

export function useFactoryConstructionPolicy({
  baseUrl,
  token,
  enabled = true,
}: UseFactoryConstructionPolicyOptions) {
  const [activeOverlay, setActiveOverlay] = useState<LibraryOverlayDetail | null>(null);
  const [baseRelease, setBaseRelease] = useState<LibraryReleaseSummary | null>(null);
  const [releases, setReleases] = useState<ReadonlyArray<LibraryReleaseSummary>>([]);
  const [conflicts, setConflicts] = useState<ReadonlyArray<LibraryOverlayConflictDetail>>([]);
  const [policy, setPolicy] = useState<FactoryConstructionPolicy>(DEFAULT_FACTORY_CONSTRUCTION_POLICY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // #875 slice 5: the DRAFT view of the policy (what activation WOULD make
  // effective) — null while no draft differs from the active policy.
  const [drafting, setDrafting] = useState(false);
  const [rebasing, setRebasing] = useState(false);
  const [resolvingConflictId, setResolvingConflictId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async (client: GraneteApiClient, authToken: string) => {
    const [overlay, currentRel, rels] = await Promise.all([
      client.getActiveStandardLibraryOverlay(authToken),
      client.getStandardCurrentRelease(authToken).catch(() => null),
      client.getStandardReleases(authToken).catch(() => []),
    ]);

    setActiveOverlay(overlay);
    setBaseRelease(currentRel);
    setReleases(rels);

    if (overlay?.overrides) {
      setPolicy(overlayOverridesToPolicy(overlay.overrides as Record<string, unknown>));
    } else {
      setPolicy(DEFAULT_FACTORY_CONSTRUCTION_POLICY);
    }

    if (overlay && overlay.status === 'rebase_conflict') {
      try {
        const conflictList = await client.listLibraryOverlayConflicts(authToken, overlay.id);
        const unresolved = conflictList.filter((c) => !c.resolvedAt);
        setConflicts(unresolved);
      } catch {
        setConflicts([]);
      }
    } else {
      setConflicts([]);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !token) return;
    let cancelled = false;
    const client = new GraneteApiClient(baseUrl);

    setLoading(true);
    setError(null);

    fetchState(client, token)
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Error al cargar política de fábrica');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, enabled, fetchState]);

  const latestRelease = useMemo(() => {
    if (releases.length > 0) return releases[0];
    return baseRelease;
  }, [releases, baseRelease]);

  const hasUpstreamUpdate = useMemo(() => {
    if (!activeOverlay || !latestRelease) return false;
    return activeOverlay.baseReleaseId !== latestRelease.id;
  }, [activeOverlay, latestRelease]);

  const savePolicy = useCallback(async (nextPolicy: FactoryConstructionPolicy) => {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const client = new GraneteApiClient(baseUrl);
      const updated = await client.saveConstructionPolicy(token, nextPolicy, activeOverlay);
      setActiveOverlay(updated);
      setPolicy(overlayOverridesToPolicy((updated.overrides ?? {}) as Record<string, unknown>));
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar política de construcción');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [baseUrl, token, activeOverlay]);

  // #875 slice 5: stage the CURRENT editor policy as the overlay's draft.
  // The active policy keeps governing every resolve — the draft only becomes
  // effective through activatePolicyDraft, which the server validates with
  // the engine's own parser before swapping.
  const savePolicyDraft = useCallback(async (nextPolicy: FactoryConstructionPolicy) => {
    if (!token || !activeOverlay) return;
    setDrafting(true);
    setError(null);
    try {
      const client = new GraneteApiClient(baseUrl);
      const updated = await client.savePolicyDraft(token, activeOverlay, nextPolicy);
      setActiveOverlay(updated);
      setPolicy(overlayOverridesToPolicy((updated.overrides ?? {}) as Record<string, unknown>));
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar el borrador de política');
      throw err;
    } finally {
      setDrafting(false);
    }
  }, [baseUrl, token, activeOverlay]);

  // #875 slice 5: promote the staged draft — the server validates with the
  // engine's own policy parser and refuses (422) an unusable policy.
  const activatePolicyDraft = useCallback(async () => {
    if (!token || !activeOverlay) return;
    setDrafting(true);
    setError(null);
    try {
      const client = new GraneteApiClient(baseUrl);
      const updated = await client.activatePolicy(token, activeOverlay);
      setActiveOverlay(updated);
      setPolicy(overlayOverridesToPolicy((updated.overrides ?? {}) as Record<string, unknown>));
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al activar la política de construcción');
      throw err;
    } finally {
      setDrafting(false);
    }
  }, [baseUrl, token, activeOverlay]);

  const rebaseToRelease = useCallback(async (targetReleaseId: string): Promise<LibraryOverlayRebaseResult | undefined> => {
    if (!token || !activeOverlay) return;
    setRebasing(true);
    setError(null);
    try {
      const client = new GraneteApiClient(baseUrl);
      const result = await client.rebaseLibraryOverlay(token, activeOverlay.id, { targetReleaseId });
      
      if (result.hasConflicts) {
        setConflicts(result.conflicts ?? []);
      } else {
        setConflicts([]);
      }

      // Fetch the updated overlay detail
      const updated = await client.getLibraryOverlayById(token, activeOverlay.id);
      setActiveOverlay(updated);
      if (updated.overrides) {
        setPolicy(overlayOverridesToPolicy(updated.overrides as Record<string, unknown>));
      }

      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar versión de biblioteca');
      throw err;
    } finally {
      setRebasing(false);
    }
  }, [baseUrl, token, activeOverlay]);

  const resolveConflict = useCallback(async (
    conflictId: string,
    action: 'keep_custom' | 'adopt_upstream',
  ): Promise<void> => {
    if (!token || !activeOverlay) return;
    setResolvingConflictId(conflictId);
    setError(null);
    try {
      const client = new GraneteApiClient(baseUrl);
      await client.resolveLibraryOverlayConflict(token, activeOverlay.id, conflictId, { action });

      // Refresh conflicts list
      const conflictList = await client.listLibraryOverlayConflicts(token, activeOverlay.id);
      const unresolved = conflictList.filter((c) => !c.resolvedAt);
      setConflicts(unresolved);

      // Refresh overlay state
      const updated = await client.getLibraryOverlayById(token, activeOverlay.id);
      setActiveOverlay(updated);
      if (updated.overrides) {
        setPolicy(overlayOverridesToPolicy(updated.overrides as Record<string, unknown>));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al resolver conflicto de biblioteca');
      throw err;
    } finally {
      setResolvingConflictId(null);
    }
  }, [baseUrl, token, activeOverlay]);

  return {
    activeOverlay,
    baseRelease,
    releases,
    latestRelease,
    hasUpstreamUpdate,
    conflicts,
    policy,
    setPolicy,
    savePolicy,
    savePolicyDraft,
    activatePolicyDraft,
    drafting,
    rebaseToRelease,
    resolveConflict,
    loading,
    saving,
    rebasing,
    resolvingConflictId,
    error,
  };
}
