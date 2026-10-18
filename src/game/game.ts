import * as THREE from 'three';
import { audio, music, voice, type LoopHandle } from '../audio';
import { buildGorgon } from '../characters/gorgon';
import { buildHands, type HandsRig } from '../characters/hands';
import type { Input } from '../engine/input';
import { Physics, GROUP } from '../engine/physics';
import type { PsxRenderer } from '../engine/renderer';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Hud } from '../ui/hud';
import { GorgonAI, type GorgonWorld } from './gorgonAI';
import { INGREDIENTS, ingredientMeshFactories, type IngredientKind } from './ingredients';
import { Interaction } from './interact';
import { Items, type Item } from './items';
import { buildKitchen, COUNTER_TOP, type Kitchen, type StationId } from './kitchen';
import { pickLine, type LineKey } from './lines';
import { Particles } from './particles';
import { Player } from './player';
import { evaluateDish, type DishResult, type Recipe } from './recipes';
import { Rivals } from './rivals';
import { Stations, type PlateId, type Ticket } from './stations';
import { buildObjectives } from './objectives';
import { PlatingMode, type PlatingResult } from './plating';
import { PlatingHud } from '../ui/platingHud';
import { gradeFor } from './recipes';
import { currentEpisode, type RoundDef } from './episodes';
import { Hotel } from './hotel';
import { buildHotelKitchen } from './hotelKitchen';
import { AssemblyPreview } from './assembly';

