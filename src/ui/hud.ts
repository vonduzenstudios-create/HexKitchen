import type { Gauge, Ticket } from '../game/stations';
import type { Objective, ObjectiveGroup, ObjectiveState } from '../game/objectives';
import type { Step } from '../game/recipes';
import type { IngredientKind } from '../game/ingredients';
import { INGREDIENTS } from '../game/ingredients';
import { ICONS, GORGON_SVG, cornerSvg, type IconName } from './icons';
import { renderGorgonPortrait } from './portrait';
import { WRATH_STAGES, wrathStage } from '../game/gorgonAI';

const STAGE_INFO: Record<string, { cls: string; desc: string }> = {
  Calm: { cls: 'calm', desc: 'Watching from across the room.' },
  Irritated: { cls: 'irritated', desc: 'Pacing closer, inspecting more.' },
  Furious: { cls: 'furious', desc: 'Sabotaging your station!' },
  'Petrifying Rage': { cls: 'rage', desc: 'Gazes come fast and often!' },
};

export interface GazeWarning {
  phase: 'none' | 'windup' | 'gaze';
  charge: number;
  safe: boolean;
  reason?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A dark framed panel with notched corners, gold border and corner ornaments. */
function panel(cls: string): HTMLDivElement {
  const p = el('div', `panel ${cls}`);
  p.append(el('i', 'orn'));
  return p;
}

export interface EndStats {
  won: boolean;
  title: string;
  quote: string;
  stars: number;
  rows: [string, string][];
}

// ------------------------------------------------------------------ objective analysis

const STEP_PREFIX: Record<Step, string> = {
  chop: 'Chop the',
  season: 'Season the',
  fry: 'Pan-fry the',
  boil: 'Boil the',
  deepfry: 'Deep-fry the',
};
const STEP_SHORT: Record<Step, string> = { chop: 'Chop', season: 'Season', fry: 'Fry', boil: 'Boil', deepfry: 'Deep-fry' };
const STEP_ICON: Record<Step, IconName> = { chop: 'knife', season: 'salt', fry: 'pan', boil: 'pot', deepfry: 'fryer' };
const SHORT_NAME: Partial<Record<IngredientKind, string>> = { pasta: 'Spaghetti', beef: 'Beef', greens: 'Beans' };
const shortName = (k: IngredientKind) => SHORT_NAME[k] ?? INGREDIENTS[k].name;

type Mark = ObjectiveState; // done | next | todo
interface CompView {
  kind: IngredientKind;
  grab: Mark;
  steps: { step: Step; mark: Mark }[];
  plate: Mark;
  warn?: string;
  active: boolean;
}
interface TicketView {
  ticket: Ticket;
  served: boolean;
  comps: CompView[];
  serve: Mark;
  /** "Set a clean plate" step, when the objectives include one. */
  plateSet: Mark | null;
  active: boolean;
  next: Objective | null;
  nextComp: CompView | null;
}

/**
 * Lines produced by buildObjectives come per component in order: "Grab ...", its steps, "Put ...",
 * listing every finished step plus the first unfinished one, then a final "Serve" line. Walk them
 * against the recipe to recover the state of every step.
 */
function analyse(ticket: Ticket, group: ObjectiveGroup | undefined): TicketView {
  const served = ticket.served || !!group?.served;
  const lines = group?.lines ?? [];
  let idx = 0;
  let next: Objective | null = null;
  let nextComp: CompView | null = null;
  const known = ['Grab ', 'Put the ', 'Serve', 'Set a ', ...Object.values(STEP_PREFIX)];
  const take = (prefix: string, name: string): Objective | null => {
    // Lines this HUD doesn't know about are skipped (but can still be the current objective).
    while (lines[idx] && !known.some((k) => lines[idx].text.startsWith(k))) {
      if (lines[idx].state === 'next') next = lines[idx];
      idx++;
    }
    const l = lines[idx];
    if (l && l.text.startsWith(prefix) && (name === '' || l.text.toLowerCase().includes(name))) {
      idx++;
      return l;
    }
    return null;
  };
  let plateSet: Mark | null = null;
  const ps = served ? null : take('Set a ', '');
  if (ps) {
    plateSet = ps.state;
    if (ps.state === 'next') next = ps;
  }
  const comps: CompView[] = ticket.recipe.components.map((c) => {
    const name = INGREDIENTS[c.kind].name.toLowerCase();
    const view: CompView = { kind: c.kind, grab: served ? 'done' : 'todo', steps: c.steps.map((step) => ({ step, mark: served ? 'done' : 'todo' })), plate: served ? 'done' : 'todo', active: false };
    if (served) return view;
    const seq: { prefix: string; set: (m: Mark) => void }[] = [
      { prefix: 'Grab ', set: (m) => (view.grab = m) },
      ...view.steps.map((s) => ({ prefix: STEP_PREFIX[s.step], set: (m: Mark) => (s.mark = m) })),
      { prefix: 'Put the ', set: (m) => (view.plate = m) },
    ];
    for (const s of seq) {
      const l = take(s.prefix, name);
      if (!l) continue;
      s.set(l.state);
      if (l.warn) view.warn = l.warn;
      if (l.state === 'next') {
        next = l;
        nextComp = view;
        view.active = true;
      }
    }
    return view;
  });
  let serve: Mark = served ? 'done' : 'todo';
  const sl = take('Serve', '');
  if (sl) {
    serve = sl.state;
    if (sl.state === 'next') next = sl;
  }
  take('\u0000', ''); // flush any trailing unknown lines
  if (!next) next = lines.find((l) => l.state === 'next') ?? null;
  return { ticket, served, comps, serve, plateSet: served ? 'done' : plateSet, active: !!next, next, nextComp };
}

interface StepNode {
  label: string;
  icon: IconName;
  state: 'done' | 'current' | 'todo';
}

function progressNodes(v: TicketView): StepNode[] {
  const nodes: StepNode[] = [];
  if (v.plateSet) nodes.push({ label: 'Set Plate', icon: 'plate', state: v.plateSet === 'done' ? 'done' : v.plateSet === 'next' ? 'current' : 'todo' });
  for (const c of v.comps) {
    const firstOpen = c.steps.findIndex((s) => s.mark !== 'done');
    c.steps.forEach((s, i) => {
      const current = (s.mark === 'next') || (c.grab === 'next' && i === firstOpen);
      nodes.push({ label: `${STEP_SHORT[s.step]} ${shortName(c.kind)}`, icon: STEP_ICON[s.step], state: s.mark === 'done' ? 'done' : current ? 'current' : 'todo' });
    });
  }
  const allPlated = v.comps.every((c) => c.plate === 'done');
  const plating = v.comps.some((c) => c.plate === 'next');
  nodes.push({ label: 'Plate it', icon: 'plate', state: allPlated ? 'done' : plating ? 'current' : 'todo' });
  nodes.push({ label: 'Serve', icon: 'bell', state: v.served ? 'done' : v.serve === 'next' ? 'current' : 'todo' });
  return nodes;
}

function objectiveIcon(o: Objective, comp: CompView | null): IconName {
  const t = o.text;
  if (t.startsWith('Grab') && comp) return comp.kind;
  if (t.startsWith('Put the')) return 'plate';
  if (t.startsWith('Serve')) return 'bell';
  if (t.startsWith('Set a')) return 'plate';
  for (const s of Object.keys(STEP_PREFIX) as Step[]) if (t.startsWith(STEP_PREFIX[s])) return STEP_ICON[s];
  return comp ? comp.kind : 'ember';
}

const HINT_ICONS: [RegExp, IconName][] = [
  [/\b(trash|bin)\b/, 'trash'],
  [/\bcrates?\b/, 'crate'],
  [/\b(plates?|smash|stacked)\b/, 'plate'],
  [/\bclick\b/, 'hand'],
  [/\b(board|swipe|chop)\b/, 'knife'],
  [/\b(tray|shake|season)\b/, 'salt'],
  [/\b(pan|flip|golden)\b/, 'pan'],
  [/\bfryer\b/, 'fryer'],
  [/\bpot\b/, 'pot'],
  [/\bgorgon\b/, 'devil'],
  [/\b(pass|serve|bell)\b/, 'bell'],
];

function hintIcon(sentence: string): IconName {
  const s = sentence.toLowerCase();
  // "hold click" sentences are about working a station, not grabbing.
  for (const [re, icon] of HINT_ICONS) if (re.test(s) && !(icon === 'hand' && s.includes('hold'))) return icon;
  return 'ember';
}

const ico = (n: IconName) => ICONS[n];

// ------------------------------------------------------------------ HUD

export class Hud {
  private crosshair = el('div', 'crosshair');
  private prompt = el('div', 'prompt');
  private lastPrompt = '';
  private lastPromptActive = false;

