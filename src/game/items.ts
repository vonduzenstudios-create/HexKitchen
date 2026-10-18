import * as THREE from 'three';
import { RAPIER, Physics, GROUP, groups } from '../engine/physics';
import { mat, basic } from '../engine/psx';
import { canvasTexture } from '../engine/textures';
import { INGREDIENTS, type IngredientKind } from './ingredients';
import { freshCookState, type CookState } from './recipes';
import type { StationId } from './kitchen';

export type ItemKind = IngredientKind | 'mirrorPan';
export type ItemWhere = 'world' | 'held' | 'station' | 'hook' | 'gone';

const BURNT = new THREE.Color(0x1a1410);

function buildMirrorPan(): THREE.Group {
  const g = new THREE.Group();
  const shine = canvasTexture(32, 32, (c, w, h) => {
    const grad = c.createRadialGradient(w * 0.35, h * 0.35, 1, w / 2, h / 2, w / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, '#d8e4f0');
    grad.addColorStop(1, '#6a7888');
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(6, 22);
    c.lineTo(22, 6);
    c.stroke();
  });
  // The polished face points down local -Y; held vertically it faces outward.
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.04, 12), mat(0x9aa2aa));
  back.position.y = 0.02;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.155, 12), basic(0xffffff, { map: shine }));
  face.rotation.x = Math.PI / 2;
  face.position.y = -0.001;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.26), mat(0x2a1a10));
  handle.position.set(0, 0.03, 0.29);
  g.add(back, face, handle);
  return g;
}

export class Item {
  private static nextId = 1;
  readonly id = Item.nextId++;
  readonly group = new THREE.Group();
  visual: THREE.Object3D;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  cook: CookState = freshCookState();
  where: ItemWhere = 'world';
  /** Knocked about by Gorgon: landing on the floor afterwards doesn't count as the player's fault. */
  sabotaged = false;
  station: StationId | null = null;
  /** Small per-item state used by stations (e.g. pan flip animation). */
  anim = { flip: 0, flipSide: 0 };
  lastVy = 0;
  spawnTime = performance.now();
  private tints: THREE.Mesh[] = [];

  constructor(
    readonly kind: ItemKind,
    private physics: Physics,
    pos: THREE.Vector3,
  ) {
    this.visual = kind === 'mirrorPan' ? buildMirrorPan() : INGREDIENTS[kind].whole();
    this.group.add(this.visual);
    this.group.position.copy(pos);
    this.tagMeshes();
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(0.2)
      .setAngularDamping(0.6)
      .setCcdEnabled(true);
    this.body = physics.world.createRigidBody(desc);
    this.collider = this.makeCollider();
  }

  get isIngredient(): boolean {
    return this.kind !== 'mirrorPan';
  }

  get name(): string {
    if (this.kind === 'mirrorPan') return 'Polished Pan';
    const d = INGREDIENTS[this.kind];
    return this.cook.chopped ? d.choppedName : d.name;
  }

  private tagMeshes(): void {
    this.tints = [];
    this.visual.traverse((o) => {
      o.userData.itemId = this.id;
      if ((o as THREE.Mesh).isMesh && o.userData.tint) this.tints.push(o as THREE.Mesh);
    });
  }

  private makeCollider(): RAPIER.Collider {
    const box = new THREE.Box3().setFromObject(this.visual, true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3()).sub(this.group.position);
    const desc = RAPIER.ColliderDesc.cuboid(Math.max(0.02, size.x / 2), Math.max(0.012, size.y / 2), Math.max(0.02, size.z / 2))
      .setTranslation(center.x, center.y, center.z)
      .setDensity(this.kind === 'mirrorPan' ? 2.5 : 0.8)
      .setFriction(0.9)
      .setRestitution(0.15)
      .setCollisionGroups(groups(GROUP.ITEM, GROUP.STATIC | GROUP.ITEM | GROUP.STATUE | GROUP.PLAYER));
    return this.physics.world.createCollider(desc, this.body);
  }

