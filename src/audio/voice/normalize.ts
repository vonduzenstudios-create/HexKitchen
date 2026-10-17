// Text normalisation: numbers -> words, symbols -> words, punctuation -> phrase breaks,
// CAPS words -> emphasis. Pure TS.

export type PhraseEnd = '.' | '!' | '?' | ',' | '...';
export interface WordTok { text: string; emph: boolean }
export interface PhraseTok { words: WordTok[]; end: PhraseEnd; shout: boolean }

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORD: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
};

export function numberToWords(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (n < 0) return 'minus ' + numberToWords(-n);
  n = Math.floor(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + numberToWords(n % 100) : '');
  const units: [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
  for (const [v, name] of units) {
    if (n >= v) {
      const rest = n % v;
      return numberToWords(Math.floor(n / v)) + ' ' + name + (rest ? (rest < 100 ? ' and ' : ' ') + numberToWords(rest) : '');
    }
  }
  return String(n);
}

function ordinal(words: string): string {
  const parts = words.split(' ');
  const last = parts.pop()!;
  let o: string;
  if (ORD[last]) o = ORD[last];
  else if (last.endsWith('y')) o = last.slice(0, -1) + 'ieth';
  else o = last + 'th';
  parts.push(o);
  return parts.join(' ');
}

function expandNumbers(s: string): string {
  return s.replace(/(\$)?(\d[\d,]*)(\.\d+)?(st|nd|rd|th|%|s)?/gi, (_m, dollar: string | undefined, int: string, dec: string | undefined, suf: string | undefined) => {
    const n = parseInt(int.replace(/,/g, ''), 10);
    let w = numberToWords(n);
    if (dec) w += ' point ' + dec.slice(1).split('').map((d) => ONES[+d]).join(' ');
    const sfx = (suf || '').toLowerCase();
    if (sfx === 'st' || sfx === 'nd' || sfx === 'rd' || sfx === 'th') w = ordinal(w);
    else if (sfx === '%') w += ' percent';
    else if (sfx === 's') w += 's';
    if (dollar) w += n === 1 && !dec ? ' dollar' : ' dollars';
    return ' ' + w + ' ';
  });
}

/** Split text into phrases of words, with emphasis flags. */
export function normalize(text: string): PhraseTok[] {
  let s = String(text ?? '');
  s = s.replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/…/g, '...').replace(/[–—]/g, ' , ').replace(/\s--+\s|--+/g, ' , ');
  s = expandNumbers(s);
  s = s.replace(/&/g, ' and ').replace(/%/g, ' percent ').replace(/\+/g, ' plus ').replace(/@/g, ' at ').replace(/#/g, ' number ');
  s = s.replace(/(\w)-(\w)/g, '$1 $2');

  const tokens = s.match(/[A-Za-z]+(?:'[A-Za-z]+)*|\.{2,}|[.!?,;:]+/g) || [];
  const phrases: PhraseTok[] = [];
  let cur: WordTok[] = [];
  const flush = (end: PhraseEnd) => {
    if (cur.length) phrases.push({ words: cur, end, shout: false });
    else if (phrases.length && (end === '...' || end === '.')) {
      // stacked punctuation: upgrade previous end if stronger
      const prev = phrases[phrases.length - 1];
      if (prev.end === ',') prev.end = end;
    }
    cur = [];
  };
  for (const t of tokens) {
    if (/^[A-Za-z]/.test(t)) {
      const letters = t.replace(/[^A-Za-z]/g, '');
      const emph = letters.length >= 2 && letters === letters.toUpperCase();
      cur.push({ text: t, emph });
    } else if (t.startsWith('..')) {
      flush('...');
    } else {
      const end: PhraseEnd = t.includes('?') ? '?' : t.includes('!') ? '!' : t.includes('.') ? '.' : ',';
      flush(end);
    }
  }
  flush('.');

  // Whole-sentence shouting: if most multi-letter words are caps, treat as shout instead of per-word emphasis.
  let multi = 0, caps = 0;
  for (const p of phrases) for (const w of p.words) if (w.text.length >= 2) { multi++; if (w.emph) caps++; }
  if (multi >= 3 && caps / multi > 0.7) {
    for (const p of phrases) { p.shout = true; for (const w of p.words) w.emph = false; }
  }
  return phrases;
}
