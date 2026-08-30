import type { FurnitureParameter } from './smartFurnitureDomain';

export const FURNITURE_PARAMETER_ISSUE_CODES = [
  'PARAMETER_UNKNOWN',
  'PARAMETER_REQUIRED',
  'PARAMETER_TYPE_INVALID',
  'PARAMETER_OUT_OF_RANGE',
  'PARAMETER_STEP_INVALID',
  'PARAMETER_ENUM_INVALID',
] as const;

export type FurnitureParameterIssueCode = (typeof FURNITURE_PARAMETER_ISSUE_CODES)[number];
export type FurnitureParameterValue = string | number | boolean;

export type FurnitureParameterIssue = {
  readonly code: FurnitureParameterIssueCode;
  readonly parameter: string;
};

export type FurnitureParameterEvaluation = {
  readonly normalized: Readonly<Record<string, FurnitureParameterValue>>;
  readonly issues: readonly FurnitureParameterIssue[];
};

/** Strict mirror of the server evaluator. It never coerces client values. */
export function evaluateFurnitureParameters(
  definitions: readonly FurnitureParameter[],
  provided: Readonly<Record<string, unknown>>,
): FurnitureParameterEvaluation {
  const declared = new Map(definitions.map((definition) => [definition.name, definition]));
  const issues: FurnitureParameterIssue[] = [];
  const normalized: Record<string, FurnitureParameterValue> = {};

  for (const name of Object.keys(provided).sort()) {
    if (!declared.has(name)) issues.push({ code: 'PARAMETER_UNKNOWN', parameter: name });
  }

  for (const definition of [...definitions].sort((left, right) => left.name.localeCompare(right.name))) {
    if (!Object.hasOwn(provided, definition.name)) {
      if (definition.defaultValue !== undefined) normalized[definition.name] = definition.defaultValue;
      else if (definition.required) issues.push({ code: 'PARAMETER_REQUIRED', parameter: definition.name });
      continue;
    }

    const value = provided[definition.name];
    const code = validateValue(definition, value);
    if (code) issues.push({ code, parameter: definition.name });
    else normalized[definition.name] = value as FurnitureParameterValue;
  }

  return { normalized, issues };
}

function validateValue(definition: FurnitureParameter, value: unknown): FurnitureParameterIssueCode | undefined {
  switch (definition.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value) || (definition.integer && !Number.isInteger(value))) {
        return 'PARAMETER_TYPE_INVALID';
      }
      if ((definition.min !== undefined && value < definition.min) ||
          (definition.max !== undefined && value > definition.max)) {
        return 'PARAMETER_OUT_OF_RANGE';
      }
      if (definition.step !== undefined) {
        const quotient = (value - (definition.min ?? 0)) / definition.step;
        if (Math.abs(quotient - Math.round(quotient)) > 1e-9 * Math.max(1, Math.abs(quotient))) {
          return 'PARAMETER_STEP_INVALID';
        }
      }
      return undefined;
    }
    case 'string':
      return typeof value === 'string' ? undefined : 'PARAMETER_TYPE_INVALID';
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'PARAMETER_TYPE_INVALID';
    case 'enum':
      if (typeof value !== 'string') return 'PARAMETER_TYPE_INVALID';
      return definition.options?.includes(value) ? undefined : 'PARAMETER_ENUM_INVALID';
  }
}
