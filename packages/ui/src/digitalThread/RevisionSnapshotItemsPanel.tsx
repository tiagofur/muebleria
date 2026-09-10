import type { DesignRevisionItem } from '@granete/storage';
import './revisionSnapshotItems.css';

const provenanceLabels = {
  authored: 'Elegido en diseño',
  quoted: 'Tomado de cotización',
  inherited_default: 'Heredado del módulo',
  unresolved: 'Sin resolver',
} as const;

function formatValue(value: unknown, unit?: string): string {
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (value == null) return '—';
  const rendered = typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
  return unit ? `${rendered} ${unit}` : rendered;
}

function TechnicalId({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <code>{value}</code>{' '}
        <button type="button" className="btn btn--ghost btn--small" aria-label={`Copiar ${label}`} onClick={() => void navigator.clipboard?.writeText(value)}>
          Copiar
        </button>
      </dd>
    </>
  );
}

export function RevisionSnapshotItemsPanel({ items }: { readonly items: ReadonlyArray<DesignRevisionItem> }) {
  if (items.length === 0) return <p className="pd-empty-hint">Esta revisión no contiene unidades físicas.</p>;

  return (
    <div className="revision-snapshot-list" data-testid="revision-items-list">
      {items.map((item) => {
        const snapshot = item.presentation_snapshot;
        return (
          <article className="revision-snapshot-item" key={item.id} data-testid={`revision-item-${item.id}`}>
            {item.descriptor_state === 'unavailable_legacy' || !snapshot ? (
              <div className="revision-snapshot-legacy" role="note">
                <strong>Descripción histórica no disponible</strong>
                <span>Esta revisión fue publicada antes de que Granete congelara nombres y materiales.</span>
              </div>
            ) : (
              <>
                <header className="revision-snapshot-item__header">
                  <div>
                    <h4>{snapshot.unit.label}</h4>
                    <p>{snapshot.definition.name || 'Definición no disponible'}</p>
                  </div>
                  {snapshot.definition.code && <span className="pd-code-pill">{snapshot.definition.code}</span>}
                </header>
                <dl className="revision-snapshot-fields"><div><dt>Ambiente</dt><dd>{snapshot.room.state === 'available' ? snapshot.room.label : 'Sin ambiente identificado'}</dd></div></dl>
                <section aria-label={`Parámetros de ${snapshot.unit.label}`}>
                  <h5>Medidas y parámetros</h5>
                  {snapshot.parameters.length === 0 ? <p className="text-muted">Sin parámetros.</p> : (
                    <ul className="revision-snapshot-values">{snapshot.parameters.map((parameter) => (
                      <li key={parameter.key}><span>{parameter.state === 'available' ? parameter.label : 'Parámetro no identificado'}</span><strong>{formatValue(parameter.value, parameter.unit)}</strong></li>
                    ))}</ul>
                  )}
                </section>
                <section aria-label={`Materiales de ${snapshot.unit.label}`}>
                  <h5>Materiales</h5>
                  {snapshot.materials.length === 0 ? <p className="text-muted">Sin roles de material.</p> : (
                    <ul className="revision-snapshot-materials">{snapshot.materials.map((material) => (
                      <li key={material.role}>
                        <div><span>{material.role_label || material.role}</span><strong>{material.name || 'Material sin resolver'}</strong>{material.code && <small>{material.code}</small>}</div>
                        <div className="revision-snapshot-material__meta">{material.effective_thickness_mm != null && <span>{material.effective_thickness_mm} mm</span>}<span className={`revision-provenance revision-provenance--${material.provenance}`}>{provenanceLabels[material.provenance]}</span></div>
                      </li>
                    ))}</ul>
                  )}
                </section>
              </>
            )}
            <details className="revision-item-audit">
              <summary>Identificadores técnicos</summary>
              <dl>
                <TechnicalId label="FurnitureInstance ID" value={item.furniture_instance_id} />
                {item.furniture_definition_id && <TechnicalId label="Definition ID" value={item.furniture_definition_id} />}
                <TechnicalId label="RevisionItem ID" value={item.id} />
                {item.room_id && <TechnicalId label="Room ID" value={item.room_id} />}
              </dl>
            </details>
          </article>
        );
      })}
    </div>
  );
}
