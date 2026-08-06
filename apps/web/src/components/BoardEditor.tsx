/**
 * BoardEditor — compone BoardCanvas + BoardPropertiesPanel conectados
 * al editorStore (Fase 1 slice 1.3).
 *
 * Vive en apps/web porque necesita acceso al editorStore (5º store Zustand).
 * Recibe un Module + catálogo, resuelve el BOM, carga el scratch space del
 * editorStore, y renderiza el canvas + panel lado a lado.
 *
 * Slotted into the Module editor Components tab **below** the instance list
 * (hybrid chrome — list + “Agregar” always remain available).
 */

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Box } from 'lucide-react';
import type { Catalog, Module, ResolvedBoardPart } from '@muebles/domain';
import { resolveBom } from '@muebles/domain';
import {
  BoardCanvas,
  BoardPropertiesPanel,
  BoardCostSummary,
  Furniture3DViewer,
  boardPartsToVisuals,
  materialColorMap,
  moduleCompositionKey,
} from '@muebles/ui';
import {
  useEditorStore,
} from '../stores';
import { useBoardShortcuts } from './useBoardShortcuts';
import { deriveOverridesFromParts } from './deriveOverridesFromParts';
import './boardEditor.css';

export interface BoardEditorProps {
  readonly module: Module;
  readonly catalog: Catalog;
  readonly optionChoices?: Readonly<Record<string, string>>;
  readonly measurePresetId?: string;
  readonly moduleWidth?: number;
  readonly moduleHeight?: number;
  readonly moduleDepth?: number;
  /**
   * Optional composition fingerprint from the **draft** (without transient
   * boardOverrides). When omitted, derived from `module` via moduleCompositionKey.
   */
  readonly compositionKey?: string;
  /**
   * Gap #1: called whenever the user edits part poses/dimensions, with the
   * derived overrides keyed by componentId. The shell merges these into the
   * module draft so they persist on save.
   */
  readonly onOverridesChange?: (
    overrides: ReturnType<typeof deriveOverridesFromParts>,
  ) => void;
}

export function BoardEditor({
  module,
  catalog,
  optionChoices = {},
  measurePresetId,
  moduleWidth,
  moduleHeight,
  moduleDepth,
  compositionKey: compositionKeyProp,
  onOverridesChange,
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
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);

  // Gap #1: snapshot the originally-resolved parts so we can diff on change.
  const originalPartsRef = useRef<readonly ResolvedBoardPart[]>([]);
  // Always resolve the latest module when composition fingerprint changes
  // (without reloading on every boardOverrides / pose-only prop update).
  const moduleRef = useRef(module);
  moduleRef.current = module;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const optionChoicesRef = useRef(optionChoices);
  optionChoicesRef.current = optionChoices;

  const compositionKey = useMemo(
    () => compositionKeyProp ?? moduleCompositionKey(module),
    [compositionKeyProp, module],
  );

  // F074: keyboard shortcuts (d=duplicate, r=rotate, del=remove, v=toggle).
  useBoardShortcuts(true);

  // Material color lookup for 3D viewer.
  const materialColors = useMemo(
    () => materialColorMap(catalog.materials),
    [catalog.materials],
  );

  // Resolve BOM when id or composition (structure / components / dims) changes.
  useEffect(() => {
    const mod = moduleRef.current;
    try {
      const bom = resolveBom(
        mod,
        optionChoicesRef.current,
        catalogRef.current,
        measurePresetId,
      );
      originalPartsRef.current = bom.boardParts;
      loadModule(mod.id, bom.boardParts);
    } catch {
      // Resolution may fail if options are incomplete — load empty.
      originalPartsRef.current = [];
      loadModule(mod.id, []);
    }
    return () => {
      clearEditor();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module.id, compositionKey, measurePresetId]);

  // Gap #1: when parts change, derive overrides and notify the shell.
  useEffect(() => {
    if (!onOverridesChange) return;
    if (originalPartsRef.current.length === 0) return;
    const overrides = deriveOverridesFromParts(
      resolvedParts,
      originalPartsRef.current,
    );
    onOverridesChange(overrides);
  }, [resolvedParts, onOverridesChange]);

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
        <div className="board-editor__toolbar">
          <button
            type="button"
            className={viewMode === '2d-iso' ? 'btn btn--small btn--primary' : 'btn btn--small'}
            onClick={() => setViewMode('2d-iso')}
            data-testid="board-view-2d"
          >
            2D Iso
          </button>
          <button
            type="button"
            className={viewMode === '3d' ? 'btn btn--small btn--primary' : 'btn btn--small'}
            onClick={() => setViewMode('3d')}
            data-testid="board-view-3d"
          >
            <Box size={14} strokeWidth={1.5} aria-hidden />
            3D
          </button>
        </div>
        {viewMode === '3d' ? (
          <Furniture3DViewer
            parts={resolvedParts}
            width={moduleWidth ?? 600}
            height={moduleHeight ?? 720}
            depth={moduleDepth ?? 580}
            materialColors={materialColors}
            className="board-editor__3d"
            /* BoardEditor already has canvas selection + properties panel. */
            showPartInspector={false}
          />
        ) : (
          <BoardCanvas
            parts={visuals}
            selectedPartId={selectedPartId}
            onSelectPart={selectPart}
            onDragPart={(id, pose) => updatePartPose(id, pose)}
            moduleWidth={moduleWidth}
            moduleHeight={moduleHeight}
            moduleDepth={moduleDepth}
          />
        )}
        <BoardCostSummary parts={resolvedParts} catalog={catalog} />
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
