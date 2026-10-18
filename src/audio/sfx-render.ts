// Procedural sound-effect and loop renderers. Pure TS: every recipe returns a mono Float32Array
// rendered sample-by-sample (modal synthesis, filtered noise, little oscillators). No Web Audio needed,
// so the recipes are deterministic (seeded) and testable in node.

import { Biquad, Resonator, OnePole, mulberry32, TAU, makeLoopable, peakNormalize, clamp } from './dsp';
import type { SfxName, LoopName } from './types';

type Rng = () => number;

class Ctx {
  out: Float32Array;
  constructor(public sr: number, dur: number, public rnd: Rng) { this.out = new Float32Array(Math.ceil(dur * sr)); }
  get len() { return this.out.length; }
  n(t: number) { return Math.floor(t * this.sr); }
  r(a: number, b: number) { return a + (b - a) * this.rnd(); }
  noise() { return this.rnd() * 2 - 1; }

  /** Sum of exponentially decaying sinusoids (modal synthesis). */
  modes(start: number, freqs: number[], decays: number[], amps: number[], opts: { attack?: number; detune?: number; gain?: number } = {}) {
    const s0 = this.n(start), sr = this.sr, g = opts.gain ?? 1;
    const att = Math.max(1, Math.floor((opts.attack ?? 0.0008) * sr));
    for (let m = 0; m < freqs.length; m++) {
      const f = freqs[m] * (1 + (opts.detune ?? 0) * (this.rnd() - 0.5));
      if (f >= sr * 0.48) continue;
      const tau = decays[m], a = amps[m] * g;
      const nEnd = Math.min(this.len, s0 + Math.floor(tau * 7 * sr));
      const w = (TAU * f) / sr, ph = this.rnd() * TAU, k = Math.exp(-1 / (tau * sr));
      let env = a;
      for (let i = s0; i < nEnd; i++) {
        const j = i - s0;
        const at = j < att ? j / att : 1;
        this.out[i] += Math.sin(w * j + ph) * env * at;
        env *= k;
      }
    }
  }

  /** Filtered noise burst with an envelope function env(t01) and optional moving filter. */
  noiseBurst(start: number, dur: number, amp: number, env: (u: number) => number,
    filt?: { type: 'lp' | 'hp' | 'bp'; f: number | ((u: number) => number); q?: number }, filt2?: { type: 'lp' | 'hp' | 'bp'; f: number; q?: number }) {
    const s0 = this.n(start), N = Math.min(this.len - s0, this.n(dur));
    if (N <= 0) return;
    const bq = new Biquad(this.sr), bq2 = filt2 ? new Biquad(this.sr) : null;
    const setF = (u: number) => {
      if (!filt) return;
      const f = typeof filt.f === 'function' ? filt.f(u) : filt.f;
      if (filt.type === 'lp') bq.lowpass(f, filt.q ?? 0.707);
      else if (filt.type === 'hp') bq.highpass(f, filt.q ?? 0.707);
      else bq.bandpass(f, filt.q ?? 1);
    };
    if (bq2 && filt2) { if (filt2.type === 'lp') bq2.lowpass(filt2.f, filt2.q ?? 0.707); else if (filt2.type === 'hp') bq2.highpass(filt2.f, filt2.q ?? 0.707); else bq2.bandpass(filt2.f, filt2.q ?? 1); }
    setF(0);
    for (let j = 0; j < N; j++) {
      const u = j / N;
      if (filt && typeof filt.f === 'function' && (j & 31) === 0) setF(u);
      let x = this.noise();
      if (filt) x = bq.process(x);
      if (bq2) x = bq2.process(x);
      this.out[s0 + j] += x * amp * env(u);
    }
  }

  /** Oscillator with frequency function f(t seconds-from-start) and envelope env(u). */
  tone(start: number, dur: number, amp: number, freq: (t: number) => number, env: (u: number) => number,
    wave: 'sine' | 'tri' | 'saw' | 'square' = 'sine', lp?: number) {
    const s0 = this.n(start), N = Math.min(this.len - s0, this.n(dur));
    let ph = this.rnd();
    const flt = lp ? new Biquad(this.sr).lowpass(lp, 0.8) : null;
    let inc = 0;
    for (let j = 0; j < N; j++) {
      if ((j & 15) === 0) inc = freq(j / this.sr) / this.sr;
      ph += inc; ph -= Math.floor(ph);
      let x: number;
      switch (wave) {
        case 'sine': x = Math.sin(ph * TAU); break;
        case 'tri': x = 4 * Math.abs(ph - 0.5) - 1; break;
        case 'saw': x = 2 * ph - 1; break;
        default: x = ph < 0.5 ? 1 : -1;
      }
      if (flt) x = flt.process(x);
      this.out[s0 + j] += x * amp * env(j / N);
    }
  }

