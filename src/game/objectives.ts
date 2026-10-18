import { INGREDIENTS } from './ingredients';
import type { Item } from './items';
import { BAKE_WINDOW, SEASON_TARGET, SEASON_WINDOW, type CookState, type Step } from './recipes';
import type { Stations, Ticket } from './stations';

export type ObjectiveState = 'done' | 'next' | 'todo';

export interface Objective {
  text: string;
  hint?: string;
  warn?: string;
  state: ObjectiveState;
}

export interface ObjectiveGroup {
  title: string;
  served: boolean;
  lines: Objective[];
}

const COOKED = 0.78;

const STEP_TEXT: Record<Step, (n: string) => string> = {
  chop: (n) => `Chop the ${n} on the cutting board`,
  season: (n) => `Season the ${n} on the blue tray`,
  fry: (n) => `Pan-fry the ${n} on both sides`,
  boil: (n) => `Boil the ${n} in the pot`,
  deepfry: (n) => `Deep-fry the ${n} in the fryer`,
  bake: (n) => `Bake the ${n} in the oven`,
};

const STEP_HINT: Record<Step, string> = {
  chop: 'Drop it on the board, hold click and swipe down on each beat',
  season: 'Drop it on the tray, hold click and shake the mouse until the bar is in the green',
  fry: 'Drop it in the pan, hold click and flick up to flip. Take it out when both sides are golden. Wear the oven mitts (hook by the stove) or you will drop it',
  boil: 'Drop it in the pot. Put on the oven mitts, then grab it out when the bar reaches the green',
  deepfry: 'Drop it in the fryer. Put on the oven mitts, then grab it out when the bar reaches the green',
  bake: 'Set it on a sheet tray (rack by the oven) and slide the tray into the oven. Take it out when the timer dings and the food is golden. Oven mitts on!',
};

function stepDone(c: CookState, step: Step): boolean {
  switch (step) {
    case 'chop':
      return c.chopped;
    case 'season':
      return c.season >= SEASON_TARGET - SEASON_WINDOW;
    case 'fry':
      return Math.min(c.fry[0], c.fry[1]) >= COOKED;
    case 'boil':
      return c.boil >= COOKED;
    case 'deepfry':
      return c.deepfry >= COOKED;
    case 'bake':
      return c.bake >= BAKE_WINDOW[0];
  }
}

function stepWarn(c: CookState, step: Step): string | undefined {
  if (step === 'season' && c.season > SEASON_TARGET + SEASON_WINDOW + 0.1) return 'too salty';
  const v = step === 'fry' ? Math.max(c.fry[0], c.fry[1]) : step === 'boil' ? c.boil : step === 'deepfry' ? c.deepfry : 0;
  if (step === 'bake' && c.bake > BAKE_WINDOW[1] + 0.25) return 'burnt, start a fresh one';
  return v > 1.5 ? 'burnt, grab a fresh one' : undefined;
}

/** Step-by-step instructions for every open ticket, worked out from where the food actually is. */
export function buildObjectives(tickets: Ticket[], stations: Stations, items: Item[], held: Item | null): ObjectiveGroup[] {
  const groups: ObjectiveGroup[] = [];
  let nextGiven = false;
  for (const t of tickets) {
    const plateName = t.plate === 'plateA' ? 'Plate 1' : 'Plate 2';
    const lines: Objective[] = [];
    if (t.served) {
      groups.push({ title: t.recipe.name, served: true, lines });
      continue;
    }
    const slots = stations.plates[t.plate].slots;
    const used = new Set<Item>();
    {
      const done = stations.hasPlate[t.plate];
      const state: ObjectiveState = done ? 'done' : nextGiven ? 'todo' : 'next';
      if (!done) nextGiven = true;
      lines.push({
        text: `Set a clean plate on ${plateName}`,
        hint: state === 'next' ? `Plates are stacked at the back of the pass. Carry it gently, they smash. ${plateName} is the ${t.plate === 'plateA' ? 'back' : 'front'} spot` : undefined,
        state,
      });
    }
    for (const comp of t.recipe.components) {
      const name = INGREDIENTS[comp.kind].name.toLowerCase();
      const onPlate = slots.find((s) => s.kind === comp.kind && s.item && !used.has(s.item))?.item ?? null;
      // Otherwise follow the most cooked loose piece of this ingredient.
      let item = onPlate;
      if (!item) {
        let best = -1;
        for (const it of items) {
          if (it.kind !== comp.kind || it.where === 'gone' || used.has(it)) continue;
          if (it.where === 'station' && (it.station === 'plateA' || it.station === 'plateB')) continue;
          const progress = comp.steps.filter((s) => stepDone(it.cook, s)).length + (it === held ? 0.5 : 0);
          if (progress > best) {
            best = progress;
            item = it;
          }
        }
      }
      if (item) used.add(item);
      let pending = false;
      const add = (text: string, done: boolean, hint?: string, warn?: string) => {
        // Each ingredient shows only its first unfinished step so the list stays short.
        if (!done && pending) return;
        let state: ObjectiveState = done ? 'done' : 'todo';
        if (!done) {
          pending = true;
          if (!nextGiven) {
            state = 'next';
            nextGiven = true;
          }
        }
        lines.push({ text, hint: state === 'next' ? hint : undefined, warn, state });
      };
      add(`Grab ${name} from the pantry crates`, !!item, 'The crates are along the left wall. Click one to take an ingredient');
      for (const step of comp.steps) {
        if (step === 'bake' && comp.onto) {
          // Parts go onto their base before the whole thing is baked.
          const base = INGREDIENTS[comp.onto].name.toLowerCase();
          const on = !!item && !!item.carrier && item.carrier.kind === comp.onto;
          add(`Top the ${base} with the ${name}`, on || (!!item && stepDone(item.cook, 'bake')), `Hold the ${name} and click the ${base} (on a tray or the counter). Glowing rings show where it goes`);
        }
        const done = !!item && stepDone(item.cook, step);
        add(STEP_TEXT[step](name), done, STEP_HINT[step], item ? stepWarn(item.cook, step) : undefined);
      }
      if (comp.onto && !comp.steps.includes('bake')) {
        const base = INGREDIENTS[comp.onto].name.toLowerCase();
        const on = !!item && !!item.carrier && item.carrier.kind === comp.onto;
        add(`Wrap the ${name} in the ${base}`, on || !!onPlate, `Hold the ${name} and click the ${base}. When everything is on, it wraps itself`);
      }
      const baked = comp.steps.includes('bake') || t.recipe.components.some((c) => c.onto === comp.kind && c.steps.includes('bake'));
      const where = `${plateName} is the ${t.plate === 'plateA' ? 'back' : 'front'} one`;
      const hint = baked
        ? `Take the tray out (mitts on), carry it to the pass and click ${plateName}: the food slides onto the plate. ${where}`
        : `The pass is the counter with the service bell. ${where}`;
      add(`Put the ${name} on ${plateName} at the pass`, !!onPlate, hint);
    }
    const ready = slots.length > 0 && slots.every((s) => s.item);
    add2(lines, ready);
    groups.push({ title: `${t.recipe.name} · ${plateName}`, served: false, lines });
  }
  return groups;

  function add2(lines: Objective[], ready: boolean): void {
    const state: ObjectiveState = ready && !nextGiven ? 'next' : 'todo';
    if (state === 'next') nextGiven = true;
    lines.push({ text: 'Serve it: press E at the plate or ring the bell', hint: state === 'next' ? 'Gorgon judges it right away' : undefined, state });
  }
}
