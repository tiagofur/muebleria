/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'; import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event'; import { draftSessionKey, registerDraftSessionBaseline } from '../common/useDraftSession';
import { AppShell, type AppShellOrganizationChoice } from './AppShell';
const organizations: readonly AppShellOrganizationChoice[] = ['a', 'b'].map((id) => ({ status: 'active', organization: { id: `org-${id}`,
  name: `Taller ${id.toUpperCase()}`, type: 'factory', status: 'active', license: { plan: 'pro', status: 'active' } } }));
function dirtyDraft(): string { const key = draftSessionKey('module', 'module-a');
  registerDraftSessionBaseline(key, { name: 'Baseline' }); sessionStorage.setItem(key, '{"name":"Tenant A edit"}'); return key; }
function renderShell(change: (id: string) => void) { render(<AppShell activeId="home" onNavigate={() => undefined} sessionMode="auth"
  organization={organizations[0]!.organization} organizationChoices={organizations} onOrganizationChange={change}>
  <p>Workspace A</p></AppShell>); }
afterEach(() => { cleanup(); sessionStorage.clear(); });
describe('AppShell draft-safe organization switch', () => {
  it('keeps A and its dirty draft when cancelled', async () => {
    const key = dirtyDraft(); const change = vi.fn(); renderShell(change);
    await userEvent.selectOptions(screen.getByLabelText('Cambiar organización'), 'org-b');
    expect(screen.getByRole('dialog', { name: 'Cambiar de organización' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(change).not.toHaveBeenCalled(); expect(sessionStorage.getItem(key)).toContain('Tenant A edit');
    expect(screen.getByLabelText<HTMLSelectElement>('Cambiar organización').value).toBe('org-a');
  });
  it('does not purge before authoritative commit', async () => {
    const key = dirtyDraft(); const change = vi.fn(); renderShell(change);
    await userEvent.selectOptions(screen.getByLabelText('Cambiar organización'), 'org-b');
    await userEvent.click(screen.getByRole('button', { name: 'Descartar y cambiar' }));
    expect(change).toHaveBeenCalledWith('org-b'); expect(sessionStorage.getItem(key)).toContain('Tenant A edit');
  });
});
