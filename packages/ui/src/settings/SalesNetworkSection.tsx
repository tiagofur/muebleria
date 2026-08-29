/**
 * SalesNetworkSection — Red de Ventas de la fábrica (#326):
 * "Factory Settings → Sales Network → Create Store → Invite Team".
 * Lista las tiendas/distribuidores conectados y crea nuevos; el catálogo se
 * clona desde la fábrica y el creador queda admin de la nueva org para
 * invitar a su equipo. Presentational fetches follow the UsersScreen pattern;
 * entering the new org is delegated to the shell (org switch + team screen).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Network, Store, Plus, LogIn, RefreshCw } from 'lucide-react';
import { GraneteApiClient, type FactoryOrganization } from '@granete/storage';
import { EmptyState } from '../common';

export type SalesNetworkSectionProps = {
  readonly baseUrl: string;
  readonly token: string;
  /** Enter the connected org (org switch) to invite its team. */
  readonly onEnterOrg: (orgId: string, orgName: string) => void;
};

const TYPE_LABELS: Record<FactoryOrganization['type'], string> = {
  store: 'Tienda comercial',
  dealer: 'Distribuidor',
};

export function SalesNetworkSection({
  baseUrl,
  token,
  onEnterOrg,
}: SalesNetworkSectionProps): ReactNode {
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);
  const [orgs, setOrgs] = useState<readonly FactoryOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<'store' | 'dealer'>('store');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<FactoryOrganization | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setOrgs(await api.listFactoryOrganizations(token));
    } catch {
      setLoadError('No se pudo cargar la red de ventas. Revisá tu conexión y volvé a intentar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, token]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError('Poné un nombre para la nueva organización.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const data = await api.createFactoryOrganization(token, { name: trimmed, type });
      setOrgs((prev) => [data.organization, ...prev]);
      setJustCreated(data.organization);
      setName('');
    } catch {
      setCreateError('No se pudo crear la organización. Revisá tu conexión.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <section aria-label="Red de ventas" data-testid="sales-network">
      {justCreated ? (
        <div
          role="status"
          data-testid="sales-network-created"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
            background: 'var(--surface-muted)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <strong>{justCreated.name} creada</strong>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            El catálogo de tu fábrica se clonó y sos admin de la nueva organización.
            Entrá para invitar a su equipo.
          </span>
          <div>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onEnterOrg(justCreated.id, justCreated.name)}
              data-testid="sales-network-enter"
            >
              <LogIn size={13} /> Entrar a {justCreated.name} e invitar equipo
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Cargando red…</p>
      ) : loadError ? (
        <EmptyState
          title="No se pudo cargar la red de ventas"
          description={loadError}
          actionLabel="Reintentar"
          onAction={() => void load()}
        />
      ) : orgs.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
          Todavía no tenés tiendas ni distribuidores conectados. Creá la primera con el
          formulario de abajo.
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: '0 0 var(--space-4)',
            padding: 0,
            display: 'grid',
            gap: 'var(--space-2)',
          }}
        >
          {orgs.map((o) => (
            <li
              key={o.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Store size={14} aria-hidden style={{ color: 'var(--text-secondary)' }} />
                <span>
                  <strong style={{ fontSize: 'var(--text-sm)' }}>{o.name}</strong>{' '}
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    {TYPE_LABELS[o.type] ?? o.type}
                    {o.active ? '' : ' · suspendida'}
                  </span>
                </span>
              </span>
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() => onEnterOrg(o.id, o.name)}
                disabled={!o.active}
                title={o.active ? undefined : 'Taller suspendido: la plataforma debe reactivarlo'}
              >
                Entrar
              </button>
            </li>
          ))}
        </ul>
      )}

      <fieldset
        className="catalog-form__section"
        style={{ maxWidth: '40rem' }}
        data-testid="sales-network-create"
      >
        <legend className="catalog-form__section-title">
          <Network size={13} aria-hidden style={{ marginRight: 6, verticalAlign: -2 }} />
          Crear organización conectada
        </legend>
        <p
          className="settings-lead settings-lead--inline"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}
        >
          La nueva organización arranca con una copia del catálogo de tu fábrica y licencia
          sin activar (la plataforma la asigna). Quedás como admin para invitar a su equipo.
        </p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
            alignItems: 'flex-end',
            marginTop: 'var(--space-3)',
          }}
        >
          <div className="catalog-form__field" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
            <label htmlFor="sales-network-name">Nombre</label>
            <input
              id="sales-network-name"
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Tienda Monterrey"
              maxLength={80}
              autoComplete="off"
            />
          </div>
          <div className="catalog-form__field" style={{ margin: 0 }}>
            <label htmlFor="sales-network-type">Tipo</label>
            <select
              id="sales-network-type"
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as 'store' | 'dealer')}
            >
              <option value="store">Tienda comercial</option>
              <option value="dealer">Distribuidor</option>
            </select>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void create()}
            disabled={creating}
          >
            {creating ? <RefreshCw size={13} /> : <Plus size={13} />}
            {creating ? 'Creando…' : 'Crear organización'}
          </button>
        </div>
        {createError ? (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', margin: 'var(--space-2) 0 0' }}>
            {createError}
          </p>
        ) : null}
      </fieldset>
    </section>
  );
}
