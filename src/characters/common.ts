import * as THREE from 'three';
import { mat } from '../engine/psx';

// Shared building blocks for the character rigs: tiny canvas textures, a simple
// joint-based humanoid body, pose blending and petrification.

export type V3 = [number, number, number];

/** Seeded RNG so textures look the same every run. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function charTexture(
  w: number,
  h: number,
  paint: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  nearest = false,
): THREE.CanvasTexture {
  // Painters work in their own small pixel grid; draw them 4x larger so vector shapes come out crisp.
  const S = nearest ? 1 : 4;
  const c = document.createElement('canvas');
  c.width = w * S;
  c.height = h * S;
  const g = c.getContext('2d')!;
  g.scale(S, S);
  paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = !nearest;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const texCache = new Map<string, THREE.CanvasTexture>();
export function cachedTexture(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

/** Light grey speckled stone; with cracks when `cracked`. Meant to be multiplied by a grey material color. */
export function stoneTexture(cracked: boolean): THREE.CanvasTexture {
  return cachedTexture(cracked ? 'stone-cracked' : 'stone', () =>
    charTexture(64, 64, (g, w, h) => {
      const r = rng(cracked ? 91 : 17);
      g.fillStyle = '#e4e2dc';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const v = 190 + Math.floor(r() * 60);
        g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
        g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1 + Math.floor(r() * 2), 1);
      }
      for (let i = 0; i < 70; i++) {
        g.fillStyle = 'rgba(90,88,84,0.6)';
        g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1, 1);
      }
      if (!cracked) return;
      for (let c = 0; c < 7; c++) {
        let x = r() * w;
        let y = r() * h;
        let a = r() * Math.PI * 2;
        const len = 14 + r() * 30;
        for (let s = 0; s < len; s++) {
          g.fillStyle = 'rgba(255,255,255,0.8)';
          g.fillRect(Math.floor(x) + 1, Math.floor(y) + 1, 1, 1);
          g.fillStyle = '#2a2826';
          g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
          a += (r() - 0.5) * 0.9;
          x = (x + Math.cos(a) + w) % w;
          y = (y + Math.sin(a) + h) % h;
          if (r() < 0.06) {
            // small branch
            let bx = x;
            let by = y;
            const ba = a + (r() < 0.5 ? 1 : -1) * (0.6 + r());
            for (let k = 0; k < 6; k++) {
              g.fillStyle = '#3a3734';
              g.fillRect(Math.floor(bx), Math.floor(by), 1, 1);
              bx = (bx + Math.cos(ba) + w) % w;
              by = (by + Math.sin(ba) + h) % h;
            }
          }
        }
      }
    }),
  );
}

export const STONE_COLOR = new THREE.Color(0x8e8b85);

type ColorMat = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;

interface StoneEntry {
  m: ColorMat;
  color: THREE.Color;
  map: THREE.Texture | null;
  emissive: THREE.Color | null;
}

/** Lerps a set of materials toward grey stone. */
export class Petrifier {
  private entries: StoneEntry[] = [];
  value = 0;

  add(m: THREE.Material): void {
    if (!(m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshBasicMaterial)) return;
    if (this.entries.some((e) => e.m === m)) return;
    this.entries.push({
      m,
      color: m.color.clone(),
      map: m.map,
      emissive: m instanceof THREE.MeshStandardMaterial ? m.emissive.clone() : null,
    });
  }

  addTree(root: THREE.Object3D, skip?: (o: THREE.Object3D) => boolean): void {
    root.traverse((o) => {
      if (skip && skip(o)) return;
      const mm = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mm) return;
      if (Array.isArray(mm)) mm.forEach((x) => this.add(x));
      else this.add(mm);
    });
  }

  /** Re-read the "original" colors (call after tinting materials yourself while not petrified). */
  refreshColors(): void {
    for (const e of this.entries) {
      e.color.copy(e.m.color);
    }
  }

  set(v: number): void {
    v = THREE.MathUtils.clamp(v, 0, 1);
    this.value = v;
    for (const e of this.entries) applyStone(e, v, v);
  }
}

function applyStone(e: StoneEntry, v: number, crackV: number): void {
  e.m.color.copy(e.color).lerp(STONE_COLOR, v);
  if (e.emissive && e.m instanceof THREE.MeshStandardMaterial) e.m.emissive.copy(e.emissive).multiplyScalar(1 - v);
  const want = v < 0.5 ? e.map : crackV >= 0.98 ? stoneTexture(true) : stoneTexture(false);
  if (e.m.map !== want) {
    if (!e.m.map !== !want) e.m.needsUpdate = true;
    e.m.map = want;
  }
}