  /** Short click / impulse into a resonator bank. */
  click(start: number, amp: number, res: { f: number; bw: number; g: number }[], len = 0.05) {
    const s0 = this.n(start), N = Math.min(this.len - s0, this.n(len));
    const rs = res.map((r) => { const R = new Resonator(); R.set(r.f, r.bw, this.sr); return { R, g: r.g * r.bw / Math.max(1, r.f) * 4 }; });
    for (let j = 0; j < N; j++) {
      const x = j < 3 ? (j === 0 ? 1 : -0.6) : 0;
      let y = 0;
      for (const r of rs) y += r.R.process(x) * r.g;
      this.out[s0 + j] += y * amp;
    }
  }

  /** "Voiced" formant source: buzzy pulse through 3 formant resonators (crowd voices). */
  voice(start: number, dur: number, amp: number, f0: (t: number) => number, formants: (t: number) => [number, number, number],
    env: (u: number) => number, breath = 0.2) {
    const s0 = this.n(start), N = Math.min(this.len - s0, this.n(dur));
    if (N <= 0) return;
    const R1 = new Resonator(), R2 = new Resonator(), R3 = new Resonator();
    const tilt = new OnePole(2500, this.sr);
    let ph = 0;
    for (let j = 0; j < N; j++) {
      const t = j / this.sr;
      if ((j & 63) === 0) {
        const F = formants(t);
        R1.set(F[0], 90, this.sr); R2.set(F[1], 120, this.sr); R3.set(F[2], 180, this.sr);
      }
      ph += f0(t) / this.sr;
      if (ph >= 1) ph -= 1;
      const tp = ph / 0.6;
      const g = tp < 1 ? 2 * tp - 3 * tp * tp : 0;
      let x = tilt.process(g) * 2 + this.noise() * breath * 0.3;
      x = R1.process(R2.process(R3.process(x)));
      this.out[s0 + j] += x * amp * env(j / N);
    }
  }
}

const expEnv = (a: number, d: number) => (u: number) => (u < a ? u / a : Math.exp(-(u - a) / d));
const ar = (a: number, r: number) => (u: number) => (u < a ? u / a : u > 1 - r ? Math.max(0, (1 - u) / r) : 1);

/** Inharmonic metal partial ratios (pot / pan). */
const METAL = [1, 2.32, 4.25, 6.63, 9.38, 12.1];

export const SFX_VARIANTS: Partial<Record<SfxName, number>> = { applause: 2, laugh: 2, boo: 2, gasp: 3, roundStart: 1, roundEnd: 1, eyeGlow: 1, buzzer: 1 };

const HALF_RATE = new Set<SfxName>(['gasp', 'laugh', 'boo', 'applause', 'stun', 'eyeGlow']);
/** Sample rate a recipe is rendered at (crowd / tonal sounds use half rate to keep render time low). */
export function sfxSampleRate(name: SfxName, sr: number): number {
  return HALF_RATE.has(name) ? Math.round(sr / 2) : sr;
}

