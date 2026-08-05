/**
 * Workshop settings — global defaults for new quotations (F031 / #37).
 * Presentation only; shell owns persistence.
 * Fase 8 UI: grouped sections matching nav vocabulary (Ajustes).
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { WorkshopSettings } from '@muebles/domain';
import { Settings } from 'lucide-react';
import { submitBusyLabel } from '../common';
import '../catalogs/catalogs.css';
import './settings.css';

export type SettingsScreenProps = {
  readonly settings: WorkshopSettings;
  readonly onSave: (settings: WorkshopSettings) => void;
  readonly saving?: boolean;
};

export function SettingsScreen({
  settings,
  onSave,
  saving = false,
}: SettingsScreenProps): ReactNode {
  const [margin, setMargin] = useState(String(settings.defaultMarginFactor));
  const [labor, setLabor] = useState(String(settings.defaultLaborFixedCost));
  const [currency, setCurrency] = useState(settings.defaultCurrency);
  const [vendedorCanViewCosts, setVendedorCanViewCosts] = useState(
    settings.vendedorCanViewCosts,
  );
  const [workshopName, setWorkshopName] = useState(
    settings.workshopName ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setMargin(String(settings.defaultMarginFactor));
    setLabor(String(settings.defaultLaborFixedCost));
    setCurrency(settings.defaultCurrency);
    setVendedorCanViewCosts(settings.vendedorCanViewCosts);
    setWorkshopName(settings.workshopName ?? '');
  }, [settings]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const marginFactor = Number(margin);
    const laborFixedCost = Number(labor);
    const cur = currency.trim().toUpperCase();
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
    setError(null);
    onSave({
      defaultMarginFactor: marginFactor,
      defaultLaborFixedCost: laborFixedCost,
      defaultCurrency: cur,
      vendedorCanViewCosts,
      workshopName: workshopName.trim() || undefined,
    });
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  return (
    <section className="catalog-page" aria-label="Ajustes del taller">
      <div className="catalog-page__header">
        <div>
          <h2 className="catalog-page__title">
            <Settings
              size={20}
              strokeWidth={1.5}
              aria-hidden
              className="settings-title-icon"
            />
            Ajustes
          </h2>
          <p className="page-header__subtitle">
            Defaults del taller para nuevas cotizaciones
          </p>
        </div>
      </div>

      <form
        className="catalog-form settings-form"
        onSubmit={onSubmit}
        data-testid="settings-form"
      >
        {error ? (
          <p className="catalog-form__error" role="alert">
            {error}
          </p>
        ) : null}
        {savedFlash ? (
          <p className="settings-saved" role="status" data-testid="settings-saved">
            Preferencias guardadas
          </p>
        ) : null}

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
