/**
 * #1651 — Actualizar precios del catálogo: ajuste por porcentaje (con filtro
 * de categoría y fabricante/marca) o lista del proveedor (XLSX/CSV). El
 * servidor calcula la vista previa y aplica todo o nada; si algún precio
 * cambió mientras tanto, no se aplica nada y se pide volver a previsualizar.
 * Las cotizaciones ya aceptadas no cambian: tienen sus precios congelados.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  GraneteApiClient,
  GraneteApiError,
  type PriceResourceKind,
  type PriceUpdatePreview,
} from '@granete/storage';
import { Modal } from '../../common/Modal';
import './prices.css';

export interface PriceListReader {
  readonly read: (file: File) => Promise<{
    readonly headers: readonly string[];
    readonly rows: readonly { readonly line: number; readonly cells: readonly string[] }[];
  }>;
  readonly parseNumber: (raw: string) => number | null;
  readonly guessColumns: (headers: readonly string[]) => { code: number; price: number };
}

export interface BulkPriceUpdateDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly baseUrl: string;
  readonly token: string;
  readonly kind: PriceResourceKind;
  /** «materiales», «cantos», «herrajes». */
  readonly kindLabel: string;
  readonly priceUnitLabel: string;
  readonly categories?: readonly { readonly id: string; readonly name: string }[];
  readonly groups?: readonly string[];
  readonly groupLabel?: string;
  readonly reader: PriceListReader;
  /** Called after a successful apply (e.g. reload the catalog). */
  readonly onApplied: (applied: number) => void | Promise<void>;
}

type Mode = 'percent' | 'import';

