/**
 * WebGL capability probe — isolated from the 3D scene modules so screens can
 * check support WITHOUT pulling three.js into their chunk (Fase 5.5).
 */

/** Detect WebGL so tests/jsdom can skip Canvas. */
export function canUseWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}
