// Prints phoneme strings for sample lines. Run: node dev/run-node.mjs dev/g2p-test.ts
import { phonemeString, wordToPhones } from '../src/audio/voice/g2p';
import { lettersToSound } from '../src/audio/voice/rules';

const lines = [
  "This lamb is so raw it's still bleating!",
  'You DONKEY! Get out of my kitchen!',
  'Welcome to HEX Kitchen. Three rounds. One survivor.',
  'What are you? An idiot sandwich.',
  'Look me in the eyes and tell me that is cooked!',
  "You've seasoned this with your TEARS! It's the Dead Sea on a plate!",
  'My grandmother cooks faster, and she is a STATUE!',
  'The final judgment. My signature Medusa Wellington.',
  'Round 2: Dinner rush! Steak and fries, AND spaghetti.',
  'Disgusting! Pathetic! Bloody delicious!',
  'Burnt, cold, soggy, rubbery and oversalted.',
  'Finally, a perfect plate. Wonderful garnish. Service!',
  'Somebody sabotaged my mushroom risotto. Remake it NOW!',
  'You have 30 seconds, contestants. Come on, move it, go go go!',
  'Never look a gorgon in the eye, you DONUT!',
  'Where is the lamb sauce?',
  'I asked for a meal, not a FOSSIL!',
  'This tastes like wet cardboard and broken dreams!',
  'The customers have left. Some of them turned to stone waiting!',
  'Caesar salad for table 14, chef!',
];
for (const l of lines) {
  console.log(l);
  console.log('  ' + phonemeString(l));
}
console.log('\nLTS-only checks:');
for (const w of ['kitchen', 'stone', 'pathetic', 'disgusting', 'make', 'blender', 'chopping', 'fridge', 'spatula', 'cauldron', 'zombie', 'thunder', 'quickly', 'weather', 'nation', 'basket', 'sizzle', 'cutlery', 'whisk', 'garnished', 'smoked']) {
  console.log(`  ${w}: ${lettersToSound(w).join(' ')}  | full: ${wordToPhones(w).map((p) => p.p + (p.stress || '')).join(' ')}`);
}
