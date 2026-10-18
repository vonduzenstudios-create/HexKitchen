// Letter-to-sound rules in the style of the NRL report (Elovitz, Johnson, McHugh & Shore, 1976),
// rewritten to output ARPAbet. Each rule is [left context, match, right context, phonemes].
// Context symbols:
//   ' ' word boundary        '#' one or more vowels      '.' a voiced consonant (B D V G J L M N R W Z)
//   '%' suffix (ER E ES ED ING ELY)  '&' sibilant (S C G Z X J CH SH)
//   '@' consonant that makes long-u sound like "oo" (T S R D L Z N J TH CH SH)
//   '^' one consonant        '+' front vowel (E I Y)     ':' zero or more consonants
//   '*' one or more consonants
// Anything else matches literally.

type Rule = [string, string, string, string];

const R: Record<string, Rule[]> = {
  A: [
    [' ', 'A', ' ', 'AX'],
    [' ', 'ARE', ' ', 'AA R'],
    [' ', 'AR', 'O', 'AX R'],
    ['', 'AR', '#', 'EH R'],
    ['^', 'AS', '#', 'EY S'],
    ['', 'A', 'WA', 'AX'],
    ['', 'AW', '', 'AO'],
    [' :', 'ANY', '', 'EH N IY'],
    ['', 'A', '^+#', 'EY'],
    ['#:', 'ALLY', '', 'AX L IY'],
    [' ', 'AL', '#', 'AX L'],
    ['', 'AGAIN', '', 'AX G EH N'],
    ['#:', 'AG', 'E', 'IH JH'],
    ['', 'A', '^+:#', 'AE'],
    [' :', 'A', '^+ ', 'EY'],
    ['', 'A', '^%', 'EY'],
    [' ', 'ARR', '', 'AX R'],
    ['', 'ARR', '', 'AE R'],
    [' :', 'AR', ' ', 'AA R'],
    ['', 'AR', ' ', 'ER'],
    ['', 'AR', '', 'AA R'],
    ['', 'AIR', '', 'EH R'],
    ['', 'AI', '', 'EY'],
    ['', 'AY', '', 'EY'],
    ['', 'AU', '', 'AO'],
    ['#:', 'AL', ' ', 'AX L'],
    ['#:', 'ALS', ' ', 'AX L Z'],
    ['', 'ALK', '', 'AO K'],
    ['', 'AL', '^', 'AO L'],
    [' :', 'ABLE', '', 'EY B AX L'],
    ['', 'ABLE', '', 'AX B AX L'],
    ['', 'ANG', '+', 'EY N JH'],
    ['', 'ATION', '', 'EY SH AX N'],
    ['', 'A', '', 'AE'],
  ],
  B: [
    [' ', 'BE', '^#', 'B IH'],
    ['', 'BEING', '', 'B IY IH NG'],
    [' ', 'BOTH', ' ', 'B OW TH'],
    [' ', 'BUS', '#', 'B IH Z'],
    ['', 'BUIL', '', 'B IH L'],
    ['M', 'B', ' ', ''],
    ['', 'BB', '', 'B'],
    ['', 'B', '', 'B'],
  ],
  C: [
    [' ', 'CH', '^', 'K'],
    ['^E', 'CH', '', 'K'],
    ['', 'CH', '', 'CH'],
    [' S', 'CI', '#', 'S AY'],
    ['', 'CI', 'A', 'SH'],
    ['', 'CI', 'O', 'SH'],
    ['', 'CI', 'EN', 'SH'],
    ['', 'C', '+', 'S'],
    ['', 'CK', '', 'K'],
    ['', 'COM', '%', 'K AH M'],
    ['', 'CC', '+', 'K S'],
    ['', 'CC', '', 'K'],
    ['', 'C', '', 'K'],
  ],
  D: [
    ['#:', 'DED', ' ', 'D IH D'],
    ['.E', 'D', ' ', 'D'],
    ['#:^E', 'D', ' ', 'T'],
    [' ', 'DE', '^#', 'D IH'],
    [' ', 'DO', ' ', 'D UW'],
    [' ', 'DOES', '', 'D AH Z'],
    [' ', 'DOING', '', 'D UW IH NG'],
    [' ', 'DOW', '', 'D AW'],
    ['', 'DU', 'A', 'JH UW'],
    ['', 'DD', '', 'D'],
    ['', 'DG', '+', 'JH'],
    ['', 'D', '', 'D'],
  ],
  E: [
    ['#:', 'E', ' ', ''],
    [' :', 'E', ' ', 'IY'],
    ['#', 'ED', ' ', 'D'],
    ['#:', 'E', 'D ', ''],
    ['', 'EV', 'ER', 'EH V'],
    ['', 'E', '^%', 'IY'],
    ['', 'ERI', '#', 'IY R IY'],
    ['', 'ERI', '', 'EH R IH'],
    ['#:', 'ER', '#', 'ER'],
    ['', 'ER', '#', 'EH R'],
    ['', 'ER', '', 'ER'],
    [' ', 'EVEN', '', 'IY V EH N'],
    ['#:', 'E', 'W', ''],
    ['@', 'EW', '', 'UW'],
    ['', 'EW', '', 'Y UW'],
    ['', 'E', 'O', 'IY'],
    ['#:&', 'ES', ' ', 'IH Z'],
    ['#:', 'E', 'S ', ''],
    ['#:', 'ELY', ' ', 'L IY'],
    ['#:', 'EMENT', '', 'M EH N T'],
    ['', 'EFUL', '', 'F UH L'],
    ['', 'EE', '', 'IY'],
    ['', 'EARN', '', 'ER N'],
    [' ', 'EAR', '^', 'ER'],
    ['', 'EAD', '', 'EH D'],
    ['#:', 'EA', ' ', 'IY AX'],
    ['', 'EA', 'SU', 'EH'],
    ['', 'EA', '', 'IY'],
    ['', 'EIGH', '', 'EY'],
    ['', 'EI', '', 'IY'],
    [' ', 'EYE', '', 'AY'],
    ['', 'EY', '', 'IY'],
    ['', 'EU', '', 'Y UW'],
    ['', 'E', '', 'EH'],
  ],
  F: [
    ['', 'FUL', '', 'F UH L'],
    ['', 'FF', '', 'F'],
    ['', 'F', '', 'F'],
  ],
  G: [
    ['', 'GIV', '', 'G IH V'],
    [' ', 'G', 'I^', 'G'],
    ['', 'GE', 'T', 'G EH'],
    ['SU', 'GGES', '', 'G JH EH S'],
    ['', 'GG', '', 'G'],
    [' B#', 'G', '', 'G'],
    ['', 'G', '+', 'JH'],
    ['', 'GREAT', '', 'G R EY T'],
    ['#', 'GH', '', ''],
    [' ', 'GN', '', 'N'],
    ['', 'GN', ' ', 'N'],
    ['', 'G', '', 'G'],
  ],
  H: [
    [' ', 'HAV', '', 'HH AE V'],
    [' ', 'HERE', '', 'HH IY R'],
    [' ', 'HOUR', '', 'AW ER'],
    ['', 'HOW', '', 'HH AW'],
    ['', 'H', '#', 'HH'],
    ['', 'H', '', ''],
  ],
  I: [
    [' ', 'IN', '', 'IH N'],
    [' ', 'I', ' ', 'AY'],
    ['', 'IN', 'D', 'AY N'],
    ['', 'IER', '', 'IY ER'],
    ['#:R', 'IED', '', 'IY D'],
    ['', 'IED', ' ', 'AY D'],
    ['', 'IEN', '', 'IY EH N'],
    ['', 'IE', 'T', 'AY EH'],
    [' :', 'I', '%', 'AY'],
    ['', 'I', '%', 'IY'],
    ['', 'IE', '', 'IY'],
    ['', 'I', '^+:#', 'IH'],
    ['', 'IR', '#', 'AY R'],
    ['', 'IZ', '%', 'AY Z'],
    ['', 'IS', '%', 'AY Z'],
    ['', 'I', 'D%', 'AY'],
    ['+^', 'I', '^+', 'IH'],
    ['', 'I', 'T%', 'AY'],
    ['#:^', 'I', '^+', 'IH'],
    ['', 'IR', '', 'ER'],
    ['', 'IGH', '', 'AY'],
    ['', 'ILD', '', 'AY L D'],
    ['', 'IGN', ' ', 'AY N'],
    ['', 'IGN', '^', 'AY N'],
    ['', 'IGN', '%', 'AY N'],
    ['', 'IQUE', '', 'IY K'],
    ['', 'I', '', 'IH'],
  ],
  J: [['', 'J', '', 'JH']],
  K: [
    [' ', 'K', 'N', ''],
    ['', 'K', '', 'K'],
  ],
  L: [
    ['', 'LO', 'C#', 'L OW'],
    ['L', 'L', '', ''],
    ['#:^', 'L', '%', 'AX L'],
    ['', 'LEAD', '', 'L IY D'],
    ['', 'L', '', 'L'],
  ],
  M: [
    ['', 'MOV', '', 'M UW V'],
    ['', 'MM', '', 'M'],
    ['', 'M', '', 'M'],
  ],
  N: [
    ['E', 'NG', '+', 'N JH'],
    ['', 'NG', 'R', 'NG G'],
    ['', 'NG', '#', 'NG G'],
    ['', 'NGL', '%', 'NG G AX L'],
    ['', 'NG', '', 'NG'],
    ['', 'NK', '', 'NG K'],
    [' ', 'NOW', ' ', 'N AW'],
    ['', 'NN', '', 'N'],
    ['', 'N', '', 'N'],
  ],
  O: [
    ['', 'OF', ' ', 'AX V'],
    ['', 'OROUGH', '', 'ER OW'],
    ['#:', 'OR', ' ', 'ER'],
    ['#:', 'ORS', ' ', 'ER Z'],
    ['', 'OR', '', 'AO R'],
    [' ', 'ONE', '', 'W AH N'],
    ['', 'OW', '', 'OW'],
    [' ', 'OVER', '', 'OW V ER'],
    ['', 'OV', '', 'AH V'],
    ['', 'O', '^%', 'OW'],
    ['', 'O', '^EN', 'OW'],
    ['', 'O', '^I#', 'OW'],
    ['', 'OL', 'D', 'OW L'],
    ['', 'OUGHT', '', 'AO T'],
    ['', 'OUGH', '', 'AH F'],
    [' ', 'OU', '', 'AW'],
    ['H', 'OU', 'S#', 'AW'],
    ['', 'OUS', '', 'AX S'],
    ['', 'OUR', '', 'AO R'],
    ['', 'OULD', '', 'UH D'],
    ['^', 'OU', '^L', 'AH'],
    ['', 'OUP', '', 'UW P'],
    ['', 'OU', '', 'AW'],
    ['', 'OY', '', 'OY'],
    ['', 'OING', '', 'OW IH NG'],
    ['', 'OI', '', 'OY'],
    ['', 'OOR', '', 'AO R'],
    ['', 'OOK', '', 'UH K'],
    ['', 'OOD', '', 'UH D'],
    ['', 'OO', '', 'UW'],
    ['', 'O', 'E', 'OW'],
    ['', 'O', ' ', 'OW'],
    ['', 'OA', '', 'OW'],
    [' ', 'ONLY', '', 'OW N L IY'],
    [' ', 'ONCE', '', 'W AH N S'],
    ['', "ON'T", '', 'OW N T'],
    ['C', 'O', 'N', 'AA'],
    ['', 'O', 'NG', 'AO'],
    [' :^', 'O', 'N', 'AH'],
    ['I', 'ON', '', 'AX N'],
    ['#:', 'ON', ' ', 'AX N'],
    ['#^', 'ON', '', 'AX N'],
    ['', 'O', 'ST ', 'OW'],
    ['', 'OF', '^', 'AO F'],
    ['', 'OTHER', '', 'AH DH ER'],
    ['', 'OSS', ' ', 'AO S'],
    ['#:^', 'OM', '', 'AH M'],
    ['', 'O', '', 'AA'],
  ],
  P: [
    ['', 'PH', '', 'F'],
    ['', 'PEOP', '', 'P IY P'],
    ['', 'POW', '', 'P AW'],
    ['', 'PUT', ' ', 'P UH T'],
    ['', 'PP', '', 'P'],
    ['', 'P', '', 'P'],
  ],
  Q: [
    ['', 'QUAR', '', 'K W AO R'],
    ['', 'QUE', ' ', 'K'],
    ['', 'QU', '', 'K W'],
    ['', 'Q', '', 'K'],
  ],
  R: [
    [' ', 'RE', '^#', 'R IY'],
    ['', 'RR', '', 'R'],
    ['', 'R', '', 'R'],
  ],
  S: [
    ['', 'SH', '', 'SH'],
    ['#', 'SION', '', 'ZH AX N'],
    ['', 'SOME', '', 'S AH M'],
    ['#', 'SUR', '#', 'ZH ER'],
    ['', 'SUR', '#', 'SH ER'],
    ['#', 'SU', '#', 'ZH UW'],
    ['#', 'SSU', '#', 'SH UW'],
    ['#', 'SED', ' ', 'Z D'],
    ['#', 'S', '#', 'Z'],
    ['', 'SAID', '', 'S EH D'],
    ['^', 'SION', '', 'SH AX N'],
    ['', 'S', 'S', ''],
    ['.', 'S', ' ', 'Z'],
    ['#:.E', 'S', ' ', 'Z'],
    ['#:^##', 'S', ' ', 'Z'],
    ['#:^#', 'S', ' ', 'S'],
    ['U', 'S', ' ', 'S'],
    [' :#', 'S', ' ', 'Z'],
    [' ', 'SCH', '', 'S K'],
    ['', 'S', 'C+', ''],
    ['#', 'SM', '', 'Z M'],
    ['#', 'SN', "'", 'Z AX N'],
    ['', 'S', '', 'S'],
  ],
  T: [
    [' ', 'THE', ' ', 'DH AX'],
    ['', 'TO', ' ', 'T UW'],
    ['', 'THAT', ' ', 'DH AE T'],
    [' ', 'THIS', ' ', 'DH IH S'],
    [' ', 'THEY', '', 'DH EY'],
    [' ', 'THERE', '', 'DH EH R'],
    ['', 'THER', '', 'DH ER'],
    ['', 'THEIR', '', 'DH EH R'],
    [' ', 'THAN', ' ', 'DH AE N'],
    [' ', 'THEM', ' ', 'DH EH M'],
    ['', 'THESE', ' ', 'DH IY Z'],
    [' ', 'THEN', '', 'DH EH N'],
    ['', 'THROUGH', '', 'TH R UW'],
    ['', 'THOSE', '', 'DH OW Z'],
    ['', 'THOUGH', ' ', 'DH OW'],
    [' ', 'THUS', '', 'DH AH S'],
    ['', 'TH', '', 'TH'],
    ['#:', 'TED', ' ', 'T IH D'],
    ['S', 'TI', '#N', 'CH'],
    ['', 'TI', 'O', 'SH'],
    ['', 'TI', 'A', 'SH'],
    ['', 'TIEN', '', 'SH AX N'],
    ['', 'TUR', '#', 'CH ER'],
    ['', 'TU', 'A', 'CH UW'],
    [' ', 'TWO', '', 'T UW'],
    ['', 'TCH', '', 'CH'],
    ['', 'TT', '', 'T'],
    ['', 'T', '', 'T'],
  ],
  U: [
    [' ', 'UN', 'I', 'Y UW N'],
    [' ', 'UN', '', 'AH N'],
    [' ', 'UPON', '', 'AX P AO N'],
    ['@', 'UR', '#', 'UH R'],
    ['', 'UR', '#', 'Y UH R'],
    ['', 'UR', '', 'ER'],
    ['', 'U', '^ ', 'AH'],
    ['', 'U', '^^', 'AH'],
    ['', 'UY', '', 'AY'],
    [' G', 'U', '#', ''],
    ['G', 'U', '%', ''],
    ['G', 'U', '#', 'W'],
    ['#N', 'U', '', 'Y UW'],
    ['@', 'U', '', 'UW'],
    ['', 'U', '', 'Y UW'],
  ],
  V: [
    ['', 'VIEW', '', 'V Y UW'],
    ['', 'V', '', 'V'],
  ],
  W: [
    [' ', 'WERE', '', 'W ER'],
    ['', 'WA', 'S', 'W AA'],
    ['', 'WA', 'T', 'W AA'],
    ['', 'WHERE', '', 'W EH R'],
    ['', 'WHAT', '', 'W AA T'],
    ['', 'WHOL', '', 'HH OW L'],
    ['', 'WHO', '', 'HH UW'],
    ['', 'WH', '', 'W'],
    ['', 'WAR', '', 'W AO R'],
    ['', 'WOR', '^', 'W ER'],
    ['', 'WR', '', 'R'],
    ['', 'W', '', 'W'],
  ],
  X: [
    [' ', 'X', '', 'Z'],
    ['', 'X', '', 'K S'],
  ],
  Y: [
    ['', 'YOUNG', '', 'Y AH NG'],
    [' ', 'YOU', '', 'Y UW'],
    [' ', 'YES', '', 'Y EH S'],
    [' ', 'Y', '', 'Y'],
    ['#:^', 'Y', ' ', 'IY'],
    ['#:^', 'Y', 'I', 'IY'],
    [' :', 'Y', ' ', 'AY'],
    [' :', 'Y', '#', 'AY'],
    [' :', 'Y', '^+:#', 'IH'],
    [' :', 'Y', '^#', 'AY'],
    ['', 'Y', '', 'IH'],
  ],
  Z: [
    ['', 'ZZ', '', 'Z'],
    ['', 'Z', '', 'Z'],
  ],
};