  // Timer
  private timerPanel = panel('timer-panel');
  private roundName = el('div', 'round-name');
  private timer = el('div', 'timer');
  private lastRoundName = '';
  private lastSeconds = -1;

  // Meters
  private wrathPanel = panel('meter-panel wrath');
  private wrathSegs: HTMLElement[] = [];
  private wrathLabel = el('b', 'meter-state');
  private wrathFoot = el('div', 'meter-foot');
  private lastStage = '';
  private cutEl = el('div', 'cutfb hidden');
  private cutTimer = 0;
  private gazeEl = el('div', 'gaze-warn hidden');
  private gazeRing = el('div', 'gaze-ring');
  private gazeTitle = el('div', 'gaze-title');
  private gazeSub = el('div', 'gaze-sub');
  private gazeKey = '';
  private gazeCharge = -1;
  private stonePanel = panel('meter-panel stone');
  private stoneFill = el('i', 'stone-fill');
  private stoneLabel = el('b', 'meter-state');
  private lastWrathKey = '';
  private lastStoneKey = '';

  // Left column + next panel
  private left = el('div', 'hud-left');
  private cardsEl = el('div', 'cards');
  private progressPanel = panel('progress-panel');
  private nextPanel = panel('next-panel');
  private right = el('div', 'hud-right');
  private tickets: Ticket[] = [];
  private lastObjectivesKey = '';

