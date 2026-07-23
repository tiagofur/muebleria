/**
 * Domain calculation engine entry point.
 *
 * Historically a single 2k-line module; now split by responsibility under
 * `./engine/` (shared / validate / bom / pricing / cut / labels). This file is
 * a thin barrel that preserves the original public surface so existing imports
 * (`from './engine'`, `from '@muebles/domain'`) keep working unchanged.
 */

export * from './engine/index';
