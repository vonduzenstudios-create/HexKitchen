import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mat } from '../engine/psx';
import { canvasTexture } from '../engine/textures';

export type IngredientKind =
  | 'lettuce'
  | 'bread'
  | 'tomato'
  | 'potato'
  | 'pasta'
  | 'steak'
  | 'beef'
  | 'mushroom'
  | 'greens'
  | 'sourdough'
  | 'cheese'
  | 'pastry';

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
// Episode 2 (The Last Resort): bakery and oven models.
// ---------------------------------------------------------------------------------------------

/** Split a geometry by its groups, merging groups that share a material index. */
function splitByMaterial(geo0: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const geo = geo0.index ? geo0.toNonIndexed() : geo0;
  const byMat = new Map<number, [number, number][]>();
  for (const g of geo.groups) {
    const k = g.materialIndex ?? 0;
    if (!byMat.has(k)) byMat.set(k, []);
    byMat.get(k)!.push([g.start, g.count]);
  }
  const out: THREE.BufferGeometry[] = [];
  for (const k of [...byMat.keys()].sort()) {
    const ranges = byMat.get(k)!;
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(geo.attributes)) {
      const a = geo.attributes[name] as THREE.BufferAttribute;
      const n = a.itemSize;
      const parts: number[] = [];
      for (const [s, c] of ranges) for (let i = s * n; i < (s + c) * n; i++) parts.push(a.array[i] as number);
      g.setAttribute(name, new THREE.Float32BufferAttribute(parts, n));
    }
    out.push(g);
  }
  return out;
}

/** Keep only the triangles of a non-indexed geometry that pass the test (centroid, face normal). */
function filterTris(geo0: THREE.BufferGeometry, keep: (c: THREE.Vector3, n: THREE.Vector3) => boolean): THREE.BufferGeometry {
  const geo = geo0.index ? geo0.toNonIndexed() : geo0;
  const p = geo.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const tris: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    d.fromBufferAttribute(p, i + 2);
    c.copy(a).add(b).add(d).multiplyScalar(1 / 3);
    n.subVectors(b, a).cross(d.clone().sub(a)).normalize();
    if (keep(c, n)) tris.push(i);
  }
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const at = geo.attributes[name] as THREE.BufferAttribute;
    const k = at.itemSize;
    const arr = new Float32Array(tris.length * 3 * k);
    tris.forEach((t, j) => {
      for (let q = 0; q < 3 * k; q++) arr[j * 3 * k + q] = at.array[t * k + q] as number;
    });
    g.setAttribute(name, new THREE.Float32BufferAttribute(arr, k));
  }
  return g;
}

/** Use the colour map as a bump map too, so pores, scores and dimples catch the light. */
function bumpy<M extends THREE.Mesh>(m: M, scale: number): M {
  const mm = m.material as THREE.MeshStandardMaterial;
  mm.bumpMap = mm.map;
  mm.bumpScale = scale;
  return m;
}

/** Tinted mesh with its own browning target (honoured by Item.refreshTint when it reads userData.cooked). */
function browns<M extends THREE.Mesh>(m: M, cooked: number): M {
  m.userData.tint = true;
  m.userData.cooked = cooked;
  return m;
}

const frac = (x: number) => x - Math.floor(x);

// ---- Sourdough boule ---------------------------------------------------------------------------

const BOULE_R = 0.088;

/** Cross-shaped "ear" scores on the crown, in sphere-direction space. */
function bouleScore(d: THREE.Vector3): { groove: number; lip: number; depth: number } {
  const ca = Math.cos(0.4);
  const sa = Math.sin(0.4);
  const ax = d.x * ca - d.z * sa;
  const az = d.x * sa + d.z * ca;
  const crown = smooth(0.25, 0.55, d.y);
  let groove = 0;
  let lip = 0;
  for (const [along, across] of [
    [ax, az],
    [az, ax],
  ]) {
    const L = 0.62;
    if (Math.abs(along) > L) continue;
    const prof = 1 - (along / L) ** 2;
    const w = 0.05 * (0.35 + 0.65 * prof);
    groove = Math.max(groove, prof * Math.exp(-((across / w) ** 2)));
    lip = Math.max(lip, prof * Math.exp(-(((Math.abs(across) - w * 1.7) / (w * 0.75)) ** 2)));
  }
  groove *= crown;
  lip *= crown;
  return { groove: smooth(0.2, 0.75, groove), lip: smooth(0.15, 0.8, lip) * (1 - groove), depth: -0.009 * groove + 0.0035 * lip };
}

const bouleGeo = once(() => {
  const g = surface(48, 32, (u, v, o) => {
    const d = sphDir(u, v, D).clone();
    const s = bouleScore(d);
    const r = BOULE_R * (1 + 0.03 * fbm(d.x * 2.2, d.y * 2.2, d.z * 2.2, 1300)) + s.depth;
    const y = d.y > 0 ? d.y * 0.68 : d.y * 0.24 * (1 - 0.35 * Math.pow(-d.y, 3));
    o.set(d.x * r, y * r, d.z * r);
  });
  sit(g);
  return g;
});

// ---- Sourdough slice ---------------------------------------------------------------------------

const SL_AX = 0.06;
const SL_TOP = 0.055;
const SL_BOT = 0.045;
const SL_DEPTH = 0.018;
const SL_BEVEL = 0.002;

/** Superellipse "radius" of a slice point in shape coords (1 on the outline). */
function sliceE(sx: number, sy: number): number {
  const by = sy > 0 ? SL_TOP : SL_BOT;
  const p = sy > 0 ? 2 : 3.2;
  return Math.pow(Math.abs(sx / SL_AX) ** p + Math.abs(sy / by) ** p, 1 / p);
}

