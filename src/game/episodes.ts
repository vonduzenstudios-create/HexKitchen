import type { RoundTemper } from './gorgonAI';
import type { LineKey } from './lines';
import { RECIPES, type Recipe } from './recipes';

export interface RoundDef {
  name: string;
  title: string;
  sub: string;
  line: LineKey;
  seconds: number;
  recipes: Recipe[];
  temper: RoundTemper;
  boss?: boolean;
  /** Seconds between Gorgon's Service Inspections of the oven (Episode 2). */
  inspectEvery?: number;
}

export interface EpisodeDef {
  id: 1 | 2;
  title: string;
  tagline: string;
  host: string;
  intro: LineKey;
  taste: LineKey;
  win: LineKey;
  lose: LineKey;
  bossDish: string;
  rounds: RoundDef[];
}

export const EPISODES: Record<1 | 2, EpisodeDef> = {
  1: {
    id: 1,
    title: 'The Audition',
    tagline: 'A grimy basement studio. Three rounds. Survive the gorgon.',
    host: "Tonight's host: Gorgon Ramsey",
    intro: 'intro',
    taste: 'tasteStart',
    win: 'verdictWin',
    lose: 'verdictLose',
    bossDish: 'Medusa Wellington',
    rounds: [
      {
        name: 'Round 1 · The Appetizer',
        title: 'Round 1',
        sub: 'The Appetizer: one Cursed Caesar',
        line: 'round1',
        seconds: 240,
        recipes: [RECIPES.caesar],
        temper: { interval: 22, inspect: 1, gaze: 0.8, sabotage: 0, speed: 0.9, windup: 2.4 },
      },
      {
        name: 'Round 2 · Dinner Rush',
        title: 'Round 2',
        sub: 'Dinner Rush: Steak & Fries AND Spaghetti',
        line: 'round2',
        seconds: 360,
        recipes: [RECIPES.steakFries, RECIPES.spaghetti],
        temper: { interval: 17, inspect: 1, gaze: 1, sabotage: 0.5, speed: 1, windup: 2.0 },
      },
      {
        name: 'Round 3 · The Final Judgment',
        title: 'The Final Judgment',
        sub: "Cook Gorgon's signature Medusa Wellington",
        line: 'round3',
        seconds: 300,
        recipes: [RECIPES.wellington],
        temper: { interval: 16, inspect: 0.6, gaze: 1.2, sabotage: 0.35, speed: 1.15, windup: 1.8 },
        boss: true,
      },
    ],
  },
  2: {
    id: 2,
    title: 'The Last Resort',
    tagline: "You've been promoted. A cursed hotel restaurant, a full dining room of statues, and an oven.",
    host: 'Room service with Gorgon Ramsey',
    intro: 'resortIntro',
    taste: 'resortTaste',
    win: 'resortWin',
    lose: 'resortLose',
    bossDish: 'Honeymoon Wellington',
    rounds: [
      {
        name: 'Round 1 · Continental Dreadfast',
        title: 'Continental Dreadfast',
        sub: 'Tomato toast: chop, top, bake',
        line: 'resort1',
        seconds: 270,
        recipes: [RECIPES.toast],
        temper: { interval: 24, inspect: 1, gaze: 0.7, sabotage: 0, speed: 0.9, windup: 2.4 },
        inspectEvery: 70,
      },
      {
        name: 'Round 2 · Room Service',
        title: 'Room Service',
        sub: 'Stuffed Mushrooms AND Steak & Roast Potatoes',
        line: 'resort2',
        seconds: 420,
        recipes: [RECIPES.stuffedMushrooms, RECIPES.steakRoast],
        temper: { interval: 19, inspect: 1, gaze: 0.9, sabotage: 0.4, speed: 1, windup: 2.1 },
        inspectEvery: 55,
      },
      {
        name: 'Round 3 · The Honeymoon Suite',
        title: 'The Honeymoon Suite',
        sub: 'A proper pastry-wrapped Wellington with green beans',
        line: 'resort3',
        seconds: 360,
        recipes: [RECIPES.honeymoon],
        temper: { interval: 17, inspect: 0.6, gaze: 1.1, sabotage: 0.3, speed: 1.1, windup: 1.9 },
        boss: true,
        inspectEvery: 50,
      },
    ],
  },
};

/** Which episode this page is running: ?ep=2 picks The Last Resort. */
export function currentEpisode(): EpisodeDef {
  const ep = new URLSearchParams(location.search).get('ep');
  return EPISODES[ep === '2' ? 2 : 1];
}
