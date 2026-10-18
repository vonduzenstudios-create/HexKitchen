// Gorgon Ramsey's dialogue. All original lines written in the style of a furious TV chef.
// CAPS words are emphasised by the voice synth.

export type LineKey =
  | 'underbaked'
  | 'resortIntro'
  | 'resort1'
  | 'resort2'
  | 'resort3'
  | 'resortTaste'
  | 'resortWin'
  | 'resortLose'
  | 'serviceInspection'
  | 'inspectionBump'
  | 'inspectionReady'
  | 'inspectionDone'
  | 'ovenEmpty'
  | 'deskBell'
  | 'deskBellAnnoyed'
  | 'deskBellFurious'
  | 'traySpill'
  | 'ovenBurning'
  | 'toastCatch'
  | 'toastLanding'
  | 'trolleyCrash'
  | 'pastryResting'
  | 'printerTicket'
  | 'openOvenInspection'
  | 'intro'
  | 'whatWasThat'
  | 'burnedHand'
  | 'fireSpread'
  | 'plateSmash'
  | 'platingRim'
  | 'platingSauce'
  | 'platingClutter'
  | 'platingBalance'
  | 'platingHurry'
  | 'platingGood'
  | 'platingStart'
  | 'platingGreat'
  | 'platingBad'
  | 'investigateNothing'
  | 'stageIrritated'
  | 'stageFurious'
  | 'stageRage'
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
  | 'floorPickup'
  | 'messSpotted'
  | 'judgeIntro'
  | 'judgeYouPass'
  | 'judgeYouFail'
  | 'sentBack'
  | 'fire'
  | 'dropped'
  | 'hitByFood'
  | 'tasteStart'
  | 'verdictWin'
  | 'verdictLose'
  | 'petrified'
  | 'shakerLid'
  | 'burning'
  | 'emptyPlate';

