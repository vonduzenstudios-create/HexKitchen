// Pure text -> waveform pipeline (no DOM): normalise, G2P, prosody, formant synthesis, monster FX.

import { textToPhrases } from './g2p';
import { buildUtterance, type Utterance } from './prosody';
import { synthesize, hashString } from './synth';
import { monsterFx } from './fx';
import { peakNormalize } from '../dsp';

export interface SpeechOpts {
  pitch?: number;   // multiplier of the base pitch (1 = Gorgon, ~92 Hz). Values > 20 are taken as Hz.
  rate?: number;    // speaking-rate multiplier
  growl?: number;   // 0..1 monster amount (default 0.5)
  british?: boolean; // non-rhotic accent (default true)
  sampleRate?: number;
}

export const GORGON_BASE_HZ = 92;
export const SPEECH_SR = 22050;

export function basePitchHz(pitch?: number): number {
  if (pitch === undefined || !Number.isFinite(pitch) || pitch <= 0) return GORGON_BASE_HZ;
  return pitch > 20 ? pitch : GORGON_BASE_HZ * pitch;
}

export function planSpeech(text: string, o: SpeechOpts = {}): Utterance {
  const growl = o.growl ?? 0.5;
  return buildUtterance(textToPhrases(text), {
    basePitch: basePitchHz(o.pitch),
    rate: o.rate ?? 1,
    british: o.british ?? true,
    hiss: Math.max(0, growl - 0.2),
    range: 1.15 + growl * 0.2,
  });
}

/** Seconds of speech for `text` (exact for the same options, as the timing plan is deterministic). */
export function speechDuration(text: string, o: SpeechOpts = {}): number {
  try { return planSpeech(text, o).duration; } catch { return Math.max(0.5, String(text).length * 0.07); }
}

export interface SpeechRender { samples: Float32Array; sampleRate: number; duration: number; phonemes: string }

export function renderSpeech(text: string, o: SpeechOpts = {}): SpeechRender {
  const sr = o.sampleRate ?? SPEECH_SR;
  const growl = Math.max(0, Math.min(1, o.growl ?? 0.5));
  const u = planSpeech(text, o);
  const seed = hashString(text);
  const main = synthesize(u, { sampleRate: sr, subharmonic: growl * 0.45, seed, tilt: 0.3 });
  let samples = main.samples;
  if (growl > 0.02) {
    const sub = synthesize(u, { sampleRate: sr, f0Mul: 0.5, formantMul: 0.86, voicedOnly: true, seed: seed + 1, tilt: 0.6 });
    samples = monsterFx(main.samples, { growl, sampleRate: sr, sub: sub.samples, sib: main.sib, seed });
  }
  // short fades so the buffer never clicks
  const fade = Math.min(samples.length >> 1, Math.round(sr * 0.008));
  for (let i = 0; i < fade; i++) { const k = i / fade; samples[i] *= k; samples[samples.length - 1 - i] *= k; }
  peakNormalize(samples, 0.89);
  return { samples, sampleRate: sr, duration: samples.length / sr, phonemes: u.phonemes };
}
