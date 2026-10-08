/**
 * Component editor — construction and joinery connections tab (#875).
 * Configures component-level constructive role, connection surfaces,
 * joinery system override, and displays origin provenance (Biblioteca / Fábrica / Componente).
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  type ConnectionFace,
  type ConstructiveRole,
  type ComponentConstructionOverride,
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
  /**
   * #875 slice 3: the station exception is FACTORY OVERLAY truth, not part of
   * the component entity. `stored` is the server value for this component;
   * `onSave(null)` restores inheritance. Editor-only fields (role, faces,
   * system) stay component-draft state — only the station pattern persists.
   */
  readonly constructionException?: {
    readonly componentId: string | null;
    readonly canMutate: boolean;
    readonly stored?: ComponentConstructionOverride | null;
    readonly saving: boolean;
    readonly error: string | null;
    readonly onSave: (override: ComponentConstructionOverride | null) => void | Promise<void>;
  };
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
  constructionException,
}: ComponentEditorJoineryPanelProps): ReactNode {
  const override = draft.constructionOverride;
  const stored = constructionException?.stored ?? null;
  const hasLocalOverride = Boolean(
    override &&
      (override.joinerySystemId !== undefined ||
        override.stationsCount !== undefined ||
        override.startMarginMm !== undefined ||
        override.endMarginMm !== undefined ||
        override.constructiveRole !== undefined ||
        (override.connectionFaces && override.connectionFaces.length > 0)),
  );
  // Server truth for the station pattern: what the overlay stores for THIS
  // component is the exception; dirty local edits are exactly that until the
  // explicit save lands.
  const storedExceptionActive = Boolean(
    stored &&
      (stored.stationsCount !== undefined ||
        stored.startMarginMm !== undefined ||
        stored.endMarginMm !== undefined),
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

  const effectiveProvenance: JoineryProvenance = storedExceptionActive
    ? 'component'
    : factoryFamilyRule.provenance ?? 'library';

  // #1219: the EFFECTIVE joinery system with its own provenance rung — the
  // component's authored system wins, then the factory family's, then the
  // library default. What the machining ladder resolves is what this shows.
  const effectiveJoinerySystemId: string =
    override?.joinerySystemId ??
    factoryFamilyRule.systemId ??
    DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide.systemId;
  const systemProvenance: JoineryProvenance = override?.joinerySystemId
    ? 'component'
    : factoryFamilyRule.systemId
      ? 'factory'
      : 'library';
  const effectiveSystemLabel =
    SYSTEM_OPTIONS.find((opt) => opt.value === effectiveJoinerySystemId)?.label ??
    effectiveJoinerySystemId;

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
    if (storedExceptionActive) {
      void constructionException?.onSave(null);
    }
  };

  // The overlay entry carries ONLY the station pattern scalars the engine
  // consumes; role/faces/system stay component-editor state.
  const handleSaveException = () => {
    if (!constructionException?.componentId || !override) return;
    void constructionException.onSave({
      componentId: constructionException.componentId,
      stationsCount: override.stationsCount,
      startMarginMm: override.startMarginMm,
      endMarginMm: override.endMarginMm,
      provenance: 'component',
    });
  };

  const exceptionDirty =
    hasLocalOverride &&
    (override?.stationsCount !== stored?.stationsCount ||
      override?.startMarginMm !== stored?.startMarginMm ||
      override?.endMarginMm !== stored?.endMarginMm);

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
      className="catalog-form__section component-editor__panel component-joinery"
      data-testid="component-editor-panel-construction"
      style={{ display: hidden ? 'none' : undefined }}
    >
      {/* Banner de Origen y Procedencia */}
      <div className="component-joinery__banner" data-testid="component-joinery-provenance-banner">
        <div className="component-joinery__banner-head">
          <div className="component-joinery__banner-title">
            <Layers size={18} style={{ color: 'var(--brand-600)' }} aria-hidden />
            <strong>Origen de las reglas constructivas</strong>
          </div>
          <div className="component-joinery__banner-actions">
            <span
              className={
                'component-joinery__badge' +
                (effectiveProvenance === 'component'
                  ? ' component-joinery__badge--component'
                  : effectiveProvenance === 'factory'
                    ? ' component-joinery__badge--factory'
                    : '')
              }
              data-testid="component-provenance-badge"
            >
              <span className="component-joinery__badge-dot" aria-hidden />
              {effectiveProvenance === 'component'
                ? 'Componente · excepción'
                : effectiveProvenance === 'factory'
                ? 'Fábrica · excepción de taller'
                : 'Biblioteca · estándar Granete'}
            </span>

            {hasLocalOverride || storedExceptionActive ? (
              <button
                type="button"
                className="btn btn--small"
                onClick={handleRestoreInheritance}
                disabled={constructionException?.saving}
                data-testid="component-restore-inheritance-btn"
              >
                <RefreshCw size={12} aria-hidden />
                Restaurar herencia
              </button>
            ) : null}
            {exceptionDirty && constructionException?.componentId ? (
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={handleSaveException}
                disabled={constructionException.saving || !constructionException.canMutate}
                data-testid="component-save-exception-btn"
              >
                <Factory size={12} aria-hidden />
                {constructionException.saving ? 'Fijando…' : 'Fijar excepción en fábrica'}
              </button>
            ) : null}
          </div>
        </div>
        <p className="catalog-form__hint">
          {constructionException?.error ? (
            <span role="alert" data-testid="component-exception-error">{constructionException.error}</span>
          ) : storedExceptionActive ? (
            'Esta pieza tiene una excepción guardada en la política de la fábrica: gobierna el perforado real de sus uniones.'
          ) : hasLocalOverride ? (
            'Configuración sin guardar: usá «Fijar excepción en fábrica» para aplicarla al perforado de esta pieza.'
          ) : (
            'Esta pieza hereda automáticamente los criterios de ensamble y perforado definidos para el taller.'
          )}
        </p>
      </div>

      {/* Rol Constructivo */}
      <fieldset className="component-joinery__fieldset">
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
          <span className="catalog-form__hint">
            Determina qué familia de uniones y mecanizados le corresponde a la pieza.
          </span>
        </div>
      </fieldset>

      {/* Caras de Conexión */}
      <fieldset className="component-joinery__fieldset">
        <legend className="catalog-form__section-title">Caras de unión activas</legend>
        <div className="component-joinery__faces">
          {CONNECTION_FACES.map((face) => {
            const isChecked = Boolean(override?.connectionFaces?.includes(face.value));
            return (
              <label key={face.value} className="component-joinery__face-option">
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
        <span className="catalog-form__hint">
          Superficies donde el mueble verifica contacto con piezas adyacentes para aplicar mecanizados.
        </span>
      </fieldset>

      {/* Mecanizado y Sistema de Unión */}
      <fieldset className="component-joinery__fieldset">
        <legend className="catalog-form__section-title">Sistema de unión para este componente</legend>
        <div className="component-joinery__grid">
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
            <span
              className="catalog-form__hint"
              data-testid="component-joinery-effective-system"
              data-provenance={systemProvenance}
            >
              Sistema efectivo: {effectiveSystemLabel}
              {' — '}
              {systemProvenance === 'component'
                ? 'definido en el componente'
                : systemProvenance === 'factory'
                  ? 'definido por la fábrica'
                  : 'heredado de la biblioteca'}
            </span>
          </div>

          <div className="catalog-form__field">
            <label htmlFor="component-stations-count">Estaciones de fijación</label>
            <input
              id="component-stations-count"
              type="number"
              min={1}
              max={8}
              placeholder={`Heredado (${stored?.stationsCount ?? factoryFamilyRule.stationsCount})`}
              value={override?.stationsCount ?? ''}
              onChange={(e) =>
                updateOverride({
                  stationsCount: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              data-testid="component-stations-count-input"
            />
          </div>

          <div className="catalog-form__field">
            <label htmlFor="component-start-margin">Margen inicial (mm)</label>
            <input
              id="component-start-margin"
              type="number"
              min={0}
              placeholder={`Heredado (${stored?.startMarginMm ?? factoryFamilyRule.startMarginMm})`}
              value={override?.startMarginMm ?? ''}
              onChange={(e) =>
                updateOverride({
                  startMarginMm: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              data-testid="component-start-margin-input"
            />
          </div>

          <div className="catalog-form__field">
            <label htmlFor="component-end-margin">Margen final (mm)</label>
            <input
              id="component-end-margin"
              type="number"
              min={0}
              placeholder={`Heredado (${stored?.endMarginMm ?? factoryFamilyRule.endMarginMm})`}
              value={override?.endMarginMm ?? ''}
              onChange={(e) =>
                updateOverride({
                  endMarginMm: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              data-testid="component-end-margin-input"
            />
          </div>
        </div>
        <span className="catalog-form__hint">
          Los valores guardados son una excepción por componente: pisan la política general de la fábrica para esta pieza.
        </span>
      </fieldset>
    </div>
  );
}
