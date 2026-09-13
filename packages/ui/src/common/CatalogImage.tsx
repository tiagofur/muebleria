/**
 * Catalog entity image or placeholder (F040).
 */

import { useState, type ReactNode } from 'react';
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

function isSafeUrl(url?: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  if (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('vbscript:') ||
    trimmed.startsWith('data:text/html')
  ) {
    return false;
  }
  return true;
}

export function CatalogImage({
  src,
  alt,
  className = '',
  size = 'md',
}: CatalogImageProps): ReactNode {
  const base = `${SIZE_CLASS[size]}${className ? ` ${className}` : ''}`;
  if (src && isSafeUrl(src)) {
    // Key by src: switching source mounts a fresh load attempt with its own
    // error state (returning to a previous URL retries it), while changing
    // only alt/size/className keeps the current attempt — a failed URL never
    // leaks into a different source or gets retried in place.
    return <CatalogImageLoad key={src} src={src} alt={alt} base={base} size={size} />;
  }
  return catalogImagePlaceholder(base, size, 'Sin foto');
}

function CatalogImageLoad({
  src,
  alt,
  base,
  size,
}: {
  readonly src: string;
  readonly alt: string;
  readonly base: string;
  readonly size: NonNullable<CatalogImageProps['size']>;
}): ReactNode {
  // Presentation-only failure for this load attempt; a late error from an
  // already-unmounted attempt (previous src) is inert setState.
  const [failed, setFailed] = useState(false);

  if (failed) {
    return catalogImagePlaceholder(base, size, 'Imagen no disponible');
  }
  return (
    <img
      className={base}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      data-testid="catalog-image"
    />
  );
}

function catalogImagePlaceholder(
  base: string,
  size: NonNullable<CatalogImageProps['size']>,
  label: 'Sin foto' | 'Imagen no disponible',
): ReactNode {
  return (
    // Placeholder is visual-only (F154 audit P3 #5): aria-hidden keeps its
    // label out of ancestors' accessible names — the entity name already
    // lives in the card/row heading, and duplicating it made screen readers
    // announce it twice.
    <div
      className={`${base} catalog-image--placeholder`}
      aria-hidden="true"
      data-testid="catalog-image-placeholder"
    >
      <Package size={size === 'lg' ? 40 : 24} strokeWidth={1.5} />
      <span className="catalog-image__ph-label">
        <ImageIcon size={14} strokeWidth={1.5} /> {label}
      </span>
    </div>
  );
}
