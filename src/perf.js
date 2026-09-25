import * as THREE from 'three';

// Every visible light is evaluated for every pixel of every lit material, so the torches, the side fires and
// the stake glow were costing about a third of the frame. The game keeps driving those lights as before, but they
// are hidden, and a fixed pool of a few real lights copies the ones nearest the camera each frame (fading in/out,
// so a torch never pops). The light count never changes, so no shader recompiles.
export function createLightPool(scene, camera, { size = 3, active = 2 } = {}) {
  const sources = [];
  scene.traverse((o) => { if (o.isPointLight && !o.castShadow) sources.push({ l: o, w: 0 }); });
  const pool = [];
  for (let i = 0; i < size; i++) { const l = new THREE.PointLight(0xffffff, 0, 1, 2); scene.add(l); pool.push(l); }
  const cam = new THREE.Vector3(), p = new THREE.Vector3();
  const score = (s) => {
    s.l.getWorldPosition(p);
    s.pos = p.clone();
    if (s.l.intensity <= 0) return -1;
    // how close the light's reach comes to the camera (lights that only touch far, fogged walls matter least)
    return s.l.intensity / (1 + Math.max(0, p.distanceTo(cam) - s.l.distance * 0.5) ** 2);
  };
  return {
    sources,
    update(dt) {
      camera.getWorldPosition(cam);
      for (const s of sources) { s.l.visible = false; s.score = score(s); }
      const ranked = sources.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
      const want = new Set(ranked.slice(0, active));
      const k = Math.min(1, dt * 4);
      for (const s of sources) s.w += ((want.has(s) ? 1 : 0) - s.w) * k;
      const shown = sources.filter((s) => s.w > 0.01 && s.l.intensity > 0).sort((a, b) => b.w - a.w).slice(0, size);
      pool.forEach((l, i) => {
        const s = shown[i];
        if (!s) { l.intensity = 0; return; }
        l.position.copy(s.pos); l.color.copy(s.l.color); l.distance = s.l.distance; l.decay = s.l.decay;
        l.intensity = s.l.intensity * s.w;
      });
    },
  };
}

// Dynamic resolution: drop the render scale when frames run long, creep back up when there is headroom.
// The UI is DOM, so only the 3D image gets softer.
export function createResolutionScaler(renderer, post, { max = Math.min(devicePixelRatio, 1.5), min = 0.7, forced = null } = {}) {
  const steps = [];
  for (let s = max; s > min - 1e-3; s -= 0.15) steps.push(+s.toFixed(3));
  let idx = forced != null ? steps.length - 1 : 0;
  if (forced != null) { steps.length = 0; steps.push(forced); idx = 0; }
  let acc = 0, n = 0, cool = 1.5, upFails = 0, lastUp = -1;
  const apply = () => {
    renderer.setPixelRatio(steps[idx]);
    renderer.setSize(innerWidth, innerHeight);
    post.composer.setSize(innerWidth, innerHeight);
    // ambient occlusion is the next most expensive pass: keep it only while running near full resolution
    post.ao.enabled = post.aoAllowed !== false && steps[idx] >= Math.min(1, max);
  };
  apply();
  return {
    get scale() { return steps[idx]; },
    apply,
    update(dtReal) {
      if (steps.length < 2) return;
      cool -= dtReal;
      if (dtReal > 0.25) return;   // loading hitches and tab switches are not a steady frame rate
      acc += dtReal; n++;
      if (acc < 1) return;
      const avg = acc / n; acc = 0; n = 0;
      if (cool > 0) return;
      if (avg > 1 / 50 && idx < steps.length - 1) {
        // went up and immediately got slow again: stay lower for longer next time
        if (lastUp === idx) upFails++;
        idx++; cool = 2; apply();
      } else if (avg < 1 / 58 && idx > 0) {
        idx--; lastUp = idx; cool = 4 + upFails * 6; apply();
      }
    },
  };
}
