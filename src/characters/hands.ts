import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat } from '../engine/psx';
import { CreepingStone, type V3, addMesh, damp } from './common';

// First-person hands. The game parents `root` to the camera (camera looks down -Z).
// Each hand is built in a "handshake" frame: fingers along -Z, palm facing the body's
// centre line, thumb up (+Y). A white chef sleeve runs back toward the camera along +Z.
//
// rightGrip sits inside the right fist; its local -Z axis runs along the held handle
// out of the thumb side of the fist (so a knife blade attached along -Z points "out of the
// top of the fist"), local +Y points out of the knuckles.

export type HandsPose = 'idle' | 'reach' | 'hold' | 'chop' | 'shake' | 'flip' | 'stir' | 'raisePan' | 'cover';

export interface HandsRig {
  root: THREE.Group;
  rightGrip: THREE.Object3D;
  update(dt: number, pose: HandsPose, opts?: { action?: number }): void;
  setStone(v: number): void;
  /** Optional extra: empty inside the left fist, same convention as rightGrip. */
  leftGrip?: THREE.Object3D;
  /** Swap bare hands for quilted oven mitts. */
  setMitts?(on: boolean): void;
}

const SKIN = 0xe0a074;
const SLEEVE = 0xf2efe8;
const CUFF = 0xdedad2;
const NAIL = 0xf0c0a8;

interface HandState {
  pos: V3;
  rot: V3; // forearm: yaw/pitch of the sleeve + roll around the forearm (order YXZ)
  wrist: V3;
  curl: number;
  thumb: number;
}

interface Hand {
  arm: THREE.Group;
  wrist: THREE.Group;
  knuckles: THREE.Group[];
  mids: THREE.Group[];
  thumbBase: THREE.Group;
  thumbTip: THREE.Group;
  grip: THREE.Object3D;
  /** Bare-hand meshes (hidden while wearing mitts) and the mitt meshes. */
  bare: THREE.Object3D[];
  mitt: THREE.Object3D[];
  cur: HandState;
  side: 1 | -1; // +1 right, -1 left
}

const RENDER_ORDER = 10;
/** Global nudge applied to every pose so the hands sit comfortably in view. */
const POS_OFFSET: V3 = [0, 0.065, -0.03];

// ---------------------------------------------------------------------------------------------
// Smooth geometry helpers (all along the -Z "finger" axis)

/** Capsule spanning z0 (near, +Z) to z1 (far, -Z), including the rounded caps. */
function capsuleZ(r: number, z0: number, z1: number, radial = 8, cap = 3): THREE.BufferGeometry {
  const len = Math.max(0.0001, Math.abs(z0 - z1) - 2 * r);
  const g = new THREE.CapsuleGeometry(r, len, cap, radial);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, (z0 + z1) / 2);
  return g;
}

/** Scale x/y cross-section linearly from sA at zA to sB at zB (clamped). Normals left as-is. */
function taper(g: THREE.BufferGeometry, zA: number, zB: number, sA: number, sB: number): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = THREE.MathUtils.clamp((p.getZ(i) - zA) / (zB - zA), 0, 1);
    const k = sA + (sB - sA) * u;
    p.setXY(i, p.getX(i) * k, p.getY(i) * k);
  }
  p.needsUpdate = true;
  return g;
}

/** Rounded "superellipsoid" blob: e=1 is an ellipsoid, smaller e is boxier. Seamless normals. */
function blob(sx: number, sy: number, sz: number, e = 1, w = 14, h = 10): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.SphereGeometry(1, w, h);
  const p = g.attributes.position as THREE.BufferAttribute;
  const f = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let i = 0; i < p.count; i++) p.setXYZ(i, f(p.getX(i)) * sx, f(p.getY(i)) * sy, f(p.getZ(i)) * sz);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  g.computeVertexNormals();
  return g;
}

function latheZ(profile: [number, number][], seg = 20): THREE.BufferGeometry {
  // profile: [radius, z] with z increasing (front of sleeve -> back toward the camera)
  const g = new THREE.LatheGeometry(
    profile.map(([r, z]) => new THREE.Vector2(r, z)),
    seg,
  );
  g.rotateX(Math.PI / 2);
  return g;
}

