/**
 * @vitest-environment jsdom
 *
 * F100 — web route resolution feeds the shared AppShell tonal context.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { AppShell } from '@muebles/ui';
import { navFromPath } from './routes';


(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('web shell area-context integration (F100)', () => {
  it.each([
    ['/quotes', 'sales'],
    ['/materials', 'library'],
    ['/modules', 'library'],
    ['/production', 'work'],
    ['/warehouse', 'warehouse'],
    ['/shipments', 'warehouse'],
    ['/', 'neutral'],
  ] as const)('propagates %s through AppShell as %s', (path, expected) => {
    const activeId = navFromPath(path);
    expect(activeId).not.toBeNull();
    if (!activeId) return;

    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
      root.render(
        createElement(
          AppShell,
          {
            activeId,
            onNavigate: () => undefined,
            children: createElement('div', null, 'Web route content'),
          },
        ),
      );
    });

    expect(
      container.querySelector('.app-layout')?.getAttribute('data-area-context'),
    ).toBe(expected);
    act(() => root.unmount());
  });
});
