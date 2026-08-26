import { useState, useEffect, useId } from 'react';
import {
  buildWhatsAppMessage,
  formatWhatsAppUrl,
  WHATSAPP_TEMPLATE_OPTIONS,
  type WhatsAppTemplateType,
  type WhatsAppTemplateVars,
} from '@granete/domain';
import { MessageSquare, ExternalLink } from 'lucide-react';
import { Modal } from '../common';
import './whatsAppModal.css';

export interface WhatsAppModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly customerName?: string;
  readonly phone?: string;
  readonly projectName?: string;
  readonly quoteAmount?: string;
  readonly scheduledDate?: string;
  readonly workshopName?: string;
}

export function WhatsAppModal({
  open,
  onClose,
  customerName = '',
  phone = '',
  projectName = '',
  quoteAmount = '',
  scheduledDate = '',
  workshopName = '',
}: WhatsAppModalProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplateType>('quote_ready');
  const [customPhone, setCustomPhone] = useState(phone);
  const [messageText, setMessageText] = useState('');
  const templateSelectId = useId();
  const phoneInputId = useId();
  const messageTextId = useId();

  const templateVars: WhatsAppTemplateVars = {
    customerName,
    projectName,
    quoteAmount,
    scheduledDate,
    workshopName,
  };

  useEffect(() => {
    setCustomPhone(phone);
  }, [phone]);

  useEffect(() => {
    if (selectedTemplate === 'custom') {
      if (!messageText) {
        setMessageText(`¡Hola ${customerName || 'Estimado/a'}! Nos comunicamos de ${workshopName || 'nuestro taller'}.`);
      }
    } else {
      setMessageText(buildWhatsAppMessage(selectedTemplate, templateVars));
    }
  }, [selectedTemplate, customerName, projectName, quoteAmount, scheduledDate, workshopName]);

  const handleSend = () => {
    const url = formatWhatsAppUrl(customPhone, messageText);
    window.open(url, '_blank', 'noopener,noreferrer');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Comunicación por WhatsApp"
      size="md"
      footer={
        <div className="whatsapp-modal__footer">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--primary whatsapp-modal__send-btn"
            onClick={handleSend}
            disabled={!messageText.trim()}
          >
            <ExternalLink size={16} aria-hidden="true" />
            <span>Abrir en WhatsApp</span>
          </button>
        </div>
      }
    >
      <div className="whatsapp-modal__content">
        <div className="whatsapp-modal__header-info">
          <div className="whatsapp-modal__badge">
            <MessageSquare size={16} aria-hidden="true" />
            <span>{customerName || 'Cliente'}</span>
          </div>
          {projectName && (
            <span className="whatsapp-modal__project-tag">{projectName}</span>
          )}
        </div>

        <div className="whatsapp-modal__field">
          <label htmlFor={phoneInputId} className="whatsapp-modal__label">
            Número de Teléfono / WhatsApp:
          </label>
          <input
            id={phoneInputId}
            type="tel"
            className="input-text whatsapp-modal__input"
            value={customPhone}
            onChange={(e) => setCustomPhone(e.target.value)}
            placeholder="Ej. +52 55 1234 5678 o 099 123 456"
          />
          {!customPhone && (
            <p className="whatsapp-modal__help-text">
              Si dejas el teléfono vacío, se abrirá WhatsApp para que elijas el contacto.
            </p>
          )}
        </div>

        <div className="whatsapp-modal__field">
          <label htmlFor={templateSelectId} className="whatsapp-modal__label">
            Plantilla de Mensaje:
          </label>
          <select
            id={templateSelectId}
            className="input-select whatsapp-modal__select"
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value as WhatsAppTemplateType)}
          >
            {WHATSAPP_TEMPLATE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label} — {opt.description}
              </option>
            ))}
          </select>
        </div>

        <div className="whatsapp-modal__field">
          <label htmlFor={messageTextId} className="whatsapp-modal__label">
            Mensaje a Enviar:
          </label>
          <textarea
            id={messageTextId}
            className="input-textarea whatsapp-modal__textarea"
            rows={5}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Escribe el mensaje..."
          />
        </div>
      </div>
    </Modal>
  );
}
