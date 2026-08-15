import React, { useMemo, useState } from 'react';
import type {
  ProductionCutRow,
  WarrantyPhotoKind,
  WarrantyRefabricationPiece,
  WarrantyTicket,
  WarrantyTicketCategory,
  WarrantyTicketPriority,
  WarrantyTicketStatus,
} from '@muebles/domain';
import {
  WARRANTY_CATEGORY_METADATA,
  WARRANTY_PRIORITY_METADATA,
  WARRANTY_STATUS_METADATA,
} from '@muebles/domain';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  Scissors,
  Trash2,
  Upload,
  User,
  Wrench,
} from 'lucide-react';
import './warranty.css';

export interface WarrantyTicketsPanelProps {
  readonly projectId: string;
  readonly projectName?: string;
  readonly customerId?: string;
  readonly tickets?: readonly WarrantyTicket[];
  readonly availableCutRows?: readonly ProductionCutRow[];
  readonly technicians?: readonly { readonly id: string; readonly name: string }[];
  readonly onCreateTicket: (
    ticket: Partial<WarrantyTicket> & {
      projectId: string;
      title: string;
      category: WarrantyTicketCategory;
      priority: WarrantyTicketPriority;
    },
  ) => Promise<void>;
  readonly onUpdateTicket: (
    ticketId: string,
    updates: Partial<WarrantyTicket>,
  ) => Promise<void>;
  readonly onDeleteTicket?: (ticketId: string) => Promise<void>;
  readonly onUploadPhoto?: (
    ticketId: string,
    file: File,
    kind?: WarrantyPhotoKind,
    caption?: string,
  ) => Promise<void>;
  readonly onDeletePhoto?: (ticketId: string, photoId: string) => Promise<void>;
  readonly onExportRefabricationOptimizer?: (ticket: WarrantyTicket) => void;
}

