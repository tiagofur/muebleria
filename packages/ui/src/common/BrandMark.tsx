/**
 * App brand mark — monochrome product mark (issue #53).
 * No emoji; works on dark sidebar and dark login surface.
 */

import type { ReactNode } from 'react';
import './brandMark.css';

export type BrandMarkProps = {
  /** Outer size in CSS pixels (default 32). */
  readonly size?: number;
  readonly className?: string;
};

/**
 * Geometric mark: brand tile + three panel strokes (tablero stack).
 * Uses currentColor so parent sets contrast on dark/light chrome.
 */
export function BrandMark({
  size = 32,
  className,
}: BrandMarkProps): ReactNode {
  const rootClass = className
    ? `app-brand-mark ${className}`
    : 'app-brand-mark';
  return (
    <span
      className={rootClass}
      style={{ width: size, height: size }}
      aria-hidden
      data-testid="app-brand-mark"
    >
      <svg
        className="app-brand-mark__svg"
        viewBox="0 0 32 32"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="8"
          className="app-brand-mark__tile"
        />
        {/* Stacked board silhouettes */}
        <path
          className="app-brand-mark__panel"
          d="M8 11.5h16M8 16h16M8 20.5h11"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