/** Per-segment petrification: each entry has its own threshold d (0 = petrifies first). */
export class CreepingStone {
  private entries: (StoneEntry & { d: number })[] = [];
  add(m: THREE.Material, d: number): void {
    if (!(m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshBasicMaterial)) return;
    this.entries.push({
      m,
      d,
      color: m.color.clone(),
      map: m.map,
      emissive: m instanceof THREE.MeshStandardMaterial ? m.emissive.clone() : null,
    });
  }
  set(v: number): void {
    v = THREE.MathUtils.clamp(v, 0, 1);
    for (const e of this.entries) {
      const a = THREE.MathUtils.smoothstep((v * 1.3 - e.d) / 0.3, 0, 1);
      applyStone(e, a, a >= 0.97 && v > 0.6 ? 1 : 0);
    }
  }
}

export function damp(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

// ---------------------------------------------------------------------------------------------
// Humanoid body

export type JointName =
  | 'spine'
  | 'neck'
  | 'head'
  | 'shoulderL'
  | 'shoulderR'
  | 'elbowL'
  | 'elbowR'
  | 'wristL'
  | 'wristR'
  | 'hipL'
  | 'hipR'
  | 'kneeL'
  | 'kneeR';

export const JOINT_NAMES: JointName[] = [
  'spine',
  'neck',
  'head',
  'shoulderL',
  'shoulderR',
  'elbowL',
  'elbowR',
  'wristL',
  'wristR',
  'hipL',
  'hipR',
  'kneeL',
  'kneeR',
];

export type JointPose = Partial<Record<JointName, V3>>;

export interface BodySpec {
  hipHeight: number;
  hipHalfWidth: number;
  legRadius: number;
  torsoLength: number;
  waistHalfWidth: number;
  chestHalfWidth: number;
  /** z/x ratio of the torso cross-section. */
  torsoDepth: number;
  shoulderHalfWidth: number;
  upperArm: number;
  foreArm: number;
  armRadius: number;
  neckLength: number;
  neckRadius: number;
  footLength: number;
  shirt: THREE.Material;
  sleeve: THREE.Material;
  pants: THREE.Material;
  shoe: THREE.Material;
  skin: THREE.Material;
  /** Builds the hand mesh hanging below the wrist; default is a mitten box. */
  makeHand?: (side: 1 | -1) => THREE.Object3D;
  handSize?: number;
}

export interface Body {
  root: THREE.Group;
  /** Pelvis group at hip height; move its y for bobbing/crouching. */
  hips: THREE.Group;
  joints: Record<JointName, THREE.Group>;
  /** Attach points at the centre of each hand. */
  handL: THREE.Object3D;
  handR: THREE.Object3D;
  /** z of the torso front surface at height y (spine local). */
  torsoFrontZ(y: number): number;
  hipHeight: number;
}

const OCT = Math.cos(Math.PI / 8);

/** Octagonal tapered prism with a flat face toward +Z, base at y=0. */
export function octPrism(rTop: number, rBottom: number, h: number, depth = 1): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop / OCT, rBottom / OCT, h, 8, 1);
  g.rotateY(Math.PI / 8);
  g.translate(0, h / 2, 0);
  g.scale(1, 1, depth);
  return g;
}

export function limb(rTop: number, rBottom: number, len: number, seg = 6): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg, 1);
  g.translate(0, -len / 2, 0);
  return g;
}

export function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export function addMesh(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  m: THREE.Material | THREE.Material[],
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.position.set(x, y, z);
  parent.add(me);
  return me;
}

