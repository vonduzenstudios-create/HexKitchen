import * as THREE from 'three';
import { basic, mat } from '../engine/psx';
import { type JointPose, Petrifier, PoseBlender, addMesh, box, buildBody, damp, gaitPose } from './common';

// Rival contestants: three comedic silhouettes in aprons. Local forward +Z, origin at the feet.

export type RivalAction = 'cook' | 'idle' | 'panic' | 'walk' | 'cower';

export interface RivalRig {
  root: THREE.Group;
  update(dt: number, action: RivalAction): void;
  setStone(v: number): void;
  /** Optional extras. */
  head?: THREE.Object3D;
  handRight?: THREE.Object3D;
  handLeft?: THREE.Object3D;
}

interface VariantSpec {
  hipHeight: number;
  torso: number;
  chest: number;
  waist: number;
  shoulder: number;
  legR: number;
  armR: number;
  upperArm: number;
  foreArm: number;
  headW: number;
  headH: number;
  headD: number;
  shirt: number;
  apron: number;
  pants: number;
  skin: number;
  hunch: number;
}

const VARIANTS: VariantSpec[] = [
  // 0: tall lanky guy, pompadour, red apron
  { hipHeight: 1.0, torso: 0.5, chest: 0.17, waist: 0.14, shoulder: 0.19, legR: 0.048, armR: 0.038, upperArm: 0.3, foreArm: 0.28, headW: 0.16, headH: 0.23, headD: 0.18, shirt: 0xe8c43a, apron: 0xc42228, pants: 0x34405a, skin: 0xf0c098, hunch: 0 },
  // 1: short round woman, big bun, blue apron
  { hipHeight: 0.66, torso: 0.47, chest: 0.21, waist: 0.25, shoulder: 0.22, legR: 0.07, armR: 0.052, upperArm: 0.22, foreArm: 0.2, headW: 0.2, headH: 0.2, headD: 0.2, shirt: 0xe07a9a, apron: 0x2a52c4, pants: 0x3a3040, skin: 0xb07850, hunch: 0 },
  // 2: nervous guy, glasses, bald, toque, green apron
  { hipHeight: 0.88, torso: 0.5, chest: 0.19, waist: 0.18, shoulder: 0.2, legR: 0.055, armR: 0.044, upperArm: 0.27, foreArm: 0.25, headW: 0.17, headH: 0.21, headD: 0.19, shirt: 0x9a8ac8, apron: 0x2f8a3a, pants: 0x4a4a52, skin: 0xe8b890, hunch: 0.12 },
];

