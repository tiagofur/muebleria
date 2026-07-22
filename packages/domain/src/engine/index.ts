/**
 * Domain calculation engine — barrel for the split sub-modules.
 *
 * Public surface is re-exported here so the legacy `./engine` entry point
 * (now a thin re-export of `./engine/index`) remains unchanged for consumers.
 *
 * Sub-modules:
 *  - shared:  catalog finders, edge-band flag math, parametric formula evaluator
 *  - validate: catalog / module / structure / part integrity + isProjectClosed
 *  - bom:     BOM resolution, composed module expansion, structure dim gate
 *  - pricing: line costs, project breakdown, quote snapshot, status transition
 *  - cut:     optimizer cut rows, piece labels, edge-banding instructions
 *  - labels:  material summary + hardware purchase list
 */

export { evaluatePartFormula } from './shared';
export {
  isProjectClosed,
  validateBoardPart,
  validateCatalogEntityCodes,
  validateComponent,
  validateHardwareLine,
  validateModule,
  validateStructure,
} from './validate';
export {
  resolveBom,
  resolveComposedModule,
  resolveStructure,
} from './bom';
export type { ComposedModuleInput, ComposedModuleResult } from './bom';
export {
  calcBoardLineCost,
  calcBoardLineMetrics,
  calcHardwareLineCost,
  calcLineCost,
  calcMaterialCostPerM2,
  calcProjectBreakdown,
  captureQuoteSnapshot,
  transitionProjectStatus,
} from './pricing';
export type { BoardLineCost, HardwareLineCost, LineCost } from './pricing';
export {
  formatEdgeBandingInstruction,
  formatOptimizerPartDescription,
  generateCutRows,
  generatePieceLabels,
} from './cut';
export {
  generateHardwareList,
  generateProjectMaterialSummary,
} from './labels';