function buildHand(side: 1 | -1, stone: CreepingStone): Hand {
  const s = side;
  const skin = (d: number) => {
    const m = mat(SKIN, { roughness: 0.55 });
    stone.add(m, d);
    return m;
  };
  const nailMat = mat(NAIL, { roughness: 0.3 });
  stone.add(nailMat, 0.0);
  const arm = new THREE.Group();
  arm.rotation.order = 'YXZ';

  // sleeve with soft fabric folds, running back toward the camera
  const sleeveMat = mat(SLEEVE, { roughness: 0.92 });
  stone.add(sleeveMat, 1.0);
  addMesh(
    arm,
    latheZ([
      [0.046, 0.06],
      [0.0525, 0.075],
      [0.0545, 0.11],
      [0.0525, 0.15],
      [0.0545, 0.19],
      [0.0525, 0.24],
      [0.0505, 0.3],
      [0.047, 0.36],
      [0.03, 0.375],
    ]),
    sleeveMat,
  );
  // rolled cuff: a thick folded band with a rounded lip at the wrist
  const cuffMat = mat(CUFF, { roughness: 0.9 });
  stone.add(cuffMat, 0.85);
  addMesh(
    arm,
    latheZ([
      [0.044, 0.026],
      [0.051, 0.02],
      [0.0585, 0.022],
      [0.0625, 0.032],
      [0.063, 0.048],
      [0.0612, 0.058],
      [0.0632, 0.068],
      [0.0622, 0.08],
      [0.057, 0.088],
      [0.05, 0.09],
    ]),
    cuffMat,
  );
  // fold crease between the two rolls of the cuff
  const seamMat = mat(0xb8b4ac, { roughness: 0.95 });
  stone.add(seamMat, 0.85);
  const seam = new THREE.TorusGeometry(0.0612, 0.0016, 4, 20);
  seam.translate(0, 0, 0.058);
  addMesh(arm, seam, seamMat);
  // wrist (slightly flattened, wider than thick)
  const wristGeo = capsuleZ(0.034, 0.06, -0.03, 10, 3);
  wristGeo.scale(0.74, 1, 1);
  addMesh(arm, wristGeo, skin(0.6));

  const wrist = new THREE.Group();
  arm.add(wrist);
  // palm: a rounded, slightly boxy pad, narrower toward the wrist
  const palm = blob(0.0215, 0.05, 0.053, 0.6, 14, 10);
  palm.translate(0, -0.001, -0.05);
  taper(palm, -0.005, -0.06, 0.82, 1);
  addMesh(wrist, palm, skin(0.38));
  // fleshy thumb (thenar) and outer-edge (hypothenar) pads on the palm side
  const thenar = blob(0.012, 0.021, 0.03, 1, 10, 8);
  thenar.translate(-s * 0.012, 0.022, -0.036);
  addMesh(wrist, thenar, skin(0.4));
  const hypo = blob(0.0105, 0.016, 0.034, 1, 10, 8);
  hypo.translate(-s * 0.009, -0.03, -0.046);
  addMesh(wrist, hypo, skin(0.4));

  const knuckles: THREE.Group[] = [];
  const mids: THREE.Group[] = [];
  const fingerYs = [0.034, 0.011, -0.012, -0.034];
  const lens = [0.042, 0.046, 0.043, 0.034];
  const radii = [0.0108, 0.0113, 0.0107, 0.0095];
  for (let i = 0; i < 4; i++) {
    const r = radii[i];
    const k = new THREE.Group();
    k.position.set(0, fingerYs[i], -0.094);
    wrist.add(k);
    // proximal phalanx, starting with a rounded knuckle tucked into the palm
    const prox = capsuleZ(r, r * 0.9, -(lens[i] + r * 0.55));
    prox.scale(1.06, 1, 1);
    addMesh(k, prox, skin(0.14));
    const m = new THREE.Group();
    m.position.z = -lens[i];
    k.add(m);
    // middle + distal phalanx, tapering to the fingertip
    const r2 = r * 0.93;
    const tip = -(lens[i] * 0.85 + r2 * 0.25);
    const dist = capsuleZ(r2, r2 * 0.8, tip);
    taper(dist, 0, tip, 1, 0.84);
    dist.scale(1.04, 1, 1);
    addMesh(m, dist, skin(0.0));
    // subtle fingernail on the back of the fingertip
    const nail = blob(0.0022, r2 * 0.62, r2 * 1.05, 0.8, 8, 6);
    nail.translate(s * r2 * 0.86, 0, tip + r2 * 1.35);
    addMesh(m, nail, nailMat);
    knuckles.push(k);
    mids.push(m);
  }
  const thumbBase = new THREE.Group();
  thumbBase.position.set(-s * 0.02, 0.04, -0.035);
  wrist.add(thumbBase);
  const tb = capsuleZ(0.0128, 0.014, -0.047);
  tb.scale(1, 0.95, 1);
  addMesh(thumbBase, tb, skin(0.16));
  const thumbTip = new THREE.Group();
  thumbTip.position.z = -0.042;
  thumbBase.add(thumbTip);
  const ttEnd = -0.038;
  const tt = capsuleZ(0.0118, 0.01, ttEnd);
  taper(tt, 0, ttEnd, 1, 0.86);
  addMesh(thumbTip, tt, skin(0.04));
  // thumbnail faces up (+Y) in the handshake frame
  const tnail = blob(0.0075, 0.0022, 0.0115, 0.8, 8, 6);
  tnail.translate(0, 0.0118 * 0.86, ttEnd + 0.0155);
  addMesh(thumbTip, tnail, nailMat);

  // Everything skin-coloured so far is the bare hand; the mitt is built over the same bones.
  const bare: THREE.Object3D[] = [];
  arm.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material === nailMat || (m.material as THREE.MeshStandardMaterial).color?.getHex() === SKIN)) bare.push(m);
  });
  const mitt: THREE.Object3D[] = [];
  const mittMat = mat(0xb3221c, { roughness: 0.9 });
  stone.add(mittMat, 0.3);
  const trimMat = mat(0xf1ece0, { roughness: 0.95 });
  stone.add(trimMat, 0.6);
  // Padded cuff over the wrist, flaring toward the sleeve.
  mitt.push(addMesh(arm, latheZ([[0.03, -0.045], [0.046, -0.04], [0.054, -0.01], [0.06, 0.03], [0.062, 0.05], [0.05, 0.056]]), mittMat));
  mitt.push(addMesh(arm, (() => { const g = new THREE.TorusGeometry(0.06, 0.007, 6, 22); g.translate(0, 0, 0.05); return g; })(), trimMat));
  // Palm block.
  const mPalm = blob(0.034, 0.064, 0.07, 0.55, 16, 12);
  mPalm.translate(0, 0, -0.06);
  mitt.push(addMesh(wrist, mPalm, mittMat));
  // One fat pouch for all four fingers, riding on the middle knuckle so it still curls.
  const pouch = blob(0.03, 0.06, 0.05, 0.6, 16, 12);
  pouch.translate(0, -0.011, -0.035);
  mitt.push(addMesh(knuckles[1], pouch, mittMat));
  const pouchTip = blob(0.026, 0.054, 0.034, 0.75, 14, 10);
  pouchTip.translate(0, -0.011, -0.018);
  mitt.push(addMesh(mids[1], pouchTip, mittMat));
  // Thumb sleeve.
  mitt.push(addMesh(thumbBase, capsuleZ(0.019, 0.004, -0.06), mittMat));
  mitt.push(addMesh(thumbTip, capsuleZ(0.017, 0.01, -0.036), mittMat));
  for (const m of mitt) m.visible = false;

  const grip = new THREE.Object3D();
  grip.position.set(-s * 0.04, 0, -0.105);
  grip.rotation.x = Math.PI / 2;
  wrist.add(grip);

  arm.traverse((o) => {
    o.renderOrder = RENDER_ORDER;
  });

  return {
    arm,
    wrist,
    knuckles,
    mids,
    thumbBase,
    thumbTip,
    grip,
    bare,
    mitt,
    side,
    cur: { pos: [0.25 * s, -0.27, -0.42], rot: [0.5, 0.35 * s, 0.3 * s], wrist: [0, 0, 0], curl: 0.4, thumb: 0.3 },
  };
}

