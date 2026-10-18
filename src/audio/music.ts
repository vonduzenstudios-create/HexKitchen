// Procedural game-show-horror score: a lookahead step sequencer (setInterval wakes up, notes are
// scheduled ahead on the AudioContext clock) driving small Web Audio synth voices.

import { engine } from './context';
import type { MusicMode, StingKind } from './types';

const m2f = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const LOOKAHEAD = 0.14;
const TICK_MS = 25;

// ---------------------------------------------------------------- instruments
class Inst {
  constructor(private ctx: AudioContext, private noiseBuf: AudioBuffer, private shaper: Float32Array) {}

  private gainEnv(t: number, a: number, peak: number, d: number, dest: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(0, t + a, d / 4);
    g.connect(dest);
    return g;
  }
  private osc(type: OscillatorType, f: number, t: number, stop: number, dest: AudioNode, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(stop);
    return o;
  }
  private lp(f: number, q: number, dest: AudioNode): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = q; b.connect(dest); return b;
  }
  private noise(t: number, dur: number, dest: AudioNode): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true; s.connect(dest);
    s.start(t, Math.random() * Math.max(0, this.noiseBuf.duration - dur - 0.05));
    s.stop(t + dur);
    return s;
  }

  pluck(dest: AudioNode, t: number, midi: number, dur: number, vel: number, detune = 0): void {
    const g = this.gainEnv(t, 0.004, vel * 0.55, dur, dest);
    const f = this.lp(2400, 5, g);
    f.frequency.setValueAtTime(400 + 2600 * vel, t);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    this.osc('sawtooth', m2f(midi), t, t + dur + 0.3, f, detune);
    const s = this.ctx.createGain(); s.gain.value = 0.6; s.connect(f);
    this.osc('triangle', m2f(midi - 12), t, t + dur + 0.3, s);
  }
  distBass(dest: AudioNode, t: number, midi: number, dur: number, vel: number): void {
    const g = this.gainEnv(t, 0.005, vel * 0.32, dur * 1.2, dest);
    const ws = this.ctx.createWaveShaper(); ws.curve = this.shaper as Float32Array<ArrayBuffer>; ws.oversample = '2x';
    const f = this.lp(1400, 2, g);
    f.frequency.setValueAtTime(2200, t); f.frequency.exponentialRampToValueAtTime(500, t + dur);
    ws.connect(f);
    const pre = this.ctx.createGain(); pre.gain.value = 0.8; pre.connect(ws);
    this.osc('sawtooth', m2f(midi), t, t + dur + 0.2, pre);
    this.osc('square', m2f(midi) * 0.5, t, t + dur + 0.2, pre, 5);
  }
  stab(dest: AudioNode, t: number, notes: number[], dur: number, vel: number, detune = 0, type: OscillatorType = 'square'): void {
    const g = this.gainEnv(t, 0.004, vel * 0.16 / Math.sqrt(notes.length), dur, dest);
    const f = this.lp(2600, 1, g);
    for (const n of notes) this.osc(type, m2f(n), t, t + dur + 0.25, f, (Math.random() * 2 - 1) * detune);
  }
  lead(dest: AudioNode, t: number, midi: number, dur: number, vel: number, detune = 0): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.13, t + 0.01);
    g.gain.setValueAtTime(vel * 0.13, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(dest);
    const f = this.lp(3200, 2, g);
    this.osc('square', m2f(midi), t, t + dur + 0.05, f, detune);
    this.osc('triangle', m2f(midi + 12), t, t + dur + 0.05, f, -detune);
  }
  hat(dest: AudioNode, t: number, vel: number, open = false): void {
    const g = this.gainEnv(t, 0.001, vel * 0.22, open ? 0.25 : 0.045, dest);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; hp.connect(g);
    this.noise(t, open ? 0.3 : 0.07, hp);
  }
  kick(dest: AudioNode, t: number, vel: number): void {
    const g = this.gainEnv(t, 0.002, vel * 0.9, 0.35, dest);
    const o = this.osc('sine', 150, t, t + 0.45, g);
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
  }
  snare(dest: AudioNode, t: number, vel: number): void {
    const g = this.gainEnv(t, 0.001, vel * 0.35, 0.16, dest);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7; bp.connect(g);
    this.noise(t, 0.2, bp);
    const g2 = this.gainEnv(t, 0.001, vel * 0.25, 0.07, dest);
    this.osc('triangle', 190, t, t + 0.12, g2);
  }
  tom(dest: AudioNode, t: number, midi: number, vel: number): void {
    const g = this.gainEnv(t, 0.002, vel * 0.5, 0.3, dest);
    const o = this.osc('sine', m2f(midi) * 1.5, t, t + 0.4, g);
    o.frequency.exponentialRampToValueAtTime(m2f(midi), t + 0.08);
  }
  wood(dest: AudioNode, t: number, vel: number, hi = true): void {
    const g = this.gainEnv(t, 0.001, vel * 0.25, 0.05, dest);
    this.osc('sine', hi ? 1900 : 1250, t, t + 0.08, g);
    const g2 = this.gainEnv(t, 0.001, vel * 0.08, 0.02, dest);
    this.osc('square', hi ? 3800 : 2500, t, t + 0.03, g2);
  }
  cymbal(dest: AudioNode, t: number, vel: number): void {
    const g = this.gainEnv(t, 0.002, vel * 0.18, 1.6, dest);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000; hp.connect(g);
    this.noise(t, 2, hp);
  }
  bell(dest: AudioNode, t: number, midi: number, vel: number, decay = 1.2): void {
    const f = m2f(midi);
    const parts: [number, number][] = [[1, 1], [3, 0.22], [4.2, 0.1], [2, 0.15]];
    for (const [r, a] of parts) {
      const g = this.gainEnv(t, 0.002, vel * 0.18 * a, decay / (r > 2 ? 2.5 : 1), dest);
      this.osc('sine', f * r, t, t + decay * 1.5, g);
    }
  }
  pad(dest: AudioNode, t: number, notes: number[], dur: number, vel: number, detune = 8, cutoff = 1200, att = 0.5): void {
    const g = this.ctx.createGain();
    const peak = vel * 0.12 / Math.sqrt(notes.length);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.setValueAtTime(peak, t + Math.max(att, dur - 0.1)); g.gain.setTargetAtTime(0, t + Math.max(att, dur - 0.1), 0.35);
    g.connect(dest);
    const f = this.lp(cutoff, 0.7, g);
    for (const n of notes) {
      this.osc('sawtooth', m2f(n), t, t + dur + 2, f, detune);
      this.osc('sawtooth', m2f(n), t, t + dur + 2, f, -detune);
    }
  }
  choir(dest: AudioNode, t: number, notes: number[], dur: number, vel: number): void {
    const g = this.ctx.createGain();
    const peak = vel * 0.5 / Math.sqrt(notes.length);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.6);
    g.gain.setValueAtTime(peak, t + dur - 0.2); g.gain.setTargetAtTime(0, t + dur - 0.2, 0.4);
    g.connect(dest);
    const sum = this.ctx.createGain(); sum.gain.value = 1;
    const formants: [number, number, number][] = [[650, 7, 1], [1080, 9, 0.5], [2650, 12, 0.25]];
    for (const [fr, q, a] of formants) {
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q;
      const ga = this.ctx.createGain(); ga.gain.value = a;
      sum.connect(bp).connect(ga).connect(g);
    }
    for (const n of notes) for (const d of [-14, 0, 13]) {
      const o = this.osc('sawtooth', m2f(n), t, t + dur + 2, sum, d);
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 4.5 + Math.random();
      const lg = this.ctx.createGain(); lg.gain.value = 6; lfo.connect(lg).connect(o.detune);
      lfo.start(t); lfo.stop(t + dur + 2);
    }
  }
  brass(dest: AudioNode, t: number, midi: number, dur: number, vel: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.16, t + 0.03);
    g.gain.setValueAtTime(vel * 0.14, t + Math.max(0.05, dur - 0.06)); g.gain.linearRampToValueAtTime(0, t + dur + 0.08);
    g.connect(dest);
    const f = this.lp(600, 1.5, g);
    f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(3500, t + 0.05); f.frequency.setTargetAtTime(1900, t + 0.06, 0.1);
    for (const d of [-7, 7]) {
      const o = this.osc('sawtooth', m2f(midi), t, t + dur + 0.2, f, d);
      if (dur > 0.4) {
        const lfo = this.ctx.createOscillator(); lfo.frequency.value = 5.5;
        const lg = this.ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(14, t + dur);
        lfo.connect(lg).connect(o.detune); lfo.start(t); lfo.stop(t + dur + 0.2);
      }
    }
  }
  trombone(dest: AudioNode, t: number, m0: number, m1: number, dur: number, vel: number, vib = false): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.3, t + 0.06);
    g.gain.setValueAtTime(vel * 0.3, t + dur * 0.75); g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(dest);
    const lp = this.lp(1100, 1, g);
    const wah = this.ctx.createBiquadFilter(); wah.type = 'bandpass'; wah.Q.value = 2.5; wah.connect(lp);
    wah.frequency.setValueAtTime(400, t); wah.frequency.linearRampToValueAtTime(1300, t + dur * 0.35); wah.frequency.linearRampToValueAtTime(500, t + dur);
    const o = this.osc('sawtooth', m2f(m0), t, t + dur + 0.1, wah);
    o.frequency.setValueAtTime(m2f(m0), t); o.frequency.linearRampToValueAtTime(m2f(m1), t + dur);
    if (vib) {
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 6;
      const lg = this.ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(45, t + dur * 0.6);
      lfo.connect(lg).connect(o.detune); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
  }
  drone(dest: AudioNode, t: number, notes: number[], dur: number, vel: number, cutoff = 500): void {
    const g = this.ctx.createGain();
    const peak = vel * 0.25 / Math.sqrt(notes.length);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + Math.min(2, dur / 3));
    g.gain.setValueAtTime(peak, t + dur - Math.min(2, dur / 3)); g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(dest);
    const f = this.lp(cutoff, 1, g);
    for (const n of notes) { this.osc('triangle', m2f(n), t, t + dur + 0.1, f, 3); this.osc('sine', m2f(n), t, t + dur + 0.1, f, -4); }
  }
  heart(dest: AudioNode, t: number, vel: number): void {
    for (const [dt, f, a] of [[0, 58, 1], [0.24, 66, 0.65]] as const) {
      const g = this.gainEnv(t + dt, 0.012, vel * 0.7 * a, 0.22, dest);
      const o = this.osc('sine', f, t + dt, t + dt + 0.35, g);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + dt + 0.2);
    }
  }
  boom(dest: AudioNode, t: number, vel: number): void {
    const g = this.gainEnv(t, 0.003, vel * 0.9, 1.2, dest);
    const o = this.osc('sine', 90, t, t + 1.4, g);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.8);
    const gn = this.gainEnv(t, 0.002, vel * 0.5, 0.4, dest);
    this.noise(t, 0.6, this.lp(900, 0.7, gn));
  }
  swell(dest: AudioNode, t: number, notes: number[], dur: number, vel: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel * 0.2, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(dest);
    const f = this.lp(200, 2, g);
    f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(2500, t + dur * 0.75);
    for (const n of notes) { this.osc('sawtooth', m2f(n), t, t + dur + 0.1, f, 9); this.osc('sawtooth', m2f(n), t, t + dur + 0.1, f, -11); }
  }
}

