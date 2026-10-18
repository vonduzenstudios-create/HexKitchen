import * as THREE from 'three';
import { audio } from '../audio';
import type { HandsPose, HandsRig } from '../characters/hands';
import { buildKnife } from '../characters/knife';
import type { Input } from '../engine/input';
import type { IngredientKind } from './ingredients';
import type { Item, Items } from './items';
import type { Kitchen, StationId } from './kitchen';
import type { Player } from './player';
import { WORKABLE, type Stations, type PlateId } from './stations';
import { assemble, canCarry, carrierSpots, freeSpot, partFor, partNeedsPrep, ruleFor } from './assembly';

export type Target =
  | { type: 'item'; item: Item; point: THREE.Vector3; station: StationId | null }
  | { type: 'station'; id: StationId; point: THREE.Vector3 }
  | { type: 'bin'; kind: IngredientKind; point: THREE.Vector3 }
  | { type: 'bell'; point: THREE.Vector3 }
  | { type: 'trash'; point: THREE.Vector3 }
  | { type: 'plateStack'; point: THREE.Vector3 }
  | { type: 'mitts'; point: THREE.Vector3 }
  | { type: 'hook'; point: THREE.Vector3 }
  | { type: 'prop'; name: 'toaster' | 'deskBell'; point: THREE.Vector3 };

export interface InteractEvents {
  serve(plates: PlateId[]): void;
  grabbed(item: Item): void;
  thrown(item: Item, speed: number): void;
  binned(item: Item): void;
  burnedHand(item: Item): void;
  /** Holding the extinguisher with the button down: spray from `from` along `dir`. */
  spray(from: THREE.Vector3, dir: THREE.Vector3, dt: number): void;
  /** A hotel set piece was clicked. Return true if it took the held item. */
  prop(name: 'toaster' | 'deskBell', held: Item | null): boolean;
  /** Clicked the service trolley: toggle its wheel locks. */
  trolley(trolley: Item): void;
  /** A part went onto its base; done = the assembly is complete. */
  assembled(base: Item, done: boolean): void;
}

const REACH = 2.4;
const HOLD_GRACE = 0.22; // seconds before a held click on a station becomes "work"

