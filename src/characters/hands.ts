import * as THREE from 'three';
import { mat } from '../engine/psx';
import { CreepingStone, type V3, addMesh, box, damp } from './common';

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
}

const SKIN = 0xe0a074;
const SLEEVE = 0xf2efe8;
const CUFF = 0xdedad2;

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
  cur: HandState;
  side: 1 | -1; // +1 right, -1 left
}

const RENDER_ORDER = 10;
/** Global nudge applied to every pose so the hands sit comfortably in view. */
const POS_OFFSET: V3 = [0, 0.065, -0.03];

function buildHand(side: 1 | -1, stone: CreepingStone): Hand {
  const s = side;
  const skin = (d: number) => {
    const m = mat(SKIN);
    stone.add(m, d);
    return m;
  };
  const arm = new THREE.Group();
  arm.rotation.order = 'YXZ';

  // sleeve + cuff, running back toward the camera
  const sleeveMat = mat(SLEEVE);
  stone.add(sleeveMat, 1.0);
  const sg = new THREE.CylinderGeometry(0.046, 0.054, 0.32, 7, 1);
  sg.rotateX(Math.PI / 2);
  sg.translate(0, 0, 0.21);
  addMesh(arm, sg, sleeveMat);
  const cuffMat = mat(CUFF);
  stone.add(cuffMat, 0.85);
  const cg = new THREE.CylinderGeometry(0.06, 0.06, 0.06, 7, 1);
  cg.rotateX(Math.PI / 2);
  cg.translate(0, 0, 0.055);
  addMesh(arm, cg, cuffMat);
  // cuff seam
  const seamMat = mat(0xb8b4ac);
  stone.add(seamMat, 0.85);
  const seam = new THREE.CylinderGeometry(0.0615, 0.0615, 0.008, 7, 1);
  seam.rotateX(Math.PI / 2);
  seam.translate(0, 0, 0.03);
  addMesh(arm, seam, seamMat);
  // wrist stub
  const wristStub = new THREE.CylinderGeometry(0.036, 0.04, 0.05, 6, 1);
  wristStub.rotateX(Math.PI / 2);
  wristStub.translate(0, 0, 0.012);
  addMesh(arm, wristStub, skin(0.6));

  const wrist = new THREE.Group();
  arm.add(wrist);
  // palm: back half and front half (chunky)
  addMesh(wrist, box(0.042, 0.092, 0.05, 0, 0, -0.025), skin(0.45));
  addMesh(wrist, box(0.044, 0.098, 0.05, 0, -0.002, -0.07), skin(0.32));
  // fleshy thumb pad on the palm side
  addMesh(wrist, box(0.02, 0.04, 0.05, -s * 0.024, 0.02, -0.035), skin(0.4));

  const knuckles: THREE.Group[] = [];
  const mids: THREE.Group[] = [];
  const fingerYs = [0.034, 0.011, -0.012, -0.034];
  const lens = [0.042, 0.046, 0.043, 0.034];
  for (let i = 0; i < 4; i++) {
    const k = new THREE.Group();
    k.position.set(0, fingerYs[i], -0.094);
    wrist.add(k);
    addMesh(k, box(0.03, 0.022, lens[i] + 0.006, 0, 0, -lens[i] / 2), skin(0.14));
    const m = new THREE.Group();
    m.position.z = -lens[i];
    k.add(m);
    addMesh(m, box(0.027, 0.02, lens[i] * 0.85, 0, 0, -lens[i] * 0.42), skin(0.0));
    knuckles.push(k);
    mids.push(m);
  }
  const thumbBase = new THREE.Group();
  thumbBase.position.set(-s * 0.02, 0.04, -0.035);
  wrist.add(thumbBase);
  addMesh(thumbBase, box(0.028, 0.028, 0.045, 0, 0, -0.02), skin(0.16));
  const thumbTip = new THREE.Group();
  thumbTip.position.z = -0.042;
  thumbBase.add(thumbTip);
  addMesh(thumbTip, box(0.025, 0.025, 0.035, 0, 0, -0.016), skin(0.04));

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
  };
  rig.update(1, 'idle');
  return rig;
}
