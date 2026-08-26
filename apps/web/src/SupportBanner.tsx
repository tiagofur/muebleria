/**
 * SupportBanner — banda persistente mientras dura una sesión de soporte de
 * plataforma ("entrar a taller", ADR-0005 §5). Salir cierra la sesión y
 * vuelve al login; el backend además la corta por expiración.
 */

import type { ReactNode } from 'react';

import type { OrgSummary, SupportInfo } from './session';

export function SupportBanner({
  support,
  organization,
  onExit,
  exiting,
}: {
  readonly support: SupportInfo;
  readonly organization: OrgSummary | null;
  readonly onExit: () => void;
  readonly exiting: boolean;
}): ReactNode {
  const orgName = organization?.name ?? support.organization_id;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-4)',
        background: 'var(--brand-800)',
        color: 'var(--brand-50)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <span>
        <strong style={{ fontWeight: 600 }}>Soporte Granete</strong> — estás operando en{' '}
        {orgName} · motivo: {support.reason}
      </span>
      <button
        type="button"
        disabled={exiting}
        onClick={onExit}
        style={{
          border: '1px solid var(--brand-300)',
          background: 'transparent',
          color: 'var(--brand-50)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-1) var(--space-3)',
          cursor: exiting ? 'wait' : 'pointer',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-sm)',
        }}
      >
        {exiting ? 'Saliendo…' : 'Salir del soporte'}
      </button>
    </div>
  );
}
