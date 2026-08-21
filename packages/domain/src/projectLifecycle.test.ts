import { describe, it, expect } from 'vitest';
import type { Project } from './types';
// Fixture de paridad TS↔Go (OC-010): backend-go/internal/domain/
// projectEventsParity_test.go afirma contra el mismo contracts/projectEventTypes.json.
import eventTypesContract from '../../../contracts/projectEventTypes.json';
import {
  createProjectEvent,
  appendProjectEvent,
  findLatestEvent,
  filterEventsByType,
  isEventRecorded,
  deriveCommercialStatus,
  mapLegacyStatusToCommercial,
  mapCommercialToLegacyStatus,
  deriveProjectStage,
  recordDepositReceived,
  getLatestDeposit,
  inferBackfillEvents,
  calcLifecycleKpis,
  calcBomFingerprint,
  createDesignRevision,
  getLatestDesignRevision,
  createApproval,
  getProjectApprovals,
  isCustomerApproved,
  isTechnicalApproved,
  evaluateProductionReleaseGates,
  canReleaseToProduction,
  createProductionRelease,
  getLatestProductionRelease,
  revokeProductionRelease,
  getProjectStalenessReport,
  isProjectStaleForProduction,
  createChangeOrder,
  submitChangeOrder,
  approveChangeOrder,
  rejectChangeOrder,
  cancelChangeOrder,
  getProjectChangeOrders,
  getActiveChangeOrder,
  PROJECT_EVENT_TYPES,
  isProjectEventType,
  COMMERCIAL_STATUS_LABELS_ES,
  PROJECT_STAGE_LABELS_ES,
  PROJECT_EVENT_TYPE_LABELS_ES,
  APPROVAL_STATUS_LABELS_ES,
  APPROVAL_TYPE_LABELS_ES,
  RELEASE_CHECK_LABELS_ES,
  STALENESS_REASON_LABELS_ES,
  CHANGE_ORDER_STATUS_LABELS_ES,
} from './projectLifecycle';