export function buildRival(variant: 0 | 1 | 2): RivalRig {
  const v = VARIANTS[variant];
  const skin = mat(v.skin);
  const shirt = mat(v.shirt);
  const pants = mat(v.pants);
  const shoe = mat(0x2a1e18);
  const apron = mat(v.apron);
  const white = mat(0xf2f0ea);
  const dark = basic(0x141010);
  const eyeWhite = basic(0xf4f0e8);
  const mouth = mat(0x4a1010);

  const body = buildBody({
    hipHeight: v.hipHeight,
    hipHalfWidth: v.waist * 0.5,
    legRadius: v.legR,
    torsoLength: v.torso,
    waistHalfWidth: v.waist,
    chestHalfWidth: v.chest,
    torsoDepth: variant === 1 ? 0.85 : 0.65,
    shoulderHalfWidth: v.shoulder,
    upperArm: v.upperArm,
    foreArm: v.foreArm,
    armRadius: v.armR,
    neckLength: variant === 0 ? 0.08 : 0.04,
    neckRadius: variant === 1 ? 0.06 : 0.045,
    footLength: 0.22,
    shirt,
    sleeve: shirt,
    pants,
    shoe,
    skin,
    handSize: v.armR * 1.9,
  });
  const J = body.joints;
  const root = body.root;
  root.name = `Rival${variant}`;
  const spine = J.spine;
  const fz = (y: number) => body.torsoFrontZ(y);

  // apron bib + skirt
  {
    const bibTop = v.torso * 0.88;
    const bw = v.chest * 1.15;
    const shape = new THREE.Shape();
    shape.moveTo(-v.waist * 1.0, 0.0);
    shape.lineTo(v.waist * 1.0, 0.0);
    shape.lineTo(bw * 0.55, bibTop);
    shape.lineTo(-bw * 0.55, bibTop);
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    const pa = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) pa.setZ(i, fz(pa.getY(i)) + 0.008);
    addMesh(spine, g, apron);
    // neck strap
    addMesh(spine, box(bw * 1.0, 0.025, 0.01), apron, 0, bibTop, fz(bibTop) + 0.004);
    // skirt over the hips
    const sg = new THREE.CylinderGeometry(v.waist * 1.08, v.waist * 1.25, v.hipHeight * 0.48, 8, 1, true, -Math.PI * 0.6, Math.PI * 1.2);
    sg.scale(1, 1, variant === 1 ? 0.9 : 0.72);
    sg.translate(0, -v.hipHeight * 0.24 + 0.02, 0.01);
    addMesh(body.hips, sg, apron);
    // pocket
    addMesh(body.hips, box(v.waist * 0.8, 0.07, 0.01), mat(new THREE.Color(v.apron).multiplyScalar(0.7)), 0, -0.12, v.waist * (variant === 1 ? 1.1 : 0.88) + 0.02);
  }
  if (variant === 1) {
    // round belly, covered by the apron
    const b = addMesh(spine, new THREE.IcosahedronGeometry(v.waist * 1.0, 1), shirt, 0, v.torso * 0.4, 0.0);
    b.scale.set(1.12, 0.95, 0.9);
    const ab = addMesh(spine, new THREE.IcosahedronGeometry(v.waist * 0.95, 1), apron, 0, v.torso * 0.36, 0.05);
    ab.scale.set(0.98, 0.95, 0.92);
  }

  // ---- head
  const head = J.head;
  const hc = new THREE.Group();
  hc.position.set(0, 0.0, 0.015);
  head.add(hc);
  const hw = v.headW;
  const hh = v.headH;
  const hd = v.headD;
  if (variant === 1) {
    const hg = addMesh(hc, new THREE.IcosahedronGeometry(hw * 0.55, 1), skin, 0, hh * 0.5, 0);
    hg.scale.set(1, hh / hw, hd / hw);
  } else if (variant === 2) {
    // egg-shaped bald head
    const hg = addMesh(hc, new THREE.IcosahedronGeometry(hw * 0.55, 1), skin, 0, hh * 0.52, 0);
    hg.scale.set(1, (hh / hw) * 1.05, hd / hw);
  } else {
    addMesh(hc, box(hw, hh, hd), skin, 0, hh / 2, 0);
    // long chin
    addMesh(hc, box(hw * 0.6, 0.05, hd * 0.6), skin, 0, 0.01, hd * 0.15);
  }
  const front = hd / 2;
  // eyes (whites + pupils), nose, mouth, ears
  const eyeY = hh * 0.58;
  const eyeParts: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    eyeParts.push(addMesh(hc, box(0.035, 0.03, 0.01), eyeWhite, sx * hw * 0.22, eyeY, front - 0.002));
    addMesh(hc, box(0.016, 0.018, 0.01), dark, sx * hw * 0.2, eyeY, front + 0.004);
    addMesh(hc, box(0.025, 0.05, 0.035), skin, sx * hw * 0.52, hh * 0.5, 0);
  }
  addMesh(hc, box(0.03, 0.045, 0.04), skin, 0, hh * 0.42, front + 0.012);
  const mouthMesh = addMesh(hc, box(0.06, 0.016, 0.01), mouth, 0, hh * 0.24, front - 0.002);

  if (variant === 0) {
    // pompadour: tall swept quiff
    const hair = mat(0x3a2414);
    addMesh(hc, box(hw * 1.04, 0.05, hd * 1.04), hair, 0, hh + 0.005, 0);
    addMesh(hc, box(hw * 1.06, hh * 0.5, 0.04), hair, 0, hh * 0.72, -hd / 2);
    for (const sx of [-1, 1]) addMesh(hc, box(0.02, hh * 0.35, hd * 0.8), hair, sx * hw * 0.52, hh * 0.78, -0.01);
    const q = addMesh(hc, new THREE.IcosahedronGeometry(0.1, 0), hair, 0, hh + 0.07, hd * 0.22);
    q.scale.set(0.85, 0.8, 1.35);
    q.rotation.x = -0.4;
    const q2 = addMesh(hc, new THREE.IcosahedronGeometry(0.07, 0), hair, 0, hh + 0.09, hd * 0.55);
    q2.scale.set(0.9, 0.8, 1.1);
    // brows
    for (const sx of [-1, 1]) addMesh(hc, box(0.045, 0.012, 0.01), hair, sx * hw * 0.22, eyeY + 0.03, front + 0.002);
  } else if (variant === 1) {
    const hair = mat(0x7a3018);
    const cap = addMesh(hc, new THREE.IcosahedronGeometry(hw * 0.58, 1), hair, 0, hh * 0.62, -0.015);
    cap.scale.set(1, 0.75, 1);
    const bun = addMesh(hc, new THREE.IcosahedronGeometry(0.1, 1), hair, 0, hh + 0.08, -0.02);
    bun.scale.set(1, 0.9, 1);
    addMesh(hc, new THREE.CylinderGeometry(0.06, 0.07, 0.03, 8), mat(0xe8d040), 0, hh + 0.005, -0.02);
    // cheeks
    for (const sx of [-1, 1]) addMesh(hc, box(0.03, 0.02, 0.01), mat(0xd86a6a), sx * hw * 0.3, hh * 0.38, front - 0.012);
  } else {
    // glasses
    const frame = basic(0x101010);
    const lens = basic(0xbfe4f0);
    for (const sx of [-1, 1]) {
      addMesh(hc, box(0.055, 0.045, 0.006), frame, sx * hw * 0.24, eyeY, front + 0.01);
      addMesh(hc, box(0.043, 0.033, 0.006), lens, sx * hw * 0.24, eyeY, front + 0.013);
      addMesh(hc, box(0.006, 0.006, hd * 0.55), frame, sx * hw * 0.5, eyeY + 0.01, front - hd * 0.25);
    }
    addMesh(hc, box(0.02, 0.006, 0.006), frame, 0, eyeY + 0.008, front + 0.012);
    // fringe of hair around the bald dome
    addMesh(hc, box(hw * 1.02, 0.04, hd * 0.6), mat(0x5a4a3a), 0, hh * 0.45, -hd * 0.25);
    // toque
    addMesh(hc, new THREE.CylinderGeometry(0.085, 0.08, 0.13, 8), white, 0, hh + 0.04, -0.01);
    const puff = addMesh(hc, new THREE.IcosahedronGeometry(0.115, 1), white, 0, hh + 0.14, -0.01);
    puff.scale.set(1, 0.65, 1);
    // nervous sweat drop
    addMesh(hc, box(0.015, 0.025, 0.01), basic(0x9ad4ff), hw * 0.45, hh * 0.78, front * 0.6);
    for (const p of eyeParts) p.scale.set(0.8, 0.8, 1);
  }

  // ---- animation
  const blender = new PoseBlender(J);
  const pet = new Petrifier();
  pet.addTree(root);
  let stone = 0;
  let t = Math.random() * 10;
  let gait = 0;
  let rootY = 0;
  let mouthOpen = 0;
  const seed = variant * 2.3;

  function pose(action: RivalAction): { j: JointPose; rootY?: number; mouth?: number; rate?: number } {
    const s = Math.sin;
    const h = v.hunch;
    switch (action) {
      case 'idle':
        return {
          j: {
            spine: [h + 0.02 * s(t * 1.7), 0, 0],
            neck: [0, 0.4 * s(t * 0.5 + seed), 0],
            head: [variant === 2 ? 0.1 : 0, 0.15 * s(t * 0.9 + seed), 0],
            shoulderL: [0, 0, 0.1],
            shoulderR: [0, 0, -0.1],
            elbowL: [-0.2, 0, 0],
            elbowR: [-0.2, 0, 0],
            ...(variant === 2 ? { shoulderL: [-0.5, -0.6, 0.1], elbowL: [-1.5 + 0.2 * s(t * 9), 0, 0], shoulderR: [-0.5, 0.6, -0.1], elbowR: [-1.5 + 0.2 * s(t * 9 + 1), 0, 0] } : {}),
          },
        };
      case 'walk':
        return { j: gaitPose(gait, variant === 0 ? 1.15 : 0.9), rootY: 0.025 * Math.abs(Math.cos(gait)) };
      case 'cook': {
        const stir = Math.floor((t + seed) / 3.5) % 2 === 1;
        const base: JointPose = {
          spine: [h + 0.18, 0, 0],
          neck: [0.15, 0, 0],
          head: [0.2, 0.08 * s(t * 0.7), 0],
          shoulderL: [-0.75, -0.35, 0.05],
          elbowL: [-1.0, 0, 0],
        };
        if (stir) {
          base.shoulderR = [-0.8 + 0.18 * s(t * 7), 0.35 + 0.25 * Math.cos(t * 7), -0.05];
          base.elbowR = [-0.9, 0, 0];
        } else {
          const c = Math.abs(s(t * 9));
          base.shoulderR = [-0.6 - 0.35 * c, 0.3, -0.05];
          base.elbowR = [-0.6 - 0.6 * c, 0, 0];
        }
        return { j: base, rate: 14 };
      }
      case 'panic':
        return {
          j: {
            spine: [-0.1, 0.25 * s(t * 5), 0.08 * s(t * 7)],
            neck: [-0.1, 0.5 * s(t * 8), 0],
            head: [-0.15, 0.2 * s(t * 11), 0],
            shoulderL: [-2.4 + 0.7 * s(t * 13), 0, 0.6 + 0.5 * s(t * 11)],
            shoulderR: [-2.4 + 0.7 * s(t * 13 + 2), 0, -0.6 - 0.5 * s(t * 12)],
            elbowL: [-0.6 + 0.5 * s(t * 15), 0, 0],
            elbowR: [-0.6 + 0.5 * s(t * 14), 0, 0],
            hipL: [-0.4 * Math.max(0, s(t * 12)), 0, 0.05],
            hipR: [-0.4 * Math.max(0, -s(t * 12)), 0, -0.05],
            kneeL: [0.7 * Math.max(0, s(t * 12)), 0, 0],
            kneeR: [0.7 * Math.max(0, -s(t * 12)), 0, 0],
          },
          rootY: 0.04 * Math.abs(s(t * 12)),
          mouth: 1,
          rate: 18,
        };
      case 'cower': {
        const tr = s(t * 40) * 0.02;
        return {
          j: {
            spine: [0.9 + tr, 0, 0],
            neck: [0.35, 0, 0],
            head: [0.2, 0, tr],
            shoulderL: [-2.5, -0.2, 0.35],
            shoulderR: [-2.5, 0.2, -0.35],
            elbowL: [-1.9, 0, 0],
            elbowR: [-1.9, 0, 0],
            hipL: [-1.35, 0, 0.12],
            hipR: [-1.35, 0, -0.12],
            kneeL: [2.0, 0, 0],
            kneeR: [2.0, 0, 0],
          },
          rootY: -v.hipHeight * 0.4,
          mouth: 0.6,
          rate: 10,
        };
      }
    }
  }

  const rig: RivalRig = {
    root,
    head,
    handLeft: body.handL,
    handRight: body.handR,
    update(dt, action) {
      if (stone >= 1) return;
      dt = Math.min(dt, 0.1);
      // animation slows as they petrify
      const k = 1 - stone * 0.9;
      dt *= k;
      t += dt;
      if (action === 'walk') gait += (dt * 1.3 * Math.PI * 2) / (v.hipHeight * 1.5);
      const p = pose(action);
      const rate = p.rate ?? 9;
      blender.apply(p.j, rate, dt);
      rootY = damp(rootY, p.rootY ?? 0, rate, dt);
      body.hips.position.y = body.hipHeight + rootY;
      mouthOpen = damp(mouthOpen, p.mouth ?? 0, 12, dt);
      mouthMesh.scale.set(1 - mouthOpen * 0.3, 1 + mouthOpen * 2.5, 1);
    },
    setStone(val) {
      stone = THREE.MathUtils.clamp(val, 0, 1);
      pet.set(stone);
    },
  };
  blender.snap(pose('idle').j);
  return rig;
}
