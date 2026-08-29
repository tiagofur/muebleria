// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LoginScreen } from './LoginScreen';

const here = dirname(fileURLToPath(import.meta.url));
const loginTsxPath = join(here, 'LoginScreen.tsx');
const loginCssPath = join(here, 'login.css');

describe('LoginScreen', () => {
  afterEach(cleanup);

  it('renders login form and guest access button', () => {
    render(
      <LoginScreen
        onLogin={vi.fn()}
        onGuestAccess={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Contraseña')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Iniciar Sesión' })[0]).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Acceder sin conexión (Invitado)' })[0]).toBeTruthy();
  });

  it('submits email and password on form submit', () => {
    const onLogin = vi.fn();
    render(
      <LoginScreen
        onLogin={onLogin}
        onGuestAccess={vi.fn()}
      />
    );

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Contraseña');
    const submitButton = screen.getAllByRole('button', { name: 'Iniciar Sesión' })[0] as HTMLElement;

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    expect(onLogin).toHaveBeenCalledWith('test@example.com', 'password123');
  });

  it('triggers onGuestAccess on guest button click', () => {
    const onGuestAccess = vi.fn();
    render(
      <LoginScreen
        onLogin={vi.fn()}
        onGuestAccess={onGuestAccess}
      />
    );

    const guestButton = screen.getAllByRole('button', { name: 'Acceder sin conexión (Invitado)' })[0] as HTMLElement;
    fireEvent.click(guestButton);

    expect(onGuestAccess).toHaveBeenCalled();
  });

  it('explains invitation-only access without a public registration action', () => {
    render(
      <LoginScreen
        onLogin={vi.fn()}
        onGuestAccess={vi.fn()}
      />,
    );
    expect(screen.getByText(/mediante invitación del administrador/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Solicitar acceso' })).toBeNull();
  });

  it('disables submit and shows loading label while loading', () => {
    render(
      <LoginScreen
        onLogin={vi.fn()}
        onGuestAccess={vi.fn()}
        loading
      />,
    );

    const submit = screen.getByRole('button', {
      name: 'Iniciando sesión...',
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect((screen.getByLabelText('Email') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByLabelText('Contraseña') as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it('renders error alert when error prop is set', () => {
    render(
      <LoginScreen
        onLogin={vi.fn()}
        onGuestAccess={vi.fn()}
        error="Credenciales inválidas"
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Credenciales inválidas');
  });

  it('renders session-expired notice as a status banner', () => {
    render(
      <LoginScreen
        onLogin={vi.fn()}
        onGuestAccess={vi.fn()}
        notice="Tu sesión expiró. Volvé a iniciar sesión para continuar donde estabas."
      />,
    );

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Tu sesión expiró');
    // Notice is not an error alert — both can coexist.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not render a notice banner without the notice prop', () => {
    render(
      <LoginScreen
        onLogin={vi.fn()}
        onGuestAccess={vi.fn()}
      />,
    );

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('uses BrandMark not emoji (issue #53)', () => {
    const src = readFileSync(loginTsxPath, 'utf8');
    expect(src).toContain('BrandMark');
    expect(src).not.toContain('🪑');
  });

  it('uses co-located token CSS without inline styles or hardcoded brand blue', () => {
    const tsx = readFileSync(loginTsxPath, 'utf8');
    const css = readFileSync(loginCssPath, 'utf8');

    expect(tsx).toContain("import './login.css'");
    expect(tsx).not.toMatch(/style=\{\{/);
    expect(tsx).not.toContain('#3b82f6');
    expect(tsx).not.toContain('system-ui');

    expect(css).toContain('var(--brand-500)');
    expect(css).toContain('var(--font-sans)');
    expect(css).toContain('var(--surface-sidebar)');
    expect(css).toContain('var(--text-inverse)');
    expect(css).toContain('var(--danger-');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).not.toContain('#3b82f6');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('uses Lucide icons with strokeWidth 1.5', () => {
    const tsx = readFileSync(loginTsxPath, 'utf8');
    expect(tsx).toContain('strokeWidth={1.5}');
    expect(tsx).toContain('LogIn');
    expect(tsx).toContain('Mail');
    expect(tsx).toContain('KeyRound');
    expect(tsx).toContain('WifiOff');
  });

  it('toggles password visibility between password and text', () => {
    render(
      <LoginScreen
        onLogin={vi.fn()}
        onGuestAccess={vi.fn()}
      />,
    );

    const passwordInput = screen.getByLabelText('Contraseña') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    const toggleBtn = screen.getByRole('button', { name: 'Ver contraseña' });
    fireEvent.click(toggleBtn);

    expect(passwordInput.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(passwordInput.type).toBe('password');
  });
});
