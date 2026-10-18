// Shared public types for the audio module.

export interface Vec3Like { x: number; y: number; z: number }

export type SfxName =
  | 'chop' | 'chopMiss' | 'pickup' | 'drop' | 'clang' | 'thud' | 'squish' | 'shake' | 'plate'
  | 'bell' | 'footstep' | 'doorSlam' | 'hiss' | 'stoneCrack' | 'petrifyTick' | 'reflect' | 'stun'
  | 'gasp' | 'laugh' | 'applause' | 'boo' | 'whoosh' | 'flip' | 'splash' | 'tick' | 'roundStart'
  | 'roundEnd' | 'slam' | 'ding' | 'eyeGlow' | 'fireIgnite' | 'buzzer' | 'click';

export const SFX_NAMES: readonly SfxName[] = [
  'chop', 'chopMiss', 'pickup', 'drop', 'clang', 'thud', 'squish', 'shake', 'plate',
  'bell', 'footstep', 'doorSlam', 'hiss', 'stoneCrack', 'petrifyTick', 'reflect', 'stun',
  'gasp', 'laugh', 'applause', 'boo', 'whoosh', 'flip', 'splash', 'tick', 'roundStart',
  'roundEnd', 'slam', 'ding', 'eyeGlow', 'fireIgnite', 'buzzer', 'click',
];

export type LoopName = 'sizzle' | 'boil' | 'fryer' | 'fire' | 'ambience' | 'heartbeat';
export const LOOP_NAMES: readonly LoopName[] = ['sizzle', 'boil', 'fryer', 'fire', 'ambience', 'heartbeat'];

export interface PlayOpts { pos?: Vec3Like; volume?: number; pitch?: number }

export interface LoopHandle {
  setVolume(v: number): void;
  setPosition(p: Vec3Like): void;
  setPitch(p: number): void;
  stop(): void;
}

export type MusicMode = 'menu' | 'round' | 'boss' | 'tasting' | 'victory' | 'gameover' | 'silent';
export type StingKind = 'dread' | 'success' | 'fail' | 'jumpscare';

export interface SayOpts { pos?: Vec3Like; pitch?: number; rate?: number; growl?: number }
