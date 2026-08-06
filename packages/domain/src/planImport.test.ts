import { describe, expect, it } from 'vitest';
import {
  createPlanUnderlay,
  parseDxfToKitchenWalls,
  scalePlanUnderlay,
} from './planImport';

const ids = (() => {
  let n = 0;
  return () => `w${++n}`;
})();

describe('planImport', () => {
  it('parses LINE entities into walls', () => {
    const dxf = `
0
SECTION
2
ENTITIES
0
LINE
8
0
10
0
20
0
11
3000
21
0
0
LINE
8
0
10
3000
20
0
11
3000
21
2500
0
ENDSEC
0
EOF
`;
    const result = parseDxfToKitchenWalls(dxf, { newId: ids });
    expect(result.walls.length).toBe(2);
    expect(result.walls[0]!.lengthMm).toBe(3000);
    expect(result.walls[0]!.angleDeg).toBe(0);
    expect(result.walls[1]!.lengthMm).toBe(2500);
    expect(result.walls[1]!.angleDeg).toBe(90);
    expect(result.warnings).toEqual([]);
  });

  it('parses closed LWPOLYLINE into segments', () => {
    let n = 0;
    const dxf = `
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
0
90
4
70
1
10
0
20
0
10
2000
20
0
10
2000
20
1500
10
0
20
1500
0
ENDSEC
0
EOF
`;
    const result = parseDxfToKitchenWalls(dxf, {
      newId: () => `p${++n}`,
    });
    expect(result.walls.length).toBe(4);
    expect(result.segmentCount).toBe(4);
  });

  it('warns on empty or junk input', () => {
    expect(parseDxfToKitchenWalls('', { newId: ids }).warnings[0]).toMatch(
      /vacío/i,
    );
    const junk = parseDxfToKitchenWalls('not a dxf at all', { newId: ids });
    expect(junk.walls).toHaveLength(0);
    expect(junk.warnings.length).toBeGreaterThan(0);
  });

  it('applies unitScale for meter drawings', () => {
    let n = 0;
    const dxf = `
0
LINE
10
0
20
0
11
3
21
0
0
EOF
`;
    const mm = parseDxfToKitchenWalls(dxf, {
      newId: () => `m${++n}`,
      unitScale: 1000,
      minLengthMm: 50,
    });
    expect(mm.walls[0]!.lengthMm).toBe(3000);
  });

  it('creates and scales image underlay keeping aspect', () => {
    const u = createPlanUnderlay({
      imageUrl: 'data:image/png;base64,xx',
      pixelWidth: 1000,
      pixelHeight: 500,
      fileName: 'plano.png',
    });
    expect(u.widthMm).toBe(5000);
    expect(u.heightMm).toBe(2500);
    expect(u.fileName).toBe('plano.png');
    const scaled = scalePlanUnderlay(u, 4000);
    expect(scaled.widthMm).toBe(4000);
    expect(scaled.heightMm).toBe(2000);
  });
});
