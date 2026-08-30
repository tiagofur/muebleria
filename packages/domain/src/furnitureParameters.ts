import type { FurnitureParameter } from './smartFurnitureDomain';

export const FURNITURE_PARAMETER_ISSUE_CODES = [
  'PARAMETER_UNKNOWN',
  'PARAMETER_REQUIRED',
  'PARAMETER_TYPE_INVALID',
  'PARAMETER_OUT_OF_RANGE',
  'PARAMETER_STEP_INVALID',
  'PARAMETER_ENUM_INVALID',
  'PARAMETER_STRING_TOO_LONG',
] as const;

export const MAX_FURNITURE_PARAMETER_STRING_LENGTH = 512;
export const MAX_FURNITURE_PARAMETER_RECEIVED_VALUE_LENGTH = 128;

const PARAMETER_FIELDS = new Set([
  'name', 'label', 'sortOrder', 'type', 'defaultValue', 'required', 'unit', 'category',
  'min', 'max', 'step', 'maxLength', 'options', 'integer', 'binding',
]);
const BINDING_FIELDS = new Set(['version', 'kind', 'componentId', 'dimension', 'relationship']);
const RELATIONSHIP_FIELDS = new Set(['kind', 'sourceRole', 'targets']);
const RELATIONSHIP_TARGET_FIELDS = new Set(['componentId', 'role']);
const CATALOG_DEFINITION_FIELDS = new Set([
  'furnitureDefinitionId', 'code', 'name', 'category', 'categoryId', 'version',
  'schemaRevision', 'definitionHash', 'description', 'imageUrl', 'thumbnailUrl',
  'previewUrl', 'parameters', 'estimatedPartCount', 'estimatedHardwareCount', 'materialRoles',
]);

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
  const shapeIssues = parsedDefinitionShapeIssues(definitions as readonly unknown[]);
  if (shapeIssues.length !== 0) return shapeIssues;

  const issues: FurnitureParameterDefinitionIssue[] = [];
  const seen = new Set<string>();

  if (definitions.length > 64) {
    issues.push({ parameter: '', field: 'definitions', message: 'must contain at most 64 definitions' });
  }

  for (const definition of definitions) {
    const add = (field: string, message: string): void => {
      issues.push({ parameter: definition.name, field, message });
    };

    addUnknownFields(definition as unknown as Record<string, unknown>, PARAMETER_FIELDS, '', add);

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

    if (definition.type === 'string') {
      if (definition.maxLength === undefined || !Number.isInteger(definition.maxLength) ||
          definition.maxLength < 1 || definition.maxLength > MAX_FURNITURE_PARAMETER_STRING_LENGTH) {
        add('maxLength', `must be an integer from 1 to ${MAX_FURNITURE_PARAMETER_STRING_LENGTH}`);
      }
    } else if (definition.maxLength !== undefined) {
      add('maxLength', 'requires type string');
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
  if (issues.length !== 0) return issues;
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
  if (issues.length !== 0) return issues;
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

export function parseFurnitureCatalogDefinition(rawJson: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new FurnitureParameterDefinitionsError([{
      parameter: '',
      field: 'definition',
      message: 'must be valid JSON',
    }]);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FurnitureParameterDefinitionsError([{
      parameter: '',
      field: 'definition',
      message: 'must be an object',
    }]);
  }
  const definition = parsed as Record<string, unknown>;
  const issues: FurnitureParameterDefinitionIssue[] = [];
  for (const key of Object.keys(definition)) {
    if (!CATALOG_DEFINITION_FIELDS.has(key)) {
      issues.push({ parameter: '', field: `definition.${key}`, message: 'is not supported' });
    }
  }
  if (!Array.isArray(definition.parameters)) {
    issues.push({ parameter: '', field: 'definition.parameters', message: 'must be an array' });
  } else {
    issues.push(...parsedDefinitionShapeIssues(definition.parameters));
    if (issues.length === 0) {
      issues.push(...validatePublishedFurnitureParameterDefinitions(
        definition.parameters as readonly FurnitureParameter[],
      ));
    }
  }
  if (issues.length !== 0) throw new FurnitureParameterDefinitionsError(issues);
  return definition;
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
    for (const key of Object.keys(definition)) {
      if (!PARAMETER_FIELDS.has(key)) issues.push({ parameter, field: key, message: 'is not supported' });
    }
    for (const field of ['min', 'max', 'step', 'sortOrder', 'maxLength'] as const) {
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
      continue;
    }
    if (definition.binding !== undefined) {
      const binding = definition.binding as unknown as Record<string, unknown>;
      for (const key of Object.keys(binding)) {
        if (!BINDING_FIELDS.has(key)) {
          issues.push({ parameter, field: `binding.${key}`, message: 'is not supported' });
        }
      }
      if (typeof binding.version !== 'number') {
        issues.push({ parameter, field: 'binding.version', message: 'must be a number' });
      }
      if (typeof binding.kind !== 'string') {
        issues.push({ parameter, field: 'binding.kind', message: 'must be a string' });
      }
      for (const field of ['componentId', 'dimension'] as const) {
        if (binding[field] !== undefined && typeof binding[field] !== 'string') {
          issues.push({ parameter, field: `binding.${field}`, message: 'must be a string' });
        }
      }
      if (binding.relationship !== undefined) {
        if (binding.relationship === null || typeof binding.relationship !== 'object' ||
            Array.isArray(binding.relationship)) {
          issues.push({ parameter, field: 'binding.relationship', message: 'must be an object' });
          continue;
        }
        const relationship = binding.relationship as Record<string, unknown>;
        for (const key of Object.keys(relationship)) {
          if (!RELATIONSHIP_FIELDS.has(key)) {
            issues.push({ parameter, field: `binding.relationship.${key}`, message: 'is not supported' });
          }
        }
        for (const field of ['kind', 'sourceRole'] as const) {
          if (typeof relationship[field] !== 'string') {
            issues.push({ parameter, field: `binding.relationship.${field}`, message: 'must be a string' });
          }
        }
        if (!Array.isArray(relationship.targets)) {
          issues.push({ parameter, field: 'binding.relationship.targets', message: 'must be an array' });
          continue;
        }
        for (const target of relationship.targets) {
          if (target === null || typeof target !== 'object' || Array.isArray(target)) {
            issues.push({ parameter, field: 'binding.relationship.targets', message: 'entries must be objects' });
            continue;
          }
          const record = target as Record<string, unknown>;
          for (const key of Object.keys(record)) {
            if (!RELATIONSHIP_TARGET_FIELDS.has(key)) {
              issues.push({
                parameter,
                field: `binding.relationship.targets.${key}`,
                message: 'is not supported',
              });
            }
          }
          if (typeof record.componentId !== 'string' || typeof record.role !== 'string') {
            issues.push({
              parameter,
              field: 'binding.relationship.targets',
              message: 'componentId and role must be strings',
            });
          }
        }
      }
    }
  }
  return issues;
}

