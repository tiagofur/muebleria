/** @vitest-environment jsdom */

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WorkspaceTabs } from './Tabs';

afterEach(cleanup);

describe('WorkspaceTabs', () => {
  it('provides count, disabled, overflow and reduced-motion hooks', async () => {
    const user = userEvent.setup();
    function Example() {
      const [active, setActive] = useState<'summary' | 'files' | 'blocked'>('summary');
      return (
        <>
          <WorkspaceTabs
            tabs={[
              { id: 'summary', label: 'Resumen', count: 3 },
              { id: 'files', label: 'Documentos' },
              { id: 'blocked', label: 'Bloqueado', disabled: true },
            ]}
            activeTab={active}
            onTabChange={setActive}
            ariaLabel="Ejemplo"
            idPrefix="example"
            testIdPrefix="example"
          />
          <div id="example-panel-summary" role="tabpanel" aria-labelledby="example-tab-summary" hidden={active !== 'summary'} />
          <div id="example-panel-files" role="tabpanel" aria-labelledby="example-tab-files" hidden={active !== 'files'} />
          <div id="example-panel-blocked" role="tabpanel" aria-labelledby="example-tab-blocked" hidden />
        </>
      );
    }
    render(<Example />);
    const tablist = screen.getByTestId('example-tablist');
    expect(tablist.className).toContain('tabs--workspace');
    expect(tablist.querySelector('.tabs__scroller')).toBeTruthy();
    expect(screen.getByLabelText('3 elementos').textContent).toBe('3');
    expect(screen.getByTestId('example-tab-blocked').hasAttribute('disabled')).toBe(true);
    const summary = screen.getByTestId('example-tab-summary');
    summary.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('example-tab-files').getAttribute('aria-selected')).toBe('true');
  });
});
