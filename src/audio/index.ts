// Hex Kitchen audio module: public API.
// Everything is synthesised in code with the Web Audio API (no samples, no libraries).
// All methods are safe no-ops before init() or when Web Audio is unavailable.

import { engine, safe } from './context';
import { playSfx, prewarmSfx } from './sfx';
import { startLoop, prewarmLoops } from './loops';
import { musicPlayer } from './music';
import { voicePlayer } from './voice/index';
import type { Vec3Like, SfxName, LoopName, PlayOpts, LoopHandle, MusicMode, StingKind, SayOpts } from './types';

export type { Vec3Like, SfxName, LoopName, PlayOpts, LoopHandle, MusicMode, SayOpts } from './types';
export { SFX_NAMES, LOOP_NAMES } from './types';

const NOOP_LOOP: LoopHandle = { setVolume() {}, setPosition() {}, setPitch() {}, stop() {} };

engine.onReady(() => {
  musicPlayer.start();
  prewarmSfx();
  prewarmLoops();
});

export const audio = {
  /** Call from a user gesture. Creates + resumes the AudioContext. Idempotent. */
  init(): Promise<void> {
    try { return engine.init(); } catch (e) { console.warn('[audio]', e); return Promise.resolve(); }
  },
  get ready(): boolean { return engine.ready; },
  setListener(pos: Vec3Like, forward: Vec3Like, up: Vec3Like): void {
    safe(() => engine.setListener(pos, forward, up), undefined);
  },
  play(name: SfxName, opts?: PlayOpts): void {
    safe(() => playSfx(name, opts || {}), undefined);
  },
  loop(name: LoopName, opts?: { pos?: Vec3Like; volume?: number }): LoopHandle {
    return safe(() => startLoop(name, opts || {}), NOOP_LOOP);
  },
  setMasterVolume(v: number): void {
    safe(() => engine.setMasterVolume(v), undefined);
  },
  /** Extra: the underlying AudioContext (null before init / when unavailable). */
  get context(): AudioContext | null { return engine.ctx; },
  /** Extra: per-bus volume (0..2). */
  setBusVolume(bus: 'sfx' | 'music' | 'voice' | 'loops', v: number): void {
    safe(() => {
      if (!engine.ctx || !Number.isFinite(v)) return;
      const node = bus === 'sfx' ? engine.sfxBus : bus === 'music' ? engine.musicBus : bus === 'voice' ? engine.voiceBus : engine.loopBus;
      const base = bus === 'music' ? 0.32 : bus === 'sfx' ? 0.9 : bus === 'loops' ? 0.8 : 1;
      node.gain.setTargetAtTime(base * Math.max(0, Math.min(2, v)), engine.ctx.currentTime, 0.05);
    }, undefined);
  },
};

export const music = {
  /** Crossfade to a music mode. Before init the mode is remembered and starts once audio is ready. */
  setMode(mode: MusicMode): void { safe(() => musicPlayer.setMode(mode), undefined); },
  /** 0..1 (Gorgon's Wrath): tempo, layers, dissonance. */
  setIntensity(v: number): void { safe(() => musicPlayer.setIntensity(v), undefined); },
  sting(kind: StingKind): void { safe(() => musicPlayer.sting(kind), undefined); },
  /** Extra: current mode. */
  get mode(): MusicMode { return musicPlayer.mode; },
};

export const voice = {
  /** Speak text in Gorgon's voice. Resolves when finished (or interrupted by another say()/stop()). */
  say(text: string, opts?: SayOpts): Promise<void> {
    try { return voicePlayer.say(text, opts); } catch (e) { console.warn('[audio]', e); return Promise.resolve(); }
  },
  stop(): void { safe(() => voicePlayer.stop(), undefined); },
  /** Drop Gorgon's voice under an important cue (the oven timer ding) for a moment. */
  duck(seconds = 1.2, level = 0.25): void {
    safe(() => {
      const ctx = engine.ctx;
      if (!ctx || !engine.voiceBus) return;
      const g = engine.voiceBus.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setTargetAtTime(level, ctx.currentTime, 0.02);
      g.setTargetAtTime(1, ctx.currentTime + seconds, 0.2);
    }, undefined);
  },
  isSpeaking(): boolean { return safe(() => voicePlayer.isSpeaking(), false); },
  /** Seconds the line will take (deterministic; same timing plan the synth uses). */
  estimateDuration(text: string, opts?: SayOpts): number { return safe(() => voicePlayer.estimateDuration(text, opts), 1); },
  /** Extra: pre-render lines in idle time so say() starts without a render hitch. */
  preload(lines: string[], opts?: SayOpts): void { safe(() => voicePlayer.preload(lines, opts), undefined); },
};
