// @vitest-environment jsdom
/**
 * CatalogImage — placeholder es decorativo; la imagen real conserva su alt
 * (auditoría de paridad 2026-08-23, hallazgo P3 #5).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CatalogImage } from './CatalogImage';

afterEach(cleanup);

describe('CatalogImage placeholder (P3 #5)', () => {
  it('es aria-hidden: no expone role=img ni entra al nombre accesible', () => {
    render(<CatalogImage alt="Gabinete 1 Puerta" />);
    const ph = screen.getByTestId('catalog-image-placeholder');
    // El contenedor completo (icono + "Sin foto") queda fuera del árbol
    // accesible: aria-hidden es lo que evita que el label visual contamine
    // el nombre accesible de la card/fila ancestro.
    expect(ph.getAttribute('aria-hidden')).toBe('true');
    expect(ph.getAttribute('role')).toBeNull();
    expect(ph.getAttribute('aria-label')).toBeNull();
    expect(ph.textContent).toContain('Sin foto');
  });

  it('con src válido renderiza <img> con alt (la imagen es contenido)', () => {
    render(<CatalogImage src="/media/tablero.jpg" alt="Arauco 15mm" />);
    const img = screen.getByAltText('Arauco 15mm');
    expect(img.getAttribute('src')).toBe('/media/tablero.jpg');
  });

  it('URL insegura cae al placeholder decorativo', () => {
    render(<CatalogImage src="javascript:alert(1)" alt="X" />);
    const ph = screen.getByTestId('catalog-image-placeholder');
    expect(ph.getAttribute('aria-hidden')).toBe('true');
  });
});
