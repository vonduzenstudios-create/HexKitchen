import { audio, music } from './audio';
import { Input } from './engine/input';
import { PsxRenderer } from './engine/renderer';
import * as THREE from 'three';
import { Game } from './game/game';
import * as assembly from './game/assembly';
import { currentEpisode, EPISODES } from './game/episodes';
import { Hud } from './ui/hud';

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const hud = new Hud(document.getElementById('hud')!);
  const renderer = new PsxRenderer(app);
  const input = new Input(renderer.canvas);
  const game = new Game(renderer, input, hud);
  hud.showScreen('<h1 class="logo display" style="font-size:48px">Preheating...</h1>');
  await game.init();

  let started = false;
  const ep = currentEpisode();
  const title = hud.titleScreen(
    Object.values(EPISODES).map((e) => ({ id: e.id, title: e.title, tagline: e.tagline })),
    ep.id,
  );
  title.querySelectorAll<HTMLButtonElement>('.ep-tab').forEach((b) =>
    b.addEventListener('click', () => {
      if (Number(b.dataset.ep) === ep.id) return;
      const q = new URLSearchParams(location.search);
      q.set('ep', b.dataset.ep!);
      location.search = q.toString();
    }),
  );
  title.querySelector('#start')?.addEventListener('click', async () => {
    await audio.init();
    music.setMode('round');
    input.requestLock();
    if (!started) {
      started = true;
      game.begin();
    }
  });
  input.onLockChange = (locked) => game.onPauseChange(!locked);

  // Debug hook for automated smoke tests.
  (window as unknown as { __hex: unknown }).__hex = { game, input, THREE, assembly, start: () => title.querySelector<HTMLButtonElement>('#start')?.click() };

  let last = performance.now();
  const loop = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    game.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;color:#f66;white-space:pre-wrap">${String(err?.stack ?? err)}</pre>`);
});
