/**
 * Module editor — Parámetros tab (#497 T5/T6).
 *
 * Typed parameter definitions + semantic bindings authored entirely from the
 * form: list/order, create/edit for the four supported types with the exact
 * contract constraints, reserved dimensions shown as read-only projections,
 * and a binding editor that only offers the two authorable behavioral kinds
 * against unambiguous composition entries. The browser validates with the
 * shared domain contract; the server stays the authority.
 */

import { type Dispatch, type ReactNode, type SetStateAction, useMemo, useState } from 'react';
import type {
  Component,
  ContractIssue,
  FurnitureParameter,
  Structure,
} from '@granete/domain';
import { validateFurnitureParameterDefinitions } from '@granete/domain';
import type {
  FurnitureAuthoringPreviewRequest,
  FurnitureAuthoringPreviewResponse,
} from '@granete/domain';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { InlineLoading } from '../../common/InlineLoading';
import type { ModuleDraft } from '../moduleHelpers';
import {
  authorableBindingKinds,
  compositionBindingEntries,
  moveParameterDefinition,
  reservedDimensionProjections,
  renumberSortOrders,
} from '../helpers/parameterBindingTargets';

export type ModuleEditorParametersPanelProps = {
  readonly draft: ModuleDraft;
  readonly setDraft: Dispatch<SetStateAction<ModuleDraft>>;
  readonly structures: readonly Structure[];
  readonly selectedStructure: Structure | undefined;
  readonly catalogComponents: readonly Component[];
  readonly canMutate: boolean;
  readonly hidden: boolean;
  /** The persisted module id, when editing a saved module (#497 T7 preview). */
  readonly savedModuleId?: string | null;
  /** #497 T7: the server-authoritative draft preview (Probar resolución). */
  readonly onPreviewAuthoring?: (
    request: FurnitureAuthoringPreviewRequest,
  ) => Promise<FurnitureAuthoringPreviewResponse>;
};

const PARAMETER_TYPES = [
  { value: 'number', label: 'Número' },
  { value: 'string', label: 'Texto' },
  { value: 'boolean', label: 'Sí / No' },
  { value: 'enum', label: 'Lista de opciones' },
] as const;

const PARAMETER_CATEGORIES = [
  { value: 'configuration', label: 'Configuración' },
  { value: 'style', label: 'Estilo' },
  { value: 'hardware', label: 'Herrajes' },
  { value: 'dimension', label: 'Dimensión' },
  { value: 'metadata', label: 'Metadatos' },
] as const;

const UNITS = [
  { value: '', label: 'Sin unidad' },
  { value: 'mm', label: 'mm' },
  { value: 'deg', label: 'grados' },
  { value: 'count', label: 'cantidad' },
] as const;

const RESERVED_NAMES = new Set(['widthMm', 'heightMm', 'depthMm']);
const NAME_PATTERN = /^[A-Za-z0-9_]+$/;

const BINDING_EFFECT: Record<'componentQuantity' | 'componentCondition', string> = {
  componentQuantity:
    'Multiplica la cantidad del componente por el valor del parámetro.',
  componentCondition:
    'Incluye el componente sólo cuando el valor del parámetro es verdadero.',
};

type ParameterFormState = {
  name: string;
  label: string;
  type: FurnitureParameter['type'];
  category: FurnitureParameter['category'];
  required: boolean;
  unit: '' | 'mm' | 'deg' | 'count';
  integer: boolean;
  min: string;
  max: string;
  step: string;
  maxLength: string;
  options: string[];
  defaultValue: string;
  bindingKind: '' | 'componentQuantity' | 'componentCondition';
  bindingComponentId: string;
};

function emptyForm(): ParameterFormState {
  return {
    name: '',
    label: '',
    type: 'number',
    category: 'configuration',
    required: true,
    unit: '',
    integer: false,
    min: '',
    max: '',
    step: '',
    maxLength: '',
    options: [],
    defaultValue: '',
    bindingKind: '',
    bindingComponentId: '',
  };
}

function formFromParameter(parameter: FurnitureParameter): ParameterFormState {
  const options = [...(parameter.options ?? [])];
  const defaultValue =
    parameter.defaultValue === undefined
      ? ''
      : parameter.type === 'boolean'
        ? parameter.defaultValue
          ? 'true'
          : 'false'
        : String(parameter.defaultValue);
  return {
    name: parameter.name,
    label: parameter.label,
    type: parameter.type,
    category: parameter.category,
    required: parameter.required ?? false,
    unit: (parameter.unit as ParameterFormState['unit']) ?? '',
    integer: parameter.integer ?? false,
    min: parameter.min !== undefined ? String(parameter.min) : '',
    max: parameter.max !== undefined ? String(parameter.max) : '',
    step: parameter.step !== undefined ? String(parameter.step) : '',
    maxLength: parameter.maxLength !== undefined ? String(parameter.maxLength) : '',
    options,
    defaultValue,
    bindingKind:
      parameter.binding?.kind === 'componentQuantity' ||
      parameter.binding?.kind === 'componentCondition'
        ? parameter.binding.kind
        : '',
    bindingComponentId: parameter.binding?.componentId ?? '',
  };
}

