/**
 * Excel adapter — Optimizer, hardware list, commercial quote writers.
 */

export const PACKAGE_NAME = '@granete/excel' as const;

export {
  optimizerExport,
  OPTIMIZER_DATA_HEADERS,
} from './optimizerExport';

export {
  hardwareListExport,
  hardwareListExportCsv,
  HARDWARE_LIST_HEADERS,
} from './hardwareListExport';

export {
  commercialQuoteExport,
  type CommercialQuoteExportInput,
  type CommercialQuoteLine,
  type CommercialQuoteTotals,
} from './commercialQuoteExport';

export {
  commercialQuotePdfExport,
  type CommercialQuotePdfInput,
  type CommercialQuotePdfVariant,
} from './commercialQuotePdf';

export {
  pieceLabelsPdfExport,
  type PieceLabelsPdfInput,
} from './pieceLabelsExport';

export {
  moduleLabelsPdfExport,
  type ModuleLabelsPdfInput,
} from './moduleLabelsExport';

export {
  materialSummaryPdfExport,
  type MaterialSummaryPdfInput,
} from './materialSummaryPdfExport';

export {
  commercialScenarioPdfExport,
  type CommercialScenarioPdfInput,
} from './commercialScenarioPdfExport';

export {
  wallElevationsPdfExport,
  type WallElevationsPdfInput,
} from './wallElevationsPdfExport';

export {
  productionDespiecePdfExport,
  type ProductionDespiecePdfInput,
} from './productionDespiecePdfExport';

export {
  productionCoverPdfExport,
  type ProductionCoverPdfInput,
} from './productionCoverPdfExport';

export {
  cutListExportCsv,
  CUT_LIST_CSV_HEADERS,
  CUT_LIST_CSV_SEPARATOR,
} from './cutListCsvExport';

export {
  assemblySheetsPdfExport,
  type AssemblySheetsPdfInput,
} from './assemblySheetsPdfExport';

export {
  pieceToZpl,
  pieceBatchToZpl,
  moduleToZpl,
  moduleBatchToZpl,
  sanitizeZplText,
  dotsPerMm,
  ZPL_SIZE_PRESETS,
  type ZplSizePreset,
  type ZplDpi,
  type ZplExportOptions,
  type ZplSizeDimensions,
} from './zplLabelExport';

export {
  cutPreviewPdfExport,
  packCutRowsIntoSheets,
  type CutPreviewPdfInput,
} from './cutPreviewPdfExport';

export {
  cutPlanPdfExport,
  type CutPlanPdfExportInput,
} from './cutPlanPdfExport';

export {
  cutListConfigurableCsvExport,
  type CsvDelimiter,
  type CsvOptimizerPreset,
  type CutListCsvExportOptions,
} from './cutListConfigurableCsvExport';

export {
  dxfCutPlanExport,
  generateDxfBySheet,
  generateDxfByPiece,
  type DxfCutPlanExportInput,
  type DxfSheetCutFile,
  type DxfPieceCutFile,
  type GenerateDxfOptions,
} from './dxfCutPlanExport';

export {
  drillingDataExportJson,
  drillingDataExportCsv,
  DRILLING_CSV_HEADERS,
  DRILLING_CSV_SEPARATOR,
} from './partDrillingExport';

export {
  exportWarrantyRefabricationOptimizer,
  warrantyRefabricationFilename,
} from './warrantyRefabricationExport';

export {
  ptxCutPlanExport,
  generatePtxString,
  generatePtxByMaterial,
  type PtxCutPlanExportInput,
  type PtxMaterialCutFile,
} from './ptxCutPlanExport';

export {
  buildActualReadbackTemplate,
  type PtxActualReadback,
  type PtxExpectedReadback,
  type PtxFindingClassification,
  type PtxReadbackComparison,
  type PtxReadbackFinding,
} from './ptxReadback';

export { comparePtxReadback } from './ptxReadbackCompare';

export {
  buildExpectedPtxReadback,
  buildPtxValidationCutPlan,
  buildPtxValidationExportInput,
  serializeExpectedReadback,
  PTX_VALIDATION_FIXTURE_GENERATED_AT,
  PTX_VALIDATION_FIXTURE_ID,
  PTX_VALIDATION_FIXTURE_REVISION,
} from './ptxValidationFixture';



// --- Machine output adapters and profiles (#351 foundation) ---
export {
  canonicalProfileData,
  CLIENT_A_BHX050_PROFILE,
  CLIENT_A_HPP250_PROFILE,
  MPR_WOODWOP_PROFILE,
  PTX_CADMATIC_3_PROFILE,
  PTX_CADMATIC_4_PROFILE,
  PTX_CADMATIC_5_PROFILE,
  PTX_GENERIC_PROFILE,
  SAW_HOMAG_PROFILE,
  type ClientMachineProfileData,
} from './machines/profiles';

export { PTX_POSTPROCESSOR_ADAPTER, PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR } from './machines/ptxAdapter';
export { SAW_POSTPROCESSOR_ADAPTER, SAW_ADAPTER_IMPLEMENTATION_DESCRIPTOR } from './machines/sawAdapter';
export {
  WOODWOP_MPR_POSTPROCESSOR_ADAPTER,
  MPR_ADAPTER_IMPLEMENTATION_DESCRIPTOR,
  describeMachiningOperations,
  describeUnrepresentableOperations,
  type MprOperationKind,
} from './machines/woodWopMprAdapter';

export {
  generateMachineArtifact,
  manifestComparisonKey,
  type MachineArtifactBundle,
  type MachineArtifactRequest,
} from './machines/machineArtifacts';

export {
  buildClientValidationPack,
  type ClientValidationPack,
  type GeneratedPackEntry,
  type NotGeneratedPackEntry,
} from './machines/clientPack';

export {
  buildFixtureCuttingJob,
  buildFixtureCuttingJobPartialProvenance,
  buildFixtureMachiningJob,
  FIXTURE_CUTTING_JOB_ID,
  FIXTURE_MACHINING_JOB_ID,
} from './machines/machineOutputFixtures';
