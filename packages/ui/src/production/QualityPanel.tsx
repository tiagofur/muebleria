/**
 * QualityPanel — per-project quality & rework work (OC-060..OC-062): open
 * issues with their rework resolutions (job costing), and the per-unit QC
 * checklist that gates packaging. The shell resolves the view
 * (`QualityPanelView`); this component only renders and dispatches actions.
 */

import { useState, type ReactNode } from 'react';
import { AlertTriangle, ClipboardCheck, ShieldAlert, Wrench } from 'lucide-react';
import {
  QUALITY_ISSUE_CATEGORY_LABELS_ES,
  QUALITY_ISSUE_STATUS_LABELS_ES,
  REWORK_ACTION_LABELS_ES,
  REWORK_ACTION_TYPES,
  QUALITY_ISSUE_CATEGORIES,
  type QcCheckCode,
  type ReworkActionType,
  type QualityIssueCategory,
  type UnitQcChecklistItem,
} from '@granete/domain';
import type { QualityPanelView } from './qualityView';
import './production.css';

export type QualityHandlers = {
  readonly onReportIssue?: (
    projectId: string,
    payload: {
      description: string;
      category: QualityIssueCategory;
      moduleUnitId?: string;
      partInstanceId?: string;
    },
  ) => void | Promise<void>;
  readonly onRework?: (
    projectId: string,
    payload: {
      issueId: string;
      action: ReworkActionType;
      reason?: string;
      partInstanceId?: string;
      materialCost?: number;
      laborMinutes?: number;
    },
  ) => void | Promise<void>;
  readonly onTransition?: (
    projectId: string,
    issueId: string,
    toStatus: 'resolved' | 'verified' | 'open',
    notes?: string,
  ) => void | Promise<void>;
  readonly onRecordQc?: (
    projectId: string,
    unitId: string,
    checklist: readonly UnitQcChecklistItem[],
  ) => void | Promise<void>;
  readonly onOverrideQc?: (projectId: string, unitId: string, reason: string) => void | Promise<void>;
};

export type QualityPanelProps = {
  readonly view: QualityPanelView;
  readonly handlers: QualityHandlers;
  readonly canManage?: boolean;
  readonly canOverride?: boolean;
  readonly testId?: string;
};

