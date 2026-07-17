export {
  ModuleScene3D,
  canUseWebGL,
  type ModuleScene3DProps,
} from './ModuleScene3D';
export {
  FurnitureScene3D,
  type FurnitureScene3DProps,
  type FurnitureSceneModule,
} from './FurnitureScene3D';
export {
  boardPartToVisual,
  boardPartsToVisuals,
  colorForMaterialId,
  colorForOptionRole,
  materialColorMap,
  resolvePartColor,
  sceneFraming,
  type BoardColorMode,
  type BoardPartVisual,
  type MaterialColorLookup,
} from './boardPartVisual';
export {
  layoutProjectRun,
  PROJECT_RUN_GAP_MM,
  DEFAULT_MODULE_FOOTPRINT_MM,
  type ModuleFootprint,
  type PlacedModuleFootprint,
  type ProjectLayoutResult,
} from './project3dLayout';
export {
  resolveProject3DPreview,
  type Project3DPreviewResult,
  type ProjectModule3DInstance,
  type ResolveProject3DOptions,
} from './project3dPreview';
