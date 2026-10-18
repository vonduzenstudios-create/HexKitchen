// Print per-segment RMS (dB) for a phrase: node dev/run-node.mjs dev/voice-diag.ts "text"
import { planSpeech } from '../src/audio/voice/render';
import { synthesize } from '../src/audio/voice/synth';
const text = process.env.TEXT || 'come on, the man is in the kitchen';
const u = planSpeech(text, { british: false, growl: 0 });
const sr = 22050;
const s = synthesize(u, { sampleRate: sr, seed: 1 }).samples;
let pk = 0; for (const x of s) pk = Math.max(pk, Math.abs(x));
for (const g of u.segs) {
  const a = Math.floor(g.start * sr), b = Math.floor((g.start + g.dur) * sr);
  let e = 0; for (let i = a; i < b; i++) e += s[i] * s[i];
  const db = 10 * Math.log10(e / Math.max(1, b - a) / (pk * pk) + 1e-12);
  console.log(`${g.ph.padEnd(3)} ${g.part.padEnd(4)} ${(g.dur * 1000).toFixed(0).padStart(4)}ms ${db.toFixed(1)} dB`);
}