export class Interaction {
  held: Item | null = null;
  target: Target | null = null;
  working: StationId | null = null;
  mirrorRaised = false;
  /** Seconds the mirror has been raised (for reflect timing). */
  mirrorRaisedAt = -10;
  prompt = '';
  private pending: { station: StationId; item: Item; t: number; moved: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private lastHeld: Item | null = null;
  private holdPos = new THREE.Vector3();
  private holdVel = new THREE.Vector3();
  private hasHoldPos = false;
  private action = 0;
  private time = 0;
  /** Wearing oven mitts: hot food is safe to grab, but chopping gets clumsy. */
  wearingMitts = false;
  /** Knife that appears in the right hand while chopping. */
  private knife = buildKnife();

  constructor(
    private player: Player,
    private kitchen: Kitchen,
    private items: Items,
    private stations: Stations,
    private hands: HandsRig,
    private events: InteractEvents,
  ) {
    this.raycaster.far = REACH;
    this.knife.visible = false;
    this.hands.rightGrip.add(this.knife);

  }

  private pick(): Target | null {
    const cam = this.player.camera;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), cam);
    const objs = [...this.kitchen.pickables, ...this.items.meshes()];
    const hits = this.raycaster.intersectObjects(objs, true);
    // Aim volumes (the oven mouth) only count if nothing more specific is hit behind them.
    let fallback: Target | null = null;
    for (const h of hits) {
      if (h.object.userData.aimVolume) {
        fallback ??= { type: 'station', id: h.object.userData.station, point: h.point };
        continue;
      }
      const it = this.items.byObject(h.object);
      if (it) {
        if (it === this.held) continue;
        return { type: 'item', item: it, point: h.point, station: it.where === 'station' ? it.station : null };
      }
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.station && !o.userData.bin && !o.userData.bell && !o.userData.trash && !o.userData.plateStack && !o.userData.mitts && !o.userData.toaster && !o.userData.deskBell) o = o.parent;
      if (!o) continue;
      if (o.userData.toaster) return { type: 'prop', name: 'toaster', point: h.point };
      if (o.userData.deskBell) return { type: 'prop', name: 'deskBell', point: h.point };
      if (o.userData.station) return { type: 'station', id: o.userData.station, point: h.point };
      if (o.userData.bin) return { type: 'bin', kind: o.userData.bin, point: h.point };
      if (o.userData.bell) return { type: 'bell', point: h.point };
      if (o.userData.trash) return { type: 'trash', point: h.point };
      if (o.userData.plateStack) return { type: 'plateStack', point: h.point };
      if (o.userData.mitts) return { type: 'mitts', point: h.point };
    }
    // The empty hook is a tiny target, so test it by angle when holding the mirror pan.
    if (this.held?.kind === 'mirrorPan') {
      const toHook = this.kitchen.mirrorHook.clone().sub(cam.position);
      if (toHook.length() < REACH && toHook.normalize().dot(this.player.forward()) > 0.97) return { type: 'hook', point: this.kitchen.mirrorHook.clone() };
    }
    return fallback;
  }

  private targetStation(t: Target | null): StationId | null {
    if (!t) return null;
    if (t.type === 'station') return t.id;
    if (t.type === 'item') return t.station ?? (t.item.root().where === 'station' ? t.item.root().station : null);
    return null;
  }

  /** The tray or trolley an item sits on (or is). */
  private carrierOf(item: Item): Item | null {
    let c: Item | null = item;
    while (c && c.kind !== 'tray' && c.kind !== 'trolley') c = c.carrier;
    return c;
  }

  private spotsFor(carrier: Item): THREE.Vector3[] {
    const tr = this.kitchen.hotel?.trolley;
    return carrierSpots(carrier, tr?.top, tr?.size);
  }

  grab(item: Item): void {
    if (item.kind === 'trolley') {
      this.events.trolley(item);
      return;
    }
    const root = item.root();
    const from = root.where === 'station' ? root.station : null;
    const hot = from === 'pan' || from === 'pot' || from === 'fryer' || from === 'oven';
    if (hot && !this.wearingMitts && from === 'oven') {
      // The oven is too hot to reach into barehanded: yelp and leave the tray where it is.
      this.player.shake = Math.max(this.player.shake, 0.4);
      this.events.burnedHand(item);
      return;
    }
    // Picking a piece off a tray or trolley lifts it (and anything assembled on it) away.
    if (item.carrier) {
      // A part tucked into an assembly lifts the whole assembly.
      let base = item;
      while (base.carrier && base.carrier.kind !== 'tray' && base.carrier.kind !== 'trolley') base = base.carrier;
      if (base.carrier) base.detach();
      item = base;
    }
    if (hot && !this.wearingMitts) {
      // Barehanded into a hot pan or oven: yelp, and it goes flying.
      this.stations.take(item);
      item.where = 'world';
      item.setKinematic(false);
      const f = this.player.forward();
      item.body.setLinvel({ x: f.x * -1.2 + (Math.random() - 0.5), y: 2.2, z: f.z * -1.2 + (Math.random() - 0.5) }, true);
      item.body.setAngvel({ x: Math.random() * 10, y: Math.random() * 10, z: Math.random() * 10 }, true);
      this.player.shake = Math.max(this.player.shake, 0.5);
      this.events.burnedHand(item);
      return;
    }
    this.stations.take(item);
    item.where = 'held';
    item.setKinematic(true);
    this.held = item;
    this.hasHoldPos = false;
    audio.play('pickup', { volume: 0.6 });
    this.events.grabbed(item);
  }

  /** Release the held item. Fast mouse flicks become throws. */
  drop(): void {
    const it = this.held;
    if (!it) return;
    this.held = null;
    it.where = 'world';
    it.setKinematic(false);
    const v = this.holdVel.clone();
    const speed = v.length();
    // Clicking a counter (or the floor) without flicking sets the item down there, upright, instead of dropping it.
    if (speed < 3) {
      const p = this.surfacePoint();
      if (p) {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.player.yaw);
        it.group.quaternion.copy(q);
        it.group.updateMatrixWorld(true);
        const lift = it.group.position.y - new THREE.Box3().setFromObject(it.group, true).min.y;
        it.body.setTranslation({ x: p.x, y: p.y + lift + 0.005, z: p.z }, true);
        it.body.setRotation(q, true);
        it.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        it.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        audio.play(it.isIngredient ? 'squish' : 'clang', { pos: p, volume: 0.35, pitch: 1.1 });
        return;
      }
    }
    if (speed > 12) v.multiplyScalar(12 / speed);
    it.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
    it.body.setAngvel({ x: (Math.random() - 0.5) * speed, y: (Math.random() - 0.5) * speed, z: (Math.random() - 0.5) * speed }, true);
    if (speed > 3) {
      audio.play('whoosh', { pos: it.group.position, volume: Math.min(1, speed / 8) });
      this.events.thrown(it, speed);
    }
    this.mirrorRaised = false;
  }

  /** Where the crosshair meets the set (counters, floor) within reach, if it's a flat-ish top surface. */
  private surfacePoint(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.player.camera);
    const hits = this.raycaster.intersectObject(this.kitchen.root, true);
    for (const h of hits) {
      if (!h.face) continue;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (n.y > 0.8) return h.point;
    }
    return null;
  }

  /** Put the held item somewhere specific (station, hook, assembly base, tray). 'refused' keeps it in hand. */
  /** The food on the held tray that belongs on this plate (its ticket has a free slot for it). */
  trayDishFor(plate: PlateId): Item | null {
    const tray = this.held;
    if (!tray || tray.kind !== 'tray') return null;
    const p = this.stations.plates[plate];
    const food = tray.carried.filter((c) => c.isIngredient && this.stations.canPlace(plate, c));
    if (!p.ticket) return food[0] ?? null;
    return food.find((c) => p.slots.some((sl) => !sl.item && !sl.part && sl.kind === c.kind)) ?? null;
  }

  private releaseInto(): boolean | 'refused' | 'kept' {
    const it = this.held;
    const t = this.target;
    if (!it || !t) return false;
    if (t.type === 'prop') {
      if (this.events.prop(t.name, it)) {
        if (this.held === it) this.held = null;
        return true;
      }
      return 'refused';
    }
    if (t.type === 'item') {
      // Onto an assembly base: tomato onto toast, cheese into a mushroom, beef into pastry.
      if (partFor(t.item, it)) {
        this.held = null;
        const done = assemble(t.item, it);
        this.events.assembled(t.item, done);
        return true;
      }
      if (partNeedsPrep(t.item, it)) return 'refused';
      // Onto a tray or the trolley (aiming at it or at anything already on it).
      const carrier = this.carrierOf(t.item);
      if (carrier && carrier !== it && canCarry(carrier, it)) {
        const spot = freeSpot(carrier, this.spotsFor(carrier), t.point);
        if (!spot) return 'refused';
        this.held = null;
        carrier.attach(it, spot, new THREE.Quaternion());
        audio.play(carrier.kind === 'tray' ? 'clang' : 'drop', { pos: t.point, volume: 0.35, pitch: 1.3 });
        return true;
      }
    }
    if (t.type === 'hook' && it.kind === 'mirrorPan') {
      this.held = null;
      it.where = 'hook';
      it.drive(this.kitchen.mirrorHook.clone(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      audio.play('clang', { pos: this.kitchen.mirrorHook, volume: 0.5 });
      this.mirrorRaised = false;
      return true;
    }
    const st = this.targetStation(t);
    // Holding a tray at the pass: slide the right food off it onto the plate, keep the tray.
    if (it.kind === 'tray' && (st === 'plateA' || st === 'plateB')) {
      const dish = this.trayDishFor(st);
      if (!dish) return 'refused';
      dish.detach();
      this.stations.place(st, dish, t.point);
      return 'kept';
    }
    if (st && this.stations.canPlace(st, it)) {
      this.held = null;
      this.stations.place(st, it, t.point);
      return true;
    }
    // Food clicked at the oven stays in hand; the prompt says to use a tray.
    if (st === 'oven') return 'refused';
    return false;
  }

  /** Release everything (round transitions, petrification). */
  reset(): void {
    if (this.held) this.drop();
    this.stopWork();
    this.pending = null;
  }

  private stopWork(): void {
    this.working = null;
    this.player.lookEnabled = true;
    this.player.moveEnabled = true;
  }

  update(dt: number, input: Input, enabled: boolean): void {
    this.time += dt;
    this.target = enabled ? this.pick() : null;
    const t = this.target;
    const st = this.targetStation(t);

    if (enabled) {
      // Working a station: mouse drives the mechanic until the button is released.
      if (this.working) {
        if (!input.lmb || !this.stations.occupant[this.working][0]) this.stopWork();
        else this.action = this.stations.work(this.working, input, dt);
      } else if (this.pending) {
        this.pending.t += dt;
        this.pending.moved += Math.abs(input.mouseDX) + Math.abs(input.mouseDY);
        if (input.lmbReleased) {
          // Quick click: take the item instead of working it.
          if (this.pending.item.where === 'station') this.grab(this.pending.item);
          this.pending = null;
        } else if (this.pending.t > HOLD_GRACE || this.pending.moved > 30) {
          this.working = this.pending.station;
          this.pending = null;
          this.player.lookEnabled = false;
          this.player.moveEnabled = false;
          this.action = this.stations.work(this.working, input, dt);
        }
      } else if (input.lmbPressed) {
        if (this.held?.kind === 'extinguisher') {
          // Clicking sprays (handled below); Q puts it down.
        } else if (this.held && t?.type === 'trash' && this.held.kind !== 'mirrorPan') {
          const it = this.held;
          this.held = null;
          this.events.binned(it);
        } else if (this.held) {
          const r = this.releaseInto();
          if (r === 'refused') audio.play('click', { volume: 0.5, pitch: 0.6 });
          else if (!r) this.drop();
        } else if (t) {
          if (t.type === 'item') {
            if (t.station && WORKABLE.includes(t.station) && this.isWorkable(t.station, t.item)) {
              this.pending = { station: t.station, item: t.item, t: 0, moved: 0 };
            } else {
              this.grab(t.item);
            }
          } else if (t.type === 'station') {
            const occ = this.stations.occupant[t.id][0];
            if (occ && WORKABLE.includes(t.id) && this.isWorkable(t.id, occ)) this.pending = { station: t.id, item: occ, t: 0, moved: 0 };
            else if (occ && !(t.id === 'plateA' || t.id === 'plateB')) this.grab(occ);
          } else if (t.type === 'bin') {
            const cam = this.player.camera;
            const it = this.items.spawn(t.kind, cam.position.clone().add(this.player.forward().multiplyScalar(0.5)));
            this.grab(it);
          } else if (t.type === 'mitts') {
            this.setMitts(!this.wearingMitts);
          } else if (t.type === 'plateStack') {
            const it = this.items.spawn('plate', this.kitchen.plateStack.clone().setY(1.2));
            this.grab(it);
            audio.play('plate', { volume: 0.5, pitch: 1.2 });
          } else if (t.type === 'bell') {
            audio.play('bell', { pos: this.kitchen.bell });
            this.events.serve(['plateA', 'plateB']);
          } else if (t.type === 'prop') {
            this.events.prop(t.name, null);
          }
        }
      }

      if (input.wasPressed('KeyE')) {
        if (st === 'plateA' || st === 'plateB') {
          audio.play('bell', { pos: this.kitchen.bell });
          this.events.serve([st]);
        } else if (this.player.position.distanceTo(this.kitchen.bell) < 2.8) {
          audio.play('bell', { pos: this.kitchen.bell });
          this.events.serve(['plateA', 'plateB']);
        }
      }
      if (input.wasPressed('KeyQ') && this.held) this.drop();
      if (input.wasPressed('KeyF') && this.wearingMitts) this.setMitts(false);
      if (this.held?.kind === 'extinguisher' && input.lmb) {
        const nozzle = this.holdPos.clone().addScaledVector(this.player.forward(), 0.12);
        this.events.spray(nozzle, this.player.forward(), dt);
      }
    }

    // Mirror pan.
    const wasRaised = this.mirrorRaised;
    this.mirrorRaised = enabled && this.held?.kind === 'mirrorPan' && input.rmb;
    if (this.mirrorRaised && !wasRaised) {
      this.mirrorRaisedAt = this.time;
      audio.play('reflect', { volume: 0.25, pitch: 1.6 });
    }

    // What's in your hands is a ghost: swinging it around must not bat trays through walls or shove you.
    const last = this.lastHeld;
    if (last && last !== this.held && !last.carrier && this.items.list.includes(last)) last.collider.setEnabled(true);
    if (this.held) this.held.collider.setEnabled(false);
    this.lastHeld = this.held;
    this.updateHeld(dt);
    this.updateHands(dt);
    this.prompt = enabled ? this.makePrompt() : '';
  }

  setMitts(on: boolean): void {
    this.wearingMitts = on;
    this.stations.mittsOn = on;
    this.kitchen.mitts.visible = !on;
    this.hands.setMitts?.(on);
    audio.play('pickup', { volume: 0.5, pitch: on ? 0.7 : 0.9 });
  }

  /** Seconds since the mirror was raised, or Infinity if it is down. */
  mirrorAge(): number {
    return this.mirrorRaised ? this.time - this.mirrorRaisedAt : Infinity;
  }

  private isWorkable(id: StationId, item: Item): boolean {
    if (id === 'board') return !item.cook.chopped;
    return true;
  }

  private updateHeld(dt: number): void {
    const it = this.held;
    if (!it) return;
    const cam = this.player.camera;
    const fwd = this.player.forward();
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const camUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
    let target: THREE.Vector3;
    let quat: THREE.Quaternion;
    if (it.kind === 'mirrorPan' && this.mirrorRaised) {
      target = cam.position.clone().addScaledVector(fwd, 0.42).addScaledVector(camUp, -0.04);
      quat = cam.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    } else {
      target = cam.position.clone().addScaledVector(fwd, 0.55).addScaledVector(right, 0.14).addScaledVector(camUp, -0.16);
      quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.player.yaw);
    }
    if (!this.hasHoldPos) {
      this.holdPos.copy(target);
      this.holdVel.set(0, 0, 0);
      this.hasHoldPos = true;
    }
    const prev = this.holdPos.clone();
    this.holdPos.lerp(target, Math.min(1, dt * 22));
    const inst = this.holdPos.clone().sub(prev).divideScalar(Math.max(dt, 1e-4));
    this.holdVel.lerp(inst, 0.5);
    it.drive(this.holdPos, quat);
  }

  private updateHands(dt: number): void {
    let pose: HandsPose = 'idle';
    let action: number | undefined;
    if (this.working === 'board') {
      pose = 'chop';
      action = this.action;
    } else if (this.working === 'prep') {
      pose = 'shake';
      action = this.action;
    } else if (this.working === 'pan') {
      pose = 'flip';
      action = this.action;
    } else if (this.mirrorRaised) pose = 'raisePan';
    else if (this.held) pose = 'hold';
    else if (this.pending) pose = 'reach';
    else if (this.player.crouch > 0.6) pose = 'cover';
    // Chopping swaps the knife from the board into your hand.
    this.knife.visible = pose === 'chop';
    this.kitchen.boardKnife.visible = pose !== 'chop';
    this.hands.update(dt, pose, action === undefined ? undefined : { action });
    this.action *= 0.85;
  }

  private makePrompt(): string {
    const t = this.target;
    if (this.working) return '';
    if (this.held) {
      if (this.held.kind === 'extinguisher') return 'Hold click: spray at the fire  ·  Q: put it down';
      if (!t) {
        const where = this.surfacePoint();
        const down = where ? (where.y > 0.5 ? 'Click: set it down here' : 'Click: put it on the floor (mess!)') : 'Click: drop';
        return `Holding ${this.held.name}  ·  ${down} / flick to throw${this.held.kind === 'mirrorPan' ? '  ·  Right-click: raise mirror' : ''}`;
      }
      if (t.type === 'hook' && this.held.kind === 'mirrorPan') return 'Click: hang the pan back up';
      if (t.type === 'prop') {
        if (t.name === 'toaster') return this.held.kind === 'sourdough' && this.held.cook.chopped ? 'Click: drop the slice in the toaster (stand back!)' : 'The toaster only takes sourdough slices';
        return 'Click: ring the desk bell (Gorgon WILL come)';
      }
      if (t.type === 'item') {
        const name = this.held.name.toLowerCase();
        if (partFor(t.item, this.held)) return `Click: put the ${name} on the ${t.item.name.toLowerCase()}`;
        if (partNeedsPrep(t.item, this.held)) return `Chop the ${name} first, then it goes on the ${t.item.name.toLowerCase()}`;
        const carrier = this.carrierOf(t.item);
        if (carrier && carrier !== this.held && canCarry(carrier, this.held)) {
          if (!freeSpot(carrier, this.spotsFor(carrier))) return carrier.kind === 'tray' ? 'That tray is full' : 'The trolley is full';
          return `Click: put the ${name} on the ${carrier.kind === 'tray' ? 'tray' : 'trolley'}`;
        }
        const rule = ruleFor(t.item);
        if (rule && this.held.isIngredient && !t.item.displayName) return `The ${t.item.name.toLowerCase()} takes: ${rule.parts.map((p) => `${p.chopped ? 'chopped ' : ''}${p.kind}`).join(' + ')}`;
      }
      if (t.type === 'trash' && this.held.kind !== 'mirrorPan') return `Click: bin the ${this.held.name}`;
      const st = this.targetStation(t);
      if (st) {
        if (st === 'oven') {
          if (this.held.kind === 'tray') return this.stations.canPlace('oven', this.held) ? 'Click: slide the tray into the oven' : 'The oven already has a tray in it';
          return 'Only trays go in the oven: put the food on a sheet tray first';
        }
        if (this.held.kind === 'tray' && (st === 'plateA' || st === 'plateB')) {
          if (!this.stations.hasPlate[st]) return 'Put a clean plate here first (stack at the back of the pass)';
          const dish = this.trayDishFor(st);
          return dish ? `Click: slide the ${dish.name.toLowerCase()} onto the plate` : this.held.carried.length ? "Nothing on this tray belongs on that plate" : 'The tray is empty';
        }
        if (this.stations.canPlace(st, this.held)) return `Click: place ${this.held.name}`;
        if (this.stations.isBurning(st)) return "It's ON FIRE! Grab the extinguisher by the stove";
        if ((st === 'plateA' || st === 'plateB') && !this.stations.hasPlate[st]) return 'Put a clean plate here first (stack at the back of the pass)';
        return 'That spot is full';
      }
      if (this.held.kind === 'tray') return `Holding ${this.held.name}  ·  Click a plate at the pass to serve from it, or a counter to set it down`;
      return `Holding ${this.held.name}  ·  Click: drop`;
    }
    if (!t) return '';
    switch (t.type) {
      case 'item': {
        if (t.item.kind === 'trolley') return `Click: ${this.kitchen.hotel && t.item.anim.flip ? 'unlock' : 'lock'} the trolley wheels`;
        const rootSt = t.item.root().where === 'station' ? t.item.root().station : null;
        if (rootSt === 'oven') {
          const what = t.item.kind === 'tray' ? 'the tray' : t.item.name;
          return this.wearingMitts ? `Click: take ${what} out of the oven` : 'HOT! Put on the oven mitts first (hook by the stove)';
        }
        if (t.station && WORKABLE.includes(t.station) && this.isWorkable(t.station, t.item)) {
          const verb = t.station === 'board' ? 'chop' : t.station === 'prep' ? 'season' : 'flip';
          if ((t.station === 'board' || t.station === 'prep' || t.station === 'pan') && this.wearingMitts) return `Hold click: ${verb} (clumsy in mitts! F: take them off)  ·  Tap: take ${t.item.name}`;
          return `Hold click: ${verb}  ·  Tap: take ${t.item.name}`;
        }
        if (t.station === 'plateA' || t.station === 'plateB') return `Click: take ${t.item.name}  ·  E: serve plate`;
        if ((t.station === 'pan' || t.station === 'pot' || t.station === 'fryer') && !this.wearingMitts) return `HOT! Put on the oven mitts by the stove first  ·  Click: grab ${t.item.name} anyway`;
        return `Click: grab ${t.item.name}`;
      }
      case 'station':
        if (this.stations.isBurning(t.id)) return "ON FIRE! The extinguisher is on the counter by the stove";
        if (t.id === 'plateA' || t.id === 'plateB') return this.stations.hasPlate[t.id] ? 'E: serve this plate' : 'Needs a plate: grab one from the stack';
        return '';
      case 'bin':
        return `Click: take ${t.kind === 'pasta' ? 'spaghetti' : t.kind === 'greens' ? 'green beans' : t.kind}`;
      case 'bell':
        return 'Click: ring the bell to serve all plates';
      case 'hook':
        return '';
      case 'prop':
        return t.name === 'toaster' ? 'Toaster: drop a sourdough slice in. It launches!' : 'Click: ring the desk bell (Gorgon WILL come)';
      case 'trash':
        return 'Trash: bin dropped food here before Gorgon finds it';
      case 'mitts':
        return this.wearingMitts ? 'Click: hang the oven mitts back up (or press F anywhere)' : 'Click: put on oven mitts (for hot pans, pots and the oven)';
      case 'plateStack':
        return 'Click: take a clean plate (careful, they break)';
    }
  }
}
