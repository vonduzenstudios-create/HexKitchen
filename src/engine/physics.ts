import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

/** Collision groups: membership in high 16 bits, filter in low 16 bits. */
export const GROUP = {
  STATIC: 0x0001,
  ITEM: 0x0002,
  PLAYER: 0x0004,
  STATUE: 0x0008,
};
export function groups(member: number, filter: number): number {
  return (member << 16) | filter;
}

export class Physics {
  world!: RAPIER.World;

  async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
  }

  /** Static axis-aligned box from center + full size. */
  addBox(center: THREE.Vector3Like, size: THREE.Vector3Like, opts: { friction?: number; group?: number } = {}): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z));
    const desc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setFriction(opts.friction ?? 0.8)
      .setCollisionGroups(groups(opts.group ?? GROUP.STATIC, 0xffff));
    return this.world.createCollider(desc, body);
  }

  /** Static vertical cylinder (statues, pots). */
  addCylinder(center: THREE.Vector3Like, halfHeight: number, radius: number, group = GROUP.STATIC): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z));
    return this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfHeight, radius).setCollisionGroups(groups(group, 0xffff)),
      body,
    );
  }

  /** First solid hit along a ray, ignoring items unless asked. */
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    filterMask = GROUP.STATIC | GROUP.STATUE,
    exclude?: RAPIER.Collider,
  ): { dist: number; collider: RAPIER.Collider } | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(0xffff, filterMask), exclude);
    if (!hit) return null;
    return { dist: hit.timeOfImpact, collider: hit.collider };
  }

  step(): void {
    this.world.step();
  }
}