const sliceParts = once(() => {
  const shp = new THREE.Shape();
  const N = 56;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * TAU;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const r = 1 / sliceE(c, s);
    const k = 1 + 0.012 * noise3(c * 3, s * 3, 0, 1310);
    if (i === 0) shp.moveTo(c * r * k, s * r * k);
    else shp.lineTo(c * r * k, s * r * k);
  }
  shp.closePath();
  const ext = new THREE.ExtrudeGeometry(shp, { depth: SL_DEPTH, bevelEnabled: true, bevelThickness: SL_BEVEL, bevelSize: 0.0016, bevelSegments: 2, curveSegments: 4 });
  const [caps, sides] = splitByMaterial(ext);
  // Crumb faces: planar UV in shape space; crust: angle around x depth.
  const cp = caps.attributes.position;
  const cuv = new Float32Array(cp.count * 2);
  for (let i = 0; i < cp.count; i++) {
    cuv[i * 2] = (cp.getX(i) + 0.065) / 0.13;
    cuv[i * 2 + 1] = (cp.getY(i) + 0.06) / 0.12;
  }
  caps.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
  const sp = sides.attributes.position;
  const suv = new Float32Array(sp.count * 2);
  for (let i = 0; i < sp.count; i++) {
    suv[i * 2] = Math.atan2(sp.getY(i), sp.getX(i)) / TAU + 0.5;
    suv[i * 2 + 1] = (sp.getZ(i) + SL_BEVEL) / (SL_DEPTH + 2 * SL_BEVEL);
  }
  sides.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
  for (const g of [caps, sides]) {
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
  }
  const both = merge([caps, sides]);
  both.computeBoundingBox();
  const b = both.boundingBox!;
  const off = new THREE.Vector3(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  caps.translate(off.x, off.y, off.z);
  sides.translate(off.x, off.y, off.z);
  return { crumb: caps, crust: sides, top: b.max.y - b.min.y };
});

// ---- Cheese ------------------------------------------------------------------------------------

const CHEESE_R = 0.13;
const CHEESE_A = 0.62;
const CHEESE_H = 0.056;

const cheeseParts = once(() => {
  const shp = new THREE.Shape();
  shp.moveTo(0, 0);
  const segs = 6;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const a = -CHEESE_A / 2;
    shp.lineTo(Math.cos(a) * CHEESE_R * t, Math.sin(a) * CHEESE_R * t);
  }
  for (let i = 1; i <= 10; i++) {
    const a = -CHEESE_A / 2 + (CHEESE_A * i) / 10;
    shp.lineTo(Math.cos(a) * CHEESE_R, Math.sin(a) * CHEESE_R);
  }
  for (let i = segs - 1; i >= 1; i--) {
    const t = i / segs;
    const a = CHEESE_A / 2;
    shp.lineTo(Math.cos(a) * CHEESE_R * t, Math.sin(a) * CHEESE_R * t);
  }
  shp.closePath();
  const ext = new THREE.ExtrudeGeometry(shp, { depth: CHEESE_H - 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0018, bevelSegments: 2, curveSegments: 4 });
  ext.rotateX(-Math.PI / 2);
  const g = ext.index ? ext.toNonIndexed() : ext;
  sit(g);
  g.computeBoundingBox();
  const midX = (g.boundingBox!.min.x + g.boundingBox!.max.x) / 2;
  // Apex sits at the minimum x after sit(); the arc (rind) is the far end.
  const apexX = g.boundingBox!.min.x;
  const isRind = (c: THREE.Vector3, n: THREE.Vector3) => {
    if (n.y < -0.6) return true; // underside
    const dx = c.x - apexX;
    const r = Math.hypot(dx, c.z);
    const radial = Math.abs(n.x * (dx / r) + n.z * (c.z / r));
    return r > CHEESE_R * 0.9 && radial > 0.75 && Math.abs(n.y) < 0.6;
  };
  const rind = filterTris(g, isRind);
  const paste = filterTris(g, (c, n) => !isRind(c, n));
  // Paste UVs: world-space planar per face orientation, tiled every 7 cm.
  const pp = paste.attributes.position;
  const pn = new THREE.Vector3();
  paste.computeVertexNormals();
  const nrm = paste.attributes.normal;
  const uv = new Float32Array(pp.count * 2);
  for (let i = 0; i < pp.count; i++) {
    pn.fromBufferAttribute(nrm, i);
    const x = pp.getX(i);
    const y = pp.getY(i);
    const z = pp.getZ(i);
    if (Math.abs(pn.y) > 0.6) {
      uv[i * 2] = x / 0.07;
      uv[i * 2 + 1] = z / 0.07;
    } else {
      uv[i * 2] = (x * -pn.z + z * pn.x) / 0.07;
      uv[i * 2 + 1] = y / 0.07;
    }
  }
  paste.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  planarUV(rind, 'x', 'y');
  rind.computeVertexNormals();
  void midX;
  return { paste, rind };
});

/** Thin curled strips (for grated cheese), in a few variants. */
const gratedStrips = once(() => {
  const r = rng(1400);
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const L = 0.018 + r() * 0.016;
    const w = 0.0028 + r() * 0.0012;
    const curl = 0.002 + r() * 0.004;
    const twist = (r() - 0.5) * 2;
    out.push(
      surface(8, 1, (u, v, o) => {
        const a = twist * (u - 0.5);
        const z = (v - 0.5) * w;
        const y = curl * Math.sin(Math.PI * u);
        o.set((u - 0.5) * L, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a));
      }),
    );
  }
  return out;
});

/** A heap of grated cheese strips. `height(x, z)` gives the surface they rest on. */
function gratedHeap(n: number, radius: number, peak: number, seed: number, height: (x: number, z: number) => number = () => 0, scale = 1): THREE.BufferGeometry {
  const strips = scale === 1 ? gratedStrips() : gratedStrips().map((g) => g.clone().scale(scale, scale, scale));
  const r = rng(seed);
  const pieces: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + r() * 0.3;
    const d = Math.sqrt((i + 0.5) / n) * radius;
    const hump = peak * (1 - (d / radius) ** 2);
    const shade = 0.86 + r() * 0.16;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    pieces.push({
      geo: strips[i % strips.length],
      x,
      y: height(x, z) + 0.0015 + hump * (0.6 + 0.4 * r()),
      z,
      rx: (r() - 0.5) * 0.9,
      ry: r() * Math.PI,
      rz: (r() - 0.5) * 0.6,
      col: new THREE.Color(shade, shade * (0.97 + r() * 0.04), shade * 0.9),
    });
  }
  return assemble(pieces, false);
}

