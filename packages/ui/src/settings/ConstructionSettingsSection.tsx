/**
 * Construction & Joinery Settings Section (#875).
 * Enables workshop administrators to self-serve joint drilling rules,
 * hardware recipes, and back panel geometry overrides on top of Granete Standard
 * via the organization manufacturing overlay.
 */

import { type ReactNode } from 'react';
import {
  type FactoryConstructionPolicy,
  type JoinerySystemId,
  type JointFamilyRule,
  type BackPanelFamilyRule,
  restoreInheritance,
  validateConstructionPolicy,
} from '@granete/domain';
import { RefreshCw, Factory, AlertTriangle } from 'lucide-react';
import type { LibraryOverlayDetail, LibraryReleaseSummary } from '@granete/storage';

export interface ConstructionSettingsSectionProps {
  readonly policy: FactoryConstructionPolicy;
  readonly activeOverlay: LibraryOverlayDetail | null;
  readonly baseRelease?: LibraryReleaseSummary | null;
  readonly onChange: (nextPolicy: FactoryConstructionPolicy) => void;
  readonly saving?: boolean;
  readonly disabled?: boolean;
}

const SYSTEM_OPTIONS: readonly { value: JoinerySystemId; label: string; description: string }[] = [
  { value: 'minifix-dowel', label: 'Minifix + Tarugo', description: 'Caja excéntrica + espiga de madera (desmontable y rígido)' },
  { value: 'screw-only', label: 'Tornillo directo', description: 'Tornillo de ensamble directo (ej. Confirmat 7x50)' },
  { value: 'dowel-only', label: 'Tarugo solo', description: 'Espiga de madera para encolado en prensa' },
  { value: 'minifix-only', label: 'Minifix solo', description: 'Solo perno y caja excéntrica sin tarugos de guía' },
  { value: 'custom', label: 'Personalizado', description: 'Herraje o ensamble especial de taller' },
];

