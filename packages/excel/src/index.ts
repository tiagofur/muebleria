/**
 * Excel adapter — Optimizer, hardware list, commercial quote writers.
 */

export const PACKAGE_NAME = '@muebles/excel' as const;

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


