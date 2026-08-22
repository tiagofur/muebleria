/**
 * F143 — barra de acciones contextual de la selección del studio de Proyectar.
 * Existe sólo cuando hay selección (anti-scope North Star §27: nada de
 * toolbars CAD permanentes). Los comandos son intenciones de dominio que el
 * studio ejecuta; la barra declara capacidades y explica los bloqueos.
 */

import { type ReactNode } from 'react';
import {
  AlignCenterVertical,
  ChevronLeft,
  ChevronRight,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Crosshair,
  Focus,
  ListX,
} from 'lucide-react';

export type StudioSelectionBarProps = {
  readonly count: number;
  readonly canEdit: boolean;
  readonly hasClipboard: boolean;
  /** Todos los seleccionados están anclados a un mismo muro. */
  readonly allOnWall: boolean;
  /** Todos los seleccionados son islas (posiciones libres). */
  readonly allIslands: boolean;
  readonly wallName: string | null;
  /** La selección primaria está anclada a muro (referencia de "pegar a…"). */
  readonly primaryPlacedOnWall: boolean;
  /** Feedback del último comando (errores que enseñan). */
  readonly status: string | null;
  readonly onDuplicate: () => void;
  readonly onCopy: () => void;
  readonly onPaste: () => void;
  readonly onPasteRelative: (side: 'left' | 'right' | 'corner') => void;
  readonly onCompact: () => void;
  readonly onDistribute: (axis: 'wall' | 'x' | 'y') => void;
  readonly onAlignIslands: (
    mode: 'left' | 'right' | 'centers-x' | 'front' | 'back' | 'centers-y',
  ) => void;
  readonly onCenter: () => void;
  readonly onRemoveFromPlan: () => void;
  /** F144 — encuadrar la cámara en la selección (acción de vista). */
  readonly onFitSelection: () => void;
};

