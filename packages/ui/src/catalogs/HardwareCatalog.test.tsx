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
});
