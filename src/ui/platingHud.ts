import { TOOL_LABEL, type PlatingResult, type PlatingTool, type PlatingView } from '../game/plating';

/**
 * Overlay for Plating Mode: title and timer up top, a checklist of what Gorgon wants on the left,
 * the Presentation Meter on the right and the tool strip with controls along the bottom.
 * Styled to match the main HUD (dark panels, gold trim, Cinzel headings).
 */

const CSS = `
#plating { position: fixed; inset: 0; pointer-events: none; z-index: 30; font-family: Inter, system-ui, sans-serif; color: #f3e6cf; display: none; }
#plating.on { display: block; }
#plating .pl-panel { background: linear-gradient(180deg, rgba(28,14,10,.92), rgba(14,7,6,.92)); border: 2px solid #b8862f; border-radius: 10px; box-shadow: 0 0 0 1px #3a1a0c inset, 0 6px 24px rgba(0,0,0,.6), 0 0 18px rgba(255,110,20,.18); }
#plating .pl-title { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); text-align: center; padding: 8px 34px 10px; }
#plating .pl-title h1 { margin: 0; font: 700 34px/1 Cinzel, serif; letter-spacing: .18em; color: #ffcf6a; text-shadow: 0 0 12px rgba(255,140,30,.5); }
#plating .pl-dish { font-size: 13px; letter-spacing: .1em; text-transform: uppercase; opacity: .8; margin-top: 4px; }
#plating .pl-time { font: 700 28px/1 Cinzel, serif; margin-top: 6px; }
#plating .pl-time.low { color: #ff5a3a; animation: pl-pulse .5s infinite alternate; }
#plating .pl-bar { height: 5px; background: #2a130b; border-radius: 3px; margin-top: 6px; overflow: hidden; }
#plating .pl-bar i { display: block; height: 100%; background: linear-gradient(90deg, #ff5a1a, #ffcf6a); }
#plating .pl-left { position: absolute; left: 20px; top: 20px; width: 240px; padding: 12px 14px; }
body.plating-on #hud .hud-left, body.plating-on #hud .hud-right, body.plating-on #hud .timer-panel, body.plating-on #hud .crosshair, body.plating-on #hud .prompt { display: none !important; }
#plating h2 { margin: 0 0 8px; font: 700 15px Cinzel, serif; letter-spacing: .12em; color: #ffcf6a; }
#plating .pl-left li { list-style: none; display: flex; gap: 8px; align-items: center; padding: 5px 0; font-size: 14px; border-bottom: 1px solid rgba(184,134,47,.15); }
#plating .pl-left li b { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #b8862f; flex: none; display: grid; place-items: center; font-size: 11px; }
#plating .pl-left li.done { color: #9fe08a; }
#plating .pl-left li.done b { background: #3c8a2a; border-color: #9fe08a; }
#plating .pl-left ul { margin: 0; padding: 0; }
#plating .pl-right { position: absolute; right: 20px; top: 50%; transform: translateY(-50%); width: 200px; padding: 12px 14px; text-align: center; }
#plating .pl-meter { position: relative; height: 220px; width: 34px; margin: 6px auto 8px; background: #1a0b07; border: 2px solid #b8862f; border-radius: 17px; overflow: hidden; }
#plating .pl-meter i { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(0deg, #8a1a10, #ff7a1a 45%, #ffd36a 75%, #fff2b0); transition: height .2s; }
#plating .pl-meter s { position: absolute; left: 0; right: 0; height: 1px; background: rgba(255,220,150,.45); }
#plating .pl-grade { font: 700 17px Cinzel, serif; color: #ffcf6a; }
#plating .pl-score { font-size: 13px; opacity: .8; }
#plating .pl-tools { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 12px 0 8px; }
#plating .pl-tool { padding: 8px 12px; border: 2px solid #5a3a1a; border-radius: 8px; font-size: 13px; text-align: center; opacity: .65; }
#plating .pl-tool kbd { display: block; font: 700 11px Inter; opacity: .7; margin-bottom: 2px; }
#plating .pl-tool.on { border-color: #ffcf6a; background: rgba(255,160,40,.16); opacity: 1; box-shadow: 0 0 12px rgba(255,160,40,.35); }
#plating .pl-keys { font-size: 12px; line-height: 1.8; opacity: .85; }
#plating .pl-keys kbd { background: #2a130b; border: 1px solid #b8862f; border-radius: 4px; padding: 0 5px; font-size: 11px; }
#plating .pl-hint { position: absolute; left: 50%; bottom: 150px; transform: translateX(-50%); font-size: 15px; text-shadow: 0 2px 6px #000; }
#plating .pl-result { position: absolute; left: 50%; top: 30%; transform: translate(-50%,-50%); text-align: center; padding: 18px 40px; animation: pl-pop .35s ease-out; }
#plating .pl-result h1 { margin: 0; font: 700 38px Cinzel, serif; color: #ffcf6a; }
@keyframes pl-pulse { to { opacity: .55; } }
@keyframes pl-pop { from { transform: translate(-50%,-50%) scale(.6); opacity: 0; } }
@media (max-width: 760px) { #plating .pl-right { display: none; } #plating .pl-title h1 { font-size: 24px; } }
`;