/** Right-hand states; left uses mirror(). */
function rightState(pose: HandsPose, a: number, t: number, auto: boolean): HandState {
  const sn = Math.sin;
  switch (pose) {
    case 'idle':
      return { pos: [0.24, -0.29, -0.42], rot: [0.55, 0.35, 0.35], wrist: [-0.2, 0, 0], curl: 0.45, thumb: 0.3 };
    case 'reach': {
      const e = auto ? 1 : a;
      return { pos: [0.19 - 0.06 * e, -0.25 + 0.06 * e, -0.44 - 0.2 * e], rot: [0.55, 0.25, 1.2], wrist: [-0.1, 0.35, 0], curl: 0.3 - 0.22 * e, thumb: 0.1 };
    }
    case 'hold':
      return { pos: [0.19, -0.23, -0.45], rot: [0.62, 0.3, 0.2], wrist: [-1.15, 0, 0], curl: 1, thumb: 0.9 };
    case 'chop': {
      // a: 0 = knife raised, 1 = blade down on the board
      const d = auto ? Math.pow(Math.abs(sn(t * 6)), 0.6) : a;
      return { pos: [0.16, -0.14 - 0.14 * d, -0.5], rot: [0.62, 0.25, 0.25], wrist: [-1.85 - 0.55 * d, 0, 0], curl: 1, thumb: 0.9 };
    }
    case 'shake': {
      const ph = auto ? t * 20 : a * Math.PI * 2;
      return { pos: [0.13, -0.13 + 0.025 * sn(ph), -0.5], rot: [0.62, 0.2, 0.4], wrist: [-2.9 + 0.3 * sn(ph), 0, 0], curl: 1, thumb: 0.9 };
    }
    case 'flip': {
      let f: number;
      if (auto) {
        const u = (t % 1.0) / 1.0;
        f = u < 0.18 ? u / 0.18 : Math.max(0, 1 - (u - 0.18) / 0.3);
      } else f = sn(Math.PI * a);
      return { pos: [0.15, -0.26 + 0.07 * f, -0.5 + 0.03 * f], rot: [0.62, 0.25, 0.15], wrist: [-1.72 + 0.75 * f, 0, 0], curl: 1, thumb: 0.9 };
    }
    case 'stir': {
      const ph = auto ? t * 6 : a * Math.PI * 2;
      return { pos: [0.12 + 0.045 * Math.cos(ph), -0.27, -0.52 + 0.045 * sn(ph)], rot: [0.62, 0.2, 0.3], wrist: [-2.62, 0, 0], curl: 1, thumb: 0.9 };
    }
    case 'raisePan': {
      const e = auto ? 1 : a;
      return {
        pos: [0.2 - 0.17 * e, -0.24 + 0.05 * e, -0.42 + 0.06 * e],
        rot: [0.45 + 0.75 * e, 0.3 - 0.2 * e, 0.2 - 0.2 * e],
        wrist: [-1.0 + 0.25 * e, 0, 0],
        curl: 1,
        thumb: 0.9,
      };
    }
    case 'cover': {
      const e = auto ? 1 : a;
      return {
        pos: [0.24 - 0.15 * e, -0.29 + 0.1 * e, -0.42 + 0.09 * e],
        rot: [0.55 + 0.85 * e, 0.35 - 0.25 * e, 0.35 - 1.75 * e],
        wrist: [0.15 * e, 0, 0],
        curl: 0.45 - 0.35 * e,
        thumb: 0.3 - 0.2 * e,
      };
    }
  }
}

