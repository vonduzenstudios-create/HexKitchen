import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mat } from '../engine/psx';
import { canvasTexture } from '../engine/textures';

export type IngredientKind = 'lettuce' | 'bread' | 'tomato' | 'potato' | 'pasta' | 'steak' | 'beef' | 'mushroom' | 'greens';

export interface IngredientDef {
  name: string;
  choppedName: string;
  raw: number;
  cooked: number;
  /** Builds the whole ingredient. Meshes flagged userData.tint get recoloured as it cooks. */
  whole: () => THREE.Group;
  chopped: () => THREE.Group;
}

// ---------------------------------------------------------------------------------------------
// Small deterministic maths helpers
// ---------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(seed + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]. */
function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * u;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * u;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * u;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return (y0 + (y1 - y0) * w) * 2 - 1;
}

function fbm(x: number, y: number, z: number, seed: number, oct = 3): number {
  let a = 1;
  let f = 1;
  let s = 0;
  let n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * noise3(x * f, y * f, z * f, seed + o * 31);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

/** fbm that wraps seamlessly in u (for textures wrapped around a lathe/tube). */
function pfbm(u: number, v: number, fu: number, fv: number, seed: number, oct = 3): number {
  const r = fu / TAU;
  return fbm(Math.cos(TAU * u) * r, Math.sin(TAU * u) * r, v * fv, seed, oct);
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Unit direction on a sphere from surface params: u around (0..1), v bottom (0) to top (1). */
function sphDir(u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
  const th = TAU * u;
  const ph = Math.PI * v;
  const s = Math.sin(ph);
  return out.set(s * Math.cos(th), -Math.cos(ph), -s * Math.sin(th));
}

function once<T>(make: () => T): () => T {
  let v: T | undefined;
  return () => (v ??= make());
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

type SurfFn = (u: number, v: number, out: THREE.Vector3) => void;

/** Builds an indexed parametric surface with smooth, seam-welded normals, oriented outward. */
function surface(nu: number, nv: number, f: SurfFn, uvf?: (u: number, v: number) => [number, number]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      f(u, v, p);
      pos.push(p.x, p.y, p.z);
      if (uvf) uv.push(...uvf(u, v));
      else uv.push(u, v);
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const d = a + nu + 1;
      const c = d + 1;
      idx.push(a, b, d, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  orientOutward(geo);
  geo.computeVertexNormals();
  weldNormals(geo);
  return geo;
}

function orientOutward(geo: THREE.BufferGeometry): void {
  const p = geo.attributes.position;
  const idx = geo.index!;
  geo.computeBoundingBox();
  const c = geo.boundingBox!.getCenter(new THREE.Vector3());
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  const n = new THREE.Vector3();
  let s = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i));
    b.fromBufferAttribute(p, idx.getX(i + 1));
    d.fromBufferAttribute(p, idx.getX(i + 2));
    n.subVectors(b, a).cross(d.clone().sub(a));
    s += n.dot(a.add(b).add(d).multiplyScalar(1 / 3).sub(c));
  }
  if (s < 0) {
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
}

/** Average normals of coincident vertices so UV seams and poles shade smoothly. */
function weldNormals(geo: THREE.BufferGeometry): void {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(i);
  }
  const s = new THREE.Vector3();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    s.set(0, 0, 0);
    for (const i of g) s.x += n.getX(i), s.y += n.getY(i), s.z += n.getZ(i);
    s.normalize();
    for (const i of g) n.setXYZ(i, s.x, s.y, s.z);
  }
}

/** Centre on x/z and drop so the lowest point is at y = 0. Returns the applied offset. */
function sit(geo: THREE.BufferGeometry): THREE.Vector3 {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const off = new THREE.Vector3(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.translate(off.x, off.y, off.z);
  return off;
}

/** Multiply (or set) per-vertex colour. */
function paint(geo: THREE.BufferGeometry, col: THREE.Color | ((i: number) => [number, number, number])): THREE.BufferGeometry {
  const n = geo.attributes.position.count;
  let attr = geo.attributes.color as THREE.BufferAttribute | undefined;
  if (!attr) {
    attr = new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3);
    geo.setAttribute('color', attr);
  }
  for (let i = 0; i < n; i++) {
    const c = typeof col === 'function' ? col(i) : [col.r, col.g, col.b];
    attr.setXYZ(i, attr.getX(i) * c[0], attr.getY(i) * c[1], attr.getZ(i) * c[2]);
  }
  return geo;
}

const KEEP = ['position', 'normal', 'uv', 'color'];

/** Merge geometries into one draw call (always non-indexed, common attribute set). */
function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const anyColor = geos.some((g) => g.attributes.color);
  const list = geos.map((g0) => {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (anyColor && !g.attributes.color) paint(g, new THREE.Color(1, 1, 1));
    g.clearGroups();
    return g;
  });
  return mergeGeometries(list, false)!;
}

interface Piece {
  geo: THREE.BufferGeometry;
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  col?: THREE.Color;
}

/** Bake pieces (each yawed last) into one merged geometry sitting on the ground. */
function assemble(pieces: Piece[], doSit = true): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const list = pieces.map((p) => {
    const g = p.geo.clone();
    if (p.col) paint(g, p.col);
    e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ');
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, one);
    g.applyMatrix4(m);
    return g;
  });
  const g = merge(list);
  if (doSit) sit(g);
  return g;
}

/** Push every vertex outward along its normal (for decal shells). */
function inflate(geo: THREE.BufferGeometry, d: number): THREE.BufferGeometry {
  const g = geo.clone();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * d, p.getY(i) + n.getY(i) * d, p.getZ(i) + n.getZ(i) * d);
  return g;
}

/** Replace UVs with a planar x/z projection normalised to the bounding box. */
function planarUV(geo: THREE.BufferGeometry, axisA: 'x' | 'y' | 'z', axisB: 'x' | 'y' | 'z'): void {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    uv[i * 2] = (v[axisA] - b.min[axisA]) / (b.max[axisA] - b.min[axisA]);
    uv[i * 2 + 1] = (v[axisB] - b.min[axisB]) / (b.max[axisB] - b.min[axisB]);
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

// ---------------------------------------------------------------------------------------------
// Procedural textures (per-pixel, painted once and cached)
// ---------------------------------------------------------------------------------------------

type Shade = (u: number, v: number) => [number, number, number] | [number, number, number, number];

/** Paint a texture analytically. `shade` gets true UVs (v = 1 at the top of the canvas) and returns 0..1 RGB(A). */
function pixelTexture(w: number, h: number, shade: Shade, grain = 8): THREE.CanvasTexture {
  return canvasTexture(
    w,
    h,
    (g) => {
      const cw = g.canvas.width;
      const ch = g.canvas.height;
      const img = g.createImageData(cw, ch);
      const d = img.data;
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const c = shade((x + 0.5) / cw, 1 - (y + 0.5) / ch);
          const o = (y * cw + x) * 4;
          d[o] = clamp01(c[0]) * 255;
          d[o + 1] = clamp01(c[1]) * 255;
          d[o + 2] = clamp01(c[2]) * 255;
          d[o + 3] = c.length > 3 ? clamp01(c[3]!) * 255 : 255;
        }
      g.putImageData(img, 0, 0);
    },
    1,
    grain,
  );
}

const D = new THREE.Vector3();

// Potato eye dimples, shared by the geometry (dents) and the texture (dark spots).
const POTATO_EYES: [number, number][] = [
  [0.04, 0.56], [0.17, 0.72], [0.31, 0.47], [0.48, 0.64], [0.6, 0.38], [0.74, 0.6], [0.88, 0.78], [0.4, 0.86], [0.95, 0.42],
];
const potatoEyeDirs = POTATO_EYES.map(([u, v]) => sphDir(u, v, new THREE.Vector3()));

