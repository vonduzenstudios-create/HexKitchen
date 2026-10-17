// Grapheme-to-phoneme: exception dictionary -> morphological decomposition -> NRL letter-to-sound rules.
// Pure TS (no DOM), testable in node.

import { getDict, LETTER_NAMES } from './dict';
import { lettersToSound } from './rules';
import { normalize, type PhraseEnd } from './normalize';

export interface Phone { p: string; stress: 0 | 1 | 2 }
export interface WordPh { text: string; phones: Phone[]; emph: boolean; func: boolean }
export interface PhrasePh { words: WordPh[]; end: PhraseEnd; shout: boolean }

export const VOWEL_PHONES = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW', 'AX']);

const FUNCTION_WORDS = new Set((
  'a an the of to and or but in on at by for with from is are was were be been am do does has have had it its ' +
  'he she we they i me my his her our their them us him as if so than then can will would should could shall ' +
  "i'm it's he's she's we're they're i'll you'll i've you've i'd that's there's into onto"
).split(' '));

function parse(arr: string[]): Phone[] {
  return arr.map((s) => {
    const m = /^([A-Z]+)([012])?$/.exec(s);
    const p = m ? m[1] : s;
    const st = m && m[2] ? (+m[2] as 0 | 1 | 2) : 0;
    return { p, stress: VOWEL_PHONES.has(p) ? st : 0 };
  });
}

function assignStress(ph: string[]): Phone[] {
  const out: Phone[] = ph.map((p) => ({ p, stress: 0 as 0 | 1 | 2 }));
  const vidx = out.map((x, i) => (VOWEL_PHONES.has(x.p) ? i : -1)).filter((i) => i >= 0);
  if (!vidx.length) return out;
  let primary = vidx.find((i) => out[i].p !== 'AX') ?? vidx[0];
  // -tion/-sion/-ic words: stress the syllable before the suffix
  const s = ph.join(' ');
  if (vidx.length >= 3 && /(SH|ZH) AX N$/.test(s)) primary = vidx[vidx.length - 2];
  else if (vidx.length >= 3 && /IH K$/.test(s)) primary = vidx[vidx.length - 2];
  out[primary].stress = 1;
  return out;
}

const SIBILANTS = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);
const VOICELESS = new Set(['P', 'T', 'K', 'F', 'TH', 'S', 'SH', 'CH', 'HH']);

function plural(base: Phone[]): Phone[] {
  const last = base[base.length - 1]?.p ?? '';
  if (SIBILANTS.has(last)) return [...base, { p: 'IH', stress: 0 }, { p: 'Z', stress: 0 }];
  if (VOICELESS.has(last)) return [...base, { p: 'S', stress: 0 }];
  return [...base, { p: 'Z', stress: 0 }];
}
function past(base: Phone[]): Phone[] {
  const last = base[base.length - 1]?.p ?? '';
  if (last === 'T' || last === 'D') return [...base, { p: 'IH', stress: 0 }, { p: 'D', stress: 0 }];
  if (VOICELESS.has(last)) return [...base, { p: 'T', stress: 0 }];
  return [...base, { p: 'D', stress: 0 }];
}
const suf = (base: Phone[], s: string) => [...base, ...parse(s.split(' '))];