function buildParameter(form: ParameterFormState): FurnitureParameter {
  const isNumber = form.type === 'number';
  const optionalNumber = (raw: string): number | undefined => {
    if (raw.trim() === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  let defaultValue: string | number | boolean | undefined;
  if (form.type === 'boolean') {
    defaultValue = form.defaultValue === '' ? undefined : form.defaultValue === 'true';
  } else if (form.type === 'number') {
    defaultValue = optionalNumber(form.defaultValue);
  } else if (form.defaultValue.trim() !== '') {
    defaultValue = form.defaultValue;
  }

  const withBinding =
    form.category !== 'metadata' && form.bindingKind !== '' && form.bindingComponentId.trim() !== ''
      ? {
          binding: {
            version: 1,
            kind: form.bindingKind,
            componentId: form.bindingComponentId.trim(),
          },
        }
      : {};
  const parameter: FurnitureParameter = {
    name: form.name.trim(),
    label: form.label.trim(),
    type: form.type,
    category: form.category,
    ...(form.required ? { required: true } : {}),
    ...(isNumber && form.unit !== '' ? { unit: form.unit as 'mm' | 'deg' | 'count' } : {}),
    ...(isNumber && optionalNumber(form.min) !== undefined ? { min: optionalNumber(form.min) } : {}),
    ...(isNumber && optionalNumber(form.max) !== undefined ? { max: optionalNumber(form.max) } : {}),
    ...(isNumber && optionalNumber(form.step) !== undefined ? { step: optionalNumber(form.step) } : {}),
    ...(isNumber && form.integer ? { integer: true } : {}),
    ...(form.type === 'string' && form.maxLength.trim() !== ''
      ? { maxLength: Number(form.maxLength) }
      : {}),
    ...(form.type === 'enum' && form.options.length > 0 ? { options: [...form.options] } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...withBinding,
  };
  return parameter;
}

/** Local save gate (the server re-validates with full authority). */
function formSaveError(
  form: ParameterFormState,
  others: readonly FurnitureParameter[],
): string | null {
  const name = form.name.trim();
  if (name === '') return 'El nombre técnico es obligatorio.';
  if (!NAME_PATTERN.test(name)) {
    return 'El nombre técnico sólo acepta letras, números y guión bajo (sin espacios).';
  }
  if (name.length > 64) return 'El nombre técnico no puede exceder 64 caracteres.';
  if (RESERVED_NAMES.has(name)) {
    return `"${name}" es una dimensión reservada: se proyecta desde las medidas del mueble y no se declara como parámetro.`;
  }
  if (others.some((p) => p.name === name)) return 'Ya existe un parámetro con ese nombre técnico.';
  const label = form.label.trim();
  if (label === '') return 'La etiqueta es obligatoria.';
  if (label.length > 160) return 'La etiqueta no puede exceder 160 caracteres.';

  const number = (raw: string): number | undefined =>
    raw.trim() === '' ? undefined : Number(raw);
  if (form.type === 'number') {
    const min = number(form.min);
    const max = number(form.max);
    const step = number(form.step);
    if (form.min.trim() !== '' && !Number.isFinite(min)) return 'El mínimo debe ser numérico.';
    if (form.max.trim() !== '' && !Number.isFinite(max)) return 'El máximo debe ser numérico.';
    if (min !== undefined && max !== undefined && min > max) {
      return 'El mínimo no puede superar el máximo.';
    }
    if (form.step.trim() !== '' && (step === undefined || step <= 0)) {
      return 'El paso debe ser un número mayor que cero.';
    }
    if (form.unit === 'count' && !form.integer) {
      return 'Los parámetros de cantidad siempre son enteros.';
    }
  }
  if (form.type === 'string') {
    const maxLength = number(form.maxLength);
    if (maxLength === undefined || !Number.isInteger(maxLength) || maxLength < 1 || maxLength > 512) {
      return 'El límite de texto (maxLength) es obligatorio: entre 1 y 512.';
    }
  }
  if (form.type === 'enum') {
    if (form.options.length === 0) return 'Definí al menos una opción.';
    if (form.options.length > 64) return 'La lista admite hasta 64 opciones.';
    if (form.options.some((option) => option.trim() === '')) return 'Las opciones no pueden quedar vacías.';
    if (new Set(form.options).size !== form.options.length) return 'Las opciones deben ser únicas.';
    if (form.options.some((option) => option.length > 128)) {
      return 'Cada opción no puede exceder 128 caracteres.';
    }
    if (form.defaultValue !== '' && !form.options.includes(form.defaultValue)) {
      return 'El valor por defecto debe ser una de las opciones.';
    }
  }
  if (form.type === 'number' && form.defaultValue.trim() !== '') {
    const value = Number(form.defaultValue);
    if (!Number.isFinite(value)) return 'El valor por defecto debe ser numérico.';
    const min = number(form.min);
    const max = number(form.max);
    if (min !== undefined && value < min) return 'El valor por defecto es menor que el mínimo.';
    if (max !== undefined && value > max) return 'El valor por defecto es mayor que el máximo.';
  }
  if (form.category !== 'metadata') {
    if (form.bindingKind === '') {
      return 'Los parámetros que no son metadatos necesitan una vinculación semántica.';
    }
    if (form.bindingComponentId.trim() === '') {
      return 'Elegí el componente al que se vincula el parámetro.';
    }
  }
  return null;
}

function defaultSummary(parameter: FurnitureParameter): string {
  if (parameter.defaultValue === undefined) return 'sin default';
  if (parameter.type === 'boolean') return parameter.defaultValue ? 'verdadero' : 'falso';
  return String(parameter.defaultValue);
}

function bindingSummary(parameter: FurnitureParameter): string {
  const binding = parameter.binding;
  if (!binding) {
    return parameter.category === 'metadata' ? 'metadato (sin vinculación)' : 'sin vinculación';
  }
  if (binding.kind === 'componentQuantity') return 'cantidad de componente';
  if (binding.kind === 'componentCondition') return 'condición de componente';
  if (binding.kind === 'dimensionColumn') return 'proyección de dimensión';
  return 'relación de estructura (resolvedor)';
}

export function ModuleEditorParametersPanel({
  draft,
  setDraft,
  structures,
  selectedStructure,
  catalogComponents,
  canMutate,
  hidden,
  savedModuleId,
  onPreviewAuthoring,
}: ModuleEditorParametersPanelProps): ReactNode {
  const definitions = draft.parameterDefinitions ?? [];
  const [editing, setEditing] = useState<
    | null
    | {
        isNew: boolean;
        position: number;
        form: ParameterFormState;
        originalType: FurnitureParameter['type'];
      }
  >(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ position: number; parameter: FurnitureParameter } | null>(null);
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const [previewState, setPreviewState] = useState<
    | { kind: 'idle' }
    | { kind: 'running' }
    | { kind: 'error'; message: string }
    | { kind: 'done'; response: FurnitureAuthoringPreviewResponse }
  >({ kind: 'idle' });

  const componentNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const component of catalogComponents) {
      names.set(component.id, component.name);
    }
    return names;
  }, [catalogComponents]);

  const entries = useMemo(
    () =>
      compositionBindingEntries(
        draft.components.map((c) => c.componentId),
        selectedStructure ?? structures.find((s) => s.id === draft.structureId),
      ),
    [draft.components, draft.structureId, selectedStructure, structures],
  );

  const issues = useMemo(
    () => validateFurnitureParameterDefinitions(definitions),
    [definitions],
  );
  const issuesByParameter = useMemo(() => {
    const byParameter = new Map<string, string[]>();
    for (const issue of issues) {
      if (issue.parameter === '') continue;
      byParameter.set(issue.parameter, [
        ...(byParameter.get(issue.parameter) ?? []),
        `${issue.field}: ${issue.message}`,
      ]);
    }
    return byParameter;
  }, [issues]);

  const displayOrder = useMemo(
    () =>
      definitions
        .map((parameter, position) => ({ parameter, position }))
        .sort((a, b) => {
          const sortA = a.parameter.sortOrder ?? 0;
          const sortB = b.parameter.sortOrder ?? 0;
          if (sortA !== sortB) return sortA - sortB;
          return a.parameter.name.localeCompare(b.parameter.name);
        }),
    [definitions],
  );

  const reserved = useMemo(
    () =>
      reservedDimensionProjections(
        draft.externalWidth,
        draft.externalHeight,
        draft.externalDepth,
        draft.presets,
      ),
    [draft.externalDepth, draft.externalHeight, draft.externalWidth, draft.presets],
  );

  const writeDefinitions = (next: readonly FurnitureParameter[]): void => {
    setDraft((prev) => ({ ...prev, parameterDefinitions: renumberSortOrders(next) }));
  };

  const openNew = (): void => {
    setFormError(null);
    setEditing({
      isNew: true,
      position: definitions.length,
      form: emptyForm(),
      originalType: 'number',
    });
  };

  const openEdit = (position: number, parameter: FurnitureParameter): void => {
    setFormError(null);
    setPreviewState({ kind: 'idle' });
    setEditing({
      isNew: false,
      position,
      form: formFromParameter(parameter),
      originalType: parameter.type,
    });
  };

  const removeParameter = (position: number): void => {
    const next = definitions.filter((_, index) => index !== position);
    writeDefinitions(next);
    setPreviewState({ kind: 'idle' });
  };

  const saveForm = (): void => {
    if (!editing) return;
    const others = editing.isNew
      ? definitions
      : definitions.filter((_, index) => index !== editing.position);
    const localError = formSaveError(editing.form, others);
    if (localError) {
      setFormError(localError);
      return;
    }
    const built = buildParameter(editing.form);
    const builtIssues = validateFurnitureParameterDefinitions([built]);
    if (builtIssues.length > 0) {
      setFormError(
        `El parámetro no cumple el contrato: ${builtIssues
          .map((issue) => `${issue.field} ${issue.message}`)
          .join('; ')}.`,
      );
      return;
    }
    const next = editing.isNew
      ? [...definitions, built]
      : definitions.map((parameter, index) => (index === editing.position ? built : parameter));
    writeDefinitions(next);
    setEditing(null);
    setFormError(null);
  };

  const editingEntries =
    editing && editing.form.category !== 'metadata'
      ? entries
      : [];

  return (
    <div
      className="module-editor__section module-editor__parameters"
      role="tabpanel"
      id="module-editor-panel-parameters"
      aria-labelledby="module-editor-tab-parameters"
      hidden={hidden}
      data-testid="module-editor-panel-parameters"
    >
      <section className="catalog-form__section" data-testid="parameters-reserved">
        <h4>Dimensiones reservadas</h4>
        <p className="catalog-form__hint">
          No se declaran como parámetros: el catálogo las proyecta desde las medidas base y
          los presets, y SketchUp las recibe como parámetros de dimensión.
        </p>
        <ul className="module-parameters__reserved" data-testid="parameters-reserved-list">
          {reserved.map((projection) => (
            <li key={projection.name}>
              <code>{projection.name}</code> — {projection.label}
              {projection.rangeText !== '' ? ` · rango ${projection.rangeText}` : ''} · default{' '}
              {projection.defaultValueText}
            </li>
          ))}
        </ul>
      </section>

      <section className="catalog-form__section" data-testid="parameters-list-section">
        <div className="module-parameters__list-header">
          <h4>Parámetros del mueble</h4>
          <button
            type="button"
            className="btn"
            onClick={openNew}
            disabled={!canMutate || editing !== null}
            data-testid="parameter-add"
          >
            Nuevo parámetro
          </button>
        </div>

        {definitions.length === 0 ? (
          <p className="catalog-form__hint" data-testid="parameters-empty">
            Sin parámetros tipados. Crealos acá y viajan con el mueble a SketchUp sin
            editar JSON.
          </p>
        ) : (
          <ul className="module-parameters__list" data-testid="parameters-list">
            {displayOrder.map(({ parameter, position }) => {
              const parameterIssues = issuesByParameter.get(parameter.name) ?? [];
              const invalid = parameterIssues.length > 0;
              return (
                <li
                  key={`${parameter.name}-${position}`}
                  className={`module-parameters__row${invalid ? ' module-parameters__row--invalid' : ''}`}
                  data-testid="parameter-row"
                >
                  <div className="module-parameters__row-main">
                    <span className="module-parameters__label">{parameter.label}</span>
                    <code className="module-parameters__name">{parameter.name}</code>
                    <span className="module-parameters__meta">
                      {parameter.type} · {parameter.category} ·{' '}
                      {parameter.required ? 'requerido' : 'opcional'}
                      {parameter.unit ? ` · ${parameter.unit}` : ''} · default{' '}
                      {defaultSummary(parameter)} · {bindingSummary(parameter)}
                    </span>
                    {invalid ? (
                      <span
                        className="module-parameters__issue"
                        role="alert"
                        data-testid="parameter-row-issue"
                      >
                        {parameterIssues[0]}
                        {parameterIssues.length > 1 ? ` (+${parameterIssues.length - 1})` : ''}
                      </span>
                    ) : null}
                  </div>
                  <div className="module-parameters__row-actions">
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Subir ${parameter.label}`}
                      disabled={!canMutate || editing !== null || position === 0}
                      onClick={() => writeDefinitions(moveParameterDefinition(definitions, position, 'up'))}
                      data-testid="parameter-move-up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Bajar ${parameter.label}`}
                      disabled={
                        !canMutate || editing !== null || position === displayOrder.length - 1
                      }
                      onClick={() => writeDefinitions(moveParameterDefinition(definitions, position, 'down'))}
                      data-testid="parameter-move-down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={!canMutate || editing !== null}
                      onClick={() => openEdit(position, parameter)}
                      data-testid="parameter-edit"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger"
                      disabled={!canMutate || editing !== null}
                      onClick={() => setConfirmRemove({ position, parameter })}
                      data-testid="parameter-remove"
                    >
                      Quitar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editing ? (
        <section
          className="catalog-form__section module-parameters__editor"
          data-testid="parameter-editor"
        >
          <h4>{editing.isNew ? 'Nuevo parámetro' : `Editar ${editing.form.name}`}</h4>
          {formError ? (
            <p className="catalog-form__error" role="alert" data-testid="parameter-editor-error">
              {formError}
            </p>
          ) : null}

          <div className="catalog-form__field">
            <label htmlFor="parameter-name">Nombre técnico</label>
            <input
              id="parameter-name"
              value={editing.form.name}
              onChange={(e) =>
                setEditing((prev) =>
                  prev ? { ...prev, form: { ...prev.form, name: e.target.value } } : prev,
                )
              }
              disabled={!canMutate}
              data-testid="parameter-name"
            />
            <span className="catalog-form__hint">
              Letras, números y guión bajo. No puede repetirse ni ser una dimensión reservada.
            </span>
          </div>

          <div className="catalog-form__field">
            <label htmlFor="parameter-label">Etiqueta</label>
            <input
              id="parameter-label"
              value={editing.form.label}
              onChange={(e) =>
                setEditing((prev) =>
                  prev ? { ...prev, form: { ...prev.form, label: e.target.value } } : prev,
                )
              }
              disabled={!canMutate}
              data-testid="parameter-label"
            />
          </div>

          <div className="catalog-form__field">
            <label htmlFor="parameter-type">Tipo</label>
            <select
              id="parameter-type"
              value={editing.form.type}
              onChange={(e) =>
                setEditing((prev) =>
                  prev
                    ? {
                        ...prev,
                        form: {
                          ...prev.form,
                          type: e.target.value as ParameterFormState['type'],
                          unit: e.target.value === 'number' ? prev.form.unit : '',
                          integer: e.target.value === 'number' ? prev.form.integer : false,
                          bindingKind: '',
                          bindingComponentId: '',
                        },
                      }
                    : prev,
                )
              }
              disabled={!canMutate}
              data-testid="parameter-type"
            >
              {PARAMETER_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            {!editing.isNew && editing.form.type !== editing.originalType ? (
              <span
                className="catalog-form__hint module-parameters__impact"
                data-testid="parameter-type-impact"
              >
                Cambiar el tipo reinterpreta el valor por defecto y puede invalidar la
                vinculación; al guardar, el hash de la definición y la revisión del
                catálogo avanzan.
              </span>
            ) : null}
          </div>

          <div className="catalog-form__field">
            <label htmlFor="parameter-category">Categoría</label>
            <select
              id="parameter-category"
              value={editing.form.category}
              onChange={(e) =>
                setEditing((prev) =>
                  prev
                    ? {
                        ...prev,
                        form: {
                          ...prev.form,
                          category: e.target.value as ParameterFormState['category'],
                          ...(e.target.value === 'metadata'
                            ? { bindingKind: '', bindingComponentId: '' }
                            : {}),
                        },
                      }
                    : prev,
                )
              }
              disabled={!canMutate}
              data-testid="parameter-category"
            >
              {PARAMETER_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
            {editing.form.category === 'metadata' ? (
              <span className="catalog-form__hint" data-testid="parameter-metadata-hint">
                Los metadatos no afectan la composición: no llevan vinculación semántica.
              </span>
            ) : null}
          </div>

          <div className="catalog-form__field">
            <label>
              <input
                type="checkbox"
                checked={editing.form.required}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, form: { ...prev.form, required: e.target.checked } } : prev,
                  )
                }
                disabled={!canMutate}
                data-testid="parameter-required"
              />{' '}
              Requerido al instanciar
            </label>
          </div>

          {editing.form.type === 'number' ? (
            <>
              <div className="catalog-form__field">
                <label htmlFor="parameter-unit">Unidad</label>
                <select
                  id="parameter-unit"
                  value={editing.form.unit}
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev
                        ? {
                            ...prev,
                            form: {
                              ...prev.form,
                              unit: e.target.value as ParameterFormState['unit'],
                              integer: e.target.value === 'count' ? true : prev.form.integer,
                            },
                          }
                        : prev,
                    )
                  }
                  disabled={!canMutate}
                  data-testid="parameter-unit"
                >
                  {UNITS.map((unit) => (
                    <option key={unit.value} value={unit.value}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="catalog-form__field-row">
                <div className="catalog-form__field">
                  <label htmlFor="parameter-min">Mínimo</label>
                  <input
                    id="parameter-min"
                    type="number"
                    value={editing.form.min}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev ? { ...prev, form: { ...prev.form, min: e.target.value } } : prev,
                      )
                    }
                    disabled={!canMutate}
                    data-testid="parameter-min"
                  />
                </div>
                <div className="catalog-form__field">
                  <label htmlFor="parameter-max">Máximo</label>
                  <input
                    id="parameter-max"
                    type="number"
                    value={editing.form.max}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev ? { ...prev, form: { ...prev.form, max: e.target.value } } : prev,
                      )
                    }
                    disabled={!canMutate}
                    data-testid="parameter-max"
                  />
                </div>
                <div className="catalog-form__field">
                  <label htmlFor="parameter-step">Paso</label>
                  <input
                    id="parameter-step"
                    type="number"
                    value={editing.form.step}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev ? { ...prev, form: { ...prev.form, step: e.target.value } } : prev,
                      )
                    }
                    disabled={!canMutate}
                    data-testid="parameter-step"
                  />
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={editing.form.integer}
                    disabled={!canMutate || editing.form.unit === 'count'}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev
                          ? { ...prev, form: { ...prev.form, integer: e.target.checked } }
                          : prev,
                      )
                    }
                    data-testid="parameter-integer"
                  />{' '}
                  Entero
                </label>
              </div>
            </>
          ) : null}

          {editing.form.type === 'string' ? (
            <div className="catalog-form__field">
              <label htmlFor="parameter-max-length">Largo máximo (1–512)</label>
              <input
                id="parameter-max-length"
                type="number"
                min={1}
                max={512}
                value={editing.form.maxLength}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, form: { ...prev.form, maxLength: e.target.value } } : prev,
                  )
                }
                disabled={!canMutate}
                data-testid="parameter-max-length"
              />
            </div>
          ) : null}

          {editing.form.type === 'enum' ? (
            <div className="catalog-form__field" data-testid="parameter-options">
              <label>Opciones (en orden)</label>
              <ul>
                {editing.form.options.map((option, index) => (
                  <li key={index} className="module-parameters__option-row">
                    <input
                      value={option}
                      aria-label={`Opción ${index + 1}`}
                      onChange={(e) =>
                        setEditing((prev) =>
                          prev
                            ? {
                                ...prev,
                                form: {
                                  ...prev.form,
                                  options: prev.form.options.map((current, current_index) =>
                                    current_index === index ? e.target.value : current,
                                  ),
                                },
                              }
                            : prev,
                        )
                      }
                      disabled={!canMutate}
                      data-testid={`parameter-option-${index}`}
                    />
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Quitar opción ${index + 1}`}
                      disabled={!canMutate}
                      onClick={() =>
                        setEditing((prev) =>
                          prev
                            ? {
                                ...prev,
                                form: {
                                  ...prev.form,
                                  options: prev.form.options.filter(
                                    (_, current_index) => current_index !== index,
                                  ),
                                },
                              }
                            : prev,
                        )
                      }
                      data-testid={`parameter-option-remove-${index}`}
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn"
                disabled={!canMutate}
                onClick={() =>
                  setEditing((prev) =>
                    prev
                      ? { ...prev, form: { ...prev.form, options: [...prev.form.options, ''] } }
                      : prev,
                  )
                }
                data-testid="parameter-option-add"
              >
                Agregar opción
              </button>
            </div>
          ) : null}

          <div className="catalog-form__field">
            <label htmlFor="parameter-default">Valor por defecto</label>
            {editing.form.type === 'boolean' ? (
              <select
                id="parameter-default"
                value={editing.form.defaultValue}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, form: { ...prev.form, defaultValue: e.target.value } } : prev,
                  )
                }
                disabled={!canMutate}
                data-testid="parameter-default"
              >
                <option value="">Sin default</option>
                <option value="true">Verdadero</option>
                <option value="false">Falso</option>
              </select>
            ) : editing.form.type === 'enum' ? (
              <select
                id="parameter-default"
                value={editing.form.defaultValue}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, form: { ...prev.form, defaultValue: e.target.value } } : prev,
                  )
                }
                disabled={!canMutate}
                data-testid="parameter-default"
              >
                <option value="">Sin default</option>
                {editing.form.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="parameter-default"
                type={editing.form.type === 'number' ? 'number' : 'text'}
                value={editing.form.defaultValue}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, form: { ...prev.form, defaultValue: e.target.value } } : prev,
                  )
                }
                disabled={!canMutate}
                data-testid="parameter-default"
              />
            )}
            {editing.form.type === 'boolean' ? (
              <span className="catalog-form__hint">
                Elegir “Falso” guarda un falso explícito: SketchUp lo respeta tal cual.
              </span>
            ) : null}
          </div>

          {editing.form.category !== 'metadata' ? (
            <fieldset
              className="catalog-form__field module-parameters__binding"
              data-testid="parameter-binding"
            >
              <legend>Vinculación semántica</legend>
              <div className="catalog-form__field">
                <label htmlFor="parameter-binding-kind">Efecto</label>
                <select
                  id="parameter-binding-kind"
                  value={editing.form.bindingKind}
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev
                        ? {
                            ...prev,
                            form: {
                              ...prev.form,
                              bindingKind: e.target.value as ParameterFormState['bindingKind'],
                            },
                          }
                        : prev,
                    )
                  }
                  disabled={!canMutate}
                  data-testid="parameter-binding-kind"
                >
                  <option value="">Sin vinculación</option>
                  {authorableBindingKinds(editing.form.type, editing.form.integer).map(({ kind, compatibility }) => (
                    <option key={kind} value={kind} disabled={compatibility !== 'compatible'}>
                      {kind === 'componentQuantity'
                        ? 'Cantidad de un componente'
                        : 'Presencia de un componente (sí/no)'}
                      {compatibility === 'requires-integer-number'
                        ? ' — requiere número entero'
                        : compatibility === 'requires-boolean'
                          ? ' — requiere Sí/No'
                          : ''}
                    </option>
                  ))}
                </select>
                {editing.form.bindingKind !== '' ? (
                  <span className="catalog-form__hint">
                    {BINDING_EFFECT[editing.form.bindingKind]}
                  </span>
                ) : (
                  <span className="catalog-form__hint">
                    Sólo se autorizan cantidad y presencia: la proyección de dimensiones y las
                    relaciones de estructura las resuelve el servidor.
                  </span>
                )}
              </div>

              {editing.form.bindingKind !== '' ? (
                <div className="catalog-form__field">
                  <label htmlFor="parameter-binding-component">Componente</label>
                  <select
                    id="parameter-binding-component"
                    value={editing.form.bindingComponentId}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev
                          ? {
                              ...prev,
                              form: { ...prev.form, bindingComponentId: e.target.value },
                            }
                          : prev,
                      )
                    }
                    disabled={!canMutate}
                    data-testid="parameter-binding-component"
                  >
                    <option value="">Elegí un componente…</option>
                    {editingEntries.map((entry) => {
                      const label =
                        componentNames.get(entry.componentId) ?? entry.componentId.slice(0, 8);
                      const ambiguous = entry.state === 'ambiguous';
                      return (
                        <option key={entry.componentId} value={entry.componentId} disabled={ambiguous}>
                          {label} · {entry.source === 'direct' ? 'directo' : 'estructura'}
                          {ambiguous ? ` — ambiguo (${entry.entryCount} entradas)` : ''}
                        </option>
                      );
                    })}
                  </select>
                  {editing.form.bindingComponentId !== '' ? (
                    <span className="catalog-form__hint" data-testid="parameter-binding-state">
                      {(() => {
                        const selected = editingEntries.find(
                          (entry) => entry.componentId === editing.form.bindingComponentId,
                        );
                        if (selected === undefined) {
                          return 'El componente no está en la composición del mueble: agregalo en Componentes o elegí otro.';
                        }
                        if (selected.state === 'ambiguous') {
                          return `Ambiguo: hay ${selected.entryCount} entradas de este componente en la composición. Desambiguá en Componentes antes de vincular.`;
                        }
                        return 'Objetivo único y directo: el servidor lo acepta.';
                      })()}
                    </span>
                  ) : null}
                  {editingEntries.length === 0 ? (
                    <span className="catalog-form__hint" data-testid="parameter-binding-empty">
                      El mueble no tiene componentes en su composición: agregá alguno en la
                      pestaña Componentes para poder vincular.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </fieldset>
          ) : null}

          <div className="module-parameters__editor-actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canMutate}
              onClick={saveForm}
              data-testid="parameter-save"
            >
              Listo
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditing(null);
                setFormError(null);
              }}
              data-testid="parameter-cancel"
            >
              Cancelar
            </button>
          </div>
        </section>
      ) : null}

      {onPreviewAuthoring ? (
        <section
          className="catalog-form__section module-parameters__preview"
          data-testid="parameter-preview"
        >
          <h4>Probar resolución</h4>
          <p className="catalog-form__hint">
            Resuelve el borrador actual con valores de muestra en el servidor: el
            resultado es autoritativo (componentes, preflight y problemas
            estructurados); el navegador nunca calcula consecuencias de
            fabricación.
          </p>
          {!savedModuleId ? (
            <p className="catalog-form__hint" data-testid="parameter-preview-guard">
              Guardá el mueble primero: el preview resuelve contra la composición
              guardada.
            </p>
          ) : null}
          {definitions.map((parameter) => {
            const value =
              sampleValues[parameter.name] ??
              (parameter.defaultValue === undefined
                ? ''
                : parameter.type === 'boolean'
                  ? parameter.defaultValue
                    ? 'true'
                    : 'false'
                  : String(parameter.defaultValue));
            const setValue = (next: string): void =>
              setSampleValues((prev) => ({ ...prev, [parameter.name]: next }));
            return (
              <div className="catalog-form__field" key={parameter.name}>
                <label htmlFor={`parameter-sample-${parameter.name}`}>
                  {parameter.label} <code>{parameter.name}</code>
                </label>
                {parameter.type === 'boolean' ? (
                  <select
                    id={`parameter-sample-${parameter.name}`}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={!canMutate}
                    data-testid={`parameter-sample-${parameter.name}`}
                  >
                    <option value="">Sin valor</option>
                    <option value="true">Verdadero</option>
                    <option value="false">Falso</option>
                  </select>
                ) : parameter.type === 'enum' ? (
                  <select
                    id={`parameter-sample-${parameter.name}`}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={!canMutate}
                    data-testid={`parameter-sample-${parameter.name}`}
                  >
                    <option value="">Sin valor</option>
                    {(parameter.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`parameter-sample-${parameter.name}`}
                    type={parameter.type === 'number' ? 'number' : 'text'}
                    value={value}
                    maxLength={parameter.maxLength}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={!canMutate}
                    data-testid={`parameter-sample-${parameter.name}`}
                  />
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canMutate || !savedModuleId || previewState.kind === 'running'}
            onClick={() => {
              if (!onPreviewAuthoring || !savedModuleId) return;
              const parameters: Record<string, unknown> = {};
              for (const parameter of definitions) {
                const raw = sampleValues[parameter.name];
                const value = raw ?? (
                  parameter.defaultValue === undefined
                    ? ''
                    : parameter.type === 'boolean'
                      ? parameter.defaultValue
                        ? 'true'
                        : 'false'
                      : String(parameter.defaultValue)
                );
                // An explicitly cleared string sample travels as "" (the
                // contract preserves empty strings); only non-string empties
                // mean "sin valor" and stay unsent.
                if (value === '' && parameter.type !== 'string') continue;
                if (parameter.type === 'boolean') {
                  parameters[parameter.name] = value === 'true';
                } else if (parameter.type === 'number') {
                  const parsed = Number(value);
                  if (Number.isFinite(parsed)) parameters[parameter.name] = parsed;
                } else {
                  parameters[parameter.name] = value;
                }
              }
              setPreviewState({ kind: 'running' });
              void onPreviewAuthoring({
                moduleId: savedModuleId,
                parameterDefinitions: definitions,
                parameters,
              })
                .then((response) => setPreviewState({ kind: 'done', response }))
                .catch((err: unknown) =>
                  setPreviewState({
                    kind: 'error',
                    message: err instanceof Error ? err.message : 'Error de conexión al previsualizar.',
                  }),
                );
            }}
            data-testid="parameter-preview-run"
          >
            Probar resolución
          </button>
          {previewState.kind === 'running' ? (
            <InlineLoading label="Resolviendo en el servidor…" />
          ) : null}
          {previewState.kind === 'error' ? (
            <p className="catalog-form__error" role="alert" data-testid="parameter-preview-error">
              {previewState.message}
            </p>
          ) : null}
          {previewState.kind === 'done' && previewState.response.status === 'rejected' ? (
            <div data-testid="parameter-preview-rejected">
              <p className="catalog-form__error" role="alert">
                Resolución rechazada:
              </p>
              <ul>
                {previewState.response.issues.map((issue: ContractIssue, index: number) => (
                  <li key={`${issue.code}-${index}`}>{describePreviewIssue(issue)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {previewState.kind === 'done' && previewState.response.status === 'accepted' ? (
            <div data-testid="parameter-preview-accepted">
              <p>
                <strong>Resolución aceptada.</strong> Hash{' '}
                <code>{previewState.response.definitionHash.slice(0, 19)}…</code> · revisión{' '}
                <code>{previewState.response.catalogRevision.slice(0, 17)}…</code>
              </p>
              <p>
                {previewState.response.resolved.layout.components.length} piezas ·{' '}
                {previewState.response.resolved.layout.hardware.length} herrajes visibles ·
                preflight:{' '}
                {previewState.response.resolved.preflight.status === 'clear'
                  ? 'sin bloqueos'
                  : 'bloqueado'}
              </p>
              {previewState.response.resolved.preflight.issues.length > 0 ? (
                <ul data-testid="parameter-preview-preflight">
                  {previewState.response.resolved.preflight.issues.map(
                    (issue: ContractIssue, index: number) => (
                      <li key={`${issue.code}-${index}`}>{describePreviewIssue(issue)}</li>
                    ),
                  )}
                </ul>
              ) : null}
              <p className="catalog-form__hint">
                Render 3D del borrador: sigue el resultado del servidor; este panel no
                calcula geometría.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        title={`Quitar ${confirmRemove?.parameter.label ?? 'parámetro'}`}
        message={
          'Quitar el parámetro cambia la definición del mueble: al guardar, el hash de la definición y la revisión del catálogo avanzan, y la vinculación semántica se elimina con él. Los muebles ya instanciados conservan su versión fijada; SketchUp resuelve contra la revisión nueva al refrescar. Los presets del mueble sólo llevan medidas: ningún preset usa este parámetro.'
        }
        onConfirm={() => {
          if (confirmRemove) removeParameter(confirmRemove.position);
          setConfirmRemove(null);
        }}
      />
    </div>
  );
}

const PREVIEW_ISSUE_LABELS: Record<string, string> = {
  PARAMETER_REQUIRED: 'Completá el parámetro requerido',
  PARAMETER_TYPE_INVALID: 'El parámetro tiene un tipo de valor incorrecto',
  PARAMETER_OUT_OF_RANGE: 'El parámetro está fuera del rango permitido',
  PARAMETER_STEP_INVALID: 'El parámetro no coincide con el incremento permitido',
  PARAMETER_ENUM_INVALID: 'Elegí una opción permitida',
  PARAMETER_STRING_TOO_LONG: 'El texto supera la longitud permitida',
  PARAMETER_UNKNOWN: 'La definición no reconoce el parámetro',
  PARAMETER_DEFINITION_INVALID: 'La definición paramétrica es inválida',
  PARAMETER_BINDING_CONFLICT: 'La definición tiene consumidores paramétricos en conflicto',
  CATALOG_REVISION_STALE: 'El catálogo cambió: probá de nuevo',
  RESOLVE_GEOMETRY_INVALID: 'La geometría no resuelve con estos valores',
  MATERIAL_CHOICE_INVALID: 'La elección de material no es válida',
};

function describePreviewIssue(issue: ContractIssue): string {
  const label = PREVIEW_ISSUE_LABELS[issue.code] ?? issue.message ?? issue.code;
  const parameter =
    (issue.details as { parameter?: string } | undefined)?.parameter ??
    (issue.path?.split('.').at(-1) ?? '');
  return parameter && issue.code.startsWith('PARAMETER_') ? `${label}: ${parameter}` : label;
}
