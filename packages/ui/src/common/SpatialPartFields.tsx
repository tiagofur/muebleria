/**
 * Dense spatial capture for board parts (S1) — face, slot, origin formulas.
 * Pure presentational; parent owns draft state.
 */

import {
  BOARD_FACES,
  PLACEMENT_SLOTS,
  boardFaceLabelEs,
  placementSlotLabelEs,
} from '@muebles/domain';

export type SpatialPartFieldValues = {
  face: string;
  placement: string;
  originXFormula: string;
  originYFormula: string;
  originZFormula: string;
  designThicknessMm: string;
};

type Props = {
  value: SpatialPartFieldValues;
  onChange: (patch: Partial<SpatialPartFieldValues>) => void;
  testIdPrefix?: string;
};

export function SpatialPartFields({
  value,
  onChange,
  testIdPrefix = 'spatial',
}: Props) {
  return (
    <div
      className="module-editor__grid module-editor__grid--spatial"
      data-testid={`${testIdPrefix}-fields`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(7.5rem, 1fr))',
        gap: '0.5rem',
        marginTop: '0.5rem',
      }}
    >
      <div className="catalog-form__field" style={{ marginBottom: 0 }}>
        <label className="text-small text-muted">Cara</label>
        <select
          className="input"
          value={value.face}
          onChange={(e) => onChange({ face: e.target.value })}
          data-testid={`${testIdPrefix}-face`}
        >
          <option value="">—</option>
          {BOARD_FACES.map((f) => (
            <option key={f} value={f}>
              {boardFaceLabelEs(f)}
            </option>
          ))}
        </select>
      </div>
      <div className="catalog-form__field" style={{ marginBottom: 0 }}>
        <label className="text-small text-muted">Posición</label>
        <select
          className="input"
          value={value.placement}
          onChange={(e) => onChange({ placement: e.target.value })}
          data-testid={`${testIdPrefix}-placement`}
        >
          <option value="">—</option>
          {PLACEMENT_SLOTS.map((s) => (
            <option key={s} value={s}>
              {placementSlotLabelEs(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="catalog-form__field" style={{ marginBottom: 0 }}>
        <label className="text-small text-muted">Origen X</label>
        <input
          className="input"
          value={value.originXFormula}
          onChange={(e) => onChange({ originXFormula: e.target.value })}
          placeholder="0 o W-T"
          data-testid={`${testIdPrefix}-ox`}
        />
      </div>
      <div className="catalog-form__field" style={{ marginBottom: 0 }}>
        <label className="text-small text-muted">Origen Y</label>
        <input
          className="input"
          value={value.originYFormula}
          onChange={(e) => onChange({ originYFormula: e.target.value })}
          placeholder="0 o H-T"
          data-testid={`${testIdPrefix}-oy`}
        />
      </div>
      <div className="catalog-form__field" style={{ marginBottom: 0 }}>
        <label className="text-small text-muted">Origen Z</label>
        <input
          className="input"
          value={value.originZFormula}
          onChange={(e) => onChange({ originZFormula: e.target.value })}
          placeholder="0 o D-T"
          data-testid={`${testIdPrefix}-oz`}
        />
      </div>
      <div className="catalog-form__field" style={{ marginBottom: 0 }}>
        <label className="text-small text-muted">Espesor diseño</label>
        <input
          className="input"
          type="number"
          min={0}
          value={value.designThicknessMm}
          onChange={(e) => onChange({ designThicknessMm: e.target.value })}
          placeholder="18"
          data-testid={`${testIdPrefix}-thickness`}
        />
      </div>
    </div>
  );
}
