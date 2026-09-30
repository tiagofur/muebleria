/**
 * Hook for managing factory manufacturing library construction policy and overlay (#875).
 * Connects SettingsScreen and component editors to the organization's active overlay.
 */

import { useEffect, useState } from 'react';
import {
  type FactoryConstructionPolicy,
  DEFAULT_FACTORY_CONSTRUCTION_POLICY,
  overlayOverridesToPolicy,
} from '@granete/domain';
import {
  GraneteApiClient,
  type LibraryOverlayDetail,
  type LibraryReleaseSummary,
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
  const [policy, setPolicy] = useState<FactoryConstructionPolicy>(DEFAULT_FACTORY_CONSTRUCTION_POLICY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !token) return;
    let cancelled = false;
    const client = new GraneteApiClient(baseUrl);

    setLoading(true);
    setError(null);

    Promise.all([
      client.getActiveStandardLibraryOverlay(token),
      client.getStandardCurrentRelease(token).catch(() => null),
    ])
      .then(([overlay, currentRel]) => {
        if (cancelled) return;
        setActiveOverlay(overlay);
        setBaseRelease(currentRel);
        if (overlay?.overrides) {
          setPolicy(overlayOverridesToPolicy(overlay.overrides as Record<string, unknown>));
        } else {
          setPolicy(DEFAULT_FACTORY_CONSTRUCTION_POLICY);
        }
      })
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
  }, [baseUrl, token, enabled]);

  const savePolicy = async (nextPolicy: FactoryConstructionPolicy) => {
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
  };

  return {
    activeOverlay,
    baseRelease,
    policy,
    setPolicy,
    savePolicy,
    loading,
    saving,
    error,
  };
}
