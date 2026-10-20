/**
 * #1369 slice 2 — modal «Simular cambio de receta»: simular → diff →
 * confirmar → aplicar atómico. Server authority: el diff viene del backend
 * (parseRecipeChangeSimulationResponse en el repositorio) y esta UI sólo lo
 * presenta; el apply es el PUT guardado con el If-Match de la simulación
 * (412 stale ⇒ conflicto y re-simular). Una sola primary por fase; Esc cierra
 * sin aplicar nada.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRightLeft,
  Minus,
  Plus,
  Ruler,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { Agregado, Hardware, RecipeChangeSimulationResponse } from '@granete/domain';
import { Modal } from '../../common/Modal';

/** Resultados del transporte (el store mapea errores de red/API a esta forma). */
export type RecipeSimRequest = {
  /** Id del agregado objetivo (identidad que el apply debe conservar). */
  readonly id: string;
  readonly candidate: Agregado;
  readonly params?: { readonly widthMm: number; readonly depthMm: number; readonly heightMm: number };
  readonly variantSelections?: Record<string, number>;
};

export type RecipeSimResult =
  | { readonly ok: true; readonly response: RecipeChangeSimulationResponse }
  | { readonly ok: false; readonly kind: 'invalid' | 'network'; readonly message: string };

export type RecipeApplyResult =
  | { readonly ok: true; readonly applied: Agregado }
  | { readonly ok: false; readonly kind: 'conflict' | 'not_found' | 'network'; readonly message: string };

export type RecipeChangeSimulationModalProps = {
  readonly open: boolean;
  /** El agregado guardado (objetivo del cambio); nunca el borrador del editor. */
  readonly agregado: Agregado;
  /** Catálogo de agregados: la receta base (SKU) de la que parte la candidata. */
  readonly agregados: readonly Agregado[];
  readonly catalogHardware: readonly Hardware[];
  readonly onSimulate: (req: RecipeSimRequest) => Promise<RecipeSimResult>;
  readonly onApply: (req: {
    readonly id: string;
    readonly expectedVersion: number;
    readonly candidate: Agregado;
  }) => Promise<RecipeApplyResult>;
  /** Se avisa al store, que actualiza el catálogo (readback detrás del modal). */
  readonly onApplied: (applied: Agregado) => void;
  readonly onClose: () => void;
  readonly testId?: string;
};

type Phase = 'selects' | 'simulating' | 'diff' | 'applying' | 'applied' | 'conflict';

const fmtMm = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function hardwareLabel(hardwareId: string | undefined, catalog: readonly Hardware[]): string {
  if (!hardwareId) return '—';
  const h = catalog.find((x) => x.id === hardwareId);
  return h ? `${h.code ?? h.id} · ${h.name ?? ''}`.trim() : hardwareId;
}

type ChipTone = 'ok' | 'danger' | 'warn' | 'info' | 'muted';

function chipFor(change: string): { icon: LucideIcon; label: string; tone: ChipTone } | null {
  switch (change) {
    case 'added':
      return { icon: Plus, label: 'Añadido', tone: 'ok' };
    case 'removed':
      return { icon: Minus, label: 'Quitado', tone: 'danger' };
    case 'moved':
      return { icon: ArrowRightLeft, label: 'Movido', tone: 'muted' };
    case 'resized':
      return { icon: Ruler, label: 'Redimensionado', tone: 'info' };
    case 'hardware_changed':
    case 'changed':
    case 'quantity_changed':
      return { icon: ArrowRightLeft, label: 'Cambiado', tone: 'info' };
    case 'rejected':
      return { icon: TriangleAlert, label: 'Rechazado', tone: 'warn' };
    default:
      return null;
  }
}

function Chip({ change }: { readonly change: string }) {
  const c = chipFor(change);
  if (!c) return null;
  const Icon = c.icon;
  return (
    <span className={`recipe-sim__chip recipe-sim__chip--${c.tone}`}>
      <Icon size={12} strokeWidth={1.5} aria-hidden />
      {c.label}
    </span>
  );
}

