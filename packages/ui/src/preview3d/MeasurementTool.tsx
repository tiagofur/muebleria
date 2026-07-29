/**
 * Measurement tool for 3D scene — click two points to measure distance (#198).
 * Renders a ruler line, point markers, and distance label in mm.
 */

import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';

type Point3D = [number, number, number];

export type MeasurementToolProps = {
  /** When true, clicks capture measurement points. */
  readonly active: boolean;
};

/** Snap a coordinate to 1mm precision. */
function snap(v: number): number {
  return Math.round(v);
}

function snapPoint(p: Point3D): Point3D {
  return [snap(p[0]), snap(p[1]), snap(p[2])];
}

/** Euclidean distance in mm. */
function distance(a: Point3D, b: Point3D): number {
  return Math.sqrt(
    (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2,
  );
}

function midpoint(a: Point3D, b: Point3D): Point3D {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function PointMarker({ position, color = '#f59e0b' }: {
  readonly position: Point3D;
  readonly color?: string;
}): ReactNode {
  return (
    <mesh position={position}>
      <sphereGeometry args={[6, 16, 16]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function DistanceLabel({ position, dist }: {
  readonly position: Point3D;
  readonly dist: number;
}): ReactNode {
  return (
    <Html position={position} center style={{ pointerEvents: 'none' }}>
      <div className="measurement-label" role="status" aria-label={`Distancia: ${dist.toFixed(1)} milímetros`}>
        {dist >= 1000
          ? `${(dist / 1000).toFixed(2)} m`
          : `${dist.toFixed(1)} mm`}
      </div>
    </Html>
  );
}

export function MeasurementTool({ active }: MeasurementToolProps): ReactNode {
  const [points, setPoints] = useState<Point3D[]>([]);

  const handleClick = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!active) return;
      e.stopPropagation();
      const hit = snapPoint([
        e.point.x,
        e.point.y,
        e.point.z,
      ]);
      setPoints((prev) => {
        // After 2 points, start a new measurement
        if (prev.length >= 2) return [hit];
        return [...prev, hit];
      });
    },
    [active],
  );

  const dist = useMemo(() => {
    const a = points[0];
    const b = points[1];
    if (!a || !b) return null;
    return distance(a, b);
  }, [points]);

  const mid = useMemo(() => {
    const a = points[0];
    const b = points[1];
    if (!a || !b) return null;
    return midpoint(a, b);
  }, [points]);

  if (!active) return null;

  return (
    <>
      {/* Invisible capture plane — only captures clicks when measurement is active */}
      <mesh
        onClick={handleClick}
        visible={false}
        position={[0, -2, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[50000, 50000]} />
        <meshBasicMaterial transparent opacity={0} side={2} />
      </mesh>

      {/* Point markers */}
      {points[0] && <PointMarker position={points[0]} />}
      {points[1] && <PointMarker position={points[1]} />}

      {/* Ruler line */}
      {points.length === 2 && (
        <Line
          points={points}
          color="#f59e0b"
          lineWidth={2.5}
          dashed
          dashScale={8}
          dashSize={4}
          gapSize={2}
        />
      )}

      {/* Distance label at midpoint */}
      {dist !== null && mid !== null && (
        <DistanceLabel position={mid} dist={dist} />
      )}
    </>
  );
}
