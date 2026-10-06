import type { ReactNode } from 'react';
import { GitBranch } from 'lucide-react';

/**
 * Línea contextual del borrador en las superficies de autoría (#1184).
 *
 * Reemplaza al stack de revisiones que antes se repetía en las 10 pantallas
 * de Catálogos/Librería: una sola línea delgada identifica contra qué
 * borrador componen los edits y sale al hub Biblioteca, donde viven las
 * acciones (probar/publicar/historial/consumidor). Sin borrador el shell no
 * la monta — las pantallas quedan sin chrome adicional.
 */

export interface LibraryDraftContextLineProps {
  readonly draftVersion: string;
  /** URL del hub (pathForNav('library')) para link real (middle-click). */
  readonly href: string;
}

export function LibraryDraftContextLine({
  draftVersion,
  href,
}: LibraryDraftContextLineProps): ReactNode {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 'var(--space-2)',
        border: '1px solid var(--color-primary-200, #c3d4fc)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-primary-50, #f0f4fe)',
        padding: 'var(--space-1) var(--space-3)',
        marginBottom: 'var(--space-3)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-secondary)',
      }}
      data-testid="library-draft-context-line"
    >
      <GitBranch size={13} aria-hidden />
      <span>
        Componiendo el{' '}
        <strong style={{ color: 'var(--color-primary-800, #1e429f)' }}>
          borrador v{draftVersion}
        </strong>{' '}
        de la biblioteca: tus edits entran a esta versión.
      </span>
      <a
        href={href}
        style={{
          marginLeft: 'auto',
          color: 'var(--color-primary-700, #1a365d)',
          fontWeight: 600,
        }}
        data-testid="library-draft-context-link"
      >
        Ir a Biblioteca →
      </a>
    </div>
  );
}
