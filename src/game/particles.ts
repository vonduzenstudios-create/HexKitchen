import * as THREE from 'three';

// One pooled point cloud for every particle effect: steam, smoke, fire, seasoning, stone dust, sparks.

const MAX = 1200;

export interface EmitOpts {
  count?: number;
  color: THREE.ColorRepresentation;
  speed?: number;
  spread?: number;
  up?: number;
  gravity?: number;
  life?: number;
  size?: number;
  jitter?: number;
  /** Extra velocity added to every particle (sprays, jets). */
  push?: THREE.Vector3Like;
}

export class Particles {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private base = new Float32Array(MAX * 3);
  private next = 0;
  private tmp = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({ size: 0.035, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false });
    this.points = new THREE.Points(geo, m);
    this.points.frustumCulled = false;
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -100;
    scene.add(this.points);
  }

  emit(at: THREE.Vector3Like, o: EmitOpts): void {
    const n = o.count ?? 6;
    this.tmp.set(o.color);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const j = o.jitter ?? 0.03;
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * j * 2;
      this.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * j * 2;
      const sp = o.speed ?? 0.3;
      const spread = o.spread ?? 1;
      this.vel[i * 3] = (Math.random() - 0.5) * sp * spread * 2;
      this.vel[i * 3 + 1] = (o.up ?? 0.5) * (0.6 + Math.random() * 0.8);
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * sp * spread * 2;
      if (o.push) {
        this.vel[i * 3] += o.push.x;
        this.vel[i * 3 + 1] += o.push.y;
        this.vel[i * 3 + 2] += o.push.z;
      }
      this.grav[i] = o.gravity ?? 0;
      const l = (o.life ?? 1) * (0.7 + Math.random() * 0.6);
      this.life[i] = l;
      this.maxLife[i] = l;
      const v = 0.85 + Math.random() * 0.3;
      this.base[i * 3] = this.tmp.r * v;
      this.base[i * 3 + 1] = this.tmp.g * v;
      this.base[i * 3 + 2] = this.tmp.b * v;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -100;
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.grav[i] > 0 && this.pos[i * 3 + 1] < 0.01) {
        this.pos[i * 3 + 1] = 0.01;
        this.vel[i * 3] *= 0.5;
        this.vel[i * 3 + 1] = 0;
        this.vel[i * 3 + 2] *= 0.5;
      }
      const f = this.life[i] / this.maxLife[i];
      const fade = Math.min(1, f * 2);
      this.col[i * 3] = this.base[i * 3] * fade;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * fade;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * fade;
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}
