/**
 * OrgPicker — paso de selección de taller para usuarios multi-membresía
 * (ADR-0005 / F172). Pantalla completa como el gate de sesión; el token sin
 * org sólo sirve para este paso (fail-closed en el middleware).
 */

import type { ReactNode } from 'react';

import { roleLabelEs } from '@granete/domain';

import type { MembershipChoice } from './session';

export function OrgPicker({
  memberships,
  onPick,
  loading,
  error,
  onLogout,
}: {
  readonly memberships: readonly MembershipChoice[];
  readonly onPick: (organizationId: string) => void;
  readonly loading: boolean;
  readonly error: string | null;
  /** Escape hatch: si la selección falla (token vencido), volver al login. */
  readonly onLogout?: () => void;
}): ReactNode {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--brand-50)',
        padding: 'var(--space-4)',
      }}
    >
      <section
        aria-labelledby="org-picker-title"
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          padding: 'var(--space-6)',
        }}
      >
        <h1
          id="org-picker-title"
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-xl)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: '0 0 var(--space-1)',
          }}
        >
          ¿En qué taller vas a trabajar?
        </h1>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
            margin: '0 0 var(--space-4)',
          }}
        >
          Tu usuario pertenece a varios talleres. Elegí uno para entrar.
        </p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
          {memberships.map((m) => (
            <li key={m.organization_id}>
              <button
                type="button"
                disabled={loading}
                onClick={() => onPick(m.organization_id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 'var(--space-1)',
                  padding: 'var(--space-3) var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  cursor: loading ? 'wait' : 'pointer',
                  textAlign: 'left',
                  fontFamily: 'var(--font-sans)',
                  transition: 'background var(--transition-fast), border-color var(--transition-fast)',
                }}
                onMouseEnter={(e) => {
                  if (!loading) e.currentTarget.style.borderColor = 'var(--brand-400)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                }}
              >
                <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {m.organization.name}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  {m.roles.map(roleLabelEs).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', margin: 'var(--space-3) 0 0' }}>
            {error}
          </p>
        ) : null}
        {loading ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', margin: 'var(--space-3) 0 0' }}>
            Entrando…
          </p>
        ) : null}
        {onLogout ? (
          <button
            type="button"
            className="btn btn--secondary"
            style={{ width: '100%', marginTop: 'var(--space-4)' }}
            disabled={loading}
            onClick={onLogout}
          >
            Cerrar sesión y volver al login
          </button>
        ) : null}
      </section>
    </main>
  );
}