export function ConstructionSettingsSection({
  policy,
  activeOverlay,
  baseRelease,
  onChange,
  saving = false,
  disabled = false,
}: ConstructionSettingsSectionProps): ReactNode {
  const validation = validateConstructionPolicy(policy);

  const updateFloor = (partial: Partial<JointFamilyRule>) => {
    onChange({
      ...policy,
      floorToSide: {
        ...policy.floorToSide,
        ...partial,
        provenance: 'factory',
      },
    });
  };

  const updateTop = (partial: Partial<JointFamilyRule>) => {
    onChange({
      ...policy,
      topToSide: {
        ...policy.topToSide,
        ...partial,
        provenance: 'factory',
      },
    });
  };

  const updateShelf = (partial: Partial<JointFamilyRule>) => {
    onChange({
      ...policy,
      shelfToSide: {
        ...policy.shelfToSide,
        ...partial,
        provenance: 'factory',
      },
    });
  };

  const updateBack = (partial: Partial<BackPanelFamilyRule>) => {
    onChange({
      ...policy,
      backPanel: {
        ...policy.backPanel,
        ...partial,
        provenance: 'factory',
      },
    });
  };

  const handleRestore = (family: 'floorToSide' | 'topToSide' | 'shelfToSide' | 'backPanel') => {
    onChange(restoreInheritance(policy, family));
  };

  const handleRestoreAll = () => {
    let next = restoreInheritance(policy, 'floorToSide');
    next = restoreInheritance(next, 'topToSide');
    next = restoreInheritance(next, 'shelfToSide');
    next = restoreInheritance(next, 'backPanel');
    onChange(next);
  };

  return (
    <fieldset
      className="catalog-form__section"
      data-testid="settings-section-construction"
      style={{ display: 'grid', gap: 'var(--space-4)' }}
    >
      <legend className="catalog-form__section-title">
        Construcción y uniones de fábrica
      </legend>

      {/* Banner de Estado del Catálogo y Overlay */}
      <div
        style={{
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3)',
          background: 'var(--surface-hover)',
          display: 'grid',
          gap: 'var(--space-2)',
        }}
        data-testid="construction-overlay-status"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Factory size={18} style={{ color: 'var(--color-primary-600)' }} aria-hidden />
            <strong>Política de Fabricación Activa</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)' }}>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                background: activeOverlay ? 'var(--color-success-100, #e6f7ed)' : 'var(--color-neutral-200, #eee)',
                color: activeOverlay ? 'var(--color-success-800, #155724)' : 'var(--text-secondary)',
                fontWeight: 600,
              }}
              data-testid="overlay-active-badge"
            >
              {activeOverlay ? 'Personalizado (Overlay Activo)' : 'Estándar Granete (Heredado)'}
            </span>
            {baseRelease ? (
              <span style={{ color: 'var(--text-muted)' }}>
                Base: {baseRelease.version}
              </span>
            ) : null}
          </div>
        </div>
        <p className="settings-hint" style={{ margin: 0 }}>
          Define el criterio de perforado, herrajes y ensamble para todos los muebles del taller.
          Las modificaciones se guardan en el overlay de tu fábrica sin alterar Granete Standard ni afectar proyectos ya publicados.
        </p>
      </div>

      {/* Alerta de Validación */}
      {!validation.valid ? (
        <div
          role="alert"
          style={{
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-danger-50, #fdf2f2)',
            border: '1px solid var(--color-danger-300, #f8b4b4)',
            color: 'var(--color-danger-800, #9b1c1c)',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
          }}
          data-testid="construction-validation-alert"
        >
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
          <div style={{ display: 'grid', gap: 4, fontSize: 'var(--text-sm)' }}>
            <strong>La política contiene errores de configuración:</strong>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {validation.issues.map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {/* Regla 1: Piso con Laterales */}
      <div
        className="machine-output-card"
        data-testid="construction-family-floor"
        style={{ display: 'grid', gap: 12 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h4 style={{ margin: 0 }}>Piso con Laterales</h4>
            <span
              style={{
                fontSize: 'var(--text-xs)',
                padding: '2px 6px',
                borderRadius: 4,
                background: policy.floorToSide.provenance === 'factory' ? 'var(--color-primary-100, #ebf5ff)' : 'var(--surface-hover)',
                color: policy.floorToSide.provenance === 'factory' ? 'var(--color-primary-800, #1e429f)' : 'var(--text-muted)',
                fontWeight: 600,
              }}
              data-testid="floor-provenance-badge"
            >
              {policy.floorToSide.provenance === 'factory' ? 'Fábrica' : 'Estándar'}
            </span>
          </div>
          {policy.floorToSide.provenance === 'factory' ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => handleRestore('floorToSide')}
              disabled={disabled || saving}
              data-testid="restore-floor-inheritance"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)' }}
            >
              <RefreshCw size={12} aria-hidden />
              Restaurar herencia
            </button>
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="catalog-form__field">
            <label htmlFor="floor-system">Sistema de unión</label>
            <select
              id="floor-system"
              value={policy.floorToSide.systemId}
              onChange={(e) => updateFloor({ systemId: e.target.value as JoinerySystemId })}
              disabled={disabled || saving}
              data-testid="floor-system-select"
            >
              {SYSTEM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="catalog-form__field">
            <label htmlFor="floor-stations">Estaciones de fijación</label>
            <input
              id="floor-stations"
              type="number"
              min={2}
              max={8}
              value={policy.floorToSide.stationsCount}
              onChange={(e) => updateFloor({ stationsCount: Number(e.target.value) })}
              disabled={disabled || saving}
              data-testid="floor-stations-input"
            />
          </div>

          <div className="catalog-form__field">
            <label htmlFor="floor-start-margin">Margen frontal (mm)</label>
            <input
              id="floor-start-margin"
              type="number"
              min={20}
              max={200}
              step={1}
              value={policy.floorToSide.startMarginMm}
              onChange={(e) => updateFloor({ startMarginMm: Number(e.target.value) })}
              disabled={disabled || saving}
              data-testid="floor-start-margin-input"
            />
          </div>

          <div className="catalog-form__field">
            <label htmlFor="floor-end-margin">Margen posterior (mm)</label>
            <input
              id="floor-end-margin"
              type="number"
              min={20}
              max={200}
              step={1}
              value={policy.floorToSide.endMarginMm}
              onChange={(e) => updateFloor({ endMarginMm: Number(e.target.value) })}
              disabled={disabled || saving}
              data-testid="floor-end-margin-input"
            />
          </div>
        </div>
      </div>

      {/* Regla 2: Techo con Laterales */}
      <div
        className="machine-output-card"
        data-testid="construction-family-top"
        style={{ display: 'grid', gap: 12 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h4 style={{ margin: 0 }}>Techo con Laterales</h4>
            <span
              style={{
                fontSize: 'var(--text-xs)',
                padding: '2px 6px',
                borderRadius: 4,
                background: policy.topToSide.provenance === 'factory' ? 'var(--color-primary-100, #ebf5ff)' : 'var(--surface-hover)',
                color: policy.topToSide.provenance === 'factory' ? 'var(--color-primary-800, #1e429f)' : 'var(--text-muted)',
                fontWeight: 600,
              }}
              data-testid="top-provenance-badge"
            >
              {policy.topToSide.provenance === 'factory' ? 'Fábrica' : 'Estándar'}
            </span>
          </div>
          {policy.topToSide.provenance === 'factory' ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => handleRestore('topToSide')}
              disabled={disabled || saving}
              data-testid="restore-top-inheritance"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)' }}
            >
              <RefreshCw size={12} aria-hidden />
              Restaurar herencia
            </button>
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="catalog-form__field">
            <label htmlFor="top-system">Sistema de unión</label>
            <select
              id="top-system"
              value={policy.topToSide.systemId}
              onChange={(e) => updateTop({ systemId: e.target.value as JoinerySystemId })}
              disabled={disabled || saving}
              data-testid="top-system-select"
            >
              {SYSTEM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="catalog-form__field">
            <label htmlFor="top-stations">Estaciones de fijación</label>
            <input
              id="top-stations"
              type="number"
              min={2}
              max={8}
              value={policy.topToSide.stationsCount}
              onChange={(e) => updateTop({ stationsCount: Number(e.target.value) })}
              disabled={disabled || saving}
              data-testid="top-stations-input"
            />
          </div>

          <div className="catalog-form__field">
            <label htmlFor="top-start-margin">Margen frontal (mm)</label>
            <input
              id="top-start-margin"
              type="number"
              min={20}
              max={200}
              step={1}
              value={policy.topToSide.startMarginMm}
              onChange={(e) => updateTop({ startMarginMm: Number(e.target.value) })}
              disabled={disabled || saving}
              data-testid="top-start-margin-input"
            />
          </div>

          <div className="catalog-form__field">
            <label htmlFor="top-end-margin">Margen posterior (mm)</label>
            <input
              id="top-end-margin"
              type="number"
              min={20}
              max={200}
              step={1}
              value={policy.topToSide.endMarginMm}
              onChange={(e) => updateTop({ endMarginMm: Number(e.target.value) })}
              disabled={disabled || saving}
              data-testid="top-end-margin-input"
            />
          </div>
        </div>
      </div>

      {/* Regla 3: Estante con Laterales */}
      <div
        className="machine-output-card"
        data-testid="construction-family-shelf"
        style={{ display: 'grid', gap: 12 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h4 style={{ margin: 0 }}>Estante con Laterales</h4>
            <span
              style={{
                fontSize: 'var(--text-xs)',
                padding: '2px 6px',
                borderRadius: 4,
                background: policy.shelfToSide.provenance === 'factory' ? 'var(--color-primary-100, #ebf5ff)' : 'var(--surface-hover)',
                color: policy.shelfToSide.provenance === 'factory' ? 'var(--color-primary-800, #1e429f)' : 'var(--text-muted)',
                fontWeight: 600,
              }}
              data-testid="shelf-provenance-badge"
            >
              {policy.shelfToSide.provenance === 'factory' ? 'Fábrica' : 'Estándar'}
            </span>
          </div>
          {policy.shelfToSide.provenance === 'factory' ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => handleRestore('shelfToSide')}
              disabled={disabled || saving}
              data-testid="restore-shelf-inheritance"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)' }}
            >
              <RefreshCw size={12} aria-hidden />
              Restaurar herencia
            </button>
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="catalog-form__field">
            <label htmlFor="shelf-system">Sistema de unión</label>
            <select
              id="shelf-system"
              value={policy.shelfToSide.systemId}
              onChange={(e) => updateShelf({ systemId: e.target.value as JoinerySystemId })}
              disabled={disabled || saving}
              data-testid="shelf-system-select"
            >
              {SYSTEM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="catalog-form__field">
            <label htmlFor="shelf-stations">Estaciones de fijación</label>
            <input
              id="shelf-stations"
              type="number"
              min={2}
              max={8}
              value={policy.shelfToSide.stationsCount}
              onChange={(e) => updateShelf({ stationsCount: Number(e.target.value) })}
              disabled={disabled || saving}
              data-testid="shelf-stations-input"
            />
          </div>

          <div className="catalog-form__field">
            <label htmlFor="shelf-start-margin">Margen frontal (mm)</label>
            <input
              id="shelf-start-margin"
              type="number"
              min={20}
              max={200}
              step={1}
              value={policy.shelfToSide.startMarginMm}
              onChange={(e) => updateShelf({ startMarginMm: Number(e.target.value) })}
              disabled={disabled || saving}
              data-testid="shelf-start-margin-input"
            />
          </div>

          <div className="catalog-form__field">
            <label htmlFor="shelf-end-margin">Margen posterior (mm)</label>
            <input
              id="shelf-end-margin"
              type="number"
              min={20}
              max={200}
              step={1}
              value={policy.shelfToSide.endMarginMm}
              onChange={(e) => updateShelf({ endMarginMm: Number(e.target.value) })}
              disabled={disabled || saving}
              data-testid="shelf-end-margin-input"
            />
          </div>
        </div>
      </div>

      {/* Regla 4: Fondo / Respaldo */}
      <div
        className="machine-output-card"
        data-testid="construction-family-back"
        style={{ display: 'grid', gap: 12 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h4 style={{ margin: 0 }}>Fondo / Respaldo</h4>
            <span
              style={{
                fontSize: 'var(--text-xs)',
                padding: '2px 6px',
                borderRadius: 4,
                background: policy.backPanel.provenance === 'factory' ? 'var(--color-primary-100, #ebf5ff)' : 'var(--surface-hover)',
                color: policy.backPanel.provenance === 'factory' ? 'var(--color-primary-800, #1e429f)' : 'var(--text-muted)',
                fontWeight: 600,
              }}
              data-testid="back-provenance-badge"
            >
              {policy.backPanel.provenance === 'factory' ? 'Fábrica' : 'Estándar'}
            </span>
          </div>
          {policy.backPanel.provenance === 'factory' ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => handleRestore('backPanel')}
              disabled={disabled || saving}
              data-testid="restore-back-inheritance"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)' }}
            >
              <RefreshCw size={12} aria-hidden />
              Restaurar herencia
            </button>
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="catalog-form__field">
            <label htmlFor="back-screw-code">Código de tornillo / fijación</label>
            <input
              id="back-screw-code"
              type="text"
              value={policy.backPanel.screwCode}
              onChange={(e) => updateBack({ screwCode: e.target.value })}
              disabled={disabled || saving}
              data-testid="back-screw-code-input"
            />
          </div>

          <div className="catalog-form__field">
            <label htmlFor="back-inset">Retiro / Inset (mm)</label>
            <input
              id="back-inset"
              type="number"
              min={0}
              max={50}
              step={1}
              value={policy.backPanel.insetMm}
              onChange={(e) => updateBack({ insetMm: Number(e.target.value) })}
              disabled={disabled || saving}
              data-testid="back-inset-input"
            />
          </div>

          <div className="catalog-form__field">
            <label htmlFor="back-max-spacing">Espaciado máximo entre tornillos (mm)</label>
            <input
              id="back-max-spacing"
              type="number"
              min={100}
              max={800}
              step={50}
              value={policy.backPanel.maxSpacingMm}
              onChange={(e) => updateBack({ maxSpacingMm: Number(e.target.value) })}
              disabled={disabled || saving}
              data-testid="back-max-spacing-input"
            />
          </div>
        </div>
      </div>

      {/* Acción Global: Restaurar Todo */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={handleRestoreAll}
          disabled={disabled || saving}
          data-testid="restore-all-construction-inheritance"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14} aria-hidden />
          Restaurar todas las reglas a Estándar Granete
        </button>
      </div>
    </fieldset>
  );
}
