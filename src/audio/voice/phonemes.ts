// Phoneme -> acoustic targets for the formant synthesiser.
// Formant values are adult-male averages (Peterson & Barney / Klatt 1980), slightly stylised.

export type PhKind = 'vowel' | 'diph' | 'liquid' | 'glide' | 'nasal' | 'stop' | 'fric' | 'affric' | 'asp';
export type F3 = [number, number, number];

/** Noise-branch spectrum: two band-passes plus a flat (high-passed) bypass. */
export interface FricSpec { f1: number; bw1: number; g1: number; f2: number; bw2: number; g2: number; byp: number }

export interface PhDef {
  kind: PhKind;
  voiced: boolean;
  f: F3;            // formant target (or locus for obstruents)
  f2?: F3;          // diphthong end target
  bw: F3;
  av: number;       // voicing amplitude (linear, ~0..1)
  af: number;       // frication amplitude
  fric?: FricSpec;
  inh: number;      // inherent duration, ms
  min: number;      // minimum duration, ms
  burst?: { spec: FricSpec; amp: number; dur: number };
  vot?: number;     // aspiration after release (voiceless stops), ms
  fnz?: number;     // nasal zero frequency
  sib?: boolean;    // sibilant (for the snake hiss)
}

const BWV: F3 = [80, 100, 160];
const v = (f: F3, av: number, inh: number, min: number, f2?: F3): PhDef => ({
  kind: f2 ? 'diph' : 'vowel', voiced: true, f, f2, bw: BWV, av, af: 0, inh, min,
});

const S_SPEC: FricSpec = { f1: 5800, bw1: 1600, g1: 1, f2: 8200, bw2: 2500, g2: 0.55, byp: 0.04 };
const SH_SPEC: FricSpec = { f1: 2700, bw1: 900, g1: 1, f2: 4300, bw2: 1800, g2: 0.6, byp: 0.04 };
const F_SPEC: FricSpec = { f1: 3500, bw1: 4000, g1: 0.2, f2: 7000, bw2: 4000, g2: 0.15, byp: 0.5 };
const TH_SPEC: FricSpec = { f1: 5000, bw1: 4000, g1: 0.15, f2: 2800, bw2: 2500, g2: 0.08, byp: 0.3 };
const P_BURST: FricSpec = { f1: 800, bw1: 1400, g1: 1, f2: 2200, bw2: 2500, g2: 0.3, byp: 0.3 };
const T_BURST: FricSpec = { f1: 4300, bw1: 2200, g1: 1, f2: 2700, bw2: 800, g2: 0.45, byp: 0.25 };
const K_BURST: FricSpec = { f1: 2000, bw1: 400, g1: 1, f2: 3200, bw2: 1500, g2: 0.1, byp: 0.0 };

