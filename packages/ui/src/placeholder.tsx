import type { ReactNode } from 'react';

/** Minimal React placeholder so the UI package typechecks. */
export function Placeholder({ children }: { children?: ReactNode }): ReactNode {
  return children ?? null;
}
