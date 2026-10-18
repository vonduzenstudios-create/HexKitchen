// Audio engine core: AudioContext lifecycle, bus graph, listener, spatial helpers.
//
//  sfxBus ──────────────┐
//  loopBus ─────────────┤
//  voiceBus ────────────┼──> master ──> compressor ──> destination
//  musicBus ─> duck ────┤
//  stingBus ────────────┤
//  reverbSend ─> convolver ─> reverbReturn ─┘

import type { Vec3Like } from './types';
import { makeImpulseResponse } from './reverb';

type Ctor = typeof AudioContext;

export class Engine {
  ctx: AudioContext | null = null;
  ready = false;
  unavailable = false;
  master!: GainNode;
  comp!: DynamicsCompressorNode;
  sfxBus!: GainNode;
  loopBus!: GainNode;
  voiceBus!: GainNode;
  musicBus!: GainNode;
  musicDuck!: GainNode;
  stingBus!: GainNode;
  reverbSend!: GainNode;
  private initPromise: Promise<void> | null = null;
  private readyCbs: (() => void)[] = [];
  private masterVolume = 1;
  private listenerSet = false;

  init(): Promise<void> {
    if (this.initPromise) {
      // already initialised: just make sure the context is running (e.g. after a tab switch)
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.initPromise;
    }
    this.initPromise = this.doInit().catch((e) => {
      console.warn('[audio] init failed', e);
      this.unavailable = true;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    if (typeof window === 'undefined') { this.unavailable = true; return; }
    const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) { this.unavailable = true; return; }
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const g = (v: number) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12; this.comp.knee.value = 10; this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master = g(this.masterVolume);
    this.master.connect(this.comp).connect(ctx.destination);
    this.sfxBus = g(0.9); this.sfxBus.connect(this.master);
    this.loopBus = g(0.8); this.loopBus.connect(this.master);
    this.voiceBus = g(1.0); this.voiceBus.connect(this.master);
    this.musicDuck = g(1); this.musicDuck.connect(this.master);
    this.musicBus = g(0.32); this.musicBus.connect(this.musicDuck);
    this.stingBus = g(0.5); this.stingBus.connect(this.master);
    // shared room reverb
    const conv = ctx.createConvolver();
    const [L, R] = makeImpulseResponse(ctx.sampleRate, { seconds: 1.8, decay: 1.2, brightness: 0.55 });
    const ir = ctx.createBuffer(2, L.length, ctx.sampleRate);
    ir.getChannelData(0).set(L); ir.getChannelData(1).set(R);
    conv.buffer = ir;
    this.reverbSend = g(1);
    const ret = g(0.35);
    this.reverbSend.connect(conv).connect(ret).connect(this.master);
    // resume (may need the user gesture; don't hang forever if the browser never resolves)
    try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 400))]); } catch { /* ignore */ }
    this.ready = true;
    const cbs = this.readyCbs; this.readyCbs = [];
    for (const cb of cbs) { try { cb(); } catch (e) { console.warn('[audio]', e); } }
    // browsers suspend contexts on some events; try to recover on later gestures
    const kick = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
    window.addEventListener('pointerdown', kick, { passive: true });
    window.addEventListener('keydown', kick, { passive: true });
  }

  onReady(cb: () => void): void {
    if (this.ready) { try { cb(); } catch (e) { console.warn('[audio]', e); } } else this.readyCbs.push(cb);
  }

  get now(): number { return this.ctx ? this.ctx.currentTime : 0; }

  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(2, Number.isFinite(v) ? v : 1));
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.03);
  }

  setListener(pos: Vec3Like, fwd: Vec3Like, up: Vec3Like): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready || !pos || !fwd || !up) return;
    const l = ctx.listener;
    const vals = [pos.x, pos.y, pos.z, fwd.x, fwd.y, fwd.z, up.x, up.y, up.z];
    if (!vals.every(Number.isFinite)) return;
    if (l.positionX) {
      const t = ctx.currentTime;
      const set = (p: AudioParam, v: number) => { if (this.listenerSet) p.setTargetAtTime(v, t, 0.015); else p.value = v; };
      set(l.positionX, pos.x); set(l.positionY, pos.y); set(l.positionZ, pos.z);
      set(l.forwardX, fwd.x); set(l.forwardY, fwd.y); set(l.forwardZ, fwd.z);
      set(l.upX, up.x); set(l.upY, up.y); set(l.upZ, up.z);
    } else {
      const legacy = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      legacy.setPosition(pos.x, pos.y, pos.z);
      legacy.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    this.listenerSet = true;
  }

  /** HRTF panner with rolloff tuned for a ~14 m room. */
  createPanner(pos: Vec3Like, opts: { ref?: number; rolloff?: number } = {}): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = opts.ref ?? 1.5;
    p.maxDistance = 40;
    p.rolloffFactor = opts.rolloff ?? 1.1;
    setPannerPos(p, pos, this.ctx!, true);
    return p;
  }

  makeBuffer(data: Float32Array, sr: number): AudioBuffer {
    const b = this.ctx!.createBuffer(1, data.length, sr);
    b.getChannelData(0).set(data);
    return b;
  }
}

export function setPannerPos(p: PannerNode, pos: Vec3Like, ctx: BaseAudioContext, immediate = false): void {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
  if (p.positionX) {
    if (immediate) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else {
      const t = ctx.currentTime;
      p.positionX.setTargetAtTime(pos.x, t, 0.02); p.positionY.setTargetAtTime(pos.y, t, 0.02); p.positionZ.setTargetAtTime(pos.z, t, 0.02);
    }
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
  }
}

export const engine = new Engine();

/** Run fn, swallowing (and logging) any error: public API must never throw. */
export function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch (e) { console.warn('[audio]', e); return fallback; }
}
