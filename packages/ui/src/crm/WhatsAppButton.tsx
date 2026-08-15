import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { WhatsAppModal } from './WhatsAppModal';
import './whatsAppModal.css';

export interface WhatsAppButtonProps {
  readonly customerName?: string;
  readonly phone?: string;
  readonly projectName?: string;
  readonly quoteAmount?: string;
  readonly scheduledDate?: string;
  readonly workshopName?: string;
  readonly compact?: boolean;
  readonly label?: string;
  readonly className?: string;
}

export function WhatsAppButton({
  customerName,
  phone,
  projectName,
  quoteAmount,
  scheduledDate,
  workshopName,
  compact = false,
  label = 'WhatsApp',
  className = '',
}: WhatsAppButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`btn btn--secondary whatsapp-btn ${compact ? 'whatsapp-btn--compact' : ''} ${className}`}
        onClick={() => setModalOpen(true)}
        title={`Enviar WhatsApp a ${customerName || 'cliente'}`}
      >
        <MessageSquare size={16} className="whatsapp-btn__icon" aria-hidden="true" />
        {!compact && <span>{label}</span>}
      </button>

      <WhatsAppModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        customerName={customerName}
        phone={phone}
        projectName={projectName}
        quoteAmount={quoteAmount}
        scheduledDate={scheduledDate}
        workshopName={workshopName}
      />
    </>
  );
}
