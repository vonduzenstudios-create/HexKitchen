import * as THREE from 'three';
import { audio, voice } from '../audio';
import type { GorgonPose, GorgonRig } from '../characters/gorgon';
import type { Waypoints } from './kitchen';
import { pickLine, type LineKey } from './lines';

export type GorgonState =
  | 'offstage'
  | 'patrol'
  | 'toInspect'
  | 'inspect'
  | 'gazeWindup'
  | 'gaze'
  | 'stunned'
  | 'toSabotage'
  | 'sabotage'
  | 'toInvestigate'
  | 'investigate'
  | 'scripted';

export type WrathStage = 'Calm' | 'Irritated' | 'Furious' | 'Petrifying Rage';

/** How each Wrath stage changes Gorgon. Thresholds are the minimum Wrath for that stage. */
export const WRATH_STAGES: { stage: WrathStage; min: number; interval: number; inspect: number; gaze: number; sabotage: number; speed: number; hearing: number }[] = [
  { stage: 'Calm', min: 0, interval: 1.4, inspect: 1, gaze: 0.4, sabotage: 0, speed: 0.85, hearing: 5 },
  { stage: 'Irritated', min: 30, interval: 1.0, inspect: 1.6, gaze: 0.8, sabotage: 0, speed: 1, hearing: 7 },
  { stage: 'Furious', min: 60, interval: 0.75, inspect: 1.2, gaze: 1.3, sabotage: 1, speed: 1.2, hearing: 9 },
  { stage: 'Petrifying Rage', min: 85, interval: 0.55, inspect: 0.6, gaze: 2.2, sabotage: 1, speed: 1.35, hearing: 12 },
];

export function wrathStage(wrath: number): (typeof WRATH_STAGES)[number] {
  let s = WRATH_STAGES[0];
  for (const x of WRATH_STAGES) if (wrath >= x.min) s = x;
  return s;
}

export interface RoundTemper {
  interval: number; // base seconds between interruptions at zero wrath
  inspect: number;
  gaze: number;
  sabotage: number;
  speed: number;
  windup: number; // gaze warning seconds
}

/** What Gorgon needs to know about (and do to) the rest of the game. */
export interface GorgonWorld {
  wrath(): number;
  addWrath(n: number): void;
  addPetrify(n: number, reason: string): void;
  playerPos(): THREE.Vector3;
  playerEye(): THREE.Vector3;
  playerForward(): THREE.Vector3;
  lineOfSightBlocked(from: THREE.Vector3, to: THREE.Vector3): boolean;
  mirrorAge(): number;
  inspectHeld(): 'good' | 'bad' | 'empty';
  sabotageTarget(): { spot: THREE.Vector3; station: string } | null;
  doSabotage(station: string, from: THREE.Vector3): 'knock' | 'bin' | 'slam';
  subtitle(text: string, seconds: number): void;
  shake(amount: number): void;
  stat(name: 'gazesSurvived' | 'reflects' | 'gazesCaught'): void;
  /** Dropped food lying on the floor within r metres of p. */
  messNear(p: THREE.Vector3, r: number): number;
}

const tmp = new THREE.Vector3();

export class GorgonAI {
  pos = new THREE.Vector3();
  yaw = 0;
  state: GorgonState = 'offstage';
  stateT = 0;
  temper: RoundTemper | null = null;
  /** Gaze charge 0..1 for HUD/post effects. */
  glow = 0;
  gazing = false;
  private path: THREE.Vector3[] = [];
  private speedMul = 1;
  private nextEvent = 12;
  private nextHurry = 15;
  private stepAcc = 0;
  private pose: GorgonPose = 'idle';
  private lookAt: THREE.Vector3 | null = null;
  private onArrive: (() => void) | null = null;
  private exposure = 0;
  private gazeFlags = { caught: false, mistimed: false, reflected: false };
  private sabotageStation = '';
  private lastSabotage = -999;
  /** Seconds left in a dropped-food meltdown. */
  private tantrumT = 0;
  private tantrumBeat = 0;
  private stageIdx = 0;
  private hearCd = 0;
  private noiseAt = new THREE.Vector3();
  /** Would the gaze hit the player right now, and why not? For the HUD warning. */
  gazeSafe = true;
  gazeReason = '';
  /** Wrath stage name for the HUD. */
  stage: WrathStage = 'Calm';
  private speakingUntil = 0;
  private clock = 0;
  private hissT = 4;
  anger = 0;

