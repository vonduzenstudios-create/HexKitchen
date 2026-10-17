import * as THREE from 'three';
import { basic, mat } from '../engine/psx';
import {
  type JointPose,
  PoseBlender,
  addMesh,
  box,
  buildBody,
  cachedTexture,
  charTexture,
  damp,
  gaitPose,
  rng,
} from './common';

// Gorgon Ramsey: a caricatured celebrity chef with a crown of golden snakes for hair.
// Local forward is +Z, origin at the feet, ~1.95 m tall (snakes poke a little above).

export type GorgonPose = 'idle' | 'walk' | 'point' | 'slam' | 'gaze' | 'stunned' | 'taste' | 'armsCrossed' | 'laugh' | 'yell';

export interface GorgonUpdate {
  pose: GorgonPose;
  speed?: number;
  talking?: boolean;
  lookAt?: THREE.Vector3 | null;
}

export interface GorgonRig {
  root: THREE.Group;
  head: THREE.Object3D;
  eyeWorldPosition(target: THREE.Vector3): THREE.Vector3;
  setEyeGlow(v: number): void;
  setAnger(v: number): void;
  update(dt: number, u: GorgonUpdate): void;
  handWorldPosition(side: 'left' | 'right', target: THREE.Vector3): THREE.Vector3;
  /** Optional extras. */
  /** Additive cone of light projected from the eyes (visible while glowing). */
  glowCone?: THREE.Mesh;
  /** Attach points at the centre of each fist (children of the wrists). */
  handLeft?: THREE.Object3D;
  handRight?: THREE.Object3D;
}

const SKIN = new THREE.Color(0xd88c5e);
const SKIN_ANGRY = new THREE.Color(0xd5442e);
const EYE_NORMAL = new THREE.Color(0xe6dfcf);
const EYE_GLOW = new THREE.Color(0xd8ff3a);
const EYE_OFF = new THREE.Color(0x4a4038);

// ---------------------------------------------------------------- textures

function faceTexture(): THREE.CanvasTexture {
  // Front of the cranium: x -0.125..0.125 -> u, y 0.10..0.32 -> v.
  return cachedTexture('gorgon-face', () =>
    charTexture(64, 64, (g) => {
      g.fillStyle = '#ece4dc';
      g.fillRect(0, 0, 64, 64);
      const dark = '#6a2f22';
      const line = (pts: [number, number][], w: number, col: string) => {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.stroke();
      };
      // forehead creases (dark groove with highlight above)
      for (const [y, x0, x1] of [
        [10, 12, 52],
        [16.5, 9, 55],
        [23, 13, 51],
      ] as [number, number, number][]) {
        const pts: [number, number][] = [];
        for (let x = x0; x <= x1; x += 4) pts.push([x, y + Math.sin(x * 0.35) * 0.9 + (Math.abs(x - 32) < 8 ? 1 : 0)]);
        line(
          pts.map(([a, b]) => [a, b - 2] as [number, number]),
          1,
          '#ffffff',
        );
        line(pts, 2, dark);
      }
      // frown "11" lines between the brows
      line(
        [
          [29, 26],
          [30, 34],
        ],
        1.5,
        dark,
      );
      line(
        [
          [35, 26],
          [34, 34],
        ],
        1.5,
        dark,
      );
      // crow's feet
      for (const sx of [-1, 1]) {
        const cx = 32 + sx * 23;
        line(
          [
            [cx, 37],
            [cx + sx * 6, 33],
          ],
          1,
          dark,
        );
        line(
          [
            [cx, 38],
            [cx + sx * 7, 38],
          ],
          1,
          dark,
        );
        line(
          [
            [cx, 39],
            [cx + sx * 6, 43],
          ],
          1,
          dark,
        );
        // under-eye bags
        line(
          [
            [32 + sx * 6, 42],
            [32 + sx * 12, 44],
            [32 + sx * 19, 42],
          ],
          1,
          '#8a4632',
        );
        // nasolabial folds
        line(
          [
            [32 + sx * 9, 51],
            [32 + sx * 13, 58],
            [32 + sx * 15, 64],
          ],
          2,
          dark,
        );
      }
    }),
  );
}

function jawTexture(): THREE.CanvasTexture {
  return cachedTexture('gorgon-jaw', () =>
    charTexture(32, 32, (g) => {
      g.fillStyle = '#ece4dc';
      g.fillRect(0, 0, 32, 32);
      const r = rng(5);
      for (let i = 0; i < 70; i++) {
        g.fillStyle = r() < 0.5 ? '#dcc0a0' : '#d0ae8a';
        g.fillRect(Math.floor(r() * 32), 6 + Math.floor(r() * 26), 1, 1);
      }
      // frown lines at the mouth corners
      g.fillStyle = '#7a3a2a';
      g.fillRect(5, 3, 1, 6);
      g.fillRect(26, 3, 1, 6);
    }),
  );
}