export function buildBody(s: BodySpec): Body {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = s.hipHeight;
  root.add(hips);

  const J = {} as Record<JointName, THREE.Group>;
  for (const n of JOINT_NAMES) J[n] = new THREE.Group();

  // pelvis
  addMesh(hips, octPrism(s.waistHalfWidth, s.waistHalfWidth * 0.92, 0.16, s.torsoDepth), s.pants, 0, -0.12, 0);

  // torso
  const spine = J.spine;
  hips.add(spine);
  addMesh(spine, octPrism(s.chestHalfWidth, s.waistHalfWidth, s.torsoLength, s.torsoDepth), s.shirt);
  // shoulder yoke for a rounder top
  addMesh(
    spine,
    octPrism(s.chestHalfWidth * 0.55, s.chestHalfWidth * 0.98, 0.06, s.torsoDepth * 0.95),
    s.shirt,
    0,
    s.torsoLength,
    0,
  );

  // neck & head
  J.neck.position.set(0, s.torsoLength + 0.02, -0.01);
  spine.add(J.neck);
  addMesh(J.neck, limb(s.neckRadius, s.neckRadius * 1.08, s.neckLength + 0.06, 7), s.skin, 0, s.neckLength + 0.02, 0);
  J.head.position.y = s.neckLength;
  J.neck.add(J.head);

  // arms
  const hand: Record<string, THREE.Object3D> = {};
  for (const side of [1, -1] as const) {
    const L = side === 1;
    const sh = L ? J.shoulderL : J.shoulderR;
    const el = L ? J.elbowL : J.elbowR;
    const wr = L ? J.wristL : J.wristR;
    sh.position.set(side * s.shoulderHalfWidth, s.torsoLength - s.armRadius * 0.9, 0);
    spine.add(sh);
    addMesh(sh, new THREE.IcosahedronGeometry(s.armRadius * 1.35, 0), s.sleeve);
    addMesh(sh, limb(s.armRadius * 1.1, s.armRadius * 0.95, s.upperArm), s.sleeve);
    el.position.y = -s.upperArm;
    sh.add(el);
    addMesh(el, limb(s.armRadius * 0.95, s.armRadius * 0.85, s.foreArm), s.sleeve);
    wr.position.y = -s.foreArm;
    el.add(wr);
    const hs = s.handSize ?? s.armRadius * 1.6;
    if (s.makeHand) wr.add(s.makeHand(side));
    else addMesh(wr, box(hs * 0.7, hs * 1.15, hs, 0, -hs * 0.55, 0.005), s.skin);
    const hp = new THREE.Object3D();
    hp.position.set(0, -hs * 0.6, 0);
    wr.add(hp);
    hand[L ? 'L' : 'R'] = hp;
  }

  // legs
  const legSeg = (s.hipHeight - 0.075) / 2;
  for (const side of [1, -1] as const) {
    const L = side === 1;
    const hp = L ? J.hipL : J.hipR;
    const kn = L ? J.kneeL : J.kneeR;
    hp.position.set(side * s.hipHalfWidth, 0, 0);
    hips.add(hp);
    addMesh(hp, limb(s.legRadius * 1.15, s.legRadius * 0.95, legSeg + 0.02), s.pants);
    kn.position.y = -legSeg;
    hp.add(kn);
    addMesh(kn, limb(s.legRadius * 0.95, s.legRadius * 0.8, legSeg), s.pants);
    const fw = s.legRadius * 2.1;
    addMesh(kn, box(fw, 0.08, s.footLength, 0, -legSeg - 0.035, s.footLength * 0.28), s.shoe);
  }

  const depth = s.torsoDepth;
  return {
    root,
    hips,
    joints: J,
    handL: hand.L,
    handR: hand.R,
    hipHeight: s.hipHeight,
    torsoFrontZ(y: number) {
      const t = THREE.MathUtils.clamp(y / s.torsoLength, 0, 1);
      return (s.waistHalfWidth + (s.chestHalfWidth - s.waistHalfWidth) * t) * depth;
    },
  };
}

/** Smoothly blends joint rotations toward target poses. */
export class PoseBlender {
  private cur: Record<JointName, THREE.Vector3>;
  constructor(private joints: Record<JointName, THREE.Group>) {
    this.cur = {} as Record<JointName, THREE.Vector3>;
    for (const n of JOINT_NAMES) this.cur[n] = new THREE.Vector3();
  }
  apply(target: JointPose, rate: number, dt: number): void {
    const k = 1 - Math.exp(-rate * dt);
    for (const n of JOINT_NAMES) {
      const t = target[n];
      const c = this.cur[n];
      const tx = t ? t[0] : 0;
      const ty = t ? t[1] : 0;
      const tz = t ? t[2] : 0;
      c.x += (tx - c.x) * k;
      c.y += (ty - c.y) * k;
      c.z += (tz - c.z) * k;
      this.joints[n].rotation.set(c.x, c.y, c.z);
    }
  }
  snap(target: JointPose): void {
    this.apply(target, 1e6, 1);
  }
}

/** Standard gait used by all walkers. phase in radians. */
export function gaitPose(p: number, amp = 1): JointPose {
  const s = Math.sin(p);
  const kneeL = Math.max(0, -Math.sin(p + 0.9)) * 0.9 * amp + 0.08;
  const kneeR = Math.max(0, Math.sin(p + 0.9)) * 0.9 * amp + 0.08;
  return {
    spine: [0.05, 0.08 * s * amp, 0],
    neck: [0, -0.04 * s * amp, 0],
    hipL: [-0.5 * s * amp, 0, 0],
    hipR: [0.5 * s * amp, 0, 0],
    kneeL: [kneeL, 0, 0],
    kneeR: [kneeR, 0, 0],
    shoulderL: [0.45 * s * amp, 0, 0.08],
    shoulderR: [-0.45 * s * amp, 0, -0.08],
    elbowL: [-0.35 - 0.2 * Math.max(0, -s) * amp, 0, 0],
    elbowR: [-0.35 - 0.2 * Math.max(0, s) * amp, 0, 0],
  };
}

export function skinMat(color: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshStandardMaterial {
  return mat(color, { map: map ?? null });
}
