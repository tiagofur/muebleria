/**
 * "Nueva cintilla" quick-create modal opened from the material form (F027).
 * Creates an EdgeBand and links it as the material's default edge by id.
 */

import { type ReactNode, useState } from 'react';
import type { EdgeBand } from '@granete/domain';
import { Modal } from '../../common';
import {
  validateNonNegativeNumber,
  validateRequiredName,
  validateUniqueCode,
} from '../catalogHelpers';
import type { EdgeDraft } from '../EdgesCatalog';
import { emptyEdgeDraft } from './materialDraft';

export interface EdgeQuickCreateModalProps {
  readonly open: boolean;
  /** Prefill derived from the material draft (code without TAB- prefix). */
  readonly prefill: { readonly code: string; readonly name: string };
  readonly edges: readonly EdgeBand[];
  readonly onClose: () => void;
  /** Creates the edge band and returns its new id. */
  readonly onCreateEdge: (draft: EdgeDraft) => string;
  /** Called with the new edge id so the parent links it as default. */
  readonly onCreated: (newEdgeId: string) => void;
}

export function EdgeQuickCreateModal({
  open,
  prefill,
  edges,
  onClose,
  onCreateEdge,
  onCreated,
}: EdgeQuickCreateModalProps): ReactNode {
  const [edgeDraft, setEdgeDraft] = useState<EdgeDraft>(emptyEdgeDraft);
  const [edgeError, setEdgeError] = useState<string | null>(null);

  // Prefill each time the modal opens (open transitions false→true).
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setEdgeDraft({
      code: prefill.code ? `CAN-${prefill.code.replace(/^TAB-?/i, '')}` : '',
      name: prefill.name || '',
      thicknessMm: 0.5,
      costPerMl: 0,
      notes: '',
      previewColor: '',
    });
    setEdgeError(null);
  } else if (!open && wasOpen) {
    setWasOpen(false);
    setEdgeDraft(emptyEdgeDraft());
    setEdgeError(null);
  }

  const submitCreateEdge = () => {
    const codeErr = validateUniqueCode(edgeDraft.code, edges);
    if (codeErr) {
      setEdgeError(codeErr);
      return;
    }
    const nameErr = validateRequiredName(edgeDraft.name);
    if (nameErr) {
      setEdgeError(nameErr);
      return;
    }
    const numErr =
      validateNonNegativeNumber(edgeDraft.thicknessMm, 'Espesor canto (mm)') ??
      validateNonNegativeNumber(edgeDraft.costPerMl, 'Costo / ML');
    if (numErr) {
      setEdgeError(numErr);
      return;
    }
    const newId = onCreateEdge(edgeDraft);
    onCreated(newId);
    setEdgeDraft(emptyEdgeDraft());
    setEdgeError(null);
  };

  return (
    /* Sibling modal (not nested inside the material form) */
    <Modal
      open={open}
      onClose={() => {
        onClose();
        setEdgeError(null);
      }}
      title="Nueva cintilla"
      size="sm"
      dataTestId="material-edge-create-modal"
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              onClose();
              setEdgeError(null);
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submitCreateEdge}
            data-testid="material-edge-create-submit"
          >
            Crear y vincular
          </button>
        </>
      }
    >
      {edgeError ? (
        <p className="catalog-form__error">{edgeError}</p>
      ) : null}
      <div className="catalog-form">
        <div className="catalog-form__field">
          <label htmlFor="mat-edge-code">Código canto</label>
          <input
            id="mat-edge-code"
            value={edgeDraft.code}
            onChange={(e) =>
              setEdgeDraft({ ...edgeDraft, code: e.target.value })
            }
            autoComplete="off"
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor="mat-edge-name">Nombre canto</label>
          <input
            id="mat-edge-name"
            value={edgeDraft.name}
            onChange={(e) =>
              setEdgeDraft({ ...edgeDraft, name: e.target.value })
            }
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor="mat-edge-thk">Espesor (mm)</label>
          <input
            id="mat-edge-thk"
            type="number"
            min={0}
            step="any"
            value={edgeDraft.thicknessMm}
            onChange={(e) =>
              setEdgeDraft({
                ...edgeDraft,
                thicknessMm: Number(e.target.value),
              })
            }
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor="mat-edge-cost">Costo / ML</label>
          <input
            id="mat-edge-cost"
            type="number"
            min={0}
            step="any"
            value={edgeDraft.costPerMl}
            onChange={(e) =>
              setEdgeDraft({
                ...edgeDraft,
                costPerMl: Number(e.target.value),
              })
            }
          />
        </div>
      </div>
    </Modal>
  );
}