export const LINES: Record<LineKey, string[]> = {
  underbaked: [
    "That's pale and RAW in the middle! It needed more time in the oven!",
    "Underbaked! Did you even turn the oven ON?",
  ],
  resortIntro: [
    "Congratulations. You've been PROMOTED. Welcome to the Last Resort, where the guests never leave. Literally.",
  ],
  resort1: [
    "Round one, the Continental Dreadfast. Tomato toast. Chop it, top it, bake it. Even a breakfast buffet could do it.",
  ],
  resort2: [
    "Room service! Stuffed mushrooms, AND a steak with roast potatoes. Try serving it before the room becomes a tomb.",
  ],
  resort3: [
    "The Honeymoon Suite. A REAL Wellington this time. Wrapped in pastry. Your basement audition is over. Show me the complete thing.",
  ],
  resortTaste: [
    "The Honeymoon Wellington. Let's cut it open and see if you've earned the suite.",
  ],
  resortWin: [
    "Golden pastry. Pink in the middle. You actually did it. Fine. You can have the suite. Don't touch the minibar.",
  ],
  resortLose: [
    "Soggy bottom, grey beef. This Wellington is a CRIME scene. Check out time is NOW. Look at me!",
  ],
  serviceInspection: [
    "Service inspection! I'm checking that oven. Stay out of my way!",
    "Inspection! Nobody touches the oven while I'm looking at it!",
    "Right, service inspection. Let's see what you've got cooking.",
  ],
  inspectionBump: [
    "MIND YOUR BACK! I'm inspecting here!",
    "Don't shove past me, you donkey! Go around!",
  ],
  inspectionReady: [
    "That's READY! Get it out before it burns! Go on, I'll move!",
    "Are you deaf? The timer went! Take it out!",
  ],
  inspectionDone: [
    "Hmm. Carry on. For now.",
    "Inspection over. Don't make me come back.",
  ],
  ovenEmpty: [
    "An empty oven! Brilliant. Are you baking AIR?",
  ],
  deskBell: [
    "Who rang that? WHO RANG THAT BELL?",
    "Yes? You RANG? This had better be good.",
  ],
  deskBellAnnoyed: [
    "Ring that bell one more time and I'll ring YOUR neck.",
    "Stop ringing the bell! I'm not your BUTLER!",
  ],
  deskBellFurious: [
    "THAT'S IT! The next ding is going to be your HEAD hitting the floor!",
  ],
  traySpill: [
    "You dropped the WHOLE TRAY? Everything? At once? Spectacular!",
    "Look at the floor! That was a whole tray of food!",
  ],
  ovenBurning: [
    "Something's burning in that oven! Can't you SMELL it?",
    "The oven's smoking! Get it OUT!",
  ],
  toastCatch: [
    "Ha! Nice catch. Don't let it go to your head.",
  ],
  toastLanding: [
    "Straight onto the plate! Okay, THAT was impressive.",
  ],
  trolleyCrash: [
    "Lock the wheels on that trolley, you muppet! It's not a go-kart!",
  ],
  pastryResting: [
    "That pastry needs RESTING. You do not.",
    "Wrap it tight! A loose Wellington is a sad Wellington.",
  ],
  printerTicket: [
    "Another ticket. The guests are getting restless. Well, as restless as statues get.",
  ],
  openOvenInspection: [
    "Don't open the oven while I'm inspecting it! You're letting the heat out!",
  ],
  platingStart: [
    "Right. PLATE it. Make it look like food, not a crime scene.",
    "Presentation! People eat with their eyes first, you donkey!",
  ],
  platingRim: [
    "THAT RIM IS FILTHY! Wipe it!",
    "Look at the edge of that plate! Clean it!",
  ],
  platingSauce: [
    "DON'T DROWN IT IN SAUCE!",
    "One swipe of sauce! ONE! Not a finger painting!",
  ],
  platingClutter: [
    "LESS IS MORE, YOU DONKEY!",
    "It's all piled on top of itself! Give it some room!",
  ],
  platingBalance: [
    "WHY IS EVERYTHING ON ONE SIDE?",
    "Put the star of the dish in the MIDDLE!",
  ],
  platingHurry: [
    "Hurry UP! It's going COLD!",
    "Service! SERVICE! Get it on the pass!",
  ],
  platingGood: [
    "Hmm. Keep going. Don't ruin it.",
    "That's... not terrible. Finish it.",
  ],
  platingGreat: [
    "Now THAT is a plate. Gorgon approved.",
    "Beautiful. Finally. Was that so hard?",
  ],
  platingBad: [
    "IT LOOKS LIKE IT FELL DOWN THE STAIRS!",
    "That's not plating, that's a cafeteria tray!",
  ],
  plateSmash: [
    "That's a PLATE! Do you know what plates COST?",
    "Smashing plates? This isn't a Greek wedding!",
  ],
  fireSpread: [
    "It's SPREADING! Grab the extinguisher, you muppet!",
    "My kitchen is ON FIRE! The red thing! By the stove! USE IT!",
  ],
  burnedHand: [
    "Bare hands in a hot pan? Mitts! MITTS! They're right there!",
    "Ha! Now you know why we wear oven mitts, you donkey.",
  ],
  whatWasThat: [
    "WHAT was THAT?",
    "Oi! What did you just DROP?",
    "I HEARD that! Don't you DARE hide it!",
  ],
  investigateNothing: [
    "Hm. Nothing. Don't play games with me.",
    "Throwing things to distract me? Cheeky. And noted.",
  ],
  stageIrritated: [
    "Right. Now I'm irritated. Pick it UP!",
    "You're starting to get on my nerves.",
  ],
  stageFurious: [
    "That's it. I am FURIOUS!",
    "My snakes are hissing. That's never good, is it?",
  ],
  stageRage: [
    "Look at me. LOOK AT ME! Actually, don't...",
    "I'm going to turn this whole kitchen to STONE!",
  ],
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
  floorPickup: [
    "Did you just pick that up off the FLOOR? I SAW that! Five-second rule my backside!",
    "I watched you scrape that off the tiles! You want to serve FLOOR to my guests?",
  ],
  messSpotted: [
    "Look at this STATION! It's a pigsty! Put things back where they BELONG!",
    "Clean as you go! Is that so HARD? This kitchen looks like a crime scene!",
    "Why is there food lying everywhere? Bin it or use it!",
  ],
  judgeIntro: [
    "Right. Time to taste. Every dish. And the worst cook in this kitchen gets turned to STONE.",
    "Plates up! I taste everything, and whoever cooked the worst gets a new career as a statue.",
  ],
  judgeYouPass: [
    "Yours... is edible. You live. For now.",
    "Hmm. Not the worst. Which in this kitchen is practically a compliment.",
  ],
  judgeYouFail: [
    "And YOU. That was the worst thing I've tasted all night. Look into my eyes.",
    "You couldn't even beat the bar. Congratulations. You're the worst cook here.",
  ],
  sentBack: [
    "A table just SENT IT BACK! They found what I didn't! Do you know how that makes me LOOK?",
    "SENT BACK! From the dining room! You slipped that past me and the GUESTS caught it!",
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
    "NO! NO! That was FOOD! Now it's FLOOR!",
    "You DROPPED it? On MY floor? Get OUT! No, stay, and PICK IT UP!",
    "I've seen pigeons with better grip than you!",
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
  burning: [
    "It's BURNING! Can you not SMELL that?",
  ],
  emptyPlate: [
    "There's nothing on the plate! Are you serving me AIR?",
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
