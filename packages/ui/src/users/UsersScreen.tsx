/**
 * UsersScreen / TeamScreen — Panel de administración de Equipo del taller
 * (F026 / F035 / F166 / F172 #326).
 * Permite gestionar miembros del taller con roles múltiples (unión RBAC),
 * invitaciones por enlace directo y estado de cuenta separado del estado de
 * membresía.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import {
  CheckCircle2,
  MinusCircle,
  RefreshCw,
  Settings2,
  Users,
  Mail,
  UserPlus,
  Copy,
  Check,
  XCircle,
} from 'lucide-react';
import { EmptyState, Modal, PageHeader, PageLoading, StatusChips } from '../common';
import { MODAL_CLOSE_MS } from '../common/Modal';
import { AdminTransferModal, RolePermissionPreview } from './TeamLifecyclePanels';
import '../catalogs/catalogs.css';
import './users.css';
import {
  allowedRolesForOrgType,
  ASSIGNABLE_ROLES,
  roleLabelEs,
  type ProductRole,
} from '@granete/domain';
import {
  GraneteApiClient,
  GraneteApiError,
  type TeamCapability,
  type TeamDirectory,
  type TeamMember,
  type Invitation,
} from '@granete/storage';

export type UserRow = TeamMember;
export type OrgInvitationRow = Invitation;

export type UserFilter = 'all' | 'active' | 'suspended' | 'left' | 'invitations';

export interface UsersScreenProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly queryKeys: {
    readonly root: QueryKey;
    readonly team: QueryKey;
    readonly invitations: QueryKey;
  };
  /**
   * Active organization type (factory/store/dealer). Store/dealer show only
   * the roles their org type may assign (#326) — mirrors the server-side
   * RolesAllowedInOrg gate.
   */
  readonly orgType?: string | null;
}

const SALES_TEAM_ROLES: readonly ProductRole[] = ['vendedor'];
const PRODUCTION_TEAM_ROLES: readonly ProductRole[] = ['produccion', 'almacen'];
const SALES_INVITATION_ROLES: readonly ProductRole[] = ['vendedor', 'gerente_ventas'];
const PRODUCTION_INVITATION_ROLES: readonly ProductRole[] = [
  'gerente_produccion',
  'ingeniero',
  'produccion',
  'almacen',
];

function hasCapability(
  capabilities: readonly TeamCapability[],
  capability: TeamCapability,
): boolean {
  return capabilities.includes(capability);
}

function canManageRoleSet(
  capabilities: readonly TeamCapability[],
  roles: readonly string[],
): boolean {
  if (roles.length === 0) return false;
  if (hasCapability(capabilities, 'team:manage:all')) return true;

  return roles.every((role) =>
    (SALES_TEAM_ROLES.includes(role as ProductRole)
      && hasCapability(capabilities, 'team:manage:sales'))
    || (PRODUCTION_TEAM_ROLES.includes(role as ProductRole)
      && hasCapability(capabilities, 'team:manage:production')),
  );
}

function canAssignRoleSet(
  capabilities: readonly TeamCapability[],
  roles: readonly string[],
): boolean {
  return canManageRoleSet(capabilities, roles)
    && (!roles.includes('admin') || hasCapability(capabilities, 'team:assign:admin'));
}

function canInviteRoleSet(
  capabilities: readonly TeamCapability[],
  roles: readonly string[],
): boolean {
  if (roles.length === 0) return false;
  const canInviteAny = hasCapability(capabilities, 'team:invite:sales')
    || hasCapability(capabilities, 'team:invite:production');

  return roles.every((role) => {
    if (role === 'admin') {
      return canInviteAny
        && hasCapability(capabilities, 'team:manage:all')
        && hasCapability(capabilities, 'team:assign:admin');
    }
    if (SALES_INVITATION_ROLES.includes(role as ProductRole)) {
      return hasCapability(capabilities, 'team:invite:sales')
        && (hasCapability(capabilities, 'team:manage:all')
          || SALES_TEAM_ROLES.includes(role as ProductRole));
    }
    if (PRODUCTION_INVITATION_ROLES.includes(role as ProductRole)) {
      return hasCapability(capabilities, 'team:invite:production')
        && (hasCapability(capabilities, 'team:manage:all')
          || PRODUCTION_TEAM_ROLES.includes(role as ProductRole));
    }
    return false;
  });
}

