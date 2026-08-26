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