const T = {
  potato: once(() =>
    pixelTexture(128, 64, (u, v) => {
      const d = sphDir(u, v, D);
      let lum = 0.9 + 0.08 * fbm(d.x * 4, d.y * 4, d.z * 4, 11);
      const dust = smooth(0.15, 0.55, fbm(d.x * 3, d.y * 3, d.z * 3, 12));
      const spots = smooth(0.35, 0.6, fbm(d.x * 16, d.y * 16, d.z * 16, 13));
      const fleck = noise3(d.x * 38, d.y * 38, d.z * 38, 14) > 0.62 ? 1 : 0;
      lum *= 1 - 0.3 * spots - 0.35 * fleck;
      let eye = 0;
      let ring = 0;
      for (const e of potatoEyeDirs) {
        const dist = d.distanceTo(e);
        eye = Math.max(eye, 1 - smooth(0.015, 0.045, dist));
        ring = Math.max(ring, (1 - smooth(0.05, 0.09, dist)) * smooth(0.03, 0.05, dist));
      }
      lum *= 1 - 0.55 * eye;
      const r = lum * mix(1, 1.06, dust) * (1 + 0.04 * ring);
      return [r, r * mix(0.93, 1.02, dust), r * mix(0.84, 0.98, dust)];
    }),
  ),
  tomato: once(() =>
    pixelTexture(64, 64, (u, v) => {
      const streak = pfbm(u, v, 40, 2, 21);
      const top = smooth(0.8, 1, v);
      const dot = noise3(u * 90, v * 45, 0, 22) > 0.7 ? 1 : 0;
      const l = 0.92 + 0.08 * streak * (0.4 + top) + 0.06 * dot;
      return [l, l * (1 + 0.25 * top), l * (1 + 0.1 * top)];
    }),
  ),
  leaf: once(() =>
    pixelTexture(64, 64, (u, v) => {
      const s = Math.abs(u - 0.5) * 2;
      let l = 0.84 + 0.08 * fbm(u * 7, v * 7, 0, 31);
      const ribW = 0.035 * (1 - 0.75 * v) + 0.006;
      const rib = 1 - smooth(ribW * 0.6, ribW, Math.abs(u - 0.5));
      const ph = (v - 0.45 * Math.pow(s, 0.8)) * 8;
      const fr = ph - Math.floor(ph);
      const vein = (1 - smooth(0.02, 0.07, Math.min(fr, 1 - fr))) * (1 - smooth(0.6, 1, s));
      const crinkle = fbm(u * 22, v * 22, 1, 32);
      l *= 1 - 0.12 * smooth(0.55, 1, Math.max(s, v)) + 0.05 * crinkle;
      l = mix(l, 0.97, vein * 0.6);
      l = mix(l, 1, rib);
      return [l * (1 + 0.04 * rib), l, l * (1 - 0.06 * rib)];
    }),
  ),
  bread: once(() =>
    pixelTexture(128, 64, (t, w) => {
      const { groove, lip } = breadSlash(t, w);
      const top = Math.max(0, -Math.cos(TAU * w)); // 1 on the top of the loaf
      const end = smooth(0.12, 0.0, Math.min(t, 1 - t));
      const n = fbm(t * 30, w * 18, 0, 41);
      let r = mix(0.95, 0.8, top) - 0.05 * end + 0.05 * n;
      let g = mix(0.82, 0.55, top) - 0.07 * end + 0.05 * n;
      let b = mix(0.66, 0.3, top) - 0.06 * end + 0.04 * n;
      // Blisters and flour dust.
      const blister = noise3(t * 160, w * 70, 3, 42) > 0.66 ? 1 : 0;
      r -= 0.12 * blister;
      g -= 0.12 * blister;
      b -= 0.08 * blister;
      const flour = (noise3(t * 120, w * 60, 4, 43) > 0.55 ? 1 : 0) * (0.4 + 0.6 * (1 - top));
      r = mix(r, 1, flour * 0.35);
      g = mix(g, 0.97, flour * 0.35);
      b = mix(b, 0.9, flour * 0.35);
      // Scores: dark baked lip, pale torn crumb inside.
      r = mix(r, 0.6, lip);
      g = mix(g, 0.36, lip);
      b = mix(b, 0.16, lip);
      r = mix(r, 1, groove);
      g = mix(g, 0.95, groove);
      b = mix(b, 0.82, groove);
      return [r, g, b];
    }),
  ),
  crouton: once(() =>
    pixelTexture(32, 32, (u, v) => {
      const edge = Math.min(u, 1 - u, v, 1 - v);
      const toast = 1 - smooth(0.04, 0.2, edge);
      const pore = noise3(u * 26, v * 26, 0, 51);
      let l = 1 - (pore > 0.45 ? 0.16 : 0) + 0.04 * fbm(u * 8, v * 8, 1, 52);
      l = Math.min(1, l);
      return [mix(l, 0.75, toast), mix(l * 0.96, 0.5, toast), mix(l * 0.88, 0.28, toast)];
    }),
  ),
  fries: once(() =>
    pixelTexture(32, 32, (u, v) => {
      const l = 0.93 + 0.06 * fbm(u * 10, v * 3, 0, 61);
      const skin = noise3(u * 30, v * 12, 0, 62) > 0.72 ? 1 : 0;
      return [l - 0.3 * skin, l - 0.4 * skin, l * 0.97 - 0.5 * skin];
    }),
  ),
  dice: once(() =>
    pixelTexture(32, 32, (u, v) => {
      const cx = u - 0.5;
      const cy = v - 0.5;
      const rr = Math.sqrt(cx * cx + cy * cy) + 0.08 * fbm(u * 6, v * 6, 0, 71);
      const gel = 1 - smooth(0.2, 0.32, rr);
      // Pale seeds scattered on a ring inside the glossy gel pocket.
      const a = Math.atan2(cy, cx);
      const sp = a * (6 / TAU);
      const sf = sp - Math.round(sp);
      const seedD = Math.hypot(sf * 0.9, (rr - 0.14) * 2.2);
      const seed = (1 - smooth(0.05, 0.08, seedD)) * gel;
      const r = mix(0.86, 1, gel);
      const g = mix(0.42, 0.55, gel);
      const b = mix(0.42, 0.5, gel);
      return [mix(r, 1, seed), mix(g, 1, seed), mix(b, 0.75, seed)];
    }),
  ),
  steakBody: once(() =>
    pixelTexture(64, 64, (u, v) => {
      const l = 0.82 + 0.12 * fbm(u * 3, v * 26, 0, 81) + 0.05 * fbm(u * 20, v * 20, 1, 82);
      return [l, l * 0.94, l * 0.94];
    }),
  ),
  steakMarble: once(() =>
    pixelTexture(96, 64, (u, v) => {
      const n1 = fbm(u * 4.5, v * 3.2, 0, 91);
      const n2 = fbm(u * 10, v * 7, 5, 92);
      const vein = 1 - smooth(0.005, 0.022, Math.abs(n1));
      const fine = (1 - smooth(0.003, 0.012, Math.abs(n2))) * 0.85;
      const pocket = smooth(0.52, 0.6, fbm(u * 4, v * 3, 9, 93));
      return [1, 0.92, 0.9, Math.max(vein * 0.95, fine * 0.7, pocket * 0.9)];
    }, 0),
  ),
  fat: once(() =>
    pixelTexture(32, 32, (u, v) => {
      const l = 0.93 + 0.06 * fbm(u * 8, v * 8, 0, 101);
      const pink = smooth(0.3, 0.6, fbm(u * 4, v * 12, 2, 102)) * 0.08;
      return [l, l - pink, l - pink * 1.2];
    }),
  ),
  slice: once(() =>
    pixelTexture(64, 32, (u, v) => {
      const crust = Math.max(1 - smooth(0.08, 0.26, Math.min(v, 1 - v)), 1 - smooth(0.015, 0.06, Math.min(u, 1 - u)));
      const rosy = 1 - smooth(0.0, 0.7, Math.abs(v - 0.5) * 2);
      const grain = 0.9 + 0.06 * fbm(u * 50, v * 5, 0, 111) + 0.06 * rosy;
      return [mix(grain, 0.58, crust), mix(grain * (0.9 + 0.06 * rosy), 0.28, crust), mix(grain * (0.9 + 0.06 * rosy), 0.3, crust)];
    }),
  ),
  fillet: once(() =>
    pixelTexture(96, 48, (u, v) => {
      const l = 0.8 + 0.12 * pfbm(v, u, 40, 3, 121) + 0.06 * pfbm(v, u, 12, 9, 122);
      return [l, l * 0.92, l * 0.94];
    }),
  ),
  silverskin: once(() =>
    pixelTexture(128, 64, (u, v) => {
      const n = pfbm(v, u, 7, 2.2, 131);
      const vein = (1 - smooth(0.004, 0.025, Math.abs(n))) * 0.75;
      const sheet = smooth(0.3, 0.65, pfbm(v, u, 22, 1.3, 132)) * 0.45;
      return [1, 0.97, 0.98, Math.max(vein, sheet)];
    }, 0),
  ),
  medallion: once(() =>
    pixelTexture(64, 64, (u, v) => {
      // v runs along the lathe profile: caps at v<CAP and v>1-CAP, side band in between.
      const capV = Math.min(v, 1 - v);
      const rho = capV / MED_CAP_V; // 0 centre .. 1 cap rim
      const fib = pfbm(u, rho, 70, 20, 141) * 1.6;
      const marb = 1 - smooth(0.01, 0.04, Math.abs(pfbm(u, rho, 8, 3, 143)));
      const inner = 1 - smooth(0.8, 0.97, rho);
      let l = mix(0.58, 0.93 + 0.05 * fib, inner);
      if (rho > 1) l = 0.56 + 0.06 * pfbm(u, v, 30, 8, 142);
      const m = rho < 0.85 ? marb * 0.6 : 0;
      return [mix(l, 1, m), mix(l * 0.92, 0.85, m), mix(l * 0.92, 0.82, m)];
    }),
  ),
  mushroomCap: once(() =>
    pixelTexture(128, 32, (u, v) => {
      const top = smooth(0.35, 1, v);
      let l = mix(1, 0.72, top);
      l += 0.07 * pfbm(u, v, 70, 2, 151);
      l -= noise3(u * 140, v * 30, 0, 152) > 0.68 ? 0.12 : 0;
      const rim = 1 - smooth(0.04, 0.16, v);
      l = mix(l, 1.05, rim * 0.6);
      return [l, l * 0.95, l * 0.9];
    }),
  ),
  gills: once(() =>
    pixelTexture(128, 16, (u, v) => {
      const g = 0.5 + 0.5 * Math.cos(TAU * u * 96);
      const l = 0.62 + 0.38 * g * g * (0.8 + 0.2 * pfbm(u, v, 30, 3, 161));
      const nearStem = smooth(0.7, 1, v) * 0.15;
      return [l + nearStem, l * 0.95 + nearStem, l * 0.9 + nearStem];
    }),
  ),
  stem: once(() =>
    pixelTexture(32, 32, (u, v) => {
      const l = 0.95 + 0.05 * pfbm(u, v, 30, 2, 171);
      const dirt = 1 - smooth(0.0, 0.18, v);
      return [l - 0.12 * dirt, l * 0.97 - 0.18 * dirt, l * 0.93 - 0.24 * dirt];
    }),
  ),
  mince: once(() =>
    pixelTexture(64, 32, (u, v) => {
      const a = pfbm(u, v, 70, 30, 181, 1);
      const b = pfbm(u, v, 130, 60, 182, 1);
      let l = a > 0.25 ? 1 : a > -0.25 ? 0.78 : 0.56;
      if (b > 0.55) l = 1.0;
      if (b < -0.6) l *= 0.7;
      return [l, l * 0.96, l * 0.9];
    }),
  ),
  sliceMush: once(() => {
    // Planar texture for the T-shaped mushroom slices: pale flesh with a brown skin edge on the dome.
    return pixelTexture(64, 64, (u, v) => {
      const x = (u - 0.5) * 2; // -1..1 across the slice
      const y = v; // 0 bottom of stem .. 1 top of cap
      const capY = MUSH_SLICE.capBase / MUSH_SLICE.height;
      const domeY = capY + (1 - capY) * Math.sqrt(Math.max(0, 1 - x * x));
      const skin = y > capY ? 1 - smooth(0.02, 0.07, domeY - y) : 0;
      const gill = y > capY - 0.03 && y < capY + 0.05 && Math.abs(x) > 0.25 ? 0.35 : 0;
      const l = 0.97 + 0.03 * fbm(u * 20, v * 20, 0, 191);
      return [mix(l, 0.55, Math.max(skin, gill)), mix(l * 0.97, 0.4, Math.max(skin, gill)), mix(l * 0.9, 0.28, Math.max(skin, gill))];
    });
  }),
  bean: once(() =>
    pixelTexture(64, 32, (u, v) => {
      const l = 0.9 + 0.06 * pfbm(v, u, 10, 6, 201) - (noise3(u * 120, v * 40, 0, 202) > 0.7 ? 0.1 : 0);
      const seam = Math.max(1 - smooth(0.0, 0.03, Math.abs(v - 0.25)), 1 - smooth(0.0, 0.03, Math.abs(v - 0.75)));
      return [l + 0.08 * seam, l + 0.08 * seam, l * 0.95 + 0.05 * seam];
    }),
  ),
  pastaBand: once(() =>
    pixelTexture(64, 16, (u, v) => {
      const stripe = v < 0.14 || v > 0.86;
      const thin = Math.abs(v - 0.2) < 0.025 || Math.abs(v - 0.8) < 0.025;
      const logo = Math.hypot((u - 0.2) * 3.5, (v - 0.5) * 1.6) < 0.32;
      const text = u > 0.36 && u < 0.86 && Math.abs(v - 0.5) < 0.1 && Math.sin(u * 160) > -0.2 && Math.sin(u * 23) > -0.6;
      if (stripe) return [0.95, 0.93, 0.88];
      if (thin) return [0.95, 0.78, 0.2];
      if (logo) return [0.92, 0.18, 0.14];
      if (text) return [0.95, 0.95, 0.95];
      return [0.12, 0.25, 0.58];
    }),
  ),
};

