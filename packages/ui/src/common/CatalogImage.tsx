/**
 * Catalog entity image or placeholder (F040).
 */

import type { ReactNode } from 'react';
import { ImageIcon, Package } from 'lucide-react';
import './catalogImage.css';

export type CatalogImageProps = {
  readonly src?: string | null;
  readonly alt: string;
  /** Absolute or same-origin media URL (shell resolves /api/media with token if needed). */
  readonly className?: string;
  readonly size?: 'sm' | 'md' | 'lg';
};

const SIZE_CLASS: Record<NonNullable<CatalogImageProps['size']>, string> = {
  sm: 'catalog-image catalog-image--sm',
  md: 'catalog-image catalog-image--md',
  lg: 'catalog-image catalog-image--lg',
};

export function CatalogImage({
  src,
  alt,
  className = '',
  size = 'md',
}: CatalogImageProps): ReactNode {
  const base = `${SIZE_CLASS[size]}${className ? ` ${className}` : ''}`;
  if (src) {
    return (
      <img
        className={base}
        src={src}
        alt={alt}
        loading="lazy"
        data-testid="catalog-image"
      />
    );
  }
  return (
    <div
      className={`${base} catalog-image--placeholder`}
      role="img"
      aria-label={alt || 'Sin imagen'}
      data-testid="catalog-image-placeholder"
    >
      <Package size={size === 'lg' ? 40 : 24} strokeWidth={1.5} aria-hidden />
      <span className="catalog-image__ph-label">
        <ImageIcon size={14} strokeWidth={1.5} aria-hidden /> Sin foto
      </span>
    </div>
  );
}
