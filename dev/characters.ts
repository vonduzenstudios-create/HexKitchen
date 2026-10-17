import * as THREE from 'three';
import { buildGorgon, type GorgonPose } from '../src/characters/gorgon';
import { buildRival, type RivalAction } from '../src/characters/rival';
import { buildHands, type HandsPose } from '../src/characters/hands';
import { mat } from '../src/engine/psx';

// Character preview. URL params:
//  view=grid|front|close|three|far|rivals|hands   scale=N (css upscale)
//  pose=<GorgonPose> glow=0..1 anger=0..1 hpose=<HandsPose> hstone=0..1 action=<RivalAction>
const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'grid';
const hi = Number(q.get('hi') ?? 1);
const W = 320 * hi;
const H = 240 * hi;
const views = view === 'grid' ? ['front', 'close', 'three', 'far', 'rivals', 'hands'] : [view];
const cols = views.length > 1 ? 3 : 1;
const rows = Math.ceil(views.length / cols);
const scale = Number(q.get('scale') ?? (views.length > 1 ? 2 : 3 / hi));

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(W * cols, H * rows, false);
renderer.domElement.style.width = `${W * cols * scale}px`;
renderer.domElement.style.height = `${H * rows * scale}px`;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141216);
scene.fog = new THREE.Fog(0x141216, 6, 16);
scene.add(new THREE.HemisphereLight(0x9aa4c0, 0x3a2a20, 1.1));
const sun = new THREE.DirectionalLight(0xffd0a0, 2.2);
sun.position.set(2, 4, 3);
scene.add(sun);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), mat(0x3a3430));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const gorgon = buildGorgon();
scene.add(gorgon.root);

const rivals = ([0, 1, 2] as const).map((v, i) => {
  const r = buildRival(v);
  r.root.position.set(2.2 + i * 0.9, 0, -0.6);
  r.root.rotation.y = -0.4;
  scene.add(r.root);
  return r;
});
rivals[1].setStone(Number(q.get('rstone') ?? 0.55));
const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 0.9, 0.6), mat(0x8a8f96));
counter.position.set(3.4, 0.45, -1.6);
counter.rotation.y = -0.4;
scene.add(counter);

// hands scene
const hScene = new THREE.Scene();
hScene.background = new THREE.Color(0x1a1612);
hScene.add(new THREE.HemisphereLight(0x9aa4c0, 0x3a2a20, 1.1));
const hSun = new THREE.DirectionalLight(0xffd0a0, 2.2);
hSun.position.set(1, 3, 2);
hScene.add(hSun);
const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.8), mat(0x6a5038));
board.position.set(0, -0.95, -0.7);
hScene.add(board);
const hCam = new THREE.PerspectiveCamera(70, W / H, 0.05, 50);
hScene.add(hCam);
const hands = buildHands();
hCam.add(hands.root);
const knife = new THREE.Group();
knife.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.1).translate(0, 0, 0.02), mat(0x3a2418)));
knife.add(new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.04, 0.18).translate(0, -0.005, -0.12), mat(0xd0d4d8)));
hands.rightGrip.add(knife);

const cams: Record<string, THREE.PerspectiveCamera> = {};
function cam(name: string, pos: [number, number, number], look: [number, number, number], fov = 60) {
  const c = new THREE.PerspectiveCamera(fov, W / H, 0.05, 60);
  c.position.set(...pos);
  c.lookAt(...look);
  cams[name] = c;
}
cam('front', [0, 1.3, 3.2], [0, 1.05, 0]);
cam('close', [0, 1.75, 1.0], [0, 1.72, 0], 50);
cam('three', [1.6, 1.6, 2.0], [0, 1.4, 0], 55);
cam('far', [0.5, 1.6, 7.5], [1.2, 1.0, 0], 60);
cam('side', [2.6, 1.6, 0.2], [0, 1.6, 0.1], 40);
cam('back', [-1.2, 1.9, -2.2], [0, 1.6, 0], 45);
cam('rivals', [3.2, 1.3, 3.0], [3.1, 0.9, -0.4], 60);

const poses: GorgonPose[] = ['idle', 'yell', 'point', 'gaze', 'slam', 'armsCrossed', 'taste', 'laugh', 'stunned', 'walk'];
const hPoses: HandsPose[] = ['idle', 'reach', 'hold', 'chop', 'shake', 'flip', 'stir', 'raisePan', 'cover'];
const rActions: RivalAction[] = ['cook', 'panic', 'walk', 'cower', 'idle'];
const fixedPose = q.get('pose') as GorgonPose | null;
const fixedH = q.get('hpose') as HandsPose | null;
const fixedA = q.get('action') as RivalAction | null;
const label = document.getElementById('label')!;
const lookTarget = new THREE.Vector3(0, 1.6, 3);
if (q.get('look')) {
  const [x, y, z] = q.get('look')!.split(',').map(Number);
  lookTarget.set(x, y, z);
}

let time = Number(q.get('t') ?? 0);
const clock = new THREE.Timer();
function frame() {
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  const pose = fixedPose ?? poses[Math.floor(time / 3) % poses.length];
  const glow = q.get('glow') !== null ? Number(q.get('glow')) : pose === 'gaze' ? 1 : 0.5 + 0.5 * Math.sin(time * 0.7) > 0.8 ? 0.6 : 0;
  const anger = q.get('anger') !== null ? Number(q.get('anger')) : 0.5 + 0.5 * Math.sin(time * 0.3);
  gorgon.setEyeGlow(glow);
  gorgon.setAnger(anger);
  gorgon.update(dt, { pose, speed: 1.4, talking: pose === 'idle' && Math.sin(time) > 0, lookAt: q.get('nolook') ? null : lookTarget });
  const act = fixedA ?? rActions[Math.floor(time / 3) % rActions.length];
  rivals.forEach((r, i) => r.update(dt, i === 1 ? 'panic' : act));
  const hp = fixedH ?? hPoses[Math.floor(time / 2) % hPoses.length];
  hands.update(dt, hp);
  hands.setStone(q.get('hstone') !== null ? Number(q.get('hstone')) : (time * 0.1) % 1.2);
  label.textContent = `gorgon:${pose} glow:${glow.toFixed(2)} anger:${anger.toFixed(2)} | rivals:${act} | hands:${hp}`;

  views.forEach((v, i) => {
    const x = (i % cols) * W;
    const y = (rows - 1 - Math.floor(i / cols)) * H;
    renderer.setViewport(x, y, W, H);
    renderer.setScissor(x, y, W, H);
    if (v === 'hands') renderer.render(hScene, hCam);
    else renderer.render(scene, cams[v]);
  });
  requestAnimationFrame(frame);
}
frame();
