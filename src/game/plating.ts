import * as THREE from 'three';
import { audio } from '../audio';
import type { Input } from '../engine/input';
import { basic, mat } from '../engine/psx';
import type { Item } from './items';
import { COUNTER_TOP, type Kitchen } from './kitchen';
import type { LineKey } from './lines';
import type { Player } from './player';
import type { PlateId, Stations, Ticket } from './stations';

/**
 * Plating Mode: a short close-up minigame between assembling a dish and presenting it.
 * The player arranges the components on the plate, swipes a sauce, sprinkles garnish and
 * wipes the rim while a timer runs down and Gorgon backseat-judges. Hidden "sweet spots"
 * (balance, spacing, a clear rim, a single elegant sauce stroke) score it; the player never sees a grid.
 */

export type PlatingTool = 'place' | 'sauce' | 'garnish' | 'wipe';
const TOOLS: PlatingTool[] = ['place', 'sauce', 'garnish', 'wipe'];
export const TOOL_LABEL: Record<PlatingTool, string> = { place: 'Arrange', sauce: 'Sauce swipe', garnish: 'Garnish', wipe: 'Wipe rim' };

export interface PlatingBreakdown {
  balance: number;
  spacing: number;
  highlight: number;
  rim: number;
  sauce: number;
  garnish: number;
  speed: number;
}

export interface PlatingResult {
  score: number;
  grade: string;
  breakdown: PlatingBreakdown;
}

export interface PlatingView {
  dish: string;
  timeLeft: number;
  timeMax: number;
  tool: PlatingTool;
  score: number;
  grade: string;
  checklist: { label: string; done: boolean }[];
  holding: boolean;
}

export function platingGrade(score: number): string {
  if (score >= 90) return 'Gorgon Approved';
  if (score >= 75) return 'Fine Dining';
  if (score >= 60) return 'Restaurant Quality';
  if (score >= 40) return 'Passable';
  return 'Cafeteria';
}

const SAUCE_COLOR: Record<string, number> = {
  caesar: 0xd8b860,
  steakFries: 0x5a2a14,
  spaghetti: 0xc0281a,
  wellington: 0x4a1a10,
};

const PLATE_R = 0.2; // usable radius; beyond this is the rim

interface Comp {
  item: Item;
  pos: THREE.Vector2; // plate-local (x toward the far side, y = world z)
  rot: number;
  q0: THREE.Quaternion; // resting orientation when plating began
}

export class PlatingMode {
  active = false;
  plate: PlateId = 'plateA';
  ticket: Ticket | null = null;
  tool: PlatingTool = 'place';
  timeLeft = 0;
  timeMax = 0;
  private comps: Comp[] = [];
  private held: Comp | null = null;
  private cursor = new THREE.Vector2();
  private cursorMesh: THREE.Mesh;
  private sauceStrokes: THREE.Vector2[][] = [];
  private stroke: THREE.Vector2[] | null = null;
  private sauceGroup = new THREE.Group();
  private garnishGroup = new THREE.Group();
  private garnishes = 0;
  private splatters: THREE.Mesh[] = [];
  private barkT = 2.5;
  private center = new THREE.Vector3();
  private shakeT = 0;
  private sauceMat: THREE.Material = mat(0xffffff);

