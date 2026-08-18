import React, { useState, useMemo } from 'react';
import type {
  Project,
  ProjectInternalMessage,
  ProjectInternalMessageType,
  ProjectTechnicalStatus,
} from '@muebles/domain';
import {
  TECHNICAL_STATUS_METADATA,
  INTERNAL_MESSAGE_TYPE_METADATA,
  getAvailableTechnicalTransitions,
} from '@muebles/domain';
import {
  MessageSquare,
  Send,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  User,
  HardHat,
  Calendar,
  Clock,
  HelpCircle,
  FileEdit,
  ShieldAlert,
  Award,
} from 'lucide-react';
import './internalComms.css';

export interface InternalCommsPanelProps {
  readonly project: Project;
  readonly messages?: readonly ProjectInternalMessage[];
  readonly assignableOwners?: readonly { readonly id: string; readonly label: string }[];
  readonly currentUserId?: string;
  readonly onSendMessage: (msg: {
    messageType: ProjectInternalMessageType;
    content: string;
    senderName?: string;
  }) => Promise<void> | void;
  readonly onUpdateTechnicalWorkflow: (updates: {
    assignedEngineerId?: string;
    technicalStatus?: ProjectTechnicalStatus;
    surveyCompletedAt?: string;
    installationScheduledDate?: string;
    comment?: string;
  }) => Promise<void> | void;
}