// ---------------------------------------------------------------------------------------------
// Mesh helpers
// ---------------------------------------------------------------------------------------------

interface Look {
  map?: THREE.Texture;
  roughness?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
  alphaTest?: number;
  /** Soft alpha decal shell (marbling, silverskin). */
  transparent?: boolean;
}

function material(color: number, look: Look): THREE.Material {
  const m = mat(color, { map: look.map, roughness: look.roughness, side: look.side, transparent: look.transparent });
  if (look.vertexColors) m.vertexColors = true;
  if (look.alphaTest !== undefined) m.alphaTest = look.alphaTest;
  return m;
}

/** Main body: recoloured towards the cooked colour as it cooks. Each call gets its own material. */
function tinted(geo: THREE.BufferGeometry, color: number, look: Look = {}): THREE.Mesh {
  const m = new THREE.Mesh(geo, material(color, look));
  m.userData.tint = true;
  return m;
}

/** Small fixed details (stems, fat, string, labels) that keep their colour while cooking. */
function fixed(geo: THREE.BufferGeometry, color: number, look: Look = {}): THREE.Mesh {
  return new THREE.Mesh(geo, material(color, look));
}

function group(...objs: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.add(...objs);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Lettuce: a head of cupped, ruffled leaves around a pale heart.
// ---------------------------------------------------------------------------------------------

const LEAVES = 7;

const lettuceGeo = once(() => {
  const parts: THREE.BufferGeometry[] = [];
  const pale = new THREE.Color(1, 1, 0.82);
  const dark = new THREE.Color(0.4, 0.64, 0.3);
  // Heart.
  const heart = surface(16, 10, (u, v, o) => {
    sphDir(u, v, o);
    o.multiplyScalar(0.043 * (1 + 0.06 * fbm(o.x * 4, o.y * 4, o.z * 4, 300)));
    o.y *= 0.86;
  });
  paint(heart, new THREE.Color(1, 1, 0.72));
  parts.push(heart);
  for (let k = 0; k < LEAVES; k++) {
    const R = 0.046 + k * 0.0068;
    const c = k * 2.39996 + 0.3;
    const W = 2.0 + k * 0.2;
    const bMax = 2.62 - k * 0.07;
    const kk = k / (LEAVES - 1);
    const leaf = surface(16, 10, (u, v, o) => {
      const s = u * 2 - 1;
      const wf = 0.3 + 0.7 * Math.sin(Math.min(1, v * 1.25) * Math.PI * 0.5);
      const phi = c + s * W * 0.5 * wf;
      const bTop = bMax - 0.45 * s * s;
      const beta = 0.1 + (bTop - 0.1) * v;
      const sb = Math.sin(beta);
      o.set(sb * Math.cos(phi), -Math.cos(beta), -sb * Math.sin(phi));
      const edge = Math.pow(Math.max(Math.abs(s), v), 3);
      let r = R * (1 + kk * 0.55 * v * v * v + 0.05 * fbm(o.x * 3, o.y * 3, o.z * 3, 310 + k));
      r += 0.006 * Math.sin(phi * 14 + k * 1.7 + v * 9) * edge;
      o.multiplyScalar(r);
      o.y *= 0.84;
    });
    const col = pale.clone().lerp(dark, kk);
    paint(leaf, (i) => {
      const v = leaf.attributes.uv.getY(i);
      const t = smooth(0.35, 0, v) * 0.6; // whiter towards the stalk
      return [mix(col.r, 1, t), mix(col.g, 1, t), mix(col.b, 0.85, t)];
    });
    parts.push(leaf);
  }
  const g = merge(parts);
  sit(g);
  return g;
});

const shredGeos = once(() => {
  const out: THREE.BufferGeometry[] = [];
  const r = rng(320);
  for (let i = 0; i < 4; i++) {
    const L = 0.045 + r() * 0.025;
    const w = 0.01 + r() * 0.006;
    const curl = 0.004 + r() * 0.006;
    const twist = (r() - 0.5) * 2.4;
    out.push(
      surface(10, 2, (u, v, o) => {
        const a = twist * (u - 0.5);
        const z = (v - 0.5) * w;
        const y = curl * Math.sin(Math.PI * u) + 0.0015 * Math.sin(u * 22) * (2 * v - 1) ** 2;
        o.set((u - 0.5) * L, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a));
      }, (u, v) => [0.3 + v * 0.4, u]),
    );
  }
  return out;
});

