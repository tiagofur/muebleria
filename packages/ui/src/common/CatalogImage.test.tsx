// @vitest-environment jsdom
/**
 * CatalogImage — placeholder es decorativo; la imagen real conserva su alt
 * (auditoría de paridad 2026-08-23, hallazgo P3 #5).
 *
 * Además: fallo de carga con alternativa visual controlada y recuperación
 * al cambiar de URL (#fallback de carga).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

describe('CatalogImage fallo de carga y recuperación', () => {
  it('URL admitida: conserva src, alt y loading original', () => {
    render(<CatalogImage src="/media/tablero.jpg" alt="Arauco 15mm" />);
    const img = screen.getByAltText('Arauco 15mm');
    expect(img.getAttribute('src')).toBe('/media/tablero.jpg');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('data-testid')).toBe('catalog-image');
    expect(screen.queryByTestId('catalog-image-placeholder')).toBeNull();
  });

  it('error de carga: desaparece la imagen y aparece "Imagen no disponible"', () => {
    render(<CatalogImage src="/media/rota.webp" alt="Foto rota" />);
    const img = screen.getByTestId('catalog-image');
    fireEvent.error(img);
    expect(screen.queryByTestId('catalog-image')).toBeNull();
    const ph = screen.getByTestId('catalog-image-placeholder');
    expect(ph.textContent).toContain('Imagen no disponible');
    expect(ph.textContent).not.toContain('Sin foto');
  });

  it('el marcador de error conserva aria-hidden, tamaño y className', () => {
    render(
      <CatalogImage
        src="/media/rota.webp"
        alt="Foto rota"
        size="lg"
        className="module-showcase-card__img"
      />,
    );
    fireEvent.error(screen.getByTestId('catalog-image'));
    const ph = screen.getByTestId('catalog-image-placeholder');
    expect(ph.getAttribute('aria-hidden')).toBe('true');
    expect(ph.getAttribute('role')).toBeNull();
    expect(ph.className).toContain('catalog-image--lg');
    expect(ph.className).toContain('module-showcase-card__img');
    expect(ph.className).toContain('catalog-image--placeholder');
  });

  it('tras fallar A, rerender con B intenta cargar B normalmente', () => {
    const { rerender } = render(
      <CatalogImage src="/media/a.webp" alt="A" />,
    );
    fireEvent.error(screen.getByTestId('catalog-image'));
    expect(screen.getByTestId('catalog-image-placeholder').textContent).toContain(
      'Imagen no disponible',
    );

    rerender(<CatalogImage src="/media/b.webp" alt="B" />);
    const img = screen.getByTestId('catalog-image');
    expect(img.getAttribute('src')).toBe('/media/b.webp');
    expect(img.getAttribute('alt')).toBe('B');
    expect(screen.queryByTestId('catalog-image-placeholder')).toBeNull();
  });

  it('una señal tardía de A no deja a B en estado de error', () => {
    const a = '/media/a.webp';
    const b = '/media/b.webp';
    const { rerender } = render(<CatalogImage src={a} alt="A" />);
    rerender(<CatalogImage src={b} alt="B" />);
    const img = screen.getByTestId('catalog-image');

    // Evento tardío atribuible a la carga de A: el error se ignora porque
    // no corresponde a la URL que el elemento está cargando ahora.
    img.setAttribute('src', a);
    fireEvent.error(img);
    img.setAttribute('src', b);
    rerender(<CatalogImage src={b} alt="B" />);

    expect(screen.getByTestId('catalog-image').getAttribute('src')).toBe(b);
    expect(screen.queryByTestId('catalog-image-placeholder')).toBeNull();
  });

  it('rerender con la misma URL fallida no reintenta ni entra en bucle', () => {
    const { rerender } = render(
      <CatalogImage src="/media/rota.webp" alt="Rota" />,
    );
    fireEvent.error(screen.getByTestId('catalog-image'));

    // Misma URL: sigue en marcador, sin <img> que dispare otra carga.
    rerender(<CatalogImage src="/media/rota.webp" alt="Rota" />);
    expect(screen.queryByTestId('catalog-image')).toBeNull();
    expect(
      screen.getByTestId('catalog-image-placeholder').textContent,
    ).toContain('Imagen no disponible');

    // Cambiar sólo alt/size/className tampoco reintenta la URL fallida.
    rerender(
      <CatalogImage
        src="/media/rota.webp"
        alt="Otro alt"
        size="sm"
        className="extra"
      />,
    );
    expect(screen.queryByTestId('catalog-image')).toBeNull();
    const ph = screen.getByTestId('catalog-image-placeholder');
    expect(ph.textContent).toContain('Imagen no disponible');
    expect(ph.className).toContain('catalog-image--sm');
    expect(ph.className).toContain('extra');
  });

  it('dos instancias independientes: falla una y la otra queda intacta', () => {
    render(
      <div>
        <CatalogImage src="/media/rota.webp" alt="Rota" />
        <CatalogImage src="/media/ok.webp" alt="OK" />
      </div>,
    );
    const [rota, ok] = screen.getAllByTestId('catalog-image');
    if (!rota || !ok) throw new Error('se esperaban dos imágenes');
    fireEvent.error(rota);

    expect(screen.queryByTestId('catalog-image-placeholder')).not.toBeNull();
    const restantes = screen.getAllByTestId('catalog-image');
    expect(restantes).toHaveLength(1);
    expect(restantes[0]?.getAttribute('src')).toBe('/media/ok.webp');
    expect(restantes[0]?.getAttribute('alt')).toBe('OK');
  });

  it('sin URL o URL rechazada se mantiene el marcador "Sin foto"', () => {
    const { rerender } = render(<CatalogImage alt="Sin src" />);
    expect(screen.getByTestId('catalog-image-placeholder').textContent).toContain(
      'Sin foto',
    );
    rerender(<CatalogImage src="javascript:alert(1)" alt="Insegura" />);
    const ph = screen.getByTestId('catalog-image-placeholder');
    expect(ph.textContent).toContain('Sin foto');
    expect(ph.textContent).not.toContain('Imagen no disponible');
    expect(ph.getAttribute('aria-hidden')).toBe('true');
  });
});