  /** Swap to the chopped mesh and refit the collider. */
  setChopped(): void {
    if (this.kind === 'mirrorPan' || this.cook.chopped) return;
    this.cook.chopped = true;
    const rot = this.group.quaternion.clone();
    this.group.quaternion.identity();
    this.group.remove(this.visual);
    this.visual = INGREDIENTS[this.kind].chopped();
    this.group.add(this.visual);
    this.tagMeshes();
    this.physics.world.removeCollider(this.collider, false);
    this.collider = this.makeCollider();
    this.group.quaternion.copy(rot);
    this.refreshTint();
  }

  /** Doneness used for colouring: 0 raw, 1 cooked, 2 charcoal. */
  cookLevel(): number {
    const c = this.cook;
    return Math.max((c.fry[0] + c.fry[1]) / 2, c.boil * 0.6, c.deepfry);
  }

  refreshTint(): void {
    if (this.kind === 'mirrorPan') return;
    const cooked = new THREE.Color(INGREDIENTS[this.kind].cooked);
    const lvl = this.cookLevel();
    for (const m of this.tints) {
      const mm = m.material as THREE.MeshStandardMaterial;
      if (!m.userData.baseColor) m.userData.baseColor = mm.color.clone();
      const base = m.userData.baseColor as THREE.Color;
      mm.color.copy(base).lerp(cooked, Math.min(1, lvl));
      if (lvl > 1) mm.color.lerp(BURNT, Math.min(1, lvl - 1));
    }
  }

  setKinematic(on: boolean): void {
    this.body.setBodyType(on ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
  }

  /** Teleport/drive while kinematic. */
  drive(pos: THREE.Vector3, quat?: THREE.Quaternion): void {
    this.body.setNextKinematicTranslation(pos);
    if (quat) this.body.setNextKinematicRotation(quat);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.physics.world.removeRigidBody(this.body);
    this.where = 'gone';
  }
}

export class Items {
  readonly list: Item[] = [];
  onFloor: (item: Item) => void = () => {};
  onImpact: (item: Item, strength: number) => void = () => {};

  constructor(
    private scene: THREE.Scene,
    private physics: Physics,
  ) {}

  spawn(kind: ItemKind, pos: THREE.Vector3): Item {
    const it = new Item(kind, this.physics, pos);
    this.scene.add(it.group);
    this.list.push(it);
    return it;
  }

  remove(it: Item): void {
    const i = this.list.indexOf(it);
    if (i >= 0) this.list.splice(i, 1);
    it.dispose(this.scene);
  }

  byObject(o: THREE.Object3D | null): Item | undefined {
    while (o) {
      if (o.userData.itemId) return this.list.find((i) => i.id === o!.userData.itemId);
      o = o.parent;
    }
    return undefined;
  }

  meshes(): THREE.Object3D[] {
    return this.list.filter((i) => i.where !== 'held').map((i) => i.group);
  }

  update(): void {
    for (const it of this.list.slice()) {
      const t = it.body.translation();
      const r = it.body.rotation();
      it.group.position.set(t.x, t.y, t.z);
      it.group.quaternion.set(r.x, r.y, r.z, r.w);
      if (it.where !== 'world') {
        it.lastVy = 0;
        continue;
      }
      const v = it.body.linvel();
      // Impact: fast downward motion that suddenly stopped.
      if (it.lastVy < -1.3 && Math.abs(v.y) < Math.abs(it.lastVy) * 0.4) this.onImpact(it, Math.min(1, -it.lastVy / 5));
      it.lastVy = v.y;
      const speed = Math.hypot(v.x, v.y, v.z);
      if (t.y > 0.6 && speed < 0.2) it.sabotaged = false;
      if (t.y < 0.14 && speed < 0.6 && it.isIngredient && !it.cook.floor && !it.sabotaged) {
        it.cook.floor = true;
        this.onFloor(it);
      }
      if (t.y < -3) this.remove(it);
    }
  }
}
