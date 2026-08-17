/**
 * SectorAssignment — Component for assigning production sectors to operators.
 * Used by gerente_produccion and admin to manage operator sector access.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import './sectorAssignment.css';

export interface UserSector {
  readonly userId: string;
  readonly sector: string;
  readonly subSector?: string;
  readonly assignedAt: string;
}

export interface SectorAssignmentProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly userId: string;
  readonly userName: string;
  readonly onClose: () => void;
}

/** Available production sectors */
const SECTORS = [
  { id: 'cutting', label: 'Corte' },
  { id: 'edge_banding', label: 'Cantos' },
  { id: 'cnc', label: 'CNC' },
  { id: 'assembly', label: 'Ensamble' },
  { id: 'packaging', label: 'Empaque' },
  { id: 'warehouse', label: 'Almacén' },
] as const;

/** Warehouse sub-sectors */
const WAREHOUSE_SUB_SECTORS = [
  { id: 'herrajes', label: 'Herrajes' },
  { id: 'tableros', label: 'Tableros' },
  { id: 'cintillas', label: 'Cintillas' },
] as const;

export function SectorAssignment({
  baseUrl,
  token,
  userId,
  userName,
  onClose,
}: SectorAssignmentProps): ReactNode {
  const [sectors, setSectors] = useState<UserSector[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Local state for selected sectors
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [selectedSubSectors, setSelectedSubSectors] = useState<Set<string>>(new Set());

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
        setSectors(data);

        // Initialize selected state
        const sectorSet = new Set<string>();
        const subSectorSet = new Set<string>();
        for (const s of data) {
          sectorSet.add(s.sector);
          if (s.subSector) {
            subSectorSet.add(`${s.sector}:${s.subSector}`);
          }
        }
        setSelectedSectors(sectorSet);
        setSelectedSubSectors(subSectorSet);
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
        // Remove sub-sectors when removing parent
        setSelectedSubSectors((subPrev) => {
          const subNext = new Set(subPrev);
          for (const sub of subNext) {
            if (sub.startsWith(`${sectorId}:`)) {
              subNext.delete(sub);
            }
          }
          return subNext;
        });
      } else {
        next.add(sectorId);
      }
      return next;
    });
  };

  const toggleSubSector = (sectorId: string, subSectorId: string) => {
    const key = `${sectorId}:${subSectorId}`;
    setSelectedSubSectors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      // Build sectors array
      const sectorsPayload: Array<{ sector: string; sub_sector?: string }> = [];
      for (const sectorId of selectedSectors) {
        if (sectorId === 'warehouse') {
          // Warehouse needs sub-sectors
          const warehouseSubs = Array.from(selectedSubSectors)
            .filter((s) => s.startsWith('warehouse:'))
            .map((s) => s.split(':')[1]);
          if (warehouseSubs.length === 0) {
            showToast('Almacén requiere al menos un sub-sector');
            return;
          }
          for (const sub of warehouseSubs) {
            sectorsPayload.push({ sector: sectorId, sub_sector: sub });
          }
        } else {
          sectorsPayload.push({ sector: sectorId });
        }
      }

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
            Seleccioná los sectores donde este operador puede trabajar:
          </p>

          <div className="sector-assignment-list">
            {SECTORS.map((sector) => (
              <div key={sector.id} className="sector-assignment-item">
                <label className="sector-assignment-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedSectors.has(sector.id)}
                    onChange={() => toggleSector(sector.id)}
                  />
                  <span className="sector-assignment-label">{sector.label}</span>
                </label>

                {sector.id === 'warehouse' && selectedSectors.has('warehouse') && (
                  <div className="sector-assignment-sub-sectors">
                    {WAREHOUSE_SUB_SECTORS.map((sub) => (
                      <label key={sub.id} className="sector-assignment-checkbox sub">
                        <input
                          type="checkbox"
                          checked={selectedSubSectors.has(`warehouse:${sub.id}`)}
                          onChange={() => toggleSubSector('warehouse', sub.id)}
                        />
                        <span className="sector-assignment-label">{sub.label}</span>
                      </label>
                    ))}
                  </div>
                )}
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
