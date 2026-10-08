import { useCallback, useEffect, useState } from 'react';
import { GraneteApiClient, type LibraryOverlayDetail } from '@granete/storage';
import {
  DEFAULT_OPENING_CAPABILITIES,
  parseOpeningCapabilities,
  type OpeningCapabilities,
} from '@granete/domain';

/**
 * #1134 — the factory's opening capabilities state for the settings screen:
 * reads the active standard-library overlay and parses `opening.capabilities`
 * client-side (the SAME parser the Go engine runs server-side, one shared
 * fixture). `decided` distinguishes "sin decisión de fábrica" (nil blob —
 * the UI shows library defaults) from an explicit factory decision.
 *
 * Saving goes through the owned-key merge (`saveOpeningCapabilities`): only
 * `opening.capabilities` is upserted; the construction policy and every
 * foreign overlay key survive untouched. Available ≠ valid: this state only
 * governs what new authoring may select — existing designs keep resolving
 * against their pinned release.
 */
export function useOpeningCapabilities({
  baseUrl,
  token,
  enabled = true,
}: {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly enabled?: boolean;
}) {
  const [activeOverlay, setActiveOverlay] = useState<LibraryOverlayDetail | null>(null);
  const [capabilities, setCapabilities] = useState<OpeningCapabilities>(DEFAULT_OPENING_CAPABILITIES);
  const [decided, setDecided] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !token) return;
    let cancelled = false;
    const client = new GraneteApiClient(baseUrl);

    setLoading(true);
    setError(null);
    client
      .getActiveStandardLibraryOverlay(token)
      .then((overlay) => {
        if (cancelled) return;
        setActiveOverlay(overlay);
        const parse = parseOpeningCapabilities(overlay?.overrides ?? null);
        if (!parse.ok) {
          setError(parse.message);
          return;
        }
        if (parse.capabilities) {
          setCapabilities(parse.capabilities);
          setDecided(true);
        } else {
          setCapabilities(DEFAULT_OPENING_CAPABILITIES);
          setDecided(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Error al cargar capacidades de apertura');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, enabled]);

  const saveCapabilities = useCallback(
    async (next: OpeningCapabilities) => {
      if (!token) return;
      setSaving(true);
      setError(null);
      try {
        const client = new GraneteApiClient(baseUrl);
        const updated = await client.saveOpeningCapabilities(token, next, activeOverlay);
        setActiveOverlay(updated);
        const parse = parseOpeningCapabilities((updated.overrides ?? {}) as Record<string, unknown>);
        if (parse.ok && parse.capabilities) {
          setCapabilities(parse.capabilities);
          setDecided(true);
        } else if (parse.ok) {
          setCapabilities(DEFAULT_OPENING_CAPABILITIES);
          setDecided(false);
        } else {
          setError(parse.message);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al guardar capacidades de apertura');
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [baseUrl, token, activeOverlay],
  );

  return {
    capabilities,
    setCapabilities,
    activeOverlay,
    decided,
    loading,
    saving,
    error,
    saveCapabilities,
  };
}
