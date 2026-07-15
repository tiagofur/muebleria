import { describe, expect, it } from 'vitest';
import {
  HARDWARE_LIST_HEADERS,
  OPTIMIZER_DATA_HEADERS,
  PACKAGE_NAME,
  hardwareListExport,
  optimizerExport,
} from './index';

describe('@muebles/excel', () => {
  it('exports package identity and export APIs', () => {
    expect(PACKAGE_NAME).toBe('@muebles/excel');
    expect(typeof optimizerExport).toBe('function');
    expect(typeof hardwareListExport).toBe('function');
    expect(OPTIMIZER_DATA_HEADERS).toHaveLength(10);
    expect(HARDWARE_LIST_HEADERS).toHaveLength(6);
  });
});
