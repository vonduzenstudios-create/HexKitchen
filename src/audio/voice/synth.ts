// Cascade/parallel formant synthesiser (Klatt-style), rendered sample-by-sample into a Float32Array.
// Voiced source: KLGLOTT88-like glottal flow derivative with jitter/shimmer and optional period-doubling
// (subharmonic growl). Cascade: nasal pole/zero -> F5 -> F4 -> F3 -> F2 -> F1. Parallel noise branch for
// frication and bursts. Pure TS: no DOM / Web Audio needed.

import { Resonator, AntiResonator, Biquad, OnePole, DCBlock, mulberry32 } from '../dsp';
import type { Utterance, Seg } from './prosody';
import { PH, isVowelKind, type F3, type FricSpec } from './phonemes';

export interface SynthOpts {
  sampleRate: number;
  f0Mul?: number;        // pitch multiplier applied to the contour
  formantMul?: number;   // vocal-tract scaling (<1 = bigger, deeper)
  subharmonic?: number;  // 0..1 period-doubling roughness
  breath?: number;       // aspiration mixed into voicing
  voicedOnly?: boolean;  // skip noise branch (for the octave-down layer)
  seed?: number;
  tilt?: number;         // 0..1 spectral tilt (higher = darker)
}

export interface SynthOut { samples: Float32Array; sib: Float32Array; sampleRate: number }

// ---------- keyframe tracks ----------
class Track {
  times: number[] = [];
  vals: number[][] = [];
  constructor(private n: number, private smooth: boolean) {}
  add(t: number, v: number[]): void {
    // keep sorted; on near-duplicate times, replace
    const L = this.times.length;
    if (L && t < this.times[L - 1] + 1e-4) {
      if (Math.abs(t - this.times[L - 1]) < 1e-4) { this.vals[L - 1] = v; return; }
      let i = L - 1;
      while (i > 0 && this.times[i - 1] > t) i--;
      this.times.splice(i, 0, t); this.vals.splice(i, 0, v);
      return;
    }
    this.times.push(t); this.vals.push(v);
  }
  private idx = 0;
  /** Evaluate at time t (monotonic calls are fast). */
  at(t: number, out: number[]): void {
    const T = this.times, V = this.vals;
    if (!T.length) { for (let k = 0; k < this.n; k++) out[k] = 0; return; }
    if (t <= T[0]) { for (let k = 0; k < this.n; k++) out[k] = V[0][k]; return; }
    const L = T.length;
    if (t >= T[L - 1]) { for (let k = 0; k < this.n; k++) out[k] = V[L - 1][k]; return; }
    if (this.idx >= L - 1 || T[this.idx] > t) this.idx = 0;
    while (this.idx < L - 2 && T[this.idx + 1] <= t) this.idx++;
    const i = this.idx;
    let u = (t - T[i]) / Math.max(1e-6, T[i + 1] - T[i]);
    if (this.smooth) u = u * u * (3 - 2 * u);
    const a = V[i], b = V[i + 1];
    for (let k = 0; k < this.n; k++) out[k] = a[k] + (b[k] - a[k]) * u;
  }
}

const mix = (a: F3, b: F3, k: number): F3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

function startTarget(s: Seg): F3 | null {
  if (!s.def || s.part === 'sil' || s.def.kind === 'asp') return null;
  return s.def.f;
}
function endTarget(s: Seg): F3 | null {
  if (!s.def || s.part === 'sil' || s.def.kind === 'asp') return null;
  return s.def.f2 ?? s.def.f;
}
function nextVowelF2(segs: Seg[], i: number): number {
  for (let j = i + 1; j < segs.length && j < i + 5; j++) {
    const d = segs[j].def;
    if (d && isVowelKind(d.kind)) return d.f[1];
  }
  return 1500;
}
function locusOf(segs: Seg[], i: number): F3 {
  const s = segs[i];
  const d = s.def!;
  if (s.ph === 'G' || s.ph === 'K' || s.ph === 'NG') {
    const f2 = nextVowelF2(segs, i);
    return f2 > 1600 ? [d.f[0], 2250, 2850] : [d.f[0], 1500, 2300];
  }
  return d.f;
}

const FNP = 270;