function money(v: number): string {
  return v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function variation(current: number, next: number): string {
  if (current === 0) return '—';
  const pct = ((next - current) / current) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function newIntentKey(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `prices-${id}`;
}

export function BulkPriceUpdateDialog({
  open,
  onClose,
  baseUrl,
  token,
  kind,
  kindLabel,
  priceUnitLabel,
  categories = [],
  groups = [],
  groupLabel = 'Fabricante',
  reader,
  onApplied,
}: BulkPriceUpdateDialogProps): ReactNode {
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);
  const [mode, setMode] = useState<Mode>('percent');
  const [percent, setPercent] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [group, setGroup] = useState('');
  const [file, setFile] = useState<{ name: string; headers: readonly string[]; rows: readonly { line: number; cells: readonly string[] }[] } | null>(null);
  const [codeCol, setCodeCol] = useState(-1);
  const [priceCol, setPriceCol] = useState(-1);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<PriceUpdatePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const applyKey = useRef<string | null>(null);

  const reset = () => {
    setPreview(null);
    setError(null);
    setStale(false);
    applyKey.current = null;
  };

  const close = () => {
    reset();
    setFile(null);
    setPercent('');
    setNote('');
    onClose();
  };

  const onFile = async (f: File | undefined) => {
    reset();
    if (!f) return;
    setBusy(true);
    try {
      const parsed = await reader.read(f);
      const guess = reader.guessColumns(parsed.headers);
      setFile({ name: f.name, headers: parsed.headers, rows: parsed.rows });
      setCodeCol(guess.code);
      setPriceCol(guess.price);
      if (parsed.rows.length === 0) setError('El archivo no tiene filas debajo del encabezado.');
    } catch (err) {
      setFile(null);
      setError(err instanceof Error ? err.message : 'No se pudo leer el archivo.');
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    reset();
    setBusy(true);
    try {
      if (mode === 'percent') {
        const value = reader.parseNumber(percent);
        if (value === null || value === 0) throw new Error('Indicá un porcentaje distinto de cero (por ejemplo 12,5 o -5).');
        setPreview(
          await api.previewCatalogPriceUpdate(token, {
            kind,
            mode: 'percent',
            percent: value,
            filter: { ...(categoryId ? { categoryId } : {}), ...(group ? { group } : {}) },
          }),
        );
      } else {
        if (!file || codeCol < 0 || priceCol < 0) throw new Error('Elegí el archivo y las columnas de código y precio.');
        const rows = file.rows.map((r) => {
          const price = reader.parseNumber(r.cells[priceCol] ?? '');
          return { line: r.line, code: (r.cells[codeCol] ?? '').slice(0, 100), ...(price !== null ? { price } : {}) };
        });
        setPreview(await api.previewCatalogPriceUpdate(token, { kind, mode: 'import', rows }));
      }
    } catch (err) {
      setError(err instanceof GraneteApiError ? err.message : err instanceof Error ? err.message : 'No se pudo previsualizar.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview || preview.changed.length === 0) return;
    setBusy(true);
    setError(null);
    applyKey.current ??= newIntentKey();
    try {
      const result = await api.applyCatalogPriceUpdate(
        token,
        {
          kind,
          source: mode,
          ...(mode === 'percent' && reader.parseNumber(percent) !== null ? { percent: reader.parseNumber(percent)! } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          items: preview.changed.map((c) => ({ id: c.id, expectedVersion: c.version, newPrice: c.newPrice })),
        },
        applyKey.current,
      );
      await onApplied(result.applied);
      close();
    } catch (err) {
      if (err instanceof GraneteApiError && err.status === 412) {
        setStale(true);
        setError('Algunos precios cambiaron desde la vista previa. No se aplicó ningún cambio: volvé a previsualizar.');
        applyKey.current = null;
      } else if (err instanceof GraneteApiError && err.status === 403) {
        setError('No tenés permiso para cambiar precios del catálogo.');
      } else {
        setError('No se aplicaron los cambios. Revisá tu conexión e intentá de nuevo.');
      }
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <div className="bulk-prices__footer">
      <button type="button" className="btn btn--ghost" onClick={close} disabled={busy}>
        Cancelar
      </button>
      {preview && !stale ? (
        <button
          type="button"
          className="btn btn--primary"
          data-testid="btn-apply-prices"
          onClick={() => void apply()}
          disabled={busy || preview.changed.length === 0}
        >
          {busy ? 'Aplicando…' : `Aplicar ${preview.changed.length} cambio(s)`}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--primary"
          data-testid="btn-preview-prices"
          onClick={() => void runPreview()}
          disabled={busy}
        >
          {busy ? 'Calculando…' : 'Previsualizar'}
        </button>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={close} title={`Actualizar precios de ${kindLabel}`} size="lg" footer={footer} dataTestId="bulk-prices-dialog">
      <div className="bulk-prices">
        <div className="bulk-prices__modes" role="radiogroup" aria-label="Forma de actualizar">
          <label>
            <input type="radio" name="bulk-prices-mode" checked={mode === 'percent'} onChange={() => { setMode('percent'); reset(); }} />
            Ajustar por porcentaje
          </label>
          <label>
            <input type="radio" name="bulk-prices-mode" checked={mode === 'import'} onChange={() => { setMode('import'); reset(); }} />
            Importar lista del proveedor (.xlsx o .csv)
          </label>
        </div>

        {mode === 'percent' ? (
          <div className="bulk-prices__grid">
            <label className="form-label" htmlFor="bulk-prices-percent">
              Porcentaje
            </label>
            <input
              id="bulk-prices-percent"
              className="form-input"
              inputMode="decimal"
              placeholder="Ej.: 12,5 o -5"
              value={percent}
              onChange={(e) => { setPercent(e.target.value); reset(); }}
            />
            {categories.length > 0 ? (
              <>
                <label className="form-label" htmlFor="bulk-prices-category">
                  Categoría
                </label>
                <select id="bulk-prices-category" className="form-select" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); reset(); }}>
                  <option value="">Todas</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            {groups.length > 0 ? (
              <>
                <label className="form-label" htmlFor="bulk-prices-group">
                  {groupLabel}
                </label>
                <select id="bulk-prices-group" className="form-select" value={group} onChange={(e) => { setGroup(e.target.value); reset(); }}>
                  <option value="">Todos</option>
                  {groups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
          </div>
        ) : (
          <div className="bulk-prices__grid">
            <label className="form-label" htmlFor="bulk-prices-file">
              Archivo
            </label>
            <input
              id="bulk-prices-file"
              type="file"
              accept=".xlsx,.csv,.txt"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {file && file.headers.length > 0 ? (
              <>
                <label className="form-label" htmlFor="bulk-prices-code-col">
                  Columna de código
                </label>
                <select id="bulk-prices-code-col" className="form-select" value={codeCol} onChange={(e) => { setCodeCol(Number(e.target.value)); reset(); }}>
                  <option value={-1}>Elegí…</option>
                  {file.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Columna ${i + 1}`}
                    </option>
                  ))}
                </select>
                <label className="form-label" htmlFor="bulk-prices-price-col">
                  Columna de precio ({priceUnitLabel})
                </label>
                <select id="bulk-prices-price-col" className="form-select" value={priceCol} onChange={(e) => { setPriceCol(Number(e.target.value)); reset(); }}>
                  <option value={-1}>Elegí…</option>
                  {file.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Columna ${i + 1}`}
                    </option>
                  ))}
                </select>
                <p className="bulk-prices__muted">
                  {file.rows.length} fila(s) en «{file.name}». Se empareja sólo por código exacto; los códigos que no existen no se crean.
                </p>
              </>
            ) : null}
          </div>
        )}

        {error ? (
          <p className="bulk-prices__error" role="alert" data-testid="bulk-prices-error">
            {error}
          </p>
        ) : null}

        {preview ? (
          <div className="bulk-prices__preview" data-testid="bulk-prices-preview">
            <ul className="bulk-prices__counts" aria-label="Resumen de la vista previa">
              <li data-testid="count-changed">
                <strong>{preview.changed.length}</strong> cambian
              </li>
              <li data-testid="count-unchanged">
                <strong>{preview.unchanged.length}</strong> quedan igual
              </li>
              {mode === 'import' ? (
                <>
                  <li data-testid="count-not-found">
                    <strong>{preview.notFound.length}</strong> códigos no encontrados
                  </li>
                  <li data-testid="count-invalid">
                    <strong>{preview.invalid.length}</strong> filas inválidas
                  </li>
                </>
              ) : null}
            </ul>
            {preview.changed.length > 0 ? (
              <div className="bulk-prices__table-wrap">
                <table className="bulk-prices__table">
                  <thead>
                    <tr>
                      <th scope="col">Código</th>
                      <th scope="col">Nombre</th>
                      <th scope="col" className="bulk-prices__num">
                        Actual
                      </th>
                      <th scope="col" className="bulk-prices__num">
                        Nuevo
                      </th>
                      <th scope="col" className="bulk-prices__num">
                        Variación
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.changed.map((c) => (
                      <tr key={c.id} data-testid={`price-change-${c.code}`}>
                        <td>{c.code}</td>
                        <td>{c.name}</td>
                        <td className="bulk-prices__num">{money(c.currentPrice)}</td>
                        <td className="bulk-prices__num">{money(c.newPrice)}</td>
                        <td className="bulk-prices__num">{variation(c.currentPrice, c.newPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="bulk-prices__muted">No hay precios para cambiar con estos datos.</p>
            )}
            {[...preview.notFound, ...preview.invalid].length > 0 ? (
              <details className="bulk-prices__issues">
                <summary>Ver filas que no se aplican</summary>
                <ul>
                  {[...preview.notFound, ...preview.invalid].map((issue) => (
                    <li key={`${issue.line}-${issue.code ?? ''}`}>
                      Fila {issue.line}
                      {issue.code ? ` · ${issue.code}` : ''}: {issue.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {preview.changed.length > 0 && !stale ? (
              <>
                <label className="form-label" htmlFor="bulk-prices-note">
                  Nota (opcional)
                </label>
                <input
                  id="bulk-prices-note"
                  className="form-input"
                  maxLength={500}
                  placeholder="Ej.: lista de octubre del proveedor"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <p className="bulk-prices__muted">
                  Las cotizaciones ya aceptadas no cambian: conservan sus precios congelados. Las nuevas cotizaciones usan los
                  precios nuevos.
                </p>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
