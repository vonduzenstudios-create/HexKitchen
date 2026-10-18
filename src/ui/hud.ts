import type { Gauge, Ticket } from '../game/stations';
import type { ObjectiveGroup } from '../game/objectives';
import { STEP_LABEL } from '../game/recipes';
import { INGREDIENTS } from '../game/ingredients';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export interface EndStats {
  won: boolean;
  title: string;
  quote: string;
  stars: number;
  rows: [string, string][];
}

export class Hud {
  private crosshair = el('div', 'crosshair');
  private prompt = el('div', 'prompt');
  private top = el('div', 'topbar');
  private roundName = el('div', 'round-name display');
  private timer = el('div', 'timer display');
  private meters = el('div', 'meters');
  private wrathMeter: HTMLElement;
  private wrathFill: HTMLElement;
  private wrathLabel: HTMLElement;
  private stoneMeter: HTMLElement;
  private stoneFill: HTMLElement;
  private stoneLabel: HTMLElement;
  private tickets = el('div', 'tickets');
  private objectives = el('div', 'objectives');
  private lastObjectivesKey = '';
  private gaugeEl = el('div', 'gauge hidden');
  private subs = el('div', 'subs hidden');
  private banner = el('div', 'banner hidden');
  private toastEl = el('div', 'toast hidden');
  private screen = el('div', 'screen hidden');
  private subTimer = 0;
  private toastTimer = 0;
  private bannerTimer = 0;
  private lastTicketsKey = '';
  private play = el('div');

  constructor(root: HTMLElement) {
    this.top.append(this.roundName, this.timer);
    const meter = (cls: string, name: string) => {
      const m = el('div', `meter ${cls}`);
      const head = el('div', 'meter-head', `<span>${name}</span><b></b>`);
      const bar = el('div', `bar ${cls}`);
      const fill = el('i');
      bar.append(fill);
      const foot = el('div', 'meter-foot');
      m.append(head, bar, foot);
      this.meters.append(m);
      return { m, fill, label: head.querySelector('b') as HTMLElement, foot };
    };
    const w = meter('wrath', "Gorgon's Wrath");
    this.wrathMeter = w.m;
    this.wrathFill = w.fill;
    this.wrathLabel = w.label;
    w.foot.textContent = 'Perfect dishes calm him. Burnt food does not.';
    const s = meter('stone', 'Petrification');
    this.stoneMeter = s.m;
    this.stoneFill = s.fill;
    this.stoneLabel = s.label;
    s.foot.textContent = 'At 100% you become a statue.';
    this.meters.append(this.objectives);
    this.play.append(this.crosshair, this.prompt, this.top, this.meters, this.tickets, this.gaugeEl, this.toastEl);
    root.append(this.play, this.subs, this.banner, this.screen);
    this.setPlaying(false);
  }

  setPlaying(on: boolean): void {
    this.play.classList.toggle('hidden', !on);
  }

  setPrompt(text: string, active: boolean): void {
    this.prompt.textContent = text;
    this.crosshair.classList.toggle('active', active);
  }

  setRound(name: string, secondsLeft: number): void {
    this.roundName.textContent = name;
    const s = Math.max(0, Math.ceil(secondsLeft));
    this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('low', s <= 10 && s > 0);
  }

  setMeters(wrath: number, stone: number): void {
    this.wrathFill.style.width = `${wrath}%`;
    this.wrathLabel.textContent = wrath < 25 ? 'Calm' : wrath < 50 ? 'Annoyed' : wrath < 75 ? 'Furious' : 'DANGER';
    this.wrathMeter.classList.toggle('danger', wrath >= 75);
    this.stoneFill.style.width = `${stone}%`;
    this.stoneLabel.textContent = `${Math.round(stone)}%`;
    this.stoneMeter.classList.toggle('danger', stone >= 70);
  }

  setTickets(tickets: Ticket[], filled: (t: Ticket) => Set<string>): void {
    const key = tickets.map((t) => `${t.id}:${t.served}:${[...filled(t)].join(',')}`).join('|');
    if (key === this.lastTicketsKey) return;
    this.lastTicketsKey = key;
    this.tickets.innerHTML = '';
    for (const t of tickets) {
      const done = filled(t);
      const card = el('div', `ticket${t.served ? ' served' : ''}`);
      const items = t.recipe.components
        .map((c) => {
          const steps = c.steps.map((s) => STEP_LABEL[s]).join(', ');
          return `<li class="${done.has(c.kind) ? 'done' : ''}">${INGREDIENTS[c.kind].name} <span class="steps">(${steps})</span></li>`;
        })
        .join('');
      card.innerHTML = `<h4 class="display">${t.recipe.name}</h4><div class="plate">${t.plate === 'plateA' ? 'Plate 1 (back)' : 'Plate 2 (front)'}${t.served ? ' · SERVED' : ''}</div><ul>${items}</ul>`;
      this.tickets.append(card);
    }
  }

