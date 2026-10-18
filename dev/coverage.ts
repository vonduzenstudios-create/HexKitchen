// Lists words from the game script (src/game/lines.ts) that are not in the dictionary (LTS fallback), with their LTS output.
import { readFileSync } from 'node:fs';
import { getDict } from '../src/audio/voice/dict';
import { wordToPhones } from '../src/audio/voice/g2p';
const src = readFileSync(process.cwd() + '/src/game/lines.ts', 'utf8');
const words = new Set((src.match(/"[^"]*"/g) || []).join(' ').toUpperCase().match(/[A-Z]+(?:'[A-Z]+)?/g) || []);
const d = getDict();
const miss = [...words].filter((w) => !d.has(w)).sort();
console.log('dictionary size', d.size, 'script words', words.size, 'not in dict', miss.length);
for (const w of miss) console.log(w.padEnd(16), wordToPhones(w).map((p) => p.p + (p.stress || '')).join(' '));
