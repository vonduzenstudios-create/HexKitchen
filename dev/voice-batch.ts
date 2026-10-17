// Render each line of $REFS to $OUT/NN.wav (for ASR checks). Env: GROWL, PITCH, RATE.
import { renderSpeech } from '../src/audio/voice/render';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
function wav(samples: Float32Array, sr: number): Buffer {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}
const out = process.env.OUT || '/tmp/hkb';
mkdirSync(out, { recursive: true });
const lines = readFileSync(process.env.REFS!, 'utf8').split('\n').filter(Boolean);
const opts = { british: process.env.BRIT !== '0', growl: +(process.env.GROWL ?? 0), pitch: process.env.PITCH ? +process.env.PITCH : undefined, rate: process.env.RATE ? +process.env.RATE : undefined };
lines.forEach((l, i) => {
  const r = renderSpeech(l, opts);
  writeFileSync(`${out}/${String(i).padStart(2, '0')}.wav`, wav(r.samples, r.sampleRate));
});
// reference phonemes (CMU 39-phone set) for phone-error-rate scoring
import { planSpeech } from '../src/audio/voice/render';
const phRefs = lines.map((l) => planSpeech(l, opts).phonemes.replace(/\/+/g, '').replace(/[0-9]/g, '').replace(/\bAX\b/g, 'AH').trim().split(/\s+/).join(' '));
writeFileSync(`${out}/phones.txt`, phRefs.join('\n') + '\n');