const shreddedGeo = once(() => {
  const r = rng(330);
  const shreds = shredGeos();
  const pale = new THREE.Color(1, 1, 0.82);
  const dark = new THREE.Color(0.42, 0.66, 0.32);
  const pieces: Piece[] = [];
  for (let i = 0; i < 18; i++) {
    const a = i * 2.39996;
    const d = Math.sqrt(i / 18) * 0.055;
    pieces.push({
      geo: shreds[i % 4],
      x: Math.cos(a) * d,
      y: 0.006 + (1 - d / 0.055) * 0.02 + r() * 0.004,
      z: Math.sin(a) * d,
      rx: (r() - 0.5) * 0.7,
      ry: r() * Math.PI,
      rz: (r() - 0.5) * 0.5,
      col: pale.clone().lerp(dark, r()),
    });
  }
  return assemble(pieces);
});

// ---------------------------------------------------------------------------------------------
// Bread: a scored baguette.
// ---------------------------------------------------------------------------------------------

const BREAD_L = 0.26;
const BREAD_R = 0.034;
const SLASH_A = 0.5;

/** Groove (pale crumb) and lip (dark ridge) weights for a point on the loaf in (t along, w around) space. */
function breadSlash(t: number, w: number): { groove: number; lip: number; depth: number } {
  let groove = 0;
  let lip = 0;
  let depth = 0;
  const Yv = (w - 0.5) * TAU * BREAD_R;
  for (let i = 0; i < 5; i++) {
    const tc = 0.18 + i * 0.16;
    const X = (t - tc) * BREAD_L;
    const p = X * Math.cos(SLASH_A) + Yv * Math.sin(SLASH_A);
    const q = -X * Math.sin(SLASH_A) + Yv * Math.cos(SLASH_A);
    const hl = 0.032;
    if (Math.abs(p) > hl) continue;
    const prof = 1 - (p / hl) ** 2;
    const wq = 0.0045 * (0.5 + 0.5 * prof);
    const g = prof * Math.exp(-((q / wq) ** 2));
    const l = prof * Math.exp(-(((q - wq * 1.7) / (wq * 0.8)) ** 2));
    groove = Math.max(groove, g);
    lip = Math.max(lip, l);
    depth += -0.0055 * g + 0.003 * l;
  }
  return { groove: smooth(0.25, 0.7, groove), lip: smooth(0.2, 0.8, lip) * (1 - groove), depth };
}

/** Warp around-parameter so vertices bunch up on top where the scores are. */
const breadWarp = (v: number) => v - 0.1 * Math.sin(TAU * (v - 0.5));

const breadGeo = once(() => {
  const g = surface(
    56,
    22,
    (u, v, o) => {
      const t = u;
      const w = breadWarp(v);
      const a = TAU * w;
      const ny = -Math.cos(a);
      const nz = Math.sin(a);
      const prof = Math.pow(Math.sin(Math.PI * t), 0.38);
      let rr = BREAD_R * prof * (1 + 0.035 * fbm(t * 9, ny * 1.5, nz * 1.5, 400));
      rr = Math.max(0, rr + breadSlash(t, w).depth * prof);
      o.set((t - 0.5) * BREAD_L * (1 + 0.02 * ny), ny > 0 ? ny * rr * 0.86 : ny * rr * 0.4, nz * rr);
    },
    (u, v) => [u, breadWarp(v)],
  );
  sit(g);
  return g;
});

const croutonGeo = once(() => {
  const box = new RoundedBoxGeometry(0.024, 0.022, 0.026, 1, 0.004);
  const r = rng(410);
  const pieces: Piece[] = [];
  for (let i = 0; i < 10; i++) {
    const a = i * 2.39996;
    const d = Math.sqrt(i / 10) * 0.05;
    const s = 0.85 + r() * 0.35;
    const g = box.clone().scale(s, s * (0.9 + r() * 0.2), s);
    pieces.push({ geo: g, x: Math.cos(a) * d, y: 0.011 + (i < 3 ? 0.014 : 0), z: Math.sin(a) * d, rx: (r() - 0.5) * 0.5, ry: r() * Math.PI, rz: (r() - 0.5) * 0.5 });
  }
  return assemble(pieces);
});

// ---------------------------------------------------------------------------------------------
// Tomato: glossy, slightly ribbed and flattened, with a star calyx and stem.
// ---------------------------------------------------------------------------------------------

