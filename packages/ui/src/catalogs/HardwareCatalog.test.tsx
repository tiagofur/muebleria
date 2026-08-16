import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('HardwareCatalog image upload (F042)', () => {
  it('exposes image field and upload wiring', () => {
    const src = readFileSync(join(here, 'HardwareCatalog.tsx'), 'utf8');
    expect(src).toContain('hardware-image-field');
    expect(src).toContain('onUploadImage');
    expect(src).toContain('imageUrl');
  });

  it('binds finish select value dynamically via matchHardwareFinish (F069 fix)', () => {
    const src = readFileSync(join(here, 'HardwareCatalog.tsx'), 'utf8');
    expect(src).toContain('value={selectedFinishId}');
    expect(src).toContain('matchHardwareFinish');
  });
});

describe('HardwareCatalog part finishes (F080)', () => {
  it('renders per-part finish selectors wired to the draft', () => {
    const src = readFileSync(join(here, 'HardwareCatalog.tsx'), 'utf8');
    expect(src).toContain('hardware-form-part-finishes');
    expect(src).toContain('hardware-form-finish-${role}');
    expect(src).toContain('hardwarePartRolesForShape');
    expect(src).toContain('HARDWARE_PART_ROLE_LABELS_ES');
    // Draft carries the three roles and toDraft maps the entity into them.
    expect(src).toContain('partFinishes: { body: string; base: string; grip: string }');
    expect(src).toContain("item.partFinishes?.body ?? ''");
  });

  it('hides part selectors for single-part shapes (only multi-part)', () => {
    const src = readFileSync(join(here, 'HardwareCatalog.tsx'), 'utf8');
    expect(src).toContain('roles.length >= 2 ? roles : []');
  });
});
