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
