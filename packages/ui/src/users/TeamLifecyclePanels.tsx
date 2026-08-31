import type { ReactNode } from 'react';
import {
  effectivePermissionPreviewForRoles,
  type EffectivePermissionCategory,
  type ProductRole,
} from '@granete/domain';
import type { TeamMember } from '@granete/storage';
import { Modal } from '../common';

const PERMISSION_LABELS: Readonly<Record<EffectivePermissionCategory, string>> = {
  quotes: 'Ver cotizaciones', sales_team: 'Administrar el equipo de ventas',
  catalog_mutation: 'Modificar catálogos y muebles', production: 'Acceder a producción',
  costs: 'Ver costos internos', assign_admin: 'Asignar administradores',
  transfer_admin: 'Transferir administración', revoke_sessions: 'Revocar sesiones',
};

export function RolePermissionPreview({
  roles,
  organizationType,
}: {
  readonly roles: readonly ProductRole[];
  readonly organizationType?: string | null;
}): ReactNode {
  const preview = effectivePermissionPreviewForRoles(roles, organizationType);
  return (
    <section aria-label="Vista previa de permisos">
      <p className="users-modal-copy">Permisos efectivos de la combinación seleccionada:</p>
      <ul>
        {Object.entries(preview.permissions).map(([category, allowed]) => (
          <li key={category}>{allowed ? 'Permitido' : 'No permitido'}: {PERMISSION_LABELS[category as EffectivePermissionCategory]}</li>
        ))}
      </ul>
      {preview.warnings.includes('sales_cost_visibility') ? <p role="note">Atención: esta combinación permite ver costos internos junto con cotizaciones.</p> : null}
      {preview.warnings.includes('organization_administration') ? <p role="note">Acceso sensible: puede administrar credenciales o administradores del taller.</p> : null}
    </section>
  );
}

export function AdminTransferModal({
  source,
  candidates,
  targetId,
  reason,
  error,
  busy,
  onTargetChange,
  onReasonChange,
  onClose,
  onReload,
  onConfirm,
}: {
  readonly source: TeamMember | null;
  readonly candidates: readonly TeamMember[];
  readonly targetId: string;
  readonly reason: string;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onTargetChange: (id: string) => void;
  readonly onReasonChange: (reason: string) => void;
  readonly onClose: () => void;
  readonly onReload: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  return (
    <Modal open={source !== null} onClose={onClose} title="Transferir administración" size="sm">
      <div className="users-modal-stack">
        <p className="users-modal-copy">
          El taller debe conservar al menos una persona administradora. Transferí la administración y luego volvé a intentar el cambio original.
        </p>
        {error ? (
          <div>
            <p role="alert" className="users-form-error">{error}</p>
            <button type="button" className="btn btn--secondary btn--small" onClick={onReload}>Actualizar equipo</button>
          </div>
        ) : null}
        {candidates.length === 0 ? (
          <p role="alert" className="users-form-error">No hay otra membresía activa elegible para recibir la administración.</p>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="transfer-admin-target">Nueva persona administradora *</label>
              <select id="transfer-admin-target" className="input" value={targetId} onChange={(event) => onTargetChange(event.target.value)}>
                <option value="">Seleccioná una persona</option>
                {candidates.map((member) => <option key={member.membership_id} value={member.membership_id}>{member.name || member.email}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="transfer-admin-reason">Motivo *</label>
              <textarea id="transfer-admin-reason" className="input" required value={reason} onChange={(event) => onReasonChange(event.target.value)} />
            </div>
          </>
        )}
        <div className="users-modal-actions users-modal-actions--flush">
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn--primary" disabled={busy || !targetId || !reason.trim()} onClick={onConfirm}>Transferir administración</button>
        </div>
      </div>
    </Modal>
  );
}
