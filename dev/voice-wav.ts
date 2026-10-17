// Render sample lines to WAV files for listening / ASR checks.
// Usage: node dev/run-node.mjs dev/voice-wav.ts   (env OUT=dir, GROWL=0.5)
import { renderSpeech } from '../src/audio/voice/render';
import { writeFileSync, mkdirSync } from 'node:fs';

function wav(samples: Float32Array, sr: number): Buffer {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}
const out = process.env.OUT || '/tmp/hkwav';
mkdirSync(out, { recursive: true });
const growl = process.env.GROWL ? +process.env.GROWL : 0.5;
const lines = (process.env.LINES || [
  "This lamb is so raw it's still bleating!",
  'Get out of my kitchen!',
  'What are you? An idiot sandwich.',
  'Look me in the eyes.',
  'You donkey!',
  'Welcome to Hex Kitchen.',
  'My grandmother cooks faster than you.',
  'It is disgusting.',
  'Finally, a perfect plate.',
  'Come on, move it, go go go!',
  'Where is the lamb sauce?',
  'one two three four five six seven eight nine ten',
].join('|')).split('|');
const t0 = Date.now();
lines.forEach((l, i) => {
  const r = renderSpeech(l, { growl });
  writeFileSync(`${out}/line${String(i).padStart(2, '0')}.wav`, wav(r.samples, r.sampleRate));
  console.log(`line${i} ${r.duration.toFixed(2)}s  ${l}\n    ${r.phonemes}`);
});
console.log('render ms', Date.now() - t0);