export function renderSfx(name: SfxName, sr: number, seed: number): Float32Array {
  const rnd = mulberry32(seed * 7919 + name.length * 131 + name.charCodeAt(0));
  let c: Ctx = new Ctx(sr, 0.05, rnd);
  const mk = (dur: number) => (c = new Ctx(sr, dur, rnd));
  switch (name) {
    case 'chop': {
      mk(0.32);
      const body = c.r(0.9, 1.15);
      c.click(0, 1.2, [{ f: 3200 * body, bw: 900, g: 0.8 }, { f: 6500, bw: 2000, g: 0.4 }], 0.02);
      c.modes(0.001, [180, 420, 980, 1650].map((f) => f * body), [0.03, 0.025, 0.018, 0.012], [0.9, 0.6, 0.35, 0.2]);
      c.noiseBurst(0, 0.05, 0.5, expEnv(0.02, 0.15), { type: 'bp', f: 2400 * body, q: 1.2 });
      c.tone(0, 0.08, 0.6, (t) => 140 - t * 600, expEnv(0.02, 0.3));
      break;
    }
    case 'chopMiss': {
      mk(0.9);
      c.modes(0, [2350, 3900, 5600, 7100].map((f) => f * c.r(0.95, 1.05)), [0.12, 0.09, 0.06, 0.04], [0.4, 0.3, 0.2, 0.12]);
      c.click(0, 0.8, [{ f: 4200, bw: 1500, g: 1 }], 0.02);
      const f0 = c.r(240, 300);
      c.tone(0.03, 0.8, 0.5, (t) => f0 * (1 - t * 0.35) * (1 + 0.18 * Math.exp(-t * 2.5) * Math.sin(TAU * 13 * t)), expEnv(0.02, 0.45), 'tri');
      break;
    }
    case 'pickup': {
      mk(0.18);
      c.noiseBurst(0, 0.12, 0.25, (u) => Math.sin(Math.PI * u), { type: 'bp', f: (u) => 900 + 2500 * u, q: 1.5 });
      const f = c.r(380, 460);
      c.tone(0.02, 0.1, 0.35, (t) => f + t * 3500, expEnv(0.1, 0.3));
      break;
    }
    case 'drop': {
      mk(0.35);
      const k = c.r(0.85, 1.2);
      c.tone(0, 0.2, 0.9, (t) => 110 * k - t * 200, expEnv(0.01, 0.18));
      c.noiseBurst(0, 0.12, 0.6, expEnv(0.01, 0.15), { type: 'lp', f: 1400 * k });
      c.modes(0, [310, 720, 1180].map((f) => f * k), [0.05, 0.035, 0.02], [0.4, 0.25, 0.12]);
      break;
    }
    case 'clang': {
      mk(1.6);
      const f0 = c.r(280, 420);
      c.modes(0, METAL.map((r) => f0 * r), [0.9, 0.7, 0.5, 0.35, 0.25, 0.18], [0.5, 0.42, 0.32, 0.22, 0.15, 0.1], { detune: 0.04 });
      c.modes(0, METAL.slice(0, 4).map((r) => f0 * r * 1.004), [0.9, 0.7, 0.5, 0.35], [0.25, 0.2, 0.15, 0.1]);
      c.noiseBurst(0, 0.03, 0.8, expEnv(0.02, 0.2), { type: 'hp', f: 2000 });
      break;
    }
    case 'thud': {
      mk(0.4);
      const k = c.r(0.85, 1.15);
      c.tone(0, 0.3, 1, (t) => 75 * k * (1 - t * 0.8), expEnv(0.01, 0.25));
      c.noiseBurst(0, 0.1, 0.7, expEnv(0.01, 0.2), { type: 'lp', f: 600 * k });
      break;
    }
    case 'squish': {
      mk(0.45);
      const k = c.r(0.8, 1.2);
      c.noiseBurst(0, 0.4, 0.8, expEnv(0.05, 0.35), { type: 'bp', f: (u) => (300 + 1400 * Math.sin(u * 9) ** 2) * k, q: 4 });
      c.voice(0, 0.35, 0.25, (t) => 90 + 60 * Math.sin(t * 40), (t) => [400 + 300 * Math.sin(t * 30), 900 + 500 * t, 2400], expEnv(0.05, 0.3), 1.5);
      break;
    }
    case 'shake': {
      mk(0.55);
      const hits = 6 + Math.floor(c.rnd() * 3);
      for (let i = 0; i < hits; i++) {
        const t = i * 0.075 + c.r(-0.01, 0.01);
        c.noiseBurst(Math.max(0, t), 0.06, c.r(0.4, 0.7), expEnv(0.15, 0.3), { type: 'hp', f: 4500 }, { type: 'bp', f: c.r(6000, 9000), q: 1 });
      }
      break;
    }
    case 'plate': {
      mk(0.7);
      const k = c.r(0.92, 1.08);
      c.modes(0, [1850, 3150, 4720, 6310, 7900].map((f) => f * k), [0.25, 0.18, 0.12, 0.08, 0.05], [0.4, 0.33, 0.24, 0.15, 0.1], { detune: 0.02 });
      c.tone(0, 0.08, 0.4, (t) => 240 - t * 900, expEnv(0.02, 0.25));
      c.click(0, 0.6, [{ f: 3500, bw: 1500, g: 1 }]);
      break;
    }
    case 'bell': {
      mk(2.2);
      const f0 = c.r(1600, 1720);
      c.modes(0, [f0, f0 * 1.003, f0 * 2.76, f0 * 5.4, f0 * 8.93, f0 * 0.5], [1.4, 1.3, 0.6, 0.3, 0.15, 0.9], [0.5, 0.4, 0.35, 0.2, 0.1, 0.08], { attack: 0.001 });
      c.click(0, 0.5, [{ f: 5000, bw: 2000, g: 1 }], 0.01);
      break;
    }
    case 'footstep': {
      mk(0.32);
      const k = c.r(0.9, 1.1);
      c.click(0, 1, [{ f: 1150 * k, bw: 300, g: 0.8 }, { f: 2600 * k, bw: 700, g: 0.5 }, { f: 5200, bw: 2000, g: 0.3 }], 0.06);
      c.noiseBurst(0, 0.03, 0.5, expEnv(0.05, 0.2), { type: 'hp', f: 1800 });
      const t2 = c.r(0.05, 0.07);
      c.noiseBurst(t2, 0.08, 0.6, expEnv(0.08, 0.25), { type: 'lp', f: 900 * k });
      c.tone(t2, 0.1, 0.6, (t) => 95 * k - t * 300, expEnv(0.02, 0.25));
      break;
    }
    case 'doorSlam': {
      mk(1.6);
      c.tone(0, 0.7, 1, (t) => 62 * (1 - t * 0.3), expEnv(0.005, 0.25));
      c.noiseBurst(0, 0.25, 0.9, expEnv(0.005, 0.2), { type: 'lp', f: 2500 });
      c.modes(0, [140, 290, 470, 830], [0.15, 0.1, 0.07, 0.05], [0.5, 0.3, 0.2, 0.1]);
      // swinging door flapping back and forth
      for (let i = 1; i <= 4; i++) {
        const t = i * 0.19 + c.r(-0.02, 0.02), a = 0.5 / i;
        c.noiseBurst(t, 0.08, a, expEnv(0.02, 0.25), { type: 'lp', f: 1600 });
        c.tone(t, 0.12, a * 0.9, (tt) => 90 - tt * 100, expEnv(0.02, 0.3));
      }
      break;
    }
    case 'hiss': {
      mk(1.0);
      c.noiseBurst(0, 1.0, 0.9, (u) => (u < 0.08 ? u / 0.08 : u > 0.6 ? Math.max(0, (1 - u) / 0.4) : 1) * (0.75 + 0.25 * Math.sin(u * TAU * 22)),
        { type: 'bp', f: (u) => 6200 + 1500 * u, q: 1.6 }, { type: 'hp', f: 3000 });
      break;
    }
    case 'stoneCrack': {
      mk(0.9);
      c.click(0, 1.2, [{ f: 900, bw: 400, g: 1 }, { f: 2300, bw: 800, g: 0.7 }, { f: 4800, bw: 1500, g: 0.4 }], 0.08);
      c.tone(0, 0.35, 0.7, (t) => 70 - t * 60, expEnv(0.01, 0.3));
      const grains = 90;
      for (let i = 0; i < grains; i++) {
        const t = Math.pow(c.rnd(), 1.6) * 0.75;
        c.click(t, c.r(0.1, 0.45) * (1 - t), [{ f: c.r(700, 4000), bw: c.r(200, 900), g: 1 }], 0.03);
      }
      c.noiseBurst(0, 0.7, 0.35, expEnv(0.02, 0.35), { type: 'bp', f: 1400, q: 0.8 });
      break;
    }
    case 'petrifyTick': {
      mk(0.2);
      for (let i = 0; i < 9; i++) c.click(c.r(0, 0.12), c.r(0.2, 0.5), [{ f: c.r(900, 3500), bw: c.r(300, 800), g: 1 }], 0.03);
      c.noiseBurst(0, 0.15, 0.25, expEnv(0.1, 0.3), { type: 'bp', f: 1500, q: 1.2 });
      break;
    }
    case 'reflect': {
      mk(1.6);
      // reverse whoosh: rising noise cut off at the ring
      c.noiseBurst(0, 0.4, 0.6, (u) => Math.pow(u, 3), { type: 'bp', f: (u) => 800 + 5000 * u * u, q: 2 });
      const base = c.r(1900, 2100);
      const parts = [1, 1.51, 2.24, 2.97, 3.76];
      for (let p = 0; p < parts.length; p++) {
        const f = base * parts[p];
        c.tone(0.38, 1.2, 0.22 / (1 + p * 0.4), (t) => f * (1 + 0.01 * t) * (1 + 0.004 * Math.sin(TAU * (6 + p) * t)),
          (u) => (u < 0.01 ? u / 0.01 : Math.exp(-u * 4)) * (0.7 + 0.3 * Math.sin(u * TAU * (9 + p * 2))));
      }
      c.click(0.38, 0.6, [{ f: 6000, bw: 2500, g: 1 }], 0.02);
      break;
    }
    case 'stun': {
      mk(1.4);
      for (let v = 0; v < 2; v++) {
        const f = v ? 1550 : 1180, ph = v * Math.PI;
        c.tone(v * 0.04, 1.3, 0.25, (t) => f * (1 + 0.18 * Math.sin(TAU * 5.5 * t + ph)), (u) => Math.min(1, u * 20) * (1 - u) * (0.6 + 0.4 * Math.sin(u * TAU * 7)), 'sine');
      }
      c.tone(0, 0.5, 0.3, (t) => 500 - 300 * t, expEnv(0.02, 0.3), 'tri');
      break;
    }
    case 'gasp': {
      mk(1.0);
      const voices = 14;
      for (let v = 0; v < voices; v++) {
        const t = c.r(0, 0.07), fs = c.r(0.85, 1.25), f0 = c.r(150, 300);
        c.noiseBurst(t, 0.55, c.r(0.15, 0.3), expEnv(0.06, 0.35), { type: 'bp', f: 1700 * fs, q: 3 }, { type: 'hp', f: 500 });
        c.noiseBurst(t, 0.5, c.r(0.1, 0.2), expEnv(0.06, 0.3), { type: 'bp', f: 700 * fs, q: 3 });
        c.voice(t + 0.03, 0.3, 0.05, (tt) => f0 * (1 + tt * 0.4), () => [700 * fs, 1700 * fs, 2600 * fs], expEnv(0.1, 0.3), 1);
      }
      break;
    }
    case 'laugh': {
      mk(2.6);
      const voices = 13;
      for (let v = 0; v < voices; v++) {
        const f0 = c.r(130, 300), fs = f0 > 200 ? c.r(1.1, 1.25) : c.r(0.9, 1.05), rate = c.r(4.2, 6.2);
        let t = c.r(0, 0.25);
        const end = c.r(1.6, 2.4);
        const vowel: [number, number, number] = c.rnd() < 0.5 ? [750, 1250, 2550] : [680, 1700, 2450];
        while (t < end) {
          const syl = 1 / rate * c.r(0.85, 1.15), a = c.r(0.08, 0.16) * (1 - t / 2.7);
          c.noiseBurst(t, syl * 0.3, a * 0.8, expEnv(0.2, 0.4), { type: 'bp', f: 1500 * fs, q: 1 });
          c.voice(t + syl * 0.18, syl * 0.6, a, (tt) => f0 * (1.1 - tt * 1.2), () => [vowel[0] * fs, vowel[1] * fs, vowel[2] * fs], expEnv(0.1, 0.35), 0.4);
          t += syl;
        }
      }
      break;
    }
    case 'applause': {
      mk(3.2);
      const clappers = 26;
      for (let p = 0; p < clappers; p++) {
        const rate = c.r(3.2, 5.5), f = c.r(700, 2600), q = c.r(1, 2.5), loud = c.r(0.15, 0.4);
        let t = c.r(0, 0.2);
        while (t < 3.0) {
          const env = t < 0.3 ? t / 0.3 : t > 2.2 ? Math.max(0, (3 - t) / 0.8) : 1;
          c.noiseBurst(t, 0.035, loud * env, expEnv(0.08, 0.25), { type: 'bp', f: f * c.r(0.92, 1.08), q });
          t += (1 / rate) * c.r(0.85, 1.15);
        }
      }
      c.noiseBurst(0, 3.1, 0.06, ar(0.1, 0.3), { type: 'bp', f: 1800, q: 0.5 });
      break;
    }
    case 'boo': {
      mk(2.2);
      for (let v = 0; v < 11; v++) {
        const f0 = c.r(95, 190), fs = c.r(0.9, 1.15), t = c.r(0, 0.25), vib = c.r(4, 6.5);
        c.voice(t, c.r(1.4, 1.9), c.r(0.08, 0.14), (tt) => f0 * (1 - tt * 0.08) * (1 + 0.02 * Math.sin(TAU * vib * tt)),
          (tt) => [Math.min(330, 300 + tt * 20) * fs, 870 * fs, 2240 * fs], ar(0.15, 0.35), 0.3);
      }
      c.noiseBurst(0, 2, 0.05, ar(0.2, 0.3), { type: 'lp', f: 900 });
      break;
    }
    case 'whoosh': {
      mk(0.55);
      const k = c.r(0.85, 1.15);
      c.noiseBurst(0, 0.55, 0.8, (u) => Math.sin(Math.PI * u) ** 2, { type: 'bp', f: (u) => (400 + 2200 * Math.sin(Math.PI * u)) * k, q: 1.8 });
      break;
    }
    case 'flip': {
      mk(0.35);
      c.noiseBurst(0, 0.2, 0.6, (u) => Math.sin(Math.PI * u), { type: 'bp', f: (u) => 600 + 3000 * u, q: 2 });
      c.tone(0.18, 0.1, 0.4, (t) => 180 - t * 400, expEnv(0.03, 0.3));
      c.noiseBurst(0.18, 0.12, 0.3, expEnv(0.03, 0.3), { type: 'hp', f: 2500 });
      break;
    }
    case 'splash': {
      mk(0.8);
      c.noiseBurst(0, 0.5, 0.7, expEnv(0.02, 0.3), { type: 'lp', f: (u) => 4000 * (1 - u) + 500, q: 0.8 });
      for (let i = 0; i < 14; i++) {
        const t = c.r(0.02, 0.6), f = c.r(400, 1300), d = c.r(0.02, 0.05);
        c.tone(t, d, c.r(0.1, 0.25), (tt) => f * (1 + tt / d * 0.8), expEnv(0.1, 0.4));
      }
      break;
    }
    case 'tick': {
      mk(0.06);
      c.click(0, 0.9, [{ f: 2800, bw: 300, g: 1 }, { f: 5200, bw: 800, g: 0.5 }], 0.05);
      break;
    }
    case 'roundStart': {
      mk(1.3);
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        const t = i * 0.09;
        const last = i === notes.length - 1;
        const d = last ? 0.9 : 0.12;
        c.tone(t, d, 0.22, (tt) => f * (1 + (last ? 0.006 * Math.sin(TAU * 6 * tt) : 0)), ar(0.02, last ? 0.5 : 0.3), 'saw', 3500);
        c.tone(t, d, 0.18, () => f * 1.004, ar(0.02, last ? 0.5 : 0.3), 'square', 2500);
      });
      [523.25, 659.25, 783.99].forEach((f) => c.tone(0.27, 0.9, 0.08, () => f, ar(0.05, 0.6), 'saw', 2000));
      c.noiseBurst(0.27, 0.5, 0.15, expEnv(0.01, 0.4), { type: 'hp', f: 6000 });
      break;
    }
    case 'roundEnd': {
      mk(1.6);
      [1568, 1318.5, 1046.5, 784].forEach((f, i) => c.modes(i * 0.17, [f, f * 2.01, f * 3.02], [0.6, 0.3, 0.15], [0.35, 0.12, 0.05]));
      break;
    }
    case 'slam': {
      mk(0.9);
      c.tone(0, 0.3, 1, (t) => 85 - t * 100, expEnv(0.005, 0.25));
      c.noiseBurst(0, 0.08, 0.9, expEnv(0.01, 0.25), { type: 'lp', f: 3000 });
      const f0 = c.r(500, 650);
      c.modes(0.002, METAL.map((r) => f0 * r), [0.5, 0.35, 0.25, 0.18, 0.12, 0.08], [0.3, 0.25, 0.18, 0.12, 0.08, 0.05], { detune: 0.05 });
      // rattling utensils
      for (let i = 0; i < 6; i++) c.modes(c.r(0.05, 0.3), [c.r(2500, 5000), c.r(5000, 7000)], [0.04, 0.03], [0.08, 0.05]);
      break;
    }
    case 'ding': {
      mk(1.1);
      const f = c.r(2050, 2130);
      c.modes(0, [f, f * 2.0, f * 3.0], [0.5, 0.25, 0.12], [0.5, 0.12, 0.05], { attack: 0.002 });
      break;
    }
    case 'eyeGlow': {
      mk(1.7);
      for (let v = 0; v < 3; v++) {
        const det = [1, 1.007, 0.5][v];
        c.tone(0, 1.6, v === 2 ? 0.2 : 0.17, (t) => 200 * det * Math.pow(4.5, t / 1.5) * (1 + 0.01 * (t / 1.5) * Math.sin(TAU * (5 + 4 * t) * t)),
          (u) => Math.pow(u, 1.6) * (u > 0.94 ? (1 - u) / 0.06 : 1), v === 2 ? 'tri' : 'sine');
      }
      c.tone(0, 1.6, 0.06, (t) => 1600 * Math.pow(2.5, t / 1.5), (u) => Math.pow(u, 2) * (0.6 + 0.4 * Math.sin(u * TAU * 18)) * (u > 0.94 ? (1 - u) / 0.06 : 1), 'sine');
      c.noiseBurst(0, 1.6, 0.12, (u) => Math.pow(u, 2.5) * (u > 0.94 ? (1 - u) / 0.06 : 1), { type: 'bp', f: (u) => 1500 + 4000 * u, q: 3 });
      break;
    }
    case 'fireIgnite': {
      mk(1.0);
      c.noiseBurst(0, 0.9, 1, (u) => (u < 0.08 ? u / 0.08 : Math.exp(-(u - 0.08) * 4)), { type: 'lp', f: (u) => 300 + 2500 * Math.exp(-u * 3), q: 0.7 });
      c.tone(0, 0.5, 0.6, (t) => 55 + 40 * Math.exp(-t * 10), expEnv(0.1, 0.4));
      for (let i = 0; i < 12; i++) c.click(c.r(0.05, 0.8), c.r(0.1, 0.35), [{ f: c.r(1500, 5000), bw: 800, g: 1 }], 0.02);
      break;
    }
    case 'buzzer': {
      mk(0.85);
      c.tone(0, 0.8, 0.35, () => 110, ar(0.01, 0.05), 'saw', 1800);
      c.tone(0, 0.8, 0.35, () => 116.5, ar(0.01, 0.05), 'square', 1500);
      c.tone(0, 0.8, 0.2, () => 55, ar(0.01, 0.05), 'square', 600);
      break;
    }
    case 'click': {
      mk(0.04);
      c.click(0, 0.7, [{ f: 4200, bw: 1200, g: 1 }, { f: 1800, bw: 500, g: 0.4 }], 0.035);
      break;
    }
    default:
      mk(0.05);
  }
  const out = c.out;
  // tiny fade-out to avoid clicks
  const f = Math.min(out.length >> 2, Math.floor(sr * 0.005));
  for (let i = 0; i < f; i++) out[out.length - 1 - i] *= i / f;
  return peakNormalize(out, 0.9);
}

