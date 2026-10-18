import * as THREE from 'three';
import { mat } from '../engine/psx';

let plateGeo: THREE.LatheGeometry | null = null;
const plateMat = () => mat(0xf6f3ec, { roughness: 0.22 });
const rimMat = () => mat(0xc9a24a, { roughness: 0.3, metalness: 0.9 });

/** White ceramic dinner plate with a gold rim, base at y = 0, about 0.48 m across. */
export function buildPlate(): THREE.Group {
  if (!plateGeo) {
    // Profile from the centre out: flat well, rising shoulder, wide rim with a rolled lip.
    const pts = [
      [0, 0.004], [0.15, 0.004], [0.17, 0.008], [0.19, 0.018], [0.225, 0.024], [0.238, 0.026], [0.242, 0.022],
      [0.236, 0.016], [0.2, 0.01], [0.17, 0.0], [0.12, 0.0], [0.11, -0.002], [0.0, -0.002],
    ].map(([x, y]) => new THREE.Vector2(x, y + 0.002));
    // Lathe faces point outward for a bottom-to-top profile; ours runs top-first, so reverse it.
    pts.reverse();
    plateGeo = new THREE.LatheGeometry(pts, 40);
  }
  const g = new THREE.Group();
  const plate = new THREE.Mesh(plateGeo, plateMat());
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.232, 0.0035, 6, 48), rimMat());
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.026;
  g.add(plate, rim);
  return g;
}

/** Red fire extinguisher standing upright, base at y = 0. Its nozzle points along -Z. */
export function buildExtinguisher(): THREE.Group {
  const g = new THREE.Group();
  const red = mat(0xc41a14, { roughness: 0.35, metalness: 0.2 });
  const black = mat(0x151515, { roughness: 0.6 });
  const chrome = mat(0xdddddd, { roughness: 0.15, metalness: 1 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.26, 6, 20), red);
  body.position.y = 0.19;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.04, 16), chrome);
  neck.position.y = 0.36;
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.09), black);
  lever.position.set(0, 0.39, 0.02);
  const hose = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 8, 20, Math.PI * 1.2), black);
  hose.position.set(0, 0.3, -0.06);
  hose.rotation.y = Math.PI / 2;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.06, 12), black);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.37, -0.09);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0605, 0.0605, 0.08, 20, 1, true), mat(0xf2f2f2, { roughness: 0.6 }));
  label.position.y = 0.2;
  g.add(body, neck, lever, hose, nozzle, label);
  return g;
}

/** One quilted red oven mitt, thumb out to the side; about 0.26 m long along +Y. */
export function buildMitt(): THREE.Group {
  const g = new THREE.Group();
  const red = mat(0xb81e1e, { roughness: 0.85 });
  const cuff = mat(0xe8e0d0, { roughness: 0.9 });
  const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.12, 6, 16), red);
  palm.scale.set(1, 1, 0.6);
  palm.position.y = 0.13;
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.05, 4, 10), red);
  thumb.position.set(0.05, 0.1, 0);
  thumb.rotation.z = -0.6;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.055, 0.05, 16), cuff);
  band.scale.set(1, 1, 0.65);
  band.position.y = 0.02;
  g.add(palm, thumb, band);
  return g;
}
