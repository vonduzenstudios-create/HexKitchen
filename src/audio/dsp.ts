// Pure DSP helpers (no Web Audio, no DOM): usable in node for tests and in the browser
// for rendering sound effects / speech straight into Float32Arrays.

/** Small fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** RBJ-cookbook biquad, direct form I. Coefficients may be changed while running. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private sr: number) {}

  private setCoefs(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): this {
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  private w(f: number): [number, number] {
    const w0 = (TAU * clamp(f, 10, this.sr * 0.49)) / this.sr;
    return [Math.cos(w0), Math.sin(w0)];
  }
  lowpass(f: number, q = 0.707): this {
    const [c, s] = this.w(f); const al = s / (2 * q);
    return this.setCoefs((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }
  highpass(f: number, q = 0.707): this {
    const [c, s] = this.w(f); const al = s / (2 * q);
    return this.setCoefs((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }
  /** Band-pass with 0 dB peak gain. */
  bandpass(f: number, q = 1): this {
    const [c, s] = this.w(f); const al = s / (2 * q);
    return this.setCoefs(al, 0, -al, 1 + al, -2 * c, 1 - al);
  }
  peaking(f: number, q: number, dbGain: number): this {
    const [c, s] = this.w(f); const al = s / (2 * q); const A = Math.pow(10, dbGain / 40);
    return this.setCoefs(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
  }
  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1;
    this.y1 = Math.abs(y) < 1e-20 ? 0 : y;
    return this.y1;
  }
  reset(): void { this.x1 = this.x2 = this.y1 = this.y2 = 0; }
}

/** Klatt-style digital resonator (unity gain at DC). */
export class Resonator {
  a = 1; b = 0; c = 0; private y1 = 0; private y2 = 0;
  set(f: number, bw: number, sr: number): void {
    const T = 1 / sr;
    const r = Math.exp(-Math.PI * bw * T);
    this.c = -r * r;
    this.b = 2 * r * Math.cos(TAU * Math.min(f, sr * 0.48) * T);
    this.a = 1 - this.b - this.c;
  }
  process(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Klatt anti-resonator (zero pair, unity gain at DC). */
export class AntiResonator {
  private a = 1; private b = 0; private c = 0; private x1 = 0; private x2 = 0;
  set(f: number, bw: number, sr: number): void {
    const T = 1 / sr;
    const r = Math.exp(-Math.PI * bw * T);
    const c = -r * r;
    const b = 2 * r * Math.cos(TAU * Math.min(f, sr * 0.48) * T);
    const a = 1 - b - c;
    this.a = 1 / a; this.b = -b / a; this.c = -c / a;
  }
  process(x: number): number {
    const y = this.a * x + this.b * this.x1 + this.c * this.x2;
    this.x2 = this.x1; this.x1 = x;
    return y;
  }
}

/** One-pole lowpass. */
export class OnePole {
  private y = 0; private k = 1;
  constructor(f: number, sr: number) { this.set(f, sr); }
  set(f: number, sr: number): void { this.k = 1 - Math.exp((-TAU * f) / sr); }
  process(x: number): number { this.y += (x - this.y) * this.k; return this.y; }
}

/** DC blocker. */
export class DCBlock {
  private x1 = 0; private y1 = 0;
  process(x: number): number { const y = x - this.x1 + 0.995 * this.y1; this.x1 = x; this.y1 = y; return y; }
}

export function peakNormalize(buf: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; }
  if (m > 1e-9) { const g = peak / m; for (let i = 0; i < buf.length; i++) buf[i] *= g; }
  return buf;
}

export function rms(buf: Float32Array, from = 0, to = buf.length): number {
  let s = 0; const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / n);
}

/** Make a buffer loop seamlessly: buffer has `len + fade` samples; returns `len` samples whose end crossfades into start. */
export function makeLoopable(src: Float32Array, len: number): Float32Array {
  const fade = src.length - len;
  const out = src.slice(0, len);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const a = Math.sin(t * Math.PI * 0.5), b = Math.cos(t * Math.PI * 0.5);
    out[i] = src[i] * a + src[len + i] * b;
  }
  return out;
}

/** Soft clip. */
export function softClip(x: number): number {
  return Math.tanh(x);
}
