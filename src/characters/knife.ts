import * as THREE from 'three';
import { mat } from '../engine/psx';

/**
 * Chef's knife. The handle sits at the origin and runs along +Z, with the blade extending along -Z
 * (the hands rig's grip convention). The cutting edge faces -Y.
 */
export function buildKnife(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat(0xdfe4ea, { roughness: 0.18, metalness: 1 });
  const edge = mat(0xf6f8fb, { roughness: 0.08, metalness: 1 });
  const wood = mat(0x2a1810, { roughness: 0.55 });
  const brass = mat(0xc8a050, { roughness: 0.3, metalness: 1 });

  // Blade profile in the Z/Y plane: straight spine, curved belly rising to the tip.
  const s = new THREE.Shape();
  s.moveTo(0, 0.004);
  s.lineTo(-0.2, 0.004);
  s.quadraticCurveTo(-0.235, 0.0, -0.245, -0.012);
  s.quadraticCurveTo(-0.17, -0.044, -0.03, -0.046);
  s.lineTo(0, -0.046);
  s.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(s, { depth: 0.0025, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 16 });
  bladeGeo.translate(0, 0, -0.00125);
  bladeGeo.rotateY(-Math.PI / 2);
  const blade = new THREE.Mesh(bladeGeo, steel);
  blade.position.z = -0.012;
  // Bright polished bevel along the edge.
  const bevel = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.006, 0.19), edge);
  bevel.position.set(0, -0.043, -0.12);
  const bolster = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.018, 12), steel);
  bolster.rotation.x = Math.PI / 2;
  bolster.position.set(0, -0.012, -0.004);
  const handleGeo = new THREE.CapsuleGeometry(0.011, 0.1, 6, 12);
  handleGeo.rotateX(Math.PI / 2);
  handleGeo.scale(0.8, 1.15, 1);
  const handle = new THREE.Mesh(handleGeo, wood);
  handle.position.set(0, -0.012, 0.058);
  g.add(blade, bevel, bolster, handle);
  for (const z of [0.03, 0.065, 0.1]) {
    const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.019, 8), brass);
    rivet.rotation.z = Math.PI / 2;
    rivet.position.set(0, -0.012, z);
    g.add(rivet);
  }
  return g;
}
