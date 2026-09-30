import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FACTORY_CONSTRUCTION_POLICY,
  overlayOverridesToPolicy,
  policyToOverlayOverrides,
  restoreInheritance,
  validateConstructionPolicy,
  type FactoryConstructionPolicy,
} from './factoryConstructionPolicy';

describe('FactoryConstructionPolicy (#875)', () => {
  it('DEFAULT_FACTORY_CONSTRUCTION_POLICY matches library defaults with library provenance', () => {
    expect(DEFAULT_FACTORY_CONSTRUCTION_POLICY.version).toBe(1);
    expect(DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide.provenance).toBe('library');
    expect(DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide.stationsCount).toBe(2);
    expect(DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide.systemId).toBe('minifix-dowel');
    expect(DEFAULT_FACTORY_CONSTRUCTION_POLICY.backPanel.provenance).toBe('library');
  });

  it('validates a correct policy without issues', () => {
    const res = validateConstructionPolicy(DEFAULT_FACTORY_CONSTRUCTION_POLICY);
    expect(res.valid).toBe(true);
    expect(res.issues).toHaveLength(0);
  });

  it('detects invalid station counts and margins', () => {
    const invalid: FactoryConstructionPolicy = {
      ...DEFAULT_FACTORY_CONSTRUCTION_POLICY,
      floorToSide: {
        ...DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide,
        stationsCount: 0,
        startMarginMm: 5,
      },
    };
    const res = validateConstructionPolicy(invalid);
    expect(res.valid).toBe(false);
    expect(res.issues).toContain('floorToSide: stationsCount must be between 1 and 10');
    expect(res.issues).toContain('floorToSide: startMarginMm must be between 10mm and 300mm');
  });

  it('round-trips custom factory policy to flattened overlay overrides under joint namespace', () => {
    const customPolicy: FactoryConstructionPolicy = {
      version: 1,
      floorToSide: {
        systemId: 'screw-only',
        stationsCount: 4,
        startMarginMm: 40,
        endMarginMm: 40,
        screwCode: 'HER-TOR-4X50',
        provenance: 'factory',
      },
      topToSide: {
        systemId: 'minifix-dowel',
        stationsCount: 3,
        startMarginMm: 45,
        endMarginMm: 45,
        minifixCode: 'HER-MIN-15',
        dowelCode: 'HER-TAQ-8X30',
        provenance: 'factory',
      },
      shelfToSide: {
        systemId: 'dowel-only',
        stationsCount: 2,
        startMarginMm: 50,
        endMarginMm: 50,
        dowelCode: 'HER-TAQ-8X30',
        provenance: 'factory',
      },
      backPanel: {
        screwCode: 'HER-TOR-3.5X30',
        insetMm: 14,
        maxSpacingMm: 350,
        provenance: 'factory',
      },
      componentOverrides: {
        'comp-1': {
          componentId: 'comp-1',
          constructiveRole: 'shelf',
          joinerySystemId: 'dowel-only',
          stationsCount: 2,
          provenance: 'component',
        },
      },
    };

    const overrides = policyToOverlayOverrides(customPolicy);
    expect(overrides['joint.floorToSide.systemId']).toBe('screw-only');
    expect(overrides['joint.floorToSide.stationsCount']).toBe(4);
    expect(overrides['joint.topToSide.stationsCount']).toBe(3);
    expect(overrides['joint.shelfToSide.systemId']).toBe('dowel-only');
    expect(overrides['joint.backPanel.screwCode']).toBe('HER-TOR-3.5X30');

    // Parse back
    const reconstituted = overlayOverridesToPolicy(overrides);
    expect(reconstituted.floorToSide.systemId).toBe('screw-only');
    expect(reconstituted.floorToSide.stationsCount).toBe(4);
    expect(reconstituted.floorToSide.provenance).toBe('factory');
    expect(reconstituted.topToSide.stationsCount).toBe(3);
    expect(reconstituted.shelfToSide.systemId).toBe('dowel-only');
    expect(reconstituted.backPanel.screwCode).toBe('HER-TOR-3.5X30');
    expect(reconstituted.componentOverrides?.['comp-1']?.constructiveRole).toBe('shelf');
  });

  it('falls back to defaults when overlay overrides are empty or undefined', () => {
    const policy = overlayOverridesToPolicy(null);
    expect(policy).toEqual(DEFAULT_FACTORY_CONSTRUCTION_POLICY);
  });

  it('restoreInheritance cleanly removes an override without copying the current value', () => {
    const customPolicy: FactoryConstructionPolicy = {
      ...DEFAULT_FACTORY_CONSTRUCTION_POLICY,
      floorToSide: {
        systemId: 'screw-only',
        stationsCount: 5,
        startMarginMm: 40,
        endMarginMm: 40,
        provenance: 'factory',
      },
      componentOverrides: {
        'comp-1': {
          componentId: 'comp-1',
          constructiveRole: 'horizontal',
          provenance: 'component',
        },
      },
    };

    const restoredFloor = restoreInheritance(customPolicy, 'floorToSide');
    expect(restoredFloor.floorToSide).toEqual(DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide);
    expect(restoredFloor.floorToSide.provenance).toBe('library');

    const restoredComponent = restoreInheritance(restoredFloor, 'comp-1');
    expect(restoredComponent.componentOverrides?.['comp-1']).toBeUndefined();
  });
});