const tomatoGeo = once(() => {
  const g = surface(28, 20, (u, v, o) => {
    sphDir(u, v, o);
    const th = TAU * u;
    const shoulder = smooth(0.35, 0.9, v);
    const r = 0.056 * (1 + 0.035 * Math.cos(5 * th + 0.4) * Math.sin(Math.PI * v) * shoulder + 0.015 * fbm(o.x * 2, o.y * 2, o.z * 2, 500));
    o.multiplyScalar(r);
    o.y *= 0.8;
    o.y -= 0.012 * Math.exp(-(((1 - v) / 0.13) ** 2));
    if (o.y < -0.036) o.y = -0.036 + (o.y + 0.036) * 0.45;
  });
  sit(g);
  return g;
});

const calyxGeo = once(() => {
  const body = tomatoGeo();
  const probe = new THREE.Mesh(body, new THREE.MeshBasicMaterial());
  const rc = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const surfY = (x: number, z: number): number => {
    rc.set(new THREE.Vector3(x, 1, z), down);
    const hit = rc.intersectObject(probe)[0];
    return hit ? hit.point.y : 0;
  };
  const r = rng(510);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const ang = (k / 5) * TAU + (r() - 0.5) * 0.4;
    const L = 0.026 + r() * 0.01;
    const curl = 0.002 + r() * 0.004;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const sep = surface(4, 7, (u, v, o) => {
      const s = u * 2 - 1;
      const w = 0.0065 * Math.pow(1 - v, 0.7) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, v * 1.6)));
      const lx = v * L;
      const lz = s * w;
      const x = lx * ca - lz * sa;
      const z = lx * sa + lz * ca;
      o.set(x, surfY(x, z) + 0.0012 + 0.0012 * (1 - s * s) + curl * v * v * v, z);
    });
    parts.push(sep);
  }
  const topY = surfY(0, 0);
  const stem = new THREE.CylinderGeometry(0.0028, 0.0042, 0.018, 8, 1);
  stem.rotateZ(0.25);
  stem.translate(0.002, topY + 0.009, 0);
  const nub = new THREE.SphereGeometry(0.006, 10, 6);
  nub.scale(1, 0.45, 1);
  nub.translate(0, topY + 0.0015, 0);
  return merge([...parts, stem, nub]);
});

const diceGeo = once(() => {
  const box = new RoundedBoxGeometry(0.02, 0.018, 0.02, 1, 0.003);
  const r = rng(520);
  const pieces: Piece[] = [];
  for (let i = 0; i < 11; i++) {
    const a = i * 2.39996;
    const d = Math.sqrt(i / 11) * 0.045;
    const s = 0.8 + r() * 0.4;
    pieces.push({ geo: box.clone().scale(s, s, s), x: Math.cos(a) * d, y: 0.009 + (i < 3 ? 0.012 : 0), z: Math.sin(a) * d, rx: (r() - 0.5) * 0.6, ry: r() * Math.PI, rz: (r() - 0.5) * 0.6 });
  }
  return assemble(pieces);
});

// ---------------------------------------------------------------------------------------------
// Potato: lumpy, dusty oblong with eye dimples.
// ---------------------------------------------------------------------------------------------

const potatoGeo = once(() => {
  const g = surface(28, 18, (u, v, o) => {
    const d = sphDir(u, v, o).clone();
    let m = 1 + 0.12 * fbm(d.x * 1.3, d.y * 1.3, d.z * 1.3, 600) + 0.035 * fbm(d.x * 4, d.y * 4, d.z * 4, 601);
    for (const e of potatoEyeDirs) m -= 0.07 * Math.exp(-((d.distanceTo(e) / 0.11) ** 2));
    o.set(d.x * 0.08 * m, d.y * 0.042 * m, d.z * 0.05 * m);
    o.y += 0.008 * (1 - (d.x * d.x));
  });
  sit(g);
  return g;
});

const friesGeo = once(() => {
  const r = rng(610);
  const lens = [0.07, 0.085, 0.06];
  const batons = lens.map((L) => new RoundedBoxGeometry(0.012, 0.012, L, 1, 0.002));
  const pieces: Piece[] = [];
  for (let i = 0; i < 11; i++) {
    const layer = i < 7 ? 0 : 1;
    const ry = layer === 0 ? (r() - 0.5) * 0.5 : Math.PI / 2 + (r() - 0.5) * 0.6;
    pieces.push({
      geo: batons[i % 3],
      x: layer === 0 ? (i - 3) * 0.014 + (r() - 0.5) * 0.004 : (r() - 0.5) * 0.02,
      y: 0.006 + layer * 0.011,
      z: layer === 0 ? (r() - 0.5) * 0.02 : (i - 8) * 0.016,
      rx: (r() - 0.5) * 0.15,
      ry,
      rz: (r() - 0.5) * 0.3,
    });
  }
  return assemble(pieces);
});

// ---------------------------------------------------------------------------------------------
// Pasta: a bundle of dry spaghetti held by a printed paper band.
// ---------------------------------------------------------------------------------------------

const pastaGeo = once(() => {
  const r = rng(700);
  const strand = new THREE.CylinderGeometry(0.0011, 0.0011, 1, 5, 1);
  strand.rotateZ(Math.PI / 2);
  const pieces: Piece[] = [];
  const N = 44;
  for (let i = 0; i < N; i++) {
    const a = i * 2.39996;
    const d = Math.sqrt((i + 0.5) / N) * 0.0098;
    const L = 0.25 + r() * 0.012;
    const s = strand.clone().scale(L, 1, 1);
    const shade = 0.9 + r() * 0.1;
    pieces.push({ geo: s, x: (r() - 0.5) * 0.008, y: Math.sin(a) * d, z: Math.cos(a) * d, ry: (r() - 0.5) * 0.03, rz: (r() - 0.5) * 0.03, col: new THREE.Color(shade, shade, shade * 0.95) });
  }
  const g = assemble(pieces, false);
  g.translate(0, 0.0122, 0);
  return g;
});

const pastaBandGeo = once(() => {
  const band = new THREE.CylinderGeometry(0.0118, 0.0118, 0.03, 20, 1, true);
  band.rotateZ(Math.PI / 2);
  band.translate(0, 0.0122, 0);
  return band;
});

const snappedGeo = once(() => {
  const r = rng(710);
  const strand = new THREE.CylinderGeometry(0.0012, 0.0012, 1, 5, 1);
  strand.rotateZ(Math.PI / 2);
  const pieces: Piece[] = [];
  for (let i = 0; i < 28; i++) {
    const L = 0.03 + r() * 0.06;
    const a = r() * TAU;
    const d = Math.sqrt(r()) * 0.04;
    const shade = 0.9 + r() * 0.1;
    pieces.push({ geo: strand.clone().scale(L, 1, 1), x: Math.cos(a) * d, y: 0.0012 + r() * 0.01 * (1 - d / 0.04), z: Math.sin(a) * d, ry: r() * Math.PI, rz: (r() - 0.5) * 0.15, col: new THREE.Color(shade, shade, shade * 0.95) });
  }
  return assemble(pieces);
});

// ---------------------------------------------------------------------------------------------
// Steak: a marbled slab with a fat cap along one edge.
// ---------------------------------------------------------------------------------------------

const STEAK_TH1 = Math.PI * 0.12;
const STEAK_TH2 = Math.PI * 0.88;

function steakR(th: number): number {
  const a = 0.098;
  const b = 0.064;
  const base = 1 / Math.sqrt((Math.cos(th) / a) ** 2 + (Math.sin(th) / b) ** 2);
  return base * (1 + 0.06 * Math.cos(2 * th + 0.5) + 0.04 * Math.sin(3 * th) + 0.03 * noise3(Math.cos(th) * 2, Math.sin(th) * 2, 0, 800));
}

