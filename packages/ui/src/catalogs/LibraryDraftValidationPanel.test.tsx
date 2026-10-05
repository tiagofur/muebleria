/**
 * LibraryDraftValidationPanel tests (#1102 LIB-AUTH Slice B).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LibraryDraftValidationPanel } from './LibraryDraftValidationPanel';
import type { StandardDraftValidationReport } from '@granete/storage';

afterEach(() => cleanup());

const cleanReport: StandardDraftValidationReport = {
  releaseId: 'rel-draft',
  version: '0.3.5',
  ok: true,
  compile: { ok: true, resourceCount: 12, manifestHash: 'sha256:abc123' },
  furniture: { total: 8, resolved: 8, failed: 0, failures: [] },
  validatedAt: '2026-10-05T12:00:00Z',
};

const brokenReport: StandardDraftValidationReport = {
  releaseId: 'rel-draft',
  version: '0.3.5',
  ok: false,
  compile: { ok: false, resourceCount: 0, error: 'perfil PERF-X inválido' },
  furniture: {
    total: 2,
    resolved: 1,
    failed: 1,
    failures: [{ id: 'm-2', code: 'VIG-B', name: 'Vigas B', error: 'sin medidas válidas' }],
  },
  validatedAt: '2026-10-05T12:00:00Z',
};

describe('LibraryDraftValidationPanel (#1102)', () => {
  it('renders nothing without a report', () => {
    const { container } = render(
      <LibraryDraftValidationPanel report={null} validating={false} />,
    );
    expect(container.querySelector('[data-testid="library-draft-validation-panel"]')).toBeNull();
  });

  it('renders the running state while validating', () => {
    render(<LibraryDraftValidationPanel report={null} validating />);
    expect(screen.getByTestId('library-draft-validation-loading').textContent).toContain('Probando');
  });

  it('renders a clean draft with counts', () => {
    render(<LibraryDraftValidationPanel report={cleanReport} validating={false} />);
    const panel = screen.getByTestId('library-draft-validation-panel');
    expect(panel.getAttribute('role')).toBe('status');
    expect(panel.textContent).toContain('v0.3.5 válido');
    expect(panel.textContent).toContain('12 recursos');
    expect(panel.textContent).toContain('8/8 resueltos');
    expect(screen.queryByTestId('library-draft-validation-failures')).toBeNull();
  });

  it('renders compile errors and per-definition failures', () => {
    render(<LibraryDraftValidationPanel report={brokenReport} validating={false} />);
    const panel = screen.getByTestId('library-draft-validation-panel');
    expect(panel.getAttribute('role')).toBe('alert');
    expect(panel.textContent).toContain('tiene problemas');
    expect(panel.textContent).toContain('Compilación fallida: perfil PERF-X inválido');
    expect(panel.textContent).toContain('1/2 resueltos');
    const failures = screen.getByTestId('library-draft-validation-failures');
    expect(failures.textContent).toContain('VIG-B');
    expect(failures.textContent).toContain('sin medidas válidas');
  });
});
