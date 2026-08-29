/**
 * UsersScreen / TeamScreen — Panel de administración de Equipo del taller
 * (F026 / F035 / F166 / F172 #326).
 * Permite gestionar miembros del taller con roles múltiples (unión RBAC),
 * asignación de sectores de planta, invitaciones por enlace directo/WhatsApp
 * y estado de cuenta separado del estado de membresía.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  MinusCircle,
  RefreshCw,
  SearchX,
  Settings2,
  ShieldCheck,
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
import { EmptyState, Modal, PageHeader, PageLoading, StatusChips } from '../common';
import '../catalogs/catalogs.css';
import './users.css';
import { SectorAssignment } from './SectorAssignment';
import {
  allowedRolesForOrgType,
  ASSIGNABLE_ROLES,
  roleLabelEs,
  type ProductRole,
} from '@granete/domain';
import { GraneteApiClient, GraneteApiError, type TeamMember, type Invitation } from '@granete/storage';

export type UserRow = TeamMember;
export type OrgInvitationRow = Invitation;

export type UserFilter = 'all' | 'active' | 'suspended' | 'invitations';

export interface UsersScreenProps {
  readonly baseUrl: string;
  readonly token: string;
  /**
   * Active organization type (factory/store/dealer). Store/dealer show only
   * the roles their org type may assign (#326) — mirrors the server-side
   * RolesAllowedInOrg gate.
   */
  readonly orgType?: string | null;
}

