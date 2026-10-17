// Prosody: phonemes -> timed segments (durations after Klatt's rules, simplified) + an F0 contour
// (declination, pitch accents on stressed syllables, emphasis, phrase-final fall / question rise).

import type { PhrasePh, Phone } from './g2p';
import { PH, ER_RP, isVowelKind, isSonorantKind, type PhDef } from './phonemes';

export type SegPart = 'main' | 'clo' | 'bur' | 'asp' | 'fr' | 'sil';
export interface Seg {
  ph: string;          // phoneme name, or 'SIL'
  def: PhDef | null;   // null for silence
  part: SegPart;
  start: number;       // seconds
  dur: number;         // seconds
  stress: 0 | 1 | 2;
  amp: number;         // loudness multiplier
  word: number;        // global word index (-1 for silence)
  burstAmp?: number;   // for 'bur'
  voiceBar?: boolean;  // for voiced 'clo'
}
export interface F0Point { t: number; hz: number }
export interface Utterance { segs: Seg[]; f0: F0Point[]; duration: number; phonemes: string }

export interface ProsodyOpts {
  basePitch: number;   // Hz, the speaker's baseline (Gorgon ~92)
  rate: number;        // speaking rate multiplier (1 = normal)
  british: boolean;    // non-rhotic R
  hiss: number;        // 0..1 lengthens voiceless sibilants (snake-y "sss")
  range: number;       // pitch accent range multiplier (aggression)
}

interface Flat {
  p: string; stress: 0 | 1 | 2; def: PhDef;
  word: number; wordInPhrase: number; func: boolean; emph: boolean;
  wordStart: boolean; wordEnd: boolean; vowelsInWord: number; vowelIdxInWord: number;
}

const BRIT_SCHWA_AFTER = new Set(['IY', 'IH', 'EH', 'EY', 'UH', 'UW', 'AY', 'OY', 'AW']);

