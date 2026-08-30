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

export type FurnitureParameterDefinitionIssue = {
  readonly parameter: string;
  readonly field: string;
  readonly message: string;
};

export class FurnitureParameterDefinitionsError extends Error {
  readonly code = 'PARAMETER_DEFINITION_INVALID' as const;
  readonly issues: readonly FurnitureParameterDefinitionIssue[];

  constructor(issues: readonly FurnitureParameterDefinitionIssue[]) {
    super('Invalid furniture parameter definitions.');
    this.name = 'FurnitureParameterDefinitionsError';
    this.issues = issues;
  }
}

export type FurnitureParameterIssue = {
  readonly code: FurnitureParameterIssueCode;
  readonly parameter: string;
  readonly details?: Readonly<Record<string, unknown>>;
};

export type FurnitureParameterEvaluation = {
  readonly normalized: Readonly<Record<string, FurnitureParameterValue>>;
  readonly issues: readonly FurnitureParameterIssue[];
};

export function validateFurnitureParameterDefinitions(
  definitions: readonly FurnitureParameter[],
): readonly FurnitureParameterDefinitionIssue[] {
  const issues: FurnitureParameterDefinitionIssue[] = [];
  const seen = new Set<string>();

  if (definitions.length > 64) {
    issues.push({ parameter: '', field: 'definitions', message: 'must contain at most 64 definitions' });
  }

  for (const definition of definitions) {
    const add = (field: string, message: string): void => {
      issues.push({ parameter: definition.name, field, message });
    };

    if (definition.name === '' || definition.name.trim() !== definition.name) {
      add('name', 'must be non-empty and must not have surrounding whitespace');
    } else if ([...definition.name].length > 64) {
      add('name', 'must be at most 64 characters');
    } else if (seen.has(definition.name)) {
      add('name', 'must be unique');
    } else {
      seen.add(definition.name);
    }
    if (definition.label.trim() === '') add('label', 'must be non-empty');
    else if ([...definition.label].length > 160) add('label', 'must be at most 160 characters');
    if (!['number', 'string', 'boolean', 'enum'].includes(definition.type)) {
      add('type', 'must be number, string, boolean, or enum');
    }
    if (definition.unit !== undefined && !['mm', 'deg', 'count'].includes(definition.unit)) {
      add('unit', 'must be mm, deg, count, or omitted');
    }
    if (!['dimension', 'configuration', 'style', 'hardware', 'metadata'].includes(definition.category)) {
      add('category', 'must be dimension, configuration, style, hardware, or metadata');
    }
    if (definition.sortOrder !== undefined && (!Number.isInteger(definition.sortOrder) || definition.sortOrder < 0)) {
      add('sortOrder', 'must be a non-negative integer');
    }

    if (definition.type === 'number') {
      for (const [field, value] of [
        ['min', definition.min],
        ['max', definition.max],
        ['step', definition.step],
      ] as const) {
        if (value !== undefined && !Number.isFinite(value)) add(field, 'must be finite');
      }
      if (definition.min !== undefined && definition.max !== undefined && definition.min > definition.max) {
        add('min|max', 'min must be less than or equal to max');
      }
      if (definition.step !== undefined && definition.step <= 0) add('step', 'must be greater than zero');
      if (definition.unit === 'count' && !definition.integer) add('integer', 'count parameters must be integer');
    } else {
      if (definition.min !== undefined || definition.max !== undefined || definition.step !== undefined) {
        add('min|max|step', 'numeric constraints require type number');
      }
      if (definition.integer) add('integer', 'integer requires type number');
      if (definition.unit !== undefined) add('unit', 'unit requires type number');
    }

    if (definition.type === 'enum') {
      if (!definition.options || definition.options.length === 0) add('options', 'enum requires at least one option');
      if ((definition.options?.length ?? 0) > 64) add('options', 'enum must contain at most 64 options');
      const optionSeen = new Set<string>();
      for (const option of definition.options ?? []) {
        if (option === '') add('options', 'enum options must be non-empty');
        if ([...option].length > 128) add('options', 'enum options must be at most 128 characters');
        if (optionSeen.has(option)) add('options', 'enum options must be unique');
        optionSeen.add(option);
      }
    } else if (definition.options && definition.options.length !== 0) {
      add('options', 'options require type enum');
    }

    if (definition.defaultValue !== undefined && validateValue(definition, definition.defaultValue)) {
      add('defaultValue', 'must satisfy the parameter type and constraints');
    }

  }

  return issues;
}

