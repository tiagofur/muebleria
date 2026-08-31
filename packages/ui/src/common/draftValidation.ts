export type DraftRule = (value: unknown) => boolean;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const stringRule: DraftRule = (value) => typeof value === 'string';
export const numberRule: DraftRule = (value) => typeof value === 'number' && Number.isFinite(value);
export const booleanRule: DraftRule = (value) => typeof value === 'boolean';
export const optionalRule = (rule: DraftRule): DraftRule => (value) => value === undefined || rule(value);
export const nullableRule = (rule: DraftRule): DraftRule => (value) => value === null || rule(value);
export const arrayRule = (rule: DraftRule): DraftRule => (value) => Array.isArray(value) && value.every(rule);
export const enumRule = (...allowed: readonly string[]): DraftRule => (value) => typeof value === 'string' && allowed.includes(value);
export const recordValuesRule = (rule: DraftRule): DraftRule => (value) =>
  isRecord(value) && Object.values(value).every(rule);
export const objectRule = (shape: Readonly<Record<string, DraftRule>>): DraftRule => (value) => isRecord(value)
  && Object.keys(value).every((key) => key in shape) && Object.entries(shape).every(([key, rule]) => rule(value[key]));
export function stringFields(...keys: readonly string[]): Record<string, DraftRule> {
  const result: Record<string, DraftRule> = {};
  for (const key of keys) result[key] = stringRule; return result;
}
