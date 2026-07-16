// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RegisterScreen } from './RegisterScreen';

const here = dirname(fileURLToPath(import.meta.url));

describe('RegisterScreen', () => {
  afterEach(cleanup);

  it('submits name/email/password when confirm matches', async () => {
    const onRegister = vi.fn(async () => undefined);
    render(
      <RegisterScreen onRegister={onRegister} onBack={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Nombre completo'), {
      target: { value: 'Nueva Persona' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'nueva@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'secret12' },
    });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'secret12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar acceso' }));

    expect(onRegister).toHaveBeenCalledWith(
      'Nueva Persona',
      'nueva@example.com',
      'secret12',
    );
  });

  it('blocks submit when passwords differ', () => {
    const onRegister = vi.fn();
    render(
      <RegisterScreen onRegister={onRegister} onBack={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Nombre completo'), {
      target: { value: 'X' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'x@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'secret12' },
    });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'other' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar acceso' }));

    expect(onRegister).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/no coinciden/i);
  });

  it('blocks weak passwords (policy: 8+ letter and digit)', () => {
    const onRegister = vi.fn();
    render(
      <RegisterScreen onRegister={onRegister} onBack={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Nombre completo'), {
      target: { value: 'X' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'x@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: '12345678' },
    });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: '12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar acceso' }));

    expect(onRegister).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/letra y un número/i);
  });

  it('uses co-located login.css tokens', () => {
    const tsx = readFileSync(join(here, 'RegisterScreen.tsx'), 'utf8');
    expect(tsx).toContain("import './login.css'");
    expect(tsx).toContain('Solicitud enviada');
  });
});