export const PH: Record<string, PhDef> = {
  IY: v([270, 2290, 3010], 0.8, 155, 55),
  IH: v([400, 1920, 2560], 0.85, 135, 40),
  EH: v([540, 1780, 2480], 0.95, 150, 70),
  AE: v([680, 1700, 2410], 1.0, 230, 80),
  AA: v([730, 1100, 2440], 1.0, 240, 100),
  AO: v([580, 860, 2410], 1.0, 240, 100),
  UH: v([450, 1050, 2240], 0.85, 160, 60),
  UW: v([320, 900, 2240], 0.8, 210, 70),
  AH: v([640, 1200, 2390], 0.95, 140, 60),
  AX: v([520, 1400, 2450], 0.75, 110, 50),
  ER: v([490, 1350, 1690], 0.9, 180, 80),
  EY: v([520, 1780, 2500], 1.0, 190, 100, [340, 2200, 2700]),
  AY: v([720, 1230, 2550], 1.0, 250, 150, [400, 1950, 2600]),
  OY: v([560, 900, 2400], 1.0, 280, 150, [400, 1900, 2600]),
  AW: v([720, 1250, 2550], 1.0, 260, 100, [450, 950, 2300]),
  OW: v([540, 1100, 2400], 0.95, 220, 80, [410, 870, 2300]),

  L: { kind: 'liquid', voiced: true, f: [330, 1150, 2800], bw: [60, 150, 250], av: 0.65, af: 0, inh: 80, min: 40 },
  R: { kind: 'liquid', voiced: true, f: [330, 1060, 1400], bw: [70, 100, 120], av: 0.7, af: 0, inh: 80, min: 30 },
  W: { kind: 'glide', voiced: true, f: [290, 610, 2150], bw: [60, 90, 150], av: 0.65, af: 0, inh: 80, min: 60 },
  Y: { kind: 'glide', voiced: true, f: [260, 2070, 3020], bw: [60, 100, 160], av: 0.65, af: 0, inh: 80, min: 40 },

  M: { kind: 'nasal', voiced: true, f: [280, 1100, 2150], bw: [80, 250, 300], av: 0.5, af: 0, inh: 70, min: 60, fnz: 750 },
  N: { kind: 'nasal', voiced: true, f: [280, 1650, 2500], bw: [80, 300, 300], av: 0.5, af: 0, inh: 60, min: 35, fnz: 1300 },
  NG: { kind: 'nasal', voiced: true, f: [280, 2000, 2650], bw: [80, 300, 300], av: 0.5, af: 0, inh: 95, min: 60, fnz: 1800 },

  B: { kind: 'stop', voiced: true, f: [200, 900, 2100], bw: [80, 120, 160], av: 0, af: 0, inh: 85, min: 60, burst: { spec: P_BURST, amp: 0.55, dur: 9 } },
  P: { kind: 'stop', voiced: false, f: [200, 900, 2100], bw: [80, 120, 160], av: 0, af: 0, inh: 90, min: 50, burst: { spec: P_BURST, amp: 0.9, dur: 10 }, vot: 45 },
  D: { kind: 'stop', voiced: true, f: [200, 1700, 2600], bw: [80, 120, 160], av: 0, af: 0, inh: 75, min: 50, burst: { spec: T_BURST, amp: 0.55, dur: 12 } },
  T: { kind: 'stop', voiced: false, f: [200, 1700, 2600], bw: [80, 120, 160], av: 0, af: 0, inh: 75, min: 50, burst: { spec: T_BURST, amp: 0.75, dur: 14 }, vot: 55 },
  G: { kind: 'stop', voiced: true, f: [200, 1900, 2400], bw: [80, 120, 160], av: 0, af: 0, inh: 80, min: 60, burst: { spec: K_BURST, amp: 0.6, dur: 18 } },
  K: { kind: 'stop', voiced: false, f: [200, 1900, 2400], bw: [80, 120, 160], av: 0, af: 0, inh: 80, min: 60, burst: { spec: K_BURST, amp: 1.6, dur: 25 }, vot: 60 },

  F: { kind: 'fric', voiced: false, f: [340, 1100, 2080], bw: [100, 120, 160], av: 0, af: 0.12, fric: F_SPEC, inh: 100, min: 80 },
  V: { kind: 'fric', voiced: true, f: [240, 1100, 2080], bw: [70, 150, 250], av: 0.5, af: 0.008, fric: F_SPEC, inh: 60, min: 40 },
  TH: { kind: 'fric', voiced: false, f: [320, 1290, 2540], bw: [100, 120, 160], av: 0, af: 0.1, fric: TH_SPEC, inh: 90, min: 60 },
  DH: { kind: 'fric', voiced: true, f: [270, 1290, 2540], bw: [70, 150, 250], av: 0.45, af: 0.004, fric: TH_SPEC, inh: 50, min: 30 },
  S: { kind: 'fric', voiced: false, f: [320, 1390, 2530], bw: [100, 120, 160], av: 0, af: 0.5, fric: S_SPEC, inh: 105, min: 60, sib: true },
  Z: { kind: 'fric', voiced: true, f: [280, 1390, 2530], bw: [80, 120, 160], av: 0.45, af: 0.3, fric: S_SPEC, inh: 75, min: 40, sib: true },
  SH: { kind: 'fric', voiced: false, f: [300, 1840, 2750], bw: [100, 120, 160], av: 0, af: 0.55, fric: SH_SPEC, inh: 105, min: 80, sib: true },
  ZH: { kind: 'fric', voiced: true, f: [280, 1840, 2750], bw: [80, 120, 160], av: 0.45, af: 0.32, fric: SH_SPEC, inh: 70, min: 40, sib: true },
  CH: { kind: 'affric', voiced: false, f: [300, 1840, 2750], bw: [100, 120, 160], av: 0, af: 0.55, fric: SH_SPEC, inh: 70, min: 50, burst: { spec: T_BURST, amp: 0.5, dur: 8 }, sib: true },
  JH: { kind: 'affric', voiced: true, f: [280, 1840, 2750], bw: [80, 120, 160], av: 0.4, af: 0.3, fric: SH_SPEC, inh: 70, min: 50, burst: { spec: T_BURST, amp: 0.35, dur: 8 }, sib: true },
  HH: { kind: 'asp', voiced: false, f: [500, 1500, 2500], bw: [200, 200, 250], av: 0, af: 0, inh: 80, min: 20 },
};

/** British (non-rhotic) NURSE vowel: no F3 lowering. */
export const ER_RP: PhDef = { ...PH.ER, f: [520, 1400, 2350] };

export function isVowelKind(k: PhKind): boolean { return k === 'vowel' || k === 'diph'; }
export function isSonorantKind(k: PhKind): boolean {
  return k === 'vowel' || k === 'diph' || k === 'liquid' || k === 'glide' || k === 'nasal';
}
