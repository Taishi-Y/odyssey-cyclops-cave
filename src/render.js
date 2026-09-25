import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
  NoiseEffect, BlendFunction, ChromaticAberrationEffect, SMAAEffect, BrightnessContrastEffect, HueSaturationEffect, Effect, EffectAttribute, DepthOfFieldEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

// Film-print style grade: teal shadows / amber highlights, lifted-but-crushed blacks, halation
class FilmGradeEffect extends Effect {
  constructor() {
    super('FilmGrade', `
      uniform float uTime; uniform float uShake; uniform float uFlash; uniform float uFilter; uniform float uExposure;
      vec3 filmic(vec3 c){
        float l = dot(c, vec3(0.2126,0.7152,0.0722));
        vec3 shadowTint = vec3(0.86,1.0,1.04);
        vec3 highTint = vec3(1.06,0.99,0.9);
        c *= mix(shadowTint, highTint, smoothstep(0.05, 0.6, l));
        // print-like toe: deep but not digital black
        c = max(c - 0.004, 0.0) * 1.004 + 0.006 * vec3(0.8,0.9,0.95);
        return c;
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec3 c = filmic(inputColor.rgb);
        // halation: red glow around bright areas approximated from the pixel itself
        float l = dot(c, vec3(0.3,0.6,0.1));
        c += vec3(0.06,0.012,0.0) * smoothstep(0.7, 1.0, l);
        c += vec3(uFlash);
        c *= exp2(uExposure * 2.0);
        float g = dot(c, vec3(0.299, 0.587, 0.114));
        if (uFilter > 0.5 && uFilter < 1.5) c = vec3(pow(g, 0.9)) * vec3(1.02, 1.0, 0.97);          // black & white
        else if (uFilter > 1.5 && uFilter < 2.5) c = mix(c, g * vec3(1.35, 0.85, 0.45), 0.55);     // firelight
        else if (uFilter > 2.5) c = mix(c, g * vec3(0.55, 0.95, 1.15), 0.6);                       // teal night
        outputColor = vec4(c, inputColor.a);
      }`, { uniforms: new Map([['uTime', new THREE.Uniform(0)], ['uShake', new THREE.Uniform(0)], ['uFlash', new THREE.Uniform(0)], ['uFilter', new THREE.Uniform(0)], ['uExposure', new THREE.Uniform(0)]]) });
  }
}

// Replaces NaN/Inf pixels (which bloom's mip chain would otherwise smear into a black frame)
class SanitizeEffect extends Effect {
  constructor() {
    super('Sanitize', `
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec4 c = inputColor;
        bool bad = any(isnan(c)) || any(isinf(c));
        outputColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(min(c.rgb, vec3(48.0)), c.a);
      }`);
  }
}


// Heat haze: the air above the campfire shimmers. Screen-space warp inside a cone over the fire,
// only on pixels at or behind the fire (depth test) so things in front of it stay sharp.
class HeatHazeEffect extends Effect {
  constructor(camera) {
    super('HeatHaze', `
      uniform float uTime; uniform vec2 uP0; uniform vec2 uP1; uniform float uR; uniform float uDepth; uniform float uAspect; uniform float uOn;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float hn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hh(i),hh(i+vec2(1,0)),f.x), mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x), f.y); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor){
        outputColor = inputColor;
        if (uOn < 0.5 || depth < uDepth - 0.0005) return;
        vec2 A = vec2(uAspect, 1.0);
        vec2 p = (uv - uP0) * A, a = (uP1 - uP0) * A;
        float t = dot(p, a) / max(dot(a, a), 1e-6);
        float r = uR * (0.55 + 0.9 * clamp(t, 0.0, 1.0));
        float d = length(p - a * t) / r;
        float m = smoothstep(1.0, 0.25, d) * smoothstep(0.0, 0.2, t) * smoothstep(1.0, 0.45, t);
        if (m <= 0.0) return;
        // fire-local coordinates so the ripples scale with the fire and rise with it
        vec2 q = vec2((p - a * t).x / uR, t * length(a) / uR);
        vec2 w = vec2(hn(q * vec2(5.0, 3.0) - vec2(0.0, uTime * 2.6)), hn(q * vec2(4.0, 6.0) + 17.0 - vec2(uTime * 0.4, uTime * 3.4))) - 0.5;
        vec2 off = w * m * uR * 0.09 / A;
        outputColor = texture2D(inputBuffer, uv + off);
      }`, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([['uTime', new THREE.Uniform(0)], ['uP0', new THREE.Uniform(new THREE.Vector2())], ['uP1', new THREE.Uniform(new THREE.Vector2())],
        ['uR', new THREE.Uniform(0)], ['uDepth', new THREE.Uniform(1)], ['uAspect', new THREE.Uniform(1)], ['uOn', new THREE.Uniform(0)]]),
    });
    this.camera = camera; this.target = null; this.height = 3.2; this.radius = 0.75;
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
  }
  update(renderer, inputBuffer, dt) {
    const U = this.uniforms, cam = this.camera;
    U.get('uTime').value += dt;
    if (!this.target) { U.get('uOn').value = 0; return; }
    const b = this._v.copy(this.target).add(new THREE.Vector3(0, 0.35, 0));
    const inView = b.clone().applyMatrix4(cam.matrixWorldInverse).z < -0.3;
    U.get('uOn').value = inView ? 1 : 0;
    if (!inView) return;
    const p0 = b.clone().project(cam), p1 = this._w.copy(b).add(new THREE.Vector3(0, this.height, 0)).project(cam);
    U.get('uP0').value.set(p0.x * 0.5 + 0.5, p0.y * 0.5 + 0.5);
    U.get('uP1').value.set(p1.x * 0.5 + 0.5, p1.y * 0.5 + 0.5);
    // projected radius in screen-height units
    const dist = b.distanceTo(cam.position);
    U.get('uR').value = this.radius / (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    U.get('uDepth').value = p0.z * 0.5 + 0.5;
    U.get('uAspect').value = cam.aspect;
  }
}

