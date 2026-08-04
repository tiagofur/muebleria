/**
 * Keyboard navigation for 3D scene (#188).
 * Arrow keys orbit camera, +/- zoom, screen reader announcements.
 */

import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

export type KeyboardNavProps = {
  /** Whether keyboard navigation is enabled. */
  readonly active: boolean;
  /** Controls ref from drei OrbitControls. */
  readonly controlsRef: React.RefObject<any>;
  /** Center point of the scene for orbit target. */
  readonly center: readonly [number, number, number];
  /** Max dimension for orbit speed scaling. */
  readonly maxDim: number;
};

/** Orbit speed in radians per key press. */
const ORBIT_STEP = 0.05;
/** Zoom step as fraction of distance. */
const ZOOM_STEP = 0.1;

function KeyboardNavInner({
  controlsRef,
  center,
  onAction,
}: {
  readonly controlsRef: React.RefObject<any>;
  readonly center: readonly [number, number, number];
  readonly onAction?: (message: string) => void;
}): ReactNode {
  const { camera } = useThree();
  const targetRef = useRef(new THREE.Vector3(...center));

  // Sync target ref with controls target each frame
  useFrame(() => {
    if (controlsRef.current?.target) {
      targetRef.current.copy(controlsRef.current.target);
    }
  });

  useEffect(() => {
    const el = controlsRef.current?.domElement?.parentElement;
    if (!el) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle keys when the canvas wrapper has focus
      if (!el.contains(document.activeElement) && document.activeElement !== el) {
        return;
      }

      const controls = controlsRef.current;
      if (!controls) return;

      const target = targetRef.current;
      const offset = new THREE.Vector3().subVectors(camera.position, target);
      const dist = offset.length();

      switch (e.key) {
        case 'ArrowLeft': {
          e.preventDefault();
          const angle = ORBIT_STEP;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const x = offset.x * cos - offset.z * sin;
          const z = offset.x * sin + offset.z * cos;
          camera.position.set(target.x + x, camera.position.y, target.z + z);
          camera.lookAt(target);
          controls.update();
          onAction?.('Cámara rotada a la izquierda');
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const angle = -ORBIT_STEP;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const x = offset.x * cos - offset.z * sin;
          const z = offset.x * sin + offset.z * cos;
          camera.position.set(target.x + x, camera.position.y, target.z + z);
          camera.lookAt(target);
          controls.update();
          onAction?.('Cámara rotada a la derecha');
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          camera.position.y += dist * ORBIT_STEP;
          camera.lookAt(target);
          controls.update();
          onAction?.('Vista elevada');
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          camera.position.y -= dist * ORBIT_STEP;
          camera.lookAt(target);
          controls.update();
          onAction?.('Vista descendida');
          break;
        }
        case '+':
        case '=': {
          e.preventDefault();
          const dir = new THREE.Vector3().subVectors(target, camera.position).normalize();
          camera.position.addScaledVector(dir, dist * ZOOM_STEP);
          controls.update();
          onAction?.('Zoom acercado');
          break;
        }
        case '-':
        case '_': {
          e.preventDefault();
          const dir = new THREE.Vector3().subVectors(target, camera.position).normalize();
          camera.position.addScaledVector(dir, -dist * ZOOM_STEP);
          controls.update();
          onAction?.('Zoom alejado');
          break;
        }
      }
    };

    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controlsRef]);

  return null;
}

export function KeyboardNav({
  active,
  controlsRef,
  center,
}: KeyboardNavProps): ReactNode {
  const [announcement, setAnnouncement] = useState('');

  const handleKeyAction = useCallback((msg: string) => {
    setAnnouncement('');
    // Force re-render so screen reader picks up new text
    requestAnimationFrame(() => setAnnouncement(msg));
  }, []);

  if (!active) return null;
  return (
    <>
      <KeyboardNavInner controlsRef={controlsRef} center={center} onAction={handleKeyAction} />
      {/* Screen reader announcement region */}
      <Html>
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </div>
      </Html>
    </>
  );
}
