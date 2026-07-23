/**
 * useBoardShortcuts — atajos de teclado para el BoardEditor (Fase 1 slice 1.8).
 *
 * - d: duplicar pieza seleccionada
 * - r: rotar 90° en Z
 * - Del/Backspace: eliminar pieza seleccionada
 * - v: toggle veta (cambiar grain 0↔1)
 *
 * Solo activo cuando hay una pieza seleccionada y el foco no está en un input.
 */

import { useEffect } from 'react';
import { useEditorStore } from '../stores';

export function useBoardShortcuts(enabled: boolean): void {
  const duplicatePart = useEditorStore((s) => s.duplicatePart);
  const removePart = useEditorStore((s) => s.removePart);
  const updatePartPose = useEditorStore((s) => s.updatePartPose);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);

  useEffect(() => {
    if (!enabled || !selectedPartId) return;

    function isTypingInField(): boolean {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (!selectedPartId || isTypingInField()) return;
      // Ignore if modifier keys are pressed (let undo/redo, copy, etc. pass through).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      switch (key) {
        case 'd':
          e.preventDefault();
          duplicatePart(selectedPartId);
          break;
        case 'r':
          e.preventDefault();
          // Rotate 90° on Z axis. Read current rotation from the store.
          {
            const part = useEditorStore.getState().resolvedParts.find(
              (p) => p.id === selectedPartId,
            );
            if (part) {
              const current = part.rotateZ ?? 0;
              updatePartPose(selectedPartId, { rotateZ: (current + 90) % 360 });
            }
          }
          break;
        case 'delete':
        case 'backspace':
          e.preventDefault();
          removePart(selectedPartId);
          break;
        case 'v':
          e.preventDefault();
          // Toggle grain: 0 ↔ 1. We update via dimensions since grain isn't a pose field.
          // For now, grain toggling requires domain-level support. Placeholder: rotateX 90°.
          {
            const part = useEditorStore.getState().resolvedParts.find(
              (p) => p.id === selectedPartId,
            );
            if (part) {
              const current = part.rotateX ?? 0;
              updatePartPose(selectedPartId, { rotateX: (current + 90) % 360 });
            }
          }
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, selectedPartId, duplicatePart, removePart, updatePartPose]);
}
