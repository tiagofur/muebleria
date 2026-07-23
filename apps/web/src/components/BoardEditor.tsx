/**
 * BoardEditor — compone BoardCanvas + BoardPropertiesPanel conectados
 * al editorStore (Fase 1 slice 1.3).
 *
 * Vive en apps/web porque necesita acceso al editorStore (5º store Zustand).
 * Recibe un Module + catálogo, resuelve el BOM, carga el scratch space del
 * editorStore, y renderiza el canvas + panel lado a lado.
 *
 * Este es el componente que reemplazará al tab "Components" del ModuleEditorForm
 * en el slice 1.5.
 */

import { useEffect, useMemo, type ReactNode } from 'react';
import type { Catalog, Module } from '@muebles/domain';
import { resolveBom } from '@muebles/domain';
import {
  BoardCanvas,
  BoardPropertiesPanel,
  boardPartsToVisuals,
} from '@muebles/ui';
import {
  useEditorStore,
} from '../stores';
import './boardEditor.css';

export interface BoardEditorProps {
  readonly module: Module;
  readonly catalog: Catalog;
  readonly optionChoices?: Readonly<Record<string, string>>;
  readonly measurePresetId?: string;
  readonly moduleWidth?: number;
  readonly moduleHeight?: number;
  readonly moduleDepth?: number;
}

export function BoardEditor({
  module,
  catalog,
  optionChoices = {},
  measurePresetId,
  moduleWidth,
  moduleHeight,
  moduleDepth,
}: BoardEditorProps): ReactNode {
  const resolvedParts = useEditorStore((s) => s.resolvedParts);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectPart = useEditorStore((s) => s.selectPart);
  const loadModule = useEditorStore((s) => s.loadModule);
  const clearEditor = useEditorStore((s) => s.clearEditor);
  const updatePartPose = useEditorStore((s) => s.updatePartPose);
  const updatePartDimensions = useEditorStore((s) => s.updatePartDimensions);
  const duplicatePart = useEditorStore((s) => s.duplicatePart);
  const removePart = useEditorStore((s) => s.removePart);

  // Resolve BOM on mount or when module/catalog/preset changes.
  useEffect(() => {
    try {
      const bom = resolveBom(module, optionChoices, catalog, measurePresetId);
      loadModule(module.id, bom.boardParts);
    } catch {
      // Resolution may fail if options are incomplete — load empty.
      loadModule(module.id, []);
    }
    return () => {
      clearEditor();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module.id, measurePresetId]);

  // Project resolved parts to BoardPartVisual[] for the canvas.
  const visuals = useMemo(
    () => boardPartsToVisuals(resolvedParts, { colorMode: 'material' }),
    [resolvedParts],
  );

  // Find the selected visual for the properties panel.
  const selectedVisual = useMemo(
    () => visuals.find((v) => v.id === selectedPartId) ?? null,
    [visuals, selectedPartId],
  );

  return (
    <div className="board-editor" data-testid="board-editor">
      <div className="board-editor__canvas">
        <BoardCanvas
          parts={visuals}
          selectedPartId={selectedPartId}
          onSelectPart={selectPart}
          onDragPart={(id, pose) => updatePartPose(id, pose)}
          moduleWidth={moduleWidth}
          moduleHeight={moduleHeight}
          moduleDepth={moduleDepth}
        />
      </div>
      <BoardPropertiesPanel
        part={selectedVisual}
        onClose={() => selectPart(null)}
        onUpdatePose={(pose) => {
          if (selectedPartId) updatePartPose(selectedPartId, pose);
        }}
        onUpdateDimensions={(dims) => {
          if (selectedPartId) updatePartDimensions(selectedPartId, dims);
        }}
        onDuplicate={() => {
          if (selectedPartId) duplicatePart(selectedPartId);
        }}
        onRemove={() => {
          if (selectedPartId) removePart(selectedPartId);
        }}
      />
    </div>
  );
}