  // Gauge (built once, then only styles and text change)
  private gaugeEl = panel('gauge hidden');
  private gBeat = el('div', 'beat');
  private gTitle = el('span');
  private gSub = el('span', 'sub');
  private gFill = el('div', 'fill');
  private gZone = el('div', 'zone');
  private gHint = el('div', 'gauge-hint');
  private gVisible = false;
  private gKey = '';

  private subs = el('div', 'subs');
  private subsText = el('div', 'subs-text');
  private banner = el('div', 'banner hidden');
  private toastEl = el('div', 'toast hidden');
  private screen = el('div', 'screen hidden');
  private subTimer = 0;
  private toastTimer = 0;
  private bannerTimer = 0;
  private play = el('div', 'play');
  private portraitUrl: string | null = null;

  constructor(root: HTMLElement) {
    const rs = document.documentElement.style;
    rs.setProperty('--corner-tl', cornerSvg(0));
    rs.setProperty('--corner-tr', cornerSvg(90));
    rs.setProperty('--corner-br', cornerSvg(180));
    rs.setProperty('--corner-bl', cornerSvg(270));

    // Timer
    const timeRow = el('div', 'timer-row');
    timeRow.append(el('span', 'flourish'), this.timer, el('span', 'flourish r'));
    this.timerPanel.append(el('span', 'emblem', ico('trident')), this.roundName, timeRow);

    // Wrath
    const wrathWrap = el('div', 'segs-wrap');
    const wrathBar = el('div', 'segs');
    wrathWrap.append(wrathBar);
    for (const st of WRATH_STAGES) {
      if (st.min <= 0) continue;
      const tick = el('span', 'tick');
      tick.style.left = `${st.min}%`;
      wrathWrap.append(tick);
    }
    for (let i = 0; i < 12; i++) {
      const s = el('i');
      wrathBar.append(s);
      this.wrathSegs.push(s);
    }
    const wHead = el('div', 'meter-head', '<span class="meter-name">Gorgon\'s Wrath</span>');
    wHead.append(this.wrathLabel);
    const wBody = el('div', 'meter-body');
    wBody.append(wHead, wrathWrap, this.wrathFoot);
    this.wrathPanel.append(el('div', 'meter-icon', ico('devil')), wBody);

    // Petrification
    const sHead = el('div', 'meter-head', '<span class="meter-name">Petrification</span>');
    sHead.append(this.stoneLabel);
    const sBar = el('div', 'stone-bar');
    sBar.append(this.stoneFill);
    const sBody = el('div', 'meter-body');
    sBody.append(sHead, sBar, el('div', 'meter-foot', 'At 100% you become a statue.'));
    this.stonePanel.append(el('div', 'meter-icon', ico('stone')), sBody);

    this.right.append(this.wrathPanel, this.stonePanel, this.nextPanel);
    this.left.append(this.cardsEl, this.progressPanel);
    this.left.classList.add('hidden');
    this.nextPanel.classList.add('hidden');

    // Gauge
    const gTitleRow = el('div', 'gauge-title');
    gTitleRow.append(this.gTitle, this.gSub);
    const gBar = el('div', 'gauge-bar');
    gBar.append(this.gFill, this.gZone);
    this.gaugeEl.append(this.gBeat, gTitleRow, gBar, this.gHint);

    // Dialogue
    const portrait = el('div', 'portrait portrait-slot', GORGON_SVG);
    const subsBody = el('div', 'subs-body', '<div class="who">Gorgon:</div>');
    subsBody.append(this.subsText);
    this.subs.append(el('i', 'orn'), portrait, subsBody, el('div', 'embers'), el('span', 'subs-pip'));

    this.gazeEl.append(this.gazeRing, this.gazeTitle, this.gazeSub);
    this.play.append(this.gazeEl, this.cutEl, this.crosshair, this.prompt, this.left, this.timerPanel, this.right, this.gaugeEl, this.toastEl);
    root.append(this.play, this.subs, this.banner, this.screen);
    this.setPlaying(false);

    // The 3D portrait is a one-off render in its own tiny context; do it once things are idle.
    setTimeout(() => this.makePortrait(), 600);
  }

