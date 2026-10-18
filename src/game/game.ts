import * as THREE from 'three';
import { audio, music, voice, type LoopHandle } from '../audio';
import { buildGorgon } from '../characters/gorgon';
import { buildHands, type HandsRig } from '../characters/hands';
import type { Input } from '../engine/input';
import { Physics, GROUP } from '../engine/physics';
import type { PsxRenderer } from '../engine/renderer';
import type { Hud } from '../ui/hud';
import { GorgonAI, type GorgonWorld, type RoundTemper } from './gorgonAI';
import { ingredientMeshFactories } from './ingredients';
import { Interaction } from './interact';
import { Items, type Item } from './items';
import { buildKitchen, type Kitchen, type StationId } from './kitchen';
import { pickLine, type LineKey } from './lines';
import { Particles } from './particles';
import { Player } from './player';
import { evaluateDish, RECIPES, type DishResult, type Recipe } from './recipes';
import { Rivals } from './rivals';
import { Stations, type PlateId, type Ticket } from './stations';
import { buildObjectives } from './objectives';

interface RoundDef {
  name: string;
  title: string;
  sub: string;
  line: LineKey;
  seconds: number;
  recipes: Recipe[];
  temper: RoundTemper;
  boss?: boolean;
}

const ROUNDS: RoundDef[] = [
  {
    name: 'Round 1 · The Appetizer',
    title: 'Round 1',
    sub: 'The Appetizer: one Cursed Caesar',
    line: 'round1',
    seconds: 240,
    recipes: [RECIPES.caesar],
    temper: { interval: 22, inspect: 1, gaze: 0.8, sabotage: 0, speed: 0.9, windup: 2.4 },
  },
  {
    name: 'Round 2 · Dinner Rush',
    title: 'Round 2',
    sub: 'Dinner Rush: Steak & Fries AND Spaghetti',
    line: 'round2',
    seconds: 360,
    recipes: [RECIPES.steakFries, RECIPES.spaghetti],
    temper: { interval: 15, inspect: 1, gaze: 1, sabotage: 0.8, speed: 1, windup: 2.0 },
  },
  {
    name: 'Round 3 · The Final Judgment',
    title: 'The Final Judgment',
    sub: "Cook Gorgon's signature Medusa Wellington",
    line: 'round3',
    seconds: 300,
    recipes: [RECIPES.wellington],
    temper: { interval: 10, inspect: 0.4, gaze: 1.4, sabotage: 1, speed: 1.25, windup: 1.6 },
    boss: true,
  },
];

type Phase = 'title' | 'cutscene' | 'playing' | 'dead' | 'ended';

export class Game {
  readonly scene = new THREE.Scene();
  private physics = new Physics();
  private kitchen!: Kitchen;
  private items!: Items;
  private particles!: Particles;
  private stations!: Stations;
  private rivals!: Rivals;
  private gorgon!: GorgonAI;
  private player!: Player;
  private hands!: HandsRig;
  private interact!: Interaction;

  private phase: Phase = 'title';
  private paused = false;
  private time = 0;
  private acc = 0;
  private wrath = 20;
  private petrify = 0;
  private stoneVisual = 0;
  private flash = 0;
  private roundIndex = -1;
  private roundTime = 0;
  private tickets: Ticket[] = [];
  private ticketId = 1;
  private results: { recipe: Recipe; result: DishResult | null }[] = [];
  private waiters: { t: number; resolve: () => void }[] = [];
  private roundDone: (() => void) | null = null;
  private heartbeat: LoopHandle | null = null;
  private thrownHits = new Set<number>();
  private bossRivalDone = false;
  private reactCd = 0;
  private stats = { dropped: 0, gazesSurvived: 0, gazesCaught: 0, reflects: 0, fires: 0, thrown: 0, worst: '', worstScore: 101, insult: '' };

  constructor(
    private renderer: PsxRenderer,
    private input: Input,
    private hud: Hud,
  ) {}