const gratedGeo = once(() => {
  const g = gratedHeap(120, 0.042, 0.032, 1410);
  sit(g);
  return g;
});

// ---- Puff pastry sheet --------------------------------------------------------------------------

const PASTRY = { x: 0.24, z: 0.18, y: 0.008 };

const pastryGeo = once(() => {
  const g = new THREE.BoxGeometry(PASTRY.x, PASTRY.y, PASTRY.z, 60, 1, 45);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const top = y > 0;
    // Gently wavy cut edges and a soft pillow with dimples on top.
    const ex = 0.0018 * noise3(z * 40, 0, 0, 1500);
    const ez = 0.0018 * noise3(x * 40, 0, 1, 1501);
    let ny = y;
    if (top) {
      const ux = (x / PASTRY.x + 0.5);
      const crease = Math.exp(-(((ux - 1 / 3) / 0.012) ** 2)) + Math.exp(-(((ux - 2 / 3) / 0.012) ** 2));
      const edge = smooth(0, 0.012, Math.min(PASTRY.x / 2 - Math.abs(x), PASTRY.z / 2 - Math.abs(z)));
      ny = y * (0.75 + 0.25 * edge) + 0.0009 * fbm(x * 45, z * 45, 0, 1502) - 0.0012 * crease;
    }
    p.setXYZ(i, x + (Math.abs(x) > PASTRY.x / 2 - 0.001 ? Math.sign(x) * ex : 0), ny, z + (Math.abs(z) > PASTRY.z / 2 - 0.001 ? Math.sign(z) * ez : 0));
  }
  g.computeVertexNormals();
  sit(g);
  return g;
});

// ---- Sheet pan ---------------------------------------------------------------------------------

export const TRAY_SIZE = { x: 0.45, z: 0.32, rim: 0.021 };
const TRAY_WALL = 0.018;
const TRAY_CORNER = 0.022;

/** Point on a rounded rectangle (half extents hx, hz, corner radius rc), s in 0..1 around; also outward normal. */
function roundRect(s: number, hx: number, hz: number, rc: number, out: THREE.Vector3, nrm: THREE.Vector3): void {
  const sx = hx - rc;
  const sz = hz - rc;
  const arc = (Math.PI / 2) * rc;
  const total = 4 * sx + 4 * sz + 4 * arc;
  let d = frac(s) * total;
  const segs: [number, (t: number) => void][] = [
    [2 * sz, (t) => (out.set(hx, 0, -sz + t), nrm.set(1, 0, 0))],
    [arc, (t) => { const a = t / rc; nrm.set(Math.cos(a), 0, Math.sin(a)); out.set(sx + nrm.x * rc, 0, sz + nrm.z * rc); }],
    [2 * sx, (t) => (out.set(sx - t, 0, hz), nrm.set(0, 0, 1))],
    [arc, (t) => { const a = Math.PI / 2 + t / rc; nrm.set(Math.cos(a), 0, Math.sin(a)); out.set(-sx + nrm.x * rc, 0, sz + nrm.z * rc); }],
    [2 * sz, (t) => (out.set(-hx, 0, sz - t), nrm.set(-1, 0, 0))],
    [arc, (t) => { const a = Math.PI + t / rc; nrm.set(Math.cos(a), 0, Math.sin(a)); out.set(-sx + nrm.x * rc, 0, -sz + nrm.z * rc); }],
    [2 * sx, (t) => (out.set(-sx + t, 0, -hz), nrm.set(0, 0, -1))],
    [arc, (t) => { const a = Math.PI * 1.5 + t / rc; nrm.set(Math.cos(a), 0, Math.sin(a)); out.set(sx + nrm.x * rc, 0, -sz + nrm.z * rc); }],
  ];
  for (const [len, f] of segs) {
    if (d <= len) return f(d);
    d -= len;
  }
  segs[0][1](0);
}

const trayParts = once(() => {
  const hx = TRAY_SIZE.x / 2;
  const hz = TRAY_SIZE.z / 2;
  const inBot = 0.012;
  const inTop = 0.004;
  const bead = 0.0032;
  const P = new THREE.Vector3();
  const Nn = new THREE.Vector3();
  const NU = 160;
  const wall = surface(NU, 3, (u, v, o) => {
    const ins = mix(inBot, inTop, v);
    roundRect(u, hx - ins, hz - ins, TRAY_CORNER - ins * 0.5, P, Nn);
    o.set(P.x, v * TRAY_WALL + 0.0006, P.z);
  }, (u, v) => [u * 8, v * 0.08]);
  const beadGeo = surface(NU, 8, (u, v, o) => {
    roundRect(u, hx - inTop, hz - inTop, TRAY_CORNER - inTop * 0.5, P, Nn);
    const a = TAU * v;
    o.set(P.x + Nn.x * bead * (1 + Math.cos(a)), TRAY_WALL + bead * Math.sin(a), P.z + Nn.z * bead * (1 + Math.cos(a)));
  }, (u, v) => [u * 8, v * 0.02]);
  const shp = new THREE.Shape();
  for (let i = 0; i <= NU; i++) {
    roundRect(i / NU, hx - inBot, hz - inBot, TRAY_CORNER - inBot * 0.5, P, Nn);
    if (i === 0) shp.moveTo(P.x, -P.z);
    else shp.lineTo(P.x, -P.z);
  }
  const base = new THREE.ExtrudeGeometry(shp, { depth: 0.0012, bevelEnabled: false });
  base.rotateX(-Math.PI / 2);
  const bp = base.attributes.position;
  const buv = new Float32Array(bp.count * 2);
  for (let i = 0; i < bp.count; i++) {
    buv[i * 2] = bp.getX(i) / TRAY_SIZE.x + 0.5;
    buv[i * 2 + 1] = bp.getZ(i) / TRAY_SIZE.z + 0.5;
  }
  base.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
  return { base, wall, bead: beadGeo };
});