function snakeTexture(): THREE.CanvasTexture {
  return cachedTexture('gorgon-snake', () =>
    charTexture(32, 32, (g) => {
      g.fillStyle = '#fff4c0';
      g.fillRect(0, 0, 32, 32);
      // diamond scale bands
      for (let y = 0; y < 32; y += 8) {
        for (let x = 0; x < 32; x += 8) {
          g.fillStyle = '#d89a28';
          g.beginPath();
          g.moveTo(x + 4, y);
          g.lineTo(x + 8, y + 4);
          g.lineTo(x + 4, y + 8);
          g.lineTo(x, y + 4);
          g.closePath();
          g.fill();
          g.fillStyle = '#ffe070';
          g.fillRect(x + 3, y + 3, 2, 2);
        }
      }
      // pale belly stripe
      g.fillStyle = '#fff6d0';
      g.fillRect(0, 0, 32, 4);
    }),
  );
}

function haloTexture(): THREE.CanvasTexture {
  return cachedTexture('gorgon-halo', () =>
    charTexture(
      16,
      16,
      (g) => {
        const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.35, 'rgba(255,255,200,0.6)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 16, 16);
      },
      true,
    ),
  );
}

// ---------------------------------------------------------------- snakes

interface Snake {
  root: THREE.Group;
  segs: THREE.Group[];
  axis: THREE.Vector3;
  phase: number;
  tongue: THREE.Group;
  tonguePhase: number;
}

const SNAKE_SEGS = 6;
const SEG_LEN = 0.038;

function buildSnake(parent: THREE.Object3D, pos: THREE.Vector3, dir: THREE.Vector3, snakeMat: THREE.Material, eyeMat: THREE.Material, tongueMat: THREE.Material, phase: number): Snake {
  const root = new THREE.Group();
  root.position.copy(pos);
  root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  parent.add(root);

  const segs: THREE.Group[] = [];
  let p: THREE.Object3D = root;
  for (let i = 0; i < SNAKE_SEGS; i++) {
    const s = new THREE.Group();
    if (i > 0) s.position.y = SEG_LEN;
    p.add(s);
    const r0 = 0.024 - i * 0.0022;
    const r1 = 0.024 - (i + 1) * 0.0022;
    const g = new THREE.CylinderGeometry(r1, r0, SEG_LEN + 0.008, 5, 1);
    g.translate(0, SEG_LEN / 2, 0);
    addMesh(s, g, snakeMat);
    segs.push(s);
    p = s;
  }
  // head: flat wedge pointing along +Y, top facing +Z
  const head = new THREE.Group();
  head.position.y = SEG_LEN;
  p.add(head);
  const hg = new THREE.BoxGeometry(0.042, 0.055, 0.024);
  const pa = hg.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) {
    if (pa.getY(i) > 0) {
      pa.setX(i, pa.getX(i) * 0.55);
      pa.setZ(i, pa.getZ(i) * 0.7);
    }
  }
  hg.translate(0, 0.024, 0.004);
  addMesh(head, hg, snakeMat);
  for (const sx of [-1, 1]) addMesh(head, box(0.008, 0.008, 0.008, sx * 0.016, 0.03, 0.011), eyeMat);
  const tongue = new THREE.Group();
  tongue.position.y = 0.05;
  head.add(tongue);
  addMesh(tongue, box(0.005, 0.04, 0.003, 0, 0.02, 0), tongueMat);
  for (const sx of [-1, 1]) {
    const f = addMesh(tongue, box(0.004, 0.016, 0.003, 0, 0.007, 0), tongueMat, sx * 0.003, 0.04, 0);
    f.rotation.z = -sx * 0.45;
  }
  tongue.scale.setScalar(0.001);

  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion.clone().invert());
  const axis = new THREE.Vector3(0, 1, 0).cross(fwd);
  if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0);
  axis.normalize();
  return { root, segs, axis, phase, tongue, tonguePhase: phase * 3.7 };
}

// ---------------------------------------------------------------- build