  constructor(
    private scene: THREE.Scene,
    private kitchen: Kitchen,
    private stations: Stations,
    private player: Player,
    private bark: (key: LineKey) => void,
    private wrath: () => number,
  ) {
    this.cursorMesh = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.018, 24), basic(0xffd040, { transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    this.cursorMesh.rotation.x = -Math.PI / 2;
    this.cursorMesh.visible = false;
    this.cursorMesh.renderOrder = 10;
    (this.cursorMesh.material as THREE.Material).depthTest = false;
    scene.add(this.cursorMesh, this.sauceGroup, this.garnishGroup);
  }

  /** Begin plating a complete dish. Seconds of plating time depend on the dish and Gorgon's mood. */
  start(plate: PlateId, ticket: Ticket, boss: boolean): void {
    this.active = true;
    this.plate = plate;
    this.ticket = ticket;
    this.tool = 'place';
    const base = this.kitchen.stations[plate];
    this.center.set(base.x, COUNTER_TOP + 0.035, base.z);
    const n = ticket.recipe.components.length;
    // Simple dishes get less time than signature ones; high Wrath shortens it further.
    this.timeMax = (boss ? 20 : n >= 2 && ticket.recipe.id !== 'caesar' ? 15 : 13) * (1 - 0.3 * (this.wrath() / 100));
    this.timeLeft = this.timeMax;
    this.cursor.set(0, 0);
    this.comps = this.stations.plates[plate].slots
      .filter((s) => s.item)
      .map((s) => ({ item: s.item!, pos: new THREE.Vector2(s.offset.x, s.offset.z), rot: 0, q0: s.item!.group.quaternion.clone() }));
    // Rushed assembly leaves a couple of smudges on the rim.
    this.clearDecor();
    for (let i = 0; i < 2; i++) this.addSplatter(Math.random() * Math.PI * 2);
    this.sauceMat = mat(SAUCE_COLOR[ticket.recipe.id] ?? 0x7a2a14, { roughness: 0.25 });
    this.barkT = 3;
    this.cursorMesh.visible = true;
    // Swoop the camera into a 3/4 view over the plate, from the cook's side of the pass.
    this.player.cameraOverride = {
      pos: new THREE.Vector3(base.x - 0.42, COUNTER_TOP + 0.52, base.z + 0.06),
      look: this.center.clone(),
    };
    audio.play('whoosh', { volume: 0.5 });
  }

  /** End plating and return the score. The dish stays on the plate for serving. */
  finish(): PlatingResult {
    const b = this.evaluate();
    const score = Math.round(b.balance + b.spacing + b.highlight + b.rim + b.sauce + b.garnish + b.speed);
    this.active = false;
    this.held = null;
    this.cursorMesh.visible = false;
    this.player.cameraOverride = null;
    // Write the arrangement back to the plate slots so the dish keeps its look until it's served.
    const slots = this.stations.plates[this.plate].slots;
    for (const c of this.comps) {
      const s = slots.find((x) => x.item === c.item);
      if (s) {
        s.offset.set(c.pos.x, 0, c.pos.y);
        s.placement = Math.max(0.4, score / 100);
      }
    }
    return { score, grade: platingGrade(score), breakdown: b };
  }

  /** Remove the sauce, garnish and smudges (the plate has gone out). */
  clearDecor(): void {
    for (const g of [this.sauceGroup, this.garnishGroup]) {
      for (const c of g.children.slice()) {
        g.remove(c);
        (c as THREE.Mesh).geometry?.dispose();
      }
    }
    for (const s of this.splatters) this.scene.remove(s);
    this.splatters = [];
    this.sauceStrokes = [];
    this.stroke = null;
    this.garnishes = 0;
  }

  update(dt: number, input: Input): 'active' | 'done' {
    if (!this.active) return 'done';
    this.timeLeft -= dt;
    const w = this.wrath() / 100;

    // Cursor: mouse moves it across the plate. Screen right is +z, screen up is +x (away from you).
    const fine = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? 0.35 : 1;
    this.cursor.y += input.mouseDX * 0.0011 * fine;
    this.cursor.x -= input.mouseDY * 0.0011 * fine;
    // An angry Gorgon gives you the shakes.
    this.shakeT += dt * 13;
    this.cursor.x += Math.sin(this.shakeT * 1.7) * 0.0009 * w;
    this.cursor.y += Math.cos(this.shakeT * 1.3) * 0.0009 * w;
    if (this.cursor.length() > 0.26) this.cursor.setLength(0.26);
    const cw = this.world(this.cursor);
    this.cursorMesh.position.copy(cw).setY(this.center.y + 0.03);

    if (input.rmbPressed) {
      this.tool = TOOLS[(TOOLS.indexOf(this.tool) + 1) % TOOLS.length];
      if (this.held) this.held = null;
      audio.play('pickup', { volume: 0.3, pitch: 1.5 });
    }
    for (const [k, t] of [['Digit1', 'place'], ['Digit2', 'sauce'], ['Digit3', 'garnish'], ['Digit4', 'wipe']] as const) if (input.wasPressed(k)) this.tool = t;

    switch (this.tool) {
      case 'place':
        if (input.lmbPressed) {
          if (this.held) {
            this.held = null;
            audio.play('plate', { pos: cw, volume: 0.5 });
          } else {
            const near = this.comps.slice().sort((a, b) => a.pos.distanceTo(this.cursor) - b.pos.distanceTo(this.cursor))[0];
            if (near && near.pos.distanceTo(this.cursor) < 0.07) {
              this.held = near;
              audio.play('pickup', { volume: 0.4 });
            }
          }
        }
        if (this.held) {
          this.held.pos.copy(this.cursor);
          if (input.wheel) this.held.rot += input.wheel * 0.3;
        }
        break;
      case 'sauce':
        if (input.lmbPressed && this.sauceStrokes.length < 4) {
          this.stroke = [];
          this.sauceStrokes.push(this.stroke);
        }
        if (input.lmb && this.stroke) {
          const last = this.stroke[this.stroke.length - 1];
          if (!last || last.distanceTo(this.cursor) > 0.01) {
            this.stroke.push(this.cursor.clone());
            this.addSauceDab(this.cursor, this.stroke.length);
            if (this.cursor.length() > PLATE_R && Math.random() < 0.3) this.addSplatter(Math.atan2(this.cursor.y, this.cursor.x));
          }
        }
        if (input.lmbReleased) this.stroke = null;
        break;
      case 'garnish':
        if (input.lmbPressed) this.sprinkle(this.cursor, w);
        break;
      case 'wipe':
        if (input.lmb) {
          for (const s of this.splatters.slice()) {
            if (s.position.distanceTo(cw) < 0.04) {
              this.scene.remove(s);
              this.splatters.splice(this.splatters.indexOf(s), 1);
              audio.play('squish', { pos: cw, volume: 0.3, pitch: 1.4 });
            }
          }
        }
        break;
    }

    // Drive the components to their plate positions.
    for (const c of this.comps) {
      const p = this.world(c.pos);
      p.y = this.center.y - 0.007 + (c === this.held ? 0.04 : 0);
      c.item.drive(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rot).multiply(c.q0));
    }

    // Gorgon backseat-judges whatever is worst right now.
    this.barkT -= dt;
    if (this.barkT <= 0) {
      this.barkT = 3.2 + Math.random() * 1.5;
      this.bark(this.worstIssue());
    }

    if (input.wasPressed('KeyE') || this.timeLeft <= 0) return 'done';
    return 'active';
  }

