import * as THREE from 'three';
import { psxUniforms } from './psx';

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Colour depth reduction with ordered dithering, vignette, plus gameplay overlays:
// petrification (grey creeping in from the edges with cracks), red damage flash and eye-glow tint.
const POST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uStone;
uniform float uFlash;
uniform float uGlow;
uniform float uTime;
uniform float uFade;
varying vec2 vUv;

float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  for (int k = 0; k < 16; k++) { if (k == i) return m[k] / 16.0; }
  return 0.0;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash(i), b = hash(i + vec2(1,0)), c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  vec2 px = vUv * uRes;

  // Petrification: stone creeps from the screen edges toward the centre.
  vec2 c = vUv - 0.5;
  float edge = length(c * vec2(1.3, 1.0)) * 1.6;
  float n = noise(vUv * 9.0) * 0.35;
  float stoneMask = smoothstep(1.15 - uStone * 1.25, 1.25 - uStone * 1.25, edge + n);
  float grey = dot(col, vec3(0.3, 0.59, 0.11));
  vec3 stone = vec3(grey * 0.7 + 0.18) * vec3(0.95, 0.93, 0.88);
  float crack = smoothstep(0.02, 0.0, abs(noise(vUv * 22.0 + 3.0) - 0.5)) * step(0.5, uStone);
  stone *= 1.0 - crack * 0.6;
  col = mix(col, stone, stoneMask * min(1.0, uStone * 1.4));
  col = mix(col, vec3(grey), uStone * 0.35);

  // Eye-glow: sickly green wash while Gorgon's gaze is charging.
  col += vec3(0.25, 0.4, 0.05) * uGlow * (0.4 + 0.6 * edge);
  // Damage flash.
  col = mix(col, vec3(0.9, 0.1, 0.05), uFlash * 0.45);

  // Vignette.
  col *= 1.0 - smoothstep(0.45, 0.95, length(c)) * 0.55;

  // 5-bit colour with Bayer dithering.
  float levels = 31.0;
  float d = bayer4(px) - 0.5;
  col = floor(col * levels + 0.5 + d) / levels;

  col *= 1.0 - uFade;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class PsxRenderer {
  readonly gl: THREE.WebGLRenderer;
  private target: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMat: THREE.ShaderMaterial;
  /** Virtual resolution height; width follows the window aspect. */
  readonly virtualHeight = 240;

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(1);
    // Colours are authored as final display values (no linear workflow), like the PS1 did.
    THREE.ColorManagement.enabled = false;
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    container.appendChild(this.gl.domElement);
    this.gl.domElement.style.imageRendering = 'pixelated';

    this.target = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tScene: { value: this.target.texture },
        uRes: { value: new THREE.Vector2(320, 240) },
        uStone: { value: 0 },
        uFlash: { value: 0 },
        uGlow: { value: 0 },
        uTime: { value: 0 },
        uFade: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat));
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  set stone(v: number) {
    this.postMat.uniforms.uStone.value = v;
  }
  set flash(v: number) {
    this.postMat.uniforms.uFlash.value = v;
  }
  set glow(v: number) {
    this.postMat.uniforms.uGlow.value = v;
  }
  set fade(v: number) {
    this.postMat.uniforms.uFade.value = v;
  }

  aspect(): number {
    return window.innerWidth / Math.max(1, window.innerHeight);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h, true);
    const vh = this.virtualHeight;
    const vw = Math.round(vh * (w / Math.max(1, h)));
    this.target.setSize(vw, vh);
    this.postMat.uniforms.uRes.value.set(vw, vh);
    psxUniforms.uSnap.value.set(vw, vh);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    this.postMat.uniforms.uTime.value = time;
    this.gl.setRenderTarget(this.target);
    this.gl.render(scene, camera);
    this.gl.setRenderTarget(null);
    this.gl.render(this.postScene, this.postCam);
  }
}
