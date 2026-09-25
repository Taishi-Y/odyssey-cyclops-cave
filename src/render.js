import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
  NoiseEffect, BlendFunction, ChromaticAberrationEffect, SMAAEffect, BrightnessContrastEffect, HueSaturationEffect, Effect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

// Film-print style grade: teal shadows / amber highlights, lifted-but-crushed blacks, halation
class FilmGradeEffect extends Effect {
  constructor() {
    super('FilmGrade', `
      uniform float uTime; uniform float uShake; uniform float uFlash;
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
        outputColor = vec4(c, inputColor.a);
      }`, { uniforms: new Map([['uTime', new THREE.Uniform(0)], ['uShake', new THREE.Uniform(0)], ['uFlash', new THREE.Uniform(0)]]) });
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
  const sanitize = new EffectPass(camera, new SanitizeEffect());
  composer.addPass(sanitize);
  const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
  ao.configuration.aoRadius = 1.6;
  ao.configuration.distanceFalloff = 1.0;
  ao.configuration.intensity = 3.0;
  ao.configuration.halfRes = true;
  ao.configuration.gammaCorrection = false;
  ao.setQualityMode('Medium');
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
  composer.addPass(new EffectPass(camera, new SanitizeEffect()));
  composer.addPass(new EffectPass(camera, bloom));
  composer.addPass(new EffectPass(camera, tone, grade, bc, hs, vignette));
  composer.addPass(new EffectPass(camera, ca));
  composer.addPass(new EffectPass(camera, noise));
  composer.addPass(new EffectPass(camera, smaa));
  return { composer, bloom, grade, vignette, ao, ca, hs };
}
