import * as THREE from 'three';
import { createRenderer, createComposer } from './render.js';
import { buildWorld } from './world.js';
import { Game } from './game.js';

const canvas = document.getElementById('c');
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x060302, 0.026);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 900);
scene.add(camera);
const post = createComposer(renderer, scene, camera);
const params0 = new URLSearchParams(location.search);
import { isTouchDevice } from './input.js';
const mobile = isTouchDevice();
if (params0.get('q') === 'low' || (mobile && params0.get('q') !== 'high')) { renderer.setPixelRatio(1); post.ao.enabled = false; post.composer.setSize(innerWidth, innerHeight); }
if (params0.get('q') === 'high') { renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); post.composer.setSize(innerWidth, innerHeight); }

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); post.composer.setSize(innerWidth, innerHeight);
});

const bar = document.querySelector('#loadbar div');
const txt = document.getElementById('loadtxt');
const params = new URLSearchParams(location.search);

const world = await buildWorld(scene, renderer, (p) => { bar.style.width = `${Math.round(p * 70)}%`; });
txt.textContent = 'Preparing the characters...';
const game = new Game({ scene, camera, renderer, world, post, params, onProgress: (p) => { bar.style.width = `${70 + Math.round(p * 30)}%`; } });
await game.init();
bar.style.width = '100%';
txt.textContent = 'Ready';
const startBtn = document.getElementById('start');
startBtn.disabled = false;
startBtn.onclick = () => { document.getElementById('menu').style.display = 'none'; game.start(); };
if (params.has('auto')) startBtn.onclick();
window.__game = game;

// precompile shaders to avoid hitches
renderer.compile(scene, camera);

const clock = new THREE.Clock();
let t = 0;
function tick(dtReal, render = true) {
  // Zelda-style bullet time: the world runs slower, the player's aim/draw stays responsive
  const ts = game.timeScale ?? 1;
  const dt = dtReal * ts;
  t += dt;
  for (const u of world.updaters) u(dt, t);
  game.update(dt, t, dtReal);
  if (render) post.composer.render(dt);
}
const manual = params.has('manual');
function frame() {
  const d = Math.min(clock.getDelta(), 1 / 20);
  if (!manual) tick(d); else post.composer.render(0);
  requestAnimationFrame(frame);
}
// dev helper: advance the simulation deterministically even when the tab is hidden
window.__step = async (n = 30, dt = 1 / 30) => { for (let i = 0; i < n; i++) { tick(dt, i === n - 1); for (let k = 0; k < 4; k++) await null; } return t; };
frame();
import { floorHeightAt, rockField, airDist } from './cave.js';
window.__dbg = { world, scene, camera, post, renderer, floorHeightAt, rockField, airDist, THREE };