function validateBinding(
  definition: FurnitureParameter,
  add: (field: string, message: string) => void,
): void {
  const candidate = definition.binding as unknown;
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    add('binding', 'must be an object');
    return;
  }
  const binding = candidate as Record<string, unknown>;
  addUnknownFields(binding, BINDING_FIELDS, 'binding.', add);
  if (binding.version !== 1) add('binding.version', 'must be 1');
  if (binding.kind === 'componentQuantity') {
    if (definition.type !== 'number' || !definition.integer) {
      add('binding.kind', 'componentQuantity requires an integer number parameter');
    }
    if (typeof binding.componentId !== 'string' || !binding.componentId.trim()) {
      add('binding.componentId', 'is required for componentQuantity');
    }
    if (binding.dimension !== undefined) {
      add('binding.dimension', 'is not allowed for componentQuantity');
    }
    if (binding.relationship !== undefined) {
      if (binding.relationship === null || typeof binding.relationship !== 'object' ||
          Array.isArray(binding.relationship)) {
        add('binding.relationship', 'must be an object');
        return;
      }
      const relationship = binding.relationship as Record<string, unknown>;
      addUnknownFields(relationship, RELATIONSHIP_FIELDS, 'binding.relationship.', add);
      if (typeof relationship.kind !== 'string' || !relationship.kind.trim()) {
        add('binding.relationship.kind', 'is required');
      }
      if (typeof relationship.sourceRole !== 'string' || !relationship.sourceRole.trim()) {
        add('binding.relationship.sourceRole', 'is required');
      }
      if (!Array.isArray(relationship.targets) || relationship.targets.length === 0) {
        add('binding.relationship.targets', 'must contain at least one target');
      } else {
        for (const target of relationship.targets) {
          if (target === null || typeof target !== 'object' || Array.isArray(target)) {
            add('binding.relationship.targets', 'componentId and role are required');
            continue;
          }
          const record = target as Record<string, unknown>;
          addUnknownFields(record, RELATIONSHIP_TARGET_FIELDS, 'binding.relationship.targets.', add);
          if (typeof record.componentId !== 'string' || !record.componentId.trim() ||
              typeof record.role !== 'string' || !record.role.trim()) {
            add('binding.relationship.targets', 'componentId and role are required');
          }
        }
      }
    }
  } else if (binding.kind === 'componentCondition') {
    if (definition.type !== 'boolean') {
      add('binding.kind', 'componentCondition requires a boolean parameter');
    }
    if (typeof binding.componentId !== 'string' || !binding.componentId.trim()) {
      add('binding.componentId', 'is required for componentCondition');
    }
    if (binding.dimension !== undefined || binding.relationship !== undefined) {
      add('binding', 'componentCondition cannot declare dimension or relationship');
    }
  } else if (binding.kind === 'dimensionColumn') {
    if (definition.type !== 'number' || !definition.integer || definition.unit !== 'mm') {
      add('binding.kind', 'dimensionColumn requires an integer number parameter measured in mm');
    }
    if (binding.dimension !== definition.name || typeof binding.dimension !== 'string' ||
        !['widthMm', 'heightMm', 'depthMm'].includes(binding.dimension)) {
      add('binding.dimension', 'must match widthMm, heightMm, or depthMm');
    }
    if ((binding.componentId !== undefined && binding.componentId !== '') || binding.relationship !== undefined) {
      add('binding', 'dimensionColumn cannot target composition');
    }
  } else {
    add('binding.kind', 'must be componentQuantity, componentCondition, or dimensionColumn');
  }
}

function addUnknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  prefix: string,
  add: (field: string, message: string) => void,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add(`${prefix}${key}`, 'is not supported');
  }
}

/** Strict mirror of the server evaluator. It never coerces client values. */
export function evaluateFurnitureParameters(
  definitions: readonly FurnitureParameter[],
  provided: Readonly<Record<string, unknown>>,
): FurnitureParameterEvaluation {
  const definitionIssues = validatePublishedFurnitureParameterDefinitions(definitions);
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
      if (typeof value !== 'string') return 'PARAMETER_TYPE_INVALID';
      return [...value].length <= (definition.maxLength ?? 0) ? undefined : 'PARAMETER_STRING_TOO_LONG';
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
    const receivedValue = safeReceivedValue(value);
    if (receivedValue !== undefined) details.receivedValue = receivedValue;
  } else {
    details.receivedValue = null;
  }
  if (definition.integer) details.integer = true;
  if (definition.min !== undefined) details.min = definition.min;
  if (definition.max !== undefined) details.max = definition.max;
  if (definition.step !== undefined) details.step = definition.step;
  if (definition.options && definition.options.length !== 0) details.allowedOptions = [...definition.options];
  if (definition.maxLength !== undefined) details.maxLength = definition.maxLength;
  return details;
}

function safeReceivedValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const characters = [...value];
  if (characters.length <= MAX_FURNITURE_PARAMETER_RECEIVED_VALUE_LENGTH) return value;
  return `${characters.slice(0, MAX_FURNITURE_PARAMETER_RECEIVED_VALUE_LENGTH).join('')}…`;
}
