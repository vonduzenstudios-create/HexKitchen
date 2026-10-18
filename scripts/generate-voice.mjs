// Renders every Gorgon line to an MP3 with the ElevenLabs text-to-speech API and writes
// public/voice/manifest.json mapping each line's text to its file. Lines that already have a
// file are skipped, so re-running only renders new or edited lines.
//
//   ELEVENLABS_API_KEY=... node --experimental-strip-types scripts/generate-voice.mjs
//   node --experimental-strip-types scripts/generate-voice.mjs --dry-run   # list lines only
//
// The voice comes from voice.config.json. Use a designed or stock voice, never a clone of a real person.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LINES } from '../src/game/lines.ts';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'public', 'voice');
const config = JSON.parse(fs.readFileSync(path.join(root, 'voice.config.json'), 'utf8'));
const dryRun = process.argv.includes('--dry-run');
const key = process.env.ELEVENLABS_API_KEY;

const texts = [...new Set(Object.values(LINES).flat())];
const fileFor = (t) => `${createHash('sha1').update(`${config.voiceId}|${config.modelId}|${t}`).digest('hex').slice(0, 12)}.mp3`;

if (dryRun) {
  for (const t of texts) console.log(`${fileFor(t)}  ${t}`);
  console.log(`${texts.length} lines`);
  process.exit(0);
}
if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
if (!config.voiceId || config.voiceId === 'REPLACE_ME') throw new Error('Set voiceId in voice.config.json');

fs.mkdirSync(outDir, { recursive: true });
const manifest = { voiceId: config.voiceId, lines: {} };
let made = 0;
for (const text of texts) {
  const file = fileFor(text);
  manifest.lines[text] = file;
  const dest = path.join(outDir, file);
  if (fs.existsSync(dest)) continue;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: config.modelId, voice_settings: config.voiceSettings }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} for "${text}": ${await res.text()}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  made++;
  console.log(`rendered ${file}  ${text}`);
}
// Drop files for lines that no longer exist.
const keep = new Set(Object.values(manifest.lines));
for (const f of fs.readdirSync(outDir)) if (f.endsWith('.mp3') && !keep.has(f)) fs.unlinkSync(path.join(outDir, f));
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${made} new, ${texts.length} total`);