  private makePortrait(): void {
    const url = renderGorgonPortrait(256);
    if (!url) return;
    this.portraitUrl = url;
    document.querySelectorAll('.portrait-slot').forEach((e) => (e.innerHTML = this.portraitImg()));
  }

  private portraitImg(): string {
    return this.portraitUrl ? `<img src="${this.portraitUrl}" alt="">` : GORGON_SVG;
  }

  setPlaying(on: boolean): void {
    this.play.classList.toggle('hidden', !on);
  }

  setPrompt(text: string, active: boolean): void {
    if (text !== this.lastPrompt) {
      this.lastPrompt = text;
      this.prompt.textContent = text;
      this.prompt.classList.toggle('empty', !text);
    }
    if (active !== this.lastPromptActive) {
      this.lastPromptActive = active;
      this.crosshair.classList.toggle('active', active);
    }
  }

  setRound(name: string, secondsLeft: number): void {
    if (name !== this.lastRoundName) {
      this.lastRoundName = name;
      this.roundName.textContent = name.replace(/\s*·\s*/, ' — ');
    }
    const s = Math.max(0, Math.ceil(secondsLeft));
    if (s === this.lastSeconds) return;
    this.lastSeconds = s;
    this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timerPanel.classList.toggle('low', s <= 10 && s > 0);
    this.timerPanel.classList.toggle('warm', s <= 30 && s > 10);
  }