// ---------------------------------------------------------------- patterns
interface StepCtx { t: number; step: number; bar: number; dur: number; I: number; inst: Inst; out: AudioNode }
interface ModeDef {
  bpm(I: number): number;
  step?(c: StepCtx): void;
  intro?(inst: Inst, out: AudioNode, t: number): number; // returns duration
  fadeIn: number;
  gain: number;
}

const ROUND_ROOTS = [50, 46, 43, 45];                  // D3 Bb2 G2 A2
const ROUND_CHORDS = [[62, 65, 69], [62, 65, 70], [62, 67, 70], [61, 64, 69]];
const ROUND_THIRD = [53, 50, 46, 49];
// 4 bars x 16 steps sneaky staccato theme (0 = rest)
const ROUND_MEL = [
  69, 0, 0, 69, 70, 0, 69, 0, 65, 0, 0, 0, 62, 0, 0, 0,
  70, 0, 0, 70, 72, 0, 70, 0, 65, 0, 0, 0, 62, 0, 0, 0,
  67, 0, 0, 67, 70, 0, 67, 0, 74, 0, 72, 0, 70, 0, 69, 0,
  73, 0, 0, 73, 76, 0, 73, 0, 69, 0, 67, 0, 64, 0, 61, 0,
];
const MENU_ROOTS = [50, 43, 46, 45];
const MENU_CHORDS = [[62, 65, 69], [62, 67, 70], [62, 65, 70], [61, 64, 69]];
const MENU_MEL = [
  69, 0, 74, 0, 77, 0, 76, 0, 74, 0, 0, 0, 69, 0, 0, 0,
  70, 0, 74, 0, 79, 0, 77, 0, 76, 0, 0, 0, 74, 0, 0, 0,
  77, 0, 76, 0, 74, 0, 77, 0, 74, 0, 70, 0, 0, 0, 0, 0,
  69, 0, 73, 0, 76, 0, 79, 0, 77, 0, 76, 0, 73, 0, 0, 0,
];
const BOSS_ROOTS = [38, 39, 38, 37];
const BOSS_CHORDS = [[62, 65, 69], [63, 67, 70], [62, 65, 69], [61, 64, 67]];
const VIC_ROOTS = [50, 43, 45, 50];
const VIC_CHORDS = [[66, 69, 74], [67, 71, 74], [64, 69, 73], [66, 69, 74]];

