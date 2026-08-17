/**
 * SectorAssignment — Component for assigning production sectors to operators.
 * Used by gerente_produccion and admin to manage operator sector access.
 *
 * All sectors are first-class — no sub-sector nesting. For almacen,
 * herrajes/tableros/cintillas appear as direct checkboxes.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import {
  PIPELINE_SECTORS,
  PRODUCTION_SECTOR_LABELS_ES,
  sectorsAllowedForRole,
  type ProductionSector,
  type ProductRole,
} from '@muebles/domain';
import './sectorAssignment.css';

export interface UserSector {
  readonly userId: string;
  readonly sector: string;
  readonly assignedAt: string;
}

export interface SectorAssignmentProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly userId: string;
  readonly userName: string;
  readonly role: ProductRole;
  readonly onClose: () => void;
}

/**
 * Assignable sectors — the single domain vocabulary (F094): the pipeline
 * stations in manufacturing order plus warehouse and material sectors.
 * Filtered by role: produccion sees all; almacen sees only material types.
 */
function buildSectorList(role: ProductRole): readonly { id: ProductionSector; label: string }[] {
  const allowed = sectorsAllowedForRole(role);
  if (allowed.length === 0) {
    // Supervisors: show all (they manage, not work)
    return [
      ...PIPELINE_SECTORS.map((sector) => ({
        id: sector,
        label: PRODUCTION_SECTOR_LABELS_ES[sector],
      })),
      { id: 'warehouse' as ProductionSector, label: PRODUCTION_SECTOR_LABELS_ES.warehouse },
      { id: 'herrajes' as ProductionSector, label: PRODUCTION_SECTOR_LABELS_ES.herrajes },
      { id: 'tableros' as ProductionSector, label: PRODUCTION_SECTOR_LABELS_ES.tableros },
      { id: 'cintillas' as ProductionSector, label: PRODUCTION_SECTOR_LABELS_ES.cintillas },
    ];
  }
  return allowed.map((sector) => ({
    id: sector,
    label: PRODUCTION_SECTOR_LABELS_ES[sector],
  }));
}

export function SectorAssignment({
  baseUrl,
  token,
  userId,
  userName,
  role,
  onClose,
}: SectorAssignmentProps): ReactNode {
  const sectors = useMemo(() => buildSectorList(role), [role]);
  const [assignedSectors, setAssignedSectors] = useState<UserSector[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Selected sectors — simple set of sector IDs
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());

  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Load current sectors
  useEffect(() => {
    const loadSectors = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${baseUrl}/admin/users/${userId}/sectors`, { headers });
        if (!res.ok) throw new Error('Error loading sectors');
        const data = (await res.json()) as UserSector[];
        setAssignedSectors(data);

        // Initialize selected state from assigned sectors
        const sectorSet = new Set<string>();
        for (const s of data) {
          sectorSet.add(s.sector);
        }
        setSelectedSectors(sectorSet);
      } finally {
        setLoading(false);
      }
    };
    void loadSectors();
  }, [baseUrl, token, userId, headers]);

  const toggleSector = (sectorId: string) => {
    setSelectedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sectorId)) {
        next.delete(sectorId);
      } else {
        next.add(sectorId);
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      // All sectors are first-class — no sub_sector
      const sectorsPayload = Array.from(selectedSectors).map((sector) => ({ sector }));

      const res = await fetch(`${baseUrl}/admin/users/${userId}/sectors`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ sectors: sectorsPayload }),
      });

      if (!res.ok) throw new Error('Error saving sectors');
      showToast('✓ Sectores actualizados');
      onClose();
    } catch (err) {
      showToast('Error al guardar sectores');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="sector-assignment-overlay">
        <div className="sector-assignment-modal">
          <div className="sector-assignment-loading">Cargando sectores...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="sector-assignment-overlay">
      <div className="sector-assignment-modal">
        <div className="sector-assignment-header">
          <h3>Sectores de {userName}</h3>
          <button className="sector-assignment-close" onClick={onClose}>
            <XCircle size={20} />
          </button>
        </div>

        <div className="sector-assignment-body">
          <p className="sector-assignment-description">
            {role === 'almacen'
              ? 'Seleccioná los tipos de material que este operador de almacén gestiona:'
              : 'Seleccioná los sectores donde este operador puede trabajar:'}
          </p>

          <div className="sector-assignment-list">
            {sectors.map((sector) => (
              <div key={sector.id} className="sector-assignment-item">
                <label className="sector-assignment-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedSectors.has(sector.id)}
                    onChange={() => toggleSector(sector.id)}
                  />
                  <span className="sector-assignment-label">{sector.label}</span>
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="sector-assignment-footer">
          <button className="sector-assignment-cancel" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="sector-assignment-save"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>

        {toast && <div className="sector-assignment-toast">{toast}</div>}
      </div>
    </div>
  );
}