const HALF_RATE_LOOPS = new Set<LoopName>(['ambience', 'boil', 'fire', 'heartbeat']);
export function loopSampleRate(name: LoopName, sr: number): number {
  return HALF_RATE_LOOPS.has(name) ? Math.round(sr / 2) : sr;
}

/** Seamlessly looping buffers for continuous sounds. */
export function renderLoop(name: LoopName, sr: number): Float32Array {
  const rnd = mulberry32(4242 + name.length * 977 + name.charCodeAt(0));
  const loopLen = name === 'heartbeat' ? 0.86 : name === 'ambience' ? 8 : 5;
  const fade = name === 'heartbeat' ? 0 : 0.5;
  const c = new Ctx(sr, loopLen + fade, rnd);
  const total = loopLen + fade;
  switch (name) {
    case 'sizzle': {
      c.noiseBurst(0, total, 0.25, (u) => 0.8 + 0.2 * Math.sin(u * TAU * 3.3), { type: 'hp', f: 2500 }, { type: 'bp', f: 5500, q: 0.7 });
      for (let i = 0; i < total * 35; i++) {
        const t = c.r(0, total - 0.03);
        c.click(t, c.r(0.08, 0.4), [{ f: c.r(2500, 7000), bw: c.r(800, 2500), g: 1 }], 0.02);
      }
      break;
    }
    case 'fryer': {
      c.noiseBurst(0, total, 0.3, (u) => 0.85 + 0.15 * Math.sin(u * TAU * 5.1), { type: 'bp', f: 3200, q: 0.6 });
      c.noiseBurst(0, total, 0.15, () => 1, { type: 'lp', f: 400 });
      for (let i = 0; i < total * 70; i++) {
        const t = c.r(0, total - 0.03);
        c.click(t, c.r(0.08, 0.35), [{ f: c.r(1200, 5000), bw: c.r(500, 1500), g: 1 }], 0.02);
      }
      for (let i = 0; i < total * 12; i++) {
        const t = c.r(0, total - 0.05), f = c.r(300, 700);
        c.tone(t, 0.03, c.r(0.05, 0.12), (tt) => f * (1 + tt * 20), expEnv(0.1, 0.4));
      }
      break;
    }
    case 'boil': {
      c.noiseBurst(0, total, 0.12, () => 1, { type: 'lp', f: 300 });
      for (let i = 0; i < total * 18; i++) {
        const t = c.r(0, total - 0.06), f = c.r(150, 520), d = c.r(0.02, 0.05);
        c.tone(t, d, c.r(0.15, 0.4), (tt) => f * (1 + 0.6 * tt / d), (u) => Math.sin(Math.PI * u) * (1 - u));
      }
      for (let i = 0; i < total * 6; i++) c.click(c.r(0, total - 0.03), c.r(0.05, 0.12), [{ f: c.r(800, 2000), bw: 300, g: 1 }], 0.03);
      break;
    }
    case 'fire': {
      const lp = new Biquad(sr).lowpass(500, 0.6), lfo = mulberry32(99);
      let slow = 0.6;
      for (let i = 0; i < c.len; i++) {
        if ((i & 1023) === 0) slow = clamp(slow + (lfo() - 0.5) * 0.15, 0.4, 1);
        c.out[i] += lp.process(c.noise()) * 0.9 * slow;
      }
      c.noiseBurst(0, total, 0.08, () => 1, { type: 'bp', f: 1200, q: 0.5 });
      for (let i = 0; i < total * 14; i++) c.click(c.r(0, total - 0.03), c.r(0.1, 0.5), [{ f: c.r(1500, 6000), bw: c.r(600, 2000), g: 1 }], 0.025);
      break;
    }
    case 'ambience': {
      // fluorescent hum: 60 Hz family with a buzzy 120 Hz component (integer cycles per loop)
      const hum = [[60, 0.25], [120, 0.35], [180, 0.12], [240, 0.08], [300, 0.05], [360, 0.04], [480, 0.025], [600, 0.015]];
      const TBL = 4096, table = new Float32Array(TBL);
      for (let k = 0; k < TBL; k++) {
        let y = 0;
        for (const [f, a] of hum) y += Math.sin((TAU * (f / 60) * k) / TBL) * a;
        table[k] = Math.tanh(y * 2.5) * 0.18;
      }
      for (let i = 0; i < c.len; i++) {
        const ph = (60 * i) / sr;
        c.out[i] += table[Math.floor((ph - Math.floor(ph)) * TBL)];
      }
      c.noiseBurst(0, total, 0.25, (u) => 0.9 + 0.1 * Math.sin(u * TAU * 1.7), { type: 'lp', f: 280 });
      c.noiseBurst(0, total, 0.02, () => 1, { type: 'bp', f: 7800, q: 2 });
      break;
    }
    case 'heartbeat': {
      const beat = (t: number, f: number, a: number) => {
        c.tone(t, 0.22, a, (tt) => f * (1 - tt * 1.5), expEnv(0.04, 0.3));
        c.noiseBurst(t, 0.12, a * 0.4, expEnv(0.05, 0.3), { type: 'lp', f: 160 });
      };
      beat(0.0, 58, 1);
      beat(0.27, 66, 0.7);
      break;
    }
  }
  const out = fade > 0 ? makeLoopable(c.out, Math.floor(loopLen * sr)) : c.out.slice(0, Math.floor(loopLen * sr));
  return peakNormalize(out, 0.85);
}
