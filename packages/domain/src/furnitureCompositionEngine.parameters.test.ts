import { describe, expect, test } from 'vitest';
import {
  instantiateFurniture,
  resolveFurnitureLayout,
  validateInteractiveParameters,
} from './furnitureCompositionEngine';
import { evaluateFurnitureParameters } from './furnitureParameters';
import type { FurnitureDefinition, FurnitureParameter } from './smartFurnitureDomain';

const parameters: readonly FurnitureParameter[] = [
  {
    name: 'widthMm',
    label: 'Width',
    type: 'number',
    defaultValue: 600,
    required: true,
    unit: 'mm',
    category: 'dimension',
    min: 300,
    max: 1200,
    step: 10,
    integer: true,
    binding: { version: 1, kind: 'dimensionColumn', dimension: 'widthMm' },
  },
  {
    name: 'heightMm',
    label: 'Height',
    type: 'number',
    defaultValue: 720,
    unit: 'mm',
    category: 'dimension',
    integer: true,
    binding: { version: 1, kind: 'dimensionColumn', dimension: 'heightMm' },
  },
  {
    name: 'depthMm',
    label: 'Depth',
    type: 'number',
    defaultValue: 590,
    unit: 'mm',
    category: 'dimension',
    integer: true,
    binding: { version: 1, kind: 'dimensionColumn', dimension: 'depthMm' },
  },
  {
    name: 'softClose',
    label: 'Soft close',
    type: 'boolean',
    defaultValue: true,
    category: 'metadata',
  },
  {
    name: 'style',
    label: 'Style',
    type: 'enum',
    defaultValue: 'slab',
    options: ['slab', 'shaker'],
    category: 'metadata',
  },
  {
    name: 'tiltDeg',
    label: 'Tilt',
    type: 'number',
    defaultValue: 0,
    unit: 'deg',
    min: 0,
    max: 5,
    step: 0.25,
    category: 'metadata',
  },
  {
    name: 'shelfCount',
    label: 'Shelf count',
    type: 'number',
    defaultValue: 2,
    unit: 'count',
    min: 0,
    max: 10,
    step: 1,
    integer: true,
    category: 'configuration',
    binding: { version: 1, kind: 'componentQuantity', componentId: 'definition-shelf' },
  },
  {
    name: 'hasBackPanel',
    label: 'Has back panel',
    type: 'boolean',
    defaultValue: true,
    category: 'configuration',
    binding: { version: 1, kind: 'componentCondition', componentId: 'definition-back' },
  },
  {
    name: 'label',
    label: 'Label',
    type: 'string',
    maxLength: 64,
    required: true,
    category: 'metadata',
  },
];

const definition: FurnitureDefinition = {
  furnitureDefinitionId: 'definition-strict-parameters',
  code: 'STRICT-PARAMETERS',
  name: 'Strict parameters fixture',
  category: 'kitchen_base',
  version: '1.0.0',
  parameters,
  componentSlots: [
    {
      slotId: 'shelf',
      role: 'shelf',
      componentDefinitionId: 'definition-shelf',
      defaultMaterialRole: 'shelf',
      quantityParameter: 'shelfCount',
    },
    {
      slotId: 'back',
      role: 'back_panel',
      componentDefinitionId: 'definition-back',
      defaultMaterialRole: 'back_panel',
      conditionParameter: 'hasBackPanel',
    },
  ],
  relationshipTemplates: [],
  defaultMaterialAssignments: [],
};

const requiredValues = { label: 'Cabinet' } as const;

function instantiate(raw: Record<string, string | number | boolean>) {
  return instantiateFurniture(definition, raw, {}, {}, {}, { projectId: 'project-1' });
}

