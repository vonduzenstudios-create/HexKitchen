# Hex Kitchen

A first-person cooking horror comedy for the browser. You are a contestant on **Hex Kitchen**, hosted by Gorgon Ramsey, a furious celebrity chef with a head of hissing snakes. Cook three rounds with your own hands, don't meet his gaze, and try not to end up as kitchen decor.

Every model, texture, sound effect and music cue is generated in code. Gorgon's voice comes from a formant synthesizer, or from AI-generated recordings when they have been rendered (see below).

## Play

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Desktop Chrome, Edge or Firefox with mouse and keyboard. Headphones recommended.

Pushes to `main` publish the game to the `gh-pages` branch. To serve it, set **Settings > Pages > Source** to *Deploy from a branch*, branch `gh-pages`, folder `/ (root)`. It then lives at https://vonduzenstudios-create.github.io/HexKitchen/.

| Input | Action |
| --- | --- |
| WASD + mouse | Move and look |
| Shift | Sprint |
| Click | Grab, place, or drop. Flick the mouse while dropping to throw |
| Hold click on a station | Work it: swipe down on the beat to chop, shake left-right to season, flick up to flip |
| Right click | Raise the polished pan (hanging by the cutting board) to reflect Gorgon's gaze |
| Space or C | Crouch behind counters for cover |
| E | Serve the plate you're looking at, or every plate when near the pass |
| Click a counter | Set what you're holding down there (leaving things lying about counts as mess) |
| Q | Drop what you're holding |
| F | Take off the oven mitts and hang them back up (click the hook to put them on). Needed for hot pans, pots, the fryer and the oven, but they make chopping, seasoning and flipping much harder |
| Hold click with the extinguisher | Spray it at a fire |
| Plating Mode | Mouse moves the cursor; click picks up and sets down, scroll rotates, right-click or 1-4 switches tool (arrange, sauce, garnish, wipe), Shift for fine control, E to finish |

## Episodes

Pick the episode on the title screen (or open the page with `?ep=2`).

### Episode 1: The Audition

The **What to do** list on the right walks you through each dish one step at a time, with a hint for the current step.

| Round | Time | Dish |
| --- | --- | --- |
| 1. The Appetizer | 4:00 | Cursed Caesar: chop and season lettuce, chop bread into croutons |
| 2. Dinner Rush | 6:00 | Steak & Fries (season and pan-fry the steak, chop and deep-fry potato) and Spaghetti Pomodoro (boil pasta, dice tomato) at the same time |
| 3. The Final Judgment | 5:00 | Medusa Wellington: season and sear beef, chop mushrooms, boil green beans. Gorgon tastes it and decides your fate |

**Plating Mode.** Serving a complete dish opens a short close-up where you arrange the components, swipe one stroke of sauce, add a pinch of garnish and wipe the rim before the timer runs out. The plating grade (Cafeteria up to Gorgon Approved) counts for 20% of the dish score.

**Chaos.** Dropped plates shatter, an unattended pan or fryer catches fire and spreads along the counter (use the extinguisher), sprinting into the rickety shelf knocks its ingredients everywhere, and grabbing hot food without oven mitts burns you.

**Judging.** At the end of every round Gorgon tastes every contestant's dish. Yours has to clear the **pass mark**, which rises with his Wrath, and beat at least one rival. The worst cook in the kitchen is turned to stone, and if that's you, the run is over. From round 2 on he sometimes misses a flaw, but a diner will send the dish back.

**Mess.** Dropped food and kit stay where they fall, and anything left lying on a counter counts too. The Mess meter shows it, and whatever Gorgon can see raises his Wrath until you bin it or put it away. Pick dropped food up within five seconds and the dish only takes a small hit, unless he watched you do it.

**Wrath stages** (Calm, Irritated, Furious, Petrifying Rage) change how Gorgon behaves: he hears loud noises from further away, walks over to investigate, and loses it if he finds a mess. His gaze always gets a warning ring around the crosshair: hide, look away or reflect it.

**Gorgon's Wrath** rises with bad dishes, burnt food, dropped food and fires, and makes his interruptions more frequent. **Petrification** rises when you fail dishes or meet his gaze; at 100% you become a statue. Perfect dishes calm him and chip the stone away.

His interruptions: **inspections** (turn around and show him what you're holding), the **petrifying gaze** (look away, hide behind a counter, or reflect it with the polished pan right as it lands), **sabotage** (he knocks food off your station or bins your plate). Frozen rivals stay in your kitchen as statues.

### Episode 2: The Last Resort

You've been promoted upstairs to a cursed hotel restaurant. A service hatch looks out over a dining room of petrified guests, the tall windows sometimes show something that shouldn't be there, and the kitchen has an oven.

| Round | Time | Dish |
| --- | --- | --- |
| 1. Continental Dreadfast | 4:30 | Tomato toast: slice the sourdough, chop a tomato, top the toast and bake it |
| 2. Room Service | 7:00 | Stuffed Mushrooms (top mushrooms with grated cheese, bake) and Steak & Roast Potatoes (pan-fried steak, seasoned potatoes baked in the oven) |
| 3. The Honeymoon Suite | 6:00 | A pastry-wrapped Wellington: sear the beef, lay it and chopped mushroom on the pastry, bake, with boiled green beans |

**Oven cooking.** Hold a part and click its base to assemble (glowing rings show where it goes). Set food on a sheet tray from the rack beside the oven and slide the tray in. The clip-on timer counts down and dings when it's ready; the oven light, browning and sizzle tell you too, and the ready window is generous. Use oven mitts to take hot food out. A dropped tray spills everything on it.

**Service Inspection.** Every so often Gorgon announces he's checking the oven and plants himself beside it on your side. Go round the island, do something else, or ring the desk bell to lure him away (he tires of it fast). He always steps aside once food is ready.

**Hotel gags.** The service trolley rolls when its red wheel locks are off (click it to toggle) and dumps its load if it crashes. The toaster rattles before it launches the toast: catch it, or land it on a plate for applause. The ticket printer spits out guests' requests.

**Plating feedback.** During plating, a "Gorgon wants" tip names the best next fix, rings on the plate show what's off-centre, crowded or touching the rim, and the result lists what to try next time.

## Gorgon's recorded voice

Gorgon can use a designed AI chef voice (not a clone of anyone) from ElevenLabs instead of the synthesizer. Add an `ELEVENLABS_API_KEY` Actions secret, put your voice ID in `voice.config.json`, and push. The **Voice** workflow renders every line in `src/game/lines.ts` to `public/voice/`, commits them and redeploys. Lines without a recording fall back to the synth. Locally: `ELEVENLABS_API_KEY=... node --experimental-strip-types scripts/generate-voice.mjs`.

## Tech

- [three.js](https://threejs.org/) rendering with physically based materials, soft shadows from the shop lights, image-based reflections, multisampled HDR and ACES tone mapping. Add `?gfx=low` to the URL to turn off shadows and multisampling on weak GPUs
- [Rapier](https://rapier.rs/) physics for every ingredient and the player controller
- Web Audio API for everything you hear: synthesized SFX, a procedural step-sequencer soundtrack, and a formant speech synthesizer for Gorgon's voice
- Vite + TypeScript

```
src/
  engine/      renderer, PSX materials, procedural textures, input, physics
  game/        kitchen, ingredients, stations, recipes and scoring, Gorgon's AI, rivals, episode flow
  characters/  code-built Gorgon, rival contestants and first-person hands
  audio/       SFX, music, voice synthesis
  ui/          HUD and screens
```
