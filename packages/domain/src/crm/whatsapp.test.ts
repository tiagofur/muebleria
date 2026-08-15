import { describe, it, expect } from 'vitest';
import {
  buildWhatsAppMessage,
  sanitizePhoneNumber,
  formatWhatsAppUrl,
  WHATSAPP_TEMPLATE_OPTIONS,
} from './whatsapp';

describe('WhatsApp CRM integration', () => {
  it('has valid template options', () => {
    expect(WHATSAPP_TEMPLATE_OPTIONS.length).toBeGreaterThanOrEqual(4);
    const ids = WHATSAPP_TEMPLATE_OPTIONS.map((o) => o.id);
    expect(ids).toContain('quote_ready');
    expect(ids).toContain('production_started');
    expect(ids).toContain('installation_scheduled');
    expect(ids).toContain('project_completed');
  });

  describe('buildWhatsAppMessage', () => {
    it('builds quote_ready message with amount and workshop name', () => {
      const msg = buildWhatsAppMessage('quote_ready', {
        customerName: 'Lucía Fernández',
        projectName: 'Cocina Moderna Roble',
        quoteAmount: '$45,000 MXN',
        workshopName: 'Carpintería Artesanal',
      });

      expect(msg).toContain('¡Hola Lucía Fernández!');
      expect(msg).toContain('Cocina Moderna Roble');
      expect(msg).toContain('$45,000 MXN');
      expect(msg).toContain('Carpintería Artesanal');
    });

    it('builds production_started message', () => {
      const msg = buildWhatsAppMessage('production_started', {
        customerName: 'Carlos',
        projectName: 'Vestidor Principal',
      });

      expect(msg).toContain('¡Hola Carlos!');
      expect(msg).toContain('Vestidor Principal');
      expect(msg).toContain('corte y fabricación');
    });

    it('builds installation_scheduled message with date', () => {
      const msg = buildWhatsAppMessage('installation_scheduled', {
        customerName: 'Mariana',
        projectName: 'Mueble de TV',
        scheduledDate: '24 de Agosto a las 10:00 AM',
      });

      expect(msg).toContain('24 de Agosto a las 10:00 AM');
      expect(msg).toContain('Mueble de TV');
    });

    it('builds project_completed message', () => {
      const msg = buildWhatsAppMessage('project_completed', {
        customerName: 'Roberto',
        projectName: 'Placard Dormitorio',
      });

      expect(msg).toContain('finalizado la instalación');
      expect(msg).toContain('Placard Dormitorio');
    });

    it('falls back gracefully when optional vars are missing', () => {
      const msg = buildWhatsAppMessage('quote_ready');
      expect(msg).toContain('¡Hola Estimado/a!');
      expect(msg).toContain('tu proyecto de mobiliario');
    });
  });

  describe('sanitizePhoneNumber', () => {
    it('removes spaces, hyphens, and brackets', () => {
      expect(sanitizePhoneNumber('+52 (55) 1234-5678')).toBe('525512345678');
      expect(sanitizePhoneNumber('099 123 456')).toBe('099123456');
      expect(sanitizePhoneNumber('')).toBe('');
    });
  });

  describe('formatWhatsAppUrl', () => {
    it('generates wa.me link with sanitized phone and encoded text', () => {
      const url = formatWhatsAppUrl('+54 9 11 2345-6789', '¡Hola! ¿Cómo estás?');
      expect(url).toBe('https://wa.me/5491123456789?text=%C2%A1Hola!%20%C2%BFC%C3%B3mo%20est%C3%A1s%3F');
    });

    it('handles empty phone number', () => {
      const url = formatWhatsAppUrl('', 'Mensaje de prueba');
      expect(url).toBe('https://wa.me/?text=Mensaje%20de%20prueba');
    });
  });
});
