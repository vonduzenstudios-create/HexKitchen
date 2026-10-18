import * as THREE from 'three';

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Final pass: gameplay overlays (petrification creeping in from the edges, red damage flash,
// eye-glow tint), vignette, ACES tone mapping and sRGB output.
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

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash(i), b = hash(i + vec2(1,0)), c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  vec2 c = vUv - 0.5;
  float edge = length(c * vec2(1.3, 1.0)) * 1.6;

  // Petrification: stone creeps from the screen edges toward the centre.
  float n = noise(vUv * 9.0) * 0.35;
  float stoneMask = smoothstep(1.15 - uStone * 1.25, 1.25 - uStone * 1.25, edge + n);
  float grey = dot(col, vec3(0.3, 0.59, 0.11));
  vec3 stone = vec3(grey * 0.7 + 0.06) * vec3(0.95, 0.93, 0.88);
  float crack = smoothstep(0.004, 0.0, abs(noise(vUv * 22.0 + 3.0) - 0.5)) * step(0.5, uStone);
  stone *= 1.0 - crack * 0.6;
  col = mix(col, stone, stoneMask * min(1.0, uStone * 1.4));
  col = mix(col, vec3(grey), uStone * 0.35);

  // Eye-glow: sickly green wash while Gorgon's gaze is charging.
  col += vec3(0.08, 0.16, 0.01) * uGlow * (0.4 + 0.6 * edge);
  // Damage flash.
  col = mix(col, vec3(0.8, 0.02, 0.01), uFlash * 0.45);

  // Vignette.
  col *= 1.0 - smoothstep(0.5, 1.0, length(c)) * 0.45;
  col *= 1.0 - uFade;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // A touch of film grain after tone mapping, to break up banding in the dark basement.
  gl_FragColor.rgb += (hash(vUv * uRes + fract(uTime) * 61.0) - 0.5) * 0.025;
}
`;

/** `?gfx=low` turns off shadows and multisampling for weak GPUs (and headless tests). */
export const LOW_GFX = new URLSearchParams(location.search).get('gfx') === 'low';

export class PsxRenderer {
  readonly gl: THREE.WebGLRenderer;
  private target: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMat: THREE.ShaderMaterial;

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(LOW_GFX ? 0.75 : Math.min(window.devicePixelRatio, 1.5));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.85;
    this.gl.shadowMap.enabled = !LOW_GFX;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.gl.domElement);

    // The scene renders into a multisampled HDR target, then the post pass tone maps it to the screen.
    this.target = new THREE.WebGLRenderTarget(320, 240, {
      type: THREE.HalfFloatType,
      samples: LOW_GFX ? 0 : 4,
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
      toneMapped: true,
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
    const pr = this.gl.getPixelRatio();
    const vw = Math.round(w * pr);
    const vh = Math.round(h * pr);
    this.target.setSize(vw, vh);
    this.postMat.uniforms.uRes.value.set(vw, vh);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    this.postMat.uniforms.uTime.value = time;
    this.gl.setRenderTarget(this.target);
    this.gl.render(scene, camera);
    this.gl.setRenderTarget(null);
    this.gl.render(this.postScene, this.postCam);
  }
}