export function validatePersistedFurnitureParameterDefinitions(
  definitions: readonly FurnitureParameter[],
): readonly FurnitureParameterDefinitionIssue[] {
  const issues = [...validatePublishedFurnitureParameterDefinitions(definitions)];
  for (const definition of definitions) {
    if (['widthMm', 'heightMm', 'depthMm'].includes(definition.name)) {
      issues.push({
        parameter: definition.name,
        field: 'name',
        message: 'reserved dimensions are projected from module columns',
      });
    }
    if (definition.binding?.kind === 'dimensionColumn') {
      issues.push({
        parameter: definition.name,
        field: 'binding.kind',
        message: 'dimensionColumn is reserved for catalog projection',
      });
    }
  }
  return issues;
}

export function validatePublishedFurnitureParameterDefinitions(
  definitions: readonly FurnitureParameter[],
): readonly FurnitureParameterDefinitionIssue[] {
  const issues = [...validateFurnitureParameterDefinitions(definitions)];
  for (const definition of definitions) {
    const add = (field: string, message: string): void => {
      issues.push({ parameter: definition.name, field, message });
    };
    if (definition.category === 'metadata') {
      if (definition.binding !== undefined) add('binding', 'metadata parameters must not declare a binding');
    } else if (definition.binding === undefined) {
      add('binding', 'non-metadata parameters require an authoritative binding');
    } else {
      validateBinding(definition, add);
    }
  }
  return issues;
}

export function parseFurnitureParameterDefinitions(
  rawJson: string,
  options: { readonly persisted?: boolean } = {},
): readonly FurnitureParameter[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new FurnitureParameterDefinitionsError([{
      parameter: '',
      field: 'definitions',
      message: 'must be valid JSON',
    }]);
  }
  if (!Array.isArray(parsed)) {
    throw new FurnitureParameterDefinitionsError([{
      parameter: '',
      field: 'definitions',
      message: 'must be an array',
    }]);
  }
  const shapeIssues = parsedDefinitionShapeIssues(parsed);
  if (shapeIssues.length !== 0) throw new FurnitureParameterDefinitionsError(shapeIssues);
  const definitions = parsed as readonly FurnitureParameter[];
  const issues = options.persisted
    ? validatePersistedFurnitureParameterDefinitions(definitions)
    : validatePublishedFurnitureParameterDefinitions(definitions);
  if (issues.length !== 0) throw new FurnitureParameterDefinitionsError(issues);
  return definitions;
}

function parsedDefinitionShapeIssues(parsed: readonly unknown[]): FurnitureParameterDefinitionIssue[] {
  const issues: FurnitureParameterDefinitionIssue[] = [];
  for (const candidate of parsed) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      issues.push({ parameter: '', field: 'definitions', message: 'entries must be objects' });
      continue;
    }
    const definition = candidate as Record<string, unknown>;
    const parameter = typeof definition.name === 'string' ? definition.name : '';
    for (const field of ['name', 'label', 'type', 'category'] as const) {
      if (typeof definition[field] !== 'string') {
        issues.push({ parameter, field, message: 'must be a string' });
      }
    }
    for (const field of ['required', 'integer'] as const) {
      if (definition[field] !== undefined && typeof definition[field] !== 'boolean') {
        issues.push({ parameter, field, message: 'must be a boolean' });
      }
    }
    for (const field of ['min', 'max', 'step', 'sortOrder'] as const) {
      if (definition[field] !== undefined && typeof definition[field] !== 'number') {
        issues.push({ parameter, field, message: 'must be a number' });
      }
    }
    if (definition.options !== undefined &&
        (!Array.isArray(definition.options) || definition.options.some((option) => typeof option !== 'string'))) {
      issues.push({ parameter, field: 'options', message: 'must be an array of strings' });
    }
    if (definition.binding !== undefined &&
        (definition.binding === null || typeof definition.binding !== 'object' || Array.isArray(definition.binding))) {
      issues.push({ parameter, field: 'binding', message: 'must be an object' });
    }
  }
  return issues;
}