// Friendly labels come from the domain (roleLabelEs) so every surface —
// chips, modals, invitations, org picker, platform console — shows the same
// name for the same canonical role. The assignable list itself is also the
// domain's canonical ASSIGNABLE_ROLES (contract-pinned), filtered per org
// type — this screen keeps no local copy to drift out of sync.
export function UsersScreen({ baseUrl, token, orgType }: UsersScreenProps): ReactNode {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitationRow[]>([]);
  const [filter, setFilter] = useState<UserFilter>('active');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  /** Roles this organization type may assign (#326): factories use the full
   * canonical set; store/dealer are commercial-only (server re-validates). */
  const assignableRoles = useMemo(
    () =>
      ASSIGNABLE_ROLES.filter((r) =>
        allowedRolesForOrgType(orgType).includes(r),
      ),
    [orgType],
  );

  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [team, pendingInvitations] = await Promise.all([
        api.listTeam(token),
        api.listInvitations(token),
      ]);
      setUsers([...team]);
      setInvitations([...pendingInvitations]);
    } catch {
      setLoadError('No se pudo cargar el equipo. Revisá tu conexión y volvé a intentar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [baseUrl, token]);

  const filtered = useMemo(() => {
    if (filter === 'suspended') return users.filter((u) => !u.membership_active);
    if (filter === 'active') return users.filter((u) => u.membership_active);
    return users;
  }, [users, filter]);

  const suspendedCount = users.filter((u) => !u.membership_active).length;

  const saveMultiRoles = async (userId: string, roles: ProductRole[]) => {
    setActionId(userId);
    try {
      const member = users.find((candidate) => candidate.user_id === userId);
      if (!member) throw new Error('Miembro no encontrado');
      await api.updateMemberRoles(token, userId, member.version, { roles });
      showToast('✓ Roles del miembro actualizados');
      setRoleEditUser(null);
      await load();
    } catch (error) {
      showToast(error instanceof GraneteApiError && error.code === 'MEMBERSHIP_VERSION_CONFLICT'
        ? 'La membresía cambió en otra sesión. Actualizá e intentá de nuevo.'
        : 'No se pudieron guardar los roles. Revisá tu conexión.');
    } finally {
      setActionId(null);
    }
  };

  const toggleMemberActive = async (userId: string, active: boolean) => {
    setActionId(userId);
    try {
      const member = users.find((candidate) => candidate.user_id === userId);
      if (!member) throw new Error('Miembro no encontrado');
      await api.updateMemberActive(token, userId, member.version, { active });
      showToast(active ? '✓ Miembro reactivado' : '✓ Miembro desactivado');
      await load();
    } catch {
      showToast('No se pudo actualizar el estado del miembro');
    } finally {
      setActionId(null);
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
      const data = await api.createInvitation(token, {
          email: inviteEmail.trim(),
          roles: inviteRoles,
      });
      const fullUrl = `${window.location.origin}${data.accept_url}`;
      setCreatedInviteLink(fullUrl);
      showToast('✓ Invitación creada');
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Error al crear invitación');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRevokeInvitation = async (invitation: Invitation) => {
    setActionId(invitation.id);
    try {
      await api.revokeInvitation(token, invitation.id, invitation.version);
      showToast('✓ Invitación revocada');
      await load();
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
    const rolesList = u.roles.length > 0 ? u.roles : ['user'];
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', alignItems: 'center' }}>
        {rolesList.map((r) => (
          <span key={r} className="meta-chip">
            {roleLabelEs(r)}
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
            { value: 'active', label: `Membresías activas (${users.filter((u) => u.membership_active).length})` },
            { value: 'invitations', label: `Invitaciones pendientes (${invitations.length})` },
            { value: 'all', label: `Todo el equipo (${users.length})` },
            ...(suspendedCount > 0
              ? [{ value: 'suspended' as const, label: `Membresías suspendidas (${suspendedCount})` }]
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
      ) : loadError ? (
        <EmptyState
          title="No se pudo cargar el equipo"
          description={loadError}
          actionLabel="Reintentar"
          onAction={() => void load()}
        />
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
                            {roleLabelEs(r)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                      {new Date(inv.expires_at).toLocaleDateString()}{' '}
                      {new Date(inv.expires_at).getTime() <= Date.now() ? (
                        <span className="status-badge status-badge--open">Vencida</span>
                      ) : (
                        <span className="status-badge status-badge--active">Pendiente</span>
                      )}
                    </td>
                    <td className="users-table__align-right">
                      <button
                        type="button"
                        className="btn btn--secondary btn--small"
                        onClick={() => void handleRevokeInvitation(inv)}
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
            filter === 'suspended'
              ? 'No hay membresías suspendidas.'
              : 'No hay miembros en este estado.'
          }
        />
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Miembro</th>
                <th>Roles en el taller</th>
                <th>Estado de cuenta</th>
                <th>Estado de membresía</th>
                <th>Estación / Puesto</th>
                <th className="users-table__align-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const isWorking = actionId === u.user_id;
                const pRole = (u.roles[0] || 'user') as ProductRole;
                const canAssignSectors =
                  (u.roles && u.roles.some((r) => r === 'produccion' || r === 'almacen')) ||
                  pRole === 'produccion' ||
                  pRole === 'almacen';

                return (
                  <tr key={u.user_id}>
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
                            const initialRoles = u.roles.length > 0
                              ? (u.roles as ProductRole[])
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
                      <span className={`status-badge ${u.account_active ? 'status-badge--active' : 'status-badge--open'}`}>
                        {u.account_active ? 'Cuenta activa' : 'Cuenta inactiva'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${u.membership_active ? 'status-badge--active' : 'status-badge--open'}`}>
                        {u.membership_active ? 'Membresía activa' : 'Membresía suspendida'}
                      </span>
                    </td>
                    <td>
                      {canAssignSectors ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--small"
                          onClick={() => {
                            setSelectedUserId(u.user_id);
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
                    
                    <td className="users-table__align-right">
                      <div className="users-table__actions" style={{ justifyContent: 'flex-end' }}>
                        {!u.membership_active ? (
                          <button
                            type="button"
                            className="btn btn--primary btn--small"
                            onClick={() => void toggleMemberActive(u.user_id, true)}
                            disabled={isWorking || !u.account_active}
                            title={!u.account_active ? 'La cuenta global está inactiva' : undefined}
                          >
                            <CheckCircle2 size={13} /> Reactivar membresía
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => void toggleMemberActive(u.user_id, false)}
                            disabled={isWorking}
                          >
                            <MinusCircle size={13} /> Suspender membresía
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

          {(orgType === 'store' || orgType === 'dealer') && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
              Este taller es comercial: sólo puede asignar roles de ventas y coordinación.
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-2)' }}>
            {assignableRoles.map((r) => {
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
                  <span style={{ fontWeight: isChecked ? 600 : 400 }}>{roleLabelEs(r)}</span>
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
                  void saveMultiRoles(roleEditUser.user_id, selectedRoles);
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
                background: 'var(--success-50, var(--surface-muted))',
                color: 'var(--success-700, var(--text-primary))',
                border: '1px solid var(--success-500, var(--border))',
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
                {assignableRoles.filter((r) => r !== 'user').map((r) => {
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
                      <span>{roleLabelEs(r)}</span>
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

    </div>
  );
}

export { UsersScreen as TeamScreen };