// ---- Beef Wellington ---------------------------------------------------------------------------

const WELL_L = 0.22;
const WELL_W = 0.045;
const WELL_TOP = 0.062;
const WELL_BOT = 0.018;
const WELL_CIRC = 0.27;

/** Diagonal lattice scoring weight at (t along, w around). */
function wellLattice(t: number, w: number): number {
  const X = t * WELL_L;
  const Y = (w - 0.5) * WELL_CIRC;
  const sp = 0.026;
  const l1 = Math.abs(frac((X + Y) / sp) - 0.5) * 2;
  const l2 = Math.abs(frac((X - Y) / sp) - 0.5) * 2;
  const line = Math.max(1 - smooth(0, 0.12, 1 - l1), 1 - smooth(0, 0.12, 1 - l2));
  const top = smooth(-0.35, 0.15, -Math.cos(TAU * w));
  const ends = smooth(0.06, 0.16, Math.min(t, 1 - t));
  return line * top * ends;
}

function wellPoint(t: number, w: number, o: THREE.Vector3): THREE.Vector3 {
  const a = TAU * w;
  const ny = -Math.cos(a);
  const nz = Math.sin(a);
  const sy = Math.sign(ny) * Math.pow(Math.abs(ny), 0.8);
  const sz = Math.sign(nz) * Math.pow(Math.abs(nz), 0.8);
  const tc = Math.min(1, Math.max(0, t));
  const prof = Math.pow(Math.sin(Math.PI * tc), 0.24);
  const lump = 1 + 0.025 * fbm(t * 5, ny * 1.4, nz * 1.4, 1600) - 0.03 * wellLattice(t, w);
  const skirt = ny < -0.2 ? 1 + 0.06 * smooth(-0.2, -0.8, ny) : 1;
  return o.set((t - 0.5) * WELL_L, (sy > 0 ? sy * WELL_TOP : sy * WELL_BOT) * prof * lump, sz * WELL_W * prof * lump * skirt);
}

const wellingtonGeo = once(() => {
  const g = surface(64, 40, (u, v, o) => wellPoint(u, v, o));
  sit(g);
  return g;
});

// ---- Stuffed mushroom --------------------------------------------------------------------------

const SM_R = 0.046;
const SM_DEPTH = 0.026;
const SM_FILL_Y = SM_DEPTH - 0.004;

function stuffingHeight(x: number, z: number): number {
  const d = Math.hypot(x, z) / (SM_R * 0.92);
  if (d >= 1) return SM_FILL_Y;
  return SM_FILL_Y + 0.02 * Math.pow(1 - d * d, 0.8) * (1 + 0.12 * fbm(x * 60, z * 60, 0, 1700));
}

