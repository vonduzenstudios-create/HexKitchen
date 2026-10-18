// Dev page for the audio module (dev/audio.html). Also exposes window.__audioSelfTest for Playwright.
import { audio, music, voice, SFX_NAMES, LOOP_NAMES, type LoopHandle, type MusicMode } from '../src/audio';
import { renderSpeech } from '../src/audio/voice/render';
import { phonemeString } from '../src/audio/voice/g2p';
import { engine } from '../src/audio/context';

const $ = (id: string) => document.getElementById(id)!;
const log = (s: string) => { $('log').textContent = s + '\n' + $('log').textContent; };
const btn = (parent: string, label: string, fn: (b: HTMLButtonElement) => void) => {
  const b = document.createElement('button'); b.textContent = label; b.onclick = () => fn(b); $(parent).appendChild(b); return b;
};
const rndPos = () => ({ x: (Math.random() - 0.5) * 12, y: 1.5, z: (Math.random() - 0.5) * 12 });

$('init').onclick = async () => {
  await audio.init();
  audio.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  log('audio ready: ' + audio.ready + ' sr=' + audio.context?.sampleRate);
};
($('master') as HTMLInputElement).oninput = (e) => audio.setMasterVolume(+(e.target as HTMLInputElement).value);
for (const n of SFX_NAMES) btn('sfx', n, () => audio.play(n, ($('spatial') as HTMLInputElement).checked ? { pos: rndPos() } : {}));
const loops = new Map<string, LoopHandle>();
for (const n of LOOP_NAMES) btn('loops', n, (b) => {
  const h = loops.get(n);
  if (h) { h.stop(); loops.delete(n); b.classList.remove('on'); }
  else { loops.set(n, audio.loop(n, ($('spatial') as HTMLInputElement).checked ? { pos: rndPos() } : {})); b.classList.add('on'); }
});
for (const m of ['menu', 'round', 'boss', 'tasting', 'victory', 'gameover', 'silent'] as MusicMode[]) btn('music', m, () => music.setMode(m));
($('intensity') as HTMLInputElement).oninput = (e) => music.setIntensity(+(e.target as HTMLInputElement).value);
for (const k of ['dread', 'success', 'fail', 'jumpscare'] as const) btn('stings', 'sting: ' + k, () => music.sting(k));

const LINES = [
  "This lamb is so raw it's still bleating!",
  'Get out of my KITCHEN!',
  'What are you? An idiot sandwich.',
  'Look me in the eyes. LOOK AT ME!',
  'You DONKEY! Remake it NOW!',
  'Welcome to HEX Kitchen. Three rounds. One survivor.',
  "Faster! My grandmother cooks faster, and she's a STATUE!",
  'Finally! Somebody in this kitchen can actually cook!',
  "You've seasoned this with your TEARS!",
  'Round two. Dinner rush! Steak and fries, AND spaghetti.',
];
const sayOpts = () => ({ growl: +($('growl') as HTMLInputElement).value, pitch: +($('pitch') as HTMLInputElement).value, rate: +($('rate') as HTMLInputElement).value });
for (const l of LINES) btn('lines', l.length > 34 ? l.slice(0, 32) + '…' : l, () => { ($('text') as HTMLTextAreaElement).value = l; speak(l); });
async function speak(t: string) {
  log(`say (${voice.estimateDuration(t, sayOpts()).toFixed(2)}s): ${phonemeString(t)}`);
  const t0 = performance.now();
  await voice.say(t, sayOpts());
  log(`done after ${((performance.now() - t0) / 1000).toFixed(2)}s`);
}
$('say').onclick = () => speak(($('text') as HTMLTextAreaElement).value);
$('stop').onclick = () => voice.stop();

// ---- automated self-test (used by Playwright)
(window as unknown as { __audioSelfTest: () => Promise<Record<string, unknown>> }).__audioSelfTest = async () => {
  const res: Record<string, unknown> = {};
  // safe before init
  audio.play('chop'); audio.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  const early = audio.loop('ambience', { volume: 0.5 });
  music.setMode('menu'); music.setIntensity(0.3); music.sting('dread'); voice.stop();
  res.speakingBeforeInit = voice.isSpeaking();
  res.estimate = voice.estimateDuration(LINES[0]);
  await audio.init(); await audio.init();
  res.ready = audio.ready;
  res.state = audio.context?.state;
  audio.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  const t0 = performance.now();
  for (const n of SFX_NAMES) { audio.play(n, { volume: 0.5, pitch: 0.9 + Math.random() * 0.2 }); audio.play(n, { pos: rndPos(), volume: 0.3 }); }
  res.sfxMs = performance.now() - t0;
  // spam test
  for (let i = 0; i < 200; i++) audio.play('clang', { volume: Math.random(), pitch: 0.8 + Math.random() * 0.4, pos: rndPos() });
  const hs = LOOP_NAMES.map((n) => audio.loop(n, { pos: rndPos(), volume: 0.4 }));
  hs.forEach((h) => { h.setVolume(0.2); h.setPitch(1.2); h.setPosition(rndPos()); });
  // measure output level per music mode with an analyser on the music bus
  const an = engine.ctx!.createAnalyser(); an.fftSize = 2048; engine.musicBus.connect(an);
  const level = () => { const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let e = 0; for (const x of d) e += x * x; return Math.sqrt(e / d.length); };
  const musicLevels: Record<string, number> = {};
  for (const m of ['round', 'boss', 'tasting', 'victory', 'gameover', 'menu'] as MusicMode[]) {
    music.setMode(m); music.setIntensity(m === 'round' ? 0.9 : 0.4);
    let mx = 0; for (let k = 0; k < 12; k++) { await new Promise((r) => setTimeout(r, 120)); mx = Math.max(mx, level()); }
    musicLevels[m] = +mx.toFixed(4);
  }
  res.musicLevels = musicLevels;
  for (const k of ['dread', 'success', 'fail', 'jumpscare'] as const) music.sting(k);
  // voice: render + playback promise + interruption
  const v0 = performance.now();
  const p1 = voice.say(LINES[1]);
  res.speakingAfterSay = voice.isSpeaking();
  const p2 = voice.say(LINES[4], { pos: rndPos(), growl: 0.9 });
  await p1;
  res.firstResolvedByInterrupt = true;
  voice.stop();
  await p2;
  res.voiceMs = performance.now() - v0;
  // full playback of a short line resolves in plausible time
  const st = performance.now();
  await voice.say('Yes chef!');
  res.shortLineSeconds = (performance.now() - st) / 1000;
  res.shortLineEstimate = voice.estimateDuration('Yes chef!');
  const st2 = performance.now();
  await voice.say('Yes chef!');
  res.shortLineCachedSeconds = (performance.now() - st2) / 1000;
  // offline render of a voice line: non-silent, plausible duration
  const r = renderSpeech(LINES[0], { growl: 0.5 });
  const off = new OfflineAudioContext(1, Math.ceil(r.duration * 44100) + 4410, 44100);
  const b = off.createBuffer(1, r.samples.length, r.sampleRate); b.getChannelData(0).set(r.samples);
  const s = off.createBufferSource(); s.buffer = b; s.connect(off.destination); s.start();
  const rendered = await off.startRendering();
  const d = rendered.getChannelData(0); let e = 0; for (const x of d) e += x * x;
  res.offlineRms = Math.sqrt(e / d.length);
  res.offlineDuration = r.duration;
  hs.forEach((h) => h.stop()); early.stop();
  music.setMode('silent');
  res.ok = true;
  return res;
};