export function WarrantyTicketsPanel({
  projectId,
  projectName,
  customerId,
  tickets = [],
  availableCutRows = [],
  technicians = [],
  onCreateTicket,
  onUpdateTicket,
  onDeleteTicket,
  onUploadPhoto,
  onExportRefabricationOptimizer,
}: WarrantyTicketsPanelProps): React.JSX.Element {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [resolvingTicketId, setResolvingTicketId] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  // New ticket state
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] =
    useState<WarrantyTicketCategory>('hardware_adjustment');
  const [newPriority, setNewPriority] = useState<WarrantyTicketPriority>('normal');
  const [newTechnicianId, setNewTechnicianId] = useState('');
  const [newScheduledDate, setNewScheduledDate] = useState('');
  const [selectedPieces, setSelectedPieces] = useState<WarrantyRefabricationPiece[]>([]);

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    if (filterStatus === 'all') return tickets;
    return tickets.filter((t) => t.status === filterStatus);
  }, [tickets, filterStatus]);

  const handleOpenCreateModal = () => {
    setNewTitle('');
    setNewDesc('');
    setNewCategory('hardware_adjustment');
    setNewPriority('normal');
    setNewTechnicianId('');
    setNewScheduledDate('');
    setSelectedPieces([]);
    setIsCreateModalOpen(true);
  };

  const handleAddPieceFromCutList = (row: ProductionCutRow) => {
    const existingIndex = selectedPieces.findIndex(
      (p) =>
        p.pieceDescription === row.description &&
        p.lengthMm === row.lengthMm &&
        p.widthMm === row.widthMm,
    );
    if (existingIndex >= 0) {
      setSelectedPieces((prev) =>
        prev.map((p, i) =>
          i === existingIndex ? { ...p, quantity: p.quantity + 1 } : p,
        ),
      );
    } else {
      const newPiece: WarrantyRefabricationPiece = {
        pieceDescription: row.description,
        materialName: row.materialName,
        lengthMm: row.lengthMm,
        widthMm: row.widthMm,
        quantity: 1,
        grain: row.grain,
        L1: row.L1,
        L2: row.L2,
        W1: row.W1,
        W2: row.W2,
        partName: row.partName,
        partCode: row.partCode,
        moduleCode: row.moduleCode,
      };
      setSelectedPieces((prev) => [...prev, newPiece]);
    }
  };

  const handleRemovePiece = (index: number) => {
    setSelectedPieces((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setBusy(true);
    try {
      await onCreateTicket({
        projectId,
        customerId,
        title: newTitle.trim(),
        description: newDesc.trim(),
        category: newCategory,
        priority: newPriority,
        assignedTechnicianId: newTechnicianId || undefined,
        scheduledDate: newScheduledDate || undefined,
        refabricationPieces: selectedPieces,
      });
      setIsCreateModalOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleResolveTicket = async (ticketId: string) => {
    setBusy(true);
    try {
      await onUpdateTicket(ticketId, {
        status: 'resolved',
        resolutionNotes: resolutionNotes.trim() || 'Incidencia resuelta satisfactoriamente.',
        resolvedAt: new Date().toISOString(),
      });
      setResolvingTicketId(null);
      setResolutionNotes('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="warranty-panel">
      {/* Header & Controls */}
      <div className="warranty-panel__header">
        <div className="warranty-panel__header-left">
          <h3 className="warranty-panel__title">
            <Wrench size={20} className="text-primary" />
            Mesa de Garantías & Re-corte
          </h3>
          <div className="warranty-panel__filters">
            <button
              type="button"
              className={`warranty-panel__filter-btn ${filterStatus === 'all' ? 'warranty-panel__filter-btn--active' : ''}`}
              onClick={() => setFilterStatus('all')}
            >
              Todos ({tickets.length})
            </button>
            <button
              type="button"
              className={`warranty-panel__filter-btn ${filterStatus === 'open' ? 'warranty-panel__filter-btn--active' : ''}`}
              onClick={() => setFilterStatus('open')}
            >
              Abiertos ({tickets.filter((t) => t.status === 'open').length})
            </button>
            <button
              type="button"
              className={`warranty-panel__filter-btn ${filterStatus === 'visit_scheduled' ? 'warranty-panel__filter-btn--active' : ''}`}
              onClick={() => setFilterStatus('visit_scheduled')}
            >
              Visitas ({tickets.filter((t) => t.status === 'visit_scheduled').length})
            </button>
            <button
              type="button"
              className={`warranty-panel__filter-btn ${filterStatus === 'in_progress' ? 'warranty-panel__filter-btn--active' : ''}`}
              onClick={() => setFilterStatus('in_progress')}
            >
              En Taller ({tickets.filter((t) => t.status === 'in_progress').length})
            </button>
            <button
              type="button"
              className={`warranty-panel__filter-btn ${filterStatus === 'resolved' ? 'warranty-panel__filter-btn--active' : ''}`}
              onClick={() => setFilterStatus('resolved')}
            >
              Resueltos ({tickets.filter((t) => t.status === 'resolved').length})
            </button>
          </div>
        </div>

        <button
          type="button"
          className="warranty-panel__create-btn"
          onClick={handleOpenCreateModal}
        >
          <Plus size={16} />
          Nuevo Ticket
        </button>
      </div>

      {/* Tickets List */}
      {filteredTickets.length === 0 ? (
        <div className="warranty-panel__empty">
          <CheckCircle2 size={36} className="text-muted" />
          <p>No hay tickets de garantía registrados con este filtro.</p>
        </div>
      ) : (
        <div className="warranty-panel__tickets-list">
          {filteredTickets.map((ticket) => {
            const catMeta = WARRANTY_CATEGORY_METADATA[ticket.category];
            const prioMeta = WARRANTY_PRIORITY_METADATA[ticket.priority];
            const statusMeta = WARRANTY_STATUS_METADATA[ticket.status];
            const hasRefab =
              ticket.refabricationPieces && ticket.refabricationPieces.length > 0;

            const assignedTech = technicians.find(
              (t) => t.id === ticket.assignedTechnicianId,
            );

            return (
              <div key={ticket.id} className="warranty-card">
                <div className="warranty-card__header">
                  <div className="warranty-card__title-group">
                    <span className="warranty-card__code">
                      {ticket.ticketNumber}
                    </span>
                    <h4 className="warranty-card__title">{ticket.title}</h4>
                  </div>

                  <div className="warranty-card__badges">
                    <span className="warranty-badge warranty-badge--category">
                      {catMeta?.label ?? ticket.category}
                    </span>
                    <span
                      className={`warranty-badge warranty-badge--priority-${ticket.priority}`}
                    >
                      {prioMeta?.label ?? ticket.priority}
                    </span>
                    <span
                      className={`warranty-badge warranty-badge--status-${ticket.status === 'visit_scheduled' ? 'visit' : ticket.status === 'in_progress' ? 'progress' : ticket.status}`}
                    >
                      {statusMeta?.label ?? ticket.status}
                    </span>
                  </div>
                </div>

                {ticket.description && (
                  <p className="warranty-card__description">
                    {ticket.description}
                  </p>
                )}

                {/* Metadata Grid */}
                <div className="warranty-card__meta-grid">
                  <div className="warranty-card__meta-item">
                    <span className="warranty-card__meta-label">
                      <User size={12} style={{ display: 'inline', marginRight: 4 }} />
                      Técnico Asignado
                    </span>
                    <span className="warranty-card__meta-val">
                      {assignedTech?.name ?? 'Sin asignar'}
                    </span>
                  </div>

                  <div className="warranty-card__meta-item">
                    <span className="warranty-card__meta-label">
                      <Calendar size={12} style={{ display: 'inline', marginRight: 4 }} />
                      Fecha de Visita / Reparación
                    </span>
                    <span className="warranty-card__meta-val">
                      {ticket.scheduledDate ?? 'Pendiente de coordinar'}
                    </span>
                  </div>

                  <div className="warranty-card__meta-item">
                    <span className="warranty-card__meta-label">
                      <Scissors size={12} style={{ display: 'inline', marginRight: 4 }} />
                      Piezas de Re-corte
                    </span>
                    <span className="warranty-card__meta-val">
                      {hasRefab
                        ? `${ticket.refabricationPieces.length} pieza(s) en orden`
                        : 'No requiere re-corte'}
                    </span>
                  </div>
                </div>

                {/* Refabrication Pieces Table */}
                {hasRefab && (
                  <div className="warranty-card__refab">
                    <div className="warranty-card__refab-header">
                      <span>Piezas Solicitadas para Re-corte:</span>
                      {onExportRefabricationOptimizer && (
                        <button
                          type="button"
                          className="warranty-btn warranty-btn--optimizer"
                          onClick={() => onExportRefabricationOptimizer(ticket)}
                        >
                          <FileSpreadsheet size={14} />
                          Descargar para Optimizer (.xlsx)
                        </button>
                      )}
                    </div>

                    <table className="warranty-card__pieces-table">
                      <thead>
                        <tr>
                          <th>Cant</th>
                          <th>Descripción</th>
                          <th>Material</th>
                          <th>Dimensiones (L x An)</th>
                          <th>Cantos (L1/L2/W1/W2)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ticket.refabricationPieces.map((p, idx) => (
                          <tr key={idx}>
                            <td>{p.quantity}</td>
                            <td>{p.pieceDescription}</td>
                            <td>{p.materialName}</td>
                            <td>
                              {p.lengthMm} × {p.widthMm} mm
                            </td>
                            <td>
                              {p.L1}/{p.L2}/{p.W1}/{p.W2}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Resolution Summary if Resolved */}
                {ticket.status === 'resolved' && (
                  <div className="warranty-card__resolution-box">
                    <div className="warranty-card__resolution-title">
                      <CheckCircle2 size={16} />
                      Resuelto el{' '}
                      {ticket.resolvedAt
                        ? new Date(ticket.resolvedAt).toLocaleDateString()
                        : ''}
                    </div>
                    {ticket.resolutionNotes && (
                      <p className="warranty-card__resolution-notes">
                        {ticket.resolutionNotes}
                      </p>
                    )}
                  </div>
                )}

                {/* Resolving inline form */}
                {resolvingTicketId === ticket.id && (
                  <div className="warranty-modal__field" style={{ marginTop: '0.5rem' }}>
                    <label className="warranty-modal__label">
                      Comprobante / Notas de resolución:
                    </label>
                    <textarea
                      className="warranty-modal__textarea"
                      placeholder="Detalle el trabajo realizado (ej. se cambió frente y se calibró tirador)..."
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="warranty-btn warranty-btn--outline"
                        onClick={() => setResolvingTicketId(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="warranty-btn warranty-btn--success"
                        disabled={busy}
                        onClick={() => handleResolveTicket(ticket.id)}
                      >
                        Confirmar Resolución
                      </button>
                    </div>
                  </div>
                )}

                {/* Actions footer */}
                <div className="warranty-card__actions">
                  {onUploadPhoto && (
                    <label className="warranty-btn warranty-btn--outline" style={{ cursor: 'pointer' }}>
                      <Upload size={14} />
                      Adjuntar Foto
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void onUploadPhoto(ticket.id, f);
                        }}
                      />
                    </label>
                  )}

                  {ticket.status !== 'resolved' && ticket.status !== 'cancelled' && (
                    <>
                      {ticket.status === 'open' && (
                        <button
                          type="button"
                          className="warranty-btn warranty-btn--outline"
                          onClick={() =>
                            void onUpdateTicket(ticket.id, {
                              status: 'visit_scheduled',
                            })
                          }
                        >
                          Programar Visita
                        </button>
                      )}
                      {ticket.status === 'visit_scheduled' && (
                        <button
                          type="button"
                          className="warranty-btn warranty-btn--outline"
                          onClick={() =>
                            void onUpdateTicket(ticket.id, {
                              status: 'in_progress',
                            })
                          }
                        >
                          Pasar a Armado / Taller
                        </button>
                      )}
                      {resolvingTicketId !== ticket.id && (
                        <button
                          type="button"
                          className="warranty-btn warranty-btn--success"
                          onClick={() => {
                            setResolvingTicketId(ticket.id);
                            setResolutionNotes('');
                          }}
                        >
                          <CheckCircle2 size={14} />
                          Resolver Incidencia
                        </button>
                      )}
                    </>
                  )}

                  {onDeleteTicket && (
                    <button
                      type="button"
                      className="warranty-btn warranty-btn--outline"
                      title="Eliminar ticket"
                      onClick={() => void onDeleteTicket(ticket.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Ticket Modal */}
      {isCreateModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            className="warranty-modal"
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              padding: '1.5rem',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
                Nuevo Ticket de Garantía / Reclamo
              </h3>
              <button
                type="button"
                className="warranty-btn warranty-btn--outline"
                onClick={() => setIsCreateModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="warranty-modal__field">
                <label className="warranty-modal__label">Título de la incidencia *</label>
                <input
                  type="text"
                  required
                  className="warranty-modal__input"
                  placeholder="Ej. Frente de cajón rayado en cocina"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </div>

              <div className="warranty-modal__grid-2">
                <div className="warranty-modal__field">
                  <label className="warranty-modal__label">Categoría</label>
                  <select
                    className="warranty-modal__select"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as WarrantyTicketCategory)}
                  >
                    <option value="hardware_adjustment">Ajuste de herrajes</option>
                    <option value="damaged_part">Pieza dañada / rayada</option>
                    <option value="finishing_defect">Detalle de acabado / canto</option>
                    <option value="installation_issue">Descuadre / fijación en obra</option>
                    <option value="other">Otro reclamo</option>
                  </select>
                </div>

                <div className="warranty-modal__field">
                  <label className="warranty-modal__label">Prioridad</label>
                  <select
                    className="warranty-modal__select"
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as WarrantyTicketPriority)}
                  >
                    <option value="low">Baja</option>
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgente</option>
                  </select>
                </div>
              </div>

              <div className="warranty-modal__grid-2">
                <div className="warranty-modal__field">
                  <label className="warranty-modal__label">Técnico / Instalador Asignado</label>
                  <select
                    className="warranty-modal__select"
                    value={newTechnicianId}
                    onChange={(e) => setNewTechnicianId(e.target.value)}
                  >
                    <option value="">-- Sin asignar --</option>
                    {technicians.map((tech) => (
                      <option key={tech.id} value={tech.id}>
                        {tech.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="warranty-modal__field">
                  <label className="warranty-modal__label">Fecha de Visita Estimada</label>
                  <input
                    type="date"
                    className="warranty-modal__input"
                    value={newScheduledDate}
                    onChange={(e) => setNewScheduledDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="warranty-modal__field">
                <label className="warranty-modal__label">Descripción detallada</label>
                <textarea
                  className="warranty-modal__textarea"
                  placeholder="Detalle el reclamo del cliente o el defecto encontrado..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </div>

              {/* Refabrication Pieces Selection */}
              <div className="warranty-modal__pieces-selector">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="warranty-modal__label">
                    <Scissors size={14} style={{ display: 'inline', marginRight: 4 }} />
                    Piezas para Re-fabricación ({selectedPieces.length})
                  </label>
                </div>

                {availableCutRows.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      Selecciona una pieza del despiece del proyecto para re-cortar:
                    </span>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', maxHeight: '120px', overflowY: 'auto' }}>
                      {availableCutRows.map((row, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="warranty-btn warranty-btn--outline"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                          onClick={() => handleAddPieceFromCutList(row)}
                        >
                          + {row.description} ({row.lengthMm}×{row.widthMm}mm)
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    No se encontró despiece calculado para este proyecto.
                  </span>
                )}

                {/* Selected pieces preview */}
                {selectedPieces.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.5rem' }}>
                    {selectedPieces.map((p, idx) => (
                      <div key={idx} className="warranty-modal__piece-row">
                        <span>
                          <strong>{p.quantity}x</strong> {p.pieceDescription} ({p.materialName}, {p.lengthMm}×{p.widthMm}mm)
                        </span>
                        <button
                          type="button"
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                          onClick={() => handleRemovePiece(idx)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="warranty-btn warranty-btn--outline"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="warranty-panel__create-btn"
                  disabled={busy}
                >
                  {busy ? 'Creando...' : 'Crear Ticket de Garantía'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
