import * as THREE from 'three';
import { audio } from '../audio';
import { basic } from '../engine/psx';
import { buildStuffedMushroom, buildTomatoToast, buildWrappedWellington, TRAY_SIZE } from './bakeModels';
import type { IngredientKind } from './ingredients';
import type { Item, Items } from './items';

/**
 * Assemble-before-bake: parts are placed onto a base with the normal grab-and-place click.
 * Once every part is on, the base swaps to a combined model (tomato toast, stuffed mushroom,
 * a pastry-wrapped Wellington) and the parts ride along hidden, keeping their own cook state
 * for judging. Trays and the service trolley use the same carrying system with a simple grid.
 */

interface Part {
  kind: IngredientKind;
  chopped: boolean;
  /** Where it sits on the base, local to the base. */
  offset: [number, number, number];
}

export interface AssemblyRule {
  base: IngredientKind;
  baseChopped: boolean;
  parts: Part[];
  name: string;
  build: () => THREE.Group;
}

export const ASSEMBLIES: AssemblyRule[] = [
  {
    base: 'sourdough',
    baseChopped: true,
    parts: [{ kind: 'tomato', chopped: true, offset: [0, 0.024, 0] }],
    name: 'Tomato Toast',
    build: buildTomatoToast,
  },
  {
    base: 'mushroom',
    baseChopped: false,
    parts: [{ kind: 'cheese', chopped: true, offset: [0, 0.05, 0] }],
    name: 'Stuffed Mushroom',
    build: buildStuffedMushroom,
  },
  {
    base: 'pastry',
    baseChopped: false,
    parts: [
      { kind: 'beef', chopped: false, offset: [0, 0.012, -0.02] },
      { kind: 'mushroom', chopped: true, offset: [0, 0.03, 0.04] },
    ],
    name: 'Wellington (unbaked)',
    build: buildWrappedWellington,
  },
];

export function ruleFor(base: Item): AssemblyRule | undefined {
  return ASSEMBLIES.find((r) => r.base === base.kind && r.baseChopped === base.cook.chopped);
}

/** The part slot on `base` that `item` would fill, if any. */
export function partFor(base: Item, item: Item): Part | undefined {
  const rule = ruleFor(base);
  if (!rule || base.carrier?.kind === 'pastry') return undefined;
  return rule.parts.find((p) => p.kind === item.kind && !base.carried.some((c) => c.kind === p.kind) && (p.chopped ? item.cook.chopped : true));
}

/** True when `item` belongs on `base` but isn't ready yet (e.g. a whole tomato onto the toast). */
export function partNeedsPrep(base: Item, item: Item): boolean {
  const rule = ruleFor(base);
  return !!rule && rule.parts.some((p) => p.kind === item.kind && p.chopped && !item.cook.chopped);
}

export function isComplete(base: Item): boolean {
  const rule = ruleFor(base);
  return !!rule && rule.parts.every((p) => base.carried.some((c) => c.kind === p.kind));
}

/** Put a part onto its base. Returns true if that finished the assembly. */
export function assemble(base: Item, item: Item): boolean {
  const part = partFor(base, item);
  const rule = ruleFor(base);
  if (!part || !rule) return false;
  base.attach(item, new THREE.Vector3(...part.offset));
  audio.play('squish', { pos: base.group.position, volume: 0.5, pitch: 1.2 });
  if (!isComplete(base)) return false;
  // Every part is on: show the combined dish and tuck the parts away inside it.
  base.setVisual(rule.build(), rule.name);
  for (const c of base.carried) c.hiddenInAssembly = true;
  audio.play('plate', { pos: base.group.position, volume: 0.5, pitch: 1.4 });
  return true;
}

// ---------------------------------------------------------------- trays and the trolley

export const TRAY_COLS = 3;
export const TRAY_ROWS = 2;

/** Grid of resting spots on a carrier's top surface, local to the carrier. */
export function carrierSpots(carrier: Item, trolleyTop = 0.9, trolleySize = new THREE.Vector3(0.9, 1, 0.5)): THREE.Vector3[] {
  if (carrier.kind === 'tray') {
    const out: THREE.Vector3[] = [];
    for (let r = 0; r < TRAY_ROWS; r++)
      for (let c = 0; c < TRAY_COLS; c++)
        out.push(new THREE.Vector3(((c + 0.5) / TRAY_COLS - 0.5) * TRAY_SIZE.x * 0.9, 0.006, ((r + 0.5) / TRAY_ROWS - 0.5) * TRAY_SIZE.z * 0.85));
    return out;
  }
  const out: THREE.Vector3[] = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) out.push(new THREE.Vector3(((c + 0.5) / 3 - 0.5) * trolleySize.x * 0.85, trolleyTop + 0.005, ((r + 0.5) / 2 - 0.5) * trolleySize.z * 0.8));
  return out;
}

/** Free spot nearest the aim point (world), or null if the carrier is full. */
export function freeSpot(carrier: Item, spots: THREE.Vector3[], aim?: THREE.Vector3): THREE.Vector3 | null {
  const taken = carrier.carried.map((c) => c.carryOffset);
  const free = spots.filter((s) => !taken.some((t) => Math.hypot(t.x - s.x, t.z - s.z) < 0.02));
  if (!free.length) return null;
  if (!aim) return free[0];
  const local = carrier.group.worldToLocal(aim.clone());
  return free.sort((a, b) => Math.hypot(a.x - local.x, a.z - local.z) - Math.hypot(b.x - local.x, b.z - local.z))[0];
}

/** What can ride on what: food and assemblies on trays; food, trays and plates' worth of stuff on the trolley. */
export function canCarry(carrier: Item, item: Item): boolean {
  if (carrier === item || carrier.root() === item) return false;
  if (carrier.kind === 'tray') return item.isIngredient;
  if (carrier.kind === 'trolley') return item.isIngredient || item.kind === 'tray' || item.kind === 'plate';
  return false;
}

// ---------------------------------------------------------------- preview

/**
 * While you hold a part, every base it belongs on shows a pulsing ring and a ghost of where it goes,
 * so "what goes where" is never a guess.
 */
export class AssemblyPreview {
  private rings: THREE.Mesh[] = [];
  private mat = basic(0x7dff9a, { transparent: true, opacity: 0.7, side: THREE.DoubleSide });
  private time = 0;

  constructor(private scene: THREE.Scene) {}

  update(dt: number, held: Item | null, items: Items): void {
    this.time += dt;
    const targets: { base: Item; part: Part }[] = [];
    if (held?.isIngredient) {
      for (const it of items.list) {
        if (it === held || it.where === 'gone' || it.where === 'held' || it.hiddenInAssembly) continue;
        const part = partFor(it, held);
        if (part) targets.push({ base: it, part });
      }
    }
    while (this.rings.length < targets.length) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 24), this.mat);
      r.renderOrder = 5;
      (r.material as THREE.Material).depthTest = false;
      this.scene.add(r);
      this.rings.push(r);
    }
    this.mat.opacity = 0.45 + 0.35 * Math.sin(this.time * 6);
    this.rings.forEach((r, i) => {
      const t = targets[i];
      r.visible = !!t;
      if (!t) return;
      const p = new THREE.Vector3(...t.part.offset).add(new THREE.Vector3(0, 0.03, 0));
      t.base.group.localToWorld(p);
      r.position.copy(p);
      r.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      r.scale.setScalar(1 + 0.15 * Math.sin(this.time * 6));
    });
  }
}
