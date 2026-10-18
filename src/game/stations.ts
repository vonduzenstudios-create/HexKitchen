import * as THREE from 'three';
import { audio, type LoopHandle } from '../audio';
import type { Input } from '../engine/input';
import { basic } from '../engine/psx';
import { INGREDIENTS } from './ingredients';
import type { Item, Items } from './items';
import { COUNTER_TOP, type Kitchen, type StationId } from './kitchen';
import type { Particles } from './particles';
import { SEASON_TARGET, SEASON_WINDOW, type Recipe, type PlatedItem } from './recipes';

export const CHOPS_NEEDED = 5;
const BEAT = 0.75; // seconds between chop beats
const PAN_RATE = 1 / 6.5; // doneness per second on the down side
const BOIL_RATE = 1 / 7;
const FRY_RATE = 1 / 6;

export type PlateId = 'plateA' | 'plateB';
export const WORKABLE: StationId[] = ['board', 'prep', 'pan'];

export interface Ticket {
  id: number;
  recipe: Recipe;
  plate: PlateId;
  served: boolean;
  /** Seconds since the ticket appeared, for HUD ageing. */
  age: number;
}

export interface Gauge {
  title: string;
  hint: string;
  value: number;
  max: number;
  zone?: [number, number];
  beat?: number; // 0..1 pulse for the chop rhythm
  sub?: string;
}

export interface StationEvents {
  chop(quality: number, item: Item): void;
  chopDone(item: Item, avg: number): void;
  flip(item: Item): void;
  flipFail(item: Item): void;
  burning(item: Item): void;
  fire(station: StationId): void;
  shakerLid(item: Item): void;
}

interface Slot {
  kind: string;
  offset: THREE.Vector3;
  item: Item | null;
  placement: number;
  ghost: THREE.Mesh;
}

const SLOT_LAYOUT: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-0.09, 0.02],
    [0.09, -0.02],
  ],
  3: [
    [-0.1, 0.06],
    [0.1, 0.06],
    [0, -0.1],
  ],
};

export class Stations {
  readonly occupant: Record<StationId, Item[]> = { board: [], prep: [], pan: [], pot: [], fryer: [], plateA: [], plateB: [] };
  readonly plates: Record<PlateId, { ticket: Ticket | null; slots: Slot[] }> = {
    plateA: { ticket: null, slots: [] },
    plateB: { ticket: null, slots: [] },
  };
  fireAt: StationId | null = null;
  private loops: Partial<Record<'sizzle' | 'boil' | 'fryer' | 'fire', LoopHandle>> = {};
  private time = 0;
  private dyHist: number[] = [0, 0, 0];
  private chopArmed = true;
  private flipArmed = true;
  private lastDxSign = 0;
  private shakeSoundCd = 0;
  private burnWarned = new Set<number>();

  constructor(
    private scene: THREE.Scene,
    private kitchen: Kitchen,
    private items: Items,
    private particles: Particles,
    private events: StationEvents,
  ) {}

  startAmbientLoops(): void {
    const s = this.kitchen.stations;
    this.loops.sizzle = audio.loop('sizzle', { pos: s.pan, volume: 0 });
    this.loops.boil = audio.loop('boil', { pos: s.pot, volume: 0.15 });
    this.loops.fryer = audio.loop('fryer', { pos: s.fryer, volume: 0.05 });
    this.loops.fire = audio.loop('fire', { pos: s.pan, volume: 0 });
  }

  stopLoops(): void {
    Object.values(this.loops).forEach((l) => l?.stop());
    this.loops = {};
  }

  stationOf(item: Item): StationId | null {
    return item.where === 'station' ? item.station : null;
  }

  isFull(id: StationId): boolean {
    if (id === 'plateA' || id === 'plateB') {
      const p = this.plates[id];
      if (!p.ticket) return this.occupant[id].length >= 4;
      return p.slots.every((s) => s.item);
    }
    return this.occupant[id].length >= 1;
  }

  canPlace(id: StationId, item: Item): boolean {
    if (!item.isIngredient) return false;
    return !this.isFull(id);
  }

