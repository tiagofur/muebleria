/**
 * UsersScreen / TeamScreen — Panel de administración de Equipo del taller
 * (F026 / F035 / F166 / F172 #326).
 * Permite gestionar miembros del taller con roles múltiples (unión RBAC),
 * asignación de sectores de planta, invitaciones por enlace directo/WhatsApp
 * y aprobaciones pendientes.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  MinusCircle,
  RefreshCw,
  SearchX,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  MapPin,
  Mail,
  UserPlus,
  Copy,
  Check,
  Clock,
  Send,
  XCircle,
} from 'lucide-react';
import { ConfirmDialog, EmptyState, Modal, PageHeader, PageLoading, StatusChips } from '../common';
import '../catalogs/catalogs.css';
import './users.css';
import { SectorAssignment } from './SectorAssignment';
import type { ProductRole } from '@granete/domain';

export interface UserRow {
  readonly id: string;
  readonly user_id?: string;
  readonly name: string;
  readonly email: string;
  readonly role?: string;
  readonly roles?: readonly string[];
  readonly active: boolean;
  readonly created_at: string;
  readonly license_plan?: string;
  readonly license_expires_at?: string | null;
}

export interface OrgInvitationRow {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly created_at: string;
  readonly expires_at: string;
}

export type UserFilter = 'all' | 'active' | 'pending' | 'invitations';

export interface UsersScreenProps {
  readonly baseUrl: string;
  readonly token: string;
}

/** Product roles (F035) — admin assigns puesto from panel. */
const ROLES: readonly ProductRole[] = [
  'user',
  'admin',
  'vendedor',
  'gerente_ventas',
  'gerente_produccion',
  'ingeniero',
  'produccion',
  'almacen',
] as const;

/** Per-user license tiers (F166) — admin assigns plan + optional expiry. */
const LICENSE_PLANS = ['none', 'trial', 'pro'] as const;

const LICENSE_LABELS: Record<(typeof LICENSE_PLANS)[number], string> = {
  none: 'Sin licencia',
  trial: 'Prueba',
  pro: 'Pro',
};

type LicenseStatus = 'active' | 'expired' | 'none';

function licenseStatus(plan: string | undefined, expiresAt: string | null | undefined): LicenseStatus {
  if (!plan || plan === 'none') return 'none';
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
}

const LICENSE_STATUS_LABELS: Record<LicenseStatus, string> = {
  active: 'Activa',
  expired: 'Vencida',
  none: '—',
};

const ROLE_LABELS: Record<(typeof ROLES)[number], string> = {
  user: 'Sin puesto',
  admin: 'Admin',
  vendedor: 'Vendedor',
  gerente_ventas: 'Gerente de ventas',
  gerente_produccion: 'Gerente de producción',
  ingeniero: 'Ingeniero',
  produccion: 'Producción',
  almacen: 'Almacén',
};

