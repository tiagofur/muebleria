import { FlaskConical, Minus, Plus, RefreshCw } from 'lucide-react';
import type { StandardDraftDiffReport } from '@granete/storage';

/**
 * Contenido del modal de confirmación de publicación (#1102 LIB-AUTH Slice C).
 *
 * Muestra el diff entre el release publicado vigente y el borrador
 * (agregados / modificados / eliminados / sin cambio) — calculado por el
 * backend con los exactos inputs del publisher — más la advertencia de
 * inmutabilidad. El Modal compartido aporta foco, Esc y overlay.
 */

export interface LibraryPublishConfirmContentProps {
  readonly version: string;
  readonly diff: StandardDraftDiffReport | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly publishing: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

function ChangeList({
  changes,
  kind,
}: {
  changes: StandardDraftDiffReport['added'];
  kind: 'added' | 'modified' | 'removed';
}) {
  if (changes.length === 0) return null;
  const label = kind === 'added' ? 'Nuevos' : kind === 'modified' ? 'Modificados' : 'Eliminados';
  const color =
    kind === 'added'
      ? 'var(--color-success-800, #22543d)'
      : kind === 'modified'
        ? 'var(--color-primary-800, #1e429f)'
        : 'var(--color-warning-900, #7b341e)';
  const Icon = kind === 'added' ? Plus : kind === 'modified' ? RefreshCw : Minus;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color, fontWeight: 600, fontSize: 'var(--text-sm)' }}>
        <Icon size={14} aria-hidden />
        {label} ({changes.length})
      </div>
      <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        {changes.map((change) => (
          <li key={`${change.kind}:${change.id}`}>
            {change.code ? (
              <>
                <strong>{change.code}</strong>
                {change.name ? ` — ${change.name}` : ''}
              </>
            ) : (
              <>{change.kind} {change.id.slice(0, 8)}…</>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LibraryPublishConfirmContent({
  version,
  diff,
  loading,
  error,
  publishing,
  onConfirm,
  onCancel,
}: LibraryPublishConfirmContentProps) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {loading ? (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}
          data-testid="library-publish-diff-loading"
        >
          <FlaskConical size={16} className="spin" aria-hidden />
          Calculando el diff contra el release vigente…
        </div>
      ) : diff ? (
        <>
          {diff.base ? (
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              Cambios contra <strong>v{diff.base.version}</strong> (publicada):
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              Esta biblioteca todavía no tiene versión publicada: todos los recursos entran nuevos.
            </p>
          )}
          <div style={{ display: 'grid', gap: 'var(--space-2)' }} data-testid="library-publish-diff-summary">
            <ChangeList changes={diff.added} kind="added" />
            <ChangeList changes={diff.modified} kind="modified" />
            <ChangeList changes={diff.removed} kind="removed" />
            {diff.unchanged > 0 ? (
              <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                Sin cambios: {diff.unchanged} recursos reutilizan su contenido exacto.
              </p>
            ) : null}
          </div>
          {diff.added.length + diff.modified.length + diff.removed.length === 0 ? (
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              No hay diferencias detectadas contra la versión vigente.
            </p>
          ) : null}
        </>
      ) : error ? (
        <p role="alert" style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-warning-900, #7b341e)' }} data-testid="library-publish-diff-error">
          {error}
        </p>
      ) : null}
      <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        Publicar es inmutable: la versión queda congelada con su contenido
        exacto y el release vigente no se toca ante cualquier error.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn btn--sm"
          onClick={onCancel}
          disabled={publishing}
          data-testid="library-publish-cancel-btn"
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={onConfirm}
          disabled={publishing || loading || !diff}
          data-testid="library-publish-confirm-btn"
        >
          {publishing ? (
            <>
              <RefreshCw size={14} className="spin" aria-hidden />
              Publicando…
            </>
          ) : (
            `Confirmar y publicar v${version}`
          )}
        </button>
      </div>
    </div>
  );
}