function validateBinding(
  definition: FurnitureParameter,
  add: (field: string, message: string) => void,
): void {
  const binding = definition.binding!;
  if (binding.version !== 1) add('binding.version', 'must be 1');
  if (binding.kind === 'componentQuantity') {
    if (definition.type !== 'number' || !definition.integer) {
      add('binding.kind', 'componentQuantity requires an integer number parameter');
    }
    if (!binding.componentId?.trim()) add('binding.componentId', 'is required for componentQuantity');
    if (binding.dimension !== undefined) {
      add('binding.dimension', 'is not allowed for componentQuantity');
    }
    if (binding.relationship) {
      if (!binding.relationship.kind.trim()) add('binding.relationship.kind', 'is required');
      if (!binding.relationship.sourceRole.trim()) add('binding.relationship.sourceRole', 'is required');
      if (binding.relationship.targets.length === 0) {
        add('binding.relationship.targets', 'must contain at least one target');
      }
      if (binding.relationship.targets.some((target) => !target.componentId.trim() || !target.role.trim())) {
        add('binding.relationship.targets', 'componentId and role are required');
      }
    }
  } else if (binding.kind === 'dimensionColumn') {
    if (definition.type !== 'number' || !definition.integer || definition.unit !== 'mm') {
      add('binding.kind', 'dimensionColumn requires an integer number parameter measured in mm');
    }
    if (binding.dimension !== definition.name || !['widthMm', 'heightMm', 'depthMm'].includes(binding.dimension)) {
      add('binding.dimension', 'must match widthMm, heightMm, or depthMm');
    }
    if (binding.componentId !== undefined && binding.componentId !== '' || binding.relationship !== undefined) {
      add('binding', 'dimensionColumn cannot target composition');
    }
  } else {
    add('binding.kind', 'must be componentQuantity or dimensionColumn');
  }
}

/** Strict mirror of the server evaluator. It never coerces client values. */
export function evaluateFurnitureParameters(
  definitions: readonly FurnitureParameter[],
  provided: Readonly<Record<string, unknown>>,
): FurnitureParameterEvaluation {
  const definitionIssues = validateFurnitureParameterDefinitions(definitions);
  if (definitionIssues.length !== 0) throw new FurnitureParameterDefinitionsError(definitionIssues);

  const declared = new Map(definitions.map((definition) => [definition.name, definition]));
  const issues: FurnitureParameterIssue[] = [];
  const normalized: Record<string, FurnitureParameterValue> = {};

  for (const name of Object.keys(provided).sort()) {
    if (!declared.has(name)) issues.push({ code: 'PARAMETER_UNKNOWN', parameter: name });
  }

  for (const definition of [...definitions].sort(compareFurnitureParameters)) {
    if (!Object.hasOwn(provided, definition.name)) {
      if (definition.defaultValue !== undefined) normalized[definition.name] = definition.defaultValue;
      else if (definition.required) {
        issues.push({
          code: 'PARAMETER_REQUIRED',
          parameter: definition.name,
          details: issueDetails(definition, undefined),
        });
      }
      continue;
    }

    const value = provided[definition.name];
    const code = validateValue(definition, value);
    if (code) issues.push({ code, parameter: definition.name, details: issueDetails(definition, value) });
    else normalized[definition.name] = value as FurnitureParameterValue;
  }

  return { normalized, issues };
}

function compareFurnitureParameters(left: FurnitureParameter, right: FurnitureParameter): number {
  return (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.name.localeCompare(right.name);
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

function issueDetails(
  definition: FurnitureParameter,
  value: unknown,
): Readonly<Record<string, unknown>> {
  const details: Record<string, unknown> = { expectedType: definition.type };
  if (value !== undefined) {
    details.receivedType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  }
  if (definition.min !== undefined) details.min = definition.min;
  if (definition.max !== undefined) details.max = definition.max;
  if (definition.step !== undefined) details.step = definition.step;
  if (definition.options && definition.options.length !== 0) details.allowedOptions = [...definition.options];
  return details;
}
