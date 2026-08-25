/**
 * UsersScreen — Admin panel: manage user registrations (approve, role,
 * license, reject). Only visible when session.user.role === 'admin'.
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
} from 'lucide-react';
import { ConfirmDialog, EmptyState, PageHeader, PageLoading, StatusChips } from '../common';
import '../catalogs/catalogs.css';
import './users.css';
import { SectorAssignment } from './SectorAssignment';
import type { ProductRole } from '@muebles/domain';

export interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly active: boolean;
  readonly created_at: string;
  readonly license_plan?: string;
  readonly license_expires_at?: string | null;
}

export type UserFilter = 'pending' | 'active' | 'all';

export interface UsersScreenProps {
  readonly baseUrl: string;
  readonly token: string;
}

/** Product roles (F035) — admin assigns puesto from panel. */
const ROLES = [
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
  const [filter, setFilter] = useState<UserFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState<string>('');
  const [selectedUserRole, setSelectedUserRole] = useState<string>('');
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
      const res = await fetch(`${baseUrl}/admin/users`, { headers });
      if (!res.ok) throw new Error('Error loading users');
      const data = (await res.json()) as UserRow[];
      setUsers(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [baseUrl, token]);

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

  const changeLicense = async (
    id: string,
    plan: string,
    expiresAtIso: string | null,
  ) => {
    setActionId(id);
    try {
      const res = await fetch(`${baseUrl}/admin/users/${id}/license`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ license_plan: plan, license_expires_at: expiresAtIso }),
      });
      if (!res.ok) throw new Error('license update failed');
      showToast('✓ Licencia actualizada');
      await load();
    } catch {
      showToast('No se pudo actualizar la licencia');
    } finally {
      setActionId(null);
    }
  };

  const reject = async (id: string) => {
    setActionId(id);
    try {
      await fetch(`${baseUrl}/admin/users/${id}`, { method: 'DELETE', headers });
      showToast('↓ Usuario eliminado');
      await load();
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="catalog-layout">
      {toast ? (
        <div className="users-toast" role="status">
          {toast}
        </div>
      ) : null}

      <PageHeader
        title="Usuarios"
        subtitle={
          <>
            Aprobación de registros y puestos del taller
            {pendingCount > 0 ? (
              <span className="users-badge">{pendingCount} pendiente{pendingCount > 1 ? 's' : ''}</span>
            ) : null}
          </>
        }
        icon={<ShieldCheck size={16} strokeWidth={1.5} />}
        secondaryActions={
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={load}
            disabled={loading}
            title="Recargar"
            aria-label="Recargar usuarios"
          >
            <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
          </button>
        }
      />

      {/* Filtros */}
      <div className="catalog-page__filters">
        <StatusChips
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'pending' as const, label: pendingCount > 0 ? `Pendientes (${pendingCount})` : 'Pendientes' },
            { value: 'active' as const, label: 'Aprobados' },
            { value: 'all' as const, label: 'Todos' },
          ]}
          aria-label="Filtrar usuarios"
        />
      </div>

      {loading ? (
        <PageLoading label="Cargando usuarios…" data-testid="users-loading" />
      ) : users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Sin usuarios"
          description="Todavía no hay cuentas registradas en el sistema."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="no-results"
          icon={SearchX}
          title={
            filter === 'pending'
              ? 'Sin solicitudes pendientes'
              : 'Sin usuarios en esta categoría'
          }
          description={
            filter === 'pending'
              ? 'Todos los usuarios han sido procesados.'
              : 'Probá con otro filtro de estado.'
          }
          actionLabel="Ver todos"
          onAction={() => setFilter('all')}
        />
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Licencia</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className={!u.active ? 'users-table__row--pending' : ''}>
                  <td className="users-table__name">{u.name}</td>
                  <td className="users-table__email">{u.email}</td>
                  <td>
                    {u.active ? (
                      <select
                        className="users-role-select"
                        value={u.role}
                        disabled={actionId === u.id}
                        onChange={(e) => void changeRole(u.id, e.target.value)}
                        aria-label={`Rol de ${u.name}`}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="meta-chip">{u.role}</span>
                    )}
                  </td>
                  <td className="users-license-cell">
                    {u.active ? (
                      <>
                        <select
                          className="users-role-select"
                          value={u.license_plan ?? 'none'}
                          disabled={actionId === u.id}
                          onChange={(e) =>
                            void changeLicense(
                              u.id,
                              e.target.value,
                              u.license_expires_at ?? null,
                            )
                          }
                          aria-label={`Licencia de ${u.name}`}
                        >
                          {LICENSE_PLANS.map((p) => (
                            <option key={p} value={p}>
                              {LICENSE_LABELS[p]}
                            </option>
                          ))}
                        </select>
                        {(u.license_plan ?? 'none') !== 'none' ? (
                          <input
                            type="date"
                            className="users-license-expiry"
                            defaultValue={u.license_expires_at ? u.license_expires_at.slice(0, 10) : ''}
                            disabled={actionId === u.id}
                            onChange={(e) => {
                              const v = e.target.value;
                              void changeLicense(
                                u.id,
                                u.license_plan ?? 'none',
                                v ? `${v}T23:59:59Z` : null,
                              );
                            }}
                            aria-label={`Vencimiento de licencia de ${u.name}`}
                            title="Vencimiento (vacío = sin vencimiento)"
                          />
                        ) : null}
                        <span
                          className={
                            licenseStatus(u.license_plan, u.license_expires_at) === 'active'
                              ? 'status-badge status-badge--active'
                              : licenseStatus(u.license_plan, u.license_expires_at) === 'expired'
                                ? 'status-badge status-badge--danger'
                                : 'meta-chip'
                          }
                        >
                          {LICENSE_STATUS_LABELS[licenseStatus(u.license_plan, u.license_expires_at)]}
                        </span>
                      </>
                    ) : (
                      <span className="meta-chip">—</span>
                    )}
                  </td>
                  <td>
                    {u.active ? (
                      <span className="status-badge status-badge--active">
                        <CheckCircle2 size={13} strokeWidth={1.5} />
                        Activo
                      </span>
                    ) : (
                      <span className="status-badge status-badge--open">
                        <MinusCircle size={13} strokeWidth={1.5} />
                        Pendiente
                      </span>
                    )}
                  </td>
                  <td className="users-table__actions">
                    {!u.active && (
                      <button
                        type="button"
                        className="btn btn--success btn--small"
                        disabled={actionId === u.id}
                        onClick={() => void approve(u.id)}
                        title="Aprobar"
                      >
                        <CheckCircle2 size={15} strokeWidth={1.5} />
                        Aprobar
                      </button>
                    )}
                    {u.active && (u.role === 'produccion' || u.role === 'almacen') && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        onClick={() => {
                          setSelectedUserId(u.id);
                          setSelectedUserName(u.name);
                          setSelectedUserRole(u.role);
                        }}
                        title="Asignar sectores"
                        aria-label={`Asignar sectores de ${u.name}`}
                      >
                        <MapPin size={15} strokeWidth={1.5} aria-hidden />
                      </button>
                    )}
                    {u.active && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        disabled
                        title="Gestionar rol con el selector de la izquierda"
                        aria-label="Gestión de rol no disponible"
                      >
                        <Settings2 size={15} strokeWidth={1.5} aria-hidden />
                      </button>
                    )}
                    {!u.active && (
                      <button
                        type="button"
                        className="btn btn--danger btn--small"
                        disabled={actionId === u.id}
                        onClick={() => setRejectingUser(u)}
                        title="Rechazar"
                      >
                        <Trash2 size={15} strokeWidth={1.5} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedUserId && (
        <SectorAssignment
          baseUrl={baseUrl}
          token={token}
          userId={selectedUserId}
          userName={selectedUserName}
          role={selectedUserRole as ProductRole}
          onClose={() => {
            setSelectedUserId(null);
            setSelectedUserName('');
            setSelectedUserRole('');
            void load();
          }}
        />
      )}

      <ConfirmDialog
        open={rejectingUser !== null}
        onClose={() => setRejectingUser(null)}
        title="Eliminar usuario pendiente"
        message={
          rejectingUser
            ? `Se elimina el registro de ${rejectingUser.email}. Podrá solicitar acceso de nuevo.`
            : ''
        }
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (rejectingUser) void reject(rejectingUser.id);
        }}
        dataTestId="users-reject-confirm"
      />
    </div>
  );
}