function leftState(pose: HandsPose, a: number, t: number, auto: boolean): HandState {
  switch (pose) {
    case 'chop':
      // flat hand steadying the food
      return mirror({ pos: [0.13, -0.33, -0.5], rot: [0.3, 0.15, 1.35], wrist: [-0.1, 0, 0], curl: 0.35, thumb: 0.2 });
    case 'cover':
      return mirror(rightState('cover', a, t, auto));
    case 'raisePan': {
      const e = auto ? 1 : a;
      return mirror({ pos: [0.27, -0.33 - 0.04 * e, -0.4], rot: [0.6, 0.4, 0.3], wrist: [-0.2, 0, 0], curl: 0.5, thumb: 0.3 });
    }
    case 'idle':
      return mirror(rightState('idle', a, t, auto));
    default:
      // lowered, relaxed
      return mirror({ pos: [0.26, -0.33, -0.42], rot: [0.6, 0.4, 0.3], wrist: [-0.2, 0, 0], curl: 0.5, thumb: 0.3 });
  }
}

function mirror(h: HandState): HandState {
  return {
    pos: [-h.pos[0], h.pos[1], h.pos[2]],
    rot: [h.rot[0], -h.rot[1], -h.rot[2]],
    wrist: [h.wrist[0], -h.wrist[1], -h.wrist[2]],
    curl: h.curl,
    thumb: h.thumb,
  };
}

