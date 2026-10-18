// Render every SFX + loop in node: checks timing, NaNs, peak/RMS, writes WAVs to $OUT (default /tmp/hksfx).
import { renderSfx, renderLoop, sfxSampleRate, SFX_VARIANTS } from '../src/audio/sfx-render';
import { SFX_NAMES, LOOP_NAMES } from '../src/audio/types';
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
const out = process.env.OUT || '/tmp/hksfx';
mkdirSync(out, { recursive: true });
const sr = 48000;
let bad = 0, total = 0;
const check = (name: string, s: Float32Array, ms: number, rate = sr) => {
  let pk = 0, e = 0, nan = 0;
  for (const x of s) { if (!Number.isFinite(x)) nan++; pk = Math.max(pk, Math.abs(x)); e += x * x; }
  const rms = Math.sqrt(e / s.length);
  const ok = nan === 0 && pk > 0.1 && rms > 0.005;
  if (!ok) bad++;
  console.log(`${ok ? 'ok ' : 'BAD'} ${name.padEnd(12)} ${(s.length / rate).toFixed(2)}s pk=${pk.toFixed(2)} rms=${rms.toFixed(3)} ${ms.toFixed(1)}ms`);
};
for (const n of SFX_NAMES) {
  const count = SFX_VARIANTS[n] ?? 3;
  for (let v = 1; v <= count; v++) {
    const t0 = performance.now();
    const s = renderSfx(n, sfxSampleRate(n, sr), v);
    const ms = performance.now() - t0; total += ms;
    if (v === 1) { check(n, s, ms, sfxSampleRate(n, sr)); writeFileSync(`${out}/${n}.wav`, wav(s, sfxSampleRate(n, sr))); }
  }
}
for (const n of LOOP_NAMES) {
  const t0 = performance.now();
  const s = renderLoop(n, sr);
  const ms = performance.now() - t0; total += ms;
  check('loop:' + n, s, ms);
  // write 3 repetitions to check seams
  const rep = new Float32Array(s.length * 3); rep.set(s, 0); rep.set(s, s.length); rep.set(s, s.length * 2);
  writeFileSync(`${out}/loop_${n}.wav`, wav(rep, sr));
}
console.log(`total render ${total.toFixed(0)}ms, bad=${bad}`);
