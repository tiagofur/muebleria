/**
 * ZPL (Zebra Programming Language) label writer for workshop thermal printers (F071).
 *
 * Re-exports domain ZPL generator for package backwards compatibility.
 */

export {
  dotsPerMm,
  pieceBatchToZpl,
  pieceToZpl,
  moduleToZpl,
  moduleBatchToZpl,
  sanitizeZplText,
  ZPL_SIZE_PRESETS,
  type ZplDpi,
  type ZplExportOptions,
  type ZplSizeDimensions,
  type ZplSizePreset,
} from '@granete/domain';