  /** Put an item into a station. aim is where the crosshair hit, for plating accuracy. */
  place(id: StationId, item: Item, aim?: THREE.Vector3): void {
    item.where = 'station';
    item.station = id;
    item.setKinematic(true);
    item.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.occupant[id].push(item);
    const base = this.kitchen.stations[id];
    if (id === 'plateA' || id === 'plateB') {
      const plate = this.plates[id];
      const center = new THREE.Vector3(base.x, COUNTER_TOP + 0.028, base.z);
      if (plate.ticket) {
        const free = plate.slots.filter((s) => !s.item);
        let slot = free.find((s) => s.kind === item.kind);
        if (!slot && aim) {
          slot = free.slice().sort((a, b) => center.clone().add(a.offset).distanceTo(aim) - center.clone().add(b.offset).distanceTo(aim))[0];
        }
        slot = slot ?? free[0];
        const target = center.clone().add(slot.offset);
        const d = aim ? Math.hypot(aim.x - target.x, aim.z - target.z) : 0.1;
        slot.item = item;
        slot.placement = Math.max(0.4, Math.min(1, 1 - (d - 0.04) / 0.3));
        slot.ghost.visible = false;
        item.drive(target, new THREE.Quaternion());
        audio.play('plate', { pos: target, volume: 0.7 });
      } else {
        const off = aim ? new THREE.Vector3(aim.x - center.x, 0, aim.z - center.z).clampLength(0, 0.14) : new THREE.Vector3();
        item.drive(center.add(off), new THREE.Quaternion());
        audio.play('plate', { pos: center, volume: 0.6 });
      }
      return;
    }
    item.drive(this.restPos(id), new THREE.Quaternion());
    audio.play(id === 'pot' || id === 'fryer' ? 'splash' : 'drop', { pos: base, volume: 0.6 });
    if (id === 'pan' || id === 'fryer') audio.play('fireIgnite', { pos: base, volume: 0.25 });
  }

  private restPos(id: StationId): THREE.Vector3 {
    const b = this.kitchen.stations[id];
    const y = { board: COUNTER_TOP + 0.045, prep: COUNTER_TOP + 0.025, pan: COUNTER_TOP + 0.08, pot: COUNTER_TOP + 0.16, fryer: COUNTER_TOP + 0.15 }[
      id as 'board'
    ];
    return new THREE.Vector3(b.x, y ?? COUNTER_TOP + 0.03, b.z);
  }

  /** Remove an item from whatever station holds it (it is being grabbed or knocked away). */
  take(item: Item): void {
    if (item.where !== 'station' || !item.station) return;
    const id = item.station;
    const list = this.occupant[id];
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
    if (id === 'plateA' || id === 'plateB') {
      for (const s of this.plates[id].slots) if (s.item === item) {
        s.item = null;
        s.ghost.visible = true;
      }
    }
    if (this.fireAt === id) this.fireAt = null;
    item.station = null;
    item.where = 'world';
  }

