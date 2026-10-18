import * as THREE from 'three';
import { RAPIER, Physics, GROUP, groups } from '../engine/physics';
import type { Input } from '../engine/input';

const RADIUS = 0.3;
const HALF = 0.55;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.0;

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  crouch = 0;
  /** When false, mouse movement is consumed by a station instead of looking. */
  lookEnabled = true;
  moveEnabled = true;
  sensitivity = 0.0022;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private vy = 0;
  private bob = 0;
  shake = 0;
  /** Optional override: smoothly turn to face this point (used by cutscenes). */
  faceTarget: THREE.Vector3 | null = null;

  constructor(
    physics: Physics,
    spawn: THREE.Vector3,
    aspect: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 40);
    const w = physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, HALF + RADIUS, spawn.z));
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups(groups(GROUP.PLAYER, GROUP.STATIC | GROUP.STATUE | GROUP.ITEM)),
      this.body,
    );
    this.controller = w.createCharacterController(0.02);
    this.controller.enableSnapToGround(0.3);
    this.controller.enableAutostep(0.15, 0.1, false);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(70);
    this.yaw = 0; // yaw 0 faces -Z, toward the back counter
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - HALF - RADIUS, t.z);
  }

  get eyeHeight(): number {
    return THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, this.crouch);
  }

  forward(target = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(target);
  }

  teleport(p: THREE.Vector3, yaw: number): void {
    this.body.setTranslation({ x: p.x, y: HALF + RADIUS, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: HALF + RADIUS, z: p.z });
    this.yaw = yaw;
    this.pitch = 0;
  }

  update(dt: number, input: Input): void {
    if (this.faceTarget) {
      const eye = this.camera.position;
      const d = this.faceTarget.clone().sub(eye);
      const targetYaw = Math.atan2(-d.x, -d.z);
      const targetPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      let dy = targetYaw - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * Math.min(1, dt * 3);
      this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 3);
    } else if (this.lookEnabled) {
      this.yaw -= input.mouseDX * this.sensitivity;
      this.pitch -= input.mouseDY * this.sensitivity;
      this.pitch = Math.max(-1.45, Math.min(1.35, this.pitch));
    }

    const wantCrouch = this.moveEnabled && (input.keys.has('Space') || input.keys.has('ControlLeft') || input.keys.has('KeyC'));
    this.crouch += ((wantCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);

    const move = new THREE.Vector3();
    if (this.moveEnabled) {
      const f = (input.keys.has('KeyW') || input.keys.has('ArrowUp') ? 1 : 0) - (input.keys.has('KeyS') || input.keys.has('ArrowDown') ? 1 : 0);
      const s = (input.keys.has('KeyD') || input.keys.has('ArrowRight') ? 1 : 0) - (input.keys.has('KeyA') || input.keys.has('ArrowLeft') ? 1 : 0);
      move.set(s, 0, -f);
      if (move.lengthSq() > 0) move.normalize();
      move.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      const sprint = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? 1.45 : 1;
      const speed = THREE.MathUtils.lerp(4.8, 2.2, this.crouch) * sprint;
      move.multiplyScalar(speed * dt);
    }
    this.vy -= 9.81 * dt;
    move.y = this.vy * dt;
    this.controller.computeColliderMovement(this.collider, move);
    const m = this.controller.computedMovement();
    if (this.controller.computedGrounded()) this.vy = 0;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });

    const horiz = Math.hypot(m.x, m.z) / Math.max(dt, 1e-4);
    this.bob += horiz * dt * 7;
    const p = this.position;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * this.shake * 0.06;
    this.camera.position.set(
      p.x + (Math.random() - 0.5) * sh,
      p.y + this.eyeHeight + Math.sin(this.bob) * 0.025 * Math.min(1, horiz / 2) + (Math.random() - 0.5) * sh,
      p.z + (Math.random() - 0.5) * sh,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
