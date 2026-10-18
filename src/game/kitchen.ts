import * as THREE from 'three';
import { buildKnife } from '../characters/knife';
import { buildMitt, buildPlate } from './plate';
import { Physics } from '../engine/physics';
import { mat, basic } from '../engine/psx';
import { tex } from '../engine/textures';
import type { IngredientKind } from './ingredients';

export const COUNTER_TOP = 0.9;

export type StationId = 'board' | 'prep' | 'pan' | 'pot' | 'fryer' | 'oven' | 'plateA' | 'plateB';

/** The hotel oven (Episode 2). Trays slide onto the rack; the door, light and clip-on timer are driven by the game. */
export interface OvenRig {
  group: THREE.Group;
  /** Where a tray rests on the rack inside (centre of the tray's base). */
  rack: THREE.Vector3;
  /** Floor point in front of the oven where the cook stands; Gorgon's Service Inspection walks here. */
  front: THREE.Vector3;
  /** 0 closed .. 1 fully open (hinged at the bottom, drops forward). */
  setDoor(open: number): void;
  /** Interior light; glow 0..1 warms the window as food browns. */
  setLight(on: boolean, glow: number): void;
  /** Clip-on timer display: seconds left, or null to show "--:--". ready=true flashes it. */
  setTimer(seconds: number | null, ready: boolean): void;
}

/** Episode 2 hotel set pieces. Behaviour lives in the game; the kitchen just builds and places them. */
export interface HotelSet {
  /** Spawn point (floor) of the rolling service trolley, and the trolley mesh (origin at floor centre, top shelf at trolleyTop). */
  trolley: { group: THREE.Group; spawn: THREE.Vector3; size: THREE.Vector3; top: number; locks: THREE.Object3D[] };
  /** Spring-loaded toaster on the counter: slot opening position and a lever you can animate (0 up .. 1 down). */
  toaster: { group: THREE.Group; slot: THREE.Vector3; setLever(t: number): void; setRattle(t: number): void };
  /** Desk bell on the pass (separate from the service bell used to serve). Clickable: userData.deskBell. */
  deskBell: THREE.Vector3;
  /** Ticket printer above the pass: where paper emerges, and a paper strip mesh to scale/extend. */
  printer: { group: THREE.Group; mouth: THREE.Vector3; paper: THREE.Mesh };
  /** Spots where sheet trays are stacked for the player to take. */
  trayRack: THREE.Vector3[];
  /** Petrified diners in the dining room beyond the hatch (head positions, for looking at / effects). */
  diners: THREE.Vector3[];
  /** Tall windows: call to change what's outside (0..1 "wrongness" for occasional reveals). */
  setWindows(t: number, reveal: number): void;
}


export interface Bin {
  kind: IngredientKind;
  pos: THREE.Vector3;
  mesh: THREE.Object3D;
}

export interface Kitchen {
  root: THREE.Group;
  /** Meshes the crosshair can target. userData: {station}, {bin}, {bell}, {hook}. */
  pickables: THREE.Object3D[];
  stations: Record<StationId, THREE.Vector3>;
  bins: Bin[];
  bell: THREE.Vector3;
  /** The plate shown on each pass spot when one has been set down. */
  passPlates: Record<'plateA' | 'plateB', THREE.Group>;
  plateStack: THREE.Vector3;
  /** Rickety storage shelf: bump into it at speed and everything on it comes down. */
  shelf: { group: THREE.Group; front: THREE.Vector3; spots: THREE.Vector3[] };
  /** Chef's knife resting beside the cutting board (hidden while it's in your hand). */
  boardKnife: THREE.Object3D;
  /** Trash can: centre of its base on the floor. */
  trash: THREE.Vector3;
  mirrorHook: THREE.Vector3;
  /** Counter spot where the fire extinguisher stands (defaults to beside the basement stove). */
  extinguisher?: THREE.Vector3;
  /** Episode 2 only. */
  oven?: OvenRig;
  hotel?: HotelSet;
  /** Oven mitts hanging by the stove; hidden while you're wearing them. */
  mitts: THREE.Group;
  spawn: THREE.Vector3;
  judgeSpot: THREE.Vector3;
  rivalSpots: THREE.Vector3[];
  statueSpots: THREE.Vector3[];
  door: { left: THREE.Object3D; right: THREE.Object3D; pos: THREE.Vector3 };
  lights: { fluoro: THREE.SpotLight[]; tubes: THREE.Mesh[]; pass: THREE.PointLight };
  waypoints: Waypoints;
  /** Flicker the fluorescents; dread 0..1 dims the room. */
  update(t: number, dread: number): void;
}

