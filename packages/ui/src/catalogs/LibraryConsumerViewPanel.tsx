import { RefreshCw, UserCheck } from 'lucide-react';
import type { HardwareProfile, LibraryReleaseSummary } from '@granete/storage';

/**
 * Vista consumidor (#1102 LIB-AUTH Slice D).
 *
 * Simula a un consumidor que lee SOLO el release que fijó: muestra los
 * perfiles de herrajes congelados de ese release (el mismo pinned read que
 * alimenta al resolve). Publicar una versión nueva NO cambia nada acá hasta
 * que el pin se actualice — y se puede fijar un release viejo para ver cómo
 * otro consumidor se queda atrás.
 */

export interface LibraryConsumerViewPanelProps {
  readonly pin: string | null;
  readonly published: ReadonlyArray<LibraryReleaseSummary>;
  readonly profiles: ReadonlyArray<HardwareProfile>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onPin: (releaseId: string) => void;
}

function versionFor(
  releases: ReadonlyArray<LibraryReleaseSummary>,
  releaseId: string | null,
): string | null {
  if (!releaseId) return null;
  return releases.find((release) => release.id === releaseId)?.version ?? null;
}

export function LibraryConsumerViewPanel({
  pin,
  published,
  profiles,
  loading,
  error,
  onPin,
}: LibraryConsumerViewPanelProps) {
  const pinnedVersion = versionFor(published, pin);
  const latest = published[0] ?? null;
  const outdated = pin !== null && latest !== null && pin !== latest.id;

  return (
    <div
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        background: 'var(--surface-hover)',
        display: 'grid',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-4)',
      }}
      data-testid="library-consumer-view-panel"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <UserCheck size={16} aria-hidden />
        <strong style={{ fontSize: 'var(--text-sm)' }}>Vista consumidor</strong>
        {pin ? (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-neutral-200, #eee)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
            }}
            data-testid="library-consumer-pin-badge"
          >
            {pinnedVersion ? `fijado a v${pinnedVersion}` : 'fijado'}
          </span>
        ) : null}
      </div>
      {pin && outdated ? (
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Este consumidor quedó en la versión vieja: publicar no lo toca hasta su propia actualización.
        </p>
      ) : null}
      {loading ? (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}
          data-testid="library-consumer-loading"
        >
          <RefreshCw size={14} className="spin" aria-hidden />
          Leyendo el contenido del release fijado…
        </div>
      ) : pin ? (
        error ? (
          <p role="alert" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-warning-900, #7b341e)' }}>
            {error}
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }} data-testid="library-consumer-content">
            Perfiles de herrajes congelados que este consumidor lee:{' '}
            {profiles.length === 0 ? 'ninguno' : profiles.map((profile) => profile.code).join(', ')}
          </p>
        )
      ) : (
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Este consumidor todavía no fijó una versión de la biblioteca.
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {latest && (!pin || pin !== latest.id) ? (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => onPin(latest.id)}
            disabled={loading}
            data-testid="library-consumer-update-btn"
          >
            {pin ? `Actualizar a v${latest.version}` : `Fijar consumidor a v${latest.version}`}
          </button>
        ) : null}
        {published.length > 1 ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            Fijar versión:
            <select
              value={pin ?? ''}
              onChange={(event) => onPin(event.target.value)}
              data-testid="library-consumer-pin-select"
              style={{ fontSize: 'var(--text-xs)' }}
            >
              <option value="" disabled>
                —
              </option>
              {published.map((release) => (
                <option key={release.id} value={release.id}>
                  v{release.version}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  );
}
