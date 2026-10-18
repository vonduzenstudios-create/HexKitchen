// Procedural room impulse response (pure TS): early reflections + exponentially decaying,
// progressively darker stereo noise tail. Tuned for a ~14 m tiled TV-studio kitchen.

import { mulberry32, OnePole } from './dsp';

export interface IROpts { seconds?: number; decay?: number; brightness?: number; preDelay?: number; seed?: number }

export function makeImpulseResponse(sr: number, o: IROpts = {}): [Float32Array, Float32Array] {
  const seconds = o.seconds ?? 1.8;
  const decay = o.decay ?? 1.25;          // RT60-ish seconds
  const bright = o.brightness ?? 0.6;
  const pre = Math.floor((o.preDelay ?? 0.012) * sr);
  const N = Math.floor(seconds * sr);
  const L = new Float32Array(N), R = new Float32Array(N);
  const rnd = mulberry32(o.seed ?? 1337);
  // early reflections (tiles: strong, discrete)
  for (let i = 0; i < 14; i++) {
    const t = pre + Math.floor((0.004 + Math.pow(rnd(), 1.3) * 0.07) * sr);
    const a = (0.5 + rnd() * 0.5) * (1 - i / 16) * 0.7;
    if (t < N) { L[t] += (rnd() < 0.5 ? -a : a); R[Math.min(N - 1, t + Math.floor(rnd() * 0.002 * sr))] += (rnd() < 0.5 ? -a : a); }
  }
  // diffuse tail
  const k = Math.log(1000) / decay; // 60 dB over `decay`
  const lpL = new OnePole(12000, sr), lpR = new OnePole(12000, sr);
  for (let i = pre; i < N; i++) {
    const t = (i - pre) / sr;
    const env = Math.exp(-k * t) * Math.min(1, t / 0.02);
    if ((i & 255) === 0) {
      const fc = 400 + (9000 * bright) * Math.exp(-t * 2.2);
      lpL.set(fc, sr); lpR.set(fc, sr);
    }
    L[i] += lpL.process(rnd() * 2 - 1) * env * 0.5;
    R[i] += lpR.process(rnd() * 2 - 1) * env * 0.5;
  }
  return [L, R];
}
