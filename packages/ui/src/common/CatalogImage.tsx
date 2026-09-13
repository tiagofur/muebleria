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
  // Presentation-only failure state keyed to the exact URL that failed:
  // a different src retries normally, and a late error event attributed to
  // a previous URL can't block the one being loaded now.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && isSafeUrl(src) && src !== failedSrc) {
    return (
      <img
        className={base}
        src={src}
        alt={alt}
        loading="lazy"
        onError={(event) => {
          // Only fail the URL the element was actually loading when the
          // error fired; ignore stale signals from an earlier src.
          if (event.currentTarget.getAttribute('src') === src) {
            setFailedSrc(src);
          }
        }}
        data-testid="catalog-image"
      />
    );
  }
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
        <ImageIcon size={14} strokeWidth={1.5} />{' '}
        {src && isSafeUrl(src) ? 'Imagen no disponible' : 'Sin foto'}
      </span>
    </div>
  );
}
