/**
 * Paso «Diseños 3D» del asistente de familia de cajón (#1633 s2b): un SKP
 * opcional por pieza — perfiles fijo/móvil de cada juego y cada inserto, por
 * lado. Va DESPUÉS de los insertos porque los insertos generan sus casillas.
 */

import type { MutableRefObject, ReactNode } from 'react';
import type { HardwareKitSystemPlan } from '@granete/domain';

export const kitDesignFileKey = (kitCode: string, hand: string, partCode: string): string =>
  `${kitCode}:${hand}:${partCode}`;
export const insertDesignFileKey = (accCode: string, anchor: string): string => `${accCode}:${anchor}`;

export const sideLabel = (hand: string): string =>
  hand === 'left' ? 'izq' : hand === 'right' ? 'der' : 'centro';

function FileSlot({
  fileKey,
  label,
  disabled,
  chosen,
  setFile,
  fileInputsRef,
}: {
  readonly fileKey: string;
  readonly label: string;
  readonly disabled: boolean;
  /** Review #1636 P2: el archivo elegido sigue visible al volver al paso. */
  readonly chosen: File | undefined;
  readonly setFile: (key: string, file: File | null) => void;
  readonly fileInputsRef: MutableRefObject<Record<string, HTMLInputElement | null>>;
}): ReactNode {
  const slotId = `system-file-${fileKey}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return (
    <div className="catalog-form__field">
      <label htmlFor={slotId}>{label}</label>
      {chosen ? (
        <span className="family-designs__chosen" data-testid={`hardware-system-wizard-chosen-${fileKey}`}>
          {chosen.name}
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => {
              setFile(fileKey, null);
              const input = fileInputsRef.current[fileKey];
              if (input) input.value = '';
            }}
            aria-label={`Quitar el archivo ${chosen.name} de ${label}`}
          >
            Quitar
          </button>
        </span>
      ) : null}
      <input
        id={slotId}
        type="file"
        accept=".skp,.glb"
        ref={(el) => {
          fileInputsRef.current[fileKey] = el;
        }}
        onChange={(e) => setFile(fileKey, e.target.files?.[0] ?? null)}
        disabled={disabled}
        data-testid={`hardware-system-wizard-file-${fileKey}`}
      />
    </div>
  );
}

export function FamilyDesignsStep({
  plan,
  files,
  setFile,
  fileInputsRef,
}: {
  readonly plan: HardwareKitSystemPlan | null;
  readonly files: Readonly<Record<string, File>>;
  readonly setFile: (key: string, file: File | null) => void;
  readonly fileInputsRef: MutableRefObject<Record<string, HTMLInputElement | null>>;
}): ReactNode {
  return (
    <div data-testid="hardware-system-wizard-designs">
      <p className="catalog-form__hint">
        Un archivo por pieza (.skp), todos opcionales. Las piezas sin diseño se ven con la
        representación genérica y podés subir el diseño después desde su ficha. Los costados
        nacen sin desfase (0 mm): si tu diseño no está dibujado en su posición final, ajustá el
        desfase de cada lado en la ficha de la pieza.
      </p>
      {!plan ? (
        <p className="catalog-form__hint">Completá los pasos anteriores para ver las piezas.</p>
      ) : null}
      {plan?.kits.map((kit) => (
        <fieldset className="catalog-form__section" key={kit.code}>
          <legend className="catalog-form__section-title">Juego {kit.heightCode}</legend>
          {kit.designs.map((design) =>
            (design.handsParts ?? []).map((part) => (
              <FileSlot
                key={kitDesignFileKey(kit.code, part.hand, design.code)}
                fileKey={kitDesignFileKey(kit.code, part.hand, design.code)}
                label={`${design.name.includes('—') ? design.name.split('—')[1]!.trim() : design.name} (${sideLabel(part.hand)})`}
                disabled={design.exists}
                chosen={files[kitDesignFileKey(kit.code, part.hand, design.code)]}
                setFile={setFile}
                fileInputsRef={fileInputsRef}
              />
            )),
          )}
          {plan.accessories
            .filter((acc) => acc.kitCode === kit.code)
            .map((acc) =>
              acc.anchors.map((anchor) => (
                <FileSlot
                  key={insertDesignFileKey(acc.code, anchor)}
                  fileKey={insertDesignFileKey(acc.code, anchor)}
                  label={`Inserto ${acc.name.includes('—') ? acc.name.split('—')[1]!.trim() : acc.name} (${sideLabel(anchor)})`}
                  disabled={acc.exists}
                  chosen={files[insertDesignFileKey(acc.code, anchor)]}
                  setFile={setFile}
                  fileInputsRef={fileInputsRef}
                />
              )),
            )}
        </fieldset>
      ))}
    </div>
  );
}