export function InternalCommsPanel({
  project,
  messages = [],
  assignableOwners = [],
  currentUserId,
  onSendMessage,
  onUpdateTechnicalWorkflow,
}: InternalCommsPanelProps) {
  const [activeFilter, setActiveFilter] = useState<'all' | ProjectInternalMessageType>('all');
  const [messageType, setMessageType] = useState<ProjectInternalMessageType>('comment');
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [actionComment, setActionComment] = useState('');
  const [showCommentInputForStatus, setShowCommentInputForStatus] = useState<ProjectTechnicalStatus | null>(null);

  const currentTechStatus = project.technicalStatus ?? 'pending_assignment';
  const statusMeta = TECHNICAL_STATUS_METADATA[currentTechStatus];
  const availableTransitions = useMemo(
    () => getAvailableTechnicalTransitions(currentTechStatus),
    [currentTechStatus],
  );

  const filteredMessages = useMemo(() => {
    if (activeFilter === 'all') return messages;
    return messages.filter((m) => m.messageType === activeFilter);
  }, [messages, activeFilter]);

  const ownerLabel = useMemo(() => {
    if (!project.ownerUserId) return 'Sin asignar (Ventas)';
    const found = assignableOwners.find((o) => o.id === project.ownerUserId);
    return found ? found.label : project.ownerUserId;
  }, [project.ownerUserId, assignableOwners]);

  const engineerLabel = useMemo(() => {
    if (!project.assignedEngineerId) return 'Sin asignar';
    const found = assignableOwners.find((o) => o.id === project.assignedEngineerId);
    return found ? found.label : project.assignedEngineerId;
  }, [project.assignedEngineerId, assignableOwners]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || isSending) return;
    try {
      setIsSending(true);
      await onSendMessage({
        messageType,
        content: content.trim(),
      });
      setContent('');
    } finally {
      setIsSending(false);
    }
  };

  const handleTransitionClick = (targetStatus: ProjectTechnicalStatus) => {
    if (targetStatus === 'changes_requested' || targetStatus === 'approved_for_production') {
      setShowCommentInputForStatus(targetStatus);
    } else {
      void onUpdateTechnicalWorkflow({
        technicalStatus: targetStatus,
      });
    }
  };

  const handleConfirmTransitionWithComment = async (targetStatus: ProjectTechnicalStatus) => {
    await onUpdateTechnicalWorkflow({
      technicalStatus: targetStatus,
      comment: actionComment.trim() || undefined,
    });
    setActionComment('');
    setShowCommentInputForStatus(null);
  };

  const handleEngineerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextId = e.target.value || undefined;
    void onUpdateTechnicalWorkflow({
      assignedEngineerId: nextId,
      technicalStatus:
        currentTechStatus === 'pending_assignment' && nextId ? 'in_review' : undefined,
    });
  };

  const renderTypeIcon = (type: ProjectInternalMessageType) => {
    switch (type) {
      case 'technical_query':
        return <HelpCircle size={14} />;
      case 'query_response':
        return <CheckCircle2 size={14} />;
      case 'design_change':
        return <FileEdit size={14} />;
      case 'production_alert':
        return <ShieldAlert size={14} />;
      case 'gate_approval':
        return <Award size={14} />;
      default:
        return <MessageSquare size={14} />;
    }
  };

  return (
    <div className="internal-comms">
      {/* 1. Handoff Card */}
      <div className="internal-comms__handoff-card">
        <div className="internal-comms__handoff-header">
          <div className="internal-comms__handoff-title-group">
            <HardHat size={20} color="var(--color-primary, #2563eb)" />
            <h3 className="internal-comms__handoff-title">Handoff Técnico: Ventas ↔ Ingeniería / Taller</h3>
          </div>
          <span
            className={`status-badge status-badge--${
              statusMeta.color === 'neutral'
                ? 'cancelled'
                : statusMeta.color === 'info'
                  ? 'open'
                  : statusMeta.color === 'success'
                    ? 'done'
                    : statusMeta.color
            }`}
          >
            <Clock size={12} />
            {statusMeta.label}
          </span>
        </div>

        {/* Roles 2-column grid */}
        <div className="internal-comms__roles-grid">
          {/* Sales Lead */}
          <div className="internal-comms__role-box">
            <div className="internal-comms__role-avatar">
              <User size={18} />
            </div>
            <div className="internal-comms__role-info">
              <span className="internal-comms__role-label">Responsable Comercial (Ventas)</span>
              <span className="internal-comms__role-name" title={ownerLabel}>
                {ownerLabel}
              </span>
            </div>
          </div>

          {/* Engineer / Production Lead */}
          <div className="internal-comms__role-box">
            <div className="internal-comms__role-avatar internal-comms__role-avatar--engineer">
              <HardHat size={18} />
            </div>
            <div className="internal-comms__role-info">
              <span className="internal-comms__role-label">Responsable Técnico / Ingeniero</span>
              {assignableOwners.length > 0 ? (
                <select
                  className="internal-comms__role-select"
                  value={project.assignedEngineerId ?? ''}
                  onChange={handleEngineerChange}
                  aria-label="Asignar responsable técnico"
                >
                  <option value="">-- Asignar Ingeniero / Técnico --</option>
                  {assignableOwners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="internal-comms__role-name">{engineerLabel}</span>
              )}
            </div>
          </div>
        </div>

        {/* Key Dates Bar */}
        <div className="internal-comms__dates-bar">
          <div className="internal-comms__date-item">
            <Calendar size={14} />
            <span>Relevamiento en Obra:</span>
            <strong>
              {project.surveyCompletedAt
                ? new Date(project.surveyCompletedAt).toLocaleDateString()
                : 'Pendiente'}
            </strong>
          </div>
          <div className="internal-comms__date-item">
            <Calendar size={14} />
            <span>Instalación Programada:</span>
            <strong>
              {project.installationScheduledDate
                ? project.installationScheduledDate
                : 'A coordinar'}
            </strong>
          </div>
        </div>

        {/* Workflow Action Transitions */}
        <div className="internal-comms__workflow-actions">
          <span className="internal-comms__role-label">Transiciones de Estado Técnico:</span>
          {showCommentInputForStatus ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input
                type="text"
                className="internal-comms__textarea"
                style={{ minHeight: 'auto', padding: '0.4rem 0.6rem' }}
                placeholder={`Nota o motivo para pasar a ${TECHNICAL_STATUS_METADATA[showCommentInputForStatus].label}...`}
                value={actionComment}
                onChange={(e) => setActionComment(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="internal-comms__action-btn internal-comms__action-btn--primary"
                  onClick={() => handleConfirmTransitionWithComment(showCommentInputForStatus)}
                >
                  Confirmar pase a {TECHNICAL_STATUS_METADATA[showCommentInputForStatus].shortLabel}
                </button>
                <button
                  type="button"
                  className="internal-comms__action-btn internal-comms__action-btn--secondary"
                  onClick={() => setShowCommentInputForStatus(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="internal-comms__workflow-buttons">
              {availableTransitions.map((targetStatus) => {
                const targetMeta = TECHNICAL_STATUS_METADATA[targetStatus];
                let btnClass = 'internal-comms__action-btn--secondary';
                if (targetStatus === 'approved_for_production') btnClass = 'internal-comms__action-btn--primary';
                if (targetStatus === 'changes_requested') btnClass = 'internal-comms__action-btn--warning';
                if (targetStatus === 'in_workshop') btnClass = 'internal-comms__action-btn--primary';
                if (targetStatus === 'ready_to_install') btnClass = 'internal-comms__action-btn--primary';

                return (
                  <button
                    key={targetStatus}
                    type="button"
                    className={`internal-comms__action-btn ${btnClass}`}
                    onClick={() => handleTransitionClick(targetStatus)}
                  >
                    <ArrowRight size={13} />
                    {targetMeta.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 2. Feed & Chat Section */}
      <div className="internal-comms__feed-section">
        <div className="internal-comms__feed-header">
          <h4 className="internal-comms__feed-title">
            Hilo de Comunicación Interna ({messages.length})
          </h4>
          <div className="internal-comms__filter-pills">
            <button
              type="button"
              className={`internal-comms__filter-pill ${activeFilter === 'all' ? 'internal-comms__filter-pill--active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              Todos
            </button>
            <button
              type="button"
              className={`internal-comms__filter-pill ${activeFilter === 'technical_query' ? 'internal-comms__filter-pill--active' : ''}`}
              onClick={() => setActiveFilter('technical_query')}
            >
              Consultas Técnicas
            </button>
            <button
              type="button"
              className={`internal-comms__filter-pill ${activeFilter === 'design_change' ? 'internal-comms__filter-pill--active' : ''}`}
              onClick={() => setActiveFilter('design_change')}
            >
              Cambios de Diseño
            </button>
            <button
              type="button"
              className={`internal-comms__filter-pill ${activeFilter === 'production_alert' ? 'internal-comms__filter-pill--active' : ''}`}
              onClick={() => setActiveFilter('production_alert')}
            >
              Alertas Taller
            </button>
            <button
              type="button"
              className={`internal-comms__filter-pill ${activeFilter === 'gate_approval' ? 'internal-comms__filter-pill--active' : ''}`}
              onClick={() => setActiveFilter('gate_approval')}
            >
              Aprobaciones
            </button>
          </div>
        </div>

        {/* Message Feed List */}
        <div className="internal-comms__message-list">
          {filteredMessages.length === 0 ? (
            <div className="internal-comms__empty-feed">
              No hay mensajes registrados en este filtro. Escribe una nota, consulta técnica o aviso a continuación.
            </div>
          ) : (
            filteredMessages.map((msg) => {
              const typeMeta = INTERNAL_MESSAGE_TYPE_METADATA[msg.messageType] || INTERNAL_MESSAGE_TYPE_METADATA.comment;
              const dateStr = new Date(msg.createdAt).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              });
              const initials = msg.senderName
                ? msg.senderName
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)
                : 'U';

              return (
                <div
                  key={msg.id}
                  className={`internal-comms__message-card internal-comms__message-card--${msg.messageType}`}
                >
                  <div className="internal-comms__message-avatar">{initials}</div>
                  <div className="internal-comms__message-body">
                    <div className="internal-comms__message-meta">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="internal-comms__message-sender">{msg.senderName}</span>
                        <span className={`internal-comms__type-tag internal-comms__type-tag--${typeMeta.badgeColor}`}>
                          {renderTypeIcon(msg.messageType)}
                          <span style={{ marginLeft: '0.25rem' }}>{typeMeta.label}</span>
                        </span>
                      </div>
                      <span className="internal-comms__message-date">{dateStr}</span>
                    </div>
                    <div className="internal-comms__message-text">{msg.content}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <form className="internal-comms__composer" onSubmit={handleSend}>
          <div className="internal-comms__composer-controls">
            <div className="internal-comms__type-selector">
              <span>Tipo de mensaje:</span>
              <select
                className="internal-comms__type-select"
                value={messageType}
                onChange={(e) => setMessageType(e.target.value as ProjectInternalMessageType)}
              >
                <option value="comment">💬 Comentario General</option>
                <option value="technical_query">❓ Consulta Técnica (Ingeniería)</option>
                <option value="query_response">✅ Respuesta Técnica</option>
                <option value="design_change">✏️ Cambio de Diseño Acordado</option>
                <option value="production_alert">⚠️ Alerta de Taller / Falta Material</option>
                <option value="gate_approval">🛡️ Registro de Aprobación</option>
              </select>
            </div>
          </div>

          <textarea
            className="internal-comms__textarea"
            placeholder="Escribe un mensaje o consulta interna para el equipo..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
          />

          <div className="internal-comms__composer-footer">
            <button
              type="submit"
              className="internal-comms__send-btn"
              disabled={!content.trim() || isSending}
            >
              <Send size={14} />
              Enviar Mensaje
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