export interface Waypoints {
  nodes: Record<string, THREE.Vector3>;
  edges: [string, string][];
}

export function box(
  parent: THREE.Object3D,
  physics: Physics | null,
  center: [number, number, number],
  size: [number, number, number],
  material: THREE.Material,
): THREE.Mesh {
  // Subdivide into ~0.6 m cells: big triangles warp and jump badly under PS1 vertex snapping.
  const seg = (v: number) => Math.max(1, Math.ceil(v / 0.6));
  const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2], seg(size[0]), seg(size[1]), seg(size[2])), material);
  m.position.set(...center);
  parent.add(m);
  if (physics) physics.addBox({ x: center[0], y: center[1], z: center[2] }, { x: size[0], y: size[1], z: size[2] });
  return m;
}

/** A counter: cabinet body plus a slightly overhanging steel top. Collider covers both. */
export function counter(parent: THREE.Object3D, physics: Physics, x0: number, x1: number, z0: number, z1: number, body: THREE.Material, top: THREE.Material): void {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = x1 - x0;
  const d = z1 - z0;
  box(parent, null, [cx, (COUNTER_TOP - 0.05) / 2, cz], [w - 0.04, COUNTER_TOP - 0.05, d - 0.04], body);
  box(parent, null, [cx, COUNTER_TOP - 0.025, cz], [w, 0.05, d], top);
  physics.addBox({ x: cx, y: COUNTER_TOP / 2, z: cz }, { x: w, y: COUNTER_TOP, z: d });
}