const steakParts = once(() => {
  const N = 48;
  const body = new THREE.Shape();
  for (let i = 0; i < N; i++) {
    const th = (i / N) * TAU;
    const r = steakR(th);
    if (i === 0) body.moveTo(r * Math.cos(th), r * Math.sin(th));
    else body.lineTo(r * Math.cos(th), r * Math.sin(th));
  }
  body.closePath();
  const fat = new THREE.Shape();
  const M = 20;
  for (let i = 0; i <= M; i++) {
    const th = STEAK_TH1 + (STEAK_TH2 - STEAK_TH1) * (i / M);
    const tf = 0.016 * Math.pow(Math.sin((Math.PI * i) / M), 0.6) + 0.0005;
    const r = steakR(th) + tf;
    if (i === 0) fat.moveTo(r * Math.cos(th), r * Math.sin(th));
    else fat.lineTo(r * Math.cos(th), r * Math.sin(th));
  }
  for (let i = M; i >= 0; i--) {
    const th = STEAK_TH1 + (STEAK_TH2 - STEAK_TH1) * (i / M);
    const r = steakR(th) - 0.003;
    fat.lineTo(r * Math.cos(th), r * Math.sin(th));
  }
  fat.closePath();
  const ext = { depth: 0.02, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 3, curveSegments: 4 };
  const bodyGeo = new THREE.ExtrudeGeometry(body, ext);
  const fatGeo = new THREE.ExtrudeGeometry(fat, { ...ext, depth: 0.019, bevelSize: 0.0045 });
  fatGeo.translate(0, 0, 0.0005);
  const top = new THREE.ShapeGeometry(body);
  const bottom = top.clone();
  top.translate(0, 0, 0.0256);
  bottom.rotateX(Math.PI);
  bottom.translate(0, 0, -0.0056);
  const marble = merge([top, bottom]);
  for (const g of [bodyGeo, fatGeo, marble]) {
    planarUV(g, 'x', 'y');
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.005, 0);
  }
  return { body: bodyGeo, fat: fatGeo, marble };
});

/** One steak slice lying on its cut face: an irregular rounded strip, extruded by the slice thickness. */
function steakSlice(L: number, seed: number): THREE.BufferGeometry {
  const h = 0.026;
  const N = 12;
  const shp = new THREE.Shape();
  const half = (x: number, side: number) => {
    const e = clamp01((L / 2 - Math.abs(x)) / (h * 0.55));
    return side * (h / 2) * (1 + 0.1 * noise3(x * 70, side, seed, 830)) * Math.max(0.3, Math.sqrt(e));
  };
  for (let i = 0; i <= N; i++) {
    const x = -L / 2 + (L * i) / N;
    if (i === 0) shp.moveTo(x, half(x, 1));
    else shp.lineTo(x, half(x, 1));
  }
  for (let i = N; i >= 0; i--) {
    const x = -L / 2 + (L * i) / N;
    shp.lineTo(x, half(x, -1));
  }
  shp.closePath();
  const g = new THREE.ExtrudeGeometry(shp, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0016, bevelSegments: 2 });
  planarUV(g, 'x', 'y');
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.0016, 0);
  return g;
}

const steakSliceParts = once(() => {
  const lens = [0.085, 0.105, 0.118, 0.12, 0.108, 0.088];
  const fatEnd = new RoundedBoxGeometry(0.01, 0.0105, 0.022, 1, 0.0025);
  const meat: Piece[] = [];
  const fat: Piece[] = [];
  const r = rng(810);
  lens.forEach((L, i) => {
    const p = { x: (r() - 0.5) * 0.008, y: 0.003 + i * 0.0022, z: (i - 2.5) * 0.021, ry: (i - 2.5) * 0.06, rx: -0.16 };
    meat.push({ geo: steakSlice(L, i), ...p });
    const fz = { ...p };
    // Fat cap sits on the +x end of each slice (rotated with it).
    const c = Math.cos(p.ry);
    const sn = Math.sin(p.ry);
    const dx = L / 2 + 0.004;
    fat.push({ geo: fatEnd, ...fz, x: p.x + dx * c, z: p.z - dx * sn, y: p.y + 0.0052 });
  });
  const m = assemble(meat, false);
  const f = assemble(fat, false);
  m.computeBoundingBox();
  f.computeBoundingBox();
  const lift = -Math.min(m.boundingBox!.min.y, f.boundingBox!.min.y);
  m.translate(0, lift, 0);
  f.translate(0, lift, 0);
  return { meat: m, fat: f };
});

// ---------------------------------------------------------------------------------------------
// Beef fillet: a long rounded log tied with butcher's twine, streaked with silverskin.
// ---------------------------------------------------------------------------------------------

const FILLET_L = 0.22;

function filletPoint(t: number, a: number, o: THREE.Vector3): THREE.Vector3 {
  const ny = -Math.cos(a);
  const nz = Math.sin(a);
  const prof = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.28);
  const R = 0.036 * (1 - 0.36 * t * t);
  const r = R * prof * (1 + 0.06 * fbm(t * 6, ny * 1.5, nz * 1.5, 900) + 0.025 * fbm(t * 18, ny * 3, nz * 3, 901));
  return o.set((t - 0.5) * FILLET_L, ny > 0 ? ny * r * 0.92 : ny * r * 0.6, nz * r * 1.06);
}

const filletParts = once(() => {
  const body = surface(32, 18, (u, v, o) => filletPoint(u, TAU * v, o));
  const off = sit(body);
  const skin = inflate(body, 0.0005);
  const strings: THREE.BufferGeometry[] = [];
  const c = new THREE.Vector3();
  for (const t of [0.27, 0.5, 0.73]) {
    strings.push(
      surface(22, 4, (u, v, o) => {
        filletPoint(t, TAU * u, c);
        const rad = new THREE.Vector3(0, c.y, c.z).normalize();
        c.addScaledVector(rad, -0.0009);
        const ps = TAU * v;
        o.copy(c).addScaledVector(rad, 0.0016 * Math.cos(ps)).add(new THREE.Vector3(0.0016 * Math.sin(ps), 0, 0)).add(off);
      }),
    );
  }
  return { body, skin, twine: merge(strings) };
});

/** Lathe profile for a medallion (radius, height, corner radius); returns points and the v where caps end. */
const MED_R = 0.03;
const MED_H = 0.024;
const MED_B = 0.0035;
const medProfile = (() => {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.0001, 0), new THREE.Vector2((MED_R - MED_B) * 0.5, 0), new THREE.Vector2(MED_R - MED_B, 0)];
  for (let i = 1; i <= 2; i++) {
    const a = -Math.PI / 2 + (i / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(MED_R - MED_B + Math.cos(a) * MED_B, MED_B + Math.sin(a) * MED_B));
  }
  pts.push(new THREE.Vector2(MED_R, MED_B), new THREE.Vector2(MED_R, MED_H - MED_B));
  for (let i = 1; i <= 2; i++) {
    const a = (i / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(MED_R - MED_B + Math.cos(a) * MED_B, MED_H - MED_B + Math.sin(a) * MED_B));
  }
  pts.push(new THREE.Vector2(MED_R - MED_B, MED_H), new THREE.Vector2((MED_R - MED_B) * 0.5, MED_H), new THREE.Vector2(0.0001, MED_H));
  return pts;
})();
const MED_CAP_V = 2 / (medProfile.length - 1);

