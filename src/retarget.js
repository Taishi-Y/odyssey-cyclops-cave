import * as THREE from 'three';

// World-space delta retargeting between two Mixamo-named rigs with different rest poses
// (X Bot: T-pose, MakeHuman: A-pose). The target rest is first re-aimed so each bone points
// the same way as the source rest, then per-frame world deltas are transferred.
const clean = (n) => n.replace(/^mixamorig:?/i, '');

function boneMap(root) {
  const m = new Map();
  root.traverse((o) => { if (o.isBone) m.set(clean(o.name), o); });
  return m;
}
function firstChildBone(b) { return b.children.find((c) => c.isBone); }

export function retargetClips(srcRoot, srcClips, tgtRoot, fps = 30) {
  srcRoot.updateMatrixWorld(true); tgtRoot.updateMatrixWorld(true);
  const S = boneMap(srcRoot), T = boneMap(tgtRoot);
  const names = [...T.keys()].filter((n) => S.has(n));
  // topological order (parents first)
  const order = [];
  tgtRoot.traverse((o) => { if (o.isBone && names.includes(clean(o.name))) order.push(clean(o.name)); });

  const q = () => new THREE.Quaternion();
  const srcRest = new Map(), tgtAligned = new Map();
  for (const n of order) srcRest.set(n, S.get(n).getWorldQuaternion(q()));
  // align target rest directions to source rest directions
  const saved = new Map(order.map((n) => [n, T.get(n).quaternion.clone()]));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Vector3();
  for (const n of order) {
    const tb = T.get(n), sb = S.get(n);
    const tc = firstChildBone(tb), sc = sb.children.find((x) => x.isBone && T.has(clean(x.name)) && tc && clean(x.name) === clean(tc.name)) || firstChildBone(sb);
    if (tc && sc && !/Hips/.test(n)) {
      tb.getWorldPosition(p); tc.getWorldPosition(c); a.subVectors(c, p).normalize();
      sb.getWorldPosition(p); sc.getWorldPosition(c); b.subVectors(c, p).normalize();
      if (a.lengthSq() > 0.5 && b.lengthSq() > 0.5) {
        const r = new THREE.Quaternion().setFromUnitVectors(a, b);
        const w = tb.getWorldQuaternion(q());
        const nw = r.multiply(w);
        const pw = tb.parent.getWorldQuaternion(q());
        tb.quaternion.copy(pw.invert().multiply(nw));
        tb.updateMatrixWorld(true);
      }
    }
    tgtAligned.set(n, tb.getWorldQuaternion(q()));
  }
  for (const n of order) T.get(n).quaternion.copy(saved.get(n));
  tgtRoot.updateMatrixWorld(true);

  const mixer = new THREE.AnimationMixer(srcRoot);
  const out = [];
  for (const clip of srcClips) {
    mixer.stopAllAction();
    const act = mixer.clipAction(clip); act.reset().play();
    const frames = Math.max(2, Math.ceil(clip.duration * fps) + 1);
    const times = new Float32Array(frames);
    const vals = new Map(order.map((n) => [n, new Float32Array(frames * 4)]));
    const tgtWorld = new Map();
    for (let f = 0; f < frames; f++) {
      const t = Math.min(clip.duration, f / fps);
      times[f] = t;
      mixer.setTime(t);
      srcRoot.updateMatrixWorld(true);
      tgtWorld.clear();
      for (const n of order) {
        const sb = S.get(n), tb = T.get(n);
        const sw = sb.getWorldQuaternion(q());
        const delta = sw.multiply(srcRest.get(n).clone().invert());
        const tw = delta.multiply(tgtAligned.get(n));
        tgtWorld.set(n, tw);
        const parentName = tb.parent && tb.parent.isBone ? clean(tb.parent.name) : null;
        const pw = parentName && tgtWorld.has(parentName) ? tgtWorld.get(parentName).clone() : tb.parent.getWorldQuaternion(q());
        const local = pw.invert().multiply(tw);
        local.toArray(vals.get(n), f * 4);
      }
    }
    act.stop();
    const tracks = order.map((n) => new THREE.QuaternionKeyframeTrack(`${T.get(n).name}.quaternion`, times, vals.get(n)));
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  return out;
}
