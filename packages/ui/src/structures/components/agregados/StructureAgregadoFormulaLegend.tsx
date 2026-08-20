/**
 * Collapsible formula guide for Agregados variables (W, H, D, B).
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function StructureAgregadoFormulaLegend(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="structure-editor__formula-legend"
      data-testid="formula-legend"
    >
      <button
        type="button"
        className="structure-editor__formula-legend-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Variables de fórmulas (W, H, D, B)</span>
      </button>
      {open ? (
        <div className="structure-editor__formula-legend-body">
          <p>
            Podés usar números exactos en milímetros (ej. <code>500</code>) o
            fórmulas paramétricas con estas variables:
          </p>
          <ul>
            <li><code>W</code> = Ancho exterior del mueble / estructura.</li>
            <li><code>H</code> = Alto exterior del mueble / estructura.</li>
            <li><code>D</code> = Profundidad exterior del mueble.</li>
            <li><code>B</code> = Alto de zoclo / patas (mm).</li>
          </ul>
          <p className="structure-editor__formula-legend-example">
            Ejemplos: <code>W - 36</code> (para puertas con laterales de 18mm),{' '}
            <code>H - B - 36</code> (alto util sobre zoclo), <code>B + 18</code>{' '}
            (elevación X/Z).
          </p>
        </div>
      ) : null}
    </div>
  );
}