  constructor(
    readonly rig: GorgonRig,
    private wp: Waypoints,
    private world: GorgonWorld,
    private door: { left: THREE.Object3D; right: THREE.Object3D; pos: THREE.Vector3 },
  ) {
    this.pos.copy(wp.nodes.offstage);
    rig.root.position.copy(this.pos);
  }

  // ---------- speech ----------

  /** Speak a line. Lower-priority lines are dropped while he is already talking. */
  say(keyOrText: LineKey | string, priority = 1, isText = false): number {
    const text = isText ? keyOrText : pickLine(keyOrText as LineKey);
    if (this.clock < this.speakingUntil && priority < 2) return 0;
    const dur = voice.estimateDuration(text) + 0.4;
    this.speakingUntil = this.clock + dur;
    this.world.subtitle(text, dur + 0.6);
    voice.say(text, { pos: this.eye(), growl: 0.35 + this.anger * 0.4 }).catch(() => {});
    return dur;
  }

  /** Dropped food: he stops dead, stomps, slams the air and screams. Only while patrolling. */
  tantrum(): boolean {
    if (this.state !== 'patrol' || this.tantrumT > 0) return false;
    this.tantrumT = 2.6;
    this.tantrumBeat = 0;
    this.path = [];
    this.faceToward(this.world.playerEye());
    this.say('dropped', 2);
    audio.play('hiss', { pos: this.eye(), volume: 1 });
    return true;
  }

  /**
   * A noise in the kitchen (food hitting the floor, a clang). If he's free and it's within earshot,
   * he stops, shouts and storms over to see. Whatever mess is there when he arrives sets him off.
   */
  hear(at: THREE.Vector3, loudness = 1): boolean {
    if (this.state !== 'patrol' || this.tantrumT > 0 || this.hearCd > 0) return false;
    const range = wrathStage(this.world.wrath()).hearing * loudness;
    if (at.distanceTo(this.pos) > range) return false;
    this.hearCd = 6;
    this.noiseAt.copy(at).setY(0);
    this.set('toInvestigate');
    this.path = [];
    this.faceToward(at);
    this.say('whatWasThat', 2);
    audio.play('hiss', { pos: this.eye(), volume: 0.8 });
    return true;
  }

  sayAsync(keyOrText: LineKey | string, isText = false): Promise<void> {
    const d = this.say(keyOrText, 3, isText);
    return new Promise((r) => setTimeout(r, d * 1000));
  }

  get talking(): boolean {
    return this.clock < this.speakingUntil;
  }

  eye(target = new THREE.Vector3()): THREE.Vector3 {
    return this.rig.eyeWorldPosition(target);
  }

  // ---------- movement ----------