describe('strict parameter evaluation at furniture composition entry points', () => {
  test.each([
    ['numeric string', { ...requiredValues, widthMm: '600' }, 'PARAMETER_TYPE_INVALID'],
    ['boolean string', { ...requiredValues, hasBackPanel: 'false' }, 'PARAMETER_TYPE_INVALID'],
    ['numeric enum', { ...requiredValues, style: 1 }, 'PARAMETER_TYPE_INVALID'],
    ['invalid step', { ...requiredValues, tiltDeg: 0.3 }, 'PARAMETER_STEP_INVALID'],
    ['non-integer count', { ...requiredValues, shelfCount: 2.5 }, 'PARAMETER_TYPE_INVALID'],
  ])('rejects %s consistently without coercion or layout output', (_name, raw, expectedCode) => {
    const instantiated = instantiate(raw);
    const interactive = validateInteractiveParameters(definition, raw);
    const layout = resolveFurnitureLayout(definition, raw);

    expect(instantiated.success).toBe(false);
    expect(instantiated.envelope).toBeUndefined();
    expect(instantiated.issues.map((issue) => issue.code)).toContain(expectedCode);
    expect(interactive.valid).toBe(false);
    expect(interactive.issues.map((issue) => issue.code)).toContain(expectedCode);
    expect(layout.validation.issues.map((issue) => issue.code)).toContain(expectedCode);
    expect(layout.components).toEqual([]);
    expect(layout.parts).toEqual([]);
  });

  test('applies defaults once and preserves them through instantiate and layout', () => {
    const instantiated = instantiate({ ...requiredValues });
    const interactive = validateInteractiveParameters(definition, { ...requiredValues });
    const layout = resolveFurnitureLayout(definition, { ...requiredValues });

    expect(instantiated.success).toBe(true);
    expect(interactive).toEqual({ valid: true, issues: [] });
    expect(instantiated.envelope!.assemblies[0]!.parameters).toMatchObject({
      widthMm: 600,
      softClose: true,
      style: 'slab',
      shelfCount: 2,
      hasBackPanel: true,
      label: 'Cabinet',
    });
    expect(layout.furnitureInstance.evaluatedParameters).toEqual(
      instantiated.envelope!.assemblies[0]!.parameters,
    );
  });

  test('componentCondition includes or excludes its composition entry consistently', () => {
    const included = instantiate({ ...requiredValues, hasBackPanel: true });
    const excluded = instantiate({ ...requiredValues, hasBackPanel: false });
    const includedLayout = resolveFurnitureLayout(definition, { ...requiredValues, hasBackPanel: true });
    const excludedLayout = resolveFurnitureLayout(definition, { ...requiredValues, hasBackPanel: false });

    expect(included.success).toBe(true);
    expect(excluded.success).toBe(true);
    expect(included.envelope!.assemblies[0]!.components!.filter(
      (component) => component.componentDefinitionId === 'definition-back',
    )).toHaveLength(1);
    expect(excluded.envelope!.assemblies[0]!.components!.filter(
      (component) => component.componentDefinitionId === 'definition-back',
    )).toHaveLength(0);
    expect(includedLayout.components.filter(
      (component) => component.componentDefinitionId === 'definition-back',
    )).toHaveLength(1);
    expect(excludedLayout.components.filter(
      (component) => component.componentDefinitionId === 'definition-back',
    )).toHaveLength(0);
    expect(excludedLayout.parts.some((part) => part.role === 'back_panel')).toBe(false);
  });

  test('preserves structured type details for UI and contract consumers', () => {
    const instantiated = instantiate({ ...requiredValues, widthMm: '600' });
    const interactive = validateInteractiveParameters(definition, { ...requiredValues, widthMm: '600' });

    expect(instantiated.issues[0]).toMatchObject({
      code: 'PARAMETER_TYPE_INVALID',
      path: 'parameters.widthMm',
      details: {
        parameterName: 'widthMm',
        expectedType: 'number',
        receivedType: 'string',
        receivedValue: '600',
        integer: true,
        min: 300,
        max: 1200,
        step: 10,
      },
    });
    expect(interactive.issues[0]).toMatchObject({
      code: 'PARAMETER_TYPE_INVALID',
      parameterName: 'widthMm',
      details: {
        expectedType: 'number',
        receivedType: 'string',
        receivedValue: '600',
        integer: true,
        min: 300,
        max: 1200,
        step: 10,
      },
    });
  });

  test('enforces string maxLength at the boundary and reports a bounded scalar value', () => {
    const boundary = 'x'.repeat(64);
    const offByOne = 'x'.repeat(65);
    const tooLong = 'á'.repeat(200);

    expect(instantiate({ label: boundary }).success).toBe(true);
    expect(instantiate({ label: offByOne }).issues.map((candidate) => candidate.code)).toContain(
      'PARAMETER_STRING_TOO_LONG',
    );
    const instantiated = instantiate({ label: tooLong });
    const interactive = validateInteractiveParameters(definition, { label: tooLong });
    const layout = resolveFurnitureLayout(definition, { label: tooLong });
    const issue = instantiated.issues.find((candidate) => candidate.code === 'PARAMETER_STRING_TOO_LONG')!;

    expect(issue.details).toMatchObject({
      expectedType: 'string',
      receivedType: 'string',
      receivedValue: `${'á'.repeat(128)}…`,
    });
    expect(interactive.issues.map((candidate) => candidate.code)).toContain('PARAMETER_STRING_TOO_LONG');
    expect(layout.validation.issues.map((candidate) => candidate.code)).toContain('PARAMETER_STRING_TOO_LONG');
    expect(layout.components).toEqual([]);
  });

  test('never copies object or array values into issue details', () => {
    for (const value of [{ secret: 'do-not-log' }, ['do-not-log']]) {
      const raw = { ...requiredValues, widthMm: value } as unknown as Record<
        string,
        string | number | boolean
      >;
      const evaluation = evaluateFurnitureParameters(parameters, raw);
      const issue = evaluation.issues.find((candidate) => candidate.parameter === 'widthMm')!;
      const instantiated = instantiate(raw);
      const interactive = validateInteractiveParameters(definition, raw);

      expect(issue.code).toBe('PARAMETER_TYPE_INVALID');
      expect(issue.details).not.toHaveProperty('receivedValue');
      expect(instantiated.issues[0]!.details).not.toHaveProperty('receivedValue');
      expect(interactive.issues[0]!.details).not.toHaveProperty('receivedValue');
    }
  });

  test('fails every entry point when a required parameter has no default', () => {
    const instantiated = instantiate({});
    const interactive = validateInteractiveParameters(definition, {});
    const layout = resolveFurnitureLayout(definition, {});

    expect(instantiated.issues.map((issue) => issue.code)).toContain('PARAMETER_REQUIRED');
    expect(interactive.issues.map((issue) => issue.code)).toContain('PARAMETER_REQUIRED');
    expect(layout.validation.issues.map((issue) => issue.code)).toContain('PARAMETER_REQUIRED');
    expect(layout.components).toEqual([]);
  });

  test('fails closed with structured issues when a definition is invalid', () => {
    const invalidDefinition: FurnitureDefinition = {
      ...definition,
      parameters: [{
        name: 'style',
        label: 'Style',
        type: 'enum',
        defaultValue: 'missing',
        options: ['slab'],
        category: 'metadata',
      }],
    };

    const instantiated = instantiateFurniture(invalidDefinition, {}, {}, {}, {}, { projectId: 'project-1' });
    const interactive = validateInteractiveParameters(invalidDefinition, {});
    const layout = resolveFurnitureLayout(invalidDefinition, {});

    expect(instantiated.issues[0]).toMatchObject({
      code: 'PARAMETER_DEFINITION_INVALID',
      details: { parameterName: 'style', field: 'defaultValue' },
    });
    expect(interactive.issues[0]).toMatchObject({
      code: 'PARAMETER_DEFINITION_INVALID',
      parameterName: 'style',
      details: { field: 'defaultValue' },
    });
    expect(layout.components).toEqual([]);
    expect(layout.parts).toEqual([]);
  });

  test.each([
    ['missing binding', undefined],
    ['binding', []],
    ['binding fields', { version: '1', kind: 7, componentId: false, dimension: 3 }],
    ['componentCondition type', {
      version: 1,
      kind: 'componentCondition',
      componentId: 'definition-shelf',
    }],
    ['componentCondition unsupported targets', {
      version: 1,
      kind: 'componentCondition',
      componentId: 'definition-shelf',
      dimension: 'widthMm',
      relationship: { kind: 'shelf-support', sourceRole: 'shelf', targets: [] },
    }],
    ['relationship', {
      version: 1,
      kind: 'componentQuantity',
      componentId: 'definition-shelf',
      relationship: [],
    }],
    ['relationship fields', {
      version: 1,
      kind: 'componentQuantity',
      componentId: 'definition-shelf',
      relationship: { kind: 7, sourceRole: false, targets: [] },
    }],
    ['targets', {
      version: 1,
      kind: 'componentQuantity',
      componentId: 'definition-shelf',
      relationship: { kind: 'shelf-support', sourceRole: 'shelf', targets: {} },
    }],
    ['target entry', {
      version: 1,
      kind: 'componentQuantity',
      componentId: 'definition-shelf',
      relationship: {
        kind: 'shelf-support',
        sourceRole: 'shelf',
        targets: [null, { componentId: 1, role: false }],
      },
    }],
  ])('fails every entry point closed for malformed nested %s shape', (_name, binding) => {
    const shelfCount = parameters.find((parameter) => parameter.name === 'shelfCount')!;
    const malformedDefinition: FurnitureDefinition = {
      ...definition,
      parameters: [{ ...shelfCount, binding } as unknown as FurnitureParameter],
    };

    const instantiated = instantiateFurniture(malformedDefinition, {}, {}, {}, {}, { projectId: 'project-1' });
    const interactive = validateInteractiveParameters(malformedDefinition, {});
    const layout = resolveFurnitureLayout(malformedDefinition, {});

    expect(instantiated.issues.map((issue) => issue.code)).toContain('PARAMETER_DEFINITION_INVALID');
    expect(interactive.issues.map((issue) => issue.code)).toContain('PARAMETER_DEFINITION_INVALID');
    expect(layout.validation.issues.map((issue) => issue.code)).toContain('PARAMETER_DEFINITION_INVALID');
    expect(layout.components).toEqual([]);
    expect(layout.parts).toEqual([]);
  });

  test.each([
    ['definition', () => ({ ...definition, unsupportedDefinitionField: true }) as unknown as FurnitureDefinition],
    ['parameter', () => ({
      ...definition,
      parameters: [{
        ...parameters.find((parameter) => parameter.name === 'softClose')!,
        defautValue: false,
      } as unknown as FurnitureParameter],
    })],
    ['binding', () => ({
      ...definition,
      parameters: [{
        ...parameters.find((parameter) => parameter.name === 'shelfCount')!,
        binding: {
          ...parameters.find((parameter) => parameter.name === 'shelfCount')!.binding!,
          unsupportedBindingField: true,
        },
      } as unknown as FurnitureParameter],
    })],
    ['relationship', () => ({
      ...definition,
      parameters: [{
        ...parameters.find((parameter) => parameter.name === 'shelfCount')!,
        binding: {
          version: 1,
          kind: 'componentQuantity',
          componentId: 'definition-shelf',
          relationship: {
            kind: 'shelf-support',
            sourceRole: 'shelf',
            targets: [{ componentId: 'definition-side', role: 'inside' }],
            unsupportedRelationshipField: true,
          },
        },
      } as unknown as FurnitureParameter],
    })],
    ['relationship target', () => ({
      ...definition,
      parameters: [{
        ...parameters.find((parameter) => parameter.name === 'shelfCount')!,
        binding: {
          version: 1,
          kind: 'componentQuantity',
          componentId: 'definition-shelf',
          relationship: {
            kind: 'shelf-support',
            sourceRole: 'shelf',
            targets: [{ componentId: 'definition-side', role: 'inside', unsupportedTargetField: true }],
          },
        },
      } as unknown as FurnitureParameter],
    })],
  ])('rejects unknown %s properties at every composition entry point', (_name, buildDefinition) => {
    const closedDefinition = buildDefinition();
    const instantiated = instantiateFurniture(closedDefinition, {}, {}, {}, {}, { projectId: 'project-1' });
    const interactive = validateInteractiveParameters(closedDefinition, {});
    const layout = resolveFurnitureLayout(closedDefinition, {});

    expect(instantiated.issues.map((issue) => issue.code)).toContain('PARAMETER_DEFINITION_INVALID');
    expect(interactive.issues.map((issue) => issue.code)).toContain('PARAMETER_DEFINITION_INVALID');
    expect(layout.validation.issues.map((issue) => issue.code)).toContain('PARAMETER_DEFINITION_INVALID');
    expect(layout.components).toEqual([]);
  });

  test.each([
    ['missing', []],
    ['ambiguous', [
      definition.componentSlots[1]!,
      { ...definition.componentSlots[1]!, slotId: 'back-duplicate' },
    ]],
  ])('rejects a %s componentCondition direct target at every entry point', (_name, componentSlots) => {
    const invalidTargetDefinition = { ...definition, componentSlots };
    const instantiated = instantiateFurniture(invalidTargetDefinition, {}, {}, {}, {}, { projectId: 'project-1' });
    const interactive = validateInteractiveParameters(invalidTargetDefinition, {});
    const layout = resolveFurnitureLayout(invalidTargetDefinition, {});

    expect(instantiated.issues.map((issue) => issue.code)).toContain('PARAMETER_DEFINITION_INVALID');
    expect(interactive.issues.map((issue) => issue.code)).toContain('PARAMETER_DEFINITION_INVALID');
    expect(layout.validation.issues.map((issue) => issue.code)).toContain('PARAMETER_DEFINITION_INVALID');
    expect(layout.components).toEqual([]);
  });
});