const BASE_PROJECT: Project = {
  id: 'prj_test_1',
  name: 'Cocina Test',
  customerId: 'cust_1',
  currency: 'USD',
  marginFactor: 1.3,
  laborFixedCost: 500,
  status: 'draft',
  items: [],
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

const FULL_READY_PROJECT: Project = {
  ...BASE_PROJECT,
  status: 'accepted',
  commercialStatus: 'won',
  surveyCompletedAt: '2026-08-05T12:00:00Z',
  items: [
    {
      id: 'item_1',
      moduleId: 'mod_1',
      quantity: 1,
      optionChoices: {},
    },
  ],
  events: [
    createProjectEvent({
      projectId: 'prj_test_1',
      type: 'deposit_received',
      payload: { amount: 1000, currency: 'USD' },
    }),
    createProjectEvent({
      projectId: 'prj_test_1',
      type: 'customer_approved',
    }),
    createProjectEvent({
      projectId: 'prj_test_1',
      type: 'engineering_approved',
    }),
  ],
};

describe('Project Lifecycle Events & Primitives (OC-010)', () => {
  it('creates valid events with defaults', () => {
    const evt = createProjectEvent({
      projectId: 'prj_test_1',
      type: 'quote_created',
      byUserId: 'usr_sales_1',
    });

    expect(evt.id).toMatch(/^evt_/);
    expect(evt.projectId).toBe('prj_test_1');
    expect(evt.type).toBe('quote_created');
    expect(evt.source).toBe('web');
    expect(evt.byUserId).toBe('usr_sales_1');
    expect(evt.at).toBeDefined();
  });

  it('appends events immutably and preserves chronological order', () => {
    const evt1 = createProjectEvent({
      projectId: 'prj_test_1',
      type: 'quote_created',
      at: '2026-08-01T10:00:00.000Z',
    });
    const evt2 = createProjectEvent({
      projectId: 'prj_test_1',
      type: 'quote_sent',
      at: '2026-08-02T14:00:00.000Z',
    });
    const evtEarlier = createProjectEvent({
      projectId: 'prj_test_1',
      type: 'survey_started',
      at: '2026-08-01T11:00:00.000Z',
    });

    let prj = appendProjectEvent(BASE_PROJECT, evt1);
    prj = appendProjectEvent(prj, evt2);
    // Insert out of chronological order to verify sorting
    prj = appendProjectEvent(prj, evtEarlier);

    expect(prj.events).toHaveLength(3);
    const evts = prj.events ?? [];
    expect(evts[0]?.type).toBe('quote_created');
    expect(evts[1]?.type).toBe('survey_started');
    expect(evts[2]?.type).toBe('quote_sent');
    expect(prj.updatedAt).toBe('2026-08-02T14:00:00.000Z');
  });

  it('finds latest event and filters by types', () => {
    const prj: Project = {
      ...BASE_PROJECT,
      events: [
        createProjectEvent({ projectId: 'prj_test_1', type: 'design_revision_created', at: '2026-08-01T10:00:00Z' }),
        createProjectEvent({ projectId: 'prj_test_1', type: 'design_submitted', at: '2026-08-02T10:00:00Z' }),
        createProjectEvent({ projectId: 'prj_test_1', type: 'design_revision_created', at: '2026-08-03T10:00:00Z' }),
      ],
    };

    const latestRev = findLatestEvent(prj, 'design_revision_created');
    expect(latestRev?.at).toBe('2026-08-03T10:00:00Z');

    const designEvts = filterEventsByType(prj, ['design_submitted']);
    expect(designEvts).toHaveLength(1);
    expect(designEvts[0]?.type).toBe('design_submitted');

    expect(isEventRecorded(prj, 'design_submitted')).toBe(true);
    expect(isEventRecorded(prj, 'production_released')).toBe(false);
  });

  it('has comprehensive Spanish display labels for all types and stages', () => {
    expect(COMMERCIAL_STATUS_LABELS_ES.draft).toBe('Borrador');
    expect(COMMERCIAL_STATUS_LABELS_ES.won).toBe('Ganado');
    expect(PROJECT_STAGE_LABELS_ES.engineering).toBe('Ingeniería');
    expect(PROJECT_STAGE_LABELS_ES.production).toBe('Producción');
    expect(PROJECT_EVENT_TYPE_LABELS_ES.production_released).toBe('Liberado a producción');
    expect(PROJECT_EVENT_TYPE_LABELS_ES.deposit_received).toBe('Anticipo recibido');
  });
});

describe('Commercial Status Derivation & Mapping (OC-011)', () => {
  it('uses explicit commercialStatus if present', () => {
    const prj: Project = { ...BASE_PROJECT, commercialStatus: 'won', status: 'draft' };
    expect(deriveCommercialStatus(prj)).toBe('won');
  });

  it('detects cancelledAt as cancelled', () => {
    const prj: Project = { ...BASE_PROJECT, cancelledAt: '2026-08-05T10:00:00Z' };
    expect(deriveCommercialStatus(prj)).toBe('cancelled');
  });

  it('derives from event stream accurately', () => {
    const pWon = appendProjectEvent(BASE_PROJECT, createProjectEvent({ projectId: '1', type: 'quote_won' }));
    expect(deriveCommercialStatus(pWon)).toBe('won');

    const pLost = appendProjectEvent(pWon, createProjectEvent({ projectId: '1', type: 'quote_lost' }));
    expect(deriveCommercialStatus(pLost)).toBe('lost');

    const pSent = appendProjectEvent(BASE_PROJECT, createProjectEvent({ projectId: '1', type: 'quote_sent' }));
    expect(deriveCommercialStatus(pSent)).toBe('sent');
  });

  it('falls back to legacy ProjectStatus when no events or commercialStatus exist', () => {
    expect(deriveCommercialStatus({ ...BASE_PROJECT, status: 'draft' })).toBe('draft');
    expect(deriveCommercialStatus({ ...BASE_PROJECT, status: 'quoted' })).toBe('sent');
    expect(deriveCommercialStatus({ ...BASE_PROJECT, status: 'accepted' })).toBe('won');
    expect(deriveCommercialStatus({ ...BASE_PROJECT, status: 'produced' })).toBe('won');
  });

  it('maps between legacy and commercial statuses bidirectionally', () => {
    expect(mapLegacyStatusToCommercial('draft')).toBe('draft');
    expect(mapLegacyStatusToCommercial('quoted')).toBe('sent');
    expect(mapLegacyStatusToCommercial('accepted')).toBe('won');
    expect(mapLegacyStatusToCommercial('produced')).toBe('won');

    expect(mapCommercialToLegacyStatus('draft')).toBe('draft');
    expect(mapCommercialToLegacyStatus('sent')).toBe('quoted');
    expect(mapCommercialToLegacyStatus('won')).toBe('accepted');
    expect(mapCommercialToLegacyStatus('lost')).toBe('draft');
    expect(mapCommercialToLegacyStatus('cancelled')).toBe('draft');
  });
});

describe('Project Stage Derivation (OC-012)', () => {
  it('derives default stage as sales for new drafts', () => {
    expect(deriveProjectStage(BASE_PROJECT)).toBe('sales');
  });

  it('derives survey stage when survey is active', () => {
    const prj = appendProjectEvent(
      BASE_PROJECT,
      createProjectEvent({ projectId: '1', type: 'survey_started' }),
    );
    expect(deriveProjectStage(prj)).toBe('survey');
  });

  it('derives design and approval stages', () => {
    let prj = appendProjectEvent(
      BASE_PROJECT,
      createProjectEvent({ projectId: '1', type: 'quote_won' }),
    );
    prj = appendProjectEvent(
      prj,
      createProjectEvent({ projectId: '1', type: 'design_revision_created' }),
    );
    expect(deriveProjectStage(prj)).toBe('design');

    prj = appendProjectEvent(
      prj,
      createProjectEvent({ projectId: '1', type: 'design_submitted' }),
    );
    expect(deriveProjectStage(prj)).toBe('approval');
  });

  it('derives engineering stage when engineering starts or design is approved', () => {
    let prj = appendProjectEvent(
      BASE_PROJECT,
      createProjectEvent({ projectId: '1', type: 'engineering_started' }),
    );
    expect(deriveProjectStage(prj)).toBe('engineering');
  });

  it('derives procurement / almacén stage when production is released', () => {
    let prj = appendProjectEvent(
      BASE_PROJECT,
      createProjectEvent({ projectId: '1', type: 'production_released' }),
    );
    expect(deriveProjectStage(prj)).toBe('procurement');
  });

  it('derives production stage when materials are ready or production started', () => {
    let prj = appendProjectEvent(
      BASE_PROJECT,
      createProjectEvent({ projectId: '1', type: 'materials_ready' }),
    );
    expect(deriveProjectStage(prj)).toBe('production');

    prj = appendProjectEvent(
      prj,
      createProjectEvent({ projectId: '1', type: 'production_started' }),
    );
    expect(deriveProjectStage(prj)).toBe('production');
  });

  it('derives shipping, installation, punch and warranty stages', () => {
    let prj = appendProjectEvent(
      BASE_PROJECT,
      createProjectEvent({ projectId: '1', type: 'shipment_loaded' }),
    );
    expect(deriveProjectStage(prj)).toBe('shipping');

    prj = appendProjectEvent(
      prj,
      createProjectEvent({ projectId: '1', type: 'installation_started' }),
    );
    expect(deriveProjectStage(prj)).toBe('installation');

    prj = appendProjectEvent(
      prj,
      createProjectEvent({ projectId: '1', type: 'punch_opened' }),
    );
    expect(deriveProjectStage(prj)).toBe('punch');

    prj = appendProjectEvent(
      prj,
      createProjectEvent({ projectId: '1', type: 'punch_closed' }),
    );
    prj = appendProjectEvent(
      prj,
      createProjectEvent({ projectId: '1', type: 'client_signed_off' }),
    );
    expect(deriveProjectStage(prj)).toBe('completed');

    prj = appendProjectEvent(
      prj,
      createProjectEvent({ projectId: '1', type: 'warranty_opened' }),
    );
    expect(deriveProjectStage(prj)).toBe('warranty');
  });
});

describe('Deposit Tracking (OC-013)', () => {
  it('records deposit received with complete payload and extracts it', () => {
    const depositData = {
      amount: 1500,
      currency: 'USD',
      paymentMethod: 'bank_transfer',
      reference: 'TX-987654',
      receiptUrl: '/receipts/tx-987654.pdf',
    };

    const updated = recordDepositReceived(
      BASE_PROJECT,
      depositData,
      'usr_admin_1',
      '2026-08-03T15:30:00.000Z',
      'web',
      'Pago anticipo 50%',
    );

    expect(updated.events).toHaveLength(1);
    const evts = updated.events ?? [];
    expect(evts[0]?.type).toBe('deposit_received');
    expect(evts[0]?.byUserId).toBe('usr_admin_1');
    expect(evts[0]?.note).toBe('Pago anticipo 50%');

    const latest = getLatestDeposit(updated);
    expect(latest).not.toBeNull();
    expect(latest?.payload.amount).toBe(1500);
    expect(latest?.payload.reference).toBe('TX-987654');
  });
});

describe('Legacy Backfill Helper (OC-010)', () => {
  it('generates grounded backfill events from legacy project fields without inventing timestamps', () => {
    const legacyProject: Project = {
      ...BASE_PROJECT,
      status: 'accepted',
      surveyCompletedAt: '2026-08-02T12:00:00Z',
      engineeringLog: {
        startedBy: 'eng_1',
        startedAt: '2026-08-03T09:00:00Z',
        generatedBy: 'eng_1',
        generatedAt: '2026-08-04T17:00:00Z',
        sentToProductionBy: 'eng_1',
        sentToProductionAt: '2026-08-05T10:00:00Z',
        revision: 1,
      },
      materialsRelease: {
        releasedBy: 'wh_1',
        releasedAt: '2026-08-06T14:00:00Z',
      },
    };

    const backfill = inferBackfillEvents(legacyProject);
    expect(backfill.length).toBeGreaterThanOrEqual(6);
    expect(backfill.every((e) => e.source === 'backfill')).toBe(true);

    const types = backfill.map((e) => e.type);
    expect(types).toContain('quote_created');
    expect(types).toContain('quote_won');
    expect(types).toContain('survey_completed');
    expect(types).toContain('engineering_started');
    expect(types).toContain('engineering_documented');
    expect(types).toContain('production_released');
    expect(types).toContain('materials_ready');
  });
});

describe('Audit-Grade Lifecycle KPIs (§12 / OC-013)', () => {
  it('calculates honest KPIs with actual origin when events exist', () => {
    const events = [
      createProjectEvent({ projectId: '1', type: 'quote_created', at: '2026-08-01T10:00:00.000Z' }),
      createProjectEvent({ projectId: '1', type: 'quote_won', at: '2026-08-03T10:00:00.000Z' }), // 48h
      createProjectEvent({ projectId: '1', type: 'deposit_received', at: '2026-08-04T10:00:00.000Z' }), // 24h from won
      createProjectEvent({ projectId: '1', type: 'engineering_started', at: '2026-08-05T10:00:00.000Z' }), // 24h wait
      createProjectEvent({ projectId: '1', type: 'production_released', at: '2026-08-08T10:00:00.000Z' }), // 72h cycle
      createProjectEvent({ projectId: '1', type: 'materials_ready', at: '2026-08-09T10:00:00.000Z' }), // 24h wait
      createProjectEvent({ projectId: '1', type: 'production_started', at: '2026-08-10T10:00:00.000Z' }),
      createProjectEvent({ projectId: '1', type: 'production_completed', at: '2026-08-15T10:00:00.000Z' }), // 120h cycle
      createProjectEvent({ projectId: '1', type: 'shipment_departed', at: '2026-08-16T10:00:00.000Z' }), // 24h wait
      createProjectEvent({ projectId: '1', type: 'installation_started', at: '2026-08-17T10:00:00.000Z' }),
      createProjectEvent({ projectId: '1', type: 'installation_completed', at: '2026-08-19T10:00:00.000Z' }), // 48h cycle
      createProjectEvent({ projectId: '1', type: 'project_closed', at: '2026-08-20T10:00:00.000Z' }), // 24h closeout
    ];

    const kpis = calcLifecycleKpis(events);

    expect(kpis.salesCycleHours.origin).toBe('actual');
    expect(kpis.salesCycleHours.value).toBe(48);

    expect(kpis.timeToDepositHours.origin).toBe('actual');
    expect(kpis.timeToDepositHours.value).toBe(24);

    expect(kpis.engineeringWaitHours.origin).toBe('actual');
    expect(kpis.engineeringWaitHours.value).toBe(24);

    expect(kpis.engineeringCycleHours.origin).toBe('actual');
    expect(kpis.engineeringCycleHours.value).toBe(72);

    expect(kpis.materialWaitHours.origin).toBe('actual');
    expect(kpis.materialWaitHours.value).toBe(24);

    expect(kpis.productionCycleHours.origin).toBe('actual');
    expect(kpis.productionCycleHours.value).toBe(120);

    expect(kpis.shippingWaitHours.origin).toBe('actual');
    expect(kpis.shippingWaitHours.value).toBe(24);

    expect(kpis.installationHours.origin).toBe('actual');
    expect(kpis.installationHours.value).toBe(48);

    expect(kpis.closeoutHours.origin).toBe('actual');
    expect(kpis.closeoutHours.value).toBe(24);

    // Total lead time: Aug 1 to Aug 20 = 19 days * 24 = 456 hours
    expect(kpis.leadTimeHours.origin).toBe('actual');
    expect(kpis.leadTimeHours.value).toBe(456);
  });

  it('returns missing provenance without inventing numbers when events are absent', () => {
    const kpis = calcLifecycleKpis([]);

    expect(kpis.salesCycleHours.origin).toBe('missing');
    expect(kpis.salesCycleHours.value).toBeNull();
    expect(kpis.timeToDepositHours.origin).toBe('missing');
    expect(kpis.engineeringWaitHours.origin).toBe('missing');
    expect(kpis.leadTimeHours.origin).toBe('missing');
  });
});

describe('DesignRevision Management (OC-020)', () => {
  it('creates design revision with BOM fingerprint, auto-incrementing revision and audit event', () => {
    const projectWithItems: Project = {
      ...BASE_PROJECT,
      items: [
        {
          id: 'item_1',
          moduleId: 'mod_base_2p',
          quantity: 2,
          optionChoices: { color: 'blanco' },
        },
      ],
    };

    const { project: p1, revision: rev1, event: ev1 } = createDesignRevision(
      projectWithItems,
      'user_designer',
      { name: 'Propuesta Inicial', description: 'Distribución en L' },
    );

    expect(rev1.revision).toBe(1);
    expect(rev1.name).toBe('Propuesta Inicial');
    expect(rev1.description).toBe('Distribución en L');
    expect(rev1.bomFingerprint).toBeTruthy();
    expect(p1.designRevisions).toHaveLength(1);
    expect(p1.events?.some((e) => e.type === 'design_revision_created')).toBe(true);
    expect(ev1.type).toBe('design_revision_created');
    expect(getLatestDesignRevision(p1)?.id).toBe(rev1.id);

    // Second revision increments number
    const { project: p2, revision: rev2 } = createDesignRevision(
      p1,
      'user_designer',
      { name: 'Ajuste de cajonera' },
    );

    expect(rev2.revision).toBe(2);
    expect(p2.designRevisions).toHaveLength(2);
    expect(getLatestDesignRevision(p2)?.id).toBe(rev2.id);
  });
});

describe('Multi-Role Approvals (OC-021)', () => {
  it('creates customer and technical approvals with proper audit events', () => {
    let prj = BASE_PROJECT;

    // Customer approval
    const resCust = createApproval(prj, {
      type: 'customer',
      status: 'approved',
      decidedBy: 'cust_user_1',
      notes: 'Aprobado diseño 3D',
    });
    prj = resCust.project;

    expect(prj.approvals).toHaveLength(1);
    expect(resCust.approval.type).toBe('customer');
    expect(resCust.approval.status).toBe('approved');
    expect(resCust.event.type).toBe('customer_approved');
    expect(isCustomerApproved(prj)).toBe(true);

    // Technical approval
    const resTech = createApproval(prj, {
      type: 'technical',
      status: 'approved_with_notes',
      decidedBy: 'eng_user_1',
      notes: 'Validado herrajes y tolerancias',
    });
    prj = resTech.project;

    expect(prj.approvals).toHaveLength(2);
    expect(resTech.approval.type).toBe('technical');
    expect(resTech.event.type).toBe('engineering_approved');
    expect(isTechnicalApproved(prj)).toBe(true);

    // Filtering approvals
    expect(getProjectApprovals(prj, 'customer')).toHaveLength(1);
    expect(getProjectApprovals(prj, 'technical')).toHaveLength(1);
    expect(getProjectApprovals(prj, 'supervisor')).toHaveLength(0);
  });

  it('correctly tracks rejection and changes requested states', () => {
    let prj = BASE_PROJECT;

    const res = createApproval(prj, {
      type: 'customer',
      status: 'changes_requested',
      decidedBy: 'cust_1',
      notes: 'Cambiar color de frentes',
    });
    prj = res.project;

    expect(res.event.type).toBe('customer_rejected');
    expect(isCustomerApproved(prj)).toBe(false);
  });
});

describe('Production Release 6 Gates & Release Execution (OC-022)', () => {
  it('evaluates all 6 gates passing on a fully prepared project', () => {
    const checks = evaluateProductionReleaseGates(FULL_READY_PROJECT, { requireSurvey: true });
    expect(checks).toHaveLength(6);
    expect(checks.every((c) => c.passed)).toBe(true);

    const gate = canReleaseToProduction(FULL_READY_PROJECT, { requireSurvey: true });
    expect(gate.allowed).toBe(true);
    expect(gate.failingChecks).toHaveLength(0);
  });

  it('blocks production release when mandatory gates fail', () => {
    // Missing deposit and missing approvals
    const incompleteProject: Project = {
      ...BASE_PROJECT,
      status: 'draft',
      items: [],
    };

    const gate = canReleaseToProduction(incompleteProject);
    expect(gate.allowed).toBe(false);
    expect(gate.failingChecks.length).toBeGreaterThanOrEqual(3);

    const failingCodes = gate.failingChecks.map((c) => c.code);
    expect(failingCodes).toContain('commercial_won');
    expect(failingCodes).toContain('deposit_received');
    expect(failingCodes).toContain('customer_approved');
    expect(failingCodes).toContain('technical_approved');
    expect(failingCodes).toContain('bom_valid');

    // Attempting to release throws descriptive error
    expect(() =>
      createProductionRelease(incompleteProject, { releasedBy: 'supervisor_1' }),
    ).toThrowError(/No se puede liberar a producción/);
  });

  it('creates production release object and event on success', () => {
    const { project: releasedProject, release, event } = createProductionRelease(
      FULL_READY_PROJECT,
      { releasedBy: 'supervisor_main', note: 'Liberación de planta autorizada' },
    );

    expect(release.id).toBeTruthy();
    expect(release.releasedBy).toBe('supervisor_main');
    expect(release.bomFingerprint).toBeTruthy();
    expect(release.checks.every((c) => c.passed)).toBe(true);
    expect(event.type).toBe('production_released');
    expect(releasedProject.productionRelease?.id).toBe(release.id);
    expect(getLatestProductionRelease(releasedProject)?.id).toBe(release.id);
  });

  it('revokes an existing production release cleanly with audit event', () => {
    const { project: releasedProject } = createProductionRelease(FULL_READY_PROJECT, {
      releasedBy: 'supervisor_1',
    });

    expect(getLatestProductionRelease(releasedProject)).toBeDefined();

    const { project: revokedProject, event: revokeEvent } = revokeProductionRelease(
      releasedProject,
      { revokedBy: 'supervisor_1', reason: 'Cambio de cliente en obra' },
    );

    expect(getLatestProductionRelease(revokedProject)).toBeUndefined();
    expect(revokeEvent.type).toBe('production_release_revoked');
    expect(revokedProject.events?.some((e) => e.type === 'production_release_revoked')).toBe(true);
  });
});

describe('OC-023: Production Staleness Detection', () => {
  it('reports unreleased project as not stale', () => {
    const report = getProjectStalenessReport(BASE_PROJECT);
    expect(report.isReleased).toBe(false);
    expect(report.isStale).toBe(false);
    expect(report.reasons).toEqual([]);
    expect(isProjectStaleForProduction(BASE_PROJECT)).toBe(false);
  });

  it('reports fresh released project as not stale', () => {
    const { project: releasedProject } = createProductionRelease(FULL_READY_PROJECT, {
      releasedBy: 'supervisor_1',
    });

    const report = getProjectStalenessReport(releasedProject);
    expect(report.isReleased).toBe(true);
    expect(report.isStale).toBe(false);
    expect(report.reasons).toEqual([]);
    expect(isProjectStaleForProduction(releasedProject)).toBe(false);
  });

  it('detects staleness when BOM items or choices change after release', () => {
    const { project: releasedProject } = createProductionRelease(FULL_READY_PROJECT, {
      releasedBy: 'supervisor_1',
    });

    // Modify quantity on released project
    const modifiedProject: Project = {
      ...releasedProject,
      items: [
        {
          ...releasedProject.items[0]!,
          quantity: 5,
        },
      ],
    };

    const report = getProjectStalenessReport(modifiedProject);
    expect(report.isReleased).toBe(true);
    expect(report.isStale).toBe(true);
    expect(report.reasons).toContain('bom_fingerprint_mismatch');
    expect(isProjectStaleForProduction(modifiedProject)).toBe(true);
  });

  it('detects staleness when release was revoked', () => {
    const { project: releasedProject } = createProductionRelease(FULL_READY_PROJECT, {
      releasedBy: 'supervisor_1',
    });
    const { project: revokedProject } = revokeProductionRelease(releasedProject, {
      revokedBy: 'supervisor_1',
      reason: 'Medidas erróneas',
    });

    const report = getProjectStalenessReport(revokedProject);
    expect(report.isReleased).toBe(false);
    expect(report.isStale).toBe(true);
    expect(report.reasons).toContain('release_revoked');
    expect(isProjectStaleForProduction(revokedProject)).toBe(true);
  });
});

describe('OC-024: Change Orders Flow', () => {
  it('creates a change order in draft status with monotonic number', () => {
    const { project: p1, changeOrder: co1, event: ev1 } = createChangeOrder(FULL_READY_PROJECT, {
      requestedBy: 'designer_1',
      reason: 'Agregar módulo especiero',
      impact: { costDelta: 1200, priceDelta: 1800, leadTimeDaysDelta: 3 },
    });

    expect(co1.id).toBeTruthy();
    expect(co1.number).toBe(1);
    expect(co1.status).toBe('draft');
    expect(co1.impact?.costDelta).toBe(1200);
    expect(ev1.type).toBe('change_order_created');
    expect(p1.changeOrders).toHaveLength(1);
    expect(getActiveChangeOrder(p1)?.id).toBe(co1.id);

    // Second change order receives number 2
    const { project: p2, changeOrder: co2 } = createChangeOrder(p1, {
      requestedBy: 'designer_1',
      reason: 'Cambio de tiradores',
    });
    expect(co2.number).toBe(2);
    expect(p2.changeOrders).toHaveLength(2);
  });

  it('submits a change order for review', () => {
    const { project: p1, changeOrder: co1 } = createChangeOrder(FULL_READY_PROJECT, {
      requestedBy: 'designer_1',
      reason: 'Ajuste de profundidad',
    });

    const { project: submittedProject, changeOrder: submittedOrder, event } = submitChangeOrder(
      p1,
      co1.id,
      { submittedBy: 'designer_1' },
    );

    expect(submittedOrder.status).toBe('submitted');
    expect(event.type).toBe('change_order_submitted');
    expect(getActiveChangeOrder(submittedProject)?.status).toBe('submitted');
  });

  it('approves a change order, bumps project version, and creates new design revision', () => {
    const initialVersion = FULL_READY_PROJECT.version ?? 1;
    const { project: p1, changeOrder: co1 } = createChangeOrder(FULL_READY_PROJECT, {
      requestedBy: 'designer_1',
      reason: 'Cambio de color frente a Nogal',
    });

    const { project: approvedProject, changeOrder: approvedOrder, revision, event } = approveChangeOrder(
      p1,
      co1.id,
      { approvedBy: 'supervisor_1', notes: 'Autorizado por el cliente vía WhatsApp' },
    );

    expect(approvedOrder.status).toBe('approved');
    expect(approvedOrder.decidedBy).toBe('supervisor_1');
    expect(approvedOrder.decisionNotes).toBe('Autorizado por el cliente vía WhatsApp');
    expect(revision).toBeDefined();
    expect(approvedOrder.newDesignRevisionId).toBe(revision?.id);
    expect(approvedProject.version).toBe(initialVersion + 1);
    expect(event.type).toBe('change_order_approved');
    expect(getProjectChangeOrders(approvedProject, 'approved')).toHaveLength(1);
    expect(getActiveChangeOrder(approvedProject)).toBeUndefined();
  });

  it('rejects a change order with reason', () => {
    const { project: p1, changeOrder: co1 } = createChangeOrder(FULL_READY_PROJECT, {
      requestedBy: 'designer_1',
      reason: 'Reducir altura general a 1800mm',
    });

    const { project: rejectedProject, changeOrder: rejectedOrder, event } = rejectChangeOrder(
      p1,
      co1.id,
      { rejectedBy: 'engineering_lead', reason: 'No cumple estándar de ergonomía de cocina' },
    );

    expect(rejectedOrder.status).toBe('rejected');
    expect(rejectedOrder.decisionNotes).toBe('No cumple estándar de ergonomía de cocina');
    expect(event.type).toBe('change_order_rejected');
    expect(getProjectChangeOrders(rejectedProject, 'rejected')).toHaveLength(1);
  });

  it('cancels a change order', () => {
    const { project: p1, changeOrder: co1 } = createChangeOrder(FULL_READY_PROJECT, {
      requestedBy: 'designer_1',
      reason: 'Solicitud cancelada por el cliente',
    });

    const { project: cancelledProject, changeOrder: cancelledOrder, event } = cancelChangeOrder(
      p1,
      co1.id,
      { cancelledBy: 'designer_1', reason: 'Cliente desistió del cambio' },
    );

    expect(cancelledOrder.status).toBe('cancelled');
    expect(event.type).toBe('change_order_cancelled');
    expect(getProjectChangeOrders(cancelledProject, 'cancelled')).toHaveLength(1);
  });
});

describe('Event type vocabulary parity TS↔Go (OC-010)', () => {
  it('PROJECT_EVENT_TYPES matches the shared contract fixture exactly', () => {
    const fixtureTypes: string[] = eventTypesContract.eventTypes;
    expect(fixtureTypes.length).toBeGreaterThan(0);

    expect([...PROJECT_EVENT_TYPES].sort()).toEqual([...fixtureTypes].sort());
  });

  it('every event type has a Spanish label (no dead vocabulary)', () => {
    for (const type of PROJECT_EVENT_TYPES) {
      expect(PROJECT_EVENT_TYPE_LABELS_ES[type], `label for ${type}`).toBeTruthy();
    }
  });

  it('isProjectEventType accepts canonical types and rejects invented ones', () => {
    expect(isProjectEventType('quote_won')).toBe(true);
    expect(isProjectEventType('warranty_opened')).toBe(true);
    for (const rejected of eventTypesContract.rejectedTypes) {
      expect(isProjectEventType(rejected)).toBe(false);
    }
    expect(isProjectEventType('pizza_delivered')).toBe(false);
    expect(isProjectEventType('')).toBe(false);
  });
});

describe('Honest KPI provenance for backfilled events (OC-006 / OC-013)', () => {
  it('marks durations resting on backfill events as proxy, not actual', () => {
    const events = [
      createProjectEvent({
        projectId: '1',
        type: 'quote_created',
        at: '2026-08-01T10:00:00.000Z',
        source: 'backfill',
      }),
      createProjectEvent({
        projectId: '1',
        type: 'quote_won',
        at: '2026-08-03T10:00:00.000Z',
        source: 'web',
      }),
    ];

    const kpis = calcLifecycleKpis(events);
    // quote_created is backfilled → the sales cycle is a proxy, never "actual".
    expect(kpis.salesCycleHours.origin).toBe('proxy');
    expect(kpis.salesCycleHours.value).toBe(48);
  });

  it('marks a metric proxy when only the later endpoint is backfilled', () => {
    const events = [
      createProjectEvent({ projectId: '1', type: 'production_started', at: '2026-08-10T10:00:00.000Z' }),
      createProjectEvent({
        projectId: '1',
        type: 'production_completed',
        at: '2026-08-15T10:00:00.000Z',
        source: 'backfill',
      }),
    ];

    const kpis = calcLifecycleKpis(events);
    expect(kpis.productionCycleHours.origin).toBe('proxy');
    expect(kpis.productionCycleHours.value).toBe(120);
  });

  it('keeps actual origin only when both endpoints were recorded live', () => {
    const events = [
      createProjectEvent({ projectId: '1', type: 'quote_created', at: '2026-08-01T10:00:00.000Z', source: 'api' }),
      createProjectEvent({ projectId: '1', type: 'quote_won', at: '2026-08-03T10:00:00.000Z', source: 'web' }),
    ];

    const kpis = calcLifecycleKpis(events);
    expect(kpis.salesCycleHours.origin).toBe('actual');
  });
});

describe('Change orders vs released production state (OC-023 + OC-024)', () => {
  it('approving a change order never silently re-releases: project goes stale until an explicit new release', () => {
    // 1. Formal release against revision 1.
    const { project: releasedProject, release } = createProductionRelease(FULL_READY_PROJECT, {
      releasedBy: 'supervisor_1',
    });
    expect(getProjectStalenessReport(releasedProject).isStale).toBe(false);

    // 2. Physical change lands in the BOM after release (quantity 1 → 3).
    const modifiedProject: Project = {
      ...releasedProject,
      items: [{ ...releasedProject.items[0]!, quantity: 3 }],
    };
    expect(isProjectStaleForProduction(modifiedProject)).toBe(true);

    // 3. A change order is requested, submitted and formally approved.
    const { project: withCo, changeOrder: co } = createChangeOrder(modifiedProject, {
      requestedBy: 'designer_1',
      reason: 'Cliente agrega 2 módulos especieros',
      impact: { priceDelta: 2400, leadTimeDaysDelta: 2 },
    });
    const { project: submitted } = submitChangeOrder(withCo, co.id, { submittedBy: 'designer_1' });
    const { project: approved, revision } = approveChangeOrder(submitted, co.id, {
      approvedBy: 'gerente_ventas_1',
      notes: 'Aprobado por cliente por WhatsApp',
    });

    // 4. Approval bumps the version and creates a new design revision…
    expect(approved.version).toBe((FULL_READY_PROJECT.version ?? 1) + 1);
    expect(revision).toBeDefined();
    // …but the OLD release still governs the floor: the project stays stale.
    const report = getProjectStalenessReport(approved);
    expect(report.isReleased).toBe(true);
    expect(report.isStale).toBe(true);
    expect(report.reasons).toContain('bom_fingerprint_mismatch');
    expect(approved.productionRelease?.id).toBe(release.id);

    // 5. Recovery requires a NEW explicit release against the new revision.
    const { project: reReleased, release: newRelease } = createProductionRelease(approved, {
      releasedBy: 'supervisor_1',
      note: 'Re-liberación tras OC aprobada',
    });
    expect(newRelease.id).not.toBe(release.id);
    expect(newRelease.designRevisionId).toBe(revision?.id);
    expect(getProjectStalenessReport(reReleased).isStale).toBe(false);
  });
});

