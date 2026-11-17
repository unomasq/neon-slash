import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { fx, fxState } from '../fx/bus';

const SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uAberration: { value: 0 },
    uVignette: { value: 0.25 },
    uDesat: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uDesat;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      vec2 o = d * uAberration;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + o).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - o).b;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, vec3(l), uDesat * 0.7);
      float r = length(d) * 1.414;
      c *= 1.0 - uVignette * smoothstep(0.35, 1.0, r);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** Один проход после bloom: хроматическая аберрация + виньетка + десатурация; также импульсы аберрации и bloom. */
export class PostFx {
  readonly pass = new ShaderPass(SHADER);
  aberrationOn = true;
  private ab = 0;
  private bloomBurst = 0;
  private offs: Array<() => void> = [];

  constructor() {
    this.offs.push(
      fx.on('hit', (e) => { this.ab = Math.max(this.ab, e.perfect ? 0.004 : 0.002); }),
      fx.on('drop', () => { this.ab = Math.max(this.ab, 0.006); this.bloomBurst = 0.8; }),
    );
  }

  update(dt: number, bloom: UnrealBloomPass | null, baseStrength: number): void {
    this.ab *= Math.exp(-dt / 0.035); // ~5% за 100 мс
    if (this.ab < 1e-5) this.ab = 0;
    this.bloomBurst *= Math.exp(-dt / 0.13); // ~5% за 0.4 с
    if (this.bloomBurst < 1e-3) this.bloomBurst = 0;
    const u = this.pass.uniforms;
    u.uAberration.value = this.aberrationOn ? this.ab : 0;
    u.uVignette.value = 0.25 + 0.4 * fxState.dim;
    u.uDesat.value = fxState.dim;
    if (bloom) bloom.strength = baseStrength * (1 + 0.6 * fxState.beatPulse) + this.bloomBurst;
  }

  dispose(): void { for (const o of this.offs) o(); this.offs.length = 0; this.pass.dispose(); }
}
