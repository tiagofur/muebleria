import type { ReactNode } from 'react';
import type {
  MembershipOffboardingPreview,
  MembershipReassignmentPlan,
  TeamMember,
} from '@granete/storage';
import { rolesCanReceiveMembershipReassignment, type MembershipReassignmentField } from '@granete/domain';
import { Modal } from '../common';

type ReassignmentField = keyof MembershipReassignmentPlan & MembershipReassignmentField;
const REASSIGNMENTS: readonly [keyof MembershipOffboardingPreview['inventory'], ReassignmentField, string][] = [
  ['customer_ownership_count', 'customer_owner_membership_id', 'Clientes asignados'],
  ['sales_project_ownership_count', 'sales_project_owner_membership_id', 'Proyectos comerciales asignados'],
  ['engineer_assignment_count', 'engineer_membership_id', 'Asignaciones de ingeniería'],
  ['open_warranty_assignment_count', 'warranty_technician_membership_id', 'Garantías abiertas asignadas'],
];

export function TeamOffboardingModal({ member, preview, candidates, reason, plan, error, loading, onReasonChange, onPlanChange, onReload, onClose, onConfirm }: {
  readonly member: TeamMember | null;
  readonly preview: MembershipOffboardingPreview | null;
  readonly candidates: readonly TeamMember[];
  readonly reason: string;
  readonly plan: MembershipReassignmentPlan;
  readonly error: string | null;
  readonly loading: boolean;
  readonly onReasonChange: (reason: string) => void;
  readonly onPlanChange: (field: ReassignmentField, membershipId: string) => void;
  readonly onReload: () => void;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  const required = preview ? REASSIGNMENTS.filter(([count]) => preview.inventory[count] > 0) : [];
  const blocked = (preview?.inventory.blocking_count ?? 0) > 0;
  const eligible = (field: ReassignmentField, membershipId?: string) => candidates.some((candidate) => candidate.membership_id === membershipId && rolesCanReceiveMembershipReassignment(candidate.roles, field));
  const missingTarget = required.some(([, field]) => !candidates.some((candidate) => rolesCanReceiveMembershipReassignment(candidate.roles, field)));
  const ready = preview && !blocked && reason.trim() && required.every(([, field]) => eligible(field, plan[field]));
  return (
    <Modal open={member !== null} onClose={onClose} title="Finalizar acceso al taller" size="md">
      <div className="users-modal-stack">
        <p className="users-modal-copy">{member?.name || member?.email} perderá definitivamente el acceso. Las responsabilidades deben quedar resueltas antes de continuar.</p>
        {error ? <p role="alert" className="users-form-error">{error}</p> : null}
        {!preview ? (
          <button type="button" className="btn btn--secondary" disabled={loading} onClick={onReload}>{loading ? 'Verificando impacto…' : 'Actualizar impacto'}</button>
        ) : (
          <>
            <section aria-label="Impacto de la finalización">
              <p className="users-modal-copy">Impacto verificado para la versión {preview.membership_version}.</p>
              <p>Huella de impacto: <code>{preview.impact_version}</code></p>
              <ul>
                {REASSIGNMENTS.map(([count, field, label]) => <li key={field}>{label}: {preview.inventory[count]}</li>)}
                <li>Reclamos de producción activos: {preview.inventory.active_production_claim_count}</li>
                <li>Responsabilidades a transferir: {preview.inventory.transfer_required_count}</li>
              </ul>
            </section>
            <button type="button" className="btn btn--secondary btn--small" disabled={loading} onClick={onReload}>Actualizar impacto</button>
            {blocked ? <p role="alert" className="users-form-error">Hay {preview.inventory.blocking_count} bloqueos activos. Resolvelos y actualizá el impacto.</p> : null}
            {missingTarget ? <p role="alert" className="users-form-error">No hay otra membresía activa elegible para recibir todas las responsabilidades.</p> : null}
            {required.map(([count, field, label]) => (
              <div key={field}>
                <label className="label" htmlFor={`offboard-${field}`}>Reasignar {label.toLocaleLowerCase()} ({preview.inventory[count]}) *</label>
                <select id={`offboard-${field}`} className="input" value={plan[field] ?? ''} onChange={(event) => onPlanChange(field, event.target.value)}>
                  <option value="">Seleccioná una persona</option>
                  {candidates.filter((candidate) => rolesCanReceiveMembershipReassignment(candidate.roles, field)).map((candidate) => <option key={candidate.membership_id} value={candidate.membership_id}>{candidate.name || candidate.email}</option>)}
                </select>
              </div>
            ))}
            <div><label className="label" htmlFor="offboard-reason">Motivo *</label><textarea id="offboard-reason" className="input" required value={reason} onChange={(event) => onReasonChange(event.target.value)} /></div>
          </>
        )}
        <div className="users-modal-actions users-modal-actions--flush">
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn--primary" disabled={loading || !ready} onClick={onConfirm}>Finalizar acceso</button>
        </div>
      </div>
    </Modal>
  );
}