  private nearestNode(p: THREE.Vector3, exclude: string[] = []): string {
    let best = '';
    let bd = Infinity;
    for (const [k, v] of Object.entries(this.wp.nodes)) {
      if (exclude.includes(k)) continue;
      const d = v.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  private route(from: string, to: string): THREE.Vector3[] {
    const prev = new Map<string, string>();
    const q = [from];
    const seen = new Set([from]);
    while (q.length) {
      const n = q.shift()!;
      if (n === to) break;
      for (const [a, b] of this.wp.edges) {
        const m = a === n ? b : b === n ? a : null;
        if (m && !seen.has(m)) {
          seen.add(m);
          prev.set(m, n);
          q.push(m);
        }
      }
    }
    const out: THREE.Vector3[] = [];
    let c: string | undefined = to;
    while (c && c !== from) {
      out.unshift(this.wp.nodes[c].clone());
      c = prev.get(c);
    }
    return out;
  }

  /** Walk to a point via the waypoint graph. */
  walkTo(p: THREE.Vector3, speedMul = 1, onArrive?: () => void): void {
    const exclude = p.x < 6 ? ['offstage'] : [];
    const a = this.nearestNode(this.pos);
    const b = this.nearestNode(p, exclude);
    this.path = this.route(a, b);
    this.path.push(p.clone().setY(0));
    this.speedMul = speedMul;
    this.onArrive = onArrive ?? null;
  }

  goTo(p: THREE.Vector3, speedMul = 1): Promise<void> {
    this.state = 'scripted';
    return new Promise((r) => this.walkTo(p, speedMul, r));
  }

  teleport(p: THREE.Vector3): void {
    this.pos.copy(p).setY(0);
    this.path = [];
  }

  setScripted(pose: GorgonPose, lookAt: THREE.Vector3 | null = null): void {
    this.state = 'scripted';
    this.pose = pose;
    this.lookAt = lookAt;
  }

  faceToward(p: THREE.Vector3): void {
    this.yaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  /** Begin the round: march in through the doors. */
  enter(temper: RoundTemper): void {
    this.temper = temper;
    this.state = 'patrol';
    this.nextEvent = temper.interval * 0.6;
    this.walkTo(this.wp.nodes.southE, 1);
  }

  /** Stop interrupting (between rounds and cutscenes). */
  calm(): void {
    this.temper = null;
    this.gazing = false;
    this.glow = 0;
    if (this.state !== 'scripted') this.state = 'scripted';
    this.pose = 'idle';
  }

  private set(state: GorgonState): void {
    this.state = state;
    this.stateT = 0;
  }

  // ---------- behaviour ----------

  private startInterruption(): void {
    const t = this.temper!;
    const st = wrathStage(this.world.wrath());
    const options: [GorgonState, number][] = [
      ['toInspect', t.inspect * st.inspect],
      ['gazeWindup', t.gaze * st.gaze],
      // Sabotage only once he's Furious, and at most once every 40 seconds.
      ['toSabotage', this.clock - this.lastSabotage < 40 ? 0 : t.sabotage * st.sabotage],
    ];
    const total = options.reduce((a, o) => a + o[1], 0);
    let r = Math.random() * total;
    let pick: GorgonState = 'toInspect';
    for (const [s, wgt] of options) {
      if ((r -= wgt) <= 0) {
        pick = s;
        break;
      }
    }
    if (pick === 'toInspect') {
      const pp = this.world.playerPos();
      const spot = new THREE.Vector3(pp.x, 0, Math.min(-0.7, Math.max(pp.z + 1.0, -1.9)));
      if (pp.x > 2.9) spot.set(Math.min(5.5, pp.x + 1), 0, pp.z);
      audio.play('doorSlam', { pos: this.pos, volume: 0.25 });
      this.set('toInspect');
      this.walkTo(spot, 1.5 * t.speed, () => {
        this.set('inspect');
        this.say('inspectStart', 2);
      });
    } else if (pick === 'gazeWindup') {
      this.path = [];
      this.set('gazeWindup');
      audio.play('eyeGlow', { pos: this.eye() });
      audio.play('hiss', { pos: this.eye(), volume: 0.8 });
      if (Math.random() < 0.7) this.say('gazeWarn', 2);
      this.gazeFlags = { caught: false, mistimed: false, reflected: false };
      this.exposure = 0;
    } else {
      const target = this.world.sabotageTarget();
      if (!target) {
        this.nextEvent = 3;
        return;
      }
      this.sabotageStation = target.station;
      this.lastSabotage = this.clock;
      this.set('toSabotage');
      this.walkTo(target.spot, 1.4 * t.speed, () => this.set('sabotage'));
    }
  }

  private wander(): void {
    const keys = ['southE', 'southM', 'southW', 'west', 'backW', 'backM', 'backC', 'backE', 'east'];
    let k = keys[Math.floor(Math.random() * keys.length)];
    // Once irritated he paces close to you, breathing down your neck.
    if (this.stageIdx >= 1 && Math.random() < 0.4 + this.stageIdx * 0.15) {
      const pp = this.world.playerPos();
      k = keys.slice().sort((a, b) => this.wp.nodes[a].distanceTo(pp) - this.wp.nodes[b].distanceTo(pp))[Math.floor(Math.random() * 2)];
    }
    this.walkTo(this.wp.nodes[k], 0.8 * wrathStage(this.world.wrath()).speed);
  }

  update(dt: number): void {
    this.clock += dt;
    this.stateT += dt;
    const t = this.temper;
    const w = this.world.wrath() / 100;
    this.anger += (Math.max(w, this.state === 'gaze' ? 1 : 0) - this.anger) * Math.min(1, dt * 2);
    this.hearCd -= dt;
    const st = wrathStage(this.world.wrath());
    const idx = WRATH_STAGES.indexOf(st);
    if (idx !== this.stageIdx) {
      // Announce climbing a stage so the player always knows why he's suddenly worse.
      if (idx > this.stageIdx && this.temper) {
        this.say(idx === 1 ? 'stageIrritated' : idx === 2 ? 'stageFurious' : 'stageRage', 2);
        audio.play('hiss', { pos: this.eye(), volume: 1 });
      }
      this.stageIdx = idx;
      this.stage = st.stage;
    }

    let pose: GorgonPose = 'idle';
    let lookAt: THREE.Vector3 | null = null;
    const eyeP = this.world.playerEye();

    switch (this.state) {
      case 'offstage':
        break;
      case 'patrol':
        if (!t) break;
        if (!this.watching) this.nextEvent -= dt;
        this.nextHurry -= dt;
        if (this.path.length === 0) this.wander();
        if (this.nextHurry <= 0) {
          this.nextHurry = 14 + Math.random() * 10;
          this.say('hurry', 1);
        }
        if (this.nextEvent <= 0) {
          this.nextEvent = t.interval * st.interval * (0.8 + Math.random() * 0.4);
          this.startInterruption();
        }
        lookAt = Math.random() < 0.5 ? eyeP : null;
        break;
      case 'toInspect':
      case 'toSabotage':
        lookAt = eyeP;
        break;
      case 'inspect':
        pose = this.stateT < 3 ? 'armsCrossed' : 'point';
        lookAt = eyeP;
        this.faceToward(eyeP);
        if (this.stateT > 3 && this.stateT - dt <= 3) {
          const r = this.world.inspectHeld();
          if (r === 'good') {
            this.say('inspectGood', 2);
            this.world.addWrath(-4);
          } else if (r === 'bad') {
            this.say('inspectBad', 2);
            this.world.addWrath(10);
            audio.play('slam', { pos: this.pos });
            this.world.shake(0.5);
          } else {
            this.say('inspectEmpty', 2);
            this.world.addWrath(6);
          }
        }
        if (this.stateT > 5) this.backToPatrol();
        break;
      case 'gazeWindup': {
        const windup = t?.windup ?? 1.8;
        this.glow = Math.min(1, this.stateT / windup);
        this.checkCover();
        this.faceToward(eyeP);
        pose = 'gaze';
        lookAt = eyeP;
        if (this.stateT >= windup) {
          this.set('gaze');
          this.gazing = true;
          audio.play('hiss', { pos: this.eye() });
          if (this.world.lineOfSightBlocked(this.eye(), eyeP)) this.exposure = -1;
        }
        break;
      }
      case 'gaze':
        this.glow = 1;
        pose = 'gaze';
        lookAt = eyeP;
        this.faceToward(eyeP);
        this.updateGaze(dt);
        this.checkCover();
        if (this.state === 'gaze' && this.stateT > 2.6) {
          this.gazing = false;
          this.glow = 0;
          if (!this.gazeFlags.caught) {
            this.world.stat('gazesSurvived');
            this.say('gazeSurvived', 1);
          }
          this.backToPatrol();
        }
        break;
      case 'stunned':
        pose = 'stunned';
        this.glow = 0;
        if (this.stateT > 4) this.backToPatrol();
        break;
      case 'sabotage':
        pose = 'slam';
        lookAt = eyeP;
        if (this.stateT > 0.6 && this.stateT - dt <= 0.6) {
          const kind = this.world.doSabotage(this.sabotageStation, this.pos);
          audio.play('slam', { pos: this.pos });
          audio.play('clang', { pos: this.pos, volume: 1 });
          this.world.shake(0.8);
          this.say(kind === 'bin' ? 'sabotageBin' : kind === 'knock' ? 'sabotageKnock' : 'sabotageSlam', 2);
          this.world.addWrath(-3);
        }
        if (this.stateT > 2) this.backToPatrol();
        break;
      case 'toInvestigate':
        // A beat of stillness while he turns toward the noise, then he storms over.
        if (this.stateT < 0.9) {
          pose = 'yell';
          this.faceToward(this.noiseAt);
        } else if (!this.path.length && !this.onArrive) {
          const spot = this.noiseAt.clone();
          this.walkTo(spot, 1.5 * wrathStage(this.world.wrath()).speed, () => this.set('investigate'));
        }
        lookAt = this.noiseAt.clone().setY(0.3);
        break;
      case 'investigate': {
        pose = this.stateT < 1.2 ? 'armsCrossed' : 'point';
        lookAt = this.noiseAt.clone().setY(0.2);
        if (this.stateT > 1.2 && this.stateT - dt <= 1.2) {
          const mess = this.world.messNear(this.noiseAt, 1.6);
          if (mess > 0) {
            this.set('patrol');
            this.world.addWrath(4 + 4 * Math.min(3, mess));
            this.tantrum();
          } else {
            this.say('investigateNothing', 2);
            this.world.addWrath(3);
          }
        }
        if (this.state === 'investigate' && this.stateT > 3) this.backToPatrol();
        break;
      }
      case 'scripted':
        pose = this.pose;
        lookAt = this.lookAt;
        break;
    }

    // Walk along the path.
    let walking = false;
    if (this.path.length && this.state !== 'gaze' && this.state !== 'gazeWindup' && this.state !== 'stunned') {
      const target = this.path[0];
      tmp.copy(target).sub(this.pos).setY(0);
      const d = tmp.length();
      const speed = 1.6 * this.speedMul * (t?.speed ?? 1);
      if (d < 0.05) {
        this.path.shift();
        if (!this.path.length && this.onArrive) {
          const cb = this.onArrive;
          this.onArrive = null;
          cb();
        }
      } else {
        const step = Math.min(d, speed * dt);
        this.pos.addScaledVector(tmp.normalize(), step);
        const targetYaw = Math.atan2(tmp.x, tmp.z);
        let dy = targetYaw - this.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.yaw += dy * Math.min(1, dt * 8);
        walking = true;
        this.stepAcc += step;
        if (this.stepAcc > 0.72) {
          this.stepAcc = 0;
          audio.play('footstep', { pos: this.pos, volume: 0.9, pitch: 0.9 + Math.random() * 0.15 });
        }
      }
    }
    if (this.tantrumT > 0) {
      this.tantrumT -= dt;
      if (this.state !== 'patrol') this.tantrumT = 0;
      else {
        this.path = [];
        lookAt = eyeP;
        this.faceToward(eyeP);
        this.anger = 1;
        // Stomp-slam rhythm: each beat shakes the kitchen.
        this.tantrumBeat -= dt;
        if (this.tantrumBeat <= 0) {
          this.tantrumBeat = 0.42;
          audio.play('clang', { pos: this.pos, volume: 0.8, pitch: 0.6 + Math.random() * 0.2 });
          audio.play('footstep', { pos: this.pos, volume: 1, pitch: 0.7 });
          this.world.shake(0.55);
        }
        pose = Math.floor(this.tantrumT / 0.42) % 2 === 0 ? 'slam' : 'yell';
      }
    }
    if (walking && pose === 'idle') pose = 'walk';
    if (this.talking && (pose === 'idle' || pose === 'walk')) pose = walking ? 'walk' : 'yell';

    // Snakes hiss now and then; more when angry.
    this.hissT -= dt * (0.5 + this.anger);
    if (this.hissT <= 0 && this.state !== 'offstage') {
      this.hissT = 5 + Math.random() * 6;
      audio.play('hiss', { pos: this.eye(), volume: 0.35 });
    }

    // Swinging doors open as he passes.
    const dd = Math.hypot(this.pos.x - this.door.pos.x, this.pos.z - this.door.pos.z);
    const open = dd < 1.6 ? (1 - dd / 1.6) * 1.3 : 0;
    this.door.left.rotation.y += (-open - this.door.left.rotation.y) * Math.min(1, dt * 8);
    this.door.right.rotation.y += (open - this.door.right.rotation.y) * Math.min(1, dt * 8);

    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.setEyeGlow(this.glow);
    this.rig.setAnger(this.anger);
    this.rig.update(dt, { pose, speed: walking ? 1.6 * this.speedMul : 0, talking: this.talking, lookAt });
  }

  /** Live read of the player's cover, shown while the gaze charges and fires. */
  private checkCover(): void {
    const eyeG = this.eye();
    const eyeP = this.world.playerEye();
    const facing = this.world.playerForward().dot(eyeG.clone().sub(eyeP).normalize());
    if (this.gazeFlags.reflected) [this.gazeSafe, this.gazeReason] = [true, 'Reflected!'];
    else if (this.world.lineOfSightBlocked(eyeG, eyeP)) [this.gazeSafe, this.gazeReason] = [true, 'Hidden'];
    else if (facing <= 0.64) [this.gazeSafe, this.gazeReason] = [true, 'Looking away'];
    else [this.gazeSafe, this.gazeReason] = [false, 'In his sight'];
  }

  private updateGaze(dt: number): void {
    const eyeG = this.eye();
    const eyeP = this.world.playerEye();
    const toG = eyeG.clone().sub(eyeP).normalize();
    const facing = this.world.playerForward().dot(toG);
    const blocked = this.world.lineOfSightBlocked(eyeG, eyeP);
    const mAge = this.world.mirrorAge();

    // Mirror pan: raised in time while facing him reflects the gaze.
    if (!this.gazeFlags.reflected && mAge !== Infinity && facing > 0.75 && !blocked) {
      if (mAge <= 1.1) {
        this.gazeFlags.reflected = true;
        this.gazing = false;
        this.glow = 0;
        audio.play('reflect', { pos: eyeG });
        audio.play('stun', { pos: eyeG });
        this.world.addWrath(-12);
        this.world.stat('reflects');
        this.say('reflected', 3);
        this.set('stunned');
        return;
      }
      if (!this.gazeFlags.mistimed) {
        this.gazeFlags.mistimed = true;
        this.world.addPetrify(15, 'mistimed mirror');
        this.say('mistimed', 2);
      }
    }

    if (facing > 0.64 && !blocked) {
      this.exposure += dt;
      this.world.addPetrify(24 * dt, 'gaze');
      if (Math.random() < dt * 8) audio.play('petrifyTick', { volume: 0.7 });
      if (!this.gazeFlags.caught && this.exposure > 0.35) {
        this.gazeFlags.caught = true;
        this.world.stat('gazesCaught');
        audio.play('stoneCrack');
        this.say('gazeCaught', 2);
      }
    }
  }

  /** Plating Mode: he hovers and judges instead of interrupting. Cancels a gaze that's winding up. */
  watch(): void {
    this.watching = true;
    if (this.state === 'gazeWindup' || this.state === 'gaze') this.backToPatrol();
    this.nextEvent = Math.max(this.nextEvent, 4);
  }

  resume(): void {
    this.watching = false;
  }

  private watching = false;

  private backToPatrol(): void {
    this.gazing = false;
    this.glow = 0;
    if (!this.temper) {
      this.state = 'scripted';
      this.pose = 'idle';
      return;
    }
    this.set('patrol');
    this.path = [];
  }
}
