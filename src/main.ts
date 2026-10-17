import { audio, music } from './audio';
import { Input } from './engine/input';
import { PsxRenderer } from './engine/renderer';
import { Game } from './game/game';
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
  const title = hud.titleScreen();
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
  (window as unknown as { __hex: unknown }).__hex = { game, input, start: () => title.querySelector<HTMLButtonElement>('#start')?.click() };

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