/** Dictionary lookup with morphological fallbacks. Returns null when nothing in the dictionary covers it. */
function lookup(w: string, depth = 0): Phone[] | null {
  const dict = getDict();
  const d = dict.get(w);
  if (d) return parse(d);
  if (depth > 2 || w.length < 3) return null;
  const tryStem = (stem: string): Phone[] | null => {
    if (stem.length < 2) return null;
    const cands = [stem, stem + 'E'];
    // de-double consonants: STOPPED -> STOP
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2] && !'AEIOULS'.includes(stem[stem.length - 1])) cands.push(stem.slice(0, -1));
    for (const c of cands) { const r = lookup(c, depth + 1); if (r) return r; }
    return null;
  };
  if (w.endsWith("'S")) { const b = lookup(w.slice(0, -2), depth + 1); if (b) return plural(b); }
  if (w.endsWith("S'")) { const b = lookup(w.slice(0, -1), depth + 1); if (b) return b; }
  if (w.endsWith('IES')) { const b = tryStem(w.slice(0, -3) + 'Y'); if (b) return plural(b); }
  if (w.endsWith('ES')) { const b = lookup(w.slice(0, -2), depth + 1); if (b) return plural(b); }
  if (w.endsWith('S') && !w.endsWith('SS')) { const b = lookup(w.slice(0, -1), depth + 1); if (b) return plural(b); }
  if (w.endsWith('IED')) { const b = tryStem(w.slice(0, -3) + 'Y'); if (b) return past(b); }
  if (w.endsWith('ED')) { const b = tryStem(w.slice(0, -2)); if (b) return past(b); }
  if (w.endsWith('ING')) { const b = tryStem(w.slice(0, -3)); if (b) return suf(b, 'IH0 NG'); }
  if (w.endsWith('ERS')) { const b = tryStem(w.slice(0, -3)); if (b) return suf(b, 'ER0 Z'); }
  if (w.endsWith('ER')) { const b = tryStem(w.slice(0, -2)); if (b) return suf(b, 'ER0'); }
  if (w.endsWith('EST')) { const b = tryStem(w.slice(0, -3)); if (b) return suf(b, 'AH0 S T'); }
  if (w.endsWith('ILY')) { const b = tryStem(w.slice(0, -3) + 'Y'); if (b) return suf(b.slice(0, -1), 'AH0 L IY0'); }
  if (w.endsWith('LY')) { const b = lookup(w.slice(0, -2), depth + 1); if (b) return suf(b, 'L IY0'); }
  if (w.endsWith('NESS')) { const b = lookup(w.slice(0, -4), depth + 1); if (b) return suf(b, 'N AH0 S'); }
  if (w.endsWith('LESS')) { const b = lookup(w.slice(0, -4), depth + 1); if (b) return suf(b, 'L AH0 S'); }
  if (w.endsWith('FUL')) { const b = lookup(w.slice(0, -3), depth + 1); if (b) return suf(b, 'F AH0 L'); }
  if (w.endsWith('MENT')) { const b = lookup(w.slice(0, -4), depth + 1); if (b) return suf(b, 'M AH0 N T'); }
  if (w.endsWith('Y') && w.length > 4) { const b = tryStem(w.slice(0, -1)); if (b) return suf(b, 'IY0'); }
  if (w.startsWith('UN') && w.length > 5) { const b = lookup(w.slice(2), depth + 1); if (b) return [...parse(['AH0', 'N']), ...b]; }
  if (w.startsWith('RE') && w.length > 5) { const b = lookup(w.slice(2), depth + 1); if (b) return [...parse(['R', 'IY0']), ...b]; }
  // compounds: both halves known
  if (depth === 0 && w.length >= 6) {
    for (let i = 3; i <= w.length - 3; i++) {
      const a = dict.get(w.slice(0, i));
      if (!a) continue;
      const b = lookup(w.slice(i), depth + 1);
      if (b) {
        const second = b.map((x) => (x.stress === 1 ? { p: x.p, stress: 2 as const } : x));
        return [...parse(a), ...second];
      }
    }
  }
  return null;
}

const cache = new Map<string, Phone[]>();

/** Convert one word to phonemes with stress. */
export function wordToPhones(word: string): Phone[] {
  const w = word.toUpperCase().replace(/[^A-Z']/g, '').replace(/^'+|'+$/g, '');
  if (!w) return [];
  const c = cache.get(w);
  if (c) return c;
  let res = lookup(w);
  if (!res) {
    const letters = w.replace(/'/g, '');
    if (letters.length <= 4 && !/[AEIOUY]/.test(letters)) {
      // acronym: spell it out
      res = [];
      for (const ch of letters) res.push(...parse((LETTER_NAMES[ch] || '').split(' ').filter(Boolean)));
    } else if (letters.length === 1) {
      res = parse((LETTER_NAMES[letters] || '').split(' '));
    } else {
      res = assignStress(lettersToSound(w));
    }
  }
  if (cache.size > 2000) cache.clear();
  cache.set(w, res);
  return res;
}

export function isFunctionWord(word: string): boolean {
  return FUNCTION_WORDS.has(word.toLowerCase());
}

export function textToPhrases(text: string): PhrasePh[] {
  return normalize(text).map((ph) => ({
    end: ph.end,
    shout: ph.shout,
    words: ph.words
      .map((w) => ({ text: w.text, emph: w.emph, func: isFunctionWord(w.text), phones: wordToPhones(w.text) }))
      .filter((w) => w.phones.length > 0),
  })).filter((p) => p.words.length > 0);
}

/** Debug helper: phoneme string, words separated by spaces, phrases by " | ". Stress shown as digits on vowels. */
export function phonemeString(text: string): string {
  return textToPhrases(text).map((ph) =>
    ph.words.map((w) => (w.emph ? '*' : '') + w.phones.map((p) => p.p + (VOWEL_PHONES.has(p.p) ? p.stress : '')).join('-')).join(' ') + ' ' + ph.end,
  ).join(' | ');
}