const EPISODE = currentEpisode();
const ROUNDS: RoundDef[] = EPISODE.rounds;

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
  private plating!: PlatingMode;
  private platingHud = new PlatingHud();
  /** Plating scores waiting to be folded into the dish score when the plate is served. */
  private platingDone = new Map<PlateId, PlatingResult>();
  private pendingServe: PlateId[] = [];
  /** Episode 2 set pieces (oven, trolley, toaster, desk bell, printer, Service Inspection). */
  private hotel: Hotel | null = null;
  private assemblyPreview!: AssemblyPreview;

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
  private stats = { dropped: 0, gazesSurvived: 0, gazesCaught: 0, reflects: 0, fires: 0, thrown: 0, plates: 0, worst: '', worstScore: 101, insult: '' };

  constructor(
    private renderer: PsxRenderer,
    private input: Input,
    private hud: Hud,
  ) {}

  async init(): Promise<void> {
    await this.physics.init();
    this.kitchen = (EPISODE.id === 2 ? buildHotelKitchen : buildKitchen)(this.scene, this.physics, ingredientMeshFactories);
    // Build every ingredient's textures and geometry up front so the first grab doesn't hitch.
    for (const def of Object.values(INGREDIENTS)) {
      def.whole();
      def.chopped();
    }
    // Soft image-based reflections so steel, sauces and Gorgon's eyes catch the light.
    const pmrem = new THREE.PMREMGenerator(this.renderer.gl);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    pmrem.dispose();
    this.particles = new Particles(this.scene);
    this.items = new Items(this.scene, this.physics);
    this.items.onFloor = (it) => this.onFloor(it);
    this.items.onSpill = (carrier, spilled) => {
      if (this.phase !== 'playing' || spilled.length < 2) return;
      audio.play('clang', { pos: carrier.group.position, volume: 1, pitch: 0.75 });
      this.gorgonSay('traySpill', false, 2);
      this.react('gasp', 1);
    };
    this.items.onImpact = (it, s) => {
      if (it.kind === 'plate' && s > 0.3) {
        this.shatterPlate(it);
        return;
      }
      // A loaded tray or trolley hitting hard throws everything off it.
      if ((it.kind === 'tray' || it.kind === 'trolley') && it.carried.length && s > 0.3) this.items.spill(it, 1 + s);
      const soft = it.isIngredient;
      audio.play(soft ? (Math.random() < 0.5 ? 'squish' : 'thud') : 'clang', { pos: it.group.position, volume: 0.25 + s * 0.75, pitch: 0.85 + Math.random() * 0.3 });
      // Loud landings carry across the kitchen; a thrown item is a handy distraction.
      if (this.phase === 'playing' && s > 0.45) this.gorgon.hear(it.group.position, 0.6 + s * 0.6);
    };
    this.stations = new Stations(this.scene, this.kitchen, this.items, this.particles, {
      chop: (q) => {
        if (q < 0.4) this.react('laugh', 0.25);
        // A little camera kick sells the weight of a clean, on-beat cut.
        this.player.shake = Math.max(this.player.shake, q >= 0.75 ? 0.32 : 0.18);
        this.hud.cutFeedback(q >= 0.75 ? 'Perfect' : q >= 0.4 ? 'Good' : 'Sloppy');
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
      fireSpread: () => {
        this.stats.fires++;
        this.addWrath(10);
        this.gorgonSay('fireSpread', false, 2);
        this.react('gasp', 1);
      },
      fireOut: () => {
        this.addWrath(-2);
        this.react('applause', 0.5);
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
      binned: (it) => this.binItem(it),
      burnedHand: () => {
        audio.play('chopMiss', { volume: 1, pitch: 1.6 });
        audio.play('fireIgnite', { volume: 0.5, pitch: 1.4 });
        this.flash = 0.6;
        this.gorgonSay('burnedHand', false, 2);
        this.react('laugh', 1);
      },
      spray: (from, dir, dt) => this.spray(from, dir, dt),
      prop: (name, held) => this.hotel?.prop(name, held) ?? false,
      trolley: () => this.hotel?.toggleLocks(),
      assembled: (base, done) => {
        if (done && base.kind === 'pastry' && this.phase === 'playing') this.gorgonSay('pastryResting', false, 1);
      },
    });
    this.assemblyPreview = new AssemblyPreview(this.scene);
    if (this.kitchen.hotel && this.kitchen.oven) {
      this.hotel = new Hotel({
        scene: this.scene,
        kitchen: this.kitchen,
        items: this.items,
        stations: this.stations,
        player: this.player,
        gorgon: this.gorgon,
        interact: () => this.interact,
        say: (k, p = 1) => this.gorgonSay(k, false, p),
        react: (k, c) => this.react(k, c),
        addWrath: (n) => this.addWrath(n),
        notice: (t) => this.hud.notice(t),
        playing: () => this.phase === 'playing',
        inspectEvery: () => (this.roundIndex >= 0 ? ROUNDS[this.roundIndex].inspectEvery : undefined),
      });
      this.hotel.init();
    }
    this.plating = new PlatingMode(this.scene, this.kitchen, this.stations, this.player, (k) => this.gorgonSay(k, false, 1), () => this.wrath);
    this.hangMirrorPan();
    window.addEventListener('resize', () => {
      this.player.camera.aspect = this.renderer.aspect();
      this.player.camera.updateProjectionMatrix();
    });
    // Warm up physics so everything settles before the first frame.
    for (let i = 0; i < 10; i++) this.physics.step();
  }

  private hangMirrorPan(): void {
    // Fire extinguisher stands on the counter beside the stove.
    this.items.spawn('extinguisher', this.kitchen.extinguisher?.clone() ?? new THREE.Vector3(2.7, COUNTER_TOP + 0.05, -3.6));
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
      messNear: (p, r) =>
        this.items.list.filter((it) => it.isIngredient && it.cook.floor && it.where === 'world' && it.group.position.distanceTo(p) < r).length,
      inspectHeld: () => {
        const h = this.interact.held;
        if (!h) return 'empty';
        // A loaded tray: he inspects what's on it.
        if (h.kind === 'tray') return h.carried.some((c) => c.isIngredient && !c.cook.floor && c.cookLevel() < 1.5) ? 'good' : h.carried.length ? 'bad' : 'empty';
        if (!h.isIngredient) return 'bad';
        const c = h.cook;
        if (c.floor || h.cookLevel() > 1.5) return 'bad';
        if (c.chopped && c.chopScoreSum / Math.max(1, c.chopHits) < 0.45) return 'bad';
        if (c.season > 1) return 'bad';
        return 'good';
      },
      sabotageTarget: () => {
        // Plated food is off limits: losing a finished dish feels unfair.
        const order: StationId[] = ['board', 'prep', 'pan'];
        const st = order.find((s) => this.stations.occupant[s].length > 0);
        if (!st) {
          const pp = this.player.position;
          const nodes = Object.values(this.kitchen.waypoints.nodes);
          return { spot: nodes.reduce((a, b) => (b.distanceTo(pp) < a.distanceTo(pp) ? b : a)).clone(), station: '' };
        }
        const p = this.kitchen.stations[st];
        // Stand on the walkable floor nearest the station.
        const nodes = Object.values(this.kitchen.waypoints.nodes);
        const near = nodes.reduce((a, b) => (b.distanceTo(p) < a.distanceTo(p) ? b : a));
        const spot = p.clone().setY(0).lerp(near, 0.55).setY(0);
        return { spot, station: st };
      },
      doSabotage: (station, from) => {
        if (!station) return 'slam';
        const st = station as StationId;
        const items = this.stations.occupant[st];
        if (!items.length) return 'slam';
        this.stations.shove(st, from);
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
    // Dropping food is the one thing he can't stand. If he sees it: instant meltdown.
    // If not, he hears the splat and comes looking, so bin it before he gets there.
    const eye = this.gorgon.eye();
    const p = it.group.position.clone().setY(0.3);
    const close = eye.distanceTo(p) < 7;
    const d = p.clone().sub(eye);
    const seen = close && this.physics.raycast(eye, d.clone().normalize(), Math.max(0, d.length() - 0.25), GROUP.STATIC | GROUP.STATUE) === null;
    if (seen && this.gorgon.tantrum()) {
      this.addWrath(10);
      this.react('gasp', 0.8);
    } else if (!this.gorgon.hear(p, 1.2)) {
      this.addWrath(2);
    }
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
    this.hud.showBanner(EPISODE.id === 2 ? `Episode 2 · ${EPISODE.title}` : 'Hex Kitchen', EPISODE.host, 3.5);
    this.player.faceTarget = this.kitchen.waypoints.nodes.southE.clone().setY(1.6);
    await this.gorgon.goTo(this.kitchen.waypoints.nodes.southE, 1.1);
    this.gorgon.setScripted('armsCrossed', this.player.camera.position);
    this.gorgon.faceToward(this.player.position);
    this.player.faceTarget = this.gorgon.eye();
    await this.wait(this.gorgon.say(EPISODE.intro, 3));
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
    for (const id of [...this.stations.fires.keys()]) this.stations.douse(id, 99);
    for (const it of this.shelfItems) if (it.where === 'world') this.items.remove(it);
    this.stockShelf();
    this.platingDone.clear();
    this.plating.clearDecor();
    this.stations.setPlate('plateA', false);
    this.stations.setPlate('plateB', false);
    this.stations.assignTicket('plateA', this.tickets[0] ?? null);
    this.stations.assignTicket('plateB', this.tickets[1] ?? null);
    if (this.hotel) {
      this.hotel.resetRound();
      for (let k = 0; k < this.tickets.length; k++) this.hotel.printTicket();
    }
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
    this.hud.showBanner('The Tasting', `Gorgon tastes your ${EPISODE.bossDish}...`, 3);
    const judge = this.kitchen.judgeSpot;
    this.player.faceTarget = judge.clone().setY(1.75);
    await this.gorgon.goTo(judge, 1.2);
    this.gorgon.faceToward(this.kitchen.stations.plateA.clone().setY(0));
    this.gorgon.setScripted('taste', null);
    await this.wait(this.gorgon.say(EPISODE.taste, 3));
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
      await this.wait(this.gorgon.say(EPISODE.win, 3));
      this.finish(true, pickLine(EPISODE.win));
    } else {
      this.gorgon.setScripted('gaze', this.player.camera.position);
      this.player.faceTarget = this.gorgon.eye();
      const d = this.gorgon.say(EPISODE.lose, 3);
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
      this.finish(false, pickLine(EPISODE.lose));
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
    const talk = this.gorgon.say(line, 3, true);
    // Frozen solid mid-pose... a wobble... then you topple over like a garden statue.
    await this.wait(0.9);
    audio.play('stoneCrack', { volume: 0.8 });
    for (let i = 0; i < 4; i++) {
      this.player.shake = 0.25;
      await this.wait(0.12);
    }
    this.player.faceTarget = null;
    const t0 = this.time;
    while (this.time - t0 < 1.1) {
      this.player.topple = Math.min(1, (this.time - t0) / 1.1);
      await this.wait(0);
    }
    this.player.topple = 1;
    audio.play('slam', { volume: 1 });
    audio.play('stoneCrack', { volume: 1, pitch: 0.7 });
    this.player.shake = 1;
    this.particles.emit(this.player.position.clone().setY(0.3), { color: 0x9a948a, count: 30, up: 1.5, speed: 1.6, gravity: 6, life: 1.4, size: 0.06 });
    this.react('laugh', 1);
    await this.wait(Math.max(1.5, talk - 1.5) + 0.8);
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
    rows.push(['Plates smashed', `${this.stats.plates}`]);
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
    if (this.phase !== 'playing' || this.plating.active) return;
    let servedAny = false;
    let toPlate: PlateId | null = null;
    for (const p of plates) {
      const t = this.stations.plates[p].ticket;
      if (!t || t.served || this.stations.occupant[p].length === 0) continue;
      // A complete dish gets plated before it goes out; an incomplete one is served as-is.
      if (this.stations.isFull(p) && !this.platingDone.has(p)) {
        toPlate ??= p;
        continue;
      }
      const plated = this.stations.collectPlate(p);
      const result = evaluateDish(t.recipe, plated);
      const pr = this.platingDone.get(p);
      if (pr) {
        this.platingDone.delete(p);
        this.plating.clearDecor();
        result.score = Math.round(result.score * 0.8 + pr.score * 0.2);
        result.grade = gradeFor(result.score);
        if (result.grade === 'Perfect') result.issue = 'perfect';
        else if (result.grade === 'Good' && result.issue === 'perfect') result.issue = 'good';
        result.breakdown.push(`plating: ${pr.grade}`);
      }
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
    if (toPlate) {
      this.startPlating(toPlate, plates);
      return;
    }
    if (!servedAny) this.gorgonSay('emptyPlate', false, 2);
    else if (this.tickets.every((t) => t.served)) this.roundDone?.();
  }

  private startPlating(p: PlateId, plates: PlateId[]): void {
    const t = this.stations.plates[p].ticket!;
    this.pendingServe = plates;
    this.interact.reset();
    this.plating.start(p, t, !!ROUNDS[this.roundIndex].boss);
    this.gorgon.watch();
    this.gorgonSay('platingStart', false, 2);
  }

  /** Close Plating Mode; serve the dish unless the round ended underneath us. */
  private endPlating(serveAfter: boolean): void {
    const plate = this.plating.plate;
    const r = this.plating.finish();
    this.platingDone.set(plate, r);
    this.platingHud.result(r);
    this.gorgon.resume();
    audio.play(r.score >= 75 ? 'ding' : 'plate', { volume: 0.7 });
    if (r.score >= 90) this.gorgonSay('platingGreat', false, 2);
    else if (r.score < 40) this.gorgonSay('platingBad', false, 2);
    if (serveAfter) this.serve(this.pendingServe);
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
    if ((this.shadowScan -= dt) <= 0) {
      this.shadowScan = 0.5;
      this.updateShadowFlags();
    }
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
      if (this.roundTime <= 0) {
        if (this.plating.active) this.endPlating(false);
        this.roundDone?.();
      }
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

    const working = this.interact.working !== null || this.plating.active;
    this.player.moveEnabled = playing && !working;
    this.player.lookEnabled = playing ? !working : this.phase !== 'dead';
    // The key or click that ends plating must not also reach the interaction system this frame.
    let platingFrame = this.plating.active;
    if (this.plating.active) {
      if (!playing || this.plating.update(dt, this.input) === 'done') this.endPlating(playing);
      else platingFrame = true;
    }
    this.player.update(dt, this.input);
    this.interact.update(dt, this.input, playing && !platingFrame);
    this.platingHud.show(this.plating.active ? this.plating.view() : null);
    this.platingHud.update(dt, this.plating.active);

    this.acc += dt;
    while (this.acc >= 1 / 60) {
      this.physics.step();
      this.acc -= 1 / 60;
    }
    this.items.update();
    this.checkTrashToss();
    this.hotel?.update(dt);
    this.assemblyPreview.update(dt, playing ? this.interact.held : null, this.items);
    this.updateShelf(dt, playing);
    if ((this.sprayT -= dt) <= 0 && this.sprayLoop) {
      this.sprayLoop.stop();
      this.sprayLoop = null;
    }
    // An open fire keeps him boiling.
    if (playing && this.stations.fires.size) this.addWrath(dt * 1.2 * this.stations.fires.size);
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
    const gs = this.gorgon.state;
    this.hud.setGazeWarning({
      phase: playing && gs === 'gazeWindup' ? 'windup' : playing && gs === 'gaze' ? 'gaze' : 'none',
      charge: this.gorgon.glow,
      safe: this.gorgon.gazeSafe,
      reason: this.gorgon.gazeReason,
    });
    this.hands.root.visible = !this.plating.active;
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

  /** Ceramic meets floor: shards everywhere, a crash the whole kitchen hears. */
  private shatterPlate(it: Item): void {
    const p = it.group.position.clone();
    audio.play('clang', { pos: p, volume: 1, pitch: 1.8 });
    audio.play('stoneCrack', { pos: p, volume: 0.9, pitch: 1.6 });
    this.particles.emit(p.clone().setY(Math.max(0.05, p.y)), { color: 0xf6f3ec, count: 28, up: 1.8, speed: 1.8, gravity: 9, life: 1.6, size: 0.04 });
    this.player.shake = Math.max(this.player.shake, 0.3);
    this.items.remove(it);
    this.stats.plates++;
    if (this.phase === 'playing') {
      this.addWrath(4);
      if (!this.gorgon.hear(p, 2)) this.gorgonSay('plateSmash', false, 2);
      this.react('gasp', 0.8);
    }
  }

  private sprayLoop: LoopHandle | null = null;
  private sprayT = 0;

  /** Fire extinguisher: a white jet that knocks down any fire it's pointed at. */
  private spray(from: THREE.Vector3, dir: THREE.Vector3, dt: number): void {
    this.sprayT = 0.15;
    this.particles.emit(from, { color: 0xf4f6f8, count: 4, speed: 0.25, up: 0.1, gravity: 1.5, life: 0.7, jitter: 0.02, size: 0.06, push: dir.clone().multiplyScalar(4.5) });
    if (!this.sprayLoop) this.sprayLoop = audio.loop('fryer', { volume: 0.7 });
    for (const id of [...this.stations.fires.keys()]) {
      const at = this.kitchen.stations[id].clone().setY(COUNTER_TOP + 0.15);
      const to = at.clone().sub(from);
      if (to.length() < 3.4 && to.normalize().dot(dir) > 0.9) this.stations.douse(id, dt * 0.9);
    }
  }

  private shelfItems: Item[] = [];
  private shelfWobble = 0;
  private shelfDown = false;

  /** Restock the storage shelf with a random mix of ingredients (start of each round). */
  private stockShelf(): void {
    const kinds: IngredientKind[] = ['potato', 'tomato', 'mushroom', 'pasta', 'bread', 'lettuce'];
    this.shelfItems = this.kitchen.shelf.spots.map((p, i) => this.items.spawn(kinds[(i + this.roundIndex) % kinds.length], p.clone()));
    this.shelfDown = false;
  }

  /** Sprinting into the shelf (or hitting it with a thrown item) brings the whole lot down. */
  private updateShelf(dt: number, playing: boolean): void {
    const sh = this.kitchen.shelf;
    if (playing && !this.shelfDown) {
      const p = this.player.position;
      const d = Math.hypot(p.x - sh.front.x, p.z - sh.front.z);
      const speed = this.player.speed;
      const hitByThrow = this.items.list.some((it) => it.where === 'world' && !this.shelfItems.includes(it) && it.group.position.distanceTo(sh.group.position.clone().setY(1)) < 0.8 && it.body.linvel().x < -2);
      if ((d < 0.75 && speed > 6.8) || hitByThrow) this.topplShelf(p);
    }
    if (this.shelfWobble > 0) {
      this.shelfWobble = Math.max(0, this.shelfWobble - dt);
      sh.group.rotation.x = Math.sin(this.shelfWobble * 30) * this.shelfWobble * 0.12;
      sh.group.rotation.z = -Math.sin(this.shelfWobble * 22) * this.shelfWobble * 0.06;
    }
  }

  private topplShelf(from: THREE.Vector3): void {
    this.shelfDown = true;
    this.shelfWobble = 1.2;
    audio.play('clang', { pos: this.kitchen.shelf.group.position, volume: 1, pitch: 0.7 });
    audio.play('slam', { pos: this.kitchen.shelf.group.position, volume: 0.8 });
    this.player.shake = Math.max(this.player.shake, 0.4);
    for (const it of this.shelfItems) {
      if (it.where !== 'world') continue;
      const out = it.group.position.clone().sub(from).setY(0).normalize();
      it.body.setLinvel({ x: 1.2 + Math.random() * 1.5 + out.x * 0.5, y: 1 + Math.random() * 1.5, z: (Math.random() - 0.5) * 2.5 }, true);
      it.body.setAngvel({ x: Math.random() * 8, y: Math.random() * 8, z: Math.random() * 8 }, true);
    }
    this.react('gasp', 1);
  }

  /** Drop an item into the trash can: gone, no evidence. */
  private binItem(it: Item): void {
    audio.play('thud', { pos: this.kitchen.trash, volume: 0.6, pitch: 0.7 });
    this.particles.emit(this.kitchen.trash.clone().setY(0.75), { color: 0x555555, count: 6, up: 0.6, speed: 0.4, gravity: 4, life: 0.5 });
    this.items.remove(it);
  }

  /** Food tossed into the can's mouth counts as binned too. */
  private checkTrashToss(): void {
    const c = this.kitchen.trash;
    for (const it of this.items.list) {
      if (it.where !== 'world' || it.kind === 'mirrorPan') continue;
      const p = it.group.position;
      if (p.y > 0.25 && p.y < 0.75 && Math.hypot(p.x - c.x, p.z - c.z) < 0.22) {
        this.binItem(it);
        return;
      }
    }
  }

  private shadowScan = 0;

  /** Opaque lit meshes cast and receive shadows; glows, particles and flagged props don't. */
  private updateShadowFlags(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.shadowSet) return;
      m.userData.shadowSet = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const lit = mats.every((x) => (x as THREE.MeshStandardMaterial).isMeshStandardMaterial && !x.transparent);
      m.receiveShadow = lit;
      m.castShadow = lit && !m.userData.noShadow;
    });
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
