/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Module } from '@muebles/domain';
import { ModuleShowcase } from './ModuleShowcase';

afterEach(() => cleanup());

const sample: Module = {
  id: 'm1',
  code: 'MOD-GAB-01',
  name: 'Gabinete',
  imageUrl: '/api/media/abc.webp',
  externalDims: { width: 600, height: 720, depth: 550 },
  boardParts: [],
  hardwareLines: [],
};

describe('ModuleShowcase (F040)', () => {
  it('renders card with image and placeholder for missing photo', () => {
    render(
      <ModuleShowcase
        modules={[
          sample,
          {
            ...sample,
            id: 'm2',
            code: 'MOD-X',
            name: 'Sin foto',
            imageUrl: undefined,
          },
        ]}
      />,
    );
    expect(screen.getByText('Vitrina de muebles')).toBeTruthy();
    expect(screen.getByTestId('showcase-card-m1')).toBeTruthy();
    expect(screen.getByTestId('catalog-image')).toBeTruthy();
    expect(screen.getByTestId('catalog-image-placeholder')).toBeTruthy();
    expect(screen.getAllByText(/600/).length).toBeGreaterThan(0);
  });
});
