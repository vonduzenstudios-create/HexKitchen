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
| Space | Crouch behind counters for cover |
| E | Serve the plate you're looking at, or every plate when near the pass |
| Q | Drop what you're holding |

## The episode

The **What to do** list on the right walks you through each dish one step at a time, with a hint for the current step.

| Round | Time | Dish |
| --- | --- | --- |
| 1. The Appetizer | 4:00 | Cursed Caesar: chop and season lettuce, chop bread into croutons |
| 2. Dinner Rush | 6:00 | Steak & Fries (season and pan-fry the steak, chop and deep-fry potato) and Spaghetti Pomodoro (boil pasta, dice tomato) at the same time |
| 3. The Final Judgment | 5:00 | Medusa Wellington: season and sear beef, chop mushrooms, boil green beans. Gorgon tastes it and decides your fate |

**Gorgon's Wrath** rises with bad dishes, burnt food, dropped food and fires, and makes his interruptions more frequent. **Petrification** rises when you fail dishes or meet his gaze; at 100% you become a statue. Perfect dishes calm him and chip the stone away.

His interruptions: **inspections** (turn around and show him what you're holding), the **petrifying gaze** (look away, hide behind a counter, or reflect it with the polished pan right as it lands), **sabotage** (he knocks food off your station or bins your plate), and **Stone Cold** (after each round he petrifies a rival, whose statue stays in your kitchen).

## Gorgon's recorded voice

Gorgon can use a designed AI chef voice (not a clone of anyone) from ElevenLabs instead of the synthesizer. Add an `ELEVENLABS_API_KEY` Actions secret, put your voice ID in `voice.config.json`, and push. The **Voice** workflow renders every line in `src/game/lines.ts` to `public/voice/`, commits them and redeploys. Lines without a recording fall back to the synth. Locally: `ELEVENLABS_API_KEY=... node --experimental-strip-types scripts/generate-voice.mjs`.

## Tech

- [three.js](https://threejs.org/) rendering with a PS1-style pipeline: 240p render target, vertex snapping, 5-bit colour with ordered dithering, fog
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
