import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveProjectDrilling } from '../../source/packages/domain/src/projectDrilling';
import { plantillaCatalogWithModules as catalog, plantillaProject, IDS } from '../../source/packages/domain/src/__fixtures__/plantillaDemo';
import type { ProjectItem } from '../../source/packages/domain/src/types';
const base = plantillaProject.items.find(item => item.id === IDS.itemGab)!;
const a: ProjectItem = { ...base, id: 'audit-line-a', quantity: 1, customDims: { widthMm: 300, heightMm: 720, depthMm: 590 } };
const b: ProjectItem = { ...base, id: 'audit-line-b', quantity: 1, customDims: { widthMm: 800, heightMm: 1000, depthMm: 450 } };
function run(items: readonly ProjectItem[]) {
 return resolveProjectDrilling({ project: { ...plantillaProject, items }, catalog, generatedAt: '2026-09-04T00:00:00.000Z' });
}
function normalized(result: ReturnType<typeof run>) {
 return result.patterns.map(pattern => ({ partName: pattern.partName, lengthMm: pattern.lengthMm, widthMm: pattern.widthMm, holes: pattern.holes, fallbackUsed: pattern.fallbackUsed, issues: pattern.issues })).sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y)));
}
describe('FM-03 bounded context differential exploration', () => {
 it('compares distinct custom-dimension lines separately, together and in reverse order', () => {
  const singleA=run([a]); const singleB=run([b]); const together=run([a,b]); const reverse=run([b,a]);
  const expected=[...normalized(singleA), ...normalized(singleB)].sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y)));
  const actual=normalized(together); const reversed=normalized(reverse);
  expect(singleA.patterns.length).toBeGreaterThan(0); expect(singleB.patterns.length).toBeGreaterThan(0);
  expect(singleA.links.map(x=>[x.part.lengthMm,x.part.widthMm])).not.toEqual(singleB.links.map(x=>[x.part.lengthMm,x.part.widthMm]));
  expect(actual).not.toEqual(expected);
  expect(reversed).not.toEqual(actual);
  const bigDoor = (patterns: ReturnType<typeof normalized>) => patterns.find(p => p.partName === 'Puerta Gabinete' && p.lengthMm === 997 && p.widthMm === 796)!;
  const expectedDoor = bigDoor(expected); const actualDoor = bigDoor(actual); const reversedDoor = bigDoor(reversed);
  expect(expectedDoor.fallbackUsed).toBe(false);
  expect(actualDoor.fallbackUsed).toBe(false);
  expect(expectedDoor.holes.filter(h => h.type === 'hinge' && h.diameterMm === 35)).toHaveLength(3);
  expect(actualDoor.holes.filter(h => h.type === 'hinge' && h.diameterMm === 35)).toHaveLength(2);
  expect(reversedDoor.holes).toEqual(expectedDoor.holes);
  const largeFloor = (patterns: ReturnType<typeof normalized>) => patterns.find(p => p.partName === 'Piso Gabinete' && p.lengthMm === 769 && p.widthMm === 450)!;
  expect(largeFloor(expected).issues).toHaveLength(0);
  expect(largeFloor(actual).issues.length).toBeGreaterThan(0);
  const summary = {
    id: 'FM-03-PURE-PROOF', findingId: 'FM-03', sourceCommit: '316df57c7c3c9d5470b5a3f22b39fffeacfd7676', status: 'CONFIRMED_PURE_DOMAIN_REPRODUCTION',
    mechanismProven: 'First part-owner reuse across two different customDims cache keys sharing expanded part IDs. Missing preset/options key dimensions are not independently isolated by this test.',
    sourceFixture: 'packages/domain/src/__fixtures__/plantillaDemo.ts', lineA: a.customDims, lineB: b.customDims,
    expected: { independentlyResolvedLargeDoorHingeCups: 3, independentlyResolvedLargeFloorIssues: 0 },
    actual: { combinedABLargeDoorHingeCups: 2, reversedBALargeDoorHingeCups: 3, combinedABLargeFloorIssues: largeFloor(actual).issues.length, reverseRestoresLargeDoorIndependentHoles: true },
    evidence: ['packages/domain/src/projectDrilling.ts:99-110', 'packages/domain/src/projectDrilling.ts:154-180', 'evidence/drilling-context-observation.json', 'evidence/drilling-context-proof.log'],
    scope: 'Production pure-domain functions with existing fixture and two synthetic line dimensions. No UI, API, DB, exported DXF, host or machine readback.',
    limits: 'Actual in-memory hole output is wrong relative to independent resolution and depends on item order. No physical damage, production file or machine behavior was tested. Passing assertions reproduce the defect, not a fix.',
  };
  writeFileSync(fileURLToPath(new URL('../data/drilling-context-proof.json',import.meta.url)),JSON.stringify(summary,null,2)+'\n');
  const result={ findingId:'FM-03', scope:'Pure-domain production functions; existing plantillaDemo fixture with only line custom dimensions changed; no UI/DB/machine', sourceCommit:'316df57c7c3c9d5470b5a3f22b39fffeacfd7676', matchesIndependent:JSON.stringify(expected)===JSON.stringify(actual), orderIndependent:JSON.stringify(actual)===JSON.stringify(reversed), counts:{a:singleA.patterns.length,b:singleB.patterns.length,together:together.patterns.length}, expected,actual,reversed, links:{a:singleA.links,b:singleB.links,together:together.links} };
  writeFileSync(fileURLToPath(new URL('../evidence/drilling-context-observation.json',import.meta.url)),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({matchesIndependent:result.matchesIndependent,orderIndependent:result.orderIndependent,counts:result.counts,fallbackA:singleA.patterns.filter(p=>p.fallbackUsed).length,fallbackB:singleB.patterns.filter(p=>p.fallbackUsed).length}));
 });
});