const medallionParts = once(() => {
  const disc = new THREE.LatheGeometry(medProfile, 18);
  const dp = disc.attributes.position;
  for (let i = 0; i < dp.count; i++) {
    const x = dp.getX(i);
    const z = dp.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.07 * noise3(Math.cos(a) * 1.6, Math.sin(a) * 1.6, 0, 920) + 0.012 * Math.sin(dp.getY(i) * 300);
    dp.setXYZ(i, x * k, dp.getY(i) * (1 + 0.1 * noise3(x * 40, z * 40, 1, 921)), z * k);
  }
  disc.computeVertexNormals();
  weldNormals(disc);
  const twine = new THREE.TorusGeometry(MED_R * 0.985, 0.0011, 4, 20);
  twine.rotateX(Math.PI / 2);
  twine.translate(0, MED_H / 2, 0);
  const r = rng(910);
  const meat: Piece[] = [];
  const str: Piece[] = [];
  const spots = [
    [-0.034, -0.022],
    [0.032, -0.03],
    [-0.028, 0.038],
    [0.036, 0.03],
  ];
  spots.forEach(([x, z], i) => {
    const p = { x, y: 0, z, ry: r() * TAU, rx: i === 3 ? 0.1 : 0 };
    meat.push({ geo: disc, ...p });
    str.push({ geo: twine, ...p });
  });
  return { meat: assemble(meat, false), twine: assemble(str, false) };
});

// ---------------------------------------------------------------------------------------------
// Mushroom: domed cap with gills underneath and a stem.
// ---------------------------------------------------------------------------------------------

const CAP_R = 0.048;
const CAP_H = 0.034;
const CAP_Y = 0.042;

function capPoint(u: number, v: number, o: THREE.Vector3): THREE.Vector3 {
  const g = -0.35 + (Math.PI / 2 + 0.35) * v;
  const th = TAU * u;
  const wob = 1 + 0.03 * noise3(Math.cos(th) * 3, Math.sin(th) * 3, 0, 1000);
  let rad = CAP_R * Math.cos(g) * wob;
  if (g < 0) rad *= 1 - 0.45 * -g;
  const y = g < 0 ? CAP_H * Math.sin(g) * 0.5 : CAP_H * Math.pow(Math.sin(g), 0.9);
  return o.set(rad * Math.cos(th), CAP_Y + y, -rad * Math.sin(th));
}

const mushroomParts = once(() => {
  const cap = surface(28, 12, capPoint);
  const rimIn = new THREE.Vector3();
  const gills = surface(28, 3, (u, v, o) => {
    capPoint(u, 0, rimIn);
    const th = TAU * u;
    const rad = mix(Math.hypot(rimIn.x, rimIn.z), 0.015, v);
    o.set(rad * Math.cos(th), mix(rimIn.y, CAP_Y + 0.004, v), -rad * Math.sin(th));
  });
  const stem = surface(16, 5, (u, v, o) => {
    const th = TAU * u;
    const y = v * (CAP_Y + 0.006);
    let r = 0.0155 * (1 + 0.18 * (1 - v) ** 3);
    if (v < 0.08) r *= 0.75 + 0.25 * (v / 0.08);
    o.set(r * Math.cos(th), y, -r * Math.sin(th));
  });
  return { cap, gills, stem };
});

const MUSH_SLICE = { width: 0.052, height: 0.046, capBase: 0.024, stemW: 0.014 };

const duxellesParts = once(() => {
  const mound = surface(22, 8, (u, v, o) => {
    const th = TAU * u;
    const ph = (Math.PI / 2) * v; // 0 rim .. pi/2 top
    const d = new THREE.Vector3(Math.cos(ph) * Math.cos(th), Math.sin(ph), -Math.cos(ph) * Math.sin(th));
    const n = 1 + 0.18 * fbm(d.x * 5, d.y * 5, d.z * 5, 1100) + 0.08 * fbm(d.x * 14, d.y * 14, d.z * 14, 1101);
    o.set(d.x * 0.05 * n, d.y * 0.022 * n, d.z * 0.05 * n);
  });
  mound.translate(0, 0.0005, 0);
  const r = rng(1110);
  const bit = new THREE.IcosahedronGeometry(0.005, 1);
  const pieces: Piece[] = [{ geo: mound, x: 0, y: 0, z: 0 }];
  for (let i = 0; i < 12; i++) {
    const a = r() * TAU;
    const d = 0.05 + r() * 0.015;
    const s = 0.7 + r() * 0.8;
    pieces.push({ geo: bit.clone().scale(s, s * 0.6, s), x: Math.cos(a) * d, y: 0.002, z: Math.sin(a) * d, ry: r() * TAU });
  }
  const minced = assemble(pieces, false);
  // T-shaped slices resting on the mound.
  const { width: W, height: H, capBase: CB, stemW: SW } = MUSH_SLICE;
  const shp = new THREE.Shape();
  shp.moveTo(-SW / 2, 0);
  shp.lineTo(-SW / 2, CB);
  shp.lineTo(-W / 2, CB);
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI - (i / 12) * Math.PI;
    shp.lineTo((Math.cos(a) * W) / 2, CB + Math.sin(a) * (H - CB));
  }
  shp.lineTo(SW / 2, CB);
  shp.lineTo(SW / 2, 0);
  shp.closePath();
  const sl = new THREE.ExtrudeGeometry(shp, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 1 });
  planarUV(sl, 'x', 'y');
  sl.translate(0, -H / 2, 0);
  const slices = assemble(
    [
      { geo: sl, x: -0.012, y: 0.024, z: 0.004, rx: -Math.PI / 2 + 0.35, ry: 0.4 },
      { geo: sl, x: 0.02, y: 0.02, z: -0.012, rx: -Math.PI / 2 + 0.3, ry: 2.4 },
      { geo: sl, x: 0.006, y: 0.016, z: 0.03, rx: -Math.PI / 2 + 0.25, ry: -1.3 },
    ],
    false,
  );
  return { minced, slices };
});

// ---------------------------------------------------------------------------------------------
// Green beans: a small bunch of curved, tapered pods.
// ---------------------------------------------------------------------------------------------

function podGeo(L: number, R: number, bend: number, seed: number): THREE.BufferGeometry {
  const c = new THREE.Vector3();
  const tng = new THREE.Vector3();
  const side = new THREE.Vector3();
  const g = surface(22, 8, (u, v, o) => {
    const t = u;
    const x = (t - 0.5) * L;
    const z = bend * Math.sin(Math.PI * t);
    const dz = (bend * Math.PI * Math.cos(Math.PI * t)) / L;
    const tail = Math.max(0, t - 0.88) / 0.12;
    c.set(x, 0.004 * tail * tail, z);
    tng.set(1, 0, dz).normalize();
    side.set(-tng.z, 0, tng.x);
    let r = R * Math.pow(Math.sin(Math.PI * (0.02 + 0.96 * t)), 0.5) * (1 - 0.35 * t ** 4);
    r *= 1 + 0.09 * Math.sin(Math.PI * t * 7.5 + seed) ** 2 * smooth(0.08, 0.2, t) * smooth(0.92, 0.8, t);
    if (t < 0.05) r *= 0.6 + 0.4 * (t / 0.05);
    const ps = TAU * v;
    o.copy(c).addScaledVector(side, r * Math.cos(ps)).add(new THREE.Vector3(0, r * 0.85 * Math.sin(ps), 0));
  });
  paint(g, (i) => {
    const t = g.attributes.uv.getX(i);
    const stemEnd = 1 - smooth(0, 0.06, t);
    return [mix(1, 1.15, stemEnd), mix(1, 1.05, stemEnd), mix(1, 0.7, stemEnd)];
  });
  return g;
}