  setObjectives(groups: ObjectiveGroup[]): void {
    const key = JSON.stringify(groups);
    if (key === this.lastObjectivesKey) return;
    this.lastObjectivesKey = key;
    const esc = (t: string) => t.replace(/</g, '&lt;');
    this.objectives.innerHTML =
      '<div class="obj-head">What to do</div>' +
      groups
        .map((g) => {
          const lines = g.served
            ? '<li class="done">Served</li>'
            : g.lines
                .map((l) => {
                  const mark = l.state === 'done' ? '✓' : l.state === 'next' ? '▶' : '·';
                  const warn = l.warn ? ` <em class="warn">(${esc(l.warn)})</em>` : '';
                  const hint = l.hint ? `<div class="hint">${esc(l.hint)}</div>` : '';
                  return `<li class="${l.state}"><span class="mark">${mark}</span><span>${esc(l.text)}${warn}${hint}</span></li>`;
                })
                .join('');
          return `<div class="obj-group${g.served ? ' served' : ''}"><h4>${esc(g.title)}</h4><ul>${lines}</ul></div>`;
        })
        .join('');
  }

  setGauge(g: Gauge | null): void {
    if (!g) {
      this.gaugeEl.classList.add('hidden');
      return;
    }
    this.gaugeEl.classList.remove('hidden');
    const pct = (v: number) => `${Math.max(0, Math.min(100, (v / g.max) * 100))}%`;
    const zone = g.zone ? `<div class="zone" style="left:${pct(g.zone[0])};width:calc(${pct(g.zone[1])} - ${pct(g.zone[0])})"></div>` : '';
    const beat =
      g.beat !== undefined
        ? `<div class="beat" style="transform:scale(${0.4 + g.beat * 0.9});opacity:${0.4 + (1 - g.beat) * 0.6};background:${g.beat > 0.86 || g.beat < 0.08 ? 'rgba(255,210,58,0.6)' : 'transparent'}"></div>`
        : '';
    this.gaugeEl.innerHTML = `${beat}<div class="gauge-title"><span>${g.title}</span><span>${g.sub ?? ''}</span></div><div class="gauge-bar"><div class="fill" style="width:${pct(g.value)}"></div>${zone}</div><div class="gauge-hint">${g.hint}</div>`;
  }

  subtitle(text: string, seconds: number): void {
    this.subs.innerHTML = `<span class="who">GORGON:</span> ${text.replace(/</g, '&lt;')}`;
    this.subs.classList.remove('hidden');
    this.subTimer = seconds;
  }

  showBanner(title: string, sub: string, seconds: number): void {
    this.banner.innerHTML = `<div><h1 class="display">${title}</h1><p>${sub}</p></div>`;
    this.banner.classList.remove('hidden');
    this.bannerTimer = seconds;
  }

  toast(grade: string, score: number, detail: string): void {
    this.toastEl.className = `toast display ${grade}`;
    this.toastEl.innerHTML = `${grade}! ${score}<small>${detail}</small>`;
    this.toastTimer = 3;
  }

  update(dt: number): void {
    if (this.subTimer > 0 && (this.subTimer -= dt) <= 0) this.subs.classList.add('hidden');
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.classList.add('hidden');
    if (this.bannerTimer > 0 && (this.bannerTimer -= dt) <= 0) this.banner.classList.add('hidden');
  }

  /** Show a full-screen panel. Returns the element so callers can wire buttons. */
  showScreen(html: string): HTMLElement {
    this.screen.innerHTML = `<div class="card">${html}</div>`;
    this.screen.classList.remove('hidden');
    return this.screen;
  }

  hideScreen(): void {
    this.screen.classList.add('hidden');
  }

  titleScreen(): HTMLElement {
    return this.showScreen(`
      <h1 class="logo display">Hex Kitchen<span>a cooking horror comedy</span></h1>
      <p class="tagline">Three rounds. One furious gorgon chef. Don't meet his eyes.</p>
      <div class="controls">
        <b>WASD</b><span>Move  ·  Mouse: look</span>
        <b>Click</b><span>Grab / place / drop  ·  flick while dropping to throw</span>
        <b>Hold click</b><span>Work a station: swipe to chop, shake to season, flick to flip</span>
        <b>Right click</b><span>Raise the polished pan to reflect his gaze</span>
        <b>Space</b><span>Crouch behind counters for cover</span>
        <b>E</b><span>Serve the plate you're looking at (or ring the bell)</span>
      </div>
      <button class="btn" id="start">ENTER THE KITCHEN</button>
      <p class="small">Headphones recommended. Everything you see and hear is generated by code.</p>
    `);
  }

  pauseScreen(): HTMLElement {
    return this.showScreen(`
      <h1 class="logo display" style="font-size:64px">Paused</h1>
      <p class="tagline">Gorgon is waiting. He is very patient. He is not very patient.</p>
      <button class="btn" id="resume">BACK TO THE LINE</button>
    `);
  }

  endScreen(s: EndStats): HTMLElement {
    const stars = Array.from({ length: 5 }, (_, i) => (i < s.stars ? '★' : '<span class="off">★</span>')).join('');
    const rows = s.rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
    return this.showScreen(`
      <h1 class="logo display" style="font-size:clamp(36px,7vw,72px)">${s.title}</h1>
      <div class="stars">${stars}</div>
      <p class="quote">"${s.quote}"<br>— Gorgon Ramsey</p>
      <div class="stats">${rows}</div>
      <button class="btn" id="again">COOK AGAIN</button>
    `);
  }
}