  view(): PlatingView {
    const b = this.evaluate();
    const score = Math.round(b.balance + b.spacing + b.highlight + b.rim + b.sauce + b.garnish + b.speed);
    return {
      dish: this.ticket?.recipe.name ?? '',
      timeLeft: Math.max(0, this.timeLeft),
      timeMax: this.timeMax,
      tool: this.tool,
      score,
      grade: platingGrade(score),
      holding: !!this.held,
      checklist: [
        { label: 'Main in the centre', done: b.highlight >= 12 },
        { label: 'Space the sides out', done: b.spacing >= 16 },
        { label: 'One sauce swipe', done: this.sauceStrokes.length === 1 && b.sauce >= 12 },
        { label: 'A pinch of garnish', done: this.garnishes >= 1 && this.garnishes <= 3 },
        { label: 'Clean rim', done: this.splatters.length === 0 && b.rim >= 14 },
      ],
    };
  }

  private world(p: THREE.Vector2): THREE.Vector3 {
    return new THREE.Vector3(this.center.x + p.x, this.center.y, this.center.z + p.y);
  }

  private addSauceDab(p: THREE.Vector2, i: number): void {
    const r = 0.012 + Math.sin(i * 0.4) * 0.003 + 0.004;
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 14), this.sauceMat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(this.world(p)).setY(this.center.y - 0.0195 + i * 0.00002);
    this.sauceGroup.add(m);
  }

  private sprinkle(p: THREE.Vector2, w: number): void {
    this.garnishes++;
    const spread = 0.022 + w * 0.03;
    const green = mat(0x3a8a2a, { roughness: 0.7 });
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.003, 0.006), green);
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * spread;
      m.position.copy(this.world(new THREE.Vector2(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d))).setY(this.center.y + 0.012 + Math.random() * 0.02);
      m.rotation.y = Math.random() * Math.PI;
      this.garnishGroup.add(m);
    }
    audio.play('shake', { volume: 0.4, pitch: 1.3 });
  }

  private addSplatter(angle: number): void {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.012 + Math.random() * 0.01, 10), this.sauceMat);
    m.rotation.x = -Math.PI / 2;
    const r = 0.215 + Math.random() * 0.015;
    m.position.copy(this.world(new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r))).setY(this.center.y - 0.002);
    this.scene.add(m);
    this.splatters.push(m);
  }

  private evaluate(): PlatingBreakdown {
    const ramp = (v: number, good: number, bad: number) => THREE.MathUtils.clamp((v - bad) / (good - bad), 0, 1);
    const comps = this.comps;
    const centroid = new THREE.Vector2();
    for (const c of comps) centroid.add(c.pos);
    if (comps.length) centroid.divideScalar(comps.length);
    let minGap = 1;
    for (let i = 0; i < comps.length; i++) for (let j = i + 1; j < comps.length; j++) minGap = Math.min(minGap, comps[i].pos.distanceTo(comps[j].pos));
    const outer = comps.reduce((m, c) => Math.max(m, c.pos.length()), 0);
    const main = comps[0];
    const sauceLen = this.sauceStrokes.reduce((sum, s) => sum + s.reduce((l, p, i) => (i ? l + p.distanceTo(s[i - 1]) : 0), 0), 0);
    let sauce = 0.35;
    if (this.sauceStrokes.length === 1) sauce = sauceLen >= 0.1 && sauceLen <= 0.4 ? 1 : sauceLen < 0.1 ? 0.55 : 0.5;
    else if (this.sauceStrokes.length > 1) sauce = Math.max(0.1, 0.7 - (this.sauceStrokes.length - 1) * 0.2 - Math.max(0, sauceLen - 0.5));
    const garnish = this.garnishes === 0 ? 0.3 : this.garnishes <= 3 ? 1 : Math.max(0.2, 1 - (this.garnishes - 3) * 0.25);
    return {
      balance: 20 * ramp(centroid.length(), 0.04, 0.15),
      spacing: 20 * (comps.length < 2 ? 1 : ramp(minGap, 0.08, 0.03)),
      highlight: 15 * (main ? ramp(main.pos.length(), 0.09, 0.2) : 0),
      rim: Math.max(0, 15 * ramp(outer, 0.17, 0.25) - this.splatters.length * 5),
      sauce: 15 * sauce,
      garnish: 10 * garnish,
      speed: 5 * THREE.MathUtils.clamp(this.timeLeft / Math.max(1, this.timeMax) + 0.3, 0, 1),
    };
  }

  private worstIssue(): LineKey {
    const b = this.evaluate();
    if (this.timeLeft < 4) return 'platingHurry';
    const scaled: [LineKey, number][] = [
      ['platingRim', b.rim / 15],
      ['platingClutter', Math.min(b.spacing / 20, b.garnish / 10)],
      ['platingSauce', b.sauce / 15],
      ['platingBalance', Math.min(b.balance / 20, b.highlight / 15)],
    ];
    scaled.sort((a, b2) => a[1] - b2[1]);
    return scaled[0][1] > 0.85 ? 'platingGood' : scaled[0][0];
  }
}
