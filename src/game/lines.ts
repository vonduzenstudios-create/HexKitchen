// Gorgon Ramsey's dialogue. All original lines written in the style of a furious TV chef.
// CAPS words are emphasised by the voice synth.

export type LineKey =
  | 'intro'
  | 'round1'
  | 'round2'
  | 'round3'
  | 'hurry'
  | 'perfect'
  | 'good'
  | 'poor'
  | 'raw'
  | 'burnt'
  | 'oversalted'
  | 'bland'
  | 'missing'
  | 'floor'
  | 'uneven'
  | 'timeout'
  | 'inspectStart'
  | 'inspectGood'
  | 'inspectBad'
  | 'inspectEmpty'
  | 'gazeWarn'
  | 'gazeCaught'
  | 'gazeSurvived'
  | 'reflected'
  | 'mistimed'
  | 'sabotageKnock'
  | 'sabotageBin'
  | 'sabotageSlam'
  | 'stoneCold'
  | 'fire'
  | 'dropped'
  | 'hitByFood'
  | 'tasteStart'
  | 'verdictWin'
  | 'verdictLose'
  | 'petrified'
  | 'shakerLid';

export const LINES: Record<LineKey, string[]> = {
  intro: [
    "Welcome to HEX Kitchen. Three rounds. One survivor. Everyone else becomes DECOR.",
  ],
  round1: [
    "Round one, the appetizer. A Caesar salad. Even a STATUE could make it. Go!",
  ],
  round2: [
    "Dinner rush! Steak and fries, AND spaghetti. At the same time. Move it!",
  ],
  round3: [
    "The final judgment. My signature Medusa Wellington. Get it wrong and you join the furniture.",
  ],
  hurry: [
    "Faster! My grandmother cooks faster, and she's a STATUE!",
    "Come on, come on, COME ON!",
    "Tick tock! The customers are turning to stone out there!",
    "Are you cooking or are you MEDITATING?",
    "Move! I've seen glaciers with more urgency!",
    "Hands! Use your HANDS! That's what they're for!",
  ],
  perfect: [
    "Finally! Somebody in this kitchen can actually cook!",
    "That... is bloody delicious. Don't let it go to your head.",
    "Perfect. I'm almost disappointed I can't scream at you.",
    "Beautiful. You may keep your flesh. For now.",
  ],
  good: [
    "Not bad. Not great. But not bad.",
    "Acceptable. Barely. Keep going.",
    "Right, that's edible. Next!",
  ],
  poor: [
    "What is this? It looks like it lost a fight with a blender!",
    "I wouldn't feed this to my SNAKES!",
    "Mediocre! Is mediocre your signature dish?",
  ],
  raw: [
    "It's RAW! This lamb is so raw it's still bleating!",
    "RAW! I've seen cows hurt worse than this and still win the vet's award!",
    "It's so raw it just asked me for directions back to the farm!",
  ],
  burnt: [
    "BURNT! You've cremated it! Shall we hold a funeral?",
    "This is charcoal! Are we cooking or are we having a BARBECUE in hell?",
    "I asked for a meal, not a FOSSIL!",
  ],
  oversalted: [
    "You've seasoned this with your TEARS! It's the Dead Sea on a plate!",
    "So much salt my snakes are dehydrating just LOOKING at it!",
  ],
  bland: [
    "Bland! Season it! Have you never met salt?",
    "This tastes like wet cardboard and broken dreams!",
  ],
  missing: [
    "Where's the rest of it? Did you EAT it?",
    "Half a dish! Do I look like I want HALF a dish?",
  ],
  floor: [
    "Did this fall on the FLOOR? I can taste the TILES!",
    "Five second rule? In MY kitchen? Absolutely not!",
  ],
  uneven: [
    "Look at these cuts! Did you chop it with a SPOON?",
    "Uneven! Chunky! Pathetic! Like your career!",
  ],
  timeout: [
    "Time's up! Nothing on the pass! Absolutely NOTHING!",
    "The customers have left. Some of them turned to stone waiting!",
  ],
  inspectStart: [
    "Right. Show me what you've got.",
    "Inspection! Let me see it. NOW.",
    "Hold it up. Let me look at this disaster.",
  ],
  inspectGood: [
    "Hmm. Fine. Carry on.",
    "That actually looks... promising. Don't ruin it.",
  ],
  inspectBad: [
    "What is THAT? Get it together!",
    "Disgusting! You call that food? I call it EVIDENCE!",
    "You absolute donkey! Start again!",
  ],
  inspectEmpty: [
    "Empty hands? EMPTY HANDS? Where is the FOOD?",
    "Nothing? You've got NOTHING? Brilliant.",
  ],
  gazeWarn: [
    "Look at me. LOOK AT ME!",
    "Eyes up, chef!",
    "Look me in the eyes and tell me that's cooked!",
  ],
  gazeCaught: [
    "That's it. Stiffen up. You're turning to STONE!",
    "Never look a gorgon in the eye, you DONUT!",
  ],
  gazeSurvived: [
    "Hmph. Clever. Get back to work!",
    "Can't even look at me? Good. You shouldn't.",
  ],
  reflected: [
    "ARGH! My own eyes! Who polished that bloody PAN?",
    "AAGH! I'm GORGEOUS! I mean... I'm STUNNED!",
  ],
  mistimed: [
    "Too slow with the pan! Ha!",
  ],
  sabotageKnock: [
    "Messy station, messy mind! Clean it UP!",
    "Oops! Did I do that? Remake it!",
  ],
  sabotageBin: [
    "That plate is an insult. In the BIN! Start again!",
  ],
  sabotageSlam: [
    "WAKE UP! Do you hear me? WAKE UP!",
  ],
  stoneCold: [
    "You. You're DONE. Take off your apron... oh wait, you can't. You're STONE.",
    "That was the worst dish I've ever tasted. Enjoy your new career as a coat rack.",
    "You're out! Permanently! Somebody fetch a feather duster!",
  ],
  fire: [
    "FIRE! There's a FIRE! Did you think this was a FLAMBE?",
    "Brilliant, you've set the kitchen on fire. Very rustic!",
  ],
  dropped: [
    "Butterfingers!",
    "Gravity one, you nil!",
    "Is the floor HUNGRY?",
  ],
  hitByFood: [
    "Did you just THROW food at me? In MY kitchen?",
    "You'll pay for that, you cheeky little sausage!",
  ],
  tasteStart: [
    "Right. My signature dish. Let's see if you deserve to keep your skin.",
  ],
  verdictWin: [
    "That... is a Wellington. A REAL Wellington. You win. Now get out of my kitchen before I change my mind!",
  ],
  verdictLose: [
    "That is the worst Wellington I have ever tasted. Look at me. LOOK AT ME!",
  ],
  petrified: [
    "And THAT is why you never look a chef in the eye. Next!",
    "Another statue for the collection. Somebody move it by the window.",
  ],
  shakerLid: [
    "The lid fell OFF? You've just salted the entire OCEAN!",
  ],
};

const last = new Map<LineKey, number>();
/** Pick a random line, avoiding the one used last time for this key. */
export function pickLine(key: LineKey): string {
  const pool = LINES[key];
  if (pool.length === 1) return pool[0];
  let i = Math.floor(Math.random() * pool.length);
  if (i === last.get(key)) i = (i + 1) % pool.length;
  last.set(key, i);
  return pool[i];
}