export function buildKitchen(scene: THREE.Scene, physics: Physics, ingredientMeshes: Record<IngredientKind, () => THREE.Object3D>): Kitchen {
  const root = new THREE.Group();
  scene.add(root);
  const pickables: THREE.Object3D[] = [];

  const floorTex = tex.floor().clone();
  floorTex.repeat.set(6, 4.5);
  floorTex.needsUpdate = true;
  const wallTex = tex.drywall().clone();
  wallTex.repeat.set(5, 1.35);
  wallTex.needsUpdate = true;
  const steelTex = tex.steel();

  const mFloor = mat(0xffffff, { map: floorTex, roughness: 0.45 });
  const mWall = mat(0xffffff, { map: wallTex });
  const ceilTex = tex.ceiling().clone();
  ceilTex.repeat.set(8, 6);
  ceilTex.needsUpdate = true;
  const mCeil = mat(0xb0a898, { map: ceilTex });
  const mSteel = mat(0xd0d4d8, { map: steelTex, roughness: 0.3, metalness: 0.6 });
  const mCabinet = mat(0x9a9ea2, { map: steelTex, roughness: 0.45, metalness: 0.45 });
  const mDark = mat(0x1e1e22);
  const mWood = mat(0xffffff, { map: tex.wood() });

  // Room: x in [-6, 6], z in [-4, 5], height 3.2.
  const W = 12;
  const D = 9;
  const H = 3.2;
  const cz = 0.5;
  box(root, physics, [0, -0.1, cz], [W + 1, 0.2, D + 1], mFloor);
  box(root, null, [0, H + 0.1, cz], [W, 0.2, D], mCeil);
  // Basement guts: exposed joists, ductwork and dripping pipes across the ceiling.
  const mJoist = mat(0x6a5236, { map: tex.wood() });
  for (let x = -5.5; x <= 5.5; x += 1.1) box(root, null, [x, H - 0.09, cz], [0.08, 0.18, D], mJoist);
  const mPipe = mat(0x5a5e60);
  const mCopper = mat(0x9a5a30);
  for (const [z, r, m] of [
    [-2.9, 0.05, mPipe],
    [-2.6, 0.03, mCopper],
    [1.2, 0.04, mCopper],
  ] as [number, number, THREE.Material][]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, W, 6, 16), m);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, H - 0.26, z);
    root.add(pipe);
  }
  box(root, null, [-2.0, H - 0.35, 3.3], [0.5, 0.3, D * 0.35], mat(0x8a8e90, { map: steelTex }));
  box(root, physics, [0, H / 2, -4.1], [W, H, 0.2], mWall);
  box(root, physics, [0, H / 2, 5.1], [W, H, 0.2], mWall);
  box(root, physics, [-6.1, H / 2, cz], [0.2, H, D], mWall);
  // East wall with a doorway at z in [1.8, 3.2].
  box(root, physics, [6.1, H / 2, (-4 + 1.8) / 2], [0.2, H, 5.8], mWall);
  box(root, physics, [6.1, H / 2, (3.2 + 5) / 2], [0.2, H, 1.8], mWall);
  box(root, null, [6.1, 2.6, 2.5], [0.2, 1.2, 1.4], mWall);
  physics.addBox({ x: 6.1, y: 1.2, z: 2.5 }, { x: 0.2, y: 2.4, z: 1.4 }); // keep the player in
  // Swinging doors (visual only; Gorgon walks through them).
  const doorMat = mat(0x7d6a4a, { map: tex.wood() });
  const doorL = new THREE.Group();
  const doorR = new THREE.Group();
  doorL.position.set(6.05, 0, 1.8);
  doorR.position.set(6.05, 0, 3.2);
  box(doorL, null, [0, 1.05, 0.35], [0.06, 1.9, 0.7], doorMat);
  box(doorR, null, [0, 1.05, -0.35], [0.06, 1.9, 0.7], doorMat);
  const porthole = basic(0xffe9a8);
  box(doorL, null, [-0.04, 1.45, 0.35], [0.02, 0.22, 0.22], porthole);
  box(doorR, null, [-0.04, 1.45, -0.35], [0.02, 0.22, 0.22], porthole);
  root.add(doorL, doorR);

  // Back counter (player line) z in [-4, -3.3], x in [-4, 3]: board, prep, stove, fryer.
  counter(root, physics, -4, -0.3, -4, -3.3, mCabinet, mSteel);
  counter(root, physics, 2.4, 3.0, -4, -3.3, mCabinet, mSteel);
  // Stove block x in [-0.3, 2.4].
  box(root, null, [1.05, 0.45, -3.65], [2.7, 0.9, 0.7], mDark);
  physics.addBox({ x: 1.05, y: 0.45, z: -3.65 }, { x: 2.7, y: 0.9, z: 0.7 });
  box(root, null, [1.05, 0.905, -3.65], [2.7, 0.02, 0.7], mat(0xffffff, { map: tex.stoveTop() }));
  // Oven door + knobs for flavour.
  box(root, null, [0.4, 0.45, -3.29], [1.2, 0.5, 0.02], mat(0x0f0f10));
  for (let i = 0; i < 4; i++) box(root, null, [-0.1 + i * 0.3, 0.8, -3.28], [0.06, 0.06, 0.05], mat(0xb0b0b0));
  // Backsplash hood above the stove.
  box(root, null, [1.05, 2.55, -3.7], [2.8, 0.5, 0.8], mSteel);

  const stations: Record<StationId, THREE.Vector3> = {
    board: new THREE.Vector3(-2.6, COUNTER_TOP, -3.6),
    prep: new THREE.Vector3(-1.2, COUNTER_TOP, -3.6),
    pan: new THREE.Vector3(0.15, COUNTER_TOP + 0.03, -3.6),
    pot: new THREE.Vector3(0.95, COUNTER_TOP, -3.6),
    fryer: new THREE.Vector3(1.85, COUNTER_TOP, -3.6),
    // No working oven in the basement.
    oven: new THREE.Vector3(0, -20, 0),
    plateA: new THREE.Vector3(3.35, COUNTER_TOP, -2.5),
    plateB: new THREE.Vector3(3.35, COUNTER_TOP, -1.4),
  };

  const tag = (o: THREE.Object3D, data: Record<string, unknown>) => {
    o.userData = { ...o.userData, ...data };
    pickables.push(o);
    return o;
  };

  // Cutting board.
  tag(box(root, null, [stations.board.x, COUNTER_TOP + 0.02, stations.board.z], [0.7, 0.04, 0.45], mWood), { station: 'board' });
  const boardKnife = buildKnife();
  boardKnife.rotation.set(0, Math.PI / 2 + 0.15, Math.PI / 2);
  boardKnife.position.set(stations.board.x + 0.05, COUNTER_TOP + 0.046, stations.board.z + 0.17);
  root.add(boardKnife);
  // Prep tray with shaker props.
  tag(box(root, null, [stations.prep.x, COUNTER_TOP + 0.01, stations.prep.z], [0.6, 0.02, 0.45], mat(0x3d5a7a)), { station: 'prep' });
  const shakerSalt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.13, 6), mat(0xeeeeee));
  shakerSalt.position.set(stations.prep.x + 0.35, COUNTER_TOP + 0.065, stations.prep.z - 0.15);
  const shakerPep = shakerSalt.clone();
  shakerPep.material = mat(0x333333);
  shakerPep.position.x += 0.1;
  root.add(shakerSalt, shakerPep);
  // Frying pan (fixed on the burner).
  const pan = new THREE.Group();
  pan.position.copy(stations.pan);
  const panBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.05, 10), mat(0x2a2a2e));
  panBase.position.y = 0.025;
  const panHandle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.04), mat(0x161616));
  panHandle.position.set(0, 0.04, 0.32);
  panHandle.rotation.y = Math.PI / 2;
  pan.add(panBase, panHandle);
  root.add(pan);
  tag(panBase, { station: 'pan' });
  // Burner glow rings.
  const burnerGlow = basic(0xff5a1a, { transparent: true, opacity: 0.7 });
  for (const sx of [stations.pan.x, stations.pot.x]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 4, 12), burnerGlow);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(sx, COUNTER_TOP + 0.012, -3.6);
    root.add(ring);
  }
  // Stock pot with water.
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.3, 10, 1, true), mat(0xb8bcc0, { map: steelTex, side: THREE.DoubleSide }));
  pot.position.set(stations.pot.x, COUNTER_TOP + 0.15, stations.pot.z);
  root.add(pot);
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.21, 10), basic(0x6f8fa0, { transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(stations.pot.x, COUNTER_TOP + 0.25, stations.pot.z);
  root.add(water);
  tag(water, { station: 'pot' });
  physics.addCylinder({ x: stations.pot.x, y: COUNTER_TOP + 0.1, z: stations.pot.z }, 0.1, 0.22);
  // Deep fryer: a steel box with golden oil.
  box(root, null, [stations.fryer.x, COUNTER_TOP + 0.1, stations.fryer.z], [0.5, 0.2, 0.45], mSteel);
  physics.addBox({ x: stations.fryer.x, y: COUNTER_TOP + 0.05, z: stations.fryer.z }, { x: 0.5, y: 0.1, z: 0.45 });
  const oil = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.37), basic(0xc8901e));
  oil.rotation.x = -Math.PI / 2;
  oil.position.set(stations.fryer.x, COUNTER_TOP + 0.205, stations.fryer.z);
  root.add(oil);
  tag(oil, { station: 'fryer' });

  // Pass / plating counter along z, x in [3, 3.7], z in [-4, 0.5].
  counter(root, physics, 3.0, 3.7, -4, 0.5, mCabinet, mSteel);
  // Heat lamps.
  for (const z of [stations.plateA.z, stations.plateB.z]) {
    box(root, null, [3.35, 1.75, z], [0.5, 0.06, 0.3], mDark);
    box(root, null, [3.35, 1.71, z], [0.42, 0.02, 0.22], basic(0xff8a3a));
  }
  box(root, null, [3.35, 1.8, -1.95], [0.04, 0.04, 2.0], mDark);
  // Each pass spot has a rubber mat; a plate appears on it once you set one down from the stack.
  const passPlates = {} as Record<'plateA' | 'plateB', THREE.Group>;
  for (const id of ['plateA', 'plateB'] as const) {
    const p = stations[id];
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.008, 0.56), mat(0x1c1c1c, { roughness: 0.9 }));
    pad.position.set(p.x, COUNTER_TOP + 0.004, p.z);
    root.add(pad);
    tag(pad, { station: id });
    const plate = buildPlate();
    plate.position.set(p.x, COUNTER_TOP + 0.008, p.z);
    plate.visible = false;
    plate.children.forEach((c) => tag(c, { station: id }));
    root.add(plate);
    passPlates[id] = plate;
  }
  // Stack of clean plates at the back of the pass. Click it to take one.
  const plateStack = new THREE.Vector3(3.35, COUNTER_TOP, -3.45);
  for (let i = 0; i < 6; i++) {
    const pl = buildPlate();
    pl.position.set(plateStack.x, COUNTER_TOP + i * 0.026, plateStack.z);
    pl.rotation.y = i * 0.7;
    pl.children.forEach((c) => tag(c, { plateStack: true }));
    root.add(pl);
  }
  physics.addCylinder({ x: plateStack.x, y: COUNTER_TOP + 0.08, z: plateStack.z }, 0.08, 0.24);
  // Service bell.
  const bell = new THREE.Vector3(3.35, COUNTER_TOP, -0.3);
  const bellG = new THREE.Group();
  bellG.position.copy(bell);
  const bellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 8), mat(0x222222));
  bellBase.position.y = 0.01;
  const bellDome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe8c040));
  bellDome.position.y = 0.02;
  const bellBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 4), mat(0x888888));
  bellBtn.position.y = 0.09;
  bellG.add(bellBase, bellDome, bellBtn);
  root.add(bellG);
  tag(bellDome, { bell: true });
  // Rickety wire storage shelf against the west wall, south of the pantry.
  const shelfG = new THREE.Group();
  shelfG.position.set(-5.68, 0, 2.9);
  const mWire = mat(0xb8bcc0, { roughness: 0.35, metalness: 0.8 });
  for (const [dx, dz] of [[-0.2, -0.5], [-0.2, 0.5], [0.2, -0.5], [0.2, 0.5]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.8, 10), mWire);
    post.position.set(dx, 0.9, dz);
    shelfG.add(post);
  }
  const shelfSpots: THREE.Vector3[] = [];
  for (const y of [0.45, 0.95, 1.45]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 1.04), mWire);
    board.position.y = y;
    shelfG.add(board);
    physics.addBox({ x: shelfG.position.x, y, z: shelfG.position.z }, { x: 0.44, y: 0.02, z: 1.04 });
    for (const dz of [-0.3, 0, 0.3]) shelfSpots.push(new THREE.Vector3(shelfG.position.x + 0.02, y + 0.12, shelfG.position.z + dz));
  }
  root.add(shelfG);
  physics.addBox({ x: shelfG.position.x - 0.22, y: 0.9, z: shelfG.position.z }, { x: 0.04, y: 1.8, z: 1.04 });
  const shelfSign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.12), basic(0xffffff, { map: tex.sign('DO NOT LEAN', '#202020', '#e8c020', 128, 32) }));
  shelfSign.position.set(shelfG.position.x + 0.23, 1.68, shelfG.position.z);
  shelfSign.rotation.y = Math.PI / 2;
  root.add(shelfSign);

  // Trash can by the cutting board, for hiding dropped food before Gorgon sees it.
  const trash = new THREE.Vector3(-4.5, 0, -2.95);
  const trashG = new THREE.Group();
  trashG.position.copy(trash);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.72, 24, 1, true), mat(0x3a4a3a, { roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
  can.position.y = 0.36;
  const canBottom = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), mat(0x1a1a1a));
  canBottom.rotation.x = -Math.PI / 2;
  canBottom.position.y = 0.02;
  const canRim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.018, 8, 24), mat(0x5a6a5a, { roughness: 0.4, metalness: 0.5 }));
  canRim.rotation.x = Math.PI / 2;
  canRim.position.y = 0.72;
  const binBag = new THREE.Mesh(new THREE.CircleGeometry(0.24, 24), mat(0x111111, { roughness: 0.3 }));
  binBag.rotation.x = -Math.PI / 2;
  binBag.position.y = 0.55;
  trashG.add(can, canBottom, canRim, binBag);
  root.add(trashG);
  [can, canRim, binBag].forEach((m) => tag(m, { trash: true }));
  const trashSign = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.1), basic(0xffffff, { map: tex.sign('TRASH', '#e8e8e8', '#2a3a2a', 96, 28) }));
  trashSign.position.set(trash.x, 0.45, trash.z + 0.255);
  root.add(trashSign);
  physics.addCylinder({ x: trash.x, y: 0.2, z: trash.z }, 0.2, 0.26);

  // Order rail with ticket clips above the pass.
  box(root, null, [3.0, 1.55, -1.95], [0.03, 0.04, 2.6], mSteel);

  // Pantry: low counter along west wall with ingredient crates.
  counter(root, physics, -5.9, -5.0, -2.6, 1.6, mCabinet, mSteel);
  const binKinds: IngredientKind[] = ['lettuce', 'bread', 'tomato', 'potato', 'pasta', 'steak', 'beef', 'mushroom', 'greens'];
  const bins: Bin[] = [];
  const crateMat = mat(0x8a6a3a, { map: tex.wood() });
  binKinds.forEach((kind, i) => {
    const z = -2.25 + i * 0.44;
    const crate = new THREE.Group();
    crate.position.set(-5.45, COUNTER_TOP, z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.38), crateMat);
    base.position.y = 0.07;
    crate.add(base);
    // Two sample ingredients in each crate so players can read what is inside.
    for (let k = 0; k < 2; k++) {
      const sample = ingredientMeshes[kind]();
      sample.position.set(-0.1 + k * 0.2, 0.16, 0);
      sample.rotation.y = k * 1.3;
      sample.scale.setScalar(0.85);
      crate.add(sample);
    }
    root.add(crate);
    tag(base, { bin: kind });
    crate.children.forEach((c) => c !== base && tag(c, { bin: kind }));
    bins.push({ kind, pos: crate.position.clone(), mesh: crate });
  });
  const pantrySign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), basic(0xffffff, { map: tex.sign('PANTRY', '#f0e6c8', '#2e3a2a') }));
  pantrySign.position.set(-5.98, 2.0, -0.4);
  pantrySign.rotation.y = Math.PI / 2;
  root.add(pantrySign);
  // Fridge.
  box(root, physics, [-5.4, 1.0, -3.4], [1.0, 2.0, 1.0], mat(0xc9ccc4, { map: steelTex }));
  box(root, null, [-4.88, 1.2, -3.15], [0.04, 0.5, 0.05], mDark);

  // Mirror pan hook on the back wall, above the board.
  // Oven mitts on a hook beside the stove hood.
  const mitts = new THREE.Group();
  mitts.position.set(-0.55, 1.2, -3.9);
  for (const dx of [-0.07, 0.07]) {
    const m = buildMitt();
    m.position.x = dx;
    m.rotation.set(Math.PI, 0, dx * 1.5);
    m.position.y = 0.27;
    mitts.add(m);
  }
  box(root, null, [mitts.position.x, mitts.position.y + 0.3, -3.98], [0.05, 0.05, 0.08], mDark);
  mitts.traverse((o) => (o as THREE.Mesh).isMesh && tag(o, { mitts: true }));
  root.add(mitts);
  const mirrorHook = new THREE.Vector3(-3.55, 1.45, -3.92);
  box(root, null, [mirrorHook.x, mirrorHook.y + 0.32, -3.98], [0.05, 0.05, 0.08], mDark);

  // Centre island, also gaze cover.
  counter(root, physics, -2.5, 1.5, -0.2, 0.6, mCabinet, mSteel);
  // South counter for the rivals.
  counter(root, physics, -4, 3, 3.6, 4.3, mCabinet, mSteel);
  for (const x of [-2.8, -0.6, 1.6]) {
    box(root, null, [x, COUNTER_TOP + 0.02, 3.95], [0.6, 0.04, 0.4], mWood);
    box(root, null, [x + 0.45, COUNTER_TOP + 0.08, 3.9], [0.26, 0.14, 0.26], mat(0x444448));
  }

  // Studio dressing: the show sign above the stove and a TV camera on a tripod.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), basic(0xffffff, { map: tex.sign('HEX KITCHEN', '#ffd23a', '#5a0808', 256, 64) }));
  sign.position.set(1.05, 2.4, -3.29);
  root.add(sign);
  const cam = new THREE.Group();
  cam.position.set(5.0, 0, -3.4);
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 4), mDark);
    const a = (i / 3) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 0.2, 0.7, Math.sin(a) * 0.2);
    leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    cam.add(leg);
  }
  const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.5), mat(0x2c2c30));
  camBody.position.y = 1.55;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.2, 8), mat(0x111111));
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 1.55, 0.33);
  const tally = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), basic(0xff2020));
  tally.position.set(0, 1.74, 0.2);
  cam.add(camBody, lens, tally);
  cam.rotation.y = -0.9;
  root.add(cam);
  physics.addBox({ x: 5.0, y: 0.8, z: -3.4 }, { x: 0.5, y: 1.6, z: 0.5 });
  // Mop bucket and a cursed "DAYS WITHOUT PETRIFICATION: 0" board.
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), basic(0xffffff, { map: tex.sign('DAYS SAFE: 0', '#e8e8e8', '#202830', 128, 48) }));
  board.position.set(-3.0, 2.0, 5.0);
  board.rotation.y = Math.PI;
  root.add(board);

  // Lighting: dim ambient, flickering fluorescents, warm spotlight on the pass.
  scene.add(new THREE.HemisphereLight(0x8a90a0, 0x2a2018, 0.45));
  const fluoro: THREE.SpotLight[] = [];
  const tubes: THREE.Mesh[] = [];
  const tubeMat = () => basic(0xf2f6e0);
  for (const [x, z] of [
    [-3, -2],
    [1, -2],
    [-1.5, 2.2],
    [3.5, 1.5],
  ]) {
    // Shop lights are wide shadow-casting spots hanging just under the tubes.
    const l = new THREE.SpotLight(0xf0f4d8, 16, 11, 1.25, 0.85, 1.6);
    l.position.set(x, H - 0.47, z);
    l.target.position.set(x, 0, z);
    l.castShadow = true;
    l.shadow.mapSize.set(1024, 1024);
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.shadow.camera.near = 0.2;
    l.shadow.camera.far = 11;
    scene.add(l, l.target);
    fluoro.push(l);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.2), tubeMat());
    // Hanging chains for the shop lights.
    for (const cx of [-0.6, 0.6]) {
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.36, 0.015), mDark);
      chain.userData.noShadow = true;
      chain.position.set(x + cx, H - 0.24, z);
      root.add(chain);
    }
    tube.position.set(x, H - 0.42, z);
    tube.userData.noShadow = true;
    root.add(tube);
    tubes.push(tube);
  }
  const passLight = new THREE.PointLight(0xffb060, 2.6, 3.5, 1.6);
  passLight.position.set(3.35, 1.6, -1.9);
  scene.add(passLight);
  scene.fog = new THREE.Fog(0x0b0a08, 9, 24);
  scene.background = new THREE.Color(0x0b0a08);

  const waypoints: Waypoints = {
    nodes: {
      offstage: new THREE.Vector3(8.5, 0, 2.5),
      door: new THREE.Vector3(5.4, 0, 2.5),
      east: new THREE.Vector3(4.4, 0, 1.3),
      judge: new THREE.Vector3(4.35, 0, -1.9),
      southE: new THREE.Vector3(2.3, 0, 2.0),
      southM: new THREE.Vector3(-0.5, 0, 2.0),
      southW: new THREE.Vector3(-3.4, 0, 2.0),
      west: new THREE.Vector3(-4.0, 0, 0.2),
      backW: new THREE.Vector3(-3.6, 0, -1.7),
      backM: new THREE.Vector3(-1.6, 0, -1.7),
      backC: new THREE.Vector3(0.6, 0, -1.7),
      backE: new THREE.Vector3(2.3, 0, -1.7),
    },
    edges: [
      ['offstage', 'door'],
      ['door', 'east'],
      ['east', 'judge'],
      ['east', 'southE'],
      ['southE', 'southM'],
      ['southM', 'southW'],
      ['southW', 'west'],
      ['west', 'backW'],
      ['backW', 'backM'],
      ['backM', 'backC'],
      ['backC', 'backE'],
      ['backE', 'southE'],
    ],
  };

  let flickerTimer = 0;
  return {
    root,
    pickables,
    stations,
    bins,
    bell,
    shelf: { group: shelfG, front: new THREE.Vector3(shelfG.position.x + 0.5, 0, shelfG.position.z), spots: shelfSpots },
    passPlates,
    plateStack,
    boardKnife,
    trash,
    mirrorHook,
    mitts,
    spawn: new THREE.Vector3(-1.0, 0, -2.2),
    judgeSpot: waypoints.nodes.judge,
    rivalSpots: [new THREE.Vector3(-2.8, 0, 3.15), new THREE.Vector3(-0.6, 0, 3.15), new THREE.Vector3(1.6, 0, 3.15)],
    statueSpots: [new THREE.Vector3(2.35, 0, -0.9), new THREE.Vector3(-3.7, 0, -0.9), new THREE.Vector3(-0.6, 0, -1.25)],
    door: { left: doorL, right: doorR, pos: new THREE.Vector3(6, 0, 2.5) },
    lights: { fluoro, tubes, pass: passLight },
    waypoints,
    update(t: number, dread: number) {
      flickerTimer -= 1 / 60;
      fluoro.forEach((l, i) => {
        let on = 1;
        // Occasional stutters; more often as dread rises.
        const s = Math.sin(t * (7 + i * 3.1)) * Math.sin(t * (1.3 + i));
        if (s > 0.97 - dread * 0.25) on = 0.15;
        l.intensity = (16 - dread * 7) * on;
        (tubes[i].material as THREE.MeshBasicMaterial).color.setScalar(0.35 + 0.6 * on);
      });
      passLight.intensity = 2.6 + Math.sin(t * 3) * 0.15;
    },
  };
}
