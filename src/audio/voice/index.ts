// Voice playback: renders speech (pure TS synth) into an AudioBuffer and plays it through an optional
// HRTF panner and the room reverb, ducking the music while Gorgon talks.

import { engine } from '../context';
import { renderSpeech, speechDuration, type SpeechOpts } from './render';
import type { SayOpts } from '../types';

interface Current { stop(): void; done: boolean }

const CACHE_MAX = 32;
const cache = new Map<string, AudioBuffer>();
const keyOf = (text: string, o: SpeechOpts) => `${o.pitch ?? ''}|${o.rate ?? ''}|${o.growl ?? ''}|${o.british ?? ''}|${text}`;

function toOpts(o?: SayOpts & { british?: boolean }): SpeechOpts {
  const r: SpeechOpts = {};
  if (o) {
    if (Number.isFinite(o.pitch as number) && (o.pitch as number) > 0) r.pitch = o.pitch;
    if (Number.isFinite(o.rate as number) && (o.rate as number) > 0) r.rate = o.rate;
    if (Number.isFinite(o.growl as number)) r.growl = Math.max(0, Math.min(1, o.growl as number));
    if (typeof o.british === 'boolean') r.british = o.british;
  }
  return r;
}

function cached(k: string): AudioBuffer | undefined {
  const hit = cache.get(k);
  if (hit) { cache.delete(k); cache.set(k, hit); }
  return hit;
}
function store(k: string, samples: Float32Array, sr: number): AudioBuffer {
  const buf = engine.makeBuffer(samples, sr);
  cache.set(k, buf);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return buf;
}

// ---- off-main-thread rendering (falls back to synchronous rendering if workers are unavailable)
let worker: Worker | null = null;
let workerFailed = false;
let reqId = 0;
const pending = new Map<number, (r: { samples?: Float32Array; sampleRate?: number; error?: string }) => void>();
function getWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; samples?: Float32Array; sampleRate?: number; error?: string }>) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.(e.data);
    };
    worker.onerror = () => {
      workerFailed = true; worker = null;
      for (const cb of pending.values()) cb({ error: 'worker error' });
      pending.clear();
    };
  } catch { workerFailed = true; worker = null; }
  return worker;
}

/** Get (or render) the buffer for a line. Calls back asynchronously when rendered in the worker. */
function withBuffer(text: string, o: SpeechOpts, cb: (b: AudioBuffer) => void): void {
  const k = keyOf(text, o);
  const hit = cached(k);
  if (hit) { cb(hit); return; }
  const sync = () => { const r = renderSpeech(text, o); cb(store(k, r.samples, r.sampleRate)); };
  const w = getWorker();
  if (!w) { sync(); return; }
  const id = ++reqId;
  const timeout = setTimeout(() => { if (pending.delete(id)) sync(); }, 3000);
  pending.set(id, (r) => {
    clearTimeout(timeout);
    if (r.samples && r.sampleRate) cb(cached(k) ?? store(k, r.samples, r.sampleRate));
    else sync();
  });
  w.postMessage({ id, text, opts: o });
}

class VoicePlayer {
  private cur: Current | null = null;

  say(text: string, opts?: SayOpts): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        this.stop();
        const str = String(text ?? '');
        const o = toOpts(opts);
        let resolved = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          if (timer) clearTimeout(timer);
          if (this.cur === cur) { this.cur = null; this.unduck(); }
          cur.done = true;
          resolve();
        };
        const cur: Current = { stop: finish, done: false };
        this.cur = cur;
        if (!str.trim()) { finish(); return; }

        const ctx = engine.ctx;
        if (!ctx || !engine.ready) {
          // no audio (yet): keep dialogue pacing by resolving after the estimated duration
          timer = setTimeout(finish, speechDuration(str, o) * 1000);
          return;
        }
        cur.stop = finish;
        withBuffer(str, o, (buf) => { if (!resolved) this.play(buf, opts, cur, finish, () => resolved, (t) => { timer = t; }); });
      } catch (e) {
        console.warn('[audio] say failed', e);
        resolve();
      }
    });
  }

  private play(buf: AudioBuffer, opts: SayOpts | undefined, cur: Current, finish: () => void, isDone: () => boolean, setTimer: (t: ReturnType<typeof setTimeout>) => void): void {
    try {
      const ctx = engine.ctx!;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain);
      let panner: PannerNode | null = null;
      if (opts?.pos) {
        panner = engine.createPanner(opts.pos, { ref: 2.5, rolloff: 0.8 });
        gain.connect(panner).connect(engine.voiceBus);
      } else gain.connect(engine.voiceBus);
      const send = ctx.createGain();
      send.gain.value = opts?.pos ? 0.3 : 0.18;
      gain.connect(send).connect(engine.reverbSend);
      const t = ctx.currentTime + 0.01;
      src.start(t);
      this.duck();
      cur.stop = () => {
        if (isDone()) return;
        try {
          const n = ctx.currentTime;
          gain.gain.cancelScheduledValues(n);
          gain.gain.setValueAtTime(gain.gain.value, n);
          gain.gain.linearRampToValueAtTime(0, n + 0.04);
          src.stop(n + 0.05);
        } catch { /* already stopped */ }
        finish();
      };
      src.onended = () => {
        finish();
        try { src.disconnect(); gain.disconnect(); send.disconnect(); panner?.disconnect(); } catch { /* ignore */ }
      };
      // safety net: a suspended context never fires onended
      setTimer(setTimeout(finish, (buf.duration + 1.5) * 1000));
    } catch (e) {
      console.warn('[audio] voice playback failed', e);
      finish();
    }
  }

  stop(): void {
    const c = this.cur;
    this.cur = null;
    if (c && !c.done) { try { c.stop(); } catch { /* ignore */ } }
    this.unduck();
  }

  isSpeaking(): boolean { return !!this.cur && !this.cur.done; }

  estimateDuration(text: string, opts?: SayOpts): number {
    try { return speechDuration(String(text ?? ''), toOpts(opts)); } catch { return 1; }
  }

  /** Pre-render lines in idle time so say() starts instantly. */
  preload(lines: string[], opts?: SayOpts): void {
    const q = [...(lines || [])];
    const o = toOpts(opts);
    const step = () => {
      if (!engine.ctx || !engine.ready) { engine.onReady(() => setTimeout(step, 100)); return; }
      const l = q.shift();
      if (l === undefined) return;
      try { withBuffer(String(l), o, () => setTimeout(step, 16)); } catch (e) { console.warn('[audio] preload', e); }
    };
    step();
  }

  private duck(): void {
    const ctx = engine.ctx;
    if (ctx && engine.musicDuck) engine.musicDuck.gain.setTargetAtTime(0.5, ctx.currentTime, 0.08);
  }
  private unduck(): void {
    const ctx = engine.ctx;
    if (ctx && engine.musicDuck) engine.musicDuck.gain.setTargetAtTime(1, ctx.currentTime, 0.25);
  }
}

export const voicePlayer = new VoicePlayer();

// spin the render worker up early so the first line doesn't pay its start-up cost
engine.onReady(() => { try { getWorker(); } catch { /* ignore */ } });
