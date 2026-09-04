import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { generateDxfBySheet } from '../../source/packages/excel/src/dxfCutPlanExport';
import { resolveProjectDrilling } from '../../source/packages/domain/src/projectDrilling';
import { plantillaCatalogWithModules, plantillaProject, IDS } from '../../source/packages/domain/src/__fixtures__/plantillaDemo';
import { buildCutPlanFixture } from './cutPlanFixture';
vi.mock('../../source/apps/web/src/stores/uiStore', () => ({ getUiStoreState: () => ({ toast: vi.fn() }) }));
vi.mock('../../source/apps/web/src/stores/workspaceStore', () => ({ useWorkspaceStore: {} }));
import { createPurchasingStore } from '../../source/apps/web/src/stores/purchasingStore';
const evidence = new URL('../evidence/', import.meta.url);

describe('Audit-only characterization: green means existing hazard reproduced, NOT fixed', () => {
  it('DXF sheet export silently omits identical front hole when its placed piece is rotated', () => {
    const base=buildCutPlanFixture(); const part={...base.sheets[0]!.pieces[0]!,grain:0};
    const drilling=[{pieceCode:part.labelRef,moduleCode:part.moduleCode,partName:part.partName,lengthMm:800,widthMm:500,materialName:part.materialName,holes:[{face:'front' as const,xMm:100,yMm:50,diameterMm:10,depthMm:12,type:'dowel' as const}]}];
    const output=(rotated:boolean)=>generateDxfBySheet({cutPlan:{...base,sheets:[{...base.sheets[0]!,pieces:[{...part,rotated,lengthMm:rotated?500:800,widthMm:rotated?800:500}]}]},drilling})[0]!.dxfContent;
    const normal=output(false), rotated=output(true);
    const circles=(dxf:string)=>dxf.split('0\nCIRCLE\n').length-1;
    expect(circles(normal)).toBe(1); expect(circles(rotated)).toBe(0);
    expect(rotated).toContain('PIEZA'); expect(rotated).toContain('EOF');
    writeFileSync(new URL('defect-dxf-normal.dxf',evidence),normal);
    writeFileSync(new URL('defect-dxf-rotated.dxf',evidence),rotated);
    console.log(JSON.stringify({proof:'DXF_ROTATED_HOLES',nonRotatedCircleCount:circles(normal),rotatedCircleCount:circles(rotated),inputHoles:1}));
  });
  it('project drilling export payload strips fallback provenance', () => {
    const result=resolveProjectDrilling({project:{...plantillaProject,items:plantillaProject.items.filter(i=>i.id===IDS.itemGab)},catalog:{...plantillaCatalogWithModules,hardware:plantillaCatalogWithModules.hardware.map(h=>({...h,machining:undefined}))},generatedAt:'2026-09-03T00:00:00.000Z'});
    const fallback=result.patterns.filter(p=>p.fallbackUsed);
    expect(fallback.length).toBeGreaterThan(0);
    expect(result.patterns.every(p=>Array.isArray(p.issues))).toBe(true);
    for(const p of fallback){const exported=result.data.patterns.find(x=>x.pieceCode===p.pieceCode)!;expect(exported).toBeDefined();expect(exported).not.toHaveProperty('fallbackUsed');expect(exported).not.toHaveProperty('issues');expect(exported.holes).toEqual(p.holes);}
    writeFileSync(new URL('defect-drilling-provenance.json',evidence),JSON.stringify({resolved:result.patterns,exported:result.data},null,2));
    console.log(JSON.stringify({proof:'DRILLING_PROVENANCE',resolvedPatterns:result.patterns.length,fallbackPatterns:fallback.length,exportedFallbackFlags:result.data.patterns.filter(p=>'fallbackUsed' in p).length}));
  });
  it('successful stock debit survives picking failure; retry debits again after in-flight lock clears', async () => {
    let balance=10; const movements:any[]=[]; let attempts=0;
    const repo={
      recordStockMovement:vi.fn(async(input:any)=>{balance+=input.revertsId?input.quantity:-input.quantity; const row={...input,id:`audit-${movements.length+1}`,delta:input.revertsId?input.quantity:-input.quantity};movements.push(row);return row;}),
      setProjectPickingState:vi.fn(async()=>{attempts++;throw new Error('audit injected picking persistence failure');}),
      listPickingStates:vi.fn(async()=>[{projectId:'audit-project',material:'tableros',status:'pendiente'}]),
      getStock:vi.fn(async()=>[{kind:'tableros',materialId:'audit-board',quantity:balance}]),
      listStockMovements:vi.fn(async()=>[...movements]),
    };
    const store=createPurchasingStore({deps:{getRepository:()=>repo as any}});
    const dispatch=()=>store.getState().togglePick({projectId:'audit-project',material:'tableros',status:'despachado'},()=>[{kind:'tableros',materialId:'audit-board',quantity:2}]);
    dispatch(); await vi.waitFor(()=>expect(attempts).toBe(1));
    await vi.waitFor(()=>expect(store.getState().pickingStates?.[0]?.status).toBe('pendiente'));
    expect(balance).toBe(8); expect(movements).toHaveLength(1);expect(movements.some(m=>m.revertsId)).toBe(false);
    dispatch(); await vi.waitFor(()=>expect(attempts).toBe(2));
    expect(balance).toBe(6);expect(movements).toHaveLength(2);expect(movements.some(m=>m.revertsId)).toBe(false);
    const result={proof:'PICKING_PARTIAL_FAILURE',initialBalance:10,afterFirstFailure:8,afterRetryFailure:balance,pickingStatus:store.getState().pickingStates?.[0]?.status,pickingPersistenceAttempts:attempts,movements};
    writeFileSync(new URL('defect-picking-partial-failure.json',evidence),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
  });
});