const beansGeo = once(() => {
  const r = rng(1200);
  const variants = [podGeo(0.13, 0.0048, 0.008, 1), podGeo(0.12, 0.0045, -0.01, 2), podGeo(0.14, 0.005, 0.005, 3)];
  const pieces: Piece[] = [];
  for (let i = 0; i < 7; i++) {
    const top = i >= 5;
    const shade = 0.88 + r() * 0.14;
    pieces.push({
      geo: variants[i % 3],
      x: (r() - 0.5) * 0.02,
      y: 0.0045 + (top ? 0.0085 : 0),
      z: top ? (i - 5.5) * 0.012 : (i - 2) * 0.0115,
      rx: (r() - 0.5) * 0.5,
      ry: (r() - 0.5) * 0.25 + (r() < 0.5 ? Math.PI : 0),
      col: new THREE.Color(shade, shade, shade),
    });
  }
  return assemble(pieces);
});

const snippedGeo = once(() => {
  const r = rng(1210);
  const seg = new THREE.CylinderGeometry(0.0046, 0.0046, 1, 10, 1);
  seg.rotateZ(Math.PI / 2);
  // Swap the cylinder's UVs so the bean texture's seams run along the segment.
  const uv = seg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
  paint(seg, (i) => (Math.abs(seg.attributes.normal.getX(i)) > 0.9 ? [1.25, 1.2, 0.85] : [1, 1, 1]));
  const tip = new THREE.ConeGeometry(0.0046, 0.018, 10, 1);
  tip.rotateZ(-Math.PI / 2);
  const pieces: Piece[] = [];
  for (let i = 0; i < 16; i++) {
    const a = i * 2.39996;
    const d = Math.sqrt(i / 16) * 0.045;
    const isTip = i % 7 === 3;
    const L = 0.018 + r() * 0.012;
    const shade = 0.88 + r() * 0.14;
    pieces.push({
      geo: isTip ? tip : seg.clone().scale(L, 1, 1),
      x: Math.cos(a) * d,
      y: 0.0045 + (i < 4 ? 0.008 : 0),
      z: Math.sin(a) * d,
      ry: r() * Math.PI,
      rz: (r() - 0.5) * 0.3,
      col: new THREE.Color(shade, shade, shade),
    });
  }
  return assemble(pieces);
});

// ---------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------

export const INGREDIENTS: Record<IngredientKind, IngredientDef> = {
  lettuce: {
    name: 'Lettuce',
    choppedName: 'Chopped Lettuce',
    raw: 0x6fbf3a,
    cooked: 0x4a7a24,
    whole: () => group(tinted(lettuceGeo(), 0xb4e070, { map: T.leaf(), roughness: 0.55, side: THREE.DoubleSide, vertexColors: true })),
    chopped: () => group(tinted(shreddedGeo(), 0xb4e070, { map: T.leaf(), roughness: 0.55, side: THREE.DoubleSide, vertexColors: true })),
  },
  bread: {
    name: 'Bread',
    choppedName: 'Croutons',
    raw: 0xd9a75a,
    cooked: 0xa86a2a,
    whole: () => group(tinted(breadGeo(), 0xf6dfb0, { map: T.bread(), roughness: 0.85 })),
    chopped: () => group(tinted(croutonGeo(), 0xf2d9a6, { map: T.crouton(), roughness: 0.9 })),
  },
  tomato: {
    name: 'Tomato',
    choppedName: 'Diced Tomato',
    raw: 0xd8281c,
    cooked: 0x9a1a10,
    whole: () =>
      group(
        tinted(tomatoGeo(), 0xd8281c, { map: T.tomato(), roughness: 0.22 }),
        fixed(calyxGeo(), 0x3f7a26, { roughness: 0.6, side: THREE.DoubleSide }),
      ),
    chopped: () => group(tinted(diceGeo(), 0xee4a34, { map: T.dice(), roughness: 0.3 })),
  },
  potato: {
    name: 'Potato',
    choppedName: 'Raw Fries',
    raw: 0xb08a50,
    cooked: 0xe0b040,
    whole: () => group(tinted(potatoGeo(), 0xbf9862, { map: T.potato(), roughness: 0.92 })),
    chopped: () => group(tinted(friesGeo(), 0xf0dc9a, { map: T.fries(), roughness: 0.6 })),
  },
  pasta: {
    name: 'Dry Spaghetti',
    choppedName: 'Snapped Spaghetti',
    raw: 0xf0d878,
    cooked: 0xf6e8b0,
    whole: () =>
      group(
        tinted(pastaGeo(), 0xf0d878, { roughness: 0.4, vertexColors: true }),
        fixed(pastaBandGeo(), 0xffffff, { map: T.pastaBand(), roughness: 0.65, side: THREE.DoubleSide }),
      ),
    chopped: () => group(tinted(snappedGeo(), 0xf0d878, { roughness: 0.4, vertexColors: true })),
  },
  steak: {
    name: 'Steak',
    choppedName: 'Sliced Steak',
    raw: 0xc0303a,
    cooked: 0x6a3a1c,
    whole: () => {
      const p = steakParts();
      return group(
        tinted(p.body, 0xc0303a, { map: T.steakBody(), roughness: 0.5 }),
        tinted(p.marble, 0xf4dcd6, { map: T.steakMarble(), roughness: 0.45, transparent: true, alphaTest: 0.02 }),
        fixed(p.fat, 0xf2e4cc, { map: T.fat(), roughness: 0.5 }),
      );
    },
    chopped: () => {
      const p = steakSliceParts();
      return group(tinted(p.meat, 0xe86672, { map: T.slice(), roughness: 0.5 }), fixed(p.fat, 0xf2e4cc, { map: T.fat(), roughness: 0.5 }));
    },
  },
  beef: {
    name: 'Beef Fillet',
    choppedName: 'Beef Medallions',
    raw: 0xb8283a,
    cooked: 0x7a4020,
    whole: () => {
      const p = filletParts();
      return group(
        tinted(p.body, 0xa82434, { map: T.fillet(), roughness: 0.48 }),
        tinted(p.skin, 0xeceef4, { map: T.silverskin(), roughness: 0.3, transparent: true, alphaTest: 0.02 }),
        fixed(p.twine, 0xc9b48a, { roughness: 0.95 }),
      );
    },
    chopped: () => {
      const p = medallionParts();
      return group(tinted(p.meat, 0xd65464, { map: T.medallion(), roughness: 0.5 }), fixed(p.twine, 0xc9b48a, { roughness: 0.95 }));
    },
  },
  mushroom: {
    name: 'Mushroom',
    choppedName: 'Duxelles',
    raw: 0xc8b8a0,
    cooked: 0x6a5038,
    whole: () => {
      const p = mushroomParts();
      return group(
        tinted(p.cap, 0xa98560, { map: T.mushroomCap(), roughness: 0.7, side: THREE.DoubleSide }),
        tinted(p.gills, 0x80604c, { map: T.gills(), roughness: 0.85, side: THREE.DoubleSide }),
        tinted(p.stem, 0xeadfcb, { map: T.stem(), roughness: 0.75 }),
      );
    },
    chopped: () => {
      const p = duxellesParts();
      return group(tinted(p.minced, 0x8e6c4e, { map: T.mince(), roughness: 0.8 }), tinted(p.slices, 0xe6d6b8, { map: T.sliceMush(), roughness: 0.75 }));
    },
  },
  greens: {
    name: 'Green Beans',
    choppedName: 'Snipped Beans',
    raw: 0x3a9a2a,
    cooked: 0x2f7f22,
    whole: () => group(tinted(beansGeo(), 0x48a832, { map: T.bean(), roughness: 0.45, vertexColors: true })),
    chopped: () => group(tinted(snippedGeo(), 0x48a832, { map: T.bean(), roughness: 0.45, vertexColors: true })),
  },
};

export const ingredientMeshFactories = Object.fromEntries(
  (Object.keys(INGREDIENTS) as IngredientKind[]).map((k) => [k, () => INGREDIENTS[k].whole()]),
) as unknown as Record<IngredientKind, () => THREE.Object3D>;
