/**
 * Lightweight virtual list component.
 *
 * Only renders items visible in the viewport plus a configurable buffer.
 * Uses scroll position tracking with requestAnimationFrame throttle.
 * Assumes items have a fixed estimated height.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

interface VirtualListProps<T> {
  /** Array of items to render */
  items: readonly T[];
  /** Estimated height of each item in pixels */
  estimatedItemHeight?: number;
  /** Number of extra items to render above/below the viewport */
  overscan?: number;
  /** Render function for each item */
  renderItem: (item: T, index: number) => ReactNode;
  /** Key extractor if items don't have an `id` property */
  getKey?: (item: T, index: number) => string | number;
  /** Optional className for the scroll container */
  className?: string;
  /** Optional style for the scroll container */
  style?: CSSProperties;
  /** Height of the scroll container (px or CSS value) */
  containerHeight?: number | string;
}

export function VirtualList<T>({
  items,
  estimatedItemHeight = 280,
  overscan = 3,
  renderItem,
  getKey,
  className,
  style,
  containerHeight = '100%',
}: VirtualListProps<T>): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rafRef = useRef(0);

  // Cleanup pending RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = containerRef.current;
      if (el) {
        setScrollTop(el.scrollTop);
      }
    });
  }, []);

  const totalHeight = items.length * estimatedItemHeight;
  const containerH =
    typeof containerHeight === 'number'
      ? `${containerHeight}px`
      : containerHeight;

  // Calculate visible range
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / estimatedItemHeight) - overscan,
  );
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + estimatedItemHeight * 10) / estimatedItemHeight) +
      overscan,
  );

  // Render only visible items
  const visibleItems: ReactNode[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    const item = items[i];
    if (item === undefined) continue;
    const key = getKey
      ? getKey(item, i)
      : (item as { id?: string | number }).id ?? i;
    visibleItems.push(
      <div
        key={key}
        style={{
          position: 'absolute',
          top: i * estimatedItemHeight,
          left: 0,
          right: 0,
        }}
      >
        {renderItem(item, i)}
      </div>,
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        height: containerH,
        overflowY: 'auto',
        ...style,
      }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems}
      </div>
    </div>
  );
}