const VOWELS = 'AEIOUY';
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXZ';
const VOICED = 'BDVGJLMNRWZ';
const isVowel = (c: string) => c !== '' && VOWELS.includes(c);
const isCons = (c: string) => c !== '' && CONSONANTS.includes(c);

/** Match right context starting at text[pos]. Returns true if the pattern matches. */
function matchRight(pat: string, text: string, pos: number): boolean {
  let p = pos;
  for (let i = 0; i < pat.length; i++) {
    const s = pat[i];
    const c = text[p] ?? ' ';
    switch (s) {
      case '#': if (!isVowel(c)) return false; while (isVowel(text[p] ?? '')) p++; break;
      case ':': while (isCons(text[p] ?? '')) p++; break;
      case '*': if (!isCons(c)) return false; while (isCons(text[p] ?? '')) p++; break;
      case '^': if (!isCons(c)) return false; p++; break;
      case '.': if (!VOICED.includes(c) || c === ' ') return false; p++; break;
      case '+': if (!'EIY'.includes(c) || c === ' ') return false; p++; break;
      case '&':
        if (c === 'C' || c === 'S') { if (text[p + 1] === 'H') { p += 2; break; } }
        if (!'SCGZXJ'.includes(c) || c === ' ') return false; p++; break;
      case '@':
        if ((c === 'T' || c === 'C' || c === 'S') && text[p + 1] === 'H') { p += 2; break; }
        if (!'TSRDLZNJ'.includes(c) || c === ' ') return false; p++; break;
      case '%': {
        const rest = text.slice(p);
        if (rest.startsWith('ING')) { p += 3; break; }
        if (rest.startsWith('ELY')) { p += 3; break; }
        if (rest.startsWith('ER') || rest.startsWith('ES') || rest.startsWith('ED')) { p += 2; break; }
        if (rest.startsWith('E')) { p += 1; break; }
        return false;
      }
      default: if (c !== s) return false; p++;
    }
  }
  return true;
}

