/**
 * Workshop settings — global defaults for new quotations (F031 / #37).
 * Presentation only; shell owns persistence.
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
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setMargin(String(settings.defaultMarginFactor));
    setLabor(String(settings.defaultLaborFixedCost));
    setCurrency(settings.defaultCurrency);
    setVendedorCanViewCosts(settings.vendedorCanViewCosts);
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
    });
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  return (
    <section className="catalog-page" aria-label="Ajustes del taller">
      <div className="catalog-page__header">
        <h2 className="catalog-page__title">
          <Settings
            size={20}
            strokeWidth={1.5}
            aria-hidden
            className="settings-title-icon"
          />
          Ajustes
        </h2>
      </div>

      <p className="settings-lead">
        Defaults para <strong>nuevas cotizaciones</strong>. No cambian proyectos
        ya creados.
      </p>

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
          <p className="settings-saved" role="status">
            ✓ Preferencias guardadas
          </p>
        ) : null}

        <div className="catalog-form__field">
          <label htmlFor="settings-margin">Factor de margen por defecto</label>
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
          <label htmlFor="settings-labor">Mano de obra fija por defecto</label>
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
          <label htmlFor="settings-currency">Moneda por defecto</label>
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

        <div className="catalog-form__field settings-form__checkbox">
          <label htmlFor="settings-vendedor-costs" className="settings-checkbox">
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
            Por defecto el vendedor solo ve precio de venta (COST-01). Activá esto
            si el taller quiere que vea unitarios, margen y desglose.
          </span>
        </div>

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
