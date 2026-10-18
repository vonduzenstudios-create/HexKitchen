import * as THREE from 'three';
import { audio, voice } from '../audio';
import type { GorgonAI } from './gorgonAI';
import type { Interaction } from './interact';
import type { Item, Items } from './items';
import { COUNTER_TOP, type Kitchen } from './kitchen';
import type { LineKey } from './lines';
import type { Player } from './player';
import type { PlateId, Stations } from './stations';

/** What the hotel needs from the rest of the game. */
export interface HotelDeps {
  scene: THREE.Scene;
  kitchen: Kitchen;
  items: Items;
  stations: Stations;
  player: Player;
  gorgon: GorgonAI;
  interact: () => Interaction;
  say(key: LineKey, priority?: number): void;
  react(kind: 'laugh' | 'gasp' | 'applause' | 'boo', chance: number): void;
  addWrath(n: number): void;
  /** Short on-screen notice (inspection countdown, printed tickets). null clears it. */
  notice(text: string | null): void;
  playing(): boolean;
  inspectEvery(): number | undefined;
}

/** Absurd requests from the petrified diners, printed on the ticket printer. */
const REQUESTS = [
  'One steak. No eye contact.',
  'Table 9: "Is the soup of the day still the soup of last year?"',
  'Room 237 would like their toast "less screamy".',
  'The bride at table 4 requests something she can chew. She cannot chew.',
  'Gentleman by the window wants his eggs "a little less petrified".',
  'Allergy note: guest is allergic to being looked at.',
  'Table 12 would like the chef to stop staring.',
  'Honeymoon Suite: "Please knock. We are both statues now."',
  'Kids menu: one (1) gravel nugget. Hold the gravel.',
  'Guest in the corner has been waiting since 1974. No rush.',
];

const TOASTER_TIME = 5.5;
const RATTLE_FROM = 3.6;

export class Hotel {
  trolley: Item | null = null;
  private door = 0;
  private wasReady = false;
  private time = 0;
  private toast: { item: Item; t: number } | null = null;
  private flying: { item: Item; t: number; caught: boolean } | null = null;
  private bellRings: number[] = [];
  private bellCd = 0;
  private trolleySpeed = 0;
  private locked = true;
  private crashCd = 0;
  private inspectT = 30;
  private wasInspecting = false;
  private inspectFlags = { ready: false, bump: 0, door: false };
  private printT = 0;
  private printQueue: string[] = [];
  private requestIdx = 0;
  private revealT = 40;
  private reveal = 0;
  private ovenBurnWarned = false;

  constructor(private d: HotelDeps) {}

  get set() {
    return this.d.kitchen.hotel!;
  }

  init(): void {
    const k = this.d.kitchen;
    const h = this.set;
    // Make sure the toaster and desk bell can be targeted even if the set didn't tag them.
    if (!k.pickables.some((p) => p.userData.toaster)) {
      h.toaster.group.userData.toaster = true;
      k.pickables.push(h.toaster.group);
    }
    // The trolley becomes a physics item that rolls when you bump it and carries whatever you load on it.
    h.trolley.group.removeFromParent();
    h.trolley.group.position.set(0, 0, 0);
    const t = this.d.items.spawn('trolley', h.trolley.spawn.clone().setY(0.02), h.trolley.group);
    t.body.setEnabledRotations(false, true, false, true);
    t.collider.setFriction(0.05);
    t.body.setLinearDamping(30);
    t.body.setAngularDamping(4);
    this.trolley = t;
    this.setLocks(true);
    this.restockTrays();
  }

  /** Between rounds: fresh trays on the rack, an empty toaster, a queued welcome ticket. */
  resetRound(): void {
    this.restockTrays();
    if (this.toast) {
      this.toast.item.where = 'world';
      this.toast.item.setKinematic(false);
      this.toast = null;
    }
    this.set.toaster.setLever(0);
    this.inspectT = (this.d.inspectEvery() ?? 60) * 0.6;
    this.inspectFlags = { ready: false, bump: 0, door: false };
    this.d.notice(null);
  }

  private restockTrays(): void {
    const free = (p: THREE.Vector3) => !this.d.items.list.some((i) => i.kind === 'tray' && i.where !== 'gone' && i.group.position.distanceTo(p) < 0.4);
    for (const p of this.set.trayRack) if (free(p)) this.d.items.spawn('tray', p.clone().add(new THREE.Vector3(0, 0.03, 0)));
  }

  // ---------- set pieces ----------

