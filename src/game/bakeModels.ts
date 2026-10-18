// Episode 2 (The Last Resort) oven models. Implemented in ingredients.ts, where the shared
// procedural geometry/texture helpers live; re-exported here as the public entry point.
//
// Every model: origin at the centre of its base, base at y = 0, real scale in metres.
// Browning meshes carry userData.tint = true and userData.cooked = <hex target colour>.
export {
  TRAY_SIZE,
  BAKE_COOKED,
  buildTray,
  buildWrappedWellington,
  buildStuffedMushroom,
  buildTomatoToast,
  buildRoastPotatoes,
  sourdoughSliceTop,
} from './ingredients';