// Friendly labels come from the domain (roleLabelEs) so every surface —
// chips, modals, invitations, org picker, platform console — shows the same
// name for the same canonical role. The assignable list itself is also the
// domain's canonical ASSIGNABLE_ROLES (contract-pinned), filtered per org
// type — this screen keeps no local copy to drift out of sync.
export function UsersScreen({ baseUrl, token, queryKeys, orgType }: UsersScreenProps): ReactNode {
  const [filter, setFilter] = useState<UserFilter>('active');
  const [actionId, setActionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
  const [revokeInvitation, setRevokeInvitation] = useState<Invitation | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [suspendMember, setSuspendMember] = useState<UserRow | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [revokeSessionsMember, setRevokeSessionsMember] = useState<UserRow | null>(null);
  const [revokeSessionsReason, setRevokeSessionsReason] = useState('');
  const [transferSource, setTransferSource] = useState<UserRow | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferNeedsReload, setTransferNeedsReload] = useState(false);

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
  const queryClient = useQueryClient();
  const teamQuery = useQuery({
    queryKey: queryKeys.team,
    queryFn: ({ signal }) => api.listMemberships(token, signal),
  });
  const users = teamQuery.data?.items ?? [];
  const summary = teamQuery.data?.summary ?? null;
  const capabilities: readonly TeamCapability[] = summary?.capabilities ?? [];
  const invitationRoles = assignableRoles.filter((role) =>
    role !== 'user' && canInviteRoleSet(capabilities, [role]),
  );
  const canInvite = invitationRoles.length > 0;
  const canRevokeSessions = hasCapability(capabilities, 'team:revoke_sessions');
  const canTransferAdmin = hasCapability(capabilities, 'team:transfer_admin');
  const invitationsQuery = useQuery({
    queryKey: queryKeys.invitations,
    queryFn: ({ signal }) => api.listInvitations(token, signal),
    enabled: canInvite,
  });
  const invitations = invitationsQuery.data ?? [];
  const mutation = useMutation({
    mutationFn: (operation: () => Promise<void>) => operation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.root }),
  });
  const loading = teamQuery.isPending;
  const loadError = teamQuery.isError
    ? 'No se pudo cargar el equipo. Revisá tu conexión y volvé a intentar.'
    : null;
  const invitationLoadError = invitationsQuery.isError
    ? 'No se pudieron cargar las invitaciones. El directorio del equipo sigue disponible.'
    : null;

  useEffect(() => {
    if (!canInvite) setFilter((current) => current === 'invitations' ? 'active' : current);
  }, [canInvite]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const filtered = useMemo(() => {
    if (filter === 'suspended') return users.filter((u) => u.membership_status === 'suspended');
    if (filter === 'active') return users.filter((u) => u.membership_status === 'active');
    if (filter === 'left') return users.filter((u) => u.membership_status === 'left');
    return users;
  }, [users, filter]);

  const activeCount = summary?.active_members ?? users.filter((u) => u.membership_status === 'active').length;
  const suspendedCount = summary?.suspended_members ?? users.filter((u) => u.membership_status === 'suspended').length;
  const leftCount = summary?.left_members ?? users.filter((u) => u.membership_status === 'left').length;
  const transferCandidates = users.filter((member) =>
    member.membership_id !== transferSource?.membership_id
    && member.membership_status === 'active'
    && member.account_status === 'active',
  );

  const mutationError = (error: unknown, fallback: string) => {
    if (!(error instanceof GraneteApiError)) return fallback;
    if (error.code === 'LAST_ADMIN') return 'No se puede dejar al taller sin administrador. Transferí ese rol antes de continuar.';
    if (error.code === 'SEAT_LIMIT_REACHED') return 'No hay lugares disponibles para reactivar esta membresía. Liberá un lugar o revisá el límite del taller.';
    if (error.code === 'MEMBERSHIP_VERSION_CONFLICT') return 'Esta membresía cambió en otra sesión. Actualizá la lista e intentá de nuevo.';
    if (error.code === 'ADMIN_TRANSFER_INVALID') return 'La transferencia ya no es válida. Actualizá el equipo y elegí nuevamente.';
    if (error.code === 'VERSION_CONFLICT' || error.code === 'INVITATION_TOKEN_ROTATED') return 'Esta invitación cambió en otra sesión. Actualizá la lista e intentá de nuevo.';
    if (error.code === 'INVITATION_ALREADY_USED' || error.code === 'INVITATION_REVOKED') return 'La invitación ya no está disponible. Actualizá la lista para ver su estado actual.';
    if (error.code === 'FORBIDDEN') return 'No tenés permiso para realizar esta acción en este miembro.';
    return fallback;
  };

  const openTransferForLastAdmin = (error: unknown, source: UserRow): boolean => {
    if (!(error instanceof GraneteApiError) || error.code !== 'LAST_ADMIN' || !canTransferAdmin) return false;
    setTransferTargetId('');
    setTransferReason('');
    setTransferError(null);
    setTransferNeedsReload(false);
    setRoleEditUser(null);
    setSuspendMember(null);
    window.setTimeout(() => setTransferSource(source), MODAL_CLOSE_MS);
    return true;
  };

  const saveMultiRoles = async (membershipId: string, roles: ProductRole[]) => {
    const member = users.find((candidate) => candidate.membership_id === membershipId);
    if (!member) return;
    setActionId(membershipId);
    setActionError(null);
    try {
      await mutation.mutateAsync(async () => {
        await api.changeMembershipRoles(token, membershipId, member.version, { roles });
      });
      showToast('✓ Roles del miembro actualizados');
      setRoleEditUser(null);
    } catch (error) {
      if (!openTransferForLastAdmin(error, member)) setActionError(mutationError(error, 'No se pudieron guardar los roles. Revisá tu conexión e intentá de nuevo.'));
    } finally {
      setActionId(null);
    }
  };

  const reactivateMember = async (member: UserRow) => {
    setActionId(member.membership_id);
    setActionError(null);
    try {
      await mutation.mutateAsync(async () => {
        await api.reactivateMembership(token, member.membership_id, member.version);
      });
      showToast('Membresía reactivada');
    } catch (error) {
      setActionError(mutationError(error, 'No se pudo reactivar la membresía. Revisá tu conexión e intentá de nuevo.'));
    } finally {
      setActionId(null);
    }
  };

  const confirmSuspension = async () => {
    if (!suspendMember || !suspendReason.trim()) return;
    setActionId(suspendMember.membership_id);
    setActionError(null);
    try {
      await mutation.mutateAsync(async () => {
        await api.suspendMembership(token, suspendMember.membership_id, suspendMember.version, { reason: suspendReason.trim() });
      });
      showToast('Membresía suspendida');
      setSuspendMember(null);
    } catch (error) {
      if (!openTransferForLastAdmin(error, suspendMember)) setActionError(mutationError(error, 'No se pudo suspender la membresía. Revisá tu conexión e intentá de nuevo.'));
    } finally {
      setActionId(null);
    }
  };

  const confirmAdminTransfer = async () => {
    const source = transferSource;
    const target = users.find((member) => member.membership_id === transferTargetId);
    if (!source || !target || !transferReason.trim()) return;
    setActionId(source.membership_id);
    setTransferError(null);
    try {
      await mutation.mutateAsync(async () => {
        await api.transferOrganizationAdmin(token, source.membership_id, source.version, {
          target_membership_id: target.membership_id,
          target_version: target.version,
          demote_source: false,
          reason: transferReason.trim(),
        });
      });
      setTransferSource(null);
      showToast('Administración transferida. Volvé a intentar el cambio original.');
    } catch (error) {
      setTransferError(mutationError(error, 'No se pudo transferir la administración. Actualizá el equipo e intentá de nuevo.'));
      if (error instanceof GraneteApiError && (error.code === 'MEMBERSHIP_VERSION_CONFLICT' || error.code === 'ADMIN_TRANSFER_INVALID')) setTransferNeedsReload(true);
    } finally {
      setActionId(null);
    }
  };

  const reloadAdminTransfer = async () => {
    const sourceId = transferSource?.membership_id;
    try {
      const latest = await queryClient.fetchQuery<TeamDirectory>({ queryKey: queryKeys.team, queryFn: ({ signal }) => api.listMemberships(token, signal), staleTime: 0, retry: false });
      const source = latest.items.find((member) => member.membership_id === sourceId);
      const target = latest.items.find((member) => member.membership_id === transferTargetId);
      if (!source) { setTransferSource(null); return; }
      setTransferSource(source);
      if (!target || target.membership_status !== 'active' || target.account_status !== 'active') setTransferTargetId('');
      setTransferNeedsReload(false);
      setTransferError(null);
    } catch {
      setTransferNeedsReload(true);
      setTransferError('No se pudo actualizar el equipo. Revisá tu conexión y volvé a intentar antes de transferir.');
    }
  };

  const confirmSessionRevocation = async () => {
    if (!revokeSessionsMember || !revokeSessionsReason.trim()) return;
    setActionId(revokeSessionsMember.membership_id);
    setActionError(null);
    try {
      await mutation.mutateAsync(async () => {
        await api.revokeMembershipSessions(token, revokeSessionsMember.membership_id, revokeSessionsMember.version, { reason: revokeSessionsReason.trim() });
      });
      showToast('Sesiones revocadas');
      setRevokeSessionsMember(null);
    } catch (error) {
      setActionError(mutationError(error, 'No se pudieron revocar las sesiones. Revisá tu conexión e intentá de nuevo.'));
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
      await mutation.mutateAsync(async () => {
        const data = await api.createInvitation(token, {
          email: inviteEmail.trim(),
          roles: inviteRoles,
        });
        setCreatedInviteLink(`${window.location.origin}${data.accept_url}`);
      });
      showToast('✓ Invitación creada');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Error al crear invitación');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRevokeInvitation = async (invitation: Invitation) => {
    if (!revokeReason.trim()) return;
    setActionId(invitation.id);
    setActionError(null);
    try {
      await mutation.mutateAsync(async () => {
        await api.revokeInvitation(token, invitation.id, invitation.version, { reason: revokeReason.trim() });
      });
      showToast('✓ Invitación revocada');
      setRevokeInvitation(null);
      setRevokeReason('');
    } catch (error) {
      setActionError(mutationError(error, 'No se pudo revocar la invitación. Actualizá la lista e intentá de nuevo.'));
    } finally {
      setActionId(null);
    }
  };

  const handleResendInvitation = async (invitation: Invitation) => {
    setActionId(invitation.id);
    setActionError(null);
    try {
      await mutation.mutateAsync(async () => {
        const data = await api.resendInvitation(token, invitation.id, invitation.version);
        setCreatedInviteLink(`${window.location.origin}${data.accept_url}`);
      });
      setShowInviteModal(true);
      showToast('✓ Enlace rotado. El enlace anterior ya no sirve.');
    } catch (error) {
      setActionError(mutationError(error, 'No se pudo reenviar la invitación. Actualizá la lista e intentá de nuevo.'));
    } finally {
      setActionId(null);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!createdInviteLink) return;
    setActionError(null);
    try {
      await navigator.clipboard.writeText(createdInviteLink);
      setCopiedLink(true);
      showToast('✓ Enlace copiado al portapapeles');
      setTimeout(() => setCopiedLink(false), 3000);
    } catch {
      setCopiedLink(false);
      setActionError('No se pudo copiar el enlace. Seleccionalo y copialo manualmente.');
    }
  };

  const roleChips = (u: UserRow) => {
    const rolesList = u.roles.length > 0 ? u.roles : ['user'];
    return (
      <div className="users-role-chips">
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
        subtitle="Equipo del taller, roles, estados de membresía e invitaciones"
        icon={<Users size={20} strokeWidth={1.5} />}
        primaryAction={
          canInvite ? (
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={() => {
              setInviteEmail('');
              setInviteRoles([invitationRoles[0]!]);
              setCreatedInviteLink(null);
              setInviteError(null);
              setShowInviteModal(true);
            }}
          >
            <UserPlus size={15} strokeWidth={1.5} aria-hidden="true" /> Invitar miembro
          </button>
          ) : null
        }
        secondaryActions={
          <button
            type="button"
            className="btn btn--secondary btn--small"
            aria-label="Recargar usuarios"
            onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.root })}
            disabled={teamQuery.isFetching || invitationsQuery.isFetching}
          >
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" /> Actualizar
          </button>
        }
      />

      {actionError && (
        <p className="users-action-error" role="alert">{actionError}</p>
      )}

      {toast && (
        <div role="status" aria-live="polite" className="users-toast">
          {toast}
        </div>
      )}

      <div className="users-team-summary" aria-label="Resumen del equipo">
        <span>{activeCount} activos</span>
        <span>{suspendedCount} suspendidos</span>
        <span>{leftCount} finalizados</span>
        <span>{summary?.max_active_members === null ? 'Sin límite de miembros' : `${activeCount} de ${summary?.max_active_members ?? '—'} lugares ocupados`}</span>
      </div>

      <div className="users-filters">
        <StatusChips<UserFilter>
          options={[
            { value: 'active', label: `Membresías activas (${activeCount})` },
            ...(canInvite
              ? [{ value: 'invitations' as const, label: `Invitaciones (${invitations.length})` }]
              : []),
            { value: 'all', label: `Todo el equipo (${users.length})` },
            ...(suspendedCount > 0
              ? [{ value: 'suspended' as const, label: `Membresías suspendidas (${suspendedCount})` }]
              : []),
            ...(leftCount > 0
              ? [{ value: 'left' as const, label: `Membresías finalizadas (${leftCount})` }]
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
          onAction={() => void queryClient.invalidateQueries({ queryKey: queryKeys.root })}
        />
      ) : filter === 'invitations' ? (
        /* INVITATIONS VIEW */
        invitationLoadError ? (
          <EmptyState
            title="No se pudieron cargar las invitaciones"
            description={invitationLoadError}
            actionLabel="Reintentar"
            onAction={() => void queryClient.invalidateQueries({ queryKey: queryKeys.root })}
          />
        ) : invitations.length === 0 ? (
          <EmptyState
            title="Sin invitaciones"
            description="Todavía no hay invitaciones. Podés crear una con el botón 'Invitar miembro'."
            actionLabel={canInvite ? 'Invitar miembro' : undefined}
            onAction={canInvite ? () => {
              setInviteEmail('');
              setInviteRoles([invitationRoles[0]!]);
              setCreatedInviteLink(null);
              setInviteError(null);
              setShowInviteModal(true);
            } : undefined}
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
                  <th>Estado</th>
                  <th className="users-table__align-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <div className="users-invitation-email">
                        <Mail size={14} strokeWidth={1.5} aria-hidden="true" />
                        <span>{inv.email}</span>
                      </div>
                    </td>
                    <td>
                      <div className="users-role-chips">
                        {inv.roles.map((r) => (
                          <span key={r} className="meta-chip">
                            {roleLabelEs(r)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="users-table__date">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td className="users-table__date">
                      {new Date(inv.expires_at).toLocaleDateString()}
                    </td>
                    <td>
                      <span className={`status-badge ${['pending', 'delivered', 'opened'].includes(inv.status) ? 'status-badge--active' : 'status-badge--open'}`}>
                        {{ pending: 'Pendiente', delivered: 'Entregada', opened: 'Abierta', expired: 'Vencida', accepted: 'Aceptada', revoked: 'Revocada' }[inv.status]}
                      </span>
                    </td>
                    <td className="users-table__align-right">
                      {canInviteRoleSet(capabilities, inv.roles)
                        && ['pending', 'delivered', 'opened', 'expired'].includes(inv.status) ? (
                        <div className="users-table__actions">
                          <button type="button" className="btn btn--secondary btn--small" onClick={() => void handleResendInvitation(inv)} disabled={actionId === inv.id}>
                            <RefreshCw size={13} strokeWidth={1.5} aria-hidden="true" /> Reenviar
                          </button>
                          {['pending', 'delivered', 'opened'].includes(inv.status) && (
                            <button type="button" className="btn btn--secondary btn--small" onClick={() => { setRevokeInvitation(inv); setRevokeReason(''); }} disabled={actionId === inv.id}>
                              <XCircle size={13} strokeWidth={1.5} aria-hidden="true" /> Revocar
                            </button>
                          )}
                        </div>
                      ) : <span aria-hidden="true">—</span>}
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
                <th className="users-table__align-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const isWorking = actionId === u.membership_id;
                const canManageMember = canManageRoleSet(capabilities, u.roles);

                return (
                  <tr key={u.membership_id}>
                    <td>
                      <div className="users-table__name">{u.name || 'Sin nombre'}</div>
                      <div className="users-table__email">{u.email}</div>
                    </td>
                    <td>
                      <div className="users-member-roles">
                        {roleChips(u)}
                        {canManageMember ? <button
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
                          aria-label={`Modificar roles de ${u.name || u.email}`}
                        >
                          <Settings2 size={13} strokeWidth={1.5} aria-hidden="true" />
                        </button> : null}
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${u.account_status === 'active' ? 'status-badge--active' : 'status-badge--open'}`}>
                        {u.account_status === 'active' ? 'Cuenta activa' : 'Cuenta deshabilitada'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${u.membership_status === 'active' ? 'status-badge--active' : 'status-badge--open'}`}>
                        {{ active: 'Membresía activa', suspended: 'Membresía suspendida', left: 'Membresía finalizada' }[u.membership_status]}
                      </span>
                    </td>
                    <td className="users-table__align-right">
                      <div className="users-table__actions users-table__actions--end">
                        {u.membership_status === 'suspended' && canManageMember ? (
                          <button
                            type="button"
                            className="btn btn--primary btn--small"
                            onClick={() => void reactivateMember(u)}
                            disabled={isWorking || u.account_status !== 'active'}
                            title={u.account_status !== 'active' ? 'La cuenta global está deshabilitada' : undefined}
                            aria-label={`Reactivar membresía de ${u.name || u.email}`}
                          >
                            <CheckCircle2 size={13} strokeWidth={1.5} aria-hidden="true" /> Reactivar membresía
                          </button>
                        ) : u.membership_status === 'active' && canManageMember ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => { setSuspendMember(u); setSuspendReason(''); }}
                            disabled={isWorking}
                            aria-label={`Suspender membresía de ${u.name || u.email}`}
                          >
                            <MinusCircle size={13} strokeWidth={1.5} aria-hidden="true" /> Suspender membresía
                          </button>
                        ) : null}
                        {canRevokeSessions ? <button
                          type="button"
                          className="btn btn--ghost btn--small"
                          onClick={() => { setRevokeSessionsMember(u); setRevokeSessionsReason(''); }}
                          disabled={isWorking}
                          aria-label={`Revocar sesiones de ${u.name || u.email}`}
                        >
                          Revocar sesiones
                        </button> : null}
                        {!canManageMember && !canRevokeSessions ? <span aria-hidden="true">—</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MULTI-ROLE EDIT MODAL */}
      <Modal
        open={roleEditUser !== null}
        onClose={() => setRoleEditUser(null)}
        title={`Roles de ${roleEditUser?.name || 'Miembro'}`}
        size="sm"
      >
        <div className="users-modal-stack">
          <p className="users-modal-copy">
            Seleccioná uno o varios roles para este usuario. Las capacidades se combinan por unión de permisos (ADR-0005).
          </p>

          {(orgType === 'store' || orgType === 'dealer') && (
            <p className="users-modal-copy">
              Este taller es comercial: sólo puede asignar roles de ventas y coordinación.
            </p>
          )}

          <div className="users-role-options users-role-options--single">
            {assignableRoles.filter((role) => canAssignRoleSet(capabilities, [role])).map((r) => {
              const isChecked = selectedRoles.includes(r);
              return (
                <label
                  key={r}
                  className={`users-role-option${isChecked ? ' is-selected' : ''}`}
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
                  <span>{roleLabelEs(r)}</span>
                </label>
              );
            })}
          </div>

          <RolePermissionPreview roles={selectedRoles} organizationType={orgType} />

          <div className="users-modal-actions">
            <button type="button" className="btn btn--secondary" onClick={() => setRoleEditUser(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={selectedRoles.length === 0}
              onClick={() => {
                if (roleEditUser) {
                  void saveMultiRoles(roleEditUser.membership_id, selectedRoles);
                }
              }}
            >
              Guardar roles
            </button>
          </div>
        </div>
      </Modal>

      {/* INVITE MEMBER MODAL */}
      <Modal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Invitar miembro al taller"
        size="md"
      >
        {createdInviteLink ? (
          <div className="users-modal-stack">
            <div className="users-invitation-success" role="status">
              ✓ Invitación generada exitosamente.
            </div>

            <p className="users-modal-copy">
              Copiá el enlace y envíaselo al miembro por WhatsApp o email para que cree su contraseña y acceda:
            </p>

            <div className="users-invitation-link">
              {createdInviteLink}
            </div>

            <div className="users-modal-actions users-modal-actions--flush">
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleCopyInviteLink}
              >
                {copiedLink
                  ? <Check size={16} strokeWidth={1.5} aria-hidden="true" />
                  : <Copy size={16} strokeWidth={1.5} aria-hidden="true" />}
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
          <form onSubmit={handleCreateInvitation} className="users-modal-stack">
            {inviteError && (
              <p role="alert" className="users-form-error">
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
              <div className="users-role-options">
                {invitationRoles.map((r) => {
                  const isChecked = inviteRoles.includes(r);
                  return (
                    <label
                      key={r}
                      className={`users-role-option${isChecked ? ' is-selected' : ''}`}
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

            <div className="users-modal-actions">
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

      <Modal
        open={revokeInvitation !== null}
        onClose={() => setRevokeInvitation(null)}
        title="Revocar invitación"
        size="sm"
      >
        <div className="users-modal-stack">
          <p className="users-modal-copy">
            El enlace dejará de funcionar. Indicá el motivo para conservar una auditoría útil.
          </p>
          <div>
            <label className="label" htmlFor="revoke-reason">Motivo *</label>
            <textarea id="revoke-reason" className="input" required value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} />
          </div>
          <div className="users-modal-actions users-modal-actions--flush">
            <button type="button" className="btn btn--secondary" onClick={() => setRevokeInvitation(null)}>Cancelar</button>
            <button type="button" className="btn btn--primary" disabled={!revokeReason.trim() || actionId === revokeInvitation?.id} onClick={() => { if (revokeInvitation) void handleRevokeInvitation(revokeInvitation); }}>
              Revocar invitación
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={suspendMember !== null}
        onClose={() => setSuspendMember(null)}
        title="Suspender membresía"
        size="sm"
      >
        <div className="users-modal-stack">
          <p className="users-modal-copy">Esta persona perderá el acceso al taller. Indicá el motivo para conservar una auditoría útil.</p>
          <div>
            <label className="label" htmlFor="suspend-reason">Motivo *</label>
            <textarea id="suspend-reason" className="input" required value={suspendReason} onChange={(event) => setSuspendReason(event.target.value)} />
          </div>
          <div className="users-modal-actions users-modal-actions--flush">
            <button type="button" className="btn btn--secondary" onClick={() => setSuspendMember(null)}>Cancelar</button>
            <button type="button" className="btn btn--primary" disabled={!suspendReason.trim() || actionId === suspendMember?.membership_id} onClick={() => void confirmSuspension()}>Suspender membresía</button>
          </div>
        </div>
      </Modal>

      <Modal
        open={revokeSessionsMember !== null}
        onClose={() => setRevokeSessionsMember(null)}
        title="Revocar sesiones"
        size="sm"
      >
        <div className="users-modal-stack">
          <p className="users-modal-copy">La persona deberá volver a iniciar sesión en este taller. Indicá el motivo.</p>
          <div>
            <label className="label" htmlFor="revoke-sessions-reason">Motivo *</label>
            <textarea id="revoke-sessions-reason" className="input" required value={revokeSessionsReason} onChange={(event) => setRevokeSessionsReason(event.target.value)} />
          </div>
          <div className="users-modal-actions users-modal-actions--flush">
            <button type="button" className="btn btn--secondary" onClick={() => setRevokeSessionsMember(null)}>Cancelar</button>
            <button type="button" className="btn btn--primary" disabled={!revokeSessionsReason.trim() || actionId === revokeSessionsMember?.membership_id} onClick={() => void confirmSessionRevocation()}>Revocar sesiones</button>
          </div>
        </div>
      </Modal>

      <AdminTransferModal
        source={transferSource}
        candidates={transferCandidates}
        targetId={transferTargetId}
        reason={transferReason}
        error={transferError}
        busy={actionId === transferSource?.membership_id || transferNeedsReload}
        onTargetChange={setTransferTargetId}
        onReasonChange={setTransferReason}
        onClose={() => setTransferSource(null)}
        onReload={() => void reloadAdminTransfer()}
        onConfirm={() => void confirmAdminTransfer()}
      />

    </div>
  );
}

export { UsersScreen as TeamScreen };