function buildTracks(u: Utterance) {
  const segs = u.segs;
  const fmt = new Track(6, true);     // F1 F2 F3 B1 B2 B3
  const src = new Track(6, false);    // AV AH AF FNZ SIB VBAR
  const fric = new Track(7, false);   // f1 bw1 g1 f2 bw2 g2 byp
  const specArr = (sp: FricSpec) => [sp.f1, sp.bw1, sp.g1, sp.f2, sp.bw2, sp.g2, sp.byp];

  const prevSon = (i: number): F3 | null => (i > 0 ? endTarget(segs[i - 1]) : null);
  const nextSon = (i: number): F3 | null => {
    for (let j = i + 1; j < segs.length && j <= i + 2; j++) {
      const s = segs[j];
      if (s.part === 'sil') return null;
      if (s.part === 'bur' || s.part === 'asp' || s.part === 'fr' || s.part === 'clo') continue;
      if (s.def && s.def.kind === 'asp') continue;
      return startTarget(s);
    }
    return null;
  };

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const st = s.start, en = s.start + s.dur, dur = s.dur;
    const d = s.def;
    // ---------- formants ----------
    if (d && s.part !== 'sil') {
      const bw = d.bw;
      const K = (f: F3) => [f[0], f[1], f[2], bw[0], bw[1], bw[2]];
      const kind = d.kind;
      if (s.part === 'main' && (kind === 'vowel' || kind === 'diph')) {
        const tin = Math.min(0.045, 0.3 * dur);
        if (kind === 'diph') {
          fmt.add(st + Math.min(tin, 0.25 * dur), K(d.f));
          fmt.add(en - Math.min(tin, 0.2 * dur), K(d.f2!));
        } else {
          fmt.add(st + tin, K(d.f));
          fmt.add(en - tin, K(d.f));
        }
      } else if (s.part === 'main' && (kind === 'liquid' || kind === 'nasal')) {
        fmt.add(st + 0.3 * dur, K(d.f));
        fmt.add(en - 0.3 * dur, K(d.f));
      } else if (s.part === 'main' && kind === 'glide') {
        fmt.add(st + 0.5 * dur, K(d.f));
      } else if (s.part === 'main' && kind === 'fric') {
        const p = prevSon(i), n = nextSon(i);
        fmt.add(st, K(p ? mix(d.f, p, 0.3) : d.f));
        fmt.add(en, K(n ? mix(d.f, n, 0.3) : d.f));
      } else if (s.part === 'clo') {
        const loc = locusOf(segs, i);
        const p = prevSon(i);
        fmt.add(st, K(p ? mix(loc, p, 0.25) : loc));
      } else if (s.part === 'asp') {
        const loc = locusOf(segs, i);
        const n = nextSon(i);
        fmt.add(st, K(n ? mix(loc, n, 0.35) : loc));
      } else if (s.part === 'fr') {
        fmt.add(st, K(d.f)); fmt.add(en, K(d.f));
      }
    }
    // ---------- source ----------
    const r = s.part === 'bur' ? 0.0015 : s.part === 'asp' ? 0.004 : Math.min(0.012, dur / 3);
    let AV = 0, AH = 0, AF = 0, FNZ = FNP, SIB = 0, VB = 0;
    if (d) {
      const a = s.amp;
      switch (s.part) {
        case 'main':
          if (d.kind === 'asp') AH = 0.42 * a;
          else { AV = d.av * a; AF = d.af * a; if (d.kind === 'nasal') FNZ = d.fnz ?? 450; SIB = d.sib ? 1 : 0; }
          break;
        case 'clo': if (s.voiceBar) { AV = 0.1; VB = 1; } break;
        case 'bur': AF = (s.burstAmp ?? 0.5) * a; break;
        case 'asp': AH = 0.38 * a; break;
        case 'fr': AV = d.av * a * 0.6; AF = d.af * a; SIB = 1; break;
      }
      if (d.kind === 'fric' || s.part === 'fr') fric.add(st, specArr(d.fric!)), fric.add(en, specArr(d.fric!));
      if (s.part === 'bur' && d.burst) {
        let sp = d.burst.spec;
        if (s.ph === 'K' || s.ph === 'G') {
          const f2 = nextVowelF2(segs, i);
          sp = { ...sp, f1: Math.max(1200, Math.min(3000, f2 * 1.15)) };
        }
        fric.add(st, specArr(sp)); fric.add(en, specArr(sp));
      }
    }
    src.add(st + r, [AV, AH, AF, FNZ, SIB, VB]);
    src.add(en - r, [AV, AH, AF, FNZ, SIB, VB]);
  }
  if (!fmt.times.length) fmt.add(0, [500, 1500, 2500, 80, 100, 160]);
  if (!fric.times.length) fric.add(0, specArr(PH.S.fric!));
  return { fmt, src, fric };
}