  async init(): Promise<void> {
    await this.physics.init();
    this.kitchen = buildKitchen(this.scene, this.physics, ingredientMeshFactories);
    this.particles = new Particles(this.scene);
    this.items = new Items(this.scene, this.physics);
    this.items.onFloor = (it) => this.onFloor(it);
    this.items.onImpact = (it, s) => {
      const soft = it.kind !== 'mirrorPan';
      audio.play(soft ? (Math.random() < 0.5 ? 'squish' : 'thud') : 'clang', { pos: it.group.position, volume: 0.25 + s * 0.75, pitch: 0.85 + Math.random() * 0.3 });
    };
    this.stations = new Stations(this.scene, this.kitchen, this.items, this.particles, {
      chop: (q) => {
        if (q < 0.4) this.react('laugh', 0.25);
      },
      chopDone: () => {},
      flip: () => {},
      flipFail: (it) => {
        this.addWrath(5);
        this.gorgonSay('dropped');
        this.react('laugh', 0.8);
        void it;
      },
      burning: () => this.gorgonSay('burning'),
      fire: () => {
        this.stats.fires++;
        this.addWrath(15);
        this.gorgonSay('fire', false, 2);
        this.react('gasp', 1);
        music.sting('fail');
      },
      shakerLid: () => {
        this.addWrath(5);
        this.gorgonSay('shakerLid', false, 2);
        this.react('laugh', 1);
      },
    });
    this.rivals = new Rivals(this.scene, this.kitchen.rivalSpots, this.physics, this.particles);
    const rig = buildGorgon();
    // Only draw the gaze cone from outside; from inside it would tint the whole screen.
    if (rig.glowCone) (rig.glowCone.material as THREE.Material).side = THREE.FrontSide;
    this.scene.add(rig.root);
    this.gorgon = new GorgonAI(rig, this.kitchen.waypoints, this.gorgonWorld(), this.kitchen.door);

    this.player = new Player(this.physics, this.kitchen.spawn, this.renderer.aspect());
    this.scene.add(this.player.camera);
    this.hands = buildHands();
    this.player.camera.add(this.hands.root);
    // Push the hands a little further away and lower so they frame the view without hogging it.
    this.hands.root.position.set(0, -0.05, -0.12);
    this.interact = new Interaction(this.player, this.kitchen, this.items, this.stations, this.hands, {
      serve: (plates) => this.serve(plates),
      grabbed: () => {},
      thrown: () => {},
    });
    this.hangMirrorPan();
    window.addEventListener('resize', () => {
      this.player.camera.aspect = this.renderer.aspect();
      this.player.camera.updateProjectionMatrix();
    });
    // Warm up physics so everything settles before the first frame.
    for (let i = 0; i < 10; i++) this.physics.step();
  }

