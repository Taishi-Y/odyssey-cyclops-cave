import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

function bakeWorldGeometry(objects) {
  const geos = [];
  for (const root of objects) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', o.geometry.attributes.position.clone());
      if (o.geometry.index) g.setIndex(o.geometry.index.clone());
      g.applyMatrix4(o.matrixWorld);
      geos.push(g.index ? g.toNonIndexed() : g);
    });
  }
  return mergeGeometries(geos, false);
}

export class Physics {
  constructor(staticObjects, dynamicObjects = []) {
    const g = bakeWorldGeometry(staticObjects);
    this.static = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.static.geometry.boundsTree = new MeshBVH(g);
    this.dynamic = dynamicObjects.map((o) => ({ obj: o, mesh: null }));
    this.rebuildDynamic();
    this._tri = null;
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
  }
  rebuildDynamic() {
    for (const d of this.dynamic) {
      const g = bakeWorldGeometry([d.obj]);
      if (d.mesh) d.mesh.geometry.dispose();
      d.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      d.mesh.geometry.boundsTree = new MeshBVH(g);
    }
  }
  meshes() { return [this.static, ...this.dynamic.map((d) => d.mesh)]; }

  // first hit along a segment
  raycastSegment(a, b) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return null;
    this.ray.set(a, dir.divideScalar(len));
    this.ray.far = len;
    let best = null;
    for (const m of this.meshes()) {
      const h = this.ray.intersectObject(m, false)[0];
      if (h && (!best || h.distance < best.distance)) best = h;
    }
    return best;
  }

  // resolve a vertical capsule (segment from p+r to p+h-r) against all colliders. Returns {onGround}
  collideCapsule(pos, radius, height, vel) {
    const seg = new THREE.Line3(new THREE.Vector3(0, radius, 0).add(pos), new THREE.Vector3(0, height - radius, 0).add(pos));
    const triPoint = new THREE.Vector3(), capPoint = new THREE.Vector3();
    const box = new THREE.Box3();
    let onGround = false;
    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;
      for (const m of this.meshes()) {
        box.makeEmpty(); box.expandByPoint(seg.start); box.expandByPoint(seg.end);
        box.min.addScalar(-radius); box.max.addScalar(radius);
        m.geometry.boundsTree.shapecast({
          intersectsBounds: (b) => b.intersectsBox(box),
          intersectsTriangle: (tri) => {
            const d = tri.closestPointToSegment(seg, triPoint, capPoint);
            if (d < radius) {
              const depth = radius - d;
              const dir = capPoint.clone().sub(triPoint);
              if (dir.lengthSq() < 1e-10) return;
              dir.normalize();
              seg.start.addScaledVector(dir, depth);
              seg.end.addScaledVector(dir, depth);
              if (dir.y > 0.55) onGround = true;
              pushed = true;
            }
          },
        });
      }
      if (!pushed) break;
    }
    const newPos = seg.start.clone().sub(new THREE.Vector3(0, radius, 0));
    const delta = newPos.clone().sub(pos);
    pos.copy(newPos);
    if (vel && delta.lengthSq() > 1e-10) {
      const n = delta.clone().normalize();
      const vn = vel.dot(n);
      if (vn < 0) vel.addScaledVector(n, -vn);
    }
    return { onGround };
  }

  groundHeight(x, z, fromY = 30) {
    const h = this.raycastSegment(new THREE.Vector3(x, fromY, z), new THREE.Vector3(x, -5, z));
    return h ? h.point.y : 0;
  }
}