/** Hash for deterministic seeds. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function synthesize(u: Utterance, o: SynthOpts): SynthOut {
  const sr = o.sampleRate;
  const f0Mul = o.f0Mul ?? 1, fMul = o.formantMul ?? 1, sub = o.subharmonic ?? 0;
  const breath = o.breath ?? 0.04;
  const N = Math.max(1, Math.ceil(u.duration * sr));
  const out = new Float32Array(N);
  const sibOut = new Float32Array(N);
  const { fmt, src, fric } = buildTracks(u);
  const f0T = new Track(1, false);
  for (const p of u.f0) f0T.add(p.t, [p.hz]);

  const rnd = mulberry32(o.seed ?? 12345);
  const R1 = new Resonator(), R2 = new Resonator(), R3 = new Resonator(), R4 = new Resonator(), R5 = new Resonator();
  const RNP = new Resonator(), RNZ = new AntiResonator();
  const BP1 = new Biquad(sr), BP2 = new Biquad(sr), HPb = new Biquad(sr).highpass(1200, 0.7);
  const tiltF = new OnePole(sr * (0.14 - 0.08 * (o.tilt ?? 0.3)), sr);
  const aspLP = new OnePole(5000, sr);
  const dc = new DCBlock();
  R4.set(3500 * fMul, 250, sr);
  R5.set(Math.min(4500 * fMul, sr * 0.45), 300, sr);
  RNP.set(FNP, 100, sr);

  const FR = Math.max(16, Math.round(sr * 0.0025));
  const fv = [0, 0, 0, 0, 0, 0], sv0 = [0, 0, 0, 0, 0, 0], sv1 = [0, 0, 0, 0, 0, 0], fr = [0, 0, 0, 0, 0, 0, 0], f0v = [0];
  src.at(0, sv0);

  let phase = 0, period = 0, jitter = 1, shimmer = 1;
  const OQ = 0.6;
  let vibPh = 0;

  for (let n0 = 0; n0 < N; n0 += FR) {
    const n1 = Math.min(N, n0 + FR);
    const tMid = (n0 + n1) * 0.5 / sr;
    fmt.at(tMid, fv);
    R1.set(fv[0] * fMul, fv[3], sr);
    R2.set(fv[1] * fMul, fv[4], sr);
    R3.set(fv[2] * fMul, fv[5], sr);
    src.at(n1 / sr, sv1);
    RNZ.set(sv1[3], 100, sr);
    fric.at(tMid, fr);
    BP1.bandpass(fr[0], Math.max(0.5, fr[0] / fr[1]));
    BP2.bandpass(Math.min(fr[3], sr * 0.45), Math.max(0.5, fr[3] / fr[4]));
    f0T.at(tMid, f0v);
    const len = n1 - n0;
    for (let n = n0; n < n1; n++) {
      const u01 = (n - n0) / len;
      const AV = sv0[0] + (sv1[0] - sv0[0]) * u01;
      const AH = sv0[1] + (sv1[1] - sv0[1]) * u01;
      const AF = sv0[2] + (sv1[2] - sv0[2]) * u01;
      const SIB = sv0[4] + (sv1[4] - sv0[4]) * u01;
      // ----- glottal source
      vibPh += 5.2 / sr;
      const vib = 1 + 0.006 * Math.sin(vibPh * 6.2832);
      let f0 = f0v[0] * f0Mul * jitter * vib;
      if (sub > 0) f0 *= period & 1 ? 1 + sub * 0.07 : 1 - sub * 0.07;
      phase += f0 / sr;
      if (phase >= 1) {
        phase -= 1; period++;
        jitter = 1 + (rnd() - 0.5) * 0.02;
        shimmer = 1 + (rnd() - 0.5) * 0.1;
        if (sub > 0 && (period & 1)) shimmer *= 1 - sub * 0.7;
      }
      const tp = phase / OQ;
      const g = tp < 1 ? (2 * tp - 3 * tp * tp) : 0;
      const open = tp < 1;
      const noise = rnd() * 2 - 1;
      const voiced = tiltF.process(g * shimmer) * AV * 3;
      const asp = aspLP.process(noise) * (AH + breath * AV * (open ? 1 : 0.3)) * 1.6;
      // ----- cascade
      let c = voiced + asp;
      c = RNP.process(c);
      c = RNZ.process(c);
      c = R5.process(c); c = R4.process(c); c = R3.process(c); c = R2.process(c); c = R1.process(c);
      // ----- parallel frication
      let f = 0;
      if (!o.voicedOnly && AF > 1e-4) {
        const nmod = AV > 0.05 ? (open ? 1 : 0.45) : 1;
        const x = noise * AF * nmod;
        f = BP1.process(x) * fr[2] + BP2.process(x) * fr[5] + HPb.process(x) * fr[6];
      } else if (!o.voicedOnly) { BP1.process(0); BP2.process(0); HPb.process(0); }
      out[n] = dc.process(c * 1.0 + f * 1.6);
      sibOut[n] = SIB * AF;
    }
    sv0[0] = sv1[0]; sv0[1] = sv1[1]; sv0[2] = sv1[2]; sv0[3] = sv1[3]; sv0[4] = sv1[4]; sv0[5] = sv1[5];
  }
  return { samples: out, sib: sibOut, sampleRate: sr };
}