  assignTicket(plate: PlateId, ticket: Ticket | null): void {
    const p = this.plates[plate];
    for (const s of p.slots) this.scene.remove(s.ghost);
    p.slots = [];
    p.ticket = ticket;
    if (!ticket) return;
    const base = this.kitchen.stations[plate];
    const layout = SLOT_LAYOUT[ticket.recipe.components.length] ?? SLOT_LAYOUT[3];
    ticket.recipe.components.forEach((c, i) => {
      const [x, z] = layout[i];
      const ghost = new THREE.Mesh(
        new THREE.RingGeometry(0.035, 0.05, 8),
        basic(INGREDIENTS[c.kind].raw, { transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      );
      ghost.rotation.x = -Math.PI / 2;
      // The pass is approached from -X, so lay slots out in the plate's local frame accordingly.
      const offset = new THREE.Vector3(z, 0, -x);
      ghost.position.set(base.x + offset.x, COUNTER_TOP + 0.03, base.z + offset.z);
      this.scene.add(ghost);
      p.slots.push({ kind: c.kind, offset, item: null, placement: 0, ghost });
    });
  }

  /** Take everything off a plate for judging. */
  collectPlate(plate: PlateId): PlatedItem[] {
    const p = this.plates[plate];
    const out: PlatedItem[] = [];
    const items = this.occupant[plate].slice();
    for (const it of items) {
      if (!it.isIngredient) continue;
      const slot = p.slots.find((s) => s.item === it);
      out.push({ kind: it.kind as PlatedItem['kind'], cook: { ...it.cook, fry: [...it.cook.fry] as [number, number] }, placement: slot ? slot.placement : 0.6 });
      this.take(it);
      this.items.remove(it);
    }
    return out;
  }

  /** Gorgon's sabotage: knock everything off a station with an impulse. */
  /** Sabotage: slide one item along the counter away from Gorgon. It stays on the counter and clean. */
  shove(id: StationId, from: THREE.Vector3): Item | null {
    const it = this.occupant[id][0];
    if (!it) return null;
    this.take(it);
    it.setKinematic(false);
    it.sabotaged = true;
    const dir = it.group.position.clone().sub(from).setY(0).normalize();
    // Push mostly sideways along the counter (x), barely toward the wall, with a small hop.
    const side = Math.sign(dir.x || Math.random() - 0.5);
    it.body.setLinvel({ x: side * (1.2 + Math.random() * 0.4), y: 1.2, z: -0.3 }, true);
    it.body.setAngvel({ x: Math.random() * 4, y: Math.random() * 6, z: Math.random() * 4 }, true);
    return it;
  }

  knock(id: StationId, from: THREE.Vector3): Item[] {
    const knocked = this.occupant[id].slice();
    for (const it of knocked) {
      this.take(it);
      it.setKinematic(false);
      const dir = it.group.position.clone().sub(from).setY(0).normalize();
      it.body.setLinvel({ x: dir.x * 2.5 + (Math.random() - 0.5), y: 3 + Math.random() * 1.5, z: dir.z * 2.5 + (Math.random() - 0.5) }, true);
      it.body.setAngvel({ x: Math.random() * 10, y: Math.random() * 10, z: Math.random() * 10 }, true);
    }
    return knocked;
  }

  update(dt: number): void {
    this.time += dt;
    this.shakeSoundCd -= dt;
    const s = this.kitchen.stations;

    // Pan: cook the down side, animate flips, smoke and fire.
    const panItem = this.occupant.pan[0];
    if (panItem) {
      const down = panItem.anim.flipSide;
      panItem.cook.fry[down] += dt * PAN_RATE;
      panItem.refreshTint();
      const lvl = panItem.cook.fry[down];
      const rest = this.restPos('pan');
      let q = new THREE.Quaternion();
      if (panItem.anim.flip > 0) {
        panItem.anim.flip = Math.max(0, panItem.anim.flip - dt / 0.45);
        const k = 1 - panItem.anim.flip;
        rest.y += Math.sin(Math.PI * k) * 0.28;
        q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * k);
      }
      panItem.drive(rest, q);
      if (Math.random() < dt * 12) this.particles.emit(s.pan.clone().setY(s.pan.y + 0.1), { color: lvl > 1.3 ? 0x3a3a3a : 0xdddddd, count: 1, up: 0.5, speed: 0.08, life: 1.2 });
      if (lvl > 1.3 && !this.burnWarned.has(panItem.id)) {
        this.burnWarned.add(panItem.id);
        this.events.burning(panItem);
      }
      if (lvl > 2.0 && this.fireAt !== 'pan') {
        this.fireAt = 'pan';
        audio.play('fireIgnite', { pos: s.pan });
        this.events.fire('pan');
      }
      this.loops.sizzle?.setVolume(0.55 + Math.min(0.4, lvl * 0.2));
    } else {
      this.loops.sizzle?.setVolume(0);
    }
    if (this.fireAt === 'pan' && panItem) {
      for (let i = 0; i < 3; i++) this.particles.emit(s.pan.clone().setY(s.pan.y + 0.12), { color: Math.random() < 0.5 ? 0xff7a10 : 0xffd040, count: 1, up: 1.1, speed: 0.15, life: 0.5, jitter: 0.12 });
      this.particles.emit(s.pan.clone().setY(s.pan.y + 0.5), { color: 0x222222, count: 1, up: 0.6, speed: 0.1, life: 2 });
      this.loops.fire?.setVolume(0.8);
    } else {
      if (this.fireAt === 'pan') this.fireAt = null;
      this.loops.fire?.setVolume(0);
    }

    // Pot and fryer.
    const potItem = this.occupant.pot[0];
    if (potItem) {
      potItem.cook.boil += dt * BOIL_RATE;
      potItem.refreshTint();
      const r = this.restPos('pot');
      r.y += Math.sin(this.time * 6) * 0.01;
      potItem.drive(r, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.time * 0.6));
    }
    if (Math.random() < dt * (potItem ? 14 : 4)) this.particles.emit(s.pot.clone().setY(s.pot.y + 0.27), { color: 0xeeeeee, count: 1, up: 0.4, speed: 0.06, life: 1.5, jitter: 0.12 });
    this.loops.boil?.setVolume(potItem ? 0.45 : 0.15);
    const fryItem = this.occupant.fryer[0];
    if (fryItem) {
      fryItem.cook.deepfry += dt * FRY_RATE;
      fryItem.refreshTint();
      const r = this.restPos('fryer');
      r.y += Math.sin(this.time * 9) * 0.006;
      fryItem.drive(r);
      if (Math.random() < dt * 20) this.particles.emit(s.fryer.clone().setY(s.fryer.y + 0.22), { color: 0xffe8a0, count: 1, up: 0.3, speed: 0.15, life: 0.4, jitter: 0.15 });
      if (fryItem.cook.deepfry > 1.3 && !this.burnWarned.has(fryItem.id)) {
        this.burnWarned.add(fryItem.id);
        this.events.burning(fryItem);
      }
    }
    this.loops.fryer?.setVolume(fryItem ? 0.6 : 0.05);

    // Plate ghost markers bob gently so players notice them.
    for (const p of Object.values(this.plates)) for (const sl of p.slots) sl.ghost.position.y = COUNTER_TOP + 0.03 + Math.sin(this.time * 3) * 0.004;
  }