function DiffGroup({
  title,
  rows,
  note,
  children,
}: {
  readonly title: string;
  readonly rows: readonly { readonly key: string; readonly change: string }[];
  readonly note?: string;
  readonly children: ReactNode;
}): ReactNode {
  const changed = rows.filter((r) => r.change !== 'unchanged').length;
  if (changed === 0) return null;
  return (
    <details className="recipe-sim__group" open>
      <summary>
        <span className="recipe-sim__group-title">{title}</span>
        <span className="recipe-sim__group-count">{changed === 1 ? '1 cambio' : `${changed} cambios`}</span>
        {note ? <span className="recipe-sim__group-note">{note}</span> : null}
      </summary>
      <ul className="recipe-sim__rows">{children}</ul>
    </details>
  );
}

export function RecipeChangeSimulationModal({
  open,
  agregado,
  agregados,
  catalogHardware,
  onSimulate,
  onApply,
  onApplied,
  onClose,
  testId = 'recipe-change-simulation',
}: RecipeChangeSimulationModalProps): ReactNode {
  const candidates = useMemo(() => agregados.filter((a) => a.active !== false), [agregados]);
  const [baseId, setBaseId] = useState(agregado.id);
  const [kitId, setKitId] = useState<string>(agregado.commercialKitHardwareId ?? '');
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<Phase>('selects');
  const [simulated, setSimulated] = useState<RecipeChangeSimulationResponse | null>(null);
  const [banner, setBanner] = useState<{ tone: 'error' | 'conflict'; text: string } | null>(null);
  const lastRequestRef = useRef<RecipeSimRequest | null>(null);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Reabrir para OTRO agregado resetea todo el estado de la decisión. El key
  // es el id, no la identidad del objeto: tras aplicar, el store actualiza la
  // entidad y el readback cambia el prop sin querer resetear la pantalla de
  // éxito.
  useEffect(() => {
    if (open) {
      setBaseId(agregado.id);
      setKitId(agregado.commercialKitHardwareId ?? '');
      setSelections({});
      setPhase('selects');
      setSimulated(null);
      setBanner(null);
      lastRequestRef.current = null;
    }
  }, [open, agregado.id]);

  const base = useMemo(
    () => candidates.find((a) => a.id === baseId) ?? agregado,
    [candidates, baseId, agregado],
  );

  const candidate: Agregado = useMemo(
    () => ({
      ...base,
      // La identidad queda siempre en el agregado objetivo: cambiar SKU cambia
      // la receta, nunca renombra la entrada del catálogo.
      id: agregado.id,
      code: agregado.code,
      name: agregado.name,
      commercialKitHardwareId: kitId === '' ? undefined : kitId,
    }),
    [base, agregado.id, agregado.code, agregado.name, kitId],
  );

  const busy = phase === 'simulating' || phase === 'applying';

  const runSimulate = async (request: RecipeSimRequest): Promise<void> => {
    lastRequestRef.current = request;
    setPhase('simulating');
    setBanner(null);
    const res = await onSimulate(request);
    if (!openRef.current) return;
    if (!res.ok) {
      setBanner({ tone: 'error', text: res.message });
      setPhase('selects');
      return;
    }
    setSimulated(res.response);
    setPhase('diff');
  };

  // Elegir una alternativa para un set rechazado re-simula con esa selección.
  const pendingResimulate = useRef(false);
  useEffect(() => {
    if (!pendingResimulate.current) return;
    pendingResimulate.current = false;
    if (!lastRequestRef.current || !openRef.current) return;
    void runSimulate({
      ...lastRequestRef.current,
      id: lastRequestRef.current?.id ?? agregado.id,
      variantSelections: { ...selections },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections]);

  const doApply = async (): Promise<void> => {
    if (!simulated) return;
    setPhase('applying');
    setBanner(null);
    const res = await onApply({
      id: agregado.id,
      expectedVersion: simulated.currentVersion,
      candidate,
    });
    if (!openRef.current) return;
    if (res.ok) {
      // Diseño: el éxito se queda EN el modal («Receta actualizada ✓» + Listo)
      // y el toast lo lanza el store; el readback es el catálogo actualizado
      // detrás del modal.
      setPhase('applied');
      onApplied(res.applied);
      return;
    }
    // El estado anterior queda intacto: el diff sigue en pantalla y se puede
    // reintentar (red) o re-simular (conflicto de versión).
    setBanner({ tone: 'conflict', text: res.message });
    setPhase(res.kind === 'conflict' || res.kind === 'not_found' ? 'conflict' : 'diff');
  };

  // Diseño: el estado «simulación stale» pre-apply se resuelve por server
  // authority — aplicar con un If-Match viejo devuelve 412 y el flujo entra a
  // conflicto (re-simular). No hay polling que lo anticipe.
  const rejected = (simulated?.diff.variants ?? []).filter((v) => v.change === 'rejected');
  const missingPick = rejected.some(
    (v) => v.rejection && selections[v.variantSetId] === undefined && v.rejection.fittingNominals.length > 0,
  );
  const blockedFit = rejected.some((v) => v.rejection && v.rejection.fittingNominals.length === 0);
  const noChanges = simulated?.diff.state === 'no_changes';
  const partial = simulated?.diff.state === 'partially_invalid';
  const conflict = phase === 'conflict';

  let primary: { label: string; onClick: () => void; disabled: boolean; busy: boolean } | null = null;
  if (phase === 'applied') {
    primary = { label: 'Listo', onClick: onClose, disabled: false, busy: false };
  } else if (conflict) {
    primary = {
      label: 'Volver a simular',
      onClick: () => {
        setPhase('selects');
        setSimulated(null);
        setBanner(null);
        if (lastRequestRef.current) void runSimulate(lastRequestRef.current);
      },
      disabled: false,
      busy: false,
    };
  } else if (simulated && (phase === 'diff' || phase === 'applying')) {
    if (noChanges) {
      primary = { label: 'Cerrar', onClick: onClose, disabled: busy, busy };
    } else {
      primary = {
        label: phase === 'applying' ? 'Aplicando…' : 'Confirmar y aplicar',
        onClick: () => void doApply(),
        disabled: busy || partial || missingPick || blockedFit,
        busy,
      };
    }
  } else {
    primary = {
      label: phase === 'simulating' ? 'Simulando…' : 'Simular',
      onClick: () => void runSimulate({ id: agregado.id, candidate, variantSelections: { ...selections } }),
      disabled: busy,
      busy,
    };
  }

  const memberRows = (simulated?.diff.members ?? []).map((m) => ({ key: m.memberId, change: m.change, row: m }));
  const boardRows = (simulated?.diff.boards ?? []).map((b) => ({ key: b.componentId, change: b.change, row: b }));
  const consumptionRows = (simulated?.diff.consumption ?? [])
    .map((c) => ({ key: `${c.hardwareId}·${c.role}`, change: c.change, row: c }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Simular cambio de receta"
      size="lg"
      dataTestId={testId}
      footer={
        <div className="recipe-sim__footer">
          <p className="recipe-sim__consequence">
            {phase === 'applied'
              ? 'La receta quedó guardada en el servidor.'
              : noChanges
                ? 'Este cambio no altera miembros, tableros ni consumo.'
                : conflict
                  ? banner?.text
                  : 'Se cambia la receta de este agregado. Los miembros que no cambian conservan identidad y posición.'}
          </p>
          <div className="recipe-sim__actions">
            {!primary.busy && phase !== 'applied' ? (
              <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
                {simulated && !conflict && !noChanges ? 'Cancelar' : 'Cerrar'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--primary"
              onClick={primary.onClick}
              disabled={primary.disabled}
              data-testid={`${testId}-primary`}
            >
              {primary.busy ? (
                <>
                  {primary.label}
                  <span className="visually-hidden"> (aguardá un momento)</span>
                </>
              ) : (
                primary.label
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="recipe-sim" data-testid={testId}>
        <p className="recipe-sim__subtitle" data-testid={`${testId}-subtitle`}>
          {agregado.code} — {agregado.name}
        </p>

        <div className="recipe-sim__selects">
          <label className="recipe-sim__field">
            <span>Receta base (SKU)</span>
            <select
              value={baseId}
              onChange={(e) => {
                setBaseId(e.target.value);
                const next = candidates.find((a) => a.id === e.target.value);
                setKitId(next?.commercialKitHardwareId ?? '');
                setSelections({});
                // El diff mostrado corresponde a la simulación anterior:
                // aplicar otro candidato con ese If-Match sería aplicar algo
                // que el usuario no confirmó. Vuelve a simular.
                if (simulated) {
                  setSimulated(null);
                  setPhase('selects');
                }
              }}
              disabled={busy}
              data-testid={`${testId}-base-select`}
            >
              {candidates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="recipe-sim__field">
            <span>Kit comercial</span>
            <select
              value={kitId}
              onChange={(e) => {
                setKitId(e.target.value);
                if (simulated) {
                  setSimulated(null);
                  setPhase('selects');
                }
              }}
              disabled={busy}
              data-testid={`${testId}-kit-select`}
            >
              <option value="">Sin kit comercial</option>
              {catalogHardware
                .filter((h) => h.active !== false)
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.code ?? h.id} — {h.name ?? ''}
                  </option>
                ))}
            </select>
          </label>
          {(candidate.variantSets ?? []).map((set) => (
            <label key={set.id} className="recipe-sim__field">
              <span>Variante · {set.dimension}</span>
              <select
                value={selections[set.id] !== undefined ? String(selections[set.id]) : 'auto'}
                onChange={(e) => {
                  const v = e.target.value;
                  pendingResimulate.current = v !== 'auto';
                  setSelections((prev) => {
                    const next = { ...prev };
                    if (v === 'auto') delete next[set.id];
                    else next[set.id] = Number(v);
                    return next;
                  });
                }}
                disabled={busy}
                data-testid={`${testId}-variant-${set.id}`}
              >
                <option value="auto">Automático (según espacio)</option>
                {set.variants.map((v) => (
                  <option key={v.hardwareId} value={v.nominalDimensionMm}>
                    {v.nominalDimensionMm} mm — {v.hardwareId}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        {phase === 'simulating' ? (
          <p className="recipe-sim__status" role="status" data-testid={`${testId}-loading`}>
            Simulando el cambio…
          </p>
        ) : null}
        {banner && !conflict ? (
          <p
            className={banner.tone === 'error' ? 'catalog-form__error' : 'recipe-sim__conflict'}
            role="alert"
            data-testid={`${testId}-banner`}
          >
            {banner.text}
          </p>
        ) : null}

        {simulated && (phase === 'diff' || phase === 'applying' || conflict) ? (
          <div
            className={conflict ? 'recipe-sim__diff recipe-sim__diff--stale' : 'recipe-sim__diff'}
            role="region"
            aria-label="Diferencias del cambio"
            data-testid={`${testId}-diff`}
          >
            <p className="recipe-sim__live" role="status" aria-live="polite" data-testid={`${testId}-live`}>
              {conflict
                ? 'El diff mostrado corresponde a la simulación anterior.'
                : simulated.diff.summary.totalChanges === 1
                  ? 'Simulación lista: 1 cambio'
                  : `Simulación lista: ${simulated.diff.summary.totalChanges} cambios`}
            </p>

            <DiffGroup title="Miembros del agregado" rows={memberRows}>
              {memberRows
                .filter((r) => r.change !== 'unchanged')
                .map(({ key, change, row: m }) => (
                  <li key={key} className="recipe-sim__row">
                    <Chip change={change} />
                    <span className="recipe-sim__mono">{m.memberId}</span>
                    <span className="recipe-sim__row-detail">
                      {m.role}
                      {m.translationDeltaMm
                        ? ` · se mueve ${fmtMm(m.translationDeltaMm[0])} / ${fmtMm(m.translationDeltaMm[1])} / ${fmtMm(m.translationDeltaMm[2])} mm`
                        : ''}
                      {change === 'hardware_changed'
                        ? ` · ${hardwareLabel(m.hardwareIdBefore, catalogHardware)} → ${hardwareLabel(m.hardwareIdAfter, catalogHardware)}`
                        : ''}
                    </span>
                  </li>
                ))}
            </DiffGroup>

            <DiffGroup title="Tableros fabricados" rows={boardRows}>
              {boardRows
                .filter((r) => r.change !== 'unchanged')
                .map(({ key, change, row: b }) => (
                  <li key={key} className="recipe-sim__row">
                    <Chip change={change} />
                    <span className="recipe-sim__mono">{b.componentId}</span>
                    <span className="recipe-sim__row-detail">
                      {b.before && b.after && b.change === 'resized'
                        ? `${fmtMm(b.before.widthMm)} × ${fmtMm(b.before.lengthMm)} → ${fmtMm(b.after.widthMm)} × ${fmtMm(b.after.lengthMm)} mm`
                        : b.after
                          ? `${fmtMm(b.after.widthMm)} × ${fmtMm(b.after.lengthMm)} mm`
                          : ''}
                    </span>
                  </li>
                ))}
            </DiffGroup>

            {rejected.length > 0 ? (
              <DiffGroup
                title="Variantes"
                rows={rejected.map((v) => ({ key: v.variantSetId, change: v.change }))}
                note={blockedFit ? 'Sin alternativa válida' : 'Parcialmente válido'}
              >
                {rejected.map((v) => (
                  <li key={v.variantSetId} className="recipe-sim__row recipe-sim__row--column">
                    <div className="recipe-sim__row-line">
                      <Chip change="rejected" />
                      <span className="recipe-sim__mono">{v.variantSetId}</span>
                      <span className="recipe-sim__row-detail">
                        sin variante para {fmtMm(v.rejection?.requestedSpaceMm ?? 0)} mm
                      </span>
                    </div>
                    {v.rejection && v.rejection.fittingNominals.length > 0 ? (
                      <fieldset className="recipe-sim__alternatives">
                        <legend>Elegí una alternativa válida:</legend>
                        {v.rejection.fittingNominals.map((n) => (
                          <label key={n} className="recipe-sim__radio">
                            <input
                              type="radio"
                              name={`${testId}-alt-${v.variantSetId}`}
                              checked={selections[v.variantSetId] === n}
                              onChange={() => {
                                pendingResimulate.current = true;
                                setSelections((prev) => ({ ...prev, [v.variantSetId]: n }));
                              }}
                              data-testid={`${testId}-alternative-${v.variantSetId}-${n}`}
                            />
                            {fmtMm(n)} mm
                          </label>
                        ))}
                      </fieldset>
                    ) : (
                      <p className="recipe-sim__no-fit">
                        Ninguna alternativa cabe con estas dimensiones. Cambiá las medidas o la receta.
                      </p>
                    )}
                  </li>
                ))}
              </DiffGroup>
            ) : null}

            <DiffGroup title="Consumo comercial" rows={consumptionRows}>
              {consumptionRows
                .filter((r) => r.change !== 'unchanged')
                .map(({ key, change, row: c }) => (
                  <li key={key} className="recipe-sim__row">
                    <Chip change={change === 'quantity_changed' ? 'changed' : change} />
                    <span className="recipe-sim__mono">{c.hardwareId}</span>
                    <span className="recipe-sim__row-detail">
                      {c.role}
                      {change === 'quantity_changed' ? ` · ${c.quantityBefore} → ${c.quantityAfter}` : ''}
                    </span>
                  </li>
                ))}
            </DiffGroup>
          </div>
        ) : null}

        {phase === 'applied' ? (
          <p className="recipe-sim__applied" role="status" data-testid={`${testId}-applied`}>
            Receta actualizada ✓ — el catálogo quedó guardado en el servidor.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
