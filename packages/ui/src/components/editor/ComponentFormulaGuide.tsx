/**
 * Collapsible formula guide for Component geometry variables.
 */

import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';

export interface ComponentFormulaGuideProps {
  readonly guideOpen: boolean;
  readonly onToggle: () => void;
}

export function ComponentFormulaGuide({
  guideOpen,
  onToggle,
}: ComponentFormulaGuideProps): ReactNode {
  return (
    <div
      className="component-geometry__formula-guide"
      data-testid="formula-vars-guide"
    >
      <button
        type="button"
        className="component-geometry__formula-guide-toggle"
        aria-expanded={guideOpen}
        data-testid="formula-guide-toggle"
        onClick={onToggle}
      >
        {guideOpen ? (
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
        ) : (
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
        )}
        <Lightbulb size={14} strokeWidth={1.5} aria-hidden />
        <span className="component-geometry__formula-guide-title">
          Variables de fórmulas
        </span>
        <span className="component-geometry__formula-guide-summary">
          PW · PH · PD · T · i · IW
        </span>
      </button>
      {guideOpen ? (
        <div
          className="component-geometry__formula-guide-body"
          data-testid="formula-guide-body"
        >
          <p className="component-geometry__formula-guide-lead">
            Matemática estándar: +, −, *, /, ().
          </p>
          <div className="component-geometry__formula-vars">
            <span title="Ancho total del contenedor/mueble">
              <code>PW</code>: Ancho Mueble
            </span>
            <span title="Alto total del contenedor/mueble">
              <code>PH</code>: Alto Mueble
            </span>
            <span title="Profundidad del contenedor/mueble">
              <code>PD</code>: Profundidad
            </span>
            <span title="Espesor del tablero">
              <code>T</code>: Espesor
            </span>
            <span title="Índice de la copia (0, 1, 2...)">
              <code>i</code>: Índice Copia
            </span>
            <span title="Ancho interior del mueble: PW menos el espesor de los dos laterales">
              <code>IW</code>: Ancho interior (PW−2·T)
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
