/**
 * PlatformScreen — Consola de plataforma para superadmin / platform_admin
 * (ADR-0005 §5 / #326).
 * Gestiona organizaciones, licencias, usuarios globales, auditoría de seguridad
 * y apertura de sesiones de soporte auditadas ("Entrar a taller").
 */

import { useState, useEffect, useMemo, type ReactNode } from 'react';
import {
  Building2,
  Users,
  ShieldAlert,
  Plus,
  Edit2,
  LogIn,
  KeyRound,
  RefreshCw,
  Search,
} from 'lucide-react';
import { PageHeader, Modal, PageLoading, EmptyState } from '../common';
import { WorkspaceTabs } from '../common/Tabs';
import './platform.css';

export interface PlatformScreenProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly onSupportSessionStart?: (token: string, orgId: string) => void;
}

export interface OrganizationRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly type: 'factory' | 'store' | 'dealer';
  readonly license_plan?: string;
  readonly license_expires_at?: string | null;
  readonly license?: {
    readonly plan?: string;
    readonly expires_at?: string | null;
    readonly status?: string;
  };
  readonly active: boolean;
  readonly created_at?: string;
  readonly member_count?: number;
}

export interface PlatformUserRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly platform_admin: boolean;
  readonly active: boolean;
  readonly created_at: string;
  readonly memberships: {
    readonly organization_id: string;
    readonly organization_name: string;
    readonly organization_slug: string;
    readonly roles: string[];
    readonly active: boolean;
  }[];
}

export interface SecurityAuditEventRow {
  readonly id: string;
  readonly created_at: string;
  readonly event_type: string;
  readonly actor_user_id: string;
  readonly organization_id: string;
  readonly ip_address: string;
  readonly metadata: Record<string, unknown>;
}

type TabKey = 'organizations' | 'users' | 'audit';

