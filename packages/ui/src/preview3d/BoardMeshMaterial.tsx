/**
 * Mesh materials for board parts: solid, procedural grain, or catalog texture.
 *
 * Important Three.js notes:
 * - Switching map on/off requires remounting the material (key), or the old
 *   map sticks on the GPU material.
 * - When a map is present, base color must be white or the map is tinted flat.
 */

import { useEffect, useMemo, type ReactNode } from 'react';
import { useTexture } from '@react-three/drei';
import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import {
  DEFAULT_TEXTURE_TILE_MM,
  type BoardPartVisual,
} from './boardPartVisual';
import { createGrainCanvas } from './grainTexture';
import {
  resolveBoardPhysicalResponse,
  type SceneLightingMode,
} from './sceneLighting';

type SharedMatProps = {
  readonly color: string;
  readonly emissive: string;
  readonly emissiveIntensity: number;
  readonly transparent: boolean;
  readonly opacity: number;
  readonly depthWrite: boolean;
  readonly lightingMode: SceneLightingMode;
  /**
   * Per-material PBR override (semantic [0,1]) from the visual bridge.
   * Undefined when the material has no PBR entry or colorMode is role;
   * the resolver then keeps the lighting-mode base (byte-identical render).
   */
  readonly previewRoughness?: number;
  readonly previewMetalness?: number;
  readonly previewClearcoat?: number;
};

/**
 * UV repeat from part size vs physical tile size of one texture image.
 * tileWidth → U (across part width); tileLength → V (along part length/veta).
 */
export function textureUvRepeat(
  widthMm: number,
  lengthMm: number,
  tileWidthMm: number = DEFAULT_TEXTURE_TILE_MM,
  tileLengthMm: number = DEFAULT_TEXTURE_TILE_MM,
): readonly [number, number] {
  const tw = Math.max(tileWidthMm, 1);
  const tl = Math.max(tileLengthMm, 1);
  const u = Math.max(Math.max(widthMm, 1) / tw, 0.25);
  const v = Math.max(Math.max(lengthMm, 1) / tl, 0.25);
  return [u, v];
}

function applyUv(
  map: Texture,
  widthMm: number,
  lengthMm: number,
  tileWidthMm: number = DEFAULT_TEXTURE_TILE_MM,
  tileLengthMm: number = DEFAULT_TEXTURE_TILE_MM,
): void {
  const [u, v] = textureUvRepeat(widthMm, lengthMm, tileWidthMm, tileLengthMm);
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.repeat.set(u, v);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;
}

function PhotoTextureMaterial({
  url,
  widthMm,
  lengthMm,
  tileWidthMm,
  tileLengthMm,
  shared,
}: {
  readonly url: string;
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly tileWidthMm: number;
  readonly tileLengthMm: number;
  readonly shared: SharedMatProps;
}): ReactNode {
  const map = useTexture(url);
  useEffect(() => {
    applyUv(map, widthMm, lengthMm, tileWidthMm, tileLengthMm);
  }, [map, widthMm, lengthMm, tileWidthMm, tileLengthMm]);

  const phys = resolveBoardPhysicalResponse({
    hasMap: true,
    hasGrain: false,
    lightingMode: shared.lightingMode,
    materialPbr: {
      roughness: shared.previewRoughness,
      metalness: shared.previewMetalness,
      clearcoat: shared.previewClearcoat,
    },
  });

  return (
    <meshPhysicalMaterial
      key={`photo:${url}`}
      map={map}
      // White so the photo shows true colors (map * color).
      color="#ffffff"
      emissive={shared.emissive}
      emissiveIntensity={shared.emissiveIntensity}
      transparent={shared.transparent}
      opacity={shared.opacity}
      depthWrite={shared.depthWrite}
      roughness={phys.roughness}
      metalness={phys.metalness}
      clearcoat={phys.clearcoat}
      clearcoatRoughness={phys.clearcoatRoughness}
      envMapIntensity={phys.envMapIntensity}
    />
  );
}

function SolidOrGrainMaterial({
  color,
  grain,
  widthMm,
  lengthMm,
  shared,
}: {
  readonly color: string;
  readonly grain: 0 | 1;
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly shared: SharedMatProps;
}): ReactNode {
  const map = useMemo(() => {
    if (grain !== 1) return null;
    const canvas = createGrainCanvas(color, 256);
    if (!canvas) return null;
    const tex = new CanvasTexture(canvas);
    applyUv(tex, widthMm, lengthMm);
    return tex;
  }, [grain, color, widthMm, lengthMm]);

  useEffect(() => {
    return () => {
      map?.dispose();
    };
  }, [map]);

  // Remount when switching solid ↔ grain so Three drops the previous map.
  const matKey = grain === 1 && map ? `grain:${color}` : `solid:${color}`;
  const phys = resolveBoardPhysicalResponse({
    hasMap: Boolean(map),
    hasGrain: grain === 1,
    lightingMode: shared.lightingMode,
    materialPbr: {
      roughness: shared.previewRoughness,
      metalness: shared.previewMetalness,
      clearcoat: shared.previewClearcoat,
    },
  });

  return (
    <meshPhysicalMaterial
      key={matKey}
      map={map ?? null}
      // Map already carries the base color; keep white to avoid double-tint.
      color={map ? '#ffffff' : color}
      emissive={shared.emissive}
      emissiveIntensity={shared.emissiveIntensity}
      transparent={shared.transparent}
      opacity={shared.opacity}
      depthWrite={shared.depthWrite}
      roughness={phys.roughness}
      metalness={phys.metalness}
      clearcoat={phys.clearcoat}
      clearcoatRoughness={phys.clearcoatRoughness}
      envMapIntensity={phys.envMapIntensity}
    />
  );
}

/**
 * Pick photo texture, procedural grain, or solid color for a board visual.
 */
export function BoardMeshMaterial({
  visual,
  selected,
  transparent,
  opacity,
  lightingMode = 'present',
}: {
  readonly visual: BoardPartVisual;
  readonly selected: boolean;
  readonly transparent: boolean;
  readonly opacity: number;
  readonly lightingMode?: SceneLightingMode;
}): ReactNode {
  const [w, , l] = visual.size;
  const shared: SharedMatProps = {
    color: visual.color,
    emissive: selected ? '#f5c542' : '#000000',
    emissiveIntensity: selected ? 0.4 : 0,
    transparent,
    opacity,
    depthWrite: !transparent,
    lightingMode,
    previewRoughness: visual.previewRoughness,
    previewMetalness: visual.previewMetalness,
    previewClearcoat: visual.previewClearcoat,
  };

  // Outer key forces full material swap between surface modes.
  const modeKey = visual.textureUrl
    ? `t:${visual.textureUrl}`
    : visual.grain === 1
      ? `g:${visual.color}`
      : `c:${visual.color}`;

  if (visual.textureUrl) {
    return (
      <PhotoTextureMaterial
        key={modeKey}
        url={visual.textureUrl}
        widthMm={w}
        lengthMm={l}
        tileWidthMm={
          visual.textureTileWidthMm && visual.textureTileWidthMm > 0
            ? visual.textureTileWidthMm
            : DEFAULT_TEXTURE_TILE_MM
        }
        tileLengthMm={
          visual.textureTileLengthMm && visual.textureTileLengthMm > 0
            ? visual.textureTileLengthMm
            : DEFAULT_TEXTURE_TILE_MM
        }
        shared={shared}
      />
    );
  }

  return (
    <SolidOrGrainMaterial
      key={modeKey}
      color={visual.color}
      grain={visual.grain}
      widthMm={w}
      lengthMm={l}
      shared={shared}
    />
  );
}