  setMeters(wrath: number, stone: number): void {
    const lit = Math.round((Math.max(0, Math.min(100, wrath)) / 100) * this.wrathSegs.length);
    const state = wrathStage(wrath).stage;
    const wKey = `${lit}|${state}`;
    if (wKey !== this.lastWrathKey) {
      this.lastWrathKey = wKey;
      this.wrathSegs.forEach((s, i) => s.classList.toggle('on', i < lit));
      if (state !== this.lastStage) {
        const info = STAGE_INFO[state] ?? STAGE_INFO.Calm;
        this.wrathLabel.textContent = state;
        this.wrathFoot.textContent = info.desc;
        this.wrathPanel.dataset.state = info.cls;
        this.wrathPanel.classList.toggle('danger', info.cls === 'rage');
        if (this.lastStage) {
          this.wrathPanel.classList.remove('flash');
          void this.wrathPanel.offsetWidth;
          this.wrathPanel.classList.add('flash');
        }
        this.lastStage = state;
      }
    }
    const pct = Math.round(Math.max(0, Math.min(100, stone)));
    const sKey = `${pct}`;
    if (sKey !== this.lastStoneKey) {
      this.lastStoneKey = sKey;
      this.stoneFill.style.width = `${pct}%`;
      this.stoneLabel.textContent = `${pct}%`;
      this.stonePanel.classList.toggle('danger', stone >= 70);
      this.stonePanel.classList.toggle('warm', stone >= 35 && stone < 70);
    }
  }

  /** Tickets are kept and rendered together with the objectives so both share one change check. */
  setTickets(tickets: Ticket[], _filled: (t: Ticket) => Set<string>): void {
    this.tickets = tickets;
  }

  setObjectives(groups: ObjectiveGroup[]): void {
    const key = this.tickets.map((t) => `${t.id}:${t.served}`).join(',') + '#' + JSON.stringify(groups);
    if (key === this.lastObjectivesKey) return;
    this.lastObjectivesKey = key;
    if (!groups.length || !this.tickets.length) {
      this.left.classList.add('hidden');
      this.nextPanel.classList.add('hidden');
      return;
    }
    const views = this.tickets.map((t, i) => analyse(t, groups[i]));
    const active = views.find((v) => v.active) ?? views.find((v) => !v.served) ?? views[0];
    this.renderCards(views, active);
    this.renderProgress(active);
    this.renderNext(views, groups);
  }

  private renderCards(views: TicketView[], active: TicketView): void {
    const plateTag = (t: Ticket) => (t.plate === 'plateA' ? 'Plate 1 · back' : 'Plate 2 · front');
    const html = views
      .map((v) => {
        if (v !== active) {
          const icons = v.comps
            .map((c) => `<span class="mini${c.plate === 'done' ? ' done' : ''}">${ico(c.kind)}${c.plate === 'done' ? `<b>${ico('check')}</b>` : ''}</span>`)
            .join('');
          return `<div class="panel rcard compact${v.served ? ' served' : ''}"><i class="orn"></i>
            <div class="card-head"><span class="emblem">${ico('trident')}</span><h3>${esc(v.ticket.recipe.name)}</h3><span class="plate-tag">${v.served ? 'Served' : plateTag(v.ticket)}</span></div>
            <div class="mini-row">${icons}</div></div>`;
        }
        const rows = v.comps
          .map((c) => {
            const chips = c.steps
              .map((s) => `<span class="chip ${s.mark}">${s.mark === 'done' ? ico('check') : ''}${STEP_SHORT[s.step]}</span>`)
              .join('');
            const ring = c.plate === 'done' ? `<span class="ring done">${ico('check')}</span>` : `<span class="ring${c.plate === 'next' ? ' next' : ''}"></span>`;
            const warn = c.warn ? `<div class="row-warn">${ico('warn')}${esc(c.warn)}</div>` : '';
            return `<div class="row${c.active ? ' active' : ''}${c.plate === 'done' ? ' plated' : ''}"><span class="row-icon">${ico(c.kind)}</span>
              <div class="row-text"><div class="row-name">${esc(INGREDIENTS[c.kind].name)}</div><div class="chips">${chips}</div>${warn}</div>${ring}</div>`;
          })
          .join('');
        const plateRow = v.plateSet
          ? `<div class="row${v.plateSet === 'next' ? ' active' : ''}${v.plateSet === 'done' ? ' plated' : ''}"><span class="row-icon">${ico('plate')}</span>
              <div class="row-text"><div class="row-name">Clean plate</div><div class="chips"><span class="chip ${v.plateSet}">${v.plateSet === 'done' ? ico('check') : ''}${v.ticket.plate === 'plateA' ? 'Plate 1 · back' : 'Plate 2 · front'}</span></div></div>
              ${v.plateSet === 'done' ? `<span class="ring done">${ico('check')}</span>` : `<span class="ring${v.plateSet === 'next' ? ' next' : ''}"></span>`}</div>`
          : '';
        return `<div class="panel rcard${v.served ? ' served' : ''}"><i class="orn"></i>
          <div class="card-head"><span class="emblem">${ico('trident')}</span><h3>${esc(v.ticket.recipe.name)}</h3><span class="plate-tag">${v.served ? 'Served' : plateTag(v.ticket)}</span></div>
          <div class="rows">${plateRow}${rows}</div></div>`;
      })
      .join('');
    this.cardsEl.innerHTML = html;
    this.left.classList.remove('hidden');
  }