  /** Feed mouse input to the station currently being worked. Returns the hand action 0..1 for animation. */
  work(id: StationId, input: Input, dt: number): number {
    const item = this.occupant[id][0];
    if (!item) return 0;
    this.dyHist.shift();
    this.dyHist.push(input.mouseDY);
    const sumDy = this.dyHist.reduce((a, b) => a + b, 0);

    if (id === 'board') {
      if (item.cook.chopped) return 0;
      if (input.mouseDY < 3) this.chopArmed = true;
      if (this.chopArmed && sumDy > 40) {
        this.chopArmed = false;
        const phase = (this.time % BEAT) / BEAT;
        const dist = Math.min(phase, 1 - phase);
        const q = Math.max(0, Math.min(1, 1 - Math.max(0, dist - 0.07) * 2.6));
        item.cook.chopHits++;
        item.cook.chopScoreSum += q;
        const col = INGREDIENTS[item.kind as keyof typeof INGREDIENTS].raw;
        this.particles.emit(item.group.position.clone().setY(COUNTER_TOP + 0.08), { color: col, count: q < 0.4 ? 14 : 5, up: q < 0.4 ? 2.2 : 0.8, speed: q < 0.4 ? 1.4 : 0.4, gravity: 6, life: 1.2, size: 0.05 });
        audio.play(q < 0.4 ? 'chopMiss' : 'chop', { pos: item.group.position, pitch: 0.9 + Math.random() * 0.2 });
        this.events.chop(q, item);
        if (item.cook.chopHits >= CHOPS_NEEDED) {
          item.setChopped();
          item.drive(this.restPos('board'));
          this.events.chopDone(item, item.cook.chopScoreSum / item.cook.chopHits);
        }
        return 1;
      }
      return Math.max(0, Math.min(1, input.mouseDY / 30));
    }

    if (id === 'prep') {
      const dx = input.mouseDX;
      const sign = Math.sign(dx);
      if (Math.abs(dx) > 5 && sign !== 0 && sign !== this.lastDxSign) {
        this.lastDxSign = sign;
        item.cook.season += 0.045;
        this.particles.emit(item.group.position.clone().setY(COUNTER_TOP + 0.45), { color: Math.random() < 0.5 ? 0xffffff : 0x333333, count: 6, up: -0.2, speed: 0.12, gravity: 2.5, life: 0.8, jitter: 0.06 });
        if (this.shakeSoundCd <= 0) {
          audio.play('shake', { pos: item.group.position, volume: 0.7 });
          this.shakeSoundCd = 0.09;
        }
        // Shaking like a maniac can pop the lid off.
        if (Math.abs(dx) > 70 && Math.random() < 0.07) {
          item.cook.season += 0.6;
          this.particles.emit(item.group.position.clone().setY(COUNTER_TOP + 0.4), { color: 0xffffff, count: 60, up: 0.2, speed: 0.4, gravity: 3, life: 1.5, jitter: 0.1 });
          audio.play('clang', { pos: item.group.position });
          this.events.shakerLid(item);
        }
      }
      return 0.5 + 0.5 * Math.sin(this.time * 30) * Math.min(1, Math.abs(dx) / 20);
    }

    if (id === 'pan') {
      if (input.mouseDY > -3) this.flipArmed = true;
      if (this.flipArmed && sumDy < -45 && item.anim.flip === 0) {
        this.flipArmed = false;
        if (sumDy < -260) {
          // Over-flip: the food leaves the pan entirely.
          this.take(item);
          item.setKinematic(false);
          item.body.setLinvel({ x: (Math.random() - 0.5) * 2, y: 4.5, z: 1.5 + Math.random() * 1.5 }, true);
          item.body.setAngvel({ x: 12, y: 3, z: 5 }, true);
          audio.play('whoosh', { pos: item.group.position });
          this.events.flipFail(item);
          return 1;
        }
        item.anim.flip = 1;
        item.anim.flipSide = 1 - item.anim.flipSide;
        audio.play('flip', { pos: item.group.position });
        this.events.flip(item);
        return 1;
      }
      return Math.max(0, Math.min(1, -sumDy / 60));
    }
    void dt;
    return 0;
  }

