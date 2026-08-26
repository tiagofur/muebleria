/**
 * Workshop settings — global defaults for new quotations and production engineering.
 * Presentation only; shell owns persistence.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { WorkshopSettings } from '@granete/domain';
import { Settings, SlidersHorizontal, Wrench } from 'lucide-react';
import { PageHeader, submitBusyLabel, WorkspaceTabs, type TabDefinition } from '../common';
import '../catalogs/catalogs.css';
import './settings.css';

export type SettingsScreenProps = {
  readonly settings: WorkshopSettings;
  readonly onSave: (settings: WorkshopSettings) => void;
  readonly saving?: boolean;
  readonly onOpenOnboardingTour?: () => void;
};

type SettingsTabId = 'general' | 'ingenieria';

const SETTINGS_TABS: readonly TabDefinition<SettingsTabId>[] = [
  {
    id: 'general',
    label: 'General y Comercial',
    icon: <SlidersHorizontal size={14} aria-hidden style={{ marginRight: 6 }} />,
  },
  {
    id: 'ingenieria',
    label: 'Ingeniería y Producción',
    icon: <Wrench size={14} aria-hidden style={{ marginRight: 6 }} />,
  },
];

export function SettingsScreen({
  settings,
  onSave,
  saving = false,
  onOpenOnboardingTour,
}: SettingsScreenProps): ReactNode {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general');

  // Commercial / General state
  const [margin, setMargin] = useState(String(settings.defaultMarginFactor));
  const [labor, setLabor] = useState(String(settings.defaultLaborFixedCost));
  const [currency, setCurrency] = useState(settings.defaultCurrency);
  const [vendedorCanViewCosts, setVendedorCanViewCosts] = useState(
    settings.vendedorCanViewCosts,
  );
  const [workshopName, setWorkshopName] = useState(
    settings.workshopName ?? '',
  );

  // Engineering / Production state
  const [ptxExportMode, setPtxExportMode] = useState<'unified' | 'by-material'>(
    settings.ptxExportMode ?? 'unified',
  );
  const [cutStrategy, setCutStrategy] = useState<'saw-guillotine' | 'cnc-nesting'>(
    settings.defaultCutStrategy ?? 'saw-guillotine',
  );
  const [sawKerf, setSawKerf] = useState(String(settings.defaultSawKerfMm ?? 4.4));
  const [trimTop, setTrimTop] = useState(String(settings.defaultTrimMargins?.topMm ?? 10));
  const [trimBottom, setTrimBottom] = useState(String(settings.defaultTrimMargins?.bottomMm ?? 10));
  const [trimLeft, setTrimLeft] = useState(String(settings.defaultTrimMargins?.leftMm ?? 10));
  const [trimRight, setTrimRight] = useState(String(settings.defaultTrimMargins?.rightMm ?? 10));
  const [deductEdgeBand, setDeductEdgeBand] = useState<boolean>(
    settings.defaultDeductEdgeBand ?? true,
  );
  const [navMode, setNavMode] = useState<'simplified' | 'departmental'>(
    settings.navMode ?? 'departmental',
  );

  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setMargin(String(settings.defaultMarginFactor));
    setLabor(String(settings.defaultLaborFixedCost));
    setCurrency(settings.defaultCurrency);
    setVendedorCanViewCosts(settings.vendedorCanViewCosts);
    setWorkshopName(settings.workshopName ?? '');
    setPtxExportMode(settings.ptxExportMode ?? 'unified');
    setCutStrategy(settings.defaultCutStrategy ?? 'saw-guillotine');
    setSawKerf(String(settings.defaultSawKerfMm ?? 4.4));
    setTrimTop(String(settings.defaultTrimMargins?.topMm ?? 10));
    setTrimBottom(String(settings.defaultTrimMargins?.bottomMm ?? 10));
    setTrimLeft(String(settings.defaultTrimMargins?.leftMm ?? 10));
    setTrimRight(String(settings.defaultTrimMargins?.rightMm ?? 10));
    setDeductEdgeBand(settings.defaultDeductEdgeBand ?? true);
    setNavMode(settings.navMode ?? 'departmental');
  }, [settings]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const marginFactor = Number(margin);
    const laborFixedCost = Number(labor);
    const cur = currency.trim().toUpperCase();
    const kerfVal = Number(sawKerf);
    const topVal = Number(trimTop);
    const botVal = Number(trimBottom);
    const leftVal = Number(trimLeft);
    const rightVal = Number(trimRight);

    if (!Number.isFinite(marginFactor) || marginFactor <= 0) {
      setError('El factor de margen debe ser un número mayor que 0.');
      return;
    }
    if (!Number.isFinite(laborFixedCost) || laborFixedCost < 0) {
      setError('La mano de obra fija debe ser un número mayor o igual a 0.');
      return;
    }
    if (!cur || cur.length > 8) {
      setError('Indicá una moneda válida (ej. MXN).');
      return;
    }
    if (!Number.isFinite(kerfVal) || kerfVal < 0) {
      setError('El espesor del disco (kerf) debe ser un número mayor o igual a 0.');
      return;
    }
    if (
      !Number.isFinite(topVal) || topVal < 0 ||
      !Number.isFinite(botVal) || botVal < 0 ||
      !Number.isFinite(leftVal) || leftVal < 0 ||
      !Number.isFinite(rightVal) || rightVal < 0
    ) {
      setError('Los márgenes de refile deben ser números mayores o iguales a 0.');
      return;
    }

    setError(null);
    onSave({
      defaultMarginFactor: marginFactor,
      defaultLaborFixedCost: laborFixedCost,
      defaultCurrency: cur,
      vendedorCanViewCosts,
      workshopName: workshopName.trim() || undefined,
      ptxExportMode,
      defaultCutStrategy: cutStrategy,
      defaultSawKerfMm: kerfVal,
      defaultTrimMargins: {
        topMm: topVal,
        bottomMm: botVal,
        leftMm: leftVal,
        rightMm: rightVal,
      },
      defaultDeductEdgeBand: deductEdgeBand,
      navMode,
    });
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  return (
    <section className="catalog-page" aria-label="Ajustes del taller">
      <PageHeader
        title="Ajustes"
        subtitle="Configuración global del taller para cotizaciones y producción"
        icon={<Settings size={16} strokeWidth={1.5} />}
      />

      <div style={{ marginBottom: 16 }}>
        <WorkspaceTabs
          tabs={SETTINGS_TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          ariaLabel="Secciones de ajustes del taller"
          idPrefix="settings"
          testIdPrefix="settings-tab"
        />
      </div>

      <form
        className="catalog-form settings-form"
        onSubmit={onSubmit}
        data-testid="settings-form"
        style={{ maxWidth: '40rem' }}
      >
        {error ? (
          <p className="catalog-form__error" role="alert">
            {error}
          </p>
        ) : null}
        {savedFlash ? (
          <p className="settings-saved" role="status" data-testid="settings-saved">
            Preferencias guardadas exitosamente
          </p>
        ) : null}

        {/* TAB 1: GENERAL Y COMERCIAL */}
        {activeTab === 'general' ? (
          <>
            <fieldset className="catalog-form__section">
              <legend className="catalog-form__section-title">
                Cotización por defecto
              </legend>
              <p className="settings-lead settings-lead--inline">
                Solo afecta <strong>cotizaciones nuevas</strong>. Las ya creadas no
                cambian.
              </p>
              <div className="catalog-form__field">
                <label htmlFor="settings-margin">Factor de margen</label>
                <input
                  id="settings-margin"
                  type="number"
                  step="0.01"
                  value={margin}
                  onChange={(e) => setMargin(e.target.value)}
                  required
                />
                <span className="settings-hint">
                  Ejemplo: 1.35 multiplica el costo directo para el precio de venta.
                </span>
              </div>
              <div className="catalog-form__field">
                <label htmlFor="settings-labor">Mano de obra fija</label>
                <input
                  id="settings-labor"
                  type="number"
                  min={0}
                  step="any"
                  value={labor}
                  onChange={(e) => setLabor(e.target.value)}
                  required
                />
                <span className="settings-hint">
                  Monto fijo sumado al costo en cada cotización nueva.
                </span>
              </div>
              <div className="catalog-form__field">
                <label htmlFor="settings-currency">Moneda</label>
                <input
                  id="settings-currency"
                  type="text"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  maxLength={8}
                  required
                  autoComplete="off"
                />
                <span className="settings-hint">Código de moneda (ej. MXN).</span>
              </div>
            </fieldset>

            <fieldset className="catalog-form__section">
              <legend className="catalog-form__section-title">Identidad</legend>
              <div className="catalog-form__field">
                <label htmlFor="settings-workshop-name">Nombre del taller</label>
                <input
                  id="settings-workshop-name"
                  type="text"
                  value={workshopName}
                  onChange={(e) => setWorkshopName(e.target.value)}
                  maxLength={80}
                  autoComplete="off"
                  placeholder="Ej. Carpintería Los Pinos"
                  data-testid="settings-workshop-name"
                />
                <span className="settings-hint">
                  Aparece en el pie de página de los PDFs exportados.
                </span>
              </div>
            </fieldset>

            <fieldset className="catalog-form__section">
              <legend className="catalog-form__section-title">Permisos</legend>
              <div className="catalog-form__field settings-form__checkbox">
                <label
                  htmlFor="settings-vendedor-costs"
                  className="settings-checkbox"
                >
                  <input
                    id="settings-vendedor-costs"
                    type="checkbox"
                    checked={vendedorCanViewCosts}
                    onChange={(e) => setVendedorCanViewCosts(e.target.checked)}
                    data-testid="settings-vendedor-can-view-costs"
                  />
                  <span>Vendedor puede ver costos del taller</span>
                </label>
                <span className="settings-hint">
                  Por defecto el vendedor solo ve precio de venta. Activá esto si
                  querés que vea unitarios, margen y desglose.
                </span>
              </div>
            </fieldset>

            <fieldset className="catalog-form__section" data-testid="settings-section-nav-mode">
              <legend className="catalog-form__section-title">Navegación</legend>
              <div className="catalog-form__field">
                <label>Tamaño del taller</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                    <input
                      type="radio"
                      name="navMode"
                      value="simplified"
                      checked={navMode === 'simplified'}
                      onChange={() => setNavMode('simplified')}
                      data-testid="settings-nav-mode-simplified"
                    />
                    <span><strong>Taller pequeño:</strong> menú simplificado — Inicio, Cotizaciones, Órdenes, Almacén e Instalaciones. Todo lo avanzado vive dentro de cada obra.</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                    <input
                      type="radio"
                      name="navMode"
                      value="departmental"
                      checked={navMode === 'departmental'}
                      onChange={() => setNavMode('departmental')}
                      data-testid="settings-nav-mode-departmental"
                    />
                    <span><strong>Empresa mediana:</strong> navegación por departamentos (Ventas, Ingeniería, Producción, Compras/Almacén).</span>
                  </label>
                </div>
                <span className="settings-hint" style={{ marginTop: 6 }}>
                  Solo cambia el menú visible; los permisos por rol se mantienen igual.
                </span>
              </div>
            </fieldset>

            {onOpenOnboardingTour ? (
              <fieldset className="catalog-form__section">
                <legend className="catalog-form__section-title">Ayuda & Tour</legend>
                <div className="catalog-form__field">
                  <p className="settings-lead settings-lead--inline">
                    Revive las novedades del catálogo LatAm, despiece 3D y exportaciones a taller.
                  </p>
                  <div>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={onOpenOnboardingTour}
                      data-testid="settings-open-onboarding-tour"
                    >
                      Ver tour de bienvenida
                    </button>
                  </div>
                </div>
              </fieldset>
            ) : null}
          </>
        ) : null}

        {/* TAB 2: INGENIERÍA Y PRODUCCIÓN */}
        {activeTab === 'ingenieria' ? (
          <>
            <fieldset className="catalog-form__section" data-testid="settings-section-cut-strategy">
              <legend className="catalog-form__section-title">
                Tipo de corte
              </legend>
              <div className="catalog-form__field">
                <label>Tipo de corte por defecto</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                    <input
                      type="radio"
                      name="cutStrategy"
                      value="saw-guillotine"
                      checked={cutStrategy === 'saw-guillotine'}
                      onChange={() => setCutStrategy('saw-guillotine')}
                      data-testid="settings-cut-strategy-saw"
                    />
                    <span><strong>Sierra (guillotina):</strong> cortes rectos de borde a borde, con kerf y secuencia paso a paso.</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                    <input
                      type="radio"
                      name="cutStrategy"
                      value="cnc-nesting"
                      checked={cutStrategy === 'cnc-nesting'}
                      onChange={() => setCutStrategy('cnc-nesting')}
                      data-testid="settings-cut-strategy-nesting"
                    />
                    <span><strong>CNC nesting:</strong> piezas anidadas libremente con espaciado de fresa; el plan se exporta en DXF.</span>
                  </label>
                </div>
                <span className="settings-hint" style={{ marginTop: 6 }}>
                  Se aplica a las obras que aún no generan un plan. Cada obra puede cambiarlo en Ingeniería → Optimización.
                </span>
              </div>
            </fieldset>

            <fieldset className="catalog-form__section" data-testid="settings-section-ingenieria">
              <legend className="catalog-form__section-title">
                Seccionadoras de Corte (PTX)
              </legend>
              <p className="settings-lead settings-lead--inline">
                Estándares de taller para seccionadoras CNC (SCM Gabbiani/Sigma, HOMAG/Holzma, Biesse Selco, etc.).
              </p>

              <div className="catalog-form__field">
                <label>Modo de empaquetado PTX por defecto</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                    <input
                      type="radio"
                      name="ptxExportMode"
                      value="unified"
                      checked={ptxExportMode === 'unified'}
                      onChange={() => setPtxExportMode('unified')}
                      data-testid="settings-ptx-mode-unified"
                    />
                    <span><strong>Archivo consolidado:</strong> 1 único archivo .ptx con todos los tableros y materiales.</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                    <input
                      type="radio"
                      name="ptxExportMode"
                      value="by-material"
                      checked={ptxExportMode === 'by-material'}
                      onChange={() => setPtxExportMode('by-material')}
                      data-testid="settings-ptx-mode-by-material"
                    />
                    <span><strong>Separado por material:</strong> 1 archivo .ptx independiente por cada acabado/espesor (empaquetado en .zip).</span>
                  </label>
                </div>
                <span className="settings-hint" style={{ marginTop: 6 }}>
                  Recomendado: <em>Separado por material</em> si el operador de la seccionadora procesa lotes por acabado.
                </span>
              </div>

              <div className="catalog-form__field">
                <label htmlFor="settings-saw-kerf">Espesor de disco de corte / Kerf (mm)</label>
                <input
                  id="settings-saw-kerf"
                  type="number"
                  step="0.1"
                  min="0"
                  max="20"
                  value={sawKerf}
                  onChange={(e) => setSawKerf(e.target.value)}
                  required
                  data-testid="settings-saw-kerf"
                />
                <span className="settings-hint">
                  Grosor del corte de la hoja de sierra principal (típicamente 4.4 mm en seccionadoras de vigas o 3.2 mm en escuadradoras).
                </span>
              </div>

              <div className="catalog-form__field settings-form__checkbox">
                <label
                  htmlFor="settings-deduct-edgeband"
                  className="settings-checkbox"
                >
                  <input
                    id="settings-deduct-edgeband"
                    type="checkbox"
                    checked={deductEdgeBand}
                    onChange={(e) => setDeductEdgeBand(e.target.checked)}
                    data-testid="settings-deduct-edgeband"
                  />
                  <span>Descontar espesor de tapacantos en cortes en crudo</span>
                </label>
                <span className="settings-hint">
                  Activar si la enchapadora de cantos no realiza pre-fresado (tupí) y requiere cortar las piezas reduciendo el grosor de la cinta para alcanzar la cota terminada.
                </span>
              </div>
            </fieldset>

            <fieldset className="catalog-form__section">
              <legend className="catalog-form__section-title">
                Refiles Perimetrales por Defecto (Tablero)
              </legend>
              <p className="settings-lead settings-lead--inline">
                Márgenes (mm) que se recortan en los 4 bordes del tablero bruto para sanear cantos antes de trozar piezas.
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: 12,
                }}
              >
                <div className="catalog-form__field">
                  <label htmlFor="settings-trim-top">Superior (mm)</label>
                  <input
                    id="settings-trim-top"
                    type="number"
                    min="0"
                    step="1"
                    value={trimTop}
                    onChange={(e) => setTrimTop(e.target.value)}
                    required
                    data-testid="settings-trim-top"
                  />
                </div>
                <div className="catalog-form__field">
                  <label htmlFor="settings-trim-bottom">Inferior (mm)</label>
                  <input
                    id="settings-trim-bottom"
                    type="number"
                    min="0"
                    step="1"
                    value={trimBottom}
                    onChange={(e) => setTrimBottom(e.target.value)}
                    required
                    data-testid="settings-trim-bottom"
                  />
                </div>
                <div className="catalog-form__field">
                  <label htmlFor="settings-trim-left">Izquierdo (mm)</label>
                  <input
                    id="settings-trim-left"
                    type="number"
                    min="0"
                    step="1"
                    value={trimLeft}
                    onChange={(e) => setTrimLeft(e.target.value)}
                    required
                    data-testid="settings-trim-left"
                  />
                </div>
                <div className="catalog-form__field">
                  <label htmlFor="settings-trim-right">Derecho (mm)</label>
                  <input
                    id="settings-trim-right"
                    type="number"
                    min="0"
                    step="1"
                    value={trimRight}
                    onChange={(e) => setTrimRight(e.target.value)}
                    required
                    data-testid="settings-trim-right"
                  />
                </div>
              </div>
            </fieldset>
          </>
        ) : null}

        <div className="settings-actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving}
            data-testid="settings-save"
          >
            {submitBusyLabel(saving, 'Guardar preferencias')}
          </button>
        </div>
      </form>
    </section>
  );
}
