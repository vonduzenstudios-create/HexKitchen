import * as THREE from 'three';
import { buildGorgon } from '../characters/gorgon';

/**
 * Renders a head-and-shoulders snapshot of a fresh Gorgon rig in a tiny throwaway WebGL renderer
 * and returns it as a PNG data URL. Never touches the main renderer or scene. Returns null on any
 * failure so the caller can keep the SVG fallback.
 */
export function renderGorgonPortrait(size = 256): string | null {
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    const rig = buildGorgon();
    scene.add(rig.root);
    rig.setAnger(0.35);
    rig.setEyeGlow(1);
    if (rig.glowCone) rig.glowCone.visible = false;
    // Let the pose settle into a scowl.
    for (let i = 0; i < 40; i++) rig.update(1 / 30, { pose: 'armsCrossed', lookAt: null });
    rig.root.updateMatrixWorld(true);

    const eye = rig.eyeWorldPosition(new THREE.Vector3());
    const headPos = rig.head.getWorldPosition(new THREE.Vector3());
    // Face direction: from the root towards the eyes on the horizontal plane, falling back to +Z.
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    fwd.normalize();
    const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const target = eye.clone().lerp(headPos, 0.3).add(new THREE.Vector3(0, 0.08, 0));
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    cam.position.copy(target).addScaledVector(fwd, 0.95).addScaledVector(side, 0.22).add(new THREE.Vector3(0, 0.02, 0));
    cam.lookAt(target);

    scene.add(new THREE.HemisphereLight(0xffd8b0, 0x301008, 1.1));
    const key = new THREE.DirectionalLight(0xffe2c0, 2.6);
    key.position.copy(target).addScaledVector(fwd, 2).addScaledVector(side, 1.4).add(new THREE.Vector3(0, 1.2, 0));
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff5a14, 3.2);
    rim.position.copy(target).addScaledVector(fwd, -2).addScaledVector(side, -1.5).add(new THREE.Vector3(0, 0.6, 0));
    scene.add(rim);
    const fill = new THREE.PointLight(0xff8030, 1.2, 4);
    fill.position.copy(target).addScaledVector(fwd, 0.8).add(new THREE.Vector3(0, -0.5, 0));
    scene.add(fill);

    renderer.render(scene, cam);
    const url = canvas.toDataURL('image/png');
    // A blank (fully transparent) frame means the context failed silently.
    const probe = document.createElement('canvas');
    probe.width = probe.height = 16;
    const g = probe.getContext('2d');
    if (g) {
      g.drawImage(canvas, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      let alpha = 0;
      for (let i = 3; i < d.length; i += 4) alpha += d[i];
      if (alpha < 255 * 20) return null;
    }
    return url;
  } catch (err) {
    console.warn('Gorgon portrait snapshot failed, using SVG', err);
    return null;
  } finally {
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }
}
