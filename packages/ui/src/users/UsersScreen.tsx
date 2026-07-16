/**
 * UsersScreen — Admin panel: manage user registrations (approve, role, reject).
 * Only visible when session.user.role === 'admin'.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  MinusCircle,
  RefreshCw,
  SearchX,
  Settings2,
  Trash2,
  Users,
} from 'lucide-react';
import { EmptyState, PageLoading } from '../common';
import '../catalogs/catalogs.css';
import './users.css';

export interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly active: boolean;
  readonly created_at: string;
}

export type UserFilter = 'pending' | 'active' | 'all';

export interface UsersScreenProps {
  readonly baseUrl: string;
  readonly token: string;
}

const ROLES = ['user', 'admin', 'vendedor', 'disenador', 'carpintero'] as const;

export function UsersScreen({ baseUrl, token }: UsersScreenProps): ReactNode {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [filter, setFilter] = useState<UserFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  const reject = async (id: string) => {
    if (!confirm('¿Eliminar este usuario pendiente?')) return;
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

      <div className="catalog-header">
        <div className="catalog-header__title-row">
          <Users size={20} strokeWidth={1.5} aria-hidden />
          <h1 className="catalog-header__title">
            Usuarios
            {pendingCount > 0 ? (
              <span className="users-badge">{pendingCount} pendiente{pendingCount > 1 ? 's' : ''}</span>
            ) : null}
          </h1>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={load}
          disabled={loading}
          title="Recargar"
        >
          <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      {/* Filtros */}
      <div className="catalog-filters">
        {(['pending', 'active', 'all'] as UserFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`filter-tab ${filter === f ? 'filter-tab--active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'pending' ? `Pendientes${pendingCount > 0 ? ` (${pendingCount})` : ''}` :
             f === 'active' ? 'Aprobados' : 'Todos'}
          </button>
        ))}
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
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="users-role-badge">{u.role}</span>
                    )}
                  </td>
                  <td>
                    {u.active ? (
                      <span className="status-badge status-badge--active">
                        <CheckCircle2 size={13} strokeWidth={1.5} />
                        Activo
                      </span>
                    ) : (
                      <span className="status-badge status-badge--pending">
                        <MinusCircle size={13} strokeWidth={1.5} />
                        Pendiente
                      </span>
                    )}
                  </td>
                  <td className="users-table__actions">
                    {!u.active && (
                      <button
                        type="button"
                        className="btn btn--success btn--sm"
                        disabled={actionId === u.id}
                        onClick={() => void approve(u.id)}
                        title="Aprobar"
                      >
                        <CheckCircle2 size={15} strokeWidth={1.5} />
                        Aprobar
                      </button>
                    )}
                    {u.active && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled
                        title="Gestionar rol con el selector de la izquierda"
                      >
                        <Settings2 size={15} strokeWidth={1.5} />
                      </button>
                    )}
                    {!u.active && (
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={actionId === u.id}
                        onClick={() => void reject(u.id)}
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
    </div>
  );
}
