// Looping ambience/cooking sounds. Handles work before init (they start once audio is ready)
// and after stop() they become inert.

import { engine, setPannerPos } from './context';
import { renderLoop, loopSampleRate } from './sfx-render';
import { LOOP_NAMES, type LoopName, type LoopHandle, type Vec3Like } from './types';

const BASE: Record<LoopName, number> = { sizzle: 0.5, boil: 0.55, fryer: 0.5, fire: 0.65, ambience: 0.3, heartbeat: 1.0 };
const bufCache = new Map<LoopName, AudioBuffer>();
const MAX_LOOPS = 16;
const live = new Set<LoopVoice>();

function buffer(name: LoopName): AudioBuffer {
  let b = bufCache.get(name);
  if (!b) {
    const sr = loopSampleRate(name, engine.ctx!.sampleRate);
    b = engine.makeBuffer(renderLoop(name, sr), sr);
    bufCache.set(name, b);
  }
  return b;
}

class LoopVoice implements LoopHandle {
  private vol: number;
  private pos: Vec3Like | undefined;
  private pitch = 1;
  private stopped = false;
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private panner: PannerNode | null = null;
  private send: GainNode | null = null;

  constructor(private name: LoopName, opts: { pos?: Vec3Like; volume?: number }) {
    this.vol = clampVol(opts.volume ?? 1);
    this.pos = opts.pos ? { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z } : undefined;
    engine.onReady(() => this.start());
  }

  private start(): void {
    const ctx = engine.ctx;
    if (this.stopped || !ctx || this.src) return;
    if (live.size >= MAX_LOOPS) { const oldest = live.values().next().value; oldest?.stop(); }
    const buf = buffer(this.name);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.playbackRate.value = this.pitch;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(this.vol * BASE[this.name], ctx.currentTime, 0.08);
    src.connect(gain);
    if (this.pos) {
      this.panner = engine.createPanner(this.pos, { ref: 1.2 });
      gain.connect(this.panner).connect(engine.loopBus);
    } else gain.connect(engine.loopBus);
    if (this.name !== 'heartbeat' && this.name !== 'ambience') {
      this.send = ctx.createGain(); this.send.gain.value = 0.15;
      gain.connect(this.send).connect(engine.reverbSend);
    }
    src.start(ctx.currentTime, this.name === 'heartbeat' ? 0 : Math.random() * buf.duration);
    this.src = src; this.gain = gain;
    live.add(this);
  }

  setVolume(v: number): void {
    try {
      this.vol = clampVol(v);
      if (this.gain && engine.ctx) this.gain.gain.setTargetAtTime(this.vol * BASE[this.name], engine.ctx.currentTime, 0.05);
    } catch (e) { console.warn('[audio]', e); }
  }
  setPosition(p: Vec3Like): void {
    try {
      if (!p) return;
      this.pos = { x: p.x, y: p.y, z: p.z };
      if (this.panner && engine.ctx) setPannerPos(this.panner, p, engine.ctx);
    } catch (e) { console.warn('[audio]', e); }
  }
  setPitch(p: number): void {
    try {
      if (!Number.isFinite(p) || p <= 0) return;
      this.pitch = Math.max(0.25, Math.min(4, p));
      if (this.src && engine.ctx) this.src.playbackRate.setTargetAtTime(this.pitch, engine.ctx.currentTime, 0.05);
    } catch (e) { console.warn('[audio]', e); }
  }
  stop(): void {
    try {
      if (this.stopped) return;
      this.stopped = true;
      live.delete(this);
      const ctx = engine.ctx;
      if (!ctx || !this.src || !this.gain) return;
      const t = ctx.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setTargetAtTime(0, t, 0.06);
      const src = this.src, gain = this.gain, pan = this.panner, send = this.send;
      src.stop(t + 0.4);
      src.onended = () => { try { src.disconnect(); gain.disconnect(); pan?.disconnect(); send?.disconnect(); } catch { /* ignore */ } };
    } catch (e) { console.warn('[audio]', e); }
  }
}

function clampVol(v: number): number { return Math.max(0, Math.min(4, Number.isFinite(v) ? v : 1)); }

const NOOP: LoopHandle = { setVolume() {}, setPosition() {}, setPitch() {}, stop() {} };

export function startLoop(name: LoopName, opts: { pos?: Vec3Like; volume?: number } = {}): LoopHandle {
  if (!(LOOP_NAMES as readonly string[]).includes(name)) return NOOP;
  if (engine.unavailable) return NOOP;
  return new LoopVoice(name, opts || {});
}

/** Pre-render loop buffers (call after init). */
export function prewarmLoops(): void {
  const q = [...LOOP_NAMES];
  const step = () => {
    if (!engine.ctx) return;
    const n = q.shift();
    if (!n) return;
    try { buffer(n); } catch (e) { console.warn('[audio] loop render', n, e); }
    setTimeout(step, 20);
  };
  setTimeout(step, 30);
}