export function StudioSelectionBar({
  count,
  canEdit,
  hasClipboard,
  allOnWall,
  allIslands,
  wallName,
  primaryPlacedOnWall,
  status,
  onDuplicate,
  onCopy,
  onPaste,
  onPasteRelative,
  onCompact,
  onDistribute,
  onAlignIslands,
  onCenter,
  onRemoveFromPlan,
  onFitSelection,
}: StudioSelectionBarProps): ReactNode {
  if (count === 0) return null;
  const readOnlyTitle = canEdit ? undefined : 'Modo lectura: la obra no se puede editar.';
  const alignBlockedTitle = 'Funcionan sobre muebles de un mismo muro.';

  return (
    <div
      className="spatial-studio__selection-bar"
      role="toolbar"
      aria-label={`Acciones de la selección (${count} muebles)`}
      data-testid="spatial-studio-selection-bar"
    >
      <span
        className="spatial-studio__selection-bar-count"
        data-testid="spatial-studio-selection-count"
      >
        {count} seleccionado{count === 1 ? '' : 's'}
      </span>

      <div className="spatial-studio__selection-bar-group" role="group" aria-label="Vista">
        <button
          type="button"
          className="btn btn--small"
          onClick={onFitSelection}
          title="Enfocar la selección en la cámara (F)"
          data-testid="spatial-studio-cmd-fit"
        >
          <Focus size={14} strokeWidth={1.5} aria-hidden /> Enfocar
        </button>
      </div>

      <div className="spatial-studio__selection-bar-group" role="group" aria-label="Portapapeles">
        <button
          type="button"
          className="btn btn--small"
          onClick={onDuplicate}
          disabled={!canEdit}
          title={readOnlyTitle ?? 'Duplicar la selección a la derecha (Ctrl+D)'}
          data-testid="spatial-studio-cmd-duplicate"
        >
          <Copy size={14} strokeWidth={1.5} aria-hidden /> Duplicar
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={onCopy}
          title="Copiar la selección (Ctrl+C)"
          data-testid="spatial-studio-cmd-copy"
        >
          <ClipboardCopy size={14} strokeWidth={1.5} aria-hidden /> Copiar
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={onPaste}
          disabled={!canEdit || !hasClipboard}
          title={
            !hasClipboard
              ? 'Copiá muebles primero (Ctrl+C).'
              : (readOnlyTitle ?? 'Pegar copias a la derecha del último pegado (Ctrl+V)')
          }
          data-testid="spatial-studio-cmd-paste"
        >
          <ClipboardPaste size={14} strokeWidth={1.5} aria-hidden /> Pegar
        </button>
      </div>

      {allIslands ? (
        <div className="spatial-studio__selection-bar-group" role="group" aria-label="Alinear islas">
          <button
            type="button"
            className="btn btn--small btn--icon"
            onClick={() => onAlignIslands('left')}
            disabled={!canEdit || count < 2}
            title={
              count < 2 ? 'Alinear necesita al menos 2 islas.' : 'Alinear bordes izquierdos'
            }
            data-testid="spatial-studio-cmd-align-left"
            aria-label="Alinear bordes izquierdos"
          >
            <AlignStartVertical size={14} strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn--small btn--icon"
            onClick={() => onAlignIslands('right')}
            disabled={!canEdit || count < 2}
            title={count < 2 ? 'Alinear necesita al menos 2 islas.' : 'Alinear bordes derechos'}
            data-testid="spatial-studio-cmd-align-right"
            aria-label="Alinear bordes derechos"
          >
            <AlignEndVertical size={14} strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn--small btn--icon"
            onClick={() => onAlignIslands('centers-x')}
            disabled={!canEdit || count < 2}
            title={count < 2 ? 'Alinear necesita al menos 2 islas.' : 'Alinear centros en X'}
            data-testid="spatial-studio-cmd-align-centers"
            aria-label="Alinear centros"
          >
            <AlignCenterVertical size={14} strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn--small btn--icon"
            onClick={() => onDistribute('x')}
            disabled={!canEdit || count < 3}
            title={count < 3 ? 'Distribuir necesita al menos 3 islas.' : 'Distribuir en X'}
            data-testid="spatial-studio-cmd-distribute-x"
            aria-label="Distribuir en X"
          >
            <AlignHorizontalDistributeCenter size={14} strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn--small btn--icon"
            onClick={() => onDistribute('y')}
            disabled={!canEdit || count < 3}
            title={count < 3 ? 'Distribuir necesita al menos 3 islas.' : 'Distribuir en Y'}
            data-testid="spatial-studio-cmd-distribute-y"
            aria-label="Distribuir en Y"
          >
            <AlignVerticalDistributeCenter size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      ) : (
        <div className="spatial-studio__selection-bar-group" role="group" aria-label="Organizar en muro">
          <button
            type="button"
            className="btn btn--small"
            onClick={onCompact}
            disabled={!canEdit || !allOnWall || count < 2}
            title={
              !allOnWall
                ? alignBlockedTitle
                : count < 2
                  ? 'Alinear necesita al menos 2 muebles.'
                  : `Compactar la corrida con separación de 20 mm${
                      wallName ? ` en ${wallName}` : ''
                    }`
            }
            data-testid="spatial-studio-cmd-compact"
          >
            <AlignHorizontalJustifyCenter size={14} strokeWidth={1.5} aria-hidden /> Alinear
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => onDistribute('wall')}
            disabled={!canEdit || !allOnWall || count < 3}
            title={
              !allOnWall
                ? alignBlockedTitle
                : count < 3
                  ? 'Distribuir necesita al menos 3 muebles.'
                  : 'Distribuir equidistante en el tramo'
            }
            data-testid="spatial-studio-cmd-distribute"
          >
            <AlignHorizontalDistributeCenter size={14} strokeWidth={1.5} aria-hidden />{' '}
            Distribuir
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={onCenter}
            disabled={!canEdit || !allOnWall}
            title={
              !allOnWall ? alignBlockedTitle : `Centrar${count === 1 ? '' : ' el grupo'} en ${wallName ?? 'el muro'}`
            }
            data-testid="spatial-studio-cmd-center"
          >
            <Crosshair size={14} strokeWidth={1.5} aria-hidden /> Centrar
          </button>
        </div>
      )}

      {hasClipboard ? (
        <div className="spatial-studio__selection-bar-group" role="group" aria-label="Pegar con referencia">
          <button
            type="button"
            className="btn btn--small btn--icon"
            onClick={() => onPasteRelative('left')}
            disabled={!canEdit || !primaryPlacedOnWall}
            title={
              !primaryPlacedOnWall
                ? 'Necesitás un mueble de muro como referencia (el primero seleccionado).'
                : 'Pegar una copia pegada a la izquierda de la referencia'
            }
            data-testid="spatial-studio-cmd-paste-left"
            aria-label="Pegar a la izquierda"
          >
            <ChevronLeft size={14} strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn--small btn--icon"
            onClick={() => onPasteRelative('right')}
            disabled={!canEdit || !primaryPlacedOnWall}
            title={
              !primaryPlacedOnWall
                ? 'Necesitás un mueble de muro como referencia (el primero seleccionado).'
                : 'Pegar una copia pegada a la derecha de la referencia'
            }
            data-testid="spatial-studio-cmd-paste-right"
            aria-label="Pegar a la derecha"
          >
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => onPasteRelative('corner')}
            disabled={!canEdit || !primaryPlacedOnWall}
            title={
              !primaryPlacedOnWall
                ? 'Necesitás un mueble de muro como referencia (el primero seleccionado).'
                : 'Pegar una copia en la esquina del muro de la referencia'
            }
            data-testid="spatial-studio-cmd-paste-corner"
          >
            Esquina
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="btn btn--small"
        onClick={onRemoveFromPlan}
        disabled={!canEdit}
        title={
          readOnlyTitle ??
          'Quitar del plano (los muebles siguen en la cotización como sin colocar)'
        }
        data-testid="spatial-studio-cmd-remove-plan"
      >
        <ListX size={14} strokeWidth={1.5} aria-hidden /> Quitar del plano
      </button>

      {status ? (
        <span
          className="spatial-studio__selection-bar-status"
          role="status"
          data-testid="spatial-studio-cmd-status"
        >
          {status}
        </span>
      ) : null}
    </div>
  );
}