  /** A hotel prop was clicked. Returns true if it took the held item. */
  prop(name: 'toaster' | 'deskBell', held: Item | null): boolean {
    if (name === 'deskBell') {
      this.ringDeskBell();
      return false;
    }
    if (!held || this.toast) {
      if (!held) audio.play('click', { pos: this.set.toaster.slot, volume: 0.5 });
      return false;
    }
    if (held.kind !== 'sourdough' || !held.cook.chopped) return false;
    // In it goes. Lever down, and the countdown to launch begins.
    this.toast = { item: held, t: 0 };
    held.where = 'prop';
    held.setKinematic(true);
    held.drive(this.set.toaster.slot.clone().add(new THREE.Vector3(0, -0.04, 0)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    this.set.toaster.setLever(1);
    audio.play('click', { pos: this.set.toaster.slot, volume: 0.9, pitch: 0.7 });
    return true;
  }

  setLocks(on: boolean): void {
    this.locked = on;
    const t = this.trolley;
    if (!t) return;
    t.anim.flip = on ? 1 : 0;
    t.body.setLinearDamping(on ? 30 : 0.7);
    for (const l of this.set.trolley.locks) {
      // Tabs on the far side pivot the other way (see hotelKitchen): pressed down when locked, flipped up when free.
      const s = Math.sign(l.children[0]?.position.z || 1);
      l.rotation.x = (on ? 0.35 : -0.5) * s;
    }
    audio.play('click', { pos: t.group.position, volume: 0.7, pitch: on ? 0.8 : 1.2 });
  }

  toggleLocks(): void {
    this.setLocks(!this.locked);
  }

  private ringDeskBell(): void {
    if (this.bellCd > 0) return;
    this.bellCd = 0.6;
    audio.play('bell', { pos: this.set.deskBell, volume: 0.9, pitch: 1.35 });
    if (!this.d.playing()) return;
    const now = this.time;
    this.bellRings = this.bellRings.filter((t) => now - t < 25);
    this.bellRings.push(now);
    const n = this.bellRings.length;
    // Lure him to the pass. Once is a trick; again and again is an insult.
    const lured = this.d.gorgon.lure(this.set.deskBell.clone().add(new THREE.Vector3(0.9, 0, 0)).setY(0));
    if (n >= 3) {
      this.d.addWrath(8);
      this.d.say('deskBellFurious', 2);
    } else if (n === 2) {
      this.d.addWrath(4);
      this.d.say('deskBellAnnoyed', 2);
    } else if (lured) {
      this.d.say('deskBell', 2);
    }
  }

  /** A new ticket prints with a stupid request from the dining room. */
  printTicket(): void {
    this.printQueue.push(REQUESTS[this.requestIdx++ % REQUESTS.length]);
  }

  // ---------- per frame ----------

  update(dt: number): void {
    this.time += dt;
    this.bellCd -= dt;
    this.crashCd -= dt;
    this.updateOven(dt);
    this.updateToaster(dt);
    this.updateTrolley();
    this.updatePrinter(dt);
    this.updateInspection(dt);
    // Every so often the tall windows show something that should not be there.
    this.revealT -= dt;
    if (this.revealT <= 0) {
      this.revealT = 45 + Math.random() * 40;
      this.reveal = 1;
      audio.play('stoneCrack', { volume: 0.25, pitch: 0.5 });
    }
    this.reveal = Math.max(0, this.reveal - dt / 3.5);
    this.set.setWindows(this.time, this.reveal);
  }

  private updateOven(dt: number): void {
    const oven = this.d.kitchen.oven!;
    const st = this.d.stations;
    const it = this.d.interact();
    const near = this.d.player.position.distanceTo(oven.front) < 1.9;
    const aimed = it.target && ((it.target.type === 'station' && it.target.id === 'oven') || (it.target.type === 'item' && it.target.item.root().station === 'oven'));
    // The door drops open when you come to use it, and swings shut on its own.
    const want = near && (aimed || it.held?.kind === 'tray') ? 1 : 0;
    this.door += (want - this.door) * Math.min(1, dt * 6);
    oven.setDoor(this.door);
    st.ovenDoorOpen = this.door > 0.5;
    const tray = st.occupant.oven[0];
    const food = tray ? tray.withCarried().filter((i) => i.isIngredient && !i.hiddenInAssembly) : [];
    const most = food.reduce((m, i) => Math.max(m, i.cook.bake), 0);
    oven.setLight(!!tray, Math.min(1, most));
    oven.setTimer(st.ovenTimeLeft, st.ovenReady);
    // The ding: loud, clear, and Gorgon is ducked under it so it's never drowned out.
    if (st.ovenReady && !this.wasReady) {
      voice.duck(1.6, 0.2);
      audio.play('ding', { pos: oven.front.clone().setY(1.2), volume: 1 });
      setTimeout(() => audio.play('ding', { pos: oven.front.clone().setY(1.2), volume: 1, pitch: 1.12 }), 260);
      this.ovenBurnWarned = false;
    }
    this.wasReady = st.ovenReady;
    if (most > 1.6 && !this.ovenBurnWarned) {
      this.ovenBurnWarned = true;
      this.d.say('ovenBurning', 2);
    }
  }

  private updateToaster(dt: number): void {
    const ts = this.set.toaster;
    if (this.toast) {
      const tt = this.toast;
      tt.t += dt;
      // A rising rattle warns you it's about to go off.
      if (tt.t > RATTLE_FROM) {
        const k = (tt.t - RATTLE_FROM) / (TOASTER_TIME - RATTLE_FROM);
        ts.setRattle(k);
        if (Math.random() < dt * (6 + 20 * k)) audio.play('tick', { pos: ts.slot, volume: 0.3 + 0.5 * k, pitch: 1.5 + k });
      }
      if (tt.t >= TOASTER_TIME) this.launchToast(tt.item);
    } else ts.setRattle(0);

    const f = this.flying;
    if (f) {
      f.t += dt;
      const it = f.item;
      if (!f.caught && this.d.interact().held === it && f.t < 2) {
        f.caught = true;
        this.d.react('applause', 1);
        this.d.say('toastCatch', 1);
        this.d.addWrath(-2);
        this.flying = null;
        return;
      }
      if (it.where === 'world' && f.t > 0.4) {
        const v = it.body.linvel();
        // A clean landing on a waiting plate counts.
        for (const id of ['plateA', 'plateB'] as PlateId[]) {
          const p = this.d.kitchen.stations[id];
          if (Math.hypot(it.group.position.x - p.x, it.group.position.z - p.z) < 0.26 && Math.abs(it.group.position.y - COUNTER_TOP) < 0.12 && Math.abs(v.y) < 1.5) {
            if (this.d.stations.canPlace(id, it)) {
              this.d.stations.place(id, it, it.group.position.clone());
              this.d.react('applause', 1);
              this.d.say('toastLanding', 2);
              this.d.addWrath(-4);
              this.flying = null;
              return;
            }
          }
        }
      }
      if (f.t > 3 || it.where !== 'world') this.flying = null;
    }
  }

  private launchToast(item: Item): void {
    const ts = this.set.toaster;
    this.toast = null;
    ts.setLever(0);
    ts.setRattle(0);
    item.cook.bake = Math.max(item.cook.bake, 0.5);
    item.refreshTint();
    item.where = 'world';
    item.setKinematic(false);
    item.body.setTranslation({ x: ts.slot.x, y: ts.slot.y + 0.1, z: ts.slot.z }, true);
    // Up, and a little toward wherever the cook is standing so a catch is possible.
    const toPlayer = this.d.player.position.clone().sub(ts.slot).setY(0);
    const lean = toPlayer.length() > 0.1 ? toPlayer.normalize().multiplyScalar(0.9) : new THREE.Vector3();
    item.body.setLinvel({ x: lean.x + (Math.random() - 0.5) * 0.4, y: 5.2, z: lean.z + (Math.random() - 0.5) * 0.4 }, true);
    item.body.setAngvel({ x: 9 + Math.random() * 4, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 }, true);
    audio.play('clang', { pos: ts.slot, volume: 1, pitch: 1.6 });
    audio.play('whoosh', { pos: ts.slot, volume: 0.8 });
    this.d.react('gasp', 0.5);
    this.flying = { item, t: 0, caught: false };
  }

  private updateTrolley(): void {
    const t = this.trolley;
    if (!t || t.where === 'gone') return;
    const v = t.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    // Bumping it: walk or sprint into an unlocked trolley and it rolls away with whatever's on it.
    if (!this.locked && t.where === 'world') {
      const pp = this.d.player.position;
      const tp = t.group.position;
      const rel = new THREE.Vector3(tp.x - pp.x, 0, tp.z - pp.z);
      const reach = Math.max(this.set.trolley.size.x, this.set.trolley.size.z) / 2 + 0.38;
      if (rel.length() < reach && this.d.player.speed > 1.2) {
        const push = rel.normalize().multiplyScalar(this.d.player.speed * 1.15);
        if (push.length() > speed) t.body.setLinvel({ x: push.x, y: v.y, z: push.z }, true);
      }
    }
    // Slamming into something at speed throws the load off.
    if (this.trolleySpeed > 2.2 && speed < this.trolleySpeed * 0.35 && t.carried.length && this.crashCd <= 0) {
      this.crashCd = 2;
      this.d.items.spill(t, 1.3);
      audio.play('clang', { pos: t.group.position, volume: 1, pitch: 0.7 });
      this.d.say('trolleyCrash', 2);
    } else if (this.trolleySpeed > 2.2 && speed < this.trolleySpeed * 0.35 && this.crashCd <= 0) {
      this.crashCd = 1;
      audio.play('clang', { pos: t.group.position, volume: 0.8, pitch: 0.8 });
    }
    this.trolleySpeed = speed;
  }

  private updatePrinter(dt: number): void {
    const pr = this.set.printer;
    if (this.printT > 0) {
      this.printT -= dt;
      const k = 1 - Math.max(0, this.printT - 3) / 1.2;
      pr.paper.scale.y = Math.max(0.01, Math.min(1, k));
      if (this.printT > 3 && Math.random() < dt * 22) audio.play('tick', { pos: pr.mouth, volume: 0.35, pitch: 2.2 });
      if (this.printT <= 0) this.d.notice(null);
      return;
    }
    const next = this.printQueue.shift();
    if (!next) return;
    this.printT = 4.2 + 3;
    pr.paper.scale.y = 0.01;
    audio.play('click', { pos: pr.mouth, volume: 0.8, pitch: 1.6 });
    this.d.notice(`🧾 ${next}`);
  }

  /**
   * Service Inspection: Gorgon announces he's checking the oven and plants himself beside it, on the
   * side you'd normally come from. Go round, do something else, or ring the desk bell to pull him away.
   * He never blocks ready food: if the timer has dinged he steps well clear.
   */
  private updateInspection(dt: number): void {
    const every = this.d.inspectEvery();
    const g = this.d.gorgon;
    const oven = this.d.kitchen.oven!;
    if (!every || !this.d.playing()) return;
    if (g.inspecting) {
      this.wasInspecting = true;
      const left = Math.ceil(g.inspectionLeft);
      this.d.notice(g.state === 'serviceInspect' ? `SERVICE INSPECTION · ${left}s` : 'SERVICE INSPECTION: Gorgon is heading for the oven');
      if (this.d.stations.ovenReady && !this.inspectFlags.ready) {
        this.inspectFlags.ready = true;
        this.d.say('inspectionReady', 2);
        g.stepAside(this.sideSpot(2.2));
      }
      this.inspectFlags.bump -= dt;
      if (g.state === 'serviceInspect' && this.d.player.position.distanceTo(g.pos) < 0.95 && this.inspectFlags.bump <= 0) {
        this.inspectFlags.bump = 5;
        this.d.say('inspectionBump', 2);
        this.d.addWrath(2);
        this.d.player.shake = Math.max(this.d.player.shake, 0.3);
      }
      if (g.state === 'serviceInspect' && this.door > 0.6 && !this.d.stations.ovenReady && !this.inspectFlags.door) {
        this.inspectFlags.door = true;
        this.d.say('openOvenInspection', 2);
        this.d.addWrath(3);
      }
      return;
    }
    if (this.wasInspecting) {
      this.wasInspecting = false;
      this.inspectFlags = { ready: false, bump: 0, door: false };
      if (this.printT <= 0) this.d.notice(null);
    }
    if (g.state !== 'patrol') return;
    this.inspectT -= dt;
    if (this.inspectT > 0) return;
    this.inspectT = every * (0.85 + Math.random() * 0.3);
    if (g.serviceInspect(this.sideSpot(this.d.stations.ovenReady ? 2.2 : 0.85), oven.rack.clone(), 9)) this.d.react('gasp', 0.4);
  }

  /** A floor spot beside the oven front, on the side nearer the player (so it's in your way, not the door's). */
  private sideSpot(dist: number): THREE.Vector3 {
    const oven = this.d.kitchen.oven!;
    const out = oven.front.clone().sub(oven.rack).setY(0).normalize();
    const side = new THREE.Vector3(-out.z, 0, out.x);
    const pp = this.d.player.position;
    const a = oven.front.clone().addScaledVector(side, dist);
    const b = oven.front.clone().addScaledVector(side, -dist);
    return (a.distanceTo(pp) < b.distanceTo(pp) ? a : b).setY(0);
  }

}
