import { GitBranch, Library, RefreshCw } from 'lucide-react';
import type { LibraryReleaseSummary } from '@granete/storage';

/**
 * Banner del workspace de autoría de la biblioteca (#1102 LIB-AUTH Slice A).
 *
 * Se muestra sobre las superficies de autoría (Catálogos y Librería) para el
 * rol bibliotecario: identifica contra qué release en draft se está
 * componiendo la próxima versión de la biblioteca y cuál es la versión
 * publicada vigente. No cambia el comportamiento de edición — los edits ya
 * fluyen al estado de autoría; este banner lo hace identificable.
 */

export interface LibraryDraftWorkspaceBannerProps {
  readonly currentPublished: LibraryReleaseSummary | null;
  readonly currentDraft: LibraryReleaseSummary | null;
  /** Sugerencia de próxima versión para el botón "Abrir borrador". */
  readonly suggestedVersion: string;
  readonly loading: boolean;
  readonly opening: boolean;
  readonly error: string | null;
  readonly onOpenDraft: () => void;
}

export function LibraryDraftWorkspaceBanner({
  currentPublished,
  currentDraft,
  suggestedVersion,
  loading,
  opening,
  error,
  onOpenDraft,
}: LibraryDraftWorkspaceBannerProps) {
  return (
    <div
      role={error ? 'alert' : 'status'}
      style={{
        border: `1px solid ${error ? 'var(--color-warning-400, #f6ad55)' : currentDraft ? 'var(--color-primary-300, #b4c6fc)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        background: error
          ? 'var(--color-warning-50, #fffaf0)'
          : currentDraft
            ? 'var(--color-primary-50, #f0f4fe)'
            : 'var(--surface-hover)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
      }}
      data-testid="library-draft-workspace-banner"
    >
      {loading ? (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}
          data-testid="library-draft-workspace-loading"
        >
          <RefreshCw size={16} className="spin" aria-hidden />
          Cargando estado de la biblioteca…
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 4 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: error
                  ? 'var(--color-warning-900, #7b341e)'
                  : currentDraft
                    ? 'var(--color-primary-800, #1e429f)'
                    : 'var(--text-primary)',
              }}
            >
              <GitBranch size={18} aria-hidden />
              <strong>
                {error
                  ? 'Workspace de biblioteca'
                  : currentDraft
                    ? `Editando el borrador de la biblioteca: próxima versión v${currentDraft.version}`
                    : 'Sin borrador abierto de la biblioteca'}
              </strong>
            </div>
            {error ? (
              <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-warning-900, #7b341e)' }}>
                {error}
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                {currentDraft
                  ? 'Tus edits de catálogo componen esta próxima versión; se vuelven la versión consumible cuando la publiques.'
                  : 'Tus edits de catálogo componen el estado de autoría; abrí un borrador para identificar la próxima versión.'}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                background: currentPublished
                  ? 'var(--color-success-100, #e6f7ed)'
                  : 'var(--color-neutral-200, #eee)',
                color: currentPublished
                  ? 'var(--color-success-800, #155724)'
                  : 'var(--text-secondary)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
              }}
              data-testid="library-published-badge"
            >
              <Library size={12} aria-hidden />
              {currentPublished
                ? `Publicado: v${currentPublished.version}`
                : 'Sin versión publicada'}
            </span>
            {!currentDraft && !error ? (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={onOpenDraft}
                disabled={opening}
                data-testid="library-draft-open-btn"
              >
                {opening ? (
                  <>
                    <RefreshCw size={14} className="spin" aria-hidden />
                    Abriendo…
                  </>
                ) : (
                  `Abrir borrador v${suggestedVersion}`
                )}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