export function QualityPanel({
  view,
  handlers,
  canManage = true,
  canOverride = false,
  testId,
}: QualityPanelProps): ReactNode {
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<QualityIssueCategory>('otro');
  const [actionByIssue, setActionByIssue] = useState<Record<string, { action: ReworkActionType; reason: string; materialCost: string; laborMinutes: string }>>({});
  const [checklistByUnit, setChecklistByUnit] = useState<Record<string, Record<string, boolean>>>({});
  const [overrideByUnit, setOverrideByUnit] = useState<Record<string, string>>({});
  const [partInstanceIdByIssue, setPartInstanceIdByIssue] = useState<Record<string, string>>({});

  const issueForm = (issueId: string) =>
    actionByIssue[issueId] ?? { action: 'rework' as ReworkActionType, reason: '', materialCost: '', laborMinutes: '' };
  const setIssueForm = (issueId: string, patch: Partial<{ action: ReworkActionType; reason: string; materialCost: string; laborMinutes: string }>) =>
    setActionByIssue((prev) => ({ ...prev, [issueId]: { ...issueForm(issueId), ...patch } }));

  const pendingQcUnits = view.unitGates.filter((u) => u.status === 'module_qc');
  const unitLabel = (unitId?: string): string => {
    if (!unitId) return '';
    const gate = view.unitGates.find((g) => g.unitId === unitId);
    return gate ? `Unidad ${gate.unitIndex}` : '';
  };
  const partLabel = (partInstanceId?: string): string =>
    (partInstanceId && view.partLabelByInstance[partInstanceId]) || '';

  return (
    <div className="quality-panel" data-testid={testId ?? `quality-panel-${view.projectId}`}>
      <section className="ship-board__section" aria-label="Problemas de calidad">
        <h4 className="ship-board__section-title">
          <AlertTriangle size={14} strokeWidth={1.5} aria-hidden />
          Problemas de calidad
          <span className="ship-board__section-count">{view.openIssues.length}</span>
        </h4>

        {canManage && handlers.onReportIssue ? (
          <form
            className="ship-board__inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!description.trim()) return;
              handlers.onReportIssue?.(view.projectId, { description: description.trim(), category });
              setDescription('');
            }}
            data-testid={`quality-report-form-${view.projectId}`}
          >
            <input
              type="text"
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripción del defecto detectado"
              aria-label="Descripción del problema"
              data-testid={`quality-report-desc-${view.projectId}`}
            />
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value as QualityIssueCategory)}
              aria-label="Categoría"
              data-testid={`quality-report-category-${view.projectId}`}
            >
              {QUALITY_ISSUE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {QUALITY_ISSUE_CATEGORY_LABELS_ES[c]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn btn--small btn--primary"
              disabled={!description.trim()}
              data-testid={`quality-report-submit-${view.projectId}`}
            >
              Reportar
            </button>
          </form>
        ) : null}

        <ul className="ship-board__list">
          {view.openIssues.map((issue) => {
            const form = issueForm(issue.id);
            const needsPart = form.action !== 'accept_as_is';
            return (
              <li key={issue.id} className="ship-board__row ship-board__row--stack">
                <div className="ship-board__row-main">
                  <span className="ship-board__row-module">{issue.description}</span>
                  <span className="ship-board__row-meta">
                    <span className="status-badge status-badge--open">
                      {QUALITY_ISSUE_CATEGORY_LABELS_ES[issue.category]}
                    </span>
                    {partLabel(issue.partInstanceId)
                      ? ` · pieza ${partLabel(issue.partInstanceId)}`
                      : ''}
                    {unitLabel(issue.moduleUnitId) ? ` · ${unitLabel(issue.moduleUnitId)}` : ''}
                  </span>
                </div>
                {canManage && handlers.onRework ? (
                  <div className="ship-board__inline-form">
                    <select
                      className="input"
                      value={form.action}
                      onChange={(e) => setIssueForm(issue.id, { action: e.target.value as ReworkActionType })}
                      aria-label="Resolución"
                      data-testid={`quality-rework-action-${issue.id}`}
                    >
                      {REWORK_ACTION_TYPES.map((a) => (
                        <option key={a} value={a}>
                          {REWORK_ACTION_LABELS_ES[a]}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      className="input"
                      value={form.reason}
                      onChange={(e) => setIssueForm(issue.id, { reason: e.target.value })}
                      placeholder={form.action === 'accept_as_is' ? 'Motivo de la desviación (obligatorio)' : 'Motivo'}
                      aria-label="Motivo"
                    />
                    {needsPart ? (
                      <select
                        className="input"
                        value={partInstanceIdByIssue[issue.id] ?? issue.partInstanceId ?? ''}
                        onChange={(e) =>
                          setPartInstanceIdByIssue((prev) => ({ ...prev, [issue.id]: e.target.value }))
                        }
                        aria-label="Pieza afectada"
                        data-testid={`quality-rework-part-${issue.id}`}
                      >
                        <option value="">Pieza afectada…</option>
                        {view.partOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <input
                      type="number"
                      className="input"
                      min="0"
                      step="0.01"
                      value={form.materialCost}
                      onChange={(e) => setIssueForm(issue.id, { materialCost: e.target.value })}
                      placeholder="Costo material"
                      aria-label="Costo material afectado"
                    />
                    <input
                      type="number"
                      className="input"
                      min="0"
                      step="1"
                      value={form.laborMinutes}
                      onChange={(e) => setIssueForm(issue.id, { laborMinutes: e.target.value })}
                      placeholder="Min. trabajo"
                      aria-label="Minutos de trabajo afectados"
                    />
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      disabled={
                        (form.action === 'accept_as_is' && !form.reason.trim()) ||
                        (needsPart && !(partInstanceIdByIssue[issue.id] || issue.partInstanceId))
                      }
                      onClick={() =>
                        handlers.onRework?.(view.projectId, {
                          issueId: issue.id,
                          action: form.action,
                          reason: form.reason.trim() || undefined,
                          partInstanceId: partInstanceIdByIssue[issue.id] || issue.partInstanceId,
                          materialCost: form.materialCost ? Number(form.materialCost) : undefined,
                          laborMinutes: form.laborMinutes ? Number(form.laborMinutes) : undefined,
                        })
                      }
                      data-testid={`quality-rework-submit-${issue.id}`}
                    >
                      <Wrench size={14} strokeWidth={1.5} aria-hidden />
                      Resolver
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
          {view.openIssues.length === 0 ? (
            <li className="ship-board__row">
              <span className="ship-board__row-meta">Sin problemas abiertos</span>
            </li>
          ) : null}
        </ul>
        {view.resolvedIssues.length > 0 ? (
          <p className="ship-board__job-meta">
            {view.resolvedIssues.length} resuelto(s) · costo retrabajo: {view.reworkCost.materialCost} /{' '}
            {view.reworkCost.laborMinutes} min
          </p>
        ) : null}
      </section>

      {pendingQcUnits.length > 0 ? (
        <section className="ship-board__section" aria-label="QC por unidad">
          <h4 className="ship-board__section-title">
            <ClipboardCheck size={14} strokeWidth={1.5} aria-hidden />
            QC de unidad (antes de empaquetar)
            <span className="ship-board__section-count">{pendingQcUnits.length}</span>
          </h4>
          <ul className="ship-board__list">
            {pendingQcUnits.map((unit) => {
              const checked = checklistByUnit[unit.unitId] ?? {};
              const overrideReason = overrideByUnit[unit.unitId] ?? '';
              return (
                <li key={unit.unitId} className="ship-board__row ship-board__row--stack">
                  <div className="ship-board__row-main">
                    <span className="ship-board__row-module">Unidad {unit.unitIndex}</span>
                    <span className="ship-board__row-meta">
                      {unit.gate.ready ? (
                        <span className="status-badge status-badge--done">QC listo</span>
                      ) : (
                        <span className="status-badge status-badge--open">QC pendiente</span>
                      )}
                      {unit.overridden ? (
                        <span className="status-badge status-badge--open">Override supervisor</span>
                      ) : null}
                    </span>
                  </div>
                  {!unit.gate.ready && canManage && (handlers.onRecordQc || (canOverride && handlers.onOverrideQc)) ? (
                    <div className="ship-board__inline-form quality-panel__checklist">
                      {view.qcChecklist.map((item) => (
                        <label key={item.code} className="quality-panel__check">
                          <input
                            type="checkbox"
                            checked={checked[item.code] ?? false}
                            onChange={(e) =>
                              setChecklistByUnit((prev) => ({
                                ...prev,
                                [unit.unitId]: { ...prev[unit.unitId], [item.code]: e.target.checked },
                              }))
                            }
                            data-testid={`quality-qc-${unit.unitId}-${item.code}`}
                          />
                          {item.label}
                        </label>
                      ))}
                      {handlers.onRecordQc ? (
                      <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={!view.qcChecklist.every((item) => checked[item.code])}
                        onClick={() =>
                          handlers.onRecordQc?.(
                            view.projectId,
                            unit.unitId,
                            view.qcChecklist.map((item) => ({
                              code: item.code,
                              passed: checked[item.code] ?? false,
                            })),
                          )
                        }
                        data-testid={`quality-qc-submit-${unit.unitId}`}
                      >
                        Aprobar QC
                      </button>
                      ) : null}
                      {canOverride && handlers.onOverrideQc ? (
                        <>
                          <input
                            type="text"
                            className="input"
                            value={overrideReason}
                            onChange={(e) =>
                              setOverrideByUnit((prev) => ({ ...prev, [unit.unitId]: e.target.value }))
                            }
                            placeholder="Motivo del override (supervisión)"
                            aria-label="Motivo del override"
                            data-testid={`quality-qc-override-input-${unit.unitId}`}
                          />
                          <button
                            type="button"
                            className="btn btn--small btn--secondary"
                            disabled={!overrideReason.trim()}
                            onClick={() => {
                              handlers.onOverrideQc?.(view.projectId, unit.unitId, overrideReason.trim());
                              setOverrideByUnit((prev) => ({ ...prev, [unit.unitId]: '' }));
                            }}
                            data-testid={`quality-qc-override-${unit.unitId}`}
                          >
                            <ShieldAlert size={14} strokeWidth={1.5} aria-hidden />
                            Override
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {unit.gate.failing.length > 0 ? (
                    <p className="ship-board__row-meta">
                      {unit.gate.failing.map((c) => c.details).join(' · ')}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