export function buildGorgon(): GorgonRig {
  const skinMain = mat(SKIN);
  const skinFace = mat(SKIN, { map: faceTexture() });
  const skinJaw = mat(SKIN, { map: jawTexture() });
  const skinMats = [skinMain, skinFace, skinJaw];
  const white = mat(0xf4f1ea);
  const whiteShade = mat(0xd8d4cc);
  const black = mat(0x18181c);
  const trousers = mat(0x1d1d24);
  const shoe = mat(0x0c0c0e);
  const apron = mat(0x16182a);
  const brow = mat(0x8a5a22);
  const lipDark = mat(0x3a1210);
  const mouthIn = mat(0x4a0e0c);
  const teeth = mat(0xf0ead8);
  const shadow = mat(0x6a3424);
  const hairCap = mat(0xd9a628);
  const snakeMat = mat(0xffd040, { map: snakeTexture() });
  const snakeEye = basic(0x000000);
  const tongueMat = basic(0xe0202a);
  const eyeMat = basic(EYE_NORMAL.clone());
  const pupilMat = basic(0x22324a);

  const makeHand = (side: 1 | -1): THREE.Object3D => {
    const g = new THREE.Group();
    addMesh(g, box(0.075, 0.1, 0.095, 0, -0.06, 0.005), skinMain);
    // knuckle ridge
    addMesh(g, box(0.08, 0.03, 0.03, 0, -0.085, 0.04), skinMain);
    // thumb
    addMesh(g, box(0.025, 0.05, 0.03, -side * 0.035, -0.05, 0.05), skinMain);
    // index finger (scaled out for pointing)
    const finger = new THREE.Group();
    finger.position.set(0, -0.1, 0.035);
    finger.name = 'finger';
    addMesh(finger, box(0.024, 0.085, 0.024, 0, -0.04, 0), skinMain);
    finger.scale.set(1, 0.01, 1);
    g.add(finger);
    // cuff
    addMesh(g, new THREE.CylinderGeometry(0.068, 0.068, 0.05, 7), white, 0, 0.0, 0);
    return g;
  };

  const body = buildBody({
    hipHeight: 0.96,
    hipHalfWidth: 0.105,
    legRadius: 0.078,
    torsoLength: 0.56,
    waistHalfWidth: 0.2,
    chestHalfWidth: 0.27,
    torsoDepth: 0.66,
    shoulderHalfWidth: 0.3,
    upperArm: 0.3,
    foreArm: 0.27,
    armRadius: 0.064,
    neckLength: 0.06,
    neckRadius: 0.078,
    footLength: 0.27,
    shirt: white,
    sleeve: white,
    pants: trousers,
    shoe,
    skin: skinMain,
    makeHand,
  });
  const J = body.joints;
  const root = body.root;
  root.name = 'GorgonRamsey';
  const spine = J.spine;
  const fingerL = J.wristL.getObjectByName('finger')!;
  const fingerR = J.wristR.getObjectByName('finger')!;

  // ---- chef jacket details
  const T = 0.56;
  const fz = (y: number) => body.torsoFrontZ(y);
  // overlapping front flap (double breasted) slightly proud of the torso, offset to his left
  {
    const flap = new THREE.Shape();
    flap.moveTo(-0.13, 0.02);
    flap.lineTo(0.15, 0.02);
    flap.lineTo(0.17, T - 0.02);
    flap.lineTo(-0.05, T - 0.02);
    flap.lineTo(-0.12, T - 0.12);
    flap.closePath();
    const g = new THREE.ShapeGeometry(flap);
    // bend to follow the torso taper: push vertices out to the front surface
    const pa = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) pa.setZ(i, fz(pa.getY(i)) + 0.006);
    g.computeVertexNormals();
    addMesh(spine, g, white);
    // seam line along the flap edge
    const seam = addMesh(spine, box(0.008, 0.11, 0.004), whiteShade, -0.085, T - 0.07, fz(T - 0.07) + 0.009);
    seam.rotation.z = -0.65;
    addMesh(spine, box(0.008, 0.42, 0.004), whiteShade, -0.125, 0.23, fz(0.23) + 0.009);
  }
  // two columns of buttons
  for (let i = 0; i < 4; i++) {
    const y = 0.12 + i * 0.105;
    for (const x of [-0.085, 0.085]) addMesh(spine, box(0.026, 0.026, 0.014), black, x, y, fz(y) + 0.012);
  }
  // mandarin collar
  addMesh(spine, new THREE.CylinderGeometry(0.1, 0.112, 0.07, 8), white, 0, T + 0.05, -0.005);
  addMesh(spine, box(0.03, 0.05, 0.01), whiteShade, 0, T + 0.04, 0.095);
  // apron: waist band + skirt on the hips
  addMesh(body.hips, box(0.44, 0.05, 0.28, 0, 0.03, 0), apron);
  {
    const ap = new THREE.Group();
    ap.position.set(0, 0.0, 0.0);
    body.hips.add(ap);
    const g = new THREE.CylinderGeometry(0.235, 0.27, 0.44, 8, 1, true, -Math.PI * 0.62, Math.PI * 1.24);
    g.scale(1, 1, 0.66);
    g.translate(0, -0.22, 0.01);
    addMesh(ap, g, apron);
    // tie dangling at the side
    addMesh(ap, box(0.03, 0.14, 0.02, 0.2, -0.05, 0.12), apron);
  }

  // ---- head
  const head = J.head;
  const hc = new THREE.Group(); // head content, chin at y=0
  hc.position.set(0, -0.045, 0.03);
  head.add(hc);

  const side6 = (front: THREE.Material) => [skinMain, skinMain, skinMain, skinMain, front, skinMain];
  // cranium
  {
    const cg = new THREE.BoxGeometry(0.25, 0.22, 0.27);
    const pa = cg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      if (pa.getZ(i) < 0) pa.setX(i, pa.getX(i) * 0.86);
    }
    addMesh(hc, cg, side6(skinFace), 0, 0.21, 0);
  }
  // temples/back rounding
  addMesh(hc, box(0.22, 0.2, 0.05), skinMain, 0, 0.21, -0.15);
  // short golden hair base under the snakes
  addMesh(hc, box(0.262, 0.035, 0.29), hairCap, 0, 0.322, -0.005);
  addMesh(hc, box(0.27, 0.07, 0.2), hairCap, 0, 0.29, -0.06);

  // brow ridge halves + eyebrows (pivot at inner end so the scowl reads as a V)
  const browL = new THREE.Group();
  const browR = new THREE.Group();
  for (const [g, sx] of [
    [browL, 1],
    [browR, -1],
  ] as [THREE.Group, number][]) {
    g.position.set(sx * 0.012, 0.207, 0.135);
    hc.add(g);
    addMesh(g, box(0.112, 0.034, 0.04, sx * 0.058, 0.0, 0.004), skinMain);
    addMesh(g, box(0.104, 0.02, 0.014, sx * 0.058, 0.008, 0.028), brow);
  }
  // forehead crease ridges
  for (const [y, w] of [
    [0.288, 0.15],
    [0.266, 0.18],
    [0.244, 0.15],
  ] as [number, number][]) {
    for (const sx of [-1, 1]) {
      const r = addMesh(hc, box(w / 2, 0.008, 0.012), skinMain, (sx * w) / 4, y, 0.137);
      r.rotation.z = sx * 0.06;
    }
  }
  // eye sockets, eyes, pupils
  const eyes: THREE.Mesh[] = [];
  const pupils: THREE.Mesh[] = [];
  const eyeGroups: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const eg = new THREE.Group();
    eg.position.set(sx * 0.058, 0.186, 0.135);
    eg.rotation.z = sx * 0.12;
    hc.add(eg);
    addMesh(eg, box(0.07, 0.034, 0.006), shadow, 0, 0, 0.001);
    const e = addMesh(eg, box(0.05, 0.014, 0.006), eyeMat, 0, -0.001, 0.004);
    const p = addMesh(eg, box(0.014, 0.014, 0.006), pupilMat, -sx * 0.004, -0.001, 0.006);
    eyes.push(e);
    pupils.push(p);
    eyeGroups.push(eg);
    // squinting cheek / lower lid bulge
    const ch = addMesh(hc, box(0.07, 0.03, 0.03), skinMain, sx * 0.068, 0.158, 0.128);
    ch.rotation.z = -sx * 0.25;
    // ears
    addMesh(hc, box(0.03, 0.075, 0.05), skinMain, sx * 0.135, 0.185, -0.015);
  }
  // nose: bridge, bulb, wings
  const bridge = addMesh(hc, box(0.032, 0.08, 0.04), skinMain, 0, 0.172, 0.148);
  bridge.rotation.x = -0.35;
  const bulb = addMesh(hc, new THREE.DodecahedronGeometry(0.027), skinMain, 0, 0.138, 0.17);
  bulb.scale.set(1.15, 0.9, 1.0);
  for (const sx of [-1, 1]) addMesh(hc, box(0.024, 0.024, 0.032), skinMain, sx * 0.027, 0.13, 0.15);
  addMesh(hc, box(0.05, 0.008, 0.01), shadow, 0, 0.117, 0.16);
  // mouth interior & upper teeth (revealed when the jaw drops)
  addMesh(hc, box(0.13, 0.06, 0.07), mouthIn, 0, 0.085, 0.085);
  addMesh(hc, box(0.085, 0.016, 0.012), teeth, 0, 0.098, 0.124);
  // upper lip
  addMesh(hc, box(0.1, 0.014, 0.02), skinMain, 0, 0.108, 0.135);

  // jaw (hinged near the ears)
  const jaw = new THREE.Group();
  jaw.position.set(0, 0.12, -0.03);
  hc.add(jaw);
  {
    const jg = new THREE.BoxGeometry(0.24, 0.105, 0.225);
    const pa = jg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      const z = pa.getZ(i);
      if (y < 0 && z < 0) pa.setY(i, y + 0.05); // slanted jawline toward the ears
      if (y < 0 && z > 0) pa.setX(i, pa.getX(i) * 0.86); // squared chin
    }
    jg.translate(0, 0.0525 - 0.12, 0.0225 + 0.03);
    addMesh(jaw, jg, side6(skinJaw));
    // chin with cleft
    for (const sx of [-1, 1]) addMesh(jaw, box(0.046, 0.042, 0.024), skinMain, sx * 0.027, 0.028 - 0.12, 0.137 + 0.03);
    addMesh(jaw, box(0.008, 0.04, 0.012), shadow, 0, 0.03 - 0.12, 0.142 + 0.03);
    // lower teeth, lips, downturned mouth corners
    addMesh(jaw, box(0.075, 0.014, 0.012), teeth, 0, 0.094 - 0.12, 0.118 + 0.03);
    addMesh(jaw, box(0.092, 0.012, 0.012), lipDark, 0, 0.1 - 0.12, 0.13 + 0.03);
    for (const sx of [-1, 1]) {
      const c = addMesh(jaw, box(0.028, 0.009, 0.012), lipDark, sx * 0.052, 0.093 - 0.12, 0.129 + 0.03);
      c.rotation.z = sx * 0.7;
    }
  }

  // eye midpoint marker
  const eyeMid = new THREE.Object3D();
  eyeMid.position.set(0, 0.186, 0.15);
  hc.add(eyeMid);

  // halos
  const haloMat = new THREE.SpriteMaterial({
    map: haloTexture(),
    color: EYE_GLOW,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const halos: THREE.Sprite[] = [];
  for (const sx of [-1, 1]) {
    const s = new THREE.Sprite(haloMat);
    s.position.set(sx * 0.058, 0.186, 0.16);
    s.scale.setScalar(0.001);
    s.visible = false;
    hc.add(s);
    halos.push(s);
  }
  // glow cone (vertex-colored, additive, fades along its length)
  const coneLen = 3;
  const cg = new THREE.ConeGeometry(0.5, coneLen, 10, 1, true);
  {
    const pa = cg.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const a = pa.getY(i) > 0 ? 1 : 0;
      col[i * 3] = 0.85 * a;
      col[i * 3 + 1] = 1.0 * a;
      col[i * 3 + 2] = 0.25 * a;
    }
    cg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    cg.rotateX(-Math.PI / 2);
    cg.translate(0, 0, coneLen / 2);
  }
  const coneMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const glowCone = new THREE.Mesh(cg, coneMat);
  glowCone.position.copy(eyeMid.position);
  glowCone.visible = false;
  glowCone.renderOrder = 5;
  hc.add(glowCone);

  // snakes
  const snakeDefs: [number, number, number, number, number, number][] = [
    // pos x,y,z           dir x,y,z
    [-0.075, 0.33, 0.115, -0.25, 1, 0.7],
    [0.0, 0.335, 0.125, 0.0, 1, 0.8],
    [0.075, 0.33, 0.115, 0.25, 1, 0.7],
    [-0.065, 0.34, 0.01, -0.45, 1, 0.15],
    [0.065, 0.34, 0.01, 0.45, 1, 0.15],
    [0.0, 0.34, -0.07, 0, 1, -0.4],
    [-0.125, 0.3, 0.06, -1, 0.7, 0.35],
    [0.125, 0.3, 0.06, 1, 0.7, 0.35],
    [-0.13, 0.29, -0.07, -1, 0.55, -0.4],
    [0.13, 0.29, -0.07, 1, 0.55, -0.4],
    [-0.06, 0.29, -0.15, -0.35, 0.5, -1],
    [0.06, 0.29, -0.15, 0.35, 0.5, -1],
  ];
  const snakes = snakeDefs.map((d, i) =>
    buildSnake(hc, new THREE.Vector3(d[0], d[1], d[2]), new THREE.Vector3(d[3], d[4], d[5]), snakeMat, snakeEye, tongueMat, i * 1.618),
  );

  // ---------------------------------------------------------------- state & animation
  const blender = new PoseBlender(J);
  let t = 0;
  let gait = 0;
  let glow = 0;
  let glowShown = 0;
  let anger = 0;
  let angerShown = 0;
  let jawCur = 0;
  let fingerLCur = 0;
  let fingerRCur = 0;
  let rootYCur = 0;
  let lookYaw = 0;
  let lookPitch = 0;
  let hasLook = 0;
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpQ2 = new THREE.Quaternion();
  const tmpE = new THREE.Euler();

  interface PoseOut {
    j: JointPose;
    rootY?: number;
    jaw?: number;
    fingerL?: number;
    fingerR?: number;
    rate?: number;
    eyesOff?: boolean;
  }

  const restArms = (): JointPose => ({
    shoulderL: [0.05, 0, 0.16],
    shoulderR: [0.05, 0, -0.16],
    elbowL: [-0.3, 0, 0],
    elbowR: [-0.3, 0, 0],
  });

  function poseFor(pose: GorgonPose): PoseOut {
    const sn = Math.sin;
    switch (pose) {
      case 'idle': {
        const b = sn(t * 1.6);
        return {
          j: {
            ...restArms(),
            spine: [0.02 * b, 0.03 * sn(t * 0.4), 0],
            neck: [0.03, 0.06 * sn(t * 0.5), 0],
            head: [0.02 * b, 0, 0],
            shoulderL: [0.05, 0, 0.17 + 0.02 * b],
            shoulderR: [0.05, 0, -0.17 - 0.02 * b],
            kneeL: [0.04, 0, 0],
            kneeR: [0.04, 0, 0],
          },
        };
      }
      case 'walk': {
        return { j: gaitPose(gait), rootY: -0.02 + 0.03 * Math.abs(Math.cos(gait)), rate: 14 };
      }
      case 'point': {
        const jab = Math.max(0, sn(t * 7)) * 0.12;
        return {
          j: {
            spine: [0.1 + jab * 0.3, -0.25, 0],
            neck: [-0.05, 0.2, 0],
            head: [0, 0.05, 0],
            shoulderR: [-1.5 - jab, 0.15, -0.05],
            elbowR: [-0.05 + jab, 0, 0],
            wristR: [0, 0, 0],
            shoulderL: [0.15, 0.2, 0.65],
            elbowL: [-0.4, 0, -1.6],
            wristL: [0, 0, -0.3],
            hipL: [-0.15, 0, 0.02],
            kneeL: [0.15, 0, 0],
            hipR: [0.08, 0, -0.03],
          },
          fingerR: 1,
          rate: 12,
        };
      }
      case 'slam': {
        const u = (t % 0.6) / 0.6;
        let a: number; // 0 = arms up, 1 = slammed down
        if (u < 0.55) a = 1 - THREE.MathUtils.smoothstep(u, 0.0, 0.5);
        else if (u < 0.7) a = (u - 0.55) / 0.15;
        else a = 1;
        a = THREE.MathUtils.clamp(a, 0, 1);
        const up = 1 - a;
        return {
          j: {
            spine: [-0.15 * up + 0.45 * a, 0, 0],
            neck: [-0.25 * a, 0, 0],
            head: [-0.1 * a, 0, 0],
            shoulderL: [-2.7 * up - 1.0 * a, 0, 0.15],
            shoulderR: [-2.7 * up - 1.0 * a, 0, -0.15],
            elbowL: [-0.6 * up - 0.5 * a, 0, 0],
            elbowR: [-0.6 * up - 0.5 * a, 0, 0],
            hipL: [-0.25 * a, 0, 0],
            hipR: [-0.25 * a, 0, 0],
            kneeL: [0.35 * a, 0, 0],
            kneeR: [0.35 * a, 0, 0],
          },
          rootY: -0.05 * a,
          jaw: 0.5 * a,
          rate: 30,
        };
      }
      case 'gaze': {
        const q = sn(t * 30) * 0.01;
        return {
          j: {
            spine: [0.32, 0, q],
            neck: [-0.25, 0, 0],
            head: [-0.15, 0, 0],
            shoulderL: [-0.15, -0.35, 1.4],
            shoulderR: [-0.15, 0.35, -1.4],
            elbowL: [-0.5, 0, 0],
            elbowR: [-0.5, 0, 0],
            hipL: [-0.2, 0, 0.08],
            hipR: [0.15, 0, -0.08],
            kneeL: [0.3, 0, 0],
            kneeR: [0.15, 0, 0],
          },
          rootY: -0.04,
          jaw: 0.15,
          fingerL: 1,
          fingerR: 1,
          rate: 8,
        };
      }
      case 'stunned': {
        return {
          j: {
            spine: [0.12, 0.1 * sn(t * 1.3), 0.14 * sn(t * 2.1)],
            neck: [0.35, 0, 0.35 * sn(t * 1.7)],
            head: [0.2, 0.15 * sn(t * 1.1), 0.2 * sn(t * 1.7 + 0.6)],
            shoulderL: [0.15 * sn(t * 2.1), 0, 0.2 + 0.1 * sn(t * 2.1)],
            shoulderR: [-0.15 * sn(t * 2.1), 0, -0.2 + 0.1 * sn(t * 2.1)],
            elbowL: [-0.2, 0, 0],
            elbowR: [-0.2, 0, 0],
            hipL: [-0.1, 0, 0.05],
            hipR: [-0.1, 0, -0.05],
            kneeL: [0.25 + 0.1 * sn(t * 2.1), 0, 0],
            kneeR: [0.25 - 0.1 * sn(t * 2.1), 0, 0],
          },
          rootY: -0.04,
          jaw: 0.35,
          rate: 6,
          eyesOff: true,
        };
      }
      case 'taste': {
        return {
          j: {
            ...restArms(),
            spine: [-0.03, 0.1, 0],
            neck: [-0.08, 0.05, 0],
            head: [-0.06, 0.1, 0.12 * sn(t * 0.8)],
            shoulderR: [-0.95, 0.75, -0.05],
            elbowR: [-2.1, 0, 0],
            wristR: [0.3, 0, 0],
            shoulderL: [-0.25, -0.7, 0.15],
            elbowL: [-1.6, 0, 0],
          },
          jaw: 0.12 + 0.12 * Math.max(0, sn(t * 9)),
          rate: 9,
        };
      }
      case 'armsCrossed': {
        const b = sn(t * 1.5);
        return {
          j: {
            spine: [-0.06 + 0.01 * b, 0, 0],
            neck: [0.04, 0.05 * sn(t * 0.4), 0],
            head: [0.04, 0, 0],
            shoulderL: [-0.3, -1.3, 0.3],
            elbowL: [-1.95, 0, 0],
            shoulderR: [-0.42, 1.3, -0.3],
            elbowR: [-1.85, 0, 0],
            hipL: [0, 0, 0.08],
            hipR: [0, 0, -0.08],
          },
          rate: 9,
        };
      }
      case 'laugh': {
        const sh = sn(t * 22);
        return {
          j: {
            spine: [-0.2 + 0.03 * sh, 0, 0],
            neck: [-0.45, 0, 0],
            head: [-0.35 + 0.04 * sh, 0, 0],
            shoulderL: [-0.1 + 0.06 * sh, -0.6, 0.4],
            shoulderR: [-0.1 + 0.06 * sh, 0.6, -0.4],
            elbowL: [-1.1, 0, 0],
            elbowR: [-1.1, 0, 0],
          },
          rootY: 0.01 * sh,
          jaw: 0.6 + 0.25 * sn(t * 15),
          rate: 12,
        };
      }
      case 'yell': {
        const jit = sn(t * 37) * 0.025;
        return {
          j: {
            spine: [0.38, jit, 0],
            neck: [-0.22, 0, 0],
            head: [-0.22 + jit, jit, 0],
            shoulderL: [0.3, 0, 0.35],
            shoulderR: [0.3, 0, -0.35],
            elbowL: [-0.75, 0, 0],
            elbowR: [-0.75, 0, 0],
            hipL: [-0.25, 0, 0],
            kneeL: [0.25, 0, 0],
            hipR: [0.12, 0, 0],
          },
          rootY: -0.03,
          jaw: 0.95 + 0.05 * sn(t * 20),
          rate: 12,
        };
      }
    }
  }

  function applyAnger(a: number): void {
    for (const m of skinMats) m.color.copy(SKIN).lerp(SKIN_ANGRY, a * 0.85);
    const s = 0.28 + a * 0.22;
    browL.rotation.z = s;
    browR.rotation.z = -s;
    browL.position.y = browR.position.y = 0.207 - a * 0.008;
    eyeGroups[0].rotation.z = -(0.12 + a * 0.12);
    eyeGroups[1].rotation.z = 0.12 + a * 0.12;
  }

  function applyGlow(g: number, off: boolean): void {
    const e = off ? 0 : g;
    eyeMat.color.copy(off ? EYE_OFF : EYE_NORMAL).lerp(EYE_GLOW, e);
    for (const p of pupils) p.visible = e < 0.35 && !off;
    for (const ey of eyes) ey.scale.set(1 + e * 0.15, 1 + e * 0.9, 1);
    haloMat.opacity = e;
    for (const h of halos) {
      h.visible = e > 0.02;
      h.scale.setScalar(0.06 + e * 0.16);
    }
    coneMat.opacity = e * e * 0.14;
    glowCone.visible = e > 0.05;
  }
  applyAnger(0);
  applyGlow(0, false);

  function updateSnakes(dt: number, agitated: number, lookBias: number): void {
    const freq = 2.2 + agitated * 7;
    const amp = 0.16 + agitated * 0.22;
    for (const s of snakes) {
      s.phase += dt * freq;
      const bend = agitated * lookBias * 0.16;
      for (let i = 0; i < s.segs.length; i++) {
        const k = i * 0.85;
        const ax = amp * Math.sin(s.phase + k) + (i < 2 ? -0.1 : 0.12);
        const az = amp * 0.8 * Math.cos(s.phase * 0.83 + k + s.tonguePhase);
        tmpE.set(ax, 0, az);
        tmpQ.setFromEuler(tmpE);
        tmpQ2.setFromAxisAngle(s.axis, bend * (i < 3 ? 1.2 : 0.4));
        s.segs[i].quaternion.copy(tmpQ2).multiply(tmpQ);
      }
      // tongue flicks
      s.tonguePhase += dt * (1.5 + agitated * 5);
      const f = Math.sin(s.tonguePhase);
      const out = f > 0.55 ? Math.min(1, (f - 0.55) * 4) : 0;
      if (out > 0.01) {
        s.tongue.visible = true;
        s.tongue.scale.set(1, out * (0.7 + 0.3 * Math.sin(t * 40)), 1);
      } else s.tongue.visible = false;
    }
  }

  const rig: GorgonRig = {
    root,
    head,
    glowCone,
    handLeft: body.handL,
    handRight: body.handR,
    eyeWorldPosition(target) {
      return eyeMid.getWorldPosition(target);
    },
    setEyeGlow(v) {
      glow = THREE.MathUtils.clamp(v, 0, 1);
    },
    setAnger(v) {
      anger = THREE.MathUtils.clamp(v, 0, 1);
    },
    handWorldPosition(side, target) {
      return (side === 'left' ? body.handL : body.handR).getWorldPosition(target);
    },
    update(dt, u) {
      dt = Math.min(dt, 0.1);
      t += dt;
      if (u.pose === 'walk') {
        const sp = u.speed ?? 1.4;
        gait += (dt * sp * Math.PI * 2) / 1.5;
      }
      const p = poseFor(u.pose);
      const rate = p.rate ?? 10;
      blender.apply(p.j, rate, dt);
      rootYCur = damp(rootYCur, p.rootY ?? 0, rate, dt);
      body.hips.position.y = body.hipHeight + rootYCur;
      let jawT = p.jaw ?? 0;
      if (u.talking) jawT = Math.max(jawT, 0.15 + 0.35 * Math.abs(Math.sin(t * 11)) * (0.6 + 0.4 * Math.sin(t * 3.1)));
      jawCur = damp(jawCur, jawT, 22, dt);
      jaw.rotation.x = jawCur * 0.5;
      fingerLCur = damp(fingerLCur, p.fingerL ?? 0, 12, dt);
      fingerRCur = damp(fingerRCur, p.fingerR ?? 0, 12, dt);
      fingerL.scale.y = Math.max(0.01, fingerLCur);
      fingerR.scale.y = Math.max(0.01, fingerRCur);

      // head tracking
      let yawT = 0;
      let pitchT = 0;
      const lookOk = !!u.lookAt && u.pose !== 'stunned' && u.pose !== 'laugh';
      if (lookOk && u.lookAt) {
        root.updateMatrixWorld();
        tmpV.copy(u.lookAt);
        J.neck.parent!.worldToLocal(tmpV);
        tmpV.sub(J.neck.position);
        tmpV.y -= 0.2;
        yawT = THREE.MathUtils.clamp(Math.atan2(tmpV.x, tmpV.z), -1.2, 1.2);
        pitchT = THREE.MathUtils.clamp(-Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z)), -0.55, 0.6);
        // when facing away the target is behind: don't snap through the back
        if (tmpV.z < 0 && Math.abs(tmpV.x) < 0.2) yawT = 0;
      }
      hasLook = damp(hasLook, lookOk ? 1 : 0, 6, dt);
      lookYaw = damp(lookYaw, yawT, 7, dt);
      lookPitch = damp(lookPitch, pitchT, 7, dt);
      J.neck.rotation.y += lookYaw * 0.4;
      J.head.rotation.y += lookYaw * 0.6;
      J.neck.rotation.x += lookPitch * 0.4;
      J.head.rotation.x += lookPitch * 0.6;

      angerShown = damp(angerShown, anger, 4, dt);
      applyAnger(angerShown);
      glowShown = damp(glowShown, glow, 10, dt);
      applyGlow(glowShown, !!p.eyesOff);

      const agitated = THREE.MathUtils.clamp(angerShown + (u.pose === 'yell' || u.pose === 'slam' ? 0.25 : 0) + glowShown * 0.3, 0, 1);
      updateSnakes(dt, u.pose === 'stunned' ? 0 : agitated, 0.4 + 0.6 * hasLook);
    },
  };
  // settle into idle so the rig looks right before the first update
  blender.snap(poseFor('idle').j);
  return rig;
}