// Focus blur while drawing the bow: the edges of the screen smear toward the centre (radial zoom blur),
// the middle stays sharp. uAmt 0..1
class EdgeBlurEffect extends Effect {
  constructor() {
    super('EdgeBlur', `
      uniform float uAmt; uniform float uAspect;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec2 d = uv - 0.5;
        float r = length(d * vec2(uAspect, 1.0));
        float m = smoothstep(0.22, 0.75, r) * uAmt;
        if (m < 0.002) { outputColor = inputColor; return; }
        vec3 acc = inputColor.rgb; float w = 1.0;
        for (int i = 1; i <= 10; i++) {
          float k = float(i) / 10.0;
          float wi = 1.0 - k * 0.5;
          acc += texture2D(inputBuffer, uv - d * k * 0.07 * m).rgb * wi; w += wi;
        }
        outputColor = vec4(acc / w, inputColor.a);
      }`, { uniforms: new Map([['uAmt', new THREE.Uniform(0)], ['uAspect', new THREE.Uniform(1)]]) });
  }
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance', antialias: false, stencil: false, depth: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
  ao.configuration.aoRadius = 1.6;
  ao.configuration.distanceFalloff = 1.0;
  ao.configuration.intensity = 3.0;
  ao.configuration.halfRes = true;
  ao.configuration.gammaCorrection = false;
  ao.setQualityMode('Low');
  composer.addPass(ao);

  const bloom = new BloomEffect({ intensity: 1.1, luminanceThreshold: 0.75, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.8 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const grade = new FilmGradeEffect();
  const bc = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.16 });
  const hs = new HueSaturationEffect({ saturation: -0.08 });
  const ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0004), radialModulation: true, modulationOffset: 0.2 });
  const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.72 });
  const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
  noise.blendMode.opacity.value = 0.22;
  const smaa = new SMAAEffect();
  const haze = new HeatHazeEffect(camera);
  composer.addPass(new EffectPass(camera, haze));
  composer.addPass(new EffectPass(camera, new SanitizeEffect()));
  // photo-mode depth of field (off during play)
  const dofEffect = new DepthOfFieldEffect(camera, { focusDistance: 6, focusRange: 2, bokehScale: 3, resolutionScale: 0.75 });
  const dof = new EffectPass(camera, dofEffect); dof.enabled = false;
  composer.addPass(dof);
  const edgeBlur = new EdgeBlurEffect();
  const edgePass = new EffectPass(camera, edgeBlur); edgePass.enabled = false;
  composer.addPass(edgePass);
  // merged into as few full-screen passes as possible (CA and SMAA are convolution effects and need their own)
  composer.addPass(new EffectPass(camera, bloom, tone, grade, bc, hs, vignette, noise));
  // chromatic aberration is only visible in slow motion / photo mode, so the pass is switched on only then (game.js)
  const caPass = new EffectPass(camera, ca); caPass.enabled = false;
  composer.addPass(caPass);
  composer.addPass(new EffectPass(camera, smaa));
  return { composer, edgeBlur, edgePass, bloom, grade, vignette, ao, ca, caPass, hs, dof, dofEffect, haze };
}
