// Gorgon's "monster chain", applied at sample level (pure TS):
// octave-down vocal layer (rendered separately by the caller and mixed in here), waveshaper growl,
// ring modulation, and a snake hiss that rides the sibilants.

import { Biquad, mulberry32, DCBlock } from '../dsp';

export interface MonsterOpts {
  growl: number;          // 0..1
  sampleRate: number;
  seed?: number;
  sub?: Float32Array;     // octave-down layer (same length)
  sib?: Float32Array;     // sibilance envelope
}

export function monsterFx(dry: Float32Array, o: MonsterOpts): Float32Array {
  const g = Math.max(0, Math.min(1, o.growl));
  const sr = o.sampleRate;
  const out = new Float32Array(dry.length);
  // normalise input roughly to peak 1 so the drive is predictable
  let pk = 1e-9; for (let i = 0; i < dry.length; i++) pk = Math.max(pk, Math.abs(dry[i]));
  let spk = 1e-9; if (o.sub) for (let i = 0; i < o.sub.length; i++) spk = Math.max(spk, Math.abs(o.sub[i]));
  const drive = 1 + g * 5;
  const tn = Math.tanh(drive);
  const wet = g * 0.55;
  const ringF = 38 + g * 20;
  const ringMix = g * 0.22;
  const subMix = g * 0.45;
  const rnd = mulberry32(o.seed ?? 777);
  const hissBP = new Biquad(sr).bandpass(Math.min(7000, sr * 0.4), 1.4);
  const hissHP = new Biquad(sr).highpass(3500, 0.7);
  const subLP = new Biquad(sr).lowpass(1800, 0.7);
  const dc = new DCBlock();
  const hissAmt = g * 0.5;
  let sibEnv = 0;
  for (let i = 0; i < dry.length; i++) {
    let x = dry[i] / pk;
    if (o.sub) x += subLP.process(o.sub[i] / spk) * subMix;
    const shaped = Math.tanh(x * drive) / tn;
    let y = x * (1 - wet) + shaped * wet;
    const ring = Math.sin((6.283185307 * ringF * i) / sr);
    y = y * (1 - ringMix) + y * ring * ringMix;
    if (o.sib && hissAmt > 0) {
      const s = o.sib[i];
      sibEnv += (s - sibEnv) * (s > sibEnv ? 0.01 : 0.0015);
      if (sibEnv > 1e-3) {
        const flutter = 0.65 + 0.35 * Math.sin((6.283185307 * 31 * i) / sr);
        y += hissHP.process(hissBP.process(rnd() * 2 - 1)) * sibEnv * hissAmt * flutter * 1.6;
      }
    }
    out[i] = dc.process(y);
  }
  return out;
}