const TOOL_HINT: Record<PlatingTool, string> = {
  place: 'Click a component to pick it up, click again to set it down. Scroll rotates.',
  sauce: 'Hold and drag for one elegant swipe of sauce.',
  garnish: 'Click to sprinkle a pinch of herbs.',
  wipe: 'Hold the mouse over smudges on the rim to wipe them.',
};

export class PlatingHud {
  private root: HTMLDivElement;
  private resultT = 0;

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'plating';
    this.root.innerHTML = `
      <div class="pl-panel pl-title"><h1>PLATING</h1><div class="pl-dish"></div><div class="pl-time"></div><div class="pl-bar"><i></i></div></div>
      <div class="pl-panel pl-left"><h2>Gorgon Wants</h2><ul></ul>
        <div class="pl-tools">${(['place', 'sauce', 'garnish', 'wipe'] as PlatingTool[]).map((t, i) => `<div class="pl-tool" data-t="${t}"><kbd>${i + 1}</kbd>${TOOL_LABEL[t]}</div>`).join('')}</div>
        <div class="pl-keys"><kbd>Right-click</kbd> next tool<br><kbd>Shift</kbd> fine control · <kbd>Wheel</kbd> rotate<br><kbd>E</kbd> finish plating</div>
      </div>
      <div class="pl-panel pl-right"><h2>Presentation</h2><div class="pl-meter"><i></i><s style="bottom:40%"></s><s style="bottom:60%"></s><s style="bottom:75%"></s><s style="bottom:90%"></s></div><div class="pl-grade"></div><div class="pl-score"></div></div>
      <div class="pl-hint"></div>
      <div class="pl-panel pl-result" style="display:none"><h1></h1><div class="pl-score"></div></div>`;
    document.body.appendChild(this.root);
  }

  show(v: PlatingView | null): void {
    this.root.classList.toggle('on', !!v || this.resultT > 0);
    document.body.classList.toggle('plating-on', !!v);
    if (!v) return;
    const q = <T extends Element>(s: string) => this.root.querySelector(s) as T;
    q<HTMLElement>('.pl-dish').textContent = v.dish;
    const time = q<HTMLElement>('.pl-time');
    time.textContent = v.timeLeft.toFixed(1) + 's';
    time.classList.toggle('low', v.timeLeft < 4);
    q<HTMLElement>('.pl-bar i').style.width = `${(100 * v.timeLeft) / v.timeMax}%`;
    q<HTMLElement>('.pl-left ul').innerHTML = v.checklist.map((c) => `<li class="${c.done ? 'done' : ''}"><b>${c.done ? '✓' : ''}</b>${c.label}</li>`).join('');
    q<HTMLElement>('.pl-meter i').style.height = `${v.score}%`;
    q<HTMLElement>('.pl-right .pl-grade').textContent = v.grade;
    q<HTMLElement>('.pl-right .pl-score').textContent = `${v.score} / 100`;
    for (const t of this.root.querySelectorAll<HTMLElement>('.pl-tool')) t.classList.toggle('on', t.dataset.t === v.tool);
    q<HTMLElement>('.pl-hint').textContent = v.tool === 'place' && v.holding ? 'Click to set it down. Scroll to rotate.' : TOOL_HINT[v.tool];
    q<HTMLElement>('.pl-result').style.display = 'none';
    for (const s of ['.pl-title', '.pl-left', '.pl-right', '.pl-hint']) q<HTMLElement>(s).style.display = '';
  }

  /** Briefly flash the plating grade after the plate is finished. */
  result(r: PlatingResult): void {
    this.resultT = 1.8;
    const q = <T extends Element>(s: string) => this.root.querySelector(s) as T;
    for (const s of ['.pl-title', '.pl-left', '.pl-right', '.pl-hint']) q<HTMLElement>(s).style.display = 'none';
    const box = q<HTMLElement>('.pl-result');
    box.style.display = '';
    box.querySelector('h1')!.textContent = r.grade;
    box.querySelector('.pl-score')!.textContent = `Plating ${r.score} / 100`;
    this.root.classList.add('on');
  }

  update(dt: number, active: boolean): void {
    if (this.resultT > 0) {
      this.resultT -= dt;
      if (this.resultT <= 0 && !active) this.root.classList.remove('on');
    }
  }
}
