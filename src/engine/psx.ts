import * as THREE from 'three';

// Colours are authored as sRGB hex values; three converts them to linear for lighting.
THREE.ColorManagement.enabled = true;

/** Kept for API compatibility with the old PS1 pipeline; vertex snapping is gone. */
export const psxUniforms = {
  uSnap: { value: new THREE.Vector2(0, 0) },
};

/** No-op now that the game renders without PS1 vertex snapping. */
export function psxify<T extends THREE.Material>(m: T): T {
  return m;
}

export interface MatOptions {
  map?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
}

/** Physically based material. The default material for everything in the game. */
export function mat(color: THREE.ColorRepresentation, opts: MatOptions = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    map: opts.map ?? null,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    roughness: opts.roughness ?? 0.75,
    metalness: opts.metalness ?? 0,
    flatShading: opts.flatShading ?? false,
  });
}

/** Unlit material for glows, signs and particles. */
export function basic(color: THREE.ColorRepresentation, opts: MatOptions = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    map: opts.map ?? null,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
}

export function mesh(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(geo, material);
}
