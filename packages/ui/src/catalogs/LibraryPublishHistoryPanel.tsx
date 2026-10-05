import { useState } from 'react';
import { ChevronDown, History } from 'lucide-react';
import type { LibraryReleaseSummary } from '@granete/storage';

/**
 * Historial colapsable de versiones publicadas (#1102 LIB-AUTH Slice C).
 *
 * Alimentado por el listado de releases que el workspace ya trae: versión,
 * fecha de publicación, changelog y hash corto del manifiesto. Colapsado por
 * defecto para no robar atención sobre las superficies de autoría.
 */

export interface LibraryPublishHistoryPanelProps {
  readonly releases: ReadonlyArray<LibraryReleaseSummary>;
}

export function LibraryPublishHistoryPanel({
  releases,
}: LibraryPublishHistoryPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 'var(--space-4)',
        background: 'var(--surface-hover)',
      }}
      data-testid="library-publish-history-panel"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 'var(--space-3)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          fontSize: 'var(--text-sm)',
          textAlign: 'left',
        }}
        data-testid="library-publish-history-toggle"
      >
        <History size={16} aria-hidden />
        <strong>
          Historial de versiones publicadas ({releases.length})
        </strong>
        <ChevronDown
          size={16}
          aria-hidden
          style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
        />
      </button>
      {open ? (
        releases.length === 0 ? (
          <p style={{ margin: 0, padding: '0 var(--space-3) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            Todavía no hay versiones publicadas de esta biblioteca.
          </p>
        ) : (
          <ul
            style={{
              margin: 0,
              padding: '0 var(--space-3) var(--space-3)',
              listStyle: 'none',
              display: 'grid',
              gap: 'var(--space-2)',
            }}
            data-testid="library-publish-history-list"
          >
            {releases.map((release) => (
              <li
                key={release.id}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--space-2)',
                  alignItems: 'baseline',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--border-default)',
                  paddingBottom: 'var(--space-2)',
                }}
              >
                <strong style={{ color: 'var(--text-primary)' }}>v{release.version}</strong>
                {release.publishedAt ? (
                  <span>{new Date(release.publishedAt).toLocaleDateString()}</span>
                ) : null}
                {release.manifestHash ? (
                  <code style={{ fontSize: 'var(--text-xs)' }}>
                    {release.manifestHash.slice(0, 19)}…
                  </code>
                ) : null}
                {release.changelog ? <span>{release.changelog}</span> : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