  private hangMirrorPan(): void {
    const pan = this.items.spawn('mirrorPan', this.kitchen.mirrorHook.clone());
    pan.setKinematic(true);
    pan.where = 'hook';
    pan.drive(this.kitchen.mirrorHook.clone(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  }

  // ---------- the bridge Gorgon uses to act on the world ----------

  private gorgonWorld(): GorgonWorld {
    return {
      wrath: () => this.wrath,
      addWrath: (n) => this.addWrath(n),
      addPetrify: (n, reason) => this.addPetrify(n, reason),
      playerPos: () => this.player.position,
      playerEye: () => this.player.camera.position.clone(),
      playerForward: () => this.player.forward(),
      lineOfSightBlocked: (from, to) => {
        const d = to.clone().sub(from);
        const len = d.length();
        return this.physics.raycast(from, d.normalize(), Math.max(0, len - 0.25), GROUP.STATIC | GROUP.STATUE) !== null;
      },
      mirrorAge: () => this.interact.mirrorAge(),
      inspectHeld: () => {
        const h = this.interact.held;
        if (!h) return 'empty';
        if (!h.isIngredient) return 'bad';
        const c = h.cook;
        if (c.floor || h.cookLevel() > 1.5) return 'bad';
        if (c.chopped && c.chopScoreSum / Math.max(1, c.chopHits) < 0.45) return 'bad';
        if (c.season > 1) return 'bad';
        return 'good';
      },
      sabotageTarget: () => {
        const order: StationId[] = this.wrath > 55 ? ['plateA', 'plateB', 'pan', 'board', 'prep'] : ['board', 'prep', 'pan', 'plateA', 'plateB'];
        const st = order.find((s) => this.stations.occupant[s].length > 0);
        if (!st) {
          const pp = this.player.position;
          return { spot: new THREE.Vector3(pp.x, 0, Math.max(-1.9, Math.min(-0.8, pp.z + 1))), station: '' };
        }
        const p = this.kitchen.stations[st];
        const spot = st.startsWith('plate') ? new THREE.Vector3(4.2, 0, p.z) : new THREE.Vector3(p.x, 0, -2.3);
        return { spot, station: st };
      },
      doSabotage: (station, from) => {
        if (!station) return 'slam';
        const st = station as StationId;
        const items = this.stations.occupant[st];
        if (!items.length) return 'slam';
        if (st.startsWith('plate') && Math.random() < 0.55) {
          for (const it of items.slice()) {
            this.stations.take(it);
            this.particles.emit(it.group.position, { color: 0x888888, count: 10, up: 1, speed: 0.6, gravity: 5, life: 0.8 });
            this.items.remove(it);
          }
          this.react('gasp', 1);
          return 'bin';
        }
        this.stations.knock(st, from);
        this.react('laugh', 0.6);
        return 'knock';
      },
      subtitle: (text, s) => this.hud.subtitle(text, s),
      shake: (a) => (this.player.shake = Math.max(this.player.shake, a)),
      stat: (name) => {
        this.stats[name]++;
        if (name === 'reflects') this.react('applause', 1);
        if (name === 'gazesCaught') this.react('gasp', 0.7);
      },
    };
  }

  // ---------- meters ----------

  addWrath(n: number): void {
    this.wrath = THREE.MathUtils.clamp(this.wrath + n, 0, 100);
  }

  addPetrify(n: number, reason: string): void {
    if (this.phase === 'dead' || this.phase === 'ended') return;
    this.petrify = THREE.MathUtils.clamp(this.petrify + n, 0, 100);
    if (n > 5) this.flash = 1;
    if (this.petrify >= 100 && this.phase === 'playing') void this.petrifiedDeath(reason);
  }

  private gorgonSay(keyOrText: LineKey | string, isText = false, priority = 1): void {
    this.gorgon.say(keyOrText, priority, isText);
  }

  private react(kind: 'laugh' | 'gasp' | 'applause' | 'boo', chance: number): void {
    if (this.reactCd > 0 || Math.random() > chance) return;
    this.reactCd = 2.5;
    audio.play(kind, { volume: 0.55 });
  }

  private onFloor(it: Item): void {
    if (this.phase !== 'playing') return;
    this.stats.dropped++;
    this.addWrath(3);
    if (Math.random() < 0.5) this.gorgonSay('dropped');
    this.react('laugh', 0.4);
    void it;
  }

  // ---------- flow ----------

  private wait(seconds: number): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ t: seconds, resolve }));
  }

  async run(): Promise<void> {
    this.phase = 'cutscene';
    this.hud.setPlaying(true);
    audio.loop('ambience', { volume: 0.5 });
    this.heartbeat = audio.loop('heartbeat', { volume: 0 });
    this.stations.startAmbientLoops();
    music.setMode('round');
    music.setIntensity(0.1);

    // Gorgon bursts through the doors.
    audio.play('doorSlam', { pos: this.kitchen.door.pos });
    music.sting('dread');
    this.hud.showBanner('Hex Kitchen', 'Tonight\'s host: Gorgon Ramsey', 3.5);
    this.player.faceTarget = new THREE.Vector3(2.3, 1.6, 1.4);
    await this.gorgon.goTo(this.kitchen.waypoints.nodes.southE, 1.1);
    this.gorgon.setScripted('armsCrossed', this.player.camera.position);
    this.gorgon.faceToward(this.player.position);
    this.player.faceTarget = this.gorgon.eye();
    await this.wait(this.gorgon.say('intro', 3));
    this.player.faceTarget = null;

    for (let i = 0; i < ROUNDS.length; i++) {
      await this.playRound(i);
      if ((this.phase as Phase) === 'dead') return;
      if (i < ROUNDS.length - 1) await this.stoneColdScene(i);
    }
  }

  private async playRound(i: number): Promise<void> {
    const r = ROUNDS[i];
    this.roundIndex = i;
    this.phase = 'cutscene';
    this.interact.reset();
    // Clear leftovers off the plates; mess on the floor stays as a monument.
    for (const p of ['plateA', 'plateB'] as PlateId[]) for (const it of this.stations.occupant[p].slice()) {
      this.stations.take(it);
      this.items.remove(it);
    }
    this.tickets = r.recipes.map((recipe, k) => ({ id: this.ticketId++, recipe, plate: (k === 0 ? 'plateA' : 'plateB') as PlateId, served: false, age: 0 }));
    this.stations.assignTicket('plateA', this.tickets[0] ?? null);
    this.stations.assignTicket('plateB', this.tickets[1] ?? null);
    this.roundTime = r.seconds;
    this.hud.showBanner(r.title, r.sub, 3.5);
    audio.play('roundStart');
    music.setMode(r.boss ? 'boss' : 'round');
    if (r.boss) this.rivals.setMood(true);
    await this.wait(Math.max(2.5, this.gorgon.say(r.line, 3) * 0.6));
    this.phase = 'playing';
    this.gorgon.enter(r.temper);
    await new Promise<void>((res) => (this.roundDone = res));
    this.roundDone = null;
    if ((this.phase as Phase) === 'dead') return;
    this.gorgon.calm();
    this.interact.reset();

    // Unserved tickets fail.
    const unserved = this.tickets.filter((t) => !t.served);
    if (r.boss) {
      const t = this.tickets[0];
      let result: DishResult;
      if (t.served) result = this.results[this.results.length - 1].result!;
      else {
        const plated = this.stations.collectPlate(t.plate);
        result = evaluateDish(t.recipe, plated);
        t.served = true;
        this.results.push({ recipe: t.recipe, result });
      }
      await this.tasting(result);
      return;
    }
    if (unserved.length) {
      audio.play('buzzer');
      for (const t of unserved) {
        this.results.push({ recipe: t.recipe, result: null });
        this.addPetrify(20, 'timeout');
        this.addWrath(15);
      }
      this.trackWorst(`Served nothing for the ${unserved[0].recipe.name}`, 0);
      this.gorgonSay('timeout', false, 3);
    } else {
      audio.play('roundEnd');
    }
    this.hud.showBanner('Time!', `${r.title} complete`, 2.5);
    await this.wait(3);
  }

  private async stoneColdScene(i: number): Promise<void> {
    this.phase = 'cutscene';
    const rival = this.rivals.list[i];
    const spot = this.kitchen.statueSpots[i];
    music.setMode('tasting');
    music.sting('dread');
    rival.action = 'panic';
    this.player.faceTarget = rival.pos.clone().setY(1.4);
    const walk = rival.walkTo(spot);
    await this.gorgon.goTo(spot.clone().add(new THREE.Vector3(0, 0, 1.4)), 1.3);
    await walk;
    rival.action = 'cower';
    rival.yaw = 0;
    this.gorgon.faceToward(spot);
    this.gorgon.setScripted('gaze', spot.clone().setY(1.5));
    this.gorgon.glow = 1;
    audio.play('eyeGlow', { pos: spot });
    this.player.faceTarget = spot.clone().setY(1.3);
    await this.wait(1.2);
    await this.rivals.petrify(rival);
    this.gorgon.glow = 0;
    this.react('gasp', 1);
    this.gorgon.setScripted('armsCrossed', this.player.camera.position);
    await this.wait(this.gorgon.say('stoneCold', 3));
    this.player.faceTarget = null;
  }

  private async tasting(result: DishResult): Promise<void> {
    this.phase = 'cutscene';
    music.setMode('tasting');
    this.hud.showBanner('The Tasting', 'Gorgon tastes your Medusa Wellington...', 3);
    const judge = this.kitchen.judgeSpot;
    this.player.faceTarget = judge.clone().setY(1.75);
    await this.gorgon.goTo(judge, 1.2);
    this.gorgon.faceToward(new THREE.Vector3(3.35, 0, -1.9));
    this.gorgon.setScripted('taste', null);
    await this.wait(this.gorgon.say('tasteStart', 3));
    this.heartbeat?.setVolume(0.8);
    await this.wait(3);
    this.heartbeat?.setVolume(0);
    const win = result.score >= 60 && this.petrify < 100;
    this.gorgon.faceToward(this.player.position);
    this.hud.toast(result.grade, result.score, result.breakdown.join(' · '));
    if (win) {
      this.gorgon.setScripted('laugh', this.player.camera.position);
      music.setMode('victory');
      this.react('applause', 1);
      await this.wait(this.gorgon.say('verdictWin', 3));
      this.finish(true, pickLine('verdictWin'));
    } else {
      this.gorgon.setScripted('gaze', this.player.camera.position);
      this.player.faceTarget = this.gorgon.eye();
      const d = this.gorgon.say('verdictLose', 3);
      this.gorgon.glow = 1;
      audio.play('eyeGlow');
      await this.wait(Math.max(2, d - 0.5));
      this.phase = 'dead';
      for (let k = 0; k < 20; k++) {
        this.petrify = Math.min(100, this.petrify + 6);
        if (k % 4 === 0) audio.play('petrifyTick');
        await this.wait(0.08);
      }
      audio.play('stoneCrack');
      this.react('gasp', 1);
      music.setMode('gameover');
      await this.wait(2);
      this.finish(false, pickLine('verdictLose'));
    }
  }

  private async petrifiedDeath(reason: string): Promise<void> {
    this.phase = 'dead';
    this.interact.reset();
    this.gorgon.calm();
    this.roundDone?.();
    audio.play('stoneCrack');
    music.setMode('gameover');
    this.react('gasp', 1);
    this.trackWorst(reason === 'gaze' ? 'Stared directly into Gorgon\'s eyes' : 'Turned to stone mid-service', -1);
    this.gorgon.setScripted('laugh', this.player.camera.position);
    this.player.faceTarget = this.gorgon.eye();
    const line = pickLine('petrified');
    await this.wait(this.gorgon.say(line, 3, true) + 0.5);
    this.finish(false, line);
  }

  private finish(won: boolean, quote: string): void {
    this.phase = 'ended';
    this.hud.setPlaying(false);
    document.exitPointerLock?.();
    const scores = ROUNDS.flatMap((r) => r.recipes).map((rec) => this.results.find((x) => x.recipe === rec)?.result?.score ?? 0);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    let stars = avg >= 90 ? 5 : avg >= 75 ? 4 : avg >= 60 ? 3 : avg >= 40 ? 2 : 1;
    if (!won) stars = Math.min(stars, 2);
    const reached = ROUNDS.slice(0, this.roundIndex + 1).flatMap((r) => r.recipes);
    const rows: [string, string][] = ROUNDS.flatMap((r) => r.recipes).map((rec) => {
      const res = this.results.find((x) => x.recipe === rec)?.result;
      return [rec.name, res ? `${res.score} · ${res.grade}` : reached.includes(rec) ? 'not served' : 'never reached'];
    });
    rows.push(['Food dropped', `${this.stats.dropped}`]);
    rows.push(['Gazes survived', `${this.stats.gazesSurvived}`]);
    rows.push(['Gazes reflected', `${this.stats.reflects}`]);
    rows.push(['Kitchen fires', `${this.stats.fires}`]);
    rows.push(['Food thrown at Gorgon', `${this.stats.thrown}`]);
    if (this.stats.worst) rows.push(['Worst moment', this.stats.worst]);
    const screen = this.hud.endScreen({ won, title: won ? 'You Survived' : 'Petrified', quote, stars, rows });
    screen.querySelector('#again')?.addEventListener('click', () => location.reload());
  }

  private trackWorst(text: string, score: number): void {
    if (score < 70 && score < this.stats.worstScore) {
      this.stats.worstScore = score;
      this.stats.worst = text;
    }
  }

  private serve(plates: PlateId[]): void {
    if (this.phase !== 'playing') return;
    let servedAny = false;
    for (const p of plates) {
      const t = this.stations.plates[p].ticket;
      if (!t || t.served || this.stations.occupant[p].length === 0) continue;
      const plated = this.stations.collectPlate(p);
      const result = evaluateDish(t.recipe, plated);
      t.served = true;
      servedAny = true;
      this.results.push({ recipe: t.recipe, result });
      this.stations.assignTicket(p, null);
      this.hud.toast(result.grade, result.score, `${t.recipe.name}: ${result.breakdown.join(' · ')}`);
      this.trackWorst(`${result.grade} ${t.recipe.name} (${result.score})`, result.score);
      if (ROUNDS[this.roundIndex].boss) {
        // The Wellington goes straight to judgment.
        this.roundDone?.();
        return;
      }
      this.gorgonSay(result.issue, false, 3);
      if (result.grade === 'Perfect') {
        this.addWrath(-20);
        this.addPetrify(-15, 'perfect');
        music.sting('success');
        this.react('applause', 1);
      } else if (result.grade === 'Good') {
        this.addWrath(-8);
        this.addPetrify(-5, 'good');
        this.react('applause', 0.6);
      } else if (result.grade === 'Poor') {
        this.addWrath(15);
        this.addPetrify(10, 'poor dish');
        this.react('boo', 0.7);
        music.sting('fail');
      } else {
        this.addWrath(25);
        this.addPetrify(25, 'raw dish');
        this.react('boo', 1);
        music.sting('fail');
      }
    }
    if (!servedAny) this.gorgonSay('emptyPlate', false, 2);
    else if (this.tickets.every((t) => t.served)) this.roundDone?.();
  }

  // ---------- per frame ----------

  onPauseChange(paused: boolean): void {
    if (this.phase === 'title' || this.phase === 'ended') return;
    this.paused = paused;
    if (paused) {
      voice.stop();
      const s = this.hud.pauseScreen();
      s.querySelector('#resume')?.addEventListener('click', () => this.input.requestLock());
    } else {
      this.hud.hideScreen();
    }
  }

  frame(rawDt: number): void {
    const dt = Math.min(rawDt, 1 / 20);
    if (!this.paused && this.phase !== 'title') this.step(dt);
    this.hud.update(dt);
    this.kitchen.update(this.time, this.wrath / 100);
    this.renderer.stone = this.stoneVisual;
    this.renderer.flash = this.flash;
    this.renderer.glow = this.gorgon.glow * 0.3;
    this.renderer.render(this.scene, this.player.camera, this.time);
    this.input.endFrame();
  }

  private step(dt: number): void {
    this.time += dt;
    this.reactCd -= dt;
    for (const w of this.waiters.slice()) if ((w.t -= dt) <= 0) {
      this.waiters.splice(this.waiters.indexOf(w), 1);
      w.resolve();
    }

    const playing = this.phase === 'playing';
    if (playing) {
      this.roundTime -= dt;
      for (const t of this.tickets) t.age += dt;
      if (this.roundTime <= 0) this.roundDone?.();
      // Final rival falls mid-way through the boss round.
      const r = ROUNDS[this.roundIndex];
      if (r.boss && !this.bossRivalDone && this.roundTime < r.seconds * 0.55 && this.gorgon.state === 'patrol') {
        this.bossRivalDone = true;
        const last = this.rivals.list[2];
        last.action = 'panic';
        audio.play('eyeGlow', { pos: last.pos });
        this.gorgon.say('stoneCold', 2);
        void this.rivals.petrify(last).then(() => this.react('gasp', 1));
      }
    }

    const working = this.interact.working !== null;
    this.player.moveEnabled = playing && !working;
    this.player.lookEnabled = playing ? !working : this.phase !== 'dead';
    this.player.update(dt, this.input);
    this.interact.update(dt, this.input, playing);

    this.acc += dt;
    while (this.acc >= 1 / 60) {
      this.physics.step();
      this.acc -= 1 / 60;
    }
    this.items.update();
    this.stations.update(dt);
    this.gorgon.update(dt);
    this.rivals.setMood(this.gorgon.gazing || this.gorgon.state === 'gazeWindup');
    this.rivals.update(dt);
    this.particles.update(dt);
    this.checkThrownAtGorgon();
    if (this.items.list.length > 70) {
      const old = this.items.list.find((i) => i.where === 'world' && i.cook.floor);
      if (old) this.items.remove(old);
    }

    // Meters, audio and screen effects.
    this.stoneVisual += (this.petrify / 100 - this.stoneVisual) * Math.min(1, dt * 4);
    this.hands.setStone(this.stoneVisual);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const danger = this.gorgon.state === 'gazeWindup' || this.gorgon.state === 'gaze';
    this.heartbeat?.setVolume(danger ? 0.9 : this.petrify > 60 ? 0.4 : 0);
    music.setIntensity(Math.max(this.wrath / 100, danger ? 0.9 : 0));
    const cam = this.player.camera;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position, this.player.forward(), up);

    // HUD.
    if (this.roundIndex >= 0) this.hud.setRound(ROUNDS[this.roundIndex].name, this.roundTime);
    else this.hud.setRound('Hex Kitchen', 0);
    this.hud.setMeters(this.wrath, this.petrify);
    this.hud.setTickets(this.tickets, (t) => {
      const filled = new Set<string>();
      for (const s of this.stations.plates[t.plate].slots) if (s.item) filled.add(s.kind);
      return filled;
    });
    this.hud.setObjectives(this.roundIndex >= 0 ? buildObjectives(this.tickets, this.stations, this.items.list, this.interact.held) : []);
    const tgt = this.interact.target;
    this.hud.setPrompt(this.interact.prompt, !!tgt);
    const gaugeStation = this.interact.working ?? (tgt?.type === 'station' ? tgt.id : tgt?.type === 'item' ? tgt.station : null);
    this.hud.setGauge(playing && gaugeStation ? this.stations.gauge(gaugeStation) : null);
  }

  private checkThrownAtGorgon(): void {
    const g = this.gorgon.pos;
    for (const it of this.items.list) {
      if (it.where !== 'world' || this.thrownHits.has(it.id)) continue;
      const v = it.body.linvel();
      if (Math.hypot(v.x, v.y, v.z) < 3) continue;
      const p = it.group.position;
      if (Math.hypot(p.x - g.x, p.z - g.z) < 0.5 && p.y > 0.6 && p.y < 2.3) {
        this.thrownHits.add(it.id);
        this.stats.thrown++;
        this.addWrath(12);
        this.gorgonSay('hitByFood', false, 2);
        audio.play('squish', { pos: p, volume: 1 });
        this.react('laugh', 1);
        it.body.setLinvel({ x: -v.x * 0.2, y: 1, z: -v.z * 0.2 }, true);
      }
    }
  }

  /** Called by main after the title screen. */
  begin(): void {
    this.hud.hideScreen();
    void this.run();
  }
}
