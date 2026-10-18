import type { IngredientKind } from './ingredients';
import type { LineKey } from './lines';

export type Step = 'chop' | 'season' | 'fry' | 'boil' | 'deepfry' | 'bake';

export interface Component {
  kind: IngredientKind;
  steps: Step[];
  /** Assembled onto this base before baking (tomato onto the toast, beef into the pastry). */
  onto?: IngredientKind;
}

export interface Recipe {
  id: string;
  name: string;
  components: Component[];
}

export const RECIPES: Record<string, Recipe> = {
  caesar: {
    id: 'caesar',
    name: 'Cursed Caesar',
    components: [
      { kind: 'lettuce', steps: ['chop', 'season'] },
      { kind: 'bread', steps: ['chop'] },
    ],
  },
  steakFries: {
    id: 'steakFries',
    name: 'Steak & Fries',
    components: [
      { kind: 'steak', steps: ['season', 'fry'] },
      { kind: 'potato', steps: ['chop', 'deepfry'] },
    ],
  },
  spaghetti: {
    id: 'spaghetti',
    name: 'Spaghetti Pomodoro',
    components: [
      { kind: 'pasta', steps: ['boil'] },
      { kind: 'tomato', steps: ['chop'] },
    ],
  },
  wellington: {
    id: 'wellington',
    name: 'Medusa Wellington',
    components: [
      { kind: 'beef', steps: ['season', 'fry'] },
      { kind: 'mushroom', steps: ['chop'] },
      { kind: 'greens', steps: ['boil'] },
    ],
  },

  // ---- Episode 2: The Last Resort ----
  toast: {
    id: 'toast',
    name: 'Dreadfast Tomato Toast',
    components: [
      { kind: 'sourdough', steps: ['chop', 'bake'] },
      { kind: 'tomato', steps: ['chop', 'bake'], onto: 'sourdough' },
    ],
  },
  stuffedMushrooms: {
    id: 'stuffedMushrooms',
    name: 'Stuffed Mushrooms',
    components: [
      { kind: 'mushroom', steps: ['bake'] },
      { kind: 'cheese', steps: ['chop', 'bake'], onto: 'mushroom' },
    ],
  },
  steakRoast: {
    id: 'steakRoast',
    name: 'Steak & Roast Potatoes',
    components: [
      { kind: 'steak', steps: ['season', 'fry'] },
      { kind: 'potato', steps: ['chop', 'season', 'bake'] },
    ],
  },
  honeymoon: {
    id: 'honeymoon',
    name: 'The Honeymoon Wellington',
    components: [
      { kind: 'pastry', steps: ['bake'] },
      { kind: 'beef', steps: ['season', 'fry'], onto: 'pastry' },
      { kind: 'mushroom', steps: ['chop'], onto: 'pastry' },
      { kind: 'greens', steps: ['boil'] },
    ],
  },
};

export const STEP_LABEL: Record<Step, string> = {
  chop: 'chop',
  season: 'season',
  fry: 'pan-fry',
  boil: 'boil',
  deepfry: 'deep-fry',
  bake: 'bake',
};

/** Cooking state carried by every ingredient item. */
export interface CookState {
  chopped: boolean;
  chopHits: number;
  chopScoreSum: number;
  season: number;
  fry: [number, number];
  boil: number;
  deepfry: number;
  /** Oven (or toaster) doneness. */
  bake: number;
  floor: boolean;
}

export function freshCookState(): CookState {
  return { chopped: false, chopHits: 0, chopScoreSum: 0, season: 0, fry: [0, 0], boil: 0, deepfry: 0, bake: 0, floor: false };
}

// Doneness values: 1.0 is perfect. Generous windows keep it forgiving.
export const SEASON_TARGET = 0.55;
export const SEASON_WINDOW = 0.13;
const DONE_WINDOW = 0.22;

function doneness(v: number): number {
  if (v < 0.15) return 0;
  if (v > 1.8) return 0;
  return Math.max(0, Math.min(1, 1 - Math.max(0, Math.abs(v - 1) - DONE_WINDOW) / 0.55));
}

/** Ovens are slower but more forgiving than pans: a wide golden window, then a gentle slide to charcoal. */
export const BAKE_WINDOW: [number, number] = [0.8, 1.35];
function bakeScore(v: number): number {
  if (v < 0.15) return 0;
  if (v >= BAKE_WINDOW[0] && v <= BAKE_WINDOW[1]) return 1;
  if (v < BAKE_WINDOW[0]) return Math.max(0, 1 - (BAKE_WINDOW[0] - v) / 0.5);
  return Math.max(0, 1 - (v - BAKE_WINDOW[1]) / 0.6);
}

