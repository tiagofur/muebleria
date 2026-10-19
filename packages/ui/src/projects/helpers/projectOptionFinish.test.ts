/**
 * #1209 PR3 — unit tests for the commercial finish helpers: the per-group
 * choice setter (empty removes) and the dependent offer (only the chosen
 * hardware's declared presets, with ES labels).
 */
import { describe, expect, it } from 'vitest';
import type { Hardware } from '@granete/domain';
import { finishOptionsForGroupChoice, setItemOptionFinish } from './projectOptionHelpers';

const HW_WITH_OFFER: Hardware = {
  id: 'hw-1',
  code: 'BIS',
  name: 'Bisagra',
  unit: 'piece',
  costPerUnit: 5,
  active: true,
  availableFinishes: ['chrome', 'black-matte'],
};

const HW_WITHOUT_OFFER: Hardware = {
  id: 'hw-2',
  code: 'PLA',
  name: 'Placa',
  unit: 'piece',
  costPerUnit: 3,
  active: true,
};

describe('setItemOptionFinish', () => {
  it('sets and clears per-group finish choices', () => {
    expect(setItemOptionFinish(undefined, 'JALADERA', 'gold')).toEqual({
      JALADERA: 'gold',
    });
    expect(
      setItemOptionFinish({ JALADERA: 'gold', BISAGRA: 'chrome' }, 'JALADERA', ''),
    ).toEqual({ BISAGRA: 'chrome' });
  });
});

describe('finishOptionsForGroupChoice', () => {
  it('offers only the chosen hardware declared presets with ES labels', () => {
    expect(finishOptionsForGroupChoice([HW_WITH_OFFER, HW_WITHOUT_OFFER], 'hw-1')).toEqual([
      { id: 'chrome', labelEs: 'Cromo' },
      { id: 'black-matte', labelEs: 'Negro mate' },
    ]);
  });

  it('offers nothing without a chosen hardware or without an offer', () => {
    expect(finishOptionsForGroupChoice([HW_WITH_OFFER], undefined)).toEqual([]);
    expect(finishOptionsForGroupChoice([HW_WITH_OFFER, HW_WITHOUT_OFFER], 'hw-2')).toEqual(
      [],
    );
    expect(finishOptionsForGroupChoice([HW_WITH_OFFER], 'hw-unknown')).toEqual([]);
  });
});
