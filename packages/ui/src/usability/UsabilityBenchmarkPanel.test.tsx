/**
 * @vitest-environment jsdom
 *
 * F148 / #314 — panel del facilitador: gate por flag, ciclo sesión → tareas
 * → cierre, y aislamiento de clicks (data-usability-ui).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import {
  USABILITY_BENCHMARK_FLAG,
  resetUsabilityModuleForTests,
  getUsabilitySession,
} from '../preview3d/usabilityBenchmark';
import { UsabilityBenchmarkPanel } from './UsabilityBenchmarkPanel';

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length(): number {
      return store.size;
    },
    clear: (): void => store.clear(),
    getItem: (key: string): string | null => store.get(key) ?? null,
    key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string): void => {
      store.delete(key);
    },
    setItem: (key: string, value: string): void => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  installLocalStorageMock();
  resetUsabilityModuleForTests();
  localStorage.setItem(USABILITY_BENCHMARK_FLAG, '1');
});

afterEach(() => {
  cleanup();
  resetUsabilityModuleForTests();
});

describe('UsabilityBenchmarkPanel', () => {
  it('no se monta sin el flag del facilitador', () => {
    localStorage.removeItem(USABILITY_BENCHMARK_FLAG);
    const { container } = render(<UsabilityBenchmarkPanel />);
    expect(container.firstElementChild).toBeNull();
  });

  it('inicia sesión desde el panel y marca una tarea completa', () => {
    render(<UsabilityBenchmarkPanel />);
    fireEvent.change(screen.getByTestId('usability-participant'), {
      target: { value: 'P1' },
    });
    fireEvent.click(screen.getByTestId('usability-start-session'));
    expect(getUsabilitySession()?.participant).toBe('P1');

    // Tarea 1 derivada: open-project pendiente → iniciar → completar.
    fireEvent.click(screen.getByTestId('usability-task-start'));
    fireEvent.click(screen.getByTestId('usability-task-complete'));
    const session = getUsabilitySession()!;
    expect(session.tasks['open-project']?.completedAt).not.toBeNull();
    expect(
      session.events.filter((e) => e.type === 'task_complete'),
    ).toHaveLength(1);
  });

  it('los clicks del facilitador en el panel no cuentan como clicks del participante', () => {
    render(<UsabilityBenchmarkPanel />);
    fireEvent.click(screen.getByTestId('usability-start-session'));
    fireEvent.click(screen.getByTestId('usability-task-start'));
    const session = getUsabilitySession()!;
    expect(
      session.events.filter((e) => e.type === 'click' && e.source === 'auto'),
    ).toHaveLength(0);
    // El panel marca su raíz para el listener global del módulo.
    expect(
      screen.getByTestId('usability-panel').hasAttribute('data-usability-ui'),
    ).toBe(true);
  });

  it('acumula ayuda/error sobre la tarea vigente y cierra la sesión', () => {
    render(<UsabilityBenchmarkPanel />);
    fireEvent.click(screen.getByTestId('usability-start-session'));
    fireEvent.click(screen.getByTestId('usability-task-start'));
    fireEvent.click(screen.getByTestId('usability-help'));
    fireEvent.click(screen.getByTestId('usability-error'));
    fireEvent.click(screen.getByTestId('usability-end-session'));
    const session = getUsabilitySession()!;
    expect(session.tasks['open-project']?.helpCount).toBe(1);
    expect(session.tasks['open-project']?.errorCount).toBe(1);
    expect(session.endedAt).not.toBeNull();
    // Sesión cerrada → ofrece nueva sesión y limpia al usarla.
    fireEvent.click(screen.getByTestId('usability-new-session'));
    expect(getUsabilitySession()).toBeNull();
  });

  it('permite marcar una tarea específica desde el selector', () => {
    render(<UsabilityBenchmarkPanel />);
    fireEvent.click(screen.getByTestId('usability-start-session'));
    fireEvent.change(screen.getByTestId('usability-task-select'), {
      target: { value: 'apply-floor-material' },
    });
    fireEvent.click(screen.getByTestId('usability-task-start'));
    expect(
      getUsabilitySession()?.tasks['apply-floor-material']?.startedAt,
    ).not.toBeNull();
  });
});