export function seasonScore(v: number): number {
  if (v <= 0.02) return 0;
  return Math.max(0, Math.min(1, 1 - Math.max(0, Math.abs(v - SEASON_TARGET) - SEASON_WINDOW) / 0.35));
}

export function stepScore(s: CookState, step: Step): number {
  switch (step) {
    case 'chop':
      return s.chopped ? Math.max(0.3, s.chopScoreSum / Math.max(1, s.chopHits)) : 0;
    case 'season':
      return seasonScore(s.season);
    case 'fry':
      return (doneness(s.fry[0]) + doneness(s.fry[1])) / 2;
    case 'boil':
      return doneness(s.boil);
    case 'deepfry':
      return doneness(s.deepfry);
    case 'bake':
      return bakeScore(s.bake);
  }
}

/** The single worst problem with an item, for Gorgon's critique. */
export function stepIssue(s: CookState, step: Step): LineKey | null {
  switch (step) {
    case 'chop':
      if (!s.chopped) return 'raw';
      return s.chopScoreSum / Math.max(1, s.chopHits) < 0.55 ? 'uneven' : null;
    case 'season':
      if (s.season > SEASON_TARGET + SEASON_WINDOW + 0.1) return 'oversalted';
      if (s.season < SEASON_TARGET - SEASON_WINDOW - 0.1) return 'bland';
      return null;
    case 'fry': {
      const hi = Math.max(s.fry[0], s.fry[1]);
      const lo = Math.min(s.fry[0], s.fry[1]);
      if (hi > 1.5) return 'burnt';
      if (lo < 0.6) return 'raw';
      return null;
    }
    case 'boil':
    case 'deepfry': {
      const v = step === 'boil' ? s.boil : s.deepfry;
      if (v > 1.5) return 'burnt';
      if (v < 0.6) return 'raw';
      return null;
    }
    case 'bake':
      if (s.bake > BAKE_WINDOW[1] + 0.25) return 'burnt';
      if (s.bake < BAKE_WINDOW[0] - 0.2) return 'underbaked';
      return null;
  }
}

export interface PlatedItem {
  kind: IngredientKind;
  cook: CookState;
  placement: number; // 0..1
}

export interface DishResult {
  score: number; // 0..100
  grade: 'Perfect' | 'Good' | 'Poor' | 'Raw';
  issue: LineKey;
  breakdown: string[];
}

export function gradeFor(score: number): DishResult['grade'] {
  if (score >= 90) return 'Perfect';
  if (score >= 70) return 'Good';
  if (score >= 40) return 'Poor';
  return 'Raw';
}

export function evaluateDish(recipe: Recipe, plated: PlatedItem[]): DishResult {
  const used = new Set<number>();
  let total = 0;
  const issues: { key: LineKey; weight: number }[] = [];
  const breakdown: string[] = [];
  let floorCount = 0;
  let placementSum = 0;
  for (const comp of recipe.components) {
    const idx = plated.findIndex((p, i) => !used.has(i) && p.kind === comp.kind);
    if (idx < 0) {
      issues.push({ key: 'missing', weight: 3 });
      breakdown.push(`${comp.kind}: missing`);
      continue;
    }
    used.add(idx);
    const item = plated[idx];
    const scores = comp.steps.map((st) => stepScore(item.cook, st));
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    total += avg;
    placementSum += item.placement;
    if (item.cook.floor) floorCount++;
    comp.steps.forEach((st, i) => {
      const iss = stepIssue(item.cook, st);
      if (iss) issues.push({ key: iss, weight: 1 + (1 - scores[i]) * 2 });
    });
    breakdown.push(`${comp.kind}: ${Math.round(avg * 100)}`);
  }
  const n = recipe.components.length;
  let score = (total / n) * 100;
  const placement = used.size ? placementSum / used.size : 0;
  score *= 0.88 + 0.12 * placement;
  score -= floorCount * 20;
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (floorCount) issues.push({ key: 'floor', weight: 2.5 });
  const grade = gradeFor(score);
  let issue: LineKey;
  if (grade === 'Perfect') issue = 'perfect';
  else if (grade === 'Good') issue = 'good';
  else {
    issues.sort((a, b) => b.weight - a.weight);
    issue = issues[0]?.key ?? 'poor';
  }
  return { score, grade, issue, breakdown };
}