export function UsersScreen({ baseUrl, token }: UsersScreenProps): ReactNode {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitationRow[]>([]);
  const [filter, setFilter] = useState<UserFilter>('active');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Station sector assignment
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState<string>('');
  const [selectedUserRole, setSelectedUserRole] = useState<string>('');

  // Multi-role edit modal
  const [roleEditUser, setRoleEditUser] = useState<UserRow | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<ProductRole[]>([]);

  // Invitation creation modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoles, setInviteRoles] = useState<ProductRole[]>(['vendedor']);
  const [createdInviteLink, setCreatedInviteLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const [rejectingUser, setRejectingUser] = useState<UserRow | null>(null);

  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const load = async () => {
    setLoading(true);
    try {
      // First try /api/org/team (F172)
      let teamLoaded = false;
      try {
        const res = await fetch(`${baseUrl}/org/team`, { headers });
        if (res.ok) {
          const data = (await res.json()) as UserRow[];
          setUsers(data);
          teamLoaded = true;
        }
      } catch {
        // fallback
      }

      if (!teamLoaded) {
        const res = await fetch(`${baseUrl}/admin/users`, { headers });
        if (res.ok) {
          const data = (await res.json()) as UserRow[];
          setUsers(data);
        }
      }

      // Load invitations
      try {
        const resInv = await fetch(`${baseUrl}/org/invitations`, { headers });
        if (resInv.ok) {
          const dataInv = (await resInv.json()) as OrgInvitationRow[];
          setInvitations(dataInv);
        }
      } catch {
        // ignore
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [baseUrl, token]);

  const filtered = useMemo(() => {
    if (filter === 'pending') return users.filter((u) => !u.active);
    if (filter === 'active') return users.filter((u) => u.active);
    return users;
  }, [users, filter]);

  const pendingCount = users.filter((u) => !u.active).length;

  const approve = async (id: string) => {
    setActionId(id);
    try {
      await fetch(`${baseUrl}/admin/users/${id}/approve`, { method: 'PUT', headers });
      showToast('✓ Usuario aprobado');
      await load();
    } finally {
      setActionId(null);
    }
  };

  const changeRole = async (id: string, role: string) => {
    setActionId(id);
    try {
      await fetch(`${baseUrl}/admin/users/${id}/role`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ role }),
      });
      showToast('✓ Rol actualizado');
      await load();
    } finally {
      setActionId(null);
    }
  };

  const saveMultiRoles = async (userId: string, roles: ProductRole[]) => {
    setActionId(userId);
    try {
      const res = await fetch(`${baseUrl}/org/members/${userId}/roles`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ roles }),
      });
      if (!res.ok) {
        // Fallback to legacy single-role endpoint if org endpoint not found
        const singleRole = roles[0] || 'user';
        await changeRole(userId, singleRole);
        return;
      }
      showToast('✓ Roles del miembro actualizados');
      setRoleEditUser(null);
      await load();
    } finally {
      setActionId(null);
    }
  };

  const toggleMemberActive = async (userId: string, active: boolean) => {
    setActionId(userId);
    try {
      const res = await fetch(`${baseUrl}/org/members/${userId}/active`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        throw new Error('Error al actualizar estado');
      }
      showToast(active ? '✓ Miembro reactivado' : '✓ Miembro desactivado');
      await load();
    } catch {
      showToast('No se pudo actualizar el estado del miembro');
    } finally {
      setActionId(null);
    }
  };

  const updateLicense = async (id: string, plan: string, expiresAt: string | null) => {
    setActionId(id);
    try {
      await fetch(`${baseUrl}/admin/users/${id}/license`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          license_plan: plan,
          license_expires_at: expiresAt || null,
        }),
      });
      showToast('✓ Licencia actualizada');
      await load();
    } finally {
      setActionId(null);
    }
  };

  const reject = async (id: string) => {
    setActionId(id);
    try {
      await fetch(`${baseUrl}/admin/users/${id}`, { method: 'DELETE', headers });
      showToast('✓ Usuario rechazado');
      await load();
    } finally {
      setActionId(null);
      setRejectingUser(null);
    }
  };

  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || inviteRoles.length === 0) {
      setInviteError('Email y al menos un rol son requeridos');
      return;
    }
    setInviteLoading(true);
    setInviteError(null);
    try {
      const res = await fetch(`${baseUrl}/org/invitations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: inviteEmail.trim(),
          roles: inviteRoles,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Error al crear invitación');
      }
      const data = (await res.json()) as { accept_url?: string; invitation_token?: string };
      const fullUrl = `${window.location.origin}${data.accept_url || `/accept-invitation?token=${data.invitation_token}`}`;
      setCreatedInviteLink(fullUrl);
      showToast('✓ Invitación creada');
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Error al crear invitación');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRevokeInvitation = async (id: string) => {
    setActionId(id);
    try {
      const res = await fetch(`${baseUrl}/org/invitations/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        showToast('✓ Invitación revocada');
        await load();
      }
    } finally {
      setActionId(null);
    }
  };

  const handleCopyInviteLink = () => {
    if (!createdInviteLink) return;
    void navigator.clipboard.writeText(createdInviteLink);
    setCopiedLink(true);
    showToast('✓ Enlace copiado al portapapeles');
    setTimeout(() => setCopiedLink(false), 3000);
  };

  const roleChips = (u: UserRow) => {
    const rolesList = (u.roles && u.roles.length > 0) ? u.roles : u.role ? [u.role] : ['user'];
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', alignItems: 'center' }}>
        {rolesList.map((r) => (
          <span key={r} className="meta-chip">
            {ROLE_LABELS[r as ProductRole] || r}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="catalogs-page">
      <PageHeader
        title="Usuarios"
        subtitle="Equipo del taller, asignación de roles múltiples, puestos de planta e invitaciones"
        icon={<Users size={20} strokeWidth={1.5} />}
        primaryAction={
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={() => {
              setInviteEmail('');
              setInviteRoles(['vendedor']);
              setCreatedInviteLink(null);
              setInviteError(null);
              setShowInviteModal(true);
            }}
          >
            <UserPlus size={15} /> Invitar Miembro
          </button>
        }
        secondaryActions={
          <button
            type="button"
            className="btn btn--secondary btn--small"
            aria-label="Recargar usuarios"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={14} /> Actualizar
          </button>
        }
      />

      {toast && (
        <div role="status" aria-live="polite" className="users-toast">
          {toast}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <StatusChips<UserFilter>
          options={[
            { value: 'active', label: `Miembros activos (${users.filter((u) => u.active).length})` },
            { value: 'invitations', label: `Invitaciones pendientes (${invitations.length})` },
            { value: 'all', label: `Todos los usuarios (${users.length})` },
            ...(pendingCount > 0
              ? [{ value: 'pending' as const, label: `Pendientes de aprobación (${pendingCount})` }]
              : []),
          ]}
          value={filter}
          onChange={(f) => setFilter(f)}
        />
      </div>

      {loading ? (
        <div data-testid="users-loading">
          <PageLoading label="Cargando equipo..." />
        </div>
      ) : filter === 'invitations' ? (
        /* INVITATIONS VIEW */
        invitations.length === 0 ? (
          <EmptyState
            title="Sin invitaciones pendientes"
            description="No hay invitaciones abiertas. Podés invitar a nuevos miembros con el botón 'Invitar Miembro'."
            actionLabel="Invitar Miembro"
            onAction={() => {
              setInviteEmail('');
              setInviteRoles(['vendedor']);
              setCreatedInviteLink(null);
              setInviteError(null);
              setShowInviteModal(true);
            }}
          />
        ) : (
          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Email invitado</th>
                  <th>Roles asignados</th>
                  <th>Creada</th>
                  <th>Vencimiento</th>
                  <th className="users-table__align-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <Mail size={14} style={{ color: 'var(--text-muted)' }} />
                        <span style={{ fontWeight: 600 }}>{inv.email}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                        {inv.roles.map((r) => (
                          <span key={r} className="meta-chip">
                            {ROLE_LABELS[r as ProductRole] || r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                      {new Date(inv.expires_at).toLocaleDateString()}
                    </td>
                    <td className="users-table__align-right">
                      <button
                        type="button"
                        className="btn btn--secondary btn--small"
                        onClick={() => void handleRevokeInvitation(inv.id)}
                        disabled={actionId === inv.id}
                        style={{ color: 'var(--danger)' }}
                      >
                        <XCircle size={13} /> Revocar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No hay miembros que coincidan con el filtro"
          description={
            filter === 'pending'
              ? 'No hay registros pendientes de aprobación.'
              : 'No hay usuarios en este estado.'
          }
        />
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Miembro</th>
                <th>Roles en el taller</th>
                <th>Estado</th>
                <th>Estación / Puesto</th>
                <th>Licencia</th>
                <th className="users-table__align-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const isWorking = actionId === (u.user_id || u.id);
                const pRole = (u.roles?.[0] || u.role || 'user') as ProductRole;
                const canAssignSectors =
                  (u.roles && u.roles.some((r) => r === 'produccion' || r === 'almacen')) ||
                  pRole === 'produccion' ||
                  pRole === 'almacen';

                return (
                  <tr key={u.user_id || u.id}>
                    <td>
                      <div className="users-table__name">{u.name || 'Sin nombre'}</div>
                      <div className="users-table__email">{u.email}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        {roleChips(u)}
                        <button
                          type="button"
                          className="btn btn--ghost btn--small"
                          onClick={() => {
                            setRoleEditUser(u);
                            const initialRoles = (u.roles && u.roles.length > 0)
                              ? (u.roles as ProductRole[])
                              : u.role
                                ? [u.role as ProductRole]
                                : ['user' as ProductRole];
                            setSelectedRoles(initialRoles);
                          }}
                          disabled={isWorking}
                          title="Modificar roles"
                          style={{ padding: '2px 6px' }}
                        >
                          <Settings2 size={13} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${u.active ? 'status-badge--active' : 'status-badge--open'}`}>
                        {u.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td>
                      {canAssignSectors ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--small"
                          onClick={() => {
                            setSelectedUserId(u.user_id || u.id);
                            setSelectedUserName(u.name || u.email);
                            setSelectedUserRole(pRole);
                          }}
                          disabled={isWorking}
                        >
                          <MapPin size={13} /> Estaciones
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <div className="users-license-cell">
                        <select
                          className="users-role-select"
                          value={u.license_plan || 'none'}
                          disabled={isWorking}
                          onChange={(e) =>
                            void updateLicense(u.user_id || u.id, e.target.value, u.license_expires_at || null)
                          }
                          aria-label={`Plan de licencia de ${u.name}`}
                        >
                          {LICENSE_PLANS.map((p) => (
                            <option key={p} value={p}>
                              {LICENSE_LABELS[p]}
                            </option>
                          ))}
                        </select>
                        <span
                          className={`status-badge ${
                            licenseStatus(u.license_plan, u.license_expires_at) === 'active'
                              ? 'status-badge--active'
                              : 'status-badge--open'
                          }`}
                        >
                          {LICENSE_STATUS_LABELS[licenseStatus(u.license_plan, u.license_expires_at)]}
                        </span>
                      </div>
                    </td>
                    <td className="users-table__align-right">
                      <div className="users-table__actions" style={{ justifyContent: 'flex-end' }}>
                        {!u.active ? (
                          <>
                            <button
                              type="button"
                              className="btn btn--primary btn--small"
                              onClick={() => void approve(u.user_id || u.id)}
                              disabled={isWorking}
                            >
                              <CheckCircle2 size={13} /> Aprobar
                            </button>
                            <button
                              type="button"
                              className="btn btn--secondary btn--small"
                              onClick={() => setRejectingUser(u)}
                              disabled={isWorking}
                              style={{ color: 'var(--danger)' }}
                            >
                              <Trash2 size={13} /> Rechazar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => void toggleMemberActive(u.user_id || u.id, false)}
                            disabled={isWorking}
                          >
                            <MinusCircle size={13} /> Desactivar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* SECTOR ASSIGNMENT MODAL */}
      {selectedUserId && (
        <SectorAssignment
          baseUrl={baseUrl}
          token={token}
          userId={selectedUserId}
          userName={selectedUserName}
          role={selectedUserRole as ProductRole}
          onClose={() => setSelectedUserId(null)}
        />
      )}

      {/* MULTI-ROLE EDIT MODAL */}
      <Modal
        open={roleEditUser !== null}
        onClose={() => setRoleEditUser(null)}
        title={`Roles de ${roleEditUser?.name || 'Miembro'}`}
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            Seleccioná uno o varios roles para este usuario. Las capacidades se combinan por unión de permisos (ADR-0005).
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-2)' }}>
            {ROLES.map((r) => {
              const isChecked = selectedRoles.includes(r);
              return (
                <label
                  key={r}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: isChecked ? 'var(--brand-50)' : 'var(--surface-muted)',
                    border: `1px solid ${isChecked ? 'var(--brand-300)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedRoles([...selectedRoles, r]);
                      } else {
                        setSelectedRoles(selectedRoles.filter((x) => x !== r));
                      }
                    }}
                  />
                  <span style={{ fontWeight: isChecked ? 600 : 400 }}>{ROLE_LABELS[r]}</span>
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button type="button" className="btn btn--secondary" onClick={() => setRoleEditUser(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={selectedRoles.length === 0}
              onClick={() => {
                if (roleEditUser) {
                  void saveMultiRoles(roleEditUser.user_id || roleEditUser.id, selectedRoles);
                }
              }}
            >
              Guardar Roles
            </button>
          </div>
        </div>
      </Modal>

      {/* INVITE MEMBER MODAL */}
      <Modal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Invitar Miembro al Taller"
        size="md"
      >
        {createdInviteLink ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div
              style={{
                background: 'hsl(140 60% 95%)',
                color: 'hsl(140 80% 25%)',
                border: '1px solid hsl(140 50% 80%)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)',
              }}
            >
              ✓ Invitación generada exitosamente.
            </div>

            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
              Copiá el enlace y envíaselo al miembro por WhatsApp o email para que cree su contraseña y acceda:
            </p>

            <div
              style={{
                background: 'var(--surface-muted)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                wordBreak: 'break-all',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
              }}
            >
              {createdInviteLink}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleCopyInviteLink}
              >
                {copiedLink ? <Check size={16} /> : <Copy size={16} />}
                {copiedLink ? '¡Enlace copiado!' : 'Copiar enlace para WhatsApp'}
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setShowInviteModal(false)}
              >
                Listo
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateInvitation} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {inviteError && (
              <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', margin: 0 }}>
                {inviteError}
              </p>
            )}

            <div>
              <label className="label" htmlFor="inv-email">
                Email del colaborador *
              </label>
              <input
                id="inv-email"
                type="email"
                className="input"
                required
                placeholder="colaborador@taller.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Roles a asignar *</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
                {ROLES.filter((r) => r !== 'user').map((r) => {
                  const isChecked = inviteRoles.includes(r);
                  return (
                    <label
                      key={r}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        padding: 'var(--space-2) var(--space-3)',
                        background: isChecked ? 'var(--brand-50)' : 'var(--surface-muted)',
                        border: `1px solid ${isChecked ? 'var(--brand-300)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        fontSize: 'var(--text-sm)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setInviteRoles([...inviteRoles, r]);
                          } else {
                            setInviteRoles(inviteRoles.filter((x) => x !== r));
                          }
                        }}
                      />
                      <span>{ROLE_LABELS[r]}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setShowInviteModal(false)}
                disabled={inviteLoading}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={inviteLoading || !inviteEmail.trim() || inviteRoles.length === 0}
              >
                {inviteLoading ? 'Generando...' : 'Generar Invitación'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* REJECT CONFIRM DIALOG */}
      {rejectingUser && (
        <ConfirmDialog
          open={rejectingUser !== null}
          title="Rechazar usuario"
          message={`¿Rechazar y eliminar la cuenta de ${rejectingUser.name || rejectingUser.email}?`}
          confirmLabel="Rechazar y eliminar"
          tone="danger"
          onConfirm={() => void reject(rejectingUser.user_id || rejectingUser.id)}
          onClose={() => setRejectingUser(null)}
        />
      )}
    </div>
  );
}

export { UsersScreen as TeamScreen };
