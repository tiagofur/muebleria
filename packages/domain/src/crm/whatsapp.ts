/**
 * WhatsApp CRM integration & message templates for carpentry projects.
 */

export type WhatsAppTemplateType =
  | 'quote_ready'
  | 'production_started'
  | 'installation_scheduled'
  | 'project_completed'
  | 'custom';

export interface WhatsAppTemplateVars {
  readonly customerName?: string;
  readonly projectName?: string;
  readonly quoteAmount?: string;
  readonly scheduledDate?: string;
  readonly workshopName?: string;
}

export interface WhatsAppTemplateOption {
  readonly id: WhatsAppTemplateType;
  readonly label: string;
  readonly description: string;
}

export const WHATSAPP_TEMPLATE_OPTIONS: readonly WhatsAppTemplateOption[] = [
  {
    id: 'quote_ready',
    label: 'Presupuesto Listo',
    description: 'Enviar propuesta comercial y cotización al cliente',
  },
  {
    id: 'production_started',
    label: 'Fabricación Iniciada',
    description: 'Avisar que el proyecto entró a corte y armado en taller',
  },
  {
    id: 'installation_scheduled',
    label: 'Instalación Programada',
    description: 'Confirmar la fecha acordada para el montaje en obra',
  },
  {
    id: 'project_completed',
    label: 'Proyecto Entregado',
    description: 'Agradecimiento por la instalación y entrega de conformidad',
  },
  {
    id: 'custom',
    label: 'Mensaje Libre',
    description: 'Escribir un mensaje personalizado',
  },
] as const;

/**
 * Generates standard message text based on template type and variable values.
 */
export function buildWhatsAppMessage(
  template: WhatsAppTemplateType,
  vars: WhatsAppTemplateVars = {},
): string {
  const name = vars.customerName?.trim() || 'Estimado/a';
  const project = vars.projectName?.trim() || 'tu proyecto de mobiliario';
  const amount = vars.quoteAmount?.trim();
  const date = vars.scheduledDate?.trim() || '[Fecha por coordinar]';
  const workshop = vars.workshopName?.trim();

  const sign = workshop ? `\n\nSaludos,\n*${workshop}*` : '';

  switch (template) {
    case 'quote_ready': {
      const priceText = amount ? ` por un total de *${amount}*` : '';
      return `¡Hola ${name}! Te comparto la cotización de *${project}*${priceText}.\n\nQuedo a tu disposición si quieres revisar algún acabado o detalle antes de confirmar.${sign}`;
    }
    case 'production_started':
      return `¡Hola ${name}! Te comentamos con entusiasmo que *${project}* ya entró a la etapa de corte y fabricación en taller.\n\nTe mantendremos al tanto del avance.${sign}`;

    case 'installation_scheduled':
      return `¡Hola ${name}! Te confirmamos la fecha programada para la instalación de *${project}* para el día *${date}*.\n\nPor favor avísanos si necesitas coordinar algún detalle de acceso o recepción en obra.${sign}`;

    case 'project_completed':
      return `¡Hola ${name}! Hemos finalizado la instalación de *${project}*.\n\n¡Esperamos que disfrutes mucho de tu nuevo mobiliario! Muchísimas gracias por confiar en nuestro taller.${sign}`;

    case 'custom':
    default:
      return `¡Hola ${name}! Nos comunicamos respecto a tu proyecto *${project}*.`;
  }
}

/**
 * Sanitizes phone numbers by keeping only numeric digits.
 */
export function sanitizePhoneNumber(phone: string): string {
  if (!phone) return '';
  return phone.replace(/[^\d]/g, '');
}

/**
 * Formats a wa.me URL with optional phone and prefilled message text.
 */
export function formatWhatsAppUrl(phone: string, text: string): string {
  const cleanPhone = sanitizePhoneNumber(phone);
  const encodedText = encodeURIComponent(text.trim());

  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}${encodedText ? `?text=${encodedText}` : ''}`;
  }
  return `https://wa.me/${encodedText ? `?text=${encodedText}` : ''}`;
}