  gauge(id: StationId): Gauge | null {
    const item = this.occupant[id][0];
    switch (id) {
      case 'board':
        if (!item) return { title: 'Cutting Board', hint: 'Place an ingredient here to chop it', value: 0, max: 1 };
        if (item.cook.chopped) return { title: item.name, hint: 'Chopped! Grab it', value: 1, max: 1 };
        return {
          title: `Chopping ${item.name}`,
          hint: 'Hold click, swipe DOWN on the beat',
          value: item.cook.chopHits,
          max: CHOPS_NEEDED,
          beat: 1 - (this.time % BEAT) / BEAT,
          sub: `${item.cook.chopHits}/${CHOPS_NEEDED} cuts`,
        };
      case 'prep':
        if (!item) return { title: 'Seasoning Station', hint: 'Place food here to season it', value: 0, max: 1 };
        return {
          title: `Seasoning ${item.name}`,
          hint: 'Hold click, shake LEFT-RIGHT. Stop in the band',
          value: item.cook.season,
          max: 1.2,
          zone: [SEASON_TARGET - SEASON_WINDOW, SEASON_TARGET + SEASON_WINDOW],
        };
      case 'pan': {
        if (!item) return { title: 'Frying Pan', hint: 'Place steak or beef here to pan-fry', value: 0, max: 2 };
        const down = item.anim.flipSide;
        return {
          title: `Frying ${item.name} (side ${down ? 'B' : 'A'})`,
          hint: 'Hold click, flick UP to flip. Grab when both sides are golden',
          value: item.cook.fry[down],
          max: 2,
          zone: [0.78, 1.22],
          sub: `Other side: ${doneWord(item.cook.fry[1 - down])}`,
        };
      }
      case 'pot':
        if (!item) return { title: 'Boiling Pot', hint: 'Drop pasta or beans in to boil', value: 0, max: 2 };
        return { title: `Boiling ${item.name}`, hint: 'Grab it out when it hits the band', value: item.cook.boil, max: 2, zone: [0.78, 1.22] };
      case 'fryer':
        if (!item) return { title: 'Deep Fryer', hint: 'Drop chopped potato in to make fries', value: 0, max: 2 };
        return { title: `Deep-frying ${item.name}`, hint: 'Grab it out when golden', value: item.cook.deepfry, max: 2, zone: [0.78, 1.22] };
      case 'plateA':
      case 'plateB': {
        const p = this.plates[id];
        if (!p.ticket) return { title: 'Spare Plate', hint: 'No order on this plate', value: 0, max: 1 };
        const filled = p.slots.filter((s) => s.item).length;
        return {
          title: `Plate: ${p.ticket.recipe.name}`,
          hint: 'Drop food on the matching rings. Press E to serve',
          value: filled,
          max: p.slots.length,
          sub: `${filled}/${p.slots.length} components`,
        };
      }
    }
  }
}

function doneWord(v: number): string {
  if (v < 0.2) return 'raw';
  if (v < 0.78) return 'rare';
  if (v <= 1.22) return 'golden';
  if (v < 1.6) return 'overdone';
  return 'charcoal';
}