const stuffedParts = once(() => {
  const bowl = surface(32, 10, (u, v, o) => {
    const th = TAU * u;
    const g = v * (Math.PI / 2);
    const wob = 1 + 0.03 * noise3(Math.cos(th) * 3, Math.sin(th) * 3, 0, 1000);
    const rad = SM_R * Math.cos(g) * wob;
    o.set(rad * Math.cos(th), SM_DEPTH - SM_DEPTH * Math.pow(Math.sin(g), 0.85), -rad * Math.sin(th));
  }, (u, v) => [u, 1 - v * 0.65]);
  const lip = new THREE.TorusGeometry(SM_R * 0.985, 0.0028, 6, 40);
  lip.rotateX(Math.PI / 2);
  lip.translate(0, SM_DEPTH, 0);
  for (let i = 0; i < lip.attributes.position.count; i++) {
    const p = lip.attributes.position;
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const k = 1 + 0.03 * noise3(Math.cos(-a) * 3, Math.sin(-a) * 3, 0, 1000);
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  lip.computeVertexNormals();
  const fill = surface(28, 8, (u, v, o) => {
    const th = TAU * u;
    const rr = SM_R * 0.93 * (1 - v);
    const x = rr * Math.cos(th);
    const z = -rr * Math.sin(th);
    o.set(x, stuffingHeight(x, z), z);
  }, (u, v) => [u, v]);
  const cheese = gratedHeap(70, SM_R * 0.72, 0.005, 1710, stuffingHeight, 0.6);
  return { bowl, lip, fill, cheese };
});

// ---- Tomato slices -----------------------------------------------------------------------------

const TOM_SLICE_R = 0.027;
const TOM_SLICE_H = 0.005;

const tomatoSliceParts = once(() => {
  const face = new THREE.CircleGeometry(TOM_SLICE_R, 28);
  face.rotateX(-Math.PI / 2);
  face.translate(0, TOM_SLICE_H, 0);
  const rim = new THREE.CylinderGeometry(TOM_SLICE_R, TOM_SLICE_R * 0.97, TOM_SLICE_H, 28, 1, true);
  rim.translate(0, TOM_SLICE_H / 2, 0);
  return { face, rim };
});

// ---- Roast potato wedges -----------------------------------------------------------------------

const WEDGE_R = 0.03;
const WEDGE_A = 1.25;
const WEDGE_L = 0.066;

const wedgeGeo = once(() => {
  const shp = new THREE.Shape();
  const steps = 6;
  shp.moveTo(0, 0);
  for (let i = 1; i <= steps; i++) shp.lineTo(Math.cos(-WEDGE_A / 2) * WEDGE_R * (i / steps), Math.sin(-WEDGE_A / 2) * WEDGE_R * (i / steps));
  for (let i = 1; i <= 10; i++) {
    const a = -WEDGE_A / 2 + (WEDGE_A * i) / 10;
    shp.lineTo(Math.cos(a) * WEDGE_R, Math.sin(a) * WEDGE_R);
  }
  for (let i = steps - 1; i >= 1; i--) shp.lineTo(Math.cos(WEDGE_A / 2) * WEDGE_R * (i / steps), Math.sin(WEDGE_A / 2) * WEDGE_R * (i / steps));
  shp.closePath();
  const g = new THREE.ExtrudeGeometry(shp, { depth: WEDGE_L, steps: 14, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 4 });
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x0 = p.getX(i);
    const y0 = p.getY(i);
    const z0 = p.getZ(i);
    const t = clamp01(z0 / WEDGE_L);
    const taper = 0.55 + 0.45 * Math.pow(Math.sin(Math.PI * (0.03 + 0.94 * t)), 0.5);
    const r = Math.hypot(x0, y0);
    const a = Math.atan2(y0, x0);
    // Colour: skin on the arc, creamy flesh on the cuts, deeper golden crisp along the edges and tips.
    const skin = smooth(0.82, 0.97, r / WEDGE_R) * smooth(WEDGE_A / 2 + 0.02, WEDGE_A / 2 - 0.1, Math.abs(a));
    const edge = Math.max(
      smooth(0.75, 0.98, r / WEDGE_R) * smooth(WEDGE_A / 2 - 0.25, WEDGE_A / 2, Math.abs(a)),
      1 - smooth(0.0, 0.25, r / WEDGE_R),
      1 - smooth(0.0, 0.18, Math.min(t, 1 - t)),
    );
    const n = 0.06 * fbm(x0 * 300, y0 * 300, z0 * 120, 1800);
    let cr = 1 + n;
    let cg = 0.86 + n;
    let cb = 0.5 + n;
    cr = mix(cr, 0.84, edge);
    cg = mix(cg, 0.6, edge);
    cb = mix(cb, 0.3, edge);
    cr = mix(cr, 0.56, skin);
    cg = mix(cg, 0.37, skin);
    cb = mix(cb, 0.19, skin);
    col.set([cr, cg, cb], i * 3);
    const lumpy = 1 + 0.06 * fbm(x0 * 120, y0 * 120, z0 * 60, 1801);
    p.setXYZ(i, x0 * taper * lumpy, y0 * taper * lumpy, z0 + (1 - taper) * 0.0);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.center();
  return g;
});

const roastParts = once(() => {
  const w = wedgeGeo();
  // Wedge lies along z; rotate so a flat cut face is down-ish for each piece.
  const r = rng(1810);
  const pieces: Piece[] = [];
  const spots: [number, number, number, number][] = [
    [-0.03, 0.0, -0.02, 0.4],
    [0.028, 0.0, -0.016, -0.5],
    [-0.012, 0.0, 0.028, 1.6],
    [0.03, 0.0, 0.03, 2.4],
    [0.0, 0.02, 0.004, -0.1],
  ];
  for (const [x, y, z, ry] of spots) pieces.push({ geo: w, x, y, z, rx: (r() - 0.5) * 0.2, ry, rz: WEDGE_A / 2 + (r() - 0.5) * 0.3 });
  const potatoes = assemble(pieces);
  // Rosemary: two sprigs of needles on a twig.
  const needle = new THREE.BoxGeometry(0.0014, 0.0007, 0.011);
  needle.translate(0, 0, 0.0055);
  const twig = new THREE.CylinderGeometry(0.0007, 0.0009, 0.036, 5, 1);
  twig.rotateZ(Math.PI / 2);
  const sprig: Piece[] = [{ geo: twig, x: 0, y: 0, z: 0 }];
  for (let i = 0; i < 14; i++) {
    const x = -0.016 + (i / 13) * 0.032;
    sprig.push({ geo: needle, x, y: 0.0005, z: 0, ry: (i % 2 ? 1 : -1) * (0.9 + r() * 0.3), rx: -0.25 });
  }
  const sp = assemble(sprig, false);
  potatoes.computeBoundingBox();
  const top = potatoes.boundingBox!.max.y;
  const herbs = assemble(
    [
      { geo: sp, x: 0.004, y: top - 0.004, z: -0.002, ry: 0.5, rz: 0.08 },
      { geo: sp, x: -0.02, y: top - 0.012, z: 0.016, ry: -0.9, rz: -0.06 },
    ],
    false,
  );
  return { potatoes, herbs };
});

// ---- Textures for the bakery set ---------------------------------------------------------------

/** Tileable round holes for Swiss-style cheese. Returns hole weight and inner shading. */
function cheeseHoles(u: number, v: number): { hole: number; shade: number } {
  const N = 4;
  const cx = Math.floor(u * N);
  const cy = Math.floor(v * N);
  let hole = 0;
  let shade = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const ix = (((cx + dx) % N) + N) % N;
      const iy = (((cy + dy) % N) + N) % N;
      if (hash3(ix, iy, 0, 1900) > 0.6) continue;
      const px = (cx + dx + 0.2 + 0.6 * hash3(ix, iy, 1, 1900)) / N;
      const py = (cy + dy + 0.2 + 0.6 * hash3(ix, iy, 2, 1900)) / N;
      const rad = (0.12 + 0.2 * hash3(ix, iy, 3, 1900)) / N;
      const ddx = u - px;
      const ddy = v - py;
      const d = Math.hypot(ddx, ddy);
      const h = 1 - smooth(rad * 0.82, rad, d);
      if (h > hole) {
        hole = h;
        shade = clamp01(0.5 + 0.5 * (ddy / rad));
      }
    }
  return { hole, shade };
}

