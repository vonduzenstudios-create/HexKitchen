// One-shot SFX playback: lazily rendered (and idle-time pre-rendered) buffer variants,
// voice limiting, per-sound gain balance, random pitch variation, optional HRTF spatialisation.

import { engine } from './context';
import { renderSfx, sfxSampleRate, SFX_VARIANTS } from './sfx-render';
import { SFX_NAMES, type SfxName, type PlayOpts } from './types';

const MAX_VOICES = 24;
const MAX_SAME = 5;
const MIN_INTERVAL = 0.025; // seconds between two starts of the same sound

/** Loudness balance per sound. */
const GAIN: Partial<Record<SfxName, number>> = {
  chop: 0.8, chopMiss: 0.7, pickup: 0.45, drop: 0.75, clang: 0.7, thud: 0.85, squish: 0.6, shake: 0.45, plate: 0.6,
  bell: 0.6, footstep: 0.8, doorSlam: 1.0, hiss: 0.45, stoneCrack: 0.85, petrifyTick: 0.5, reflect: 0.7, stun: 0.5,
  gasp: 0.55, laugh: 0.6, applause: 0.55, boo: 0.55, whoosh: 0.5, flip: 0.5, splash: 0.6, tick: 0.35, roundStart: 0.55,
  roundEnd: 0.55, slam: 0.9, ding: 0.5, eyeGlow: 0.55, fireIgnite: 0.8, buzzer: 0.45, click: 0.35,
};
/** How much random pitch spread each sound gets (fraction). */
const SPREAD: Partial<Record<SfxName, number>> = {
  clang: 0.06, thud: 0.06, drop: 0.06, chop: 0.05, footstep: 0.05, plate: 0.04, squish: 0.08, pickup: 0.05,
  bell: 0.01, roundStart: 0, roundEnd: 0, buzzer: 0, eyeGlow: 0, ding: 0.01, applause: 0.02, laugh: 0.03, boo: 0.03,
};
/** Sounds that stay mostly dry (UI / jingles). */
const DRY = new Set<SfxName>(['click', 'roundStart', 'roundEnd', 'buzzer', 'tick']);

interface Voice { src: AudioBufferSourceNode; gain: GainNode; name: SfxName; start: number; ended: boolean }
const active: Voice[] = [];
const lastStart = new Map<SfxName, number>();
const cache = new Map<SfxName, AudioBuffer[]>();

/** Buffers for a sound. Renders the first variant now; the others follow in later idle slices. */
function variants(name: SfxName, all = false): AudioBuffer[] {
  let v = cache.get(name);
  const ctx = engine.ctx!;
  const count = SFX_VARIANTS[name] ?? 3;
  const sr = sfxSampleRate(name, ctx.sampleRate);
  if (!v) {
    v = [engine.makeBuffer(renderSfx(name, sr, 1), sr)];
    cache.set(name, v);
    if (!all && count > 1) setTimeout(() => { try { variants(name, true); } catch { /* ignore */ } }, 40);
  }
  if (all) while (v.length < count) v.push(engine.makeBuffer(renderSfx(name, sr, v.length + 1), sr));
  return v;
}

/** Pre-render everything in small idle-time chunks after init so first plays don't hitch. */
export function prewarmSfx(): void {
  const queue = [...SFX_NAMES];
  const step = () => {
    if (!engine.ctx) return;
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 8) {
      const n = queue.shift()!;
      try { variants(n, true); } catch (e) { console.warn('[audio] sfx render', n, e); }
    }
    if (queue.length) setTimeout(step, 30);
  };
  setTimeout(step, 50);
}

function stopVoice(v: Voice, fade = 0.015): void {
  if (v.ended) return;
  v.ended = true;
  const t = engine.now;
  try {
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + fade);
    v.src.stop(t + fade + 0.01);
  } catch { /* already stopped */ }
}

export function playSfx(name: SfxName, opts: PlayOpts = {}): void {
  const ctx = engine.ctx;
  if (!ctx || !engine.ready) return;
  if (!(SFX_NAMES as readonly string[]).includes(name)) return;
  const now = ctx.currentTime;
  const vol = Math.max(0, Math.min(4, Number.isFinite(opts.volume as number) ? (opts.volume as number) : 1));
  if (vol < 0.003) return;

  // prune finished voices
  for (let i = active.length - 1; i >= 0; i--) if (active[i].ended) active.splice(i, 1);
  // rate limit identical sounds (physics can fire many per frame)
  const last = lastStart.get(name) ?? -1;
  if (now - last < MIN_INTERVAL) return;
  lastStart.set(name, now);
  // per-name cap, then global cap: steal the oldest
  const same = active.filter((v) => v.name === name);
  if (same.length >= MAX_SAME) stopVoice(same[0]);
  const live = active.filter((v) => !v.ended);
  if (live.length >= MAX_VOICES) stopVoice(live[0]);

  const bufs = variants(name);
  const buf = bufs[Math.floor(Math.random() * bufs.length)];
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const spread = SPREAD[name] ?? 0.03;
  const pitch = Number.isFinite(opts.pitch as number) && (opts.pitch as number) > 0 ? (opts.pitch as number) : 1;
  src.playbackRate.value = Math.max(0.25, Math.min(4, pitch * (1 + (Math.random() * 2 - 1) * spread)));
  const gain = ctx.createGain();
  gain.gain.value = vol * (GAIN[name] ?? 0.7) * (1 + (Math.random() - 0.5) * 0.1);
  src.connect(gain);
  let send = DRY.has(name) ? 0.05 : 0.12;
  if (opts.pos) {
    const p = engine.createPanner(opts.pos);
    gain.connect(p).connect(engine.sfxBus);
    send = DRY.has(name) ? 0.05 : 0.28;
  } else {
    gain.connect(engine.sfxBus);
  }
  const sg = ctx.createGain();
  sg.gain.value = send;
  gain.connect(sg).connect(engine.reverbSend);
  const v: Voice = { src, gain, name, start: now, ended: false };
  src.onended = () => {
    v.ended = true;
    try { src.disconnect(); gain.disconnect(); sg.disconnect(); } catch { /* ignore */ }
  };
  src.start(now);
  active.push(v);
}

export function activeSfxCount(): number {
  return active.filter((v) => !v.ended).length;
}