/** Match left context ending at text[pos] (moving leftwards). */
function matchLeft(pat: string, text: string, pos: number): boolean {
  let p = pos;
  for (let i = pat.length - 1; i >= 0; i--) {
    const s = pat[i];
    const c = p >= 0 ? text[p] : ' ';
    switch (s) {
      case '#': if (!isVowel(c)) return false; while (p >= 0 && isVowel(text[p])) p--; break;
      case ':': while (p >= 0 && isCons(text[p])) p--; break;
      case '*': if (!isCons(c)) return false; while (p >= 0 && isCons(text[p])) p--; break;
      case '^': if (!isCons(c)) return false; p--; break;
      case '.': if (!VOICED.includes(c) || c === ' ') return false; p--; break;
      case '+': if (!'EIY'.includes(c) || c === ' ') return false; p--; break;
      case '&':
        if (c === 'H' && p > 0 && (text[p - 1] === 'C' || text[p - 1] === 'S')) { p -= 2; break; }
        if (!'SCGZXJ'.includes(c) || c === ' ') return false; p--; break;
      case '@':
        if (c === 'H' && p > 0 && 'TCS'.includes(text[p - 1])) { p -= 2; break; }
        if (!'TSRDLZNJ'.includes(c) || c === ' ') return false; p--; break;
      default: if (c !== s) return false; p--;
    }
  }
  return true;
}

/** Convert an uppercase word (letters and apostrophes) to ARPAbet phonemes without stress. */
export function lettersToSound(word: string): string[] {
  const text = ' ' + word.toUpperCase().replace(/[^A-Z']/g, '') + ' ';
  const out: string[] = [];
  let i = 1;
  while (i < text.length - 1) {
    const ch = text[i];
    const rules = R[ch];
    if (!rules) { i++; continue; } // apostrophes and anything unknown are silent
    let matched = false;
    for (const [left, m, right, ph] of rules) {
      if (!text.startsWith(m, i)) continue;
      if (!matchLeft(left, text, i - 1)) continue;
      if (!matchRight(right, text, i + m.length)) continue;
      if (ph) out.push(...ph.split(' '));
      i += m.length;
      matched = true;
      break;
    }
    if (!matched) i++;
  }
  return out;
}
