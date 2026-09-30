/**
 * Component editor — construction and joinery connections tab (#875).
 * Configures component-level constructive role, connection surfaces,
 * joinery system override, and displays origin provenance (Biblioteca / Fábrica / Componente).
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  type ConnectionFace,
  type ConstructiveRole,
  type FactoryConstructionPolicy,
  type JoineryProvenance,
  type JoinerySystemId,
  DEFAULT_FACTORY_CONSTRUCTION_POLICY,
} from '@granete/domain';
import { RefreshCw, Factory, BookOpen, Layers } from 'lucide-react';
import type { ComponentDraft } from '../componentDraft';

export type ComponentEditorJoineryPanelProps = {
  readonly draft: ComponentDraft;
  readonly setDraft: Dispatch<SetStateAction<ComponentDraft>>;
  readonly hidden: boolean;
  readonly factoryPolicy?: FactoryConstructionPolicy;
};

const SYSTEM_OPTIONS: readonly { value: JoinerySystemId; label: string }[] = [
  { value: 'minifix-dowel', label: 'Minifix + Tarugo' },
  { value: 'screw-only', label: 'Tornillo directo' },
  { value: 'dowel-only', label: 'Tarugo solo' },
  { value: 'minifix-only', label: 'Minifix solo' },
  { value: 'custom', label: 'Personalizado' },
];

const CONNECTION_FACES: readonly { value: ConnectionFace; label: string }[] = [
  { value: 'front', label: 'Frontal' },
  { value: 'back', label: 'Posterior' },
  { value: 'left', label: 'Izquierda' },
  { value: 'right', label: 'Derecha' },
  { value: 'top', label: 'Superior' },
  { value: 'bottom', label: 'Inferior' },
];

function inferConstructiveRole(placement: string): ConstructiveRole {
  switch (placement) {
    case 'base':
      return 'horizontal';
    case 'superior':
      return 'horizontal';
    case 'lateral_izquierdo':
    case 'lateral_derecho':
      return 'lateral';
    case 'trasera':
      return 'back';
    case 'interno':
      return 'shelf';
    case 'puerta':
      return 'door';
    default:
      return 'custom';
  }
}

export function ComponentEditorJoineryPanel({
  draft,
  setDraft,
  hidden,
  factoryPolicy = DEFAULT_FACTORY_CONSTRUCTION_POLICY,
}: ComponentEditorJoineryPanelProps): ReactNode {
  const override = draft.constructionOverride;
  const hasLocalOverride = Boolean(
    override &&
      (override.joinerySystemId !== undefined ||
        override.stationsCount !== undefined ||
        override.constructiveRole !== undefined ||
        (override.connectionFaces && override.connectionFaces.length > 0)),
  );

  const inferredRole = inferConstructiveRole(draft.placement);
  const effectiveRole = override?.constructiveRole ?? inferredRole;

  // Determine effective joinery rule from factory policy for comparison
  let factoryFamilyRule = factoryPolicy.floorToSide;
  if (draft.placement === 'superior') {
    factoryFamilyRule = factoryPolicy.topToSide;
  } else if (draft.placement === 'interno') {
    factoryFamilyRule = factoryPolicy.shelfToSide;
  }

  const effectiveProvenance: JoineryProvenance = hasLocalOverride
    ? 'component'
    : factoryFamilyRule.provenance ?? 'library';

  const updateOverride = (partial: Partial<NonNullable<typeof override>>) => {
    setDraft((prev) => {
      const nextOverride = {
        componentId: prev.code || 'component',
        ...prev.constructionOverride,
        ...partial,
        provenance: 'component' as const,
      };
      return {
        ...prev,
        constructionOverride: nextOverride,
      };
    });
  };

  const handleRestoreInheritance = () => {
    setDraft((prev) => {
      const next = { ...prev };
      delete next.constructionOverride;
      return next;
    });
  };

  const toggleFace = (face: ConnectionFace) => {
    const currentFaces = override?.connectionFaces ?? [];
    const nextFaces = currentFaces.includes(face)
      ? currentFaces.filter((f) => f !== face)
      : [...currentFaces, face];
    updateOverride({ connectionFaces: nextFaces });
  };

  return (
    <div
      role="tabpanel"
      id="component-editor-panel-construction"
      aria-labelledby="component-editor-tab-construction"
      hidden={hidden}
      className="catalog-form__section component-editor__panel"
      data-testid="component-editor-panel-construction"
      style={{ display: hidden ? 'none' : 'grid', gap: 'var(--space-4)' }}
    >
      {/* Banner de Origen y Procedencia */}
      <div
        style={{
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3)',
          background: 'var(--surface-hover)',
          display: 'grid',
          gap: 'var(--space-2)',
        }}
        data-testid="component-joinery-provenance-banner"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={18} style={{ color: 'var(--color-primary-600)' }} aria-hidden />
            <strong>Origen de Reglas Constructivas</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 'var(--text-xs)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                fontWeight: 600,
                background:
                  effectiveProvenance === 'component'
                    ? 'var(--color-primary-100, #ebf5ff)'
                    : effectiveProvenance === 'factory'
                    ? 'var(--color-success-100, #e6f7ed)'
                    : 'var(--color-neutral-200, #eee)',
                color:
                  effectiveProvenance === 'component'
                    ? 'var(--color-primary-800, #1e429f)'
                    : effectiveProvenance === 'factory'
                    ? 'var(--color-success-800, #155724)'
                    : 'var(--text-secondary)',
              }}
              data-testid="component-provenance-badge"
            >
              {effectiveProvenance === 'component'
                ? '🧩 Componente (Excepción)'
                : effectiveProvenance === 'factory'
                ? '🏭 Fábrica (Overlay Activo)'
                : '🏛️ Biblioteca (Estándar Granete)'}
            </span>

            {hasLocalOverride ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={handleRestoreInheritance}
                data-testid="component-restore-inheritance-btn"
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)' }}
              >
                <RefreshCw size={12} aria-hidden />
                Restaurar herencia
              </button>
            ) : null}
          </div>
        </div>
        <p className="settings-hint" style={{ margin: 0 }}>
          {hasLocalOverride
            ? 'Esta pieza tiene configuraciones específicas que anulan la política general del taller.'
            : 'Esta pieza hereda automáticamente los criterios de ensamble y perforado definidos para el taller.'}
        </p>
      </div>

      {/* Rol Constructivo */}
      <fieldset className="catalog-form__section" style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend className="catalog-form__section-title">Rol constructivo</legend>
        <div className="catalog-form__field">
          <label htmlFor="component-constructive-role">Función estructural en el mueble</label>
          <select
            id="component-constructive-role"
            value={override?.constructiveRole ?? ''}
            onChange={(e) =>
              updateOverride({
                constructiveRole: e.target.value ? (e.target.value as ConstructiveRole) : undefined,
              })
            }
            data-testid="component-constructive-role-select"
          >
            <option value="">Automático por posición ({inferredRole})</option>
            <option value="horizontal">Horizontal (Piso / Techo)</option>
            <option value="lateral">Lateral / Costado</option>
            <option value="shelf">Estante / Entrepaño</option>
            <option value="back">Fondo / Respaldo</option>
            <option value="door">Puerta</option>
            <option value="divider">Divisor vertical</option>
            <option value="custom">Personalizado</option>
          </select>
          <span className="settings-hint">
            Determina qué familia de uniones y mecanizados le corresponde a la pieza.
          </span>
        </div>
      </fieldset>

      {/* Caras de Conexión */}
      <fieldset className="catalog-form__section" style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend className="catalog-form__section-title">Caras de unión activas</legend>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
          {CONNECTION_FACES.map((face) => {
            const isChecked = Boolean(override?.connectionFaces?.includes(face.value));
            return (
              <label
                key={face.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleFace(face.value)}
                  data-testid={`face-checkbox-${face.value}`}
                />
                <span>{face.label}</span>
              </label>
            );
          })}
        </div>
        <span className="settings-hint" style={{ marginTop: 4 }}>
          Superficies donde el mueble verifica contacto con piezas adyacentes para aplicar mecanizados.
        </span>
      </fieldset>

      {/* Mecanizado y Sistema de Unión */}
      <fieldset className="catalog-form__section" style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend className="catalog-form__section-title">Sistema de unión para este componente</legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="catalog-form__field">
            <label htmlFor="component-joinery-system">Sistema de fijación</label>
            <select
              id="component-joinery-system"
              value={override?.joinerySystemId ?? ''}
              onChange={(e) =>
                updateOverride({
                  joinerySystemId: e.target.value ? e.target.value : undefined,
                })
              }
              data-testid="component-joinery-system-select"
            >
              <option value="">
                Heredado de Fábrica ({factoryFamilyRule.systemId})
              </option>
              {SYSTEM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="catalog-form__field">
            <label htmlFor="component-stations-count">Estaciones de fijación</label>
            <input
              id="component-stations-count"
              type="number"
              min={1}
              max={8}
              placeholder={`Heredado (${factoryFamilyRule.stationsCount})`}
              value={override?.stationsCount ?? ''}
              onChange={(e) =>
                updateOverride({
                  stationsCount: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              data-testid="component-stations-count-input"
            />
          </div>
        </div>
      </fieldset>
    </div>
  );
}
