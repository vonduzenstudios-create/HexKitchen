import { INGREDIENTS } from './ingredients';
import type { Item } from './items';
import { SEASON_TARGET, SEASON_WINDOW, type CookState, type Step } from './recipes';
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
};

const STEP_HINT: Record<Step, string> = {
  chop: 'Drop it on the board, hold click and swipe down on each beat',
  season: 'Drop it on the tray, hold click and shake the mouse until the bar is in the green',
  fry: 'Drop it in the pan, hold click and flick up to flip. Take it out when both sides are golden',
  boil: 'Drop it in the pot and grab it out when the bar reaches the green',
  deepfry: 'Drop it in the fryer and grab it out when the bar reaches the green',
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
  }
}

function stepWarn(c: CookState, step: Step): string | undefined {
  if (step === 'season' && c.season > SEASON_TARGET + SEASON_WINDOW + 0.1) return 'too salty';
  const v = step === 'fry' ? Math.max(c.fry[0], c.fry[1]) : step === 'boil' ? c.boil : step === 'deepfry' ? c.deepfry : 0;
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
        const done = !!item && stepDone(item.cook, step);
        add(STEP_TEXT[step](name), done, STEP_HINT[step], item ? stepWarn(item.cook, step) : undefined);
      }
      add(`Put the ${name} on ${plateName} at the pass`, !!onPlate, `The pass is the counter on the right. ${plateName} is the ${t.plate === 'plateA' ? 'back' : 'front'} one`);
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