const BT = {
  boule: once(() =>
    pixelTexture(160, 96, (u, v) => {
      const d = sphDir(u, v, D);
      const s = bouleScore(d);
      const side = smooth(0.7, -0.1, d.y);
      const n = fbm(d.x * 9, d.y * 9, d.z * 9, 1950);
      let r = mix(0.52, 0.74, side) + 0.06 * n;
      let g = mix(0.28, 0.45, side) + 0.05 * n;
      let b = mix(0.12, 0.22, side) + 0.04 * n;
      // Pale floury base.
      const under = smooth(-0.1, -0.5, d.y);
      r = mix(r, 0.88, under * 0.7);
      g = mix(g, 0.76, under * 0.7);
      b = mix(b, 0.58, under * 0.7);
      // Banneton flour rings spiralling out from the crown.
      const ph = Math.acos(Math.max(-1, Math.min(1, d.y)));
      const rr = (ph / (Math.PI / 2)) * 6.5 + 0.18 * fbm(d.x * 4, d.y * 4, d.z * 4, 1951);
      const f = frac(rr);
      const ring = smooth(0.3, 0.55, f) * (1 - smooth(0.6, 0.85, f));
      const patch = smooth(-0.25, 0.35, fbm(d.x * 6, d.y * 6, d.z * 6, 1952));
      const flour = clamp01(ring * patch * smooth(-0.15, 0.2, d.y) * 0.42 + patch * 0.18 * smooth(0.0, 0.6, d.y) + (noise3(d.x * 70, d.y * 70, d.z * 70, 1953) > 0.62 ? 0.2 : 0));
      // Blisters.
      const blister = noise3(d.x * 55, d.y * 55, d.z * 55, 1954) > 0.68 ? 1 : 0;
      r -= 0.1 * blister;
      g -= 0.08 * blister;
      b -= 0.05 * blister;
      r = mix(r, 0.96, flour);
      g = mix(g, 0.93, flour);
      b = mix(b, 0.86, flour);
      // Scores: dark caramelised ears, golden torn crumb inside.
      r = mix(r, 0.42, s.lip);
      g = mix(g, 0.2, s.lip);
      b = mix(b, 0.08, s.lip);
      r = mix(r, 0.94, s.groove);
      g = mix(g, 0.74, s.groove);
      b = mix(b, 0.44, s.groove);
      return [r, g, b];
    }),
  ),
  crumb: once(() =>
    pixelTexture(96, 96, (u, v) => {
      const sx = u * 0.13 - 0.065;
      const sy = v * 0.12 - 0.06;
      const e = sliceE(sx, sy);
      const edge = (1 - e) * 0.05; // ~ metres from the crust
      const crust = 1 - smooth(0.0022, 0.0042, edge);
      const ring = (1 - smooth(0.004, 0.009, edge)) * (1 - crust);
      // Open crumb: many small, slightly tall holes (cellular), shadowed on top and lit below.
      const C = 0.0055;
      const gx = sx / C;
      const gy = sy / (C * 1.25);
      const cx = Math.floor(gx);
      const cy = Math.floor(gy);
      let hole = 0;
      let hs = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const ix = cx + dx;
          const iy = cy + dy;
          if (hash3(ix, iy, 0, 1960) > 0.75) continue;
          const big = hash3(ix, iy, 4, 1960) > 0.9 ? 1.9 : 1;
          const px = ix + 0.2 + 0.6 * hash3(ix, iy, 1, 1960);
          const py = iy + 0.2 + 0.6 * hash3(ix, iy, 2, 1960);
          const rad = (0.16 + 0.22 * hash3(ix, iy, 3, 1960)) * big;
          const ex = gx - px + 0.12 * noise3(gx * 3, gy * 3, 0, 1963);
          const ey = (gy - py) * 1.15;
          const d = Math.hypot(ex, ey);
          const h = 1 - smooth(rad * 0.8, rad, d);
          if (h > hole) {
            hole = h;
            hs = clamp01(0.5 - 0.5 * (ey / rad));
          }
        }
      hole *= smooth(0.003, 0.008, edge);
      const base = 0.95 + 0.035 * fbm(sx * 140, sy * 140, 2, 1962);
      let r = base;
      let g = base * 0.91;
      let b = base * 0.77;
      // Shadowed upper wall, lit lower wall.
      const ir = mix(0.8, 0.5, hs);
      const ig = mix(0.68, 0.38, hs);
      const ib = mix(0.5, 0.25, hs);
      r = mix(r, ir, hole);
      g = mix(g, ig, hole);
      b = mix(b, ib, hole);
      r = mix(r, 0.82, ring * 0.6);
      g = mix(g, 0.66, ring * 0.6);
      b = mix(b, 0.42, ring * 0.6);
      r = mix(r, 0.48, crust);
      g = mix(g, 0.26, crust);
      b = mix(b, 0.11, crust);
      if (e > 1.02) return [0.45, 0.24, 0.1];
      return [r, g, b];
    }),
  ),
  crust: once(() =>
    pixelTexture(128, 16, (u, v) => {
      const n = pfbm(u, v, 60, 2, 1970);
      const flour = noise3(u * 400, v * 20, 0, 1971) > 0.74 ? 0.7 : 0;
      const l = 0.95 + 0.08 * n;
      return [mix(0.56 * l, 0.92, flour * 0.6), mix(0.31 * l, 0.86, flour * 0.6), mix(0.13 * l, 0.75, flour * 0.6)];
    }),
  ),
  paste: once(() =>
    pixelTexture(64, 64, (u, v) => {
      const { hole, shade } = cheeseHoles(u, v);
      const n = 0.04 * fbm(u * 20, v * 20, 0, 1980);
      let r = 1 + n;
      let g = 0.84 + n;
      let b = 0.38 + n;
      const ir = mix(0.78, 0.98, shade);
      const ig = mix(0.55, 0.78, shade);
      const ib = mix(0.12, 0.3, shade);
      r = mix(r, ir, hole);
      g = mix(g, ig, hole);
      b = mix(b, ib, hole);
      return [r, g, b];
    }),
  ),
  rind: once(() =>
    pixelTexture(64, 32, (u, v) => {
      const n = fbm(u * 14, v * 7, 0, 1990);
      const l = 0.92 + 0.08 * n;
      return [0.9 * l, 0.62 * l, 0.2 * l];
    }),
  ),
  pastry: once(() =>
    pixelTexture(96, 72, (u, v) => {
      const n = fbm(u * 18, v * 14, 0, 2000);
      let l = 0.97 + 0.04 * n;
      const crease = Math.exp(-(((u - 1 / 3) / 0.008) ** 2)) + Math.exp(-(((u - 2 / 3) / 0.008) ** 2));
      l -= 0.08 * crease;
      const dimple = smooth(0.3, 0.6, noise3(u * 70, v * 52, 1, 2001)) * 0.09;
      l -= dimple;
      // Fork docking holes in a loose grid.
      const gx = frac(u * 14) - 0.5;
      const gy = frac(v * 10.5) - 0.5;
      const dock = 1 - smooth(0.06, 0.11, Math.hypot(gx * 1.0, gy * 1.33));
      l -= 0.22 * dock;
      const dust = smooth(0.1, 0.5, fbm(u * 6, v * 5, 2, 2002)) * (noise3(u * 300, v * 220, 3, 2003) > 0.35 ? 1 : 0.3);
      const r = mix(l, 1, dust * 0.4);
      const g = mix(l * 0.86, 0.99, dust * 0.35);
      const b = mix(l * 0.6, 0.95, dust * 0.35);
      return [r, g, b];
    }),
  ),
  wellington: once(() =>
    pixelTexture(160, 128, (t, w) => {
      const lat = wellLattice(t, w);
      const top = smooth(-0.6, 0.6, -Math.cos(TAU * w));
      const n = fbm(t * 30, w * 28, 0, 2010);
      const pool = smooth(0.05, 0.5, fbm(t * 10, w * 9, 1, 2011));
      // Egg-washed pastry: richer yellow on top, paler underneath; scores show pale layers.
      let r = mix(0.97, 1.0, top) + 0.03 * n;
      let g = mix(0.88, 0.82, top) + 0.03 * n - 0.05 * pool * top;
      let b = mix(0.68, 0.5, top) + 0.03 * n - 0.1 * pool * top;
      r = mix(r, 1.0, lat * 0.9);
      g = mix(g, 0.96, lat * 0.9);
      b = mix(b, 0.86, lat * 0.9);
      const salt = noise3(t * 420, w * 380, 2, 2012) > 0.72 ? top : 0;
      r = mix(r, 1, salt);
      g = mix(g, 1, salt);
      b = mix(b, 1, salt);
      return [r, g, b];
    }),
  ),
  tomatoSlice: once(() =>
    pixelTexture(64, 64, (u, v) => {
      const x = (u - 0.5) * 2;
      const y = (v - 0.5) * 2;
      const rr = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      const skin = smooth(0.9, 0.97, rr);
      const wall = 1 - smooth(0.78, 0.86, rr);
      // Four seed chambers separated by radial septa around a pale core.
      const sec = frac((a / TAU) * 4 + 0.08);
      const septum = 1 - smooth(0.05, 0.12, Math.min(sec, 1 - sec));
      const core = 1 - smooth(0.14, 0.24, rr);
      const chamber = wall * (1 - septum) * (1 - core) * smooth(0.2, 0.3, rr);
      const seedP = Math.hypot((sec - 0.5) * 1.6, rr - 0.52);
      const seeds = chamber * (noise3(u * 70, v * 70, 0, 2020) > 0.35 ? 1 : 0) * (1 - smooth(0.12, 0.22, seedP));
      let r = 0.95;
      let g = 0.3;
      let b = 0.24;
      // Gel: glossy, lighter orange-red.
      r = mix(r, 1.0, chamber * 0.7);
      g = mix(g, 0.52, chamber * 0.7);
      b = mix(b, 0.3, chamber * 0.7);
      r = mix(r, 1.0, core * 0.6);
      g = mix(g, 0.62, core * 0.6);
      b = mix(b, 0.5, core * 0.6);
      r = mix(r, 1.0, seeds);
      g = mix(g, 0.9, seeds);
      b = mix(b, 0.55, seeds);
      r = mix(r, 0.8, skin);
      g = mix(g, 0.12, skin);
      b = mix(b, 0.08, skin);
      const pepper = noise3(u * 160, v * 160, 4, 2021) > 0.78 ? 1 : 0;
      return [r * (1 - 0.7 * pepper), g * (1 - 0.7 * pepper), b * (1 - 0.7 * pepper)];
    }),
  ),
  tray: once(() =>
    pixelTexture(192, 140, (u, v) => {
      const brushed = 0.04 * noise3(u * 4, v * 900, 0, 2030) + 0.02 * fbm(u * 20, v * 20, 1, 2031);
      let l = 0.9 + brushed;
      // Baking stains: brown rings and patina, heavier towards the corners and edges.
      const edge = 1 - smooth(0.0, 0.12, Math.min(u, 1 - u, v, 1 - v));
      const blot = fbm(u * 5, v * 4, 2, 2032);
      const ringv = Math.abs(fbm(u * 7, v * 5, 3, 2033));
      const stain = clamp01(smooth(0.3, 0.55, blot) * 0.45 + edge * 0.35 + (1 - smooth(0.0, 0.025, ringv)) * 0.3 * smooth(0.1, 0.35, blot));
      const scratch = Math.abs(noise3(u * 30, v * 30, 5, 2034)) < 0.01 ? 0.08 : 0;
      l -= scratch;
      const r = mix(l, 0.78, stain * 0.6);
      const g = mix(l, 0.58, stain * 0.6);
      const b = mix(l * 1.02, 0.32, stain * 0.6);
      return [r, g, b];
    }),
  ),
};