export function buildHands(): HandsRig {
  const root = new THREE.Group();
  root.name = 'FirstPersonHands';
  const stone = new CreepingStone();
  const right = buildHand(1, stone);
  const left = buildHand(-1, stone);
  root.add(right.arm, left.arm);
  let t = 0;
  let lastPose: HandsPose = 'idle';
  let poseTime = 0;

  function applyHand(h: Hand, target: HandState, rate: number, dt: number, bob: V3): void {
    const c = h.cur;
    const k = 1 - Math.exp(-rate * dt);
    for (let i = 0; i < 3; i++) {
      c.pos[i] += (target.pos[i] + POS_OFFSET[i] - c.pos[i]) * k;
      c.rot[i] += (target.rot[i] + (i === 0 ? 0.12 : 0) - c.rot[i]) * k;
      c.wrist[i] += (target.wrist[i] - c.wrist[i]) * k;
    }
    c.curl = damp(c.curl, target.curl, rate, dt);
    c.thumb = damp(c.thumb, target.thumb, rate, dt);
    h.arm.position.set(c.pos[0] + bob[0] * h.side, c.pos[1] + bob[1], c.pos[2] + bob[2]);
    h.arm.rotation.set(c.rot[0], c.rot[1], c.rot[2]);
    h.wrist.rotation.set(c.wrist[0], c.wrist[1], c.wrist[2]);
    const s = h.side;
    for (let i = 0; i < 4; i++) {
      const extra = i * 0.08;
      h.knuckles[i].rotation.y = s * c.curl * (1.45 + extra);
      h.mids[i].rotation.y = s * c.curl * (1.55 + extra);
    }
    h.thumbBase.rotation.set(-0.35 - 0.3 * c.thumb, s * (0.35 + 0.75 * c.thumb), 0);
    h.thumbTip.rotation.y = s * 0.7 * c.thumb;
  }

  const bob: V3 = [0, 0, 0];
  const rig: HandsRig = {
    root,
    rightGrip: right.grip,
    leftGrip: left.grip,
    update(dt, pose, opts) {
      dt = Math.min(dt, 0.1);
      t += dt;
      if (pose !== lastPose) {
        lastPose = pose;
        poseTime = 0;
      }
      poseTime += dt;
      const auto = opts?.action === undefined;
      const a = THREE.MathUtils.clamp(opts?.action ?? 0, 0, 1);
      const fast = pose === 'chop' || pose === 'shake' || pose === 'flip' || pose === 'stir';
      const rate = fast ? 22 : 11;
      const idleAmt = pose === 'idle' || pose === 'hold' ? 1 : 0.4;
      bob[0] = Math.sin(t * 1.1) * 0.004 * idleAmt;
      bob[1] = Math.sin(t * 2.2) * 0.005 * idleAmt;
      bob[2] = 0;
      applyHand(right, rightState(pose, a, poseTime, auto), rate, dt, bob);
      applyHand(left, leftState(pose, a, poseTime, auto), rate * 0.8, dt, bob);
    },
    setStone(v) {
      stone.set(v);
    },
    setMitts(on) {
      for (const h of [right, left]) {
        for (const m of h.bare) m.visible = !on;
        for (const m of h.mitt) m.visible = on;
      }
    },
  };
  rig.update(1, 'idle');
  return rig;
}
