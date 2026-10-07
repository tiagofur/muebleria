import { describe, expect, it } from 'vitest';
import { tabForModuleValidationError } from './moduleEditorTabs';

describe('tabForModuleValidationError (#1147)', () => {
  it('routes the placements-without-identity error to the components tab, before the generic hardware match', () => {
    expect(
      tabForModuleValidationError(
        'Hay un herraje posicionado sin identidad en componentes (pieza 1, herraje 1): elegí grupo de opciones o herraje específico.',
      ),
    ).toBe('components');
  });
});
