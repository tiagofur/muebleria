export {
  ModuleScene3D,
  canUseWebGL,
  type ModuleScene3DProps,
} from './ModuleScene3D';
export {
  FurnitureScene3D,
  type FurnitureScene3DProps,
  type FurnitureSceneModule,
  type FurnitureSceneWall,
  type SceneLightingMode,
} from './FurnitureScene3D';
export {
  DEFAULT_SCENE_LIGHTING_MODE,
  planSceneLighting,
  boardPhysicalResponse,
} from './sceneLighting';
export {
  PartInspector,
  type PartInspectorProps,
} from './PartInspector';
export {
  PartList,
  type PartListProps,
} from './PartList';
export {
  boardPartToVisual,
  boardPartsToVisuals,
  colorForMaterialId,
  colorForOptionRole,
  materialColorMap,
  materialTextureMap,
  resolveMaterialSurface,
  resolvePartColor,
  sceneFraming,
  DEFAULT_MATERIAL_SURFACE_MODE,
  DEFAULT_TEXTURE_TILE_MM,
  type BoardColorMode,
  type BoardPartVisual,
  type MaterialColorLookup,
  type MaterialSurfaceMode,
  type MaterialTextureEntry,
  type MaterialTextureLookup,
} from './boardPartVisual';
export {
  grainUvRepeat,
  parseHexColor,
  GRAIN_TILE_MM,
} from './grainTexture';
export {
  PaintModeField,
  type PaintModeFieldProps,
} from './PaintModeField';
export {
  MaterialSurfaceModeField,
  type MaterialSurfaceModeFieldProps,
} from './MaterialSurfaceModeField';
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
export { type ModelFormat } from './ModelExporter';
export { downloadBlob, sanitizeFilename } from './exportModel';
