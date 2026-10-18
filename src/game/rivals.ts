import * as THREE from 'three';
import { audio } from '../audio';
import { buildRival, type RivalAction, type RivalRig } from '../characters/rival';
import { Physics, GROUP } from '../engine/physics';
import type { Particles } from './particles';

export class Rival {
  pos: THREE.Vector3;
  yaw = 0;
  action: RivalAction = 'cook';
  stone = 0;
  isStatue = false;
  private target: THREE.Vector3 | null = null;
  private resolve: (() => void) | null = null;

  constructor(
    readonly rig: RivalRig,
    home: THREE.Vector3,
  ) {
    this.pos = home.clone();
    rig.root.position.copy(home);
  }

  walkTo(p: THREE.Vector3): Promise<void> {
    this.target = p.clone();
    return new Promise((r) => (this.resolve = r));
  }

  update(dt: number): void {
    if (this.target && !this.isStatue) {
      const d = this.target.clone().sub(this.pos).setY(0);
      const len = d.length();
      if (len < 0.04) {
        this.target = null;
        this.resolve?.();
        this.resolve = null;
      } else {
        this.pos.addScaledVector(d.normalize(), Math.min(len, 2.0 * dt));
        this.yaw = Math.atan2(d.x, d.z);
      }
    }
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.setStone(this.stone);
    this.rig.update(dt, this.target ? 'walk' : this.action);
  }
}

export class Rivals {
  readonly list: Rival[] = [];

  constructor(
    scene: THREE.Scene,
    homes: THREE.Vector3[],
    private physics: Physics,
    private particles: Particles,
  ) {
    homes.forEach((h, i) => {
      const r = new Rival(buildRival(i as 0 | 1 | 2), h);
      r.yaw = 0; // facing the south counter (+Z)
      scene.add(r.rig.root);
      this.list.push(r);
    });
  }

  /** Living rivals react to the mood of the kitchen. */
  setMood(panic: boolean): void {
    for (const r of this.list) if (!r.isStatue) r.action = panic ? 'cower' : 'cook';
  }

  /** Turn a rival to stone over a second and make them a physical obstacle. */
  async petrify(r: Rival): Promise<void> {
    const start = performance.now();
    audio.play('stoneCrack', { pos: r.pos, volume: 1 });
    await new Promise<void>((done) => {
      const tick = () => {
        const k = Math.min(1, (performance.now() - start) / 1300);
        r.stone = k;
        if (Math.random() < 0.6) this.particles.emit(r.pos.clone().setY(0.3 + Math.random() * 1.4), { color: 0x9a948a, count: 3, up: 0.2, speed: 0.4, gravity: 3, life: 1 });
        if (k < 1) requestAnimationFrame(tick);
        else done();
      };
      tick();
    });
    r.isStatue = true;
    this.physics.addCylinder({ x: r.pos.x, y: 0.9, z: r.pos.z }, 0.9, 0.32, GROUP.STATUE);
    audio.play('thud', { pos: r.pos, volume: 1, pitch: 0.5 });
  }

  update(dt: number): void {
    for (const r of this.list) r.update(dt);
  }
}