  private renderProgress(v: TicketView): void {
    const nodes = progressNodes(v);
    const done = nodes.filter((n) => n.state === 'done').length;
    // The lit track runs up to the current node (or the last finished one).
    let reach = nodes.findIndex((n) => n.state === 'current');
    if (reach < 0) reach = nodes.reduce((a, n, i) => (n.state === 'done' ? i : a), 0);
    const pct = nodes.length > 1 ? (reach / (nodes.length - 1)) * 100 : 0;
    this.progressPanel.innerHTML =
      `<i class="orn"></i><div class="progress-head"><span>Recipe Progress</span><b>${done}/${nodes.length}</b></div>` +
      `<div class="stepper" style="--n:${nodes.length}"><div class="track"><i style="width:${Math.min(100, pct)}%"></i></div>` +
      nodes
        .map((n) => `<div class="node ${n.state}"><span class="dot">${n.state === 'done' ? ico('check') : ''}</span><span class="node-label">${esc(n.label)}</span></div>`)
        .join('') +
      '</div>';
  }

  private renderNext(views: TicketView[], groups: ObjectiveGroup[]): void {
    const nv = views.find((v) => v.next);
    let body: string;
    if (nv && nv.next) {
      const o = nv.next;
      const warn = o.warn ? `<div class="next-warn">${ico('warn')}${esc(o.warn)}</div>` : '';
      const sentences = (o.hint ?? '')
        .split(/\.\s+|\.$/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (o.warn && /burnt|fresh/.test(o.warn)) sentences.push('Bin the ruined one in the trash can');
      const hints = sentences
        .map((s) => `<li><span class="hint-icon">${ico(hintIcon(s))}</span><span>${esc(s)}.</span></li>`)
        .join('');
      // A peek at the other open work, mostly useful in Round 2 with two tickets.
      const later: string[] = [];
      groups.forEach((g, gi) => {
        if (g.served) return;
        for (const l of g.lines) {
          if (l.state !== 'todo' || later.length >= 2) continue;
          if (views[gi] === nv && later.length >= 1) continue;
          later.push(`<li><span class="later-dot"></span>${esc(l.text)}</li>`);
          break;
        }
      });
      body =
        `<div class="next-box"><span class="next-icon">${ico(objectiveIcon(o, nv.nextComp))}</span><div class="next-text">${esc(o.text)}${warn}</div></div>` +
        (hints ? `<ul class="hints">${hints}</ul>` : '') +
        (later.length ? `<div class="later-head">Then</div><ul class="later">${later.join('')}</ul>` : '');
    } else if (views.every((v) => v.served)) {
      body = `<div class="next-box calm"><span class="next-icon">${ico('devil')}</span><div class="next-text">Every plate is out. Keep out of his gaze!</div></div>`;
    } else {
      body = `<div class="next-box"><span class="next-icon">${ico('ember')}</span><div class="next-text">Keep cooking!</div></div>`;
    }
    this.nextPanel.innerHTML = `<i class="orn"></i><div class="panel-title"><span class="emblem">${ico('trident')}</span>What to do next</div>${body}`;
    this.nextPanel.classList.remove('hidden');
  }

  /** Punchy word above the station gauge after each chop. */
  cutFeedback(word: 'Perfect' | 'Good' | 'Sloppy'): void {
    this.cutEl.textContent = word === 'Perfect' ? 'PERFECT!' : word === 'Good' ? 'Good' : 'Sloppy';
    this.cutEl.className = `cutfb ${word.toLowerCase()}`;
    void this.cutEl.offsetWidth; // restart the animation
    this.cutEl.classList.add('go');
    this.cutTimer = 0.6;
  }

  /** Big ring around the crosshair while Gorgon winds up and fires his gaze. */
  setGazeWarning(w: GazeWarning): void {
    const label = w.phase === 'gaze' ? (w.safe ? (w.reason ?? 'Safe').toUpperCase() : 'TURNING TO STONE') : 'GAZE INCOMING';
    const key = w.phase === 'none' ? 'none' : `${w.phase}|${w.safe}|${label}`;
    if (key !== this.gazeKey) {
      this.gazeKey = key;
      if (w.phase === 'none') {
        this.gazeEl.classList.add('hidden');
      } else {
        this.gazeEl.className = `gaze-warn ${w.phase}${w.phase === 'gaze' ? (w.safe ? ' safe' : ' unsafe') : ''}`;
        this.gazeTitle.textContent = label;
        this.gazeSub.textContent = w.phase === 'windup' ? 'Look away · Duck behind a counter · Raise the pan (right-click) as it lands' : w.safe ? 'Hold it until he stops' : 'Look away! Duck! Raise the pan!';
      }
    }
    if (w.phase === 'none') return;
    const c = Math.round(Math.max(0, Math.min(1, w.phase === 'gaze' ? 1 : w.charge)) * 100) / 100;
    if (c !== this.gazeCharge) {
      this.gazeCharge = c;
      this.gazeEl.style.setProperty('--charge', `${c}`);
    }
  }

  setGauge(g: Gauge | null): void {
    if (!g) {
      if (this.gVisible) {
        this.gVisible = false;
        this.gaugeEl.classList.add('hidden');
      }
      return;
    }
    if (!this.gVisible) {
      this.gVisible = true;
      this.gaugeEl.classList.remove('hidden');
    }
    const pct = (v: number) => Math.max(0, Math.min(100, (v / g.max) * 100));
    const fill = pct(g.value);
    const z0 = g.zone ? pct(g.zone[0]) : 0;
    const z1 = g.zone ? pct(g.zone[1]) : 0;
    const inZone = !!g.zone && fill >= z0 && fill <= z1;
    const beat = g.beat;
    const key = `${g.title}|${g.sub ?? ''}|${g.hint}|${fill.toFixed(1)}|${z0.toFixed(1)}|${z1.toFixed(1)}|${beat === undefined ? '' : beat.toFixed(2)}`;
    if (key === this.gKey) return;
    this.gKey = key;
    if (this.gTitle.textContent !== g.title) this.gTitle.textContent = g.title;
    const sub = g.sub ?? '';
    if (this.gSub.textContent !== sub) this.gSub.textContent = sub;
    if (this.gHint.textContent !== g.hint) this.gHint.textContent = g.hint;
    this.gFill.style.width = `${fill}%`;
    this.gFill.classList.toggle('in-zone', inZone);
    this.gZone.style.display = g.zone ? '' : 'none';
    if (g.zone) {
      this.gZone.style.left = `${z0}%`;
      this.gZone.style.width = `${z1 - z0}%`;
    }
    if (beat === undefined) {
      this.gBeat.style.display = 'none';
    } else {
      this.gBeat.style.display = '';
      this.gBeat.style.transform = `scale(${0.4 + beat * 0.9})`;
      this.gBeat.style.opacity = `${0.4 + (1 - beat) * 0.6}`;
      this.gBeat.classList.toggle('hit', beat > 0.86 || beat < 0.08);
    }
  }

  subtitle(text: string, seconds: number): void {
    this.subsText.textContent = text;
    this.subs.classList.remove('show');
    void this.subs.offsetWidth; // restart the slide-in
    this.subs.classList.add('show');
    this.subTimer = seconds;
  }

  showBanner(title: string, sub: string, seconds: number): void {
    this.banner.innerHTML = `<div class="banner-inner"><div class="banner-rule"><i></i><span class="emblem">${ico('trident')}</span><i></i></div><h1>${esc(title)}</h1><p>${esc(sub)}</p><div class="banner-rule"><i></i><span class="gem"></span><i></i></div></div>`;
    this.banner.classList.remove('hidden');
    this.bannerTimer = seconds;
  }

  toast(grade: string, score: number, detail: string): void {
    this.toastEl.className = `toast panel ${grade}`;
    this.toastEl.innerHTML = `<i class="orn"></i><div class="toast-grade">${esc(grade)}!</div><div class="toast-score">${score}<small>pts</small></div><div class="toast-detail">${esc(detail)}</div>`;
    this.toastTimer = 3.2;
  }

  update(dt: number): void {
    if (this.subTimer > 0 && (this.subTimer -= dt) <= 0) this.subs.classList.remove('show');
    if (this.cutTimer > 0 && (this.cutTimer -= dt) <= 0) this.cutEl.classList.add('hidden');
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.classList.add('hidden');
    if (this.bannerTimer > 0 && (this.bannerTimer -= dt) <= 0) this.banner.classList.add('hidden');
  }

  /** Show a full-screen panel. Returns the element so callers can wire buttons. */
  showScreen(html: string): HTMLElement {
    this.screen.innerHTML = `<div class="card screen-card panel"><i class="orn"></i>${html}</div>`;
    this.screen.classList.remove('hidden');
    return this.screen;
  }

  hideScreen(): void {
    this.screen.classList.add('hidden');
  }

  titleScreen(): HTMLElement {
    const row = (k: string, icon: IconName, t: string) => `<span class="key">${k}</span><span class="ctl-icon">${ico(icon)}</span><span>${t}</span>`;
    return this.showScreen(`
      <div class="title-portrait portrait-slot">${this.portraitImg()}</div>
      <h1 class="logo display">Hex Kitchen<span>a cooking horror comedy</span></h1>
      <p class="tagline">Three rounds. One furious gorgon chef. <b>Don't meet his eyes.</b></p>
      <div class="controls">
        ${row('WASD', 'hand', 'Move · <b>Shift</b> sprint · <b>Mouse</b> look')}
        ${row('Click', 'crate', 'Grab / place / drop · flick while dropping to throw')}
        ${row('Hold click', 'knife', 'Work a station: swipe to chop, shake to season, flick to flip')}
        ${row('Right click', 'pan', 'Raise the polished pan to reflect his gaze')}
        ${row('Space / C', 'stone', 'Crouch behind counters for cover')}
        ${row('E', 'bell', "Serve a finished plate: you plate it up first, then it goes out")}
        ${row('F / Q', 'trash', 'F takes off the oven mitts · Q drops what you hold · click the trash can to bin')}
      </div>
      <button class="btn" id="start">Enter the Kitchen</button>
      <p class="small">Headphones recommended. Everything you see and hear is generated by code.</p>
    `);
  }

  pauseScreen(): HTMLElement {
    return this.showScreen(`
      <h1 class="logo display small-logo">Paused</h1>
      <p class="tagline">Gorgon is waiting. He is very patient. He is not very patient.</p>
      <button class="btn" id="resume">Back to the Line</button>
    `);
  }

  endScreen(s: EndStats): HTMLElement {
    const stars = Array.from({ length: 5 }, (_, i) => (i < s.stars ? '<span class="on">★</span>' : '<span class="off">★</span>')).join('');
    const rows = s.rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
    return this.showScreen(`
      <div class="title-portrait portrait-slot${s.won ? '' : ' stone-tint'}">${this.portraitImg()}</div>
      <h1 class="logo display end-logo ${s.won ? 'won' : 'lost'}">${s.title}</h1>
      <div class="stars">${stars}</div>
      <p class="quote">"${s.quote}"<span>— Gorgon Ramsey</span></p>
      <div class="stats">${rows}</div>
      <button class="btn" id="again">Cook Again</button>
    `);
  }
}