const MODES: Record<Exclude<MusicMode, 'silent'>, ModeDef> = {
  menu: {
    bpm: () => 76, fadeIn: 1.5, gain: 1.4,
    step({ t, step, bar, dur, inst, out }) {
      const b = bar % 4, s = step;
      if (s === 0) { inst.pluck(out, t, MENU_ROOTS[b] - 12, dur * 6, 0.7); inst.pad(out, t, MENU_CHORDS[b], dur * 16, 0.5, 9, 700, 1.2); }
      if (s === 8) inst.pluck(out, t, MENU_ROOTS[b] - 5, dur * 6, 0.5);
      const m = MENU_MEL[b * 16 + s];
      if (m) inst.bell(out, t, m, 0.55, 1.4);
      if (s % 4 === 0) inst.wood(out, t, s === 0 ? 0.35 : 0.2, s % 8 === 0);
    },
  },
  round: {
    bpm: (I) => 110 + 40 * I, fadeIn: 0.8, gain: 1,
    step({ t, step: s, bar, dur, I, inst, out }) {
      const b = bar % 4, root = ROUND_ROOTS[b], next = ROUND_ROOTS[(b + 1) % 4];
      const det = Math.max(0, I - 0.6) * 70;
      // pizzicato bass
      const bassPat: Record<number, [number, number]> = { 0: [root, 1], 3: [root, 0.55], 6: [root + 7, 0.7], 8: [root + 12, 0.8], 10: [root, 0.6], 11: [ROUND_THIRD[b], 0.5], 12: [root + 7, 0.7], 14: [next - 1, 0.6] };
      const bp = bassPat[s];
      if (bp) inst.pluck(out, t, bp[0], dur * 1.6, bp[1], det * 0.3);
      // staccato chord stabs
      if (s === 4 || s === 12 || (I > 0.45 && (s === 7 || s === 15))) inst.stab(out, t, ROUND_CHORDS[b], dur * 0.8, s === 4 || s === 12 ? 0.9 : 0.6, det);
      // theme
      const m = ROUND_MEL[b * 16 + s];
      if (m && (bar % 8 < 4 || I > 0.3)) {
        inst.lead(out, t, m, dur * 0.9, 0.75 + 0.25 * I, det * 0.5);
        if (I > 0.6) inst.lead(out, t, m + 12, dur * 0.9, 0.35 * (I - 0.4), det);
      }
      // drums
      if (s % 2 === 0) inst.hat(out, t, s % 4 === 2 ? 0.5 : 0.3);
      else if (I > 0.35) inst.hat(out, t, 0.18 + 0.15 * I);
      if (s === 0 || s === 8 || (I > 0.55 && (s === 10 || s === 6))) inst.kick(out, t, 0.75);
      if ((s === 4 || s === 12) && I > 0.25) inst.snare(out, t, 0.5 + 0.3 * I);
      else if ((s === 4 || s === 12)) inst.wood(out, t, 0.3, false);
      if (I > 0.7 && s % 4 === 0) inst.wood(out, t, 0.25 + 0.3 * (I - 0.7), true); // ticking clock
      if (I > 0.85 && s === 15 && b === 3) inst.cymbal(out, t, 0.5);
      // dissonant pad creeping in with Wrath
      if (s === 0 && I > 0.6) {
        const a = (I - 0.6) / 0.4;
        inst.pad(out, t, [root + 12, root + 13, root + 18], dur * 16, 0.4 + 0.5 * a, 10 + 25 * a, 900 + 1500 * a, 0.8);
      }
    },
  },
  boss: {
    bpm: (I) => 140 + 30 * I, fadeIn: 0.6, gain: 1,
    step({ t, step: s, bar, dur, I, inst, out }) {
      const b = bar % 4, root = BOSS_ROOTS[b];
      if (s % 2 === 0) inst.distBass(out, t, root + (s === 6 || s === 14 ? 12 : 0), dur * 1.7, s % 4 === 0 ? 1 : 0.7);
      if (s % 4 === 0 || (I > 0.5 && (s === 14 || s === 15))) inst.kick(out, t, 0.9);
      if (s === 4 || s === 12) inst.snare(out, t, 0.8);
      inst.hat(out, t, s % 2 === 0 ? 0.35 : 0.2);
      if (s === 0) {
        inst.choir(out, t, BOSS_CHORDS[b], dur * 16, 0.6);
        inst.brass(out, t, root + 12, dur * 3, 0.9); inst.brass(out, t, root + 19, dur * 3, 0.7);
        if (b === 0) inst.cymbal(out, t, 0.6);
      }
      if (b === 3 && s >= 12) inst.tom(out, t, [52, 48, 45, 41][s - 12], 0.8);
      if (I > 0.6 && s === 8) inst.stab(out, t, [root + 36, root + 37, root + 42], dur * 6, 0.5 + 0.5 * I, 30 * I, 'sawtooth');
    },
  },
  tasting: {
    bpm: (I) => 60 + 30 * I, fadeIn: 2, gain: 0.9,
    step({ t, step: s, bar, dur, I, inst, out }) {
      if (s === 0 && bar % 2 === 0) inst.drone(out, t, [38, 39, 45], dur * 16 * 2 + 1.5, 0.55, 420 + 400 * I);
      if (s % 4 === 0) inst.heart(out, t, 0.6 + 0.4 * I);
      if (s === 8 && Math.random() < 0.3) inst.bell(out, t, Math.random() < 0.5 ? 93 : 94, 0.18, 3);
      if (I > 0.6 && s === 0) inst.pad(out, t, [74, 75], dur * 16, 0.25 * I, 20, 2500, 2);
    },
  },
  victory: {
    bpm: () => 96, fadeIn: 0.02, gain: 1,
    intro(inst, out, t) {
      const n: [number, number, number][] = [[0, 74, 0.13], [0.15, 78, 0.13], [0.3, 81, 0.13], [0.45, 86, 0.55], [1.05, 83, 0.18], [1.25, 85, 0.18], [1.45, 86, 1.3]];
      for (const [dt, m, d] of n) { inst.brass(out, t + dt, m, d, 1); inst.brass(out, t + dt, m - 12, d, 0.6); }
      for (let i = 0; i < 8; i++) inst.snare(out, t + 0.9 + i * 0.065, 0.25 + i * 0.06);
      inst.cymbal(out, t + 1.45, 0.9); inst.kick(out, t + 1.45, 1); inst.kick(out, t + 0.45, 0.8);
      inst.pad(out, t + 1.45, [62, 66, 69, 74], 1.6, 0.8, 8, 3000, 0.05);
      inst.pluck(out, t + 1.45, 38, 1.5, 1);
      return 3.4;
    },
    step({ t, step: s, bar, dur, inst, out }) {
      const b = bar % 4;
      if (s === 0) { inst.pad(out, t, VIC_CHORDS[b], dur * 16, 0.35, 7, 1500, 0.8); inst.pluck(out, t, VIC_ROOTS[b] - 12, dur * 4, 0.5); }
      if (s === 8) inst.pluck(out, t, VIC_ROOTS[b] - 5, dur * 4, 0.4);
      if (s % 4 === 2) inst.hat(out, t, 0.2);
      if (s % 2 === 0 && s < 8) inst.bell(out, t, VIC_CHORDS[b][(s / 2) % 3] + 12, 0.22, 0.8);
    },
  },
  gameover: {
    bpm: () => 50, fadeIn: 0.02, gain: 1,
    intro(inst, out, t) {
      inst.trombone(out, t, 58, 58, 0.45, 1);
      inst.trombone(out, t + 0.5, 57, 57, 0.45, 1);
      inst.trombone(out, t + 1.0, 56, 56, 0.45, 1);
      inst.trombone(out, t + 1.5, 55, 54.3, 1.6, 1, true);
      inst.drone(out, t + 2.6, [26, 38, 45], 6, 0.6, 300);
      return 3.2;
    },
    step({ t, step: s, bar, dur, inst, out }) {
      if (s === 0 && bar % 2 === 0) inst.drone(out, t, [26, 38, 45], dur * 32 + 1, 0.5, 300);
      if (s === 0 && bar % 2 === 1) inst.bell(out, t, 50, 0.3, 3);
    },
  },
};

