import React, { useState, useRef, useEffect } from 'react';
import type { ResolvedBoardPart } from '@muebles/domain';
import './part3DViewer.css';

interface Part3DViewerProps {
  parts: readonly ResolvedBoardPart[];
  // Parent dimensions for centering/bounding box
  width: number;
  height: number;
  depth: number;
}

export const Part3DViewer: React.FC<Part3DViewerProps> = ({ parts, width, height, depth }) => {
  const [rotateX, setRotateX] = useState<number>(-25);
  const [rotateY, setRotateY] = useState<number>(45);
  const [zoom, setZoom] = useState<number>(0.8);
  const [hoveredPart, setHoveredPart] = useState<ResolvedBoardPart | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef<boolean>(false);
  const previousMousePosition = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Handle drag to rotate
  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    previousMousePosition.current = { x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const deltaX = e.clientX - previousMousePosition.current.x;
      const deltaY = e.clientY - previousMousePosition.current.y;

      setRotateY((prev) => prev + deltaX * 0.5);
      setRotateX((prev) => Math.max(-80, Math.min(80, prev - deltaY * 0.5)));

      previousMousePosition.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Handle scroll to zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.3, Math.min(2.5, prev - e.deltaY * 0.001)));
  };

  // Determine a scale factor to fit the cabinet in a 300px viewport
  const maxDim = Math.max(width, height, depth, 1);
  const baseScale = 320 / maxDim;
  const currentScale = baseScale * zoom;

  // Center offset
  const offsetX = -width / 2;
  const offsetY = height / 2;
  const offsetZ = -depth / 2;

  // Map optionRole to colors
  const getRoleColorClass = (role: string) => {
    const r = role.toUpperCase();
    if (r.includes('FRENTE') || r.includes('PUERTA')) return 'role-frente';
    if (r.includes('FONDO') || r.includes('TRASERA')) return 'role-fondo';
    return 'role-interior';
  };

  if (parts.length === 0) {
    return (
      <div className="three-d-viewer-container" data-testid="part-3d-viewer-empty">
        <p className="catalog-empty">Sin piezas para la vista 3D.</p>
      </div>
    );
  }

  return (
    <div
      className="three-d-viewer-container"
      ref={containerRef}
      onWheel={handleWheel}
      data-testid="part-3d-viewer"
    >
      <div className="three-d-instructions">
        Arrastrá para girar • Usá la ruedita para zoom
      </div>

      <div
        className="three-d-viewport"
        onMouseDown={handleMouseDown}
        style={{ cursor: isDragging.current ? 'grabbing' : 'grab' }}
      >
        <div
          className="three-d-scene"
          style={{
            transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${currentScale})`,
          }}
        >
          {/* Origin grid helper */}
          <div className="origin-axes">
            <div className="axis axis-x" style={{ width: `${width}px` }} />
            <div className="axis axis-y" style={{ width: `${depth}px` }} />
            <div className="axis axis-z" style={{ width: `${height}px` }} />
          </div>

          {/* Render Board Parts */}
          {parts.map((part) => {
            const px = part.x ?? 0;
            const py = part.y ?? 0;
            const pz = part.z ?? 0;
            const rx = part.rotateX ?? 0;
            const ry = part.rotateY ?? 0;
            const rz = part.rotateZ ?? 0;

            // Dimensions:
            const w = part.widthMm;
            const h = part.thicknessMm;
            const d = part.lengthMm;

            // Positioning:
            const tx = px + offsetX;
            const ty = -(pz + h) + offsetY; // CSS Y is down, so height is negative, and we align to top of part
            const tz = py + offsetZ;

            // Face positioning style:
            const transformStr = [
              `translate3d(${tx}px, ${ty}px, ${tz}px)`,
              `rotateZ(${rz}deg)`,
              `rotateY(${ry}deg)`,
              `rotateX(${rx}deg)`,
            ].join(' ');

            const colorClass = getRoleColorClass(part.optionRole);
            const isHovered = hoveredPart?.id === part.id;

            return (
              <div
                key={part.id}
                className={`part-cube ${colorClass} ${isHovered ? 'hovered' : ''}`}
                style={{
                  width: `${w}px`,
                  height: `${h}px`,
                  transform: transformStr,
                  transformOrigin: '0 100% 0', // bottom-left-back corner
                }}
                onMouseEnter={() => setHoveredPart(part)}
                onMouseLeave={() => setHoveredPart(null)}
              >
                {/* 3D faces */}
                <div className="face face-front" style={{ transform: `translate3d(0, 0, ${d}px)`, width: `${w}px`, height: `${h}px` }} />
                <div className="face face-back" style={{ transform: `rotateY(180deg)`, width: `${w}px`, height: `${h}px` }} />
                <div className="face face-top" style={{ transform: `rotateX(90deg) translate3d(0, 0, 0)`, width: `${w}px`, height: `${d}px` }} />
                <div className="face face-bottom" style={{ transform: `rotateX(-90deg) translate3d(0, 0, -${h}px)`, width: `${w}px`, height: `${d}px` }} />
                <div className="face face-left" style={{ transform: `rotateY(-90deg) translate3d(0, 0, 0)`, width: `${d}px`, height: `${h}px` }} />
                <div className="face face-right" style={{ transform: `rotateY(90deg) translate3d(0, 0, -${w}px)`, width: `${d}px`, height: `${h}px` }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Part Details overlay */}
      {hoveredPart && (
        <div className="part-details-overlay">
          <h4>{hoveredPart.description}</h4>
          <p>
            Ancho: <strong>{hoveredPart.widthMm} mm</strong>
          </p>
          <p>
            Largo: <strong>{hoveredPart.lengthMm} mm</strong>
          </p>
          <p>
            Espesor: <strong>{hoveredPart.thicknessMm} mm</strong>
          </p>
          <p className="role-badge">
            Rol: <span>{hoveredPart.optionRole}</span>
          </p>
          <p className="position-details">
            Posición: ({hoveredPart.x ?? 0}, {hoveredPart.y ?? 0}, {hoveredPart.z ?? 0})
          </p>
        </div>
      )}
    </div>
  );
};
