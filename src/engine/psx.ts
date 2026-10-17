import * as THREE from 'three';

// Colours are authored as final display values (no linear workflow), like the PS1 did.
THREE.ColorManagement.enabled = false;

// Shared uniform so every PSX material snaps vertices to the same virtual screen grid.
export const psxUniforms = {
  uSnap: { value: new THREE.Vector2(160, 120) },
};

/** Patch a built-in material so its vertices snap to a coarse grid, giving the PS1 wobble. */
export function psxify<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = psxUniforms.uSnap;
    shader.vertexShader =
      'uniform vec2 uSnap;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 psxPos = gl_Position;
        psxPos.xyz /= psxPos.w;
        psxPos.xy = floor(psxPos.xy * uSnap + 0.5) / uSnap;
        psxPos.xyz *= psxPos.w;
        gl_Position = psxPos;`,
      );
  };
  return m;
}

export interface MatOptions {
  map?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
}

/** Flat-shaded Lambert material with vertex snapping. The default material for everything in the game. */
export function mat(color: THREE.ColorRepresentation, opts: MatOptions = {}): THREE.MeshLambertMaterial {
  return psxify(
    new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      map: opts.map ?? null,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    }),
  );
}

/** Unlit material for glows, UI-ish world elements and particles. */
export function basic(color: THREE.ColorRepresentation, opts: MatOptions = {}): THREE.MeshBasicMaterial {
  return psxify(
    new THREE.MeshBasicMaterial({
      color,
      map: opts.map ?? null,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    }),
  );
}

/** Convenience: a mesh with shadows off (we fake lighting with flat shading and fog). */
export function mesh(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(geo, material);
}