export function PlatformScreen({
  baseUrl,
  token,
  onSupportSessionStart,
}: PlatformScreenProps): ReactNode {
  const [activeTab, setActiveTab] = useState<TabKey>('organizations');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Data
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [users, setUsers] = useState<PlatformUserRow[]>([]);
  const [auditEvents, setAuditEvents] = useState<SecurityAuditEventRow[]>([]);
  const [selectedAuditOrgId, setSelectedAuditOrgId] = useState<string>('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrganizationRow | null>(null);
  const [supportOrg, setSupportOrg] = useState<OrganizationRow | null>(null);
  const [supportReason, setSupportReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newType, setNewType] = useState<'factory' | 'store' | 'dealer'>('factory');
  const [newPlan, setNewPlan] = useState('trial');
  const [newExpiry, setNewExpiry] = useState('');
  const [cloneFromOrgId, setCloneFromOrgId] = useState('');

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editPlan, setEditPlan] = useState('trial');
  const [editExpiry, setEditExpiry] = useState('');
  const [editActive, setEditActive] = useState(true);

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }),
    [token],
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const loadOrganizations = async () => {
    try {
      const res = await fetch(`${baseUrl}/platform/organizations`, { headers });
      if (res.ok) {
        const data = (await res.json()) as OrganizationRow[];
        setOrganizations(data);
        if (data.length > 0 && !selectedAuditOrgId) {
          setSelectedAuditOrgId(data[0]!.id);
        }
      } else {
        throw new Error('organizations');
      }
    } catch {
      throw new Error('organizations');
    }
  };

  const loadUsers = async () => {
    try {
      const res = await fetch(`${baseUrl}/platform/users`, { headers });
      if (res.ok) {
        const data = (await res.json()) as PlatformUserRow[];
        setUsers(data);
      } else {
        throw new Error('users');
      }
    } catch {
      throw new Error('users');
    }
  };

  const loadAudit = async (orgId: string) => {
    if (!orgId) return;
    try {
      const res = await fetch(`${baseUrl}/platform/organizations/${orgId}/audit?limit=100`, {
        headers,
      });
      if (res.ok) {
        const data = (await res.json()) as SecurityAuditEventRow[];
        setAuditEvents(data);
      }
    } catch {
      // ignore
    }
  };

  const loadCurrentTab = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (activeTab === 'organizations') {
        await loadOrganizations();
      } else if (activeTab === 'users') {
        await loadUsers();
      } else if (activeTab === 'audit') {
        if (organizations.length === 0) await loadOrganizations();
        await loadAudit(selectedAuditOrgId || (organizations[0]?.id ?? ''));
      }
    } catch {
      setLoadError(
        'No se pudo cargar esta sección de la consola. Revisá tu conexión y volvé a intentar.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCurrentTab();
  }, [activeTab, baseUrl, token]);

  useEffect(() => {
    if (activeTab === 'audit' && selectedAuditOrgId) {
      void loadAudit(selectedAuditOrgId);
    }
  }, [selectedAuditOrgId, activeTab]);

  // Handle Create Organization
  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newSlug.trim()) {
      setModalError('Nombre y slug son requeridos');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch(`${baseUrl}/platform/organizations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: newName.trim(),
          slug: newSlug.trim().toLowerCase(),
          type: newType,
          license_plan: newPlan,
          license_expires_at: newExpiry ? new Date(`${newExpiry}T23:59:59Z`).toISOString() : null,
          clone_catalog_from: cloneFromOrgId || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Error al crear organización');
      }
      showToast('✓ Organización creada exitosamente');
      setShowCreateModal(false);
      setNewName('');
      setNewSlug('');
      setNewExpiry('');
      setCloneFromOrgId('');
      await loadOrganizations();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al crear organización');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Update Organization
  const handleUpdateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrg) return;
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch(`${baseUrl}/platform/organizations/${editingOrg.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          name: editName.trim(),
          license_plan: editPlan,
          license_expires_at: editExpiry ? new Date(`${editExpiry}T23:59:59Z`).toISOString() : null,
          active: editActive,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Error al actualizar organización');
      }
      showToast('✓ Organización actualizada');
      setEditingOrg(null);
      await loadOrganizations();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al actualizar');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Start Support Session
  const handleStartSupportSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportOrg) return;
    if (supportReason.trim().length < 4) {
      setModalError('El motivo debe tener al menos 4 caracteres');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch(
        `${baseUrl}/platform/organizations/${supportOrg.id}/support-session`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ reason: supportReason.trim() }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Error al iniciar sesión de soporte');
      }
      const data = (await res.json()) as { token: string };
      showToast(`✓ Entrando a ${supportOrg.name} en modo soporte...`);
      setSupportOrg(null);
      setSupportReason('');
      if (onSupportSessionStart) {
        onSupportSessionStart(data.token, supportOrg.id);
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al iniciar sesión de soporte');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredOrgs = useMemo(() => {
    if (!searchQuery.trim()) return organizations;
    const q = searchQuery.toLowerCase();
    return organizations.filter(
      (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
    );
  }, [organizations, searchQuery]);

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase();
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.memberships.some((m) => m.organization_name.toLowerCase().includes(q)),
    );
  }, [users, searchQuery]);

  return (
    <div className="platform-screen">
      <PageHeader
        title="Consola de Plataforma"
        subtitle="Superadmin multi-taller: gestión de organizaciones, usuarios globales y auditoría de soporte"
        primaryAction={
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setModalError(null);
              setShowCreateModal(true);
            }}
          >
            <Plus size={16} /> Nueva Organización
          </button>
        }
        secondaryActions={
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void loadCurrentTab()}
            disabled={loading}
          >
            <RefreshCw size={15} /> Actualizar
          </button>
        }
      />

      {toast && (
        <div role="status" aria-live="polite" className="toast toast--success" style={{ marginBottom: 'var(--space-2)' }}>
          {toast}
        </div>
      )}

      {/* Tabs */}
      <WorkspaceTabs<TabKey>
        tabs={[
          { id: 'organizations', label: 'Organizaciones', count: organizations.length, icon: <Building2 size={16} /> },
          { id: 'users', label: 'Usuarios Globales', count: users.length, icon: <Users size={16} /> },
          { id: 'audit', label: 'Auditoría de Seguridad', icon: <ShieldAlert size={16} /> },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Consola de plataforma"
        idPrefix="platform-console"
      />

      {loading ? (
        <PageLoading label="Cargando consola de plataforma..." />
      ) : loadError ? (
        <EmptyState
          title="No se pudo cargar la consola"
          description={loadError}
          actionLabel="Reintentar"
          onAction={() => void loadCurrentTab()}
        />
      ) : (
        <>
          {/* TAB 1: ORGANIZATIONS */}
          {activeTab === 'organizations' && (
            <div>
              <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: '360px' }}>
                  <Search
                    size={16}
                    style={{
                      position: 'absolute',
                      left: 'var(--space-3)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                    }}
                  />
                  <input
                    type="text"
                    className="platform-input"
                    placeholder="Buscar organización por nombre o slug..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ paddingLeft: 'var(--space-8)' }}
                  />
                </div>
              </div>

              {filteredOrgs.length === 0 ? (
                <EmptyState
                  title="No hay organizaciones"
                  description={
                    searchQuery
                      ? 'No se encontraron organizaciones para la búsqueda.'
                      : 'Aún no hay organizaciones registradas en la plataforma.'
                  }
                />
              ) : (
                <div className="platform-grid">
                  {filteredOrgs.map((org) => (
                    <article key={org.id} className="platform-card">
                      <div className="platform-card__header">
                        <div>
                          <h2 className="platform-card__title">{org.name}</h2>
                          <span className="platform-card__slug">/{org.slug}</span>
                        </div>
                        <span className={`platform-chip platform-chip--${org.type}`}>
                          {org.type === 'factory' ? 'Fábrica' : org.type === 'store' ? 'Tienda' : 'Distribuidor'}
                        </span>
                      </div>

                      <div className="platform-card__meta">
                        <div>
                          <strong>Estado:</strong>{' '}
                          <span className={`platform-chip platform-chip--${org.active !== false ? 'active' : 'suspended'}`}>
                            {org.active !== false ? 'Activo' : 'Suspendido'}
                          </span>
                        </div>
                        <div>
                          <strong>Miembros:</strong> {org.member_count ?? 0}
                        </div>
                        <div>
                          <strong>Plan:</strong>{' '}
                          <span className={`platform-chip platform-chip--${(org.license_plan || org.license?.plan) === 'pro' ? 'pro' : 'plan'}`}>
                            {(org.license_plan || org.license?.plan || 'none').toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <strong>Vence:</strong>{' '}
                          {(org.license_expires_at || org.license?.expires_at)
                            ? new Date((org.license_expires_at || org.license?.expires_at)!).toLocaleDateString()
                            : 'Permanente'}
                        </div>
                      </div>

                      <div className="platform-card__actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => {
                            const currentPlan = org.license_plan || org.license?.plan || 'trial';
                            const currentExpiry = org.license_expires_at || org.license?.expires_at || null;
                            setModalError(null);
                            setEditingOrg(org);
                            setEditName(org.name);
                            setEditPlan(currentPlan);
                            setEditExpiry(currentExpiry ? currentExpiry.slice(0, 10) : '');
                            setEditActive(org.active !== false);
                          }}
                        >
                          <Edit2 size={13} /> Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={!org.active}
                          onClick={() => {
                            setModalError(null);
                            setSupportOrg(org);
                            setSupportReason('');
                          }}
                        >
                          <LogIn size={13} /> Entrar a Taller
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: GLOBAL USERS */}
          {activeTab === 'users' && (
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
                Directorio unificado de todos los usuarios registrados en el sistema y los talleres a los que pertenecen.
              </p>
              <div className="platform-table-wrap">
                <table className="platform-table">
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      <th>Email</th>
                      <th>Estado</th>
                      <th>Staff Plataforma</th>
                      <th>Organizaciones / Talleres</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-6)' }}>
                          No se encontraron usuarios
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => (
                        <tr key={u.id}>
                          <td><strong>{u.name || 'Sin nombre'}</strong></td>
                          <td style={{ fontFamily: 'monospace' }}>{u.email}</td>
                          <td>
                            <span className={`platform-chip platform-chip--${u.active ? 'active' : 'suspended'}`}>
                              {u.active ? 'Activo' : 'Inactivo'}
                            </span>
                          </td>
                          <td>
                            {u.platform_admin ? (
                              <span className="platform-chip platform-chip--pro">Superadmin</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>Usuario</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                              {u.memberships && u.memberships.length > 0 ? (
                                u.memberships.map((m) => (
                                  <span
                                    key={m.organization_id}
                                    className="platform-chip"
                                    style={{ background: 'var(--surface-sunken)', fontSize: 'var(--text-xs)' }}
                                    title={`Roles: ${(m.roles || []).join(', ')}`}
                                  >
                                    {m.organization_name || m.organization_id}
                                    <span style={{ opacity: 0.7, marginLeft: '4px' }}>
                                      ({(m.roles || []).join(', ')})
                                    </span>
                                  </span>
                                ))
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>Sin talleres</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: AUDIT LOG */}
          {activeTab === 'audit' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
                  Registro inmutable de seguridad (ADR-0005 §7): inicios de sesión, cambios de roles, membresías y sesiones de soporte.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <label htmlFor="audit-org-select" style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
                    Taller:
                  </label>
                  <select
                    id="audit-org-select"
                    className="platform-select"
                    style={{ width: 'auto', minWidth: '220px' }}
                    value={selectedAuditOrgId}
                    onChange={(e) => setSelectedAuditOrgId(e.target.value)}
                  >
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} ({org.slug})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="platform-table-wrap">
                <table className="platform-table">
                  <thead>
                    <tr>
                      <th>Fecha / Hora</th>
                      <th>Evento</th>
                      <th>Actor</th>
                      <th>Detalles</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEvents.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-6)' }}>
                          No hay eventos de auditoría registrados para esta organización.
                        </td>
                      </tr>
                    ) : (
                      auditEvents.map((ev) => (
                        <tr key={ev.id}>
                          <td style={{ whiteSpace: 'nowrap', fontSize: 'var(--text-xs)' }}>
                            {new Date(ev.created_at).toLocaleString()}
                          </td>
                          <td>
                            <span className="platform-chip platform-chip--plan" style={{ fontWeight: 600 }}>
                              {ev.event_type}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>
                            {ev.actor_user_id || 'Sistema'}
                          </td>
                          <td style={{ fontSize: 'var(--text-xs)' }}>
                            <pre style={{ margin: 0, padding: '2px 4px', background: 'var(--surface-sunken)', borderRadius: '4px', maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {JSON.stringify(ev.metadata)}
                            </pre>
                          </td>
                          <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                            {ev.ip_address || '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL: CREATE ORGANIZATION */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Crear Nueva Organización"
        size="md"
      >
        <form onSubmit={handleCreateOrg} className="platform-form">
          {modalError && (
            <div role="alert" className="platform-modal-error">
              {modalError}
            </div>
          )}

          <div className="platform-form-group">
            <label className="platform-label" htmlFor="org-name">
              Nombre del Taller / Negocio *
            </label>
            <input
              id="org-name"
              type="text"
              className="platform-input"
              required
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (!newSlug) {
                  setNewSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/(^-|-$)/g, ''),
                  );
                }
              }}
              placeholder="Ej: Carpintería Roble Sur"
            />
          </div>

          <div className="platform-form-group">
            <label className="platform-label" htmlFor="org-slug">
              Slug identificador único *
            </label>
            <input
              id="org-slug"
              type="text"
              className="platform-input"
              required
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
              placeholder="roble-sur"
            />
            <p className="platform-help-text">
              Usado para identificación en la URL y multi-tenancy aislado.
            </p>
          </div>

          <div className="platform-form-row">
            <div className="platform-form-group">
              <label className="platform-label" htmlFor="org-type">
                Tipo de Organización
              </label>
              <select
                id="org-type"
                className="platform-select"
                value={newType}
                onChange={(e) => setNewType(e.target.value as 'factory' | 'store' | 'dealer')}
              >
                <option value="factory">Fábrica / Taller</option>
                <option value="store">Tienda comercial</option>
                <option value="dealer">Distribuidor</option>
              </select>
            </div>
            <div className="platform-form-group">
              <label className="platform-label" htmlFor="org-plan">
                Plan de Licencia
              </label>
              <select
                id="org-plan"
                className="platform-select"
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value)}
              >
                <option value="trial">Prueba (Trial)</option>
                <option value="pro">Profesional (Pro)</option>
                <option value="none">Sin licencia</option>
              </select>
            </div>
          </div>

          <div className="platform-form-group">
            <label className="platform-label" htmlFor="org-expiry">
              Fecha de Vencimiento de Licencia (opcional)
            </label>
            <input
              id="org-expiry"
              type="date"
              className="platform-input"
              value={newExpiry}
              onChange={(e) => setNewExpiry(e.target.value)}
            />
            <p className="platform-help-text">
              Dejar en blanco para suscripción permanente o sin fecha límite estricta.
            </p>
          </div>

          <div className="platform-form-group">
            <label className="platform-label" htmlFor="org-clone">
              Clonar catálogo base desde (opcional)
            </label>
            <select
              id="org-clone"
              className="platform-select"
              value={cloneFromOrgId}
              onChange={(e) => setCloneFromOrgId(e.target.value)}
            >
              <option value="">-- Sin clonar (catálogo vacío) --</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.slug})
                </option>
              ))}
            </select>
            <p className="platform-help-text">
              Copia todos los tableros, herrajes, módulos y estructuras remapeando identificadores de forma aislada.
            </p>
          </div>

          <div className="platform-modal-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setShowCreateModal(false)}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? 'Creando...' : 'Crear Organización'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: EDIT ORGANIZATION */}
      <Modal
        open={editingOrg !== null}
        onClose={() => setEditingOrg(null)}
        title={`Editar ${editingOrg?.name ?? ''}`}
        size="md"
      >
        <form onSubmit={handleUpdateOrg} className="platform-form">
          {modalError && (
            <div role="alert" className="platform-modal-error">
              {modalError}
            </div>
          )}

          <div className="platform-form-group">
            <label className="platform-label" htmlFor="edit-name">
              Nombre de la Organización
            </label>
            <input
              id="edit-name"
              type="text"
              className="platform-input"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>

          <div className="platform-form-group">
            <label className="platform-label" htmlFor="edit-plan">
              Plan de Licencia
            </label>
            <select
              id="edit-plan"
              className="platform-select"
              value={editPlan}
              onChange={(e) => setEditPlan(e.target.value)}
            >
              <option value="trial">Prueba (Trial)</option>
              <option value="pro">Profesional (Pro)</option>
              <option value="none">Sin licencia</option>
            </select>
          </div>

          <div className="platform-form-group">
            <label className="platform-label" htmlFor="edit-expiry">
              Fecha de Vencimiento de Licencia (opcional)
            </label>
            <input
              id="edit-expiry"
              type="date"
              className="platform-input"
              value={editExpiry}
              onChange={(e) => setEditExpiry(e.target.value)}
            />
            <p className="platform-help-text">
              Dejar en blanco para suscripción permanente o sin fecha límite estricta.
            </p>
          </div>

          <label className="platform-checkbox-wrap" htmlFor="edit-active">
            <input
              type="checkbox"
              id="edit-active"
              className="platform-checkbox"
              checked={editActive}
              onChange={(e) => setEditActive(e.target.checked)}
            />
            <span>
              <strong>Organización Activa</strong> — si se desmarca, se suspende el acceso a todos los usuarios del taller inmediatamente.
            </span>
          </label>

          <div className="platform-modal-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setEditingOrg(null)}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: SUPPORT SESSION ("ENTRAR A TALLER") */}
      <Modal
        open={supportOrg !== null}
        onClose={() => setSupportOrg(null)}
        title={`Entrar a ${supportOrg?.name ?? ''} en modo soporte`}
        size="md"
      >
        <form
          onSubmit={handleStartSupportSession}
          className="platform-form"
        >
          {modalError && (
            <div role="alert" className="platform-modal-error">
              {modalError}
            </div>
          )}

          <div className="platform-banner-info">
            <strong>Sesión de soporte auditada:</strong> Se emitirá un token temporal de 2 horas con rol de
            administrador efectivo del taller. Toda acción realizada quedará registrada con tu usuario real
            en la auditoría de seguridad.
          </div>

          <div className="platform-form-group">
            <label className="platform-label" htmlFor="support-reason">
              Motivo del acceso (obligatorio, mín. 4 caracteres) *
            </label>
            <textarea
              id="support-reason"
              className="platform-textarea"
              rows={3}
              required
              placeholder="Ej: Asistencia en configuración de máquinas y diagnóstico de nesting"
              value={supportReason}
              onChange={(e) => setSupportReason(e.target.value)}
            />
          </div>

          <div className="platform-modal-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setSupportOrg(null)}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submitting || supportReason.trim().length < 4}
            >
              {submitting ? 'Iniciando...' : 'Iniciar Sesión y Entrar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
