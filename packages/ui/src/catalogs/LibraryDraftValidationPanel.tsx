import { CheckCircle2, FlaskConical, OctagonAlert } from 'lucide-react';
import type { StandardDraftValidationReport } from '@granete/storage';

/**
 * Panel del reporte "Probar borrador" (#1102 LIB-AUTH Slice B).
 *
 * Muestra el resultado de la validación read-only del draft: el dry-run de
 * compilación (los mismos inputs que juntará el publisher) y el resolve
 * batch de todas las definiciones de muebles, con la lista de fallas.
 */

export interface LibraryDraftValidationPanelProps {
  readonly report: StandardDraftValidationReport | null;
  readonly validating: boolean;
}

export function LibraryDraftValidationPanel({
  report,
  validating,
}: LibraryDraftValidationPanelProps) {
  if (validating) {
    return (
      <div
        style={{
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3)',
          background: 'var(--surface-hover)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: 'var(--text-secondary)',
          marginBottom: 'var(--space-4)',
        }}
        data-testid="library-draft-validation-loading"
      >
        <FlaskConical size={16} className="spin" aria-hidden />
        Probando el borrador: compilación + resolve de muebles…
      </div>
    );
  }
  if (!report) return null;

  return (
    <div
      role={report.ok ? 'status' : 'alert'}
      style={{
        border: `1px solid ${report.ok ? 'var(--color-success-300, #9ae6b4)' : 'var(--color-warning-400, #f6ad55)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        background: report.ok
          ? 'var(--color-success-50, #f0fff4)'
          : 'var(--color-warning-50, #fffaf0)',
        display: 'grid',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-4)',
      }}
      data-testid="library-draft-validation-panel"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: report.ok
            ? 'var(--color-success-800, #22543d)'
            : 'var(--color-warning-900, #7b341e)',
          fontWeight: 600,
        }}
      >
        {report.ok ? (
          <CheckCircle2 size={18} aria-hidden />
        ) : (
          <OctagonAlert size={18} aria-hidden />
        )}
        {report.ok
          ? `Borrador v${report.version} válido`
          : `El borrador v${report.version} tiene problemas`}
      </div>
      {report.compile.ok ? (
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Compilación: {report.compile.resourceCount} recursos listos para
          publicar ({report.compile.manifestHash?.slice(0, 19)}…)
        </p>
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--text-xs)',
            color: 'var(--color-warning-900, #7b341e)',
          }}
        >
          Compilación fallida: {report.compile.error ?? 'entrada inválida'}
        </p>
      )}
      <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        Muebles: {report.furniture.resolved}/{report.furniture.total} resueltos
        con el motor del plugin.
      </p>
      {(report.furniture.failures ?? []).length > 0 ? (
        <ul
          style={{ margin: 0, paddingLeft: 'var(--space-5)', fontSize: 'var(--text-xs)', color: 'var(--color-warning-900, #7b341e)' }}
          data-testid="library-draft-validation-failures"
        >
          {(report.furniture.failures ?? []).map((failure) => (
            <li key={failure.id}>
              <strong>{failure.code}</strong> — {failure.name}: {failure.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