// ---------------------------------------------------------------- sequencer
class MusicPlayer {
  mode: MusicMode = 'silent';
  private target = 0;
  private I = 0;
  private inst: Inst | null = null;
  private modeGain: GainNode | null = null;
  private def: ModeDef | null = null;
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  private ensure(): boolean {
    const ctx = engine.ctx;
    if (!ctx || !engine.ready) return false;
    if (!this.inst) {
      const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3.5); }
      this.inst = new Inst(ctx, nb, curve);
    }
    if (!this.timer) this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.warn('[audio] music', e); } }, TICK_MS);
    return true;
  }

  /** Called once audio becomes ready. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const m = this.mode;
    this.mode = 'silent';
    if (m !== 'silent') this.setMode(m);
  }

  setMode(mode: MusicMode): void {
    if (!(mode in MODES) && mode !== 'silent') return;
    if (!this.started || !this.ensure()) { this.mode = mode; return; }
    if (mode === this.mode) return;
    const ctx = engine.ctx!;
    const now = ctx.currentTime;
    if (this.modeGain) {
      const old = this.modeGain;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.setTargetAtTime(0, now, mode === 'victory' || mode === 'gameover' ? 0.12 : 0.4);
      setTimeout(() => { try { old.disconnect(); } catch { /* ignore */ } }, 4000);
    }
    this.mode = mode;
    this.modeGain = null; this.def = null;
    if (mode === 'silent') return;
    const def = MODES[mode];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(def.gain, now + def.fadeIn);
    g.connect(engine.musicBus);
    this.modeGain = g; this.def = def;
    this.step = 0; this.bar = 0;
    let t = now + 0.06;
    if (def.intro) t += def.intro(this.inst!, g, t);
    this.nextTime = t;
  }

  setIntensity(v: number): void {
    if (!Number.isFinite(v)) return;
    this.target = Math.max(0, Math.min(1, v));
  }

  private tick(): void {
    const ctx = engine.ctx;
    if (!ctx || !this.def || !this.modeGain || !this.inst) return;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.05; // fell behind (tab hidden): resync
    while (this.nextTime < now + LOOKAHEAD) {
      this.I += (this.target - this.I) * 0.08;
      const dur = 60 / this.def.bpm(this.I) / 4;
      if (this.def.step) this.def.step({ t: this.nextTime, step: this.step, bar: this.bar, dur, I: this.I, inst: this.inst, out: this.modeGain });
      this.nextTime += dur;
      if (++this.step >= 16) { this.step = 0; this.bar++; }
    }
  }

  sting(kind: StingKind): void {
    if (!this.started || !this.ensure()) return;
    const ctx = engine.ctx!, inst = this.inst!, out = engine.stingBus, t = ctx.currentTime + 0.02;
    switch (kind) {
      case 'dread':
        inst.swell(out, t, [38, 39, 44, 45], 2.4, 1);
        inst.boom(out, t + 1.7, 0.8);
        break;
      case 'success':
        [74, 78, 81, 86].forEach((m, i) => { inst.bell(out, t + i * 0.07, m, 0.8, 1.2); inst.pluck(out, t + i * 0.07, m - 12, 0.2, 0.6); });
        inst.pad(out, t + 0.28, [74, 78, 81], 0.9, 0.7, 6, 4000, 0.02);
        break;
      case 'fail':
        inst.brass(out, t, 50, 0.22, 1); inst.brass(out, t, 53, 0.22, 0.8);
        inst.brass(out, t + 0.3, 49, 0.7, 1); inst.brass(out, t + 0.3, 52, 0.7, 0.8);
        inst.kick(out, t + 0.3, 0.9);
        break;
      case 'jumpscare':
        inst.stab(out, t, [84, 85, 86, 87, 88, 89, 90], 1.0, 4, 35, 'sawtooth');
        inst.stab(out, t, [60, 61, 66], 1.2, 3, 20, 'sawtooth');
        inst.boom(out, t, 1);
        inst.cymbal(out, t, 1);
        break;
    }
  }
}

export const musicPlayer = new MusicPlayer();