// ---- Exported bakery builders ------------------------------------------------------------------

/** Doneness target colours used by the Episode 2 models (also stamped as userData.cooked). */
export const BAKE_COOKED = {
  crumb: 0xdc9f5c,
  crust: 0xb89070,
  pastry: 0xd99a4a,
  wellington: 0xc88c50,
  cheese: 0xd88e2c,
  tomato: 0xf09070,
  mushroom: 0x7a5636,
  stuffing: 0x5a4028,
  potato: 0xdca246,
} as const;

function sourdoughSlice(): THREE.Group {
  const p = sliceParts();
  return group(
    browns(bumpy(tinted(p.crumb, 0xffffff, { map: BT.crumb(), roughness: 0.9 }), 1.2), BAKE_COOKED.crumb),
    browns(bumpy(tinted(p.crust, 0xffffff, { map: BT.crust(), roughness: 0.8 }), 1), BAKE_COOKED.crust),
  );
}

/** Height of the top face of a sourdough slice (for stacking toppings). */
export function sourdoughSliceTop(): number {
  return sliceParts().top;
}

/** Half sheet pan: 0.45 x 0.32 m, ~2.1 cm rolled rim. Origin at the centre of the base, base at y = 0. */
export function buildTray(): THREE.Group {
  const p = trayParts();
  const alu = () => mat(0xd6dade, { map: BT.tray(), roughness: 0.38, metalness: 0.85, side: THREE.DoubleSide });
  const base = new THREE.Mesh(p.base, alu());
  const wall = new THREE.Mesh(p.wall, alu());
  const bead = new THREE.Mesh(p.bead, mat(0xe4e8ec, { roughness: 0.3, metalness: 0.9 }));
  for (const m of [base, wall, bead]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  return group(base, wall, bead);
}

/** Pastry-wrapped beef Wellington (~0.22 x 0.08 x 0.09 m), lattice-scored and egg-washed. */
export function buildWrappedWellington(): THREE.Group {
  const m = browns(bumpy(tinted(wellingtonGeo(), 0xffffff, { map: BT.wellington(), roughness: 0.42 }), 1.4), BAKE_COOKED.wellington);
  return group(m);
}

/** A flipped mushroom cap heaped with duxelles and grated cheese (~0.095 m across, ~0.05 m tall). */
export function buildStuffedMushroom(): THREE.Group {
  const p = stuffedParts();
  return group(
    browns(tinted(p.bowl, 0xa98560, { map: T.mushroomCap(), roughness: 0.7, side: THREE.DoubleSide }), BAKE_COOKED.mushroom),
    browns(tinted(p.lip, 0xc4a17e, { roughness: 0.75 }), BAKE_COOKED.mushroom),
    browns(tinted(p.fill, 0x8e6c4e, { map: T.mince(), roughness: 0.8 }), BAKE_COOKED.stuffing),
    browns(tinted(p.cheese, 0xf8d460, { roughness: 0.5, side: THREE.DoubleSide, vertexColors: true }), BAKE_COOKED.cheese),
  );
}

/** Open-faced tomato toast: a sourdough slice with three overlapping tomato slices. */
export function buildTomatoToast(): THREE.Group {
  const g = sourdoughSlice();
  const sl = tomatoSliceParts();
  const top = sourdoughSliceTop();
  const spots: [number, number, number][] = [
    [-0.03, 0.006, 0.4],
    [0.002, -0.006, 1.7],
    [0.032, 0.008, 3.1],
  ];
  const faces = assemble(spots.map(([x, z, ry], i) => ({ geo: sl.face, x, y: top + (i === 1 ? 0.0016 : 0), z, ry })), false);
  const rims = assemble(spots.map(([x, z, ry], i) => ({ geo: sl.rim, x, y: top + (i === 1 ? 0.0016 : 0), z, ry })), false);
  g.add(
    browns(tinted(faces, 0xffffff, { map: BT.tomatoSlice(), roughness: 0.42 }), BAKE_COOKED.tomato),
    browns(tinted(rims, 0xcc2a18, { roughness: 0.3 }), BAKE_COOKED.tomato),
  );
  return g;
}

/** A small heap of roast potato wedges with rosemary (~0.11 x 0.045 x 0.1 m). */
export function buildRoastPotatoes(): THREE.Group {
  const p = roastParts();
  return group(
    browns(tinted(p.potatoes, 0xffffff, { map: T.fries(), roughness: 0.55, vertexColors: true }), BAKE_COOKED.potato),
    fixed(p.herbs, 0x3e5a2a, { roughness: 0.7 }),
  );
}

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
  sourdough: {
    name: 'Sourdough',
    choppedName: 'Sourdough Slice',
    raw: 0xc98a4a,
    cooked: BAKE_COOKED.crumb,
    whole: () => group(browns(bumpy(tinted(bouleGeo(), 0xffffff, { map: BT.boule(), roughness: 0.85 }), 1.5), BAKE_COOKED.crust)),
    chopped: () => sourdoughSlice(),
  },
  cheese: {
    name: 'Cheese',
    choppedName: 'Grated Cheese',
    raw: 0xf2c84b,
    cooked: BAKE_COOKED.cheese,
    whole: () => {
      const p = cheeseParts();
      return group(
        browns(bumpy(tinted(p.paste, 0xffffff, { map: BT.paste(), roughness: 0.55 }), 2), BAKE_COOKED.cheese),
        browns(tinted(p.rind, 0xffffff, { map: BT.rind(), roughness: 0.45 }), BAKE_COOKED.crust),
      );
    },
    chopped: () => group(browns(tinted(gratedGeo(), 0xf4c64c, { roughness: 0.5, side: THREE.DoubleSide, vertexColors: true }), BAKE_COOKED.cheese)),
  },
  pastry: {
    name: 'Puff Pastry',
    choppedName: 'Puff Pastry',
    raw: 0xf3e2bc,
    cooked: BAKE_COOKED.pastry,
    whole: () => group(browns(bumpy(tinted(pastryGeo(), 0xffffff, { map: BT.pastry(), roughness: 0.62 }), 1.2), BAKE_COOKED.pastry)),
    chopped: () => group(browns(bumpy(tinted(pastryGeo(), 0xffffff, { map: BT.pastry(), roughness: 0.62 }), 1.2), BAKE_COOKED.pastry)),
  },
};

export const ingredientMeshFactories = Object.fromEntries(
  (Object.keys(INGREDIENTS) as IngredientKind[]).map((k) => [k, () => INGREDIENTS[k].whole()]),
) as unknown as Record<IngredientKind, () => THREE.Object3D>;
