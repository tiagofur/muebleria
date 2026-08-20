/**
 * Panel for managing Sub-assemblies (Agregados) in StructureEditorForm and
 * ModuleEditorForm. Generic over T so it works for both StructureDraft and
 * ModuleDraft.
 */

import {
  useState,
  useCallback,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { Agregado, Hardware, ModuleAgregadoInstance, OptionGroup } from '@muebles/domain';
import { StructureAgregadoCard } from './agregados/StructureAgregadoCard';
import { StructureAgregadoFormulaLegend } from './agregados/StructureAgregadoFormulaLegend';
import { getOptionRolesForAgregado } from './agregados/agregadoRoleHelpers';

export { getOptionRolesForAgregado };

export interface StructureEditorAgregadosPanelProps<
  T extends { agregados?: ModuleAgregadoInstance[] },
> {
  readonly draft: T;
  readonly setDraft: Dispatch<SetStateAction<T>>;
  readonly catalogAgregados: readonly Agregado[];
  readonly catalogHardware?: readonly Hardware[];
  readonly optionGroups?: readonly OptionGroup[];
  readonly hidden?: boolean;
  readonly idPrefix?: string;
}

export function StructureEditorAgregadosPanel<
  T extends { agregados?: ModuleAgregadoInstance[] },
>({
  draft,
  setDraft,
  catalogAgregados,
  catalogHardware = [],
  optionGroups = [],
  hidden = false,
  idPrefix = 'structure-editor',
}: StructureEditorAgregadosPanelProps<T>): ReactNode {
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>('');
  const [pendingRemove, setPendingRemove] = useState<{
    index: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

  const clearPending = useCallback(() => {
    if (pendingRemove) {
      clearTimeout(pendingRemove.timer);
      setPendingRemove(null);
    }
  }, [pendingRemove]);

  const toggleExpand = (key: string, defaultOpen: boolean) => {
    setExpandedMap((prev) => {
      const isCurrentlyExpanded =
        prev[key] !== undefined ? prev[key] : defaultOpen;
      return {
        ...prev,
        [key]: !isCurrentlyExpanded,
      };
    });
  };

  const handleExpandAll = () => {
    const next: Record<string, boolean> = {};
    (draft.agregados ?? []).forEach((inst, i) => {
      const key = inst.id || `agr-${i}`;
      next[key] = true;
    });
    setExpandedMap(next);
  };

  const handleCollapseAll = () => {
    const next: Record<string, boolean> = {};
    (draft.agregados ?? []).forEach((inst, i) => {
      const key = inst.id || `agr-${i}`;
      next[key] = false;
    });
    setExpandedMap(next);
  };

  const handleAddAgregado = () => {
    if (!selectedCatalogId) return;

    const template = catalogAgregados.find((a) => a.id === selectedCatalogId);
    const newId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });

    const newInst: ModuleAgregadoInstance = {
      id: newId,
      agregadoId: selectedCatalogId,
      name: template?.name ?? '',
      quantity: 1,
      layoutDirection: 'none',
      gapMm: 0,
      mirrored: false,
      position: {
        xFormula: '',
        yFormula: '',
        zFormula: '',
      },
      dimensions: {
        widthFormula: '',
        heightFormula: '',
        depthFormula: '',
      },
    };

    setDraft((prev) => ({
      ...prev,
      agregados: [...(prev.agregados ?? []), newInst],
    }));

    // Auto-expand newly added agregado
    setExpandedMap((prev) => ({ ...prev, [newId]: true }));
  };

  const handleRemoveAgregado = (index: number) => {
    if (pendingRemove?.index === index) {
      clearTimeout(pendingRemove.timer);
      setPendingRemove(null);
      setDraft((prev) => ({
        ...prev,
        agregados: (prev.agregados ?? []).filter((_, i) => i !== index),
      }));
      return;
    }
    clearPending();
    const timer = setTimeout(() => setPendingRemove(null), 3500);
    setPendingRemove({ index, timer });
  };

  const handleUpdateAgregado = (
    index: number,
    patch: Partial<ModuleAgregadoInstance>,
  ) => {
    setDraft((prev) => ({
      ...prev,
      agregados: (prev.agregados ?? []).map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  };

  const agregadosCount = (draft.agregados ?? []).length;
  const panelId = `${idPrefix}-panel-agregados`;
  const tabId = `${idPrefix}-tab-agregados`;

  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      hidden={hidden}
      className="structure-editor__panel structure-editor__agregados-panel"
      data-testid="structure-editor-agregados-panel"
    >
      <div className="structure-editor__panel-header">
        <div>
          <h3 className="structure-editor__panel-title">Agregados</h3>
          <p className="structure-editor__panel-subtitle">
            Puertas, cajones o módulos internos incorporados a esta pieza, con
            posicionamiento 3D (X, Y, Z) y dimensiones del hueco (W, H, D).
          </p>
        </div>
      </div>

      {catalogAgregados.length === 0 ? (
        <p className="catalog-form__hint" data-testid="agregados-catalog-empty">
          No hay agregados en el catálogo. Creá uno en{' '}
          <strong>Ingeniería → Agregados</strong>.
        </p>
      ) : (
        <div className="structure-editor__agregado-add-bar">
          <select
            className="catalog-form__input"
            value={selectedCatalogId}
            onChange={(e) => setSelectedCatalogId(e.target.value)}
            data-testid="structure-agregado-select"
          >
            <option value="" disabled>
              Elegir agregado del catálogo…
            </option>
            {catalogAgregados.map((a) => (
              <option key={a.id} value={a.id}>
                [{a.code}] {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleAddAgregado}
            disabled={!selectedCatalogId}
            data-testid="structure-add-agregado-btn"
          >
            + Agregar
          </button>
        </div>
      )}

      {agregadosCount > 0 ? <StructureAgregadoFormulaLegend /> : null}

      {agregadosCount > 1 ? (
        <div
          className="structure-editor__agregados-toolbar"
          data-testid="structure-agregados-toolbar"
        >
          <span className="structure-editor__agregados-count">
            {agregadosCount} {agregadosCount === 1 ? 'agregado' : 'agregados'}
          </span>
          <div className="structure-editor__agregados-actions">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={handleExpandAll}
              data-testid="structure-agregados-expand-all"
            >
              Expandir todos
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={handleCollapseAll}
              data-testid="structure-agregados-collapse-all"
            >
              Colapsar todos
            </button>
          </div>
        </div>
      ) : null}

      {agregadosCount === 0 ? (
        <div className="catalog-form__empty" data-testid="structure-agregados-empty">
          No hay agregados añadidos todavía.
        </div>
      ) : (
        <div className="structure-editor__agregados-list">
          {(draft.agregados ?? []).map((inst, idx) => {
            const isPendingRemove = pendingRemove?.index === idx;
            const itemKey = inst.id || `agr-${idx}`;
            const defaultOpen = agregadosCount === 1;
            const isOpen =
              expandedMap[itemKey] !== undefined
                ? expandedMap[itemKey]
                : defaultOpen;

            return (
              <StructureAgregadoCard
                key={itemKey}
                idx={idx}
                inst={inst}
                catalogAgregados={catalogAgregados}
                catalogHardware={catalogHardware}
                optionGroups={optionGroups}
                isOpen={isOpen}
                defaultOpen={defaultOpen}
                isPendingRemove={isPendingRemove}
                onToggleExpand={toggleExpand}
                onRemove={handleRemoveAgregado}
                onUpdate={handleUpdateAgregado}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