export function buildUtterance(phrases: PhrasePh[], o: ProsodyOpts): Utterance {
  const segs: Seg[] = [];
  const f0: F0Point[] = [];
  let t = 0;
  let wordCounter = 0;
  const rate = Math.max(0.3, Math.min(3, o.rate || 1));
  const phonLog: string[] = [];

  const pushSil = (dur: number) => {
    if (dur <= 0) return;
    const last = segs[segs.length - 1];
    if (last && last.ph === 'SIL') { last.dur += dur; t += dur; return; }
    segs.push({ ph: 'SIL', def: null, part: 'sil', start: t, dur, stress: 0, amp: 0, word: -1 });
    t += dur;
  };
  pushSil(0.04);

  phrases.forEach((phrase, pi) => {
    // ---- flatten with word info + British R handling
    const flat: Flat[] = [];
    phrase.words.forEach((w, wi) => {
      const phones: Phone[] = w.phones.map((p) => ({ ...p }));
      const vcount = phones.filter((p) => PH[p.p] && isVowelKind(PH[p.p].kind)).length;
      let vi = 0;
      phones.forEach((p, k) => {
        let name = p.p;
        if (name === 'AH' && p.stress === 0) name = 'AX';
        const def0 = PH[name];
        if (!def0) return;
        let def = def0;
        if (name === 'ER' && o.british) def = ER_RP;
        const isV = isVowelKind(def.kind);
        flat.push({
          p: name, stress: p.stress, def, word: wordCounter, wordInPhrase: wi, func: w.func && !w.emph, emph: w.emph,
          wordStart: k === 0, wordEnd: k === phones.length - 1, vowelsInWord: vcount, vowelIdxInWord: isV ? vi : -1,
        });
        if (isV) vi++;
      });
      wordCounter++;
    });
    if (o.british) {
      for (let i = flat.length - 1; i >= 0; i--) {
        if (flat[i].p !== 'R') continue;
        const next = flat[i + 1];
        const prev = flat[i - 1];
        if (next && isVowelKind(next.def.kind)) continue;
        if (!prev || !isVowelKind(prev.def.kind)) continue;
        if (BRIT_SCHWA_AFTER.has(prev.p)) {
          flat[i] = { ...flat[i], p: 'AX', def: PH.AX, stress: 0, vowelIdxInWord: -1 };
        } else {
          if (flat[i].wordEnd) prev.wordEnd = true;
          flat.splice(i, 1);
          (prev as Flat & { long?: boolean }).long = true;
        }
      }
    }
    if (!flat.length) return;

    // last syllable of phrase = from the last vowel onwards
    let lastVowel = -1;
    for (let i = flat.length - 1; i >= 0; i--) if (isVowelKind(flat[i].def.kind)) { lastVowel = i; break; }

    const phraseStartT = t;
    const accents: { seg: Seg; strength: number }[] = [];
    const vowelSegs: { seg: Seg; f: Flat; accented: boolean; idx: number }[] = [];

    for (let i = 0; i < flat.length; i++) {
      const f = flat[i];
      const d = f.def;
      const prev = flat[i - 1];
      const next = flat[i + 1];
      const isV = isVowelKind(d.kind);
      const finalSyl = i >= lastVowel && lastVowel >= 0;
      let k = 1;
      let amp = 1;
      if (isV) {
        k *= f.stress === 1 ? 1 : f.stress === 2 ? 0.85 : 0.55;
        if (f.func) k *= 0.6;
        if (f.vowelsInWord > 1 && f.vowelIdxInWord < f.vowelsInWord - 1) k *= 0.85;
        if (next && !next.wordStart && next.def.kind !== 'vowel' && !next.def.voiced && next.def.kind !== 'asp') k *= 0.8;
        if ((f as Flat & { long?: boolean }).long) k *= 1.3;
        amp *= f.stress === 1 ? 1.12 : f.stress === 2 ? 1 : 0.8;
      } else {
        const inCluster = (prev && !prev.wordEnd && !isVowelKind(prev.def.kind) && !f.wordStart) ||
          (next && !f.wordEnd && !isVowelKind(next.def.kind));
        if (inCluster) k *= 0.75;
        if (f.wordStart) k *= 1.1;
        if (f.func) k *= 0.8;
      }
      if (finalSyl) k *= phrase.end === ',' ? 1.15 : 1.35;
      if (f.emph) { k *= 1.35; amp *= 1.45; }
      if (phrase.shout) { k *= 1.08; amp *= 1.2; }
      if (f.func) amp *= 0.85;
      let dur = (d.min + (d.inh - d.min) * k) / 1000;
      if (k > 1) dur = (d.inh * k) / 1000;
      if (d.sib && !d.voiced) dur *= 1 + o.hiss * 0.55;
      dur /= rate;

      // vowel-initial stressed word after a vowel: tiny glottal break
      if (isV && f.wordStart && prev && isVowelKind(prev.def.kind)) pushSil(0.03 / rate);

      phonLog.push(f.p + (isV ? f.stress : ''));
      const base: Omit<Seg, 'part' | 'dur' | 'start'> = { ph: f.p, def: d, stress: f.stress, amp, word: f.word };

      if (d.kind === 'stop') {
        const b = d.burst!;
        const bdur = b.dur / 1000;
        const clo = Math.max(0.02, dur - bdur);
        const voiceBar = d.voiced && !!prev && prev.def.voiced;
        segs.push({ ...base, part: 'clo', start: t, dur: clo, voiceBar }); t += clo;
        let bAmp = b.amp;
        if (next && (next.def.kind === 'stop' || next.def.kind === 'affric')) bAmp *= 0.3;
        segs.push({ ...base, part: 'bur', start: t, dur: bdur, burstAmp: bAmp }); t += bdur;
        if (!d.voiced) {
          let vot = (d.vot ?? 40) / 1000;
          const afterS = prev && prev.p === 'S' && !f.wordStart;
          if (afterS) vot = 0.012;
          else if (next && isSonorantKind(next.def.kind)) { if (next.stress === 0 && isVowelKind(next.def.kind)) vot *= 0.65; }
          else if (!next) vot = 0.03;
          else vot = 0.015;
          vot /= Math.sqrt(rate);
          segs.push({ ...base, part: 'asp', start: t, dur: vot }); t += vot;
        }
      } else if (d.kind === 'affric') {
        const clo = dur * 0.45;
        const fr = dur * 0.55;
        segs.push({ ...base, part: 'clo', start: t, dur: clo, voiceBar: d.voiced && !!prev && prev.def.voiced }); t += clo;
        segs.push({ ...base, part: 'bur', start: t, dur: 0.008, burstAmp: d.burst!.amp }); t += 0.008;
        segs.push({ ...base, part: 'fr', start: t, dur: fr }); t += fr;
      } else {
        const seg: Seg = { ...base, part: 'main', start: t, dur };
        segs.push(seg);
        t += dur;
        if (isV) {
          const accented = (!f.func || f.emph) && (f.stress === 1 || (f.vowelsInWord === 1));
          vowelSegs.push({ seg, f, accented, idx: i });
          if (accented) accents.push({ seg, strength: f.emph ? 1.5 : 1 });
        }
      }
    }
    const phraseEndT = t;

    // ---- F0 contour for this phrase
    const base = o.basePitch * (phrase.shout ? 1.15 : 1);
    const R = o.range * (phrase.shout ? 1.2 : 1) * (phrase.end === '!' ? 1.15 : 1);
    const span = Math.max(0.2, phraseEndT - phraseStartT);
    const top = (tt: number) => base * (1 + 0.5 * R - 0.25 * R * ((tt - phraseStartT) / span));
    const bot = (tt: number) => base * (1 - 0.1 * ((tt - phraseStartT) / span));
    const at = (tt: number, frac: number) => bot(tt) + (top(tt) - bot(tt)) * frac;
    f0.push({ t: phraseStartT, hz: at(phraseStartT, 0.2) });
    vowelSegs.forEach((vs, n) => {
      const s = vs.seg.start, e = s + vs.seg.dur;
      const isLast = n === vowelSegs.length - 1;
      const strength = vs.f.emph ? 1.45 : 1;
      if (isLast) {
        if (phrase.end === '?') {
          f0.push({ t: s, hz: at(s, vs.accented ? 0.4 : 0.15) });
          f0.push({ t: e, hz: top(e) * 1.2 });
        } else if (phrase.end === ',') {
          f0.push({ t: s + 0.3 * (e - s), hz: at(s, vs.accented ? 0.8 * strength : 0.2) });
          f0.push({ t: e, hz: at(e, 0.45) });
        } else {
          if (vs.accented) {
            f0.push({ t: s, hz: at(s, 0.6) });
            f0.push({ t: s + 0.3 * (e - s), hz: at(s, 1.0 * strength) });
          } else f0.push({ t: s, hz: at(s, 0.25) });
          f0.push({ t: e, hz: base * (phrase.end === '!' ? 0.8 : phrase.end === '...' ? 0.85 : 0.72) });
        }
      } else if (vs.accented) {
        f0.push({ t: s, hz: at(s, 0.45) });
        f0.push({ t: s + 0.4 * (e - s), hz: at(s, Math.min(1.6, strength)) });
        f0.push({ t: e, hz: at(e, 0.55) });
      } else {
        f0.push({ t: s + 0.5 * (e - s), hz: at(s, vs.f.stress === 2 ? 0.35 : 0.15) });
      }
    });

    const pause = phrase.end === ',' ? 0.16 : phrase.end === '...' ? 0.55 : phrase.end === '?' ? 0.36 : phrase.end === '!' ? 0.3 : 0.36;
    phonLog.push(phrase.end === ',' ? '/' : '//');
    if (pi < phrases.length - 1) pushSil(pause / rate);
  });
  pushSil(0.12);
  f0.sort((a, b) => a.t - b.t);
  if (!f0.length) f0.push({ t: 0, hz: o.basePitch });
  return { segs, f0, duration: t, phonemes: phonLog.join(' ') };
}
